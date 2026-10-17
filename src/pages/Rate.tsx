import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/util";
import { Icon } from "../components/ui";
import { Chip, EmptyArt, SectionTitle, lookFor } from "../components/home/Kit";
import "../styles/home.css";

interface PlaceLite { id: string; name: string; category: string; area: string | null; city: string }
interface VisitRow { place_id: string; scanned_at: string; expires_at: string; places: PlaceLite | null }

// "Rate": reviews come only from a table QR scan, so this is a scan button plus your visits.
export default function Rate() {
  const { session } = useAuth();
  const [visits, setVisits] = useState<VisitRow[]>([]);

  useEffect(() => {
    if (!session) return;
    supabase.from("visits").select("place_id, scanned_at, expires_at, places(id, name, category, area, city)")
      .eq("user_id", session.user.id).order("scanned_at", { ascending: false }).limit(20)
      .then(({ data }) => {
        const seen = new Set<string>();
        setVisits(((data as unknown as VisitRow[]) || []).filter((v) => v.places && !seen.has(v.place_id) && seen.add(v.place_id)).slice(0, 5));
      });
  }, [session]);

  // An open visit goes to the review form; an old one only to the place page (reading).
  const row = (p: PlaceLite, sub: string, live: boolean) => {
    const look = lookFor(p.category);
    return (
      <Link key={p.id} to={live ? `/review/${p.id}` : `/p/${p.id}`} className="menu-row">
        <Chip icon={look.icon} tone={look.tone} />
        <span className="grow stack tight" style={{ minWidth: 0 }}>
          <span className="t ellipsis">{p.name}</span>
          <span className="s ellipsis">{sub || [p.category, p.area, p.city].filter(Boolean).join(" · ")}</span>
        </span>
        {live && <span className="pill verified"><Icon name="star" size={13} />Rate now</span>}
        <Icon name="chev" size={18} color="var(--muted)" />
      </Link>
    );
  };

  return (
    <div className="page" style={{ gap: 18 }}>
      <header className="hero sunset compact">
        <span className="hero-sub"><Icon name="star" size={16} fill="#fff" />Rate</span>
        <h1>At a shop? Scan to rate</h1>
        <Link to="/scan" className="btn white block" style={{ color: "#b2401f" }}><Icon name="scan" size={18} />Scan the table QR</Link>
        <span className="hero-sub" style={{ justifyContent: "center", fontSize: 12 }}><Icon name="verified" size={14} />Reviews come only from real visits</span>
      </header>

      {visits.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <SectionTitle icon="clock" tone="sky">Your visits</SectionTitle>
          <div className="menu">
            {visits.map((v) => row(v.places!, `Scanned ${timeAgo(v.scanned_at)}`, new Date(v.expires_at).getTime() > Date.now()))}
          </div>
        </section>
      )}

      <section className="card soft stack" style={{ gap: 8 }}>
        <div className="row"><span className="icon-chip sm"><Icon name="shield" size={16} /></span><span className="strong grow">Why scan?</span></div>
        <p className="small muted">Only people at the shop can review it, so every rating here is from a real visit. Reviews stay anonymous unless you choose to show your name.</p>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <SectionTitle icon="store" tone="green">Shop not listed?</SectionTitle>
        <div className="card">
          <EmptyArt icon="store" tone="sky" title="Ask them to join Trusted Picks">
            <Link to="/business" className="btn small ghost"><Icon name="store" size={16} />List a business</Link>
          </EmptyArt>
        </div>
      </section>
    </div>
  );
}
