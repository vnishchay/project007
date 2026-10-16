import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, PROFILE_COLS, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useFollowing, type FollowSource } from "../lib/follows";
import type { Friend, Profile, Topic } from "../lib/types";
import { timeAgo } from "../lib/util";
import { Avatar, Icon, Spinner, useToast } from "../components/ui";
import { CirclePersonRow } from "../components/CirclePersonRow";
import { InviteCard } from "../components/home/InviteCard";
import { Chip, EmptyArt, Glyph, Retry, SectionTitle, lookFor, viaLook } from "../components/home/Kit";
import "../styles/home.css";

interface Stats { reviews: number; followers: number; following: number; verified: number }
interface Suggested { id: string; display_name: string; avatar_path: string | null; city: string | null; review_count: number; is_expert: boolean; topic_name: string | null }

function FriendRow({ f, onRemove, busy }: { f: Friend; onRemove: () => void; busy: boolean }) {
  const named = Boolean(f.display_name?.trim()) && !f.is_guest;
  const via = viaLook(f.via);
  const name = named ? f.display_name! : "Friend who joined via your link";
  const face = named
    ? <Avatar id={f.id} name={f.display_name} path={f.avatar_path} />
    : <span className="ghost-avatar"><Icon name="user" size={20} /></span>;
  return (
    <div className="friend-row">
      <span className="av-wrap">
        {named ? <Link to={`/u/${f.id}`} tabIndex={-1} aria-hidden="true">{face}</Link> : face}
        <span className={`via-dot icon-chip ${via.tone === "green" ? "" : via.tone}`} style={{ width: 20, height: 20, borderRadius: "50%" }} title={`Joined via ${via.label}`}>
          <Glyph name={via.icon} size={11} width={2.6} />
        </span>
      </span>
      <span className="grow stack tight" style={{ minWidth: 0 }}>
        {named ? <Link to={`/u/${f.id}`} className="strong ellipsis" style={{ color: "inherit" }}>{name}</Link> : <span className="strong muted" style={{ lineHeight: 1.25 }}>{name}</span>}
        <span className="tiny muted row" style={{ gap: 4 }}><Glyph name={via.icon} size={12} />via {via.label} · {timeAgo(f.since)}</span>
      </span>
      <button type="button" className="icon-act" onClick={onRemove} disabled={busy} aria-label={`Remove ${name}`} title="Remove friend">
        <Glyph name="userMinus" size={18} />
      </button>
    </div>
  );
}

export default function Circle() {
  const { session, profile } = useAuth();
  const me = session!.user.id;
  const toast = useToast();
  const { following, toggleFollow, loaded: followLoaded, pending } = useFollowing(me);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [friendsErr, setFriendsErr] = useState<string | null>(null);
  const [noFriendsDb, setNoFriendsDb] = useState(false);
  const [friendsKey, setFriendsKey] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topic, setTopic] = useState<number | null>(null);
  const [followed, setFollowed] = useState<Profile[]>([]);
  const [match, setMatch] = useState<Record<string, number>>({});
  const [suggested, setSuggested] = useState<Suggested[] | null>(null);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [suggestKey, setSuggestKey] = useState(0);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Profile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchKey, setSearchKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setFriendsErr(null);
    supabase.rpc("my_friends").then(({ data, error }) => {
      if (!alive) return;
      if (error?.code === "PGRST202") { setNoFriendsDb(true); setFriends([]); return; }
      if (error) { setFriendsErr(errorText(error)); return; }
      setFriends((data as Friend[]) || []);
    });
    return () => { alive = false; };
  }, [me, friendsKey]);

  useEffect(() => {
    Promise.all([supabase.rpc("my_circle_stats"), supabase.from("topics").select("id, name").order("name")]).then(([s, tp]) => {
      if (!s.error) setStats(((s.data as Stats[]) || [])[0] ?? null);
      if (!tp.error) setTopics((tp.data as Topic[]) || []);
    });
  }, [me]);

  // People you follow, with how closely your ratings match.
  const followKey = useMemo(() => [...following].sort().join(","), [following]);
  useEffect(() => {
    if (!followLoaded) return;
    const ids = followKey ? followKey.split(",") : [];
    if (!ids.length) { setFollowed([]); return; }
    let alive = true;
    Promise.all([
      supabase.from("profiles").select(PROFILE_COLS).in("id", ids),
      supabase.from("taste_match").select("other_user_id, match_pct, shared_items").eq("user_id", me),
    ]).then(([p, m]) => {
      if (!alive) return;
      if (!p.error) setFollowed((p.data as Profile[]) || []);
      if (!m.error) {
        const best: Record<string, { pct: number; n: number }> = {};
        for (const r of (m.data || []) as { other_user_id: string; match_pct: number; shared_items: number }[]) {
          if (!best[r.other_user_id] || r.shared_items > best[r.other_user_id]!.n) best[r.other_user_id] = { pct: r.match_pct, n: r.shared_items };
        }
        setMatch(Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.pct])));
      }
    });
    return () => { alive = false; };
  }, [me, followKey, followLoaded]);

  useEffect(() => {
    let alive = true;
    setSuggestErr(null);
    setSuggested(null);
    supabase.rpc("suggested_people", { p_topic: topic, p_limit: 8 }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setSuggestErr(errorText(error)); else setSuggested(((data as Suggested[]) || []).filter((s) => s.id !== me));
    });
    return () => { alive = false; };
  }, [topic, suggestKey, me]);

  useEffect(() => {
    const term = q.trim().replace(/[%_,()]/g, "");
    if (term.length < 2) { setFound(null); setSearchErr(null); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      // Only people who posted a review with their name can be found by name.
      supabase.rpc("find_people", { p_query: term, p_limit: 15 }).then(({ data, error }) => {
        if (!alive) return;
        setSearching(false);
        if (error) { setSearchErr(errorText(error)); setFound([]); } else { setSearchErr(null); setFound(((data as Profile[]) || []).filter((p) => p.id !== me)); }
      });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, me, searchKey]);

  const follow = useCallback(async (id: string, source: FollowSource = "in_app") => {
    const e = await toggleFollow(id, source);
    if (e) toast(e);
  }, [toggleFollow, toast]);

  async function remove(f: Friend) {
    const name = f.display_name && !f.is_guest ? f.display_name : "this friend";
    if (!confirm(`Remove ${name} from your friends?`)) return;
    setRemoving(f.id);
    const { error } = await supabase.rpc("remove_friend", { p_friend: f.id });
    setRemoving(null);
    if (error) { toast(errorText(error)); return; }
    setFriends((fs) => (fs || []).filter((x) => x.id !== f.id));
    toast("Friend removed");
  }

  const topicName = topics.find((t) => t.id === topic)?.name;

  return (
    <div className="page" style={{ gap: 18 }}>
      <header className="hero violet">
        <div className="row" style={{ gap: 12 }}>
          <Avatar id={me} name={profile?.display_name} path={profile?.avatar_path} size="lg" />
          <div className="grow stack tight">
            <h1>Friends</h1>
            <span className="hero-sub"><Glyph name="handshake" size={16} />Joined through your links</span>
          </div>
        </div>
        <div className="stat-tiles">
          <div className="stat-tile"><span className="n"><Icon name="people" size={16} />{friends?.length ?? "–"}</span><span className="l">{friends?.length === 1 ? "friend" : "friends"}</span></div>
          <div className="stat-tile"><span className="n"><Icon name="star" size={16} />{stats?.reviews ?? "–"}</span><span className="l">reviews</span></div>
          <div className="stat-tile"><span className="n"><Icon name="verified" size={16} />{stats?.verified ?? "–"}</span><span className="l">verified</span></div>
        </div>
        <InviteCard />
      </header>

      <div className="callout green">
        <Chip icon="lock" size="sm" />
        <span className="small grow">Friends are people who joined through your link. Your reviews stay anonymous unless you show your name.</span>
      </div>

      <section className="stack" style={{ gap: 6 }} aria-labelledby="friends-h">
        <SectionTitle icon="people" tone="violet" right={friends && friends.length > 0 ? <span className="count-pill">{friends.length}</span> : null}>
          <span id="friends-h">Your friends</span>
        </SectionTitle>
        {noFriendsDb ? (
          <div className="notice warn row"><Icon name="info" size={18} /><span className="grow small">Friends will show here after the next app update. Your invite link already works.</span></div>
        ) : friendsErr ? (
          <Retry msg={`Couldn't load your friends: ${friendsErr}`} onRetry={() => setFriendsKey((k) => k + 1)} />
        ) : friends === null ? <Spinner /> : friends.length === 0 ? (
          <div className="card">
            <EmptyArt icon="party" tone="violet" title="No friends yet">
              <span className="small">Share your link, a review or your QR. Whoever joins becomes your friend.</span>
              <div className="row" style={{ gap: 14, justifyContent: "center" }}>
                {(["link", "star", "qr"] as const).map((i) => <Chip key={i} icon={i} tone={i === "star" ? "amber" : i === "qr" ? "violet" : "green"} size="sm" />)}
              </div>
            </EmptyArt>
          </div>
        ) : (
          <div className="menu">
            {friends.map((f) => <FriendRow key={f.id} f={f} busy={removing === f.id} onRemove={() => remove(f)} />)}
          </div>
        )}
      </section>

      {followed.length > 0 && (
        <section className="stack" style={{ gap: 10 }} aria-label="Following">
          <SectionTitle icon="heart" tone="coral" right={<span className="count-pill">{followed.length}</span>}>Following</SectionTitle>
          <div className="hscroll">
            {followed.map((p) => (
              <Link key={p.id} to={`/u/${p.id}`} className="stack center" style={{ width: 76, gap: 4, alignItems: "center", color: "inherit" }}>
                <Avatar id={p.id} name={p.display_name} path={p.avatar_path} size="lg" />
                <span className="tiny strong ellipsis" style={{ maxWidth: 76 }}>{(p.display_name || "Someone").split(" ")[0]}</span>
                {match[p.id] != null && <span className="pill green" title="Taste match">{match[p.id]}%</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 10 }} aria-labelledby="people-h">
        <SectionTitle icon="compass" tone="sky"><span id="people-h">Find people</span></SectionTitle>
        <div className="search">
          <Icon name="search" color="var(--muted)" />
          <input type="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find people by name" />
        </div>

        {found || searching ? (
          <div className="menu" aria-live="polite">
            {searching && !found ? <Spinner /> : null}
            {searchErr && <Retry msg={`Search failed: ${searchErr}`} onRetry={() => setSearchKey((k) => k + 1)} />}
            {found && !searchErr && found.length === 0 && <EmptyArt icon="ghost" tone="sky" title="No one by that name"><span className="small">Send them your invite instead.</span></EmptyArt>}
            {found?.map((p) => <CirclePersonRow key={p.id} p={p} on={following.has(p.id)} busy={pending.has(p.id)} onToggle={() => follow(p.id)} />)}
          </div>
        ) : (
          <>
            <div className="chips scroll" role="group" aria-label="Filter by topic">
              <button type="button" className={`chip ${topic == null ? "on" : ""}`} aria-pressed={topic == null} onClick={() => setTopic(null)}><Icon name="spark" size={14} />All</button>
              {topics.map((t) => (
                <button type="button" key={t.id} className={`chip ${topic === t.id ? "on" : ""}`} aria-pressed={topic === t.id} onClick={() => setTopic(t.id)}>
                  <Glyph name={lookFor(t.name).icon} size={14} />{t.name}
                </button>
              ))}
            </div>
            {suggestErr ? (
              <Retry msg={`Couldn't load suggestions: ${suggestErr}`} onRetry={() => setSuggestKey((k) => k + 1)} />
            ) : suggested === null ? <Spinner /> : suggested.length === 0 ? (
              <EmptyArt icon="compass" tone="sky" title={`No suggestions${topicName ? ` for ${topicName.toLowerCase()}` : ""} yet`} />
            ) : (
              <div className="menu">
                {suggested.map((s) => (
                  <CirclePersonRow
                    key={s.id} p={s} on={following.has(s.id)} busy={pending.has(s.id)}
                    onToggle={() => follow(s.id, "suggested")}
                    badge={s.is_expert ? <span className="pill amber" style={{ background: "var(--amber-soft)", color: "#8a5a00" }}><Icon name="award" size={12} />{s.topic_name || "Expert"}</span> : null}
                    sub={<span className="row" style={{ gap: 8 }}><span className="row" style={{ gap: 3 }}><Icon name="star" size={12} />{s.review_count}</span>{s.city && <span className="row" style={{ gap: 3 }}><Icon name="pin" size={12} />{s.city}</span>}</span>}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
