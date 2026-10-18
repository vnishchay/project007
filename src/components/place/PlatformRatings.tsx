import { Icon } from "../ui";
import { LinkIcon } from "../LinkIcon";
import { googleMapsUrl } from "../../lib/util";
import type { PlaceLink } from "./ShopLinks";

export interface ParsedAbout {
  story: string;
  amenities: string[];
  platformRatings: { platform: string; rating: string; details?: string; kind: string }[];
  fssai?: string;
}

export function parsePlaceAbout(rawAbout?: string | null, links: PlaceLink[] = []): ParsedAbout {
  if (!rawAbout) return { story: "", amenities: [], platformRatings: [] };
  const lines = rawAbout.split("\n\n");
  let story = "";
  const amenities: string[] = [];
  const platformRatings: { platform: string; rating: string; details?: string; kind: string }[] = [];
  let fssai: string | undefined;

  for (const block of lines) {
    const trimmed = block.trim();
    if (/^services\s*&\s*amenities:/i.test(trimmed)) {
      const items = trimmed
        .replace(/^services\s*&\s*amenities:\s*/i, "")
        .split(/[•·|,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      amenities.push(...items);
    } else if (/^platform\s*ratings:/i.test(trimmed)) {
      const items = trimmed
        .replace(/^platform\s*ratings:\s*/i, "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const item of items) {
        const m = item.match(/^([^:]+):\s*([0-9.]+(?:★|\/5)?)(?:\s*\(([^)]+)\))?/);
        if (m) {
          const platform = m[1].trim();
          const rating = m[2].trim();
          const details = m[3]?.trim();
          const norm = platform.toLowerCase();
          const kind = norm.includes("google") ? "maps"
            : norm.includes("zomato") ? "zomato"
            : norm.includes("swiggy") ? "swiggy"
            : norm.includes("justdial") ? "justdial"
            : "website";
          platformRatings.push({ platform, rating, details, kind });
        }
      }
    } else if (/^fssai\s*license:/i.test(trimmed)) {
      fssai = trimmed.replace(/^fssai\s*license:\s*/i, "").trim();
    } else {
      if (story) story += "\n\n";
      story += trimmed;
    }
  }

  // Also include any platforms present in links if not already in platformRatings
  for (const l of links) {
    if (["zomato", "swiggy", "justdial"].includes(l.kind)) {
      if (!platformRatings.some((p) => p.kind === l.kind)) {
        const platformName = l.kind === "zomato" ? "Zomato" : l.kind === "swiggy" ? "Swiggy" : "Justdial";
        platformRatings.push({
          platform: platformName,
          rating: "Verified",
          details: "Official Listing",
          kind: l.kind
        });
      }
    }
  }

  return { story, amenities, platformRatings, fssai };
}

export function PlatformRatingsCard({
  ratings,
  links,
  googlePlaceId,
  placeName,
}: {
  ratings: { platform: string; rating: string; details?: string; kind: string }[];
  links: PlaceLink[];
  googlePlaceId?: string | null;
  placeName: string;
}) {
  const list = ratings || [];
  if (!list.length) return null;
  const safeLinks = links || [];
  const findUrl = (kind: string) => {
    if (kind === "maps" && googlePlaceId) return googleMapsUrl(googlePlaceId, placeName);
    return safeLinks.find((l) => l && l.kind === kind)?.url;
  };

  return (
    <section className="pl-about pl-multiplatform" aria-label="Verified across platforms">
      <div className="section-title">
        <span className="icon-chip sm emerald"><Icon name="verified" size={16} /></span>
        <span className="grow">Verified Across Platforms</span>
        <span className="muted tiny">{list.length} networks</span>
      </div>
      <p className="tiny muted" style={{ margin: "-4px 0 6px" }}>
        Aggregated real-world ratings, verified diner counts, and digital footprints across major discovery networks.
      </p>
      <div className="pl-platforms-grid">
        {list.map((p, idx) => {
          const url = findUrl(p.kind);
          const Content = (
            <>
              <div className="pl-plat-header">
                <LinkIcon kind={p.kind} size={28} />
                <span className="pl-plat-name">{p.platform}</span>
                {url && <Icon name="external" size={12} color="var(--muted)" />}
              </div>
              <div className="pl-plat-body">
                <span className="pl-plat-rate">{p.rating}</span>
                {p.details && <span className="pl-plat-sub">{p.details}</span>}
              </div>
            </>
          );
          return url ? (
            <a
              key={idx}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="pl-plat-card"
              aria-label={`View ${placeName} on ${p.platform}`}
            >
              {Content}
            </a>
          ) : (
            <div key={idx} className="pl-plat-card">
              {Content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AmenitiesCard({ amenities }: { amenities: string[] }) {
  const list = amenities || [];
  if (!list.length) return null;
  return (
    <section className="pl-about pl-amenities-box" aria-label="Services and amenities">
      <div className="section-title">
        <span className="icon-chip sm amber"><Icon name="spark" size={16} /></span>
        <span className="grow">Services & Highlights</span>
        <span className="muted tiny">{list.length} verified</span>
      </div>
      <div className="pl-amenities-chips">
        {list.map((item, i) => (
          <span key={i} className="pl-amenity-chip">
            <span className="pl-amenity-spark" aria-hidden="true">✓</span>
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}
