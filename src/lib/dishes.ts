import { supabase } from "./supabase";
import { todaysHours } from "./util";

/** One ranked dish (or service) from top_dishes(). */
export interface TopDish {
  item_id: string;
  item_name: string;
  image_path: string | null;
  /** whole amount in `currency`, the shop's own */
  price_inr: number | null;
  diet: string[] | null;
  place_id: string;
  place_name: string;
  area: string | null;
  city: string;
  kind: string | null;
  hours: Record<string, string> | null;
  distance_m: number | null;
  review_count: number;
  avg_rating: number;
  loved_count: number;
  friend_loved: number;
  score: number;
  /** the shop's currency (missing before migration 40, which means INR) */
  currency?: string | null;
}

export interface DishQuery {
  query?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusM?: number;
  city?: string | null;
  area?: string | null;
  place?: string | null;
  excludePlace?: string | null;
  kind?: string | null;
  limit?: number;
}

/** Best dishes for a search, place or area. Empty (not an error) on a database without migration 37. */
export async function topDishes(a: DishQuery): Promise<{ rows: TopDish[]; error: string | null }> {
  const { data, error } = await supabase.rpc("top_dishes", {
    p_query: a.query || null,
    p_lat: a.lat ?? null,
    p_lng: a.lng ?? null,
    p_radius_m: a.radiusM ?? 15000,
    p_city: a.city || null,
    p_area: a.area || null,
    p_place: a.place || null,
    p_exclude_place: a.excludePlace || null,
    p_kind: a.kind || null,
    p_limit: a.limit ?? 20,
  });
  if (error) return { rows: [], error: error.code === "PGRST202" ? null : error.message };
  return { rows: (data as TopDish[]) || [], error: null };
}

/** Share of ratings that were 4 or 5 stars. */
export const lovedPct = (d: Pick<TopDish, "loved_count" | "review_count">) =>
  d.review_count ? Math.round((d.loved_count / d.review_count) * 100) : 0;

/** "paneer tikka" -> "paneer-tikka", for /best/<city>/<dish> links. */
export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const unslug = (s: string) => decodeURIComponent(s).replace(/-+/g, " ").trim();
export const bestPath = (city: string, dish: string) => `/best/${slug(city)}/${slug(dish)}`;

/** "paneer tikka" -> "Paneer Tikka". */
export const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

function minutes(t: string, suffix?: string): { min: number; s?: string } | null {
  const m = t.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const s = (m[3] || suffix || "").replace(/\./g, "").toLowerCase() || undefined;
  if (s === "pm" && h < 12) h += 12;
  if (s === "am" && h === 12) h = 0;
  if (h > 24 || Number(m[2] || 0) > 59) return null;
  return { min: h * 60 + Number(m[2] || 0), s };
}

/**
 * Is the place open at `now`, from the hours its owner gave ({"Mon–Sat": "7 am–9 pm"})?
 * null when we can't tell (no hours, or hours we can't read).
 */
export function openNow(hours: Record<string, string> | null | undefined, now = new Date()): boolean | null {
  if (!hours || !Object.keys(hours).length) return null;
  const today = todaysHours(hours, now);
  if (today == null) return false; // hours are given, but not for today
  if (/closed/i.test(today)) return false;
  if (/24\s*h|24 hours|open all day/i.test(today)) return true;
  const at = now.getHours() * 60 + now.getMinutes();
  let readable = false;
  for (const range of today.split(/\s*[,;&]\s*/)) {
    const parts = range.split(/\s*(?:[–—-]|to)\s*/i);
    if (parts.length !== 2) continue;
    const b = minutes(parts[1]!);
    const a = minutes(parts[0]!, b?.s);
    if (!a || !b) continue;
    readable = true;
    const end = b.min <= a.min ? b.min + 24 * 60 : b.min; // past midnight
    if (at >= a.min && at < end) return true;
  }
  return readable ? false : null;
}

/** What people are about to eat at this hour, for headings ("Dinner near you"). */
export function mealNow(now = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 11) return "Breakfast";
  if (h >= 11 && h < 16) return "Lunch";
  if (h >= 16 && h < 19) return "Snacks";
  if (h >= 19 && h < 23) return "Dinner";
  return "Late night";
}

/** Dishes like this one at other shops nearby, best loved first. Empty (not an error) before migration 44. */
export async function similarDishes(itemId: string, at?: { lat: number; lng: number } | null): Promise<TopDish[]> {
  const { data, error } = await supabase.rpc("similar_items", { p_item: itemId, p_lat: at?.lat ?? null, p_lng: at?.lng ?? null, p_limit: 10 });
  return error ? [] : (data as TopDish[]) || [];
}

/** Once per visit to a shop page (or after an owner changes products, with force): make sure its products can be matched in "Similar dishes". Quiet if it can't. */
export function ensureEmbeddings(placeId: string, force = false) {
  const key = `tp-embed:${placeId}`;
  try { if (!force && sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* storage off: still fine to ask */ }
  supabase.functions.invoke("ai", { body: { task: "embed", placeId } }).then(() => {}, () => {});
}
