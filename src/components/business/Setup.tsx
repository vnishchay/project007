import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { loadPlans, payForRequest, type PlanRow } from "../../lib/billing";
import { googleConfigured, type GoogleMatch } from "../../lib/google";
import { extractPlaceId, googleMapsUrl, QR_STYLES, rupees } from "../../lib/util";
import type { QrStyle } from "../../lib/types";
import { areaCityFromAddress, GoogleFind, GooglePreview, matchCategory } from "../manage/Google";
import { Icon, QrImage, useToast } from "../ui";
import { LinkIcon, guessLinkKind } from "../LinkIcon";
import "../../styles/setup.css";

const EMPTY = { business_name: "", category: "", area: "", city: "", phone: "", google_place_id: "", note: "" };
const TABLE_CHOICES = [1, 3, 5, 10, 15, 25];
type Interval = "year" | "month";
const LAST = 5;
const LINK_FIELDS = [
  { key: "zomato", label: "Zomato", ph: "Paste your Zomato link" },
  { key: "swiggy", label: "Swiggy", ph: "Paste your Swiggy link" },
  { key: "instagram", label: "Instagram", ph: "Paste your Instagram link" },
  { key: "website", label: "Website", ph: "Paste your website" },
] as const;
type LinkKey = (typeof LINK_FIELDS)[number]["key"];

/** A pasted address, with https:// added when it is missing; null when it can't be a web address. */
function cleanUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "";
  const u = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try { const x = new URL(u); return x.hostname.includes(".") ? x.toString() : null; } catch { return null; }
}

/**
 * Setting up a business as a stack of full screens, one question each: the shop, how to reach you,
 * where else you are listed, how many tables need a QR, which plan, and last of all the payment.
 * The step lives in the address (?s=), so the phone's back button goes to the screen before.
 * Every screen flies in from the direction you are travelling.
 */
export function Setup() {
  const { session } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const step = Math.min(LAST, Math.max(0, parseInt(params.get("s") || "0", 10) || 0));
  const lastStep = useRef(step);
  const dir: "fwd" | "back" = step >= lastStep.current ? "fwd" : "back";
  useEffect(() => { lastStep.current = step; }, [step]);
  const [urls, setUrls] = useState<Record<LinkKey, string>>({ zomato: "", swiggy: "", instagram: "", website: "" });
  const [extras, setExtras] = useState<string[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [picked, setPicked] = useState<GoogleMatch | null>(null);
  const [tables, setTables] = useState(5);
  const [style, setStyle] = useState<QrStyle>("paper");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plan, setPlan] = useState("");
  const [manual, setManual] = useState(false);
  const [interval, setInterval] = useState<Interval>("year");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<null | "paid" | "review" | "unpaid">(null);

  useEffect(() => { loadPlans().then(setPlans); }, []);
  // A reload loses what was typed, so start again from the first screen instead of showing an empty one.
  useEffect(() => { if (step > 0 && !form.business_name.trim() && !outcome) setParams({}, { replace: true }); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The smallest plan that covers the tables is pre-selected; the free trial covers one QR.
  const fits = (p: PlanRow) => p.qr_limit >= tables;
  const suggested = useMemo(() => (tables <= 1 && plans.some((p) => p.code === "trial") ? "trial" : plans.filter((p) => p.code !== "trial" && fits(p)).sort((a, b) => a.qr_limit - b.qr_limit)[0]?.code ?? ""), [plans, tables]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cur = plans.find((p) => p.code === plan);
    if (!cur || !fits(cur) || !manual) setPlan(suggested);
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
    if (step === 2) {
      for (const f of LINK_FIELDS) if (cleanUrl(urls[f.key]) === null) { setErr(`Check the ${f.label} link.`); return; }
      if (extras.some((x) => cleanUrl(x) === null)) { setErr("Check the extra link."); return; }
    }
    if (step === 4 && !chosen) { setErr("Pick a plan."); return; }
    go(1);
  }
  function go(d: 1 | -1) {
    setErr("");
    if (d === -1) { nav(-1); return; }
    setParams({ s: String(step + 1) });
    window.scrollTo({ top: 0 });
  }

  /** What goes on the shop page: Google Maps first, then whatever was pasted. */
  function buildLinks() {
    const out: { kind: string; url: string }[] = [];
    const gid = extractPlaceId(form.google_place_id.trim());
    if (gid) out.push({ kind: "maps", url: googleMapsUrl(gid, form.business_name) });
    for (const f of LINK_FIELDS) { const u = cleanUrl(urls[f.key]); if (u) out.push({ kind: f.key === "website" ? "website" : f.key, url: u }); }
    for (const x of extras) { const u = cleanUrl(x); if (u) out.push({ kind: guessLinkKind(u), url: u }); }
    return out;
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
          wants_qr: tables > 0, qr_style: tables > 0 ? style : null, tables, plan: chosen.code, links: buildLinks(),
          billing_interval: chosen.code === "trial" ? null : interval,
        }).select("id").single();
        if (ins.error) throw ins.error;
        id = (ins.data as { id: string }).id;
        setRequestId(id);
      }
      if (price <= 0) { setOutcome("review"); return; }
      const paid = await payForRequest(id, form.business_name.trim());
      setOutcome(paid ? "paid" : "unpaid");
    } catch (e) {
      setErr(errorText(e));
      if (requestId) toast("Your request is saved. You can pay from Your requests.");
    }
    setBusy(false);
  }

  if (outcome) {
    const paid = outcome === "paid";
    return (
      <div className="su-screen">
        <main className="su-body su-card su-done" data-dir="fwd" data-step="7">
          {outcome !== "unpaid" && Array.from({ length: 14 }, (_, i) => <i key={i} className="su-cf" style={{ left: `${6 + i * 6.5}%`, animationDelay: `${(i * 0.23) % 1.6}s`, background: ["#c9604a", "#d9a441", "#c2492b", "#6d5fb0", "#4a78b8", "#2f7d6e"][i % 6] }} />)}
          <span className={`icon-chip lg ${outcome === "unpaid" ? "amber" : ""}`} style={{ margin: "0 auto" }}><Icon name={outcome === "unpaid" ? "wallet" : "check"} size={26} /></span>
          <h2>{paid ? "Paid. You're all set" : outcome === "review" ? "Request sent" : "Request saved"}</h2>
          <p className="small muted">{outcome === "unpaid"
            ? "Your payment wasn't completed. Pay from Your requests whenever you're ready."
            : "We'll check your details and switch on your page, usually within a day. You'll see it under Your requests."}</p>
        </main>
        <footer className="su-foot"><button className="btn green block" onClick={() => nav("/business", { replace: true })}><Icon name="ticket" size={18} />See Your requests</button></footer>
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
      <span className="icon-chip lg violet" style={{ margin: "0 auto" }}><Icon name="link" size={26} /></span>
      <h2>Where else are you listed?</h2>
      <p className="small muted">Paste what you have and skip the rest. Customers get one button for each, and you can add more later.</p>
      <div className="stack" style={{ textAlign: "left", gap: 10 }}>
        {extractPlaceId(form.google_place_id.trim()) ? (
          <div className="su-link on"><LinkIcon kind="maps" size={40} /><span className="grow"><b className="tiny muted">Google Maps</b><br /><span className="strong small">{form.business_name || "Found on Google"}</span></span><span className="su-found"><Icon name="check" size={16} width={3} /></span></div>
        ) : (
          <label className="su-link"><LinkIcon kind="maps" size={40} /><span className="grow"><b className="tiny muted">Google Maps</b>
            <input className="su-input" value={form.google_place_id} onChange={set("google_place_id")} placeholder="Paste your Google Maps link" inputMode="url" /></span></label>
        )}
        {LINK_FIELDS.map((f) => (
          <label key={f.key} className={`su-link ${urls[f.key].trim() ? "on" : ""}`}><LinkIcon kind={f.key} size={40} /><span className="grow"><b className="tiny muted">{f.label}</b>
            <input className="su-input" value={urls[f.key]} onChange={(e) => setUrls((u) => ({ ...u, [f.key]: e.target.value }))} placeholder={f.ph} inputMode="url" autoCapitalize="off" /></span></label>
        ))}
        {extras.map((x, i) => (
          <label key={i} className={`su-link ${x.trim() ? "on" : ""}`}><LinkIcon kind={guessLinkKind(x)} size={40} /><span className="grow"><b className="tiny muted">Another link</b>
            <input className="su-input" value={x} onChange={(e) => setExtras((a) => a.map((v, j) => (j === i ? e.target.value : v)))} placeholder="Facebook, YouTube, Justdial…" inputMode="url" autoCapitalize="off" /></span></label>
        ))}
        {extras.length < 3 && <button type="button" className="su-add" onClick={() => setExtras((a) => [...a, ""])}><Icon name="plus" size={16} />Add another link</button>}
      </div>
      <p className="tiny muted su-note"><Icon name="info" size={14} />Your Google rating and reviews show on your page by themselves. Zomato and Swiggy appear as buttons because those sites don't share their reviews.</p>
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
      {plans.length === 0 && <div className="notice row" style={{ textAlign: "left" }}><span className="grow">Loading plans…</span><button type="button" className="link-btn" onClick={() => loadPlans().then(setPlans)}><Icon name="refresh" size={15} />Retry</button></div>}
      <div className="stack" style={{ textAlign: "left" }}>
        {plans.map((p) => {
          const ok = fits(p);
          const amt = p.code === "trial" ? 0 : (interval === "year" ? p.price_inr_year : p.price_inr_month) ?? 0;
          return (
            <button key={p.code} type="button" disabled={!ok} aria-pressed={plan === p.code} onClick={() => { setManual(true); setPlan(p.code); }}
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
      <p className="tiny muted center row" style={{ justifyContent: "center", gap: 6 }}><Icon name="shield" size={14} />
        {price > 0 ? <>One payment, no auto-renew. <Link to="/refunds">Refunds</Link></> : "No payment now. Pick a plan any time."}</p>
    </>,
  ];

  const final = step === LAST;
  return (
    <div className="su-screen">
      <header className="su-top">
        <button type="button" className="icon-btn" aria-label="Close setup" onClick={() => nav("/business", { replace: true })}><Icon name="close" /></button>
        <div className="su-bar" aria-label={`Step ${step + 1} of ${slides.length}`}>
          {slides.map((_, i) => <span key={i} className={i < step ? "done" : i === step ? "now" : ""} />)}
          <b>{step + 1}/{slides.length}</b>
        </div>
      </header>
      <main className="su-body su-card" key={step} data-dir={dir} data-step={step}>
        {slides[step]}
        {err && <div className="notice err">{err}</div>}
        {step === 2 && <button type="button" className="link-btn su-skip" onClick={() => { setUrls({ zomato: "", swiggy: "", instagram: "", website: "" }); setExtras([]); go(1); }}>Skip for now</button>}
      </main>
      <footer className="su-foot">
        {step > 0 && <button type="button" className="icon-btn su-back" aria-label="Back" disabled={busy} onClick={() => go(-1)}><Icon name="back" /></button>}
        {final
          ? <button className="btn green grow" disabled={busy} onClick={finish}><Icon name={price > 0 ? "wallet" : "send"} size={18} />{busy ? "One moment…" : price > 0 ? `Pay ${rupees(price)} with Razorpay` : "Send for review"}</button>
          : <button className="btn green grow su-cta" onClick={next}>Next<Icon name="chev" size={18} /></button>}
      </footer>
    </div>
  );
}
