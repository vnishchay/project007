import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Place, ReviewRow } from "../../lib/types";
import type { PlaceSummary } from "../../lib/assist";
import type { GoogleRating } from "../../lib/google";
import type { SiteStyle } from "../../lib/siteStyles";
import { summarize } from "../../lib/reviews";
import { googleMapsUrl } from "../../lib/util";
import { placeMediaUrl } from "../../lib/media";
import { Icon } from "../ui";
import { Sheet } from "../Sheet";
import { ShopLinks, type PlaceLink } from "../place/ShopLinks";
import { ShopUpdates } from "../place/ShopUpdates";
import type { ShopItem, ShopLook } from "../place/shop";
import { priceLabel } from "../place/shop";
import { MenuPanel } from "./MenuPanel";
import "../../styles/site.css";

interface Stat { sum: number; count: number }

export interface SiteProps {
  place: Place;
  style: SiteStyle;
  look: ShopLook;
  menuName: string;
  items: ShopItem[];
  stats: Map<string, Stat>;
  reviews: ReviewRow[];
  aiSummary: PlaceSummary | null;
  score: number | null;
  verified: number;
  google: GoogleRating | null;
  links: PlaceLink[];
  today: string | null;
  canRate: boolean;
  rateUrl: string;
  canManage: boolean;
  saved: boolean;
  onSave: () => void;
  onShare: () => void;
  /** the reviews list, rendered by the page so it shares filters with the rest of the app */
  renderReviews: () => ReactNode;
  /** narrow the reviews to one item (or show all) before the sheet opens */
  onReviewFocus: (itemId: string | null) => void;
  /** Google's own rating and reviews, loaded only when the reviews sheet is open */
  googleBlock: ReactNode;
}

type SheetKind = "menu" | "reviews" | "visit" | null;

function firstSentence(t: string | null | undefined, max = 140): string {
  const s = (t || "").trim().split(/(?<=[.!?])\s/)[0] || "";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Elements with data-reveal fade and rise in as they scroll into view. */
function useReveal(root: React.RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (!("IntersectionObserver" in window)) { nodes.forEach((n) => n.classList.add("in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root, key]);
}

/** Scroll position as a CSS variable, for parallax. */
function useScrollVar(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => root.current?.style.setProperty("--sy", String(Math.min(window.scrollY, 1200)))); };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, [root]);
}

/** Cards that lean toward the pointer, in 3D. */
function tilt(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  e.currentTarget.style.setProperty("--rx", `${(-y * 14).toFixed(2)}deg`);
  e.currentTarget.style.setProperty("--ry", `${(x * 16).toFixed(2)}deg`);
}
function untilt(e: React.PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty("--rx", "0deg");
  e.currentTarget.style.setProperty("--ry", "0deg");
}

function Img({ src, alt = "", className }: { src: string | null; alt?: string; className?: string }) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]);
  return src && ok ? <img src={src} alt={alt} className={className} loading="lazy" onError={() => setOk(false)} /> : null;
}

export function SiteHome(p: SiteProps) {
  const { place, style, look } = p;
  const nav = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const close = useCallback(() => setSheet(null), []);
  useReveal(root, style);
  useScrollVar(root);

  const cover = placeMediaUrl(place.cover_path);
  const logo = placeMediaUrl(place.logo_path);
  const sum = useMemo(() => summarize(p.reviews), [p.reviews]);
  const withPhoto = p.items.filter((i) => i.image_path);
  const signature = (withPhoto.length ? withPhoto : p.items).slice(0, 8);
  const gallery = [...new Set([cover, ...withPhoto.map((i) => placeMediaUrl(i.image_path))].filter((x): x is string => Boolean(x)))].slice(0, 7);
  const rating = p.score ?? (sum.count ? sum.average : null);
  const ownerLine = place.tagline?.trim() || firstSentence(place.about) || `${place.category} in ${place.area || place.city}`;
  const peopleLine = p.aiSummary?.summary ? firstSentence(p.aiSummary.summary, 160)
    : sum.count === 0 ? "No reviews yet. Reviews here come only from people who visited."
    : sum.liked.length ? `Most mention ${sum.liked.slice(0, 2).map(([l]) => l.toLowerCase()).join(" and ")}${sum.better[0] ? `; some say ${sum.better[0][0].toLowerCase()}` : ""}.`
    : `${sum.count} verified review${sum.count === 1 ? "" : "s"}, averaging ${sum.average.toFixed(1)} stars.`;
  const directions = place.google_place_id ? googleMapsUrl(place.google_place_id, place.name)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.area, place.city].filter(Boolean).join(" "))}`;
  const phone = p.links.find((l) => /^tel:/i.test(l.url));
  const words = place.name.trim().split(/\s+/);
  const half = Math.ceil(words.length / 2);
  const nameA = words.slice(0, half).join(" "), nameB = words.slice(half).join(" ");

  const openMenu = (itemId?: string) => { setFocus(itemId ?? null); setSheet("menu"); };
  const openReviews = (itemId?: string) => { p.onReviewFocus(itemId ?? null); setSheet("reviews"); };

  const back = () => (window.history.length > 1 ? nav(-1) : nav("/"));
  const ratingChip = rating != null && (
    <span className="st-chip rate"><Icon name="star" size={14} fill="currentColor" />{rating.toFixed(1)}<span>{p.verified} verified</span></span>
  );

  const topBar = (
    <header className="st-top">
      <button type="button" className="st-round light" aria-label="Back" onClick={back}><Icon name="back" size={22} /></button>
      <span className="st-top-label">{place.category}</span>
      <span className="st-pill">
        {p.canManage && <Link to={`/manage/${place.id}?tab=site`} className="st-round ghost" aria-label="Edit website"><Icon name="settings" size={19} /></Link>}
        <button type="button" className="st-round ghost" aria-label={p.saved ? "Unsave" : "Save"} aria-pressed={p.saved} onClick={p.onSave}><Icon name="bookmark" size={19} fill={p.saved ? "currentColor" : undefined} /></button>
        <button type="button" className="st-round light" aria-label="Share" onClick={p.onShare}><Icon name="share" size={19} /></button>
      </span>
    </header>
  );

  return (
    <div className={`st st-${style}`} ref={root} style={{ "--grad": look.grad } as CSSProperties}>
      {style === "glass" && <div className="st-bg" aria-hidden="true">{cover ? <img src={cover} alt="" /> : <span style={{ background: look.grad }} />}</div>}
      {style === "pop" && <div className="st-blobs" aria-hidden="true"><i /><i /><i /></div>}

      <div className="st-wrap">
        {topBar}
        {style === "noir" && <NoirHero {...{ nameA, nameB, place, ownerLine, ratingChip, signature, look, openMenu, logo }} />}
        {style === "glass" && <GlassHero {...{ nameA, nameB, place, ownerLine, ratingChip, signature, look, openMenu, openReviews, setSheet }} />}
        {style === "editorial" && <EditorialHero {...{ nameA, nameB, place, ownerLine, ratingChip, cover, look, tags: sum.liked.map(([l]) => l) }} />}
        {style === "pop" && <PopHero {...{ nameA, nameB, place, ownerLine, rating, verified: p.verified, logo, look }} />}

        <div className="st-actions" data-reveal>
          <button type="button" className="st-act main" onClick={() => openMenu()}><Icon name={look.icon} size={20} />{p.menuName}</button>
          <button type="button" className="st-act" onClick={() => openReviews()}><Icon name="message" size={20} />Reviews</button>
          <a className="st-act" href={directions} target="_blank" rel="noreferrer"><Icon name="navigate" size={20} />Directions</a>
          {phone && <a className="st-act" href={phone.url}><Icon name="phone" size={20} />Call</a>}
        </div>

        {p.canRate && (
          <Link to={p.rateUrl} className="st-rate" data-reveal><Icon name="star" size={20} fill="currentColor" />You're here. Rate what you had</Link>
        )}

        <button type="button" className="st-consensus" data-reveal onClick={() => openReviews()}>
          <span className="st-kicker"><Icon name="spark" size={14} />In short</span>
          <span className="st-says">
            <span className="st-who"><Icon name="store" size={16} />{place.name} says</span>
            <span className="st-line">“{ownerLine}”</span>
          </span>
          <span className="st-says">
            <span className="st-who"><Icon name="people" size={16} />Customers say</span>
            <span className="st-line">{peopleLine}</span>
          </span>
          <span className="st-more">{ratingChip}<span className="grow" />All reviews<Icon name="chev" size={16} /></span>
        </button>

        {signature.length > 0 && (
          <section className="st-sec" data-reveal>
            <SecHead n="01" title={style === "editorial" ? "The signatures" : "Signature picks"} action={<button type="button" className="st-link" onClick={() => openMenu()}>Full {p.menuName.toLowerCase()}<Icon name="chev" size={15} /></button>} />
            <div className="st-cards">
              {signature.map((it) => {
                const s = p.stats.get(it.id);
                const img = placeMediaUrl(it.image_path);
                return (
                  <button key={it.id} type="button" className="st-card" onClick={() => openMenu(it.id)} onPointerMove={style === "pop" ? tilt : undefined} onPointerLeave={style === "pop" ? untilt : undefined}>
                    <span className="st-card-img">{img ? <Img src={img} alt={it.name} /> : <Icon name={look.icon} size={44} width={1.4} />}</span>
                    <span className="st-card-body">
                      <b>{it.name}</b>
                      <span className="st-card-meta">
                        {priceLabel(it.price_inr) && <span>{priceLabel(it.price_inr)}</span>}
                        {s && <span><Icon name="star" size={12} fill="currentColor" />{(s.sum / s.count).toFixed(1)}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {gallery.length > 1 && (
          <section className="st-sec" data-reveal>
            <SecHead n="02" title="Inside" />
            <div className={`st-gallery n${Math.min(gallery.length, 5)}`}>
              {gallery.slice(0, 5).map((g, i) => <span key={g} className={`st-g g${i}`}><Img src={g} /></span>)}
            </div>
          </section>
        )}

        <section className="st-sec st-updates" data-reveal>
          <ShopUpdates placeId={place.id} />
        </section>

        <section className="st-sec" data-reveal>
          <SecHead n="03" title="Visit" />
          <div className="st-visit">
            <div className="st-visit-row"><Icon name="pin" size={18} /><span className="grow">{[place.area, place.city].filter(Boolean).join(", ")}</span><a href={directions} target="_blank" rel="noreferrer" className="st-link">Map<Icon name="external" size={14} /></a></div>
            {p.today && <button type="button" className="st-visit-row" onClick={() => setSheet("visit")}><Icon name="clock" size={18} /><span className="grow">Today: {p.today}</span><span className="st-link">All hours<Icon name="chev" size={15} /></span></button>}
            {p.google && <div className="st-visit-row"><Icon name="globe" size={18} /><span className="grow">{p.google.rating.toFixed(1)} on Google from {p.google.count.toLocaleString("en-IN")} reviews</span></div>}
          </div>
          {p.links.length > 0 && <div className="st-links"><ShopLinks links={p.links} /></div>}
        </section>

        <footer className="st-foot">
          <span className="st-foot-name">{place.name}</span>
          <span className="st-foot-badge"><Icon name="verified" size={14} />Reviews verified by Trusted Picks: only people who visited can post.</span>
          <Link to="/business" className="st-foot-link">Own a business? Get your own site</Link>
        </footer>
      </div>

      <nav className="st-dock" aria-label={`${place.name} menu`}>
        <button type="button" onClick={() => openMenu()} aria-label={p.menuName}><Icon name={look.icon} size={21} /></button>
        <button type="button" onClick={() => openReviews()} aria-label="Reviews"><Icon name="message" size={21} /></button>
        {p.canRate
          ? <Link to={p.rateUrl} className="main" aria-label="Rate"><Icon name="star" size={22} fill="currentColor" /></Link>
          : <a href={directions} target="_blank" rel="noreferrer" className="main" aria-label="Directions"><Icon name="navigate" size={22} /></a>}
        <button type="button" onClick={p.onShare} aria-label="Share"><Icon name="share" size={21} /></button>
      </nav>

      <Sheet open={sheet === "menu"} onClose={close} title={<span className="row" style={{ gap: 8 }}><Icon name={look.icon} size={20} />{p.menuName}</span>}>
        <MenuPanel items={p.items} stats={p.stats} icon={look.icon} canRate={p.canRate} rateUrl={p.rateUrl} focus={focus} onReviews={(id) => openReviews(id)} />
      </Sheet>
      <Sheet open={sheet === "reviews"} onClose={close} title={<span className="row" style={{ gap: 8 }}><Icon name="message" size={20} />Reviews</span>}>
        {p.renderReviews()}
        {p.googleBlock}
      </Sheet>
      <Sheet open={sheet === "visit"} onClose={close} title="Opening hours">
        {place.hours && <div className="pl-hours-all" style={{ display: "grid" }}>{Object.entries(place.hours).map(([d, h]) => <div key={d}><b>{d}</b><span>{h}</span></div>)}</div>}
      </Sheet>
    </div>
  );
}

function SecHead({ n, title, action }: { n: string; title: string; action?: ReactNode }) {
  return <div className="st-sec-head"><span className="st-num">{n}</span><h2>{title}</h2><span className="grow" />{action}</div>;
}

interface HeroBase { nameA: string; nameB: string; place: Place; ownerLine: string; look: ShopLook }

/** Noir: black, oversized light type, a glass card with the signature dish turning slowly on its plate. */
function NoirHero({ nameA, nameB, place, ownerLine, ratingChip, signature, look, openMenu, logo }: HeroBase & {
  ratingChip: ReactNode; signature: ShopItem[]; openMenu: (id?: string) => void; logo: string | null;
}) {
  const [i, setI] = useState(0);
  const it = signature[i % Math.max(signature.length, 1)];
  const img = it ? placeMediaUrl(it.image_path) : null;
  const step = (d: number) => setI((x) => (x + d + signature.length) % signature.length);
  return (
    <section className="st-hero">
      <h1 className="st-name"><span>{nameA}</span>{nameB && <span>{nameB}</span>}</h1>
      <div className="st-sub"><span className="st-tag">{ownerLine}</span><span className="st-area">{place.area || place.city}</span></div>
      <div className="st-chips">{ratingChip}</div>
      <div className="st-plate-card" data-reveal>
        {signature.length > 1 && <button type="button" className="st-arrow l" aria-label="Previous" onClick={() => step(-1)}><Icon name="back" size={22} /></button>}
        <button type="button" className="st-plate" onClick={() => openMenu(it?.id)} aria-label={it ? `See ${it.name} on the menu` : "See the menu"}>
          {img ? <img key={img} src={img} alt="" /> : logo ? <img src={logo} alt="" /> : <Icon name={look.icon} size={64} width={1.3} />}
        </button>
        {signature.length > 1 && <button type="button" className="st-arrow r" aria-label="Next" onClick={() => step(1)}><Icon name="chev" size={22} /></button>}
        <b className="st-plate-name">{it?.name || place.category}</b>
        <span className="st-plate-desc">{it?.description || (it && priceLabel(it.price_inr)) || ownerLine}</span>
      </div>
    </section>
  );
}

/** Glass: the shop's photo behind everything, big right-aligned title, tall frosted cards that slide. */
function GlassHero({ nameA, nameB, place, ownerLine, ratingChip, signature, look, openMenu, openReviews, setSheet }: HeroBase & {
  ratingChip: ReactNode; signature: ShopItem[]; openMenu: (id?: string) => void; openReviews: (id?: string) => void; setSheet: (s: SheetKind) => void;
}) {
  return (
    <section className="st-hero">
      <h1 className="st-name"><span>{nameA}</span>{nameB && <span>{nameB}</span>}</h1>
      <div className="st-sub"><span className="st-area">{place.area || place.city}</span><span className="st-tag">{ownerLine}</span></div>
      <div className="st-tabs">
        <button type="button" className="on" onClick={() => openMenu()}>{look.menu}</button>
        <button type="button" onClick={() => openReviews()}>Reviews</button>
        {place.hours && <button type="button" onClick={() => setSheet("visit")}>Hours</button>}
        {ratingChip}
      </div>
      {signature.length > 0 && (
        <div className="st-tall" data-reveal>
          {signature.slice(0, 6).map((it) => {
            const img = placeMediaUrl(it.image_path);
            return (
              <button key={it.id} type="button" className="st-tall-card" onClick={() => openMenu(it.id)}>
                {img ? <img src={img} alt="" loading="lazy" /> : <span className="st-tall-ph" style={{ background: look.grad }}><Icon name={look.icon} size={56} width={1.3} /></span>}
                <span className="st-tall-go" aria-hidden="true"><Icon name="chev" size={26} /></span>
                <b>{it.name}</b>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Editorial: warm paper, serif display type, an arched photo with parallax, a moving headline band. */
function EditorialHero({ nameA, nameB, place, ownerLine, ratingChip, cover, look, tags }: HeroBase & { ratingChip: ReactNode; cover: string | null; tags: string[] }) {
  const band = [place.category, ...(tags.length ? tags : [place.area || place.city]), "Verified reviews"].filter(Boolean) as string[];
  return (
    <section className="st-hero">
      <span className="st-kicker">{place.category} · {place.area || place.city}</span>
      <h1 className="st-name"><span>{nameA}</span>{nameB && <em>{nameB}</em>}</h1>
      <p className="st-tag">{ownerLine}</p>
      <div className="st-chips">{ratingChip}</div>
      <div className="st-arch" data-reveal>
        {cover ? <img src={cover} alt="" /> : <span className="st-arch-ph" style={{ background: look.grad }}><Icon name={look.icon} size={90} width={1.1} /></span>}
      </div>
      <div className="st-marquee" aria-hidden="true">
        <div>{[...band, ...band, ...band].map((t, i) => <span key={i}>{t}<i>✦</i></span>)}</div>
      </div>
    </section>
  );
}

/** Pop: loud colour, chunky type, a spinning badge with the rating and floating stickers. */
function PopHero({ nameA, nameB, place, ownerLine, rating, verified, logo, look }: HeroBase & { rating: number | null; verified: number; logo: string | null }) {
  const ring = "VERIFIED REVIEWS • TRUSTED PICKS • ";
  return (
    <section className="st-hero">
      <span className="st-sticker s1">{place.category}</span>
      <h1 className="st-name"><span>{nameA}</span>{nameB && <span>{nameB}</span>}</h1>
      <p className="st-tag">{ownerLine}</p>
      <div className="st-pop-row">
        <span className="st-badge" aria-label={rating != null ? `Rated ${rating.toFixed(1)}` : "New here"}>
          <svg viewBox="0 0 120 120" aria-hidden="true"><defs><path id="st-ring" d="M60 60m-46 0a46 46 0 1 1 92 0a46 46 0 1 1-92 0" /></defs>
            <text><textPath href="#st-ring">{ring + ring}</textPath></text></svg>
          <b>{rating != null ? rating.toFixed(1) : "New"}</b>
          <span>{verified} verified</span>
        </span>
        <span className="st-pop-logo" style={{ background: look.grad }}>{logo ? <img src={logo} alt="" /> : <Icon name={look.icon} size={46} />}</span>
        <span className="st-sticker s2">{place.area || place.city}</span>
      </div>
    </section>
  );
}

