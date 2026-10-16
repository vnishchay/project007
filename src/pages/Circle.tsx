import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, PROFILE_COLS } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useFollowing } from "../lib/follows";
import type { Profile, Topic } from "../lib/types";
import { copyText } from "../lib/util";
import { Avatar, Icon, useToast } from "../components/ui";

interface Stats { reviews: number; followers: number; following: number; verified: number }

export default function Circle() {
  const { session, profile } = useAuth();
  const me = session!.user.id;
  const toast = useToast();
  const { following, toggleFollow } = useFollowing(me);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trustedOn, setTrustedOn] = useState<string[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topic, setTopic] = useState<number | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [match, setMatch] = useState<Record<string, { pct: number; n: number }>>({});
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Profile[] | null>(null);

  useEffect(() => {
    supabase.rpc("my_circle_stats").then(({ data }) => setStats(((data as Stats[]) || [])[0] ?? null));
    supabase.from("user_topic_stats").select("followers_trusting, review_count, topics(name)").eq("user_id", me).order("followers_trusting", { ascending: false }).limit(2)
      .then(({ data }) => setTrustedOn(((data || []) as unknown as { topics: { name: string } | null }[]).map((d) => d.topics?.name || "").filter(Boolean)));
    supabase.from("topics").select("id, name").order("name").then(({ data }) => setTopics((data as Topic[]) || []));
  }, [me]);

  useEffect(() => {
    const ids = [...following];
    if (!ids.length) { setPeople([]); return; }
    supabase.from("profiles").select(PROFILE_COLS).in("id", ids).then(({ data }) => setPeople((data as Profile[]) || []));
  }, [following]);

  useEffect(() => {
    let query = supabase.from("taste_match").select("other_user_id, match_pct, shared_items, topic_id").eq("user_id", me);
    if (topic != null) query = query.eq("topic_id", topic);
    query.then(({ data }) => {
      const m: Record<string, { pct: number; n: number }> = {};
      for (const row of (data || []) as { other_user_id: string; match_pct: number; shared_items: number }[]) {
        const cur = m[row.other_user_id];
        // Without a topic picked, show the best-backed match across topics.
        if (!cur || row.shared_items > cur.n) m[row.other_user_id] = { pct: row.match_pct, n: row.shared_items };
      }
      setMatch(m);
    });
  }, [me, topic]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound(null); return; }
    const t = setTimeout(() => {
      supabase.from("profiles").select(PROFILE_COLS).ilike("display_name", `%${term.replace(/[%_]/g, "")}%`).neq("id", me).limit(15)
        .then(({ data }) => setFound((data as Profile[]) || []));
    }, 250);
    return () => clearTimeout(t);
  }, [q, me]);

  async function follow(id: string) {
    const e = await toggleFollow(id);
    if (e) toast(e);
  }

  async function invite() {
    const url = window.location.origin;
    const text = "I'm using Trusted Picks to find the best food and places, ranked by friends. Join me:";
    if (navigator.share) { try { await navigator.share({ text, url }); } catch { /* dismissed */ } }
    else if (await copyText(`${text} ${url}`)) toast("Invite link copied");
  }

  const sortedPeople = [...people].sort((a, b) => (match[b.id]?.pct ?? -1) - (match[a.id]?.pct ?? -1));

  return (
    <div className="page">
      <h1>Your taste circle</h1>
      <div className="row" style={{ gap: 14 }}>
        <Avatar id={me} name={profile?.display_name} path={profile?.avatar_path} size="lg" />
        <div className="stack tight">
          <span className="strong" style={{ fontSize: 17 }}>{profile?.display_name || "You"}</span>
          <span className="small muted">{trustedOn.length ? `Trusted on ${trustedOn.join(" and ").toLowerCase()}` : "Review a few things to build your trust"}</span>
        </div>
      </div>
      <div className="stats">
        <div><div className="n">{stats?.reviews ?? "–"}</div><div className="l">reviews</div></div>
        <div><div className="n">{stats?.followers ?? "–"}</div><div className="l">follow you</div></div>
        <div><div className="n">{stats?.verified ?? "–"}</div><div className="l">verified</div></div>
      </div>

      <div className="search">
        <Icon name="search" color="var(--muted)" />
        <input placeholder="Find friends by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find friends" />
      </div>

      {found ? (
        <div className="list">
          {found.length === 0 && <div className="empty"><p>No one by that name yet. Invite them.</p></div>}
          {found.map((p) => <PersonRow key={p.id} p={p} on={following.has(p.id)} onToggle={() => follow(p.id)} />)}
        </div>
      ) : (
        <>
          <div className="chips scroll">
            <button className={`chip ${topic == null ? "on" : ""}`} onClick={() => setTopic(null)}>All</button>
            {topics.map((t) => <button key={t.id} className={`chip ${topic === t.id ? "on" : ""}`} onClick={() => setTopic(t.id)}>{t.name}</button>)}
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <div className="row between" style={{ paddingBottom: 4 }}>
              <h2>People you follow</h2>
              <span className="tiny muted">taste match</span>
            </div>
            {sortedPeople.length === 0 ? (
              <div className="empty"><p>You don't follow anyone yet. Search above or invite friends.</p></div>
            ) : (
              <div className="list">
                {sortedPeople.map((p) => (
                  <Link key={p.id} to={`/u/${p.id}`} className="list-item">
                    <Avatar id={p.id} name={p.display_name} path={p.avatar_path} />
                    <div className="grow stack tight">
                      <span className="strong">{p.display_name || "Someone"}</span>
                      <span className="tiny muted">{match[p.id] ? `${match[p.id]!.n} things you both rated` : "Not enough overlap yet"}</span>
                    </div>
                    <span className="strong green">{match[p.id] ? `${match[p.id]!.pct}%` : ""}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <button className="btn ghost block" onClick={invite}>Invite friends</button>
    </div>
  );
}

export function PersonRow({ p, on, onToggle }: { p: Profile; on: boolean; onToggle: () => void }) {
  return (
    <div className="list-item">
      <Link to={`/u/${p.id}`}><Avatar id={p.id} name={p.display_name} path={p.avatar_path} /></Link>
      <Link to={`/u/${p.id}`} className="grow stack tight" style={{ color: "inherit" }}>
        <span className="strong">{p.display_name || "Someone"}</span>
        {p.city && <span className="tiny muted">{p.city}</span>}
      </Link>
      <button className={`btn small ${on ? "ghost" : ""}`} onClick={onToggle}>{on ? "Following" : "Follow"}</button>
    </div>
  );
}
