import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar, Icon } from "./ui";

export interface PersonLite { id: string; display_name: string | null; avatar_path: string | null; city?: string | null }

/** One person in a list: avatar and name link to their page, with a Follow / Following button. */
export function CirclePersonRow({ p, on, busy, onToggle, sub, badge, right }: {
  p: PersonLite; on: boolean; busy?: boolean; onToggle?: () => void; sub?: ReactNode; badge?: ReactNode; right?: ReactNode;
}) {
  const name = p.display_name || "Someone";
  return (
    <div className="friend-row">
      <Link to={`/u/${p.id}`} aria-hidden="true" tabIndex={-1}><Avatar id={p.id} name={p.display_name} path={p.avatar_path} /></Link>
      <Link to={`/u/${p.id}`} className="grow stack tight" style={{ color: "inherit", minWidth: 0 }}>
        <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="strong ellipsis" style={{ minWidth: 0 }}>{name}</span>
          {badge}
        </span>
        {sub ? <span className="tiny muted">{sub}</span> : p.city ? <span className="tiny muted row" style={{ gap: 3 }}><Icon name="pin" size={12} />{p.city}</span> : null}
      </Link>
      {right}
      {onToggle && (
        <button
          type="button"
          className={`icon-act ${on ? "green" : "violet"}`}
          onClick={onToggle}
          disabled={busy}
          aria-pressed={on}
          aria-label={`${on ? "Following" : "Follow"} ${name}`}
          title={on ? "Following" : "Follow"}
        >
          <Icon name={on ? "check" : "userPlus"} size={18} />
        </button>
      )}
    </div>
  );
}
