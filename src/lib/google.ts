// Google business details via the official Places API (New). Google's terms don't allow
// storing or copying this content, so it's fetched each time, shown as Google's, with
// Google's attribution, and never saved to our database (only the Place ID is kept).
// Every call goes through our /api/google, which holds the API key, so the key never reaches the browser.
const API = "/api/google";
const KEY = __GOOGLE__;

/** Whether this deployment has a Google key (decided at build time; the key itself stays on the server). */
export const googleConfigured = KEY;

export interface GoogleRating { rating: number; count: number; mapsUri: string | null }

export interface GoogleAuthor { displayName?: string; uri?: string; photoUri?: string }
export interface GooglePhoto { name: string; widthPx?: number; heightPx?: number; authorAttributions?: GoogleAuthor[] }
export interface GoogleReview {
  name: string;
  rating?: number;
  relativePublishTimeDescription?: string;
  text?: { text: string };
  originalText?: { text: string };
  authorAttribution?: GoogleAuthor;
  googleMapsUri?: string;
}
export interface GoogleDetails {
  id: string;
  name: string;
  address: string | null;
  summary: string | null;
  rating: number | null;
  count: number;
  mapsUri: string | null;
  website: string | null;
  phone: string | null;
  hours: string[];
  types: string[];
  photos: GooglePhoto[];
  reviews: GoogleReview[];
}

async function get<T>(id: string, fields: string): Promise<T | null> {
  if (!KEY) return null;
  try {
    const res = await fetch(`${API}?op=place&id=${encodeURIComponent(id)}&fields=${encodeURIComponent(fields)}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function fetchGoogleRating(placeId: string): Promise<GoogleRating | null> {
  if (!placeId) return null;
  const j = await get<{ rating?: number; userRatingCount?: number; googleMapsUri?: string }>(
    placeId, "rating,userRatingCount,googleMapsUri");
  if (j?.rating == null) return null;
  return { rating: j.rating, count: j.userRatingCount ?? 0, mapsUri: j.googleMapsUri ?? null };
}

const cache = new Map<string, Promise<GoogleDetails | null>>();

/** Description, photos and up to 5 reviews (good and bad, as Google picks them). */
export function fetchGoogleDetails(placeId: string): Promise<GoogleDetails | null> {
  if (!placeId || !KEY) return Promise.resolve(null);
  if (!cache.has(placeId)) {
    const fields = "id,displayName,formattedAddress,editorialSummary,rating,userRatingCount,googleMapsUri,websiteUri,nationalPhoneNumber,regularOpeningHours.weekdayDescriptions,types,photos,reviews";
    cache.set(placeId, get<{
      id: string; displayName?: { text: string }; formattedAddress?: string; editorialSummary?: { text: string };
      rating?: number; userRatingCount?: number; googleMapsUri?: string; websiteUri?: string; nationalPhoneNumber?: string;
      regularOpeningHours?: { weekdayDescriptions?: string[] }; types?: string[]; photos?: GooglePhoto[]; reviews?: GoogleReview[];
    }>(placeId, fields).then((j) => j && {
      id: j.id,
      name: j.displayName?.text || "",
      address: j.formattedAddress ?? null,
      summary: j.editorialSummary?.text ?? null,
      rating: j.rating ?? null,
      count: j.userRatingCount ?? 0,
      mapsUri: j.googleMapsUri ?? null,
      website: j.websiteUri ?? null,
      phone: j.nationalPhoneNumber ?? null,
      hours: j.regularOpeningHours?.weekdayDescriptions ?? [],
      types: j.types ?? [],
      photos: (j.photos ?? []).slice(0, 10),
      reviews: j.reviews ?? [],
    }));
  }
  return cache.get(placeId)!;
}

/** Image address for a Google photo. Show it with its authorAttributions. */
export function googlePhotoUrl(photo: GooglePhoto, maxPx = 800): string {
  return `${API}?op=photo&name=${encodeURIComponent(photo.name)}&max=${maxPx}`;
}

export interface GoogleMatch { id: string; name: string; address: string | null; types: string[] }

/** Find businesses by name (and optionally near a point). */
export async function searchGooglePlaces(text: string, near?: { lat: number; lng: number }): Promise<GoogleMatch[]> {
  if (!KEY || !text.trim()) return [];
  try {
    const res = await fetch(`${API}?op=search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim().slice(0, 200), ...(near ? { lat: near.lat, lng: near.lng } : {}) }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { places?: { id: string; displayName?: { text: string }; formattedAddress?: string; types?: string[] }[] };
    return (j.places ?? []).map((p) => ({ id: p.id, name: p.displayName?.text || "", address: p.formattedAddress ?? null, types: p.types ?? [] }));
  } catch {
    return [];
  }
}

/**
 * Turns whatever the owner pasted (a Place ID, a Google Maps link, a maps.app.goo.gl
 * share link) into Google matches. Short links are opened by our /api/resolve-link.
 */
export async function findFromGoogleLink(input: string): Promise<GoogleMatch[]> {
  let text = input.trim();
  if (!text) return [];
  const direct = text.match(/(?:place_id[:=]|query_place_id=|placeid=)([A-Za-z0-9_-]{16,})/)?.[1]
    ?? (/^ChIJ[A-Za-z0-9_-]{10,}$/.test(text) ? text : null);
  if (direct) {
    const d = await fetchGoogleDetails(direct);
    return d ? [{ id: d.id, name: d.name, address: d.address, types: d.types }] : [];
  }
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google)\//i.test(text)) {
    try {
      const r = await fetch(`/api/resolve-link?url=${encodeURIComponent(text)}`);
      if (r.ok) text = ((await r.json()) as { url: string }).url || text;
    } catch { /* fall through to a name search */ }
    const again = text.match(/(?:place_id[:=]|query_place_id=|placeid=)([A-Za-z0-9_-]{16,})/)?.[1];
    if (again) return findFromGoogleLink(again);
  }
  let name = text, near: { lat: number; lng: number } | undefined;
  try {
    const u = new URL(text);
    const seg = u.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
    const q = u.searchParams.get("q") || u.searchParams.get("query");
    name = decodeURIComponent((seg || q || "").replace(/\+/g, " "));
    const at = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) near = { lat: Number(at[1]), lng: Number(at[2]) };
  } catch { /* not a link: treat as a name */ }
  return name ? searchGooglePlaces(name, near) : [];
}

/** A short category from Google's place types ("restaurant" -> "Restaurant"). */
export function categoryFromTypes(types: string[]): string {
  const skip = new Set(["point_of_interest", "establishment", "food", "store", "service"]);
  const t = types.find((x) => !skip.has(x)) || types[0] || "";
  return t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export interface GoogleLocation { lat: number; lng: number }

/** The business's exact pin on Google Maps. Cached by us for at most ~25 days (Google allows 30). */
export async function fetchGoogleLocation(placeId: string): Promise<GoogleLocation | null> {
  if (!placeId) return null;
  const j = await get<{ location?: { latitude?: number; longitude?: number } }>(placeId, "location");
  const { latitude, longitude } = j?.location ?? {};
  return typeof latitude === "number" && typeof longitude === "number" ? { lat: latitude, lng: longitude } : null;
}
