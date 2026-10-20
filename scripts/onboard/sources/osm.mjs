// OpenStreetMap: discovery of businesses and their public facts (ODbL open data).
// Uses Nominatim to find the city and Overpass to list what's mapped there. Both are free public
// services with usage policies: one Nominatim request a second, an identifying User-Agent, modest queries.
// Data © OpenStreetMap contributors, ODbL: the app must credit "© OpenStreetMap contributors".
import { http, throttle } from "../lib/common.mjs";
import { OVERPASS_FILTERS, classifyOsm } from "../lib/normalize.mjs";

const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const nominatimTurn = throttle(1100);

/** City name -> { name, bbox: [south, west, north, east], lat, lng, countryCode }. */
export async function geocodeCity(city) {
  await nominatimTurn();
  const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(city)}`;
  const res = await http(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const hits = await res.json();
  const hit = hits.find((h) => ["city", "town", "village", "municipality", "administrative", "suburb"].includes(h.addresstype || h.type)) || hits[0];
  if (!hit) throw new Error(`Couldn't find "${city}" on OpenStreetMap`);
  const [s, n, w, e] = hit.boundingbox.map(Number);
  return { name: hit.name || city, bbox: [s, w, n, e], lat: Number(hit.lat), lng: Number(hit.lon), countryCode: hit.address?.country_code || null };
}

/** Area (neighbourhood) for a point, via Nominatim reverse geocoding. */
export async function reverseArea(lat, lng) {
  await nominatimTurn();
  const res = await http(`${NOMINATIM}/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en" } });
  if (!res.ok) return null;
  const a = (await res.json()).address || {};
  return a.neighbourhood || a.suburb || a.quarter || a.city_district || a.residential || null;
}

/**
 * Businesses of the given kinds inside a bbox, or within `radius` metres of {lat,lng}.
 * Returns normalised records with the raw OSM tags kept for later steps.
 */
export async function discoverOsm({ kinds = ["food"], bbox, around }) {
  const scope = around ? `(around:${around.radius},${around.lat},${around.lng})` : `(${bbox.join(",")})`;
  const parts = kinds.flatMap((k) => OVERPASS_FILTERS[k] || []).map((f) => `nwr${f}["name"]${scope};`);
  if (!parts.length) throw new Error(`Unknown kinds: ${kinds.join(", ")}`);
  const query = `[out:json][timeout:180];(${parts.join("")});out center tags;`;
  const res = await http(OVERPASS, { method: "POST", body: new URLSearchParams({ data: query }), timeout: 200000, retries: 3 });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { elements = [] } = await res.json();
  const out = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const type = classifyOsm(tags);
    if (!type) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    if (!kinds.includes(type[0])) continue;
    out.push({ osmId: `${el.type}/${el.id}`, kind: type[0], typeLabel: type[1], name: tags["name:en"] || tags.name,
      nativeName: tags["name:en"] && tags.name !== tags["name:en"] ? tags.name : null, lat, lng, tags });
  }
  return out;
}

/** The neighbourhood OSM itself records on the element, if any. */
export const osmArea = (tags) =>
  tags["addr:suburb"] || tags["addr:neighbourhood"] || tags["addr:quarter"] || tags["addr:city_district"] || tags["addr:place"] || null;

/** Score for ordering: better-documented places first (more useful profiles, likelier to be real and open). */
export function osmRichness(tags) {
  const keys = ["website", "contact:website", "phone", "contact:phone", "opening_hours", "cuisine", "contact:instagram",
    "contact:facebook", "wikidata", "image", "wikimedia_commons", "addr:street", "brand", "start_date"];
  return keys.reduce((n, k) => n + (tags[k] ? 1 : 0), 0);
}
