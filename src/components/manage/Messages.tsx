import { useEffect, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { placeMediaUrl } from "../../lib/media";
import { initials, timeAgo } from "../../lib/util";
import { Icon, useConfirm, useToast } from "../ui";
import { normalizeLink } from "./LinksEditor";
import { friendlyUpdateError, type PlaceUpdate } from "./Updates";
import { assist } from "../../lib/assist";
import "../../styles/home.css";

const LIMIT = 280;
const DAY = 86_400_000;

export type Audience = "update" | "offer";
interface SentOffer { body: string; link_url: string | null; sent_at: string; recipients: number; seen: number }

function friendlyOfferError(e: unknown): string {
  const t = errorText(e);
  if (/reviews or ratings/i.test(t)) return "Offers can't mention reviews or ratings. Google removes reviews that were rewarded.";
  if (/PGRST202|could not find the function/i.test(t)) return "This isn't available yet.";
  return t;
}

/**
 * One place to write to customers. "Everyone" posts an update that shows to people who saved or
 * reviewed the shop; "Visitors you picked" sends an offer to people who scanned a table QR.
 * The preview shows it exactly as customers will see it, and the history shows what was sent.
 */
export function Messages({ placeId, placeName, logoPath, live, audience, onAudience, picked, onPick, onSent }: {
  placeId: string; placeName: string; logoPath: string | null; live: boolean;
  audience: Audience; onAudience: (a: Audience) => void;
  /** Visitors picked on the Visitors tab. */
  picked: string[]; onPick: () => void; onSent: () => void;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [updates, setUpdates] = useState<PlaceUpdate[] | null>(null);
  const [offers, setOffers] = useState<SentOffer[] | null>(null);
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    let alive = true;
    supabase.from("place_updates").select("id, body, link_url, created_at").eq("place_id", placeId).order("created_at", { ascending: false }).limit(30)
      .then(({ data, error }) => { if (alive) setUpdates(error ? [] : ((data as PlaceUpdate[]) || [])); });
    supabase.rpc("shop_offers_sent", { p_place: placeId, p_limit: 20 })
      .then(({ data, error }) => { if (alive) setOffers(error ? [] : ((data as SentOffer[]) || [])); }, () => alive && setOffers([]));
    return () => { alive = false; };
  }, [placeId, n]);

  const today = (updates || []).filter((u) => Date.now() - new Date(u.created_at).getTime() < DAY).length;
  const left = Math.max(0, 3 - today);
  const over = body.length > LIMIT;
  const isOffer = audience === "offer";

  async function polish() {
    setWriting(true); setErr("");
    try { setBody((await assist("update", placeId, body)).text); } catch (e) { setErr(errorText(e)); }
    setWriting(false);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const text = body.trim();
    if (!text) return;
    let url: string | null = null;
    if (link.trim()) {
      url = normalizeLink(link);
      if (!url || !/^https?:\/\//.test(url)) { setErr("Use a web link, like https://…"); return; }
    }
    if (isOffer && !picked.length) { onPick(); return; }
    setBusy(true);
    if (isOffer) {
      const { data, error } = await supabase.rpc("send_visitor_offer", { p_place: placeId, p_users: picked, p_body: text, p_link: url });
      setBusy(false);
      if (error) { setErr(friendlyOfferError(error)); return; }
      const sent = Number(data) || 0;
      toast(sent ? `Offer sent to ${sent} ${sent === 1 ? "person" : "people"}` : "Nobody could get it right now. Try again tomorrow.");
    } else {
      const { error } = await supabase.from("place_updates").insert({ place_id: placeId, body: text, link_url: url, created_by: session?.user.id });
      setBusy(false);
      if (error) { setErr(friendlyUpdateError(error)); return; }
      toast("Update posted");
    }
    setBody(""); setLink(""); setShowLink(false);
    setN((x) => x + 1);
    onSent();
  }

  async function remove(u: PlaceUpdate) {
    const ok = await confirm({ title: "Delete this update?", body: "It disappears from your page and from customers' home pages.", ok: "Delete", danger: true });
    if (!ok) return;
    const { error } = await supabase.from("place_updates").delete().eq("id", u.id);
    if (error) { toast(errorText(error)); return; }
    setUpdates((xs) => (xs || []).filter((x) => x.id !== u.id));
    toast("Deleted");
  }

  const logo = placeMediaUrl(logoPath);
  const blocked = busy || !body.trim() || over || (!isOffer && !left);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <form className="mg-section" onSubmit={send}>
        <div className="mg-section-head"><span className="icon-chip sm coral"><Icon name={isOffer ? "gift" : "message"} size={16} /></span><span className="grow">Write to customers</span>
          {!isOffer && <span className={`badge ${left ? "gray" : "warn"}`}>{left} updates left today</span>}</div>

        <fieldset className="mg-aud">
          <legend className="mg-label">Who gets it</legend>
          <label className={!isOffer ? "on" : ""}><input type="radio" name="aud" checked={!isOffer} onChange={() => onAudience("update")} />
            <Icon name="people" size={18} /><span><b>Everyone who saved or reviewed you</b><small>An update on your page and their home page. You never see who they are.</small></span></label>
          <label className={isOffer ? "on" : ""}><input type="radio" name="aud" checked={isOffer} onChange={() => onAudience("offer")} />
            <Icon name="gift" size={18} /><span><b>Visitors you pick{picked.length ? ` (${picked.length})` : ""}</b><small>A private offer to people who scanned your QR. One per person per day.</small></span></label>
        </fieldset>
        {isOffer && !picked.length && <button type="button" className="link-btn small" style={{ alignSelf: "flex-start" }} onClick={onPick}><Icon name="people" size={15} />Pick visitors first</button>}

        <div className="up-box">
          <textarea className="textarea" style={{ minHeight: 88, border: 0, padding: 0 }} value={body} maxLength={LIMIT + 20} aria-label="Message"
            onChange={(e) => { setBody(e.target.value); setErr(""); }} placeholder={isOffer ? "Thanks for coming in! Free dessert with any main this weekend." : "New this week: something special. Open late on Sunday!"} />
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

        {body.trim() && (
          <div className="stack tight" aria-label="Preview">
            <span className="tiny muted strong row" style={{ gap: 4 }}><Icon name="eye" size={13} />What customers see</span>
            <div className={`news-card ${isOffer ? "offer" : ""}`} style={{ width: "100%", maxWidth: 320 }}>
              <span className="news-head">
                <span className="news-logo">{logo ? <img src={logo} alt="" /> : initials(placeName)}</span>
                <span className="grow stack tight" style={{ minWidth: 0 }}>
                  <span className="strong small ellipsis">{placeName}</span>
                  <span className="tiny muted">{isOffer ? <><Icon name="gift" size={12} /> For you · now</> : "now"}</span>
                </span>
              </span>
              <span className="news-body">{body.trim()}</span>
            </div>
          </div>
        )}

        {isOffer && <p className="tiny muted row" style={{ gap: 6 }}><Icon name="alert" size={13} />Don't offer anything for a review or rating. Google removes rewarded reviews.</p>}
        {!live && <div className="notice warn small">Your listing isn't live, so customers won't see this yet.</div>}
        {err && <div className="notice err small row" style={{ gap: 8 }}><Icon name="alert" size={16} /><span className="grow">{err}</span></div>}
        <button className="btn green block" disabled={blocked}>
          <Icon name="send" size={18} />{busy ? "Sending…" : isOffer ? (picked.length ? `Send offer to ${picked.length}` : "Pick visitors first") : left ? "Post update" : "Back tomorrow"}
        </button>
      </form>

      {offers && offers.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="mg-group-title"><span className="icon-chip sm coral"><Icon name="gift" size={16} /></span><span className="grow">Offers sent</span><span className="badge gray">{offers.length}</span></div>
          {offers.map((o) => (
            <div key={`${o.sent_at}-${o.body}`} className="up-item">
              <p className="up-body">{o.body}</p>
              {o.link_url && <span className="tiny row ellipsis" style={{ gap: 4 }}><Icon name="external" size={12} />{o.link_url.replace(/^https?:\/\/(www\.)?/, "")}</span>}
              <span className="tiny muted row" style={{ gap: 6 }}><Icon name="send" size={12} />{timeAgo(o.sent_at)} · to {o.recipients} · <Icon name="eye" size={12} />seen by {o.seen}</span>
            </div>
          ))}
        </div>
      )}

      <div className="stack" style={{ gap: 10 }}>
        <div className="mg-group-title"><span className="icon-chip sm sky"><Icon name="clock" size={16} /></span><span className="grow">Past updates</span>{updates && updates.length > 0 && <span className="badge gray">{updates.length}</span>}</div>
        {updates === null ? <div className="skeleton" style={{ height: 72 }} /> : updates.length === 0 ? (
          <p className="small muted">Nothing yet. Share something new, an offer or your festive hours.</p>
        ) : updates.map((u) => (
          <div key={u.id} className="up-item">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <p className="grow up-body">{u.body}</p>
              <button className="mg-act" aria-label="Delete update" onClick={() => void remove(u)}><Icon name="trash" size={15} /></button>
            </div>
            {u.link_url && <a className="tiny row ellipsis" style={{ gap: 4 }} href={u.link_url} target="_blank" rel="noreferrer"><Icon name="external" size={12} />{u.link_url.replace(/^https?:\/\/(www\.)?/, "")}</a>}
            <span className="tiny muted">{timeAgo(u.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
