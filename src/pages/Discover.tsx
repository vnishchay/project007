import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, searchPlaces, PROFILE_COLS, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Profile, SearchResult, Topic } from "../lib/types";
import { distanceText, priceText } from "../lib/util";
import { useWhere, whereLabel } from "../lib/location";
import { fetchGoogleRating } from "../lib/google";
import { Avatar, Icon } from "../components/ui";
import { LocationPicker } from "../components/LocationPicker";

export default function Discover() {
  const { profile, session, loading, isGuest } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const [text, setText] = useState(q);
  const [topics, setTopics] = useState<Topic[]>([]);
  const { where, effective, coords, locating, denied, setWhere } = useWhere(profile?.city);
  const [picking, setPicking] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.from("topics").select("id, name").order("name").then(({ data }) => setTopics((data as Topic[]) || []));
  }, []);

  const whereKey = JSON.stringify(effective);
  useEffect(() => {
    let cancelled = false;
    setResults(null); setErr("");
    const near = effective.kind === "near" && coords;
    searchPlaces({
      p_query: q || null,
      p_lat: near ? coords.lat : null,
      p_lng: near ? coords.lng : null,
      p_radius_m: 15000,
      p_city: effective.kind === "city" || effective.kind === "area" ? effective.city : null,
      p_area: effective.kind === "area" ? effective.area : null,
      p_limit: 60,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, whereKey, coords, session?.user.id]);

  // Like the design: flag when Google's rating hides a weaker one from people you trust.
  const [gap, setGap] = useState<{ name: string; google: number; ours: number; item: string | null; id: string } | null>(null);
  useEffect(() => {
    setGap(null);
    const r = (results || []).find((x) => x.google_place_id && x.trust_score != null && (x.friend_count > 0 || !session));
    if (!r) return;
    let alive = true;
    fetchGoogleRating(r.google_place_id!).then((g) => {
      if (alive && g && g.rating - Number(r.trust_score) >= 0.5) setGap({ name: r.name, google: g.rating, ours: Number(r.trust_score), item: q || r.top_item, id: r.place_id });
    });
    return () => { alive = false; };
  }, [results, session, q]);

  const label = locating ? "Finding you…" : whereLabel(effective);
  const friendsHere = new Set((results || []).flatMap((r) => r.friend_ids || [])).size;
  const farthest = Math.max(0, ...(results || []).map((r) => r.distance_m ?? 0));

  // Voice search, where the browser supports speech recognition.
  type Rec = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };
  const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
    || (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  function voiceSearch() {
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript?.trim().replace(/[.?!]$/, "") || "";
      const clean = said.replace(/^(best|find|show me|search for)\s+/i, "").replace(/\s+near (me|by)$/i, "");
      if (clean) { setText(clean); setParams({ q: clean }); }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }
  const nearYou = effective.kind === "near";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = text.trim();
    setParams(v ? { q: v } : {});
  }

  return (
    <div className="page">
      <div className="row between">
        <button className="where-btn" onClick={() => setPicking(true)} aria-haspopup="dialog" aria-label={`Location: ${label}. Change location`}>
          <Icon name="pin" size={16} color="var(--green)" />
          <span className="small strong ellipsis" style={{ maxWidth: 220 }}>{label}</span>
          <Icon name="down" size={16} color="var(--muted)" width={2.4} />
        </button>
        {loading ? null : session && !isGuest ? (
          <Link to="/me" aria-label="Your profile"><Avatar id={session.user.id} name={profile?.display_name || session.user.email} path={profile?.avatar_path} /></Link>
        ) : <Link to="/signin" className="btn small ghost">Sign in</Link>}
      </div>
      {denied && where.kind === "near" && (
        <div className="notice small">Location is off, so we're showing {whereLabel(effective)}. <button className="link-btn" onClick={() => setPicking(true)}>Choose a location</button></div>
      )}
      {picking && <LocationPicker current={where} onPick={setWhere} onClose={() => setPicking(false)} />}

      <h1>{q ? <>Best <span className="green">{q}</span> {nearYou && coords ? "near you" : effective.kind === "all" ? "" : `in ${whereLabel(effective)}`}</> : "What are you craving?"}</h1>

      <form className="search" onSubmit={submit} role="search">
        <Icon name="search" color="var(--muted)" />
        <input aria-label="Search" placeholder="Pizza, filter coffee, haircut…" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="search" />
        {q && <button type="button" className="link-btn" onClick={() => { setText(""); setParams({}); }} aria-label="Clear search"><Icon name="close" size={18} color="var(--muted)" /></button>}
        {SR && <button type="button" className="link-btn" onClick={voiceSearch} aria-label={listening ? "Listening" : "Search by voice"} disabled={listening}><Icon name="mic" size={20} color={listening ? "var(--green)" : "var(--muted)"} /></button>}
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
          {results && results.length > 0 && <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{results.length} place{results.length > 1 ? "s" : ""}{nearYou && coords && farthest > 0 ? ` · ${Math.max(1, Math.ceil(farthest / 1000))} km` : ""}</span>}
        </div>
        {!loading && (!session || isGuest) && <Link to="/signin" className="tiny" style={{ paddingBottom: 6 }}>Sign in to rank by friends</Link>}
        {session && friendsHere > 0 && <span className="badge" style={{ alignSelf: "flex-start", marginBottom: 6 }}><Icon name="people" size={14} />{friendsHere} friend{friendsHere > 1 ? "s" : ""} reviewed places here</span>}
        {err && <div className="notice err">{err}</div>}
        {gap && <Link to={`/p/${gap.id}`} className="notice warn small" style={{ marginBottom: 8 }}><b>{gap.name}</b> is {gap.google.toFixed(1)} on Google, but {session ? "your circle rates" : "Trusted Picks reviewers rate"} {gap.item ? `its ${gap.item.toLowerCase()}` : "it"} {gap.ours.toFixed(1)}.</Link>}
        {results === null ? (
          <div className="stack" style={{ marginTop: 10 }}><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        ) : results.length === 0 ? (
          <div className="empty">
            <p>{q ? `No listed places match “${q}” in ${whereLabel(effective)} yet.` : `No places are listed in ${whereLabel(effective)} yet.`}</p>
            {effective.kind !== "all" && <button className="link-btn" onClick={() => setWhere({ kind: "all" })}>Search everywhere</button>}
            <button className="link-btn" onClick={() => setPicking(true)}>Choose another location</button>
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
