import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import { loadPlans, payForPlan, type PlanRow } from "../../lib/billing";
import { googleConfigured, type GoogleMatch } from "../../lib/google";
import { goBack } from "../../lib/nav";
import { extractPlaceId, googleMapsUrl, QR_STYLES, rupees } from "../../lib/util";
import type { QrStyle } from "../../lib/types";
import { areaCityFromAddress, GoogleFind, GooglePreview, matchCategory } from "../manage/Google";
import { Icon, QrImage, useConfirm } from "../ui";
import { LinkIcon, guessLinkKind } from "../LinkIcon";
import { CurrencyField } from "../manage/CurrencyField";
import { DEFAULT_CURRENCY, localCurrency } from "../../lib/money";
import { KINDS, MODES, type Kind } from "../../lib/modes";
import "../../styles/manage.css";
import "../../styles/setup.css";

const EMPTY = { business_name: "", category: "", area: "", city: "", phone: "", google_place_id: "", note: "" };
const TABLE_CHOICES = [1, 3, 5, 10, 15, 25];
type Interval = "year" | "month";
const LAST = 5;
const LINK_FIELDS = [
  { key: "zomato", label: "Zomato", ph: "Paste your Zomato link", only: "food" },
  { key: "swiggy", label: "Swiggy", ph: "Paste your Swiggy link", only: "food" },
  { key: "instagram", label: "Instagram", ph: "Paste your Instagram link", only: null },
  { key: "website", label: "Website", ph: "Paste your website or booking page", only: null },
] as const;
type LinkKey = (typeof LINK_FIELDS)[number]["key"];
/** Only the link boxes that make sense for this type of business: Zomato and Swiggy are for food. */
const linkFieldsFor = (kind: Kind | "") => LINK_FIELDS.filter((f) => !f.only || f.only === kind);

/** Phone country codes, with how many digits a local number has there. */
const DIAL: { region: string; code: string; label: string; digits: [number, number] }[] = [
  { region: "IN", code: "+91", label: "India", digits: [10, 10] },
  { region: "US", code: "+1", label: "US / Canada", digits: [10, 10] },
  { region: "GB", code: "+44", label: "UK", digits: [10, 11] },
  { region: "AE", code: "+971", label: "UAE", digits: [8, 9] },
  { region: "SG", code: "+65", label: "Singapore", digits: [8, 8] },
  { region: "AU", code: "+61", label: "Australia", digits: [9, 10] },
  { region: "DE", code: "+49", label: "Germany", digits: [6, 11] },
  { region: "FR", code: "+33", label: "France", digits: [9, 10] },
  { region: "NP", code: "+977", label: "Nepal", digits: [8, 10] },
  { region: "LK", code: "+94", label: "Sri Lanka", digits: [9, 10] },
  { region: "BD", code: "+880", label: "Bangladesh", digits: [10, 10] },
  { region: "XX", code: "", label: "Other (type +code)", digits: [7, 15] },
];
/** The phone's own region picks the starting country code. */
function localDial(): string {
  try {
    for (const tag of [...(navigator.languages || []), navigator.language]) {
      const r = tag ? new Intl.Locale(tag).region?.toUpperCase() : undefined;
      if (r && DIAL.some((d) => d.region === r)) return r;
    }
  } catch { /* old browser */ }
  return "IN";
}

const DRAFT_KEY = "tp-setup-draft";
interface SetupDraft { kind: Kind | ""; form: typeof EMPTY; urls: Record<LinkKey, string>; extras: string[]; currency: string; dial: string; tables: number; style: QrStyle; plan: string; interval: Interval }
function readDraft(): SetupDraft | null {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null") as SetupDraft | null; } catch { return null; }
}

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
 * The step lives in the address (?s=) but replaces itself, so the phone's back button leaves the setup in one press;
 * the arrow in the footer goes to the screen before, and the X discards the setup.
 * Every screen flies in from the direction you are travelling.
 */
export function Setup() {
  const confirm = useConfirm();
  const nav = useNavigate();
  // What was typed survives a reload or a trip to another app, for this tab only.
  const [draft0] = useState(readDraft);
  const [params, setParams] = useSearchParams();
  const step = Math.min(LAST, Math.max(0, parseInt(params.get("s") || "0", 10) || 0));
  const lastStep = useRef(step);
  const dir: "fwd" | "back" = step >= lastStep.current ? "fwd" : "back";
  useEffect(() => { lastStep.current = step; }, [step]);
  const [kind, setKind] = useState<Kind | "">(draft0?.kind ?? "");
  const [urls, setUrls] = useState<Record<LinkKey, string>>(draft0?.urls ?? { zomato: "", swiggy: "", instagram: "", website: "" });
  const [extras, setExtras] = useState<string[]>(draft0?.extras ?? []);
  const [form, setForm] = useState(draft0?.form ?? EMPTY);
  // What the shop's prices are in: the phone's region to start (India gives rupees).
  const [currency, setCurrency] = useState(() => draft0?.currency ?? localCurrency());
  const [dial, setDial] = useState(() => draft0?.dial ?? localDial());
  const [picked, setPicked] = useState<GoogleMatch | null>(null);
  const [tables, setTables] = useState(draft0?.tables ?? 5);
  const [style, setStyle] = useState<QrStyle>(draft0?.style ?? "paper");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plan, setPlan] = useState(draft0?.plan ?? "");
  const [manual, setManual] = useState(Boolean(draft0?.plan));
  const [interval, setInterval] = useState<Interval>(draft0?.interval ?? "year");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [shopId, setShopId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<null | "paid" | "live" | "unpaid" | "pending">(null);
  const [qrCount, setQrCount] = useState<number | null>(null);
  const [payErr, setPayErr] = useState("");

  useEffect(() => { loadPlans().then(setPlans); }, []);
  useEffect(() => {
    if (shopId) return;
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, form, urls, extras, currency, dial, tables, style, plan, interval } satisfies SetupDraft)); } catch { /* storage blocked */ }
  }, [kind, form, urls, extras, currency, dial, tables, style, plan, interval, shopId]);
  const clearDraft = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked */ } };
  const dialRow = DIAL.find((d) => d.region === dial) ?? DIAL[DIAL.length - 1]!;
  /** The phone as saved: country code first, so owners abroad are reachable too. */
  const fullPhone = () => {
    const raw = form.phone.trim();
    if (raw.startsWith("+") || !dialRow.code) return raw;
    return `${dialRow.code} ${raw.replace(/^0+/, "")}`;
  };
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
    if (step === 0 && !kind) { setErr("Pick what kind of business it is."); return; }
    if (step === 0 && !form.business_name.trim()) { setErr("Add your shop's name."); return; }
    if (step === 1) {
      if (!form.category.trim() || !form.city.trim()) { setErr("Add a category and a city."); return; }
      const digits = form.phone.replace(/\D/g, "").replace(/^0+/, "");
      const [lo, hi] = form.phone.trim().startsWith("+") ? [8, 15] : dialRow.digits;
      if (digits.length < lo || digits.length > hi) { setErr(lo === hi ? `Enter the ${lo}-digit phone number so we can reach you.` : `Enter a full phone number (${lo} to ${hi} digits) so we can reach you.`); return; }
    }
    if (step === 2) {
      for (const f of linkFieldsFor(kind)) if (cleanUrl(urls[f.key]) === null) { setErr(`Check the ${f.label} link.`); return; }
      if (extras.some((x) => cleanUrl(x) === null)) { setErr("Check the extra link."); return; }
    }
    if (step === 4 && !chosen) { setErr("Pick a plan."); return; }
    go(1);
  }
  function go(d: 1 | -1) {
    setErr("");
    // Steps replace each other in the history, so one Back (or the X) leaves the whole setup.
    setParams(d === -1 ? (step > 1 ? { s: String(step - 1) } : {}) : { s: String(step + 1) }, { replace: true });
    window.scrollTo({ top: 0 });
  }

  /** What goes on the shop page: Google Maps first, then whatever was pasted. */
  function buildLinks() {
    const out: { kind: string; url: string }[] = [];
    const gid = extractPlaceId(form.google_place_id.trim());
    if (gid) out.push({ kind: "maps", url: googleMapsUrl(gid, form.business_name) });
    for (const f of linkFieldsFor(kind)) { const u = cleanUrl(urls[f.key]); if (u) out.push({ kind: f.key === "website" ? "website" : f.key, url: u }); }
    for (const x of extras) { const u = cleanUrl(x); if (u) out.push({ kind: guessLinkKind(u), url: u }); }
    return out;
  }

  async function finish() {
    if (!chosen) return;
    setBusy(true); setErr("");
    let id = shopId;
    try {
      if (!id) {
        const raw = form.google_place_id.trim();
        const placeId = raw ? extractPlaceId(raw) : null;
        const note = [form.note.trim(), raw && !placeId ? `Google Maps link: ${raw}` : ""].filter(Boolean).join("\n");
        const ins = await supabase.rpc("list_my_shop", {
          p_name: form.business_name.trim(), p_category: form.category.trim(), p_city: form.city.trim(), p_phone: fullPhone(),
          p_area: form.area.trim() || null, p_google_place_id: placeId, p_links: buildLinks(), p_note: note || null,
        });
        if (ins.error) throw ins.error;
        id = (ins.data as { id: string }).id;
        setShopId(id);
        // New shops start in rupees as a general shop. The owner's choices are set straight after; if that fails, they can be changed in Details.
        const after = { ...(currency !== DEFAULT_CURRENCY ? { currency } : {}), ...(kind ? { kind } : {}) };
        if (Object.keys(after).length) {
          const up = await supabase.from("places").update(after).eq("id", id);
          // An older database without the kind column still takes the currency.
          if (up.error && after.kind && currency !== DEFAULT_CURRENCY) await supabase.from("places").update({ currency }).eq("id", id);
        }
        clearDraft();
        // The free trial QR right away; paid tables come after payment.
        await makeQrs(id);
      }
      if (price <= 0) { setOutcome("live"); return; }
      const paid = await payForPlan(id, form.business_name.trim(), chosen.code, interval);
      if (paid === "paid") await makeQrs(id);
      setOutcome(paid === "paid" ? "paid" : paid === "pending" ? "pending" : "unpaid");
    } catch (e) {
      // Once the shop exists, the earlier screens can't change it any more: finish on the outcome screen.
      if (id) { setPayErr(errorText(e)); setOutcome("unpaid"); } else setErr(errorText(e));
    }
    setBusy(false);
  }
  /** Table QRs up to what the plan allows; remembers how many exist so the last screen tells the truth. */
  async function makeQrs(id: string) {
    const r = await supabase.rpc("make_table_qrs", { p_place: id, p_tables: Math.max(1, tables), p_style: style });
    setQrCount(r.error ? null : (r.data as number));
  }

  if (outcome) {
    const paid = outcome === "paid";
    return (
      <div className="su-screen">
        <main className="su-body su-card su-done" data-dir="fwd" data-step="7">
          {(outcome === "paid" || outcome === "live") && Array.from({ length: 14 }, (_, i) => <i key={i} className="su-cf" style={{ left: `${6 + i * 6.5}%`, animationDelay: `${(i * 0.23) % 1.6}s`, background: ["#c9604a", "#d9a441", "#c2492b", "#6d5fb0", "#4a78b8", "#2f7d6e"][i % 6] }} />)}
          <span className={`icon-chip lg ${outcome === "unpaid" || outcome === "pending" ? "amber" : ""}`} style={{ margin: "0 auto" }}><Icon name={outcome === "unpaid" || outcome === "pending" ? "wallet" : "check"} size={26} /></span>
          <h2>{paid ? "Paid. Your shop is live" : outcome === "live" ? "Your shop is live" : outcome === "pending" ? "Payment received. Your shop is live" : "Your shop is live. The payment didn't go through"}</h2>
          <p className="small muted">{outcome === "unpaid"
            ? `No money was taken. You're on the free trial QR for now, so customers can already review. Try paying again, or pay later from your shop's Plan tab.`
            : outcome === "pending"
            ? "We're confirming your payment with Razorpay; your plan turns on in a few minutes, so there's no need to pay again. Then add your QR codes from the QR tab."
            : qrCount == null
            ? "Your shop is live, but the QR codes didn't get made. Open your shop and add them from the QR tab."
            : `${qrCount} QR code${qrCount === 1 ? " is" : "s are"} ready to print. We'll check your Google page and links, usually within a day, then show your links on your page.`}</p>
          {outcome === "unpaid" && payErr && <details className="tiny muted" style={{ textAlign: "left" }}><summary>What went wrong</summary>{payErr}</details>}
        </main>
        <footer className="su-foot">
          {outcome === "unpaid" && <button className="btn ghost grow" disabled={busy} onClick={() => { setPayErr(""); void finish(); }}><Icon name="refresh" size={18} />{busy ? "One moment…" : "Try again"}</button>}
          <button className={`btn ${outcome === "unpaid" ? "quiet" : "green"} grow`} onClick={() => nav(shopId ? `/manage/${shopId}` : "/business", { replace: true })}><Icon name="store" size={18} />Open my shop</button>
        </footer>
      </div>
    );
  }

  const slides: React.ReactNode[] = [
    <>
      <span className="icon-chip lg" style={{ margin: "0 auto" }}><Icon name="store" size={26} /></span>
      <h2>What kind of business is it?</h2>
      <div className="mg-kinds" role="radiogroup" aria-label="Business type" style={{ textAlign: "left" }}>
        {KINDS.map((k) => {
          const m = MODES[k];
          return (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={`mg-kind ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
              <span className={`icon-chip sm ${m.tint === "green" ? "" : m.tint}`}><Icon name={m.icon} size={16} /></span>
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>
      <h2 style={{ fontSize: 20 }}>What's it called?</h2>
      {googleConfigured && (picked ? (
        <div className="stack" style={{ gap: 6, textAlign: "left" }}>
          <GooglePreview id={picked.id} mini />
          <span className="row tiny" style={{ gap: 6 }}><Icon name="spark" size={13} color="var(--accent)" /><span className="grow muted">Filled in from Google. Edit anything.</span>
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
        <div className="field"><label className="mg-label" htmlFor="ph"><Icon name="phone" size={15} />Phone</label>
          <div className="su-phone">
            <select className="select" aria-label="Country code" value={dial} onChange={(e) => setDial(e.target.value)}>
              {DIAL.map((d) => <option key={d.region} value={d.region}>{d.code ? `${d.code} ${d.label}` : d.label}</option>)}
            </select>
            <input id="ph" className="input" type="tel" autoComplete="tel-national" value={form.phone} onChange={set("phone")} placeholder={dialRow.region === "IN" ? "98765 43210" : "Phone number"} />
          </div>
        </div>
        <div className="grid2">
          <div className="field"><label className="mg-label" htmlFor="ar"><Icon name="pin" size={15} />Area</label><input id="ar" className="input" value={form.area} onChange={set("area")} placeholder="Koregaon Park" /></div>
          <div className="field"><label className="mg-label" htmlFor="ct"><Icon name="map" size={15} />City</label><input id="ct" className="input" value={form.city} onChange={set("city")} placeholder="Pune" /></div>
        </div>
        <CurrencyField id="cur" value={currency} onChange={setCurrency} />
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
        {linkFieldsFor(kind).map((f) => (
          <label key={f.key} className={`su-link ${urls[f.key].trim() ? "on" : ""}`}><LinkIcon kind={f.key} size={40} /><span className="grow"><b className="tiny muted">{f.label}</b>
            <input className="su-input" value={urls[f.key]} onChange={(e) => setUrls((u) => ({ ...u, [f.key]: e.target.value }))} placeholder={f.ph} inputMode="url" autoCapitalize="off" /></span></label>
        ))}
        {extras.map((x, i) => (
          <label key={i} className={`su-link ${x.trim() ? "on" : ""}`}><LinkIcon kind={guessLinkKind(x)} size={40} /><span className="grow"><b className="tiny muted">Another link</b>
            <input className="su-input" value={x} onChange={(e) => setExtras((a) => a.map((v, j) => (j === i ? e.target.value : v)))} placeholder="Facebook, YouTube, Justdial…" inputMode="url" autoCapitalize="off" /></span></label>
        ))}
        {extras.length < 3 && <button type="button" className="su-add" onClick={() => setExtras((a) => [...a, ""])}><Icon name="plus" size={16} />Add another link</button>}
      </div>
      <p className="tiny muted su-note"><Icon name="info" size={14} />Your Google rating and reviews show on your page by themselves.{kind === "food" ? " Zomato and Swiggy appear as buttons because those sites don't share their reviews." : ""}</p>
    </>,
    <>
      <span className="icon-chip lg amber" style={{ margin: "0 auto" }}><Icon name="qr" size={26} /></span>
      <h2>How many counters, desks or tables need a QR?</h2>
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
      <p className="tiny muted row" style={{ justifyContent: "center", gap: 6 }}><Icon name="rupee" size={13} />Prices and billing are in Indian rupees (INR)</p>
      <div className="pn-seg" role="radiogroup" aria-label="Pay for">
        {(["year", "month"] as const).map((i) => (
          <button key={i} type="button" role="radio" aria-checked={interval === i} className={interval === i ? "on" : ""} onClick={() => setInterval(i)}>{i === "year" ? "Yearly (2 months free)" : "Monthly"}</button>
        ))}
      </div>
      {plans.length === 0 && <div className="notice row" style={{ textAlign: "left" }}><span className="grow">Loading plans…</span><button type="button" className="link-btn" onClick={() => loadPlans().then(setPlans)}><Icon name="refresh" size={15} />Retry</button></div>}
      <div className="stack" style={{ textAlign: "left" }}>
        {plans.map((p) => {
          const ok = fits(p);
          const amt = p.code === "trial" ? 0 : (interval === "year" ? p.price_inr_year : p.price_inr_month) ?? 0;
          return (
            <button key={p.code} type="button" aria-pressed={plan === p.code} onClick={() => { if (!ok) setTables(p.qr_limit); setManual(true); setPlan(p.code); }}
              className={`card pn-plan pn-pick ${plan === p.code ? "on" : ""}`}>
              <span className="row" style={{ gap: 8 }}>
                <strong className="grow">{p.name}{p.code === suggested && <span className="badge" style={{ marginLeft: 8 }}>Best fit</span>}</strong>
                <span className="pn-price">{amt ? rupees(amt) : "Free"}{amt ? <span className="tiny muted">/{interval === "year" ? "yr" : "mo"}</span> : null}</span>
              </span>
              <span className="tiny muted">{ok ? p.features.join(" · ") : `Covers ${p.qr_limit} QR${p.qr_limit === 1 ? "" : "s"}. You chose ${tables}: tap to use ${p.qr_limit} instead.`}</span>
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
  /** Leave the setup from any screen: back to where it was started, asking first when something was typed. */
  function discard() {
    const typed = form.business_name.trim() || form.phone.trim() || form.category.trim();
    if (typed && !shopId) {
      void confirm({ title: "Discard your shop setup?", body: "What you typed will be lost.", ok: "Discard", cancel: "Keep going", danger: true })
        .then((ok) => { if (ok) { clearDraft(); goBack(nav, "/business"); } });
      return;
    }
    clearDraft();
    goBack(nav, "/business");
  }
  return (
    <div className="su-screen">
      <header className="su-top">
        <button type="button" className="icon-btn" aria-label="Close setup" onClick={discard}><Icon name="close" /></button>
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
          ? <button className="btn green grow" disabled={busy} onClick={finish}><Icon name={price > 0 ? "wallet" : "check"} size={18} />{busy ? "One moment…" : price > 0 ? `Pay ${rupees(price)} with Razorpay` : "Start free"}</button>
          : <button className="btn green grow su-cta" onClick={next}>Next<Icon name="chev" size={18} /></button>}
      </footer>
    </div>
  );
}
