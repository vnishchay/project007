import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/settings";
import { loadPlans, payForRequest, type PlanRow } from "../lib/billing";
import { Setup } from "../components/business/Setup";
import type { ListingRequest } from "../lib/types";
import { initials, rupees, timeAgo } from "../lib/util";
import type { AppSettings } from "../lib/settings";
import { Icon, TopBar, useToast, type IconName } from "../components/ui";
import { MediaImg } from "../components/manage/MediaImg";
import { LinkIcon } from "../components/LinkIcon";
import "../styles/manage.css";

const STATUS: Record<string, { label: string; cls: string; step: number; icon: IconName }> = {
  pending: { label: "Waiting for payment", cls: "warn", step: 1, icon: "wallet" },
  paid: { label: "Paid, being reviewed", cls: "gray", step: 2, icon: "clock" },
  approved: { label: "Live", cls: "", step: 3, icon: "checkCircle" },
  declined: { label: "Declined", cls: "red", step: 3, icon: "alert" },
};

interface MyPlace { id: string; name: string; area: string | null; city: string; status: string; listed_until: string | null; cover_path: string | null; logo_path: string | null }

export default function Business() {
  const { session } = useAuth();
  const toast = useToast();
  const [settings] = useSettings();
  const [mine, setMine] = useState<ListingRequest[]>([]);
  const [shops, setShops] = useState<MyPlace[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const formRef = useRef<HTMLDivElement>(null);

  const load = () => {
    if (!session) return;
    supabase.from("listing_requests").select("*").eq("requester_id", session.user.id).order("created_at", { ascending: false })
      .then(({ data }) => setMine((data as ListingRequest[]) || []));
    supabase.rpc("my_places").then(({ data, error }) => { if (!error) setShops((data as MyPlace[]) || []); });
  };
  useEffect(load, [session]);
  useEffect(() => { loadPlans().then((p) => setPlans(p.filter((x) => x.code !== "trial"))); }, []);

  const toForm = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

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
          ["store", "", "Your shop", "Name and details"],
          ["qr", "amber", "Tables and QR", "On every table"],
          ["wallet", "violet", "Plan and pay", "Reviews go live"],
        ] as [IconName, string, string, string][]).map(([icon, cls, t, s], i) => (
          <div key={t} className="biz-step">
            <span className="num">{i + 1}</span>
            <span className={`icon-chip lg ${cls}`}><Icon name={icon} size={24} /></span>
            <span className="t">{t}</span>
            <span className="s">{s}</span>
          </div>
        ))}
      </div>

      {plans.length > 0 && (
        <div className="biz-plans">
          {plans.map((p) => (
            <div key={p.code} className="biz-price">
              <span><span className="amt">{rupees(p.price_inr_year ?? 0)}</span><span className="per"> / year</span></span>
              <b>{p.name}</b>
              <span className="tiny muted">{p.qr_limit} review QRs</span>
            </div>
          ))}
          <span className="tiny muted" style={{ gridColumn: "1 / -1" }}>Your page is free. Start with 1 QR free for 30 days or 25 reviews.</span>
        </div>
      )}

      {mine.length > 0 && (
        <div className="stack">
          <div className="section-title"><span className="icon-chip sm sky"><Icon name="ticket" size={16} /></span>Your requests</div>
          {mine.map((r) => <RequestCard key={r.id} r={r} settings={settings} onPaid={() => { toast("Paid. We'll review your request."); load(); }} />)}
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
          <Setup onSent={load} />
        )}
      </div>
      <nav className="row wrap tiny muted center" style={{ gap: 12, justifyContent: "center", marginTop: 8 }}>
        <Link to="/pricing">Pricing</Link><Link to="/terms">Terms</Link><Link to="/refunds">Refunds</Link><Link to="/privacy">Privacy</Link><Link to="/contact">Contact</Link>
      </nav>
    </div>
  );
}

function RequestCard({ r, settings, onPaid }: { r: ListingRequest; settings: AppSettings; onPaid: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inReview = r.status === "pending" && r.amount_inr === 0;
  const st = inReview ? { label: "Being reviewed", cls: "gray", step: 2, icon: "clock" as IconName } : STATUS[r.status]!;
  async function payNow() {
    setBusy(true);
    try { if (await payForRequest(r.id, r.business_name)) onPaid(); } catch (e) { toast(errorText(e)); }
    setBusy(false);
  }
  const ref = `TP-${r.id.slice(0, 8).toUpperCase()}`;
  return (
    <div className="biz-req">
      <div className="row">
        <span className={`icon-chip sm ${r.status === "pending" ? "amber" : r.status === "declined" ? "coral" : r.status === "paid" ? "sky" : ""}`}><Icon name={st.icon} size={16} /></span>
        <span className="strong grow ellipsis">{r.business_name}</span>
        <span className={`badge ${st.cls}`}>{st.label}</span>
      </div>
      <div className={`biz-track ${r.status === "declined" ? "red" : ""}`} aria-hidden="true">{[1, 2, 3].map((s) => <span key={s} className={s <= st.step ? "on" : ""} />)}</div>
      <span className="small muted">{[r.category, r.area, r.city].filter(Boolean).join(" · ")} · {rupees(r.amount_inr)} · {timeAgo(r.created_at)}</span>
      {r.status === "pending" && r.amount_inr > 0 && (
        <button type="button" className="btn small green block" disabled={busy} onClick={payNow}>
          <Icon name="wallet" size={16} />{busy ? "Opening…" : `Pay ${rupees(r.amount_inr)} with Razorpay`}
        </button>
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
