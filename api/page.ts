// Vercel serverless function: the app's own HTML with a real title, description, link preview
// (WhatsApp, Instagram, iMessage) and readable content for search engines, for the pages people
// share or search for: a shop (/p/<id>) and a dish in a city (/best/<city>/<dish>). Also /sitemap.xml and /robots.txt.
// The app then starts as usual and replaces the pre-filled content. Any failure serves the plain app.
import type { VercelRequest, VercelResponse } from "@vercel/node";

const SUPA = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Dish { item_name: string; place_id: string; place_name: string; area: string | null; city: string; review_count: number; avg_rating: number; loved_count: number }
interface PlaceRow { name: string; area: string | null; city: string; category: string; about: string | null }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const unslug = (s: string) => s.replace(/-+/g, " ").trim();
const title = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const pct = (d: Dish) => (d.review_count ? Math.round((d.loved_count / d.review_count) * 100) : 0);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

async function db<T>(path: string, body?: unknown): Promise<T | null> {
  if (!SUPA || !KEY) return null;
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(2500),
  }).catch(() => null);
  return r?.ok ? ((await r.json()) as T) : null;
}

interface Page { title: string; description: string; html: string; jsonLd?: unknown; canonical: string }

async function placePage(id: string, origin: string): Promise<Page | null> {
  if (!UUID.test(id)) return null;
  const [rows, dishes] = await Promise.all([
    db<PlaceRow[]>(`places?select=name,area,city,category,about&id=eq.${id}&status=eq.live&limit=1`),
    db<Dish[]>("rpc/top_dishes", { p_place: id, p_limit: 5 }),
  ]);
  const p = rows?.[0];
  if (!p) return null;
  const where = [p.area, p.city].filter(Boolean).join(", ");
  const top = (dishes || []).slice(0, 5);
  const loved = top.slice(0, 3).map((d) => `${d.item_name} (${pct(d)}% of ${d.review_count} loved it)`).join(", ");
  return {
    title: `${p.name}, ${where}: most loved picks`,
    description: loved ? `Most loved at ${p.name}: ${loved}. Rated by people who went there.` : (p.about || `${p.category} in ${where}. See what people loved, rated by people who visited.`).slice(0, 200),
    canonical: `${origin}/p/${id}`,
    html: `<main style="padding:24px;font-family:system-ui,sans-serif"><h1>${esc(p.name)}</h1><p>${esc(p.category)} · ${esc(where)}</p>`
      + (top.length ? `<h2>Most loved here</h2><ol>${top.map((d) => `<li>${esc(d.item_name)}: ★${Number(d.avg_rating).toFixed(1)}, ${pct(d)}% of ${d.review_count} loved it</li>`).join("")}</ol>` : "")
      + `</main>`,
    jsonLd: { "@context": "https://schema.org", "@type": "LocalBusiness", name: p.name, address: { "@type": "PostalAddress", addressLocality: p.city, streetAddress: p.area || undefined }, url: `${origin}/p/${id}` },
  };
}

async function bestPage(citySlug: string, dishSlug: string, origin: string): Promise<Page | null> {
  const dish = unslug(dishSlug), cityQ = unslug(citySlug);
  if (!dish || !cityQ || dish.length > 60 || cityQ.length > 60) return null;
  const rows = await db<Dish[]>("rpc/top_dishes", { p_query: dish, p_city: cityQ, p_limit: 20 });
  if (!rows) return null;
  const city = rows[0]?.city || title(cityQ);
  const name = `Best ${title(dish)} in ${city}`;
  const url = `${origin}/best/${slug(city)}/${slug(dish)}`;
  const lead = rows.slice(0, 3).map((d, i) => `${i + 1}. ${d.place_name} (${pct(d)}% of ${d.review_count} loved it)`).join(", ");
  return {
    title: name,
    description: rows.length ? `${lead}. Ranked by people who tried it there, not by ads.` : `No ratings for ${dish} in ${city} yet.`,
    canonical: url,
    html: `<main style="padding:24px;font-family:system-ui,sans-serif"><h1>${esc(name)}</h1><p>Ranked by people who tried it there.</p><ol>`
      + rows.map((d) => `<li><a href="/p/${d.place_id}">${esc(d.place_name)}</a>${d.area ? `, ${esc(d.area)}` : ""}: ${esc(d.item_name)}, ★${Number(d.avg_rating).toFixed(1)}, ${pct(d)}% of ${d.review_count} loved it</li>`).join("")
      + `</ol></main>`,
    jsonLd: { "@context": "https://schema.org", "@type": "ItemList", name, itemListElement: rows.map((d, i) => ({ "@type": "ListItem", position: i + 1, name: `${d.item_name} at ${d.place_name}`, url: `${origin}/p/${d.place_id}` })) },
  };
}

async function sitemap(origin: string): Promise<string> {
  const [pairs, places] = await Promise.all([
    db<{ city: string; dish: string }[]>("rpc/dish_pages", { p_min_reviews: 3, p_limit: 5000 }),
    db<{ id: string }[]>("places?select=id&status=eq.live&limit=5000"),
  ]);
  const urls = [`${origin}/`, ...(pairs || []).map((x) => `${origin}/best/${slug(x.city)}/${slug(x.dish)}`), ...(places || []).map((p) => `${origin}/p/${p.id}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((u) => `<url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

/** The built app's index.html, asked of this same deployment (one retry). */
async function appHtml(origin: string): Promise<string | null> {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(2500) }).catch(() => null);
    if (r?.ok) { const t = await r.text(); if (t.includes('id="root"')) return t; }
  }
  return null;
}

/** Puts the page's title, description, preview tags and content into the app's HTML. */
export function inject(shell: string, p: Page): string {
  const meta = [
    `<meta name="description" content="${esc(p.description)}" />`,
    `<link rel="canonical" href="${esc(p.canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Trusted Picks" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:url" content="${esc(p.canonical)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    p.jsonLd ? `<script type="application/ld+json">${JSON.stringify(p.jsonLd).replace(/</g, "\\u003c")}</script>` : "",
  ].join("\n    ");
  return shell
    .replace(/<meta name="description"[^>]*>\s*/i, "")
    .replace(/<title>[^<]*<\/title>/i, `<title>${esc(p.title)} · Trusted Picks</title>`)
    .replace("</head>", `    ${meta}\n  </head>`)
    .replace(/<div id="root"><\/div>/, `<div id="root">${p.html}</div>`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = one(req.headers["x-forwarded-host"]) || one(req.headers.host);
  const origin = `https://${host}`;
  const kind = one(req.query.kind);
  if (kind === "robots") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=86400");
    return res.send(["User-agent: *", "Allow: /", ...["/api/", "/q/", "/r/", "/review/", "/manage/", "/owner", "/admin", "/saved/", "/me", "/signin", "/check"].map((p) => `Disallow: ${p}`), `Sitemap: ${origin}/sitemap.xml`, ""].join("\n"));
  }
  if (kind === "sitemap") {
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.send(await sitemap(origin).catch(() => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(origin)}/</loc></url></urlset>\n`));
  }
  const [shell, page] = await Promise.all([
    appHtml(origin),
    (kind === "best" ? bestPage(one(req.query.city), one(req.query.dish), origin) : placePage(one(req.query.id), origin)).catch(() => null),
  ]);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!shell) {
    // Without the app's HTML, still give a readable page that leads into the app.
    res.setHeader("Cache-Control", "no-store");
    // The browser fetches the app's HTML itself and swaps it in, so people still land in the app.
    return res.status(200).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(page?.title || "Trusted Picks")}</title>${page?.html || ""}<p style="padding:0 24px"><a href="/">Open Trusted Picks</a></p>`
      + `<script>fetch("/index.html").then(function(r){return r.ok?r.text():null}).then(function(h){if(h){document.open();document.write(h);document.close()}})</script>`);
  }
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  return res.status(200).send(page ? inject(shell, page) : shell);
}
