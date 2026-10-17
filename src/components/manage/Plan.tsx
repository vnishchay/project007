import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import { loadPlans, payForPlan, type MyPlan, type PlanRow } from "../../lib/billing";
import { Icon, Spinner, useToast } from "../ui";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** The shop's plan: QRs used, whether reviews are on, when it ends, and paying for more. */
export function Plan({ placeId, placeName }: { placeId: string; placeName: string }) {
  const toast = useToast();
  const [me, setMe] = useState<MyPlan | null | undefined>(undefined);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [interval, setInterval] = useState<"year" | "month">("year");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([supabase.rpc("my_plan", { p_place: placeId }), loadPlans()]);
    setMe(r.error ? null : ((r.data as MyPlan[] | null)?.[0] ?? null));
    setPlans(p.filter((x) => x.code !== "trial"));
  }, [placeId]);
  useEffect(() => { load(); }, [load]);

  async function buy(code: string) {
    setBusy(code);
    try {
      if (await payForPlan(placeId, placeName, code, interval)) { toast("Paid. Your plan is on."); await load(); }
    } catch (e) { toast(errorText(e)); }
    setBusy("");
  }

  if (me === undefined) return <Spinner />;
  if (me === null) return <div className="card small muted">Plans will show here once the latest database update is run.</div>;

  const trial = me.status === "trial";
  const daysLeft = Math.max(0, Math.ceil((new Date(me.period_end).getTime() - Date.now()) / 86400000));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card stack pn-now" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 10 }}>
          <span className={`icon-chip ${me.reviews_open ? "" : "coral"}`}><Icon name={trial ? "zap" : "crown"} size={20} /></span>
          <div className="grow stack" style={{ gap: 2 }}>
            <strong>{me.plan_name}</strong>
            <span className="tiny muted">{me.reviews_open
              ? trial ? `${daysLeft} days or ${me.trial_reviews_left} reviews left` : `Paid until ${day(me.period_end)}`
              : "Reviews are paused. Your page and QRs still work."}</span>
          </div>
          <span className={`badge ${me.reviews_open ? "" : "warn"}`}><Icon name={me.reviews_open ? "check" : "clock"} size={12} />{me.reviews_open ? "Reviews on" : "Paused"}</span>
        </div>
        <div className="plan-bar" aria-label={`${me.qr_used} of ${me.qr_limit} review QRs used`}>
          <span style={{ width: `${Math.min(100, (me.qr_used / Math.max(1, me.qr_limit)) * 100)}%` }} />
        </div>
        <span className="tiny muted row" style={{ gap: 4 }}><Icon name="qr" size={12} />{me.qr_used} of {me.qr_limit} review QRs in use</span>
      </div>

      <div className="pn-seg" role="tablist" aria-label="Pay for">
        {(["year", "month"] as const).map((i) => (
          <button key={i} role="tab" aria-selected={interval === i} className={interval === i ? "on" : ""} onClick={() => setInterval(i)}>
            {i === "year" ? "Yearly (2 months free)" : "Monthly"}
          </button>
        ))}
      </div>

      {plans.map((p) => {
        const price = interval === "year" ? p.price_inr_year : p.price_inr_month;
        const current = !trial && me.plan === p.code && me.status !== "expired";
        return (
          <div key={p.code} className={`card pn-plan ${current ? "on" : ""}`}>
            <div className="row" style={{ gap: 8 }}>
              <strong className="grow">{p.name}</strong>
              {price ? <span className="pn-price">{inr(price)}<span className="tiny muted">/{interval === "year" ? "yr" : "mo"}</span></span> : null}
            </div>
            <ul className="pn-feat">{p.features.map((f) => <li key={f}><Icon name="check" size={14} color="var(--green)" />{f}</li>)}</ul>
            <button className={`btn small block ${current ? "ghost" : "green"}`} disabled={!!busy} onClick={() => buy(p.code)}>
              {busy === p.code ? "Opening…" : current ? `Add 1 more ${interval}` : `Get ${p.name}`}
            </button>
          </div>
        );
      })}
      <p className="tiny muted center">One payment, no auto-renew, nothing to cancel. Time left on your plan carries over. <Link to="/pricing">Pricing and refunds</Link></p>
    </div>
  );
}
