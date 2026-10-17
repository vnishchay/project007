import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewRow } from "../../lib/types";
import type { PlaceSummary } from "../../lib/assist";
import { sortReviews, summarize, type ReviewSort } from "../../lib/reviews";
import { Icon, Stars, type IconName } from "../ui";
import { ReviewCard } from "../ReviewCard";
import { ItemThumb } from "./ItemThumb";

export type ReviewFilter = "all" | "photos" | "friends" | `item:${string}` | `stars:${number}`;

/** Summary, star filter, sorting and the review list. Used on the classic page and in the website's reviews sheet. */
export function ReviewsPanel({ reviews, isFriend, experts, imageOf, icon, me, canRate, rateUrl, aiSummary, filter, onFilter, title = true }: {
  reviews: ReviewRow[];
  isFriend: (r: ReviewRow) => boolean;
  experts: Record<string, string>;
  imageOf: Map<string, string | null>;
  icon: IconName;
  me?: string;
  canRate: boolean;
  rateUrl: string;
  aiSummary: PlaceSummary | null;
  filter: ReviewFilter;
  onFilter: (f: ReviewFilter) => void;
  title?: boolean;
}) {
  const [sort, setSort] = useState<ReviewSort>("useful");
  const sum = useMemo(() => summarize(reviews), [reviews]);
  const sorted = useMemo(() => sortReviews(reviews, sort, isFriend), [reviews, sort, isFriend]);
  const reviewedItems = useMemo(() => {
    const seen = new Map<string, { name: string; count: number }>();
    for (const r of reviews) {
      if (!r.items?.name) continue;
      const s = seen.get(r.item_id) || { name: r.items.name, count: 0 };
      s.count += 1;
      seen.set(r.item_id, s);
    }
    return [...seen].map(([id, s]) => ({ id, ...s })).sort((a, b) => b.count - a.count);
  }, [reviews]);
  const photoCount = reviews.filter((r) => r.photo_path).length;
  const friendReviews = reviews.filter(isFriend).length;
  const shown = sorted.filter((r) =>
    filter === "all" ? true : filter === "photos" ? Boolean(r.photo_path) : filter === "friends" ? isFriend(r)
    : filter.startsWith("stars:") ? r.rating === Number(filter.slice(6)) : r.item_id === filter.slice(5));

  return (
    <section className="stack" style={{ gap: 12 }} id="reviews">
      {aiSummary && (
        <div className="pl-summary">
          <span className="row tiny strong" style={{ gap: 6 }}><Icon name="spark" size={14} />What people say</span>
          <p className="small">{aiSummary.summary}</p>
          {aiSummary.highlights.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{aiSummary.highlights.map((h) => <span key={h} className="pill">{h}</span>)}</div>}
          <span className="tiny muted">Summarised by AI from reviews here</span>
        </div>
      )}
      {title && (
        <div className="section-title">
          <span className="icon-chip sm amber"><Icon name="message" size={16} /></span>
          <span className="grow">Reviews</span>
          {reviews.length > 0 && <span className="muted">{reviews.length}</span>}
        </div>
      )}
      {reviews.length > 0 && (
        <div className="rs" aria-label="Review summary">
          <div className="rs-avg">
            <b>{sum.average.toFixed(1)}</b>
            <Stars value={Math.round(sum.average)} size={14} />
            <span className="tiny muted">{sum.count} review{sum.count === 1 ? "" : "s"}</span>
          </div>
          <div className="rs-bars" role="group" aria-label="Filter by stars">
            {[5, 4, 3, 2, 1].map((n) => {
              const c = sum.stars[n - 1] ?? 0;
              const f = `stars:${n}` as const;
              return (
                <button key={n} type="button" className={`rs-bar ${filter === f ? "on" : ""}`} disabled={!c} aria-pressed={filter === f}
                  aria-label={`${n} stars: ${c}`} onClick={() => onFilter(filter === f ? "all" : f)}>
                  <span>{n}★</span><span className="track"><span className="fill" style={{ width: `${sum.count ? (c / sum.count) * 100 : 0}%` }} /></span><span>{c}</span>
                </button>
              );
            })}
          </div>
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
          <span className="small muted">{shown.length === reviews.length ? "All reviews" : `${shown.length} of ${reviews.length}`}</span>
          <select className="select pl-sort" style={{ width: "auto", padding: "6px 10px", fontSize: 13 }} value={sort} onChange={(e) => setSort(e.target.value as ReviewSort)} aria-label="Sort reviews">
            <option value="useful">Most useful</option>
            <option value="newest">Newest</option>
            <option value="high">Highest rated</option>
            <option value="low">Lowest rated</option>
          </select>
        </div>
      )}
      {reviews.length > 1 && (
        <div className="hscroll pl-filters" role="group" aria-label="Filter reviews">
          <button type="button" className={`chip ${filter === "all" ? "on" : ""}`} aria-pressed={filter === "all"} onClick={() => onFilter("all")}><Icon name="list" size={15} />All</button>
          {photoCount > 0 && <button type="button" className={`chip ${filter === "photos" ? "on" : ""}`} aria-pressed={filter === "photos"} onClick={() => onFilter("photos")}><Icon name="camera" size={15} />{photoCount}</button>}
          {friendReviews > 0 && <button type="button" className={`chip ${filter === "friends" ? "on" : ""}`} aria-pressed={filter === "friends"} onClick={() => onFilter("friends")}><Icon name="people" size={15} />{friendReviews}</button>}
          {reviewedItems.length > 1 && reviewedItems.map((i) => {
            const f = `item:${i.id}` as const;
            return (
              <button key={i.id} type="button" className={`chip pl-item-chip ${filter === f ? "on" : ""}`} aria-pressed={filter === f} onClick={() => onFilter(filter === f ? "all" : f)}>
                <ItemThumb path={imageOf.get(i.id)} icon={icon} size={24} />{i.name}
              </button>
            );
          })}
        </div>
      )}
      {reviews.length === 0 ? (
        <Link to={canRate ? rateUrl : "#"} className="pl-empty-reviews" onClick={canRate ? undefined : (e) => e.preventDefault()}>
          <span className="icon-chip lg amber"><Icon name="star" size={26} fill="currentColor" /></span>
          <b>No reviews yet</b>
          <span className="small muted">{canRate ? "Be the first" : "Customers review by scanning the QR at the shop"}</span>
        </Link>
      ) : shown.length === 0 ? <div className="empty"><Icon name="filter" size={28} /><p className="small">Nothing here</p></div> :
        shown.map((r) => (
          <ReviewCard key={r.id} r={r} mine={Boolean(me && r.user_id === me)} friend={isFriend(r)} expert={r.user_id ? experts[r.user_id] || null : null}
            itemImage={imageOf.get(r.item_id)} itemIcon={icon} />
        ))}
    </section>
  );
}
