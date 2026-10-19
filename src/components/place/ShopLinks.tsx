import { LinkIcon, guessLinkKind, linkLabel } from "../LinkIcon";
import { Icon } from "../ui";

export interface PlaceLink { kind: string; url: string; label?: string | null }

export interface PlaceContext {
  name?: string;
  city?: string;
  area?: string;
  googlePlaceId?: string | null;
}

/** Only web, phone and email addresses; anything else is dropped. */
export function cleanLinks(raw: unknown, context?: PlaceContext): PlaceLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is PlaceLink => Boolean(l && typeof l === "object" && typeof (l as PlaceLink).url === "string" && /^(https?:\/\/|tel:|mailto:)/i.test((l as PlaceLink).url)))
    .map((l) => {
      const kind = l.kind || guessLinkKind(l.url);
      let url = l.url.trim();

      // Transform raw numeric Swiggy URLs (e.g. /restaurants/144541) that return 404 into direct city search
      if (kind === "swiggy" && /^https?:\/\/(?:www\.)?swiggy\.com\/restaurants\/\d+\/?$/i.test(url)) {
        const city = context?.city || "varanasi";
        const query = context?.name || "";
        url = `https://www.swiggy.com/city/${encodeURIComponent(city.toLowerCase())}/search?query=${encodeURIComponent(query)}`;
      }

      // Transform synthetic or unverified Google Maps CID URLs to universal maps search
      if (kind === "maps" && (/^https?:\/\/maps\.google\.com\/\?cid=\d+$/i.test(url) || !url.includes("google.com/maps"))) {
        const query = [context?.name, context?.area, context?.city].filter(Boolean).join(", ");
        if (context?.googlePlaceId) {
          url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || "Restaurant")}&query_place_id=${encodeURIComponent(context.googlePlaceId)}`;
        } else if (query) {
          url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
        }
      }

      // Transform unindexed/street-food Zomato slugs that return 404 to official city restaurant search
      if (kind === "zomato") {
        const knownBrokenZomatoSlugs = [
          "kashi-chat-bhandar",
          "baati-chokha",
          "blue-lassi",
          "brown-bread-bakery",
          "deena-chaat-bhandar"
        ];
        if (knownBrokenZomatoSlugs.some((s) => url.toLowerCase().includes(s))) {
          const city = context?.city || "varanasi";
          const query = context?.name || "";
          url = `https://www.zomato.com/${encodeURIComponent(city.toLowerCase())}/restaurants?q=${encodeURIComponent(query)}`;
        }
      }

      return { ...l, kind, url };
    });
}

function subText(url: string): string {
  if (/^tel:/i.test(url)) return url.slice(4);
  if (/^mailto:/i.test(url)) return url.slice(7);
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** The shop's own links (Swiggy, Zomato, Instagram, website...), like a link-in-bio page. */
export function ShopLinks({ links }: { links: PlaceLink[] }) {
  if (!links.length) return null;
  return (
    <nav className={`pl-links ${links.length === 1 ? "one" : ""}`} aria-label="Shop links">
      {links.map((l, i) => {
        const web = /^https?:/i.test(l.url);
        return (
          <a key={`${l.url}-${i}`} className="pl-link" href={l.url} {...(web ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            <LinkIcon kind={l.kind} size={40} />
            <span className="pl-link-txt">
              <b>{linkLabel(l)}</b>
              <span>{subText(l.url)}</span>
            </span>
            {web && <Icon name="external" size={14} color="var(--muted)" />}
          </a>
        );
      })}
    </nav>
  );
}
