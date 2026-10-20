// Google Places API (New): matches a place found elsewhere to its Google Place ID, then reads its details.
// Note: Google's Maps Platform terms restrict storing Places content other than the Place ID. Akanksha
// (2026-10-20) decided to store these details anyway and to take that up with Google herself.
// Reviews' text is never stored (Trusted Picks reviews come only from real visits).
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

const DETAILS = "rating,userRatingCount,businessStatus,regularOpeningHours.weekdayDescriptions,internationalPhoneNumber,nationalPhoneNumber," +
  "websiteUri,priceLevel,priceRange,editorialSummary,primaryTypeDisplayName,photos," +
  "servesBreakfast,servesBrunch,servesLunch,servesDinner,servesCoffee,servesDessert,servesVegetarianFood,servesBeer,servesWine,servesCocktails," +
  "dineIn,takeout,delivery,curbsidePickup,reservable,outdoorSeating,liveMusic,goodForChildren,goodForGroups,goodForWatchingSports," +
  "menuForChildren,allowsDogs,restroom,paymentOptions,parkingOptions,accessibilityOptions";

const AMENITY_FLAGS = [
  ["dineIn", "Dine-in"], ["takeout", "Takeaway"], ["delivery", "Delivery"], ["curbsidePickup", "Kerbside pickup"],
  ["reservable", "Takes bookings"], ["outdoorSeating", "Outdoor seating"], ["liveMusic", "Live music"],
  ["goodForChildren", "Good for kids"], ["menuForChildren", "Kids' menu"], ["goodForGroups", "Good for groups"],
  ["goodForWatchingSports", "Sports on TV"], ["allowsDogs", "Dogs welcome"], ["restroom", "Toilets"],
  ["servesBreakfast", "Breakfast"], ["servesBrunch", "Brunch"], ["servesLunch", "Lunch"], ["servesDinner", "Dinner"],
  ["servesCoffee", "Coffee"], ["servesDessert", "Desserts"], ["servesVegetarianFood", "Vegetarian food"],
  ["servesBeer", "Beer"], ["servesWine", "Wine"], ["servesCocktails", "Cocktails"],
];
const PRICE = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
const DAY = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };

/** "9:00 AM – 10:30 PM" -> "9 am–10:30 pm" (the app's style). */
function tidyTimes(t) {
  return t.replace(/\u202f|\u2009/g, " ").replace(/(\d{1,2}):00\b/g, "$1").replace(/\s*([AP])\.?M\.?/gi, (m, a) => ` ${a.toLowerCase()}m`)
    .replace(/\s*[–-]\s*/g, "–").replace(/Open 24 hours/i, "Open 24 hours").trim();
}

/** Google's weekdayDescriptions ("Monday: 9:00 AM – 10:00 PM") to {"Mon–Sat": "9 am–10 pm", Sun: "Closed"}. */
export function googleHoursToApp(lines) {
  if (!Array.isArray(lines) || lines.length !== 7) return null;
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const byDay = {};
  for (const l of lines) {
    const m = String(l).match(/^(\w+):\s*(.+)$/);
    if (!m || !DAY[m[1]]) return null;
    byDay[DAY[m[1]]] = tidyTimes(m[2]);
  }
  const out = {};
  let i = 0;
  while (i < 7) {
    const t = byDay[order[i]] ?? "Closed";
    let j = i;
    while (j + 1 < 7 && (byDay[order[j + 1]] ?? "Closed") === t) j++;
    out[i === j ? order[i] : `${order[i]}–${order[j]}`] = t;
    i = j + 1;
  }
  return out;
}

function money(m) {
  if (!m?.units) return null;
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: m.currencyCode || "INR", maximumFractionDigits: 0 }).format(Number(m.units)); }
  catch { return String(m.units); }
}

/**
 * Everything the Places API says about a place, shaped for our tables:
 * { rating, count, closed, hours, phone, website, priceLevel, priceRange, amenities[], summary, typeLabel, photos[] }
 */
export async function googleDetails(key, placeId) {
  const res = await http(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS },
  });
  if (!res.ok) return null;
  const j = await res.json();
  await sleep(120);
  const amenities = AMENITY_FLAGS.filter(([k]) => j[k] === true).map(([, l]) => l);
  const pay = j.paymentOptions || {}, park = j.parkingOptions || {}, acc = j.accessibilityOptions || {};
  if (pay.acceptsCreditCards || pay.acceptsDebitCards) amenities.push("Cards accepted");
  if (pay.acceptsNfc) amenities.push("Tap to pay");
  if (pay.acceptsCashOnly) amenities.push("Cash only");
  if (park.freeParkingLot || park.freeStreetParking || park.freeGarageParking) amenities.push("Free parking");
  else if (Object.values(park).some(Boolean)) amenities.push("Parking");
  if (acc.wheelchairAccessibleEntrance) amenities.push("Wheelchair accessible");
  const from = money(j.priceRange?.startPrice), to = money(j.priceRange?.endPrice);
  return {
    rating: typeof j.rating === "number" ? Math.round(j.rating * 10) / 10 : null,
    count: j.userRatingCount ?? null,
    closed: j.businessStatus === "CLOSED_PERMANENTLY",
    hours: googleHoursToApp(j.regularOpeningHours?.weekdayDescriptions),
    phone: j.internationalPhoneNumber || j.nationalPhoneNumber || null,
    website: j.websiteUri || null,
    priceLevel: PRICE[j.priceLevel] || null,
    priceRange: from && to ? `${from}–${to.replace(/^[^\d]+/, "")} per person` : from ? `From ${from} per person` : null,
    amenities,
    summary: j.editorialSummary?.text || null,
    typeLabel: j.primaryTypeDisplayName?.text || null,
    photos: (j.photos || []).filter((p) => p.name).slice(0, 10).map((p) => ({ name: p.name, author: p.authorAttributions?.[0]?.displayName || null })),
  };
}

/** Downloads one Google photo (JPEG) as a Buffer, at most `maxPx` wide. */
export async function googlePhoto(key, name, maxPx = 1200) {
  const res = await http(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxPx}&key=${encodeURIComponent(key)}`, { timeout: 30000 });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") || "image/jpeg";
  if (!/^image\/(jpeg|png|webp)/.test(type)) return null;
  return { data: Buffer.from(await res.arrayBuffer()), type: type.split(";")[0] };
}
