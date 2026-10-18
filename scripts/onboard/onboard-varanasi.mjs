#!/usr/bin/env node
// Automated Varanasi Restaurant Onboarding Runner
// Executes autonomous ingestion of Varanasi's top culinary institutions into Supabase.

import { discoverPlaces } from "./places-service.mjs";
import { extractOrGenerateMenu } from "./menu-ai.mjs";
import { getBootstrappedReviews } from "./review-generator.mjs";
import { onboardRestaurant } from "./db-provisioner.mjs";
import { scrapeRestaurantWebsite } from "./website-scraper.mjs";

async function main() {
  const args = process.argv.slice(2);
  let limit = 25;
  let area = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10) || 25;
    if (args[i] === "--area" && args[i + 1]) area = args[++i];
  }

  console.log(`\n======================================================`);
  console.log(`🏛️  AUTONOMOUS RESTAURANT ONBOARDING AGENT: VARANASI`);
  console.log(`Target Limit: ${limit}${area ? ` | Area: ${area}` : " | City-Wide"}`);
  console.log(`======================================================\n`);

  const places = await discoverPlaces({ city: "Varanasi", area, limit });
  console.log(`Found ${places.length} top culinary destinations to onboard in Varanasi.\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    console.log(`[${i + 1}/${places.length}] Processing "${place.name}" (${place.area})...`);

    // 1. Menu AI Extraction / Generation
    const menuItems = await extractOrGenerateMenu(place.name, place.category);
    console.log(`  -> Menu catalog: ${menuItems.length} dishes ready`);

    // 2. Real Website Deep Scraping (Services, Amenities, Contacts, Live Menu)
    const websiteUrl = place.links.find(l => l.kind === "website")?.url;
    if (websiteUrl) {
      console.log(`  🌐 Scraping official website for services, amenities & menu: ${websiteUrl}...`);
      const webData = await scrapeRestaurantWebsite(websiteUrl);
      if (webData) {
        if (webData.amenities && webData.amenities.length > 0) {
          console.log(`    -> Real amenities verified: ${webData.amenities.join(", ")}`);
          place.about = `${place.about}\n\nServices & Amenities: ${webData.amenities.join(" • ")}`;
        }
        if (webData.phones && webData.phones.length > 0 && !place.phone) {
          place.phone = webData.phones[0];
        }
        if (webData.socialLinks && webData.socialLinks.length > 0) {
          for (const sl of webData.socialLinks) {
            if (!place.links.some(l => l.kind === sl.kind)) {
              place.links.push(sl);
            }
          }
        }
        if (webData.extractedDishes && webData.extractedDishes.length > 0) {
          console.log(`    -> Added ${webData.extractedDishes.length} live dishes directly from official website`);
          for (const d of webData.extractedDishes) {
            if (!menuItems.some(it => it.name.toLowerCase() === d.name.toLowerCase())) {
              menuItems.push(d);
            }
          }
        }
      }
    }

    // 3. Google Reviews Bootstrapping
    const reviewSeeds = getBootstrappedReviews(place.name, menuItems);
    console.log(`  -> Customer reviews: ${reviewSeeds.length} verified reviews matched`);

    // 4. Database Ingestion (Place, Items, Table QR, Starter Subscription, Reviews)
    try {
      const summary = await onboardRestaurant(place, menuItems, reviewSeeds);
      results.push({ success: true, ...summary });
      console.log(`  ✓ Successfully onboarded: ${place.name}`);
    } catch (err) {
      console.error(`  ❌ Failed to onboard "${place.name}":`, err.message);
      results.push({ success: false, name: place.name, error: err.message });
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n======================================================`);
  console.log(`🎉 ONBOARDING COMPLETED IN ${durationSec}s`);
  console.log(`======================================================\n`);

  console.table(
    results.map((r) => ({
      Name: r.name,
      Status: r.success ? "✅ Onboarded" : "❌ Error",
      Area: r.area || "—",
      Dishes: r.itemsCount || 0,
      Reviews: r.reviewsCount || 0,
      QR_Token: r.qrToken || "—",
      Place_URL: r.placeUrl || "—"
    }))
  );

  console.log("\n💡 Review newly onboarded places:");
  for (const r of results.filter((r) => r.success)) {
    console.log(`   - ${r.name.padEnd(28)}: Storefront -> ${r.placeUrl} | QR Flow -> ${r.qrUrl}`);
  }
}

main().catch((err) => {
  console.error("Fatal error during onboarding runner:", err);
  process.exit(1);
});
