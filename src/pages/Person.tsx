import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { goBack } from "../lib/nav";
import { supabase, PROFILE_COLS, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Profile, ReviewRow } from "../lib/types";
import { Avatar, Icon, Spinner, TopBar } from "../components/ui";
import { EmptyArt, Retry } from "../components/home/Kit";
import "../styles/home.css";
import { ReviewCard, REVIEW_SELECT } from "../components/ReviewCard";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TopicStat { review_count: number; is_expert: boolean; topics: { name: string } | null }

export default function Person() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const me = session?.user.id;
  const nav = useNavigate();
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [expertOn, setExpertOn] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!UUID_RE.test(id)) { setP(null); return; }
    let alive = true;
    setP(undefined);
    setErr(null);
    Promise.all([
      supabase.from("profiles").select(PROFILE_COLS).eq("id", id).maybeSingle(),
      supabase.rpc("person_reviews", { p_user: id, p_limit: 50 }).select(REVIEW_SELECT),
      supabase.from("user_topic_stats").select("review_count, is_expert, topics(name)").eq("user_id", id).eq("is_expert", true),
    ]).then(([pr, rv, ts]) => {
      if (!alive) return;
      const e = pr.error || rv.error;
      if (e) { setErr(errorText(e)); return; }
      setP((pr.data as Profile) ?? null);
      setReviews((rv.data as unknown as ReviewRow[]) || []);
      setExpertOn(ts.error ? [] : ((ts.data || []) as unknown as TopicStat[]).map((t) => t.topics?.name || "").filter(Boolean));
    });
    return () => { alive = false; };
  }, [id, me, key]);

  const retry = useCallback(() => setKey((k) => k + 1), []);

  if (me && id === me) return <Navigate to="/me" replace />;
  if (err) return (
    <div className="page">
      <TopBar />
      <Retry msg={`Couldn't load this profile: ${err}`} onRetry={retry} />
    </div>
  );
  if (p === undefined) return <div className="page"><TopBar /><Spinner /></div>;
  if (!p) return (
    <div className="page">
      <TopBar />
      <div className="card">
        <EmptyArt icon="ghost" tone="sky" title="Person not found">
          <Link to="/" className="btn small ghost"><Icon name="home" size={16} />Discover</Link>
        </EmptyArt>
      </div>
    </div>
  );

  const verified = reviews.filter((r) => r.verified).length;
  const name = p.display_name || "Someone";


  return (
    <div className="page" style={{ gap: 18 }}>
      <header className="hero sky">
        <div className="row">
          <button type="button" className="glass-btn round" aria-label="Back" onClick={() => goBack(nav)}><Icon name="back" /></button>
          <span className="grow" />
        </div>
        <div className="row" style={{ gap: 14 }}>
          <Avatar id={p.id} name={p.display_name} path={p.avatar_path} size="lg" />
          <div className="grow stack tight" style={{ minWidth: 0 }}>
            <span className="strong ellipsis" style={{ fontSize: 22 }}>{name}</span>
            {p.city && <span className="hero-sub"><Icon name="pin" size={14} />{p.city}</span>}
          </div>
        </div>
        {expertOn.length > 0 && (
          <span className="row wrap" style={{ gap: 6 }}>{expertOn.map((t) => <span key={t} className="pill white"><Icon name="award" size={12} />{t} expert</span>)}</span>
        )}
        <div className="stat-tiles">
          <div className="stat-tile"><span className="n"><Icon name="star" size={16} />{reviews.length}{reviews.length >= 50 ? "+" : ""}</span><span className="l">reviews</span></div>
          <div className="stat-tile"><span className="n"><Icon name="store" size={16} />{new Set(reviews.map((r) => r.place_id)).size}</span><span className="l">places</span></div>
          <div className="stat-tile"><span className="n"><Icon name="verified" size={16} />{verified}</span><span className="l">verified</span></div>
        </div>
      </header>
      <div className="stack">
        {reviews.length === 0
          ? <div className="card"><EmptyArt icon="star" tone="amber" title="No named reviews yet" /></div>
          : reviews.map((r) => <ReviewCard key={r.id} r={r} showPlace />)}
      </div>
    </div>
  );
}
