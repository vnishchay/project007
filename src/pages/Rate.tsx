import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/util";
import { Icon } from "../components/ui";

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

  const row = (p: PlaceLite, sub?: string, live?: boolean) => (
    <Link key={p.id} to={`/review/${p.id}`} className="list-item">
      <div className="grow stack tight">
        <span className="strong ellipsis">{p.name}</span>
        <span className="small muted ellipsis">{sub || [p.category, p.area, p.city].filter(Boolean).join(" · ")}</span>
      </div>
      {live && <span className="badge">✓ Verified</span>}
      <Icon name="chev" size={16} color="var(--muted)" width={2.4} />
    </Link>
  );

  return (
    <div className="page">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Rate what you had</h1>
        <p className="muted">Pick the place. Scan the table QR first to get a verified badge.</p>
      </div>
      <Link to="/scan" className="card soft row" style={{ color: "inherit", flexDirection: "row" }}>
        <Icon name="scan" color="var(--green)" /><span className="grow strong">Scan the table QR</span><Icon name="chev" size={16} color="var(--muted)" width={2.4} />
      </Link>

      {visits.length > 0 && (
        <div className="stack" style={{ gap: 0 }}>
          <h2>Recent visits</h2>
          <div className="list">
            {visits.map((v) => row(v.places!, `Scanned ${timeAgo(v.scanned_at)}`, new Date(v.expires_at).getTime() > Date.now()))}
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 0 }}>
        <h2 style={{ paddingBottom: 10 }}>Find the place</h2>
        <div className="search"><Icon name="search" color="var(--muted)" /><input aria-label="Search places" placeholder="Name, area or kind of place" value={text} onChange={(e) => setText(e.target.value)} /></div>
        {err && <div className="notice err" style={{ marginTop: 10 }}>{err}</div>}
        {places === null ? <div className="skeleton" style={{ marginTop: 10 }} /> : places.length === 0 ? (
          <div className="empty"><p>No listed place matches “{text.trim()}”.</p><Link to="/business" className="link-btn">Ask the place to get listed</Link></div>
        ) : <div className="list">{places.map((p) => row(p))}</div>}
      </div>
    </div>
  );
}
