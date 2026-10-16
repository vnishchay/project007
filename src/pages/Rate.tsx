import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/util";
import { Icon } from "../components/ui";
import { Chip, EmptyArt, SectionTitle, lookFor } from "../components/home/Kit";
import "../styles/home.css";

interface PlaceLite { id: string; name: string; category: string; area: string | null; city: string }
interface VisitRow { place_id: string; scanned_at: string; expires_at: string; places: PlaceLite | null }

// "Write a review": pick the place, recent verified visits first.
export default function Rate() {
  const { session } = useAuth();
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [text, setText] = useState("");
  const [places, setPlaces] = useState<PlaceLite[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!session) return;
    supabase.from("visits").select("place_id, scanned_at, expires_at, places(id, name, category, area, city)")
      .eq("user_id", session.user.id).order("scanned_at", { ascending: false }).limit(20)
      .then(({ data }) => {
        const seen = new Set<string>();
        setVisits(((data as unknown as VisitRow[]) || []).filter((v) => v.places && !seen.has(v.place_id) && seen.add(v.place_id)).slice(0, 5));
      });
  }, [session]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const q = text.trim().replace(/[%,()]/g, " ");
      let req = supabase.from("places").select("id, name, category, area, city").eq("status", "live").order("name").limit(40);
      if (q) req = req.or(`name.ilike.%${q}%,category.ilike.%${q}%,area.ilike.%${q}%,city.ilike.%${q}%`);
      req.then(({ data, error }) => {
        if (!alive) return;
        setErr(error ? errorText(error) : "");
        setPlaces((data as PlaceLite[]) || []);
      });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [text]);

  const row = (p: PlaceLite, sub?: string, live?: boolean) => {
    const look = lookFor(p.category);
    return (
      <Link key={p.id} to={`/review/${p.id}`} className="menu-row">
        <Chip icon={look.icon} tone={look.tone} />
        <span className="grow stack tight" style={{ minWidth: 0 }}>
          <span className="t ellipsis">{p.name}</span>
          <span className="s ellipsis">{sub || [p.category, p.area, p.city].filter(Boolean).join(" · ")}</span>
        </span>
        {live && <span className="pill verified"><Icon name="verified" size={13} />Verified</span>}
        <Icon name="chev" size={18} color="var(--muted)" />
      </Link>
    );
  };

  return (
    <div className="page" style={{ gap: 18 }}>
      <header className="hero sunset compact">
        <span className="hero-sub"><Icon name="star" size={16} fill="#fff" />Rate</span>
        <h1>What did you have?</h1>
        <Link to="/scan" className="btn white block" style={{ color: "#b2401f" }}><Icon name="scan" size={18} />Scan the table QR</Link>
        <span className="hero-sub" style={{ justifyContent: "center", fontSize: 12 }}><Icon name="verified" size={14} />Scanning adds a verified badge</span>
      </header>

      {visits.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <SectionTitle icon="clock" tone="sky">Recent visits</SectionTitle>
          <div className="menu">
            {visits.map((v) => row(v.places!, `Scanned ${timeAgo(v.scanned_at)}`, new Date(v.expires_at).getTime() > Date.now()))}
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <SectionTitle icon="store" tone="green">Find the place</SectionTitle>
        <div className="search"><Icon name="search" color="var(--muted)" /><input aria-label="Search places" placeholder="Name, area or kind of place" value={text} onChange={(e) => setText(e.target.value)} /></div>
        {err && <div className="notice err">{err}</div>}
        {places === null ? <div className="skeleton" /> : places.length === 0 ? (
          <div className="card">
            <EmptyArt icon="search" tone="sky" title={`No “${text.trim()}” listed`}>
              <Link to="/business" className="btn small ghost"><Icon name="store" size={16} />Get it listed</Link>
            </EmptyArt>
          </div>
        ) : <div className="menu">{places.map((p) => row(p))}</div>}
      </section>
    </div>
  );
}
