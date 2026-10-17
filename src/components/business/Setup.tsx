import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { loadPlans, payForRequest, type PlanRow } from "../../lib/billing";
import { googleConfigured, type GoogleMatch } from "../../lib/google";
import { extractPlaceId, QR_STYLES, rupees } from "../../lib/util";
import type { QrStyle } from "../../lib/types";
import { areaCityFromAddress, GoogleFind, GooglePreview, matchCategory } from "../manage/Google";
import { Icon, QrImage, useToast } from "../ui";

const EMPTY = { business_name: "", category: "", area: "", city: "", phone: "", google_place_id: "", note: "" };
const TABLE_CHOICES = [1, 3, 5, 10, 15, 25];
type Interval = "year" | "month";

/**
 * Setting up a business, one question per slide: the shop, how to reach you, how many tables
 * need a QR, which plan, and last of all the payment.
 */
export function Setup({ onSent }: { onSent: () => void }) {
  const { session } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [picked, setPicked] = useState<GoogleMatch | null>(null);
  const [tables, setTables] = useState(5);
  const [style, setStyle] = useState<QrStyle>("paper");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plan, setPlan] = useState("");
  const [interval, setInterval] = useState<Interval>("year");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<null | "paid" | "review" | "unpaid">(null);

  useEffect(() => { loadPlans().then(setPlans); }, []);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The smallest plan that covers the tables is pre-selected; the free trial covers one QR.
  const fits = (p: PlanRow) => p.qr_limit >= tables;
  const suggested = useMemo(() => plans.filter((p) => p.code !== "trial" && fits(p)).sort((a, b) => a.qr_limit - b.qr_limit)[0]?.code ?? "", [plans, tables]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cur = plans.find((p) => p.code === plan);
    if (!cur || !fits(cur)) setPlan(suggested || (tables <= 1 ? "trial" : ""));
  }, [suggested, plans, tables]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = plans.find((p) => p.code === plan);
  const price = !chosen || chosen.code === "trial" ? 0 : (interval === "year" ? chosen.price_inr_year : chosen.price_inr_month) ?? 0;

  function fromGoogle(m: GoogleMatch) {
    const { area, city } = areaCityFromAddress(m.address);
    setPicked(m);
    setForm((f) => ({ ...f, business_name: m.name || f.business_name, category: matchCategory(m) || f.category, area: area || f.area, city: city || f.city, google_place_id: m.id }));
  }
  const clearGoogle = () => { setPicked(null); setForm((f) => ({ ...f, google_place_id: "" })); };

  function next() {
    setErr("");
    if (step === 0 && !form.business_name.trim()) { setErr("Add your shop's name."); return; }
    if (step === 1) {
      if (!form.category.trim() || !form.city.trim()) { setErr("Add a category and a city."); return; }
      if (form.phone.replace(/\D/g, "").length < 10) { setErr("Enter a full phone number so we can reach you."); return; }
    }
    if (step === 3 && !chosen) { setErr("Pick a plan."); return; }
    setStep((s) => s + 1);
  }

  async function finish() {
    if (!chosen) return;
    setBusy(true); setErr("");
    try {
      let id = requestId;
      if (!id) {
        const raw = form.google_place_id.trim();
        const placeId = raw ? extractPlaceId(raw) : null;
        const note = [form.note.trim(), raw && !placeId ? `Google Maps link: ${raw}` : ""].filter(Boolean).join("\n");
        const ins = await supabase.from("listing_requests").insert({
          requester_id: session!.user.id, business_name: form.business_name.trim(), category: form.category.trim(),
          area: form.area.trim() || null, city: form.city.trim(), phone: form.phone.trim(), google_place_id: placeId, note: note || null,
          wants_qr: tables > 0, qr_style: tables > 0 ? style : null, tables, plan: chosen.code,
          billing_interval: chosen.code === "trial" ? null : interval,
        }).select("id").single();
        if (ins.error) throw ins.error;
        id = (ins.data as { id: string }).id;
        setRequestId(id);
      }
      if (price <= 0) { setOutcome("review"); onSent(); return; }
      const paid = await payForRequest(id, form.business_name.trim());
      setOutcome(paid ? "paid" : "unpaid");
      onSent();
    } catch (e) {
      setErr(errorText(e));
      if (requestId) toast("Your request is saved. You can pay from Your requests.");
    }
    setBusy(false);
  }

  if (outcome) {
    const paid = outcome === "paid";
    return (
      <div className="card rv-gate center cl-slide">
        <span className={`icon-chip lg ${outcome === "unpaid" ? "amber" : ""}`} style={{ margin: "0 auto" }}><Icon name={outcome === "unpaid" ? "wallet" : "check"} size={26} /></span>
        <h2>{paid ? "Paid. You're all set" : outcome === "review" ? "Request sent" : "Request saved"}</h2>
        <p className="small muted">{outcome === "unpaid"
          ? "Your payment wasn't completed. Pay from Your requests above whenever you're ready."
          : "We'll check your details and switch on your page, usually within a day. You'll see it under Your requests."}</p>
        <button className="btn ghost block" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><Icon name="ticket" size={18} />See Your requests</button>
      </div>
    );
  }

  const slides: React.ReactNode[] = [
    <>
      <span className="icon-chip lg" style={{ margin: "0 auto" }}><Icon name="store" size={26} /></span>
      <h2>What's your shop called?</h2>
      {googleConfigured && (picked ? (
        <div className="stack" style={{ gap: 6, textAlign: "left" }}>
          <GooglePreview id={picked.id} mini />
          <span className="row tiny" style={{ gap: 6 }}><Icon name="spark" size={13} color="var(--green)" /><span className="grow muted">Filled in from Google. Edit anything.</span>
            <button type="button" className="link-btn tiny" onClick={clearGoogle}>Change</button></span>
        </div>
      ) : (
        <div className="stack" style={{ textAlign: "left" }}>
          <span className="tiny muted">Paste your Google Maps link or type the name and we fill in the rest.</span>
          <GoogleFind onPick={fromGoogle} />
          <span className="biz-or">or type it yourself</span>
        </div>
      ))}
      <div className="field" style={{ textAlign: "left" }}>
        <label className="mg-label" htmlFor="bn"><Icon name="store" size={15} />Business name</label>
        <input id="bn" className="input" value={form.business_name} onChange={set("business_name")} placeholder="Forno Napoli" />
      </div>
    </>,
    <>
      <span className="icon-chip lg sky" style={{ margin: "0 auto" }}><Icon name="phone" size={26} /></span>
      <h2>Where are you, and how do we reach you?</h2>
      <div className="stack" style={{ textAlign: "left" }}>
        <div className="field"><label className="mg-label" htmlFor="cat"><Icon name="tag" size={15} />Category</label><input id="cat" className="input" value={form.category} onChange={set("category")} placeholder="Pizzeria, Salon…" /></div>
        <div className="field"><label className="mg-label" htmlFor="ph"><Icon name="phone" size={15} />Phone</label><input id="ph" className="input" type="tel" value={form.phone} onChange={set("phone")} placeholder="98xxxxxxxx" /></div>
        <div className="grid2">
          <div className="field"><label className="mg-label" htmlFor="ar"><Icon name="pin" size={15} />Area</label><input id="ar" className="input" value={form.area} onChange={set("area")} placeholder="Koregaon Park" /></div>
          <div className="field"><label className="mg-label" htmlFor="ct"><Icon name="map" size={15} />City</label><input id="ct" className="input" value={form.city} onChange={set("city")} placeholder="Pune" /></div>
        </div>
      </div>
    </>,
    <>
      <span className="icon-chip lg amber" style={{ margin: "0 auto" }}><Icon name="qr" size={26} /></span>
      <h2>How many tables or counters need a QR?</h2>
      <p className="small muted">Customers scan it to review. You can add more later.</p>
      <div className="row wrap" style={{ gap: 8, justifyContent: "center" }}>
        {TABLE_CHOICES.map((n) => <button key={n} type="button" className={`chip ${tables === n ? "on" : ""}`} aria-pressed={tables === n} onClick={() => setTables(n)}>{n}</button>)}
      </div>
      <div className="row" style={{ justifyContent: "center", gap: 14 }}>
        <button type="button" className="icon-btn" aria-label="Fewer" onClick={() => setTables((n) => Math.max(1, n - 1))}><Icon name="minus" /></button>
        <strong style={{ fontSize: 28, minWidth: 48 }}>{tables}</strong>
        <button type="button" className="icon-btn" aria-label="More" onClick={() => setTables((n) => Math.min(40, n + 1))}><Icon name="plus" /></button>
      </div>
      <div className="stack" style={{ textAlign: "left" }}>
        <span className="mg-label"><Icon name="spark" size={15} />QR style</span>
        <div className="biz-styles" role="radiogroup" aria-label="QR style">
          {(Object.keys(QR_STYLES) as QrStyle[]).map((k) => {
            const st = QR_STYLES[k];
            return (
              <button type="button" key={k} role="radio" aria-checked={style === k} onClick={() => setStyle(k)} className={`biz-style ${style === k ? "on" : ""}`}
                style={{ background: st.light, color: st.light === "#FFFFFF" ? "var(--ink)" : "#fff" }}>
                {style === k && <span className="tick"><Icon name="check" size={14} /></span>}
                <QrImage text={`${window.location.origin}/q/preview`} size={72} dark={st.dark} light={st.light} />
                <span className="small strong">{st.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>,
    <>
      <span className="icon-chip lg violet" style={{ margin: "0 auto" }}><Icon name="crown" size={26} /></span>
      <h2>Pick a plan</h2>
      <p className="small muted">Your page is free. A plan switches on {tables} review QR{tables === 1 ? "" : "s"}.</p>
      <div className="pn-seg" role="tablist" aria-label="Pay for">
        {(["year", "month"] as const).map((i) => (
          <button key={i} type="button" role="tab" aria-selected={interval === i} className={interval === i ? "on" : ""} onClick={() => setInterval(i)}>{i === "year" ? "Yearly (2 months free)" : "Monthly"}</button>
        ))}
      </div>
      <div className="stack" style={{ textAlign: "left" }}>
        {plans.map((p) => {
          const ok = fits(p);
          const amt = p.code === "trial" ? 0 : (interval === "year" ? p.price_inr_year : p.price_inr_month) ?? 0;
          return (
            <button key={p.code} type="button" disabled={!ok} aria-pressed={plan === p.code} onClick={() => setPlan(p.code)}
              className={`card pn-plan pn-pick ${plan === p.code ? "on" : ""}`}>
              <span className="row" style={{ gap: 8 }}>
                <strong className="grow">{p.name}{p.code === suggested && <span className="badge" style={{ marginLeft: 8 }}>Best fit</span>}</strong>
                <span className="pn-price">{amt ? rupees(amt) : "Free"}{amt ? <span className="tiny muted">/{interval === "year" ? "yr" : "mo"}</span> : null}</span>
              </span>
              <span className="tiny muted">{ok ? p.features.join(" · ") : `Covers ${p.qr_limit} QR${p.qr_limit === 1 ? "" : "s"}. You chose ${tables}.`}</span>
            </button>
          );
        })}
      </div>
    </>,
    <>
      <span className="icon-chip lg" style={{ margin: "0 auto" }}><Icon name="wallet" size={26} /></span>
      <h2>{price > 0 ? "Review and pay" : "Review and send"}</h2>
      <div className="stack small" style={{ textAlign: "left", gap: 8 }}>
        <span className="row"><Icon name="store" size={16} /><span className="grow"><b>{form.business_name}</b><br /><span className="muted">{[form.category, form.area, form.city].filter(Boolean).join(" · ")}</span></span></span>
        <span className="row"><Icon name="qr" size={16} /><span className="grow">{tables} table QR{tables === 1 ? "" : "s"}, {QR_STYLES[style].label} style</span></span>
        <span className="row"><Icon name="crown" size={16} /><span className="grow">{chosen?.name}{price > 0 ? `, ${interval === "year" ? "1 year" : "1 month"}` : ", 30 days or 25 reviews"}</span><b>{price > 0 ? rupees(price) : "Free"}</b></span>
      </div>
      <div className="field" style={{ textAlign: "left" }}>
        <label className="mg-label" htmlFor="nt"><Icon name="message" size={15} />Anything else <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label>
        <textarea id="nt" className="textarea" style={{ minHeight: 60 }} value={form.note} onChange={set("note")} placeholder="Best time to call…" />
      </div>
      {err && <div className="notice err">{err}</div>}
      <button className="btn green block" disabled={busy} onClick={finish}>
        <Icon name={price > 0 ? "wallet" : "send"} size={18} />{busy ? "One moment…" : price > 0 ? `Pay ${rupees(price)} with Razorpay` : "Send for review"}
      </button>
      <p className="tiny muted center row" style={{ justifyContent: "center", gap: 6 }}><Icon name="shield" size={14} />
        {price > 0 ? <>One payment, no auto-renew. <Link to="/refunds">Refunds</Link></> : "No payment now. Pick a plan any time."}</p>
    </>,
  ];

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="cl-dots" aria-label={`Step ${step + 1} of ${slides.length}`}>{slides.map((_, i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
      <div className="card rv-gate center cl-slide" key={step}>
        {slides[step]}
        {err && step < 4 && <div className="notice err">{err}</div>}
        {step < 4 && <button className="btn green block" onClick={next}>Next<Icon name="chev" size={18} /></button>}
      </div>
      {step > 0 && !busy && <button className="btn quiet" onClick={() => { setErr(""); setStep((s) => s - 1); }}><Icon name="back" size={16} />Back</button>}
    </div>
  );
}
