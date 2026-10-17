import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { loadPlans, type PlanRow } from "../lib/billing";
import { initials, rupees } from "../lib/util";
import { Icon, TopBar, type IconName } from "../components/ui";
import { MediaImg } from "../components/manage/MediaImg";
import "../styles/manage.css";

interface MyPlace { id: string; name: string; area: string | null; city: string; status: string; listed_until: string | null; cover_path: string | null; logo_path: string | null; verification?: string; verification_note?: string | null }

export default function Business() {
  const { session } = useAuth();
  const [shops, setShops] = useState<MyPlace[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);

  const load = () => {
    if (!session) return;
    supabase.rpc("my_places").then(({ data, error }) => { if (!error) setShops((data as MyPlace[]) || []); });
  };
  useEffect(load, [session]);
  useEffect(() => { loadPlans().then((p) => setPlans(p.filter((x) => x.code !== "trial"))); }, []);

  const startUrl = session ? "/business/setup" : "/signin?next=/business/setup";

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
        <Link to={startUrl} className="btn small"><Icon name="plus" size={17} />List my shop</Link>
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
                  <span className="mg-meta">{[s.area, s.city].filter(Boolean).join(" · ")}<span className={`badge ${s.status === "live" ? "" : s.status === "lapsed" ? "warn" : "red"}`}>{s.status}</span>
                    {s.verification === "pending" && <span className="badge gray">Being checked</span>}</span>
                  {s.verification === "rejected" && <span className="tiny" style={{ color: "var(--danger)" }}>Not approved{s.verification_note ? `: ${s.verification_note}` : ""}</span>}
                </span>
                <span className="icon-chip sm"><Icon name="edit" size={15} /></span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="biz-steps">
        {([
          ["store", "", "Your shop", "Details and links"],
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

      <Link to={startUrl} className="biz-start">
        <span className="icon-chip lg"><Icon name="store" size={24} /></span>
        <span className="grow stack tight"><span className="strong" style={{ fontSize: 17 }}>Set up my shop</span><span className="small muted">{session ? "Six quick screens. Free to start." : "Sign in, then six quick screens. Free to start."}</span></span>
        <span className="biz-start-go"><Icon name="chev" size={20} /></span>
      </Link>
      <nav className="row wrap tiny muted center" style={{ gap: 12, justifyContent: "center", marginTop: 8 }}>
        <Link to="/pricing">Pricing</Link><Link to="/terms">Terms</Link><Link to="/refunds">Refunds</Link><Link to="/privacy">Privacy</Link><Link to="/contact">Contact</Link>
      </nav>
    </div>
  );
}
