import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, searchPlaces, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Place, ReviewRow, SearchResult } from "../lib/types";
import { fetchGoogleRating, type GoogleRating } from "../lib/google";
import { copyText, googleMapsUrl, placeUrl, priceText, todaysHours } from "../lib/util";
import { Icon, Spinner, TopBar, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT, REVIEW_FEED } from "../components/ReviewCard";

interface ItemStat { item_id: string; avg_rating: number; review_count: number; verified_count: number; items: { name: string } | null }

export const PLACE_COLS = "id, google_place_id, name, category, area, city, about, hours, price_level, status, listed_until, created_at";

export default function PlacePage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const me = session?.user.id;
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [stats, setStats] = useState<ItemStat[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [google, setGoogle] = useState<GoogleRating | null>(null);
  const [summary, setSummary] = useState<SearchResult | null>(null);
  const [experts, setExperts] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [allHours, setAllHours] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setErr(""); setLoadErr("");
      const { data, error } = await supabase.from("places").select(PLACE_COLS).eq("id", id).maybeSingle();
      if (!alive) return;
      if (error) { setErr(errorText(error)); setPlace(null); return; }
      setPlace(data as Place | null);
      if (!data) return;
      if ((data as Place).google_place_id) fetchGoogleRating((data as Place).google_place_id!).then((g) => alive && setGoogle(g));
      const [s, r, sc] = await Promise.all([
        supabase.from("item_stats").select("item_id, avg_rating, review_count, verified_count, items(name)").eq("place_id", id).order("avg_rating", { ascending: false }),
        supabase.from(REVIEW_FEED).select(REVIEW_SELECT).eq("place_id", id).eq("status", "published").order("created_at", { ascending: false }).limit(100),
        // Same score as Discover: one formula, computed in the database.
        searchPlaces({ p_place: id, p_limit: 1 }),
      ]);
      if (!alive) return;
      const firstErr = s.error || r.error || sc.error;
      if (firstErr) setLoadErr(errorText(firstErr));
      setStats((s.data as unknown as ItemStat[]) || []);
      const rows = (r.data as unknown as ReviewRow[]) || [];
      setReviews(rows);
      setSummary(((sc.data as SearchResult[]) || [])[0] ?? null);
      const uids = [...new Set(rows.map((x) => x.user_id).filter((u): u is string => Boolean(u)))];
      if (uids.length) {
        const { data: ex } = await supabase.from("user_topic_stats").select("user_id, topics(name)").eq("is_expert", true).in("user_id", uids);
        if (alive) setExperts(Object.fromEntries(((ex || []) as unknown as { user_id: string; topics: { name: string } | null }[]).map((e) => [e.user_id, e.topics?.name || ""])));
      }
    })();
    return () => { alive = false; };
  }, [id, me, attempt]);

  useEffect(() => {
    if (!me) return;
    supabase.from("follows").select("followee_id").eq("follower_id", me).then(({ data }) => setFollowing(new Set((data || []).map((f) => f.followee_id as string))));
    supabase.from("saved_places").select("place_id").eq("user_id", me).eq("place_id", id).maybeSingle().then(({ data }) => setSaved(Boolean(data)));
  }, [me, id]);

  const score = summary?.trust_score != null ? Number(summary.trust_score) : null;
  const friendReviewers = summary?.friend_count ?? 0;
  const verified = reviews.filter((r) => r.verified).length;
  const best = stats.filter((s) => s.review_count >= 1).slice(0, 5);
  const sorted = useMemo(() => [...reviews].sort((a, b) => Number(Boolean(b.user_id && following.has(b.user_id))) - Number(Boolean(a.user_id && following.has(a.user_id)))), [reviews, following]);

  async function toggleSave() {
    if (!me) { toast("Sign in to save places"); return; }
    if (saved) {
      const { error } = await supabase.from("saved_places").delete().eq("user_id", me).eq("place_id", id);
      if (error) toast(errorText(error)); else { setSaved(false); toast("Removed from saved"); }
    } else {
      const { error } = await supabase.from("saved_places").insert({ user_id: me, place_id: id });
      if (error) toast(errorText(error)); else { setSaved(true); toast("Saved"); }
    }
  }

  async function share() {
    const url = placeUrl(id);
    if (navigator.share) { try { await navigator.share({ title: place?.name, url }); } catch { /* dismissed */ } }
    else if (await copyText(url)) toast("Link copied");
  }

  if (place === undefined) return <div className="page"><Spinner /></div>;
  if (!place) return <div className="page"><TopBar /><div className="empty"><h2>This place isn't listed</h2><p>{err || "It may have been removed or its listing has lapsed."}</p></div></div>;

  return (
    <div className="page">
      <TopBar right={<>
        <button className="icon-btn" aria-label={saved ? "Unsave" : "Save"} onClick={toggleSave}><Icon name="bookmark" color={saved ? "var(--green)" : "currentColor"} /></button>
        <button className="icon-btn" aria-label="Share" onClick={share}><Icon name="share" /></button>
      </>} />

      <div className="stack" style={{ gap: 6 }}>
        <h1>{place.name}</h1>
        <span className="muted small">{[place.category, place.area, place.city, priceText(place.price_level)].filter(Boolean).join(" · ")}</span>
        <span className="row wrap" style={{ gap: 6 }}><span className="badge">✓ Listed</span>{summary?.has_qr && <span className="badge">QR on tables</span>}{verified > 0 && <span className="badge gray">{verified} verified visit{verified > 1 ? "s" : ""}</span>}</span>
      </div>

      {loadErr && <div className="notice err row"><span className="grow">Couldn't load everything: {loadErr}</span><button className="link-btn" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>}

      <div className="grid2">
        <div className="card soft" style={{ gap: 2 }}>
          <span className="tiny muted strong">{me && friendReviewers > 0 ? "Your circle" : "Trusted Picks"}</span>
          <span style={{ fontSize: 30, fontWeight: 800, color: "var(--green)" }}>{score != null ? score.toFixed(1) : "–"}</span>
          <span className="tiny muted">{me && friendReviewers ? `from ${friendReviewers} friend${friendReviewers > 1 ? "s" : ""}` : `${reviews.length} review${reviews.length === 1 ? "" : "s"}`}</span>
        </div>
        <div className="card soft" style={{ gap: 2 }}>
          <span className="tiny muted strong">Google</span>
          {google ? <>
            <span style={{ fontSize: 30, fontWeight: 800 }}>{google.rating.toFixed(1)}</span>
            <span className="tiny muted">from {google.count.toLocaleString("en-IN")} people</span>
          </> : <>
            <span style={{ fontSize: 30, fontWeight: 800, color: "var(--muted)" }}>–</span>
            {place.google_place_id ? <a className="tiny" href={googleMapsUrl(place.google_place_id, place.name)} target="_blank" rel="noreferrer">See on Google Maps</a> : <span className="tiny muted">Not linked</span>}
          </>}
        </div>
      </div>

      {google && score != null && google.rating - score >= 0.5 && (
        <div className="notice warn small">{google.rating.toFixed(1)} on Google, but {me && friendReviewers > 0 ? "your circle rates" : "Trusted Picks reviewers rate"} it {score.toFixed(1)}{summary?.top_item ? `. Most rated: ${summary.top_item}` : ""}.</div>
      )}

      {place.about && <p style={{ lineHeight: 1.55, color: "var(--ink-2)" }}>{place.about}</p>}
      {place.hours && Object.keys(place.hours).length > 0 && (
        <div className="small muted stack tight">
          <span className="row" style={{ gap: 8 }}>
            <span><b>Today</b> {todaysHours(place.hours) ?? "Closed"}</span>
            <button className="link-btn tiny" onClick={() => setAllHours(!allHours)} aria-expanded={allHours}>{allHours ? "Hide hours" : "All hours"}</button>
          </span>
          {allHours && Object.entries(place.hours).map(([d, h]) => <div key={d}><b>{d}</b> {h}</div>)}
        </div>
      )}

      {best.length > 0 && (
        <div className="stack">
          <h2>Best things here</h2>
          {best.map((s) => (
            <div key={s.item_id} className="stack tight">
              <div className="row between"><span className="small strong">{s.items?.name}</span><span className="small"><b>{Number(s.avg_rating).toFixed(1)}</b> <span className="muted">· {s.review_count}</span></span></div>
              <div className="bar"><span style={{ width: `${(Number(s.avg_rating) / 5) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <Link to={`/review/${place.id}`} className="btn grow">Rate something you had</Link>
        <Link to="/scan" className="btn ghost" aria-label="Scan the table QR for a verified visit"><Icon name="scan" />Scan QR</Link>
      </div>

      <div className="stack">
        <h2>Reviews</h2>
        {sorted.length === 0 ? <div className="empty"><p>No reviews yet. Be the first.</p></div> :
          sorted.map((r) => <ReviewCard key={r.id} r={r} mine={Boolean(me && r.user_id === me)} friend={Boolean(r.user_id && following.has(r.user_id))} expert={r.user_id ? experts[r.user_id] || null : null} />)}
      </div>

      {google && <p className="tiny muted center">Google rating shown live from Google Maps.</p>}
    </div>
  );
}
