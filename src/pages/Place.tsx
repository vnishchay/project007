import { focusCode, focusShop } from "../lib/focus";
import { goBack } from "../lib/nav";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, searchPlaces, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { isUuid, type Place, type ReviewRow, type SearchResult } from "../lib/types";
import { googleConfigured, type GoogleRating } from "../lib/google";
import { googleMapsUrl, todaysHours } from "../lib/util";
import { formatPrice, priceLevelText } from "../lib/money";
import { isStockPhoto, placeMediaUrl } from "../lib/media";
import { isDemoPhoto } from "../lib/demoArt";
import { shareLink, shareOrCopy } from "../lib/invite";
import { Avatar, Icon, Spinner, Stars, TopBar, useTabKeys, useToast } from "../components/ui";
import { GoogleG, Retry } from "../components/home/Kit";
import { ReviewCard, REVIEW_SELECT, REVIEW_FEED, reviewPhotoUrl } from "../components/ReviewCard";
import { ItemThumb } from "../components/place/ItemThumb";
import { DietDot, loadShopItems, missingColumn, shopLook, sortShopItems, type ShopItem } from "../components/place/shop";
import { ShopLinks, cleanLinks } from "../components/place/ShopLinks";
import { ShopUpdates } from "../components/place/ShopUpdates";
import { OnGoogle } from "../components/place/OnGoogle";
import { SimilarDishes } from "../components/place/SimilarDishes";
import { TreatsRail } from "../components/treats/TreatsRail";
import { ensureEmbeddings, openNow } from "../lib/dishes";
import { parsePlaceAbout, PlatformRatingsCard, AmenitiesCard } from "../components/place/PlatformRatings";
import { deviceId } from "../lib/device";
import { placeSummary, type PlaceSummary } from "../lib/assist";
import { isVisitItem, itemLabel, olderThan, sortReviews, summarize, type ReviewSort } from "../lib/reviews";
import "../styles/place.css";
import "../styles/night.css";

// currency is dropped by the client's fetch on a database without migration 40 (prices then show in rupees).
export const PLACE_COLS = "id, google_place_id, name, category, area, city, about, hours, price_level, status, listed_until, created_at, currency";

interface Stat { avg: number; count: number }
type Filter = "all" | "photos" | "friends" | `item:${string}` | `stars:${number}`;

/** Newest columns first; older databases lack kind, then links, then cover/logo. */
async function loadPlace(id: string) {
  if (!isUuid(id)) return { data: null, error: null };
  let r = await supabase.from("places").select(`${PLACE_COLS}, cover_path, logo_path, links, kind, verification`).eq("id", id).maybeSingle();
  if (missingColumn(r.error)) r = await supabase.from("places").select(`${PLACE_COLS}, cover_path, logo_path, links, kind`).eq("id", id).maybeSingle();
  if (missingColumn(r.error)) r = await supabase.from("places").select(`${PLACE_COLS}, cover_path, logo_path, links`).eq("id", id).maybeSingle();
  if (missingColumn(r.error)) r = await supabase.from("places").select(`${PLACE_COLS}, cover_path, logo_path`).eq("id", id).maybeSingle();
  if (missingColumn(r.error)) r = await supabase.from("places").select(PLACE_COLS).eq("id", id).maybeSingle();
  return r;
}

/** Your friends' ids: invite-link friends, or people you follow on an older database. */
async function loadFriendIds(me: string): Promise<Set<string>> {
  const f = await supabase.rpc("my_friends");
  if (!f.error) return new Set(((f.data || []) as { id: string }[]).map((x) => x.id));
  const { data } = await supabase.from("follows").select("followee_id").eq("follower_id", me);
  return new Set((data || []).map((x) => x.followee_id as string));
}

function Img({ src, className, alt = "" }: { src: string | null; className?: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return src && !broken ? <img src={src} className={className} alt={alt} onError={() => setBroken(true)} /> : null;
}

/** A review photo in the Photos tab; drops out quietly if the picture can't be loaded. */
function PhotoTile({ path, name, delay }: { path: string; name?: string; delay: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <figure style={{ animationDelay: `${delay}s` }} className="ph-broken" aria-label={`Photo of ${name || "the visit"} didn't load`}><Icon name="image" size={22} /><figcaption>{name}</figcaption></figure>;
  return <figure style={{ animationDelay: `${delay}s` }}><img src={reviewPhotoUrl(path)!} alt={`Photo of ${name || "the visit"}`} loading="lazy" onError={() => setBroken(true)} /><figcaption>{name}</figcaption></figure>;
}

export default function PlacePage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const me = session?.user.id;
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [items, setItems] = useState<ShopItem[]>([]);
  // Per-item averages and counts over every review, kept by the database (not just the reviews loaded here).
  const [itemStats, setItemStats] = useState<Map<string, Stat> | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const REVIEW_PAGE = 30;
  const [moreReviews, setMoreReviews] = useState(false);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [aiSummary, setAiSummary] = useState<PlaceSummary | null>(null);
  const withText = reviews.filter((r) => (r.body || "").trim()).length;
  // Only worth asking once there's something to summarise; the answer is cached for a day.
  useEffect(() => {
    if (withText < 3 || !isUuid(id)) { setAiSummary(null); return; }
    let alive = true;
    placeSummary(id).then((s) => { if (alive) setAiSummary(s); });
    return () => { alive = false; };
  }, [id, withText >= 3]); // eslint-disable-line react-hooks/exhaustive-deps
  const [friends, setFriends] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [canManage, setCanManage] = useState(false);
  // Reviewing is only open during a visit started by scanning this shop's table QR.
  const [canRate, setCanRate] = useState(false);
  const [google] = useState<GoogleRating | null>(null);
  // Google's rating and count, saved by onboarding (migration 42). Older databases simply don't show it.
  const [gStat, setGStat] = useState<{ rating: number; count: number } | null>(null);
  // An item nobody has rated yet: a small sheet says so, instead of a tap that does nothing.
  const [peek, setPeek] = useState<ShopItem | null>(null);
  useEffect(() => {
    setGStat(null);
    if (!isUuid(id)) return;
    let alive = true;
    supabase.from("places").select("google_rating, google_rating_count").eq("id", id).maybeSingle().then(({ data, error }) => {
      const g = data as { google_rating: number | null; google_rating_count: number | null } | null;
      if (alive && !error && g?.google_rating != null) setGStat({ rating: Number(g.google_rating), count: g.google_rating_count ?? 0 });
    }, () => {});
    return () => { alive = false; };
  }, [id]);
  const [summary, setSummary] = useState<SearchResult | null>(null);
  const [experts, setExperts] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [loadErr, setLoadErr] = useState("");
  // Reviews lead the page. A shop nobody has reviewed yet opens on its menu instead, unless the visitor already chose a tab.
  const [tab, setTab] = useState<"menu" | "reviews" | "photos" | "about">("reviews");
  const tabChosen = useRef(false);
  const pickTab = (t: typeof tab) => { tabChosen.current = true; setTab(t); };
  useEffect(() => { tabChosen.current = false; setTab("reviews"); }, [id]);
  const tabKeys = useTabKeys(["reviews", "menu", "photos", "about"] as const, tab, pickTab);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<ReviewSort>("useful");
  const [coverOk, setCoverOk] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setErr(""); setLoadErr("");
      if (!isUuid(id)) { setPlace(null); return; }
      const { data, error } = await loadPlace(id);
      if (!alive) return;
      if (error) { setErr(errorText(error)); setPlace(null); return; }
      const pl = data as Place | null;
      setPlace(pl);
      if (!pl) return;
      // The Google rating is billed per lookup, so it loads only when someone taps "See on Google".
      const [it, r, sc, ist] = await Promise.all([
        loadShopItems(id),
        supabase.from(REVIEW_FEED).select(REVIEW_SELECT).eq("place_id", id).eq("status", "published").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(REVIEW_PAGE + 1),
        // Same score as Discover: one formula, computed in the database.
        searchPlaces({ p_place: id, p_limit: 1 }),
        supabase.from("item_stats").select("item_id, avg_rating, review_count").eq("place_id", id),
      ]);
      if (!alive) return;
      const firstErr = it.error || r.error || sc.error;
      if (firstErr) setLoadErr(errorText(firstErr));
      setItems(it.items);
      setItemStats(ist.error ? null : new Map(((ist.data || []) as { item_id: string; avg_rating: number | string; review_count: number }[])
        .filter((x) => x.review_count > 0).map((x) => [x.item_id, { avg: Number(x.avg_rating), count: x.review_count }])));
      const all = (r.data as unknown as ReviewRow[]) || [];
      const rows = all.slice(0, REVIEW_PAGE);
      setMoreReviews(all.length > REVIEW_PAGE);
      setReviews(rows);
      if (!rows.length && it.items.length && !tabChosen.current) setTab("menu");
      setSummary(((sc.data as SearchResult[]) || [])[0] ?? null);
      const uids = [...new Set(rows.map((x) => x.user_id).filter((u): u is string => Boolean(u)))];
      if (uids.length) {
        const { data: ex } = await supabase.from("user_topic_stats").select("user_id, topics(name)").eq("is_expert", true).in("user_id", uids);
        if (alive) setExperts(Object.fromEntries(((ex || []) as unknown as { user_id: string; topics: { name: string } | null }[]).map((e) => [e.user_id, e.topics?.name || ""])));
      }
    })();
    return () => { alive = false; };
  }, [id, me, attempt]);

  async function showMoreReviews() {
    const last = reviews[reviews.length - 1];
    if (!last || loadingReviews) return;
    setLoadingReviews(true);
    // Keyset paging: everything older than the oldest review shown, so new reviews arriving never shift the pages.
    const r = await supabase.from(REVIEW_FEED).select(REVIEW_SELECT).eq("place_id", id).eq("status", "published")
      .or(olderThan(last)).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(REVIEW_PAGE + 1);
    setLoadingReviews(false);
    if (r.error) { toast(errorText(r.error)); return; }
    const all = (r.data as unknown as ReviewRow[]) || [];
    const rows = all.slice(0, REVIEW_PAGE);
    setMoreReviews(all.length > REVIEW_PAGE);
    setReviews((prev) => { const seen = new Set(prev.map((x) => x.id)); return [...prev, ...rows.filter((x) => !seen.has(x.id))]; });
    const uids = [...new Set(rows.map((x) => x.user_id).filter((u): u is string => Boolean(u)))];
    if (uids.length) {
      const { data: ex } = await supabase.from("user_topic_stats").select("user_id, topics(name)").eq("is_expert", true).in("user_id", uids);
      setExperts((prev) => ({ ...prev, ...Object.fromEntries(((ex || []) as unknown as { user_id: string; topics: { name: string } | null }[]).map((e) => [e.user_id, e.topics?.name || ""])) }));
    }
  }

  useEffect(() => {
    if (!me || !isUuid(id)) { setFriends(new Set()); setSaved(false); setCanManage(false); setCanRate(false); return; }
    let alive = true;
    loadFriendIds(me).then((s) => alive && setFriends(s));
    supabase.from("saved_places").select("place_id").eq("user_id", me).eq("place_id", id).maybeSingle().then(({ data }) => alive && setSaved(Boolean(data)));
    supabase.rpc("can_manage_place", { p_place: id }).then(({ data, error }) => alive && setCanManage(!error && data === true), () => {});
    supabase.rpc("can_review", { p_place: id, p_device: deviceId() }).then(({ data, error }) => {
      if (alive) setCanRate(!error && Boolean((data as { allowed: boolean }[] | null)?.[0]?.allowed));
    }, () => {});
    return () => { alive = false; };
  }, [me, id]);

  // Lets this shop's products show up in "Similar dishes" elsewhere (fills in only what's missing).
  useEffect(() => { if (place?.id && place.status === "live") ensureEmbeddings(place.id); }, [place?.id, place?.status]);
  const look = shopLook(place?.category, place?.kind);
  const stats = useMemo(() => {
    if (itemStats) return itemStats;
    // Older database without item_stats readable: fall back to the reviews loaded here.
    const m = new Map<string, { sum: number; count: number }>();
    for (const r of reviews) {
      const s = m.get(r.item_id) || { sum: 0, count: 0 };
      s.sum += r.rating; s.count += 1;
      m.set(r.item_id, s);
    }
    return new Map([...m].map(([k, v]) => [k, { avg: v.sum / v.count, count: v.count }]));
  }, [reviews, itemStats]);
  const products = useMemo(() => sortShopItems(items, (i) => stats.get(i.id)?.count ?? 0), [items, stats]);
  const imageOf = useMemo(() => new Map(items.map((i) => [i.id, i.image_path])), [items]);
  const isFriend = (r: ReviewRow) => Boolean(r.user_id && friends.has(r.user_id));
  const sorted = useMemo(() => sortReviews(reviews, sort, isFriend),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviews, friends, sort]);
  const sum = useMemo(() => summarize(reviews), [reviews]);
  const reviewedItems = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of reviews) if (r.items?.name && !seen.has(r.item_id)) seen.set(r.item_id, itemLabel(r.items.name));
    return [...seen].map(([itemId, name]) => ({ id: itemId, name, count: stats.get(itemId)?.count ?? 0 })).sort((a, b) => b.count - a.count);
  }, [reviews, stats]);
  const shown = sorted.filter((r) =>
    filter === "all" ? true : filter === "photos" ? Boolean(r.photo_path) : filter === "friends" ? isFriend(r)
    : filter.startsWith("stars:") ? r.rating === Number(filter.slice(6)) : r.item_id === filter.slice(5));

  async function toggleSave() {
    if (!me) { toast("Sign in to save places", { label: "Sign in", to: `/signin?next=${encodeURIComponent(`/p/${id}`)}` }); return; }
    if (saved) {
      const { error } = await supabase.from("saved_places").delete().eq("user_id", me).eq("place_id", id);
      if (error) toast(errorText(error)); else { setSaved(false); toast("Removed from saved"); }
    } else {
      const { error } = await supabase.from("saved_places").insert({ user_id: me, place_id: id });
      if (error) toast(errorText(error)); else { setSaved(true); toast("Saved"); }
    }
  }

  async function share() {
    const res = await shareOrCopy({ title: place?.name, url: await shareLink(`/p/${id}`, "place") });
    if (res === "copied") toast("Link copied");
  }

  if (place === undefined) return <div className="page"><Spinner /></div>;
  // A failed load is not the same as a shop that isn't listed: offer a retry instead of a dead end.
  if (!place && err) return <div className="page"><TopBar /><Retry msg={`Couldn't load this place. Check your connection and try again. (${err})`} onRetry={() => setAttempt((n) => n + 1)} /></div>;
  if (!place) return <div className="page"><TopBar /><div className="empty"><Icon name="store" size={32} /><h2>This place isn't listed</h2><p>It may have been removed or its listing has ended.</p><Link to="/" className="btn small ghost"><Icon name="search" size={16} />Search places</Link></div></div>;

  const cover = coverOk ? placeMediaUrl(place.cover_path, 1200) : null;
  const logo = placeMediaUrl(place.logo_path);
  const score = summary?.trust_score != null ? Number(summary.trust_score) : null;
  const reviewCount = summary?.review_count ?? reviews.length;
  const verified = summary?.verified_count ?? reviews.filter((r) => r.verified).length;
  const friendNamed = (summary?.friend_ids || []).map((fid) => reviews.find((r) => r.user_id === fid)).filter((r): r is ReviewRow => Boolean(r));
  const friendCount = Math.max(summary?.friend_count ?? 0, friendNamed.length);
  const today = place.hours && Object.keys(place.hours).length ? todaysHours(place.hours) ?? "Closed today" : null;
  const isOpen = openNow(place.hours);
  const photoCount = reviews.filter((r) => r.photo_path).length;
  const friendReviews = reviews.filter(isFriend).length;
  // What friends (people you're connected with through an invite link) loved here. Only reviews
  // they posted with their name, so an anonymous review never points to a friend.
  const friendLiked = reviews.filter((r) => isFriend(r) && r.rating >= 4 && r.author_name && r.is_public).slice(0, 6);
  const rateUrl = `/review/${place.id}`;
  // Shop mode (came in through a table QR or review link): no other pages, but a way back to that code to rate.
  const shopMode = Boolean(focusShop());
  const code = focusCode(place.id);
  const backToCode = !canRate && code ? code : null;
  // A newly listed shop's links stay hidden until the team has checked they are genuine.
  const unchecked = place.verification === "pending" || place.verification === "rejected";
  const links = unchecked && !canManage ? [] : cleanLinks((place as Place & { links?: unknown }).links, {
    name: place.name,
    city: place.city,
    area: place.area || undefined,
    googlePlaceId: place.google_place_id,
  });
  const parsedAbout = parsePlaceAbout(place.about, links);
  const onGoogle = Boolean(googleConfigured && place.google_place_id);

  const openReviews = (f: Filter) => {
    setFilter(f); pickTab("reviews");
    window.setTimeout(() => document.getElementById("pn-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };
  const [first, ...restWords] = place.name.trim().split(/\s+/);
  const find = (k: string) => links.find((l) => l.kind === k)?.url;
  const directions = googleMapsUrl(place.google_place_id, place.name, [place.area, place.city].filter(Boolean).join(", "));
  type DockItem = { icon: "navigate" | "phone" | "message" | "globe"; label: string; href: string; hot?: boolean };
  const dock: DockItem[] = [];
  if (directions) dock.push({ icon: "navigate", label: "Directions", href: directions, hot: true });
  const phoneUrl = find("phone");
  if (phoneUrl) dock.push({ icon: "phone", label: "Call", href: phoneUrl });
  if (find("whatsapp")) dock.push({ icon: "message", label: "WhatsApp", href: find("whatsapp")! });
  if (find("website")) dock.push({ icon: "globe", label: "Website", href: find("website")! });
  // Items people rate highly, for the big cards at the top.
  const signature = products.filter((p) => { const st = stats.get(p.id); return st && st.avg >= 3.5; })
    .sort((a, b) => { const x = stats.get(a.id)!, y = stats.get(b.id)!; return y.avg - x.avg || y.count - x.count; }).slice(0, 5);
  const ticker = reviews.filter((r) => r.author_name && r.is_public && r.rating >= 4).slice(0, 6)
    .map((r) => `${r.author_name!.split(" ")[0]} rated ${isVisitItem(r.items?.name) ? "the visit" : r.items?.name || "it"} ${r.rating}★`);
  const photos = reviews.filter((r) => r.photo_path);
  const tabs: { id: typeof tab; label: string; n?: number }[] = [
    { id: "reviews", label: "Reviews", n: reviewCount || undefined },
    { id: "menu", label: look.menu, n: products.length || undefined },
    { id: "photos", label: "Photos", n: photos.length || undefined },
    { id: "about", label: "About" },
  ];

  return (
    <div className="page pl-page pl-night">
      <div className={`pn-hero ${cover ? "has-cover" : ""}`}>
        {cover ? <img className="pn-cover" src={cover} alt="" onError={() => setCoverOk(false)} /> : (
          <>
            <span className="pn-aur" aria-hidden="true" />
          </>
        )}
        <div className="pn-fade" />
        <div className="pn-bar">
          {!shopMode && <button className="pn-glass" aria-label="Back" onClick={() => goBack(nav)}><Icon name="back" /></button>}
          {logo && <span className="pn-logo"><Img src={logo} alt={`${place.name} logo`} /></span>}
          <span className="grow" />
          {canManage && <Link to={`/owner/${place.id}`} className="pn-glass pill"><Icon name="settings" size={18} />Manage</Link>}
          <button className="pn-glass" aria-label={saved ? "Saved. Tap to remove" : "Save this place"} aria-pressed={saved} onClick={toggleSave}><Icon name="bookmark" fill={saved ? "currentColor" : undefined} /></button>
          <button className="pn-glass" aria-label="Share" onClick={share}><Icon name="share" /></button>
        </div>
        <div className="pn-title">
          <div className="pn-eyebrow"><span />{[place.category, place.area || place.city].filter(Boolean).join(" · ")}</div>
          <h1>{first}{restWords.length > 0 && <><br /><i>{restWords.join(" ")}</i></>}</h1>
          {parsedAbout.story && <p className="pn-tag">{parsedAbout.story.length > 130 ? `${parsedAbout.story.slice(0, 127)}…` : parsedAbout.story}</p>}
          <div className="pn-chips">
            {score != null
              ? <span className="pn-chip" aria-label={`Trust score ${score.toFixed(1)} of 5`}><Icon name="star" size={15} fill="currentColor" color="#d9a441" /><b>{score.toFixed(1)}</b><span>{reviewCount} {reviewCount === 1 ? "review" : "reviews"}</span></span>
              : <span className="pn-chip"><Icon name="spark" size={15} color="#d9a441" /><b>New</b><span>on Trusted Picks</span></span>}
            {gStat && <span className="pn-chip" aria-label={`Google ${gStat.rating.toFixed(1)} stars from ${gStat.count} reviews`}><GoogleG size={14} /><b>{gStat.rating.toFixed(1)}</b><span>{gStat.count.toLocaleString(undefined)} on Google</span></span>}
            {today && <button type="button" className="pn-chip" onClick={() => { pickTab("about"); window.setTimeout(() => document.getElementById("pn-tabs")?.scrollIntoView({ behavior: "smooth" }), 80); }}><span className={`pn-dot ${isOpen ? "" : "closed"}`} aria-hidden="true" />{isOpen === true ? "Open · " : isOpen === false && !/closed/i.test(today) ? "Closed · " : ""}{today}</button>}
            {parsedAbout.platformRatings.length > 0 && (
              <button type="button" className="pn-chip" onClick={() => { pickTab("about"); window.setTimeout(() => document.getElementById("pn-tabs")?.scrollIntoView({ behavior: "smooth" }), 80); }} aria-label={`On ${parsedAbout.platformRatings.length} platforms. See ratings`}>
                <Icon name="globe" size={15} color="#34a853" /><b>On {parsedAbout.platformRatings.length} {parsedAbout.platformRatings.length === 1 ? "platform" : "platforms"}</b>
              </button>
            )}
            {verified > 0 && <span className="pn-chip"><Icon name="verified" size={15} color="#e5c78f" />{verified} verified</span>}
            {priceLevelText(place.price_level, place.currency) && <span className="pn-chip gold">{priceLevelText(place.price_level, place.currency)}</span>}
          </div>
        </div>
      </div>

      {ticker.length >= 2 && (
        <div className="pn-ticker" aria-label="What friends and others rated">
          <div className="pn-ticker-run">{[...ticker, ...ticker].map((t, i) => <span key={i}><Icon name="star" size={13} fill="currentColor" />{t}</span>)}</div>
        </div>
      )}

      <TreatsRail placeId={place.id} placeName={place.name} currency={place.currency} bleed />

      {dock.length > 0 && (
        <div className="pn-dock">
          {dock.map((d) => (
            <a key={d.label} className="pn-act" href={d.href} {...(/^https?:/i.test(d.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              <span className={d.hot ? "hot" : ""}><Icon name={d.icon} size={23} /></span>{d.label}
            </a>
          ))}
        </div>
      )}

      {(friendLiked.length > 0 || friendCount > 0) && (
        <section className="pn-friends" aria-label="Your friends liked">
          <h2>Your friends <i>liked</i></h2>
          {friendLiked.length > 0 ? (
            <div className="pn-fr-row">
              {friendLiked.map((r) => (
                <button key={r.id} type="button" className="pn-fr" onClick={() => openReviews("friends")}>
                  <span className="row" style={{ gap: 10 }}>
                    <Avatar id={r.user_id!} name={r.author_name} path={r.author_avatar} size="sm" />
                    <span className="grow"><b>{r.author_name!.split(" ")[0]}</b><span className="pn-lime tiny">Your friend</span></span>
                    <Stars value={r.rating} size={12} />
                  </span>
                  <span className="pn-quote">{r.body?.trim() ? `“${r.body.trim().slice(0, 90)}${r.body.trim().length > 90 ? "…" : ""}”` : `Loved ${isVisitItem(r.items?.name) ? "it here" : r.items?.name || "it here"}`}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="pn-fr solo"><span className="avatars">{friendNamed.slice(0, 3).map((r) => <Avatar key={r.user_id} id={r.user_id!} name={r.author_name} path={r.author_avatar} size="sm" />)}</span>
              <span className="small">{friendNamed.length ? <><b>{friendNamed[0]!.author_name || "A friend"}</b>{friendCount > 1 ? ` + ${friendCount - 1} more` : ""} rated this</> : <><b>{friendCount} friends</b> rated this</>}</span></div>
          )}
        </section>
      )}

      <div className="pn-tabs" id="pn-tabs" role="tablist" aria-label="Shop sections" onKeyDown={tabKeys}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" tabIndex={tab === t.id ? 0 : -1} aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => pickTab(t.id)}>
            {t.label}{t.n ? <span>{t.n}</span> : null}
          </button>
        ))}
      </div>

      {loadErr && <div className="notice err row"><span className="grow">Couldn't load everything: {loadErr}</span><button className="link-btn" onClick={() => setAttempt((n) => n + 1)}><Icon name="refresh" size={16} />Retry</button></div>}

      <div className="pn-panel" key={tab}>
        {tab === "menu" && (
          <>
            {signature.length > 0 && (
              <section className="pn-sig" aria-label="Signature picks">
                <h2>Signature <i>picks</i></h2>
                <div className="pn-sig-row">
                  {signature.map((p, i) => {
                    const st = stats.get(p.id)!;
                    return (
                      <button key={p.id} type="button" className="pn-sig-card" style={{ animationDelay: `${0.1 + i * 0.1}s` }} onClick={() => (canRate ? nav(`${rateUrl}?item=${p.id}`) : openReviews(`item:${p.id}`))}>
                        <span className="pn-sig-img"><ItemThumb path={p.image_path} icon={look.icon} /></span>
                        <span className="pn-sig-name"><DietDot diet={p.diet} />{p.name}</span>
                        <span className="pn-sig-foot"><b>{formatPrice(p.price_inr, place.currency) ?? ""}</b><span className="pn-lime"><Icon name="star" size={12} fill="currentColor" />{st.avg.toFixed(1)} · {st.count}</span></span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            <ShopUpdates placeId={place.id} hideLinks={unchecked && !canManage} />
      <section className="stack" style={{ gap: 12 }}>
        <div className="section-title">
          <span className={`icon-chip sm ${look.tint}`}><Icon name={look.icon} size={16} /></span>
          <span className="grow">{look.menu}</span>
          {products.length > 0 && <span className="muted">{products.length}</span>}
        </div>
        {products.length === 0 ? (canRate &&
          <Link to={rateUrl} className="pl-empty-products">
            <span className={`icon-chip lg ${look.tint}`}><Icon name="plus" size={24} /></span>
            <span className="grow"><b>Nothing rated yet</b><br /><span className="small muted">Be the first to rate an item</span></span>
            <Icon name="chev" />
          </Link>
        ) : (
          <div className="pl-products pn-grid">
            {products.map((p) => {
              const s = stats.get(p.id);
              return (
                <Link key={p.id} to={canRate ? `${rateUrl}?item=${p.id}` : `#reviews`} className="pl-product" aria-label={canRate ? `Rate ${p.name}` : `Reviews of ${p.name}`}
                  onClick={canRate ? undefined : (e) => { e.preventDefault(); if (s) openReviews(`item:${p.id}`); else setPeek(p); }}>
                  <span className="pl-product-img">
                    <ItemThumb path={p.image_path} icon={look.icon} />
                    {s && <span className="pl-product-rate"><Icon name="star" size={12} fill="currentColor" />{s.avg.toFixed(1)}<span>· {s.count}</span></span>}
                  </span>
                  <span className="pl-product-body">
                    <span className="pl-product-name"><DietDot diet={p.diet} />{p.name}</span>
                    <span className="pl-product-foot">
                      {p.price_inr != null ? <span className="pl-price">{formatPrice(p.price_inr, place.currency)}</span> : <span className="muted tiny">{s ? "" : "New"}</span>}
                      {canRate && <span className="pl-rate-btn"><Icon name="star" size={14} /></span>}
                    </span>
                  </span>
                </Link>
              );
            })}
            {canRate && <Link to={rateUrl} className="pl-product pl-product-more" aria-label="Rate something else">
              <span className="icon-chip lg"><Icon name="plus" size={24} /></span>
              <span className="small strong">Something else</span>
            </Link>}
          </div>
        )}
        {products.some((p) => isDemoPhoto(p.image_path))
          ? <p className="pn-credit">Demo pictures are stock photos from <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a> and <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer">Unsplash</a>. Real shops use their own.</p>
          : products.some((p) => isStockPhoto(p.image_path)) && <p className="pn-credit">Pictures are for illustration. Stock photos by <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>.</p>}
      </section>

          </>
        )}
        {tab === "reviews" && (
          <>
      {/* Profiles aren't open in shop mode, so a reviewer's name there goes nowhere instead of bouncing back here. */}
      <section className="stack" style={{ gap: 12 }} id="reviews"
        onClickCapture={shopMode ? (e) => { const a = (e.target as HTMLElement).closest("a[href^='/u/']"); if (a) e.preventDefault(); } : undefined}>
        {aiSummary && (
          <div className="pl-summary">
            <span className="row tiny strong" style={{ gap: 6 }}><Icon name="spark" size={14} />What people say</span>
            <p className="small">{aiSummary.summary}</p>
            {aiSummary.highlights.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{aiSummary.highlights.map((h) => <span key={h} className="pill">{h}</span>)}</div>}
            <span className="tiny muted">Summarised by AI from reviews here</span>
          </div>
        )}
        <div className="section-title">
          <span className="icon-chip sm amber"><Icon name="message" size={16} /></span>
          <span className="grow">Reviews</span>
          {reviewCount > 0 && <span className="muted">{reviewCount}</span>}
        </div>
        {reviews.length > 0 && (
          <div className="rs" aria-label="Review summary">
            {/* The headline numbers are the server's, same as the header; the bars and tags below come from what's loaded. */}
            <div className="rs-avg">
              <b>{score != null ? score.toFixed(1) : reviewCount}</b>
              {score != null ? <Stars value={Math.round(score)} size={14} /> : null}
              <span className="tiny muted">{score != null ? `${reviewCount} review${reviewCount === 1 ? "" : "s"}` : `review${reviewCount === 1 ? "" : "s"}`}</span>
            </div>
            <div className="rs-bars" role="group" aria-label="Filter by stars">
              {[5, 4, 3, 2, 1].map((n) => {
                const c = sum.stars[n - 1] ?? 0;
                const f = `stars:${n}` as const;
                return (
                  <button key={n} type="button" className={`rs-bar ${filter === f ? "on" : ""}`} disabled={!c} aria-pressed={filter === f}
                    aria-label={filter === f ? `Showing ${n}-star reviews (${c}). Tap to show all` : `Show ${n}-star reviews (${c})`} onClick={() => setFilter(filter === f ? "all" : f)}>
                    <span>{n}★</span><span className="track"><span className="fill" style={{ width: `${sum.count ? (c / sum.count) * 100 : 0}%` }} /></span><span>{c}</span>
                  </button>
                );
              })}
            </div>
            {sum.count < reviewCount && <span className="tiny muted" style={{ gridColumn: "1 / -1" }}>Stars and tags from the latest {sum.count} reviews</span>}
            {(sum.liked.length > 0 || sum.better.length > 0) && (
              <div className="rs-tags">
                {sum.liked.length > 0 && <div><span className="lbl row" style={{ gap: 4 }}><Icon name="thumbs" size={13} />Liked</span>{sum.liked.map(([l, n]) => <span key={l} className="rc-tag">{l}<span>{n}</span></span>)}</div>}
                {sum.better.length > 0 && <div><span className="lbl row" style={{ gap: 4 }}><Icon name="thumbsDown" size={13} />Could be better</span>{sum.better.map(([l, n]) => <span key={l} className="rc-tag bad">{l}<span>{n}</span></span>)}</div>}
              </div>
            )}
          </div>
        )}
        {reviews.length > 1 && (
          <div className="row" style={{ gap: 8 }}>
            <span className="small muted">{shown.length === reviews.length ? (moreReviews ? "Newest reviews" : "All reviews") : `${shown.length} of ${reviews.length}`}</span>
            <span className="grow" />
            <label className="pl-sortbtn" title="Sort reviews"><Icon name="filter" size={16} /><span className="sr-only">Sort reviews</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as ReviewSort)} aria-label="Sort reviews">
              <option value="useful">Most useful</option>
              <option value="newest">Newest</option>
              <option value="high">Highest rated</option>
              <option value="low">Lowest rated</option>
            </select>
            <span aria-hidden="true">{({ useful: "Most useful", newest: "Newest", high: "Highest", low: "Lowest" } as Record<ReviewSort, string>)[sort]}</span><Icon name="down" size={14} /></label>
          </div>
        )}
        {reviews.length > 1 && (
          <div className="hscroll pl-filters" role="group" aria-label="Filter reviews">
            <button type="button" className={`chip ${filter === "all" ? "on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}><Icon name="list" size={15} />All</button>
            {photoCount > 0 && <button type="button" className={`chip ${filter === "photos" ? "on" : ""}`} aria-pressed={filter === "photos"} onClick={() => setFilter("photos")}><Icon name="camera" size={15} />{photoCount}</button>}
            {friendReviews > 0 && <button type="button" className={`chip ${filter === "friends" ? "on" : ""}`} aria-pressed={filter === "friends"} onClick={() => setFilter("friends")}><Icon name="people" size={15} />{friendReviews}</button>}
            {reviewedItems.length > 1 && reviewedItems.map((i) => {
              const f = `item:${i.id}` as const;
              return (
                <button key={i.id} type="button" className={`chip pl-item-chip ${filter === f ? "on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(filter === f ? "all" : f)}>
                  <ItemThumb path={imageOf.get(i.id)} icon={look.icon} size={24} />{i.name}
                </button>
              );
            })}
          </div>
        )}
        {!shopMode && filter.startsWith("item:") && (() => {
          const it = reviewedItems.find((i) => `item:${i.id}` === filter);
          return it ? <SimilarDishes itemId={it.id} name={it.name} /> : null;
        })()}
        {reviews.length === 0 ? (
          canRate || backToCode ? (
            <Link to={canRate ? rateUrl : backToCode!} replace={Boolean(backToCode)} className="pl-empty-reviews">
              <span className="icon-chip lg amber"><Icon name="star" size={26} fill="currentColor" /></span>
              <b>No reviews yet</b>
              <span className="small muted">Be the first to rate what you had</span>
            </Link>
          ) : (
            // Not a button: nothing happens on tap, so it shouldn't look tappable.
            <div className="pn-empty"><Icon name="message" size={28} /><b>No reviews yet</b><span className="small">Customers review by scanning the QR on their table</span></div>
          )
        ) : shown.length === 0 ? <div className="pn-empty"><Icon name="filter" size={28} /><b>No reviews match this filter</b><button type="button" className="link-btn small" onClick={() => setFilter("all")}>Show all reviews</button></div> :
          shown.map((r) => (
            <ReviewCard key={r.id} r={r} mine={Boolean(me && r.user_id === me)} friend={isFriend(r)} expert={r.user_id ? experts[r.user_id] || null : null}
              itemImage={imageOf.get(r.item_id)} itemIcon={look.icon} />
          ))}
        {moreReviews && reviews.length > 0 && (
          <button type="button" className="btn ghost block" disabled={loadingReviews} onClick={showMoreReviews}><Icon name="down" size={18} />{loadingReviews ? "Loading…" : "Show older reviews"}</button>
        )}
      </section>

          </>
        )}
        {tab === "photos" && (
          photos.length === 0
            ? <div className="pn-empty"><Icon name="camera" size={28} /><b>No photos yet</b><span className="small">Photos from verified visitors show up here</span></div>
            : <div className="pn-photos">{photos.map((r, i) => <PhotoTile key={r.id} path={r.photo_path!} name={itemLabel(r.items?.name)} delay={i * 0.06} />)}</div>
        )}
        {tab === "about" && (
          <>
            <PlatformRatingsCard
              ratings={parsedAbout.platformRatings}
              links={links}
              googlePlaceId={place.google_place_id}
              placeName={place.name}
              city={place.city}
              area={place.area}
            />

            <AmenitiesCard amenities={parsedAbout.amenities} />

            {(parsedAbout.story || (!onGoogle && (place.google_place_id || google))) && (
              <section className="pl-about">
                <div className="section-title">
                  <span className="icon-chip sm sky"><Icon name="info" size={16} /></span>
                  <span className="grow">About</span>
                </div>
                {parsedAbout.story && <p style={{ whiteSpace: "pre-line", fontSize: 15, lineHeight: 1.6 }}>{parsedAbout.story}</p>}
                {parsedAbout.fssai && (
                  <div className="pl-fssai-row">
                    <Icon name="verified" size={15} color="var(--accent)" />
                    <span className="tiny muted">FSSAI Central Food Safety License: <b style={{ color: "var(--ink)" }}>{parsedAbout.fssai}</b></span>
                  </div>
                )}
                {!onGoogle && google && (
                  <div className="row small" style={{ gap: 8, marginTop: 8 }}>
                    <Icon name="globe" size={16} color="var(--muted)" /><b>{google.rating.toFixed(1)}</b><Stars value={google.rating} size={13} /><span className="muted">{google.count.toLocaleString(undefined)} on Google</span>
                  </div>
                )}
                {!onGoogle && place.google_place_id && (
                  <a className="btn small ghost" href={googleMapsUrl(place.google_place_id, place.name, [place.area, place.city].filter(Boolean).join(", "))} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start", marginTop: 8 }}>
                    <Icon name="map" size={16} />Open in Maps<Icon name="external" size={14} />
                  </a>
                )}
                {!onGoogle && google && <span className="tiny muted">Google rating shown live from Google Maps.</span>}
              </section>
            )}

            {place.hours && Object.keys(place.hours).length > 0 && (
              <section className="pl-about">
                <div className="section-title"><span className="icon-chip sm amber"><Icon name="clock" size={16} /></span><span className="grow">Opening hours</span></div>
                <div className="pl-hours-all">{Object.entries(place.hours).map(([d, h]) => <div key={d}><b>{d}</b><span>{h}</span></div>)}</div>
              </section>
            )}
            {onGoogle && <OnGoogle key={place.google_place_id!} googlePlaceId={place.google_place_id!} />}

          </>
        )}
      </div>

      {links.length > 0 && (
        <section className="pn-links">
          <h2>Also find us <i>on</i></h2>
          <ShopLinks links={links} />
        </section>
      )}

      {!shopMode && !canManage && <Link to={`/claim/${place.id}`} className="pl-claim tiny muted row"><Icon name="store" size={14} />Own this business? Claim it free</Link>}

      {shopMode && (
        <a href="/" target="_blank" rel="noopener" className="pl-claim tiny muted row"><Icon name="search" size={14} />Explore more places on Trusted Picks</a>
      )}

      {peek && (
        <div className="sheet-backdrop" onClick={() => setPeek(null)}>
          <div className="sheet pl-peek" role="dialog" aria-modal="true" aria-labelledby="peek-h" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Escape") setPeek(null); }}>
            <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <span className="pl-peek-img"><ItemThumb path={peek.image_path} icon={look.icon} /></span>
              <div className="grow stack tight">
                <b id="peek-h" style={{ fontSize: 18 }}><DietDot diet={peek.diet} />{peek.name}</b>
                {peek.price_inr != null && <span className="small">{formatPrice(peek.price_inr, place.currency)}</span>}
              </div>
              <button type="button" className="icon-act" aria-label="Close" autoFocus onClick={() => setPeek(null)}><Icon name="close" size={18} /></button>
            </div>
            {peek.description && <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>{peek.description}</p>}
            <p className="small muted row" style={{ gap: 6, margin: 0 }}><Icon name="star" size={14} />No ratings yet. People rate it after scanning the QR on their table.</p>
          </div>
        </div>
      )}

      {canRate ? (
        <div className="pn-foot">
          <Link to={rateUrl} className="pn-foot-btn"><span className="pn-pulse"><Icon name="star" size={22} fill="currentColor" /></span><span className="grow"><b>Rate what you had</b><br />Takes under a minute</span><Icon name="chev" /></Link>
        </div>
      ) : backToCode && (
        <div className="pn-foot">
          <Link to={backToCode} replace className="pn-foot-btn"><span className="pn-pulse"><Icon name="star" size={22} fill="currentColor" /></span><span className="grow"><b>Rate what you had</b><br />Takes under a minute</span><Icon name="chev" /></Link>
        </div>
      )}
    </div>
  );
}
