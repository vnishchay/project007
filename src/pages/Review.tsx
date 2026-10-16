import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Place, Tag, Topic } from "../lib/types";
import { Icon, Spinner, StarInput, TopBar } from "../components/ui";

interface ItemOpt { id: string; name: string; topic_id: number | null; count: number }

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
function makeRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const C = w.SpeechRecognition || w.webkitSpeechRecognition;
  return C ? new C() : null;
}

export default function Review() {
  const { placeId = "" } = useParams();
  const { session } = useAuth();
  const nav = useNavigate();
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [visitOpen, setVisitOpen] = useState(false);

  const [itemName, setItemName] = useState("");
  const [custom, setCustom] = useState(false);
  const [topicId, setTopicId] = useState<number | "">("");
  const [rating, setRating] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const [body, setBody] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [listening, setListening] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const rec = useRef<Recognition | null>(null);
  const canDictate = useRef(Boolean(makeRecognition()));

  useEffect(() => {
    (async () => {
      const uid = session!.user.id;
      const [p, it, tp, tg, v] = await Promise.all([
        supabase.from("places").select("id, name, area, category, city, google_place_id").eq("id", placeId).maybeSingle(),
        supabase.from("items").select("id, name, topic_id, item_stats(review_count)").eq("place_id", placeId),
        supabase.from("topics").select("id, name").order("name"),
        supabase.from("tags").select("id, label").order("id"),
        supabase.from("visits").select("id").eq("user_id", uid).eq("place_id", placeId).gt("expires_at", new Date().toISOString()).limit(1),
      ]);
      setPlace((p.data as Place) ?? null);
      const opts = ((it.data || []) as unknown as { id: string; name: string; topic_id: number | null; item_stats: { review_count: number } | { review_count: number }[] | null }[]).map((i) => {
        const st = Array.isArray(i.item_stats) ? i.item_stats[0] : i.item_stats;
        return { id: i.id, name: i.name, topic_id: i.topic_id, count: st?.review_count ?? 0 };
      }).sort((a, b) => b.count - a.count);
      setItems(opts);
      if (!opts.length) setCustom(true);
      setTopics((tp.data as Topic[]) || []);
      setTags((tg.data as Tag[]) || []);
      setVisitOpen(Boolean(v.data?.length));
    })();
    return () => rec.current?.stop();
  }, [placeId, session]);

  function toggleTag(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function dictate() {
    if (listening) { rec.current?.stop(); return; }
    const r = makeRecognition();
    if (!r) return;
    rec.current = r;
    r.lang = "en-IN"; r.interimResults = false; r.continuous = true;
    const start = body ? body.trimEnd() + " " : "";
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ");
      setBody(start + heard);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    setListening(true);
  }

  async function draft() {
    if (!itemName.trim() || !rating) { setErr("Pick what you had and give it stars first."); return; }
    setDrafting(true); setErr("");
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
        body: JSON.stringify({
          place: place?.name, category: place?.category, item: itemName.trim(), rating,
          tags: tags.filter((t) => picked.includes(t.id)).map((t) => t.label), notes: body,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !j.text) throw new Error(j.error || "The AI draft isn't available right now. You can write it yourself.");
      setBody(j.text); setAiDrafted(true);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!itemName.trim()) { setErr("Say what you had."); return; }
    if (!rating) { setErr("Tap the stars to rate it."); return; }
    setSaving(true); setErr("");
    const existing = items.find((i) => i.name.toLowerCase() === itemName.trim().toLowerCase());
    const { data, error } = await supabase.rpc("submit_review", {
      p_place_id: placeId,
      p_item_name: itemName.trim(),
      p_rating: rating,
      p_body: body.trim(),
      p_topic_id: existing?.topic_id ?? (topicId === "" ? null : topicId),
      p_tag_ids: picked,
      p_ai_drafted: aiDrafted,
    });
    setSaving(false);
    if (error) { setErr(errorText(error)); return; }
    nav(`/saved/${(data as { id: string }).id}`, { replace: true });
  }

  if (place === undefined) return <div className="page"><Spinner /></div>;
  if (!place) return <div className="page"><TopBar /><div className="empty"><h2>This place isn't listed</h2></div></div>;

  return (
    <div className="page">
      <TopBar title={place.name} sub={visitOpen ? <span className="green strong">✓ Verified visit</span> : "Scan the table code for a verified badge"} />

      <div className="stack">
        <h2>What did you have?</h2>
        <div className="chips">
          {items.map((i) => (
            <button key={i.id} type="button" className={`chip ${!custom && itemName === i.name ? "on" : ""}`} onClick={() => { setCustom(false); setItemName(i.name); }}>{i.name}</button>
          ))}
          {items.length > 0 && <button type="button" className={`chip dashed ${custom ? "on" : ""}`} onClick={() => { setCustom(true); setItemName(""); }}>+ Other</button>}
        </div>
        {custom && (
          <div className="grid2">
            <input className="input" placeholder="e.g. Margherita" value={itemName} onChange={(e) => setItemName(e.target.value)} aria-label="Item name" autoFocus={items.length > 0} />
            <select className="select" value={topicId} onChange={(e) => setTopicId(e.target.value ? Number(e.target.value) : "")} aria-label="Kind of thing">
              <option value="">Kind (optional)</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <StarInput value={rating} onChange={setRating} />

      <div className="chips">
        {tags.map((t) => <button key={t.id} type="button" className={`tag ${picked.includes(t.id) ? "" : "off"}`} onClick={() => toggleTag(t.id)}>{t.label}</button>)}
      </div>

      <div className="stack">
        <div className="row between">
          <h2>Your review</h2>
          {aiDrafted && <span className="tiny green strong">Drafted with AI, edit freely</span>}
        </div>
        <textarea className="textarea" placeholder="A few words on what made it good or not. Or tap the mic and just talk." value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
        <div className="row wrap">
          {canDictate.current && (
            <button type="button" className={`btn small ${listening ? "green" : "ghost"}`} onClick={dictate}><Icon name="mic" size={16} />{listening ? "Listening… tap to stop" : "Talk"}</button>
          )}
          <button type="button" className="btn small ghost" onClick={draft} disabled={drafting}><Icon name="spark" size={16} />{drafting ? "Drafting…" : body ? "Polish with AI" : "Draft with AI"}</button>
        </div>
      </div>

      {err && <div className="notice err">{err}</div>}
      <button className="btn block" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save review"}</button>
    </div>
  );
}
