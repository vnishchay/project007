import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CALLS, cancelCall, myCalls, placeService, sendCall, waited, type CallKind, type TableCall } from "../lib/service";
import { errorText } from "../lib/supabase";
import { playHapticTap } from "../lib/haptics";
import { Icon } from "./ui";
import "../styles/service.css";

const FOOD_CHIPS = ["Waiting a long time", "My order is wrong", "Food is cold", "Need water", "Too hot or cold in here"];
const OTHER_CHIPS = ["Waiting a long time", "Something isn't right", "Need help choosing", "Cleanliness"];

/**
 * On the table page: call the staff, ask for the bill (when the shop switched table calls on), or tell
 * the shop something right now. It reaches the shop's live board with the table only, never the name,
 * and it has nothing to do with the review: rating stays open whatever is sent here.
 */
export function TableService({ placeId, shop, table, food, ensureVisit, onHelp }: {
  placeId: string; shop: string; table: string | null; food: boolean;
  /** Starts the visit (guest session, location check) if there isn't one yet. */
  ensureVisit: () => Promise<boolean>;
  /** Use the trackable recovery flow when the host page provides one. */
  onHelp?: () => void;
}) {
  const [calls, setCalls] = useState(false);
  const [mine, setMine] = useState<TableCall[]>([]);
  const [busy, setBusy] = useState<CallKind | null>(null);
  const [err, setErr] = useState("");
  const [sheet, setSheet] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { void placeService(placeId).then((s) => setCalls(s.calls)); }, [placeId]);
  const refresh = useCallback(() => myCalls(placeId).then(setMine), [placeId]);
  useEffect(() => { void refresh(); }, [refresh]);
  // While something is waiting, check every few seconds whether the shop has seen it.
  const waiting = mine.some((c) => !c.done_at);
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") void refresh(); }, 6000);
    return () => window.clearInterval(t);
  }, [waiting, refresh]);

  async function send(kind: CallKind, message?: string): Promise<boolean> {
    setBusy(kind); setErr("");
    try {
      if (!(await ensureVisit())) return false;
      const c = await sendCall(placeId, kind, message);
      playHapticTap(900);
      setMine((m) => [c, ...m.filter((x) => x.id !== c.id)]);
      setNow(Date.now());
      return true;
    } catch (e) {
      setErr(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const open = (k: CallKind) => mine.find((c) => c.kind === k && !c.done_at);
  const kinds: CallKind[] = calls ? (food ? ["waiter", "bill", "help"] : ["waiter", "help"]) : ["help"];
  const shown = mine.filter((c) => !c.done_at || now - new Date(c.done_at).getTime() < 10 * 60000).slice(0, 3);

  return (
    <section className="rvx-sec sv" aria-label="Reach the shop">
      <div className="rvx-row"><h3>Need something?</h3></div>
      <div className={`sv-btns n${kinds.length}`}>
        {kinds.map((k) => {
          const c = CALLS[k];
          const o = k === "help" ? undefined : open(k);
          return (
            <button key={k} type="button" className={`sv-btn tone-${c.tone} ${o ? "on" : ""}`} disabled={busy !== null}
              onClick={() => (k === "help" ? onHelp ? onHelp() : setSheet(true) : void send(k))}
              aria-label={o ? `${c.label}: sent. Tap to remind the shop` : c.label}>
              <span className="ic"><Icon name={c.icon} size={24} /></span>
              <b>{busy === k ? "Sending…" : o ? (o.seen_at ? "On the way" : "Called") : c.label}</b>
              {o && <small>{o.seen_at ? "The shop saw it" : `${waited(o.pinged_at, now)} · tap to remind`}</small>}
            </button>
          );
        })}
      </div>
      {err && <p className="notice err" role="alert" style={{ margin: 0 }}>{err}</p>}
      {shown.length > 0 && (
        <ul className="sv-mine" aria-live="polite">
          {shown.map((c) => (
            <li key={c.id} className={c.done_at ? "done" : c.seen_at ? "seen" : ""}>
              <Icon name={c.done_at ? "checkCircle" : c.seen_at ? "check" : "clock"} size={16} />
              <span className="grow">
                <b>{c.kind === "help" ? `“${c.message}”` : CALLS[c.kind].label}</b>
                <small>{c.done_at ? "Sorted by the shop" : c.seen_at ? `${shop} is on it` : `Sent ${waited(c.created_at, now)}${c.created_at === c.pinged_at ? "" : " · reminded"}`}</small>
              </span>
              {!c.seen_at && !c.done_at && <button type="button" className="sv-x" onClick={() => { void cancelCall(c.id).then(refresh); }}>Cancel</button>}
            </li>
          ))}
        </ul>
      )}
      {sheet && <HelpSheet shop={shop} table={table} food={food} busy={busy === "help"} err={err}
        onClose={() => { setSheet(false); setErr(""); }}
        onSend={async (msg) => { if (await send("help", msg)) setSheet(false); }} />}
    </section>
  );
}

function HelpSheet({ shop, table, food, busy, err, onClose, onSend }: {
  shop: string; table: string | null; food: boolean; busy: boolean; err: string;
  onClose: () => void; onSend: (msg: string) => void;
}) {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const chips = food ? FOOD_CHIPS : OTHER_CHIPS;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet stack sv-sheet" style={{ gap: 14 }} role="dialog" aria-modal="true" aria-label={`Tell ${shop} now`}
        onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (msg.trim()) onSend(msg.trim()); }}>
        <div className="sv-head">
          <span className="ic tone-coral"><Icon name="message" size={22} /></span>
          <span className="grow"><b>Tell {shop} now</b><small>The staff see it straight away{table ? `, with ${table}` : ""}, so they can sort it while you're here.</small></span>
        </div>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {chips.map((c) => <button key={c} type="button" className={`chip ${msg === c ? "on" : ""}`} onClick={() => setMsg(c)}>{c}</button>)}
        </div>
        <textarea className="textarea" rows={3} maxLength={280} placeholder="Or write it here" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Your message" />
        <p className="tiny muted sv-priv"><Icon name="eyeOff" size={14} />Only the shop sees this, without your name. It isn't public and isn't part of any review.</p>
        {err && <p className="notice err" role="alert" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn block" disabled={busy || !msg.trim()}><Icon name="send" size={18} />{busy ? "Sending…" : "Send to the shop"}</button>
        <button type="button" className="btn block ghost" onClick={onClose}>Close</button>
      </form>
    </div>,
    document.body,
  );
}
