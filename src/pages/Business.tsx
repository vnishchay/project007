import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { initials } from "../lib/util";
import { Icon, TopBar, type IconName } from "../components/ui";
import { MediaImg } from "../components/manage/MediaImg";
import "../styles/manage.css";

interface MyPlace { id: string; name: string; area: string | null; city: string; status: string; listed_until: string | null; cover_path: string | null; logo_path: string | null; verification?: string; verification_note?: string | null }

export default function Business() {
  const { session } = useAuth();
  const [shops, setShops] = useState<MyPlace[]>([]);

  const load = () => {
    if (!session) return;
    supabase.rpc("my_places").then(({ data, error }) => { if (!error) setShops((data as MyPlace[]) || []); });
  };
  useEffect(load, [session]);

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
            <span className={`icon-chip lg ${cls}`}><Icon name={icon} size={22} /></span>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
              <span className="t">{t}</span>
              <span className="s">{s}</span>
            </div>
            <Icon name="chevronRight" size={16} color="var(--muted)" />
          </div>
        ))}
      </div>

      <nav className="biz-footer-nav">
        <Link to="/pricing">Pricing</Link><Link to="/terms">Terms</Link><Link to="/refunds">Refunds</Link><Link to="/privacy">Privacy</Link><Link to="/contact">Contact</Link>
      </nav>
    </div>
  );
}
