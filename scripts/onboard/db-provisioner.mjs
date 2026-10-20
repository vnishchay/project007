// Database Provisioner for Automated Restaurant Onboarding
// Ingests places, menus, active QR codes and subscriptions into Supabase (no reviews).

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return {};
  const lines = readFileSync(envPath, "utf8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      env[k] = v;
    }
  }
  return env;
}

const env = loadEnv();
const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL or SUPABASE_SECRET_KEY missing in .env");
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeLinks(links) {
  if (Array.isArray(links)) return links;
  if (links && typeof links === "object") {
    return Object.entries(links)
      .filter(([_, url]) => Boolean(url))
      .map(([k, url]) => ({
        kind: k === "google_maps" ? "maps" : k,
        url: String(url)
      }));
  }
  return [];
}

function normalizeDiet(diet) {
  if (!Array.isArray(diet)) return ["veg"];
  const valid = new Set(["veg", "non_veg", "vegan", "jain"]);
  return diet.map((d) => {
    const clean = String(d).toLowerCase().replace(/-/g, "_");
    if (clean === "nonveg") return "non_veg";
    return valid.has(clean) ? clean : "veg";
  });
}


// Never writes reviews: those only come from real customers scanning a QR.
export async function onboardRestaurant(restaurantData, menuItems) {
  console.log(`\n======================================================`);
  console.log(`🚀 Onboarding: ${restaurantData.name} (${restaurantData.area}, ${restaurantData.city})`);
  console.log(`======================================================`);

  const linksArray = normalizeLinks(restaurantData.links);
  const contactPhone = restaurantData.phone || restaurantData.contact_phone || null;

  // 1. Check or Insert Place
  let placeId = null;
  let existingPlaces = null;

  if (restaurantData.google_place_id) {
    const { data: byGId } = await supabase
      .from("places")
      .select("id, name, city")
      .eq("google_place_id", restaurantData.google_place_id)
      .limit(1);
    if (byGId && byGId.length > 0) existingPlaces = byGId;
  }

  if (!existingPlaces || existingPlaces.length === 0) {
    const { data: byName, error: searchErr } = await supabase
      .from("places")
      .select("id, name, city")
      .ilike("name", restaurantData.name)
      .eq("city", restaurantData.city);

    if (searchErr) {
      throw new Error(`Failed to check existing place: ${searchErr.message}`);
    }
    existingPlaces = byName;
  }

  const pointWkt = `POINT(${restaurantData.lng} ${restaurantData.lat})`;

  if (existingPlaces && existingPlaces.length > 0) {
    placeId = existingPlaces[0].id;
    console.log(`ℹ️ Place already exists (ID: ${placeId}), updating details...`);
    const { error: updateErr } = await supabase
      .from("places")
      .update({
        name: restaurantData.name,
        category: restaurantData.category,
        area: restaurantData.area,
        about: restaurantData.about,
        price_level: restaurantData.price_level,
        location: pointWkt,
        hours: restaurantData.hours,
        kind: "food",
        cover_path: restaurantData.cover_path,
        logo_path: restaurantData.logo_path,
        links: linksArray,
        contact_phone: contactPhone,
        status: "live",
        google_place_id: restaurantData.google_place_id || null
      })
      .eq("id", placeId);

    if (updateErr) throw new Error(`Place update failed: ${updateErr.message}`);
  } else {
    console.log(`➕ Inserting new place into Supabase...`);
    const { data: newPlace, error: insertErr } = await supabase
      .from("places")
      .insert({
        name: restaurantData.name,
        category: restaurantData.category,
        area: restaurantData.area,
        city: restaurantData.city,
        about: restaurantData.about,
        price_level: restaurantData.price_level,
        location: pointWkt,
        hours: restaurantData.hours,
        kind: "food",
        cover_path: restaurantData.cover_path,
        logo_path: restaurantData.logo_path,
        links: linksArray,
        contact_phone: contactPhone,
        status: "live",
        google_place_id: restaurantData.google_place_id || null
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(`Place insert failed: ${insertErr.message}`);
    placeId = newPlace.id;
    console.log(`✓ Place created successfully (ID: ${placeId})`);
  }

  // 2. Insert Menu Items
  console.log(`🍽️ Ingesting ${menuItems.length} menu items...`);
  const insertedItems = [];
  for (const item of menuItems) {
    const { data: existingItem } = await supabase
      .from("items")
      .select("id, name")
      .eq("place_id", placeId)
      .ilike("name", item.name)
      .maybeSingle();

    if (existingItem) {
      await supabase
        .from("items")
        .update({
          price_inr: item.price_inr,
          description: item.description,
          section: item.section,
          diet: normalizeDiet(item.diet),
          is_listed: item.is_listed ?? true,
          sort_order: item.sort_order ?? 0,
          image_path: item.image_path
        })
        .eq("id", existingItem.id);
      insertedItems.push({ ...item, id: existingItem.id });
    } else {
      const { data: newItem, error: itemErr } = await supabase
        .from("items")
        .insert({
          place_id: placeId,
          name: item.name,
          price_inr: item.price_inr,
          description: item.description,
          section: item.section,
          diet: normalizeDiet(item.diet),
          is_listed: item.is_listed ?? true,
          sort_order: item.sort_order ?? 0,
          image_path: item.image_path
        })
        .select("id, name")
        .single();

      if (itemErr) {
        console.warn(`  ⚠️ Failed to insert item "${item.name}":`, itemErr.message);
      } else {
        insertedItems.push({ ...item, id: newItem.id });
      }
    }
  }
  console.log(`✓ ${insertedItems.length} menu items configured.`);

  // 3. Provision Active Table QR Code
  console.log(`📱 Generating Active Table QR Code...`);
  const slug = slugify(restaurantData.name).slice(0, 10);
  const token = `vns-${slug}-${crypto.randomUUID().slice(0, 8)}`;

  const { data: existingQr } = await supabase
    .from("qr_codes")
    .select("id, token")
    .eq("place_id", placeId)
    .eq("active", true)
    .limit(1);

  let qrToken = token;
  if (existingQr && existingQr.length > 0) {
    qrToken = existingQr[0].token;
    console.log(`ℹ️ Existing active QR code found (Token: ${qrToken})`);
  } else {
    const { error: qrErr } = await supabase.from("qr_codes").insert({
      place_id: placeId,
      token,
      table_label: "Table 1 / Counter",
      active: true
    });
    if (qrErr) console.warn("  ⚠️ QR code insert warning:", qrErr.message);
    else console.log(`✓ Table QR Code activated (Token: ${token})`);
  }

  // 4. Provision Subscription Plan (upgrade auto-provisioned trial to active starter)
  console.log(`🎟️ Provisioning active starter subscription...`);
  const periodEnd = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
  const { data: updatedSub, error: subErr } = await supabase
    .from("subscriptions")
    .update({
      plan: "starter",
      status: "active",
      trial_reviews_left: 100,
      period_end: periodEnd,
      billing_interval: "year",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString()
    })
    .eq("place_id", placeId)
    .select();

  if (subErr || !updatedSub || updatedSub.length === 0) {
    const { error: insErr } = await supabase.from("subscriptions").insert({
      place_id: placeId,
      plan: "starter",
      status: "active",
      trial_reviews_left: 100,
      period_end: periodEnd,
      billing_interval: "year",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString()
    });
    if (insErr) console.warn("  ⚠️ Subscription insert warning:", insErr.message);
    else console.log(`✓ Subscription active with open review allowance.`);
  } else {
    console.log(`✓ Subscription upgraded to active starter with open review allowance.`);
  }

  return {
    placeId,
    name: restaurantData.name,
    area: restaurantData.area,
    city: restaurantData.city,
    itemsCount: insertedItems.length,
    qrToken,
    placeUrl: `/p/${placeId}`,
    qrUrl: `/q/${qrToken}`
  };
}
