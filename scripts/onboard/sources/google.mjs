// Google Places API (New): matches a place found elsewhere to its Google Place ID.
// Google's terms let us keep the Place ID indefinitely but not its other content (rating, reviews,
// photos, hours, address), and lat/lng only as a 30-day cache. So we read name, pin and business status
// here only to confirm the match, and store just the ID. The app shows Google's rating, photos and
// reviews live from that ID (api/google.ts).
import { http, metres, nameSimilarity, sleep } from "../lib/common.mjs";

const API = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = "places.id,places.displayName,places.location,places.businessStatus";

/**
 * Returns { placeId, closed } for the Google place that is the same business (similar name within
 * `maxMetres`), { closed: true } if Google says it closed for good, or null when there's no confident match.
 */
export async function matchGooglePlace(key, { name, lat, lng, city, area }, { maxMetres = 250 } = {}) {
  if (!key) return null;
  const res = await http(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({
      textQuery: [name, area, city].filter(Boolean).join(", "),
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 500 } },
      maxResultCount: 5,
    }),
  });
  if (res.status === 403 || res.status === 400) throw new Error(`Google Places: ${(await res.text()).slice(0, 300)}`);
  if (!res.ok) return null;
  const { places = [] } = await res.json();
  await sleep(120); // stay well under per-minute quotas
  let best = null;
  for (const p of places) {
    const d = metres({ lat, lng }, { lat: p.location?.latitude, lng: p.location?.longitude });
    const sim = nameSimilarity(name, p.displayName?.text);
    if (d > maxMetres || sim < 0.6) continue;
    const score = sim - d / (maxMetres * 4);
    if (!best || score > best.score) best = { score, placeId: p.id, closed: p.businessStatus === "CLOSED_PERMANENTLY" };
  }
  return best ? { placeId: best.placeId, closed: best.closed } : null;
}
