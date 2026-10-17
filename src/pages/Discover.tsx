import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, searchPlaces, PROFILE_COLS, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Profile, SearchResult, Topic } from "../lib/types";
import { useWhere, whereLabel } from "../lib/location";
import { fetchGoogleRating } from "../lib/google";
import { placeMediaUrl } from "../lib/media";
import { Avatar, Icon } from "../components/ui";
import { LocationPicker } from "../components/LocationPicker";
import { Chip, EmptyArt, Glyph, SectionTitle, greeting, lookFor, type GlyphName, type Tone } from "../components/home/Kit";
import { PickCard, PlaceCard, type Media } from "../components/home/PlaceCard";
import { NewsStrip } from "../components/home/NewsStrip";
import { KINDS, MODES } from "../lib/modes";
import "../styles/home.css";

interface Cat { label: string; q: string; icon: GlyphName; tone: Tone }
const CATS: Cat[] = [
  { label: "Food", q: "restaurant", icon: "food", tone: "green" },
  { label: "Coffee", q: "coffee", icon: "coffee", tone: "amber" },
  { label: "Bakery", q: "bakery", icon: "croissant", tone: "amber" },
  { label: "Pizza", q: "pizza", icon: "pizza", tone: "coral" },
  { label: "Biryani", q: "biryani", icon: "soup", tone: "coral" },
  { label: "Dessert", q: "dessert", icon: "cake", tone: "violet" },
  { label: "Salon", q: "salon", icon: "scissors", tone: "violet" },
  { label: "Spa", q: "spa", icon: "spa", tone: "sky" },
  { label: "Shopping", q: "shop", icon: "bag", tone: "sky" },
];

// Voice search, where the browser supports speech recognition.
type Rec = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };
const SR = typeof window === "undefined" ? undefined
  : (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
    || (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export default function Discover() {
  const { profile, session, loading, isGuest } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const type = params.get("type") || "";
  const [text, setText] = useState(q);
  const [topics, setTopics] = useState<Topic[]>([]);
  const { where, effective, coords, locating, denied, setWhere } = useWhere(profile?.city);
  const [picking, setPicking] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [media, setMedia] = useState<Record<string, Media>>({});
  const [err, setErr] = useState("");

  useEffect(() => { setText(q); }, [q]);

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
      ...(type ? { p_kind: type } : {}),
      p_limit: 60,
    }).then(async ({ data, error }) => {
      if (cancelled) return;
      if (error) { setErr(errorText(error)); setResults([]); return; }
      const rows = (data as SearchResult[]) || [];
      setResults(rows);
      const placeIds = rows.map((r) => r.place_id);
      const ids = [...new Set(rows.flatMap((r) => r.friend_ids || []))].slice(0, 100);
      const [ps, pm] = await Promise.all([
        ids.length ? supabase.from("profiles").select(PROFILE_COLS).in("id", ids) : null,
        // Older databases have no cover photos yet: just show the icon tiles.
        placeIds.length ? supabase.from("places").select("id, cover_path, logo_path").in("id", placeIds) : null,
      ]);
      if (cancelled) return;
      if (ps && !ps.error) setPeople(Object.fromEntries(((ps.data as Profile[]) || []).map((p) => [p.id, p])));
      if (pm && !pm.error) setMedia(Object.fromEntries(((pm.data as unknown as (Media & { id: string })[]) || []).map((m) => [m.id, m])));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, whereKey, coords, session?.user.id]);

  // Flag when Google's rating hides a weaker one from people you trust.
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = text.trim();
    setParams({ ...(v ? { q: v } : {}), ...(type ? { type } : {}) });
  }
  const go = (v: string) => {
    const next = q.toLowerCase() === v.toLowerCase() ? "" : v;
    setText(next);
    setParams({ ...(next ? { q: next } : {}), ...(type ? { type } : {}) });
  };
  const setType = (k: string) => setParams({ ...(q ? { q } : {}), ...(k ? { type: k } : {}) });

  const label = locating ? "Finding you…" : whereLabel(effective);
  const nearYou = effective.kind === "near" && coords;
  const friendsHere = new Set((results || []).flatMap((r) => r.friend_ids || [])).size;
  const farthest = Math.max(0, ...(results || []).map((r) => r.distance_m ?? 0));
  const picks = (results || []).filter((r) => r.friend_count > 0);
  const signedIn = Boolean(session && !isGuest);
  const firstName = (profile?.display_name || "").split(" ")[0];
  const hi = greeting();
  const cover = (id: string) => placeMediaUrl(media[id]?.cover_path) || placeMediaUrl(media[id]?.logo_path);
  const extraTopics = topics.filter((t) => !CATS.some((c) => c.label.toLowerCase() === t.name.toLowerCase() || c.q === t.name.toLowerCase()));

  return (
    <div className="page" style={{ gap: 18 }}>
      <header className="hero">
        <div className="row between">
          <button className="glass-btn" onClick={() => setPicking(true)} aria-haspopup="dialog" aria-label={`Location: ${label}. Change location`}>
            <Icon name={effective.kind === "near" ? "locate" : "pin"} size={16} />
            <span className="ellipsis" style={{ maxWidth: 190 }}>{label}</span>
            <Icon name="down" size={16} width={2.4} />
          </button>
          {loading ? null : signedIn ? (
            <Link to="/me" aria-label="Your profile"><Avatar id={session!.user.id} name={profile?.display_name || session!.user.email} path={profile?.avatar_path} /></Link>
          ) : <Link to="/signin" className="glass-btn" aria-label="Sign in"><Icon name="login" size={16} />Sign in</Link>}
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span className="hero-sub"><Glyph name={hi.icon} size={16} />{hi.text}{firstName && signedIn ? `, ${firstName}` : ""}</span>
          <h1>{q ? <>Best {q} {nearYou ? "near you" : effective.kind === "all" ? "" : `in ${whereLabel(effective)}`}</> : "What are you craving?"}</h1>
        </div>
        <form className="search" onSubmit={submit} role="search">
          <Icon name="search" color="var(--muted)" />
          <input aria-label="Search" placeholder="Pizza, filter coffee, haircut…" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="search" />
          {q && <button type="button" className="link-btn" onClick={() => { setText(""); setParams({}); }} aria-label="Clear search"><Icon name="close" size={18} color="var(--muted)" /></button>}
          {SR && <button type="button" className={`mic-btn ${listening ? "on" : ""}`} onClick={voiceSearch} aria-label={listening ? "Listening" : "Search by voice"} disabled={listening}><Icon name="mic" size={18} /></button>}
        </form>
      </header>

      {denied && where.kind === "near" && (
        <button type="button" className="callout amber" style={{ border: 0, textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => setPicking(true)}>
          <Chip icon="locate" tone="amber" size="sm" />
          <span className="grow small">Location is off. Showing {whereLabel(effective)}.</span>
          <span className="small strong row" style={{ gap: 4 }}><Icon name="pin" size={14} />Change</span>
        </button>
      )}
      {picking && <LocationPicker current={where} onPick={setWhere} onClose={() => setPicking(false)} />}

      <nav className="chips scroll type-strip" aria-label="Type of business">
        <button type="button" className={`chip ${!type ? "on" : ""}`} aria-pressed={!type} onClick={() => setType("")}><Icon name="grid" size={15} />All</button>
        {KINDS.filter((k) => k !== "other").map((k) => (
          <button key={k} type="button" className={`chip ${type === k ? "on" : ""}`} aria-pressed={type === k} onClick={() => setType(type === k ? "" : k)}>
            <Icon name={MODES[k].icon} size={15} />{MODES[k].label}
          </button>
        ))}
      </nav>

      <nav className="cat-strip" aria-label="Categories">
        {CATS.map((c) => (
          <button key={c.label} type="button" className={`cat ${q.toLowerCase() === c.q ? "on" : ""}`} aria-pressed={q.toLowerCase() === c.q} onClick={() => go(c.q)}>
            <Chip icon={c.icon} tone={c.tone} iconSize={24} /><span className="l">{c.label}</span>
          </button>
        ))}
        {extraTopics.map((t) => {
          const look = lookFor(t.name);
          const on = q.toLowerCase() === t.name.toLowerCase();
          return (
            <button key={t.id} type="button" className={`cat ${on ? "on" : ""}`} aria-pressed={on} onClick={() => go(t.name)}>
              <Chip icon={look.icon} tone={look.tone} iconSize={24} /><span className="l">{t.name}</span>
            </button>
          );
        })}
      </nav>

      {gap && (
        <Link to={`/p/${gap.id}`} className="callout coral">
          <Chip icon="alert" tone="coral" size="sm" />
          <span className="grow small"><b>{gap.name}</b>: Google {gap.google.toFixed(1)}, {session ? "your circle" : "reviewers here"} {gap.ours.toFixed(1)}{gap.item ? ` for the ${gap.item.toLowerCase()}` : ""}.</span>
        </Link>
      )}

      {signedIn && !q && <NewsStrip userId={session!.user.id} />}

      {picks.length > 0 && (
        <section className="stack" style={{ gap: 10 }} aria-label="Friends' picks">
          <SectionTitle icon="people" tone="violet" right={<span className="count-pill"><Icon name="people" size={13} />{friendsHere || picks.length}</span>}>Friends' picks</SectionTitle>
          <div className="hscroll">
            {picks.slice(0, 10).map((r) => <PickCard key={r.place_id} r={r} people={people} coverUrl={cover(r.place_id)} />)}
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 12 }} aria-label="Places">
        <SectionTitle icon={q ? "trophy" : "flame"} tone={q ? "amber" : "coral"} right={results && results.length > 0 ? (
          <span className="count-pill"><Icon name="store" size={13} />{results.length}{nearYou && farthest > 0 ? <> · <Icon name="navigate" size={11} />{Math.max(1, Math.ceil(farthest / 1000))} km</> : null}</span>
        ) : null}>
          {q ? "Ranked by people you trust" : "Top picks"}
        </SectionTitle>

        {!loading && !signedIn && (
          <Link to="/signin" className="callout violet">
            <Chip icon="people" tone="violet" size="sm" />
            <span className="grow small strong">Rank by friends' ratings</span>
            <Icon name="login" size={18} />
          </Link>
        )}
        {err && <div className="notice err">{err}</div>}

        {results === null ? (
          <div className="stack"><div className="skeleton" style={{ height: 108, borderRadius: 20 }} /><div className="skeleton" style={{ height: 108, borderRadius: 20 }} /><div className="skeleton" style={{ height: 108, borderRadius: 20 }} /></div>
        ) : results.length === 0 ? (
          <EmptyArt icon="search" tone="sky" title={q ? `No “${q}” here yet` : "No places here yet"}>
            <span className="small">{whereLabel(effective)}</span>
            <div className="row wrap" style={{ justifyContent: "center", gap: 8 }}>
              {effective.kind !== "all" && <button className="btn small ghost" onClick={() => setWhere({ kind: "all" })}><Icon name="globe" size={16} />Everywhere</button>}
              <button className="btn small ghost" onClick={() => setPicking(true)}><Icon name="pin" size={16} />Change area</button>
              {q && <button className="btn small ghost" onClick={() => { setText(""); setParams({}); }}><Icon name="close" size={16} />Clear</button>}
            </div>
          </EmptyArt>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {results.map((r) => <PlaceCard key={r.place_id} r={r} people={people} coverUrl={cover(r.place_id)} />)}
          </div>
        )}
      </section>

      <Link to="/business" className="callout green">
        <Chip icon="store" size="lg" />
        <span className="grow stack tight">
          <span className="strong">List your business</span>
          <span className="tiny">Item reviews and your own table QR</span>
        </span>
        <Icon name="chev" size={18} />
      </Link>
    </div>
  );
}
