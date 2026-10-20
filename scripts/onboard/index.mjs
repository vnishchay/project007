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
//   Wikipedia / Wikidata        a short history and founding year for well-known places, credited
// Zomato, Swiggy, Justdial and Google pages are never scraped.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, root, slugify } from "./lib/common.mjs";
import { amenitiesFromTags, categoryFor, composeAbout, storyFromTags, cleanUrl, linkKind, currencyFor, mergeLinks, osmHoursToApp, socialUrl, telLink } from "./lib/normalize.mjs";
import { discoverOsm, geocodeCity, osmArea, osmRichness, reverseArea } from "./sources/osm.mjs";
import { googleDetails, googlePhoto, matchGooglePlace } from "./sources/google.mjs";
import { fetchMenuFile, pdfText, readMenu } from "./sources/menus.mjs";
import { readMarketplaceMenu } from "./sources/marketplaces.mjs";
import { readWebsite } from "./sources/website.mjs";
import { commonsFileFor, commonsImage } from "./sources/commons.mjs";
import { wikiFacts } from "./sources/wikipedia.mjs";
import { itemCount, normalizeKind, onboardBusiness, saveItems } from "./lib/writer.mjs";

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
  --no-wiki               Don't add Wikipedia history for well-known places
  --no-menus              Don't read menus (website pages, PDFs, photos, Zomato/Swiggy)
  --no-marketplaces       Don't read the shop's own Zomato/Swiggy page
  --menu-photos <n>       Google photos to check for a menu per place (default 8; 0 = none)
  --no-qr                 Don't create the counter QR
  --reverse-area          Look up the neighbourhood on OpenStreetMap when the place doesn't name one (1/sec)
  --verified              Mark new places verified (default: verified only when matched to Google, else pending)
  --overwrite             Replace details on places nobody has claimed (default: only fill empty fields)
  --plan <code>           Also put new and existing places on this plan (trial|starter|standard|pro)
  --months <n>            Length of --plan (default 12)
`;

function parseArgs(argv) {
  const o = { kinds: ["food"], limit: 50, radius: 2000, google: true, website: true, photos: true, wiki: true, menus: true, marketplaces: true, menuPhotos: 8, qr: true, months: 12 };
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
    else if (a === "--no-wiki") o.wiki = false;
    else if (a === "--no-menus") o.menus = false;
    else if (a === "--no-marketplaces") o.marketplaces = false;
    else if (a === "--menu-photos") o.menuPhotos = Math.max(0, Number(next()) || 0);
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

  let googlePlaceId = null, gd = null;
  if (o.google && ctx.googleKey) {
    const g = await matchGooglePlace(ctx.googleKey, { name: rec.name, lat: rec.lat, lng: rec.lng, city: ctx.city, area });
    if (g?.closed) return { skip: "closed for good on Google" };
    if (g?.placeId) {
      googlePlaceId = g.placeId; sources.push("Google");
      const q = [rec.name, area, ctx.city].filter(Boolean).join(" ");
      links.push({ kind: "maps", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}&query_place_id=${encodeURIComponent(g.placeId)}` });
      gd = await googleDetails(ctx.googleKey, g.placeId).catch(() => null);
      if (gd?.closed) return { skip: "closed for good on Google" };
      if (gd) {
        const tel = telLink(gd.phone, ctx.calling);
        if (tel) links.push({ kind: "phone", url: tel });
        if (gd.website) links.push({ url: gd.website });
      }
    }
  }

  // The shop's own site: from OSM, else the one on its Google profile (unless that's a social or delivery page).
  const ownSite = website || (gd?.website && linkKind(gd.website) === "website" ? cleanUrl(gd.website) : null);
  let site = null;
  if (o.website && ownSite) {
    site = await readWebsite(ownSite);
    if (site) {
      sources.push("own website");
      const tel = telLink(site.phone, ctx.calling);
      if (tel) links.push({ kind: "phone", url: tel });
      links.push(...site.links);
      if (site.menuUrl && !site.items.length) links.push({ kind: "other", url: site.menuUrl, label: rec.kind === "food" ? "Menu" : "Services & prices" });
    }
  }

  let photo = null;
  const coverLoaders = [];
  if (o.photos) {
    const file = await commonsFileFor(t).catch(() => null);
    if (file) photo = await commonsImage(file).catch(() => null);
    if (photo) { sources.push("Wikimedia Commons"); coverLoaders.push(async () => ({ url: photo.url, mime: photo.mime, credit: photo.credit, prefix: "commons" })); }
    const first = gd?.photos?.[0];
    if (first) coverLoaders.push(async () => {
      const img = await googlePhoto(ctx.googleKey, first.name, 1400);
      return img && { ...img, prefix: "google", credit: `Photo: ${first.author || "a Google Maps user"}, via Google Maps` };
    });
  }

  const wiki = o.wiki && (t.wikipedia || t.wikidata) ? await wikiFacts(t).catch(() => null) : null;
  if (wiki?.history) sources.push("Wikipedia");

  const tags = { ...t };
  if (!tags.cuisine && site?.cuisine?.length) tags.cuisine = site.cuisine.join(";");
  if (!tags.start_date) tags.start_date = site?.since || wiki?.since || undefined;
  const amenities = [...new Set([...amenitiesFromTags(tags), ...(gd?.amenities || []), ...(gd?.priceRange ? [gd.priceRange] : [])])].slice(0, 24);
  const story = [storyFromTags(tags), gd?.summary].filter(Boolean).join(" ");
  // A plain OSM label ("Restaurant") gives way to Google's more specific one ("North Indian restaurant").
  const category = !tags.cuisine && gd?.typeLabel ? gd.typeLabel : categoryFor(rec.typeLabel, tags);
  return {
    name: rec.name, kind: rec.kind, category, area, city: ctx.city,
    about: composeAbout({ story, history: wiki?.history, historyCredit: wiki?.credit, amenities }),
    hours: ctx.hoursFrom(t["opening_hours"]) || gd?.hours || site?.hours || null,
    priceLevel: site?.priceLevel || gd?.priceLevel || null, currency: ctx.currency, lat: rec.lat, lng: rec.lng, googlePlaceId,
    google: gd && { rating: gd.rating, count: gd.count }, googlePhotos: gd?.photos || [],
    links: mergeLinks(links), items: site?.items || [], menuText: site?.menuText || "", menuFiles: site?.menuFiles || [],
    photo, coverLoaders, verified: o.verified || Boolean(googlePlaceId), sources, osmId: rec.osmId,
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

/**
 * Looks for a menu in order: the shop's Zomato/Swiggy page, its website's menu pages, PDF menus and menu
 * photos, then its Google photos (the reader returns nothing for photos that aren't menus).
 * Returns { items, from, blocked[] }.
 */
async function findMenu(b, placeId, ctx, o) {
  const blocked = [];
  if (await itemCount(placeId) > 0) return { items: [], from: null, blocked };
  if (o.marketplaces) {
    for (const l of b.links.filter((l) => l.kind === "zomato" || l.kind === "swiggy")) {
      const m = await readMarketplaceMenu(l.url);
      if (m.items?.length) return { items: m.items, from: l.kind, blocked };
      blocked.push(`${l.kind}: ${m.blocked}`);
    }
  }
  if (!ctx.env.ONBOARD_TOKEN) return { items: [], from: null, blocked };
  if (b.menuText) {
    const items = await readMenu(ctx.env, placeId, { text: b.menuText });
    if (items.length) return { items, from: "website", blocked };
  }
  const images = [];
  for (const url of b.menuFiles || []) {
    const f = await fetchMenuFile(url);
    if (f?.kind === "pdf") {
      const text = await pdfText(f.data).catch(() => "");
      const items = text.length > 40 ? await readMenu(ctx.env, placeId, { text }) : [];
      if (items.length) return { items, from: "website PDF", blocked };
    } else if (f?.kind === "image") images.push(f);
  }
  if (images.length) {
    const items = await readMenu(ctx.env, placeId, { images });
    if (items.length) return { items, from: "website photos", blocked };
  }
  // Google photos, four at a time (the reader's limit), up to --menu-photos of them.
  const photos = (b.googlePhotos || []).slice(0, o.menuPhotos);
  for (let i = 0; i < photos.length; i += 4) {
    const batch = (await Promise.all(photos.slice(i, i + 4).map((p) => googlePhoto(ctx.googleKey, p.name, 1200).catch(() => null)))).filter(Boolean);
    if (!batch.length) continue;
    const items = await readMenu(ctx.env, placeId, { images: batch });
    if (items.length >= 3) return { items, from: "Google photos", blocked };
  }
  return { items: [], from: null, blocked };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const ctx = { env, city: o.city, googleKey: o.google ? env.GOOGLE_MAPS_KEY || env.VITE_GOOGLE_MAPS_KEY : null, currency: "INR", calling: "91", hoursFrom: osmHoursToApp };
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

  // Places are written one at a time (so the same shop listed twice can't be created twice) ...
  const results = [], pending = [];
  for (const b of businesses.filter(Boolean)) {
    try {
      const r = await onboardBusiness(b, { dryRun: o.dryRun, overwrite: o.overwrite, qr: o.qr, plan: o.plan, planMonths: o.months });
      const row = { ...r, sources: b.sources, osmId: b.osmId, category: b.category, hours: b.hours, about: b.about, google: b.google,
        links: b.links, catalog: b.items, photo: r.photo || (o.dryRun && b.coverLoaders?.length ? "available" : null),
        menuSources: { text: Boolean(b.menuText), files: b.menuFiles?.length || 0, googlePhotos: b.googlePhotos?.length || 0 } };
      results.push(row);
      if (!o.dryRun && o.menus && r.placeId && !r.items) pending.push({ b, row });
      if (!o.dryRun) console.log(`✓ ${b.name}: ${r.action}, ${r.items} items${r.qr ? `, QR /q/${r.qr}` : ""}${r.photo ? ", photo" : ""}`);
    } catch (e) {
      console.warn(`✗ ${b.name}: ${e.message}`);
      results.push({ name: b.name, error: e.message });
    }
  }
  // ... then menus are looked for three places at a time, as reading them is the slow part.
  if (pending.length) {
    if (!ctx.env.ONBOARD_TOKEN) console.log("No ONBOARD_TOKEN in .env: only Zomato/Swiggy pages are read for menus (website and photo menus need the ai function).");
    console.log(`\n🍽️  Looking for menus at ${pending.length} places...`);
    await pool(pending, 3, async ({ b, row }) => {
      const m = await findMenu(b, row.placeId, ctx, o).catch((e) => ({ items: [], from: null, blocked: [e.message] }));
      if (m.items.length) { row.items = await saveItems(row.placeId, m.items, row.currency); row.menuFrom = m.from; }
      if (m.blocked.length) row.menuBlocked = m.blocked;
      if (row.items) console.log(`  ✓ ${b.name}: ${row.items} items from ${m.from}`);
    });
  }

  const dir = join(root, "scripts", "onboard", "out");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slugify(o.city || "input")}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}${o.dryRun ? "-dry" : ""}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), options: o, attribution: "Data © OpenStreetMap contributors (ODbL)", results }, null, 2));
  const ok = results.filter((r) => !r.error);
  const n = (f) => ok.filter(f).length;
  console.log(`\n${o.dryRun ? "Would onboard" : "Onboarded"} ${ok.length} places: ${n((r) => r.googlePlaceId)} matched to Google, ${n((r) => r.google?.rating != null)} with Google rating, ` +
    `${n((r) => r.hours)} with hours, ${n((r) => r.photo)} with a cover photo, ${n((r) => r.items > 0)} with a menu (${ok.reduce((s, r) => s + (r.items || 0), 0)} items), ` +
    `${n((r) => r.menuBlocked?.length)} where Zomato/Swiggy refused. Report: ${file}`);
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
