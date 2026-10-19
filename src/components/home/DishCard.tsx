import { Link } from "react-router-dom";
import { lovedPct, openNow, type TopDish } from "../../lib/dishes";
import { distanceText } from "../../lib/util";
import { Icon } from "../ui";
import { ItemThumb } from "../place/ItemThumb";

/** Open, closed, or nothing when the shop gave no hours we can read. */
export function OpenPill({ hours }: { hours: TopDish["hours"] }) {
  const open = openNow(hours);
  if (open == null) return null;
  return open
    ? <span className="pill green"><Icon name="clock" size={12} />Open</span>
    : <span className="pill gray"><Icon name="clock" size={12} />Closed</span>;
}

/** A dish in a sideways row: its photo, where it is, and how much people loved it. `newTab` leaves shop mode. */
export function DishCard({ d, showPlace = true, newTab = false }: { d: TopDish; showPlace?: boolean; newTab?: boolean }) {
  const dist = distanceText(d.distance_m);
  const pct = lovedPct(d);
  const body = (
    <>
      <span className="thumb">
        <ItemThumb path={d.image_path} />
        <span className="rating-pill" aria-label={`Rated ${Number(d.avg_rating).toFixed(1)} from ${d.review_count} ratings`}><Icon name="star" size={12} fill="#fff" />{Number(d.avg_rating).toFixed(1)} · {d.review_count}</span>
      </span>
      <span className="pc-body">
        <span className="strong ellipsis">{d.item_name}</span>
        {showPlace && <span className="tiny muted ellipsis">{[d.place_name, d.area].filter(Boolean).join(" · ")}</span>}
        <span className="row wrap" style={{ gap: 6 }}>
          <span className="pill loved"><Icon name="heart" size={12} fill="currentColor" /><span>{pct}% loved</span></span>
          {d.friend_loved > 0 && <span className="pill friends"><Icon name="people" size={12} />{d.friend_loved}</span>}
          {dist && <span className="pill gray"><Icon name="navigate" size={11} />{dist}</span>}
          <OpenPill hours={d.hours} />
        </span>
      </span>
    </>
  );
  const label = `${d.item_name} at ${d.place_name}, ${pct}% of ${d.review_count} loved it`;
  return newTab
    ? <a href={`/p/${d.place_id}`} target="_blank" rel="noopener" className="pick-card dish-card" aria-label={label}>{body}</a>
    : <Link to={`/p/${d.place_id}`} className="pick-card dish-card" aria-label={label}>{body}</Link>;
}
