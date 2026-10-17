import { useCallback, useEffect, useRef, useState } from "react";
import { isNegativeTag } from "../lib/reviews";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Place, Tag } from "../lib/types";
import { Icon, Spinner, TopBar } from "../components/ui";
import { ReviewPhotoPicker } from "../components/ReviewPhoto";
import { ReviewVoiceRecorder, canRecordVoice, type VoiceClip } from "../components/ReviewVoice";
import { ItemThumb } from "../components/place/ItemThumb";
import { loadShopItems, priceLabel, shopLook, sortShopItems, type ShopItem } from "../components/place/shop";
import { deviceId } from "../lib/device";
import { callAi } from "../lib/assist";
import { modeOf, tagFits } from "../lib/modes";
import { fetchGoogleRating } from "../lib/google";
import { copyText, googleReviewUrl } from "../lib/util";
import { shareOrCopy, shareLink } from "../lib/invite";
import "../styles/place.css";
import "../styles/review.css";

type ItemOpt = ShopItem & { count: number };

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
type RecognitionCtor = new () => Recognition;
function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
function makeRecognition(): Recognition | null {
  const C = recognitionCtor();
  try { return C ? new C() : null; } catch { return null; }
}

const MAX_BODY = 2000;
const MAX_CUSTOM_TAGS = 5;
const MAX_DISHES = 5;

/** Free-text tags aren't in the tags table, so they ride along at the end of the review text. */
function withCustomTags(body: string, custom: string[]): string {
  const b = body.trim();
  if (!custom.length) return b;
  const line = `Tags: ${custom.join(", ")}`;
  return (b ? `${b}\n\n${line}` : line).slice(0, MAX_BODY);
}

const FACES = ["", "😣", "🙁", "😐", "😋", "🤩"];
const FACE_WORDS = ["Tap a star", "Not for me", "Could be better", "It was okay", "Really good", "Loved it!"];
const STAR_PATH = "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z";

/** One thing the person had, and everything they say about it. */
interface Dish {
  key: string;
  name: string;
  itemId: string | null;
  rating: number;
  picked: number[];
  custom: string[];
  body: string;
  aiDrafted: boolean;
  photo: Blob | null;
  voice: VoiceClip | null;
  /** Set once this dish has been saved, so a retry never posts it twice. */
  reviewId?: string;
}

const newDish = (name: string, itemId: string | null): Dish => ({ key: `${itemId || "x"}:${name.toLowerCase()}`, name, itemId, rating: 0, picked: [], custom: [], body: "", aiDrafted: false, photo: null, voice: null });

type Stage = "pick" | "dish" | "preview" | "sending" | "done";

/** What goes on Google: the person's own words per dish, or their picks when they wrote none. */
function googleText(dishes: Dish[], tags: Tag[]): string {
  const say = (d: Dish) => {
    const t = d.body.trim();
    if (t) return t;
    const good = [...tags.filter((x) => d.picked.includes(x.id) && !isNegativeTag(x.label)).map((x) => x.label.toLowerCase()), ...d.custom.map((x) => x.toLowerCase())];
    return good.length ? `${FACE_WORDS[d.rating]}. ${good.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()) : FACE_WORDS[d.rating];
  };
  if (dishes.length === 1) return say(dishes[0]!).slice(0, MAX_BODY);
  return dishes.map((d) => `${d.name} (${d.rating}/5): ${say(d)}`).join("\n\n").slice(0, 3000);
}

const averageStars = (dishes: Dish[]) => Math.max(1, Math.min(5, Math.round(dishes.reduce((n, d) => n + d.rating, 0) / Math.max(1, dishes.length))));

/** Can this person write a review here? Only during a visit started by a table QR scan. */
type Gate = "loading" | "ok" | "scan" | "guest_used" | "owner" | "paused";

async function checkGate(placeId: string, uid: string): Promise<Gate> {
  const r = await supabase.rpc("can_review", { p_place: placeId, p_device: deviceId() });
  if (!r.error) return ((r.data as { allowed: boolean; reason: string }[] | null)?.[0]?.reason as Gate) || "scan";
  if (r.error.code !== "PGRST202") throw r.error;
  // Database without migration 0014: fall back to "has an open visit".
  const v = await supabase.from("visits").select("id").eq("user_id", uid).eq("place_id", placeId).gt("expires_at", new Date().toISOString()).limit(1);
  return v.data?.length ? "ok" : "scan";
}

function ReviewGate({ placeId, name, reason }: { placeId: string; name?: string; reason: Gate }) {
  const used = reason === "guest_used";
  if (reason === "paused") return (
    <div className="page">
      <TopBar title={name || "Reviews"} />
      <div className="card rv-gate center">
        <span className="icon-chip lg sky" style={{ margin: "0 auto" }}><Icon name="clock" size={26} /></span>
        <h2>Reviews are paused here for now</h2>
        <p className="small muted">You can still see what people loved at this shop.</p>
        <Link to={`/p/${placeId}`} className="btn green block"><Icon name="eye" size={18} />See reviews</Link>
      </div>
    </div>
  );
  if (reason === "owner") return (
    <div className="page">
      <TopBar title={name || "Reviews"} />
      <div className="card rv-gate center">
        <span className="icon-chip lg violet" style={{ margin: "0 auto" }}><Icon name="store" size={26} /></span>
        <h2>This is your shop</h2>
        <p className="small muted">Owners can't review their own shop. Your customers rate it by scanning your table QR.</p>
        <Link to={`/manage/${placeId}`} className="btn green block"><Icon name="settings" size={18} />Manage shop</Link>
        <Link to={`/p/${placeId}`} className="btn ghost block"><Icon name="eye" size={18} />See reviews</Link>
      </div>
    </div>
  );
  return (
    <div className="page">
      <TopBar title={name || "Reviews"} />
      <div className="card rv-gate center">
        <span className={`icon-chip lg ${used ? "violet" : ""}`} style={{ margin: "0 auto" }}><Icon name={used ? "lock" : "qr"} size={26} /></span>
        <h2>{used ? "You've reviewed here from this phone" : "Reviews come from people at the shop"}</h2>
        <p className="small muted">{used
          ? "Without signing in, each phone gets one review per place. Sign in to rate more of what you had."
          : "Point your phone camera at the QR code on your table or counter, or open the review link the shop sent you. It keeps every review genuine."}</p>
        {used && <Link to={`/signin?next=${encodeURIComponent(`/review/${placeId}`)}`} className="btn green block"><Icon name="login" size={18} />Sign in</Link>}
        <Link to={`/p/${placeId}`} className="btn ghost block"><Icon name="eye" size={18} />See reviews</Link>
      </div>
    </div>
  );
}


export default function Review() {
  const { session, loading, profile } = useAuth();
  const { placeId = "" } = useParams();
  if (loading || (session && !profile)) return <div className="page"><Spinner /></div>;
  if (!session) return <ReviewGate placeId={placeId} reason="scan" />;
  return <ReviewForm />;
}

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const at = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    return r && r.width ? Math.max(1, Math.min(5, Math.ceil(((x - r.left) / r.width) * 5))) : value;
  };
  return (
    <div
      ref={box}
      className="rvx-stars"
      role="radiogroup"
      aria-label="Rating"
      onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button !== 0) return; onChange(at(e.clientX)); }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") onChange(at(e.clientX)); }}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? "s" : ""}`} className={i <= value ? "on" : ""} onClick={() => onChange(i)}>
          <svg viewBox="0 0 24 24" width="46" height="46" aria-hidden="true"><path d={STAR_PATH} /></svg>
        </button>
      ))}
    </div>
  );
}

function ReviewForm() {
  const { placeId = "" } = useParams();
  const [params] = useSearchParams();
  const { session, isGuest } = useAuth();
  const uid = session?.user.id;
  const nav = useNavigate();
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState("");
  const [reload, setReload] = useState(0);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [gate, setGate] = useState<Gate>("loading");
  const [googleLive, setGoogleLive] = useState<{ rating: number | null } | null>(null);

  const [stage, setStage] = useState<Stage>("pick");
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [at, setAt] = useState(0);
  const [other, setOther] = useState(false);
  const [otherName, setOtherName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState<string | false>(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Dish[]>([]);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [googleOpened, setGoogleOpened] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const [canDictate] = useState(() => Boolean(recognitionCtor()));
  const [canRecord] = useState(() => canRecordVoice());

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    setLoadErr("");
    setPlace(undefined);
    (async () => {
      try {
        const [p, it, st, tg, g] = await Promise.all([
          supabase.from("places").select("id, name, area, category, city, google_place_id, status, kind").eq("id", placeId).maybeSingle()
            .then((r) => r.error && /kind/.test(r.error.message) ? supabase.from("places").select("id, name, area, category, city, google_place_id, status").eq("id", placeId).maybeSingle() : r),
          loadShopItems(placeId),
          supabase.from("item_stats").select("item_id, review_count").eq("place_id", placeId),
          supabase.from("tags").select("id, label, kinds").order("id")
            .then((r) => r.error && /kinds/.test(r.error.message) ? supabase.from("tags").select("id, label").order("id") : r),
          checkGate(placeId, uid),
        ]);
        if (!alive) return;
        // A failed query is not the same as "this place isn't listed".
        const failed = [p, it, tg].find((r) => r.error);
        if (failed?.error) {
          // A malformed id in the URL comes back as an invalid-uuid error: that's simply not a place.
          if (p.error && /invalid input syntax for type uuid/i.test(p.error.message)) { setPlace(null); return; }
          setLoadErr(errorText(failed.error));
          return;
        }
        const pl = (p.data as Place | null) ?? null;
        setPlace(pl && pl.status === "live" ? pl : null);
        const counts = new Map(((st.data || []) as { item_id: string; review_count: number }[]).map((x) => [x.item_id, x.review_count]));
        const opts = sortShopItems(it.items.map((i) => ({ ...i, count: counts.get(i.id) ?? 0 })), (i) => i.count);
        setItems(opts);
        const pre = opts.find((i) => i.id === params.get("item"));
        if (pre) setDishes([newDish(pre.name, pre.id)]);
        else if (!opts.length) setOther(true);
        const kind = modeOf(pl?.kind, pl?.category).kind;
        setTags(((tg.data as Tag[]) || []).filter((t) => tagFits(t, kind)));
        setGate(g);
      } catch (e) {
        if (alive) setLoadErr(errorText(e) === "Failed to fetch" ? "You seem to be offline." : errorText(e));
      }
    })();
    return () => { alive = false; };
    // params are read once per load on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, uid, reload]);

  // The live Google rating is only shown, never stored. Failing to get it hides the badge.
  useEffect(() => {
    if (!place?.google_place_id) return;
    let alive = true;
    fetchGoogleRating(place.google_place_id).then((g) => { if (alive && g) setGoogleLive({ rating: g.rating }); }, () => {});
    return () => { alive = false; };
  }, [place?.google_place_id]);

  // Stop listening if the page goes away.
  useEffect(() => () => rec.current?.stop(), []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [stage, at]);

  const dish = dishes[at];
  const patch = (i: number, p: Partial<Dish>) => setDishes((all) => all.map((d, k) => (k === i ? { ...d, ...p } : d)));
  const postedKeys = new Set(done.map((d) => d.key));

  function toggleItem(i: ShopItem) {
    setErr("");
    setDishes((all) => {
      const key = newDish(i.name, i.id).key;
      if (all.some((d) => d.key === key)) return all.filter((d) => d.key !== key);
      if (all.length >= MAX_DISHES) { setErr(`Up to ${MAX_DISHES} dishes in one go.`); return all; }
      return [...all, newDish(i.name, i.id)];
    });
  }
  function addOther() {
    const name = otherName.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return;
    const known = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    setErr("");
    setDishes((all) => {
      const d = newDish(known?.name || name, known?.id ?? null);
      if (all.some((x) => x.key === d.key)) return all;
      if (all.length >= MAX_DISHES) { setErr(`Up to ${MAX_DISHES} dishes in one go.`); return all; }
      return [...all, d];
    });
    setOtherName("");
  }

  function toggleTag(id: number) {
    if (!dish) return;
    patch(at, { picked: dish.picked.includes(id) ? dish.picked.filter((x) => x !== id) : [...dish.picked, id] });
  }
  function addCustomTag() {
    if (!dish) return;
    const t = (tagDraft || "").replace(/\s+/g, " ").replace(/^#/, "").trim().slice(0, 30);
    if (!t) { setTagDraft(null); return; }
    const lower = t.toLowerCase();
    const known = tags.find((x) => x.label.toLowerCase() === lower);
    if (known) {
      if (!dish.picked.includes(known.id)) patch(at, { picked: [...dish.picked, known.id] });
    } else if (!dish.custom.some((x) => x.toLowerCase() === lower)) {
      if (dish.custom.length >= MAX_CUSTOM_TAGS) { setErr(`Up to ${MAX_CUSTOM_TAGS} of your own tags.`); return; }
      patch(at, { custom: [...dish.custom, t] });
    }
    setTagDraft(null);
  }

  const dictate = useCallback(() => {
    if (listening) { rec.current?.stop(); return; }
    const r = makeRecognition();
    if (!r || !dish) return;
    const i = at;
    rec.current = r;
    r.lang = "en-IN"; r.interimResults = false; r.continuous = true;
    const start = dish.body ? dish.body.trimEnd() + " " : "";
    r.onresult = (e) => {
      const heard = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ");
      patch(i, { body: (start + heard).slice(0, MAX_BODY) });
    };
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); setErr("Couldn't hear you. Check the microphone permission, or type instead."); };
    try { r.start(); setListening(true); } catch { setListening(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, dish, at]);

  async function draft() {
    if (!dish || !dish.rating) { setErr("Give it stars first."); return; }
    setDrafting(true); setErr("");
    const i = at;
    try {
      const j = await callAi<{ text?: string }>("draft", {
        place: place?.name, category: place?.category, item: dish.name, rating: dish.rating,
        tags: [...tags.filter((t) => dish.picked.includes(t.id)).map((t) => t.label), ...dish.custom], notes: dish.body,
      });
      if (!j.text) throw new Error("The AI draft isn't available right now. You can write it yourself.");
      patch(i, { body: j.text.slice(0, MAX_BODY), aiDrafted: true });
    } catch (e) {
      setErr(`${errorText(e)}. You can write it yourself.`.replace(/\.\. /, ". "));
    } finally {
      setDrafting(false);
    }
  }

  function goDish(i: number) { if (listening) rec.current?.stop(); setErr(""); setAt(i); setStage("dish"); }
  function next() {
    setErr("");
    if (!dish?.rating) { setErr("Tap a star to rate it."); return; }
    if (recording) { setErr("Stop the recording first."); return; }
    if (listening) rec.current?.stop();
    if (at < dishes.length - 1) setAt(at + 1); else setStage("preview");
  }
  function back() {
    setErr("");
    if (stage === "preview") { setAt(dishes.length - 1); setStage("dish"); }
    else if (stage === "dish") { if (at > 0) setAt(at - 1); else setStage("pick"); }
  }

  const gUrl = place?.google_place_id
    ? googleReviewUrl(place.google_place_id)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place?.name, place?.area, place?.city].filter(Boolean).join(" "))}`;

  /** Copy on the tap itself (browsers refuse it later), then keep the tab to point at Google. */
  function copyNow(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => false);
    return copyText(text).catch(() => false);
  }

  async function post(withGoogle: boolean) {
    if (saving || !uid || !place) return;
    if (dishes.some((d) => !d.rating)) { setErr("Every dish needs its stars."); return; }
    if (recording) { setErr("Stop the recording first."); return; }
    if (listening) rec.current?.stop();
    setErr("");
    const text = googleText(dishes, tags);
    let win: Window | null = null;
    let copying: Promise<boolean> = Promise.resolve(false);
    if (withGoogle) {
      copying = copyNow(text);
      try { win = window.open("", "_blank"); } catch { win = null; }
    }
    setStage("sending");
    setSaving("Saving…");
    const saved: Dish[] = [];
    try {
      for (const d of dishes) {
        if (d.reviewId) { saved.push(d); continue; }
        const uploaded: { bucket: string; path: string }[] = [];
        try {
          let photoPath: string | null = null;
          let voicePath: string | null = null;
          if (d.photo) {
            setSaving(`Uploading the ${d.name} photo…`);
            // A random name, so the link never shows who posted it.
            const path = `${crypto.randomUUID()}.jpg`;
            const { error } = await supabase.storage.from("review-photos").upload(path, d.photo, { contentType: "image/jpeg", upsert: false });
            if (error) throw new Error(`The photo didn't upload: ${errorText(error)}`);
            uploaded.push({ bucket: "review-photos", path });
            photoPath = path;
          }
          if (d.voice) {
            setSaving(`Uploading the ${d.name} voice note…`);
            const path = `${crypto.randomUUID()}.${d.voice.ext}`;
            const { error } = await supabase.storage.from("voice").upload(path, d.voice.blob, { contentType: d.voice.mime.split(";")[0] || "audio/webm", upsert: false });
            if (error) throw new Error(`The voice note didn't upload: ${errorText(error)}`);
            uploaded.push({ bucket: "voice", path });
            voicePath = path;
          }
          setSaving(dishes.length > 1 ? `Saving ${d.name}…` : "Saving…");
          const existing = items.find((i) => i.name.toLowerCase() === d.name.toLowerCase());
          const args = {
            p_place_id: placeId,
            p_item_name: d.name,
            p_rating: d.rating,
            p_body: withCustomTags(d.body, d.custom),
            p_topic_id: existing?.topic_id ?? null,
            p_tag_ids: d.picked,
            p_ai_drafted: d.aiDrafted,
            p_voice_path: voicePath,
            p_photo_path: photoPath,
            p_is_public: isPublic,
            p_device: deviceId(),
          };
          let { data, error } = await supabase.rpc("submit_review", args);
          // Database without migration 0014 doesn't know p_device yet.
          if (error?.code === "PGRST202") {
            const { p_device: _d, ...older } = args;
            ({ data, error } = await supabase.rpc("submit_review", older));
          }
          if (error) throw error;
          const withId = { ...d, reviewId: (data as { id: string }).id };
          saved.push(withId);
          setDishes((all) => all.map((x) => (x.key === d.key ? withId : x)));
        } catch (e) {
          await Promise.all(uploaded.map((u) => supabase.storage.from(u.bucket).remove([u.path]))).catch(() => {});
          throw e;
        }
      }
      const ok = await copying;
      setCopied(withGoogle ? ok : null);
      if (withGoogle) {
        if (win) { win.location.href = gUrl; setGoogleOpened(true); }
        const first = saved[0]?.reviewId;
        if (first) void supabase.from("google_shares").insert({ review_id: first, user_id: uid }).then(({ error }) => { if (error) console.warn(errorText(error)); });
      }
      setDone((all) => [...all, ...saved]);
      setSaving(false);
      setStage("done");
    } catch (e) {
      try { win?.close(); } catch { /* already gone */ }
      const m = errorText(e);
      setErr(m === "Failed to fetch" ? "You seem to be offline. Your review is still here; try again." : m);
      setSaving(false);
      setStage("preview");
    }
  }

  /** From the "done" screen: copy and open Google in one tap. */
  function openGoogle() {
    const text = googleText(done, tags);
    const copying = copyNow(text);
    let win: Window | null = null;
    try { win = window.open(gUrl, "_blank"); } catch { win = null; }
    if (win) win.opener = null;
    setGoogleOpened(true);
    void copying.then((ok) => {
      setCopied(ok);
      if (!win && ok) window.location.href = gUrl;
    });
  }

  async function copyAgain() { setCopied(await copyNow(googleText(done, tags))); }

  async function share() {
    const url = await shareLink(`/p/${placeId}`, "review");
    const lines = done.map((d) => `${d.name} ${"★".repeat(d.rating)}`).join(", ");
    await shareOrCopy({ title: place?.name, text: `${lines} at ${place?.name}`, url });
  }

  function another() {
    setDishes([]); setAt(0); setErr(""); setOther(false); setOtherName(""); setCopied(null);
    setStage("pick");
  }

  if (loadErr) return (
    <div className="page">
      <TopBar title="Rate what you had" />
      <div className="notice err" role="alert">
        <div className="stack" style={{ gap: 8 }}>
          <span>Couldn't load this place: {loadErr}</span>
          <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => setReload((n) => n + 1)}>Retry</button>
        </div>
      </div>
    </div>
  );
  if (place === undefined || (place && gate === "loading")) return <div className="page"><Spinner /></div>;
  if (!place) return (
    <div className="page"><TopBar /><div className="empty">
      <h2>This place isn't listed</h2>
      <p>It may have been removed, or the link is wrong.</p>
      <button type="button" className="btn ghost" onClick={() => nav("/")}>Search places</button>
    </div></div>
  );
  // After the first dish is saved a guest's gate flips, but the visit is still open: keep the flow going.
  if (gate !== "ok" && stage !== "done" && stage !== "sending") return <ReviewGate placeId={placeId} name={place.name} reason={gate} />;

  const look = shopLook(place.category, place.kind);
  const mode = modeOf(place.kind, place.category);
  const stars = averageStars(stage === "done" ? done : dishes);
  const goodTags = tags.filter((t) => !isNegativeTag(t.label));
  const badTags = tags.filter((t) => isNegativeTag(t.label));
  const busy = Boolean(saving);
  const steps = dishes.length + 2;
  const stepNo = stage === "pick" ? 0 : stage === "dish" ? 1 + at : stage === "preview" ? steps - 1 : steps - 1;
  const isFood = mode.kind === "food" || mode.kind === "other";
  const promptWords = mode.ratePrompt.split(" ");
  const ratePromptTail = promptWords.pop() || "";
  const ratePromptHead = promptWords.join(" ");

  const hero = (
    <header className="rvx-hero">
      <span className="rvx-mono" aria-hidden="true">{place.name.trim().charAt(0).toUpperCase()}</span>
      <span className="rvx-verified"><Icon name="verified" size={14} />Verified visit</span>
      <div className="rvx-kicker">{[place.category, place.area].filter(Boolean).join(" · ")}</div>
      <h1>{place.name}</h1>
      <div className="rvx-meta">
        <span className="rvx-pill"><Icon name={look.icon} size={13} />{look.menu}</span>
        {googleLive?.rating != null && <span className="rvx-pill"><Icon name="star" size={13} fill="#d9a441" color="#d9a441" />{googleLive.rating.toFixed(1)} on Google</span>}
      </div>
    </header>
  );

  const bar = (
    <div className="rvx-bar">
      {stage === "pick" ? <span className="rvx-brand">Trusted Picks</span> : <button type="button" className="rvx-back" aria-label="Back" onClick={back}><Icon name="back" size={20} /></button>}
      <div className="rvx-dots" aria-label={`Step ${stepNo + 1} of ${steps}`}>
        {Array.from({ length: steps }, (_, i) => <i key={i} className={i < stepNo ? "done" : i === stepNo ? "now" : ""} />)}
      </div>
      <span className="rvx-who">{isGuest ? <Icon name="eyeOff" size={16} /> : <Icon name="user" size={16} />}</span>
    </div>
  );

  /* ---------- pick ---------- */
  if (stage === "pick") {
    const isOn = (i: ItemOpt) => dishes.some((d) => d.itemId === i.id);
    const extras = dishes.filter((d) => !d.itemId);
    return (
      <div className="rvx" data-stage="pick">
        {bar}
        {hero}
        <section className="rvx-sec">
          <h2>{ratePromptHead} <i>{ratePromptTail}</i></h2>
          <p className="rvx-hint">Tap everything you tried. You can rate more than one.</p>
          <div className="rvx-tiles">
            {items.map((i) => {
              const on = isOn(i);
              const rated = postedKeys.has(newDish(i.name, i.id).key);
              return (
                <button key={i.id} type="button" className={`rvx-tile ${on ? "on" : ""}`} aria-pressed={on} disabled={rated} onClick={() => toggleItem(i)}>
                  <span className="rvx-img"><ItemThumb path={i.image_path} icon={look.icon} />
                    <span className="rvx-tick"><Icon name="check" size={14} width={3} /></span>
                    {rated && <span className="rvx-rated">Rated</span>}
                  </span>
                  <span className="rvx-nm">{i.name}</span>
                  {priceLabel(i.price_inr) && <span className="rvx-pr">{priceLabel(i.price_inr)}</span>}
                </button>
              );
            })}
            <button type="button" className={`rvx-tile rvx-other ${other ? "on" : ""}`} aria-pressed={other} onClick={() => setOther(!other)}>
              <span className="rvx-img"><Icon name="plus" size={28} /></span>
              <span className="rvx-nm">Something else</span>
            </button>
          </div>
          {extras.length > 0 && <div className="rvx-extras">{extras.map((d) => <button key={d.key} type="button" className="rvx-chip on" onClick={() => setDishes((all) => all.filter((x) => x.key !== d.key))}>{d.name}<Icon name="close" size={12} /></button>)}</div>}
          {(other || items.length === 0) && (
            <form className="rvx-add" onSubmit={(e) => { e.preventDefault(); addOther(); }}>
              <input className="input" value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="Type it, e.g. Cold coffee" aria-label="What you had" maxLength={80} autoComplete="off" />
              <button type="submit" className="btn small ghost" disabled={!otherName.trim()}><Icon name="plus" size={16} />Add</button>
            </form>
          )}
        </section>
        {err && <div className="notice err" role="alert">{err}</div>}
        <div className="rvx-foot">
          <button type="button" className="rvx-cta" disabled={dishes.length === 0} onClick={() => { setAt(0); setStage("dish"); }}>
            <span>{dishes.length === 0 ? (isFood ? "Pick what you had" : "Pick what you got") : dishes.length === 1 ? <>Rate the <b>{dishes[0]!.name}</b></> : <>Rate <b>{dishes.length}</b> things</>}</span>
            <Icon name="chev" size={20} />
          </button>
        </div>
      </div>
    );
  }

  /* ---------- one dish ---------- */
  if (stage === "dish" && dish) {
    const last = at === dishes.length - 1;
    return (
      <div className="rvx" data-stage="dish">
        {bar}
        <div className="rvx-ctx"><Icon name="store" size={14} />{place.name}{dishes.length > 1 && <span> · {at + 1} of {dishes.length}</span>}</div>
        <section className="rvx-sec" key={dish.key}>
          <h2><i>{dish.name}</i></h2>
          <div className="rvx-face" aria-live="polite">
            <span key={dish.rating} className="rvx-emoji">{FACES[dish.rating] || "🍽️"}</span>
            <span className="rvx-word">{FACE_WORDS[dish.rating]}</span>
          </div>
          <Stars value={dish.rating} onChange={(v) => patch(at, { rating: v })} />
          <p className="rvx-hint c">Drag across the stars or tap one</p>

          {dish.rating > 0 && (
            <div className="rvx-reveal">
              <h3><Icon name="thumbs" size={15} />What stood out?</h3>
              <div className="rvx-chips" role="group" aria-label="What was good">
                {goodTags.map((t) => <button key={t.id} type="button" aria-pressed={dish.picked.includes(t.id)} className={`rvx-chip ${dish.picked.includes(t.id) ? "on" : ""}`} onClick={() => toggleTag(t.id)}>{t.label}</button>)}
                {dish.custom.map((t) => <button key={`c-${t}`} type="button" className="rvx-chip on" aria-label={`Remove tag ${t}`} onClick={() => patch(at, { custom: dish.custom.filter((x) => x !== t) })}>{t} <Icon name="close" size={12} /></button>)}
                {tagDraft === null ? (
                  dish.custom.length < MAX_CUSTOM_TAGS && <button type="button" className="rvx-chip dash" aria-label="Add your own tag" onClick={() => setTagDraft("")}><Icon name="plus" size={13} />tag</button>
                ) : (
                  <input className="input rvx-tagin" value={tagDraft} maxLength={30} autoFocus aria-label="Your own tag" placeholder="e.g. Crispy"
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } if (e.key === "Escape") setTagDraft(null); }}
                    onBlur={addCustomTag} />
                )}
              </div>
              {badTags.length > 0 && <>
                <h3 className="bad"><Icon name="thumbsDown" size={15} />Anything that could be better?</h3>
                <div className="rvx-chips" role="group" aria-label="What could be better">
                  {badTags.map((t) => <button key={t.id} type="button" aria-pressed={dish.picked.includes(t.id)} className={`rvx-chip bad ${dish.picked.includes(t.id) ? "on" : ""}`} onClick={() => toggleTag(t.id)}>{t.label}</button>)}
                </div>
              </>}

              <h3><Icon name="edit" size={15} />Say it your way <span className="opt">optional</span></h3>
              <textarea className="textarea rvx-text" aria-label="Your words" placeholder={canDictate ? "What made it good or not? Or tap Talk and speak." : "What made it good or not?"}
                value={dish.body} onChange={(e) => patch(at, { body: e.target.value })} maxLength={MAX_BODY} />
              <div className="rvx-tools">
                {canDictate && <button type="button" aria-pressed={listening} className={`rvx-tool ${listening ? "hot" : ""}`} onClick={dictate} disabled={recording || busy}><Icon name="mic" size={16} />{listening ? "Listening… tap to stop" : "Talk"}</button>}
                <button type="button" className="rvx-tool" onClick={draft} disabled={drafting || busy}><Icon name="spark" size={16} />{drafting ? "Writing…" : dish.body ? "Polish with AI" : "Write it for me"}</button>
                {dish.aiDrafted && <span className="rvx-ai"><Icon name="spark" size={12} />AI draft</span>}
              </div>
              <div className="rvx-media">
                <ReviewPhotoPicker value={dish.photo} onChange={(b) => patch(at, { photo: b })} disabled={busy} />
                {canRecord && <ReviewVoiceRecorder value={dish.voice} onChange={(c) => patch(at, { voice: c })} disabled={busy || listening} onRecordingChange={setRecording} />}
              </div>
            </div>
          )}
        </section>
        {err && <div className="notice err" role="alert">{err}</div>}
        <div className="rvx-foot">
          <button type="button" className="rvx-cta" disabled={!dish.rating || recording} onClick={next}>
            <span>{last ? "Preview my review" : <>Next, <b>{dishes[at + 1]!.name}</b></>}</span>
            <Icon name="chev" size={20} />
          </button>
        </div>
      </div>
    );
  }

  /* ---------- preview + sending ---------- */
  if (stage === "preview" || stage === "sending") {
    const sending = stage === "sending";
    return (
      <div className="rvx" data-stage={stage}>
        {bar}
        <section className="rvx-sec">
          <h2>Looks <i>good?</i></h2>
          <div className="rvx-cards">
            {dishes.map((d, i) => {
              const labels = [...tags.filter((t) => d.picked.includes(t.id)).map((t) => t.label), ...d.custom];
              return (
                <article key={d.key} className="rvx-rcard">
                  <div className="rvx-rhead">
                    <div className="grow"><b>{d.name}</b><div className="rvx-sm">{place.name}</div></div>
                    <span className="rvx-rstars" aria-label={`${d.rating} stars`}>{FACES[d.rating]} {d.rating}<Icon name="star" size={13} fill="#d9a441" color="#d9a441" /></span>
                  </div>
                  {labels.length > 0 && <div className="rvx-chips sm">{labels.map((l) => <span key={l} className={`rvx-chip static ${isNegativeTag(l) ? "bad" : ""}`}>{l}</span>)}</div>}
                  {d.body.trim() && <p>{d.body.trim()}</p>}
                  {!sending && <button type="button" className="rvx-edit" onClick={() => goDish(i)}><Icon name="edit" size={13} />Edit</button>}
                </article>
              );
            })}
          </div>
          {!sending && dishes.length < MAX_DISHES && (
            <button type="button" className="rvx-more" onClick={() => { setStage("pick"); }}><Icon name="plus" size={16} />Add another dish</button>
          )}
        </section>

        {isGuest ? (
          <p className="rvx-anon"><Icon name="eyeOff" size={16} />Posted anonymously. No one can see it was you.</p>
        ) : (
          <fieldset className="rvx-whoseg" disabled={sending}>
            <legend>Who sees it's you</legend>
            <label className={!isPublic ? "on" : ""}><input type="radio" name="visibility" checked={!isPublic} onChange={() => setIsPublic(false)} /><Icon name="eyeOff" size={20} /><b>Anonymous</b><i>Counts, but no one sees it was you</i></label>
            <label className={isPublic ? "on" : ""}><input type="radio" name="visibility" checked={isPublic} onChange={() => setIsPublic(true)} /><Icon name="user" size={20} /><b>Show my name</b><i>Friends see you were here</i></label>
          </fieldset>
        )}

        {err && <div className="notice err" role="alert">{err}</div>}
        <div className="rvx-foot">
          {sending ? (
            <div className="rvx-pipe" role="status" aria-live="polite">
              <span className="spin" aria-hidden="true" />
              <b>{saving || "Almost there…"}</b>
              <small>Copying your review and opening Google…</small>
            </div>
          ) : <>
            <div className="rvx-flow"><span><Icon name="check" size={12} width={3} />Saved here</span><i /><span><Icon name="copy" size={12} />Copied</span><i /><span><Icon name="external" size={12} />Google</span></div>
            <button type="button" className="rvx-cta big" onClick={() => post(true)}>
              <span className="rvx-g"><Icon name="star" size={18} fill="#fff" color="#fff" /></span>
              <span className="grow"><b>Post and share on Google</b><small>Saves, copies and opens {place.google_place_id ? "Google reviews" : "Google Maps"}</small></span>
              <Icon name="chev" size={20} />
            </button>
            <button type="button" className="rvx-skip" onClick={() => post(false)}>Post here only</button>
          </>}
        </div>
      </div>
    );
  }

  /* ---------- done ---------- */
  const names = done.map((d) => d.name);
  return (
    <div className="rvx" data-stage="done">
      <div className="rvx-confetti" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ left: `${4 + i * 6}%`, animationDelay: `${(i * 0.13) % 1.2}s` }} />)}</div>
      <section className="rvx-sec center">
        <span className="rvx-big"><Icon name="check" size={40} width={3} /></span>
        <h2>Posted. <i>Thank you!</i></h2>
        <p className="rvx-hint c">{names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]} {names.length > 1 ? "are" : "is"} on {place.name}'s page{isGuest ? ", anonymously" : isPublic ? ", with your name" : ", anonymously"}.</p>
      </section>

      <section className="rvx-google">
        <div className="rvx-ghead"><span className="rvx-g"><Icon name="star" size={16} fill="#fff" color="#fff" /></span><div className="grow"><b>{place.name}</b><small>{googleOpened ? "Google opened in a new tab. Finish it there in 3 taps." : "Add it on Google too, in 3 taps"}</small></div></div>
        <ol className="rvx-coach">
          <li><b>1</b>Tap <span className="rvx-gs">{"★".repeat(stars)}</span></li>
          <li><b>2</b>Press and hold the box, tap <u>Paste</u></li>
          <li><b>3</b>Tap <span className="rvx-post">Post</span></li>
        </ol>
        {copied === false && <p className="rvx-warn">Couldn't copy by itself. Press Copy, then open Google.</p>}
        <div className="rvx-two">
          <button type="button" className="rvx-tool" onClick={openGoogle}><Icon name="external" size={16} />{googleOpened ? "Open Google again" : "Copy and open Google"}</button>
          <button type="button" className="rvx-tool" onClick={copyAgain}><Icon name="copy" size={16} />{copied ? "Copied" : "Copy again"}</button>
        </div>
        <p className="rvx-fine">Google only lets you post yourself, so the last tap is yours.</p>
      </section>

      <div className="rvx-after">
        <button type="button" className="rvx-more" onClick={another}><Icon name="plus" size={16} />Rate another dish</button>
        <button type="button" className="rvx-more" onClick={share}><Icon name="share" size={16} />Share with friends</button>
        <Link to={`/p/${placeId}`} className="rvx-more"><Icon name="eye" size={16} />See what people loved</Link>
      </div>
      {isGuest && (
        <Link to={`/signin?next=${encodeURIComponent(`/p/${placeId}`)}`} className="rvx-nudge">
          <Icon name="lock" size={18} /><span className="grow"><b>Keep your reviews? (optional)</b><small>Sign in to see them on any phone. Nothing changes if you don't.</small></span><Icon name="chev" size={18} />
        </Link>
      )}
    </div>
  );
}
