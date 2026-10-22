import { useEffect, useMemo, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { timeAgo } from "../../lib/util";
import { Avatar, Icon } from "../ui";

interface Visitor {
  user_id: string; display_name: string | null; avatar_path: string | null; is_guest: boolean; visits: number;
  last_visit: string; last_table: string | null; at_shop: boolean; can_offer: boolean; last_offer_at: string | null;
}

const DAYS = [7, 30, 90] as const;

function friendlyOfferError(e: unknown): string {
  const t = errorText(e);
  if (/reviews or ratings/i.test(t)) return "Offers can't mention reviews or ratings. Google removes reviews that were rewarded.";
  if (/PGRST202|shop_visitors|send_visitor_offer/i.test(t)) return "This isn't available yet.";
  return t;
}

/**
 * People who scanned this shop's QR codes. The list comes first; picking people shows a sticky
 * "Write offer to N" button that opens the message composer with them already chosen.
 */
export function Visitors({ placeId, picked, setPicked, onWrite, reload = 0 }: {
  placeId: string; picked: Set<string>; setPicked: (f: (p: Set<string>) => Set<string>) => void; onWrite: () => void; reload?: number;
}) {
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [list, setList] = useState<Visitor[] | null>(null);
  const [err, setErr] = useState("");

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
  }, [placeId, days, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const reachable = useMemo(() => (list || []).filter((v) => v.can_offer), [list]);
  const allOn = reachable.length > 0 && reachable.every((v) => picked.has(v.user_id));

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <div className="stack" style={{ gap: 10, paddingBottom: picked.size ? 72 : 0 }}>
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
          <button type="button" className="link-btn small" onClick={() => setPicked(() => (allOn ? new Set() : new Set(reachable.map((v) => v.user_id))))}>
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
                onClick={() => toggle(v.user_id)}>
                <Avatar id={v.user_id} name={name} path={v.avatar_path} size="sm" />
                <span className="grow stack tight" style={{ minWidth: 0 }}>
                  <span className="t ellipsis">{name}{v.at_shop && <span title="Scanned at the shop" style={{ marginLeft: 5, verticalAlign: -2 }}><Icon name="verified" size={14} color="var(--accent)" /></span>}</span>
                  <span className="s ellipsis">{v.can_offer ? sub : v.last_offer_at && Date.now() - new Date(v.last_offer_at).getTime() < 86_400_000 ? `Already got an offer ${timeAgo(v.last_offer_at)}` : "Turned offers off"}</span>
                </span>
                <Icon name={on ? "checkCircle" : "plus"} size={18} color={on ? "var(--accent)" : "var(--muted)"} />
              </button>
            );
          })}
        </div>
      )}
      {picked.size > 0 && (
        <div className="mg-sticky">
          <button type="button" className="btn green block" onClick={onWrite}><Icon name="gift" size={18} />Write offer to {picked.size}</button>
        </div>
      )}
    </div>
  );
}
