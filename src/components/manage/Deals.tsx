import { useEffect, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { currencySymbol } from "../../lib/money";
import { KINDS, dateText, dealWhen, useNow, type Deal, type DealKind } from "../../lib/treats";
import { DealTicket } from "../treats/Tickets";
import { Icon, useConfirm, useToast } from "../ui";
import { BIZ, type Biz } from "../../lib/modes";
import "../../styles/treats.css";

interface Row extends Omit<Deal, "on_now" | "ends_ts" | "used_at" | "place_id"> { valid_from: string; active: boolean; uses_7d: number; uses_total: number }
interface Card { goal: number; reward: string; active: boolean; collectors: number; rewards_used: number }
interface Form { id: string | null; kind: DealKind; amount: string; title: string; terms: string; days: number[]; hours: boolean; starts: string; ends: string; until: string; once: boolean }

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ALL = [0, 1, 2, 3, 4, 5, 6];
const BLANK: Form = { id: null, kind: "percent", amount: "20", title: "", terms: "", days: ALL, hours: false, starts: "16:00", ends: "19:00", until: "", once: false };

function friendly(e: unknown): string {
  const t = errorText(e);
  if (/reviews or ratings/i.test(t)) return "Deals can't mention reviews or ratings. Google removes rewarded reviews.";
  if (/6 deals/i.test(t)) return "You can have 6 deals on at once. Turn one off first.";
  if (/PGRST202|could not find the function/i.test(t)) return "Deals need the latest database update (run-now-50.sql).";
  return t;
}

/**
 * Deals everyone sees as tickets on the shop page, and the stamp card that fills itself from table scans.
 * The preview is the real ticket, so what the owner sees is what customers get.
 */
export function Deals({ placeId, currency, live, biz = BIZ.other }: { placeId: string; currency?: string | null; live: boolean; biz?: Biz }) {
  // Examples and the timed deal's name fit the business type (no pizza examples for a salon).
  const HINT: Record<DealKind, string> = biz.dealHints;
  const kindLabel = (k: DealKind) => (k === "happy_hour" ? biz.timedDeal : KINDS[k].label);
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(1000);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [f, setF] = useState<Form | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState(6);
  const [reward, setReward] = useState("");
  const [cardErr, setCardErr] = useState("");
  const [n, setN] = useState(0);

  useEffect(() => {
    let alive = true;
    supabase.rpc("shop_deals_list", { p_place: placeId }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(friendly(error)); setRows([]); return; }
      setRows((data as Row[]) || []);
    }, () => alive && setRows([]));
    supabase.rpc("shop_stamp_card", { p_place: placeId }).then(({ data, error }) => {
      if (!alive) return;
      const c = error ? null : (data as Card | null);
      setCard(c);
      if (c) { setGoal(c.goal); setReward(c.reward); }
    }, () => alive && setCard(null));
    return () => { alive = false; };
  }, [placeId, n]);

  const set = (p: Partial<Form>) => { setF((x) => x && { ...x, ...p }); setErr(""); };
  const edit = (r: Row) => setF({
    id: r.id, kind: r.kind, amount: r.amount != null ? String(r.amount) : "", title: r.title, terms: r.terms || "",
    days: r.days?.length ? r.days : ALL, hours: Boolean(r.starts_at), starts: r.starts_at || "16:00", ends: r.ends_at || "19:00",
    until: r.valid_until || "", once: r.per_person === "once",
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    const amount = Number(f.amount);
    if ((f.kind === "percent" && !(amount >= 1 && amount <= 90)) || (f.kind === "flat" && !(amount > 0))) {
      setErr(f.kind === "percent" ? "Pick a discount from 1 to 90%." : "Enter how much off."); return;
    }
    if (!f.days.length) { setErr("Pick at least one day."); return; }
    if (f.hours && f.starts === f.ends) { setErr("The start and end times are the same."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("save_shop_deal", {
      p_place: placeId, p_id: f.id, p_kind: f.kind, p_title: f.title.trim(),
      p_amount: f.kind === "percent" || f.kind === "flat" ? amount : null, p_terms: f.terms.trim() || null,
      p_days: f.days.length === 7 ? null : f.days, p_starts: f.hours ? f.starts : null, p_ends: f.hours ? f.ends : null,
      p_valid_until: f.until || null, p_per_person: f.once ? "once" : "daily", p_active: true,
    });
    setBusy(false);
    if (error) { setErr(friendly(error)); return; }
    toast(f.id ? "Deal updated" : "Deal is live on your page");
    setF(null); setN((x) => x + 1);
  }

  async function toggle(r: Row) {
    const { error } = await supabase.rpc("save_shop_deal", {
      p_place: placeId, p_id: r.id, p_kind: r.kind, p_title: r.title, p_amount: r.amount, p_terms: r.terms, p_days: r.days,
      p_starts: r.starts_at, p_ends: r.ends_at, p_valid_until: r.valid_until, p_per_person: r.per_person, p_active: !r.active,
    });
    if (error) { toast(friendly(error)); return; }
    setN((x) => x + 1);
  }
  async function remove(r: Row) {
    const ok = await confirm({ title: "Delete this deal?", body: "It disappears from your page and from customers' pockets.", ok: "Delete", danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc("delete_shop_deal", { p_id: r.id });
    if (error) { toast(friendly(error)); return; }
    setN((x) => x + 1);
  }

  async function saveCard(active: boolean) {
    if (!reward.trim()) { setCardErr(`Write the reward, like “${biz.stampReward}”.`); return; }
    setCardErr("");
    const { data, error } = await supabase.rpc("save_stamp_card", { p_place: placeId, p_goal: goal, p_reward: reward.trim(), p_active: active });
    if (error) { setCardErr(friendly(error)); return; }
    setCard(data as Card);
    toast(active ? "Stamp card is on" : "Stamp card is off");
  }

  const preview: Deal | null = f && {
    id: "preview", place_id: placeId, kind: f.kind, amount: Number(f.amount) || null, title: f.title.trim() || HINT[f.kind], terms: f.terms || null,
    days: f.days.length === 7 ? null : f.days, starts_at: f.hours ? f.starts : null, ends_at: f.hours ? f.ends : null,
    valid_until: f.until || null, per_person: f.once ? "once" : "daily", on_now: true, ends_ts: null, used_at: null,
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="mg-section">
        <div className="mg-section-head"><span className="icon-chip sm coral"><Icon name="ticket" size={16} /></span><span className="grow">Deals for everyone</span>
          {rows && <span className="badge gray">{rows.filter((r) => r.active).length} on</span>}</div>
        <p className="small muted" style={{ margin: 0 }}>Deals show as tickets at the top of your page and in the pockets of people who visited or saved you. They show one at your counter and your staff press and hold to use it.</p>

        {rows === null ? <div className="skeleton" style={{ height: 72 }} /> : rows.map((r) => (
          <div key={r.id} className="up-item" style={{ opacity: r.active ? 1 : 0.6 }}>
            <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
              <span className={`icon-chip sm`} style={{ background: "var(--fill)" }}><Icon name={(KINDS[r.kind] ?? KINDS.other).icon} size={16} /></span>
              <span className="grow stack tight" style={{ minWidth: 0 }}>
                <b className="small">{r.kind === "percent" ? `${Math.round(Number(r.amount))}% off` : r.kind === "flat" ? `${currencySymbol(currency)}${Number(r.amount)} off` : kindLabel(r.kind)} · {r.title}</b>
                <span className="tiny muted">{dealWhen(r)}{r.valid_until ? ` · till ${dateText(r.valid_until)}` : ""}{r.per_person === "once" ? " · once per person" : ""}</span>
                <span className="tiny muted row" style={{ gap: 4 }}><Icon name="check" size={12} />Used {r.uses_7d} this week · {r.uses_total} in all</span>
              </span>
              <label className="switch-row" aria-label={r.active ? "Turn off" : "Turn on"}><input type="checkbox" role="switch" checked={r.active} onChange={() => void toggle(r)} /></label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="link-btn small" onClick={() => edit(r)}><Icon name="edit" size={14} />Edit</button>
              <button type="button" className="link-btn small" style={{ color: "var(--muted)" }} onClick={() => void remove(r)}><Icon name="trash" size={14} />Delete</button>
            </div>
          </div>
        ))}
        {!f && <button type="button" className="btn block" onClick={() => setF({ ...BLANK })}><Icon name="plus" size={18} />New deal</button>}
      </section>

      {f && preview && (
        <form className="mg-section" onSubmit={save}>
          <div className="mg-section-head"><span className="icon-chip sm coral"><Icon name={f.id ? "edit" : "plus"} size={16} /></span><span className="grow">{f.id ? "Change deal" : "New deal"}</span>
            <button type="button" className="mg-act" aria-label="Cancel" onClick={() => setF(null)}><Icon name="close" size={16} /></button></div>

          <div className="field">
            <span className="mg-label"><Icon name="tag" size={15} />Kind</span>
            <div className="chips" role="radiogroup" aria-label="Kind of deal">
              {(Object.keys(KINDS) as DealKind[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={`chip ${f.kind === k ? "on" : ""}`} onClick={() => set({ kind: k, amount: k === "percent" ? "20" : k === "flat" ? "100" : f.amount })}>
                  <Icon name={KINDS[k].icon} size={14} />{kindLabel(k)}
                </button>
              ))}
            </div>
          </div>
          {(f.kind === "percent" || f.kind === "flat") && (
            <div className="field"><label className="mg-label" htmlFor="dl-amt"><Icon name={f.kind === "percent" ? "tag" : "banknote"} size={15} />{f.kind === "percent" ? "How much off (%)" : `How much off (${currencySymbol(currency)})`}</label>
              <input id="dl-amt" className="input" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })} /></div>
          )}
          <div className="field"><label className="mg-label" htmlFor="dl-title"><Icon name="edit" size={15} />{f.kind === "other" ? "The deal, in a few words" : f.kind === "free" ? "What's free" : "On what"}</label>
            <input id="dl-title" className="input" required maxLength={60} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={HINT[f.kind]} /></div>

          <div className="field">
            <span className="mg-label"><Icon name="clock" size={15} />Days</span>
            <div className="chips" role="group" aria-label="Days">
              {DAYS.map((d, i) => {
                const on = f.days.includes(i);
                return <button key={i} type="button" aria-pressed={on} aria-label={DAY_NAMES[i]} className={`chip ${on ? "on" : ""}`} style={{ minWidth: 44, justifyContent: "center" }}
                  onClick={() => set({ days: on ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })}>{d}</button>;
              })}
            </div>
          </div>
          <label className="switch-row"><input type="checkbox" role="switch" checked={f.hours} onChange={(e) => set({ hours: e.target.checked })} /><span>Only certain hours{f.kind === "happy_hour" ? ` (good for ${biz.timedDeal.toLowerCase()})` : ""}</span></label>
          {f.hours && (
            <div className="row" style={{ gap: 10 }}>
              <div className="field grow"><label className="mg-label" htmlFor="dl-s">From</label><input id="dl-s" className="input" type="time" value={f.starts} onChange={(e) => set({ starts: e.target.value })} /></div>
              <div className="field grow"><label className="mg-label" htmlFor="dl-e">To</label><input id="dl-e" className="input" type="time" value={f.ends} onChange={(e) => set({ ends: e.target.value })} /></div>
            </div>
          )}
          <div className="field"><label className="mg-label" htmlFor="dl-until"><Icon name="clock" size={15} />Ends on (optional)</label>
            <input id="dl-until" className="input" type="date" value={f.until} onChange={(e) => set({ until: e.target.value })} /></div>
          <label className="switch-row"><input type="checkbox" role="switch" checked={f.once} onChange={(e) => set({ once: e.target.checked })} /><span>Once per person (otherwise once a day)</span></label>
          <div className="field"><label className="mg-label" htmlFor="dl-terms"><Icon name="info" size={15} />Small print (optional)</label>
            <input id="dl-terms" className="input" maxLength={200} value={f.terms} onChange={(e) => set({ terms: e.target.value })} placeholder="Dine-in only. Not with other offers." /></div>

          <div className="stack tight" aria-label="Preview">
            <span className="tiny muted strong row" style={{ gap: 4 }}><Icon name="eye" size={13} />What customers see</span>
            <div style={{ pointerEvents: "none" }}><DealTicket deal={preview} currency={currency} now={now} onOpen={() => {}} /></div>
          </div>
          <p className="tiny muted row" style={{ gap: 6 }}><Icon name="alert" size={13} />Never offer anything for a review or rating. Google removes rewarded reviews.</p>
          {!live && <div className="notice warn small">Your listing isn't live, so customers won't see this yet.</div>}
          {err && <div className="notice err small row" style={{ gap: 8 }}><Icon name="alert" size={16} /><span className="grow">{err}</span></div>}
          <button className="btn green block" disabled={busy || !f.title.trim()}><Icon name="check" size={18} />{busy ? "Saving…" : f.id ? "Save changes" : "Put it on my page"}</button>
        </form>
      )}

      <section className="mg-section">
        <div className="mg-section-head"><span className="icon-chip sm amber"><Icon name="award" size={16} /></span><span className="grow">Stamp card</span>
          {card && <span className={`badge ${card.active ? "" : "gray"}`}>{card.active ? "On" : "Off"}</span>}</div>
        <p className="small muted" style={{ margin: 0 }}>Every day someone scans your QR code, they get a stamp by themselves. When the card is full, they show the reward at your counter. Stamps count visits only, never reviews.</p>
        {card === undefined ? <div className="skeleton" style={{ height: 72 }} /> : (
          <>
            <div className="field">
              <span className="mg-label" id="st-goal"><Icon name="checkCircle" size={15} />Visits for the reward</span>
              <div className="row" style={{ gap: 12 }} role="group" aria-labelledby="st-goal">
                <button type="button" className="mg-act" aria-label="Fewer visits" disabled={goal <= 3} onClick={() => setGoal((g) => g - 1)}><Icon name="minus" size={16} /></button>
                <b style={{ fontSize: 22, minWidth: 28, textAlign: "center" }} aria-live="polite">{goal}</b>
                <button type="button" className="mg-act" aria-label="More visits" disabled={goal >= 12} onClick={() => setGoal((g) => g + 1)}><Icon name="plus" size={16} /></button>
              </div>
            </div>
            <div className="field"><label className="mg-label" htmlFor="st-rw"><Icon name="gift" size={15} />The reward</label>
              <input id="st-rw" className="input" maxLength={60} value={reward} onChange={(e) => { setReward(e.target.value); setCardErr(""); }} placeholder={biz.stampReward} /></div>
            {card && <span className="tiny muted row" style={{ gap: 6 }}><Icon name="people" size={13} />{card.collectors} collecting · {card.rewards_used} rewards given</span>}
            {cardErr && <div className="notice err small row" style={{ gap: 8 }}><Icon name="alert" size={16} /><span className="grow">{cardErr}</span></div>}
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn green grow" onClick={() => void saveCard(true)}><Icon name="check" size={18} />{card?.active ? "Save" : "Turn on stamp card"}</button>
              {card?.active && <button type="button" className="btn ghost" onClick={() => void saveCard(false)}>Turn off</button>}
            </div>
            {card && !card.active && <p className="tiny muted" style={{ margin: 0 }}>Turning it back on starts everyone's card fresh.</p>}
          </>
        )}
      </section>
    </div>
  );
}
