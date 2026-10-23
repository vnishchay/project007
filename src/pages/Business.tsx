import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/settings";
import { STATUS_WORDS, initials } from "../lib/util";
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

  const support = String(useSettings()[0].support_phone || "").replace(/\D/g, "");
  return (
    <div className="page">
      <TopBar title="For businesses" />

      <div className="biz-hero">
        <div className="biz-hero-art" aria-hidden="true">
          <span><Icon name="store" size={22} color="#fff" /></span><span><Icon name="star" size={22} color="#fff" fill="#fff" /></span>
          <span><Icon name="qr" size={22} color="#fff" /></span><span><Icon name="people" size={22} color="#fff" /></span>
        </div>
        <span className="biz-hero-pills"><span><Icon name="message" size={13} />Customer help</span><span><Icon name="checkCircle" size={13} />Track the outcome</span></span>
        <h1>Turn customer problems into action</h1>
        <p>Give customers a simple way to ask for help. Assign responsibility, record the fix, and let them confirm it worked.</p>
        <Link to={startUrl} className="btn small"><Icon name="plus" size={17} />Set up my shop</Link>
      </div>

      {shops.length > 0 && (
        <div className="stack">
          <div className="section-title"><span className="icon-chip sm"><Icon name="store" size={16} /></span>Your shops</div>
          {shops.map((s) => {
            return (
              <Link key={s.id} to={`/owner/${s.id}`} className="biz-shop">
                <span className="thumb"><MediaImg path={s.logo_path || s.cover_path} fallback={initials(s.name)} /></span>
                <span className="grow stack tight">
                  <span className="strong ellipsis">{s.name}</span>
                  <span className="mg-meta">{[s.area, s.city].filter(Boolean).join(" · ")}<span className={`badge ${s.status === "live" ? "" : s.status === "lapsed" ? "warn" : "red"}`}>{STATUS_WORDS[s.status] || s.status}</span>
                    {s.verification === "pending" && <span className="badge gray">We're checking your details</span>}</span>
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
          ["qr", "", "Make it easy to speak up", "A help request from your shop QR, with no public review required"],
          ["message", "amber", "Follow through", "A named person responsible, a follow-up target and a recorded response"],
          ["checkCircle", "violet", "Know what happened", "Customer confirmation, recovery costs and purchases recorded against bills"],
        ] as [IconName, string, string, string][]).map(([icon, cls, t, s], i) => (
          <div key={t} className="biz-step">
            <span className="num">{i + 1}</span>
            <span className={`icon-chip lg ${cls}`}><Icon name={icon} size={22} /></span>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
              <span className="t">{t}</span>
              <span className="s">{s}</span>
            </div>
          </div>
        ))}
      </div>

      <section className="card stack" style={{ gap: 12 }} aria-label="How the service works">
        <h2>Useful from your first customer</h2>
        <p className="small">Start at one outlet. Add your details, print a QR and show your team how to check Customer help. Help requests and private notes stay accessible on every plan, even after a review plan ends.</p>
        <p className="small muted">The help queue updates while the owner app is open. Optional background notifications need setup and permission on your device. Staff names are responsibility labels; staff invitations are not included. Keep a manager checking the queue during service.</p>
        <p className="small muted">Track actual recovery costs before deciding whether the service is worthwhile. Recorded purchases are not a claim of additional revenue or profit.</p>
      </section>

      {support && (
        <a className="btn block ghost" href={`https://wa.me/${support}`} target="_blank" rel="noopener noreferrer"><Icon name="message" size={18} />Questions? WhatsApp us</a>
      )}

      <nav className="biz-footer-nav">
        <Link to="/pricing">Pricing</Link><Link to="/terms">Terms</Link><Link to="/refunds">Refunds</Link><Link to="/privacy">Privacy</Link><Link to="/contact">Contact</Link>
      </nav>
    </div>
  );
}
