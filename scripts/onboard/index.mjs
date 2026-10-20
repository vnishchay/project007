#!/usr/bin/env node
// Trusted Picks onboarding: fills the platform with real, public facts about local businesses.
//
//   npm run onboard -- --city Varanasi --dry-run                 see what would be added, write nothing
//   npm run onboard -- --city Varanasi --limit 200               restaurants, cafés, sweet shops...
//   npm run onboard -- --city Pune --kinds food,beauty,fitness   salons, gyms too
//   npm run onboard -- --around 25.3109,83.0107 --radius 1500 --city Varanasi
//   npm run onboard -- --input my-shops.json                     businesses you collected yourself
//
// Where each fact comes from (no AI, no made-up data, no reviews):
//   OpenStreetMap (ODbL)        name, type, cuisine, pin, hours, phone, website, socials, diet, amenities
//   Google Places API (New)     only the Place ID, matched by name + distance; Google's rating, photos and
//                               reviews are shown live in the app from that ID and never stored
//   The business's own website  schema.org menu/services with prices, hours, price range, and the links it
//                               gives to its Zomato/Swiggy/Instagram pages (robots.txt respected)
//   Wikimedia Commons           a cover photo, only when freely licensed, with its credit in the about text
// Zomato, Swiggy, Justdial and Google pages are never scraped.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, root, slugify } from "./lib/common.mjs";
import { aboutFromTags, categoryFor, cleanUrl, currencyFor, mergeLinks, osmHoursToApp, socialUrl, telLink } from "./lib/normalize.mjs";
import { discoverOsm, geocodeCity, osmArea, osmRichness, reverseArea } from "./sources/osm.mjs";
import { matchGooglePlace } from "./sources/google.mjs";
import { readWebsite } from "./sources/website.mjs";
import { commonsFileFor, commonsImage } from "./sources/commons.mjs";
import { normalizeKind, onboardBusiness } from "./lib/writer.mjs";

const HELP = `
Trusted Picks onboarding: real public data only.

  --city <name>           City to onboard (required unless --input gives cities)
  --kinds <list>          food,beauty,health,fitness,education,store,services (default: food)
  --around <lat,lng>      Only within --radius metres (default 2000) of this point
  --limit <n>             Most places to onboard, best-documented first (default 50)
  --input <file.json>     Onboard businesses from your own JSON list instead of OpenStreetMap
  --dry-run               Discover and enrich, write nothing; the report shows what would be saved
  --no-google             Skip matching Google Place IDs (no GOOGLE_MAPS_KEY needed)
  --no-website            Don't read business websites
  --no-photos             Don't add Wikimedia Commons cover photos
  --no-qr                 Don't create the counter QR
  --reverse-area          Look up the neighbourhood on OpenStreetMap when the place doesn't name one (1/sec)
  --verified              Mark new places verified (default: verified only when matched to Google, else pending)
  --overwrite             Replace details on places nobody has claimed (default: only fill empty fields)
  --plan <code>           Also put new and existing places on this plan (trial|starter|standard|pro)
  --months <n>            Length of --plan (default 12)
`;

function parseArgs(argv) {
  const o = { kinds: ["food"], limit: 50, radius: 2000, google: true, website: true, photos: true, qr: true, months: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--city") o.city = next();
    else if (a === "--kinds") o.kinds = next().split(",").map((k) => normalizeKind(k.trim()));
    else if (a === "--around") { const [lat, lng] = next().split(",").map(Number); o.around = { lat, lng }; }
    else if (a === "--radius") o.radius = Number(next());
    else if (a === "--limit") o.limit = Number(next()) || 50;
    else if (a === "--input") o.input = next();
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--no-google") o.google = false;
    else if (a === "--no-website") o.website = false;
    else if (a === "--no-photos") o.photos = false;
    else if (a === "--no-qr") o.qr = false;
    else if (a === "--reverse-area") o.reverseArea = true;
    else if (a === "--verified") o.verified = true;
    else if (a === "--overwrite") o.overwrite = true;
    else if (a === "--plan") o.plan = next();
    else if (a === "--months") o.months = Number(next()) || 12;
    else if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
    else { console.error(`Unknown option ${a}\n${HELP}`); process.exit(1); }
  }
  if (!o.city && !o.input) { console.error(HELP); process.exit(1); }
  if (o.plan && !["trial", "starter", "standard", "pro"].includes(o.plan)) { console.error(`Unknown plan ${o.plan}`); process.exit(1); }
  return o;
}

const CALLING = { in: "91", us: "1", ca: "1", gb: "44", ae: "971", sg: "65", au: "61", np: "977", lk: "94", bd: "880", de: "49", fr: "33", it: "39", es: "34", nl: "31" };

/** Runs fn over items, `n` at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** An OSM record -> the writer's business shape, with Google, website and Commons details added. */
async function enrichOsm(rec, ctx, o) {
  const t = rec.tags, sources = ["OpenStreetMap"];
  const area = osmArea(t) || (o.reverseArea ? await reverseArea(rec.lat, rec.lng) : null);
  const website = cleanUrl(t.website || t["contact:website"] || t.url);
  const links = [];
  if (website) links.push({ kind: undefined, url: website });
  for (const ph of [t.phone, t["contact:phone"], t["contact:mobile"]]) { const tel = telLink(ph, ctx.calling); if (tel) links.push({ kind: "phone", url: tel }); }
  if (t.email || t["contact:email"]) links.push({ kind: "email", url: `mailto:${(t.email || t["contact:email"]).split(";")[0].trim()}` });
  const ig = socialUrl("instagram", t["contact:instagram"] || t.instagram), fb = socialUrl("facebook", t["contact:facebook"] || t.facebook);
  if (ig) links.push({ kind: "instagram", url: ig });
  if (fb) links.push({ kind: "facebook", url: fb });
  const wa = String(t["contact:whatsapp"] || "").replace(/\D/g, "");
  if (wa.length >= 8) links.push({ kind: "whatsapp", url: `https://wa.me/${wa}` });

  let googlePlaceId = null;
  if (o.google && ctx.googleKey) {
    const g = await matchGooglePlace(ctx.googleKey, { name: rec.name, lat: rec.lat, lng: rec.lng, city: ctx.city, area });
    if (g?.closed) return { skip: "closed for good on Google" };
    if (g?.placeId) {
      googlePlaceId = g.placeId; sources.push("Google Place ID");
      const q = [rec.name, area, ctx.city].filter(Boolean).join(" ");
      links.push({ kind: "maps", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}&query_place_id=${encodeURIComponent(g.placeId)}` });
    }
  }

  let site = null;
  if (o.website && website) {
    site = await readWebsite(website);
    if (site) {
      sources.push("own website");
      const tel = telLink(site.phone, ctx.calling);
      if (tel) links.push({ kind: "phone", url: tel });
      links.push(...site.links);
      if (site.menuUrl && !site.items.length) links.push({ kind: "other", url: site.menuUrl, label: rec.kind === "food" ? "Menu" : "Services & prices" });
    }
  }

  let photo = null;
  if (o.photos) {
    const file = await commonsFileFor(t).catch(() => null);
    if (file) photo = await commonsImage(file).catch(() => null);
    if (photo) sources.push("Wikimedia Commons");
  }

  const tags = { ...t };
  if (!tags.cuisine && site?.cuisine?.length) tags.cuisine = site.cuisine.join(";");
  if (!tags.start_date && site?.since) tags.start_date = site.since;
  return {
    name: rec.name, kind: rec.kind, category: categoryFor(rec.typeLabel, tags), area, city: ctx.city,
    about: aboutFromTags(tags), hours: ctx.hoursFrom(t["opening_hours"]) || site?.hours || null,
    priceLevel: site?.priceLevel || null, currency: ctx.currency, lat: rec.lat, lng: rec.lng, googlePlaceId,
    links: mergeLinks(links), items: site?.items || [], photo, verified: o.verified || Boolean(googlePlaceId), sources, osmId: rec.osmId,
  };
}

/** A business from --input (the older onboardBusiness shape is accepted) -> the writer's shape. */
async function fromInput(x, ctx, o) {
  const city = x.city || o.city;
  const links = [...(x.links || [])];
  for (const k of ["website_url", "instagram_url", "facebook_url", "zomato_url", "swiggy_url", "justdial_url", "maps_url", "magicpin_url"]) if (x[k]) links.push({ url: x[k] });
  const tel = telLink(x.phone || x.contact_phone, ctx.calling);
  if (tel) links.push({ kind: "phone", url: tel });
  let googlePlaceId = x.google_place_id || null;
  if (!googlePlaceId && o.google && ctx.googleKey && x.lat != null) {
    const g = await matchGooglePlace(ctx.googleKey, { name: x.name, lat: x.lat, lng: x.lng, city, area: x.area });
    googlePlaceId = g?.placeId || null;
  }
  const site = o.website && x.website_url ? await readWebsite(x.website_url) : null;
  if (site) links.push(...site.links);
  const items = (x.items?.length ? x.items : site?.items || []).map((it) => ({ ...it, price: it.price ?? it.price_inr ?? null }));
  return {
    name: x.name, kind: normalizeKind(x.kind || "food"), category: x.category || "Business", area: x.area || null, city,
    about: x.about || null, hours: x.hours || site?.hours || null, priceLevel: x.price_level || site?.priceLevel || null,
    currency: x.currency || ctx.currency, lat: x.lat ?? null, lng: x.lng ?? null, googlePlaceId, links: mergeLinks(links), items,
    photo: null, verified: o.verified || Boolean(googlePlaceId), sources: ["your list"].concat(site ? ["own website"] : []),
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const ctx = { city: o.city, googleKey: o.google ? env.GOOGLE_MAPS_KEY || env.VITE_GOOGLE_MAPS_KEY : null, currency: "INR", calling: "91", hoursFrom: osmHoursToApp };
  if (o.google && !ctx.googleKey) console.log("No GOOGLE_MAPS_KEY in .env: skipping Google Place IDs.");

  let businesses = [];
  if (o.input) {
    const list = JSON.parse(readFileSync(o.input, "utf8"));
    businesses = await pool([].concat(list).slice(0, o.limit), 3, (x) => fromInput(x, ctx, o));
  } else {
    const geo = await geocodeCity(o.city);
    ctx.city = o.city;
    ctx.currency = currencyFor(geo.countryCode) || "INR";
    ctx.calling = CALLING[geo.countryCode] || null;
    console.log(`📍 ${geo.name} (${geo.countryCode?.toUpperCase() || "?"}, prices in ${ctx.currency})`);
    const found = await discoverOsm({ kinds: o.kinds, bbox: geo.bbox, around: o.around && { ...o.around, radius: o.radius } });
    found.sort((a, b) => osmRichness(b.tags) - osmRichness(a.tags));
    console.log(`🗺️  OpenStreetMap lists ${found.length} ${o.kinds.join("/")} places; enriching the best-documented ${Math.min(o.limit, found.length)}.`);
    businesses = await pool(found.slice(0, o.limit), 4, async (rec, i) => {
      const b = await enrichOsm(rec, ctx, o).catch((e) => ({ skip: e.message }));
      console.log(`  ${String(i + 1).padStart(3)}. ${rec.name}: ${b.skip ? `skipped, ${b.skip}` : b.sources.join(" + ")}`);
      return b.skip ? null : b;
    });
  }

  const results = [];
  for (const b of businesses.filter(Boolean)) {
    try {
      const r = await onboardBusiness(b, { dryRun: o.dryRun, overwrite: o.overwrite, qr: o.qr, plan: o.plan, planMonths: o.months });
      results.push({ ...r, sources: b.sources, osmId: b.osmId, category: b.category, hours: b.hours, about: b.about,
        links: b.links, catalog: b.items, photo: b.photo && { page: b.photo.page, credit: b.photo.credit } });
      if (!o.dryRun) console.log(`✓ ${b.name}: ${r.action}, ${r.items} items${r.qr ? `, QR /q/${r.qr}` : ""}${r.photo ? ", photo" : ""}`);
    } catch (e) {
      console.warn(`✗ ${b.name}: ${e.message}`);
      results.push({ name: b.name, error: e.message });
    }
  }

  const dir = join(root, "scripts", "onboard", "out");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slugify(o.city || "input")}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}${o.dryRun ? "-dry" : ""}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), options: o, attribution: "Data © OpenStreetMap contributors (ODbL)", results }, null, 2));
  const ok = results.filter((r) => !r.error);
  console.log(`\n${o.dryRun ? "Would onboard" : "Onboarded"} ${ok.length} places (${ok.filter((r) => r.googlePlaceId).length} matched to Google, ${ok.reduce((n, r) => n + (r.items || 0), 0)} catalog items). Report: ${file}`);
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
