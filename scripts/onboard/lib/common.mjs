// Shared helpers for the onboarding pipeline: .env loading, polite HTTP, small text utilities.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../..", import.meta.url));

/** Reads KEY=value lines from the repo's .env (process.env wins). */
export function loadEnv() {
  const envPath = join(root, ".env");
  const env = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i !== -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return new Proxy(env, { get: (e, k) => process.env[k] || e[k] });
}

// Identifies us to OpenStreetMap, Wikimedia and shop websites, as their usage policies ask.
export const USER_AGENT = "TrustedPicksOnboard/2.0 (+https://github.com/vnishchay/project007)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with our User-Agent, a timeout and a couple of retries on 429/5xx. */
export async function http(url, { retries = 2, timeout = 20000, headers = {}, ...opts } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...opts, headers: { "User-Agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeout) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(2000 * 2 ** attempt); continue; }
      return res;
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(2000 * 2 ** attempt);
    }
  }
}

/** Calls fn at most once every `ms` (Nominatim allows 1 request a second). */
export function throttle(ms) {
  let next = 0;
  return async () => {
    const wait = next - Date.now();
    next = Math.max(Date.now(), next) + ms;
    if (wait > 0) await sleep(wait);
  };
}

export function slugify(text) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const titleCase = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** Lowercase letters and digits only, for comparing names from different sources. */
export const nameKey = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Rough similarity of two business names, 0..1 (shared word share, plus containment). */
export function nameSimilarity(a, b) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const stop = new Set(["the", "and", "of", "restaurant", "cafe", "shop", "store", "salon", "pvt", "ltd"]);
  const wa = new Set(x.split(" ").filter((w) => !stop.has(w)));
  const wb = new Set(y.split(" ").filter((w) => !stop.has(w)));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

/** Distance in metres between two {lat,lng}. */
export function metres(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Reads a PostGIS geography point as PostgREST returns it (EWKB hex) or as WKT/GeoJSON. */
export function parsePoint(v) {
  if (!v) return null;
  if (typeof v === "object" && Array.isArray(v.coordinates)) return { lng: v.coordinates[0], lat: v.coordinates[1] };
  const s = String(v);
  const wkt = s.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  if (wkt) return { lng: Number(wkt[1]), lat: Number(wkt[2]) };
  if (!/^[0-9a-f]+$/i.test(s) || s.length < 42) return null;
  const buf = Buffer.from(s, "hex");
  const le = buf[0] === 1;
  const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  let off = 5;
  if (type & 0x20000000) off += 4; // SRID present
  const rd = (o) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  return { lng: rd(off), lat: rd(off + 8) };
}

export const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};
