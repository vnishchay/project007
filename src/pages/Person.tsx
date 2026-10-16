import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { supabase, PROFILE_COLS, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useFollowing } from "../lib/follows";
import type { Profile, ReviewRow } from "../lib/types";
import { Avatar, Spinner, TopBar, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT, REVIEW_FEED } from "../components/ReviewCard";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TopicStat { review_count: number; is_expert: boolean; topics: { name: string } | null }

export default function Person() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const me = session?.user.id;
  const toast = useToast();
  const { following, toggleFollow, pending } = useFollowing(me);
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [followers, setFollowers] = useState<number | null>(null);
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
      supabase.from(REVIEW_FEED).select(REVIEW_SELECT).eq("user_id", id).eq("status", "published").order("created_at", { ascending: false }).limit(50),
      // Only signed-in people may read the follow graph.
      supabase.rpc("person_stats", { p_user: id }),
      supabase.from("user_topic_stats").select("review_count, is_expert, topics(name)").eq("user_id", id).eq("is_expert", true),
    ]).then(([pr, rv, fl, ts]) => {
      if (!alive) return;
      const e = pr.error || rv.error;
      if (e) { setErr(errorText(e)); return; }
      setP((pr.data as Profile) ?? null);
      setReviews((rv.data as unknown as ReviewRow[]) || []);
      setFollowers(fl.error ? null : (((fl.data as { followers: number }[] | null) || [])[0]?.followers ?? 0));
      setExpertOn(ts.error ? [] : ((ts.data || []) as unknown as TopicStat[]).map((t) => t.topics?.name || "").filter(Boolean));
    });
    return () => { alive = false; };
  }, [id, me, key]);

  const retry = useCallback(() => setKey((k) => k + 1), []);

  if (me && id === me) return <Navigate to="/me" replace />;
  if (err) return (
    <div className="page">
      <TopBar />
      <div className="notice err row" role="alert">
        <span className="grow">Couldn't load this profile: {err}</span>
        <button type="button" className="link-btn strong" style={{ color: "var(--danger)" }} onClick={retry}>Retry</button>
      </div>
    </div>
  );
  if (p === undefined) return <div className="page"><TopBar /><Spinner /></div>;
  if (!p) return (
    <div className="page">
      <TopBar />
      <div className="empty"><h2>Person not found</h2><p>This profile doesn't exist or was removed.</p><Link to="/circle" className="btn ghost">Back to your circle</Link></div>
    </div>
  );

  const on = following.has(id);
  const busy = pending.has(id);
  const verified = reviews.filter((r) => r.verified).length;
  const name = p.display_name || "Someone";

  async function toggle() {
    if (!me) { toast("Sign in to follow people"); return; }
    const e = await toggleFollow(id);
    if (e) toast(e); else setFollowers((n) => (n == null ? n : Math.max(0, n + (on ? -1 : 1))));
  }

  return (
    <div className="page">
      <TopBar />
      <div className="row" style={{ gap: 14 }}>
        <Avatar id={p.id} name={p.display_name} path={p.avatar_path} size="lg" />
        <div className="grow stack tight">
          <span className="strong" style={{ fontSize: 18 }}>{name}</span>
          {p.city && <span className="small muted">{p.city}</span>}
          {expertOn.length > 0 && (
            <span className="row wrap" style={{ gap: 6 }}>{expertOn.map((t) => <span key={t} className="badge">{t} expert</span>)}</span>
          )}
        </div>
        {me ? (
          <button type="button" className={`btn small ${on ? "ghost" : ""}`} onClick={toggle} disabled={busy}
            aria-pressed={on} aria-label={`${on ? "Following" : "Follow"} ${name}`}>
            {on ? "Following" : "Follow"}
          </button>
        ) : (
          <Link to={`/signin?next=${encodeURIComponent(`/u/${id}`)}`} className="btn small">Follow</Link>
        )}
      </div>
      <div className="stats">
        <div><div className="n">{reviews.length}{reviews.length >= 50 ? "+" : ""}</div><div className="l">reviews</div></div>
        <div><div className="n">{followers ?? "–"}</div><div className="l">followers</div></div>
        <div><div className="n">{verified}</div><div className="l">verified</div></div>
      </div>
      <div className="stack">
        {reviews.length === 0
          ? <div className="empty"><p>{name} hasn't reviewed anything yet.</p></div>
          : reviews.map((r) => <ReviewCard key={r.id} r={r} showPlace />)}
      </div>
    </div>
  );
}
