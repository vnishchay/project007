import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, PROFILE_COLS, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useFollowing, type FollowSource } from "../lib/follows";
import type { Profile, Topic } from "../lib/types";
import { copyText } from "../lib/util";
import { Avatar, Icon, Spinner, useToast } from "../components/ui";
import { CirclePersonRow } from "../components/CirclePersonRow";
import { ContactsMatch } from "../components/ContactsMatch";

interface Stats { reviews: number; followers: number; following: number; verified: number }
interface Suggested { id: string; display_name: string; avatar_path: string | null; city: string | null; review_count: number; is_expert: boolean; topic_name: string | null }
interface TopicStat { user_id: string; review_count: number; is_expert: boolean }

function Retry({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="notice err row" role="alert">
      <span className="grow">{msg}</span>
      <button type="button" className="link-btn strong" style={{ color: "var(--danger)" }} onClick={onRetry}>Retry</button>
    </div>
  );
}

export default function Circle() {
  const { session, profile } = useAuth();
  const me = session!.user.id;
  const toast = useToast();
  const { following, toggleFollow, loaded: followLoaded, error: followError, reload: reloadFollowing, pending } = useFollowing(me);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trustedOn, setTrustedOn] = useState<string[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [headErr, setHeadErr] = useState<string | null>(null);
  const [headKey, setHeadKey] = useState(0);
  const [topic, setTopic] = useState<number | null>(null);
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [peopleErr, setPeopleErr] = useState<string | null>(null);
  // Both are tagged with the topic they were loaded for, so switching topics never shows stale rows.
  const [matchData, setMatchData] = useState<{ topic: number | null; map: Record<string, { pct: number; n: number }> } | null>(null);
  const [statsData, setStatsData] = useState<{ topic: number; map: Record<string, TopicStat> } | null>(null);
  const [listKey, setListKey] = useState(0);
  const [suggested, setSuggested] = useState<Suggested[] | null>(null);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [suggestKey, setSuggestKey] = useState(0);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Profile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchKey, setSearchKey] = useState(0);

  // Header: stats, what you're trusted on, topic chips.
  useEffect(() => {
    let alive = true;
    setHeadErr(null);
    Promise.all([
      supabase.rpc("my_circle_stats"),
      supabase.from("user_topic_stats").select("followers_trusting, review_count, topics(name)").eq("user_id", me)
        .gt("followers_trusting", 0).order("followers_trusting", { ascending: false }).limit(2),
      supabase.from("topics").select("id, name").order("name"),
    ]).then(([s, t, tp]) => {
      if (!alive) return;
      const e = s.error || t.error || tp.error;
      if (e) setHeadErr(errorText(e));
      if (!s.error) setStats(((s.data as Stats[]) || [])[0] ?? null);
      if (!t.error) setTrustedOn(((t.data || []) as unknown as { topics: { name: string } | null }[]).map((d) => d.topics?.name || "").filter(Boolean));
      if (!tp.error) setTopics((tp.data as Topic[]) || []);
    });
    return () => { alive = false; };
  }, [me, headKey]);

  const followKey = useMemo(() => [...following].sort().join(","), [following]);

  // Profiles of the people you follow.
  useEffect(() => {
    if (!followLoaded) return;
    const ids = followKey ? followKey.split(",") : [];
    if (!ids.length) { setPeople([]); setPeopleErr(null); return; }
    let alive = true;
    setPeopleErr(null);
    supabase.from("profiles").select(PROFILE_COLS).in("id", ids).then(({ data, error }) => {
      if (!alive) return;
      if (error) setPeopleErr(errorText(error)); else setPeople((data as Profile[]) || []);
    });
    return () => { alive = false; };
  }, [followKey, followLoaded, listKey]);

  // Taste match, and for a picked topic who among the people you follow reviews it.
  useEffect(() => {
    let alive = true;
    let mq = supabase.from("taste_match").select("other_user_id, match_pct, shared_items, topic_id").eq("user_id", me);
    if (topic != null) mq = mq.eq("topic_id", topic);
    const ids = followKey ? followKey.split(",") : [];
    const sq = topic != null && ids.length
      ? supabase.from("user_topic_stats").select("user_id, review_count, is_expert").eq("topic_id", topic).in("user_id", ids)
      : null;
    Promise.all([mq, sq]).then(([m, s]) => {
      if (!alive) return;
      if (m.error || s?.error) { setPeopleErr(errorText(m.error || s?.error)); return; }
      const out: Record<string, { pct: number; n: number }> = {};
      for (const row of (m.data || []) as { other_user_id: string; match_pct: number; shared_items: number }[]) {
        const cur = out[row.other_user_id];
        // Without a topic picked, show the best-backed match across topics.
        if (!cur || row.shared_items > cur.n) out[row.other_user_id] = { pct: row.match_pct, n: row.shared_items };
      }
      setMatchData({ topic, map: out });
      if (topic != null) {
        const ts: Record<string, TopicStat> = {};
        for (const row of ((s?.data || []) as TopicStat[])) ts[row.user_id] = row;
        setStatsData({ topic, map: ts });
      }
    });
    return () => { alive = false; };
  }, [me, topic, followKey, listKey]);

  // Suggested people for the picked topic (or overall).
  useEffect(() => {
    let alive = true;
    setSuggestErr(null);
    setSuggested(null);
    supabase.rpc("suggested_people", { p_topic: topic, p_limit: 8 }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setSuggestErr(errorText(error)); else setSuggested((data as Suggested[]) || []);
    });
    return () => { alive = false; };
  }, [topic, suggestKey]);

  useEffect(() => {
    const term = q.trim().replace(/[%_,()]/g, "");
    if (term.length < 2) { setFound(null); setSearchErr(null); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      // Only people who posted a review with their name can be found by name.
      supabase.rpc("find_people", { p_query: term, p_limit: 15 })
        .then(({ data, error }) => {
          if (!alive) return;
          setSearching(false);
          if (error) { setSearchErr(errorText(error)); setFound([]); } else { setSearchErr(null); setFound((data as Profile[]) || []); }
        });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, me, searchKey]);

  const follow = useCallback(async (id: string, source: FollowSource = "in_app") => {
    const e = await toggleFollow(id, source);
    if (e) toast(e);
  }, [toggleFollow, toast]);

  async function invite() {
    const url = window.location.origin;
    const text = "I'm using Trusted Picks to find the best food and places, ranked by friends. Join me:";
    if (navigator.share) { try { await navigator.share({ text, url }); } catch { /* dismissed */ } }
    else if (await copyText(`${text} ${url}`)) toast("Invite link copied");
    else toast("Couldn't copy the link");
  }

  const topicName = topics.find((t) => t.id === topic)?.name;
  const matchReady = matchData?.topic === topic;
  const match = useMemo(() => (matchReady ? matchData!.map : {}), [matchReady, matchData]);
  const topicStats = topic != null && statsData?.topic === topic ? statsData.map : null;
  const list = useMemo(() => {
    let ps = [...(people || [])];
    if (topic != null) ps = ps.filter((p) => match[p.id] || topicStats?.[p.id]);
    return ps.sort((a, b) =>
      (match[b.id]?.pct ?? -1) - (match[a.id]?.pct ?? -1)
      || (topicStats?.[b.id]?.review_count ?? 0) - (topicStats?.[a.id]?.review_count ?? 0)
      || (a.display_name || "").localeCompare(b.display_name || ""));
  }, [people, match, topicStats, topic]);

  const listLoading = !followLoaded || people === null || ((people?.length ?? 0) > 0 && (!matchReady || (topic != null && topicStats === null)));
  const listErr = followError || peopleErr;

  return (
    <div className="page">
      <h1>Your taste circle</h1>
      <div className="row" style={{ gap: 14 }}>
        <Avatar id={me} name={profile?.display_name} path={profile?.avatar_path} size="lg" />
        <div className="grow stack tight">
          <span className="strong" style={{ fontSize: 17 }}>{profile?.display_name || "You"}</span>
          <span className="small muted">{trustedOn.length ? `Trusted on ${trustedOn.join(" and ").toLowerCase()}` : "Review a few things to build your trust"}</span>
        </div>
      </div>
      <div className="stats">
        <div><div className="n">{stats?.reviews ?? "–"}</div><div className="l">reviews</div></div>
        <div><div className="n">{stats?.followers ?? "–"}</div><div className="l">follow you</div></div>
        <div><div className="n">{stats?.verified ?? "–"}</div><div className="l">verified</div></div>
      </div>
      {headErr && <Retry msg={`Couldn't load your circle: ${headErr}`} onRetry={() => setHeadKey((k) => k + 1)} />}

      <div className="search">
        <Icon name="search" color="var(--muted)" />
        <input type="search" placeholder="Find friends by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find friends by name" />
      </div>

      {found || searching ? (
        <div className="list" aria-live="polite">
          {searching && !found ? <Spinner /> : null}
          {searchErr && <Retry msg={`Search failed: ${searchErr}`} onRetry={() => setSearchKey((k) => k + 1)} />}
          {found && !searchErr && found.length === 0 && <div className="empty"><p>No one by that name yet. Invite them.</p></div>}
          {found?.map((p) => <CirclePersonRow key={p.id} p={p} on={following.has(p.id)} busy={pending.has(p.id)} onToggle={() => follow(p.id)} />)}
        </div>
      ) : (
        <>
          <ContactsMatch following={following} pending={pending} onToggle={follow} />

          <div className="chips scroll" role="group" aria-label="Filter by topic">
            <button type="button" className={`chip ${topic == null ? "on" : ""}`} aria-pressed={topic == null} onClick={() => setTopic(null)}>All</button>
            {topics.map((t) => (
              <button type="button" key={t.id} className={`chip ${topic === t.id ? "on" : ""}`} aria-pressed={topic === t.id} onClick={() => setTopic(t.id)}>{t.name}</button>
            ))}
          </div>

          <section className="stack" style={{ gap: 0 }} aria-labelledby="circle-list-h">
            <div className="row between" style={{ paddingBottom: 4 }}>
              <h2 id="circle-list-h">{topicName ? `Who you trust on ${topicName.toLowerCase()}` : "People you follow"}</h2>
              <span className="tiny muted">taste match</span>
            </div>
            {listErr ? (
              <Retry msg={`Couldn't load the people you follow: ${listErr}`} onRetry={() => { reloadFollowing(); setListKey((k) => k + 1); }} />
            ) : listLoading ? (
              <Spinner />
            ) : (people?.length ?? 0) === 0 ? (
              <div className="empty"><p>You don't follow anyone yet. Find friends from your contacts, search above, or follow someone suggested below.</p></div>
            ) : list.length === 0 ? (
              <div className="empty">
                <p>No one you follow has reviewed {topicName?.toLowerCase() || "this"} yet.</p>
                <button type="button" className="btn small ghost" onClick={() => setTopic(null)}>Show everyone</button>
              </div>
            ) : (
              <div className="list">
                {list.map((p) => {
                  const m = match[p.id];
                  const ts = topicStats?.[p.id];
                  const sub = [
                    ts ? `${ts.review_count} ${topicName?.toLowerCase() || ""} review${ts.review_count === 1 ? "" : "s"}`.replace(/\s+/g, " ") : null,
                    m ? `${m.n} thing${m.n === 1 ? "" : "s"} you both rated` : topic == null ? "Not enough overlap yet" : null,
                  ].filter(Boolean).join(" · ");
                  return (
                    <Link key={p.id} to={`/u/${p.id}`} className="list-item">
                      <Avatar id={p.id} name={p.display_name} path={p.avatar_path} />
                      <div className="grow stack tight">
                        <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <span className="strong">{p.display_name || "Someone"}</span>
                          {ts?.is_expert && <span className="badge">{topicName} expert</span>}
                        </span>
                        <span className="tiny muted">{sub}</span>
                      </div>
                      <span className="strong green" aria-label={m ? `${m.pct}% taste match` : undefined}>{m ? `${m.pct}%` : ""}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className="stack" style={{ gap: 0 }} aria-labelledby="suggested-h">
            <div className="row between" style={{ paddingBottom: 4 }}>
              <h2 id="suggested-h">Suggested for you{topicName ? ` · ${topicName.toLowerCase()}` : ""}</h2>
            </div>
            {suggestErr ? (
              <Retry msg={`Couldn't load suggestions: ${suggestErr}`} onRetry={() => setSuggestKey((k) => k + 1)} />
            ) : suggested === null ? (
              <Spinner />
            ) : suggested.length === 0 ? (
              <div className="empty"><p>No suggestions right now{topicName ? ` for ${topicName.toLowerCase()}` : ""}. Check back as more people review.</p></div>
            ) : (
              <div className="list">
                {suggested.map((s) => (
                  <CirclePersonRow
                    key={s.id} p={s} on={following.has(s.id)} busy={pending.has(s.id)}
                    onToggle={() => follow(s.id, "suggested")}
                    badge={s.is_expert ? <span className="badge">{s.topic_name ? `${s.topic_name} expert` : "Expert"}</span> : null}
                    sub={[`${s.review_count} review${s.review_count === 1 ? "" : "s"}`, s.city].filter(Boolean).join(" · ")}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <button type="button" className="btn ghost block" onClick={invite}>Invite friends</button>
    </div>
  );
}
