import { focusShop } from "../lib/focus";
import { playAppleChime, playHapticTap, playWaxStamp } from "../lib/haptics";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { VISIT_ITEM, isNegativeTag, ratingWord } from "../lib/reviews";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { isUuid, type Place, type Tag } from "../lib/types";
import { Icon, RvxBack, Spinner, useToast, type IconName } from "../components/ui";
import { ReviewPhotoPicker } from "../components/ReviewPhoto";
import { ReviewVoiceRecorder, canRecordVoice, type VoiceClip } from "../components/ReviewVoice";
import { ItemThumb } from "../components/place/ItemThumb";
import { loadShopItems, shopLook, sortShopItems, type ShopItem } from "../components/place/shop";
import { formatPrice } from "../lib/money";
import { deviceId } from "../lib/device";
import { callAi } from "../lib/assist";
import { modeOf, tagFits } from "../lib/modes";
import { fetchGoogleRating } from "../lib/google";
import { copyText, googleReviewUrl } from "../lib/util";
import { bumpStat } from "../lib/stats";
import { shareLink } from "../lib/invite";
import { generateStoryCard } from "../lib/story";
import { lovedPct, type TopDish } from "../lib/dishes";
import { GoogleHandoff, PrivateNote } from "../components/GoogleHandoff";
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

/** Four faces instead of five stars. They map onto the same 1-5 scale everything else ranks by,
 *  and each face shows its star value so nobody is surprised by what lands on Google. */
type Verdict = "meh" | "ok" | "good" | "love";
const VERDICTS: { key: Verdict; label: string; rating: number }[] = [
  { key: "meh", label: "Not for me", rating: 2 },
  { key: "ok", label: "It was OK", rating: 3 },
  { key: "good", label: "Good", rating: 4 },
  { key: "love", label: "Loved it", rating: 5 },
];
const verdictOf = (r: number): Verdict | undefined => (!r ? undefined : r >= 5 ? "love" : r >= 4 ? "good" : r >= 3 ? "ok" : "meh");
/** The same words the rest of the app uses for a rating. */
const labelOf = (r: number) => ratingWord(r);

function Face({ v, size = 26 }: { v: Verdict; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      {v === "love" ? <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /> : <>
        <circle cx="12" cy="12" r="9" />
        <path d={v === "meh" ? "M8.5 16c1-1.2 2.2-1.8 3.5-1.8s2.5.6 3.5 1.8M9 10h.01M15 10h.01" : v === "ok" ? "M8.5 15h7M9 10h.01M15 10h.01" : "M8.5 14.5c1 .9 2.2 1.3 3.5 1.3s2.5-.4 3.5-1.3M9 10h.01M15 10h.01"} />
      </>}
    </svg>
  );
}

/** Quick tags for the whole visit, by verdict. Each label is a row in the tags table, so it shows up on the shop page. */
const VISIT_TAGS: Record<"food" | "other", Record<Verdict, { title: string; tags: string[] }>> = {
  food: {
    meh: { title: "What let it down?", tags: ["Poor food", "Poor service", "Long wait", "Noisy", "Too pricey", "Not clean"] },
    ok: { title: "What stood out?", tags: ["Food", "Service", "Value", "Long wait", "Too pricey", "Noisy"] },
    good: { title: "What was good?", tags: ["Food", "Service", "Ambience", "Value", "Quick"] },
    love: { title: "What made it great?", tags: ["Amazing food", "Lovely staff", "Great vibe", "Great value", "Super quick"] },
  },
  other: {
    meh: { title: "What let it down?", tags: ["Poor service", "Long wait", "Unhelpful staff", "Too pricey", "Not clean"] },
    ok: { title: "What stood out?", tags: ["Service", "Staff", "Value", "Long wait", "Too pricey"] },
    good: { title: "What was good?", tags: ["Service", "Staff", "Value", "Quick", "Clean"] },
    love: { title: "What made it great?", tags: ["Great service", "Lovely staff", "Great vibe", "Great value", "Super quick"] },
  },
};

/** Two taps the AI writer asks before writing about a visit, so it sounds like the person. */
const AI_QUESTIONS: Record<"food" | "other", { q: string; opts: string[]; say: (a: string) => string }[]> = {
  food: [
    { q: "Who were you with?", opts: ["Solo", "Partner", "Friends", "Family"], say: (a) => (a === "Solo" ? "Came on my own" : `Came with ${a.toLowerCase()}`) },
    { q: "Would you come back?", opts: ["Definitely", "Maybe", "Probably not"], say: (a) => `Would come back: ${a.toLowerCase()}` },
  ],
  other: [
    { q: "Would you recommend it?", opts: ["Definitely", "Maybe", "Probably not"], say: (a) => `Would recommend it: ${a.toLowerCase()}` },
    { q: "Would you come back?", opts: ["Definitely", "Maybe", "Probably not"], say: (a) => `Would come back: ${a.toLowerCase()}` },
  ],
};

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

/** The review of the whole visit. Dishes are optional on top of it. */
interface VisitR { rating: number; tags: string[]; body: string; aiDrafted: boolean; reviewId?: string }
const NO_VISIT: VisitR = { rating: 0, tags: [], body: "", aiDrafted: false };

/** The AI writer's state for one text box ("visit" or a dish key). */
type Len = "short" | "normal" | "long";
interface AiState { stage: "idle" | "ask" | "typing" | "done"; own: string; prev: string; out: string; len: Len; tone: "casual" | "polite"; answers: (string | null)[] }
const AI0: AiState = { stage: "idle", own: "", prev: "", out: "", len: "normal", tone: "casual", answers: [] };

type Stage = "visit" | "pick" | "dish" | "preview" | "sending" | "done";

/** The database answered and said no (a PostgREST error with a code), as opposed to a reply that never arrived. */
function refusedByServer(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code !== "" && !/failed to fetch|network|load failed|timed? ?out|abort/i.test(errorText(e));
}

/** What goes on Google: the person's own words, or their picks when they wrote none. */
function googleText(visit: VisitR, dishes: Dish[], tags: Tag[]): string {
  const sentence = (lead: string, xs: string[]) => (xs.length ? `${lead}. ${xs.join(", ")}.` : `${lead}.`).replace(/^./, (c) => c.toUpperCase());
  const say = (d: Dish) => {
    const t = d.body.trim();
    if (t) return t;
    return sentence(labelOf(d.rating), [...tags.filter((x) => d.picked.includes(x.id)).map((x) => x.label.toLowerCase()), ...d.custom.map((x) => x.toLowerCase())]);
  };
  const parts: string[] = [];
  if (visit.rating) parts.push(visit.body.trim() || sentence(labelOf(visit.rating), visit.tags.map((t) => t.toLowerCase())));
  for (const d of dishes) parts.push(dishes.length === 1 && !visit.rating ? say(d) : `${d.name}: ${say(d)}`);
  return parts.join("\n\n").slice(0, 3000);
}

const averageStars = (dishes: Dish[]) => Math.max(1, Math.min(5, Math.round(dishes.reduce((n, d) => n + d.rating, 0) / Math.max(1, dishes.length))));

/** Can this person write a review here? Only during a visit started by a table QR scan. */
type Gate = "loading" | "ok" | "scan" | "guest_used" | "owner" | "paused";

async function checkGate(placeId: string, uid: string): Promise<{ gate: Gate; visitKey: string | null }> {
  const r = await supabase.rpc("can_review", { p_place: placeId, p_device: deviceId() });
  if (!r.error) {
    const row = (r.data as { allowed: boolean; reason: string; expires_at: string | null }[] | null)?.[0];
    return { gate: (row?.reason as Gate) || "scan", visitKey: row?.expires_at ?? null };
  }
  if (r.error.code !== "PGRST202") throw r.error;
  // Database without migration 0014: fall back to "has an open visit".
  const v = await supabase.from("visits").select("id, expires_at").eq("user_id", uid).eq("place_id", placeId).gt("expires_at", new Date().toISOString()).limit(1);
  const open = (v.data as { expires_at: string }[] | null)?.[0];
  return { gate: open ? "ok" : "scan", visitKey: open?.expires_at ?? null };
}

function ReviewGate({ placeId, name, reason }: { placeId: string; name?: string; reason: Gate }) {
  const used = reason === "guest_used";
  const view = (
    <Link to={`/p/${placeId}`} className="rvx-more"><Icon name="eye" size={18} />See what people loved</Link>
  );
  const shell = (icon: IconName, title: string, text: string, actions: ReactNode) => (
    <div className="rvx" data-stage="gate">
      <div className="rvx-bar"><RvxBack fallback={`/p/${placeId}`} /><span className="rvx-brand">Trusted Picks</span><span className="grow" /></div>
      <div className="rvx-ctx"><Icon name="store" size={14} />{name || "This shop"}</div>
      <div className="rvx-gate">
        <span className="ico"><Icon name={icon} size={28} /></span>
        <h2>{title}</h2>
        <p>{text}</p>
        {actions}
      </div>
    </div>
  );
  if (reason === "paused") return shell("clock", "Reviews are paused here for now", "You can still see what people loved at this shop.", view);
  if (reason === "owner") return shell("store", "This is your shop", "Owners can't review their own shop. Your customers rate it by scanning your QR code.", <>
    <Link to={`/manage/${placeId}`} className="rvx-cta"><span>Manage shop</span><Icon name="chev" size={20} /></Link>{view}
  </>);
  return shell(used ? "lock" : "qr",
    used ? "You've reviewed here from this phone" : "Reviews come from people at the shop",
    used ? "Without signing in, each phone gets one visit per place. Sign in to rate more of what you had."
      : "Point your phone camera at the QR code on your table or counter, or open the review link the shop sent you. It keeps every review genuine.",
    <>
      {used && <Link to={`/signin?next=${encodeURIComponent(`/review/${placeId}`)}`} className="rvx-cta"><span>Sign in</span><Icon name="chev" size={20} /></Link>}
      {view}
    </>);
}

/** The review in progress, kept for this tab only, without photos or voice notes. */
/** `visitKey` is when the visit the draft belongs to ends, so a new scan never inherits an old review. */
interface Draft { visit?: VisitR; dishes: Dish[]; done: Dish[]; isPublic: boolean; finished?: boolean; googleOpened?: boolean; visitKey?: string | null }
const draftKey = (placeId: string, uid: string) => `tp-review:${uid}:${placeId}`;
const lite = (d: Dish): Dish => ({ ...d, photo: null, voice: null });
function readDraft(placeId: string, uid: string): Draft | null {
  try { const raw = sessionStorage.getItem(draftKey(placeId, uid)); return raw ? (JSON.parse(raw) as Draft) : null; } catch { return null; }
}
/** Unexpired dish ids the diner tagged on the QR landing (saved there as `tp-plan:<placeId>`). */
function readPlan(placeId: string): string[] {
  try {
    const p = JSON.parse(localStorage.getItem(`tp-plan:${placeId}`) || "null") as { ids?: unknown; expiresAt?: number } | null;
    return p && Array.isArray(p.ids) && (p.expiresAt ?? 0) > Date.now() ? p.ids.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function writeDraft(placeId: string, uid: string, d: Draft) {
  try { sessionStorage.setItem(draftKey(placeId, uid), JSON.stringify({ ...d, dishes: d.dishes.map(lite), done: d.done.map(lite) })); } catch { /* storage blocked or full */ }
}

export default function Review() {
  const { session, loading, profile } = useAuth();
  const { placeId = "" } = useParams();
  if (loading || (session && !profile)) return <div className="rvx"><div className="rvx-center"><Spinner /></div></div>;
  if (!session) return <ReviewGate placeId={placeId} reason="scan" />;
  return <ReviewForm />;
}

function ReviewForm() {
  const { placeId = "" } = useParams();
  const { session, isGuest } = useAuth();
  const uid = session?.user.id;
  const nav = useNavigate();
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState("");
  const [reload, setReload] = useState(0);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [gate, setGate] = useState<Gate>("loading");
  const [visitKey, setVisitKey] = useState<string | null>(null);
  const [googleLive, setGoogleLive] = useState<{ rating: number | null } | null>(null);

  const [stage, setStage] = useState<Stage>("visit");
  const [visit, setVisit] = useState<VisitR>(NO_VISIT);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [at, setAt] = useState(0);
  const [fromDishes, setFromDishes] = useState(false);
  const [backToPreview, setBackToPreview] = useState(false);
  /** Where the picker was opened from, so Back goes there. */
  const [pickFrom, setPickFrom] = useState<Stage>("visit");
  const [other, setOther] = useState(false);
  const [otherName, setOtherName] = useState("");
  const [pickQ, setPickQ] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [ai, setAi] = useState<Record<string, AiState>>({});
  const [saving, setSaving] = useState<string | false>(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Dish[]>([]);
  const [googleOpened, setGoogleOpened] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const typer = useRef<number | null>(null);
  const [canDictate] = useState(() => Boolean(recognitionCtor()));
  const [canRecord] = useState(() => canRecordVoice());

  const toast = useToast();
  const [showPrivateForm, setShowPrivateForm] = useState(false);
  const [sharingStory, setSharingStory] = useState(false);

  useEffect(() => {
    if (!uid) return;
    if (!isUuid(placeId)) {
      setPlace(null);
      return;
    }
    let alive = true;
    setLoadErr("");
    setPlace(undefined);
    (async () => {
      try {
        const [p, it, st, tg, g] = await Promise.all([
          supabase.from("places").select("id, name, area, category, city, google_place_id, status, kind, currency").eq("id", placeId).maybeSingle()
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
          if (p.error && /invalid input syntax for type uuid/i.test(p.error.message)) { setPlace(null); return; }
          setLoadErr(errorText(failed.error));
          return;
        }
        const pl = (p.data as Place | null) ?? null;
        setPlace(pl && pl.status === "live" ? pl : null);
        const counts = new Map(((st.data || []) as { item_id: string; review_count: number }[]).map((x) => [x.item_id, x.review_count]));
        const opts = sortShopItems(it.items.map((i) => ({ ...i, count: counts.get(i.id) ?? 0 })), (i) => i.count);
        setItems(opts);
        const keptAny = readDraft(placeId, uid);
        // A draft belongs to the visit it was started in. After a new scan (or once that visit has ended) it starts fresh.
        const sameVisit = !keptAny?.visitKey || (g.visitKey ? g.visitKey === keptAny.visitKey : Date.parse(keptAny.visitKey) > Date.now());
        const kept = sameVisit ? keptAny : null;
        if (keptAny && !kept) { try { sessionStorage.removeItem(draftKey(placeId, uid)); } catch { /* storage blocked */ } }
        const kv = kept?.visit;
        if (kept && (kv?.rating || kv?.body.trim() || kept.dishes.length || kept.done.length)) {
          // Phones often reload the tab after the camera: bring back what was written (photos and voice can't be kept).
          setVisit(kv ?? NO_VISIT); setDishes(kept.dishes); setDone(kept.done); setIsPublic(kept.isPublic);
          const open = kept.dishes.findIndex((d) => !d.rating);
          // Back from Google after the tab was reloaded: show the thank-you screen again.
          if (kept.finished && (kept.done.length || kv?.reviewId)) { setStage("done"); setGoogleOpened(Boolean(kept.googleOpened)); }
          else if (!kv?.reviewId) setStage("visit");
          else if (open >= 0) { setAt(open); setStage("dish"); } else setStage(kept.dishes.length ? "preview" : "pick");
        } else {
          // Things the diner tapped "Having this" on at the QR landing (never ticked for them).
          const planned = readPlan(placeId);
          const list = opts.filter((i) => planned.includes(i.id)).slice(0, MAX_DISHES).map((i) => newDish(i.name, i.id));
          if (list.length) setDishes(list);
          if (!opts.length) setOther(true);
        }
        const kind = modeOf(pl?.kind, pl?.category).kind;
        setTags(((tg.data as Tag[]) || []).filter((t) => tagFits(t, kind)));
        setGate(g.gate);
        if (g.gate === "ok") bumpStat("review_started", `review_started:${placeId}`);
        setVisitKey(g.visitKey);
      } catch (e) {
        if (alive) setLoadErr(errorText(e) === "Failed to fetch" ? "You seem to be offline." : errorText(e));
      }
    })();
    return () => { alive = false; };
  }, [placeId, uid, reload]);

  // The live Google rating is only shown, never stored. Failing to get it hides the badge.
  useEffect(() => {
    if (!place?.google_place_id) return;
    let alive = true;
    fetchGoogleRating(place.google_place_id).then((g) => { if (alive && g) setGoogleLive({ rating: g.rating }); }, () => {});
    return () => { alive = false; };
  }, [place?.google_place_id]);

  // Stop listening and typing if the page goes away.
  useEffect(() => () => { rec.current?.stop(); if (typer.current) clearInterval(typer.current); }, []);
  const head = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const dish = dishes[at];
  useEffect(() => {
    window.scrollTo({ top: 0 });
    // Screen readers hear the new step; skipped on first load so the page opens normally.
    if (moved.current) head.current?.focus({ preventScroll: true });
    moved.current = true;
  }, [stage, at, dish?.key]);

  useEffect(() => {
    if (uid && place && stage !== "sending") writeDraft(placeId, uid, { visit, dishes: stage === "done" ? [] : dishes, done, isPublic, finished: stage === "done", googleOpened, visitKey });
  }, [visit, dishes, done, isPublic, stage, place, placeId, uid, googleOpened, visitKey]);

  const isFood = modeOf(place?.kind, place?.category).kind === "food";
  const patch = (i: number, p: Partial<Dish>) => setDishes((all) => all.map((d, k) => (k === i ? { ...d, ...p } : d)));
  const postedKeys = new Set(done.map((d) => d.key));
  const rated = dishes.filter((d) => d.rating > 0);

  function toggleItem(i: ShopItem) {
    setErr("");
    setDishes((all) => {
      const key = newDish(i.name, i.id).key;
      if (all.some((d) => d.key === key)) return all.filter((d) => d.key !== key);
      if (all.length >= MAX_DISHES) { setErr(`Up to ${MAX_DISHES} in one go.`); return all; }
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
      if (all.length >= MAX_DISHES) { setErr(`Up to ${MAX_DISHES} in one go.`); return all; }
      return [...all, d];
    });
    setOtherName("");
  }

  /** A stale AI text (still exactly what it wrote) goes back to the person's own words when the verdict changes. */
  function dropStaleAi(key: string) {
    const a = ai[key];
    if (a?.out && bodyOf(key) === a.out) { setBody(key, a.prev, false); setAiFor(key, null); }
  }
  function rateDish(r: number) {
    if (!dish) return;
    const changed = verdictOf(dish.rating) !== verdictOf(r);
    // "Loved it" has no "could be better" tags, so ones picked under another verdict would contradict it.
    const bad = new Set(tags.filter((t) => isNegativeTag(t.label)).map((t) => t.id));
    patch(at, { rating: r, ...(verdictOf(r) === "love" ? { picked: dish.picked.filter((id) => !bad.has(id)) } : {}) });
    if (changed && dish.rating) dropStaleAi(dish.key);
  }
  function rateVisit(r: number) {
    const changed = verdictOf(visit.rating) !== verdictOf(r);
    setVisit((v) => ({ ...v, rating: r, tags: verdictOf(v.rating) === verdictOf(r) ? v.tags : [] }));
    if (changed && visit.rating) dropStaleAi("visit");
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

  /* ---------- the text boxes: typed, spoken or written with AI ---------- */
  const bodyOf = (key: string) => (key === "visit" ? visit.body : dishes.find((d) => d.key === key)?.body ?? "");
  function setBody(key: string, body: string, aiDrafted?: boolean) {
    const extra = aiDrafted === undefined ? {} : { aiDrafted };
    if (key === "visit") setVisit((v) => ({ ...v, body, ...extra }));
    else setDishes((all) => all.map((d) => (d.key === key ? { ...d, body, ...extra } : d)));
  }
  const setAiFor = (key: string, p: Partial<AiState> | null) =>
    setAi((all) => {
      const n = { ...all };
      if (p === null) delete n[key]; else n[key] = { ...AI0, ...all[key], ...p };
      return n;
    });

  function dictate(key: string) {
    if (listening) { rec.current?.stop(); return; }
    const r = makeRecognition();
    if (!r) return;
    rec.current = r;
    r.lang = navigator.language || "en"; r.interimResults = false; r.continuous = true;
    const now = bodyOf(key);
    const start = now ? now.trimEnd() + " " : "";
    r.onresult = (e) => {
      const heard = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ");
      setBody(key, (start + heard).slice(0, MAX_BODY));
    };
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); setErr("Couldn't hear you. Check the microphone permission, or type instead."); };
    try { r.start(); setListening(true); } catch { setListening(false); }
  }

  /** Types the AI's text into the box a few letters at a time, so it reads as being written. */
  function typeOut(key: string, full: string) {
    if (typer.current) clearInterval(typer.current);
    const finish = () => { typer.current = null; setBody(key, full, true); setAiFor(key, { stage: "done", out: full }); };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    const step = Math.max(3, Math.ceil(full.length / 90));
    let i = 0;
    typer.current = window.setInterval(() => {
      i = Math.min(full.length, i + step);
      if (i >= full.length) { clearInterval(typer.current!); finish(); } else setBody(key, full.slice(0, i), true);
    }, 18);
  }

  async function generate(key: string, p: Partial<AiState> = {}) {
    const was = ai[key];
    const s: AiState = { ...AI0, ...was, ...p };
    const isVisit = key === "visit";
    const d = isVisit ? undefined : dishes.find((x) => x.key === key);
    const rating = isVisit ? visit.rating : d?.rating ?? 0;
    if (!rating) { setErr("Pick a face first."); return; }
    if (listening) rec.current?.stop();
    setErr("");
    setAiFor(key, { ...s, stage: "typing" });
    const liked: string[] = [];
    const downs: string[] = [];
    if (isVisit) for (const t of visit.tags) (verdictOf(rating) === "meh" || isNegativeTag(t) ? downs : liked).push(t);
    else if (d) {
      for (const t of tags) if (d.picked.includes(t.id)) (isNegativeTag(t.label) ? downs : liked).push(t.label);
      liked.push(...d.custom);
    }
    const qs = AI_QUESTIONS[isFood ? "food" : "other"];
    const answers = isVisit ? s.answers.map((a, i) => (a && qs[i] ? qs[i]!.say(a) : "")).filter(Boolean) : [];
    try {
      const j = await callAi<{ text?: string }>("draft", {
        scope: isVisit ? "visit" : "item", place: place?.name, category: place?.category, item: d?.name, rating,
        tags: liked, downs, answers, notes: s.own, tone: s.tone, length: s.len,
      });
      if (!j.text) throw new Error("The AI writer isn't available right now");
      typeOut(key, j.text.slice(0, MAX_BODY));
    } catch (e) {
      setAiFor(key, was ? { ...was, stage: was.stage === "typing" ? "done" : was.stage } : null);
      setErr(`${errorText(e)}. You can write it yourself.`.replace(/\.\. /, ". "));
    }
  }

  function startAi(key: string) {
    const cur = ai[key];
    if (cur?.stage === "typing") return;
    if (cur?.stage === "ask") { setAiFor(key, { stage: "idle" }); return; }
    const text = bodyOf(key);
    // AI works from the person's own words. If they changed the text after AI wrote it, their version wins.
    const own = cur?.out && text === cur.out ? cur.own : text;
    const prev = cur?.out && text === cur.out ? cur.prev : text;
    if (key === "visit" && (!cur || cur.stage === "idle")) { setAiFor(key, { stage: "ask", own, prev }); return; }
    void generate(key, { own, prev });
  }

  function refine(key: string, kind: "short" | "long" | "casual" | "polite" | "undo") {
    const a = ai[key];
    if (!a || a.stage === "typing") return;
    if (kind === "undo") { setBody(key, a.prev, false); setAiFor(key, { stage: "idle", out: "" }); return; }
    void generate(key, kind === "short" || kind === "long" ? { len: a.len === kind ? "normal" : kind } : { tone: kind });
  }

  /* ---------- moving between screens ---------- */
  /** `fromPreview`: the person tapped Edit on the preview, so Done takes them straight back to it. */
  function goDish(i: number, fromPreview = false) { if (listening) rec.current?.stop(); setErr(""); setBackToPreview(fromPreview); setAt(i); setStage("dish"); }
  const writing = (key: string) => ai[key]?.stage === "typing";
  function toDishes() {
    setErr("");
    if (listening) rec.current?.stop();
    const open = dishes.findIndex((d) => !d.rating);
    if (open >= 0) goDish(open); else { setPickFrom(stage); setStage("pick"); }
  }
  function postVisit() {
    if (!visit.rating) { setErr("Pick a face for your visit first."); return; }
    if (writing("visit")) { setErr("The AI is still writing. One moment."); return; }
    if (listening) rec.current?.stop();
    setErr(""); setFromDishes(false); setStage("preview");
  }
  function skipDish() {
    const rest = dishes.filter((_, k) => k !== at);
    setDishes(rest);
    setErr("");
    const anything = rest.some((d) => d.rating) || (visit.rating > 0 && !visit.reviewId);
    if (backToPreview && anything) { setBackToPreview(false); setFromDishes(true); setAt(Math.max(0, Math.min(at, rest.length - 1))); setStage("preview"); return; }
    setBackToPreview(false);
    if (at < rest.length) return;
    if (rest.some((d) => d.rating) || (visit.rating && !visit.reviewId)) { setAt(Math.max(0, rest.length - 1)); setFromDishes(true); setStage("preview"); }
    else { setAt(0); setStage(visit.reviewId ? "pick" : "visit"); }
  }
  function next() {
    if (!dish) return;
    if (!dish.rating) { skipDish(); return; }
    if (recording) { setErr("Stop the recording first."); return; }
    if (writing(dish.key)) { setErr("The AI is still writing. One moment."); return; }
    if (listening) rec.current?.stop();
    setErr("");
    if (backToPreview) { setBackToPreview(false); setFromDishes(true); setStage("preview"); return; }
    if (at < dishes.length - 1) setAt(at + 1); else { setFromDishes(true); setStage("preview"); }
  }

  function back() {
    setErr("");
    if (listening) rec.current?.stop();
    if (stage === "preview") {
      const last = dishes.length - 1;
      if (fromDishes && last >= 0) { setAt(last); setStage("dish"); } else setStage(visit.reviewId ? "pick" : "visit");
    } else if (stage === "dish") {
      if (backToPreview) { setBackToPreview(false); setFromDishes(true); setStage("preview"); }
      else if (at > 0) setAt(at - 1); else setStage("pick");
    }
    else if (stage === "pick") {
      if (pickFrom === "preview" && (rated.length > 0 || (visit.rating > 0 && !visit.reviewId))) { setFromDishes(false); setStage("preview"); }
      else setStage(visit.reviewId || done.length ? "done" : "visit");
    }
  }

  // The phone's own Back (Android button, iPhone swipe) steps back through the screens instead of
  // leaving the review. One extra history entry is held while answering and dropped when we leave the steps.
  const backRef = useRef(back);
  backRef.current = back;
  const answering = stage === "pick" || stage === "dish" || stage === "preview";
  const held = useRef(false);
  useEffect(() => {
    if (!answering) return;
    if (!held.current) { window.history.pushState({ ...window.history.state, rvx: 1 }, ""); held.current = true; }
    const onPop = () => { held.current = false; backRef.current(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [answering, stage, at]);
  useEffect(() => {
    if (answering || !held.current) return;
    held.current = false;
    if (window.history.state?.rvx) window.history.back();
  }, [answering]);

  const gUrl = place?.google_place_id
    ? googleReviewUrl(place.google_place_id)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place?.name, place?.area, place?.city].filter(Boolean).join(" "))}`;

  async function post() {
    if (saving || !uid || !place) return;
    const toPost = dishes.filter((d) => d.rating > 0);
    const visitDue = visit.rating > 0 && !visit.reviewId;
    if (!visitDue && !toPost.length) { setErr("Pick a face for your visit or for something you had."); return; }
    if (recording) { setErr("Stop the recording first."); return; }
    if (listening) rec.current?.stop();
    setErr("");
    setStage("sending");
    setSaving("Saving…");
    const saved: Dish[] = [];
    try {
      if (visitDue) {
        setSaving("Saving your visit…");
        const { data, error } = await supabase.rpc("submit_visit_review", {
          p_place_id: placeId, p_rating: visit.rating, p_body: visit.body.trim(), p_tags: visit.tags,
          p_ai_drafted: visit.aiDrafted, p_is_public: isPublic, p_device: deviceId(),
        });
        let id = (data as { id?: string } | null)?.id;
        if (error) {
          if (error.code === "PGRST202") throw new Error("Rating the whole visit isn't switched on for this app yet. Rate what you had instead, or try again later");
          // Saved on an earlier try whose answer never arrived: use that one.
          if (!/already reviewed this visit/i.test(errorText(error))) throw error;
          const prior = await supabase.from("reviews").select("id, items!inner(name)").eq("user_id", uid).eq("place_id", placeId).eq("items.name", VISIT_ITEM).order("created_at", { ascending: false }).limit(1);
          id = (prior.data as { id: string }[] | null)?.[0]?.id;
          if (!id) throw error;
        }
        setVisit((v) => ({ ...v, reviewId: id || "saved" }));
      }
      for (const d of toPost) {
        if (d.reviewId) { saved.push(d); continue; }
        const uploaded: { bucket: string; path: string }[] = [];
        // Once submit_review is called, a lost reply may still mean it saved: then the uploads must stay.
        let sent = false;
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
          setSaving(`Saving ${d.name}…`);
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
          sent = true;
          let { data, error } = await supabase.rpc("submit_review", args);
          // Database without migration 0014 doesn't know p_device yet.
          if (error?.code === "PGRST202") {
            const { p_device: _d, ...older } = args;
            ({ data, error } = await supabase.rpc("submit_review", older));
          }
          // The review may have been saved on an earlier try whose answer never arrived: use that one.
          if (error && /already reviewed/i.test(errorText(error))) {
            const prior = await supabase.from("reviews").select("id, photo_path, voice_path, items(name)").eq("user_id", uid).eq("place_id", placeId).order("created_at", { ascending: false }).limit(30);
            const hit = ((prior.data as unknown as { id: string; photo_path: string | null; voice_path: string | null; items: { name: string } | null }[]) || []).find((r) => r.items?.name.toLowerCase() === d.name.toLowerCase());
            if (hit) {
              data = { id: hit.id }; error = null;
              // This try's copies went unused; never touch the files the saved review points at.
              const spare = uploaded.filter((u) => u.path !== hit.photo_path && u.path !== hit.voice_path);
              void Promise.all(spare.map((u) => supabase.storage.from(u.bucket).remove([u.path]))).catch(() => {});
            }
          }
          if (error) throw error;
          const withId = { ...d, reviewId: (data as { id: string }).id };
          saved.push(withId);
          setDishes((all) => all.map((x) => (x.key === d.key ? withId : x)));
        } catch (e) {
          if (!sent || refusedByServer(e)) await Promise.all(uploaded.map((u) => supabase.storage.from(u.bucket).remove([u.path]))).catch(() => {});
          throw e;
        }
      }
      // Dishes they tagged but chose not to rate are simply left out.
      setDishes((all) => all.filter((d) => d.rating > 0));
      setDone((all) => [...all.filter((x) => !saved.some((s) => s.key === x.key)), ...saved]);
      setSaving(false);
      // What they tapped on the QR page has been used, so a later visit starts clean.
      try { localStorage.removeItem(`tp-plan:${placeId}`); sessionStorage.removeItem(`tp_preselected_${placeId}`); } catch { /* storage blocked */ }
      setStage("done");
      playAppleChime();
    } catch (e) {
      if (saved.length) setDone((all) => [...all.filter((x) => !saved.some((s) => s.key === x.key)), ...saved]);
      const m = errorText(e);
      setErr(m === "Failed to fetch" ? "You seem to be offline. Your review is still here; try again." : m);
      setSaving(false);
      setStage("preview");
    }
  }

  const overall = visit.reviewId && visit.rating ? visit.rating : averageStars(done);

  async function share() {
    setSharingStory(true);
    try {
      const url = await shareLink(`/p/${placeId}`, "review");
      // Lead with what a friend wants to know: the dish worth ordering, and how many diners agree.
      const best = [...done].filter((d) => d.itemId && d.rating >= 4).sort((a, b) => b.rating - a.rating)[0];
      let crowd = "";
      if (best?.itemId) {
        const { data } = await supabase.rpc("top_dishes", { p_place: placeId, p_limit: 50 }).then((x) => x, () => ({ data: null }));
        const row = ((data as TopDish[] | null) || []).find((d) => d.item_id === best.itemId);
        if (row && row.review_count >= 3) crowd = `${lovedPct(row)}% of ${row.review_count} people loved it`;
      }
      const cardFile = await generateStoryCard({
        itemName: best ? best.name : done.length ? done.map((d) => d.name).join(", ") : "My visit",
        placeName: place?.name || "",
        rating: best ? best.rating : overall,
        body: (best?.body.trim()) || (visit.reviewId && visit.body.trim()) || done.find((d) => d.body)?.body || "",
        photoBlob: best?.photo || done.find((d) => d.photo)?.photo,
        crowd,
      });
      const lines = [visit.reviewId ? labelOf(visit.rating) : "", ...done.map((d) => `${d.name}: ${labelOf(d.rating).toLowerCase()}`)].filter(Boolean).join(", ");
      const msg = best
        ? `${isFood ? "Order" : "Try"} the ${best.name} at ${place?.name}${crowd ? ` (${crowd})` : ""}. See what else is good there:\n${url}`
        : `${lines} at ${place?.name}\n${url}`;

      if (navigator.share) {
        if (cardFile && navigator.canShare?.({ files: [cardFile] })) {
          await navigator.share({ files: [cardFile], text: msg, url });
        } else {
          await navigator.share({ text: msg, url });
        }
      } else if (cardFile) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(cardFile);
        a.download = "verified-story.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast("Story card downloaded for Instagram / WhatsApp!");
      } else if (await copyText(msg)) {
        toast("Review link copied, ready to paste");
      }
    } catch {
      /* cancelled */
    } finally {
      setSharingStory(false);
    }
  }

  function another() {
    setDishes([]); setAt(0); setErr(""); setOther(false); setOtherName(""); setPickQ(""); setBackToPreview(false);
    setStage("pick");
  }

  if (loadErr) return (
    <div className="rvx">
      <div className="rvx-bar"><RvxBack fallback={`/p/${placeId}`} /><span className="rvx-brand">Trusted Picks</span><span className="grow" /></div>
      <div className="rvx-gate">
        <span className="ico"><Icon name="alert" size={28} /></span>
        <h2>Couldn't load this place</h2>
        <p>{loadErr}</p>
        <button type="button" className="rvx-cta" onClick={() => setReload((n) => n + 1)}><span>Try again</span><Icon name="chev" size={20} /></button>
      </div>
    </div>
  );
  if (place === undefined || (place && gate === "loading")) return <div className="rvx"><div className="rvx-center"><Spinner /></div></div>;
  if (!place) return (
    <div className="rvx">
      <div className="rvx-bar"><RvxBack /><span className="rvx-brand">Trusted Picks</span><span className="grow" /></div>
      <div className="rvx-gate">
        <span className="ico"><Icon name="search" size={28} /></span>
        <h2>This place isn't listed</h2>
        <p>It may have been removed, or the link is wrong.</p>
        {!focusShop() && <button type="button" className="rvx-cta" onClick={() => nav("/")}><span>Search places</span><Icon name="chev" size={20} /></button>}
      </div>
    </div>
  );
  // After the first review is saved a guest's gate flips, but the visit is still open: keep the flow going.
  if (gate !== "ok" && stage !== "done" && stage !== "sending" && !visit.reviewId && !done.length) return <ReviewGate placeId={placeId} name={place.name} reason={gate} />;

  const look = shopLook(place.category, place.kind);
  const mode = modeOf(place.kind, place.category);
  const goodTags = tags.filter((t) => !isNegativeTag(t.label));
  const badTags = tags.filter((t) => isNegativeTag(t.label));
  const busy = Boolean(saving);
  const things = (n: number) => `${n} ${n === 1 ? mode.item : mode.itemPlural}`;
  // Says in words how the review will be posted, so the icon is never the only clue.
  const named = !isGuest && isPublic;
  const who = <span className="rvx-who">{named ? <Icon name="user" size={16} /> : <Icon name="eyeOff" size={16} />}<span>{named ? "With your name" : "Anonymous"}</span></span>;
  const backBtn = <button type="button" className="rvx-back" aria-label="Back" onClick={back}><Icon name="back" size={20} /></button>;

  const faces = (rating: number, pick: (r: number) => void, locked = false) => (
    <div className="rvx-faces" role="radiogroup" aria-label="How was it?">
      {VERDICTS.map((v) => {
        const on = verdictOf(rating) === v.key;
        return (
          <button key={v.key} type="button" role="radio" aria-checked={on} disabled={locked} className={`rvx-face-btn ${v.key} ${on ? "on" : ""}`}
            onClick={() => { try { if (v.key === "love") playWaxStamp(); else playHapticTap(700 + v.rating * 60); } catch { /* no audio */ } pick(v.rating); }}>
            {on && <span className="mark" aria-hidden="true"><Icon name="check" size={12} width={3} /></span>}
            <Face v={v.key} />{v.label}
            <small className="rvx-stars" aria-label={`${v.rating} out of 5 stars`}>{v.rating}<Icon name="star" size={10} /></small>
          </button>
        );
      })}
    </div>
  );

  const writeBox = (key: string, label: string, placeholder: string, small = false) => {
    const typing = ai[key]?.stage === "typing";
    return (
      <div className="rvx-write">
        <b id={`w-${key}`}>{label}<small>Optional</small></b>
        <span className="box">
          <textarea className={`textarea rvx-text ${small ? "sm" : ""} ${typing ? "typing" : ""}`} aria-labelledby={`w-${key}`} placeholder={placeholder}
            value={bodyOf(key)} readOnly={typing} maxLength={MAX_BODY}
            onChange={(e) => setBody(key, e.target.value, e.target.value.trim() ? undefined : false)} />
          {canDictate && (
            <button type="button" className={`rvx-mic ${listening ? "hot" : ""}`} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak instead of typing"} disabled={typing || recording || busy} onClick={() => dictate(key)}>
              <Icon name="mic" size={16} />
            </button>
          )}
        </span>
        {listening && <span className="rvx-count" role="status">Listening… tap the mic to stop</span>}
      </div>
    );
  };

  const aiPanel = (key: string, enabled: boolean) => {
    const a = ai[key];
    const st = a?.stage ?? "idle";
    const hasText = bodyOf(key).trim().length > 0;
    const qs = AI_QUESTIONS[isFood ? "food" : "other"];
    const label = !enabled ? "Choose how it went to use AI" : st === "typing" ? "Writing…" : st === "ask" ? "Not now" : st === "done" ? "Write again" : hasText ? "Improve my words with AI" : "Write it with AI";
    const refines: { k: "short" | "long" | "casual" | "polite" | "undo"; label: string; on: boolean }[] = [
      { k: "short", label: "Shorter", on: a?.len === "short" }, { k: "long", label: "More detail", on: a?.len === "long" },
      { k: "casual", label: "Casual", on: a?.tone !== "polite" }, { k: "polite", label: "Polite", on: a?.tone === "polite" },
      { k: "undo", label: "Undo AI", on: false },
    ];
    return (
      <div className="rvx-aiwrap">
        <button type="button" className="rvx-aibtn" disabled={!enabled || st === "typing" || busy} onClick={() => startAi(key)}>
          {st === "typing" ? <span className="spin" aria-hidden="true" /> : st === "ask" ? <Icon name="close" size={16} /> : <Icon name="spark" size={17} />}
          {label}
        </button>
        {st === "ask" && a && (
          <div className="rvx-aiask">
            <b>Two quick questions, so it sounds like you</b>
            {qs.map((q, qi) => (
              <div key={q.q} className="rvx-q" role="group" aria-label={q.q}>
                <span>{q.q}</span>
                <div className="rvx-opts">
                  {q.opts.map((o) => {
                    const on = a.answers[qi] === o;
                    return <button key={o} type="button" className={`rvx-opt ${on ? "on" : ""}`} aria-pressed={on}
                      onClick={() => { const ans = [...a.answers]; ans[qi] = on ? null : o; setAiFor(key, { answers: ans }); }}>{on && <Icon name="check" size={14} width={2.6} />}{o}</button>;
                  })}
                </div>
              </div>
            ))}
            <div className="rvx-aigo">
              <button type="button" className="go" onClick={() => void generate(key)}>Write it</button>
              <button type="button" className="skip" onClick={() => void generate(key, { answers: [] })}>Skip</button>
            </div>
          </div>
        )}
        {st === "done" && a && (
          <div className="rvx-refine">
            <div className="rvx-opts">
              {refines.map((r) => <button key={r.k} type="button" className={`rvx-opt ${r.on ? "on" : ""}`} aria-pressed={r.k === "undo" ? undefined : r.on} onClick={() => refine(key, r.k)}>{r.on && <Icon name="check" size={14} width={2.6} />}{r.label}</button>)}
            </div>
            <span className="rvx-aifine"><Icon name="info" size={14} />Written by AI from your choices and words. Check it before you post.</span>
          </div>
        )}
      </div>
    );
  };

  /* ---------- the visit: how did it go? ---------- */
  if (stage === "visit") {
    const vv = verdictOf(visit.rating);
    const set = VISIT_TAGS[isFood ? "food" : "other"];
    const tagged = dishes.length;
    return (
      <div className="rvx" data-stage="visit">
        <div className="rvx-bar"><RvxBack fallback={`/p/${placeId}`} /><span className="rvx-brand">Trusted Picks</span><span className="grow" />{who}</div>
        <header className="rvx-hero">
          {(place.category || place.area) && <div className="rvx-kicker">{[place.category, place.area].filter(Boolean).join(" · ")}</div>}
          <h1>{place.name}</h1>
          <div className="rvx-meta">
            <span className="rvx-verified"><Icon name="verified" size={15} />Verified visit</span>
            {googleLive?.rating != null && <span className="rvx-pill"><Icon name="star" size={14} fill="var(--star)" color="var(--star)" />{googleLive.rating.toFixed(1)} on Google</span>}
          </div>
        </header>
        <section className="rvx-sec">
          <h2 ref={head} tabIndex={-1}>How was your visit?</h2>
          {faces(visit.rating, rateVisit, writing("visit"))}
          {vv && (
            <div className="rvx-group" key={vv}>
              <span className="rvx-gtitle"><Icon name={vv === "meh" ? "thumbsDown" : "thumbs"} size={16} />{set[vv].title}</span>
              <div className="rvx-chips">
                {set[vv].tags.map((t) => {
                  const on = visit.tags.includes(t);
                  return <button key={t} type="button" className={`rvx-chip ${on ? "on" : ""}`} aria-pressed={on}
                    onClick={() => setVisit((v) => ({ ...v, tags: on ? v.tags.filter((x) => x !== t) : [...v.tags, t] }))}>{on && <Icon name="check" size={14} width={2.6} />}{t}</button>;
                })}
              </div>
            </div>
          )}
          {writeBox("visit", "Your review", "What should others know? A few words is enough, and AI can help.")}
          {aiPanel("visit", Boolean(visit.rating))}
        </section>
        {err && <div className="notice err" role="alert">{err}</div>}
        <div className="rvx-foot">
          <button type="button" className={`rvx-cta ${visit.rating ? "" : "idle"}`} onClick={postVisit}>{visit.rating ? "Continue" : "Choose how it went"}</button>
          <button type="button" className="rvx-link" onClick={toDishes}><Icon name={look.icon} size={16} />{tagged ? `Rate the ${things(tagged)} you picked` : `Rate a ${mode.item} too`}</button>
        </div>
      </div>
    );
  }

  /* ---------- which ones did you have? ---------- */
  if (stage === "pick") {
    const first = dishes.findIndex((d) => !d.rating);
    return (
      <div className="rvx" data-stage="pick">
        <div className="rvx-bar">{backBtn}<span className="rvx-where">{place.name}</span>{who}</div>
        <section className="rvx-sec">
          <h2 ref={head} tabIndex={-1}>{mode.ratePrompt}</h2>
          <p className="rvx-hint">Pick up to {MAX_DISHES}. You'll rate each one next, and can skip any.</p>
          {dishes.length > 0 && (
            <div className="rvx-tray" aria-label="Picked">
              {dishes.map((d) => {
                const it = d.itemId ? items.find((i) => i.id === d.itemId) : undefined;
                return (
                  <button key={d.key} type="button" className={`rvx-tok ${it ? "" : "plain"}`} aria-label={`Remove ${d.name}`} onClick={() => { setErr(""); setDishes((all) => all.filter((x) => x.key !== d.key)); }}>
                    {it && <ItemThumb path={it.image_path} icon={look.icon} size={28} />}{d.name}<Icon name="close" size={13} />
                  </button>
                );
              })}
            </div>
          )}
          {items.length > 8 && (
            <label className="rvx-msearch">
              <Icon name="search" size={18} />
              <input type="search" value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder={`Search ${items.length} ${mode.itemPlural}`} aria-label={`Search ${mode.itemPlural}`} autoComplete="off" />
            </label>
          )}
        </section>
        {(() => {
          const q = pickQ.trim().toLowerCase();
          const state = (i: ItemOpt) => {
            const k = dishes.findIndex((d) => d.itemId === i.id);
            return { on: k >= 0, wasRated: postedKeys.has(newDish(i.name, i.id).key) };
          };
          // The shop's picks and what people rate most get photos in one sideways row; the rest is a short list.
          const popular = q || items.length <= 6 ? [] : items.filter((i) => i.is_listed || i.count > 0).slice(0, 8);
          const pop = new Set(popular.map((i) => i.id));
          const rest = (q ? items.filter((i) => `${i.name} ${i.description || ""}`.toLowerCase().includes(q)) : items.filter((i) => !pop.has(i.id)))
            .slice().sort((x, y) => x.name.localeCompare(y.name));
          return (
            <>
              {popular.length > 1 && (
                <section className="rvx-sec" aria-label="Popular here">
                  <div className="rvx-row"><h3>Popular here</h3><span>Swipe for more</span></div>
                  <div className="rvx-scroll">
                    {popular.map((i) => {
                      const { on, wasRated } = state(i);
                      return (
                        <button key={i.id} type="button" className={`rvx-pcard ${on ? "on" : ""}`} aria-pressed={on} disabled={wasRated} onClick={() => toggleItem(i)}>
                          <span className="ph"><ItemThumb path={i.image_path} icon={look.icon} />
                            {wasRated ? <span className="rvx-rated">Rated</span> : <span className="rvx-add-btn" aria-hidden="true"><Icon name={on ? "check" : "plus"} size={16} width={2.4} /></span>}
                          </span>
                          <span className="tx"><b>{i.name}</b>{i.price_inr != null && <small>{formatPrice(i.price_inr, place.currency)}</small>}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
              <section className="rvx-sec" aria-label={popular.length > 1 ? "Everything else" : mode.catalog}>
                {(popular.length > 1 || q) && <div className="rvx-row"><h3>{q ? "Results" : "Everything else"}</h3><span>A to Z</span></div>}
                <div className="rvx-menu">
                  {rest.map((i) => {
                    const { on, wasRated } = state(i);
                    return (
                      <button key={i.id} type="button" className={`rvx-mrow ${on ? "on" : ""}`} aria-pressed={on} disabled={wasRated} onClick={() => toggleItem(i)}>
                        <span className="th"><ItemThumb path={i.image_path} icon={look.icon} size={48} /></span>
                        <span className="tx"><b>{i.name}</b>{(wasRated || i.price_inr != null) && <small>{wasRated ? "Rated" : formatPrice(i.price_inr, place.currency)}</small>}</span>
                        {!wasRated && <span className="rvx-add-btn" aria-hidden="true"><Icon name={on ? "check" : "plus"} size={16} width={2.4} /></span>}
                      </button>
                    );
                  })}
                  {q && !rest.length && <p className="rvx-mrow" style={{ cursor: "default", color: "var(--muted)" }}>No match for "{pickQ.trim()}".</p>}
                  <button type="button" className={`rvx-mrow ${other ? "on" : ""}`} aria-pressed={other} onClick={() => { setOther(!other); if (q && !other) setOtherName(pickQ.trim()); }}>
                    <span className="th rvx-other-th"><Icon name="plus" size={20} /></span>
                    <span className="tx"><b>Something else</b><small>Not on the list? Type it in.</small></span>
                  </button>
                </div>
                {(other || items.length === 0) && (
                  <form className="rvx-add" onSubmit={(e) => { e.preventDefault(); addOther(); }}>
                    <input className="input" value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder={`Type it, e.g. ${mode.itemExample}`} aria-label="What you had" maxLength={80} autoComplete="off" autoFocus={other} />
                    <button type="submit" className="btn small ghost" disabled={!otherName.trim()}><Icon name="plus" size={16} />Add</button>
                  </form>
                )}
              </section>
            </>
          );
        })()}
        {err && <div className="notice err" role="alert">{err}</div>}
        <div className="rvx-foot">
          <button type="button" className={`rvx-cta ${dishes.length ? "" : "idle"}`} onClick={() => { if (dishes.length) goDish(first >= 0 ? first : 0); }}>
            {dishes.length ? `Rate ${things(dishes.length)}` : `Tap the ${mode.itemPlural} you had`}
          </button>
        </div>
      </div>
    );
  }

  /* ---------- one dish ---------- */
  if (stage === "dish" && dish) {
    const last = at === dishes.length - 1;
    const dv = verdictOf(dish.rating);
    const item = items.find((i) => i.id === dish.itemId);
    const groups: { title: string; list: Tag[]; bad?: boolean; opt?: boolean; own?: boolean }[] =
      dv === "love" ? [{ title: "What made it great?", list: goodTags, own: true }]
        : dv === "good" ? [{ title: "What stood out?", list: goodTags, own: true }, { title: "Anything that could be better?", list: badTags, bad: true, opt: true }]
          : dv === "ok" ? [{ title: "What was good?", list: goodTags, own: true }, { title: "What could be better?", list: badTags, bad: true, opt: true }]
          : dv === "meh" ? [{ title: "What went wrong?", list: badTags, bad: true, own: true }, { title: "Anything good?", list: goodTags, opt: true }] : [];
    return (
      <div className="rvx" data-stage="dish">
        <div className="rvx-bar">
          {backBtn}
          <div className="rvx-dots" aria-hidden="true">
            {dishes.map((d, i) => <i key={d.key} className={i < at ? "done" : i === at ? "now" : ""} />)}
          </div>
          {who}
        </div>
        <div className="rvx-dhero" key={`h-${dish.key}`}>
          <span className="th"><ItemThumb path={item?.image_path} icon={look.icon} /></span>
          <div className="cap"><small>Step {at + 1} of {dishes.length}</small><b>{dish.name}</b></div>
        </div>
        <section className="rvx-sec" key={dish.key}>
          <h2 ref={head} tabIndex={-1} className="sr-only">How was the {dish.name}?</h2>
          {faces(dish.rating, rateDish, writing(dish.key))}
          {groups.map((g, gi) => g.list.length > 0 || g.own ? (
            <div className="rvx-group" key={`${dv}-${gi}`}>
              <span className="rvx-gtitle"><Icon name={g.bad ? "thumbsDown" : "thumbs"} size={16} />{g.title}{g.opt && <span className="opt">Optional</span>}</span>
              <div className="rvx-chips" role="group" aria-label={g.title}>
                {g.list.map((t) => <button key={t.id} type="button" aria-pressed={dish.picked.includes(t.id)} className={`rvx-chip ${g.bad ? "bad" : ""} ${dish.picked.includes(t.id) ? "on" : ""}`} onClick={() => toggleTag(t.id)}>{dish.picked.includes(t.id) && <Icon name="check" size={14} width={2.6} />}{t.label}</button>)}
                {g.own && dish.custom.map((t) => <button key={`c-${t}`} type="button" className="rvx-chip on" aria-label={`Remove tag ${t}`} onClick={() => patch(at, { custom: dish.custom.filter((x) => x !== t) })}>{t} <Icon name="close" size={12} /></button>)}
                {g.own && (tagDraft === null ? (
                  dish.custom.length < MAX_CUSTOM_TAGS && <button type="button" className="rvx-chip dash" aria-label="Add your own tag" onClick={() => setTagDraft("")}><Icon name="plus" size={14} />Add your own</button>
                ) : (
                  <input className="input rvx-tagin" value={tagDraft} maxLength={30} autoFocus aria-label="Your own tag" placeholder="e.g. Crispy"
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } if (e.key === "Escape") setTagDraft(null); }}
                    onBlur={addCustomTag} />
                ))}
              </div>
            </div>
          ) : null)}
          {writeBox(dish.key, `About the ${dish.name}`, isFood ? "Taste, portion, how it arrived…" : "What was it like?", true)}
          {aiPanel(dish.key, Boolean(dish.rating))}
          <div className="rvx-media">
            <ReviewPhotoPicker value={dish.photo} onChange={(b) => patch(at, { photo: b })} disabled={busy} />
            {canRecord && !isGuest && <ReviewVoiceRecorder value={dish.voice} onChange={(c) => patch(at, { voice: c })} disabled={busy || listening} onRecordingChange={setRecording} />}
          </div>
        </section>
        {err && <div className="notice err" role="alert">{err}</div>}
        <div className="rvx-foot">
          <button type="button" className={`rvx-cta ${dish.rating ? "" : "idle"}`} disabled={recording} onClick={next}>
            {!dish.rating ? `Skip this ${mode.item}` : backToPreview ? "Done" : last ? "Continue" : <>Next: {dishes[at + 1]!.name}</>}
          </button>
        </div>
      </div>
    );
  }

  /* ---------- preview + sending ---------- */
  if (stage === "preview" || stage === "sending") {
    const sending = stage === "sending";
    const quote = (t: string) => (t.length > 140 ? `${t.slice(0, 140)}…` : t);
    const badge = (r: number) => { const v = verdictOf(r); return v ? <span className={`rvx-badge ${v}`}><Face v={v} size={14} />{labelOf(r)}</span> : null; };
    return (
      <div className="rvx" data-stage={stage}>
        <div className="rvx-bar">{!sending && backBtn}<span className="rvx-where">{place.name}</span>{who}</div>
        <section className="rvx-sec">
          <h2 ref={head} tabIndex={-1}>Check your review</h2>
          <div className="rvx-cards">
            {visit.rating > 0 && (
              <article className="rvx-rcard">
                <span className="rvx-rthumb"><Icon name={look.icon} size={26} /></span>
                <div className="rvx-rbody">
                  <div className="rvx-rhead"><b>Your visit</b>{badge(visit.rating)}</div>
                  <p className={visit.body.trim() || visit.tags.length ? "" : "none"}>{visit.body.trim() ? quote(visit.body.trim()) : visit.tags.length ? visit.tags.join(" · ") : "No words added"}</p>
                  {visit.reviewId ? <span className="rvx-edit done"><Icon name="check" size={13} />Posted</span>
                    : !sending && <button type="button" className="rvx-edit" onClick={() => { setErr(""); setStage("visit"); }}><Icon name="edit" size={14} />Edit</button>}
                </div>
              </article>
            )}
            {rated.map((d) => {
              const labels = [...tags.filter((t) => d.picked.includes(t.id)).map((t) => t.label), ...d.custom];
              const item = items.find((i) => i.id === d.itemId);
              return (
                <article key={d.key} className="rvx-rcard">
                  <span className="rvx-rthumb"><ItemThumb path={item?.image_path} icon={look.icon} /></span>
                  <div className="rvx-rbody">
                    <div className="rvx-rhead"><b>{d.name}</b>{badge(d.rating)}</div>
                    <p className={d.body.trim() || labels.length ? "" : "none"}>{d.body.trim() ? quote(d.body.trim()) : labels.length ? labels.join(" · ") : "No words added"}</p>
                    {d.reviewId ? <span className="rvx-edit done"><Icon name="check" size={13} />Posted</span>
                      : !sending && <button type="button" className="rvx-edit" onClick={() => goDish(dishes.indexOf(d), true)}><Icon name="edit" size={14} />Edit</button>}
                  </div>
                </article>
              );
            })}
          </div>
          {!sending && rated.length < MAX_DISHES && (
            <button type="button" className="rvx-more" onClick={toDishes}><Icon name="plus" size={16} />{dishes.some((d) => !d.rating) ? `Rate your other ${things(dishes.filter((d) => !d.rating).length)}` : rated.length ? `Add another ${mode.item}` : `Rate a ${mode.item} too`}</button>
          )}
        </section>

        {isGuest ? (
          <p className="rvx-anon"><Icon name="eyeOff" size={16} />Posted anonymously. No one can see it was you.</p>
        ) : (
          <fieldset className="rvx-whoseg" disabled={sending}>
            <legend>Post as</legend>
            <div className={`track ${isPublic ? "named" : ""}`}>
              <span className="thumb" aria-hidden="true" />
              <label className={!isPublic ? "on" : ""}><input type="radio" name="visibility" checked={!isPublic} onChange={() => setIsPublic(false)} /><Icon name="eyeOff" size={16} />Anonymous</label>
              <label className={isPublic ? "on" : ""}><input type="radio" name="visibility" checked={isPublic} onChange={() => setIsPublic(true)} /><Icon name="user" size={16} />With my name</label>
            </div>
            <p className="rvx-whonote">{isPublic ? "Your name shows on the review, and friends see you were here." : "It counts the same, but no one sees it was you."}</p>
          </fieldset>
        )}

        {(() => {
          // Shows the exact words that will be copied for Google, so nothing on the next screen is a surprise.
          const g = googleText(visit.rating ? visit : NO_VISIT, rated, tags);
          return g ? (
            <details className="rvx-gprev">
              <summary><Icon name="copy" size={16} />What we'll copy for Google</summary>
              <p>{g}</p>
            </details>
          ) : null;
        })()}
        {!isGuest && !isPublic && rated.some((d) => d.voice && !d.reviewId) && <p className="rvx-anon"><Icon name="mic" size={16} />Voice notes play only on reviews that show your name, so anonymous ones stay anonymous.</p>}
        {err && <div className="notice err" role="alert">{err}</div>}
        <div className="rvx-foot inline">
          {sending ? (
            <div className="rvx-pipe" role="status" aria-live="polite">
              <span className="spin" aria-hidden="true" />
              {saving || "Posting…"}
            </div>
          ) : <>
            <button type="button" className="rvx-cta" onClick={() => void post()}>Post review</button>
            <span className="rvx-hint c">After posting, you can add it to Google too.</span>
          </>}
        </div>
      </div>
    );
  }

  /* ---------- done ---------- */
  const n = done.length;
  const count = visit.reviewId ? (n ? `Visit and ${things(n)}` : "Your visit") : things(n);

  return (
    <div className="rvx" data-stage="done">
      <section className="rvx-sec center">
        <div className="rvx-stampwrap" aria-hidden="true">
          <span className="stamp"><Icon name="check" size={40} width={2.6} /></span>
        </div>
        <h2 ref={head} tabIndex={-1}>Review posted</h2>
        <span className="rvx-count-pill"><Icon name={isGuest || !isPublic ? "eyeOff" : "user"} size={14} />{count} · {isGuest || !isPublic ? "anonymous" : "with your name"}</span>
        <p className="rvx-hint c">Thank you. It helps the next {isFood ? "table order well" : "person choose well"} at {place.name}.</p>
      </section>

      {/* One main action after posting: Google. Everything else is one quiet row. */}
      <GoogleHandoff text={googleText(visit.reviewId ? visit : NO_VISIT, done, tags)} stars={overall} url={gUrl} onMaps={!place.google_place_id}
        placeName={place.name} reviewId={(visit.reviewId || done.find((d) => d.reviewId)?.reviewId) ?? null} opened={googleOpened} onOpened={() => setGoogleOpened(true)} />

      <div className="gh-row">
        <button type="button" onClick={() => void share()} disabled={sharingStory}><Icon name="share" size={20} />{sharingStory ? "Making card…" : "Share"}</button>
        <button type="button" aria-expanded={showPrivateForm} onClick={() => setShowPrivateForm((v) => !v)}><Icon name="message" size={20} />Note to owner</button>
        <button type="button" onClick={another}><Icon name="plus" size={20} />Rate another</button>
      </div>
      {showPrivateForm && <div className="gh-panel"><PrivateNote placeId={placeId} /></div>}
      <Link to={`/p/${placeId}`} className="rvx-link"><Icon name="store" size={16} />Back to {place.name}</Link>
      {isGuest && (
        <Link to={`/signin?next=${encodeURIComponent(`/p/${placeId}`)}`} className="rvx-nudge">
          <span className="rvx-ico"><Icon name="lock" size={18} /></span><span className="grow"><b>Save your picks diary</b><small>Every {mode.item} you rated and loved, on any phone. Optional.</small></span><Icon name="chev" size={18} />
        </Link>
      )}
    </div>
  );
}
