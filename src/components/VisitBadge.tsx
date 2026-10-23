import type { VisitProof } from "../lib/visits";
import { Icon } from "./ui";

/** The pill on the scan and review pages. Only a visit that passed the shop check is called verified. */
export function VisitBadge({ proof }: { proof: VisitProof | null }) {
  if (!proof) return null;
  if (proof === "verified") return <span className="rvx-verified"><Icon name="verified" size={15} />Verified visit</span>;
  return (
    <span className="rvx-pill" title={proof === "far" ? "Your phone wasn't at the shop, so this review counts for less" : "Location wasn't shared, so this review counts a little less"}>
      <Icon name="qr" size={14} />{proof === "far" ? "Scanned away from the shop" : "Scanned the shop's code"}
    </span>
  );
}
