import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, PROFILE_COLS, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Profile, SearchResult, Topic } from "../lib/types";
import { distanceText, getLocation, priceText, type Coords } from "../lib/util";
import { Avatar, Icon } from "../components/ui";

export default function Discover() {
  const { profile, session } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const [text, setText] = useState(q);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locState, setLocState] = useState<"asking" | "on" | "off">("asking");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.from("topics").select("id, name").order("name").then(({ data }) => setTopics((data as Topic[]) || []));
    getLocation().then((c) => { setCoords(c); setLocState(c ? "on" : "off"); });
  }, []);

  useEffect(() => {
    if (locState === "asking") return;
    let cancelled = false;
    setResults(null); setErr("");
    supabase.rpc("search_places", {
      p_query: q || null,
      p_lat: coords?.lat ?? null,
      p_lng: coords?.lng ?? null,
      p_radius_m: 8000,
      p_city: coords ? null : profile?.city || null,
      p_limit: 30,
    }).then(async ({ data, error }) => {
      if (cancelled) return;
      if (error) { setErr(errorText(error)); setResults([]); return; }
      const rows = (data as SearchResult[]) || [];
      setResults(rows);
      const ids = [...new Set(rows.flatMap((r) => r.friend_ids || []))].slice(0, 100);
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select(PROFILE_COLS).in("id", ids);
        if (!cancelled) setPeople(Object.fromEntries(((ps as Profile[]) || []).map((p) => [p.id, p])));
      }
    });
    return () => { cancelled = true; };
  }, [q, coords, locState, profile?.city, session?.user.id]);

  const where = useMemo(() => (coords ? "Near you" : profile?.city ? profile.city : "Everywhere"), [coords, profile?.city]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = text.trim();
    setParams(v ? { q: v } : {});
  }

  return (
    <div className="page">
      <div className="row between">
        <div className="row" style={{ gap: 6 }}>
          <Icon name="pin" size={16} color="var(--green)" />
          <span className="small strong">{where}</span>
          {locState === "off" && <button className="link-btn tiny" onClick={() => getLocation().then((c) => { setCoords(c); setLocState(c ? "on" : "off"); })}>Use my location</button>}
        </div>
        {!session && <Link to="/signin" className="small strong">Sign in</Link>}
      </div>

      <h1>{q ? <>Best <span className="green">{q}</span> {coords ? "near you" : ""}</> : "What are you craving?"}</h1>

      <form className="search" onSubmit={submit} role="search">
        <Icon name="search" color="var(--muted)" />
        <input aria-label="Search" placeholder="Pizza, filter coffee, haircut…" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="search" />
        {q && <button type="button" className="link-btn" onClick={() => { setText(""); setParams({}); }} aria-label="Clear search"><Icon name="close" size={18} color="var(--muted)" /></button>}
      </form>

      {topics.length > 0 && (
        <div className="chips scroll">
          {topics.map((t) => (
            <button key={t.id} className={`chip ${q.toLowerCase() === t.name.toLowerCase() ? "on" : ""}`} onClick={() => { setText(t.name); setParams({ q: t.name }); }}>{t.name}</button>
          ))}
        </div>
      )}

      <div className="stack" style={{ gap: 0 }}>
        <div className="row between" style={{ paddingBottom: 4 }}>
          <h2>{q ? "Ranked by people you trust" : "Places on Trusted Picks"}</h2>
          {session ? null : <span className="tiny muted">Sign in to rank by friends</span>}
        </div>
        {err && <div className="notice err">{err}</div>}
        {results === null ? (
          <div className="stack" style={{ marginTop: 10 }}><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        ) : results.length === 0 ? (
          <div className="empty">
            <p>{q ? `No listed places match “${q}” yet.` : "No places are listed here yet."}</p>
            <Link to="/business" className="link-btn">Own a business? Get listed</Link>
          </div>
        ) : (
          <div className="list">
            {results.map((r) => (
              <Link key={r.place_id} to={`/p/${r.place_id}`} className="list-item">
                <div className="grow stack tight">
                  <span className="strong ellipsis" style={{ fontSize: 16 }}>{r.name}</span>
                  <span className="small muted ellipsis">{[r.category, r.area, priceText(r.price_level), distanceText(r.distance_m)].filter(Boolean).join(" · ")}</span>
                  {r.friend_count > 0 ? (
                    <span className="row" style={{ gap: 8, marginTop: 4 }}>
                      <span className="avatars">{r.friend_ids.slice(0, 3).map((id) => <Avatar key={id} id={id} name={people[id]?.display_name} path={people[id]?.avatar_path} size="sm" />)}</span>
                      <span className="tiny muted ellipsis">{friendLine(r, people)}</span>
                    </span>
                  ) : r.review_count > 0 ? (
                    <span className="tiny muted">{r.review_count} review{r.review_count > 1 ? "s" : ""}{r.verified_count ? ` · ${r.verified_count} verified` : ""}{r.top_item ? ` · loved: ${r.top_item}` : ""}</span>
                  ) : <span className="tiny muted">No reviews yet</span>}
                </div>
                {r.trust_score != null ? <span className="score">{Number(r.trust_score).toFixed(1)}</span> : <span className="score none">New</span>}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Link to="/business" className="card soft" style={{ color: "inherit" }}>
        <div className="row"><Icon name="store" color="var(--green)" /><span className="strong grow">List your business</span><Icon name="chev" size={16} color="var(--muted)" width={2.4} /></div>
        <span className="small muted">Collect item-level reviews from verified diners with your own table QR.</span>
      </Link>
    </div>
  );
}

function friendLine(r: SearchResult, people: Record<string, Profile>): string {
  const names = r.friend_ids.map((id) => people[id]?.display_name?.split(" ")[0]).filter(Boolean) as string[];
  const shown = names.slice(0, 2).join(", ");
  const more = r.friend_count - Math.min(names.length, 2);
  const who = shown ? (more > 0 ? `${shown} +${more}` : shown) : `${r.friend_count} friend${r.friend_count > 1 ? "s" : ""}`;
  return r.top_item ? `${who} rated the ${r.top_item}` : `${who} reviewed this`;
}
