import { useEffect, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/util";
import { Icon, useToast } from "../ui";
import { normalizeLink } from "./LinksEditor";
import { assist } from "../../lib/assist";

export interface PlaceUpdate { id: string; body: string; link_url: string | null; created_at: string }

const LIMIT = 280;
const DAY = 86_400_000;

export function friendlyUpdateError(e: unknown): string {
  const t = errorText(e);
  if (/3 updates a day/i.test(t)) return "You've posted 3 updates today. Post again tomorrow.";
  if (/place_updates_link_url_check|link_url/i.test(t)) return "The link needs to start with https://";
  return t;
}

/** Short notes from the shop to everyone who saved or reviewed it. */
export function Updates({ placeId, live }: { placeId: string; live: boolean }) {
  const { session } = useAuth();
  const toast = useToast();
  const [list, setList] = useState<PlaceUpdate[] | null>(null);
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);

  async function polish() {
    setWriting(true); setErr("");
    try { setBody((await assist("update", placeId, body)).text); } catch (e) { setErr(errorText(e)); }
    setWriting(false);
  }

  useEffect(() => {
    let alive = true;
    supabase.from("place_updates").select("id, body, link_url, created_at").eq("place_id", placeId).order("created_at", { ascending: false }).limit(30)
      .then(({ data, error }) => { if (!alive) return; if (error) setErr(errorText(error)); setList((data as PlaceUpdate[]) || []); });
    return () => { alive = false; };
  }, [placeId]);

  const today = (list || []).filter((u) => Date.now() - new Date(u.created_at).getTime() < DAY).length;
  const left = Math.max(0, 3 - today);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const text = body.trim();
    if (!text) return;
    let link_url: string | null = null;
    if (link.trim()) {
      link_url = normalizeLink(link);
      if (!link_url || !/^https?:\/\//.test(link_url)) { setErr("Use a web link, like https://…"); return; }
    }
    setBusy(true);
    const { data, error } = await supabase.from("place_updates").insert({ place_id: placeId, body: text, link_url, created_by: session?.user.id })
      .select("id, body, link_url, created_at").single();
    setBusy(false);
    if (error) { setErr(friendlyUpdateError(error)); return; }
    setList((xs) => [data as PlaceUpdate, ...(xs || [])]);
    setBody(""); setLink(""); setShowLink(false);
    toast("Update posted");
  }

  async function remove(u: PlaceUpdate) {
    if (!confirm("Delete this update?")) return;
    const { error } = await supabase.from("place_updates").delete().eq("id", u.id);
    if (error) { toast(errorText(error)); return; }
    setList((xs) => (xs || []).filter((x) => x.id !== u.id));
    toast("Deleted");
  }

  const over = body.length > LIMIT;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <form className="mg-section" onSubmit={post}>
        <div className="mg-section-head"><span className="icon-chip sm coral"><Icon name="message" size={16} /></span><span className="grow">Post an update</span><span className={`badge ${left ? "gray" : "warn"}`}>{left} left today</span></div>
        <p className="tiny muted row" style={{ gap: 6, marginTop: -6 }}><Icon name="lock" size={13} />People who saved or reviewed you see it. You never see who they are.</p>
        <div className="up-box">
          <textarea className="textarea" style={{ minHeight: 96, border: 0, padding: 0 }} value={body} maxLength={LIMIT + 20} aria-label="Update"
            onChange={(e) => { setBody(e.target.value); setErr(""); }} placeholder="New this week: wood-fired calzone. 20% off till Sunday!" />
          <div className="row" style={{ gap: 8 }}>
            {!showLink && <button type="button" className="link-btn small" onClick={() => setShowLink(true)}><Icon name="link" size={15} />Add link</button>}
            <button type="button" className="link-btn small" disabled={writing || !body.trim()} onClick={polish} title="Type a few words, then tap"><Icon name="spark" size={15} />{writing ? "Writing…" : "Polish"}</button>
            <span className="grow" />
            <span className={`tiny ${over ? "strong" : "muted"}`} style={over ? { color: "var(--danger)" } : undefined}>{body.length}/{LIMIT}</span>
          </div>
          {showLink && (
            <div className="gf-bar" style={{ height: 44 }}>
              <Icon name="link" size={16} color="var(--muted)" />
              <input className="grow" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="https://… (optional)" aria-label="Link" />
              <button type="button" className="mg-act" aria-label="Remove link" onClick={() => { setLink(""); setShowLink(false); }}><Icon name="close" size={15} /></button>
            </div>
          )}
        </div>
        {!live && <div className="notice warn small">Your listing isn't live, so customers won't see updates yet.</div>}
        {err && <div className="notice err small row" style={{ gap: 8 }}><Icon name="alert" size={16} /><span className="grow">{err}</span></div>}
        <button className="btn green block" disabled={busy || !body.trim() || over || !left}><Icon name="send" size={18} />{busy ? "Posting…" : left ? "Post update" : "Back tomorrow"}</button>
      </form>

      <div className="stack" style={{ gap: 10 }}>
        <div className="mg-group-title"><span className="icon-chip sm sky"><Icon name="clock" size={16} /></span><span className="grow">Past updates</span>{list && list.length > 0 && <span className="badge gray">{list.length}</span>}</div>
        {list === null ? <div className="skeleton" style={{ height: 72 }} /> : list.length === 0 ? (
          <p className="small muted">Nothing yet. Share a new dish, an offer or your festive hours.</p>
        ) : list.map((u) => (
          <div key={u.id} className="up-item">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <p className="grow up-body">{u.body}</p>
              <button className="mg-act" aria-label="Delete update" onClick={() => remove(u)}><Icon name="trash" size={15} /></button>
            </div>
            {u.link_url && <a className="tiny row ellipsis" style={{ gap: 4 }} href={u.link_url} target="_blank" rel="noreferrer"><Icon name="external" size={12} />{u.link_url.replace(/^https?:\/\/(www\.)?/, "")}</a>}
            <span className="tiny muted">{timeAgo(u.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
