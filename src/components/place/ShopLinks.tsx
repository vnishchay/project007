import { LinkIcon, guessLinkKind, linkLabel } from "../LinkIcon";
import { Icon } from "../ui";

export interface PlaceLink { kind: string; url: string; label?: string | null }

/** Only web, phone and email addresses; anything else is dropped. */
export function cleanLinks(raw: unknown): PlaceLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is PlaceLink => Boolean(l && typeof l === "object" && typeof (l as PlaceLink).url === "string" && /^(https?:\/\/|tel:|mailto:)/i.test((l as PlaceLink).url)))
    .map((l) => ({ ...l, kind: l.kind || guessLinkKind(l.url) }));
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
