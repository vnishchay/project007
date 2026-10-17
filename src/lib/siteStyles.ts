import { modeOf } from "./modes";
import type { Place } from "./types";

/** Homepage templates a shop owner can pick for their website. Add new ones here and in styles/site.css. */
export type SiteStyle = "noir" | "glass" | "editorial" | "pop" | "classic";

export interface SiteStyleInfo {
  id: SiteStyle;
  name: string;
  blurb: string;
  /** preview swatch: background, ink, accent */
  swatch: [string, string, string];
}

export const SITE_STYLES: SiteStyleInfo[] = [
  { id: "noir", name: "Noir", blurb: "Dark and luxe, a slowly turning signature dish, glass cards", swatch: ["#0b0b0c", "#ffffff", "#c6f432"] },
  { id: "glass", name: "Glass", blurb: "Your photo fills the screen, frosted cards slide over it", swatch: ["#6b7a72", "#ffffff", "#c6f432"] },
  { id: "editorial", name: "Editorial", blurb: "Magazine look: big serif type, arched photo, moving headline", swatch: ["#f4efe6", "#1d1a16", "#b4532a"] },
  { id: "pop", name: "Pop", blurb: "Bold colour, floating shapes and cards that tilt in 3D", swatch: ["#ff5a36", "#1b1030", "#ffd23f"] },
  { id: "classic", name: "Classic", blurb: "The simple Trusted Picks layout, reviews first", swatch: ["#f3f6f1", "#111311", "#1e7a46"] },
];

export function isSiteStyle(v: unknown): v is SiteStyle {
  return typeof v === "string" && SITE_STYLES.some((s) => s.id === v);
}

/** The owner's pick, else Noir for food places and Editorial for everything else. */
export function siteStyleFor(place: Pick<Place, "kind" | "category"> & { site_style?: string | null }): SiteStyle {
  if (isSiteStyle(place.site_style)) return place.site_style;
  return modeOf(place.kind, place.category).kind === "food" ? "noir" : "editorial";
}
