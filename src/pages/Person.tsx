import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { supabase, PROFILE_COLS } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useFollowing } from "../lib/follows";
import type { Profile, ReviewRow } from "../lib/types";
import { Avatar, Spinner, TopBar, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT } from "../components/ReviewCard";

export default function Person() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const me = session?.user.id;
  const toast = useToast();
  const { following, toggleFollow } = useFollowing(me);
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [followers, setFollowers] = useState(0);

  useEffect(() => {
    supabase.from("profiles").select(PROFILE_COLS).eq("id", id).maybeSingle().then(({ data }) => setP((data as Profile) ?? null));
    supabase.from("reviews").select(REVIEW_SELECT).eq("user_id", id).eq("status", "published").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setReviews((data as unknown as ReviewRow[]) || []));
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", id).then(({ count }) => setFollowers(count ?? 0));
  }, [id]);

  if (me && id === me) return <Navigate to="/me" replace />;
  if (p === undefined) return <div className="page"><Spinner /></div>;
  if (!p) return <div className="page"><TopBar /><div className="empty"><h2>Person not found</h2></div></div>;

  const on = following.has(id);
  const verified = reviews.filter((r) => r.visit_id).length;

  async function toggle() {
    if (!me) { toast("Sign in to follow people"); return; }
    const e = await toggleFollow(id);
    if (e) toast(e); else setFollowers((n) => n + (on ? -1 : 1));
  }

  return (
    <div className="page">
      <TopBar />
      <div className="row" style={{ gap: 14 }}>
        <Avatar id={p.id} name={p.display_name} path={p.avatar_path} size="lg" />
        <div className="grow stack tight">
          <span className="strong" style={{ fontSize: 18 }}>{p.display_name || "Someone"}</span>
          {p.city && <span className="small muted">{p.city}</span>}
        </div>
        <button className={`btn small ${on ? "ghost" : ""}`} onClick={toggle}>{on ? "Following" : "Follow"}</button>
      </div>
      <div className="stats">
        <div><div className="n">{reviews.length}</div><div className="l">reviews</div></div>
        <div><div className="n">{followers}</div><div className="l">followers</div></div>
        <div><div className="n">{verified}</div><div className="l">verified</div></div>
      </div>
      <div className="stack">
        {reviews.length === 0 ? <div className="empty"><p>No reviews yet.</p></div> : reviews.map((r) => <ReviewCard key={r.id} r={r} showPlace />)}
      </div>
    </div>
  );
}
