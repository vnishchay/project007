-- Trusted Picks: remove ALL demo data (from supabase/demo_data.sql and supabase/demo_data_features.sql).
-- Removes only demo rows: shops with "[Demo]" in About, people with ids de000000-... or {"demo": true} (the test logins
-- included), and rows listed in public.demo_seed_rows or tagged "demo_" / "[Demo]". Real shops, people and reviews stay.
-- Your real accounts' demo visits, offers and friendships go with the demo shops and people they point at.
-- Safe to run more than once.

set search_path = public, extensions;

-- Daily totals and AI spend this file's partner added (only those rows, never real counts).
do $demo$ begin
  if to_regclass('public.demo_seed_rows') is not null then
    delete from public.daily_counts d using public.demo_seed_rows s where s.tbl = 'daily_counts' and s.row_key = d.day::text || '|' || d.metric;
    delete from public.ai_usage_total a using public.demo_seed_rows s where s.tbl = 'ai_usage_total' and s.row_key = a.day::text;
    delete from public.reviews r using public.demo_seed_rows s where s.tbl = 'reviews' and s.row_key = r.id::text;
    delete from public.visits v using public.demo_seed_rows s where s.tbl = 'visits' and s.row_key = v.id::text;
  end if;
end $demo$;

delete from public.billing_alerts where provider_order_id like 'demo_order_%'
   or place_id in (select id from public.places where about like '[Demo]%');
delete from public.place_rechecks where note like '[Demo]%';
delete from public.payments where provider = 'demo' or place_id in (select id from public.places where about like '[Demo]%');
delete from public.billing_orders where provider_order_id like 'order_demo_%' or place_id in (select id from public.places where about like '[Demo]%');

-- Listing requests first (they point at people and shops), then the shops (their menus, QR codes, NFC tags, plans,
-- payments, reviews, visits, offers, notes, tags and news go with them), then the people.
delete from public.listing_requests where note like '[Demo]%';
delete from public.items where description = '[Demo item]';
delete from public.places where about like '[Demo]%';
delete from public.listing_requests where requester_id in (select id from public.profiles where id::text like 'de000000-%');
delete from auth.users where raw_user_meta_data ->> 'demo' = 'true' or id::text like 'de000000-%';
delete from public.profiles where id::text like 'de000000-%';

-- Older copies of the demo file stored fake Google ids such as "demo-forno-napoli".
update public.places set google_place_id = null where google_place_id like 'demo-%';

drop table if exists public.demo_seed_rows;

-- Per-dish scores and trust tables, rebuilt without the demo reviews.
delete from public.item_stats s where not exists (select 1 from public.reviews r where r.item_id = s.item_id and r.status = 'published');
do $demo$ begin perform public.refresh_trust_tables(); exception when others then raise notice 'trust tables not refreshed: %', sqlerrm; end $demo$;

-- What is left (all should be 0).
select (select count(*) from public.places where about like '[Demo]%') as demo_shops,
       (select count(*) from public.profiles where id::text like 'de000000-%') as demo_people,
       (select count(*) from auth.users where raw_user_meta_data ->> 'demo' = 'true') as demo_logins,
       (select count(*) from public.listing_requests where note like '[Demo]%') as demo_requests,
       (select count(*) from public.billing_alerts where provider_order_id like 'demo_order_%') as demo_alerts;
