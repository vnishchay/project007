// A business's own website: the facts it publishes about itself in schema.org markup (JSON-LD),
// plus links it gives to its Zomato/Swiggy/Instagram/... pages. robots.txt is respected, at most
// two pages are read per site, and marketplaces (Zomato, Swiggy, Justdial...) are never fetched.
// Website photos and prose are the owner's copyright, so they aren't copied: only facts, prices and links.
import { USER_AGENT, http, clip } from "../lib/common.mjs";
import { cleanUrl, linkKind, normalizeDiet, schemaHoursToApp } from "../lib/normalize.mjs";

const NEVER_FETCH = /(zomato|swiggy|justdial|magicpin|eatsure|tripadvisor|facebook|instagram|fb\.|google|goo\.gl|youtube|wa\.me|whatsapp|linktr\.ee)\./i;
const robotsCache = new Map();

/** True unless the site's robots.txt disallows this path for us or for every bot. */
export async function robotsAllows(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = [];
    try {
      const res = await http(`${u.origin}/robots.txt`, { timeout: 8000, retries: 0 });
      if (res.ok) rules = parseRobots(await res.text());
    } catch { /* no robots.txt: allowed */ }
    robotsCache.set(u.origin, rules);
  }
  const path = u.pathname + u.search;
  let verdict = true, longest = -1;
  for (const r of robotsCache.get(u.origin)) {
    if (path.startsWith(r.path) && r.path.length > longest) { longest = r.path.length; verdict = r.allow; }
  }
  return verdict;
}

function parseRobots(txt) {
  const me = USER_AGENT.split("/")[0].toLowerCase();
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, k, v] = m;
    if (k.toLowerCase() === "user-agent") {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (/^disallow$/i.test(k) && v) cur.rules.push({ path: v.replace(/\*.*$/, ""), allow: false });
      if (/^allow$/i.test(k) && v) cur.rules.push({ path: v.replace(/\*.*$/, ""), allow: true });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && me.includes(a)));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
}

async function getPage(url) {
  if (NEVER_FETCH.test(new URL(url).hostname + ".")) return null;
  if (!(await robotsAllows(url))) { console.log(`    robots.txt asks us not to read ${url}`); return null; }
  try {
    const res = await http(url, { headers: { Accept: "text/html,application/xhtml+xml" }, timeout: 12000, retries: 1 });
    if (!res.ok || !/html/i.test(res.headers.get("content-type") || "")) return null;
    return { url: res.url || url, html: (await res.text()).slice(0, 3_000_000) };
  } catch { return null; }
}

/** All JSON-LD objects on a page, @graph flattened. */
export function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { out.push(o); if (o["@graph"]) walk(o["@graph"]); } };
      walk(JSON.parse(m[1].trim().replace(/^<!--|-->$/g, "")));
    } catch { /* broken markup on their site: skip it */ }
  }
  return out;
}

const types = (o) => [].concat(o?.["@type"] || []).map(String);
const isType = (o, re) => types(o).some((t) => re.test(t));
const BUSINESS = /Restaurant|FoodEstablishment|CafeOrCoffeeShop|Bakery|BarOrPub|FastFoodRestaurant|IceCreamShop|LocalBusiness|Store|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|NailSalon|MedicalBusiness|Dentist|Physician|ExerciseGym|SportsActivityLocation|EducationalOrganization|Organization/;

function priceOf(offers) {
  const o = [].concat(offers || [])[0];
  if (!o) return null;
  const p = o.price ?? o.lowPrice ?? o.priceSpecification?.price;
  const n = Number(String(p ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? { price: Math.round(n), currency: o.priceCurrency || null } : null;
}

/** Menu items (schema.org Menu > MenuSection > MenuItem) and offered services/products, with prices. */
export function catalogFromLd(objs) {
  const items = [], seen = new Set();
  const add = (name, section, node) => {
    const n = clip(name, 80);
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    const p = priceOf(node.offers);
    items.push({ name: n, section: section ? clip(section, 40) : null, description: node.description ? clip(stripTags(node.description), 200) : null,
      price: p?.price ?? null, currency: p?.currency ?? null, diet: normalizeDiet([].concat(node.suitableForDiet || [])) });
  };
  const walkMenu = (node, section) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => walkMenu(n, section));
    if (isType(node, /MenuItem/)) add(node.name, section, node);
    if (isType(node, /MenuSection/)) section = node.name || section;
    for (const k of ["hasMenuSection", "hasMenuItem", "hasMenu", "itemListElement"]) if (node[k]) walkMenu(node[k], section);
  };
  const walkCatalog = (node, section) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => walkCatalog(n, section));
    if (isType(node, /OfferCatalog/)) section = node.name || section;
    if (isType(node, /^Offer$/) && node.itemOffered?.name) add(node.itemOffered.name, section, { ...node.itemOffered, offers: node.itemOffered.offers || node });
    else if (isType(node, /^(Service|Product|MenuItem)$/) && node.name) add(node.name, section, node);
    for (const k of ["itemListElement", "hasOfferCatalog", "makesOffer"]) if (node[k]) walkCatalog(node[k], section);
  };
  for (const o of objs) {
    if (isType(o, /^Menu$|MenuSection/) || o.hasMenu) walkMenu(o.hasMenu && typeof o.hasMenu === "object" ? o.hasMenu : o);
    if (o.hasOfferCatalog || o.makesOffer || isType(o, /OfferCatalog/)) walkCatalog(o.hasOfferCatalog || o.makesOffer || o);
    if (isType(o, /^(Service|Product|MenuItem)$/)) add(o.name, null, o);
  }
  return items.slice(0, 300);
}

const stripTags = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

/** Outbound links on the page that point at the business's own profiles elsewhere. */
function profileLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, "&"), base).toString(); } catch { continue; }
    if (/^(tel|mailto):/i.test(m[1])) u = m[1];
    const kind = linkKind(u);
    if (kind === "website" || kind === "maps") continue;
    // Share buttons and the site builder's own pages aren't the business's profile.
    if (/sharer|share\?|intent\/tweet|\/share\/|wix\.com|squarespace|wordpress\.(com|org)|godaddy/i.test(u)) continue;
    if (kind === "facebook" && /facebook\.com\/(tr|plugins|dialog)/i.test(u)) continue;
    out.push({ kind, url: u });
  }
  return out;
}

/**
 * Reads a business website. Returns what it states about itself:
 * { phone, hours, priceLevel, cuisine, since, links[], items[], menuUrl } (fields may be empty).
 */
export async function readWebsite(siteUrl) {
  const start = cleanUrl(siteUrl);
  if (!start) return null;
  const home = await getPage(start);
  if (!home) return null;
  const objs = jsonLd(home.html);
  const biz = objs.find((o) => isType(o, BUSINESS) && (o.name || o.telephone || o.address)) || {};
  const links = [
    ...[].concat(biz.sameAs || []).map((u) => ({ url: u })),
    ...profileLinks(home.html, home.url),
  ];
  let items = catalogFromLd(objs);
  // One more page: the menu / services page, when the site links one on its own domain.
  let menuUrl = typeof biz.hasMenu === "string" ? biz.hasMenu : biz.hasMenu?.url || biz.menu || null;
  if (!menuUrl) {
    const m = home.html.match(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>\s*(?:<[^>]+>\s*)*(?:our\s+)?(menu|services|price\s*list|rate\s*card)\b/i);
    if (m) menuUrl = m[1];
  }
  if (menuUrl) {
    try {
      const abs = new URL(menuUrl, home.url);
      menuUrl = abs.toString();
      if (abs.hostname === new URL(home.url).hostname && !items.length) {
        const page = await getPage(menuUrl);
        if (page) items = catalogFromLd(jsonLd(page.html));
      }
    } catch { menuUrl = null; }
  }
  const pr = String(biz.priceRange || "");
  const priceLevel = /^[₹$€£¥]{1,4}$/.test(pr) ? pr.length : null;
  const since = String(biz.foundingDate || "").match(/^\d{4}/)?.[0] || null;
  return {
    phone: [].concat(biz.telephone || [])[0] || null,
    hours: schemaHoursToApp(biz.openingHoursSpecification, biz.openingHours),
    priceLevel,
    cuisine: [].concat(biz.servesCuisine || []).filter(Boolean),
    since,
    links,
    items,
    menuUrl: menuUrl && cleanUrl(menuUrl),
  };
}
