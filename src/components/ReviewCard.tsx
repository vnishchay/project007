import { Link } from "react-router-dom";
import type { ReviewRow } from "../lib/types";
import { timeAgo } from "../lib/util";
import { Avatar, Stars } from "./ui";

export function ReviewCard({ r, mine, friend, showPlace = false }: { r: ReviewRow; mine?: boolean; friend?: boolean; showPlace?: boolean }) {
  const name = mine ? "You" : r.profiles?.display_name || "Someone";
  const tags = (r.review_tags || []).map((t) => t.tags?.label).filter(Boolean) as string[];
  return (
    <div className="card">
      <div className="row">
        <Link to={`/u/${r.user_id}`}><Avatar id={r.user_id} name={r.profiles?.display_name} path={r.profiles?.avatar_path} /></Link>
        <div className="grow stack tight">
          <span className="row" style={{ gap: 6 }}>
            <Link to={`/u/${r.user_id}`} className="strong" style={{ color: "inherit" }}>{name}</Link>
            {friend && !mine && <span className="badge gray">You follow</span>}
          </span>
          <span className="tiny muted">
            {r.visit_id ? <span className="green strong">✓ Verified visit · </span> : null}
            {timeAgo(r.created_at)}
          </span>
        </div>
        <Stars value={r.rating} />
      </div>
      <div className="small strong">
        {r.items?.name}
        {showPlace && r.places ? <> · <Link to={`/p/${r.place_id}`}>{r.places.name}</Link></> : null}
      </div>
      {r.body && <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>{r.body}</p>}
      {tags.length > 0 && <div className="chips">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
    </div>
  );
}

export const REVIEW_SELECT =
  "id, user_id, place_id, item_id, rating, body, ai_drafted, visit_id, status, created_at, items(name), places(name, google_place_id, area), profiles(display_name, avatar_path), review_tags(tags(label))";
