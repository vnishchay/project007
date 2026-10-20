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

const MENU_WORDS = /menu|services|price|rate[-_ ]?card|tariff|food|dishes|our[-_ ]?offer|packages|treatments/i;
const PAGE_WORDS = /menu|services|price|rate|tariff|contact|about|gallery|food|treatments|packages|timing|hours/i;

/** Visible text of a page, scripts and styles dropped. */
export function pageText(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/li|\/tr|\/h\d|\/div)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8377;|&#x20b9;/gi, "₹").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function sameSiteLinks(html, base) {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"), base);
      if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
      out.push({ url: u.toString().replace(/#.*$/, ""), label: m[2].replace(/<[^>]+>/g, " ").trim() });
    } catch { /* bad link */ }
  }
  return out;
}

/** Images on a page that look like menus or price lists (by file name or alt text). */
function menuImages(html, base) {
  const out = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] || "";
    if (!src || !(MENU_WORDS.test(src) || MENU_WORDS.test(alt))) continue;
    try { out.push(new URL(src, base).toString()); } catch { /* bad src */ }
  }
  return out;
}

/**
 * Reads a business website: the home page and up to `maxPages - 1` of its own menu/services/contact pages.
 * Returns { phone, hours, priceLevel, cuisine, since, links[], items[], menuUrl, menuText, menuFiles[] }.
 * items are schema.org menu entries; menuText / menuFiles (PDFs, menu photos) go to the menu reader.
 */
export async function readWebsite(siteUrl, { maxPages = 6 } = {}) {
  const start = cleanUrl(siteUrl);
  if (!start) return null;
  const home = await getPage(start);
  if (!home) return null;
  const pages = [home];
  const seen = new Set([home.url]);
  const candidates = sameSiteLinks(home.html, home.url)
    .filter((l) => PAGE_WORDS.test(l.url) || PAGE_WORDS.test(l.label))
    .sort((a, b) => Number(MENU_WORDS.test(b.url + b.label)) - Number(MENU_WORDS.test(a.url + a.label)));
  const pdfs = new Set();
  for (const l of sameSiteLinks(home.html, home.url)) if (/\.pdf($|\?)/i.test(l.url) && MENU_WORDS.test(l.url + l.label)) pdfs.add(l.url);
  for (const c of candidates) {
    if (pages.length >= maxPages) break;
    if (seen.has(c.url) || /\.(pdf|jpe?g|png|webp)($|\?)/i.test(c.url)) continue;
    seen.add(c.url);
    const p = await getPage(c.url);
    if (p) { p.menuish = MENU_WORDS.test(c.url + c.label); pages.push(p); }
  }
  const objs = pages.flatMap((p) => jsonLd(p.html));
  const biz = objs.find((o) => isType(o, BUSINESS) && (o.name || o.telephone || o.address)) || {};
  const links = [...[].concat(biz.sameAs || []).map((u) => ({ url: u })), ...pages.flatMap((p) => profileLinks(p.html, p.url))];
  let items = catalogFromLd(objs);
  let menuUrl = typeof biz.hasMenu === "string" ? biz.hasMenu : biz.hasMenu?.url || biz.menu || null;
  const menuPage = pages.find((p) => p.menuish);
  if (!menuUrl && menuPage) menuUrl = menuPage.url;
  try { if (menuUrl) menuUrl = new URL(menuUrl, home.url).toString(); } catch { menuUrl = null; }
  // Text of the menu/services pages, for the menu reader when there's no schema.org menu.
  const menuText = items.length ? "" : pages.filter((p) => p.menuish).map((p) => pageText(p.html)).join("\n\n").slice(0, 24000);
  for (const p of pages) for (const l of sameSiteLinks(p.html, p.url)) if (/\.pdf($|\?)/i.test(l.url) && MENU_WORDS.test(l.url + l.label)) pdfs.add(l.url);
  const imgs = [...new Set(pages.flatMap((p) => menuImages(p.html, p.url)))].slice(0, 4);
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
    menuText: menuText.length > 80 ? menuText : "",
    menuFiles: items.length ? [] : [...pdfs].slice(0, 2).concat(imgs),
    pages: pages.length,
  };
}
