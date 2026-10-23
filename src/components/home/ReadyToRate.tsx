import { Link } from "react-router-dom";
import { timeLeft, useOpenVisits } from "../../lib/visits";
import { Icon } from "../ui";
import { Chip, lookFor } from "./Kit";

/** On Home: a shop you scanned at and haven't reviewed yet, while the review is still open. */
export function ReadyToRate({ userId }: { userId: string }) {
  const open = useOpenVisits(userId).filter((v) => !v.reviewed);
  if (!open.length) return null;
  const v = open[0]!;
  const look = lookFor(v.category);
  return (
    <section aria-label="Ready to rate" className="stack" style={{ gap: 6 }}>
      <Link to={`/review/${v.place_id}`} className="callout amber ready-rate">
        <Chip icon={look.icon} tone="amber" size="sm" />
        <span className="grow stack tight" style={{ minWidth: 0 }}>
          <span className="strong small ellipsis">How was {v.place_name}?</span>
          <span className="tiny row" style={{ gap: 4 }}><Icon name="clock" size={12} />Your review is open · {timeLeft(v.expires_at)}</span>
        </span>
        <span className="pill verified"><Icon name="star" size={13} />Rate</span>
      </Link>
      {open.length > 1 && <Link to="/picks" className="tiny strong" style={{ alignSelf: "flex-end" }}>{open.length - 1} more ready to rate</Link>}
    </section>
  );
}
