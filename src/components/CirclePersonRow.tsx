import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "./ui";

export interface PersonLite { id: string; display_name: string | null; avatar_path: string | null; city?: string | null }

/** One person in a list: avatar and name link to their page, with a Follow / Following button. */
export function CirclePersonRow({ p, on, busy, onToggle, sub, badge, right }: {
  p: PersonLite; on: boolean; busy?: boolean; onToggle?: () => void; sub?: ReactNode; badge?: ReactNode; right?: ReactNode;
}) {
  const name = p.display_name || "Someone";
  return (
    <div className="list-item">
      <Link to={`/u/${p.id}`} aria-hidden="true" tabIndex={-1}><Avatar id={p.id} name={p.display_name} path={p.avatar_path} /></Link>
      <Link to={`/u/${p.id}`} className="grow stack tight" style={{ color: "inherit" }}>
        <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="strong ellipsis" style={{ minWidth: 0 }}>{name}</span>
          {badge}
        </span>
        {sub ? <span className="tiny muted">{sub}</span> : p.city ? <span className="tiny muted">{p.city}</span> : null}
      </Link>
      {right}
      {onToggle && (
        <button
          type="button"
          className={`btn small ${on ? "ghost" : ""}`}
          onClick={onToggle}
          disabled={busy}
          aria-pressed={on}
          aria-label={`${on ? "Following" : "Follow"} ${name}`}
        >
          {on ? "Following" : "Follow"}
        </button>
      )}
    </div>
  );
}
