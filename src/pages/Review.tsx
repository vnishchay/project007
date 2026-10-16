import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Place, Tag, Topic } from "../lib/types";
import { Icon, Spinner, StarInput, TopBar } from "../components/ui";
import { ReviewPhotoPicker } from "../components/ReviewPhoto";
import { ReviewVoiceRecorder, canRecordVoice, type VoiceClip } from "../components/ReviewVoice";

interface ItemOpt { id: string; name: string; topic_id: number | null; count: number }

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

/** The topic whose name best matches the text (longest name contained in it, or containing it). */
function matchTopic(topics: Topic[], ...texts: (string | null | undefined)[]): Topic | null {
  for (const raw of texts) {
    const t = (raw || "").trim().toLowerCase();
    if (!t) continue;
    const exact = topics.find((x) => x.name.toLowerCase() === t);
    if (exact) return exact;
    const inside = topics.filter((x) => t.includes(x.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
    if (inside) return inside;
    const around = topics.find((x) => x.name.toLowerCase().includes(t) && t.length >= 3);
    if (around) return around;
  }
  return null;
}

const MAX_BODY = 2000;
const MAX_CUSTOM_TAGS = 5;

/** Free-text tags aren't in the tags table, so they ride along at the end of the review text. */
function withCustomTags(body: string, custom: string[]): string {
  const b = body.trim();
  if (!custom.length) return b;
  const line = `Tags: ${custom.join(", ")}`;
  return (b ? `${b}\n\n${line}` : line).slice(0, MAX_BODY);
}

export default function Review() {
  const { placeId = "" } = useParams();
  const [params] = useSearchParams();
  const { session } = useAuth();
  const uid = session?.user.id;
  const nav = useNavigate();
  const listId = useId();
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState("");
  const [reload, setReload] = useState(0);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [visitOpen, setVisitOpen] = useState(false);

  const [itemName, setItemName] = useState("");
  const [custom, setCustom] = useState(false);
  const [topicId, setTopicId] = useState<number | "">("");
  const topicTouched = useRef(false);
  const [rating, setRating] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [voice, setVoice] = useState<VoiceClip | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState<string | false>(false);
  const [err, setErr] = useState("");
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
        const [p, it, tp, tg, v] = await Promise.all([
          supabase.from("places").select("id, name, area, category, city, google_place_id, status").eq("id", placeId).maybeSingle(),
          supabase.from("items").select("id, name, topic_id, item_stats(review_count)").eq("place_id", placeId),
          supabase.from("topics").select("id, name").order("name"),
          supabase.from("tags").select("id, label").order("id"),
          supabase.from("visits").select("id").eq("user_id", uid).eq("place_id", placeId).gt("expires_at", new Date().toISOString()).limit(1),
        ]);
        if (!alive) return;
        // A failed query is not the same as "this place isn't listed".
        const failed = [p, it, tp, tg].find((r) => r.error);
        if (failed?.error) {
          // A malformed id in the URL comes back as an invalid-uuid error: that's simply not a place.
          if (p.error && /invalid input syntax for type uuid/i.test(p.error.message)) { setPlace(null); return; }
          setLoadErr(errorText(failed.error));
          return;
        }
        const pl = (p.data as Place | null) ?? null;
        setPlace(pl && pl.status === "live" ? pl : null);
        const opts = ((it.data || []) as unknown as { id: string; name: string; topic_id: number | null; item_stats: { review_count: number } | { review_count: number }[] | null }[]).map((i) => {
          const st = Array.isArray(i.item_stats) ? i.item_stats[0] : i.item_stats;
          return { id: i.id, name: i.name, topic_id: i.topic_id, count: st?.review_count ?? 0 };
        }).sort((a, b) => b.count - a.count);
        setItems(opts);
        if (!opts.length) setCustom(true);
        const tps = (tp.data as Topic[]) || [];
        setTopics(tps);
        setTags((tg.data as Tag[]) || []);
        setVisitOpen(Boolean(v.data?.length));
        // Preselect the kind from ?topic / ?q, else the place's category. The user can still change it.
        if (!topicTouched.current) {
          const guess = matchTopic(tps, params.get("topic"), params.get("q"), pl?.category);
          setTopicId(guess ? guess.id : "");
        }
      } catch (e) {
        if (alive) setLoadErr(errorText(e) === "Failed to fetch" ? "You seem to be offline." : errorText(e));
      }
    })();
    return () => { alive = false; };
    // params are read once per load on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, uid, reload]);

  // Stop listening if the page goes away.
  useEffect(() => () => rec.current?.stop(), []);

  function toggleTag(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function addCustomTag() {
    const t = (tagDraft || "").replace(/\s+/g, " ").replace(/^#/, "").trim().slice(0, 30);
    if (!t) { setTagDraft(null); return; }
    const lower = t.toLowerCase();
    const known = tags.find((x) => x.label.toLowerCase() === lower);
    if (known) {
      if (!picked.includes(known.id)) setPicked((p) => [...p, known.id]);
    } else if (!customTags.some((x) => x.toLowerCase() === lower)) {
      if (customTags.length >= MAX_CUSTOM_TAGS) { setErr(`Up to ${MAX_CUSTOM_TAGS} of your own tags.`); return; }
      setCustomTags((c) => [...c, t]);
    }
    setTagDraft(null);
  }

  const dictate = useCallback(() => {
    if (listening) { rec.current?.stop(); return; }
    const r = makeRecognition();
    if (!r) return;
    rec.current = r;
    r.lang = "en-IN"; r.interimResults = false; r.continuous = true;
    const start = body ? body.trimEnd() + " " : "";
    r.onresult = (e) => {
      const heard = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ");
      setBody((start + heard).slice(0, MAX_BODY));
    };
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); setErr("Couldn't hear you. Check the microphone permission, or type instead."); };
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, body]);

  async function draft() {
    if (!itemName.trim() || !rating) { setErr("Pick what you had and give it stars first."); return; }
    setDrafting(true); setErr("");
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
        body: JSON.stringify({
          place: place?.name, category: place?.category, item: itemName.trim(), rating,
          tags: [...tags.filter((t) => picked.includes(t.id)).map((t) => t.label), ...customTags], notes: body,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !j.text) throw new Error(j.error || "The AI draft isn't available right now. You can write it yourself.");
      setBody(j.text.slice(0, MAX_BODY)); setAiDrafted(true);
    } catch (e) {
      setErr(errorText(e) === "Failed to fetch" ? "You seem to be offline. You can write it yourself." : errorText(e));
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (saving) return;
    if (!itemName.trim()) { setErr("Say what you had."); return; }
    if (!rating) { setErr("Tap the stars to rate it."); return; }
    if (recording) { setErr("Stop the recording first."); return; }
    if (listening) rec.current?.stop();
    if (!uid) return;
    setErr("");
    const uploaded: { bucket: string; path: string }[] = [];
    const cleanup = () => Promise.all(uploaded.map((u) => supabase.storage.from(u.bucket).remove([u.path]))).catch(() => {});
    try {
      let photoPath: string | null = null;
      let voicePath: string | null = null;
      if (photo) {
        setSaving("Uploading photo…");
        // A random name, so the link never shows who posted it.
        const path = `${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from("review-photos").upload(path, photo, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error(`The photo didn't upload: ${errorText(error)}`);
        uploaded.push({ bucket: "review-photos", path });
        photoPath = path;
      }
      if (voice) {
        setSaving("Uploading voice note…");
        const path = `${crypto.randomUUID()}.${voice.ext}`;
        const { error } = await supabase.storage.from("voice").upload(path, voice.blob, { contentType: voice.mime.split(";")[0] || "audio/webm", upsert: false });
        if (error) throw new Error(`The voice note didn't upload: ${errorText(error)}`);
        uploaded.push({ bucket: "voice", path });
        voicePath = path;
      }
      setSaving("Saving…");
      const existing = items.find((i) => i.name.toLowerCase() === itemName.trim().toLowerCase());
      const { data, error } = await supabase.rpc("submit_review", {
        p_place_id: placeId,
        p_item_name: itemName.trim(),
        p_rating: rating,
        p_body: withCustomTags(body, customTags),
        p_topic_id: existing?.topic_id ?? (topicId === "" ? null : topicId),
        p_tag_ids: picked,
        p_ai_drafted: aiDrafted,
        p_voice_path: voicePath,
        p_photo_path: photoPath,
        p_is_public: isPublic,
      });
      if (error) throw error;
      nav(`/saved/${(data as { id: string }).id}`, { replace: true });
    } catch (e) {
      await cleanup();
      const m = errorText(e);
      setErr(m === "Failed to fetch" ? "You seem to be offline. Your review is still here; try again." : m);
      setSaving(false);
    }
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
  if (place === undefined) return <div className="page"><Spinner /></div>;
  if (!place) return (
    <div className="page"><TopBar /><div className="empty">
      <h2>This place isn't listed</h2>
      <p>It may have been removed, or the link is wrong.</p>
      <button type="button" className="btn ghost" onClick={() => nav("/")}>Search places</button>
    </div></div>
  );

  const bodyLen = withCustomTags(body, customTags).length;
  const busy = Boolean(saving);

  return (
    <div className="page">
      <TopBar title={place.name} sub={visitOpen ? <span className="green strong">✓ Verified visit</span> : "Scan the table code for a verified badge"} />

      <div className="stack">
        <h2 id="what-h">What did you have?</h2>
        {items.length > 0 && (
          <div className="chips" role="group" aria-labelledby="what-h">
            {items.map((i) => (
              <button key={i.id} type="button" aria-pressed={!custom && itemName === i.name} className={`chip ${!custom && itemName === i.name ? "on" : ""}`} onClick={() => { setCustom(false); setItemName(i.name); }}>{i.name}</button>
            ))}
            <button type="button" aria-pressed={custom} className={`chip dashed ${custom ? "on" : ""}`} onClick={() => { setCustom(true); setItemName(""); }}>+ Other</button>
          </div>
        )}
        {custom && (
          <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)" }}>
            <input
              className="input"
              placeholder="e.g. Margherita"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              aria-label="Item name"
              list={listId}
              maxLength={80}
              autoComplete="off"
              autoFocus={items.length > 0}
            />
            <datalist id={listId}>
              {items.map((i) => <option key={i.id} value={i.name} />)}
            </datalist>
            <select className="select" value={topicId} onChange={(e) => { topicTouched.current = true; setTopicId(e.target.value ? Number(e.target.value) : ""); }} aria-label="Kind of thing">
              <option value="">Kind (optional)</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <StarInput value={rating} onChange={setRating} />

      <div className="chips" role="group" aria-label="Tags">
        {tags.map((t) => <button key={t.id} type="button" aria-pressed={picked.includes(t.id)} className={`tag ${picked.includes(t.id) ? "" : "off"}`} onClick={() => toggleTag(t.id)}>{t.label}</button>)}
        {customTags.map((t) => (
          <button key={`c-${t}`} type="button" className="tag" aria-label={`Remove tag ${t}`} onClick={() => setCustomTags((c) => c.filter((x) => x !== t))}>
            {t} <span aria-hidden="true">×</span>
          </button>
        ))}
        {tagDraft === null ? (
          customTags.length < MAX_CUSTOM_TAGS && <button type="button" className="tag off" style={{ borderStyle: "dashed" }} onClick={() => setTagDraft("")}>+ tag</button>
        ) : (
          <span className="row" style={{ gap: 6 }}>
            <input
              className="input"
              style={{ padding: "5px 10px", fontSize: 13, width: 140, borderRadius: 8 }}
              value={tagDraft}
              maxLength={30}
              autoFocus
              aria-label="Your own tag"
              placeholder="e.g. Crispy"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addCustomTag(); }
                if (e.key === "Escape") setTagDraft(null);
              }}
              onBlur={addCustomTag}
            />
          </span>
        )}
      </div>

      <div className="stack">
        <div className="row between">
          <h2><label htmlFor="review-body">Your review</label></h2>
          {aiDrafted && <span className="tiny green strong">Drafted with AI, edit freely</span>}
        </div>
        <textarea
          id="review-body"
          className="textarea"
          placeholder={canDictate ? "A few words on what made it good or not. Or tap Talk and just speak." : "A few words on what made it good or not."}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_BODY}
        />
        {bodyLen > MAX_BODY - 200 && <span className="tiny muted" style={{ textAlign: "right" }}>{bodyLen}/{MAX_BODY}</span>}
        <div className="row wrap">
          {canDictate && (
            <button type="button" aria-pressed={listening} className={`btn small ${listening ? "green" : "ghost"}`} onClick={dictate} disabled={recording || busy}><Icon name="mic" size={16} />{listening ? "Listening… tap to stop" : "Talk"}</button>
          )}
          <button type="button" className="btn small ghost" onClick={draft} disabled={drafting || busy}><Icon name="spark" size={16} />{drafting ? "Drafting…" : body ? "Polish with AI" : "Draft with AI"}</button>
        </div>
      </div>

      <div className="stack">
        <h2>Add a photo or voice note <span className="tiny muted" style={{ fontWeight: 600 }}>(optional)</span></h2>
        <ReviewPhotoPicker value={photo} onChange={setPhoto} disabled={busy} />
        {canRecord && <ReviewVoiceRecorder value={voice} onChange={setVoice} disabled={busy || listening} onRecordingChange={setRecording} />}
      </div>

      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="strong" style={{ fontSize: 16, marginBottom: 10 }}>Who can see it's you</legend>
        <label className="card row" style={{ cursor: "pointer", flexDirection: "row", alignItems: "flex-start", borderColor: !isPublic ? "var(--green)" : "var(--line)" }}>
          <input type="radio" name="visibility" checked={!isPublic} onChange={() => setIsPublic(false)} style={{ width: 20, height: 20, accentColor: "var(--green)", marginTop: 2 }} />
          <span className="grow"><b>Post anonymously</b><br /><span className="small muted">Your rating counts, but no one can see you wrote it or that you went there.</span></span>
        </label>
        <label className="card row" style={{ cursor: "pointer", flexDirection: "row", alignItems: "flex-start", borderColor: isPublic ? "var(--green)" : "var(--line)" }}>
          <input type="radio" name="visibility" checked={isPublic} onChange={() => setIsPublic(true)} style={{ width: 20, height: 20, accentColor: "var(--green)", marginTop: 2 }} />
          <span className="grow"><b>Show my name</b><br /><span className="small muted">Your name and photo appear on this review, like a Google review. Friends who synced contacts see you were here.</span></span>
        </label>
        <span className="tiny muted">You can change this later from your profile.</span>
      </fieldset>

      {err && <div className="notice err" role="alert">{err}</div>}
      <button className="btn block" onClick={save} disabled={busy || recording}>{saving || "Save review"}</button>
    </div>
  );
}
