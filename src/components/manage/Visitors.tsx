import { useEffect, useMemo, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { timeAgo } from "../../lib/util";
import { Avatar, Icon, useToast } from "../ui";
import { normalizeLink } from "./LinksEditor";
import { assist } from "../../lib/assist";

interface Visitor {
  user_id: string; display_name: string | null; avatar_path: string | null; is_guest: boolean; visits: number;
  last_visit: string; last_table: string | null; at_shop: boolean; can_offer: boolean; last_offer_at: string | null;
}

const LIMIT = 280;
const DAYS = [7, 30, 90] as const;

function friendlyOfferError(e: unknown): string {
  const t = errorText(e);
  if (/reviews or ratings/i.test(t)) return "Offers can't mention reviews or ratings. Google removes reviews that were rewarded.";
  if (/PGRST202|shop_visitors|send_visitor_offer/i.test(t)) return "Visitors need this week's database update first.";
  return t;
}

/** People who scanned this shop's QR codes, and a way to send them an offer in the app. */
export function Visitors({ placeId }: { placeId: string }) {
  const toast = useToast();
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [list, setList] = useState<Visitor[] | null>(null);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr("");
    supabase.rpc("shop_visitors", { p_place: placeId, p_days: days }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(friendlyOfferError(error)); setList([]); return; }
      const rows = (data as Visitor[]) || [];
      setList(rows);
      setPicked((p) => new Set([...p].filter((id) => rows.some((r) => r.user_id === id && r.can_offer))));
    });
    return () => { alive = false; };
  }, [placeId, days, reload]);

  const reachable = useMemo(() => (list || []).filter((v) => v.can_offer), [list]);
  const allOn = reachable.length > 0 && reachable.every((v) => picked.has(v.user_id));
  const over = body.length > LIMIT;

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function polish() {
    setWriting(true); setSendErr("");
    try { setBody((await assist("update", placeId, body)).text); } catch (e) { setSendErr(errorText(e)); }
    setWriting(false);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSendErr("");
    const text = body.trim();
    if (!text || !picked.size) return;
    let p_link: string | null = null;
    if (link.trim()) {
      p_link = normalizeLink(link);
      if (!p_link || !/^https?:\/\//.test(p_link)) { setSendErr("Use a web link, like https://…"); return; }
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("send_visitor_offer", { p_place: placeId, p_users: [...picked], p_body: text, p_link });
    setBusy(false);
    if (error) { setSendErr(friendlyOfferError(error)); return; }
    const n = Number(data) || 0;
    toast(n ? `Offer sent to ${n} ${n === 1 ? "person" : "people"}` : "Nobody could get it right now. Try again tomorrow.");
    setBody(""); setLink(""); setShowLink(false); setPicked(new Set());
    setReload((x) => x + 1);
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <form className="mg-section" onSubmit={send}>
        <div className="mg-section-head">
          <span className="icon-chip sm coral"><Icon name="gift" size={16} /></span>
          <span className="grow">Send an offer</span>
          <span className={`badge ${picked.size ? "" : "gray"}`}>{picked.size} picked</span>
        </div>
        <p className="tiny muted row" style={{ gap: 6, marginTop: -6 }}><Icon name="bell" size={13} />It shows on their home page in the app. One offer per person per day.</p>
        <div className="up-box">
          <textarea className="textarea" style={{ minHeight: 84, border: 0, padding: 0 }} value={body} maxLength={LIMIT + 20} aria-label="Offer"
            onChange={(e) => { setBody(e.target.value); setSendErr(""); }} placeholder="Thanks for coming in! Free dessert with any main this weekend." />
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
        <p className="tiny muted row" style={{ gap: 6 }}><Icon name="alert" size={13} />Don't offer anything for a review or rating. Google removes rewarded reviews.</p>
        {sendErr && <div className="notice err small row" style={{ gap: 8 }}><Icon name="alert" size={16} /><span className="grow">{sendErr}</span></div>}
        <button className="btn green block" disabled={busy || !body.trim() || over || !picked.size}>
          <Icon name="send" size={18} />{busy ? "Sending…" : picked.size ? `Send to ${picked.size}` : "Pick people below"}
        </button>
      </form>

      <div className="stack" style={{ gap: 10 }}>
        <div className="mg-group-title">
          <span className="icon-chip sm sky"><Icon name="people" size={16} /></span>
          <span className="grow">Who scanned</span>
          {list && list.length > 0 && <span className="badge gray">{list.length}</span>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {DAYS.map((d) => (
            <button key={d} type="button" className={`chip ${days === d ? "on" : ""}`} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>
          ))}
          <span className="grow" />
          {reachable.length > 0 && (
            <button type="button" className="link-btn small" onClick={() => setPicked(allOn ? new Set() : new Set(reachable.map((v) => v.user_id)))}>
              <Icon name={allOn ? "close" : "checkCircle"} size={15} />{allOn ? "Clear" : "Pick all"}
            </button>
          )}
        </div>
        <p className="tiny muted row" style={{ gap: 6 }}><Icon name="lock" size={13} />You see names only, never emails, phones or which review is whose. People can hide from you.</p>
        {err && <div className="notice err small">{err}</div>}
        {list === null ? <div className="skeleton" style={{ height: 72 }} /> : list.length === 0 ? (
          !err && <p className="small muted">Nobody yet in the last {days} days. People appear here after they scan a table QR code.</p>
        ) : (
          <div className="menu">
            {list.map((v) => {
              const name = v.display_name || (v.is_guest ? "Guest" : "Customer");
              const on = picked.has(v.user_id);
              const sub = [
                v.visits > 1 ? `${v.visits} visits` : "1 visit",
                timeAgo(v.last_visit),
                v.last_table,
              ].filter(Boolean).join(" · ");
              return (
                <button key={v.user_id} type="button" className="menu-row" disabled={!v.can_offer} aria-pressed={on} style={v.can_offer ? undefined : { opacity: 0.55 }}
                  onClick={() => toggle(v.user_id)} title={v.can_offer ? undefined : v.last_offer_at ? "Already got an offer today" : "Turned offers off"}>
                  <Avatar id={v.user_id} name={name} path={v.avatar_path} size="sm" />
                  <span className="grow stack tight" style={{ minWidth: 0 }}>
                    <span className="t ellipsis">{name}{v.at_shop && <span title="Scanned at the shop" style={{ marginLeft: 5, verticalAlign: -2 }}><Icon name="verified" size={14} color="var(--green)" /></span>}</span>
                    <span className="s ellipsis">{v.can_offer ? sub : v.last_offer_at && Date.now() - new Date(v.last_offer_at).getTime() < 86_400_000 ? `Offer sent ${timeAgo(v.last_offer_at)}` : "Offers off"}</span>
                  </span>
                  <Icon name={on ? "checkCircle" : "plus"} size={18} color={on ? "var(--green)" : "var(--muted)"} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
