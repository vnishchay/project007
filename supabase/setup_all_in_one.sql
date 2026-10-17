-- Trusted Picks: the whole database in one file.
-- Paste into Supabase > SQL Editor > New query, then Run. Run it once on a fresh project.

-- ===== 20261016000001_schema.sql =====
-- Trusted Picks: core schema for Supabase (Postgres 15+).
-- Matches the "Database and Data Sources" doc. Users live in Supabase Auth
-- (auth.users); public.profiles holds the app's own fields for each user.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- Types ----------
create type public.app_role       as enum ('user', 'business', 'admin');
create type public.follow_source  as enum ('contacts', 'in_app', 'suggested');
create type public.place_status   as enum ('live', 'lapsed', 'removed');
create type public.review_status  as enum ('published', 'hidden');
create type public.qr_style       as enum ('neon', 'aurora', 'matrix', 'paper');
create type public.request_status as enum ('pending', 'paid', 'approved', 'declined');
create type public.payment_kind   as enum ('listing', 'qr');
create type public.payment_status as enum ('pending', 'paid', 'refunded');

-- ---------- People ----------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '',
  avatar_path   text,                         -- path in the "avatars" bucket
  city          text,
  phone_hash    text unique,                  -- sha256 of E.164 phone, for contact matching only
  role          public.app_role not null default 'user',
  created_at    timestamptz not null default now()
);

create table public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  followee_id  uuid not null references public.profiles (id) on delete cascade,
  source       public.follow_source not null default 'in_app',
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

-- ---------- Places and what's rated there ----------
create table public.places (
  id               uuid primary key default gen_random_uuid(),
  google_place_id  text unique,               -- the only Google field we may store long term
  name             text not null,
  category         text not null,
  area             text,
  city             text not null,
  about            text,
  location         extensions.geography(point, 4326),  -- set by the business or admin, not copied from Google
  hours            jsonb,                     -- hours given by the business
  price_level      smallint check (price_level between 1 and 4),
  status           public.place_status not null default 'live',
  listed_until     date,
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now()
);
create index places_location_idx on public.places using gist (location);
create index places_city_idx on public.places (city, status);
create index places_name_trgm_idx on public.places using gin (name extensions.gin_trgm_ops);

create table public.topics (
  id         bigint generated always as identity primary key,
  name       text not null unique,            -- "Pizza", "Filter coffee", "Haircut"
  parent_id  bigint references public.topics (id)
);

create table public.items (
  id               uuid primary key default gen_random_uuid(),
  place_id         uuid not null references public.places (id) on delete cascade,
  topic_id         bigint references public.topics (id),
  name             text not null,
  name_normalized  text generated always as (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored,
  created_at       timestamptz not null default now(),
  unique (place_id, name_normalized)
);
create index items_topic_idx on public.items (topic_id);
create index items_name_trgm_idx on public.items using gin (name_normalized extensions.gin_trgm_ops);

-- ---------- QR codes and visits ----------
create table public.qr_codes (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places (id) on delete cascade,
  token        text not null unique default encode(extensions.gen_random_bytes(8), 'hex'),
  style        public.qr_style not null default 'neon',
  table_label  text,                          -- "Table 6"
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.visits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  qr_code_id  uuid references public.qr_codes (id) on delete set null,
  scanned_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '6 hours'
);
create index visits_user_place_idx on public.visits (user_id, place_id, expires_at desc);

-- ---------- Reviews ----------
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  item_id     uuid not null references public.items (id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  body        text not null default '' check (length(body) <= 2000),
  voice_path  text,                           -- only if the user opted in to keep audio
  ai_drafted  boolean not null default false,
  visit_id    uuid references public.visits (id) on delete set null,  -- set = verified visit
  status      public.review_status not null default 'published',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index reviews_place_idx on public.reviews (place_id, status);
create index reviews_item_idx on public.reviews (item_id);
create index reviews_user_idx on public.reviews (user_id, created_at desc);

create table public.tags (
  id     bigint generated always as identity primary key,
  label  text not null unique                -- "Authentic", "Worth the price"
);

create table public.review_tags (
  review_id  uuid not null references public.reviews (id) on delete cascade,
  tag_id     bigint not null references public.tags (id) on delete cascade,
  primary key (review_id, tag_id)
);

create table public.google_shares (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.reviews (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  opened_at  timestamptz not null default now()
);

create table public.saved_places (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, place_id)
);

-- ---------- Business side ----------
create table public.app_settings (
  key    text primary key,
  value  jsonb not null
);

create table public.listing_requests (
  id               uuid primary key default gen_random_uuid(),
  requester_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  business_name    text not null,
  category         text not null,
  area             text,
  city             text not null,
  phone            text not null,
  google_place_id  text,
  note             text,
  wants_qr         boolean not null default false,
  qr_style         public.qr_style,
  amount_inr       integer not null default 0,   -- filled from app_settings by trigger
  status           public.request_status not null default 'pending',
  decided_by       uuid references public.profiles (id),
  decided_at       timestamptz,
  place_id         uuid references public.places (id),
  created_at       timestamptz not null default now()
);
create index listing_requests_status_idx on public.listing_requests (status, created_at desc);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid references public.listing_requests (id) on delete set null,
  place_id      uuid references public.places (id) on delete set null,
  kind          public.payment_kind not null,
  amount_inr    integer not null,
  provider      text not null default 'manual',   -- 'manual' until Razorpay is added
  provider_ref  text,
  status        public.payment_status not null default 'paid',
  paid_at       timestamptz default now(),
  period_start  date,                              -- listing payments only
  period_end    date,
  created_at    timestamptz not null default now(),
  check (request_id is not null or place_id is not null)
);

-- ---------- Computed tables ----------
create table public.item_stats (
  item_id         uuid primary key references public.items (id) on delete cascade,
  place_id        uuid not null references public.places (id) on delete cascade,
  avg_rating      numeric(3,2) not null,
  review_count    integer not null,
  verified_count  integer not null
);
create index item_stats_place_idx on public.item_stats (place_id, avg_rating desc);

create table public.user_topic_stats (
  user_id             uuid not null references public.profiles (id) on delete cascade,
  topic_id            bigint not null references public.topics (id) on delete cascade,
  review_count        integer not null,
  followers_trusting  integer not null,
  is_expert           boolean not null default false,   -- top 5% in the city for the topic
  primary key (user_id, topic_id)
);

create table public.taste_match (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  other_user_id  uuid not null references public.profiles (id) on delete cascade,
  topic_id       bigint not null references public.topics (id) on delete cascade,
  match_pct      smallint not null,
  shared_items   integer not null,
  primary key (user_id, other_user_id, topic_id)
);

-- ===== 20261016000002_functions.sql =====
-- Trusted Picks: helper functions, triggers and the RPCs the app calls.
-- Functions marked "security definer" run with the owner's rights so they can
-- do things a plain user can't (create a visit, attach it to a review), but each
-- one checks auth.uid() itself.

-- ---------- Helpers ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.setting_int(k text, fallback integer)
returns integer language sql stable set search_path = public as $$
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = k), fallback);
$$;

-- A profile row for every new Supabase Auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, phone_hash)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''),
    case when new.phone is not null and new.phone <> ''
         then encode(extensions.digest('+' || ltrim(new.phone, '+'), 'sha256'), 'hex') end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change someone's role.
create or replace function public.guard_profile_role()
returns trigger language plpgsql set search_path = public as $$
begin
  -- auth.uid() is null for the SQL editor and the service key, which are trusted.
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'only admins can change roles';
  end if;
  return new;
end $$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- Requests always start pending, with the price taken from settings.
create or replace function public.prepare_listing_request()
returns trigger language plpgsql set search_path = public as $$
begin
  new.requester_id := auth.uid();
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.place_id := null;
  new.amount_inr := public.setting_int('listing_price_inr', 199)
                  + case when new.wants_qr then public.setting_int('qr_price_inr', 399) else 0 end;
  return new;
end $$;

create trigger listing_requests_prepare
  before insert on public.listing_requests
  for each row execute function public.prepare_listing_request();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

-- A review may only carry a visit that belongs to the same user and place
-- and was still open when the review was written.
create or replace function public.check_review_visit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visit_id is not null and not exists (
    select 1 from public.visits v
    where v.id = new.visit_id and v.user_id = new.user_id and v.place_id = new.place_id
      and new.created_at between v.scanned_at and v.expires_at
  ) then
    raise exception 'visit does not match this review';
  end if;
  if tg_op = 'UPDATE' and new.visit_id is distinct from old.visit_id and not public.is_admin() then
    raise exception 'visit cannot be changed';
  end if;
  return new;
end $$;

create trigger reviews_check_visit before insert or update on public.reviews
  for each row execute function public.check_review_visit();

-- Keep item_stats current on every review change.
create or replace function public.refresh_item_stats(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.item_stats where item_id = p_item;
  insert into public.item_stats (item_id, place_id, avg_rating, review_count, verified_count)
  select r.item_id, r.place_id, round(avg(r.rating), 2), count(*), count(r.visit_id)
  from public.reviews r
  where r.item_id = p_item and r.status = 'published'
  group by r.item_id, r.place_id;
end $$;

create or replace function public.reviews_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.refresh_item_stats(new.item_id); end if;
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.item_id <> new.item_id) then
    perform public.refresh_item_stats(old.item_id);
  end if;
  return null;
end $$;

create trigger reviews_stats after insert or update or delete on public.reviews
  for each row execute function public.reviews_after_change();

-- ---------- RPCs the app calls ----------

-- Scan a table QR: returns the place and opens a 6-hour verified-visit window.
create or replace function public.scan_qr(p_token text)
returns table (visit_id uuid, place_id uuid, place_name text, area text, table_label text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare q record; v public.visits;
begin
  if auth.uid() is null then raise exception 'sign in to scan'; end if;
  select qc.id, qc.place_id, qc.table_label, p.name, p.area into q
  from public.qr_codes qc join public.places p on p.id = qc.place_id
  where qc.token = p_token and qc.active and p.status = 'live';
  if not found then raise exception 'unknown or inactive code'; end if;

  insert into public.visits (user_id, place_id, qr_code_id, expires_at)
  values (auth.uid(), q.place_id, q.id,
          now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
  returning * into v;

  return query select v.id, q.place_id, q.name, q.area, q.table_label, v.expires_at;
end $$;

-- Look up a QR without signing in (to show the place before login).
create or replace function public.peek_qr(p_token text)
returns table (place_id uuid, place_name text, area text, table_label text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, qc.table_label
  from public.qr_codes qc join public.places p on p.id = qc.place_id
  where qc.token = p_token and qc.active and p.status = 'live';
$$;

-- Save a review. Creates the item the first time it's rated, attaches the
-- user's open visit for this place (if any), and sets tags.
create or replace function public.submit_review(
  p_place_id uuid, p_item_name text, p_rating smallint, p_body text default '',
  p_topic_id bigint default null, p_tag_ids bigint[] default '{}',
  p_ai_drafted boolean default false, p_voice_path text default null)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare it public.items; v_visit uuid; r public.reviews;
begin
  if auth.uid() is null then raise exception 'sign in to review'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  if btrim(coalesce(p_item_name, '')) = '' then raise exception 'say what you had'; end if;

  insert into public.items (place_id, topic_id, name)
  values (p_place_id, p_topic_id, btrim(p_item_name))
  on conflict (place_id, name_normalized) do update
    set topic_id = coalesce(public.items.topic_id, excluded.topic_id)
  returning * into it;

  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, voice_path, visit_id)
  values (auth.uid(), p_place_id, it.id, p_rating, coalesce(p_body, ''), p_ai_drafted, p_voice_path, v_visit)
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t from unnest(coalesce(p_tag_ids, '{}')) t
  on conflict do nothing;

  return r;
end $$;

-- Find friends from the phone's contacts. The app sends sha256 hashes of
-- E.164 numbers; raw numbers never leave the phone.
create or replace function public.match_contacts(p_hashes text[])
returns table (id uuid, display_name text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path from public.profiles p
  where p.phone_hash = any (p_hashes[1:2000]) and p.id <> auth.uid();
$$;

-- "Best X near me": places ranked by the viewer's trust score.
-- score = (sum w*r + k*avg) / (sum w + k)
-- w = rel (3 followed, 1.5 expert, else 1) * ver (1.5 verified) * 0.5^(age_days/180)
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20)
returns table (
  place_id uuid, name text, category text, area text, price_level smallint, google_place_id text,
  distance_m integer, trust_score numeric, review_count integer, verified_count integer,
  friend_count integer, friend_ids uuid[], top_item text)
language sql stable security definer set search_path = public, extensions as $$
  with me as (select auth.uid() as uid),
  q as (select nullif(lower(btrim(p_query)), '') as txt),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  cand as (
    select p.*, case when here.pt is not null and p.location is not null
                     then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here
    where p.status = 'live'
      and (p_city is null or p.city ilike p_city)
      and (here.pt is null or p.location is null or st_dwithin(p.location, here.pt, p_radius_m))),
  matched as (
    select r.*, i.name as item_name
    from public.reviews r
    join public.items i on i.id = r.item_id
    left join public.topics t on t.id = i.topic_id
    join cand c on c.id = r.place_id, q
    where r.status = 'published'
      and (q.txt is null or i.name_normalized like '%' || q.txt || '%'
           or lower(t.name) like '%' || q.txt || '%' or lower(c.name) like '%' || q.txt || '%'
           or lower(c.category) like '%' || q.txt || '%')),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from matched),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name,
      (case when f.follower_id is not null then 3.0
            when uts.is_expert then 1.5 else 1.0 end)
      * (case when m.visit_id is not null then 1.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      f.follower_id is not null as is_friend
    from matched m
    cross join me
    left join public.follows f on f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.items i on i.id = m.item_id
    left join public.user_topic_stats uts on uts.user_id = m.user_id and uts.topic_id = i.topic_id),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv,
      count(distinct w.user_id) filter (where w.is_friend)::integer as nf,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w group by w.place_id)
  select c.id, c.name, c.category, c.area, c.price_level, c.google_place_id, c.dist,
         s.score, coalesce(s.n, 0), coalesce(s.nv, 0), coalesce(s.nf, 0), coalesce(s.fids, '{}'), s.top_item
  from cand c left join scored s on s.place_id = c.id, q
  where s.place_id is not null or q.txt is null
     or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
  order by s.score desc nulls last, c.dist asc nulls last
  limit least(p_limit, 50);
$$;

-- Counts shown on the Circle screen.
create or replace function public.my_circle_stats()
returns table (reviews integer, followers integer, following integer, verified integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.reviews where user_id = auth.uid())::integer,
    (select count(*) from public.follows where followee_id = auth.uid())::integer,
    (select count(*) from public.follows where follower_id = auth.uid())::integer,
    (select count(*) from public.reviews where user_id = auth.uid() and visit_id is not null)::integer;
$$;

-- ---------- Admin RPCs ----------

create or replace function public.mark_request_paid(p_request uuid, p_provider_ref text default null)
returns public.listing_requests
language plpgsql security definer set search_path = public as $$
declare lr public.listing_requests;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.listing_requests set status = 'paid'
  where id = p_request and status = 'pending' returning * into lr;
  if not found then raise exception 'request is not pending'; end if;

  insert into public.payments (request_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (lr.id, 'listing', public.setting_int('listing_price_inr', 199), 'manual', p_provider_ref,
          current_date, current_date + interval '1 year');
  if lr.wants_qr then
    insert into public.payments (request_id, kind, amount_inr, provider, provider_ref)
    values (lr.id, 'qr', public.setting_int('qr_price_inr', 399), 'manual', p_provider_ref);
  end if;
  return lr;
end $$;

-- Approving creates the place, its QR code (if bought), and links payments.
create or replace function public.approve_listing(
  p_request uuid, p_lat double precision default null, p_lng double precision default null,
  p_table_labels text[] default '{}')
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare lr public.listing_requests; pl public.places; lbl text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into lr from public.listing_requests where id = p_request for update;
  if not found or lr.status not in ('pending', 'paid') then raise exception 'request cannot be approved'; end if;

  insert into public.places (google_place_id, name, category, area, city, location, status, listed_until, created_by)
  values (nullif(lr.google_place_id, ''), lr.business_name, lr.category, lr.area, lr.city,
          case when p_lat is not null and p_lng is not null
               then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
          'live', current_date + interval '1 year', auth.uid())
  on conflict (google_place_id) do update
    set status = 'live', listed_until = excluded.listed_until
  returning * into pl;

  if lr.wants_qr then
    if coalesce(array_length(p_table_labels, 1), 0) = 0 then
      insert into public.qr_codes (place_id, style) values (pl.id, coalesce(lr.qr_style, 'neon'));
    else
      foreach lbl in array p_table_labels loop
        insert into public.qr_codes (place_id, style, table_label) values (pl.id, coalesce(lr.qr_style, 'neon'), lbl);
      end loop;
    end if;
  end if;

  update public.payments set place_id = pl.id where request_id = lr.id;
  update public.listing_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), place_id = pl.id
    where id = lr.id;
  return pl;
end $$;

create or replace function public.decline_listing(p_request uuid)
returns public.listing_requests
language plpgsql security definer set search_path = public as $$
declare lr public.listing_requests;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.listing_requests
    set status = 'declined', decided_by = auth.uid(), decided_at = now()
    where id = p_request and status in ('pending', 'paid') returning * into lr;
  if not found then raise exception 'request cannot be declined'; end if;
  return lr;
end $$;

create or replace function public.admin_summary()
returns table (to_review integer, live_places integer, collected_inr integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.listing_requests where status in ('pending', 'paid'))::integer,
    (select count(*) from public.places where status = 'live')::integer,
    (select coalesce(sum(amount_inr), 0) from public.payments where status = 'paid')::integer
  where public.is_admin();
$$;

-- ---------- Nightly jobs ----------

-- Lapse listings whose year is up.
create or replace function public.lapse_expired_listings()
returns integer language sql security definer set search_path = public as $$
  with u as (
    update public.places set status = 'lapsed'
    where status = 'live' and listed_until is not null and listed_until < current_date
    returning 1)
  select count(*)::integer from u;
$$;

-- Rebuild user_topic_stats and taste_match from reviews.
create or replace function public.refresh_trust_tables()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_topic_stats;
  insert into public.user_topic_stats (user_id, topic_id, review_count, followers_trusting, is_expert)
  with counts as (
    select r.user_id, i.topic_id, count(*)::integer as n
    from public.reviews r join public.items i on i.id = r.item_id
    where r.status = 'published' and i.topic_id is not null
    group by r.user_id, i.topic_id),
  trusting as (
    select c.user_id, c.topic_id, count(distinct f.follower_id)::integer as ft
    from counts c
    join public.follows f on f.followee_id = c.user_id
    join public.reviews r2 on r2.user_id = f.follower_id and r2.status = 'published'
    join public.items i2 on i2.id = r2.item_id and i2.topic_id = c.topic_id
    group by c.user_id, c.topic_id)
  select c.user_id, c.topic_id, c.n, coalesce(t.ft, 0),
         c.n >= 5 and percent_rank() over (partition by c.topic_id order by c.n) >= 0.95
  from counts c left join trusting t using (user_id, topic_id);

  delete from public.taste_match;
  insert into public.taste_match (user_id, other_user_id, topic_id, match_pct, shared_items)
  with latest as (
    select distinct on (r.user_id, r.item_id) r.user_id, r.item_id, i.topic_id, r.rating
    from public.reviews r join public.items i on i.id = r.item_id
    where r.status = 'published' and i.topic_id is not null
    order by r.user_id, r.item_id, r.created_at desc)
  select a.user_id, b.user_id, a.topic_id,
         round(100 * (1 - avg(abs(a.rating - b.rating)) / 4.0))::smallint, count(*)::integer
  from latest a join latest b on a.item_id = b.item_id and a.user_id <> b.user_id
  group by a.user_id, b.user_id, a.topic_id
  having count(*) >= 3;
end $$;

-- Only signed-in users call RPCs; the nightly jobs are for the scheduler only.
revoke execute on function public.refresh_trust_tables() from public, anon, authenticated;
revoke execute on function public.lapse_expired_listings() from public, anon, authenticated;
revoke execute on function public.refresh_item_stats(uuid) from public, anon, authenticated;

-- ===== 20261016000003_security.sql =====
-- Trusted Picks: row-level security. Every table is locked by default;
-- these policies open exactly what each screen needs.
-- "authenticated" = any signed-in user; is_admin() = profiles.role = 'admin'.

alter table public.profiles          enable row level security;
alter table public.follows           enable row level security;
alter table public.places            enable row level security;
alter table public.topics            enable row level security;
alter table public.items             enable row level security;
alter table public.qr_codes          enable row level security;
alter table public.visits            enable row level security;
alter table public.reviews           enable row level security;
alter table public.tags              enable row level security;
alter table public.review_tags       enable row level security;
alter table public.google_shares     enable row level security;
alter table public.saved_places      enable row level security;
alter table public.app_settings      enable row level security;
alter table public.listing_requests  enable row level security;
alter table public.payments          enable row level security;
alter table public.item_stats        enable row level security;
alter table public.user_topic_stats  enable row level security;
alter table public.taste_match       enable row level security;

-- profiles: names and avatars are public; you edit only your own.
create policy "profiles readable" on public.profiles for select using (true);
create policy "edit own profile"  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
-- Column grants: phone_hash is never readable, and only these fields are editable.
-- (Select columns by name from the app; "select *" on profiles is refused.)
revoke select, update on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_path, city, role, created_at) on public.profiles to anon, authenticated;
grant update (display_name, avatar_path, city, role) on public.profiles to authenticated;

-- follows: anyone signed in sees the graph; you add or remove your own follows.
create policy "follows readable" on public.follows for select to authenticated using (true);
create policy "follow"   on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "unfollow" on public.follows for delete to authenticated using (follower_id = auth.uid());

-- places: everyone sees live listings; only admins create or change them.
create policy "live places readable" on public.places for select using (status = 'live' or public.is_admin());
create policy "admins manage places" on public.places for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- topics, tags, settings: readable by all, managed by admins.
create policy "topics readable" on public.topics for select using (true);
create policy "admins manage topics" on public.topics for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "tags readable" on public.tags for select using (true);
create policy "admins manage tags" on public.tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "settings readable" on public.app_settings for select using (true);
create policy "admins manage settings" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- items: readable by all; created through submit_review(); admins can tidy them.
create policy "items readable" on public.items for select using (true);
create policy "admins manage items" on public.items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- qr_codes: tokens stay private; the public resolves them through peek_qr()/scan_qr().
create policy "admins manage qr" on public.qr_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- visits: you see your own; created only by scan_qr().
create policy "own visits" on public.visits for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- reviews: published ones are public; you edit or delete your own.
-- New reviews go through submit_review() so items, visits and tags stay consistent.
create policy "published reviews readable" on public.reviews for select
  using (status = 'published' or user_id = auth.uid() or public.is_admin());
create policy "edit own review" on public.reviews for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "delete own review" on public.reviews for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- Users may change only the words, stars and voice note; admins hide reviews via status.
revoke update on public.reviews from authenticated;
grant update (rating, body, voice_path, status) on public.reviews to authenticated;
create or replace function public.guard_review_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null and not public.is_admin() then
    raise exception 'only admins can hide or restore reviews';
  end if;
  return new;
end $$;
create trigger reviews_guard_status before update on public.reviews
  for each row execute function public.guard_review_status();

create policy "review tags readable" on public.review_tags for select using (true);
create policy "tag own review" on public.review_tags for insert to authenticated
  with check (exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid()));
create policy "untag own review" on public.review_tags for delete to authenticated
  using (exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid()));

-- google_shares: log your own "Copy and open Google" taps.
create policy "log own share" on public.google_shares for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid()));
create policy "own shares readable" on public.google_shares for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- saved_places: private bookmarks.
create policy "own saved places" on public.saved_places for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- listing_requests: anyone signed in can ask; you see your own; admins decide.
create policy "request listing" on public.listing_requests for insert to authenticated
  with check (requester_id = auth.uid());
create policy "own requests readable" on public.listing_requests for select to authenticated
  using (requester_id = auth.uid() or public.is_admin());
create policy "admins update requests" on public.listing_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- payments: admins see all; a business sees payments for its own requests.
create policy "payments readable" on public.payments for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.listing_requests lr where lr.id = request_id and lr.requester_id = auth.uid()));
create policy "admins manage payments" on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- computed tables: read-only for everyone; written by triggers and nightly jobs.
create policy "item stats readable" on public.item_stats for select using (true);
create policy "topic stats readable" on public.user_topic_stats for select using (true);
create policy "taste match readable" on public.taste_match for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ===== 20261016000004_storage_cron_seed.sql =====
-- Trusted Picks: storage buckets, the nightly schedule, and starter data.

-- ---------- Storage (Supabase Storage) ----------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('voice', 'voice', false), ('qr-prints', 'qr-prints', false)
on conflict (id) do nothing;

-- Files go under a folder named after the user's id: <uid>/<file>.
create policy "avatars readable" on storage.objects for select using (bucket_id = 'avatars');
create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own voice notes" on storage.objects for all to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admins manage qr prints" on storage.objects for all to authenticated
  using (bucket_id = 'qr-prints' and public.is_admin())
  with check (bucket_id = 'qr-prints' and public.is_admin());

-- ---------- Nightly jobs (pg_cron, free on Supabase) ----------
create extension if not exists pg_cron;
select cron.schedule('trusted-picks-nightly', '30 21 * * *',  -- 03:00 IST
  $$ select public.lapse_expired_listings(); select public.refresh_trust_tables(); $$);

-- ---------- Starter data ----------
insert into public.app_settings (key, value) values
  ('listing_price_inr', '199'),
  ('qr_price_inr', '399'),
  ('visit_window_hours', '6')
on conflict (key) do nothing;

insert into public.topics (name) values
  ('Pizza'), ('Pasta'), ('Burger'), ('Biryani'), ('Dosa'), ('Filter coffee'), ('Coffee'),
  ('Dessert'), ('Cocktails'), ('Haircut'), ('Spa'), ('Bakery')
on conflict (name) do nothing;

insert into public.tags (label) values
  ('Authentic'), ('Worth the price'), ('Generous portion'), ('Quick service'),
  ('Friendly staff'), ('Great for groups'), ('Too pricey'), ('Slow service')
on conflict (label) do nothing;

-- ===== 20261016000005_app_helpers.sql =====
-- Trusted Picks: small helpers the web app uses.

-- Read a place's coordinates as plain numbers (the column itself is binary).
create or replace function public.place_latlng(p_place uuid)
returns table (lat double precision, lng double precision)
language sql stable security definer set search_path = public, extensions as $$
  select st_y(location::geometry), st_x(location::geometry)
  from public.places where id = p_place and location is not null and (status = 'live' or public.is_admin());
$$;

-- Admins set a place's coordinates from numbers.
create or replace function public.set_place_location(p_place uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.places
    set location = case when p_lat is null or p_lng is null then null
                        else st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end
    where id = p_place;
end $$;

-- Extend a listing by a year from today or from its current end date, whichever is later.
create or replace function public.renew_listing(p_place uuid, p_provider_ref text default null)
returns public.places language plpgsql security definer set search_path = public as $$
declare pl public.places; start_d date;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into pl from public.places where id = p_place for update;
  if not found then raise exception 'place not found'; end if;
  start_d := greatest(current_date, coalesce(pl.listed_until, current_date));
  update public.places set listed_until = start_d + interval '1 year', status = 'live'
    where id = p_place returning * into pl;
  insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (p_place, 'listing', public.setting_int('listing_price_inr', 199), 'manual', p_provider_ref, start_d, start_d + interval '1 year');
  return pl;
end $$;

insert into public.app_settings (key, value) values
  ('upi_id', '""'), ('payee_name', '"Trusted Picks"'), ('support_phone', '""')
on conflict (key) do nothing;

-- ===== 20261016000006_existing_users.sql =====
-- Trusted Picks: support a Supabase project that already has users from other apps.
-- The on_auth_user_created trigger only covers new sign-ups, so give every
-- existing user a profile, and let the app create one on first sign-in if missing.

insert into public.profiles (id, display_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1), '')
from auth.users u
on conflict (id) do nothing;

create or replace function public.ensure_profile()
returns void language plpgsql security definer set search_path = public as $$
declare u auth.users;
begin
  if auth.uid() is null then return; end if;
  select * into u from auth.users where id = auth.uid();
  insert into public.profiles (id, display_name)
  values (u.id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1), ''))
  on conflict (id) do nothing;
end $$;

revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;

-- ===== 20261016000007_safe_signup.sql =====
-- Trusted Picks: never let profile creation block a sign-in.
-- If the profile insert fails for any reason (for example a user who already has
-- a row, or a project shared with other apps), sign-in still succeeds and the
-- app creates the profile on first load through ensure_profile().

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.profiles (id, display_name, phone_hash)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''),
      case when new.phone is not null and new.phone <> ''
           then encode(extensions.digest('+' || ltrim(new.phone, '+'), 'sha256'), 'hex') end
    )
    on conflict (id) do nothing;
  exception when others then
    raise warning 'trusted picks: profile for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $$;

-- ===== 20261016000008_features.sql =====
-- Trusted Picks: review photos, playable voice notes, phone numbers for contact
-- matching, suggested people, one trust-score formula for every screen, and
-- payments that record what the business was actually asked to pay.

-- ---------- Review photos ----------
alter table public.reviews add column if not exists photo_path text;
grant update (photo_path) on public.reviews to authenticated;

insert into storage.buckets (id, name, public)
values ('review-photos', 'review-photos', true)
on conflict (id) do nothing;

drop policy if exists "review photos readable" on storage.objects;
create policy "review photos readable" on storage.objects for select using (bucket_id = 'review-photos');
drop policy if exists "own review photos" on storage.objects;
create policy "own review photos" on storage.objects for all to authenticated
  using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Voice notes stay private until they are attached to a published review.
drop policy if exists "voice notes of published reviews" on storage.objects;
create policy "voice notes of published reviews" on storage.objects for select
  using (bucket_id = 'voice' and exists (
    select 1 from public.reviews r where r.voice_path = storage.objects.name and r.status = 'published'));

-- ---------- submit_review: photo, and a topic guessed when none is picked ----------
drop function if exists public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text);
create or replace function public.submit_review(
  p_place_id uuid, p_item_name text, p_rating smallint, p_body text default '',
  p_topic_id bigint default null, p_tag_ids bigint[] default '{}',
  p_ai_drafted boolean default false, p_voice_path text default null, p_photo_path text default null)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare it public.items; v_visit uuid; r public.reviews; v_topic bigint; v_name text;
begin
  if auth.uid() is null then raise exception 'sign in to review'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  v_name := btrim(coalesce(p_item_name, ''));
  if v_name = '' then raise exception 'say what you had'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'pick 1 to 5 stars'; end if;
  if p_voice_path is not null and split_part(p_voice_path, '/', 1) <> auth.uid()::text then raise exception 'bad voice note'; end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> auth.uid()::text then raise exception 'bad photo'; end if;

  -- Without a topic, guess one from the item name, then from the place's category.
  v_topic := coalesce(p_topic_id,
    (select t.id from public.topics t where lower(v_name) like '%' || lower(t.name) || '%' order by length(t.name) desc limit 1),
    (select t.id from public.topics t join public.places p on p.id = p_place_id
      where lower(p.category) like '%' || lower(t.name) || '%' order by length(t.name) desc limit 1));

  insert into public.items (place_id, topic_id, name)
  values (p_place_id, v_topic, v_name)
  on conflict (place_id, name_normalized) do update
    set topic_id = coalesce(public.items.topic_id, excluded.topic_id)
  returning * into it;

  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, voice_path, photo_path, visit_id)
  values (auth.uid(), p_place_id, it.id, p_rating, coalesce(p_body, ''), p_ai_drafted, p_voice_path, p_photo_path, v_visit)
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t from unnest(coalesce(p_tag_ids, '{}')) t
  on conflict do nothing;

  return r;
end $$;
revoke execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text) from public, anon;
grant execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text) to authenticated;

-- ---------- Phone number for contact matching ----------
-- Only a sha256 of the number is kept. Numbers without a country code are taken as Indian (+91).
create or replace function public.set_my_phone(p_phone text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare digits text; h text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if btrim(coalesce(p_phone, '')) = '' then
    update public.profiles set phone_hash = null where id = auth.uid();
    return false;
  end if;
  digits := regexp_replace(p_phone, '\D', '', 'g');
  if p_phone !~ '^\s*\+' then
    digits := regexp_replace(digits, '^0+', '');
    if length(digits) = 10 then digits := '91' || digits; end if;
  end if;
  if length(digits) < 8 or length(digits) > 15 then raise exception 'enter a full phone number'; end if;
  h := encode(digest('+' || digits, 'sha256'), 'hex');
  if exists (select 1 from public.profiles where phone_hash = h and id <> auth.uid()) then
    raise exception 'that number is already linked to another account';
  end if;
  update public.profiles set phone_hash = h where id = auth.uid();
  return true;
end $$;

create or replace function public.my_phone_is_set()
returns boolean language sql stable security definer set search_path = public as $$
  select phone_hash is not null from public.profiles where id = auth.uid();
$$;

revoke execute on function public.set_my_phone(text) from public, anon;
revoke execute on function public.my_phone_is_set() from public, anon;
revoke execute on function public.match_contacts(text[]) from public, anon;
grant execute on function public.set_my_phone(text) to authenticated;
grant execute on function public.my_phone_is_set() to authenticated;
grant execute on function public.match_contacts(text[]) to authenticated;

-- ---------- Suggested people: local experts and active reviewers you don't follow ----------
drop function if exists public.suggested_people(bigint, integer);
create or replace function public.suggested_people(p_topic bigint default null, p_limit integer default 10)
returns table (id uuid, display_name text, avatar_path text, city text, review_count integer, is_expert boolean, topic_name text)
language sql stable security definer set search_path = public as $$
  with mine as (select city from public.profiles where id = auth.uid()),
  cand as (
    select s.user_id, sum(s.review_count)::integer as n, bool_or(s.is_expert) as expert,
           (array_agg(t.name order by s.is_expert desc, s.review_count desc))[1] as topic_name
    from public.user_topic_stats s join public.topics t on t.id = s.topic_id
    where p_topic is null or s.topic_id = p_topic
    group by s.user_id
    union all
    select r.user_id, count(*)::integer, false, null
    from public.reviews r
    where r.status = 'published' and p_topic is null
      and not exists (select 1 from public.user_topic_stats s where s.user_id = r.user_id)
    group by r.user_id)
  select p.id, p.display_name, p.avatar_path, p.city, c.n, c.expert, c.topic_name
  from cand c join public.profiles p on p.id = c.user_id
  where p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id)
  order by c.expert desc, (p.city is not null and p.city ilike (select city from mine)) desc, c.n desc
  limit least(greatest(p_limit, 1), 30);
$$;
grant execute on function public.suggested_people(bigint, integer) to anon, authenticated;

-- ---------- One trust-score formula for Discover and the place page ----------
-- Adds p_area (match an area within the city), p_place (score one place), has_qr,
-- and in "near me" searches leaves out places with no map location.
drop function if exists public.search_places(text, double precision, double precision, integer, text, integer);
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null)
returns table (
  place_id uuid, name text, category text, area text, price_level smallint, google_place_id text,
  distance_m integer, trust_score numeric, review_count integer, verified_count integer,
  friend_count integer, friend_ids uuid[], top_item text, has_qr boolean)
language sql stable security definer set search_path = public, extensions as $$
  with me as (select auth.uid() as uid),
  q as (select nullif(lower(btrim(p_query)), '') as txt),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  cand as (
    select p.*, case when here.pt is not null and p.location is not null
                     then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or p.city ilike btrim(p_city))
      and (p_area is null or btrim(p_area) = '' or p.area ilike btrim(p_area))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, p_radius_m)))),
  matched as (
    select r.*, i.name as item_name
    from public.reviews r
    join public.items i on i.id = r.item_id
    left join public.topics t on t.id = i.topic_id
    join cand c on c.id = r.place_id, q
    where r.status = 'published'
      and (q.txt is null or i.name_normalized like '%' || q.txt || '%'
           or lower(t.name) like '%' || q.txt || '%' or lower(c.name) like '%' || q.txt || '%'
           or lower(c.category) like '%' || q.txt || '%')),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from matched),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name,
      (case when f.follower_id is not null then 3.0
            when uts.is_expert then 1.5 else 1.0 end)
      * (case when m.visit_id is not null then 1.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      f.follower_id is not null as is_friend
    from matched m
    cross join me
    left join public.follows f on f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.items i on i.id = m.item_id
    left join public.user_topic_stats uts on uts.user_id = m.user_id and uts.topic_id = i.topic_id),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv,
      count(distinct w.user_id) filter (where w.is_friend)::integer as nf,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w group by w.place_id)
  select c.id, c.name, c.category, c.area, c.price_level, c.google_place_id, c.dist,
         s.score, coalesce(s.n, 0), coalesce(s.nv, 0), coalesce(s.nf, 0), coalesce(s.fids, '{}'), s.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = c.id and qc.active)
  from cand c left join scored s on s.place_id = c.id, q
  where s.place_id is not null or q.txt is null
     or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
  order by s.score desc nulls last, c.dist asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid) to anon, authenticated;

-- ---------- Payments record the price quoted on the request ----------
alter table public.listing_requests add column if not exists listing_inr integer;
alter table public.listing_requests add column if not exists qr_inr integer;

create or replace function public.prepare_listing_request()
returns trigger language plpgsql set search_path = public as $$
begin
  new.requester_id := auth.uid();
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.place_id := null;
  new.listing_inr := public.setting_int('listing_price_inr', 199);
  new.qr_inr := case when new.wants_qr then public.setting_int('qr_price_inr', 399) else 0 end;
  new.amount_inr := new.listing_inr + new.qr_inr;
  return new;
end $$;

create or replace function public.mark_request_paid(p_request uuid, p_provider_ref text default null)
returns public.listing_requests
language plpgsql security definer set search_path = public as $$
declare lr public.listing_requests; v_qr integer; v_listing integer;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.listing_requests set status = 'paid'
  where id = p_request and status = 'pending' returning * into lr;
  if not found then raise exception 'request is not pending'; end if;

  -- Older requests have no split stored: take the QR part at today's price, the rest is the listing.
  v_qr := case when lr.wants_qr then coalesce(lr.qr_inr, least(lr.amount_inr, public.setting_int('qr_price_inr', 399))) else 0 end;
  v_listing := coalesce(lr.listing_inr, lr.amount_inr - v_qr);

  insert into public.payments (request_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (lr.id, 'listing', v_listing, 'manual', p_provider_ref, current_date, current_date + interval '1 year');
  if lr.wants_qr then
    insert into public.payments (request_id, kind, amount_inr, provider, provider_ref)
    values (lr.id, 'qr', v_qr, 'manual', p_provider_ref);
  end if;
  return lr;
end $$;

-- ---------- Demo places: no fake Google IDs ----------
-- Earlier demo data used ids like "demo-forno-napoli", which break Google links.
update public.places set google_place_id = null where google_place_id like 'demo-%';

-- ===== 20261016000009_privacy.sql =====
-- Trusted Picks: privacy by default.
--
-- * Every review is anonymous unless its author chooses "Show my name". Nobody else
--   can see who wrote an anonymous review: the reviews table is readable only by its
--   author and admins, and everyone else reads through the review_feed view, which
--   blanks out the author on anonymous reviews.
-- * "Your friends were here" only appears between people who have both synced
--   contacts and have each other's numbers, and only for reviews posted with a name.
-- * Visits stay private (only you see yours). Follower lists, contact links, phone
--   fingerprints and home city are never readable by other users.
-- * Uploaded photos and voice notes get random file names, so a link never reveals who
--   posted it.

-- ---------- Reviews: anonymous unless the author shows their name ----------
alter table public.reviews add column if not exists is_public boolean not null default false;
grant update (is_public) on public.reviews to authenticated;

drop policy if exists "published reviews readable" on public.reviews;
drop policy if exists "own reviews readable" on public.reviews;
create policy "own reviews readable" on public.reviews for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- What everyone else sees. Runs with the view owner's rights so it can blank out
-- authors; it shows only published reviews (plus your own).
drop view if exists public.review_feed;
create view public.review_feed with (security_barrier = true) as
  select r.id,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.user_id end as user_id,
         r.place_id, r.item_id, r.rating, r.body, r.ai_drafted,
         (r.visit_id is not null) as verified,
         r.photo_path,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.voice_path end as voice_path,
         r.status, r.is_public, r.created_at,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.display_name end as author_name,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.avatar_path end as author_avatar
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  where r.status = 'published' or r.user_id = auth.uid() or public.is_admin();
revoke all on public.review_feed from public, anon, authenticated;
grant select on public.review_feed to anon, authenticated;

-- ---------- Uploads: random names, ownership checked by the database ----------
update storage.buckets set public = true where id = 'review-photos';

drop policy if exists "own review photos" on storage.objects;
drop policy if exists "upload review photos" on storage.objects;
drop policy if exists "manage own review photos" on storage.objects;
drop policy if exists "delete own review photos" on storage.objects;
create policy "upload review photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-photos' and position('/' in name) = 0);
create policy "manage own review photos" on storage.objects for update to authenticated
  using (bucket_id = 'review-photos' and owner = auth.uid());
create policy "delete own review photos" on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos' and owner = auth.uid());

drop policy if exists "own voice notes" on storage.objects;
drop policy if exists "voice notes of published reviews" on storage.objects;
drop policy if exists "upload voice notes" on storage.objects;
drop policy if exists "read voice notes" on storage.objects;
drop policy if exists "delete own voice notes" on storage.objects;
create policy "upload voice notes" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and position('/' in name) = 0);
create policy "read voice notes" on storage.objects for select
  using (bucket_id = 'voice' and (owner = auth.uid() or exists (
    select 1 from public.reviews r
    where r.voice_path = storage.objects.name and r.status = 'published' and r.is_public)));
create policy "delete own voice notes" on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and owner = auth.uid());

-- ---------- submit_review: choose anonymous or named ----------
drop function if exists public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text);
create or replace function public.submit_review(
  p_place_id uuid, p_item_name text, p_rating smallint, p_body text default '',
  p_topic_id bigint default null, p_tag_ids bigint[] default '{}',
  p_ai_drafted boolean default false, p_voice_path text default null, p_photo_path text default null,
  p_is_public boolean default false)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare it public.items; v_visit uuid; r public.reviews; v_topic bigint; v_name text;
begin
  if auth.uid() is null then raise exception 'sign in to review'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  v_name := btrim(coalesce(p_item_name, ''));
  if v_name = '' then raise exception 'say what you had'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'pick 1 to 5 stars'; end if;
  if length(coalesce(p_body, '')) > 2000 then raise exception 'keep the review under 2000 characters'; end if;
  if p_photo_path is not null and not exists (
      select 1 from storage.objects o where o.bucket_id = 'review-photos' and o.name = p_photo_path and o.owner = auth.uid()) then
    raise exception 'photo upload not found';
  end if;
  if p_voice_path is not null and not exists (
      select 1 from storage.objects o where o.bucket_id = 'voice' and o.name = p_voice_path and o.owner = auth.uid()) then
    raise exception 'voice note upload not found';
  end if;

  v_topic := coalesce(p_topic_id,
    (select t.id from public.topics t where lower(v_name) like '%' || lower(t.name) || '%' order by length(t.name) desc limit 1),
    (select t.id from public.topics t join public.places p on p.id = p_place_id
      where lower(p.category) like '%' || lower(t.name) || '%' order by length(t.name) desc limit 1));

  insert into public.items (place_id, topic_id, name)
  values (p_place_id, v_topic, v_name)
  on conflict (place_id, name_normalized) do update
    set topic_id = coalesce(public.items.topic_id, excluded.topic_id)
  returning * into it;

  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, voice_path, photo_path, visit_id, is_public)
  values (auth.uid(), p_place_id, it.id, p_rating, coalesce(p_body, ''), p_ai_drafted, p_voice_path, p_photo_path, v_visit, coalesce(p_is_public, false))
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t from unnest(coalesce(p_tag_ids, '{}')) t
  on conflict do nothing;

  return r;
end $$;
revoke execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean) from public, anon;
grant execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean) to authenticated;

-- ---------- Profiles: home city is private ----------
alter table public.profiles add column if not exists contacts_synced_at timestamptz;
revoke select (city) on public.profiles from anon, authenticated;

create or replace function public.my_profile()
returns table (id uuid, display_name text, avatar_path text, city text, role public.app_role, created_at timestamptz,
               phone_set boolean, contacts_synced boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path, p.city, p.role, p.created_at,
         p.phone_hash is not null, p.contacts_synced_at is not null
  from public.profiles p where p.id = auth.uid();
$$;

-- ---------- Follows: only you see your own follows and followers ----------
drop policy if exists "follows readable" on public.follows;
drop policy if exists "own follows readable" on public.follows;
create policy "own follows readable" on public.follows for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid() or public.is_admin());

-- Public counts for a profile page, from named reviews only.
create or replace function public.person_stats(p_user uuid)
returns table (reviews integer, followers integer, verified integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.reviews r where r.user_id = p_user and r.status = 'published'
       and (r.is_public or p_user = auth.uid()))::integer,
    (select count(*) from public.follows f where f.followee_id = p_user)::integer,
    (select count(*) from public.reviews r where r.user_id = p_user and r.status = 'published' and r.visit_id is not null
       and (r.is_public or p_user = auth.uid()))::integer;
$$;
grant execute on function public.person_stats(uuid) to anon, authenticated;

-- Find people by name: only people who have posted a review with their name.
create or replace function public.find_people(p_query text, p_limit integer default 15)
returns table (id uuid, display_name text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path from public.profiles p
  where length(btrim(coalesce(p_query, ''))) >= 2
    and p.display_name ilike '%' || btrim(p_query) || '%'
    and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and exists (select 1 from public.reviews r where r.user_id = p.id and r.status = 'published' and r.is_public)
  order by p.display_name
  limit least(greatest(p_limit, 1), 30);
$$;
grant execute on function public.find_people(text, integer) to authenticated;

-- ---------- Contact sync: opt-in, private, mutual ----------
create table if not exists public.contact_links (
  owner_id    uuid not null references public.profiles (id) on delete cascade,   -- has contact_id's number saved
  contact_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (owner_id, contact_id)
);
create index if not exists contact_links_contact_idx on public.contact_links (contact_id);
alter table public.contact_links enable row level security;
-- No policies: nobody reads or writes this table directly, only through the functions below.

create table if not exists public.contact_syncs (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  synced_at  timestamptz not null default now()
);
create index if not exists contact_syncs_user_idx on public.contact_syncs (user_id, synced_at desc);
alter table public.contact_syncs enable row level security;

-- Mutual contacts: each has the other's number, and both turned on contact sync.
create or replace function public.are_contacts(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and a <> b
    and exists (select 1 from public.contact_links where owner_id = a and contact_id = b)
    and exists (select 1 from public.contact_links where owner_id = b and contact_id = a)
    and exists (select 1 from public.profiles where id = a and contacts_synced_at is not null)
    and exists (select 1 from public.profiles where id = b and contacts_synced_at is not null);
$$;
revoke execute on function public.are_contacts(uuid, uuid) from public, anon, authenticated;

-- Matching your contacts needs your own number on file (so it works both ways),
-- is limited to 5 syncs a day and 2000 numbers, and only finds people who added
-- their number to be found.
drop function if exists public.match_contacts(text[]);
create or replace function public.match_contacts(p_hashes text[])
returns table (id uuid, display_name text, avatar_path text, mutual boolean)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where profiles.id = auth.uid() and phone_hash is not null) then
    raise exception 'add your own number first, so your contacts can find you too';
  end if;
  if (select count(*) from public.contact_syncs s where s.user_id = auth.uid() and s.synced_at > now() - interval '1 day') >= 5 then
    raise exception 'you can sync contacts 5 times a day; try again tomorrow';
  end if;
  insert into public.contact_syncs (user_id) values (auth.uid());

  delete from public.contact_links where owner_id = auth.uid();
  insert into public.contact_links (owner_id, contact_id)
  select auth.uid(), p.id from public.profiles p
  where p.phone_hash = any (p_hashes[1:2000]) and p.id <> auth.uid()
  on conflict do nothing;
  update public.profiles set contacts_synced_at = now() where profiles.id = auth.uid();

  return query
    select p.id, p.display_name, p.avatar_path, public.are_contacts(auth.uid(), p.id)
    from public.contact_links l join public.profiles p on p.id = l.contact_id
    where l.owner_id = auth.uid()
    order by p.display_name;
end $$;
revoke execute on function public.match_contacts(text[]) from public, anon;
grant execute on function public.match_contacts(text[]) to authenticated;

-- Turn contact sync off: forget who is in your contacts.
create or replace function public.stop_contact_sync()
returns void language sql security definer set search_path = public as $$
  delete from public.contact_links where owner_id = auth.uid();
  update public.profiles set contacts_synced_at = null where id = auth.uid();
$$;
revoke execute on function public.stop_contact_sync() from public, anon;
grant execute on function public.stop_contact_sync() to authenticated;

-- Removing your number also stops others from matching you.
create or replace function public.set_my_phone(p_phone text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare digits text; h text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if btrim(coalesce(p_phone, '')) = '' then
    update public.profiles set phone_hash = null where id = auth.uid();
    delete from public.contact_links where contact_id = auth.uid();
    return false;
  end if;
  digits := regexp_replace(p_phone, '\D', '', 'g');
  if p_phone !~ '^\s*\+' then
    digits := regexp_replace(digits, '^0+', '');
    if length(digits) = 10 then digits := '91' || digits; end if;
  end if;
  if length(digits) < 8 or length(digits) > 15 then raise exception 'enter a full phone number'; end if;
  h := encode(digest('+' || digits, 'sha256'), 'hex');
  if exists (select 1 from public.profiles where phone_hash = h and id <> auth.uid()) then
    raise exception 'that number is already linked to another account';
  end if;
  update public.profiles set phone_hash = h where id = auth.uid();
  return true;
end $$;

-- ---------- Suggestions: no home city in the output ----------
drop function if exists public.suggested_people(bigint, integer);
create or replace function public.suggested_people(p_topic bigint default null, p_limit integer default 10)
returns table (id uuid, display_name text, avatar_path text, review_count integer, is_expert boolean, topic_name text)
language sql stable security definer set search_path = public as $$
  with mine as (select city from public.profiles where id = auth.uid()),
  cand as (
    select s.user_id, sum(s.review_count)::integer as n, bool_or(s.is_expert) as expert,
           (array_agg(t.name order by s.is_expert desc, s.review_count desc))[1] as topic_name
    from public.user_topic_stats s join public.topics t on t.id = s.topic_id
    where p_topic is null or s.topic_id = p_topic
    group by s.user_id)
  select p.id, p.display_name, p.avatar_path, c.n, c.expert, c.topic_name
  from cand c join public.profiles p on p.id = c.user_id
  where p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id)
  order by c.expert desc, (p.city is not null and p.city ilike (select city from mine)) desc, c.n desc
  limit least(greatest(p_limit, 1), 30);
$$;
grant execute on function public.suggested_people(bigint, integer) to anon, authenticated;

-- ---------- Trust tables: built from named reviews only ----------
create or replace function public.refresh_trust_tables()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_topic_stats;
  insert into public.user_topic_stats (user_id, topic_id, review_count, followers_trusting, is_expert)
  with counts as (
    select r.user_id, i.topic_id, count(*)::integer as n
    from public.reviews r join public.items i on i.id = r.item_id
    where r.status = 'published' and r.is_public and i.topic_id is not null
    group by r.user_id, i.topic_id),
  trusting as (
    select c.user_id, c.topic_id, count(distinct f.follower_id)::integer as ft
    from counts c
    join public.follows f on f.followee_id = c.user_id
    join public.reviews r2 on r2.user_id = f.follower_id and r2.status = 'published' and r2.is_public
    join public.items i2 on i2.id = r2.item_id and i2.topic_id = c.topic_id
    group by c.user_id, c.topic_id)
  select c.user_id, c.topic_id, c.n, coalesce(t.ft, 0),
         c.n >= 5 and percent_rank() over (partition by c.topic_id order by c.n) >= 0.95
  from counts c left join trusting t using (user_id, topic_id);

  delete from public.taste_match;
  insert into public.taste_match (user_id, other_user_id, topic_id, match_pct, shared_items)
  with latest as (
    select distinct on (r.user_id, r.item_id) r.user_id, r.item_id, i.topic_id, r.rating
    from public.reviews r join public.items i on i.id = r.item_id
    where r.status = 'published' and r.is_public and i.topic_id is not null
    order by r.user_id, r.item_id, r.created_at desc)
  select a.user_id, b.user_id, a.topic_id,
         round(100 * (1 - avg(abs(a.rating - b.rating)) / 4.0))::smallint, count(*)::integer
  from latest a join latest b on a.item_id = b.item_id and a.user_id <> b.user_id
  group by a.user_id, b.user_id, a.topic_id
  having count(*) >= 3;
end $$;
revoke execute on function public.refresh_trust_tables() from public, anon, authenticated;
select public.refresh_trust_tables();

-- ---------- Search: friend signals only from mutual contacts' named reviews ----------
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null)
returns table (
  place_id uuid, name text, category text, area text, price_level smallint, google_place_id text,
  distance_m integer, trust_score numeric, review_count integer, verified_count integer,
  friend_count integer, friend_ids uuid[], top_item text, has_qr boolean)
language sql stable security definer set search_path = public, extensions as $$
  with me as (select auth.uid() as uid),
  q as (select nullif(lower(btrim(p_query)), '') as txt),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  cand as (
    select p.*, case when here.pt is not null and p.location is not null
                     then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or p.city ilike btrim(p_city))
      and (p_area is null or btrim(p_area) = '' or p.area ilike btrim(p_area))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, p_radius_m)))),
  matched as (
    select r.*, i.name as item_name
    from public.reviews r
    join public.items i on i.id = r.item_id
    left join public.topics t on t.id = i.topic_id
    join cand c on c.id = r.place_id, q
    where r.status = 'published'
      and (q.txt is null or i.name_normalized like '%' || q.txt || '%'
           or lower(t.name) like '%' || q.txt || '%' or lower(c.name) like '%' || q.txt || '%'
           or lower(c.category) like '%' || q.txt || '%')),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from matched),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name,
      -- Anonymous reviews count, but never with extra weight that could hint at who wrote them.
      (case when not m.is_public then 1.0
            when f.follower_id is not null or fr.is_contact then 3.0
            when uts.is_expert then 1.5 else 1.0 end)
      * (case when m.visit_id is not null then 1.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      m.is_public and fr.is_contact as is_friend
    from matched m
    cross join me
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.items i on i.id = m.item_id
    left join public.user_topic_stats uts on uts.user_id = m.user_id and uts.topic_id = i.topic_id
    cross join lateral (select m.is_public and public.are_contacts(me.uid, m.user_id) as is_contact) fr),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv,
      count(distinct w.user_id) filter (where w.is_friend)::integer as nf,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w group by w.place_id)
  select c.id, c.name, c.category, c.area, c.price_level, c.google_place_id, c.dist,
         s.score, coalesce(s.n, 0), coalesce(s.nv, 0), coalesce(s.nf, 0), coalesce(s.fids, '{}'), s.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = c.id and qc.active)
  from cand c left join scored s on s.place_id = c.id, q
  where s.place_id is not null or q.txt is null
     or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
  order by s.score desc nulls last, c.dist asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid) to anon, authenticated;

-- ---------- Visit history stays private ----------
-- visits are readable only by their owner (and admins) already. Make sure nobody can
-- read another user's Google share log or saved places either.
revoke all on public.contact_links, public.contact_syncs from anon, authenticated;

-- ===== 20261016000010_guests.sql =====
-- Trusted Picks: review without signing up.
--
-- The app starts a Supabase anonymous session for guests (Authentication > Sign In /
-- Providers > "Allow anonymous sign-ins" must be on). A guest is a real but nameless
-- user: their reviews are always anonymous, and if they later sign in with Google or
-- email the same account is kept, reviews included.
--
-- Abuse limits: guests may post 5 reviews a day, signed-in people 25. A guest review
-- without a table scan counts half in rankings.

create or replace function public.is_guest()
returns boolean language sql stable as $$
  select coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false);
$$;

alter table public.reviews add column if not exists by_guest boolean not null default false;

-- Guests can't show a name: they don't have one yet.
create or replace function public.guard_review_visibility()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_public and public.is_guest() then
    raise exception 'sign in to show your name on a review';
  end if;
  return new;
end $$;
drop trigger if exists reviews_guard_visibility on public.reviews;
create trigger reviews_guard_visibility before insert or update of is_public on public.reviews
  for each row execute function public.guard_review_visibility();

create or replace function public.submit_review(
  p_place_id uuid, p_item_name text, p_rating smallint, p_body text default '',
  p_topic_id bigint default null, p_tag_ids bigint[] default '{}',
  p_ai_drafted boolean default false, p_voice_path text default null, p_photo_path text default null,
  p_is_public boolean default false)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare it public.items; v_visit uuid; r public.reviews; v_topic bigint; v_name text; v_guest boolean := public.is_guest();
begin
  if auth.uid() is null then raise exception 'open the review page again to continue'; end if;
  if (select count(*) from public.reviews where user_id = auth.uid() and created_at > now() - interval '1 day')
     >= (case when v_guest then 5 else 25 end) then
    raise exception 'that''s a lot of reviews for one day. Try again tomorrow%', (case when v_guest then ', or sign in to post more' else '' end);
  end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  v_name := btrim(coalesce(p_item_name, ''));
  if v_name = '' then raise exception 'say what you had'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'pick 1 to 5 stars'; end if;
  if length(coalesce(p_body, '')) > 2000 then raise exception 'keep the review under 2000 characters'; end if;
  if p_photo_path is not null and not exists (
      select 1 from storage.objects o where o.bucket_id = 'review-photos' and o.name = p_photo_path and o.owner = auth.uid()) then
    raise exception 'photo upload not found';
  end if;
  if p_voice_path is not null and not exists (
      select 1 from storage.objects o where o.bucket_id = 'voice' and o.name = p_voice_path and o.owner = auth.uid()) then
    raise exception 'voice note upload not found';
  end if;

  v_topic := coalesce(p_topic_id,
    (select t.id from public.topics t where lower(v_name) like '%' || lower(t.name) || '%' order by length(t.name) desc limit 1),
    (select t.id from public.topics t join public.places p on p.id = p_place_id
      where lower(p.category) like '%' || lower(t.name) || '%' order by length(t.name) desc limit 1));

  insert into public.items (place_id, topic_id, name)
  values (p_place_id, v_topic, v_name)
  on conflict (place_id, name_normalized) do update
    set topic_id = coalesce(public.items.topic_id, excluded.topic_id)
  returning * into it;

  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, voice_path, photo_path, visit_id, is_public, by_guest)
  values (auth.uid(), p_place_id, it.id, p_rating, coalesce(p_body, ''), p_ai_drafted, p_voice_path, p_photo_path, v_visit,
          coalesce(p_is_public, false) and not v_guest, v_guest)
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t from unnest(coalesce(p_tag_ids, '{}')) t
  on conflict do nothing;

  return r;
end $$;
revoke execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean) from public, anon;
grant execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean) to authenticated;

-- Guests can't list a business, share a phone number or sync contacts: those need an account.
drop policy if exists "request listing" on public.listing_requests;
create policy "request listing" on public.listing_requests for insert to authenticated
  with check (requester_id = auth.uid() and not public.is_guest());

create or replace function public.guard_guest_features()
returns void language plpgsql stable as $$
begin
  if public.is_guest() then raise exception 'sign in first to use this'; end if;
end $$;

create or replace function public.set_my_phone(p_phone text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare digits text; h text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  perform public.guard_guest_features();
  if btrim(coalesce(p_phone, '')) = '' then
    update public.profiles set phone_hash = null where id = auth.uid();
    delete from public.contact_links where contact_id = auth.uid();
    return false;
  end if;
  digits := regexp_replace(p_phone, '\D', '', 'g');
  if p_phone !~ '^\s*\+' then
    digits := regexp_replace(digits, '^0+', '');
    if length(digits) = 10 then digits := '91' || digits; end if;
  end if;
  if length(digits) < 8 or length(digits) > 15 then raise exception 'enter a full phone number'; end if;
  h := encode(digest('+' || digits, 'sha256'), 'hex');
  if exists (select 1 from public.profiles where phone_hash = h and id <> auth.uid()) then
    raise exception 'that number is already linked to another account';
  end if;
  update public.profiles set phone_hash = h where id = auth.uid();
  return true;
end $$;

create or replace function public.match_contacts(p_hashes text[])
returns table (id uuid, display_name text, avatar_path text, mutual boolean)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  perform public.guard_guest_features();
  if not exists (select 1 from public.profiles where profiles.id = auth.uid() and phone_hash is not null) then
    raise exception 'add your own number first, so your contacts can find you too';
  end if;
  if (select count(*) from public.contact_syncs s where s.user_id = auth.uid() and s.synced_at > now() - interval '1 day') >= 5 then
    raise exception 'you can sync contacts 5 times a day; try again tomorrow';
  end if;
  insert into public.contact_syncs (user_id) values (auth.uid());

  delete from public.contact_links where owner_id = auth.uid();
  insert into public.contact_links (owner_id, contact_id)
  select auth.uid(), p.id from public.profiles p
  where p.phone_hash = any (p_hashes[1:2000]) and p.id <> auth.uid()
  on conflict do nothing;
  update public.profiles set contacts_synced_at = now() where profiles.id = auth.uid();

  return query
    select p.id, p.display_name, p.avatar_path, public.are_contacts(auth.uid(), p.id)
    from public.contact_links l join public.profiles p on p.id = l.contact_id
    where l.owner_id = auth.uid()
    order by p.display_name;
end $$;

-- Rankings: an unverified guest review counts half.
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null)
returns table (
  place_id uuid, name text, category text, area text, price_level smallint, google_place_id text,
  distance_m integer, trust_score numeric, review_count integer, verified_count integer,
  friend_count integer, friend_ids uuid[], top_item text, has_qr boolean)
language sql stable security definer set search_path = public, extensions as $$
  with me as (select auth.uid() as uid),
  q as (select nullif(lower(btrim(p_query)), '') as txt),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  cand as (
    select p.*, case when here.pt is not null and p.location is not null
                     then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or p.city ilike btrim(p_city))
      and (p_area is null or btrim(p_area) = '' or p.area ilike btrim(p_area))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, p_radius_m)))),
  matched as (
    select r.*, i.name as item_name
    from public.reviews r
    join public.items i on i.id = r.item_id
    left join public.topics t on t.id = i.topic_id
    join cand c on c.id = r.place_id, q
    where r.status = 'published'
      and (q.txt is null or i.name_normalized like '%' || q.txt || '%'
           or lower(t.name) like '%' || q.txt || '%' or lower(c.name) like '%' || q.txt || '%'
           or lower(c.category) like '%' || q.txt || '%')),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from matched),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name,
      (case when not m.is_public then 1.0
            when f.follower_id is not null or fr.is_contact then 3.0
            when uts.is_expert then 1.5 else 1.0 end)
      * (case when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      m.is_public and fr.is_contact as is_friend
    from matched m
    cross join me
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.items i on i.id = m.item_id
    left join public.user_topic_stats uts on uts.user_id = m.user_id and uts.topic_id = i.topic_id
    cross join lateral (select m.is_public and public.are_contacts(me.uid, m.user_id) as is_contact) fr),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv,
      count(distinct w.user_id) filter (where w.is_friend)::integer as nf,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w group by w.place_id)
  select c.id, c.name, c.category, c.area, c.price_level, c.google_place_id, c.dist,
         s.score, coalesce(s.n, 0), coalesce(s.nv, 0), coalesce(s.nf, 0), coalesce(s.fids, '{}'), s.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = c.id and qc.active)
  from cand c left join scored s on s.place_id = c.id, q
  where s.place_id is not null or q.txt is null
     or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
  order by s.score desc nulls last, c.dist asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid) to anon, authenticated;

-- ===== 20261016000011_shops_friends.sql =====
-- Trusted Picks: shops manage their own products and photos, and friends are made
-- through invite links instead of phone numbers.

-- ---------- Place owners ----------
alter table public.places add column if not exists owner_id uuid references public.profiles (id) on delete set null;
alter table public.places add column if not exists cover_path text;
alter table public.places add column if not exists logo_path text;
create index if not exists places_owner_idx on public.places (owner_id);

-- Businesses already approved belong to whoever requested them.
update public.places p set owner_id = lr.requester_id
from public.listing_requests lr
where lr.place_id = p.id and lr.status = 'approved' and p.owner_id is null;

create or replace function public.is_place_owner(p_place uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.places where id = p_place and owner_id = auth.uid() and auth.uid() is not null);
$$;

-- Same as before, plus: the requester becomes the owner.
create or replace function public.approve_listing(
  p_request uuid, p_lat double precision default null, p_lng double precision default null,
  p_table_labels text[] default '{}')
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare lr public.listing_requests; pl public.places; lbl text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into lr from public.listing_requests where id = p_request for update;
  if not found or lr.status not in ('pending', 'paid') then raise exception 'request cannot be approved'; end if;

  insert into public.places (google_place_id, name, category, area, city, location, status, listed_until, created_by, owner_id)
  values (nullif(lr.google_place_id, ''), lr.business_name, lr.category, lr.area, lr.city,
          case when p_lat is not null and p_lng is not null
               then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
          'live', current_date + interval '1 year', auth.uid(), lr.requester_id)
  on conflict (google_place_id) do update
    set status = 'live', listed_until = excluded.listed_until, owner_id = coalesce(public.places.owner_id, excluded.owner_id)
  returning * into pl;

  if lr.wants_qr then
    if coalesce(array_length(p_table_labels, 1), 0) = 0 then
      insert into public.qr_codes (place_id, style) values (pl.id, coalesce(lr.qr_style, 'neon'));
    else
      foreach lbl in array p_table_labels loop
        insert into public.qr_codes (place_id, style, table_label) values (pl.id, coalesce(lr.qr_style, 'neon'), lbl);
      end loop;
    end if;
  end if;

  update public.payments set place_id = pl.id where request_id = lr.id;
  update public.listing_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), place_id = pl.id
    where id = lr.id;
  return pl;
end $$;

-- Owners edit how their page looks; admins keep control of listing status, name and dates.
drop policy if exists "owners update own place" on public.places;
create policy "owners update own place" on public.places for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.guard_place_owner_edits()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.name is distinct from old.name or new.status is distinct from old.status
     or new.listed_until is distinct from old.listed_until or new.owner_id is distinct from old.owner_id
     or new.google_place_id is distinct from old.google_place_id or new.city is distinct from old.city
     or new.created_by is distinct from old.created_by then
    raise exception 'ask the Trusted Picks team to change the name, city, Google link or listing dates';
  end if;
  return new;
end $$;
drop trigger if exists places_guard_owner on public.places;
create trigger places_guard_owner before update on public.places
  for each row execute function public.guard_place_owner_edits();

-- ---------- Products ----------
alter table public.items add column if not exists image_path text;
alter table public.items add column if not exists description text;
alter table public.items add column if not exists price_inr integer check (price_inr is null or price_inr >= 0);
alter table public.items add column if not exists sort_order integer not null default 0;
alter table public.items add column if not exists is_listed boolean not null default false;  -- added by the shop, shown with its photo
alter table public.items add column if not exists is_hidden boolean not null default false;  -- removed from the picker

-- Owners add and edit products. Customer reviews stay attached to what was reviewed:
-- a reviewed product can be hidden or re-photographed but not renamed or deleted.
drop policy if exists "owners manage items" on public.items;
drop policy if exists "owners add items" on public.items;
drop policy if exists "owners edit items" on public.items;
drop policy if exists "owners delete unreviewed items" on public.items;
create policy "owners add items" on public.items for insert to authenticated
  with check (public.is_place_owner(place_id));
create policy "owners edit items" on public.items for update to authenticated
  using (public.is_place_owner(place_id)) with check (public.is_place_owner(place_id));
create policy "owners delete unreviewed items" on public.items for delete to authenticated
  using (public.is_place_owner(place_id) and not exists (select 1 from public.reviews r where r.item_id = items.id));

create or replace function public.guard_item_edits()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.place_id is distinct from old.place_id then raise exception 'a product can''t move to another shop'; end if;
  if new.name is distinct from old.name and exists (select 1 from public.reviews r where r.item_id = old.id) then
    raise exception 'this product already has reviews, so its name stays. You can hide it and add a new one';
  end if;
  return new;
end $$;
drop trigger if exists items_guard_edits on public.items;
create trigger items_guard_edits before update on public.items
  for each row execute function public.guard_item_edits();

-- ---------- Photos for places and products ----------
insert into storage.buckets (id, name, public)
values ('place-media', 'place-media', true)
on conflict (id) do nothing;

create or replace function public.can_manage_place_media(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  begin v := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  return public.is_admin() or public.is_place_owner(v);
end $$;

drop policy if exists "place media readable" on storage.objects;
create policy "place media readable" on storage.objects for select using (bucket_id = 'place-media');
drop policy if exists "owners manage place media" on storage.objects;
create policy "owners manage place media" on storage.objects for all to authenticated
  using (bucket_id = 'place-media' and public.can_manage_place_media(name))
  with check (bucket_id = 'place-media' and public.can_manage_place_media(name));

-- ---------- Friends through invite links ----------
alter table public.profiles add column if not exists invite_code text unique;

create table if not exists public.friendships (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  via        text not null default 'invite',     -- 'invite' | 'review'
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index if not exists friendships_friend_idx on public.friendships (friend_id);
alter table public.friendships enable row level security;
drop policy if exists "own friendships readable" on public.friendships;
create policy "own friendships readable" on public.friendships for select to authenticated
  using (user_id = auth.uid());
-- Rows are written only by accept_invite() and remove_friend().
revoke insert, update, delete on public.friendships from anon, authenticated;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (select 1 from public.friendships where user_id = a and friend_id = b);
$$;
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- Your personal invite code, made the first time you share.
create or replace function public.my_invite_code()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select invite_code into c from public.profiles where id = auth.uid();
  while c is null loop
    c := encode(gen_random_bytes(5), 'hex');
    begin
      update public.profiles set invite_code = c where id = auth.uid();
    exception when unique_violation then c := null;
    end;
  end loop;
  return c;
end $$;
revoke execute on function public.my_invite_code() from public, anon;
grant execute on function public.my_invite_code() to authenticated;

-- Opening someone's invite or shared review makes the two of you friends.
create or replace function public.accept_invite(p_code text, p_via text default 'invite')
returns table (friend_id uuid, display_name text, avatar_path text, is_new boolean)
language plpgsql security definer set search_path = public as $$
declare inviter public.profiles; v_new boolean;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into inviter from public.profiles where invite_code = lower(btrim(p_code));
  if not found or inviter.id = auth.uid() then return; end if;
  v_new := not exists (select 1 from public.friendships f where f.user_id = auth.uid() and f.friend_id = inviter.id);
  insert into public.friendships (user_id, friend_id, via) values (auth.uid(), inviter.id, coalesce(nullif(p_via, ''), 'invite'))
  on conflict do nothing;
  insert into public.friendships (user_id, friend_id, via) values (inviter.id, auth.uid(), coalesce(nullif(p_via, ''), 'invite'))
  on conflict do nothing;
  return query select inviter.id, inviter.display_name, inviter.avatar_path, v_new;
end $$;
revoke execute on function public.accept_invite(text, text) from public, anon;
grant execute on function public.accept_invite(text, text) to authenticated;

create or replace function public.my_friends()
returns table (id uuid, display_name text, avatar_path text, via text, since timestamptz, is_guest boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path, f.via, f.created_at,
         not exists (select 1 from public.reviews r where r.user_id = p.id and r.is_public) and coalesce(p.display_name, '') = ''
  from public.friendships f join public.profiles p on p.id = f.friend_id
  where f.user_id = auth.uid()
  order by f.created_at desc;
$$;
grant execute on function public.my_friends() to authenticated;

create or replace function public.remove_friend(p_friend uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.friendships where (user_id = auth.uid() and friend_id = p_friend) or (user_id = p_friend and friend_id = auth.uid());
$$;
revoke execute on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;

-- ---------- Search: friends' ratings count most; names only on named reviews ----------
-- A friend's anonymous review still counts with friend weight but is never named.
-- friend_count is only given when at least 2 friends rated, so one anonymous friend
-- can't be singled out; friend_ids lists only friends who posted with their name.
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null)
returns table (
  place_id uuid, name text, category text, area text, price_level smallint, google_place_id text,
  distance_m integer, trust_score numeric, review_count integer, verified_count integer,
  friend_count integer, friend_ids uuid[], top_item text, has_qr boolean)
language sql stable security definer set search_path = public, extensions as $$
  with me as (select auth.uid() as uid),
  q as (select nullif(lower(btrim(p_query)), '') as txt),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  cand as (
    select p.*, case when here.pt is not null and p.location is not null
                     then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or p.city ilike btrim(p_city))
      and (p_area is null or btrim(p_area) = '' or p.area ilike btrim(p_area))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, p_radius_m)))),
  matched as (
    select r.*, i.name as item_name
    from public.reviews r
    join public.items i on i.id = r.item_id
    left join public.topics t on t.id = i.topic_id
    join cand c on c.id = r.place_id, q
    where r.status = 'published'
      and (q.txt is null or i.name_normalized like '%' || q.txt || '%'
           or lower(t.name) like '%' || q.txt || '%' or lower(c.name) like '%' || q.txt || '%'
           or lower(c.category) like '%' || q.txt || '%')),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from matched),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name, m.is_public,
      (case when fr.is_friend then 3.0
            when m.is_public and f.follower_id is not null then 3.0
            when m.is_public and uts.is_expert then 1.5 else 1.0 end)
      * (case when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      fr.is_friend
    from matched m
    cross join me
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.items i on i.id = m.item_id
    left join public.user_topic_stats uts on uts.user_id = m.user_id and uts.topic_id = i.topic_id
    cross join lateral (select public.are_friends(me.uid, m.user_id) as is_friend) fr),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv,
      count(distinct w.user_id) filter (where w.is_friend)::integer as nf_all,
      count(distinct w.user_id) filter (where w.is_friend and w.is_public)::integer as nf_named,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend and w.is_public), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w group by w.place_id)
  select c.id, c.name, c.category, c.area, c.price_level, c.google_place_id, c.dist,
         s.score, coalesce(s.n, 0), coalesce(s.nv, 0),
         coalesce(case when s.nf_all >= 2 then s.nf_all else s.nf_named end, 0),
         coalesce(s.fids, '{}'), s.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = c.id and qc.active)
  from cand c left join scored s on s.place_id = c.id, q
  where s.place_id is not null or q.txt is null
     or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
  order by s.score desc nulls last, c.dist asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid) to anon, authenticated;

-- Who owns a shop is private: others can't read owner_id or created_by.
revoke select on public.places from anon, authenticated;
grant select (id, google_place_id, name, category, area, city, about, location, hours, price_level,
              status, listed_until, created_at, cover_path, logo_path) on public.places to anon, authenticated;

-- Shops you can manage (yours, or every shop for admins).
create or replace function public.my_places()
returns table (id uuid, name text, area text, city text, status public.place_status, listed_until date, cover_path text, logo_path text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, p.city, p.status, p.listed_until, p.cover_path, p.logo_path
  from public.places p
  where auth.uid() is not null and p.owner_id = auth.uid()
  order by p.name;
$$;
grant execute on function public.my_places() to authenticated;

create or replace function public.can_manage_place(p_place uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_place_owner(p_place);
$$;
grant execute on function public.can_manage_place(uuid) to anon, authenticated;

-- Owners see their own table QR codes and can pin their shop on the map.
drop policy if exists "owners read own qr" on public.qr_codes;
create policy "owners read own qr" on public.qr_codes for select to authenticated
  using (public.is_place_owner(place_id));

create or replace function public.set_place_location(p_place uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change this'; end if;
  update public.places
    set location = case when p_lat is null or p_lng is null then null
                        else st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end
    where id = p_place;
end $$;

-- ===== 20261016000012_links_updates.sql =====
-- Trusted Picks: a shop's links (Swiggy, Zomato, Instagram, website...), short updates
-- from the shop to its customers, and numbers that show the owner what the app brings in.

-- ---------- Links ----------
-- [{ "kind": "zomato", "url": "https://...", "label": "Order on Zomato" }, ...]
alter table public.places add column if not exists links jsonb not null default '[]'::jsonb;

create or replace function public.check_place_links()
returns trigger language plpgsql set search_path = public as $$
declare l jsonb;
begin
  if jsonb_typeof(new.links) <> 'array' then raise exception 'links must be a list'; end if;
  if jsonb_array_length(new.links) > 12 then raise exception 'up to 12 links'; end if;
  for l in select * from jsonb_array_elements(new.links) loop
    if coalesce(l ->> 'url', '') !~* '^(https?://|tel:|mailto:)' or length(l ->> 'url') > 500 then
      raise exception 'each link needs a web address starting with https://';
    end if;
    if length(coalesce(l ->> 'label', '')) > 40 then raise exception 'keep link names under 40 characters'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists places_check_links on public.places;
create trigger places_check_links before insert or update of links on public.places
  for each row execute function public.check_place_links();

grant select (links) on public.places to anon, authenticated;

-- ---------- Updates from the shop ----------
create table if not exists public.place_updates (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 280),
  link_url   text check (link_url is null or (link_url ~* '^https?://' and length(link_url) <= 500)),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists place_updates_place_idx on public.place_updates (place_id, created_at desc);
alter table public.place_updates enable row level security;

drop policy if exists "updates readable" on public.place_updates;
create policy "updates readable" on public.place_updates for select
  using (exists (select 1 from public.places p where p.id = place_id and p.status = 'live'));
drop policy if exists "owners post updates" on public.place_updates;
create policy "owners post updates" on public.place_updates for insert to authenticated
  with check ((public.is_place_owner(place_id) or public.is_admin()) and created_by = auth.uid());
drop policy if exists "owners delete updates" on public.place_updates;
create policy "owners delete updates" on public.place_updates for delete to authenticated
  using (public.is_place_owner(place_id) or public.is_admin());
-- Who posted is not shown to customers.
revoke select on public.place_updates from anon, authenticated;
grant select (id, place_id, body, link_url, created_at) on public.place_updates to anon, authenticated;
grant insert (place_id, body, link_url, created_by), delete on public.place_updates to authenticated;

-- A few a day is plenty; stops a shop from spamming its customers.
create or replace function public.limit_place_updates()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.place_updates where place_id = new.place_id and created_at > now() - interval '1 day') >= 3 then
    raise exception 'you can post 3 updates a day';
  end if;
  return new;
end $$;
drop trigger if exists place_updates_limit on public.place_updates;
create trigger place_updates_limit before insert on public.place_updates
  for each row execute function public.limit_place_updates();

-- Updates from shops you saved or reviewed. The shop never learns who you are.
create or replace function public.my_shop_updates(p_limit integer default 10)
returns table (id uuid, place_id uuid, place_name text, logo_path text, body text, link_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.place_id, p.name, p.logo_path, u.body, u.link_url, u.created_at
  from public.place_updates u
  join public.places p on p.id = u.place_id and p.status = 'live'
  where auth.uid() is not null
    and u.created_at > now() - interval '30 days'
    and (exists (select 1 from public.saved_places s where s.user_id = auth.uid() and s.place_id = u.place_id)
         or exists (select 1 from public.reviews r where r.user_id = auth.uid() and r.place_id = u.place_id))
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;
revoke execute on function public.my_shop_updates(integer) from public, anon;
grant execute on function public.my_shop_updates(integer) to authenticated;

-- ---------- What the app brings the shop ----------
-- Counts only, never who. Shown to the owner and admins.
create or replace function public.shop_stats(p_place uuid)
returns table (reviews integer, avg_rating numeric, reviews_30d integer, verified integer,
               google_handoffs integer, google_handoffs_30d integer, scans_30d integer, saves integer, items_rated integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query select
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.created_at > now() - interval '30 days'),
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.visit_id is not null),
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place),
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place and g.opened_at > now() - interval '30 days'),
    (select count(*)::integer from public.visits v where v.place_id = p_place and v.scanned_at > now() - interval '30 days'),
    (select count(*)::integer from public.saved_places s where s.place_id = p_place),
    (select count(distinct r.item_id)::integer from public.reviews r where r.place_id = p_place and r.status = 'published');
end $$;
revoke execute on function public.shop_stats(uuid) from public, anon;
grant execute on function public.shop_stats(uuid) to authenticated;

-- Per product: average and count, best and worst first for the owner.
create or replace function public.shop_item_stats(p_place uuid)
returns table (item_id uuid, name text, image_path text, reviews integer, avg_rating numeric, low_ratings integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
    select i.id, i.name, i.image_path, count(r.id)::integer, round(avg(r.rating)::numeric, 1),
           count(r.id) filter (where r.rating <= 2)::integer
    from public.items i
    join public.reviews r on r.item_id = i.id and r.status = 'published'
    where i.place_id = p_place
    group by i.id
    order by avg(r.rating) desc, count(r.id) desc;
end $$;
revoke execute on function public.shop_item_stats(uuid) from public, anon;
grant execute on function public.shop_item_stats(uuid) to authenticated;

-- ---------- Owners connect their Google profile ----------
-- An owner may link their shop to its Google Place ID once (when none is set yet);
-- changing an existing link still goes through the Trusted Picks team.
create or replace function public.guard_place_owner_edits()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.name is distinct from old.name or new.status is distinct from old.status
     or new.listed_until is distinct from old.listed_until or new.owner_id is distinct from old.owner_id
     or (new.google_place_id is distinct from old.google_place_id and old.google_place_id is not null)
     or new.city is distinct from old.city or new.created_by is distinct from old.created_by then
    raise exception 'ask the Trusted Picks team to change the name, city, Google link or listing dates';
  end if;
  return new;
end $$;

-- ===== 20261016000013_business_modes.sql =====
-- Trusted Picks: business types ("modes"). A restaurant shows a menu and takes orders,
-- a gym shows plans and trainers, a school shows courses and fees. The app reads the
-- type to pick its words, sections, buttons and review tags.

alter table public.places add column if not exists kind text not null default 'other';
alter table public.places drop constraint if exists places_kind_check;
alter table public.places add constraint places_kind_check
  check (kind in ('food', 'store', 'beauty', 'health', 'fitness', 'education', 'services', 'other'));

-- Best guess from the category; owners can change it.
create or replace function public.guess_place_kind(p_category text)
returns text language sql immutable as $$
  select case
    when p_category ~* 'restaurant|cafe|café|coffee|bakery|cake|pizz|biryani|dhaba|bar|pub|kitchen|food|sweet|dessert|juice|tea|mess|tiffin|caterer' then 'food'
    when p_category ~* 'salon|spa|beauty|parlour|parlor|barber|nail|makeup|tattoo' then 'beauty'
    when p_category ~* 'gym|fitness|yoga|studio|dance|martial|crossfit|pilates|sports|swim' then 'fitness'
    when p_category ~* 'school|coaching|tuition|class|academy|institute|college|tutor|learning' then 'education'
    when p_category ~* 'clinic|doctor|dental|dentist|hospital|physio|pharmacy|chemist|vet|diagnostic|lab' then 'health'
    when p_category ~* 'shop|store|mart|boutique|retail|grocery|kirana|electronics|book|fashion|jewel|optical|hardware|florist' then 'store'
    when p_category ~* 'repair|service|laundry|tailor|cleaning|mechanic|garage|plumber|electrician|travel|photograph' then 'services'
    else 'other' end;
$$;
update public.places set kind = public.guess_place_kind(category) where kind = 'other';

create or replace function public.set_place_kind()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'other' then new.kind := public.guess_place_kind(new.category); end if;
  return new;
end $$;
drop trigger if exists places_set_kind on public.places;
create trigger places_set_kind before insert on public.places
  for each row execute function public.set_place_kind();

grant select (kind) on public.places to anon, authenticated;

-- Menu sections ("Starters", "Haircuts", "Monthly plans") for products.
alter table public.items add column if not exists section text check (section is null or length(section) <= 40);

-- Review tags per business type (null = every type).
alter table public.tags add column if not exists kinds text[];
update public.tags set kinds = '{food}' where label in ('Authentic', 'Generous portion', 'Great for groups') and kinds is null;
insert into public.tags (label, kinds) values
  ('Fresh', '{food}'), ('Good packaging', '{food,store}'),
  ('Genuine products', '{store}'), ('Good variety', '{store}'), ('Easy returns', '{store}'),
  ('Hygienic', '{beauty,health,food,fitness}'), ('Skilled staff', '{beauty,services}'), ('On time', '{beauty,health,services,education}'),
  ('Caring doctor', '{health}'), ('Short wait', '{health}'), ('Explains clearly', '{health,education}'),
  ('Clean', '{fitness,beauty,health}'), ('Good trainers', '{fitness}'), ('Good equipment', '{fitness}'), ('Crowded', '{fitness}'),
  ('Good teachers', '{education}'), ('Value for fees', '{education}'), ('Personal attention', '{education,fitness}'),
  ('Did it right first time', '{services}'), ('Fair quote', '{services}')
on conflict (label) do update set kinds = coalesce(public.tags.kinds, excluded.kinds);

-- Search: filter by business type and return it.
drop function if exists public.search_places(text, double precision, double precision, integer, text, integer, text, uuid);
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null, p_kind text default null)
returns table (
  place_id uuid, name text, category text, area text, price_level smallint, google_place_id text,
  distance_m integer, trust_score numeric, review_count integer, verified_count integer,
  friend_count integer, friend_ids uuid[], top_item text, has_qr boolean, kind text)
language sql stable security definer set search_path = public, extensions as $$
  with me as (select auth.uid() as uid),
  q as (select nullif(lower(btrim(p_query)), '') as txt),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  cand as (
    select p.*, case when here.pt is not null and p.location is not null
                     then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or p.city ilike btrim(p_city))
      and (p_area is null or btrim(p_area) = '' or p.area ilike btrim(p_area))
      and (p_kind is null or btrim(p_kind) = '' or p.kind = btrim(p_kind))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, p_radius_m)))),
  matched as (
    select r.*, i.name as item_name
    from public.reviews r
    join public.items i on i.id = r.item_id
    left join public.topics t on t.id = i.topic_id
    join cand c on c.id = r.place_id, q
    where r.status = 'published'
      and (q.txt is null or i.name_normalized like '%' || q.txt || '%'
           or lower(t.name) like '%' || q.txt || '%' or lower(c.name) like '%' || q.txt || '%'
           or lower(c.category) like '%' || q.txt || '%')),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from matched),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name, m.is_public,
      (case when fr.is_friend then 3.0
            when m.is_public and f.follower_id is not null then 3.0
            when m.is_public and uts.is_expert then 1.5 else 1.0 end)
      * (case when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      fr.is_friend
    from matched m
    cross join me
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.items i on i.id = m.item_id
    left join public.user_topic_stats uts on uts.user_id = m.user_id and uts.topic_id = i.topic_id
    cross join lateral (select public.are_friends(me.uid, m.user_id) as is_friend) fr),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv,
      count(distinct w.user_id) filter (where w.is_friend)::integer as nf_all,
      count(distinct w.user_id) filter (where w.is_friend and w.is_public)::integer as nf_named,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend and w.is_public), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w group by w.place_id)
  select c.id, c.name, c.category, c.area, c.price_level, c.google_place_id, c.dist,
         s.score, coalesce(s.n, 0), coalesce(s.nv, 0),
         coalesce(case when s.nf_all >= 2 then s.nf_all else s.nf_named end, 0),
         coalesce(s.fids, '{}'), s.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = c.id and qc.active),
         c.kind
  from cand c left join scored s on s.place_id = c.id, q
  where s.place_id is not null or q.txt is null
     or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
  order by s.score desc nulls last, c.dist asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid, text) to anon, authenticated;

-- ===== 20261016000014_review_by_scan.sql =====
-- Trusted Picks: reviews only from people who are at the shop.
--
-- Writing a review needs an open visit, which only scanning the shop's table QR creates.
-- Everyone else (invited friends, people browsing) can read but not review.
-- Guests (not signed in) get one review per shop per device: the app sends a random
-- device id it keeps on the phone; we store only its hash, never shown to anyone.
-- Signed-in people get one review per product per visit. Owners can't review their own shop.

alter table public.reviews add column if not exists device_hash text;
create index if not exists reviews_device_idx on public.reviews (place_id, device_hash) where device_hash is not null;

drop function if exists public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean);

create or replace function public.submit_review(
  p_place_id uuid, p_item_name text, p_rating smallint, p_body text default '',
  p_topic_id bigint default null, p_tag_ids bigint[] default '{}',
  p_ai_drafted boolean default false, p_voice_path text default null, p_photo_path text default null,
  p_is_public boolean default false, p_device text default null)
returns public.reviews
language plpgsql security definer set search_path = public, extensions as $$
declare it public.items; v_visit uuid; r public.reviews; v_topic bigint; v_name text;
        v_guest boolean := public.is_guest(); v_device text;
begin
  if auth.uid() is null then raise exception 'open the review page again to continue'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;

  -- Only at the shop: an open visit from a table QR scan.
  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;
  if v_visit is null then raise exception 'scan the table QR at the shop to write a review'; end if;
  if public.is_place_owner(p_place_id) then raise exception 'you can''t review your own shop'; end if;

  v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
  if v_guest then
    if v_device is null then raise exception 'refresh the page and try again'; end if;
    if exists (select 1 from public.reviews where place_id = p_place_id
               and (user_id = auth.uid() or (device_hash = v_device and by_guest))) then
      raise exception 'you''ve already reviewed this place from this phone. Sign in to review more';
    end if;
  end if;

  if (select count(*) from public.reviews where user_id = auth.uid() and created_at > now() - interval '1 day')
     >= (case when v_guest then 5 else 25 end) then
    raise exception 'that''s a lot of reviews for one day. Try again tomorrow';
  end if;
  v_name := btrim(coalesce(p_item_name, ''));
  if v_name = '' then raise exception 'say what you had'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'pick 1 to 5 stars'; end if;
  if length(coalesce(p_body, '')) > 2000 then raise exception 'keep the review under 2000 characters'; end if;
  if p_photo_path is not null and not exists (
      select 1 from storage.objects o where o.bucket_id = 'review-photos' and o.name = p_photo_path and o.owner = auth.uid()) then
    raise exception 'photo upload not found';
  end if;
  if p_voice_path is not null and not exists (
      select 1 from storage.objects o where o.bucket_id = 'voice' and o.name = p_voice_path and o.owner = auth.uid()) then
    raise exception 'voice note upload not found';
  end if;

  v_topic := coalesce(p_topic_id,
    (select t.id from public.topics t where lower(v_name) like '%' || lower(t.name) || '%' order by length(t.name) desc limit 1),
    (select t.id from public.topics t join public.places p on p.id = p_place_id
      where lower(p.category) like '%' || lower(t.name) || '%' order by length(t.name) desc limit 1));

  insert into public.items (place_id, topic_id, name)
  values (p_place_id, v_topic, v_name)
  on conflict (place_id, name_normalized) do update
    set topic_id = coalesce(public.items.topic_id, excluded.topic_id)
  returning * into it;

  if exists (select 1 from public.reviews where user_id = auth.uid() and visit_id = v_visit and item_id = it.id) then
    raise exception 'you''ve already reviewed % on this visit', it.name;
  end if;

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, voice_path, photo_path, visit_id, is_public, by_guest, device_hash)
  values (auth.uid(), p_place_id, it.id, p_rating, coalesce(p_body, ''), p_ai_drafted, p_voice_path, p_photo_path, v_visit,
          coalesce(p_is_public, false) and not v_guest, v_guest, v_device)
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t from unnest(coalesce(p_tag_ids, '{}')) t
  on conflict do nothing;

  return r;
end $$;
revoke execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean, text) from public, anon;
grant execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean, text) to authenticated;

-- The review screen asks this before showing the form: is there an open visit here,
-- and has this guest already used their one review?
create or replace function public.can_review(p_place uuid, p_device text default null)
returns table (allowed boolean, reason text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v public.visits; v_device text;
begin
  if auth.uid() is null then return query select false, 'scan', null::timestamptz; return; end if;
  select * into v from public.visits
  where user_id = auth.uid() and place_id = p_place and now() between scanned_at and visits.expires_at
  order by scanned_at desc limit 1;
  if v.id is null then return query select false, 'scan', null::timestamptz; return; end if;
  if public.is_place_owner(p_place) then return query select false, 'owner', v.expires_at; return; end if;
  if public.is_guest() then
    v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
    if exists (select 1 from public.reviews where place_id = p_place
               and (user_id = auth.uid() or (v_device is not null and device_hash = v_device and by_guest))) then
      return query select false, 'guest_used', v.expires_at; return;
    end if;
  end if;
  return query select true, 'ok', v.expires_at;
end $$;
grant execute on function public.can_review(uuid, text) to authenticated;
