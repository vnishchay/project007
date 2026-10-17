import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { upiLink, useSettings } from "../lib/settings";
import type { ListingRequest, QrStyle } from "../lib/types";
import { copyText, extractPlaceId, initials, QR_STYLES, rupees, timeAgo } from "../lib/util";
import type { AppSettings } from "../lib/settings";
import { Icon, QrImage, TopBar, useToast, type IconName } from "../components/ui";
import { MediaImg } from "../components/manage/MediaImg";
import { areaCityFromAddress, GoogleFind, GoogleMark, GooglePreview, matchCategory } from "../components/manage/Google";
import { LinkIcon } from "../components/LinkIcon";
import { googleConfigured, type GoogleMatch } from "../lib/google";
import "../styles/manage.css";

const STATUS: Record<string, { label: string; cls: string; step: number; icon: IconName }> = {
  pending: { label: "Waiting for payment", cls: "warn", step: 1, icon: "wallet" },
  paid: { label: "Paid, being reviewed", cls: "gray", step: 2, icon: "clock" },
  approved: { label: "Live", cls: "", step: 3, icon: "checkCircle" },
  declined: { label: "Declined", cls: "red", step: 3, icon: "alert" },
};

interface MyPlace { id: string; name: string; area: string | null; city: string; status: string; listed_until: string | null; cover_path: string | null; logo_path: string | null }

const EMPTY = { business_name: "", category: "", area: "", city: "", phone: "", google_place_id: "", note: "" };

export default function Business() {
  const { session } = useAuth();
  const toast = useToast();
  const [settings] = useSettings();
  const [mine, setMine] = useState<ListingRequest[]>([]);
  const [shops, setShops] = useState<MyPlace[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [wantsQr, setWantsQr] = useState(true);
  const [style, setStyle] = useState<QrStyle>("paper");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<GoogleMatch | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const load = () => {
    if (!session) return;
    supabase.from("listing_requests").select("*").eq("requester_id", session.user.id).order("created_at", { ascending: false })
      .then(({ data }) => setMine((data as ListingRequest[]) || []));
    supabase.rpc("my_places").then(({ data, error }) => { if (!error) setShops((data as MyPlace[]) || []); });
  };
  useEffect(load, [session]);

  const total = settings.listing_price_inr + (wantsQr ? settings.qr_price_inr : 0);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const gp = form.google_place_id.trim();
  const gpId = gp ? extractPlaceId(gp) : null;
  function fromGoogle(m: GoogleMatch) {
    const { area, city } = areaCityFromAddress(m.address);
    setPicked(m);
    setForm((f) => ({
      ...f, business_name: m.name || f.business_name, category: matchCategory(m) || f.category,
      area: area || f.area, city: city || f.city, google_place_id: m.id,
    }));
  }
  const clearGoogle = () => { setPicked(null); setForm((f) => ({ ...f, google_place_id: "" })); };
  const toForm = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) { setErr("Enter a full phone number so we can reach you."); return; }
    setBusy(true); setErr("");
    // A Maps link without a Place ID goes in the note for the team to look up.
    const raw = form.google_place_id.trim();
    const placeId = extractPlaceId(raw);
    const note = [form.note.trim(), raw && !placeId ? `Google Maps link: ${raw}` : ""].filter(Boolean).join("\n");
    const { error } = await supabase.from("listing_requests").insert({
      requester_id: session!.user.id,
      business_name: form.business_name.trim(), category: form.category.trim(), area: form.area.trim() || null,
      city: form.city.trim(), phone: form.phone.trim(), google_place_id: placeId,
      note: note || null, wants_qr: wantsQr, qr_style: wantsQr ? style : null,
    });
    setBusy(false);
    if (error) { setErr(errorText(error)); return; }
    toast("Request sent");
    setForm(EMPTY);
    setPicked(null);
    load();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="page">
      <TopBar title="For businesses" />

      <div className="biz-hero">
        <div className="biz-hero-art" aria-hidden="true">
          <span><Icon name="store" size={22} color="#fff" /></span><span><Icon name="star" size={22} color="#fff" fill="#fff" /></span>
          <span><Icon name="qr" size={22} color="#fff" /></span><span><Icon name="people" size={22} color="#fff" /></span>
        </div>
        <span className="biz-hero-pills"><span><Icon name="verified" size={13} />Friend-trusted</span><span><Icon name="box" size={13} />Item by item</span></span>
        <h1>Let friends find your best</h1>
        <p>Customers rate the exact dish, cut or cake they had. Their friends see it first.</p>
        <button type="button" className="btn small" onClick={toForm}><Icon name="plus" size={17} />List my shop</button>
      </div>

      {shops.length > 0 && (
        <div className="stack">
          <div className="section-title"><span className="icon-chip sm"><Icon name="store" size={16} /></span>Your shops</div>
          {shops.map((s) => {
            return (
              <Link key={s.id} to={`/manage/${s.id}`} className="biz-shop">
                <span className="thumb"><MediaImg path={s.logo_path || s.cover_path} fallback={initials(s.name)} /></span>
                <span className="grow stack tight">
                  <span className="strong ellipsis">{s.name}</span>
                  <span className="mg-meta">{[s.area, s.city].filter(Boolean).join(" · ")}<span className={`badge ${s.status === "live" ? "" : s.status === "lapsed" ? "warn" : "red"}`}>{s.status}</span></span>
                </span>
                <span className="icon-chip sm"><Icon name="edit" size={15} /></span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="biz-steps">
        {([
          ["store", "", "List", "Name, photo, products"],
          ["qr", "amber", "Get QR", "On every table"],
          ["star", "violet", "Collect", "Trusted reviews"],
        ] as [IconName, string, string, string][]).map(([icon, cls, t, s], i) => (
          <div key={t} className="biz-step">
            <span className="num">{i + 1}</span>
            <span className={`icon-chip lg ${cls}`}><Icon name={icon} size={24} /></span>
            <span className="t">{t}</span>
            <span className="s">{s}</span>
          </div>
        ))}
      </div>

      <div className="biz-prices">
        <div className="biz-price">
          <span className="icon-chip"><Icon name="store" size={20} /></span>
          <span><span className="amt">{rupees(settings.listing_price_inr)}</span><span className="per"> / year</span></span>
          <ul>
            <li><Icon name="check" size={13} />Shop page</li>
            <li><Icon name="check" size={13} />Products + photos</li>
            <li><Icon name="check" size={13} />Ranked in search</li>
          </ul>
        </div>
        <div className="biz-price qr">
          <span className="icon-chip amber"><Icon name="qr" size={20} /></span>
          <span><span className="amt">{rupees(settings.qr_price_inr)}</span><span className="per"> once</span></span>
          <ul>
            <li><Icon name="check" size={13} />Code per table</li>
            <li><Icon name="check" size={13} />Verified reviews</li>
            <li><Icon name="check" size={13} />Print-ready</li>
          </ul>
        </div>
      </div>

      {mine.length > 0 && (
        <div className="stack">
          <div className="section-title"><span className="icon-chip sm sky"><Icon name="ticket" size={16} /></span>Your requests</div>
          {mine.map((r) => <RequestCard key={r.id} r={r} settings={settings} onCopied={() => toast("UPI ID copied")} />)}
        </div>
      )}

      <div ref={formRef} style={{ scrollMarginTop: 16 }}>
        {!session ? (
          <div className="biz-form" style={{ alignItems: "center", textAlign: "center" }}>
            <span className="icon-chip lg violet"><Icon name="login" size={24} /></span>
            <p className="small muted">Sign in first so we can keep you updated on your listing.</p>
            <Link to="/signin?next=/business" className="btn block"><Icon name="login" size={18} />Sign in to continue</Link>
          </div>
        ) : (
          <form className="biz-form" onSubmit={submit}>
            <div className="section-title"><span className="icon-chip sm"><Icon name="plus" size={16} /></span>{mine.length || shops.length ? "List another shop" : "Your shop"}</div>
            {googleConfigured && (
              picked ? (
                <div className="stack" style={{ gap: 6 }}>
                  <GooglePreview id={picked.id} mini />
                  <span className="row tiny" style={{ gap: 6 }}>
                    <Icon name="spark" size={13} color="var(--green)" /><span className="grow muted">Filled in from Google. Edit anything below.</span>
                    <button type="button" className="link-btn tiny" onClick={clearGoogle}>Change</button>
                  </span>
                </div>
              ) : (
                <div className="biz-google">
                  <span className="row strong" style={{ gap: 8 }}><span className="icon-chip sm sky" style={{ background: "#fff" }}><Icon name="zap" size={16} /></span>Find your shop on <GoogleMark /></span>
                  <span className="tiny muted" style={{ marginTop: -4 }}>Paste your Google Maps link or type the shop name. We fill in the rest.</span>
                  <GoogleFind onPick={fromGoogle} />
                  <span className="biz-or">or fill in by hand</span>
                </div>
              )
            )}
            <div className="field"><label className="mg-label" htmlFor="bn"><Icon name="store" size={15} />Business name</label><input id="bn" className="input" required value={form.business_name} onChange={set("business_name")} placeholder="Forno Napoli" /></div>
            <div className="grid2">
              <div className="field"><label className="mg-label" htmlFor="cat"><Icon name="tag" size={15} />Category</label><input id="cat" className="input" required value={form.category} onChange={set("category")} placeholder="Pizzeria, Salon…" /></div>
              <div className="field"><label className="mg-label" htmlFor="ph"><Icon name="phone" size={15} />Phone</label><input id="ph" className="input" required type="tel" value={form.phone} onChange={set("phone")} placeholder="98xxxxxxxx" /></div>
            </div>
            <div className="grid2">
              <div className="field"><label className="mg-label" htmlFor="ar"><Icon name="pin" size={15} />Area</label><input id="ar" className="input" value={form.area} onChange={set("area")} placeholder="Koregaon Park" /></div>
              <div className="field"><label className="mg-label" htmlFor="ct"><Icon name="map" size={15} />City</label><input id="ct" className="input" required value={form.city} onChange={set("city")} placeholder="Pune" /></div>
            </div>
            {!googleConfigured && (
              <div className="field">
                <label className="mg-label" htmlFor="gp"><Icon name="globe" size={15} />Google Maps link <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label>
                <input id="gp" className="input" value={form.google_place_id} onChange={set("google_place_id")} placeholder="Paste your Google Maps link" />
                {gp ? (
                  gpId ? <span className="tiny row" style={{ gap: 4, color: "var(--green)" }}><Icon name="checkCircle" size={13} />Place ID found</span>
                    : <span className="tiny muted row" style={{ gap: 4 }}><Icon name="info" size={13} />No Place ID in this link. We look it up for you.</span>
                ) : <span className="tiny muted">One-tap Google reviews for your customers.</span>}
              </div>
            )}
            <div className="field"><label className="mg-label" htmlFor="nt"><Icon name="message" size={15} />Anything else <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label><textarea id="nt" className="textarea" style={{ minHeight: 70 }} value={form.note} onChange={set("note")} placeholder="Number of tables, best time to call…" /></div>

            <label className="biz-qr-toggle">
              <span className="icon-chip amber" style={{ background: "#fff" }}><Icon name="qr" size={20} /></span>
              <span className="grow"><b>Table QR codes</b><br /><span className="small" style={{ color: "#8a5a00" }}>{rupees(settings.qr_price_inr)} one time</span></span>
              <input type="checkbox" checked={wantsQr} onChange={(e) => setWantsQr(e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--green)" }} />
            </label>
            {wantsQr && (
              <div className="stack">
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
            )}

            {err && <div className="notice err">{err}</div>}
            <button className="btn green block" disabled={busy}><Icon name="send" size={18} />{busy ? "Sending…" : `Request listing · ${rupees(total)}`}</button>
            <p className="tiny muted center row" style={{ justifyContent: "center", gap: 6 }}><Icon name="shield" size={14} />Pay by UPI after sending. Live once confirmed.</p>
          </form>
        )}
      </div>
      <nav className="row wrap tiny muted center" style={{ gap: 12, justifyContent: "center", marginTop: 8 }}>
        <Link to="/pricing">Pricing</Link><Link to="/terms">Terms</Link><Link to="/refunds">Refunds</Link><Link to="/privacy">Privacy</Link><Link to="/contact">Contact</Link>
      </nav>
    </div>
  );
}

function RequestCard({ r, settings, onCopied }: { r: ListingRequest; settings: AppSettings; onCopied: () => void }) {
  const st = STATUS[r.status]!;
  const ref = `TP-${r.id.slice(0, 8).toUpperCase()}`;
  const upi = upiLink(settings, r.amount_inr, `${ref} ${r.business_name}`.slice(0, 50));
  return (
    <div className="biz-req">
      <div className="row">
        <span className={`icon-chip sm ${r.status === "pending" ? "amber" : r.status === "declined" ? "coral" : r.status === "paid" ? "sky" : ""}`}><Icon name={st.icon} size={16} /></span>
        <span className="strong grow ellipsis">{r.business_name}</span>
        <span className={`badge ${st.cls}`}>{st.label}</span>
      </div>
      <div className={`biz-track ${r.status === "declined" ? "red" : ""}`} aria-hidden="true">{[1, 2, 3].map((s) => <span key={s} className={s <= st.step ? "on" : ""} />)}</div>
      <span className="small muted">{[r.category, r.area, r.city].filter(Boolean).join(" · ")} · {rupees(r.amount_inr)} · {timeAgo(r.created_at)}</span>
      {r.status === "pending" && (
        upi ? (
          <div className="stack">
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              <QrImage text={upi} size={110} />
              <div className="stack tight small">
                <span>Pay <b>{rupees(r.amount_inr)}</b> by UPI to <b>{settings.upi_id}</b></span>
                <span className="muted">Reference <b>{ref}</b>. We confirm and list you after payment arrives.</span>
              </div>
            </div>
            <div className="row">
              <a className="btn small green" href={upi}><Icon name="wallet" size={16} />Pay with UPI</a>
              <button type="button" className="btn small ghost" onClick={async () => { if (await copyText(settings.upi_id)) onCopied(); }}><Icon name="copy" size={16} />Copy UPI ID</button>
            </div>
          </div>
        ) : <p className="small muted">We'll call you on {r.phone} to collect payment. Reference <b>{ref}</b>.</p>
      )}
      {r.status === "approved" && r.place_id && (
        <div className="stack" style={{ gap: 8 }}>
          <Link to={`/manage/${r.place_id}?tab=links`} className="biz-links-cta">
            <span className="stackicons" aria-hidden="true">{["swiggy", "zomato", "instagram"].map((k) => <LinkIcon key={k} kind={k} size={30} />)}</span>
            <span className="grow stack tight"><span className="strong">Add your links</span><span className="tiny" style={{ opacity: 0.9 }}>Swiggy, Zomato, Instagram, WhatsApp</span></span>
            <Icon name="chev" size={20} />
          </Link>
          <div className="row">
            <Link to={`/manage/${r.place_id}?tab=products`} className="btn small ghost grow"><Icon name="box" size={16} />Add products</Link>
            <Link to={`/p/${r.place_id}`} className="btn small ghost grow"><Icon name="eye" size={16} />Live page</Link>
          </div>
        </div>
      )}
      {settings.support_phone && r.status !== "approved" && <a className="link-btn small" href={`https://wa.me/${settings.support_phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi, about my listing ${ref}`)}`} target="_blank" rel="noreferrer"><Icon name="message" size={15} />Message us on WhatsApp</a>}
    </div>
  );
}
