import { Link } from "react-router-dom";
import type { Profile, SearchResult } from "../../lib/types";
import { distanceText } from "../../lib/util";
import { priceLevelText } from "../../lib/money";
import { Avatar, Icon } from "../ui";
import { Cover } from "./Kit";

/** Looked up per result: photos, and the currency its price level is in. */
export interface Media {
  cover_path: string | null; logo_path: string | null; currency?: string | null;
  /** Google's rating and review count, saved by onboarding (migration 42). */
  google_rating?: number | null; google_rating_count?: number | null;
}

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Rating({ r }: { r: SearchResult }) {
  return r.trust_score != null
    ? <span className="rating-pill" aria-label={`Rated ${Number(r.trust_score).toFixed(1)}`}><Icon name="star" size={12} fill="#fff" />{Number(r.trust_score).toFixed(1)}</span>
    : <span className="rating-pill none"><Icon name="spark" size={12} />New</span>;
}

function Friends({ r, people }: { r: SearchResult; people: Record<string, Profile> }) {
  if (r.friend_count <= 0) return null;
  const named = r.friend_ids.slice(0, 3);
  return (
    <span className="pill friends" aria-label={`${r.friend_count} friend${r.friend_count > 1 ? "s" : ""} rated this`}>
      {named.length > 0
        ? <span className="avatars" style={{ marginLeft: -4 }}>{named.map((id) => <Avatar key={id} id={id} name={people[id]?.display_name} path={people[id]?.avatar_path} size="sm" />)}</span>
        : <Icon name="people" size={13} />}
      {r.friend_count}
    </span>
  );
}

export function PlaceCard({ r, people, coverUrl, currency, google }: { r: SearchResult; people: Record<string, Profile>; coverUrl: string | null; currency?: string | null; google?: Media }) {
  const dist = distanceText(r.distance_m);
  return (
    <Link to={`/p/${r.place_id}`} className="place-card">
      <span className="thumb"><Cover url={coverUrl} category={r.category} /></span>
      <span className="body">
        <span className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <span className="name grow ellipsis">{r.name}</span>
          <Rating r={r} />
        </span>
        <span className="meta">
          <span>{r.category}</span>
          {r.area && <span><Icon name="pin" size={12} />{r.area}</span>}
          {dist && <span><Icon name="navigate" size={11} />{dist}</span>}
          {r.price_level ? <span>{priceLevelText(r.price_level, currency)}</span> : null}
        </span>
        <span className="badges">
          <Friends r={r} people={people} />
          {r.verified_count > 0 && <span className="pill verified" title="Verified visits"><Icon name="verified" size={13} />{r.verified_count}</span>}
          {r.has_qr && !r.verified_count && <span className="pill verified" title="Table QR"><Icon name="qr" size={13} /></span>}
          {r.review_count > 0 && <span className="pill gray" title="Reviews"><Icon name="message" size={12} />{r.review_count}</span>}
          {google?.google_rating != null && (
            <span className="pill gray" title={`${google.google_rating} on Google from ${(google.google_rating_count ?? 0).toLocaleString(undefined)} reviews`}>
              <b>G</b>{Number(google.google_rating).toFixed(1)}<Icon name="star" size={11} fill="currentColor" />{google.google_rating_count ? <span className="muted">{compact(google.google_rating_count)}</span> : null}
            </span>
          )}
          {r.top_item && <span className="pill loved" title="Most loved"><Icon name="heart" size={12} fill="currentColor" /><span>{r.top_item}</span></span>}
        </span>
      </span>
    </Link>
  );
}

export function PickCard({ r, people, coverUrl }: { r: SearchResult; people: Record<string, Profile>; coverUrl: string | null }) {
  return (
    <Link to={`/p/${r.place_id}`} className="pick-card">
      <span className="thumb"><Cover url={coverUrl} category={r.category} size={40} /><Rating r={r} /></span>
      <span className="pc-body">
        <span className="strong ellipsis">{r.name}</span>
        <span className="row" style={{ gap: 6 }}>
          <Friends r={r} people={people} />
          {r.top_item && <span className="pill loved" style={{ minWidth: 0 }}><Icon name="heart" size={12} fill="currentColor" /><span>{r.top_item}</span></span>}
        </span>
      </span>
    </Link>
  );
}
