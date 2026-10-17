import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase, searchPlaces, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Place, ReviewRow, SearchResult } from "../lib/types";
import { fetchGoogleRating, googleConfigured, type GoogleRating } from "../lib/google";
import { googleMapsUrl, initials, priceText, todaysHours } from "../lib/util";
import { placeMediaUrl } from "../lib/media";
import { shareLink, shareOrCopy } from "../lib/invite";
import { Avatar, Icon, Spinner, Stars, TopBar, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT, REVIEW_FEED } from "../components/ReviewCard";
import { ItemThumb } from "../components/place/ItemThumb";
import { loadShopItems, missingColumn, priceLabel, shopLook, sortShopItems, type ShopItem } from "../components/place/shop";
import { ShopLinks, cleanLinks } from "../components/place/ShopLinks";
import { ShopUpdates } from "../components/place/ShopUpdates";
import { OnGoogle } from "../components/place/OnGoogle";
import { deviceId } from "../lib/device";
import { placeSummary, type PlaceSummary } from "../lib/assist";
import { ReviewsPanel, type ReviewFilter } from "../components/place/ReviewsPanel";
import { SiteHome } from "../components/site/SiteHome";
import { isSiteStyle, siteStyleFor } from "../lib/siteStyles";
import "../styles/place.css";

export const PLACE_COLS = "id, google_place_id, name, category, area, city, about, hours, price_level, status, listed_until, created_at";

interface Stat { sum: number; count: number }

/** Newest columns first; older databases lack kind, then links, then cover/logo. */
async function loadPlace(id: string) {
  let r = await supabase.from("places").select(`${PLACE_COLS}, cover_path, logo_path, links, kind, site_style, tagline`).eq("id", id).maybeSingle();
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

export default function PlacePage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const me = session?.user.id;
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [aiSummary, setAiSummary] = useState<PlaceSummary | null>(null);
  const withText = reviews.filter((r) => (r.body || "").trim()).length;
  // Only worth asking once there's something to summarise; the answer is cached for a day.
  useEffect(() => {
    if (withText < 3) { setAiSummary(null); return; }
    let alive = true;
    placeSummary(id).then((s) => { if (alive) setAiSummary(s); });
    return () => { alive = false; };
  }, [id, withText >= 3]); // eslint-disable-line react-hooks/exhaustive-deps
  const [friends, setFriends] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [canManage, setCanManage] = useState(false);
  // Reviewing is only open during a visit started by scanning this shop's table QR.
  const [canRate, setCanRate] = useState(false);
  const [google, setGoogle] = useState<GoogleRating | null>(null);
  const [summary, setSummary] = useState<SearchResult | null>(null);
  const [experts, setExperts] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [allHours, setAllHours] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [coverOk, setCoverOk] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setErr(""); setLoadErr("");
      const { data, error } = await loadPlace(id);
      if (!alive) return;
      if (error) { setErr(errorText(error)); setPlace(null); return; }
      const pl = data as Place | null;
      setPlace(pl);
      if (!pl) return;
      if (pl.google_place_id) fetchGoogleRating(pl.google_place_id).then((g) => alive && setGoogle(g));
      const [it, r, sc] = await Promise.all([
        loadShopItems(id),
        supabase.from(REVIEW_FEED).select(REVIEW_SELECT).eq("place_id", id).eq("status", "published").order("created_at", { ascending: false }).limit(100),
        // Same score as Discover: one formula, computed in the database.
        searchPlaces({ p_place: id, p_limit: 1 }),
      ]);
      if (!alive) return;
      const firstErr = it.error || r.error || sc.error;
      if (firstErr) setLoadErr(errorText(firstErr));
      setItems(it.items);
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
    if (!me) { setFriends(new Set()); setSaved(false); setCanManage(false); setCanRate(false); return; }
    let alive = true;
    loadFriendIds(me).then((s) => alive && setFriends(s));
    supabase.from("saved_places").select("place_id").eq("user_id", me).eq("place_id", id).maybeSingle().then(({ data }) => alive && setSaved(Boolean(data)));
    supabase.rpc("can_manage_place", { p_place: id }).then(({ data, error }) => alive && setCanManage(!error && data === true), () => {});
    supabase.rpc("can_review", { p_place: id, p_device: deviceId() }).then(({ data, error }) => {
      if (alive) setCanRate(!error && Boolean((data as { allowed: boolean }[] | null)?.[0]?.allowed));
    }, () => {});
    return () => { alive = false; };
  }, [me, id]);

  const look = shopLook(place?.category, place?.kind);
  const stats = useMemo(() => {
    const m = new Map<string, Stat>();
    for (const r of reviews) {
      const s = m.get(r.item_id) || { sum: 0, count: 0 };
      s.sum += r.rating; s.count += 1;
      m.set(r.item_id, s);
    }
    return m;
  }, [reviews]);
  const products = useMemo(() => sortShopItems(items, (i) => stats.get(i.id)?.count ?? 0), [items, stats]);
  const imageOf = useMemo(() => new Map(items.map((i) => [i.id, i.image_path])), [items]);
  const isFriend = useCallback((r: ReviewRow) => Boolean(r.user_id && friends.has(r.user_id)), [friends]);
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
    const res = await shareOrCopy({ title: place?.name, url: await shareLink(`/p/${id}`, "place") });
    if (res === "copied") toast("Link copied");
  }

  if (place === undefined) return <div className="page"><Spinner /></div>;
  if (!place) return <div className="page"><TopBar /><div className="empty"><h2>This place isn't listed</h2><p>{err || "It may have been removed or its listing has lapsed."}</p></div></div>;

  const cover = coverOk ? placeMediaUrl(place.cover_path) : null;
  const logo = placeMediaUrl(place.logo_path);
  const score = summary?.trust_score != null ? Number(summary.trust_score) : null;
  const reviewCount = summary?.review_count ?? reviews.length;
  const verified = summary?.verified_count ?? reviews.filter((r) => r.verified).length;
  const friendNamed = (summary?.friend_ids || []).map((fid) => reviews.find((r) => r.user_id === fid)).filter((r): r is ReviewRow => Boolean(r));
  const friendCount = Math.max(summary?.friend_count ?? 0, friendNamed.length);
  const today = place.hours && Object.keys(place.hours).length ? todaysHours(place.hours) ?? "Closed today" : null;
  const rateUrl = `/review/${place.id}`;
  const links = cleanLinks((place as Place & { links?: unknown }).links);
  const onGoogle = Boolean(googleConfigured && place.google_place_id);

  const preview = params.get("style");
  const style = isSiteStyle(preview) ? preview : siteStyleFor(place);
  if (style !== "classic") return (
    <SiteHome place={place} style={style} look={look} menuName={look.menu} items={products} stats={stats} reviews={reviews} aiSummary={aiSummary}
      score={score} verified={verified} google={google} links={links} today={today} canRate={canRate} rateUrl={rateUrl}
      canManage={canManage} saved={saved} onSave={toggleSave} onShare={share}
      onReviewFocus={(itemId) => setFilter(itemId ? `item:${itemId}` : "all")}
      renderReviews={() => (
        <ReviewsPanel reviews={reviews} isFriend={isFriend} experts={experts} imageOf={imageOf} icon={look.icon} me={me}
          canRate={canRate} rateUrl={rateUrl} aiSummary={aiSummary} filter={filter} onFilter={setFilter} title={false} />
      )}
      googleBlock={onGoogle ? <OnGoogle key={place.google_place_id!} googlePlaceId={place.google_place_id!} /> : null} />
  );

  return (
    <div className="page pl-page">
      <div className={`pl-hero ${cover ? "has-cover" : ""}`} style={cover ? undefined : { background: look.grad }}>
        {cover ? <img className="pl-cover" src={cover} alt="" onError={() => setCoverOk(false)} /> : (
          <span className="pl-hero-art" aria-hidden="true"><Icon name={look.icon} size={150} width={1.2} /></span>
        )}
        <div className="pl-hero-bar">
          <button className="pl-glass" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/"))}><Icon name="back" /></button>
          <span className="grow" />
          {canManage && <Link to={`/manage/${place.id}`} className="pl-glass pill"><Icon name="settings" size={18} />Manage shop</Link>}
          <button className="pl-glass" aria-label={saved ? "Unsave" : "Save"} aria-pressed={saved} onClick={toggleSave}><Icon name="bookmark" fill={saved ? "currentColor" : undefined} /></button>
          <button className="pl-glass" aria-label="Share" onClick={share}><Icon name="share" /></button>
        </div>
      </div>

      <section className="pl-head">
        <span className="pl-logo" style={{ background: look.grad }}>
          <Img src={logo} alt={`${place.name} logo`} />
          <span className="pl-logo-txt">{initials(place.name)}</span>
        </span>
        {score != null ? (
          <div className="pl-score" aria-label={`Trust score ${score.toFixed(1)} of 5`}>
            <span className="n">{score.toFixed(1)}<Icon name="star" size={15} fill="currentColor" /></span>
            <span className="l"><Icon name="shield" size={11} />Trust</span>
          </div>
        ) : (
          <div className="pl-score none" aria-label="Not rated yet">
            <span className="n"><Icon name="spark" size={18} /></span>
            <span className="l">New</span>
          </div>
        )}
        <h1>{place.name}</h1>
        <div className="pl-meta">
          <span><Icon name={look.icon} size={15} />{place.category}</span>
          {(place.area || place.city) && <span><Icon name="pin" size={15} />{place.area || place.city}</span>}
          {priceText(place.price_level) && <span className="pl-price-level">{priceText(place.price_level)}</span>}
        </div>
        {today && (
          <button type="button" className="pl-hours" onClick={() => setAllHours(!allHours)} aria-expanded={allHours}>
            <Icon name="clock" size={15} /><span>{today}</span><Icon name={allHours ? "up" : "down"} size={14} />
          </button>
        )}
        {allHours && place.hours && (
          <div className="pl-hours-all">{Object.entries(place.hours).map(([d, h]) => <div key={d}><b>{d}</b><span>{h}</span></div>)}</div>
        )}

        <div className="pl-stats">
          <span title="Reviews"><Icon name="message" size={16} /><b>{reviewCount}</b><span>reviews</span></span>
          <span title="Verified visits"><Icon name="verified" size={16} /><b>{verified}</b><span>verified</span></span>
          {google ? <a href={onGoogle ? "#on-google" : place.google_place_id ? googleMapsUrl(place.google_place_id, place.name) : undefined} {...(onGoogle ? { onClick: (e: React.MouseEvent) => { e.preventDefault(); document.getElementById("on-google")?.scrollIntoView({ behavior: "smooth", block: "start" }); } } : { target: "_blank", rel: "noreferrer" })} title="Google rating"><Icon name="globe" size={16} /><b>{google.rating.toFixed(1)}</b><span>Google</span></a>
            : summary?.has_qr ? <span title="Table QR"><Icon name="qr" size={16} /><b><Icon name="check" size={14} width={3} /></b><span>table QR</span></span> : null}
        </div>

        {friendCount > 0 && (
          <div className="pl-friends">
            <span className="avatars">
              {friendNamed.slice(0, 3).map((r) => <Avatar key={r.user_id} id={r.user_id!} name={r.author_name} path={r.author_avatar} size="sm" />)}
              {!friendNamed.length && <span className="avatar sm pl-fdot"><Icon name="people" size={13} /></span>}
            </span>
            <span className="small">
              {friendNamed.length
                ? <><b>{friendNamed[0]!.author_name || "A friend"}</b>{friendCount > 1 ? ` + ${friendCount - 1} friend${friendCount > 2 ? "s" : ""}` : ""} rated this</>
                : <><b>{friendCount} friends</b> rated this</>}
            </span>
          </div>
        )}

        {canRate
          ? <Link to={rateUrl} className="btn green block pl-cta"><Icon name="star" size={20} fill="#fff" />Rate what you had</Link>
          : <p className="pl-cta-note"><Icon name="qr" size={16} />At the shop? Point your phone camera at the QR on your table to review.</p>}
      </section>

      <ShopLinks links={links} />
      <ShopUpdates placeId={place.id} />

      {loadErr && <div className="notice err row"><span className="grow">Couldn't load everything: {loadErr}</span><button className="link-btn" onClick={() => setAttempt((n) => n + 1)}><Icon name="refresh" size={16} />Retry</button></div>}

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
          <div className="hscroll pl-products">
            {products.map((p) => {
              const s = stats.get(p.id);
              return (
                <Link key={p.id} to={canRate ? `${rateUrl}?item=${p.id}` : `#reviews`} className="pl-product" aria-label={canRate ? `Rate ${p.name}` : `Reviews of ${p.name}`}
                  onClick={canRate ? undefined : (e) => { e.preventDefault(); if (s) { setFilter(`item:${p.id}`); document.getElementById("reviews")?.scrollIntoView({ behavior: "smooth" }); } }}>
                  <span className="pl-product-img">
                    <ItemThumb path={p.image_path} icon={look.icon} />
                    {s && <span className="pl-product-rate"><Icon name="star" size={12} fill="currentColor" />{(s.sum / s.count).toFixed(1)}<span>· {s.count}</span></span>}
                  </span>
                  <span className="pl-product-body">
                    <span className="pl-product-name">{p.name}</span>
                    <span className="pl-product-foot">
                      {priceLabel(p.price_inr) ? <span className="pl-price">{priceLabel(p.price_inr)}</span> : <span className="muted tiny">{s ? "" : "New"}</span>}
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
      </section>

      <ReviewsPanel reviews={reviews} isFriend={isFriend} experts={experts} imageOf={imageOf} icon={look.icon} me={me}
        canRate={canRate} rateUrl={rateUrl} aiSummary={aiSummary} filter={filter} onFilter={setFilter} />

      {(place.about || (!onGoogle && (place.google_place_id || google))) && (
        <section className="pl-about">
          <div className="section-title">
            <span className="icon-chip sm sky"><Icon name="info" size={16} /></span>
            <span className="grow">About</span>
          </div>
          {place.about && <p>{place.about}</p>}
          {!onGoogle && google && (
            <div className="row small" style={{ gap: 8 }}>
              <Icon name="globe" size={16} color="var(--muted)" /><b>{google.rating.toFixed(1)}</b><Stars value={google.rating} size={13} /><span className="muted">{google.count.toLocaleString("en-IN")} on Google</span>
            </div>
          )}
          {!onGoogle && place.google_place_id && (
            <a className="btn small ghost" href={googleMapsUrl(place.google_place_id, place.name)} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
              <Icon name="map" size={16} />Open in Maps<Icon name="external" size={14} />
            </a>
          )}
          {!onGoogle && google && <span className="tiny muted">Google rating shown live from Google Maps.</span>}
        </section>
      )}

      {onGoogle && <OnGoogle key={place.google_place_id!} googlePlaceId={place.google_place_id!} />}
    </div>
  );
}
