// Master Clean Platform Script
// 1. Purges all 2,991 synthetic/test reviews & visits across all businesses
// 2. Wipes all items and menus to leave clean, raw business profiles
// 3. Removes all 52 mock Pune/Mumbai/Delhi places + 5 local test places (total 57 test places)
// 4. Retains ONLY the 35 real, verified, authentic scraped Varanasi businesses
// 5. Purges all 193 demo accounts (de000000%) while preserving real registered users

import { supabase } from "./db-provisioner.mjs";

const REAL_SCRAPED_VARANASI_PLACES = new Set([
  'The Great Kabab Factory', 'Brown Bread Bakery', 'Kashi Chat Bhandar', 'Pehlwan Lassi',
  'Pizzeria Vaatika Cafe', 'Baati Chokha Restaurant', 'Pind Balluchi', 'Kwality Wall\'s Ice Cream And More',
  'Pizza Hut', 'The Biryani Life', 'Ganesh Chat Bhandar', 'Domino\'s Pizza', 'La Pino\'z Pizza',
  'The Good Bowl', 'The Belgian Waffle Co.', 'Barbeque Nation', 'Sweet Truth - Cake and Desserts',
  'New Krishna Bhojnalaya', 'Rahil Restaurant', 'Subway', 'Baskin Robbins - Ice Cream Desserts',
  'Bangs Restaurant', 'Keventers - Milkshakes & Waffles', 'Burger King', 'Tandoor Villa', 'KFC',
  'Shahi Daya Restaurant', 'McDonald\'s', 'Deena Chaat Bhandar', 'The Biryani Mahal Banaras',
  'FIDKA', 'Capsicum Food Court - Since 2007', 'Blue Lassi Shop', 'Ram Bhandar', 'Aman Restaurant & Rooftop'
]);

async function cleanPlatform() {
  console.log("🧹 Starting complete platform cleanup...");

  // 1. Delete review reports & secondary relation data
  console.log("1. Cleaning review reports, user topic stats, and saved places...");
  const { error: repErr } = await supabase.from('review_reports').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (repErr) console.warn("  review_reports delete error:", repErr.message);

  const { error: statErr } = await supabase.from('user_topic_stats').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');
  if (statErr) console.warn("  user_topic_stats delete error:", statErr.message);

  const { error: savedErr } = await supabase.from('saved_places').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');
  if (savedErr) console.warn("  saved_places delete error:", savedErr.message);

  const { error: claimsErr } = await supabase.from('place_claims').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (claimsErr) console.warn("  place_claims delete error:", claimsErr.message);

  // 2. Delete all reviews
  console.log("2. Deleting ALL reviews (leaving zero test reviews)...");
  const { error: revErr } = await supabase.from('reviews').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (revErr) console.error("  reviews delete error:", revErr.message);
  else console.log("  ✅ All reviews purged.");

  // 3. Delete all visits
  console.log("3. Deleting ALL visits...");
  const { error: visErr } = await supabase.from('visits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (visErr) console.error("  visits delete error:", visErr.message);
  else console.log("  ✅ All visits purged.");

  // 4. Delete all items/menus
  console.log("4. Deleting ALL items & menus (leaving clean, raw business profiles)...");
  const { error: itemErr } = await supabase.from('items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (itemErr) console.error("  items delete error:", itemErr.message);
  else console.log("  ✅ All items purged.");

  // 5. Delete all test/mock places
  console.log("5. Purging test & mock businesses...");
  const { data: allPlaces } = await supabase.from('places').select('id, name');
  const placesToDelete = (allPlaces || []).filter(p => !REAL_SCRAPED_VARANASI_PLACES.has(p.name));
  console.log(`  Found ${placesToDelete.length} test businesses to delete.`);
  
  for (const p of placesToDelete) {
    const { error: delErr } = await supabase.from('places').delete().eq('id', p.id);
    if (delErr) console.error(`  Error deleting place ${p.name}:`, delErr.message);
  }
  console.log("  ✅ Test businesses deleted.");

  // 6. Delete all demo users (de000000-...)
  console.log("6. Purging demo user accounts (de000000%)...");
  const { data: allUsers } = await supabase.from('profiles').select('id, display_name');
  const demoUsers = (allUsers || []).filter(u => u.id.startsWith('de000000'));
  console.log(`  Found ${demoUsers.length} demo accounts to delete.`);

  for (const u of demoUsers) {
    const { error: delUserErr } = await supabase.from('profiles').delete().eq('id', u.id);
    if (delUserErr) console.error(`  Error deleting user ${u.id}:`, delUserErr.message);
  }
  console.log("  ✅ Demo users deleted.");

  // 7. Verify final database state
  console.log("\n📊 VERIFYING FINAL DATABASE STATE:");
  const { data: finalPlaces } = await supabase.from('places').select('id, name, city');
  const { count: finalReviews } = await supabase.from('reviews').select('*', { count: 'exact', head: true });
  const { count: finalItems } = await supabase.from('items').select('*', { count: 'exact', head: true });
  const { count: finalVisits } = await supabase.from('visits').select('*', { count: 'exact', head: true });
  const { data: finalProfiles } = await supabase.from('profiles').select('id, display_name, role');

  console.log({
    realVaranasiPlacesRemaining: finalPlaces?.length,
    reviewsRemaining: finalReviews,
    itemsRemaining: finalItems,
    visitsRemaining: finalVisits,
    realUsersRemaining: finalProfiles?.length,
    userList: finalProfiles?.map(u => `${u.display_name} (${u.role})`)
  });
  console.log("🎉 Complete platform cleanup finished successfully!");
}

cleanPlatform().catch(console.error);
