// Menus from a shop's own Zomato or Swiggy page: only the page the shop itself links to (on its website or
// Google profile), one plain request, and only when the site's robots.txt allows it. No logins, no hidden
// APIs, nothing that gets around their bot protection: if they refuse, the shop is skipped.
// Akanksha (2026-10-20) decided to read these pages; their terms of use may not allow it.
import { http, clip } from "../lib/common.mjs";
import { normalizeDiet } from "../lib/normalize.mjs";
import { robotsAllows } from "./website.mjs";

/** The JSON a page embeds for its own scripts (Zomato: __PRELOADED_STATE__, Swiggy/Next: __NEXT_DATA__ or ___INITIAL_STATE__). */
function embeddedState(html) {
  const out = [];
  const pre = html.match(/__PRELOADED_STATE__\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
  if (pre) { try { out.push(JSON.parse(JSON.parse(pre[1]))); } catch { /* changed format */ } }
  for (const m of html.matchAll(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { out.push(JSON.parse(m[1])); } catch { /* skip */ } }
  const init = html.match(/___INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*(?:var|window|<\/script>)/);
  if (init) { try { out.push(JSON.parse(init[1])); } catch { /* skip */ } }
  return out;
}

/** Walks embedded JSON for menu items: Zomato {name, price, desc, dietary_slugs}, Swiggy {info:{name, price (paise), isVeg}}. */
export function itemsFromState(states) {
  const items = [], seen = new Set();
  const add = (name, price, section, description, diet) => {
    const n = clip(name, 80);
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    items.push({ name: n, price: Number.isFinite(price) && price > 0 ? Math.round(price) : null, section: section ? clip(section, 40) : null,
      description: description ? clip(description, 200) : null, diet: normalizeDiet(diet) });
  };
  const walk = (o, section, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 40 || items.length >= 400) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, section, depth + 1); return; }
    const info = o.info;
    if (info && typeof info.name === "string" && (info.price != null || info.defaultPrice != null) && ("isVeg" in info || "category" in info)) {
      add(info.name, Number(info.price ?? info.defaultPrice) / 100, info.category || section, info.description,
        info.isVeg === 1 ? ["veg"] : info.isVeg === 0 ? ["non_veg"] : []);
      return;
    }
    if (typeof o.name === "string" && o.price != null && (Array.isArray(o.dietary_slugs) || Array.isArray(o.tag_slugs) || "desc" in o)) {
      const slugs = [...(o.dietary_slugs || []), ...(o.tag_slugs || [])].map((s) => String(s).replace(/-/g, "_"));
      add(o.name, Number(o.price), section, o.desc, slugs);
      return;
    }
    const nextSection = typeof o.name === "string" && (o.items || o.itemCards || o.categories) ? o.name : (typeof o.title === "string" && (o.itemCards || o.items) ? o.title : section);
    for (const k of Object.keys(o)) walk(o[k], nextSection, depth + 1);
  };
  for (const s of states) walk(s, null);
  return items;
}

/** Items from a Zomato/Swiggy page, or { blocked } saying why nothing was read. */
export async function readMarketplaceMenu(url) {
  try {
    if (!(await robotsAllows(url))) return { blocked: "robots.txt" };
    const res = await http(url, { headers: { Accept: "text/html", "Accept-Language": "en-IN,en" }, timeout: 20000, retries: 0 });
    if (!res.ok) return { blocked: `HTTP ${res.status}` };
    const items = itemsFromState(embeddedState(await res.text()));
    return items.length ? { items } : { blocked: "no menu on the page" };
  } catch (e) { return { blocked: e.message }; }
}
