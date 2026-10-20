// Turns raw source data into the shapes the database and the app expect.
import { titleCase, clip } from "./common.mjs";

// ---------------------------------------------------------------- business type
// OSM tag -> [places.kind, label]. kinds match the places_kind_check constraint.
const AMENITY = {
  restaurant: ["food", "Restaurant"], cafe: ["food", "Café"], fast_food: ["food", "Fast food"],
  food_court: ["food", "Food court"], ice_cream: ["food", "Ice cream"], bar: ["food", "Bar"],
  pub: ["food", "Pub"], biergarten: ["food", "Beer garden"],
  clinic: ["health", "Clinic"], doctors: ["health", "Doctor"], dentist: ["health", "Dental clinic"],
  pharmacy: ["health", "Pharmacy"], veterinary: ["health", "Vet clinic"], hospital: ["health", "Hospital"],
  school: ["education", "School"], college: ["education", "College"], language_school: ["education", "Language school"],
  music_school: ["education", "Music school"], driving_school: ["education", "Driving school"],
  dancing_school: ["fitness", "Dance studio"], kindergarten: ["education", "Kindergarten"], training: ["education", "Coaching institute"],
  spa: ["beauty", "Spa"], car_wash: ["services", "Car wash"],
};
const SHOP = {
  bakery: ["food", "Bakery"], confectionery: ["food", "Sweet shop"], pastry: ["food", "Pastry shop"],
  deli: ["food", "Deli"], tea: ["food", "Tea shop"], coffee: ["food", "Coffee shop"], chocolate: ["food", "Chocolate shop"],
  ice_cream: ["food", "Ice cream"], juice: ["food", "Juice bar"],
  hairdresser: ["beauty", "Hair salon"], beauty: ["beauty", "Beauty salon"], cosmetics: ["beauty", "Cosmetics store"],
  massage: ["beauty", "Massage & spa"], tattoo: ["beauty", "Tattoo studio"], nail_salon: ["beauty", "Nail salon"],
  chemist: ["health", "Chemist"], optician: ["health", "Optician"], medical_supply: ["health", "Medical supplies"],
  laundry: ["services", "Laundry"], dry_cleaning: ["services", "Dry cleaning"], tailor: ["services", "Tailor"],
  car_repair: ["services", "Car repair"], motorcycle_repair: ["services", "Bike repair"], travel_agency: ["services", "Travel agency"],
  photo: ["services", "Photo studio"], copyshop: ["services", "Print & copy"], mobile_phone_repair: ["services", "Phone repair"],
};
const LEISURE = {
  fitness_centre: ["fitness", "Gym"], sports_centre: ["fitness", "Sports centre"], dance: ["fitness", "Dance studio"],
  swimming_pool: ["fitness", "Swimming pool"], yoga: ["fitness", "Yoga studio"],
};
const HEALTHCARE = { physiotherapist: ["health", "Physiotherapy"], laboratory: ["health", "Diagnostic lab"], alternative: ["health", "Ayurveda & wellness"] };

/** Which kind and label an OSM element is, or null if it isn't a business we list. */
export function classifyOsm(tags) {
  if (!tags?.name || tags.disused || tags["disused:shop"] || tags.shop === "vacant") return null;
  if (tags.amenity && AMENITY[tags.amenity]) return AMENITY[tags.amenity];
  if (tags.leisure && LEISURE[tags.leisure]) return LEISURE[tags.leisure];
  if (tags.sport === "yoga") return LEISURE.yoga;
  if (tags.shop && SHOP[tags.shop]) return SHOP[tags.shop];
  if (tags.healthcare && HEALTHCARE[tags.healthcare]) return HEALTHCARE[tags.healthcare];
  if (tags.shop) return ["store", titleCase(tags.shop)];
  if (tags.craft) return ["services", titleCase(tags.craft)];
  return null;
}

/** Category text shown on the shop page, from the type and OSM cuisine (e.g. "North Indian · Restaurant"). */
export function categoryFor(label, tags = {}) {
  const cuisines = String(tags.cuisine || "").split(/[;,]/).map((c) => c.trim()).filter(Boolean).slice(0, 2).map(titleCase);
  return clip(cuisines.length ? `${cuisines.join(", ")} · ${label}` : label, 60);
}

/** The Overpass filters for each kind the CLI can ask for. */
export const OVERPASS_FILTERS = {
  food: ['["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream|bar|pub|biergarten)$"]', '["shop"~"^(bakery|confectionery|pastry|deli|tea|coffee|chocolate|ice_cream|juice)$"]'],
  beauty: ['["shop"~"^(hairdresser|beauty|cosmetics|massage|tattoo|nail_salon)$"]', '["amenity"="spa"]'],
  health: ['["amenity"~"^(clinic|doctors|dentist|pharmacy|veterinary)$"]', '["shop"~"^(chemist|optician|medical_supply)$"]', '["healthcare"~"^(physiotherapist|laboratory|alternative)$"]'],
  fitness: ['["leisure"~"^(fitness_centre|sports_centre|dance)$"]', '["sport"="yoga"]', '["amenity"="dancing_school"]'],
  education: ['["amenity"~"^(language_school|music_school|driving_school|training)$"]'],
  store: ['["shop"]["shop"!~"^(vacant|bakery|confectionery|pastry|deli|tea|coffee|chocolate|ice_cream|juice|hairdresser|beauty|cosmetics|massage|tattoo|nail_salon|chemist|optician|medical_supply|laundry|dry_cleaning|tailor|car_repair|motorcycle_repair|travel_agency|photo|copyshop|mobile_phone_repair)$"]'],
  services: ['["shop"~"^(laundry|dry_cleaning|tailor|car_repair|motorcycle_repair|travel_agency|photo|copyshop|mobile_phone_repair)$"]', '["craft"]', '["amenity"="car_wash"]'],
};

// ---------------------------------------------------------------- opening hours
const OSM_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmt(t) {
  let [h, m] = t.split(":").map(Number);
  h = h % 24;
  const s = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${s}`;
}

/**
 * OSM opening_hours (the common subset: "Mo-Sa 10:00-22:00; Su 12:00-20:00", "24/7", "Su off")
 * to the app's {"Mon–Sat": "10 am–10 pm"}. Anything fancier (holidays, months, sunrise) returns null
 * rather than a guess.
 */
export function osmHoursToApp(oh) {
  if (!oh) return null;
  const s = String(oh).trim();
  if (s === "24/7") return { "Mon–Sun": "Open 24 hours" };
  if (/PH|SH|[A-Z][a-z]{2} \d|week|sunrise|sunset|dawn|dusk|"|\|\||\[|\+/.test(s)) return null;
  const days = Array(7).fill(null);
  for (const rule of s.split(";").map((r) => r.trim()).filter(Boolean)) {
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?\s*(.*)$/);
    if (!m) return null;
    const which = new Set();
    if (!m[1]) for (let i = 0; i < 7; i++) which.add(i);
    else for (const part of m[1].split(",").filter(Boolean)) {
      const [a, b] = part.split("-").map((d) => OSM_DAYS.indexOf(d));
      if (a < 0 || (b !== undefined && b < 0)) return null;
      for (let i = a; ; i = (i + 1) % 7) { which.add(i); if (b === undefined || i === b) break; }
    }
    const times = m[2].trim();
    let text;
    if (/^(off|closed)$/i.test(times)) text = "Closed";
    else {
      const ranges = times.split(",").map((r) => r.trim());
      if (!ranges.length || !ranges.every((r) => /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(r))) return null;
      text = ranges.map((r) => r.split("-").map(fmt).join("–")).join(", ");
    }
    for (const i of which) days[i] = text;
  }
  if (days.every((d) => d == null)) return null;
  const out = {};
  let i = 0;
  while (i < 7) {
    const t = days[i] ?? "Closed";
    let j = i;
    while (j + 1 < 7 && (days[j + 1] ?? "Closed") === t) j++;
    out[i === j ? NAMES[i] : `${NAMES[i]}–${NAMES[j]}`] = t;
    i = j + 1;
  }
  return out;
}

/** schema.org openingHoursSpecification / openingHours ("Mo-Fr 09:00-17:00") to app hours. */
export function schemaHoursToApp(spec, text) {
  if (Array.isArray(text) || typeof text === "string") {
    const joined = [].concat(text).join("; ");
    const h = osmHoursToApp(joined.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)[a-z]*\b/g, "$1"));
    if (h) return h;
  }
  const specs = [].concat(spec || []).filter(Boolean);
  if (!specs.length) return null;
  const full = { Monday: "Mo", Tuesday: "Tu", Wednesday: "We", Thursday: "Th", Friday: "Fr", Saturday: "Sa", Sunday: "Su" };
  const rules = [];
  for (const sp of specs) {
    const ds = [].concat(sp.dayOfWeek || []).map((d) => full[String(d).split("/").pop()]).filter(Boolean);
    const o = String(sp.opens || "").slice(0, 5), c = String(sp.closes || "").slice(0, 5);
    if (!ds.length || !/^\d{2}:\d{2}$/.test(o) || !/^\d{2}:\d{2}$/.test(c)) continue;
    rules.push(`${ds.join(",")} ${o}-${c}`);
  }
  return rules.length ? osmHoursToApp(rules.join("; ")) : null;
}

// ---------------------------------------------------------------- diet
const DIETS = new Set(["veg", "non_veg", "egg", "vegan", "jain", "gluten_free"]);
/** Keeps only tags the items_diet_chk constraint allows. Unknown stays unknown: never defaults to "veg". */
export function normalizeDiet(diet) {
  if (!Array.isArray(diet)) return [];
  const out = new Set();
  for (const d of diet) {
    let c = String(d).toLowerCase().split("/").pop().replace(/-/g, "_").replace(/diet$/, "");
    if (c === "nonveg" || c === "non_vegetarian") c = "non_veg";
    if (c === "vegetarian") c = "veg";
    if (c === "glutenfree") c = "gluten_free";
    if (DIETS.has(c)) out.add(c);
  }
  return [...out];
}

// ---------------------------------------------------------------- currency
const CURRENCY = {
  in: "INR", us: "USD", gb: "GBP", ae: "AED", sg: "SGD", au: "AUD", ca: "CAD", nz: "NZD", jp: "JPY", np: "NPR",
  lk: "LKR", bd: "BDT", pk: "PKR", th: "THB", my: "MYR", id: "IDR", za: "ZAR", ch: "CHF", se: "SEK", no: "NOK",
  dk: "DKK", pl: "PLN", sa: "SAR", qa: "QAR", br: "BRL", mx: "MXN",
};
const EURO = new Set(["de", "fr", "it", "es", "nl", "be", "at", "ie", "pt", "fi", "gr", "lu", "sk", "si", "ee", "lv", "lt", "mt", "cy", "hr"]);
export const currencyFor = (cc) => (cc ? CURRENCY[cc.toLowerCase()] || (EURO.has(cc.toLowerCase()) ? "EUR" : null) : null);

// ---------------------------------------------------------------- links
const LINK_KINDS = [
  ["swiggy", /swiggy\.(com|in)|swig\.gy/i], ["zomato", /zomato\.com|zoma\.to/i], ["magicpin", /magicpin\.(in|com)/i],
  ["eatsure", /eatsure\.com/i], ["instagram", /instagram\.com|instagr\.am/i], ["facebook", /facebook\.com|fb\.(com|me)/i],
  ["youtube", /youtube\.com|youtu\.be/i], ["whatsapp", /wa\.me|whatsapp\.com/i],
  ["maps", /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\./i], ["justdial", /justdial\.com/i],
  ["tripadvisor", /tripadvisor\./i],
];
/** Same rules as the app's guessLinkKind (src/components/LinkIcon.tsx). */
export function linkKind(url) {
  if (/^tel:/i.test(url)) return "phone";
  if (/^mailto:/i.test(url)) return "email";
  for (const [k, re] of LINK_KINDS) if (re.test(url)) return k === "tripadvisor" ? "other" : k;
  return "website";
}

/** Normalises a phone to tel:+<digits>, using the country's calling code when it is missing. */
export function telLink(phone, callingCode) {
  const first = String(phone || "").split(/[;,/]/)[0].trim();
  let d = first.replace(/[^\d+]/g, "");
  if (d.replace(/\D/g, "").length < 7) return null;
  if (!d.startsWith("+")) d = callingCode ? `+${callingCode}${d.replace(/^0+/, "")}` : d;
  return `tel:${d}`;
}

export function cleanUrl(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (/^(tel|mailto):/i.test(s)) return s.length <= 500 ? s : null;
  if (/^www\./i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) s = `https://${s}`;
  try {
    const url = new URL(s);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    for (const p of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|igshid)/i.test(p)) url.searchParams.delete(p);
    const out = url.toString().replace(/\/$/, "");
    return out.length <= 500 ? out : null;
  } catch { return null; }
}

/** Instagram/Facebook handles from OSM ("contact:instagram=kashichaat") to URLs. */
export function socialUrl(kind, v) {
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || /\.(com|me)\//i.test(v)) return cleanUrl(v);
  const h = String(v).replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9._-]{2,60}$/.test(h)) return null;
  return kind === "instagram" ? `https://www.instagram.com/${h}` : `https://www.facebook.com/${h}`;
}

/** Search-page fallbacks earlier scripts saved in place of a real listing; the app builds these itself. */
export const isGuessedLink = (url) =>
  /zomato\.com\/[^/]+\/restaurants\?q=|swiggy\.com\/(city\/[^/]+\/)?search|justdial\.com\/[^/]+\/[^/]*%20/i.test(url);

/**
 * Merges link lists: only real links that were found somewhere, never guessed search URLs
 * (the app already builds Zomato/Swiggy/Maps search fallbacks itself). One link per kind except
 * "other", existing links first, at most 12 (the check_place_links trigger's limit).
 */
export function mergeLinks(...lists) {
  const out = [], seenUrl = new Set(), seenKind = new Set();
  for (const l of lists.flat()) {
    if (!l?.url) continue;
    const url = cleanUrl(l.url);
    if (!url) continue;
    if (isGuessedLink(url)) continue;
    const kind = l.kind && l.kind !== "website" ? l.kind : linkKind(url);
    const key = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
    if (seenUrl.has(key) || (kind !== "other" && seenKind.has(kind))) continue;
    seenUrl.add(key); seenKind.add(kind);
    const link = { kind, url };
    if (l.label) link.label = clip(l.label, 40);
    out.push(link);
    if (out.length >= 12) break;
  }
  return out;
}

// ---------------------------------------------------------------- about
const YES = (v) => v === "yes" || v === "only" || v === "designated";
/** A short factual about text from OSM tags. Built from facts only, never copied prose. */
export function aboutFromTags(tags = {}) {
  const facts = [];
  const cuisine = String(tags.cuisine || "").split(/[;,]/).map((c) => titleCase(c.trim())).filter(Boolean);
  if (cuisine.length) facts.push(`Serves ${cuisine.join(", ")}.`);
  if (tags["diet:vegetarian"] === "only") facts.push("Pure vegetarian.");
  else if (tags["diet:vegan"] === "only") facts.push("Fully vegan.");
  else {
    const opts = [];
    if (YES(tags["diet:vegetarian"])) opts.push("vegetarian");
    if (YES(tags["diet:vegan"])) opts.push("vegan");
    if (YES(tags["diet:jain"])) opts.push("Jain");
    if (YES(tags["diet:gluten_free"])) opts.push("gluten-free");
    if (opts.length) facts.push(`Has ${opts.join(", ")} options.`);
  }
  if (tags["diet:halal"] === "only" || tags["diet:halal"] === "yes") facts.push("Halal.");
  const am = [];
  if (YES(tags.outdoor_seating)) am.push("outdoor seating");
  if (YES(tags.air_conditioning)) am.push("air-conditioned");
  if (tags.internet_access && tags.internet_access !== "no") am.push("Wi-Fi");
  if (YES(tags.wheelchair)) am.push("wheelchair accessible");
  if (YES(tags.takeaway)) am.push("takeaway");
  if (YES(tags.delivery)) am.push("delivery");
  if (YES(tags.reservation) || tags.reservation === "recommended" || tags.reservation === "required") am.push("reservations");
  if (YES(tags["payment:upi"])) am.push("UPI");
  if (YES(tags["payment:cards"]) || YES(tags["payment:credit_cards"])) am.push("cards accepted");
  if (am.length) facts.push(`${am[0][0].toUpperCase()}${am.join(", ").slice(1)}.`);
  const since = String(tags.start_date || "").match(/^\d{4}/)?.[0];
  if (since && Number(since) > 1700 && Number(since) <= new Date().getFullYear()) facts.push(`Since ${since}.`);
  if (tags.brand && tags.brand !== tags.name) facts.push(`Part of ${tags.brand}.`);
  return facts.join(" ") || null;
}
