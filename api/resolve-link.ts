// Vercel serverless function: opens a Google Maps share link (maps.app.goo.gl/...) and
// returns the full Google Maps address it points to, so the app can find the business.
// Only Google hosts are followed, and nothing is fetched beyond the redirects.
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ALLOWED = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google|(www\.|maps\.)?google\.[a-z.]{2,6})$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let url = typeof req.query.url === "string" ? req.query.url : "";
  for (let hop = 0; hop < 5; hop++) {
    let u: URL;
    try { u = new URL(url); } catch { return res.status(400).json({ error: "That isn't a link" }); }
    if (u.protocol !== "https:" || !ALLOWED.test(u.hostname)) {
      return hop === 0 ? res.status(400).json({ error: "Paste a Google Maps link" }) : res.json({ url });
    }
    if (/^(www\.|maps\.)?google\./i.test(u.hostname) && u.pathname.startsWith("/maps")) return res.json({ url });
    const r = await fetch(u, { redirect: "manual" }).catch(() => null);
    const next = r?.headers.get("location");
    if (!next) return res.json({ url });
    url = new URL(next, u).toString();
  }
  return res.json({ url });
}
