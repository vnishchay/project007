-- Trusted Picks demo data, part 2: test logins and every newer feature (visitors, offers at the counter, customer groups
-- and tags, Hide me / Stop offers, notes to the owner, owner replies, NFC tags, Ready to rate, Google ratings, admin
-- daily stats and billing alerts), on a few restaurants, so each screen can be tested precisely.
--
-- DEMO ONLY. Nothing here is real, and the project rule "zero fake or seeded reviews" still holds for real shops:
--   * Every row belongs to a demo shop ("[Demo]" in About), a demo person (id de000000-..., {"demo": true}), or is listed
--     in public.demo_seed_rows / carries a "demo_" or "[Demo]" tag, so it can all be removed in one go.
--   * Best run on a test Supabase project. If you run it on the live one, remove it with supabase/demo_data_remove.sql
--     before real shops and diners arrive.
--
-- Order: run supabase/demo_data.sql first (shops, people, reviews), then this file. Safe to run again: it clears what it
-- made last time and builds it fresh (visits are relative to "now", so re-run it to get fresh "at the shop now" visits).
-- Fill in the three settings just below first. Never commit a real password into the repo.

set search_path = public, extensions;

drop table if exists tp_cfg;
create temp table tp_cfg (my_email text, test_password text, make_test_admin boolean);
insert into tp_cfg values (
  'you@example.com',  -- the email you sign in with: your account gets visits, offers and friends to test with
  '',                 -- a password for the test logins below. Leave '' and they are made without a password (no sign-in)
  false               -- true also makes test.admin@demo.trustedpicks.test, an admin login (only on a test project)
);

-- Stop early if part 1 hasn't run, or the database is behind this file.
do $demo$
declare need text[] := array['visits.remind_at','visitor_offers.used_at','nfc_tags.qr_code_id','shop_privacy.no_offers',
  'owner_notes.visit_id','reviews.owner_reply','places.google_rating','daily_counts.metric','billing_alerts.kind']; n text; missing text := '';
begin
  foreach n in array need loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = split_part(n, '.', 1) and column_name = split_part(n, '.', 2)) then
      missing := missing || ' ' || n;
    end if;
  end loop;
  if missing <> '' then
    raise exception 'Your database is behind this file (missing:%). Run supabase/update_existing_database.sql first, then run this file again.', missing;
  end if;
  if (select count(*) from public.places where about like '[Demo]%') < 10 then
    raise exception 'Run supabase/demo_data.sql first (the demo shops and people), then this file.';
  end if;
end
$demo$;

create or replace function pg_temp.did(o integer) returns uuid language sql immutable as $$
  select ('de000000-0000-4000-8000-' || lpad(o::text, 12, '0'))::uuid
$$;
create or replace function pg_temp.h(t text) returns bigint language sql immutable as $$ select abs(hashtext(t)::bigint) $$;

-- Rows this file adds to shared tables (visits, the test reviews, daily totals) are listed here so they can be removed.
create table if not exists public.demo_seed_rows (tbl text not null, row_key text not null, primary key (tbl, row_key));
alter table public.demo_seed_rows enable row level security;
revoke all on public.demo_seed_rows from anon, authenticated;

drop table if exists tp_pl;
create temp table tp_pl as
select distinct on (name) id, name, city, kind from public.places where about like '[Demo]%' order by name, created_at, id;

-- =====================================================================================
-- Test logins: Test Customer (901), Test Owner (902) and, if asked for, Test Admin (903).
-- They are demo people too ({"demo": true}), so removing the demo people removes them.
-- =====================================================================================
do $demo$
declare
  c tp_cfg; a record; uid uuid; pw text; enc text; k integer; vals text[]; cols text; lits text;
  want text[] := array['id','instance_id','aud','role','email','encrypted_password','email_confirmed_at','raw_app_meta_data','raw_user_meta_data',
                       'created_at','updated_at','is_anonymous','confirmation_token','recovery_token','email_change_token_new','email_change'];
begin
  select * into c from tp_cfg;
  pw := nullif(btrim(coalesce(c.test_password, '')), '');
  if pw is not null and length(pw) < 8 then raise exception 'Use a test password of at least 8 characters.'; end if;
  if not coalesce(c.make_test_admin, false) then delete from auth.users where id = pg_temp.did(903); end if;

  for a in select * from (values
      (901, 'test.customer@demo.trustedpicks.test', 'Test Customer', 'user', 'demo:person:w:30'),
      (902, 'test.owner@demo.trustedpicks.test', 'Test Owner', 'business', 'demo:person:m:30'),
      (903, 'test.admin@demo.trustedpicks.test', 'Test Admin', 'admin', 'demo:person:w:31')) v (ord, email, name, role, avatar)
  loop
    continue when a.ord = 903 and not coalesce(c.make_test_admin, false);
    uid := pg_temp.did(a.ord);
    enc := case when pw is null then '' else extensions.crypt(pw, extensions.gen_salt('bf')) end;
    if not exists (select 1 from auth.users where id = uid) then
      vals := array[uid::text, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', a.email, enc, now()::text,
                    '{"provider":"email","providers":["email"]}', jsonb_build_object('demo', true, 'full_name', a.name)::text,
                    (now() - interval '40 days')::text, now()::text, 'false', '', '', '', ''];
      cols := ''; lits := '';
      for k in 1..array_length(want, 1) loop
        if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = want[k]) then
          cols := cols || case when cols = '' then '' else ', ' end || quote_ident(want[k]);
          lits := lits || case when lits = '' then '' else ', ' end || quote_nullable(vals[k]);
        end if;
      end loop;
      execute format('insert into auth.users (%s) values (%s)', cols, lits);
    else
      update auth.users set encrypted_password = enc, email_confirmed_at = coalesce(email_confirmed_at, now()) where id = uid;
    end if;

    -- An email identity, so the password sign-in works.
    if pw is not null and to_regclass('auth.identities') is not null and not exists (select 1 from auth.identities where user_id = uid) then
      cols := 'user_id, identity_data, provider, last_sign_in_at, created_at, updated_at';
      lits := format('%L::uuid, %L::jsonb, %L, now(), now(), now()', uid, jsonb_build_object('sub', uid::text, 'email', a.email, 'email_verified', true), 'email');
      if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
        cols := cols || ', provider_id'; lits := lits || format(', %L', uid::text);
      end if;
      if (select data_type from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name = 'id') = 'text' then
        cols := cols || ', id'; lits := lits || format(', %L', uid::text);
      end if;
      execute format('insert into auth.identities (%s) values (%s)', cols, lits);
    end if;

    insert into public.profiles (id, display_name, avatar_path, city, role, invite_code, created_at)
    values (uid, a.name, a.avatar, 'Pune', a.role::public.app_role, 'de' || lpad(to_hex(a.ord), 8, '0'), now() - interval '40 days')
    on conflict (id) do update set display_name = excluded.display_name, avatar_path = excluded.avatar_path, city = excluded.city,
                                   role = excluded.role, invite_code = excluded.invite_code;
  end loop;
end
$demo$;

-- =====================================================================================
-- Contacts on demo shops can never reach anyone: phone and WhatsApp numbers become +91 00000 xxxxx (no Indian number
-- starts with 0), every outside link points at example.com and emails at a .example address. This also fixes shops
-- made by older copies of demo_data.sql, which used real-looking numbers and real Instagram, Zomato and Swiggy links.
-- =====================================================================================
create or replace function pg_temp.fake_phone(seed text) returns text language sql immutable as $$
  select '+9100000' || lpad((abs(hashtext('phone' || seed)::bigint) % 100000)::text, 5, '0')
$$;
create or replace function pg_temp.safe_url(u text, seed text) returns text language sql immutable as $$
  select case
    when u ~* '^tel:' then 'tel:' || pg_temp.fake_phone(seed)
    when u ~* '^mailto:' then case when u ~* '\.example$' then u else 'mailto:hello@' || regexp_replace(lower(seed), '[^a-z0-9]', '', 'g') || '.example' end
    when u ~* '^https?://(www\.)?(wa\.me|api\.whatsapp\.com|whatsapp\.com)' or u ~* '^https?://example\.com/wa/' then 'https://example.com/wa/' || ltrim(pg_temp.fake_phone(seed), '+')
    when u ~* '^https?://(www\.)?(example\.com|google\.com/maps)' then u
    when u ~* '^https?://' then regexp_replace(u, '^https?://(www\.)?([^./]+)[^/]*', 'https://example.com/\2', 'i')
    else u end
$$;
update public.places p set links = (
  select coalesce(jsonb_agg(case when jsonb_typeof(l -> 'url') = 'string' then jsonb_set(l, '{url}', to_jsonb(pg_temp.safe_url(l ->> 'url', p.name))) else l end
                            order by o), '[]'::jsonb)
  from jsonb_array_elements(p.links) with ordinality as x (l, o))
where p.about like '[Demo]%' and jsonb_typeof(p.links) = 'array' and jsonb_array_length(p.links) > 0;
update public.places set contact_phone = pg_temp.fake_phone(name) where about like '[Demo]%' and contact_phone is not null;
update public.listing_requests set phone = pg_temp.fake_phone(business_name) where note like '[Demo]%';
update public.place_claims set phone = pg_temp.fake_phone(user_id::text || place_id::text) where user_id::text like 'de000000-%' and phone is not null;
do $demo$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listing_requests' and column_name = 'links') then
    execute $q$update public.listing_requests r set links = (
      select coalesce(jsonb_agg(case when jsonb_typeof(l -> 'url') = 'string' then jsonb_set(l, '{url}', to_jsonb(pg_temp.safe_url(l ->> 'url', r.business_name))) else l end
                                order by o), '[]'::jsonb)
      from jsonb_array_elements(r.links) with ordinality as x (l, o))
    where r.note like '[Demo]%' and jsonb_typeof(r.links) = 'array' and jsonb_array_length(r.links) > 0$q$;
  end if;
end $demo$;

-- Your real account(s): the admin account(s) and the email above. They get visits, offers and friends, never reviews.
drop table if exists tp_real;
create temp table tp_real as
select p.id from public.profiles p
where p.id::text not like 'de000000-%'
  and (p.role = 'admin' or exists (select 1 from auth.users u, tp_cfg c where u.id = p.id and lower(u.email) = lower(btrim(c.my_email))));

-- Everyone who tests as a diner.
drop table if exists tp_subj;
create temp table tp_subj as
select id from tp_real union select id from public.profiles where id in (pg_temp.did(901), pg_temp.did(903));

-- Test Owner runs Burger Barn (Pro plan: everything open) and Kaapi Corner (Starter plan: notes and insights locked).
update public.places p set owner_id = pg_temp.did(902)
from tp_pl l where l.id = p.id and l.name in ('Burger Barn', 'Kaapi Corner');
update public.subscriptions s set plan = 'starter', status = 'active', period_end = greatest(coalesce(s.period_end, now()), now() + interval '200 days')
from tp_pl l where l.id = s.place_id and l.name = 'Kaapi Corner';
update public.subscriptions s set plan = 'pro', status = 'active', period_end = greatest(coalesce(s.period_end, now()), now() + interval '300 days')
from tp_pl l where l.id = s.place_id and l.name = 'Burger Barn';

-- Friends: Test Customer has 14 demo friends and is friends with your account(s), so "Your friends liked" has data both ways.
insert into public.friendships (user_id, friend_id, via)
select x.a, x.b, 'invite' from (
  select pg_temp.did(901) as a, pg_temp.did(g) as b from generate_series(1, 14) g
  union all select pg_temp.did(g), pg_temp.did(901) from generate_series(1, 14) g
  union all select pg_temp.did(901), r.id from tp_real r
  union all select r.id, pg_temp.did(901) from tp_real r
) x where exists (select 1 from public.profiles where id = x.a) and exists (select 1 from public.profiles where id = x.b)
on conflict do nothing;

-- The shops that get visitors, offers, notes and NFC: the ones you and Test Owner run, plus two that you visit as a diner.
drop table if exists tp_vshop;
create temp table tp_vshop as
select l.id, l.name, l.city, l.kind, p.owner_id from tp_pl l join public.places p on p.id = l.id
where p.owner_id in (select id from tp_real union select pg_temp.did(902))
   or l.name in ('Hyderabad Biryani House', 'Forno Napoli');

-- =====================================================================================
-- Clear what the last run made.
-- =====================================================================================
delete from public.reviews where id in (select row_key::uuid from public.demo_seed_rows where tbl = 'reviews');
delete from public.visits where id in (select row_key::uuid from public.demo_seed_rows where tbl = 'visits');
delete from public.demo_seed_rows where tbl in ('reviews', 'visits');
delete from public.visitor_offers where place_id in (select id from tp_pl);
delete from public.shop_privacy where place_id in (select id from tp_pl);
delete from public.owner_notes where place_id in (select id from tp_pl);
delete from public.nfc_tags where qr_code_id in (select id from public.qr_codes where place_id in (select id from tp_pl));
delete from public.place_rechecks where note like '[Demo]%';
delete from public.billing_alerts where provider_order_id like 'demo_order_%';
do $demo$ begin
  if to_regclass('public.customer_tags') is not null then
    execute 'delete from public.customer_tags where place_id in (select id from tp_pl)';
  end if;
end $demo$;

-- =====================================================================================
-- Visitors: at each shop above, 20 people in set patterns, so every customer group has people in it.
--   regulars (3+ visits in 60 days), new this week, haven't been back (30+ days), at the shop right now, guests, one-offs.
-- =====================================================================================
drop table if exists tp_vpat;
create temp table tp_vpat (slot integer primary key, grp text, days integer[]);
insert into tp_vpat values
  (1, 'regular', '{2,9,17,30}'), (2, 'regular', '{1,6,13,24,41}'), (3, 'regular', '{4,11,25}'), (4, 'regular', '{0,8,20,33}'),
  (5, 'new', '{1}'), (6, 'new', '{3}'), (7, 'new', '{5}'), (8, 'new', '{2}'),
  (9, 'lapsed', '{38,52}'), (10, 'lapsed', '{45}'), (11, 'lapsed', '{61,74}'), (12, 'lapsed', '{33,40,58}'),
  (13, 'here', '{0}'), (14, 'here', '{0}'),
  (15, 'guest', '{0}'), (16, 'guest', '{6}'), (17, 'guest', '{12}'),
  (18, 'once', '{15}'), (19, 'once', '{22}'), (20, 'once', '{27}');

-- Who fills each slot: named people from the shop's city, those who never visited it first (so "new" really is new).
drop table if exists tp_vpeople;
create temp table tp_vpeople as
with named as (
  select s.id as place_id, s.name, t.id as user_id,
         row_number() over (partition by s.id order by exists (select 1 from public.visits v where v.user_id = t.id and v.place_id = s.id), md5(s.name || t.id::text)) as rk
  from tp_vshop s join public.profiles t on t.id::text like 'de000000-%' and t.role = 'user' and t.city = s.city and coalesce(t.display_name, '') <> ''
  where t.id not in (pg_temp.did(901), pg_temp.did(903))
), guests as (
  select s.id as place_id, s.name, t.id as user_id, row_number() over (partition by s.id order by md5(s.name || t.id::text)) as rk
  from tp_vshop s join public.profiles t on t.id::text like 'de000000-%' and t.role = 'user' and coalesce(t.display_name, '') = ''
)
select n.place_id, n.name, n.user_id, (array[5,6,7,8,9,10,11,12,13,14,1,2,3,4,18,19,20])[n.rk] as slot from named n where n.rk <= 17
union all
select g.place_id, g.name, g.user_id, 14 + g.rk::integer from guests g where g.rk <= 3;

-- NFC tag on each shop's first table code (Manage > QR shows the tag's link and key).
insert into public.nfc_tags (qr_code_id, key, last_counter, last_user, last_tap_at, created_at)
select q.id, decode(md5('demo-nfc' || q.id::text), 'hex'), 42,
       (select user_id from tp_vpeople vp where vp.place_id = s.id and vp.slot = 13), now() - interval '25 minutes', now() - interval '20 days'
from tp_vshop s
cross join lateral (select c.id from public.qr_codes c where c.place_id = s.id and c.active order by c.created_at, c.id limit 1) q
on conflict (qr_code_id) do nothing;

drop table if exists tp_newvis;
create temp table tp_newvis as
select md5('feat-v' || vp.place_id::text || vp.user_id::text || d.n::text)::uuid as id, vp.user_id, vp.place_id, vp.slot, d.day,
       case when d.day = 0 then now() - make_interval(mins => 12 + (vp.slot * 7) % 50)
            else now() - make_interval(days => d.day, hours => 1 + (pg_temp.h(vp.user_id::text || d.n::text) % 9)::integer) end as scanned_at,
       (vp.slot in (4, 13) and d.day = 0) as tapped
from tp_vpeople vp join tp_vpat p on p.slot = vp.slot
cross join lateral unnest(p.days) with ordinality as d (day, n);

insert into public.visits (id, user_id, place_id, qr_code_id, scanned_at, expires_at, source, near, tapped)
select v.id, v.user_id, v.place_id,
       case when v.tapped then (select n.qr_code_id from public.nfc_tags n join public.qr_codes c on c.id = n.qr_code_id where c.place_id = v.place_id limit 1)
            else (select c.id from public.qr_codes c where c.place_id = v.place_id and c.active order by md5(c.id::text || v.id::text) limit 1) end,
       v.scanned_at, v.scanned_at + interval '6 hours', 'qr', v.slot <> 10, v.tapped
from tp_newvis v
on conflict (id) do nothing;
insert into public.demo_seed_rows (tbl, row_key) select 'visits', id::text from tp_newvis on conflict do nothing;

-- =====================================================================================
-- You as a diner: open visits (Ready to rate, offers at the counter), past visits, and privacy choices.
-- Shops you run yourself are skipped.
-- =====================================================================================
drop table if exists tp_svis;
create temp table tp_svis (shop text, ago_min integer, tbl text);
insert into tp_svis values
  ('Hyderabad Biryani House', 25, 'Table 2'),   -- open now: Ready to rate, offer at the counter
  ('Forno Napoli', 130, 'Table 3'),             -- open now too
  ('Burger Barn', 3 * 1440, null), ('Burger Barn', 12 * 1440, null), ('Burger Barn', 26 * 1440, null),  -- a regular at Test Owner's shop
  ('Kaapi Corner', 5 * 1440, null),             -- new this week at Test Owner's other shop
  ('Masala Library', 9 * 1440, null), ('Masala Library', 40 * 1440, null),
  ('Brew Society', 20 * 1440, null),            -- you stopped offers here
  ('Pasta Fresca', 15 * 1440, null);            -- you hid yourself here

drop table if exists tp_snew;
create temp table tp_snew as
select md5('feat-s' || u.id::text || s.shop || s.ago_min::text)::uuid as id, u.id as user_id, l.id as place_id, s.shop, s.ago_min,
       now() - make_interval(mins => s.ago_min) as scanned_at,
       coalesce((select c.id from public.qr_codes c where c.place_id = l.id and c.active and c.table_label = s.tbl limit 1),
                (select c.id from public.qr_codes c where c.place_id = l.id and c.active order by md5(c.id::text || u.id::text) limit 1)) as qr
from tp_subj u cross join tp_svis s join tp_pl l on l.name = s.shop join public.places p on p.id = l.id
where p.owner_id is distinct from u.id;

insert into public.visits (id, user_id, place_id, qr_code_id, scanned_at, expires_at, source, near)
select id, user_id, place_id, qr, scanned_at, scanned_at + interval '6 hours', 'qr', true from tp_snew
on conflict (id) do nothing;
insert into public.demo_seed_rows (tbl, row_key) select 'visits', id::text from tp_snew on conflict do nothing;

insert into public.shop_privacy (user_id, place_id, hidden, no_offers, updated_at)
select distinct n.user_id, n.place_id, n.shop = 'Pasta Fresca', n.shop = 'Brew Society', now() - interval '10 days'
from tp_snew n where n.shop in ('Brew Society', 'Pasta Fresca')
on conflict (user_id, place_id) do update set hidden = excluded.hidden, no_offers = excluded.no_offers;

-- Some demo visitors hid themselves (slot 7) or stopped offers (slot 3) at each shop.
insert into public.shop_privacy (user_id, place_id, hidden, no_offers, updated_at)
select vp.user_id, vp.place_id, vp.slot = 7, vp.slot = 3, now() - interval '3 days'
from tp_vpeople vp where vp.slot in (3, 7)
on conflict (user_id, place_id) do update set hidden = excluded.hidden, no_offers = excluded.no_offers;

-- =====================================================================================
-- Offers: what owners sent to visitors (some used at the counter, some seen, some new), and offers waiting for you.
-- None of them mention reviews (the app refuses that, Google rules).
-- =====================================================================================
drop table if exists tp_otext;
create temp table tp_otext (n integer primary key, body text);
insert into tp_otext values
  (1, '10% off your next visit, Monday to Thursday. Show this at the counter.'),
  (2, 'Bring a friend this week and the second one gets 15% off.'),
  (3, 'Thanks for coming in! Something small is on the house next time, just show this.'),
  (4, 'Our festive specials are here. Ask for the tasting plate, the first one is free.');

insert into public.visitor_offers (place_id, user_id, body, link_url, sent_by, created_at, seen_at, used_at)
select vp.place_id, vp.user_id, t.body, null, s.owner_id, o.made,
       case when vp.slot in (1, 2, 5, 9, 12) then o.made + interval '2 hours' end,
       case when vp.slot in (1, 2) then o.made + interval '1 day' end
from tp_vpeople vp join tp_vshop s on s.id = vp.place_id
cross join lateral (select now() - make_interval(days => 2 + vp.slot % 5, hours => 3) as made) o
join tp_otext t on t.n = 1 + vp.slot % 4
where vp.slot in (1, 2, 4, 5, 6, 9, 12, 13);
-- Regular no. 1 used an older offer too.
insert into public.visitor_offers (place_id, user_id, body, link_url, sent_by, created_at, seen_at, used_at)
select vp.place_id, vp.user_id, (select body from tp_otext where n = 4), null, s.owner_id,
       now() - interval '20 days', now() - interval '20 days' + interval '1 hour', now() - interval '18 days'
from tp_vpeople vp join tp_vshop s on s.id = vp.place_id where vp.slot = 1;

insert into public.visitor_offers (place_id, user_id, body, link_url, sent_by, created_at, seen_at, used_at)
select l.id, u.id, v.body, v.link, p.owner_id, now() - make_interval(mins => v.ago_min),
       case when v.seen then now() - make_interval(mins => v.ago_min - 30) end,
       case when v.used then now() - make_interval(mins => v.ago_min - 60) end
from tp_subj u
cross join (values
  ('Hyderabad Biryani House', 20, 'Today only: a free cup of Irani chai with any biryani. Show this at the counter.', null, false, false),
  ('Forno Napoli', 2 * 1440, 'Tuesday pizza club: the second Margherita is half price, dine-in only.', null, true, false),
  ('Burger Barn', 4 * 1440, 'Free loaded fries with any two burgers this week.', null, true, true),
  ('Kaapi Corner', 6 * 1440, 'Cold filter coffee is back for summer. Your first glass is on us.', 'https://example.com/instagram/kaapicorner', true, false),
  ('Brew Society', 25 * 1440, 'Brunch for two at 599 this weekend.', null, true, false)) v (shop, ago_min, body, link, seen, used)
join tp_pl l on l.name = v.shop join public.places p on p.id = l.id
where p.owner_id is distinct from u.id;

-- =====================================================================================
-- Customer tags (Manage > Visitors), only if this database has them (migration 48).
-- =====================================================================================
do $demo$ begin
  if to_regclass('public.customer_tags') is not null then
    execute $q$
      insert into public.customer_tags (place_id, label, color, created_at)
      select s.id, t.label, t.color, now() - make_interval(days => 30 - t.n)
      from tp_vshop s
      cross join (values (1, 'VIP', 'amber'), (2, 'Family', 'green'), (3, 'Office lunch', 'sky'), (4, 'Birthday month', 'coral'), (5, 'Weekend crowd', 'violet')) t (n, label, color)
      where s.owner_id in (select id from tp_real) or s.owner_id = pg_temp.did(902)
      on conflict do nothing$q$;
    execute $q$
      insert into public.customer_tag_links (tag_id, user_id, place_id, created_at)
      select t.id, vp.user_id, vp.place_id, now() - interval '5 days'
      from tp_vpeople vp
      join (values (1, 'VIP'), (2, 'VIP'), (2, 'Family'), (4, 'Office lunch'), (5, 'Weekend crowd'), (9, 'Family'), (13, 'Birthday month')) m (slot, label) on m.slot = vp.slot
      join public.customer_tags t on t.place_id = vp.place_id and t.label = m.label
      on conflict do nothing$q$;
    execute $q$
      insert into public.customer_tag_links (tag_id, user_id, place_id, created_at)
      select t.id, u.id, t.place_id, now() - interval '2 days'
      from tp_subj u join tp_pl l on l.name = 'Burger Barn' join public.customer_tags t on t.place_id = l.id and t.label = 'VIP'
      on conflict do nothing$q$;
  end if;
end $demo$;

-- =====================================================================================
-- Notes to the owner (Manage > Messages): unread, read, replied, with and without a dish or a phone number.
-- Kaapi Corner is on Starter, so its notes show locked there (plan gating).
-- =====================================================================================
insert into public.owner_notes (place_id, item_id, body, contact, created_at, read_at, replied_at, visit_id)
select s.id,
       case when n.with_item then (select i.id from public.items i where i.place_id = s.id and not i.is_hidden order by i.sort_order, i.id limit 1) end,
       n.body, n.contact, now() - make_interval(mins => n.ago_min),
       case when n.state <> 'unread' then now() - make_interval(mins => n.ago_min - 60) end,
       case when n.state = 'replied' then now() - make_interval(mins => n.ago_min - 120) end,
       (select v.id from public.visits v join tp_vpeople vp on vp.user_id = v.user_id and vp.place_id = v.place_id
         where v.place_id = s.id and vp.slot = n.slot order by v.scanned_at desc limit 1)
from tp_vshop s
cross join (values
  (1, true,  'It was a bit too salty tonight, otherwise a lovely evening. Thank you!', null, 'unread', 90, 4),
  (2, false, 'Please add a vegan option, we would come every week.', null, 'read', 3 * 1440, 6),
  (3, false, 'Can I book the back room for 12 people next Saturday? Please call me.', '+91 00000 43210', 'replied', 6 * 1440, 2),
  (4, false, 'The music was a little loud near the window tables.', null, 'unread', 1440, 13)) n (k, with_item, body, contact, state, ago_min, slot);

-- =====================================================================================
-- Owner replies on reviews at these shops (about 4 in 10), worded by how the review went.
-- =====================================================================================
alter table public.reviews disable trigger reviews_check_visit;
alter table public.reviews disable trigger reviews_touch;
update public.reviews r set
  owner_reply = case when r.rating >= 4 then format('Thank you so much! So glad you enjoyed the %s. See you again soon.', i.name)
                     when r.rating = 3 then format('Thanks for telling us. We are working on the %s and hope to get it just right next time.', i.name)
                     else 'Sorry we let you down. We have shared this with the team. Please ask for the manager on your next visit.' end,
  owner_reply_at = least(now(), r.created_at + make_interval(hours => 2 + (pg_temp.h('reply' || r.id::text) % 48)::integer))
from public.items i, tp_vshop s
where i.id = r.item_id and r.place_id = s.id and r.status = 'published' and r.user_id::text like 'de000000-%'
  and pg_temp.h('reply' || r.id::text) % 100 < 40;

-- Test Customer's own reviews (one named, one anonymous, one older), so My reviews, owner replies and friends' picks show.
alter table public.reviews disable trigger reviews_check_allowed;
drop table if exists tp_trev;
create temp table tp_trev as
select md5('feat-r' || v.id::text)::uuid as id, v.user_id, v.place_id, v.id as visit_id, x.rating, x.pub, x.tpl, x.reply, v.scanned_at,
       (select i.id from public.items i where i.place_id = v.place_id and not i.is_hidden order by i.sort_order, i.id limit 1) as item_id
from public.visits v
join tp_pl l on l.id = v.place_id
join (values ('Kaapi Corner', 5, true, 'The %s was spot on, hot and fresh. Coffee was strong, exactly how I like it.', null),
             ('Burger Barn', 3, false, 'The %s was good but the fries came out cold. Service was quick though.',
              'Sorry about the fries! We have changed how we time them. Thanks for coming back so often.'),
             ('Masala Library', 4, true, 'Lovely %s and a calm room. A little slow on a busy night.', null)) x (shop, rating, pub, tpl, reply) on x.shop = l.name
where v.user_id = pg_temp.did(901)
  and v.id in (select row_key::uuid from public.demo_seed_rows where tbl = 'visits')
  and v.scanned_at = (select min(w.scanned_at) from public.visits w where w.user_id = v.user_id and w.place_id = v.place_id and w.scanned_at > now() - interval '30 days');

insert into public.reviews (id, user_id, place_id, item_id, rating, body, visit_id, is_public, by_guest, created_at, updated_at, owner_reply, owner_reply_at)
select t.id, t.user_id, t.place_id, t.item_id, t.rating, format(t.tpl, i.name), t.visit_id, t.pub, false,
       t.scanned_at + interval '40 minutes', t.scanned_at + interval '40 minutes', t.reply, case when t.reply is not null then t.scanned_at + interval '1 day' end
from tp_trev t join public.items i on i.id = t.item_id
on conflict (id) do nothing;
insert into public.demo_seed_rows (tbl, row_key) select 'reviews', id::text from tp_trev on conflict do nothing;
insert into public.review_tags (review_id, tag_id)
select t.id, (select tg.id from public.tags tg where (tg.kinds is null or 'food' = any(tg.kinds))
              and tg.label <> all(array['Too pricey','Slow service','Crowded','Small portion','Not fresh','Served cold','Too oily','Rude staff','Not clean','Long wait'])
              order by tg.label limit 1)
from tp_trev t where t.rating >= 4
on conflict do nothing;
alter table public.reviews enable trigger reviews_check_allowed;
alter table public.reviews enable trigger reviews_check_visit;
alter table public.reviews enable trigger reviews_touch;

-- =====================================================================================
-- Shop details and admin screens.
-- =====================================================================================
-- Google rating and count on every demo shop (the second ranking signal).
update public.places p set google_rating = round((3.6 + (pg_temp.h('g' || p.name) % 13) / 10.0)::numeric, 1),
                           google_rating_count = 40 + (pg_temp.h('gc' || p.name) % 2400)::integer,
                           google_synced_at = now() - make_interval(days => (pg_temp.h('gs' || p.name) % 20)::integer)
where p.about like '[Demo]%';

-- One table code switched off at Masala Library (Manage > QR shows it paused).
update public.qr_codes c set active = false
from tp_pl l where l.id = c.place_id and l.name = 'Masala Library' and c.table_label = 'Table 7';

-- Admin > Stats: daily totals for the last 30 days (not today, so real counts are never mixed in).
delete from public.daily_counts d using public.demo_seed_rows s where s.tbl = 'daily_counts' and s.row_key = d.day::text || '|' || d.metric;
delete from public.demo_seed_rows where tbl = 'daily_counts';
with gen as (
  select current_date - g as day, m.metric,
         greatest(0, round(m.base * (1 + (30 - g) / 30.0) * (0.7 + (pg_temp.h(m.metric || g::text) % 60) / 100.0)))::integer as n
  from generate_series(1, 30) g
  cross join (values ('view_home', 60), ('view_place', 140), ('view_best', 25), ('view_qr', 35), ('view_business', 8), ('view_pricing', 5),
                     ('review_started', 18), ('install_prompt', 6), ('installed', 2), ('share', 4)) m (metric, base)
), ins as (
  insert into public.daily_counts (day, metric, n)
  select day, metric, n from gen
  on conflict (day, metric) do nothing
  returning day, metric
)
insert into public.demo_seed_rows (tbl, row_key) select 'daily_counts', day::text || '|' || metric from ins on conflict do nothing;

-- Admin AI spend for the last 14 days.
delete from public.ai_usage_total a using public.demo_seed_rows s where s.tbl = 'ai_usage_total' and s.row_key = a.day::text;
delete from public.demo_seed_rows where tbl = 'ai_usage_total';
with ins as (
  insert into public.ai_usage_total (day, credits)
  select current_date - g, 20 + (pg_temp.h('ai' || g::text) % 60)::integer from generate_series(1, 14) g
  on conflict (day) do nothing
  returning day
)
insert into public.demo_seed_rows (tbl, row_key) select 'ai_usage_total', day::text from ins on conflict do nothing;

-- Admin > Billing: payment alerts, two open and one resolved.
insert into public.billing_alerts (kind, place_id, provider_order_id, provider_payment_id, amount_minor, expected_minor, created_at, resolved_at)
select v.kind, l.id, v.o, v.p, v.amt, v.exp, now() - make_interval(days => v.d), case when v.res then now() - make_interval(days => v.d - 1) end
from (values ('amount_mismatch', 'Burger Barn', 'demo_order_001', 'demo_pay_001', 149900, 299900, 2, false),
             ('second_payment', 'Masala Library', 'demo_order_002', 'demo_pay_002', 299900, 299900, 5, false),
             ('unknown_order', null, 'demo_order_003', 'demo_pay_003', 99900, null, 12, true)) v (kind, shop, o, p, amt, exp, d, res)
left join tp_pl l on l.name = v.shop;

-- Admin: owners asking for their shop details to be checked again.
insert into public.place_rechecks (place_id, requested_by, note, created_at)
select l.id, pg_temp.did(v.u), v.note, now() - make_interval(days => v.d)
from (values ('Tandoor Tales', 161, '[Demo] Our opening hours changed to 12 pm to 11 pm, please check again.', 1),
             ('Chaat Street', 165, '[Demo] We moved two shops down the road, the pin is wrong now.', 4)) v (shop, u, note, d)
join tp_pl l on l.name = v.shop
where exists (select 1 from public.profiles where id = pg_temp.did(v.u));

-- Who is an expert, who tastes alike: refresh with the new reviews.
do $demo$ begin perform public.refresh_trust_tables(); exception when others then raise notice 'trust tables not refreshed: %', sqlerrm; end $demo$;

-- =====================================================================================
-- What you got, and where to try it. (App paths: add them to your app address.)
-- =====================================================================================
select * from (
  select 1 as n, 'Test logins' as what,
         case when (select nullif(btrim(test_password), '') from tp_cfg) is null then 'Made WITHOUT a password (no sign-in). Set test_password at the top and run again.'
              else 'test.customer@ / test.owner@' || case when (select make_test_admin from tp_cfg) then ' / test.admin@' else '' end || 'demo.trustedpicks.test, with the password you set' end as detail
  union all
  select 2, 'Your account(s) as diner', (select count(*) from tp_real)::text || ' account(s): open visits (Home > Ready to rate), offers, privacy list in Profile'
  union all
  select 3, 'Scan as a diner: Hyderabad Biryani House', '/q/' || (select c.token from public.qr_codes c join tp_pl l on l.id = c.place_id where l.name = 'Hyderabad Biryani House' and c.active order by c.table_label limit 1)
  union all
  select 4, 'Scan as a diner: Burger Barn (Test Owner''s shop)', '/q/' || (select c.token from public.qr_codes c join tp_pl l on l.id = c.place_id where l.name = 'Burger Barn' and c.active order by c.table_label limit 1)
  union all
  select 5, 'Shops with visitors, offers, notes, NFC', (select string_agg(name || ' (' || coalesce((select display_name from public.profiles where id = owner_id), '?') || ')', ', ' order by name) from tp_vshop)
  union all
  select 6, 'Visits / offers / notes made', (select count(*) from tp_newvis)::text || ' visitor visits, ' || (select count(*) from tp_snew)::text || ' of your visits, '
         || (select count(*) from public.visitor_offers where place_id in (select id from tp_pl))::text || ' offers, '
         || (select count(*) from public.owner_notes where place_id in (select id from tp_pl))::text || ' notes, '
         || (select count(*) from public.reviews where owner_reply is not null and place_id in (select id from tp_pl))::text || ' owner replies'
  union all
  select 7, 'Remove all demo data', 'Run supabase/demo_data_remove.sql'
) x order by n;
