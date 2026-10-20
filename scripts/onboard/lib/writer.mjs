// Writes one business into Supabase: places, its catalog (items), a counter QR and optionally a plan.
// Never writes reviews, ratings or visits: those only come from real customers scanning a QR.
// Matches the schema in supabase/migrations (places, items, qr_codes, subscriptions).
import { createClient } from "@supabase/supabase-js";
import { loadEnv, metres, parsePoint, slugify, clip } from "./common.mjs";
import { mergeLinks, normalizeDiet } from "./normalize.mjs";
import { storeCommonsImage } from "../sources/commons.mjs";

let client = null;
export function db() {
  if (client) return client;
  const env = loadEnv();
  const url = env.SUPABASE_URL, key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are needed in .env (use --dry-run to try without them)");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

const KINDS = new Set(["food", "store", "beauty", "health", "fitness", "education", "services", "other"]);
const KIND_ALIASES = { restaurant: "food", cafe: "food", salon: "beauty", spa: "beauty", retail: "store", shop: "store",
  healthcare: "health", clinic: "health", gym: "fitness", school: "education", service: "services" };
export const normalizeKind = (k) => (KINDS.has(k) ? k : KIND_ALIASES[String(k || "").toLowerCase()] || "other");

const PLACE_COLS = "id, name, city, area, category, kind, about, hours, price_level, contact_phone, google_place_id, location, links, cover_path, owner_id, currency";

/** The existing row for this business: same Google ID, or same name in the same city within 250 m. */
async function findExisting(sb, b) {
  if (b.googlePlaceId) {
    const { data } = await sb.from("places").select(PLACE_COLS).eq("google_place_id", b.googlePlaceId).maybeSingle();
    if (data) return data;
  }
  const pattern = b.name.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: same } = await sb.from("places").select(PLACE_COLS).ilike("name", pattern).ilike("city", b.city).limit(50);
  if (!same?.length) return null;
  const here = b.lat != null ? { lat: b.lat, lng: b.lng } : null;
  // Chains have many branches with one name: only the branch at this spot is the same place.
  const near = same.find((p) => here && metres(here, parsePoint(p.location)) <= 250);
  if (near) return near;
  const unpinned = same.filter((p) => !p.location);
  if (unpinned.length === 1 && (!here || same.length === 1)) return unpinned[0];
  return null;
}

const blank = (v) => v == null || v === "" || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

/**
 * b: { name, kind, category, area, city, about, hours, priceLevel, currency, lat, lng, googlePlaceId,
 *      links[], items[], photo?, verified? }
 * opts: { overwrite, qr, plan, planMonths, dryRun }
 * Existing places keep what they have; only empty fields are filled, links are added (never removed),
 * unless --overwrite is given for a place nobody has claimed yet.
 */
export async function onboardBusiness(b, opts = {}) {
  const sb = opts.dryRun ? null : db();
  const result = { name: b.name, city: b.city, area: b.area, action: "dry-run", placeId: null, googlePlaceId: b.googlePlaceId || null, items: 0, qr: null, photo: null };
  if (opts.dryRun) return { ...result, items: b.items?.length || 0 };

  const existing = await findExisting(sb, b);
  const fresh = {
    name: clip(b.name, 120), category: clip(b.category || "Business", 60), kind: normalizeKind(b.kind), area: b.area || null,
    city: b.city, about: b.about || null, hours: b.hours || null, price_level: b.priceLevel || null,
    contact_phone: b.links.find((l) => l.kind === "phone")?.url.slice(4) || null, google_place_id: b.googlePlaceId || null,
    currency: b.currency || "INR",
  };
  const point = b.lat != null && b.lng != null ? `SRID=4326;POINT(${b.lng} ${b.lat})` : null;

  let placeId, place;
  if (existing) {
    placeId = existing.id;
    const replace = opts.overwrite && !existing.owner_id;
    const patch = {};
    for (const [k, v] of Object.entries(fresh)) {
      if (v == null || k === "name" || k === "city") continue;
      if (k === "google_place_id" && existing.google_place_id) continue; // never re-point a Google link
      if (replace || blank(existing[k]) || (k === "kind" && existing.kind === "other")) patch[k] = v;
    }
    // Older profiles without the amenities block get it added under what's there.
    const block = fresh.about?.split("\n\n").find((x) => /^services\s*&\s*amenities:/i.test(x));
    if (!patch.about && block && existing.about && !/services\s*&\s*amenities:/i.test(existing.about)) patch.about = `${existing.about}\n\n${block}`;
    if (point && (replace || !existing.location)) patch.location = point;
    const links = replace ? mergeLinks(b.links) : mergeLinks(existing.links || [], b.links);
    if (JSON.stringify(links) !== JSON.stringify(existing.links || [])) patch.links = links;
    if (Object.keys(patch).length) {
      const { error } = await sb.from("places").update(patch).eq("id", placeId);
      if (error) throw new Error(`update ${b.name}: ${error.message}`);
    }
    result.action = Object.keys(patch).length ? `updated (${Object.keys(patch).join(", ")})` : "unchanged";
    place = { ...existing, ...patch };
  } else {
    const row = { ...fresh, links: mergeLinks(b.links), status: "live", verification: b.verified ? "verified" : "pending" };
    if (point) row.location = point;
    const { data, error } = await sb.from("places").insert(row).select(PLACE_COLS).single();
    if (error) throw new Error(`insert ${b.name}: ${error.message}`);
    placeId = data.id; place = data; result.action = `created (${row.verification})`;
  }
  result.placeId = placeId;

  // Cover photo: a freely licensed Commons photo, only if the place has none.
  if (b.photo && !place.cover_path) {
    const path = await storeCommonsImage(sb, placeId, b.photo);
    if (path) {
      const about = [place.about, b.photo.credit].filter(Boolean).join("\n\n");
      await sb.from("places").update({ cover_path: path, about }).eq("id", placeId);
      result.photo = b.photo.page;
    }
  }

  // Catalog: menu items or services the business itself publishes. New names only; owner edits are kept.
  if (b.items?.length) {
    const rows = b.items.map((it, i) => ({
      place_id: placeId, name: clip(it.name, 80), section: it.section ? clip(it.section, 40) : null,
      description: it.description || null, diet: normalizeDiet(it.diet),
      price_inr: it.price != null && (!it.currency || it.currency === fresh.currency) ? Math.round(it.price) : null,
      sort_order: i, is_listed: false,
    }));
    const { data, error } = await sb.from("items").upsert(rows, { onConflict: "place_id,name_normalized", ignoreDuplicates: true }).select("id");
    if (error) console.warn(`    items: ${error.message}`);
    else result.items = data?.length || 0;
  }

  // One counter QR if the place has none. Seats, jar size and refill stay empty so the database's
  // per-type defaults apply (qr_jar: a restaurant QR holds 12 reviews and refills one every 5 minutes).
  if (opts.qr !== false) {
    const { data: qrs } = await sb.from("qr_codes").select("token").eq("place_id", placeId).limit(1);
    if (qrs?.length) result.qr = qrs[0].token;
    else {
      const token = `${slugify(b.city).slice(0, 3)}-${slugify(b.name).slice(0, 12)}-${crypto.randomUUID().slice(0, 6)}`;
      const { error } = await sb.from("qr_codes").insert({ place_id: placeId, token, table_label: "Counter", active: true });
      if (error) console.warn(`    QR: ${error.message}`);
      else result.qr = token;
    }
  }

  // A plan only when asked for; otherwise the free trial the database starts for every new place stays.
  if (opts.plan) {
    const periodEnd = new Date(Date.now() + (opts.planMonths || 12) * 30.44 * 86400 * 1000).toISOString();
    const { error } = await sb.from("subscriptions").upsert({
      place_id: placeId, plan: opts.plan, status: opts.plan === "trial" ? "trial" : "active", period_end: periodEnd,
      billing_interval: (opts.planMonths || 12) >= 12 ? "year" : "month", cancel_at_period_end: false, updated_at: new Date().toISOString(),
    }, { onConflict: "place_id" });
    if (error) console.warn(`    plan: ${error.message}`);
  }
  return result;
}
