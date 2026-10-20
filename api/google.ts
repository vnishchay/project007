// Vercel serverless function: the app's only way to Google's Places API (New).
// The API key stays on the server (env GOOGLE_MAPS_KEY, or the older VITE_GOOGLE_MAPS_KEY), so it
// can't be copied out of the browser and run up the bill. Only the fields the app shows are allowed,
// requests from other sites are refused, and each server instance caps how fast one visitor can ask.
// Google's terms don't allow storing this content: responses are only cached briefly in the browser.
import type { VercelRequest, VercelResponse } from "@vercel/node";

const KEY = process.env.GOOGLE_MAPS_KEY || process.env.VITE_GOOGLE_MAPS_KEY || "";
const API = "https://places.googleapis.com/v1";
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const PHOTO = /^places\/[A-Za-z0-9_-]{10,300}\/photos\/[A-Za-z0-9_-]{10,1000}$/;

// The field sets the app asks for (see src/lib/google.ts). Anything else is refused.
const PLACE_FIELDS = new Set([
  "rating,userRatingCount,googleMapsUri",
  "id,displayName,formattedAddress,editorialSummary,rating,userRatingCount,googleMapsUri,websiteUri,nationalPhoneNumber,regularOpeningHours.weekdayDescriptions,types,photos,reviews",
  // Same, plus what the place offers (shown as "Good to know").
  "id,displayName,formattedAddress,editorialSummary,rating,userRatingCount,googleMapsUri,websiteUri,nationalPhoneNumber,regularOpeningHours.weekdayDescriptions,types,photos,reviews,servesBreakfast,servesBrunch,servesLunch,servesDinner,servesCoffee,servesDessert,servesVegetarianFood,servesBeer,servesWine,servesCocktails,dineIn,takeout,delivery,curbsidePickup,reservable,outdoorSeating,liveMusic,goodForChildren,goodForGroups,goodForWatchingSports,menuForChildren,allowsDogs,restroom,paymentOptions,parkingOptions,accessibilityOptions,priceRange,currentOpeningHours.openNow,reviewSummary",
  "location",
]);
const SEARCH_FIELDS = "places.id,places.displayName,places.formattedAddress,places.types";

// A soft per-visitor limit for each warm instance: 60 requests a minute.
const hits = new Map<string, { n: number; t: number }>();
function tooMany(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); if (hits.size > 5000) hits.clear(); return false; }
  return ++h.n > 60;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

/** Only our own pages may ask (same host). Requests without Origin/Referer (old browsers) pass. */
function sameSite(req: VercelRequest): boolean {
  const host = one(req.headers["x-forwarded-host"]) || one(req.headers.host);
  const from = one(req.headers.origin) || one(req.headers.referer);
  if (!from) return true;
  try { return new URL(from).host === host; } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!KEY) return res.status(503).json({ error: "Google isn't set up" });
  if (!sameSite(req)) return res.status(403).json({ error: "Not allowed" });
  const ip = one(req.headers["x-real-ip"]) || one(req.headers["x-forwarded-for"]).split(",")[0]!.trim() || "?";
  if (tooMany(ip)) return res.status(429).json({ error: "Too many requests" });
  const op = one(req.query.op);

  try {
    if (op === "place") {
      const id = one(req.query.id), fields = one(req.query.fields);
      if (!PLACE_ID.test(id) || !PLACE_FIELDS.has(fields)) return res.status(400).json({ error: "Bad request" });
      const r = await fetch(`${API}/places/${encodeURIComponent(id)}`, {
        headers: { "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": fields },
        signal: AbortSignal.timeout(6000),
      });
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.status(r.status).json(await r.json());
    }

    if (op === "search" && req.method === "POST") {
      const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { text?: string; lat?: number; lng?: number };
      const text = String(body?.text || "").trim().slice(0, 200);
      if (!text) return res.json({ places: [] });
      const near = typeof body.lat === "number" && typeof body.lng === "number" && Math.abs(body.lat) <= 90 && Math.abs(body.lng) <= 180;
      const r = await fetch(`${API}/places:searchText`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": SEARCH_FIELDS },
        body: JSON.stringify({
          textQuery: text, pageSize: 5,
          ...(near ? { locationBias: { circle: { center: { latitude: body.lat, longitude: body.lng }, radius: 2000 } } } : {}),
        }),
        signal: AbortSignal.timeout(6000),
      });
      res.setHeader("Cache-Control", "no-store");
      return res.status(r.status).json(await r.json());
    }

    if (op === "photo") {
      // Ask Google for the photo's own address (no key in it) and send the browser there.
      const name = one(req.query.name);
      const px = Math.min(1600, Math.max(100, Number(one(req.query.max)) || 800));
      if (!PHOTO.test(name)) return res.status(400).json({ error: "Bad request" });
      const r = await fetch(`${API}/${name}/media?maxWidthPx=${px}&skipHttpRedirect=true`, {
        headers: { "X-Goog-Api-Key": KEY },
        signal: AbortSignal.timeout(6000),
      });
      const j = (await r.json().catch(() => ({}))) as { photoUri?: string };
      if (!r.ok || !j.photoUri) return res.status(404).end();
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.redirect(302, j.photoUri);
    }
  } catch {
    return res.status(502).json({ error: "Google didn't answer" });
  }
  return res.status(400).json({ error: "Bad request" });
}
