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

-- ===== 20261016000015_review_links.sql =====
-- Trusted Picks: the shop's review link, the only way to review besides the table QR.
--
-- An owner creates a link for one customer (say after a delivery or appointment) and sends it
-- on WhatsApp. Each link works once, for one person, and expires in a few days; a shop can make
-- only a few a day. Opening it gives that person a visit, like scanning the table QR.
-- Link reviews count a little less than table scans, because the shop chooses who gets a link.
-- The shop never learns which review came from which link.

insert into public.app_settings (key, value) values
  ('review_links_per_day', '10'), ('review_link_days', '3')
on conflict (key) do nothing;

alter table public.visits add column if not exists source text not null default 'qr';
do $$ begin
  alter table public.visits add constraint visits_source_check check (source in ('qr', 'link'));
exception when duplicate_object then null; end $$;

create table if not exists public.review_links (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  token       text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  visit_id    uuid references public.visits (id) on delete set null
);
create index if not exists review_links_place_idx on public.review_links (place_id, created_at desc);
-- Only the functions below touch it: nobody can list links or see who used one.
alter table public.review_links enable row level security;
revoke all on public.review_links from anon, authenticated;

-- Owner (or admin): make a new single-use link.
create or replace function public.create_review_link(p_place uuid)
returns table (token text, expires_at timestamptz, left_today integer)
language plpgsql security definer set search_path = public, extensions as $$
declare v_cap integer := public.setting_int('review_links_per_day', 10); v_made integer; l public.review_links;
begin
  if not public.can_manage_place(p_place) then raise exception 'only the shop owner can make review links'; end if;
  if not exists (select 1 from public.places where id = p_place and status = 'live') then
    raise exception 'your shop isn''t live yet';
  end if;
  select count(*) into v_made from public.review_links r
  where r.place_id = p_place and r.created_at > now() - interval '1 day';
  if v_made >= v_cap and not public.is_admin() then
    raise exception 'you''ve made % review links today. Make more tomorrow', v_cap;
  end if;
  insert into public.review_links (place_id, expires_at)
  values (p_place, now() + make_interval(days => public.setting_int('review_link_days', 3)))
  returning * into l;
  return query select l.token, l.expires_at, greatest(v_cap - v_made - 1, 0);
end $$;
revoke execute on function public.create_review_link(uuid) from public, anon;
grant execute on function public.create_review_link(uuid) to authenticated;

-- Owner: how many links today, and how many were used (totals only, never which).
create or replace function public.review_link_counts(p_place uuid)
returns table (made_today integer, left_today integer, used_30d integer, made_30d integer)
language plpgsql stable security definer set search_path = public as $$
declare v_cap integer := public.setting_int('review_links_per_day', 10); v_today integer;
begin
  if not public.can_manage_place(p_place) then raise exception 'only the shop owner can see this'; end if;
  select count(*) into v_today from public.review_links where place_id = p_place and created_at > now() - interval '1 day';
  return query select v_today, greatest(v_cap - v_today, 0),
    (select count(*)::integer from public.review_links where place_id = p_place and used_at > now() - interval '30 days'),
    (select count(*)::integer from public.review_links where place_id = p_place and created_at > now() - interval '30 days');
end $$;
grant execute on function public.review_link_counts(uuid) to authenticated;

-- Anyone: which shop is this link for, and does it still work?
create or replace function public.peek_review_link(p_token text)
returns table (place_id uuid, place_name text, area text, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area,
         case when l.used_at is not null then 'used' when l.expires_at < now() then 'expired' else 'ok' end
  from public.review_links l join public.places p on p.id = l.place_id
  where l.token = p_token and p.status = 'live';
$$;
grant execute on function public.peek_review_link(text) to anon, authenticated;

-- The customer opens the link: it's used up and they get a visit. Opening it again
-- from the same account gives back the same visit.
create or replace function public.redeem_review_link(p_token text)
returns table (visit_id uuid, place_id uuid, place_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare l public.review_links; v public.visits; v_name text;
begin
  if auth.uid() is null then raise exception 'open the link again to continue'; end if;
  select * into l from public.review_links where token = p_token for update;
  if l.id is null then raise exception 'this review link doesn''t work'; end if;
  select name into v_name from public.places where id = l.place_id and status = 'live';
  if v_name is null then raise exception 'this shop isn''t listed right now'; end if;

  if l.used_at is not null then
    select * into v from public.visits where id = l.visit_id and user_id = auth.uid();
    if v.id is null then raise exception 'this review link was already used. Ask the shop for a new one'; end if;
    return query select v.id, l.place_id, v_name, v.expires_at; return;
  end if;
  if l.expires_at < now() then raise exception 'this review link has expired. Ask the shop for a new one'; end if;
  if public.is_place_owner(l.place_id) then raise exception 'you can''t review your own shop'; end if;

  insert into public.visits (user_id, place_id, source, expires_at)
  values (auth.uid(), l.place_id, 'link', now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
  returning * into v;
  update public.review_links set used_at = now(), visit_id = v.id where id = l.id;
  return query select v.id, l.place_id, v_name, v.expires_at;
end $$;
revoke execute on function public.redeem_review_link(text) from public, anon;
grant execute on function public.redeem_review_link(text) to authenticated;

-- Table QR: scanning again at the same shop reuses the open visit, and one account can't
-- collect visits at many shops in a day (a photo of a QR shared around stops working fast).
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

  select * into v from public.visits vv
  where vv.user_id = auth.uid() and vv.place_id = q.place_id and now() between vv.scanned_at and vv.expires_at
  order by vv.scanned_at desc limit 1;
  if v.id is null then
    if (select count(distinct vv.place_id) from public.visits vv
        where vv.user_id = auth.uid() and vv.scanned_at > now() - interval '1 day') >= 8 then
      raise exception 'that''s a lot of shops for one day. Try again tomorrow';
    end if;
    insert into public.visits (user_id, place_id, qr_code_id, expires_at)
    values (auth.uid(), q.place_id, q.id, now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
    returning * into v;
  end if;
  return query select v.id, q.place_id, q.name, q.area, q.table_label, v.expires_at;
end $$;

-- Ranking: a review from a shop's link counts 1.2x, a table scan 1.5x.
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
      * (case when vs.source = 'link' then 1.2 when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      fr.is_friend
    from matched m
    cross join me
    left join public.visits vs on vs.id = m.visit_id
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

-- ===== 20261016000016_ai.sql =====
-- Trusted Picks: AI runs only inside the Supabase Edge Function "ai" (key = Supabase secret).
-- The browser never holds an AI key and never calls the AI directly.

-- "What people say" for each shop, written by the edge function at most once a day.
create table if not exists public.place_ai_summaries (
  place_id     uuid primary key references public.places (id) on delete cascade,
  summary      text not null default '',
  highlights   text[] not null default '{}',
  review_count integer not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.place_ai_summaries enable row level security;
revoke all on public.place_ai_summaries from anon, authenticated;
grant select on public.place_ai_summaries to anon, authenticated;
drop policy if exists "summaries of live places are public" on public.place_ai_summaries;
create policy "summaries of live places are public" on public.place_ai_summaries for select
  using (exists (select 1 from public.places p where p.id = place_id and p.status = 'live'));

-- How much AI help each person used today. Nobody can read or change it except the edge function.
create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null default current_date,
  calls   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Count a call if it fits today's allowance. Only the edge function (service role) may call it.
create or replace function public.ai_take(p_user uuid, p_cost integer, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.ai_usage (user_id, day, calls) values (p_user, current_date, 0)
  on conflict (user_id, day) do nothing;
  update public.ai_usage set calls = calls + greatest(p_cost, 1)
  where user_id = p_user and day = current_date and calls + greatest(p_cost, 1) <= p_limit
  returning calls into v;
  delete from public.ai_usage where day < current_date - 7;
  return v is not null;
end $$;
revoke execute on function public.ai_take(uuid, integer, integer) from public, anon, authenticated;
do $$ begin
  grant execute on function public.ai_take(uuid, integer, integer) to service_role;
exception when undefined_object then null; end $$;

-- ===== 20261016000017_trust_checks.sql =====
-- Trusted Picks: harder to fake, easier to spot.
-- 1. Location check on table scans: the app may send the phone's position with a scan. We keep only
--    whether it was near the shop (true/false/unknown), never the position itself. Far-away scans
--    still work but their reviews count much less, so a shared photo of a QR is nearly worthless.
-- 2. Every review says how it got here: from a table scan or from the shop's link.
-- 3. Anyone can report a review; admins see reports and patterns in one list.

alter table public.visits add column if not exists near boolean;

drop function if exists public.scan_qr(text);
create or replace function public.scan_qr(p_token text, p_lat double precision default null, p_lng double precision default null)
returns table (visit_id uuid, place_id uuid, place_name text, area text, table_label text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare q record; v public.visits; v_near boolean;
begin
  if auth.uid() is null then raise exception 'sign in to scan'; end if;
  select qc.id, qc.place_id, qc.table_label, p.name, p.area, p.location into q
  from public.qr_codes qc join public.places p on p.id = qc.place_id
  where qc.token = p_token and qc.active and p.status = 'live';
  if not found then raise exception 'unknown or inactive code'; end if;

  if q.location is not null and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_near := st_dwithin(q.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                         public.setting_int('scan_near_meters', 300));
  end if;

  select * into v from public.visits vv
  where vv.user_id = auth.uid() and vv.place_id = q.place_id and now() between vv.scanned_at and vv.expires_at
  order by vv.scanned_at desc limit 1;
  if v.id is null then
    if (select count(distinct vv.place_id) from public.visits vv
        where vv.user_id = auth.uid() and vv.scanned_at > now() - interval '1 day') >= 8 then
      raise exception 'that''s a lot of shops for one day. Try again tomorrow';
    end if;
    insert into public.visits (user_id, place_id, qr_code_id, near, expires_at)
    values (auth.uid(), q.place_id, q.id, v_near, now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
    returning * into v;
  elsif v_near is true and v.near is distinct from true then
    update public.visits set near = true where id = v.id returning * into v;  -- a later scan at the shop upgrades it
  end if;
  return query select v.id, q.place_id, q.name, q.area, q.table_label, v.expires_at;
end $$;
revoke execute on function public.scan_qr(text, double precision, double precision) from public, anon;
grant execute on function public.scan_qr(text, double precision, double precision) to authenticated;

-- How a review got here, for the review cards: 'table' or 'link'.
create or replace view public.review_feed with (security_barrier = true) as
  select r.id,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.user_id end as user_id,
         r.place_id, r.item_id, r.rating, r.body, r.ai_drafted,
         (r.visit_id is not null) as verified,
         r.photo_path,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.voice_path end as voice_path,
         r.status, r.is_public, r.created_at,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.display_name end as author_name,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.avatar_path end as author_avatar,
         (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id) as source
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  where r.status = 'published' or r.user_id = auth.uid() or public.is_admin();
revoke all on public.review_feed from public, anon, authenticated;
grant select on public.review_feed to anon, authenticated;

-- Reports. Reporters stay private; only admins read them.
create table if not exists public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews (id) on delete cascade,
  reporter    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason      text not null check (reason in ('fake', 'offensive', 'wrong_place', 'personal_info', 'other')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (review_id, reporter)
);
alter table public.review_reports enable row level security;
revoke all on public.review_reports from anon, authenticated;
grant select, update on public.review_reports to authenticated;
drop policy if exists "admins read reports" on public.review_reports;
create policy "admins read reports" on public.review_reports for select to authenticated using (public.is_admin());
drop policy if exists "admins resolve reports" on public.review_reports;
create policy "admins resolve reports" on public.review_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.report_review(p_review uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'open the page again to report'; end if;
  if p_reason not in ('fake', 'offensive', 'wrong_place', 'personal_info', 'other') then raise exception 'pick a reason'; end if;
  if not exists (select 1 from public.reviews where id = p_review and status = 'published') then raise exception 'review not found'; end if;
  if (select count(*) from public.review_reports where reporter = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'that''s a lot of reports for one day. Try again tomorrow';
  end if;
  insert into public.review_reports (review_id, reason) values (p_review, p_reason)
  on conflict (review_id, reporter) do update set reason = excluded.reason, created_at = now(), resolved_at = null;
end $$;
revoke execute on function public.report_review(uuid, text) from public, anon;
grant execute on function public.report_review(uuid, text) to authenticated;

-- Admin: things worth a look, newest patterns first. Counts and reviews only, never who.
create or replace function public.admin_alerts()
returns table (kind text, place_id uuid, place_name text, review_id uuid, detail text, n integer, seen_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
  -- Reported reviews still open.
  select 'reported'::text, r.place_id, p.name, r.id,
         string_agg(distinct rr.reason, ', ') || ': ' || left(coalesce(nullif(r.body, ''), '(no text)'), 80),
         count(*)::integer, max(rr.created_at)
  from public.review_reports rr join public.reviews r on r.id = rr.review_id join public.places p on p.id = r.place_id
  where rr.resolved_at is null and r.status = 'published'
  group by r.id, r.place_id, p.name, r.body
  union all
  -- A burst of glowing reviews in a day.
  select 'burst', p.id, p.name, null::uuid,
         count(*) || ' reviews in 24 hours, average ' || round(avg(r.rating), 1),
         count(*)::integer, max(r.created_at)
  from public.reviews r join public.places p on p.id = r.place_id
  where r.created_at > now() - interval '1 day' and r.status = 'published'
  group by p.id, p.name having count(*) >= 8 and avg(r.rating) >= 4.5
  union all
  -- Reviews from scans that were far from the shop.
  select 'far_scans', p.id, p.name, null::uuid,
         count(*) || ' reviews this week from scans far from the shop',
         count(*)::integer, max(r.created_at)
  from public.reviews r join public.visits v on v.id = r.visit_id join public.places p on p.id = r.place_id
  where v.near is false and r.created_at > now() - interval '7 days' and r.status = 'published'
  group by p.id, p.name having count(*) >= 3
  union all
  -- Shop-link reviews much rosier than table reviews.
  select 'link_skew', s.place_id, p.name, null::uuid,
         'link reviews ' || round(s.link_avg, 1) || ' vs table ' || round(s.table_avg, 1),
         s.link_n, now()
  from (select r.place_id,
               avg(r.rating) filter (where v.source = 'link') as link_avg, avg(r.rating) filter (where v.source = 'qr') as table_avg,
               (count(*) filter (where v.source = 'link'))::integer as link_n, (count(*) filter (where v.source = 'qr'))::integer as table_n
        from public.reviews r join public.visits v on v.id = r.visit_id
        where r.created_at > now() - interval '30 days' and r.status = 'published'
        group by r.place_id) s
  join public.places p on p.id = s.place_id
  where s.link_n >= 3 and s.table_n >= 3 and s.link_avg - s.table_avg >= 1.5
  union all
  -- One phone writing a lot of guest reviews.
  select 'busy_device', null::uuid, null::text, null::uuid,
         count(*) || ' guest reviews from one phone across ' || count(distinct r.place_id) || ' shops in 24 hours',
         count(*)::integer, max(r.created_at)
  from public.reviews r
  where r.device_hash is not null and r.created_at > now() - interval '1 day'
  group by r.device_hash having count(*) >= 5
  order by 7 desc nulls last;
end $$;
grant execute on function public.admin_alerts() to authenticated;

-- Ranking: table scan at the shop 1.5x, shop link 1.2x, scan with location unknown 1.0x, scan far from the shop 0.4x.
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
      * (case when vs.source = 'link' then 1.2 when vs.near is false then 0.4 when vs.near is null and m.visit_id is not null then 1.0 when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      fr.is_friend
    from matched m
    cross join me
    left join public.visits vs on vs.id = m.visit_id
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

-- ===== 20261017000018_review_tags_tone.sql =====
-- Trusted Picks: "could be better" review tags, so a review can say what was good and what wasn't.
-- The app groups tags by these labels; no column change needed.
insert into public.tags (label, kinds) values
  ('Small portion', '{food}'), ('Not fresh', '{food}'), ('Served cold', '{food}'), ('Too oily', '{food}'),
  ('Rude staff', null), ('Not clean', null), ('Long wait', '{beauty,health,services,food}'),
  ('Poor quality', '{store,services}'), ('Damaged item', '{store}'), ('Pushy selling', '{store,beauty,fitness}'),
  ('Late', '{beauty,health,services,education}'), ('Overcharged', '{services,beauty,health}'),
  ('Rushed', '{health,beauty,education}'), ('Old equipment', '{fitness}')
on conflict (label) do nothing;

-- ===== 20261017000020_plans.sql =====
-- Trusted Picks: free listing for every business, plans that switch reviews on, and per-QR review limits.
--  * Listing is free and never lapses. What a plan buys is review QRs.
--  * Every shop starts with a trial: 1 review QR for 30 days or 25 reviews.
--  * When a plan or trial ends, QRs still open the shop page; only new reviews pause.
--    Customers never see an expiry date.
--  * Each QR has a small "jar" of review tickets that refills over time, sized by business type,
--    so a whole table can review together but nobody can post twenty in a row.

-- ---------- Plans ----------
create table if not exists public.plans (
  code             text primary key,
  name             text not null,
  qr_limit         integer not null,
  price_inr_year   integer,
  price_inr_month  integer,
  price_usd_year   integer,
  price_usd_month  integer,
  features         text[] not null default '{}',
  sort_order       integer not null default 0
);
alter table public.plans enable row level security;
drop policy if exists "anyone reads plans" on public.plans;
create policy "anyone reads plans" on public.plans for select using (true);
grant select on public.plans to anon, authenticated;

insert into public.plans (code, name, qr_limit, price_inr_year, price_inr_month, price_usd_year, price_usd_month, features, sort_order) values
  ('trial',    'Free trial', 1,  0,    0,   0,   0,  '{"1 review QR","30 days or 25 reviews"}', 0),
  ('starter',  'Starter',    5,  1499, 149, 39,  4,  '{"5 review QRs","Styled QRs and print kit","Review links"}', 1),
  ('standard', 'Standard',   15, 2999, 299, 79,  8,  '{"15 review QRs","Everything in Starter","Insights"}', 2),
  ('pro',      'Pro',        40, 5999, 599, 149, 15, '{"40 review QRs","Everything in Standard","AI insights and offers"}', 3)
on conflict (code) do nothing;

-- ---------- Subscriptions: one per shop ----------
create table if not exists public.subscriptions (
  place_id                  uuid primary key references public.places (id) on delete cascade,
  plan                      text not null references public.plans (code),
  status                    text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  period_end                timestamptz not null,
  trial_reviews_left        integer not null default 25,
  billing_interval          text check (billing_interval in ('month', 'year')),
  provider                  text,
  provider_customer_id      text,
  provider_subscription_id  text,
  cancel_at_period_end      boolean not null default false,
  updated_at                timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "owners read their subscription" on public.subscriptions;
create policy "owners read their subscription" on public.subscriptions for select to authenticated
  using (public.is_place_owner(place_id) or public.is_admin());
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- Every shop gets a trial; shops that paid for a listing keep a Starter plan until their paid date.
insert into public.subscriptions (place_id, plan, status, period_end, trial_reviews_left)
select p.id,
       case when p.listed_until is not null and p.listed_until >= current_date then 'starter' else 'trial' end,
       case when p.listed_until is not null and p.listed_until >= current_date then 'active' else 'trial' end,
       case when p.listed_until is not null and p.listed_until >= current_date then p.listed_until::timestamptz else now() + interval '30 days' end,
       25
from public.places p
on conflict (place_id) do nothing;

create or replace function public.place_start_trial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (place_id, plan, status, period_end)
  values (new.id, 'trial', 'trial', now() + interval '30 days')
  on conflict (place_id) do nothing;
  return new;
end $$;
drop trigger if exists places_start_trial on public.places;
create trigger places_start_trial after insert on public.places
  for each row execute function public.place_start_trial();

-- Listing is free now: nothing lapses, and shops that lapsed come back.
update public.places set status = 'live' where status = 'lapsed';
create or replace function public.lapse_expired_listings()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  -- Ended trials and plans stop taking reviews; the shop page stays up.
  update public.subscriptions set status = 'expired', updated_at = now()
  where status in ('trial', 'active', 'past_due', 'cancelled') and period_end < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Are reviews open at this shop? ----------
create or replace function public.reviews_open(p_place uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when s.status = 'trial' then s.period_end > now() and s.trial_reviews_left > 0
      when s.status in ('active', 'past_due', 'cancelled') then s.period_end > now()
      else false end
    from public.subscriptions s where s.place_id = p_place), false);
$$;
grant execute on function public.reviews_open(uuid) to anon, authenticated;

-- A plan's QR limit.
create or replace function public.place_qr_limit(p_place uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select pl.qr_limit from public.subscriptions s join public.plans pl on pl.code = s.plan
                   where s.place_id = p_place and s.status <> 'expired'), 1);
$$;
grant execute on function public.place_qr_limit(uuid) to authenticated;

create or replace function public.check_qr_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim integer; n integer;
begin
  -- The SQL editor and server jobs (no signed-in user) and admins aren't limited.
  if auth.uid() is null or public.is_admin() or not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  lim := public.place_qr_limit(new.place_id);
  select count(*) into n from public.qr_codes where place_id = new.place_id and active and id <> new.id;
  if n >= lim then raise exception 'your plan includes % review QR%. Upgrade for more', lim, case when lim = 1 then '' else 's' end; end if;
  return new;
end $$;
drop trigger if exists qr_codes_limit on public.qr_codes;
create trigger qr_codes_limit before insert or update of active on public.qr_codes
  for each row execute function public.check_qr_limit();

-- ---------- Review ticket jars per QR ----------
alter table public.qr_codes add column if not exists seats integer check (seats is null or seats between 1 and 20);
alter table public.qr_codes add column if not exists jar_size integer check (jar_size is null or jar_size between 1 and 20);
alter table public.qr_codes add column if not exists refill_seconds integer check (refill_seconds is null or refill_seconds between 30 and 86400);
alter table public.qr_codes add column if not exists tickets double precision;
alter table public.qr_codes add column if not exists tickets_at timestamptz;

-- Jar size and refill time by business type: a table refills slowly, a counter quickly.
create or replace function public.qr_jar(p_qr uuid)
returns table (size integer, refill integer)
language sql stable security definer set search_path = public as $$
  select coalesce(q.jar_size, q.seats, case coalesce(p.kind, 'food')
           when 'food' then 4 when 'store' then 3 when 'beauty' then 1 when 'health' then 1 else 2 end),
         coalesce(q.refill_seconds, case coalesce(p.kind, 'food')
           when 'food' then 900 when 'store' then 120 when 'beauty' then 1500 when 'health' then 1500
           when 'fitness' then 3600 when 'education' then 3600 when 'services' then 3600 else 600 end)
  from public.qr_codes q join public.places p on p.id = q.place_id where q.id = p_qr;
$$;

-- Runs before a review is saved: reviews must be open here, and a QR visit takes one ticket from its jar.
-- Several items rated in one visit cost one ticket, so a person can rate their whole meal.
create or replace function public.check_review_allowed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.visits; j record; q public.qr_codes; t double precision; wait_min integer;
begin
  if new.visit_id is null or public.is_admin() then return new; end if;
  if not public.reviews_open(new.place_id) then
    raise exception 'reviews are paused at this shop for now';
  end if;
  select * into v from public.visits where id = new.visit_id;
  if v.qr_code_id is not null and not exists (select 1 from public.reviews where visit_id = new.visit_id) then
    select * into q from public.qr_codes where id = v.qr_code_id for update;
    select * into j from public.qr_jar(q.id);
    t := least(j.size, coalesce(q.tickets, j.size) + extract(epoch from now() - coalesce(q.tickets_at, now())) / j.refill);
    if t < 1 then
      wait_min := greatest(1, ceil((1 - t) * j.refill / 60.0));
      raise exception 'lots of reviews from this table just now. Try again in about % minute%', wait_min, case when wait_min = 1 then '' else 's' end;
    end if;
    update public.qr_codes set tickets = t - 1, tickets_at = now() where id = q.id;
  end if;
  update public.subscriptions set trial_reviews_left = greatest(trial_reviews_left - 1, 0), updated_at = now()
  where place_id = new.place_id and status = 'trial';
  return new;
end $$;
drop trigger if exists reviews_check_allowed on public.reviews;
create trigger reviews_check_allowed before insert on public.reviews
  for each row execute function public.check_review_allowed();

-- can_review also says when reviews are paused (no dates, no reasons shown to customers).
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
  if not public.reviews_open(p_place) then return query select false, 'paused', v.expires_at; return; end if;
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

-- Owners see their plan, QR use and review status in one call.
create or replace function public.my_plan(p_place uuid)
returns table (plan text, plan_name text, status text, period_end timestamptz, trial_reviews_left integer,
               qr_limit integer, qr_used integer, reviews_open boolean, cancel_at_period_end boolean, billing_interval text)
language sql stable security definer set search_path = public as $$
  select s.plan, pl.name, s.status, s.period_end, s.trial_reviews_left, pl.qr_limit,
         (select count(*)::integer from public.qr_codes q where q.place_id = p_place and q.active),
         public.reviews_open(p_place), s.cancel_at_period_end, s.billing_interval
  from public.subscriptions s join public.plans pl on pl.code = s.plan
  where s.place_id = p_place and (public.is_place_owner(p_place) or public.is_admin());
$$;
grant execute on function public.my_plan(uuid) to authenticated;

-- ===== 20261017000021_billing.sql =====
-- Trusted Picks: Razorpay payments for plans (India). One payment buys a month or a year;
-- nothing renews on its own, so there's no lock-in and nothing to cancel.
-- Only the edge functions "billing" and "billing-webhook" (service role) write here.

create table if not exists public.billing_orders (
  id                   uuid primary key default gen_random_uuid(),
  place_id             uuid not null references public.places (id) on delete cascade,
  plan                 text not null references public.plans (code),
  billing_interval     text not null check (billing_interval in ('month', 'year')),
  currency             text not null default 'INR',
  amount_minor         integer not null check (amount_minor > 0),
  provider             text not null default 'razorpay',
  provider_order_id    text unique,
  provider_payment_id  text,
  status               text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded')),
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  paid_at              timestamptz
);
create index if not exists billing_orders_place on public.billing_orders (place_id, created_at desc);
alter table public.billing_orders enable row level security;
drop policy if exists "owners read their orders" on public.billing_orders;
create policy "owners read their orders" on public.billing_orders for select to authenticated
  using (public.is_place_owner(place_id) or public.is_admin());
revoke all on public.billing_orders from anon, authenticated;
grant select on public.billing_orders to authenticated;

-- Each provider event is handled once.
create table if not exists public.billing_events (
  id           text primary key,
  provider     text not null default 'razorpay',
  kind         text not null,
  received_at  timestamptz not null default now()
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

-- Marks an order paid and extends the shop's plan. Safe to call twice (verify + webhook).
-- Time left on a paid plan carries over; a trial ends when a plan starts.
create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.billing_orders; s public.subscriptions; base timestamptz;
begin
  select * into o from public.billing_orders where provider_order_id = p_order for update;
  if o.id is null then return false; end if;
  if o.status = 'paid' then return true; end if;
  if p_amount is not null and p_amount <> o.amount_minor then
    update public.billing_orders set status = 'failed' where id = o.id;
    return false;
  end if;
  update public.billing_orders set status = 'paid', provider_payment_id = p_payment, paid_at = now() where id = o.id;
  select * into s from public.subscriptions where place_id = o.place_id for update;
  base := case when s.status in ('active', 'past_due', 'cancelled') and s.period_end > now() then s.period_end else now() end;
  insert into public.subscriptions (place_id, plan, status, period_end, billing_interval, provider, updated_at)
  values (o.place_id, o.plan, 'active', base + case when o.billing_interval = 'year' then interval '1 year' else interval '1 month' end,
          o.billing_interval, 'razorpay', now())
  on conflict (place_id) do update set plan = excluded.plan, status = 'active', period_end = excluded.period_end,
    billing_interval = excluded.billing_interval, provider = 'razorpay', cancel_at_period_end = false, updated_at = now();
  return true;
end $$;
revoke all on function public.billing_mark_paid(text, text, integer) from public, anon, authenticated;

-- Admins see every plan payment.
create or replace function public.admin_billing(p_limit integer default 100)
returns table (id uuid, place_id uuid, place_name text, plan text, billing_interval text, currency text,
               amount_minor integer, status text, provider_payment_id text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.place_id, p.name, o.plan, o.billing_interval, o.currency, o.amount_minor, o.status,
         o.provider_payment_id, o.created_at, o.paid_at
  from public.billing_orders o join public.places p on p.id = o.place_id
  where public.is_admin()
  order by o.created_at desc limit least(greatest(p_limit, 1), 500);
$$;
grant execute on function public.admin_billing(integer) to authenticated;

-- ===== 20261017000022_claims.sql =====
-- Trusted Picks: owners claim their shop. Proof = standing at the shop (location check)
-- plus a photo of the shop front. An admin approves; the claimer becomes the owner.
-- If the shop already has an owner, the request is "access" and the admin decides.
-- Locations are never stored, only whether the person was near the shop.

insert into storage.buckets (id, name, public) values ('claim-photos', 'claim-photos', false)
on conflict (id) do nothing;
drop policy if exists "own claim photos" on storage.objects;
create policy "own claim photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-photos' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists "admins read claim photos" on storage.objects;
create policy "admins read claim photos" on storage.objects for select to authenticated
  using (bucket_id = 'claim-photos' and (public.is_admin() or split_part(name, '/', 1) = auth.uid()::text));

create table if not exists public.place_claims (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null default 'claim' check (kind in ('claim', 'access')),
  near        boolean,
  photo_path  text,
  role        text,
  phone       text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create unique index if not exists place_claims_one_open on public.place_claims (place_id, user_id) where status = 'pending';
alter table public.place_claims enable row level security;
drop policy if exists "own claims readable" on public.place_claims;
create policy "own claims readable" on public.place_claims for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke all on public.place_claims from anon, authenticated;
grant select on public.place_claims to authenticated;

-- Start a claim. Signed-in, non-guest accounts only; 3 open claims at a time.
create or replace function public.claim_place(p_place uuid, p_lat double precision, p_lng double precision,
                                              p_photo text, p_role text default null, p_phone text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places; v_near boolean; v_kind text;
begin
  if auth.uid() is null or public.is_guest() then raise exception 'sign in to claim a shop'; end if;
  select * into pl from public.places where id = p_place;
  if pl.id is null then raise exception 'shop not found'; end if;
  if pl.owner_id = auth.uid() then return 'owner'; end if;
  if p_photo is null or split_part(p_photo, '/', 1) <> auth.uid()::text then raise exception 'add a photo of the shop front'; end if;
  if (select count(*) from public.place_claims where user_id = auth.uid() and status = 'pending') >= 3 then
    raise exception 'you have 3 claims waiting. We''ll check them soon';
  end if;
  if pl.location is not null and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_near := st_dwithin(pl.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, 300);
  end if;
  v_kind := case when pl.owner_id is null then 'claim' else 'access' end;
  insert into public.place_claims (place_id, user_id, kind, near, photo_path, role, phone)
  values (p_place, auth.uid(), v_kind, v_near, p_photo, left(btrim(coalesce(p_role, '')), 60), left(btrim(coalesce(p_phone, '')), 20))
  on conflict (place_id, user_id) where status = 'pending'
  do update set near = excluded.near, photo_path = excluded.photo_path, role = excluded.role, phone = excluded.phone, created_at = now();
  return v_kind;
end $$;
grant execute on function public.claim_place(uuid, double precision, double precision, text, text, text) to authenticated;

-- Admin: open claims with what they need to decide.
create or replace function public.admin_claims()
returns table (id uuid, place_id uuid, place_name text, area text, kind text, near boolean, photo_path text,
               role text, phone text, claimer_name text, has_owner boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.place_id, p.name, p.area, c.kind, c.near, c.photo_path, c.role, c.phone,
         pr.display_name, p.owner_id is not null, c.created_at
  from public.place_claims c join public.places p on p.id = c.place_id
  left join public.profiles pr on pr.id = c.user_id
  where public.is_admin() and c.status = 'pending'
  order by c.created_at;
$$;
grant execute on function public.admin_claims() to authenticated;

create or replace function public.decide_claim(p_claim uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c public.place_claims;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into c from public.place_claims where id = p_claim and status = 'pending' for update;
  if c.id is null then raise exception 'claim already handled'; end if;
  update public.place_claims set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now() where id = c.id;
  if p_approve then
    update public.places set owner_id = c.user_id where id = c.place_id;
    update public.place_claims set status = 'rejected', decided_at = now()
    where place_id = c.place_id and status = 'pending' and id <> c.id;
  end if;
end $$;
grant execute on function public.decide_claim(uuid, boolean) to authenticated;

-- ===== 20261017000023_invite_only.sql =====
-- Trusted Picks: connections are invite-only. Nobody can find people by name or from
-- suggestions, and you can only follow someone who is already your friend through a link.
revoke execute on function public.find_people(text, integer) from public, anon, authenticated;
revoke execute on function public.suggested_people(bigint, integer) from public, anon, authenticated;

drop policy if exists "follow" on public.follows;
create policy "follow" on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and exists (
    select 1 from public.friendships f where f.user_id = auth.uid() and f.friend_id = follows.followee_id));

-- ===== 20261017000024_signup_payment.sql =====
-- Trusted Picks: business sign-up is a step-by-step flow (shop, details, tables and QR, plan, pay).
-- Payment comes last, through Razorpay, and attaches to the sign-up request. When the team
-- approves the request, the paid plan starts on the new shop. Admins can also give or extend a
-- plan by hand and edit plan prices.

-- ---------- Sign-up requests carry the plan, tables and billing period ----------
alter table public.listing_requests add column if not exists plan text references public.plans (code);
alter table public.listing_requests add column if not exists billing_interval text check (billing_interval in ('month', 'year'));
alter table public.listing_requests add column if not exists tables integer check (tables is null or tables between 0 and 200);

create or replace function public.prepare_listing_request()
returns trigger language plpgsql set search_path = public as $$
declare pr public.plans; price integer;
begin
  new.requester_id := auth.uid();
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.place_id := null;
  select * into pr from public.plans where code = coalesce(new.plan, 'trial');
  if pr.code is null then pr.code := 'trial'; pr.qr_limit := 1; end if;
  new.plan := pr.code;
  new.billing_interval := case when pr.code = 'trial' then null else coalesce(new.billing_interval, 'year') end;
  if coalesce(new.tables, 0) > pr.qr_limit then
    raise exception 'the % plan includes % review QR%', pr.name, pr.qr_limit, case when pr.qr_limit = 1 then '' else 's' end;
  end if;
  new.wants_qr := coalesce(new.tables, 0) > 0 or new.wants_qr;
  price := case when pr.code = 'trial' then 0
                when new.billing_interval = 'month' then coalesce(pr.price_inr_month, 0)
                else coalesce(pr.price_inr_year, 0) end;
  new.listing_inr := price;
  new.qr_inr := 0;
  new.amount_inr := price;
  return new;
end $$;

-- ---------- One place to start or extend a plan ----------
create or replace function public.apply_plan(p_place uuid, p_plan text, p_interval text, p_months integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.subscriptions; base timestamptz; span interval;
begin
  select * into s from public.subscriptions where place_id = p_place for update;
  base := case when s.place_id is not null and s.status in ('active', 'past_due', 'cancelled') and s.period_end > now()
               then s.period_end else now() end;
  span := case when p_months is not null then make_interval(months => p_months)
               when p_interval = 'month' then interval '1 month' else interval '1 year' end;
  insert into public.subscriptions (place_id, plan, status, period_end, billing_interval, updated_at)
  values (p_place, p_plan, 'active', base + span, case when p_interval in ('month', 'year') then p_interval end, now())
  on conflict (place_id) do update set plan = excluded.plan, status = 'active', period_end = excluded.period_end,
    billing_interval = excluded.billing_interval, cancel_at_period_end = false, updated_at = now();
end $$;
revoke all on function public.apply_plan(uuid, text, text, integer) from public, anon, authenticated;

-- ---------- Razorpay orders can belong to a sign-up request ----------
alter table public.billing_orders alter column place_id drop not null;
alter table public.billing_orders add column if not exists request_id uuid references public.listing_requests (id) on delete cascade;
do $$ begin
  alter table public.billing_orders add constraint billing_orders_target check (place_id is not null or request_id is not null);
exception when duplicate_object then null; end $$;
create index if not exists billing_orders_request on public.billing_orders (request_id);

drop policy if exists "owners read their orders" on public.billing_orders;
create policy "owners read their orders" on public.billing_orders for select to authenticated
  using (public.is_admin() or (place_id is not null and public.is_place_owner(place_id)) or created_by = auth.uid());

create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.billing_orders; lr public.listing_requests; rupees integer;
begin
  select * into o from public.billing_orders where provider_order_id = p_order for update;
  if o.id is null then return false; end if;
  if o.status = 'paid' then return true; end if;
  if p_amount is not null and p_amount <> o.amount_minor then
    update public.billing_orders set status = 'failed' where id = o.id;
    return false;
  end if;
  update public.billing_orders set status = 'paid', provider_payment_id = p_payment, paid_at = now() where id = o.id;
  rupees := o.amount_minor / 100;

  if o.place_id is not null then
    perform public.apply_plan(o.place_id, o.plan, o.billing_interval);
    insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
    values (o.place_id, 'listing', rupees, 'razorpay', p_payment, current_date,
            current_date + case when o.billing_interval = 'month' then interval '1 month' else interval '1 year' end);
  else
    select * into lr from public.listing_requests where id = o.request_id for update;
    update public.listing_requests set status = 'paid' where id = lr.id and status = 'pending';
    insert into public.payments (request_id, place_id, kind, amount_inr, provider, provider_ref)
    values (lr.id, lr.place_id, 'listing', rupees, 'razorpay', p_payment);
    -- Approved before it was paid: start the plan on the shop now.
    if lr.place_id is not null then perform public.apply_plan(lr.place_id, o.plan, o.billing_interval); end if;
  end if;
  return true;
end $$;
revoke all on function public.billing_mark_paid(text, text, integer) from public, anon, authenticated;

-- ---------- Approving a request starts the paid plan and makes the table QRs ----------
create or replace function public.approve_listing(
  p_request uuid, p_lat double precision default null, p_lng double precision default null,
  p_table_labels text[] default '{}')
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare lr public.listing_requests; pl public.places; lbl text; n integer;
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

  -- The shop gets a paid plan first, so its QR limit allows the tables.
  if lr.status = 'paid' and coalesce(lr.plan, 'trial') <> 'trial' then
    perform public.apply_plan(pl.id, lr.plan, coalesce(lr.billing_interval, 'year'));
  end if;

  if lr.wants_qr then
    if coalesce(array_length(p_table_labels, 1), 0) > 0 then
      foreach lbl in array p_table_labels loop
        insert into public.qr_codes (place_id, style, table_label) values (pl.id, coalesce(lr.qr_style, 'neon'), lbl);
      end loop;
    elsif coalesce(lr.tables, 0) > 0 then
      for n in 1..lr.tables loop
        insert into public.qr_codes (place_id, style, table_label) values (pl.id, coalesce(lr.qr_style, 'neon'), 'Table ' || n);
      end loop;
    else
      insert into public.qr_codes (place_id, style) values (pl.id, coalesce(lr.qr_style, 'neon'));
    end if;
  end if;

  update public.payments set place_id = pl.id where request_id = lr.id;
  update public.billing_orders set place_id = pl.id where request_id = lr.id and place_id is null;
  update public.listing_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), place_id = pl.id
    where id = lr.id;
  return pl;
end $$;

-- ---------- Admin: payments, plans, prices ----------
create or replace function public.admin_billing(p_limit integer default 100)
returns table (id uuid, place_id uuid, place_name text, plan text, billing_interval text, currency text,
               amount_minor integer, status text, provider_payment_id text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.place_id, coalesce(p.name, lr.business_name), o.plan, o.billing_interval, o.currency, o.amount_minor, o.status,
         o.provider_payment_id, o.created_at, o.paid_at
  from public.billing_orders o
  left join public.places p on p.id = o.place_id
  left join public.listing_requests lr on lr.id = o.request_id
  where public.is_admin()
  order by o.created_at desc limit least(greatest(p_limit, 1), 500);
$$;
grant execute on function public.admin_billing(integer) to authenticated;

-- Every shop with its plan, so the team can see who is paying, trialling or paused.
create or replace function public.admin_shop_plans()
returns table (place_id uuid, place_name text, area text, plan text, plan_name text, status text, period_end timestamptz,
               qr_used integer, qr_limit integer, reviews_open boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, s.plan, pl.name, s.status, s.period_end,
         (select count(*)::integer from public.qr_codes q where q.place_id = p.id and q.active), pl.qr_limit,
         public.reviews_open(p.id)
  from public.places p
  join public.subscriptions s on s.place_id = p.id
  join public.plans pl on pl.code = s.plan
  where public.is_admin()
  order by (s.status = 'expired') desc, s.period_end;
$$;
grant execute on function public.admin_shop_plans() to authenticated;

-- Give or extend a plan by hand (cash, direct UPI, a gift). Optionally records what was received.
create or replace function public.admin_set_plan(p_place uuid, p_plan text, p_months integer,
                                                 p_amount_inr integer default 0, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'unknown plan'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'choose 1 to 36 months'; end if;
  perform public.apply_plan(p_place, p_plan, null, p_months);
  if coalesce(p_amount_inr, 0) > 0 then
    insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
    values (p_place, 'listing', p_amount_inr, 'manual', nullif(btrim(coalesce(p_ref, '')), ''), current_date,
            current_date + make_interval(months => p_months));
  end if;
end $$;
grant execute on function public.admin_set_plan(uuid, text, integer, integer, text) to authenticated;

create or replace function public.admin_update_plan(p_code text, p_name text, p_qr_limit integer,
  p_price_inr_year integer, p_price_inr_month integer, p_price_usd_year integer, p_price_usd_month integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_qr_limit < 1 or p_qr_limit > 500 then raise exception 'QR limit must be 1 to 500'; end if;
  update public.plans set name = left(btrim(p_name), 40), qr_limit = p_qr_limit,
    price_inr_year = case when p_code = 'trial' then 0 else greatest(p_price_inr_year, 0) end,
    price_inr_month = case when p_code = 'trial' then 0 else greatest(p_price_inr_month, 0) end,
    price_usd_year = case when p_code = 'trial' then 0 else greatest(p_price_usd_year, 0) end,
    price_usd_month = case when p_code = 'trial' then 0 else greatest(p_price_usd_month, 0) end
  where code = p_code;
end $$;
grant execute on function public.admin_update_plan(text, text, integer, integer, integer, integer, integer) to authenticated;

-- ===== 20261017000025_setup_links.sql =====
-- Trusted Picks: shop links (Google Maps, Zomato, Swiggy, Instagram...) collected during setup.
-- The owner pastes them while setting up; approving the request puts them on the shop page.
alter table public.listing_requests add column if not exists links jsonb not null default '[]'::jsonb;

create or replace function public.approve_listing(
  p_request uuid, p_lat double precision default null, p_lng double precision default null,
  p_table_labels text[] default '{}')
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare lr public.listing_requests; pl public.places; lbl text; n integer;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into lr from public.listing_requests where id = p_request for update;
  if not found or lr.status not in ('pending', 'paid') then raise exception 'request cannot be approved'; end if;

  insert into public.places (google_place_id, name, category, area, city, location, status, listed_until, created_by, owner_id, links)
  values (nullif(lr.google_place_id, ''), lr.business_name, lr.category, lr.area, lr.city,
          case when p_lat is not null and p_lng is not null
               then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
          'live', current_date + interval '1 year', auth.uid(), lr.requester_id,
          coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(lr.links, '[]'::jsonb)) e
                    where coalesce(e ->> 'url', '') ~* '^(https?://|tel:|mailto:)' and length(e ->> 'url') <= 500), '[]'::jsonb))
  on conflict (google_place_id) do update
    set status = 'live', listed_until = excluded.listed_until, owner_id = coalesce(public.places.owner_id, excluded.owner_id),
        links = case when jsonb_array_length(public.places.links) = 0 then excluded.links else public.places.links end
  returning * into pl;

  -- The shop gets a paid plan first, so its QR limit allows the tables.
  if lr.status = 'paid' and coalesce(lr.plan, 'trial') <> 'trial' then
    perform public.apply_plan(pl.id, lr.plan, coalesce(lr.billing_interval, 'year'));
  end if;

  if lr.wants_qr then
    if coalesce(array_length(p_table_labels, 1), 0) > 0 then
      foreach lbl in array p_table_labels loop
        insert into public.qr_codes (place_id, style, table_label) values (pl.id, coalesce(lr.qr_style, 'neon'), lbl);
      end loop;
    elsif coalesce(lr.tables, 0) > 0 then
      for n in 1..lr.tables loop
        insert into public.qr_codes (place_id, style, table_label) values (pl.id, coalesce(lr.qr_style, 'neon'), 'Table ' || n);
      end loop;
    else
      insert into public.qr_codes (place_id, style) values (pl.id, coalesce(lr.qr_style, 'neon'));
    end if;
  end if;

  update public.payments set place_id = pl.id where request_id = lr.id;
  update public.billing_orders set place_id = pl.id where request_id = lr.id and place_id is null;
  update public.listing_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), place_id = pl.id
    where id = lr.id;
  return pl;
end $$;

-- ===== 20261017000026_stock_photos.sql =====
-- Stock pictures for products. The "ai" edge function finds one per product (Pexels), caches the search here
-- and saves the picture's URL in items.image_path. Only Pexels picture URLs may be saved in place of an upload.

create table if not exists public.stock_photos (
  query       text primary key,                 -- lower-cased photo search
  url         text not null,
  created_at  timestamptz not null default now()
);
alter table public.stock_photos enable row level security;   -- no policies: only the edge function (service role) reads or writes

alter table public.items drop constraint if exists items_image_path_chk;
alter table public.items add constraint items_image_path_chk
  check (image_path is null or image_path !~* '^https?://'
         or (image_path ~ '^https://images\.pexels\.com/[A-Za-z0-9/_.?=&%-]+$' and char_length(image_path) <= 400));

-- ===== 20261017000027_multi_dish_visit.sql =====
-- A visit can cover more than one dish. A guest (no account) still gets one visit per phone
-- and place, but inside that visit they can rate every dish they had. The daily cap and
-- "already reviewed this dish on this visit" still apply, and only the first review of a
-- visit uses a QR ticket.

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
    -- One visit per phone and place; inside that visit a guest can rate every dish they had.
    if exists (select 1 from public.reviews where place_id = p_place_id and visit_id is distinct from v_visit
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
  if not public.reviews_open(p_place) then return query select false, 'paused', v.expires_at; return; end if;
  if public.is_guest() then
    v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
    if exists (select 1 from public.reviews where place_id = p_place and visit_id is distinct from v.id
               and (user_id = auth.uid() or (v_device is not null and device_hash = v_device and by_guest))) then
      return query select false, 'guest_used', v.expires_at; return;
    end if;
  end if;
  return query select true, 'ok', v.expires_at;
end $$;
grant execute on function public.can_review(uuid, text) to authenticated;


-- ===== 20261017000028_scale_search_locations.sql =====
-- Trusted Picks: stay fast at scale, and keep every shop's map pin precise.
--
-- 1. Missing indexes (foreign keys that cascades and joins scanned in full, recent-review lookups).
-- 2. search_places no longer scores every review of every shop on each call: it scores the 250 best
--    candidates (nearest, or most reviewed), looks only at each shop's newest 80 matching reviews
--    (older ones count for little with the 180-day half-life), reads your friends once instead of once
--    per review, and pages with p_offset.
-- 3. place_areas(): the Where picker's city/area list from one grouped query.
-- 4. Map pins: where a shop's pin came from (Google or typed in) and when. A shop linked to Google
--    keeps Google's pin: owners can't type over it. Coordinates are checked.

set search_path = public, extensions;

-- ---------------------------------------------------------------- indexes
create index if not exists reviews_place_pub_idx on public.reviews (place_id, created_at desc) where status = 'published';
create index if not exists reviews_created_idx on public.reviews (created_at desc);
create index if not exists reviews_device_recent_idx on public.reviews (device_hash, created_at) where device_hash is not null;
create index if not exists reviews_place_user_idx on public.reviews (place_id, user_id) where status = 'published';
create index if not exists reviews_visit_idx on public.reviews (visit_id) where visit_id is not null;
create index if not exists visits_place_idx on public.visits (place_id, scanned_at desc);
create index if not exists visits_user_scanned_idx on public.visits (user_id, scanned_at desc);
create index if not exists visits_qr_idx on public.visits (qr_code_id) where qr_code_id is not null;
create index if not exists qr_codes_place_idx on public.qr_codes (place_id);
create index if not exists saved_places_place_idx on public.saved_places (place_id);
create index if not exists saved_places_user_idx on public.saved_places (user_id, created_at desc);
create index if not exists google_shares_review_idx on public.google_shares (review_id);
create index if not exists google_shares_user_idx on public.google_shares (user_id);
create index if not exists review_tags_tag_idx on public.review_tags (tag_id);
create index if not exists review_reports_reporter_idx on public.review_reports (reporter);
create index if not exists listing_requests_place_idx on public.listing_requests (place_id) where place_id is not null;
create index if not exists listing_requests_requester_idx on public.listing_requests (requester_id, created_at desc);
create index if not exists listing_requests_status_idx on public.listing_requests (status, created_at desc);
create index if not exists payments_place_idx on public.payments (place_id) where place_id is not null;
create index if not exists payments_request_idx on public.payments (request_id) where request_id is not null;
create index if not exists place_claims_user_idx on public.place_claims (user_id);
create index if not exists user_topic_stats_topic_idx on public.user_topic_stats (topic_id);
-- Live shops only: the index search walks, by pin and by city and area (matched case-insensitively).
create index if not exists places_live_loc_idx on public.places using gist (location) where status = 'live';
create index if not exists places_live_city_idx on public.places (lower(city), lower(area)) where status = 'live';

-- ---------------------------------------------------------------- map pins
alter table public.places add column if not exists location_source text;
alter table public.places add column if not exists location_updated_at timestamptz;
alter table public.places drop constraint if exists places_location_source_check;
alter table public.places add constraint places_location_source_check check (location_source is null or location_source in ('google', 'manual'));
alter table public.places drop constraint if exists places_location_sane_check;
alter table public.places add constraint places_location_sane_check check (
  location is null or (extensions.st_y(location::extensions.geometry) between -90 and 90 and extensions.st_x(location::extensions.geometry) between -180 and 180
                       and not (abs(extensions.st_y(location::extensions.geometry)) < 0.0001 and abs(extensions.st_x(location::extensions.geometry)) < 0.0001))) not valid;

update public.places set location_source = 'manual', location_updated_at = coalesce(location_updated_at, created_at)
where location is not null and location_source is null;

-- Records where a pin came from whenever it is set or changed.
create or replace function public.places_location_meta()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if new.location is null then
    new.location_source := null; new.location_updated_at := null;
  elsif tg_op = 'INSERT' or new.location is distinct from old.location then
    new.location_source := coalesce(nullif(current_setting('app.location_source', true), ''), 'manual');
    new.location_updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists places_location_meta on public.places;
create trigger places_location_meta before insert or update of location on public.places
  for each row execute function public.places_location_meta();

-- Owners can't move a pin that comes from Google, whatever route they take to the table.
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
  if new.location is distinct from old.location and old.location_source = 'google' and old.google_place_id is not null
     and coalesce(current_setting('app.location_write', true), '') <> '1' then
    raise exception 'this shop''s pin comes from Google. Use "Refresh from Google" instead';
  end if;
  return new;
end $$;

drop function if exists public.set_place_location(uuid, double precision, double precision);
create or replace function public.set_place_location(p_place uuid, p_lat double precision, p_lng double precision, p_source text default 'manual')
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change this'; end if;
  select * into pl from public.places where id = p_place;
  if not found then raise exception 'shop not found'; end if;
  if p_source is null or p_source not in ('google', 'manual') then raise exception 'unknown location source'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'send both latitude and longitude'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180 or (abs(p_lat) < 0.0001 and abs(p_lng) < 0.0001)) then
    raise exception 'that isn''t a real location';
  end if;
  if p_source = 'google' and pl.google_place_id is null then raise exception 'link the shop to Google first'; end if;
  if p_source = 'manual' and pl.google_place_id is not null and pl.location_source = 'google' and not public.is_admin() then
    raise exception 'this shop''s pin comes from Google. Use "Refresh from Google" instead';
  end if;
  perform set_config('app.location_write', '1', true);
  perform set_config('app.location_source', p_source, true);
  update public.places
    set location = case when p_lat is null then null else st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end
    where id = p_place;
  perform set_config('app.location_write', '', true);
  perform set_config('app.location_source', '', true);
end $$;
grant execute on function public.set_place_location(uuid, double precision, double precision, text) to authenticated;

-- What the owner sees under "Map pin": no coordinates leave the database unless there is one.
create or replace function public.place_pin(p_place uuid)
returns table (has_pin boolean, source text, updated_at timestamptz, lat double precision, lng double precision, google_linked boolean)
language sql stable security definer set search_path = public, extensions as $$
  select p.location is not null, p.location_source, p.location_updated_at,
         st_y(p.location::geometry), st_x(p.location::geometry), p.google_place_id is not null
  from public.places p
  where p.id = p_place and (public.is_admin() or public.is_place_owner(p.id));
$$;
grant execute on function public.place_pin(uuid) to authenticated;

-- Admins: live shops people can't find nearby because they have no pin.
create or replace function public.places_without_pin()
returns table (place_id uuid, name text, city text, google_linked boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.city, p.google_place_id is not null
  from public.places p where public.is_admin() and p.status = 'live' and p.location is null
  order by p.created_at desc limit 500;
$$;
grant execute on function public.places_without_pin() to authenticated;

-- ---------------------------------------------------------------- Where picker
create or replace function public.place_areas()
returns table (city text, area text, shops integer)
language sql stable security invoker set search_path = public as $$
  select p.city, p.area, count(*)::integer
  from public.places p where p.status = 'live'
  group by p.city, p.area order by count(*) desc limit 1000;
$$;
grant execute on function public.place_areas() to anon, authenticated;

-- ---------------------------------------------------------------- search
-- Ranking is unchanged: table scan at the shop 1.5x, shop link 1.2x, scan with location unknown 1.0x,
-- scan far from the shop 0.4x, friends 3x, followed 3x, experts 1.5x, halved every 180 days.
drop function if exists public.search_places(text, double precision, double precision, integer, text, integer, text, uuid, text);
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null, p_kind text default null, p_offset integer default 0)
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
    select p.id, p.name, p.category, p.area, p.price_level, p.google_place_id, p.kind,
           case when here.pt is not null and p.location is not null then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here, q
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or lower(p.city) = lower(btrim(p_city)))
      and (p_area is null or btrim(p_area) = '' or lower(p.area) = lower(btrim(p_area)))
      and (p_kind is null or btrim(p_kind) = '' or p.kind = btrim(p_kind))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, least(greatest(coalesce(p_radius_m, 5000), 100), 200000))))
      -- With words typed: the shop's own name or category, or a reviewed item or topic that matches.
      and (q.txt is null or lower(p.name) like '%' || q.txt || '%' or lower(p.category) like '%' || q.txt || '%'
           or exists (select 1 from public.item_stats s join public.items i on i.id = s.item_id
                      left join public.topics t on t.id = i.topic_id
                      where s.place_id = p.id and s.review_count > 0
                        and (i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%')))
    -- Nearest first when there is a pin to measure from, otherwise the most reviewed.
    order by case when here.pt is not null then st_distance(p.location, here.pt) end asc nulls last,
             (select coalesce(sum(s.review_count), 0) from public.item_stats s where s.place_id = p.id) desc,
             p.created_at desc
    limit case when p_place is null then 250 else 1 end),
  fr as (select f.friend_id as uid from public.friendships f, me where f.user_id = me.uid),
  fr_arr as (select coalesce(array_agg(uid), '{}') as ids from fr),
  -- Each shop's newest 80 matching reviews, plus every one from your friends (up to 60), so who you trust always counts.
  sample as (
    select s.*
    from cand c
    cross join lateral (
      select * from (
        select r.id, r.place_id, r.rating, r.user_id, r.visit_id, r.created_at, r.is_public, r.by_guest, i.name as item_name, i.topic_id
        from public.reviews r
        join public.items i on i.id = r.item_id
        left join public.topics t on t.id = i.topic_id, q
        where r.place_id = c.id and r.status = 'published'
          and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%'
               or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%')
        order by r.created_at desc
        limit 80) newest
      union
      select * from (
        select r.id, r.place_id, r.rating, r.user_id, r.visit_id, r.created_at, r.is_public, r.by_guest, i.name as item_name, i.topic_id
        from public.reviews r
        join public.items i on i.id = r.item_id
        left join public.topics t on t.id = i.topic_id, q, fr_arr
        where r.place_id = c.id and r.status = 'published' and r.user_id = any (fr_arr.ids)
          and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%'
               or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%')
        order by r.created_at desc
        limit 60) mine) s),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from sample),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name, m.is_public,
      (case when fr.uid is not null then 3.0
            when m.is_public and f.follower_id is not null then 3.0
            when m.is_public and uts.is_expert then 1.5 else 1.0 end)
      * (case when vs.source = 'link' then 1.2 when vs.near is false then 0.4 when vs.near is null and m.visit_id is not null then 1.0 when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      (fr.uid is not null) as is_friend
    from sample m
    cross join me
    left join fr on fr.uid = m.user_id
    left join public.visits vs on vs.id = m.visit_id
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.user_topic_stats uts on m.is_public and uts.user_id = m.user_id and uts.topic_id = m.topic_id),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv
    from weighted w group by w.place_id),
  page as (
    select c.*, s.score, s.n, s.nv
    from cand c left join scored s on s.place_id = c.id, q
    where s.place_id is not null or q.txt is null
       or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
    order by s.score desc nulls last, c.dist asc nulls last, c.name
    limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)),
  -- The costlier per-shop details (who in your circle, the most reviewed item) only for the shops on this page.
  extras as (
    select w.place_id,
      count(distinct w.user_id) filter (where w.is_friend)::integer as nf_all,
      count(distinct w.user_id) filter (where w.is_friend and w.is_public)::integer as nf_named,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend and w.is_public), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w where w.place_id in (select id from page) group by w.place_id)
  select pg.id, pg.name, pg.category, pg.area, pg.price_level, pg.google_place_id, pg.dist,
         pg.score,
         -- A shop with more than the sampled reviews gets its true counts (only when no words narrow them).
         case when pg.n >= 80 and (select txt from q) is null
              then (select count(*)::integer from public.reviews r where r.place_id = pg.id and r.status = 'published')
              else coalesce(pg.n, 0) end,
         case when pg.n >= 80 and (select txt from q) is null
              then (select count(r.visit_id)::integer from public.reviews r where r.place_id = pg.id and r.status = 'published')
              else coalesce(pg.nv, 0) end,
         coalesce(case when x.nf_all >= 2 then x.nf_all else x.nf_named end, 0),
         coalesce(x.fids, '{}'), x.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = pg.id and qc.active),
         pg.kind
  from page pg left join extras x on x.place_id = pg.id
  order by pg.score desc nulls last, pg.dist asc nulls last, pg.name;
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid, text, integer) to anon, authenticated;


-- ===== 20261017000029_direct_listing.sql =====
-- Trusted Picks: shops list themselves straight away; there are no listing requests any more.
-- A new shop goes live at once with its free trial QR. Paid plans are bought through Razorpay on
-- the shop itself. The team then checks the listing (name, Google page, links) and marks it
-- verified or removes it. Until it is verified, the shop's links stay off its public page.

alter table public.places add column if not exists verification text not null default 'verified'
  check (verification in ('pending', 'verified', 'rejected'));
alter table public.places add column if not exists verification_note text;
alter table public.places add column if not exists contact_phone text;
create index if not exists places_verification_idx on public.places (verification) where verification = 'pending';

-- Owners can't mark their own shop verified.
create or replace function public.guard_place_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then new.verification := 'pending';
    elsif new.verification is distinct from old.verification or new.verification_note is distinct from old.verification_note then
      new.verification := old.verification; new.verification_note := old.verification_note;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists places_guard_verification on public.places;
create trigger places_guard_verification before insert or update on public.places
  for each row execute function public.guard_place_verification();

-- List a shop. Live at once, owned by the caller, waiting for the team's check.
create or replace function public.list_my_shop(
  p_name text, p_category text, p_city text, p_phone text,
  p_area text default null, p_google_place_id text default null, p_links jsonb default '[]'::jsonb,
  p_note text default null)
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places; existing public.places; recent integer;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'sign in to list a shop';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(coalesce(p_city, ''))) < 2 then
    raise exception 'add the shop name and city';
  end if;
  select count(*) into recent from public.places where owner_id = auth.uid() and created_at > now() - interval '1 day';
  if recent >= 3 then raise exception 'you can list up to 3 shops a day. Message us if you need more'; end if;

  if nullif(trim(p_google_place_id), '') is not null then
    select * into existing from public.places where google_place_id = trim(p_google_place_id);
    if found then
      if existing.owner_id = auth.uid() then return existing; end if;
      raise exception 'this Google listing is already on Trusted Picks. Claim it from its shop page instead';
    end if;
  end if;

  insert into public.places (google_place_id, name, category, area, city, status, created_by, owner_id, links,
                             verification, verification_note, contact_phone)
  values (nullif(trim(p_google_place_id), ''), trim(p_name), trim(p_category), nullif(trim(p_area), ''), trim(p_city),
          'live', auth.uid(), auth.uid(),
          coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) e
                    where coalesce(e ->> 'url', '') ~* '^https?://' and length(e ->> 'url') <= 500), '[]'::jsonb),
          'pending', nullif(left(trim(coalesce(p_note, '')), 1000), ''), nullif(trim(p_phone), ''))
  returning * into pl;
  return pl;
end $$;
revoke all on function public.list_my_shop(text, text, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.list_my_shop(text, text, text, text, text, text, jsonb, text) to authenticated;

-- Make table QRs up to what the shop's plan allows. Returns how many exist afterwards.
create or replace function public.make_table_qrs(p_place uuid, p_tables integer, p_style text default 'paper')
returns integer
language plpgsql security definer set search_path = public as $$
declare lim integer; have integer; n integer;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'not your shop'; end if;
  lim := public.place_qr_limit(p_place);
  select count(*) into have from public.qr_codes where place_id = p_place and active;
  for n in (have + 1)..least(greatest(coalesce(p_tables, 1), 1), lim, 200) loop
    insert into public.qr_codes (place_id, style, table_label) values (p_place, coalesce(nullif(p_style, ''), 'paper')::public.qr_style, 'Table ' || n);
  end loop;
  select count(*) into have from public.qr_codes where place_id = p_place and active;
  return have;
end $$;
revoke all on function public.make_table_qrs(uuid, integer, text) from public, anon;
grant execute on function public.make_table_qrs(uuid, integer, text) to authenticated;

-- The team's check: verified puts the links on the page; rejected takes the shop down.
create or replace function public.verify_place(p_place uuid, p_ok boolean, p_note text default null,
  p_lat double precision default null, p_lng double precision default null)
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.places set
    verification = case when p_ok then 'verified' else 'rejected' end,
    verification_note = nullif(trim(coalesce(p_note, '')), ''),
    status = case when p_ok then status else 'removed' end,
    location = case when p_lat is not null and p_lng is not null
                    then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography else location end
  where id = p_place
  returning * into pl;
  if pl.id is null then raise exception 'shop not found'; end if;
  return pl;
end $$;
revoke all on function public.verify_place(uuid, boolean, text, double precision, double precision) from public, anon;
grant execute on function public.verify_place(uuid, boolean, text, double precision, double precision) to authenticated;

-- Everyone can see whether a shop is verified (the page hides links until it is).
grant select (verification) on public.places to anon, authenticated;

-- Your shops, now with their check status.
drop function if exists public.my_places();
create function public.my_places()
returns table (id uuid, name text, area text, city text, status public.place_status, listed_until date,
               cover_path text, logo_path text, verification text, verification_note text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, p.city, p.status, p.listed_until, p.cover_path, p.logo_path,
         p.verification, case when p.verification = 'rejected' then p.verification_note end
  from public.places p
  where auth.uid() is not null and p.owner_id = auth.uid()
  order by p.name;
$$;
grant execute on function public.my_places() to authenticated;

-- The team's queue of shops to check.
create or replace function public.admin_places_to_verify()
returns table (id uuid, name text, category text, area text, city text, google_place_id text, links jsonb,
               contact_phone text, verification_note text, owner_name text, created_at timestamptz, has_location boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.area, p.city, p.google_place_id, p.links, p.contact_phone, p.verification_note,
         pr.display_name, p.created_at, p.location is not null
  from public.places p left join public.profiles pr on pr.id = p.owner_id
  where public.is_admin() and p.verification = 'pending'
  order by p.created_at;
$$;
revoke all on function public.admin_places_to_verify() from public, anon;
grant execute on function public.admin_places_to_verify() to authenticated;

-- ===== 20261018000030_review_fixes.sql =====
-- Trusted Picks: fixes from the full review of 2026-10-18.
-- Privacy: anonymous friends are never counted; old phone matching and listing requests are switched off.
-- Shops: payments only from a fresh order, plan changes are fair, QRs follow the plan, Google pins and links
-- can't be faked or swapped after the team's check. Reviews: review links aren't wasted, guests can't reset
-- their one visit per phone, uploads are images and audio only.
set search_path = public, extensions;

-- 1. Old phone matching (replaced by invite links): nobody can look up who owns a phone number any more.
drop function if exists public.match_contacts(text[]);
drop function if exists public.set_my_phone(text);
drop function if exists public.my_phone_is_set();
drop function if exists public.stop_contact_sync();
drop function if exists public.are_contacts(uuid, uuid);
drop table if exists public.contact_links;
drop table if exists public.contact_syncs;
update public.profiles set phone_hash = null where phone_hash is not null;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''))
    on conflict (id) do nothing;
  exception when others then
    raise warning 'trusted picks: profile for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $$;
-- Who is an admin isn't public.
revoke select (role) on public.profiles from anon, authenticated;

-- 2. Listing requests are gone (shops list themselves): nobody can start or pay for one.
drop policy if exists "request listing" on public.listing_requests;
do $$ begin
  revoke execute on function public.approve_listing(uuid, double precision, double precision, text[]) from public, anon, authenticated;
  revoke execute on function public.decline_listing(uuid) from public, anon, authenticated;
  revoke execute on function public.mark_request_paid(uuid, text) from public, anon, authenticated;
exception when undefined_function then null; end $$;
create or replace function public.admin_summary()
returns table (to_review integer, live_places integer, collected_inr integer)
language sql stable security definer set search_path = public as $$
  select
    ((select count(*) from public.places where verification = 'pending' and status = 'live')
     + (select count(*) from public.place_claims where status = 'pending'))::integer,
    (select count(*) from public.places where status = 'live')::integer,
    (select coalesce(sum(amount_inr), 0) from public.payments where status = 'paid')::integer
  where public.is_admin();
$$;

-- 3. Search: "friends rated this" counts only friends who posted with their name.
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null, p_kind text default null, p_offset integer default 0)
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
    select p.id, p.name, p.category, p.area, p.price_level, p.google_place_id, p.kind,
           case when here.pt is not null and p.location is not null then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here, q
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or lower(p.city) = lower(btrim(p_city)))
      and (p_area is null or btrim(p_area) = '' or lower(p.area) = lower(btrim(p_area)))
      and (p_kind is null or btrim(p_kind) = '' or p.kind = btrim(p_kind))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, least(greatest(coalesce(p_radius_m, 5000), 100), 200000))))
      -- With words typed: the shop's own name or category, or a reviewed item or topic that matches.
      and (q.txt is null or lower(p.name) like '%' || q.txt || '%' or lower(p.category) like '%' || q.txt || '%'
           or exists (select 1 from public.item_stats s join public.items i on i.id = s.item_id
                      left join public.topics t on t.id = i.topic_id
                      where s.place_id = p.id and s.review_count > 0
                        and (i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%')))
    -- Nearest first when there is a pin to measure from, otherwise the most reviewed.
    order by case when here.pt is not null then st_distance(p.location, here.pt) end asc nulls last,
             (select coalesce(sum(s.review_count), 0) from public.item_stats s where s.place_id = p.id) desc,
             p.created_at desc
    limit case when p_place is null then 250 else 1 end),
  fr as (select f.friend_id as uid from public.friendships f, me where f.user_id = me.uid),
  fr_arr as (select coalesce(array_agg(uid), '{}') as ids from fr),
  -- Each shop's newest 80 matching reviews, plus every one from your friends (up to 60), so who you trust always counts.
  sample as (
    select s.*
    from cand c
    cross join lateral (
      select * from (
        select r.id, r.place_id, r.rating, r.user_id, r.visit_id, r.created_at, r.is_public, r.by_guest, i.name as item_name, i.topic_id
        from public.reviews r
        join public.items i on i.id = r.item_id
        left join public.topics t on t.id = i.topic_id, q
        where r.place_id = c.id and r.status = 'published'
          and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%'
               or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%')
        order by r.created_at desc
        limit 80) newest
      union
      select * from (
        select r.id, r.place_id, r.rating, r.user_id, r.visit_id, r.created_at, r.is_public, r.by_guest, i.name as item_name, i.topic_id
        from public.reviews r
        join public.items i on i.id = r.item_id
        left join public.topics t on t.id = i.topic_id, q, fr_arr
        where r.place_id = c.id and r.status = 'published' and r.user_id = any (fr_arr.ids)
          and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%'
               or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%')
        order by r.created_at desc
        limit 60) mine) s),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from sample),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name, m.is_public,
      (case when fr.uid is not null then 3.0
            when m.is_public and f.follower_id is not null then 3.0
            when m.is_public and uts.is_expert then 1.5 else 1.0 end)
      * (case when vs.source = 'link' then 1.2 when vs.near is false then 0.4 when vs.near is null and m.visit_id is not null then 1.0 when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      (fr.uid is not null) as is_friend
    from sample m
    cross join me
    left join fr on fr.uid = m.user_id
    left join public.visits vs on vs.id = m.visit_id
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.user_topic_stats uts on m.is_public and uts.user_id = m.user_id and uts.topic_id = m.topic_id),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv
    from weighted w group by w.place_id),
  page as (
    select c.*, s.score, s.n, s.nv
    from cand c left join scored s on s.place_id = c.id, q
    where s.place_id is not null or q.txt is null
       or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
    order by s.score desc nulls last, c.dist asc nulls last, c.name, c.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)),
  -- The costlier per-shop details (who in your circle, the most reviewed item) only for the shops on this page.
  extras as (
    select w.place_id,
      count(distinct w.user_id) filter (where w.is_friend and w.is_public)::integer as nf_named,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend and w.is_public), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w where w.place_id in (select id from page) group by w.place_id)
  select pg.id, pg.name, pg.category, pg.area, pg.price_level, pg.google_place_id, pg.dist,
         pg.score,
         -- A shop with more than the sampled reviews gets its true counts (only when no words narrow them).
         case when pg.n >= 80 and (select txt from q) is null
              then (select count(*)::integer from public.reviews r where r.place_id = pg.id and r.status = 'published')
              else coalesce(pg.n, 0) end,
         case when pg.n >= 80 and (select txt from q) is null
              then (select count(r.visit_id)::integer from public.reviews r where r.place_id = pg.id and r.status = 'published')
              else coalesce(pg.nv, 0) end,
         coalesce(x.nf_named, 0),
         coalesce(x.fids, '{}'), x.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = pg.id and qc.active),
         pg.kind
  from page pg left join extras x on x.place_id = pg.id
  order by pg.score desc nulls last, pg.dist asc nulls last, pg.name, pg.id;
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid, text, integer) to anon, authenticated;

-- 4. Reviews of a shop that was taken down stay hidden (except from their author and admins).
create or replace view public.review_feed with (security_barrier = true) as
select r.id,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.user_id end as user_id,
  r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null) as verified, r.photo_path,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.voice_path end as voice_path,
  r.status, r.is_public, r.created_at,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.display_name end as author_name,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.avatar_path end as author_avatar,
  (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id) as source
from public.reviews r
join public.profiles p on p.id = r.user_id
join public.places pl on pl.id = r.place_id
where (r.status = 'published' and pl.status = 'live') or r.user_id = auth.uid() or public.is_admin();
grant select on public.review_feed to anon, authenticated;

-- 5. A review's photo or voice note can only be set through submit_review (which checks the file is yours),
--    and a guest can't delete a review to get a second visit from the same phone.
revoke update (photo_path, voice_path) on public.reviews from authenticated;
drop policy if exists "delete own review" on public.reviews;
create policy "delete own review" on public.reviews for delete to authenticated
  using ((user_id = auth.uid() and not public.is_guest()) or public.is_admin());

-- 6. Review links: not used up when the person can't review, and an ended visit says so.
drop function if exists public.redeem_review_link(text);
create or replace function public.redeem_review_link(p_token text, p_device text default null)
returns table (visit_id uuid, place_id uuid, place_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare l public.review_links; v public.visits; v_name text; v_device text;
begin
  if auth.uid() is null then raise exception 'open the link again to continue'; end if;
  select * into l from public.review_links where token = p_token for update;
  if l.id is null then raise exception 'this review link doesn''t work'; end if;
  select name into v_name from public.places where id = l.place_id and status = 'live';
  if v_name is null then raise exception 'this shop isn''t listed right now'; end if;

  if l.used_at is not null then
    select * into v from public.visits where id = l.visit_id and user_id = auth.uid();
    if v.id is null then raise exception 'this review link was already used. Ask the shop for a new one'; end if;
    if v.expires_at < now() then raise exception 'the visit from this link has ended. Ask the shop for a new link'; end if;
    return query select v.id, l.place_id, v_name, v.expires_at; return;
  end if;
  if l.expires_at < now() then raise exception 'this review link has expired. Ask the shop for a new one'; end if;
  if public.is_place_owner(l.place_id) then raise exception 'you can''t review your own shop'; end if;
  if not public.reviews_open(l.place_id) then raise exception 'reviews are paused at this shop for now'; end if;
  if public.is_guest() then
    v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
    if exists (select 1 from public.reviews r where r.place_id = l.place_id
               and (r.user_id = auth.uid() or (v_device is not null and r.device_hash = v_device and r.by_guest))) then
      raise exception 'you''ve already reviewed this shop from this phone. Sign in to review again';
    end if;
  end if;

  insert into public.visits (user_id, place_id, source, expires_at)
  values (auth.uid(), l.place_id, 'link', now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
  returning * into v;
  update public.review_links set used_at = now(), visit_id = v.id where id = l.id;
  return query select v.id, l.place_id, v_name, v.expires_at;
end $$;
revoke all on function public.redeem_review_link(text, text) from public, anon;
grant execute on function public.redeem_review_link(text, text) to authenticated;

-- 7. Changing the Google link or the links after the team's check sends the shop back to be checked.
create or replace function public.guard_place_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then new.verification := 'pending';
    else
      if new.verification is distinct from old.verification or new.verification_note is distinct from old.verification_note then
        new.verification := old.verification; new.verification_note := old.verification_note;
      end if;
      if new.google_place_id is distinct from old.google_place_id or new.links is distinct from old.links then
        new.verification := 'pending';
      end if;
    end if;
  end if;
  return new;
end $$;

-- 8. Pins: owners can't relabel where a pin came from, and a "Google" pin from an owner can't jump far
--    from the one already there (Google only moves a pin a little).
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
  if (new.location_source is distinct from old.location_source or new.location_updated_at is distinct from old.location_updated_at)
     and coalesce(current_setting('app.location_write', true), '') <> '1' then
    new.location_source := old.location_source; new.location_updated_at := old.location_updated_at;
  end if;
  if new.location is distinct from old.location and old.location_source = 'google' and old.google_place_id is not null
     and coalesce(current_setting('app.location_write', true), '') <> '1' then
    raise exception 'this shop''s pin comes from Google. Use "Refresh from Google" instead';
  end if;
  return new;
end $$;

create or replace function public.set_place_location(p_place uuid, p_lat double precision, p_lng double precision, p_source text default 'manual')
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change this'; end if;
  select * into pl from public.places where id = p_place;
  if not found then raise exception 'shop not found'; end if;
  if p_source is null or p_source not in ('google', 'manual') then raise exception 'unknown location source'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'send both latitude and longitude'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180 or (abs(p_lat) < 0.0001 and abs(p_lng) < 0.0001)) then
    raise exception 'that isn''t a real location';
  end if;
  if p_source = 'google' and pl.google_place_id is null then raise exception 'link the shop to Google first'; end if;
  if not public.is_admin() and pl.google_place_id is not null and pl.location_source = 'google' then
    if p_source = 'manual' then raise exception 'this shop''s pin comes from Google. Use "Refresh from Google" instead'; end if;
    if p_lat is null then raise exception 'a Google pin can''t be removed'; end if;
    if pl.location is not null and st_distance(pl.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) > 2000 then
      raise exception 'that''s far from Google''s pin for this shop. Ask the Trusted Picks team to move it';
    end if;
  end if;
  perform set_config('app.location_write', '1', true);
  perform set_config('app.location_source', p_source, true);
  update public.places
    set location = case when p_lat is null then null else st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end
    where id = p_place;
  perform set_config('app.location_write', '', true);
  perform set_config('app.location_source', '', true);
end $$;
revoke all on function public.set_place_location(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.set_place_location(uuid, double precision, double precision, text) to authenticated;

-- 9. A shop's update can carry a link only once the team has checked the shop.
create or replace function public.guard_update_link()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.link_url is not null and not public.is_admin()
     and not exists (select 1 from public.places p where p.id = new.place_id and p.verification = 'verified') then
    new.link_url := null;
  end if;
  return new;
end $$;
drop trigger if exists place_updates_guard_link on public.place_updates;
create trigger place_updates_guard_link before insert or update on public.place_updates
  for each row execute function public.guard_update_link();

-- 10. Plans. A payment only counts once, from a fresh order. Changing plan converts the time left at the
--     old plan's price instead of carrying it over 1:1, and QRs above the new plan's limit are turned off.
create or replace function public.trim_qrs(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lim integer;
begin
  lim := public.place_qr_limit(p_place);
  update public.qr_codes set active = false
  where id in (select id from public.qr_codes where place_id = p_place and active order by created_at desc
               offset greatest(lim, 1));
end $$;
revoke all on function public.trim_qrs(uuid) from public, anon, authenticated;

create or replace function public.apply_plan(p_place uuid, p_plan text, p_interval text, p_months integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.subscriptions; base timestamptz; span interval; old_price numeric; new_price numeric;
begin
  select * into s from public.subscriptions where place_id = p_place for update;
  base := case when s.place_id is not null and s.status in ('active', 'past_due', 'cancelled') and s.period_end > now()
               then s.period_end else now() end;
  -- Time left on a different paid plan is worth what it cost: convert it at the two plans' yearly prices.
  if base > now() and s.plan is distinct from p_plan then
    select price_inr_year into old_price from public.plans where code = s.plan;
    select price_inr_year into new_price from public.plans where code = p_plan;
    if coalesce(old_price, 0) > 0 and coalesce(new_price, 0) > 0 then
      base := now() + (base - now()) * (old_price / new_price);
    else
      base := now();
    end if;
  end if;
  span := case when p_months is not null then make_interval(months => p_months)
               when p_interval = 'month' then interval '1 month' else interval '1 year' end;
  insert into public.subscriptions (place_id, plan, status, period_end, billing_interval, updated_at)
  values (p_place, p_plan, 'active', base + span, case when p_interval in ('month', 'year') then p_interval end, now())
  on conflict (place_id) do update set plan = excluded.plan, status = 'active', period_end = excluded.period_end,
    billing_interval = excluded.billing_interval, cancel_at_period_end = false, updated_at = now();
  perform public.trim_qrs(p_place);
end $$;
revoke all on function public.apply_plan(uuid, text, text, integer) from public, anon, authenticated;

create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.billing_orders; rupees integer;
begin
  select * into o from public.billing_orders where provider_order_id = p_order for update;
  if o.id is null then return false; end if;
  if o.status = 'paid' then return true; end if;
  if o.status <> 'created' then return false; end if;
  if p_amount is not null and p_amount <> o.amount_minor then
    update public.billing_orders set status = 'failed' where id = o.id;
    return false;
  end if;
  if o.place_id is null then return false; end if;
  update public.billing_orders set status = 'paid', provider_payment_id = p_payment, paid_at = now() where id = o.id;
  rupees := o.amount_minor / 100;
  perform public.apply_plan(o.place_id, o.plan, o.billing_interval);
  insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (o.place_id, 'listing', rupees, 'razorpay', p_payment, current_date,
          current_date + case when o.billing_interval = 'month' then interval '1 month' else interval '1 year' end);
  return true;
end $$;
revoke all on function public.billing_mark_paid(text, text, integer) from public, anon, authenticated;

-- The plan card shows the limit that really applies (an ended plan falls back to the trial's one QR).
create or replace function public.my_plan(p_place uuid)
returns table (plan text, plan_name text, status text, period_end timestamptz, trial_reviews_left integer, qr_limit integer,
               qr_used integer, reviews_open boolean, cancel_at_period_end boolean, billing_interval text)
language sql stable security definer set search_path = public as $$
  select s.plan, pl.name, s.status, s.period_end, s.trial_reviews_left, public.place_qr_limit(p_place),
         (select count(*)::integer from public.qr_codes q where q.place_id = p_place and q.active),
         public.reviews_open(p_place), s.cancel_at_period_end, s.billing_interval
  from public.subscriptions s join public.plans pl on pl.code = s.plan
  where s.place_id = p_place and (public.is_place_owner(p_place) or public.is_admin());
$$;

-- 11. Uploads: review photos are images and voice notes are audio, with size limits.
do $$ begin
  update storage.buckets set file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'review-photos';
  update storage.buckets set file_size_limit = 3145728, allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/wav'] where id = 'voice';
exception when undefined_column or undefined_table then null; end $$;

-- ===== 20261018000031_owner_admin_fixes.sql =====
-- Trusted Picks: owner and admin fixes from the review of 2026-10-18 (part 2).
-- Shops: a removed shop's owner can still open it, read the team's note and ask for another check.
-- Admin: the old "Renew" tool is gone and "collected" counts real payments only; payments that need a
-- person's look are listed. Insights count what they say. Uploads have type and size limits.
-- Speed and cost: profile reviews by user id, no unused nightly table, an overall daily AI ceiling.
-- Safe to run more than once.
set search_path = public, extensions;

-- 1. Removed shops aren't a dead end.
--    Owners can read their own shop whatever its status (everyone else still only sees live shops).
drop policy if exists "owners read own place" on public.places;
create policy "owners read own place" on public.places for select to authenticated
  using (owner_id = auth.uid());

-- Owners' "check again" requests, at most one a day per shop. Nobody reads this table directly.
create table if not exists public.place_rechecks (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists place_rechecks_place_idx on public.place_rechecks (place_id, created_at desc);
alter table public.place_rechecks enable row level security;
revoke all on public.place_rechecks from anon, authenticated;

-- The verification guard (from migration 30), now letting request_recheck put the shop back in the queue.
create or replace function public.guard_place_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and coalesce(current_setting('app.verification_write', true), '') <> '1' then
    if tg_op = 'INSERT' then new.verification := 'pending';
    else
      if new.verification is distinct from old.verification or new.verification_note is distinct from old.verification_note then
        new.verification := old.verification; new.verification_note := old.verification_note;
      end if;
      if new.google_place_id is distinct from old.google_place_id or new.links is distinct from old.links then
        new.verification := 'pending';
      end if;
    end if;
  end if;
  return new;
end $$;

-- The team's check: verified puts the links on the page and brings a removed shop back; rejected takes it down.
create or replace function public.verify_place(p_place uuid, p_ok boolean, p_note text default null,
  p_lat double precision default null, p_lng double precision default null)
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.places set
    verification = case when p_ok then 'verified' else 'rejected' end,
    verification_note = nullif(trim(coalesce(p_note, '')), ''),
    status = case when not p_ok then 'removed'::public.place_status
                  when status = 'removed' then 'live'::public.place_status
                  else status end,
    location = case when p_lat is not null and p_lng is not null
                    then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography else location end
  where id = p_place
  returning * into pl;
  if pl.id is null then raise exception 'shop not found'; end if;
  return pl;
end $$;
revoke all on function public.verify_place(uuid, boolean, text, double precision, double precision) from public, anon;
grant execute on function public.verify_place(uuid, boolean, text, double precision, double precision) to authenticated;

-- Where the team's check stands, for the owner's Manage page. The note is the team's (or, while it is being
-- checked again, the owner's own message to the team).
create or replace function public.my_place_check(p_place uuid)
returns table (status public.place_status, verification text, note text, next_recheck_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.status, p.verification,
         case when p.verification in ('rejected', 'pending') or p.status = 'removed' then p.verification_note end,
         (select max(r.created_at) + interval '1 day' from public.place_rechecks r where r.place_id = p.id)
  from public.places p
  where p.id = p_place and auth.uid() is not null and (p.owner_id = auth.uid() or public.is_admin());
$$;
revoke all on function public.my_place_check(uuid) from public, anon;
grant execute on function public.my_place_check(uuid) to authenticated;

-- "I've fixed it, check again": a removed or rejected shop goes back in the team's queue, once a day.
-- It stays off the public app until the team verifies it.
create or replace function public.request_recheck(p_place uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare pl public.places; last_at timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into pl from public.places where id = p_place for update;
  if pl.id is null or pl.owner_id is distinct from auth.uid() then raise exception 'only the shop owner can ask for this'; end if;
  if pl.verification = 'pending' then raise exception 'your shop is already waiting for the team''s check'; end if;
  if not (pl.status = 'removed' or pl.verification = 'rejected') then raise exception 'your shop is already listed'; end if;
  select max(created_at) into last_at from public.place_rechecks where place_id = p_place;
  if last_at is not null and last_at > now() - interval '1 day' then
    raise exception 'you can ask once a day. Try again after %',
      to_char((last_at + interval '1 day') at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM');
  end if;
  insert into public.place_rechecks (place_id, requested_by, note)
  values (p_place, auth.uid(), nullif(left(btrim(coalesce(p_note, '')), 1000), ''));
  perform set_config('app.verification_write', '1', true);
  update public.places
    set verification = 'pending',
        verification_note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''), verification_note)
    where id = p_place;
  perform set_config('app.verification_write', '', true);
  return 'pending';
end $$;
revoke all on function public.request_recheck(uuid, text) from public, anon;
grant execute on function public.request_recheck(uuid, text) to authenticated;

-- 2. The old Renew tool recorded a made-up ₹199 and didn't touch the plan: it's gone.
drop function if exists public.renew_listing(uuid, text);

-- Payments the team records by hand (admin_set_plan) are marked 'admin', so they can be told apart from
-- the old Renew rows (provider 'manual') and the copies of Razorpay orders (provider 'razorpay').
create or replace function public.admin_set_plan(p_place uuid, p_plan text, p_months integer, p_amount_inr integer default 0, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'unknown plan'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'choose 1 to 36 months'; end if;
  perform public.apply_plan(p_place, p_plan, null, p_months);
  if coalesce(p_amount_inr, 0) > 0 then
    insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
    values (p_place, 'listing', p_amount_inr, 'admin', nullif(btrim(coalesce(p_ref, '')), ''), current_date,
            current_date + make_interval(months => p_months));
  end if;
end $$;
revoke all on function public.admin_set_plan(uuid, text, integer, integer, text) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, integer, integer, text) to authenticated;

-- Collected = Razorpay orders that are paid (a refunded order is no longer 'paid') plus money the team
-- recorded by hand. "To review" includes removed shops that asked to be checked again.
create or replace function public.admin_summary()
returns table (to_review integer, live_places integer, collected_inr integer)
language sql stable security definer set search_path = public as $$
  select
    ((select count(*) from public.places where verification = 'pending')
     + (select count(*) from public.place_claims where status = 'pending'))::integer,
    (select count(*) from public.places where status = 'live')::integer,
    ((select coalesce(sum(amount_minor), 0) from public.billing_orders where status = 'paid') / 100
     + (select coalesce(sum(amount_inr), 0) from public.payments where status = 'paid' and provider = 'admin'))::integer
  where public.is_admin();
$$;
revoke all on function public.admin_summary() from public, anon;
grant execute on function public.admin_summary() to authenticated;

-- 3. Insights: "visits with a review" counts visits, table scans and review-link visits are counted apart.
drop function if exists public.shop_stats(uuid);
create function public.shop_stats(p_place uuid)
returns table (reviews integer, avg_rating numeric, reviews_30d integer, verified integer,
               google_handoffs integer, google_handoffs_30d integer, scans_30d integer, saves integer, items_rated integer,
               link_visits_30d integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query select
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.created_at > now() - interval '30 days'),
    -- Visits (a table scan or a review link) that led to at least one published review.
    (select count(distinct r.visit_id)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.visit_id is not null),
    -- Reviews whose writer opened Google to post them there (we can't see whether they did post).
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place),
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place and g.opened_at > now() - interval '30 days'),
    (select count(*)::integer from public.visits v where v.place_id = p_place and v.source = 'qr' and v.scanned_at > now() - interval '30 days'),
    (select count(*)::integer from public.saved_places s where s.place_id = p_place),
    (select count(distinct r.item_id)::integer from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select count(*)::integer from public.visits v where v.place_id = p_place and v.source = 'link' and v.scanned_at > now() - interval '30 days');
end $$;
revoke all on function public.shop_stats(uuid) from public, anon;
grant execute on function public.shop_stats(uuid) to authenticated;

-- 4. Payments that need a person's look: a second payment for an order that was already paid, the wrong
--    amount, money for a closed or unknown order. Nothing is refunded automatically.
create table if not exists public.billing_alerts (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('second_payment', 'amount_mismatch', 'closed_order', 'unknown_order', 'no_shop')),
  order_id            uuid references public.billing_orders (id) on delete set null,
  place_id            uuid references public.places (id) on delete set null,
  provider_order_id   text,
  provider_payment_id text,
  amount_minor        integer,
  expected_minor      integer,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);
create unique index if not exists billing_alerts_once on public.billing_alerts (kind, provider_order_id, provider_payment_id) nulls not distinct;
create index if not exists billing_alerts_open on public.billing_alerts (created_at desc) where resolved_at is null;
alter table public.billing_alerts enable row level security;
revoke all on public.billing_alerts from anon, authenticated;
grant select on public.billing_alerts to authenticated;
grant update (resolved_at) on public.billing_alerts to authenticated;
drop policy if exists "admins read billing alerts" on public.billing_alerts;
create policy "admins read billing alerts" on public.billing_alerts for select to authenticated using (public.is_admin());
drop policy if exists "admins resolve billing alerts" on public.billing_alerts;
create policy "admins resolve billing alerts" on public.billing_alerts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.billing_alert(p_kind text, o public.billing_orders, p_order text, p_payment text, p_amount integer)
returns void language sql security definer set search_path = public as $$
  insert into public.billing_alerts (kind, order_id, place_id, provider_order_id, provider_payment_id, amount_minor, expected_minor)
  values (p_kind, o.id, o.place_id, p_order, p_payment, p_amount, o.amount_minor)
  on conflict (kind, provider_order_id, provider_payment_id) do nothing;
$$;
revoke all on function public.billing_alert(text, public.billing_orders, text, text, integer) from public, anon, authenticated;

create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.billing_orders; rupees integer;
begin
  select * into o from public.billing_orders where provider_order_id = p_order for update;
  if o.id is null then
    perform public.billing_alert('unknown_order', o, p_order, p_payment, p_amount);
    return false;
  end if;
  if o.status = 'paid' then
    if o.provider_payment_id is distinct from p_payment then
      perform public.billing_alert('second_payment', o, p_order, p_payment, p_amount);
    end if;
    return true;
  end if;
  if o.status <> 'created' then
    -- (A retry of the payment already flagged as the wrong amount isn't flagged again.)
    if not (o.status = 'failed' and o.provider_payment_id is not distinct from p_payment) then
      perform public.billing_alert('closed_order', o, p_order, p_payment, p_amount);
    end if;
    return false;
  end if;
  if p_amount is not null and p_amount <> o.amount_minor then
    update public.billing_orders set status = 'failed', provider_payment_id = p_payment where id = o.id;
    perform public.billing_alert('amount_mismatch', o, p_order, p_payment, p_amount);
    return false;
  end if;
  if o.place_id is null then
    perform public.billing_alert('no_shop', o, p_order, p_payment, p_amount);
    return false;
  end if;
  update public.billing_orders set status = 'paid', provider_payment_id = p_payment, paid_at = now() where id = o.id;
  rupees := o.amount_minor / 100;
  perform public.apply_plan(o.place_id, o.plan, o.billing_interval);
  insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (o.place_id, 'listing', rupees, 'razorpay', p_payment, current_date,
          current_date + case when o.billing_interval = 'month' then interval '1 month' else interval '1 year' end);
  return true;
end $$;
revoke all on function public.billing_mark_paid(text, text, integer) from public, anon, authenticated;
do $$ begin
  grant execute on function public.billing_mark_paid(text, text, integer) to service_role;
exception when undefined_object then null; end $$;

-- 5. Uploads: profile, shop and claim photos are images only, with size limits.
do $$ begin
  update storage.buckets set file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'avatars';
  update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'place-media';
  update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'claim-photos';
exception when undefined_column or undefined_table then null; end $$;

-- 6. A person's reviews, read by reviews.user_id (indexed) instead of the view's hidden-author column.
--    Same columns as review_feed, so the app can embed items, places and tags as before. Newest first,
--    paged with the last row's created_at and id.
create or replace function public.my_reviews(p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns setof public.review_feed
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null), r.photo_path,
         r.voice_path, r.status, r.is_public, r.created_at, p.display_name, p.avatar_path,
         (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id)
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  where auth.uid() is not null and r.user_id = auth.uid()
    and (p_before_created is null or (r.created_at, r.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.my_reviews(timestamptz, uuid, integer) from public, anon;
grant execute on function public.my_reviews(timestamptz, uuid, integer) to authenticated;

create or replace function public.person_reviews(p_user uuid, p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns setof public.review_feed
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null), r.photo_path,
         r.voice_path, r.status, r.is_public, r.created_at, p.display_name, p.avatar_path,
         (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id)
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  join public.places pl on pl.id = r.place_id
  where r.user_id = p_user and r.is_public and r.status = 'published' and pl.status = 'live'
    and (p_before_created is null or (r.created_at, r.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.person_reviews(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.person_reviews(uuid, timestamptz, uuid, integer) to anon, authenticated;

-- The nightly job no longer rebuilds taste_match: nothing reads it.
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
end $$;
revoke execute on function public.refresh_trust_tables() from public, anon, authenticated;
drop table if exists public.taste_match;

-- 7. AI cost: an overall daily ceiling for everyone together (app setting ai_daily_ceiling, in credits),
--    credits given back when the AI call fails.
insert into public.app_settings (key, value) values ('ai_daily_ceiling', '3000') on conflict (key) do nothing;

create table if not exists public.ai_usage_total (
  day     date primary key default current_date,
  credits integer not null default 0
);
alter table public.ai_usage_total enable row level security;
revoke all on public.ai_usage_total from anon, authenticated;

-- Count a call if it fits the person's allowance; raises 'ai_daily_ceiling' when everyone's total is used up
-- (which also undoes the person's count).
create or replace function public.ai_take(p_user uuid, p_cost integer, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v integer; t integer; c integer := greatest(coalesce(p_cost, 1), 1);
begin
  insert into public.ai_usage (user_id, day, calls) values (p_user, current_date, 0)
  on conflict (user_id, day) do nothing;
  update public.ai_usage set calls = calls + c
  where user_id = p_user and day = current_date and calls + c <= p_limit
  returning calls into v;
  if v is null then return false; end if;
  insert into public.ai_usage_total (day, credits) values (current_date, 0) on conflict (day) do nothing;
  update public.ai_usage_total set credits = credits + c
  where day = current_date and credits + c <= public.setting_int('ai_daily_ceiling', 3000)
  returning credits into t;
  if t is null then raise exception 'ai_daily_ceiling: AI help has reached today''s limit'; end if;
  delete from public.ai_usage where day < current_date - 7;
  delete from public.ai_usage_total where day < current_date - 60;
  return true;
end $$;
revoke execute on function public.ai_take(uuid, integer, integer) from public, anon, authenticated;
do $$ begin
  grant execute on function public.ai_take(uuid, integer, integer) to service_role;
exception when undefined_object then null; end $$;

-- Give back what a failed AI call took (today's counts only).
create or replace function public.ai_give_back(p_user uuid, p_cost integer)
returns void language plpgsql security definer set search_path = public as $$
declare c integer := greatest(coalesce(p_cost, 0), 0);
begin
  if c = 0 then return; end if;
  update public.ai_usage set calls = greatest(calls - c, 0) where user_id = p_user and day = current_date;
  update public.ai_usage_total set credits = greatest(credits - c, 0) where day = current_date;
end $$;
revoke execute on function public.ai_give_back(uuid, integer) from public, anon, authenticated;
do $$ begin
  grant execute on function public.ai_give_back(uuid, integer) to service_role;
exception when undefined_object then null; end $$;

-- ===== 20261018000032_diet_tags.sql =====
-- Trusted Picks: diet tags on items (veg, non_veg, egg, vegan, jain, gluten_free).
alter table public.items add column if not exists diet text[] default '{}';

alter table public.items drop constraint if exists items_diet_chk;
alter table public.items add constraint items_diet_chk check (
  diet is null or diet <@ array['veg', 'non_veg', 'egg', 'vegan', 'jain', 'gluten_free']::text[]
);

-- ===== 20261018000033_owner_notes_gating.sql =====
-- Trusted Picks: private notes to the owner, anonymous and visit-only, and plan checks on the server.
--  * One notes table (owner_notes). The earlier place_feedback table is folded in and dropped.
--  * A note is not linked to any review or account the owner can see. Owners read notes only through
--    my_owner_notes(); the text and contact are withheld unless the plan includes notes.
--  * Sending needs an open visit (table QR or review link) at that shop: at most 3 notes per visit and
--    5 per phone per day.
--  * place_has_feature() also checks that the plan period has not ended.
--  * shop_item_stats() returns rows only when the plan includes insights.

-- 1. owner_notes: no link to a review; remember the visit and phone only to limit abuse.
create table if not exists public.owner_notes (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places (id) on delete cascade,
  item_id      uuid references public.items (id) on delete set null,
  body         text not null check (length(btrim(body)) between 1 and 2000),
  contact      text check (contact is null or length(contact) <= 200),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  replied_at   timestamptz
);
alter table public.owner_notes drop column if exists review_id;
alter table public.owner_notes add column if not exists visit_id uuid references public.visits (id) on delete set null;
alter table public.owner_notes add column if not exists device_hash text;
create index if not exists owner_notes_place_idx on public.owner_notes (place_id, created_at desc);
create index if not exists owner_notes_visit_idx on public.owner_notes (visit_id) where visit_id is not null;
create index if not exists owner_notes_device_idx on public.owner_notes (device_hash, created_at) where device_hash is not null;

-- 2. Fold in notes from the older table, without who sent them, then drop it.
-- Clear out every overload of the old feedback functions, whatever their arguments (a database patched by hand may have others).
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('submit_private_feedback', 'get_place_feedback') loop
    execute 'drop function ' || r.sig;
  end loop;
  -- A stray my_reviews(limit, offset) made by hand makes my_reviews(p_limit => n) ambiguous for the app.
  drop function if exists public.my_reviews(integer, integer);
end $$;
do $$ begin
  if to_regclass('public.place_feedback') is not null then
    if (select relkind from pg_class where oid = 'public.place_feedback'::regclass) = 'r' then
      insert into public.owner_notes (place_id, body, contact, created_at, read_at)
      select f.place_id, left(btrim(f.message), 2000), f.contact_info, f.created_at,
             case when f.status = 'unread' then null else f.created_at end
      from public.place_feedback f
      where length(btrim(f.message)) > 0
        and not exists (select 1 from public.owner_notes n where n.place_id = f.place_id and n.created_at = f.created_at and n.body = left(btrim(f.message), 2000));
      drop table public.place_feedback;
    else
      -- Only a compatibility view over owner_notes (made by hand): nothing to copy, just remove it.
      drop view public.place_feedback cascade;
    end if;
  end if;
end $$;

-- 3. Nobody reads the table directly any more.
alter table public.owner_notes enable row level security;
drop policy if exists "owners read notes" on public.owner_notes;
drop policy if exists "owners update notes" on public.owner_notes;
revoke all on public.owner_notes from public, anon, authenticated;

-- 4. Sending a note.
drop function if exists public.send_owner_note(uuid, text, uuid, text, uuid);
create or replace function public.send_owner_note(
  p_place uuid, p_body text, p_item uuid default null, p_contact text default null, p_device text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_visit uuid; v_id uuid; v_msg text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'open the page again to send a note'; end if;
  if length(v_msg) < 1 then raise exception 'write a few words first'; end if;
  if length(v_msg) > 1000 then raise exception 'keep the note under 1,000 characters'; end if;
  if public.is_place_owner(p_place) then raise exception 'owners can''t send a note to their own shop'; end if;
  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;
  if v_visit is null then raise exception 'notes come from people at the shop. Scan the table code again'; end if;
  if (select count(*) from public.owner_notes where visit_id = v_visit) >= 3 then
    raise exception 'you''ve sent a few notes already. The owner will see them';
  end if;
  if p_device is not null and (select count(*) from public.owner_notes
       where device_hash = left(p_device, 80) and created_at > now() - interval '1 day') >= 5 then
    raise exception 'that''s a lot of notes for one day. Try again tomorrow';
  end if;
  if p_item is not null and not exists (select 1 from public.items where id = p_item and place_id = p_place) then p_item := null; end if;
  insert into public.owner_notes (place_id, item_id, body, contact, visit_id, device_hash)
  values (p_place, p_item, v_msg, nullif(left(btrim(coalesce(p_contact, '')), 200), ''), v_visit, left(p_device, 80))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.send_owner_note(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.send_owner_note(uuid, text, uuid, text, text) to authenticated;

-- 5. Plan features, checked on the server.
create or replace function public.place_has_feature(p_place uuid, p_feature text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_order integer; v_status text; v_end timestamptz;
begin
  if public.is_admin() then return true; end if;
  select coalesce(pl.sort_order, 0), s.status, s.period_end into v_order, v_status, v_end
  from public.subscriptions s left join public.plans pl on pl.code = s.plan
  where s.place_id = p_place;
  if not found then return false; end if;
  if v_status in ('cancelled', 'expired', 'past_due', 'trial') or v_end < now() then return false; end if;
  if p_feature in ('insights', 'notes') then return v_order >= 2; end if;
  if p_feature = 'ai_insights' then return v_order >= 3; end if;
  return false;
end $$;
revoke execute on function public.place_has_feature(uuid, text) from public, anon;
grant execute on function public.place_has_feature(uuid, text) to authenticated;

-- 6. Owner reads notes. Text and contact only when the plan includes notes.
create or replace function public.my_owner_notes(p_place uuid)
returns table (id uuid, item_name text, created_at timestamptz, read_at timestamptz, locked boolean, body text, contact text)
language plpgsql stable security definer set search_path = public as $$
declare v_open boolean;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  v_open := public.place_has_feature(p_place, 'notes');
  return query
    select n.id, i.name, n.created_at, n.read_at, not v_open,
           case when v_open then n.body end, case when v_open then n.contact end
    from public.owner_notes n left join public.items i on i.id = n.item_id
    where n.place_id = p_place
    order by n.created_at desc limit 100;
end $$;
revoke execute on function public.my_owner_notes(uuid) from public, anon;
grant execute on function public.my_owner_notes(uuid) to authenticated;

create or replace function public.mark_note_read(p_note uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_place uuid;
begin
  select place_id into v_place from public.owner_notes where id = p_note;
  if v_place is null then return; end if;
  if not (public.is_admin() or public.is_place_owner(v_place)) then raise exception 'only the shop owner can do this'; end if;
  if not public.place_has_feature(v_place, 'notes') then raise exception 'upgrade your plan to read notes'; end if;
  update public.owner_notes set read_at = coalesce(read_at, now()) where id = p_note;
end $$;
revoke execute on function public.mark_note_read(uuid) from public, anon;
grant execute on function public.mark_note_read(uuid) to authenticated;

-- 7. Dish-level stats follow the plan.
create or replace function public.shop_item_stats(p_place uuid)
returns table (item_id uuid, name text, image_path text, reviews integer, avg_rating numeric, low_ratings integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  if not public.place_has_feature(p_place, 'insights') then return; end if;
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

-- ===== 20261018000034_review_limit_x3.sql =====
-- Trusted Picks: the per-QR review limit is three times as generous, so it never blocks real customers.
-- Each QR holds 3x the review tickets (at most 20) and a ticket comes back 3x as fast (at least every 30 seconds).
-- Still sized by business type, and a shop's own per-QR numbers are multiplied the same way.
create or replace function public.qr_jar(p_qr uuid)
returns table (size integer, refill integer)
language sql stable security definer set search_path = public as $$
  select least(20, 3 * coalesce(q.jar_size, q.seats, case coalesce(p.kind, 'food')
           when 'food' then 4 when 'store' then 3 when 'beauty' then 1 when 'health' then 1 else 2 end))::integer,
         greatest(30, coalesce(q.refill_seconds, case coalesce(p.kind, 'food')
           when 'food' then 900 when 'store' then 120 when 'beauty' then 1500 when 'health' then 1500
           when 'fitness' then 3600 when 'education' then 3600 when 'services' then 3600 else 600 end) / 3)::integer
  from public.qr_codes q join public.places p on p.id = q.place_id where q.id = p_qr;
$$;

-- ===== 20261018000035_visit_reviews.sql =====
-- Trusted Picks: a review of the whole visit. Many diners don't want to rate every dish, so the review
-- flow asks "How was your visit?" first and dishes become optional. A visit review needs the same open
-- visit as a dish review, keeps a guest to one visit per phone and place, and counts towards the daily cap.

create table if not exists public.visit_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  visit_id    uuid references public.visits (id) on delete set null,
  rating      smallint not null check (rating between 1 and 5),
  body        text not null default '' check (length(body) <= 2000),
  tags        text[] not null default '{}' check (cardinality(tags) <= 12),
  ai_drafted  boolean not null default false,
  is_public   boolean not null default false,
  by_guest    boolean not null default false,
  device_hash text,
  status      public.review_status not null default 'published',
  created_at  timestamptz not null default now()
);
create unique index if not exists visit_reviews_one_per_visit on public.visit_reviews (user_id, visit_id);
create index if not exists visit_reviews_place_idx on public.visit_reviews (place_id, status, created_at desc);
create index if not exists visit_reviews_user_idx on public.visit_reviews (user_id, created_at desc);

alter table public.visit_reviews enable row level security;
drop policy if exists visit_reviews_own on public.visit_reviews;
create policy visit_reviews_own on public.visit_reviews for select using (user_id = auth.uid());
-- Everyone else reads them through place_visit_reviews(), which never exposes who wrote an anonymous one.

create or replace function public.submit_visit_review(
  p_place_id uuid, p_rating smallint, p_body text default '', p_tags text[] default '{}',
  p_ai_drafted boolean default false, p_is_public boolean default false, p_device text default null)
returns public.visit_reviews
language plpgsql security definer set search_path = public, extensions as $$
declare v_visit uuid; r public.visit_reviews; v_guest boolean := coalesce(public.is_guest(), false); v_device text; v_tags text[];
begin
  if auth.uid() is null then raise exception 'open the review page again to continue'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;
  if v_visit is null then raise exception 'scan the table QR at the shop to write a review'; end if;
  if public.is_place_owner(p_place_id) then raise exception 'you can''t review your own shop'; end if;
  if not public.reviews_open(p_place_id) then raise exception 'reviews are paused here for now'; end if;

  v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
  if v_guest then
    if v_device is null then raise exception 'refresh the page and try again'; end if;
    if exists (select 1 from public.reviews where place_id = p_place_id and visit_id is distinct from v_visit
               and (user_id = auth.uid() or (device_hash = v_device and by_guest)))
       or exists (select 1 from public.visit_reviews where place_id = p_place_id and visit_id is distinct from v_visit
               and (user_id = auth.uid() or (device_hash = v_device and by_guest))) then
      raise exception 'you''ve already reviewed this place from this phone. Sign in to review more';
    end if;
  end if;

  if (select count(*) from public.reviews where user_id = auth.uid() and created_at > now() - interval '1 day')
     + (select count(*) from public.visit_reviews where user_id = auth.uid() and created_at > now() - interval '1 day')
     >= (case when v_guest then 5 else 25 end) then
    raise exception 'that''s a lot of reviews for one day. Try again tomorrow';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'pick how your visit went'; end if;
  if length(coalesce(p_body, '')) > 2000 then raise exception 'keep the review under 2000 characters'; end if;
  if exists (select 1 from public.visit_reviews where user_id = auth.uid() and visit_id = v_visit) then
    raise exception 'you''ve already reviewed this visit';
  end if;

  select coalesce(array_agg(t), '{}') into v_tags
  from (select distinct left(btrim(x), 30) t from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> '' limit 12) s;

  insert into public.visit_reviews (user_id, place_id, visit_id, rating, body, tags, ai_drafted, is_public, by_guest, device_hash)
  values (auth.uid(), p_place_id, v_visit, p_rating, btrim(coalesce(p_body, '')), v_tags, coalesce(p_ai_drafted, false),
          coalesce(p_is_public, false) and not v_guest, v_guest, v_device)
  returning * into r;
  return r;
end $$;
revoke execute on function public.submit_visit_review(uuid, smallint, text, text[], boolean, boolean, text) from public, anon;
grant execute on function public.submit_visit_review(uuid, smallint, text, text[], boolean, boolean, text) to authenticated;

-- Recent visit reviews for a shop page. The writer's name shows only when they chose "Show my name".
create or replace function public.place_visit_reviews(p_place uuid, p_limit integer default 20)
returns table (id uuid, rating smallint, body text, tags text[], created_at timestamptz, author text, verified boolean)
language sql stable security definer set search_path = public as $$
  select vr.id, vr.rating, vr.body, vr.tags, vr.created_at,
         case when vr.is_public then nullif(p.display_name, '') end,
         vr.visit_id is not null
  from public.visit_reviews vr
  join public.places pl on pl.id = vr.place_id and pl.status = 'live'
  left join public.profiles p on p.id = vr.user_id
  where vr.place_id = p_place and vr.status = 'published'
  order by vr.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
grant execute on function public.place_visit_reviews(uuid, integer) to anon, authenticated;

-- A guest who only reviewed the visit has also used this phone's one visit here.
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
  if not public.reviews_open(p_place) then return query select false, 'paused', v.expires_at; return; end if;
  if public.is_guest() then
    v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
    if exists (select 1 from public.reviews where place_id = p_place and visit_id is distinct from v.id
               and (user_id = auth.uid() or (v_device is not null and device_hash = v_device and by_guest)))
       or exists (select 1 from public.visit_reviews where place_id = p_place and visit_id is distinct from v.id
               and (user_id = auth.uid() or (v_device is not null and device_hash = v_device and by_guest))) then
      return query select false, 'guest_used', v.expires_at; return;
    end if;
  end if;
  return query select true, 'ok', v.expires_at;
end $$;
grant execute on function public.can_review(uuid, text) to authenticated;

-- ===== 20261018000036_visit_reviews_in_reviews.sql =====
-- Trusted Picks: the review of the whole visit is a normal review. It used to sit in its own table, so it never
-- showed on the shop page, never counted in scores, insights or the Me page, could not be reported or hidden, and
-- skipped the QR ticket jar and the free trial's review count. Now it is a row in `reviews` for a hidden item named
-- "Overall visit", so every one of those things works the same as for a dish.
--  * Free trial reviews and QR tickets are charged once per visit (the first review), not once per dish.
--  * The visit's quick tags are real tags (kind "visit": they never show as dish tags).
--  * Old rows from migration 35's visit_reviews table are copied across; that table is no longer used.

insert into public.tags (label, kinds) values
  ('Poor food', '{visit}'), ('Poor service', '{visit}'), ('Noisy', '{visit}'), ('Unhelpful staff', '{visit}'),
  ('Food', '{visit}'), ('Service', '{visit}'), ('Ambience', '{visit}'), ('Value', '{visit}'), ('Quick', '{visit}'), ('Staff', '{visit}'),
  ('Amazing food', '{visit}'), ('Lovely staff', '{visit}'), ('Great vibe', '{visit}'), ('Great value', '{visit}'),
  ('Super quick', '{visit}'), ('Great service', '{visit}')
on conflict (label) do nothing;

drop function if exists public.submit_visit_review(uuid, smallint, text, text[], boolean, boolean, text);
create function public.submit_visit_review(
  p_place_id uuid, p_rating smallint, p_body text default '', p_tags text[] default '{}',
  p_ai_drafted boolean default false, p_is_public boolean default false, p_device text default null)
returns public.reviews
language plpgsql security definer set search_path = public, extensions as $$
declare it public.items; v_visit uuid; r public.reviews; v_guest boolean := coalesce(public.is_guest(), false); v_device text;
begin
  if auth.uid() is null then raise exception 'open the review page again to continue'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;
  if v_visit is null then raise exception 'scan the table QR at the shop to write a review'; end if;
  if public.is_place_owner(p_place_id) then raise exception 'you can''t review your own shop'; end if;

  v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
  if v_guest then
    if v_device is null then raise exception 'refresh the page and try again'; end if;
    if exists (select 1 from public.reviews where place_id = p_place_id and visit_id is distinct from v_visit
               and (user_id = auth.uid() or (device_hash = v_device and by_guest))) then
      raise exception 'you''ve already reviewed this place from this phone. Sign in to review more';
    end if;
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'pick how your visit went'; end if;
  if length(coalesce(p_body, '')) > 2000 then raise exception 'keep the review under 2000 characters'; end if;

  -- The visit is rated as a hidden item, so it flows through every review feature. Reviews being open, the QR
  -- ticket and the trial count are checked by the reviews triggers, the same as for a dish.
  insert into public.items (place_id, name, is_hidden, is_listed)
  values (p_place_id, 'Overall visit', true, false)
  on conflict (place_id, name_normalized) do update set is_hidden = true
  returning * into it;
  if exists (select 1 from public.reviews where user_id = auth.uid() and visit_id = v_visit and item_id = it.id) then
    raise exception 'you''ve already reviewed this visit';
  end if;

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, visit_id, is_public, by_guest, device_hash)
  values (auth.uid(), p_place_id, it.id, p_rating, btrim(coalesce(p_body, '')), coalesce(p_ai_drafted, false), v_visit,
          coalesce(p_is_public, false) and not v_guest, v_guest, v_device)
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t.id from public.tags t where t.label = any (coalesce(p_tags, '{}'))
  order by t.id limit 12
  on conflict do nothing;

  return r;
end $$;
revoke execute on function public.submit_visit_review(uuid, smallint, text, text[], boolean, boolean, text) from public, anon;
grant execute on function public.submit_visit_review(uuid, smallint, text, text[], boolean, boolean, text) to authenticated;

drop function if exists public.place_visit_reviews(uuid, integer);

-- A dish review: the whole-visit review no longer uses up the daily dish allowance.
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
    -- One visit per phone and place; inside that visit a guest can rate every dish they had.
    if exists (select 1 from public.reviews where place_id = p_place_id and visit_id is distinct from v_visit
               and (user_id = auth.uid() or (device_hash = v_device and by_guest))) then
      raise exception 'you''ve already reviewed this place from this phone. Sign in to review more';
    end if;
  end if;

  -- The review of the whole visit isn't a dish, so it doesn't use up the daily allowance of dish reviews.
  if (select count(*) from public.reviews rv join public.items iv on iv.id = rv.item_id
      where rv.user_id = auth.uid() and rv.created_at > now() - interval '1 day' and iv.name_normalized <> 'overall visit')
     >= (case when v_guest then 5 else 25 end) then
    raise exception 'that''s a lot of reviews for one day. Try again tomorrow';
  end if;
  v_name := btrim(coalesce(p_item_name, ''));
  if v_name = '' then raise exception 'say what you had'; end if;
  if lower(v_name) = 'overall visit' then raise exception 'pick a different name for that'; end if;
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

-- Can this person review here? Visit reviews are in `reviews` now, so this is the dish version again.
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
  if not public.reviews_open(p_place) then return query select false, 'paused', v.expires_at; return; end if;
  if public.is_guest() then
    v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
    if exists (select 1 from public.reviews where place_id = p_place and visit_id is distinct from v.id
               and (user_id = auth.uid() or (v_device is not null and device_hash = v_device and by_guest))) then
      return query select false, 'guest_used', v.expires_at; return;
    end if;
  end if;
  return query select true, 'ok', v.expires_at;
end $$;
grant execute on function public.can_review(uuid, text) to authenticated;

-- Trial reviews and QR tickets are charged once per visit.
create or replace function public.check_review_allowed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.visits; j record; q public.qr_codes; t double precision; wait_min integer;
begin
  if new.visit_id is null or public.is_admin() then return new; end if;
  -- A visit that already has a review can add the rest of the meal: no second ticket, no second trial review,
  -- and no pause stops someone halfway through.
  if exists (select 1 from public.reviews where visit_id = new.visit_id) then return new; end if;
  if not public.reviews_open(new.place_id) then
    raise exception 'reviews are paused at this shop for now';
  end if;
  select * into v from public.visits where id = new.visit_id;
  if v.qr_code_id is not null then
    select * into q from public.qr_codes where id = v.qr_code_id for update;
    select * into j from public.qr_jar(q.id);
    t := least(j.size, coalesce(q.tickets, j.size) + extract(epoch from now() - coalesce(q.tickets_at, now())) / j.refill);
    if t < 1 then
      wait_min := greatest(1, ceil((1 - t) * j.refill / 60.0));
      raise exception 'lots of reviews from this table just now. Try again in about % minute%', wait_min, case when wait_min = 1 then '' else 's' end;
    end if;
    update public.qr_codes set tickets = t - 1, tickets_at = now() where id = q.id;
  end if;
  update public.subscriptions set trial_reviews_left = greatest(trial_reviews_left - 1, 0), updated_at = now()
  where place_id = new.place_id and status = 'trial';
  return new;
end $$;
drop trigger if exists reviews_check_allowed on public.reviews;
create trigger reviews_check_allowed before insert on public.reviews
  for each row execute function public.check_review_allowed();

-- Search: the whole-visit review counts in the score but is never the "top item".
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null, p_kind text default null, p_offset integer default 0)
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
    select p.id, p.name, p.category, p.area, p.price_level, p.google_place_id, p.kind,
           case when here.pt is not null and p.location is not null then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here, q
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or lower(p.city) = lower(btrim(p_city)))
      and (p_area is null or btrim(p_area) = '' or lower(p.area) = lower(btrim(p_area)))
      and (p_kind is null or btrim(p_kind) = '' or p.kind = btrim(p_kind))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, least(greatest(coalesce(p_radius_m, 5000), 100), 200000))))
      -- With words typed: the shop's own name or category, or a reviewed item or topic that matches.
      and (q.txt is null or lower(p.name) like '%' || q.txt || '%' or lower(p.category) like '%' || q.txt || '%'
           or exists (select 1 from public.item_stats s join public.items i on i.id = s.item_id
                      left join public.topics t on t.id = i.topic_id
                      where s.place_id = p.id and s.review_count > 0
                        and i.name_normalized <> 'overall visit'
                        and (i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%')))
    -- Nearest first when there is a pin to measure from, otherwise the most reviewed.
    order by case when here.pt is not null then st_distance(p.location, here.pt) end asc nulls last,
             (select coalesce(sum(s.review_count), 0) from public.item_stats s where s.place_id = p.id) desc,
             p.created_at desc
    limit case when p_place is null then 250 else 1 end),
  fr as (select f.friend_id as uid from public.friendships f, me where f.user_id = me.uid),
  fr_arr as (select coalesce(array_agg(uid), '{}') as ids from fr),
  -- Each shop's newest 80 matching reviews, plus every one from your friends (up to 60), so who you trust always counts.
  sample as (
    select s.*
    from cand c
    cross join lateral (
      select * from (
        select r.id, r.place_id, r.rating, r.user_id, r.visit_id, r.created_at, r.is_public, r.by_guest, i.name as item_name, i.topic_id
        from public.reviews r
        join public.items i on i.id = r.item_id
        left join public.topics t on t.id = i.topic_id, q
        where r.place_id = c.id and r.status = 'published'
          and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%'
               or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%')
        order by r.created_at desc
        limit 80) newest
      union
      select * from (
        select r.id, r.place_id, r.rating, r.user_id, r.visit_id, r.created_at, r.is_public, r.by_guest, i.name as item_name, i.topic_id
        from public.reviews r
        join public.items i on i.id = r.item_id
        left join public.topics t on t.id = i.topic_id, q, fr_arr
        where r.place_id = c.id and r.status = 'published' and r.user_id = any (fr_arr.ids)
          and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%'
               or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%')
        order by r.created_at desc
        limit 60) mine) s),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from sample),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name, m.is_public,
      (case when fr.uid is not null then 3.0
            when m.is_public and f.follower_id is not null then 3.0
            when m.is_public and uts.is_expert then 1.5 else 1.0 end)
      * (case when vs.source = 'link' then 1.2 when vs.near is false then 0.4 when vs.near is null and m.visit_id is not null then 1.0 when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      (fr.uid is not null) as is_friend
    from sample m
    cross join me
    left join fr on fr.uid = m.user_id
    left join public.visits vs on vs.id = m.visit_id
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.user_topic_stats uts on m.is_public and uts.user_id = m.user_id and uts.topic_id = m.topic_id),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv
    from weighted w group by w.place_id),
  page as (
    select c.*, s.score, s.n, s.nv
    from cand c left join scored s on s.place_id = c.id, q
    where s.place_id is not null or q.txt is null
       or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
    order by s.score desc nulls last, c.dist asc nulls last, c.name, c.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)),
  -- The costlier per-shop details (who in your circle, the most reviewed item) only for the shops on this page.
  extras as (
    select w.place_id,
      count(distinct w.user_id) filter (where w.is_friend and w.is_public)::integer as nf_named,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend and w.is_public), '{}') as fids,
      mode() within group (order by w.item_name) filter (where w.item_name <> 'Overall visit') as top_item
    from weighted w where w.place_id in (select id from page) group by w.place_id)
  select pg.id, pg.name, pg.category, pg.area, pg.price_level, pg.google_place_id, pg.dist,
         pg.score,
         -- A shop with more than the sampled reviews gets its true counts (only when no words narrow them).
         case when pg.n >= 80 and (select txt from q) is null
              then (select count(*)::integer from public.reviews r where r.place_id = pg.id and r.status = 'published')
              else coalesce(pg.n, 0) end,
         case when pg.n >= 80 and (select txt from q) is null
              then (select count(r.visit_id)::integer from public.reviews r where r.place_id = pg.id and r.status = 'published')
              else coalesce(pg.nv, 0) end,
         coalesce(x.nf_named, 0),
         coalesce(x.fids, '{}'), x.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = pg.id and qc.active),
         pg.kind
  from page pg left join extras x on x.place_id = pg.id
  order by pg.score desc nulls last, pg.dist asc nulls last, pg.name, pg.id;
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid, text, integer) to anon, authenticated;

-- Insights: the whole-visit review is not a dish.
drop function if exists public.shop_stats(uuid);
create function public.shop_stats(p_place uuid)
returns table (reviews integer, avg_rating numeric, reviews_30d integer, verified integer,
               google_handoffs integer, google_handoffs_30d integer, scans_30d integer, saves integer, items_rated integer,
               link_visits_30d integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query select
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.created_at > now() - interval '30 days'),
    -- Visits (a table scan or a review link) that led to at least one published review.
    (select count(distinct r.visit_id)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.visit_id is not null),
    -- Reviews whose writer opened Google to post them there (we can't see whether they did post).
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place),
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place and g.opened_at > now() - interval '30 days'),
    (select count(*)::integer from public.visits v where v.place_id = p_place and v.source = 'qr' and v.scanned_at > now() - interval '30 days'),
    (select count(*)::integer from public.saved_places s where s.place_id = p_place),
    (select count(distinct r.item_id)::integer from public.reviews r join public.items i on i.id = r.item_id where r.place_id = p_place and r.status = 'published' and i.name_normalized <> 'overall visit'),
    (select count(*)::integer from public.visits v where v.place_id = p_place and v.source = 'link' and v.scanned_at > now() - interval '30 days');
end $$;
revoke all on function public.shop_stats(uuid) from public, anon;
grant execute on function public.shop_stats(uuid) to authenticated;

create or replace function public.shop_item_stats(p_place uuid)
returns table (item_id uuid, name text, image_path text, reviews integer, avg_rating numeric, low_ratings integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  if not public.place_has_feature(p_place, 'insights') then return; end if;
  return query
    select i.id, i.name, i.image_path, count(r.id)::integer, round(avg(r.rating)::numeric, 1),
           count(r.id) filter (where r.rating <= 2)::integer
    from public.items i
    join public.reviews r on r.item_id = i.id and r.status = 'published'
    where i.place_id = p_place and i.name_normalized <> 'overall visit'
    group by i.id
    order by avg(r.rating) desc, count(r.id) desc;
end $$;
revoke execute on function public.shop_item_stats(uuid) from public, anon;
grant execute on function public.shop_item_stats(uuid) to authenticated;

-- Copy rows from the old visit_reviews table (if migration 35 was run) into reviews.
do $$
begin
  if to_regclass('public.visit_reviews') is not null then
    alter table public.reviews disable trigger reviews_check_allowed;
    insert into public.items (place_id, name, is_hidden, is_listed)
    select distinct vr.place_id, 'Overall visit', true, false from public.visit_reviews vr
    on conflict (place_id, name_normalized) do update set is_hidden = true;
    insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, visit_id, status, is_public, by_guest, device_hash, created_at)
    select vr.user_id, vr.place_id, i.id, vr.rating, vr.body, vr.ai_drafted, vr.visit_id, vr.status, vr.is_public, vr.by_guest, vr.device_hash, vr.created_at
    from public.visit_reviews vr
    join public.items i on i.place_id = vr.place_id and i.name_normalized = 'overall visit'
    where not exists (select 1 from public.reviews r where r.user_id = vr.user_id and r.item_id = i.id and r.visit_id is not distinct from vr.visit_id);
    insert into public.review_tags (review_id, tag_id)
    select r.id, g.id
    from public.visit_reviews vr
    join public.items i on i.place_id = vr.place_id and i.name_normalized = 'overall visit'
    join public.reviews r on r.user_id = vr.user_id and r.item_id = i.id and r.visit_id is not distinct from vr.visit_id
    cross join lateral unnest(vr.tags) as t(label)
    join public.tags g on g.label = (case when vr.rating <= 3 then
        (case t.label when 'Food' then 'Poor food' when 'Service' then 'Poor service' when 'Pricey' then 'Too pricey'
                      when 'Cleanliness' then 'Not clean' when 'Staff' then 'Unhelpful staff' else t.label end)
      else t.label end)
    on conflict do nothing;
    alter table public.reviews enable trigger reviews_check_allowed;
    comment on table public.visit_reviews is 'Not used since migration 36: a visit review is a row in reviews for the hidden item "Overall visit". Safe to drop.';
  end if;
exception when others then
  raise notice 'Old visit reviews were not copied: %', sqlerrm;
end $$;

-- ===== 20261019000037_dish_discovery.sql =====
-- Trusted Picks: dish discovery.
-- People decide what to eat dish by dish ("where are the best momos?", "what do I order here?"),
-- so the app ranks dishes, not only shops. top_dishes() feeds "Best dishes near you" on the home
-- page, the dish pages (/best/<city>/<dish>), "Loved nearby" after a review and link previews.
-- dish_pages() lists the city and dish pairs with enough reviews to deserve a page (for the sitemap).

-- Ranked dishes, read from item_stats so it stays fast. The score is a Bayesian average
-- (3 imaginary ratings of 3.8), so one 5-star rating never beats forty ratings averaging 4.7.
-- Dishes your friends loved (on reviews that show their name) get a small lift.
create or replace function public.top_dishes(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 15000, p_city text default null, p_area text default null,
  p_place uuid default null, p_exclude_place uuid default null, p_kind text default null,
  p_limit integer default 20, p_offset integer default 0)
returns table (
  item_id uuid, item_name text, image_path text, price_inr integer, diet text[],
  place_id uuid, place_name text, area text, city text, kind text, hours jsonb,
  distance_m integer, review_count integer, avg_rating numeric, loved_count integer, friend_loved integer, score numeric)
language sql stable security definer set search_path = public, extensions as $$
  with q as (select nullif(lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'))), '') as txt),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  cand as (
    select i.id, i.name, i.image_path, i.price_inr, i.diet, p.id as pid, p.name as pname, p.area, p.city, p.kind, p.hours,
           case when here.pt is not null and p.location is not null then st_distance(p.location, here.pt)::integer end as dist,
           s.review_count, s.avg_rating,
           (s.avg_rating * s.review_count + 3.8 * 3) / (s.review_count + 3) as bayes
    from public.item_stats s
    join public.items i on i.id = s.item_id
    join public.places p on p.id = s.place_id
    left join public.topics t on t.id = i.topic_id
    cross join here
    cross join q
    where p.status = 'live' and not i.is_hidden and i.name_normalized <> 'overall visit' and s.review_count > 0
      and (p_place is null or p.id = p_place)
      and (p_exclude_place is null or p.id <> p_exclude_place)
      and (p_city is null or btrim(p_city) = '' or lower(p.city) = lower(btrim(p_city)))
      and (p_area is null or btrim(p_area) = '' or lower(p.area) = lower(btrim(p_area)))
      and (p_kind is null or btrim(p_kind) = '' or p.kind = btrim(p_kind))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, least(greatest(coalesce(p_radius_m, 15000), 100), 200000))))
      and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%')
    order by bayes desc, s.review_count desc
    limit 150),
  fr as (select f.friend_id from public.friendships f where f.user_id = auth.uid())
  select c.id, c.name, c.image_path, c.price_inr, c.diet, c.pid, c.pname, c.area, c.city, c.kind, c.hours, c.dist,
         c.review_count, round(c.avg_rating, 1), lv.loved::integer, lv.friends::integer,
         round(c.bayes + 0.15 * least(lv.friends, 3), 3) as score
  from cand c
  cross join lateral (
    select count(*) filter (where r.rating >= 4) as loved,
           count(*) filter (where r.rating >= 4 and r.is_public and r.user_id in (select friend_id from fr)) as friends
    from public.reviews r
    where r.item_id = c.id and r.status = 'published') lv
  order by score desc, c.review_count desc, c.dist asc nulls last
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.top_dishes(text, double precision, double precision, integer, text, text, uuid, uuid, text, integer, integer) from public;
grant execute on function public.top_dishes(text, double precision, double precision, integer, text, text, uuid, uuid, text, integer, integer) to anon, authenticated;

-- City and dish pairs with at least p_min_reviews reviews, most reviewed first.
create or replace function public.dish_pages(p_min_reviews integer default 3, p_limit integer default 5000)
returns table (city text, dish text, places integer, reviews integer)
language sql stable security definer set search_path = public as $$
  select min(p.city), i.name_normalized, count(distinct p.id)::integer, sum(s.review_count)::integer
  from public.item_stats s
  join public.items i on i.id = s.item_id
  join public.places p on p.id = s.place_id
  where p.status = 'live' and not i.is_hidden and i.name_normalized <> 'overall visit'
  group by lower(p.city), i.name_normalized
  having sum(s.review_count) >= greatest(coalesce(p_min_reviews, 3), 1)
  order by sum(s.review_count) desc, i.name_normalized
  limit least(greatest(coalesce(p_limit, 5000), 1), 50000);
$$;
revoke execute on function public.dish_pages(integer, integer) from public;
grant execute on function public.dish_pages(integer, integer) to anon, authenticated;

-- ===== 20261019000040_replies_currency.sql =====
-- Trusted Picks: owners reply to reviews, and every shop has its own currency.
-- 1. A shop's owner can answer any review of the shop in public: one reply per review, up to 600 characters,
--    shown under the review to everyone who can see it. A reply is about the review, never the reviewer:
--    it changes nothing about who can see an anonymous review's author (still no one but the author).
-- 2. Each shop has a currency (an ISO 4217 code, INR unless the owner picks another). Item prices stay in
--    items.price_inr, which now means the price in the shop's currency, in whole units.
-- Safe to run more than once.

-- ---------- 1. Owner replies ----------
alter table public.reviews add column if not exists owner_reply text;
alter table public.reviews add column if not exists owner_reply_at timestamptz;
alter table public.reviews drop constraint if exists reviews_owner_reply_check;
alter table public.reviews add constraint reviews_owner_reply_check
  check (owner_reply is null or char_length(owner_reply) between 1 and 600);
comment on column public.reviews.owner_reply is 'The shop owner''s public reply to this review (set only through reply_to_review)';
-- Only reply_to_review() writes a reply; reviewers edit their own review through other columns.
revoke update (owner_reply, owner_reply_at) on public.reviews from anon, authenticated;

-- The shop's owner sets, changes or (with empty text) removes the reply to a review of their shop.
-- The team can only take a reply down. Returns when the reply was posted, or null once it is removed.
create or replace function public.reply_to_review(p_review_id uuid, p_text text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_place uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_at timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in to reply'; end if;
  select r.place_id into v_place from public.reviews r where r.id = p_review_id;
  if not found then raise exception 'this review isn''t here any more'; end if;
  if not (public.is_place_owner(v_place) or (v_text is null and public.is_admin())) then
    raise exception 'only the shop owner can reply to its reviews';
  end if;
  if char_length(v_text) > 600 then raise exception 'keep the reply to 600 characters'; end if;
  v_at := case when v_text is null then null else now() end;
  update public.reviews set owner_reply = v_text, owner_reply_at = v_at where id = p_review_id;
  return v_at;
end $$;
revoke all on function public.reply_to_review(uuid, text) from public, anon;
grant execute on function public.reply_to_review(uuid, text) to authenticated;

-- Everyone who can see a review sees its reply: the same view as migration 30, two columns added at the end.
create or replace view public.review_feed with (security_barrier = true) as
select r.id,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.user_id end as user_id,
  r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null) as verified, r.photo_path,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.voice_path end as voice_path,
  r.status, r.is_public, r.created_at,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.display_name end as author_name,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.avatar_path end as author_avatar,
  (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id) as source,
  r.owner_reply, r.owner_reply_at
from public.reviews r
join public.profiles p on p.id = r.user_id
join public.places pl on pl.id = r.place_id
where (r.status = 'published' and pl.status = 'live') or r.user_id = auth.uid() or public.is_admin();
grant select on public.review_feed to anon, authenticated;

-- Your own reviews and a person's named reviews return review_feed rows, so they carry the reply too.
create or replace function public.my_reviews(p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns setof public.review_feed
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null), r.photo_path,
         r.voice_path, r.status, r.is_public, r.created_at, p.display_name, p.avatar_path,
         (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id),
         r.owner_reply, r.owner_reply_at
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  where auth.uid() is not null and r.user_id = auth.uid()
    and (p_before_created is null or (r.created_at, r.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.my_reviews(timestamptz, uuid, integer) from public, anon;
grant execute on function public.my_reviews(timestamptz, uuid, integer) to authenticated;

create or replace function public.person_reviews(p_user uuid, p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns setof public.review_feed
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null), r.photo_path,
         r.voice_path, r.status, r.is_public, r.created_at, p.display_name, p.avatar_path,
         (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id),
         r.owner_reply, r.owner_reply_at
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  join public.places pl on pl.id = r.place_id
  where r.user_id = p_user and r.is_public and r.status = 'published' and pl.status = 'live'
    and (p_before_created is null or (r.created_at, r.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.person_reviews(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.person_reviews(uuid, timestamptz, uuid, integer) to anon, authenticated;

-- ---------- 2. A currency for every shop ----------
alter table public.places add column if not exists currency text not null default 'INR';
alter table public.places drop constraint if exists places_currency_check;
alter table public.places add constraint places_currency_check check (currency ~ '^[A-Z]{3}$');
comment on column public.places.currency is 'ISO 4217 code of the currency the shop''s prices are in (INR, USD, EUR...)';
comment on column public.items.price_inr is 'Price in the shop''s currency (places.currency), in whole units. Named from when every shop was in India.';
-- Anyone may read it, like the shop's other public columns; owners change it with the rest of their details.
grant select (currency) on public.places to anon, authenticated;

-- Ranked dishes come from many shops, so each row says which currency its price is in.
-- Same as migration 37 with currency added at the end; adding a column means dropping the old one first.
drop function if exists public.top_dishes(text, double precision, double precision, integer, text, text, uuid, uuid, text, integer, integer);
create or replace function public.top_dishes(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 15000, p_city text default null, p_area text default null,
  p_place uuid default null, p_exclude_place uuid default null, p_kind text default null,
  p_limit integer default 20, p_offset integer default 0)
returns table (
  item_id uuid, item_name text, image_path text, price_inr integer, diet text[],
  place_id uuid, place_name text, area text, city text, kind text, hours jsonb,
  distance_m integer, review_count integer, avg_rating numeric, loved_count integer, friend_loved integer, score numeric,
  currency text)
language sql stable security definer set search_path = public, extensions as $$
  with q as (select nullif(lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'))), '') as txt),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  cand as (
    select i.id, i.name, i.image_path, i.price_inr, i.diet, p.id as pid, p.name as pname, p.area, p.city, p.kind, p.hours,
           case when here.pt is not null and p.location is not null then st_distance(p.location, here.pt)::integer end as dist,
           s.review_count, s.avg_rating,
           (s.avg_rating * s.review_count + 3.8 * 3) / (s.review_count + 3) as bayes,
           p.currency
    from public.item_stats s
    join public.items i on i.id = s.item_id
    join public.places p on p.id = s.place_id
    left join public.topics t on t.id = i.topic_id
    cross join here
    cross join q
    where p.status = 'live' and not i.is_hidden and i.name_normalized <> 'overall visit' and s.review_count > 0
      and (p_place is null or p.id = p_place)
      and (p_exclude_place is null or p.id <> p_exclude_place)
      and (p_city is null or btrim(p_city) = '' or lower(p.city) = lower(btrim(p_city)))
      and (p_area is null or btrim(p_area) = '' or lower(p.area) = lower(btrim(p_area)))
      and (p_kind is null or btrim(p_kind) = '' or p.kind = btrim(p_kind))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, least(greatest(coalesce(p_radius_m, 15000), 100), 200000))))
      and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%')
    order by bayes desc, s.review_count desc
    limit 150),
  fr as (select f.friend_id from public.friendships f where f.user_id = auth.uid())
  select c.id, c.name, c.image_path, c.price_inr, c.diet, c.pid, c.pname, c.area, c.city, c.kind, c.hours, c.dist,
         c.review_count, round(c.avg_rating, 1), lv.loved::integer, lv.friends::integer,
         round(c.bayes + 0.15 * least(lv.friends, 3), 3) as score,
         c.currency
  from cand c
  cross join lateral (
    select count(*) filter (where r.rating >= 4) as loved,
           count(*) filter (where r.rating >= 4 and r.is_public and r.user_id in (select friend_id from fr)) as friends
    from public.reviews r
    where r.item_id = c.id and r.status = 'published') lv
  order by score desc, c.review_count desc, c.dist asc nulls last
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.top_dishes(text, double precision, double precision, integer, text, text, uuid, uuid, text, integer, integer) from public;
grant execute on function public.top_dishes(text, double precision, double precision, integer, text, text, uuid, uuid, text, integer, integer) to anon, authenticated;

-- ===== 20261019000041_daily_stats.sql =====
-- Trusted Picks: privacy-friendly usage numbers for the team (marketing needs to know what works).
-- Only daily totals per metric are kept: no user id, no IP, no device, no path beyond a fixed list,
-- so nothing here can say who did what. The funnel (scans, reviews, Google hand-offs, new shops)
-- is counted from the tables that already exist.

create table if not exists public.daily_counts (
  day    date    not null default current_date,
  metric text    not null,
  n      integer not null default 0,
  primary key (day, metric)
);
alter table public.daily_counts enable row level security;
-- No policies: only the functions below read or write it.

-- Adds one to today's count for a known metric. Unknown names are ignored, so it can't be filled with junk.
create or replace function public.bump_stat(p_metric text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_metric is null or p_metric not in (
    'view_home', 'view_place', 'view_best', 'view_qr', 'view_business', 'view_pricing',
    'review_started', 'install_prompt', 'installed', 'share') then
    return;
  end if;
  insert into public.daily_counts (day, metric, n) values (current_date, p_metric, 1)
  on conflict (day, metric) do update set n = public.daily_counts.n + 1;
end $$;
revoke execute on function public.bump_stat(text) from public;
grant execute on function public.bump_stat(text) to anon, authenticated;

-- Admins: one row per day and metric for the last p_days days, the counted ones plus the funnel.
create or replace function public.admin_daily_stats(p_days integer default 30)
returns table (day date, metric text, n bigint)
language sql stable security definer set search_path = public as $$
  with span as (select current_date - (least(greatest(coalesce(p_days, 30), 1), 365) - 1) as since)
  select x.day, x.metric, x.n from (
    select c.day, c.metric, c.n::bigint from public.daily_counts c, span where c.day >= span.since
    union all
    select v.scanned_at::date, 'scans', count(*) from public.visits v, span where v.scanned_at >= span.since group by 1
    union all
    select r.created_at::date, 'reviews', count(*) from public.reviews r, span where r.created_at >= span.since group by 1
    union all
    select g.opened_at::date, 'google_opened', count(*) from public.google_shares g, span where g.opened_at >= span.since group by 1
    union all
    select p.created_at::date, 'new_places', count(*) from public.places p, span where p.created_at >= span.since group by 1
  ) x
  where public.is_admin()
  order by x.day desc, x.metric;
$$;
revoke execute on function public.admin_daily_stats(integer) from public;
grant execute on function public.admin_daily_stats(integer) to authenticated;

-- ===== 20261020000042_google_ranking.sql =====
-- Trusted Picks: Google's star rating and review count are kept on each place (filled by the onboarding
-- script from the Places API) and rank shops second, after our own trust score: among shops with the same
-- score (or none yet), the better and more reviewed on Google comes first.

alter table public.places add column if not exists google_rating numeric(2,1) check (google_rating is null or google_rating between 1 and 5);
alter table public.places add column if not exists google_rating_count integer check (google_rating_count is null or google_rating_count >= 0);
alter table public.places add column if not exists google_synced_at timestamptz;
grant select (google_rating, google_rating_count, google_synced_at) on public.places to anon, authenticated;

create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20,
  p_area text default null, p_place uuid default null, p_kind text default null, p_offset integer default 0)
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
    select p.id, p.name, p.category, p.area, p.price_level, p.google_place_id, p.kind,
           -- Google's rating pulled toward 4.0 until it has many reviews, so 5.0 from 3 people doesn't beat 4.4 from 9,000.
           case when p.google_rating is not null and coalesce(p.google_rating_count, 0) > 0
                then (p.google_rating * p.google_rating_count + 4.0 * 50) / (p.google_rating_count + 50) end as gscore,
           case when here.pt is not null and p.location is not null then st_distance(p.location, here.pt)::integer end as dist
    from public.places p, here, q
    where p.status = 'live'
      and (p_place is null or p.id = p_place)
      and (p_city is null or btrim(p_city) = '' or lower(p.city) = lower(btrim(p_city)))
      and (p_area is null or btrim(p_area) = '' or lower(p.area) = lower(btrim(p_area)))
      and (p_kind is null or btrim(p_kind) = '' or p.kind = btrim(p_kind))
      and (here.pt is null or (p.location is not null and st_dwithin(p.location, here.pt, least(greatest(coalesce(p_radius_m, 5000), 100), 200000))))
      -- With words typed: the shop's own name or category, or a reviewed item or topic that matches.
      and (q.txt is null or lower(p.name) like '%' || q.txt || '%' or lower(p.category) like '%' || q.txt || '%'
           or exists (select 1 from public.item_stats s join public.items i on i.id = s.item_id
                      left join public.topics t on t.id = i.topic_id
                      where s.place_id = p.id and s.review_count > 0
                        and i.name_normalized <> 'overall visit'
                        and (i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%')))
    -- Nearest first when there is a pin to measure from, otherwise the most reviewed.
    order by case when here.pt is not null then st_distance(p.location, here.pt) end asc nulls last,
             (select coalesce(sum(s.review_count), 0) from public.item_stats s where s.place_id = p.id) desc,
             coalesce(p.google_rating_count, 0) desc,
             p.created_at desc
    limit case when p_place is null then 250 else 1 end),
  fr as (select f.friend_id as uid from public.friendships f, me where f.user_id = me.uid),
  fr_arr as (select coalesce(array_agg(uid), '{}') as ids from fr),
  -- Each shop's newest 80 matching reviews, plus every one from your friends (up to 60), so who you trust always counts.
  sample as (
    select s.*
    from cand c
    cross join lateral (
      select * from (
        select r.id, r.place_id, r.rating, r.user_id, r.visit_id, r.created_at, r.is_public, r.by_guest, i.name as item_name, i.topic_id
        from public.reviews r
        join public.items i on i.id = r.item_id
        left join public.topics t on t.id = i.topic_id, q
        where r.place_id = c.id and r.status = 'published'
          and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%'
               or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%')
        order by r.created_at desc
        limit 80) newest
      union
      select * from (
        select r.id, r.place_id, r.rating, r.user_id, r.visit_id, r.created_at, r.is_public, r.by_guest, i.name as item_name, i.topic_id
        from public.reviews r
        join public.items i on i.id = r.item_id
        left join public.topics t on t.id = i.topic_id, q, fr_arr
        where r.place_id = c.id and r.status = 'published' and r.user_id = any (fr_arr.ids)
          and (q.txt is null or i.name_normalized like '%' || q.txt || '%' or lower(t.name) like '%' || q.txt || '%'
               or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%')
        order by r.created_at desc
        limit 60) mine) s),
  prior as (select coalesce(avg(rating), 3.5) as avg_r from sample),
  weighted as (
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name, m.is_public,
      (case when fr.uid is not null then 3.0
            when m.is_public and f.follower_id is not null then 3.0
            when m.is_public and uts.is_expert then 1.5 else 1.0 end)
      * (case when vs.source = 'link' then 1.2 when vs.near is false then 0.4 when vs.near is null and m.visit_id is not null then 1.0 when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      (fr.uid is not null) as is_friend
    from sample m
    cross join me
    left join fr on fr.uid = m.user_id
    left join public.visits vs on vs.id = m.visit_id
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.user_topic_stats uts on m.is_public and uts.user_id = m.user_id and uts.topic_id = m.topic_id),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv
    from weighted w group by w.place_id),
  page as (
    select c.*, s.score, s.n, s.nv
    from cand c left join scored s on s.place_id = c.id, q
    where s.place_id is not null or q.txt is null
       or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
    order by s.score desc nulls last, c.gscore desc nulls last, c.dist asc nulls last, c.name, c.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)),
  -- The costlier per-shop details (who in your circle, the most reviewed item) only for the shops on this page.
  extras as (
    select w.place_id,
      count(distinct w.user_id) filter (where w.is_friend and w.is_public)::integer as nf_named,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend and w.is_public), '{}') as fids,
      mode() within group (order by w.item_name) filter (where w.item_name <> 'Overall visit') as top_item
    from weighted w where w.place_id in (select id from page) group by w.place_id)
  select pg.id, pg.name, pg.category, pg.area, pg.price_level, pg.google_place_id, pg.dist,
         pg.score,
         -- A shop with more than the sampled reviews gets its true counts (only when no words narrow them).
         case when pg.n >= 80 and (select txt from q) is null
              then (select count(*)::integer from public.reviews r where r.place_id = pg.id and r.status = 'published')
              else coalesce(pg.n, 0) end,
         case when pg.n >= 80 and (select txt from q) is null
              then (select count(r.visit_id)::integer from public.reviews r where r.place_id = pg.id and r.status = 'published')
              else coalesce(pg.nv, 0) end,
         coalesce(x.nf_named, 0),
         coalesce(x.fids, '{}'), x.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = pg.id and qc.active),
         pg.kind
  from page pg left join extras x on x.place_id = pg.id
  order by pg.score desc nulls last, pg.gscore desc nulls last, pg.dist asc nulls last, pg.name, pg.id;
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid, text, integer) to anon, authenticated;

-- ===== 20261022000043_nfc_tags.sql =====
-- Trusted Picks: NFC table tags (NXP NTAG 424 DNA with Secure Unique NFC, "SUN").
-- A tag sits next to a table QR. Every tap makes the phone open a fresh link to the same /q/<token> page
-- with two extra values: picc (the tag's id and tap counter, encrypted) and cmac (a signature). The tag's
-- secret key never leaves the tag or this database, so a link can't be made up, and because the counter
-- must go up, a copied or photographed link works only once. A verified tap counts as "at the shop",
-- like a scan with the phone's location nearby, without asking for or keeping any location.
-- The checks follow NXP AN12196 (AES-128: PICC data decrypted with the meta read key, SDMMAC from a
-- session key derived with CMAC). One key per tag serves as both the meta read and file read key.

create table if not exists public.nfc_tags (
  qr_code_id   uuid primary key references public.qr_codes (id) on delete cascade,
  key          bytea not null default extensions.gen_random_bytes(16) check (length(key) = 16),
  uid          bytea check (uid is null or length(uid) = 7),      -- learned from the first good tap
  last_counter integer not null default -1,
  last_user    uuid references public.profiles (id) on delete set null,
  last_tap_at  timestamptz,
  created_at   timestamptz not null default now()
);
-- No policies: nobody reads keys directly. Owners get their tag's key through nfc_tag_setup().
alter table public.nfc_tags enable row level security;
revoke all on public.nfc_tags from anon, authenticated;

alter table public.visits add column if not exists tapped boolean not null default false;

-- AES-128 on one 16-byte block.
create or replace function public._aes_block(p_key bytea, p_block bytea)
returns bytea language sql immutable strict set search_path = public, extensions as $$
  select extensions.encrypt(p_block, p_key, 'aes-ecb/pad:none');
$$;

-- One bit to the left across a 16-byte block, for the CMAC subkeys.
create or replace function public._shift1(p bytea)
returns bytea language plpgsql immutable strict as $$
declare r bytea := p; i integer; carry integer := 0; b integer;
begin
  for i in reverse 15..0 loop
    b := get_byte(p, i);
    r := set_byte(r, i, ((b << 1) & 255) | carry);
    carry := (b >> 7) & 1;
  end loop;
  return r;
end $$;

create or replace function public._xor16(a bytea, b bytea)
returns bytea language plpgsql immutable strict as $$
declare r bytea := a; i integer;
begin
  for i in 0..15 loop r := set_byte(r, i, get_byte(a, i) # get_byte(b, i)); end loop;
  return r;
end $$;

-- AES-CMAC (RFC 4493) of any message, using AES-128.
create or replace function public._aes_cmac(p_key bytea, p_msg bytea)
returns bytea language plpgsql immutable strict set search_path = public as $$
declare
  zero bytea := '\x00000000000000000000000000000000';
  rb   bytea := '\x00000000000000000000000000000087';
  l bytea; k1 bytea; k2 bytea; n integer; last bytea; x bytea := zero; i integer;
begin
  l := public._aes_block(p_key, zero);
  k1 := public._shift1(l);
  if get_byte(l, 0) >= 128 then k1 := public._xor16(k1, rb); end if;
  k2 := public._shift1(k1);
  if get_byte(k1, 0) >= 128 then k2 := public._xor16(k2, rb); end if;
  n := greatest(1, (length(p_msg) + 15) / 16);
  if length(p_msg) > 0 and length(p_msg) % 16 = 0 then
    last := public._xor16(substring(p_msg from (n - 1) * 16 + 1 for 16), k1);
  else
    last := substring(p_msg from (n - 1) * 16 + 1) || '\x80'::bytea;
    last := last || substring(zero from 1 for 16 - length(last));
    last := public._xor16(last, k2);
  end if;
  for i in 0..n - 2 loop
    x := public._aes_block(p_key, public._xor16(x, substring(p_msg from i * 16 + 1 for 16)));
  end loop;
  return public._aes_block(p_key, public._xor16(x, last));
end $$;

-- Checks one tap's picc + cmac against a key. Returns the tag id and counter, or nothing if it's not genuine.
create or replace function public._sun_check(p_key bytea, p_picc text, p_cmac text)
returns table (uid bytea, counter integer)
language plpgsql immutable set search_path = public, extensions as $$
declare picc bytea; plain bytea; v_uid bytea; ctr bytea; ses bytea; full_mac bytea; mac bytea := ''; i integer;
begin
  if p_picc !~* '^[0-9a-f]{32}$' or p_cmac !~* '^[0-9a-f]{16}$' then return; end if;
  picc := decode(p_picc, 'hex');
  plain := extensions.decrypt(picc, p_key, 'aes-cbc/pad:none');
  -- 0xC7: the tag mirrors its 7-byte id and its 3-byte counter.
  if get_byte(plain, 0) <> 199 then return; end if;
  v_uid := substring(plain from 2 for 7);
  ctr := substring(plain from 9 for 3);
  ses := public._aes_cmac(p_key, '\x3cc300010080'::bytea || v_uid || ctr);
  full_mac := public._aes_cmac(ses, ''::bytea);
  for i in 0..7 loop mac := mac || substring(full_mac from i * 2 + 2 for 1); end loop;
  if mac <> decode(p_cmac, 'hex') then return; end if;
  return query select v_uid, get_byte(ctr, 0) + (get_byte(ctr, 1) << 8) + (get_byte(ctr, 2) << 16);
end $$;

revoke execute on function public._aes_block(bytea, bytea) from public, anon, authenticated;
revoke execute on function public._aes_cmac(bytea, bytea) from public, anon, authenticated;
revoke execute on function public._sun_check(bytea, text, text) from public, anon, authenticated;

-- A tap on a table's NFC tag: checks the tag, then opens (or reuses) the visit exactly like scan_qr does,
-- marked as at the shop. Opening the same tap link again on the same phone is fine; anyone else is refused.
create or replace function public.tap_nfc(p_token text, p_picc text, p_cmac text)
returns table (visit_id uuid, place_id uuid, place_name text, area text, table_label text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare t public.nfc_tags; chk record; s record;
begin
  if auth.uid() is null then raise exception 'sign in to scan'; end if;
  select nt.* into t from public.nfc_tags nt join public.qr_codes qc on qc.id = nt.qr_code_id
  where qc.token = p_token and qc.active;
  if not found then raise exception 'this tag isn''t set up yet. Scan the QR code instead'; end if;

  select * into chk from public._sun_check(t.key, p_picc, p_cmac);
  if chk.uid is null or (t.uid is not null and t.uid <> chk.uid) then
    raise exception 'this tag link isn''t genuine. Scan the QR code instead';
  end if;
  if chk.counter < t.last_counter or (chk.counter = t.last_counter and t.last_user is distinct from auth.uid()) then
    raise exception 'this tap link was already used. Tap the tag again';
  end if;
  update public.nfc_tags
     set uid = coalesce(nfc_tags.uid, chk.uid), last_counter = chk.counter, last_user = auth.uid(), last_tap_at = now()
   where qr_code_id = t.qr_code_id and nfc_tags.last_counter <= chk.counter;
  if not found then raise exception 'this tap link was already used. Tap the tag again'; end if;

  select * into s from public.scan_qr(p_token) limit 1;
  update public.visits set near = true, tapped = true where id = s.visit_id;
  return query select s.visit_id, s.place_id, s.place_name, s.area, s.table_label, s.expires_at;
end $$;
revoke execute on function public.tap_nfc(text, text, text) from public, anon;
grant execute on function public.tap_nfc(text, text, text) to authenticated;

-- For the owner (or an admin): the key and status of one table's tag, made on first ask.
create or replace function public.nfc_tag_setup(p_qr uuid, p_new_key boolean default false)
returns table (qr_code_id uuid, key_hex text, linked boolean, taps integer, last_tap_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare v_place uuid;
begin
  select qc.place_id into v_place from public.qr_codes qc where qc.id = p_qr and qc.active;
  if v_place is null then raise exception 'unknown table code'; end if;
  if not (public.is_admin() or public.is_place_owner(v_place)) then raise exception 'not your shop'; end if;
  insert into public.nfc_tags (qr_code_id) values (p_qr) on conflict on constraint nfc_tags_pkey do nothing;
  if p_new_key then
    update public.nfc_tags set key = extensions.gen_random_bytes(16), uid = null, last_counter = -1, last_user = null, last_tap_at = null
    where nfc_tags.qr_code_id = p_qr;
  end if;
  return query select nt.qr_code_id, upper(encode(nt.key, 'hex')), nt.uid is not null, greatest(nt.last_counter, 0), nt.last_tap_at
  from public.nfc_tags nt where nt.qr_code_id = p_qr;
end $$;
revoke execute on function public.nfc_tag_setup(uuid, boolean) from public, anon;
grant execute on function public.nfc_tag_setup(uuid, boolean) to authenticated;

-- ===== 20261022000044_similar_dishes.sql =====
-- Trusted Picks: "Similar dishes" for a dish someone is looking at, from other shops nearby.
-- Each product's name gets a small meaning vector (gte-small, 384 numbers, made inside the `ai` Edge Function by
-- Supabase's built-in model, so no AI company sees it). pgvector finds the closest names, and the best of those
-- by how many people loved them come first. Products without a vector yet fall back to similar spelling or the
-- same topic, so the section works from day one.
-- Ranking uses the Wilson lower bound of the "loved" share (4 or 5 stars): 2 of 2 loved ranks below 38 of 40,
-- because a small sample could easily be luck.

create extension if not exists vector with schema extensions;

-- Kept apart from items so the vectors never travel with menu reads.
create table if not exists public.item_embeddings (
  item_id    uuid primary key references public.items (id) on delete cascade,
  name       text not null,                 -- the text that was embedded; a renamed product gets a new vector
  embedding  extensions.vector(384) not null,
  created_at timestamptz not null default now()
);
alter table public.item_embeddings enable row level security;
revoke all on public.item_embeddings from anon, authenticated;
create index if not exists item_embeddings_hnsw on public.item_embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- Lower bound of the share of positive ratings (Wilson score interval, 90% confidence).
create or replace function public.wilson_lower(p_pos integer, p_n integer, p_z double precision default 1.645)
returns double precision language sql immutable as $$
  select case when coalesce(p_n, 0) <= 0 then 0::double precision else
    ((p_pos::double precision / p_n) + p_z * p_z / (2 * p_n)
      - p_z * sqrt(((p_pos::double precision / p_n) * (1 - p_pos::double precision / p_n) + p_z * p_z / (4 * p_n)) / p_n))
    / (1 + p_z * p_z / p_n) end;
$$;
grant execute on function public.wilson_lower(integer, integer, double precision) to anon, authenticated;

-- Dishes like this one at other shops, best loved first. Same columns as top_dishes so the app shows them the same way.
create or replace function public.similar_items(
  p_item uuid, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 15000, p_limit integer default 10)
returns table (
  item_id uuid, item_name text, image_path text, price_inr integer, diet text[],
  place_id uuid, place_name text, area text, city text, kind text, hours jsonb,
  distance_m integer, review_count integer, avg_rating numeric, loved_count integer, friend_loved integer, score numeric,
  currency text)
language sql stable security definer set search_path = public, extensions as $$
  with me as (
    select i.id, i.place_id, i.topic_id, i.name_normalized, p.city, e.embedding
    from public.items i join public.places p on p.id = i.place_id
    left join public.item_embeddings e on e.item_id = i.id
    where i.id = p_item),
  here as (
    select case when p_lat is not null and p_lng is not null
                then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as pt),
  -- Closest meanings first (uses the vector index), or similar names / the same topic without a vector.
  near_meaning as (
    select e.item_id, 1 - (e.embedding <=> me.embedding) as sim
    from public.item_embeddings e, me
    where me.embedding is not null and e.item_id <> me.id
    order by e.embedding <=> me.embedding
    limit 300),
  near_name as (
    select i.id as item_id, greatest(extensions.similarity(i.name_normalized, me.name_normalized),
                                     case when i.topic_id = me.topic_id then 0.5 else 0 end)::double precision as sim
    from public.items i, me
    where me.embedding is null and i.id <> me.id
      and (i.topic_id = me.topic_id or i.name_normalized operator(extensions.%) me.name_normalized)),
  cand as (
    select i.id, i.name, i.image_path, i.price_inr, i.diet, p.id as pid, p.name as pname, p.area, p.city, p.kind, p.hours,
           case when here.pt is not null and p.location is not null then st_distance(p.location, here.pt)::integer end as dist,
           s.review_count, s.avg_rating, p.currency, n.sim
    from (select * from near_meaning where sim >= 0.82 union all select * from near_name where sim >= 0.4) n
    join public.items i on i.id = n.item_id
    join public.places p on p.id = i.place_id
    join public.item_stats s on s.item_id = i.id
    cross join me cross join here
    where p.status = 'live' and not i.is_hidden and i.name_normalized <> 'overall visit' and s.review_count > 0
      and p.id <> me.place_id
      and (case when here.pt is not null
                then p.location is not null and st_dwithin(p.location, here.pt, least(greatest(coalesce(p_radius_m, 15000), 100), 200000))
                else lower(p.city) = lower(me.city) end)),
  fr as (select f.friend_id from public.friendships f where f.user_id = auth.uid())
  select c.id, c.name, c.image_path, c.price_inr, c.diet, c.pid, c.pname, c.area, c.city, c.kind, c.hours, c.dist,
         c.review_count, round(c.avg_rating, 1), lv.loved::integer, lv.friends::integer,
         round((public.wilson_lower(lv.loved::integer, c.review_count) + 0.05 * least(lv.friends, 3))::numeric, 3) as score,
         c.currency
  from cand c
  cross join lateral (
    select count(*) filter (where r.rating >= 4) as loved,
           count(*) filter (where r.rating >= 4 and r.is_public and r.user_id in (select friend_id from fr)) as friends
    from public.reviews r
    where r.item_id = c.id and r.status = 'published') lv
  order by score desc, c.sim desc, c.dist asc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 30);
$$;
grant execute on function public.similar_items(uuid, double precision, double precision, integer, integer) to anon, authenticated;

-- ===== 20261022000045_shop_visitors.sql =====
-- Trusted Picks: shops can see who scanned their QR codes and send them an offer.
-- Decided by Akanksha on 2026-10-22: owners see visitors by name so they can reach them.
-- What stays private:
--   * Reviews are never linked to a visitor here, so an anonymous review stays anonymous.
--   * No email, phone or location is shared, only the profile name and photo (or "Guest").
--   * The diner is told on the scan page and can hide from that shop with one tap; hiding also
--     stops its offers. They can stop offers alone from any offer card.
-- Offers can't be tied to reviewing (Google's rules), and each person gets at most one offer per
-- shop per day.

-- One row per diner and shop, only once they change something. No row = shown, offers on.
create table if not exists public.shop_privacy (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  place_id   uuid not null references public.places (id) on delete cascade,
  hidden     boolean not null default false,   -- the shop doesn't see me in its visitors
  no_offers  boolean not null default false,   -- the shop can't send me offers
  updated_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.shop_privacy enable row level security;
revoke all on public.shop_privacy from anon, authenticated;

create table if not exists public.visitor_offers (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 280),
  link_url   text check (link_url is null or (link_url ~* '^https?://' and length(link_url) <= 500)),
  sent_by    uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists visitor_offers_user_idx on public.visitor_offers (user_id, created_at desc);
create index if not exists visitor_offers_place_idx on public.visitor_offers (place_id, created_at desc);
alter table public.visitor_offers enable row level security;
revoke all on public.visitor_offers from anon, authenticated;

-- The diner's own settings for one shop.
create or replace function public.my_shop_privacy(p_place uuid)
returns table (hidden boolean, no_offers boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(sp.hidden, false), coalesce(sp.no_offers, false)
  from (select 1) one
  left join public.shop_privacy sp on sp.user_id = auth.uid() and sp.place_id = p_place
  where auth.uid() is not null;
$$;
revoke execute on function public.my_shop_privacy(uuid) from public, anon;
grant execute on function public.my_shop_privacy(uuid) to authenticated;

-- Change either setting; null leaves it as it is. Hiding also stops offers.
create or replace function public.set_shop_privacy(p_place uuid, p_hidden boolean default null, p_no_offers boolean default null)
returns table (hidden boolean, no_offers boolean)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into public.shop_privacy as sp (user_id, place_id, hidden, no_offers)
  values (auth.uid(), p_place, coalesce(p_hidden, false), coalesce(p_no_offers, false) or coalesce(p_hidden, false))
  on conflict (user_id, place_id) do update
    set hidden = coalesce(p_hidden, sp.hidden),
        no_offers = coalesce(p_no_offers, sp.no_offers) or coalesce(p_hidden, sp.hidden),
        updated_at = now();
  return query select * from public.my_shop_privacy(p_place);
end $$;
revoke execute on function public.set_shop_privacy(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_shop_privacy(uuid, boolean, boolean) to authenticated;

-- For the owner (or an admin): people who scanned in the last p_days, newest first.
create or replace function public.shop_visitors(p_place uuid, p_days integer default 30)
returns table (user_id uuid, display_name text, avatar_path text, is_guest boolean, visits integer,
               last_visit timestamptz, last_table text, at_shop boolean, can_offer boolean, last_offer_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  with v as (
    select vi.user_id, count(*)::integer as n, max(vi.scanned_at) as last_at,
           bool_or(coalesce(vi.near, false)) as near
    from public.visits vi
    where vi.place_id = p_place
      and vi.scanned_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
    group by vi.user_id)
  select v.user_id,
         nullif(btrim(pr.display_name), ''),
         pr.avatar_path,
         coalesce(au.is_anonymous, false),
         v.n, v.last_at,
         (select qc.table_label from public.visits l left join public.qr_codes qc on qc.id = l.qr_code_id
           where l.user_id = v.user_id and l.place_id = p_place order by l.scanned_at desc limit 1),
         v.near,
         not coalesce(sp.no_offers, false) and not exists (
           select 1 from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id and o.created_at > now() - interval '1 day'),
         (select max(o.created_at) from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id)
  from v
  join public.profiles pr on pr.id = v.user_id
  left join auth.users au on au.id = v.user_id
  left join public.shop_privacy sp on sp.user_id = v.user_id and sp.place_id = p_place
  where not coalesce(sp.hidden, false)
  order by v.last_at desc
  limit 500;
end $$;
revoke execute on function public.shop_visitors(uuid, integer) from public, anon;
grant execute on function public.shop_visitors(uuid, integer) to authenticated;

-- Send one offer to some visitors. Skips anyone who hid, turned offers off, didn't visit in
-- the last 90 days, or already got an offer from this shop today. Returns how many got it.
create or replace function public.send_visitor_offer(p_place uuid, p_users uuid[], p_body text, p_link text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can send offers'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 280 then raise exception 'write an offer of up to 280 characters'; end if;
  if p_body ~* '\m(reviews?|ratings?|rate us)\M' then
    raise exception 'offers can''t mention reviews or ratings. Google bans rewards for reviews';
  end if;
  if coalesce(array_length(p_users, 1), 0) = 0 then raise exception 'pick at least one visitor'; end if;
  insert into public.visitor_offers (place_id, user_id, body, link_url, sent_by)
  select p_place, u, btrim(p_body), nullif(btrim(coalesce(p_link, '')), ''), auth.uid()
  from (select distinct unnest(p_users[1:500]) as u) x
  where exists (select 1 from public.visits vi where vi.place_id = p_place and vi.user_id = x.u and vi.scanned_at > now() - interval '90 days')
    and not exists (select 1 from public.shop_privacy sp where sp.place_id = p_place and sp.user_id = x.u and (sp.hidden or sp.no_offers))
    and not exists (select 1 from public.visitor_offers o where o.place_id = p_place and o.user_id = x.u and o.created_at > now() - interval '1 day');
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.send_visitor_offer(uuid, uuid[], text, text) from public, anon;
grant execute on function public.send_visitor_offer(uuid, uuid[], text, text) to authenticated;

-- The diner's offers from the last 30 days (not from shops they've since turned off).
create or replace function public.my_offers(p_limit integer default 10)
returns table (id uuid, place_id uuid, place_name text, logo_path text, body text, link_url text, created_at timestamptz, seen boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.place_id, p.name, p.logo_path, o.body, o.link_url, o.created_at, o.seen_at is not null
  from public.visitor_offers o
  join public.places p on p.id = o.place_id and p.status = 'live'
  where o.user_id = auth.uid() and auth.uid() is not null
    and o.created_at > now() - interval '30 days'
    and not exists (select 1 from public.shop_privacy sp where sp.user_id = o.user_id and sp.place_id = o.place_id and (sp.hidden or sp.no_offers))
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
revoke execute on function public.my_offers(integer) from public, anon;
grant execute on function public.my_offers(integer) to authenticated;

create or replace function public.mark_offers_seen(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.visitor_offers set seen_at = now()
  where user_id = auth.uid() and id = any(p_ids) and seen_at is null;
$$;
revoke execute on function public.mark_offers_seen(uuid[]) from public, anon;
grant execute on function public.mark_offers_seen(uuid[]) to authenticated;

-- ===== 20261022000046_privacy_list_offers_qr.sql =====
-- Trusted Picks: fixes from the UX review (2026-10-22).
--   * Diners get one list of the shops that can see them, with Hide and Offers switches.
--   * Owners see the offers they sent and how many people saw each one.
--   * Owners can rename a table QR or turn off a lost one (before, only admins could).

-- Every shop the diner scanned at in the last year, with their privacy settings for it.
create or replace function public.my_shop_privacy_list()
returns table (place_id uuid, place_name text, area text, logo_path text, last_visit timestamptz, hidden boolean, no_offers boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, p.logo_path, v.last_at,
         coalesce(sp.hidden, false), coalesce(sp.no_offers, false)
  from (select vi.place_id, max(vi.scanned_at) as last_at
        from public.visits vi
        where vi.user_id = auth.uid() and vi.scanned_at > now() - interval '365 days'
        group by vi.place_id) v
  join public.places p on p.id = v.place_id
  left join public.shop_privacy sp on sp.user_id = auth.uid() and sp.place_id = v.place_id
  where auth.uid() is not null
  order by v.last_at desc
  limit 200;
$$;
revoke execute on function public.my_shop_privacy_list() from public, anon;
grant execute on function public.my_shop_privacy_list() to authenticated;

-- Offers this shop sent, one row per send (same text within the same minute), newest first.
create or replace function public.shop_offers_sent(p_place uuid, p_limit integer default 20)
returns table (body text, link_url text, sent_at timestamptz, recipients integer, seen integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  select o.body, o.link_url, min(o.created_at), count(*)::integer, count(o.seen_at)::integer
  from public.visitor_offers o
  where o.place_id = p_place
  group by o.body, o.link_url, date_trunc('minute', o.created_at)
  order by min(o.created_at) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke execute on function public.shop_offers_sent(uuid, integer) from public, anon;
grant execute on function public.shop_offers_sent(uuid, integer) to authenticated;

-- Rename a table code, or turn it off (a lost or damaged card) and back on. Turning on again
-- counts against the plan's QR limit like any other active code.
create or replace function public.owner_update_qr(p_qr uuid, p_label text default null, p_active boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
declare q public.qr_codes; used integer;
begin
  select * into q from public.qr_codes where id = p_qr;
  if q.id is null then raise exception 'code not found'; end if;
  if not (public.is_admin() or public.is_place_owner(q.place_id)) then raise exception 'not your shop'; end if;
  if p_active is true and not q.active then
    select count(*) into used from public.qr_codes where place_id = q.place_id and active;
    if used >= public.place_qr_limit(q.place_id) then raise exception 'your plan has no free QR codes. Turn another one off first, or get a bigger plan'; end if;
  end if;
  update public.qr_codes
     set table_label = case when p_label is null then table_label else nullif(left(btrim(p_label), 40), '') end,
         active = coalesce(p_active, active)
   where id = p_qr;
end $$;
revoke execute on function public.owner_update_qr(uuid, text, boolean) from public, anon;
grant execute on function public.owner_update_qr(uuid, text, boolean) to authenticated;

-- ===== 20261023000047_offers_wallet_reminders.sql =====
-- Trusted Picks: offers you can show at the counter, and reminders to review a visit (2026-10-23).
--   * A diner sees this shop's offers for them on the scan page and can mark one as used at the counter.
--     Owners see how many were used.
--   * Review reminders: a diner who allowed notifications gets a reminder about an hour and a half after
--     scanning, and one last one before the review window closes, unless they already reviewed.
--     Nothing is sent to anyone who didn't switch reminders on.

-- ---------- Offers as coupons ----------
alter table public.visitor_offers add column if not exists used_at timestamptz;

-- This shop's offers for me, for the scan page. Unused first.
create or replace function public.my_offers_here(p_place uuid)
returns table (id uuid, body text, link_url text, created_at timestamptz, seen boolean, used_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.body, o.link_url, o.created_at, o.seen_at is not null, o.used_at
  from public.visitor_offers o
  where o.user_id = auth.uid() and auth.uid() is not null and o.place_id = p_place
    and o.created_at > now() - interval '30 days'
    and not exists (select 1 from public.shop_privacy sp where sp.user_id = o.user_id and sp.place_id = o.place_id and (sp.hidden or sp.no_offers))
  order by o.used_at is not null, o.created_at desc
  limit 10;
$$;
revoke execute on function public.my_offers_here(uuid) from public, anon;
grant execute on function public.my_offers_here(uuid) to authenticated;

-- The diner marks an offer as used, at the counter. It can't be undone.
create or replace function public.use_offer(p_id uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  update public.visitor_offers set used_at = now(), seen_at = coalesce(seen_at, now())
   where id = p_id and user_id = auth.uid() and used_at is null
  returning used_at into t;
  if t is null then
    select used_at into t from public.visitor_offers where id = p_id and user_id = auth.uid();
    if t is null then raise exception 'offer not found'; end if;
  end if;
  return t;
end $$;
revoke execute on function public.use_offer(uuid) from public, anon;
grant execute on function public.use_offer(uuid) to authenticated;

-- Home's news strip leaves out offers already used.
create or replace function public.my_offers(p_limit integer default 10)
returns table (id uuid, place_id uuid, place_name text, logo_path text, body text, link_url text, created_at timestamptz, seen boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.place_id, p.name, p.logo_path, o.body, o.link_url, o.created_at, o.seen_at is not null
  from public.visitor_offers o
  join public.places p on p.id = o.place_id and p.status = 'live'
  where o.user_id = auth.uid() and auth.uid() is not null
    and o.created_at > now() - interval '30 days'
    and o.used_at is null
    and not exists (select 1 from public.shop_privacy sp where sp.user_id = o.user_id and sp.place_id = o.place_id and (sp.hidden or sp.no_offers))
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
revoke execute on function public.my_offers(integer) from public, anon;
grant execute on function public.my_offers(integer) to authenticated;

-- Offers sent, now with how many were used.
drop function if exists public.shop_offers_sent(uuid, integer);
create or replace function public.shop_offers_sent(p_place uuid, p_limit integer default 20)
returns table (body text, link_url text, sent_at timestamptz, recipients integer, seen integer, used integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  select o.body, o.link_url, min(o.created_at), count(*)::integer, count(o.seen_at)::integer, count(o.used_at)::integer
  from public.visitor_offers o
  where o.place_id = p_place
  group by o.body, o.link_url, date_trunc('minute', o.created_at)
  order by min(o.created_at) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke execute on function public.shop_offers_sent(uuid, integer) from public, anon;
grant execute on function public.shop_offers_sent(uuid, integer) to authenticated;

-- Shops I can still review (the visit is open), newest first, and whether I already reviewed since the scan.
create or replace function public.my_open_visits()
returns table (place_id uuid, place_name text, area text, category text, expires_at timestamptz, reviewed boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (v.place_id) v.place_id, p.name, p.area, p.category, v.expires_at,
         exists (select 1 from public.reviews r where r.user_id = v.user_id and r.place_id = v.place_id and r.created_at >= v.scanned_at)
  from public.visits v
  join public.places p on p.id = v.place_id
  where v.user_id = auth.uid() and auth.uid() is not null and v.expires_at > now()
  order by v.place_id, v.expires_at desc
  limit 10;
$$;
revoke execute on function public.my_open_visits() from public, anon;
grant execute on function public.my_open_visits() to authenticated;

-- ---------- Review reminders ----------
-- A phone's push address (Web Push). Only the remind function reads these.
create table if not exists public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh     text not null check (length(p256dh) <= 200),
  auth       text not null check (length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

alter table public.visits add column if not exists remind_at timestamptz;
alter table public.visits add column if not exists reminders_sent smallint not null default 0;
create index if not exists visits_remind_idx on public.visits (remind_at) where remind_at is not null;

-- When the first reminder for a visit goes out: 90 minutes after the scan, but never later than
-- 45 minutes before the window closes, and never sooner than 10 minutes from now.
create or replace function public.first_reminder_at(p_expires timestamptz)
returns timestamptz language sql stable as $$
  select greatest(least(now() + interval '90 minutes', p_expires - interval '45 minutes'), now() + interval '10 minutes');
$$;

-- Switch reminders on for this phone (also schedules one for any visit that's open right now).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'open the page again to turn on reminders'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  -- Ten phones per person is plenty; drop the oldest.
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from public.push_subscriptions where user_id = auth.uid() order by created_at desc offset 10);
  update public.visits set remind_at = public.first_reminder_at(expires_at)
   where user_id = auth.uid() and expires_at > now() + interval '20 minutes' and reminders_sent = 0 and remind_at is null;
end $$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- Switch reminders off for this phone, or for every phone (p_endpoint null).
create or replace function public.delete_push_subscription(p_endpoint text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where user_id = auth.uid() and (p_endpoint is null or endpoint = p_endpoint);
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid()) then
    update public.visits set remind_at = null where user_id = auth.uid() and remind_at is not null;
  end if;
end $$;
revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Every new visit by someone with reminders on gets one scheduled.
create or replace function public.schedule_review_reminder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    new.remind_at := public.first_reminder_at(new.expires_at);
  end if;
  return new;
end $$;
drop trigger if exists visits_schedule_reminder on public.visits;
create trigger visits_schedule_reminder before insert on public.visits
  for each row execute function public.schedule_review_reminder();

-- For the remind function only: reminders due now, each marked as sent. A visit already reviewed
-- (any review by that person at that shop since the scan) is skipped and cleared. The second and
-- last reminder is set 45 minutes before the window closes, if there's time for one.
create or replace function public.take_due_review_reminders(p_limit integer default 200)
returns table (visit_id uuid, place_id uuid, place_name text, expires_at timestamptz, last_one boolean, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
begin
  update public.visits v set remind_at = null
   where v.remind_at <= now()
     and (v.expires_at <= now() + interval '10 minutes'
          or exists (select 1 from public.reviews r where r.user_id = v.user_id and r.place_id = v.place_id and r.created_at >= v.scanned_at));
  return query
  with due as (
    update public.visits v
       set reminders_sent = v.reminders_sent + 1,
           remind_at = case when v.reminders_sent = 0 and v.expires_at - now() > interval '2 hours'
                            then v.expires_at - interval '45 minutes' end
     where v.id in (select v2.id from public.visits v2 where v2.remind_at <= now() order by v2.remind_at
                    limit least(greatest(coalesce(p_limit, 200), 1), 1000) for update skip locked)
    returning v.id, v.user_id, v.place_id, v.expires_at, v.remind_at is null as last_one
  )
  select d.id, d.place_id, p.name, d.expires_at, d.last_one, s.endpoint, s.p256dh, s.auth
  from due d
  join public.places p on p.id = d.place_id
  join public.push_subscriptions s on s.user_id = d.user_id;
end $$;
revoke execute on function public.take_due_review_reminders(integer) from public, anon, authenticated;
grant execute on function public.take_due_review_reminders(integer) to service_role;

-- Every 10 minutes, ask the `remind` Edge Function to send what's due. It reads the project address and
-- the function's secret from Supabase Vault (set once, see supabase/README.md), and does nothing until
-- they're there or when nothing is due.
create extension if not exists pg_net;
select cron.schedule('trusted-picks-review-reminders', '*/10 * * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/remind',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'remind_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from vault.decrypted_secrets where name = 'remind_cron_secret')
    and exists (select 1 from vault.decrypted_secrets where name = 'project_url')
    and exists (select 1 from public.visits where remind_at <= now());
$cron$);

-- ===== 20261023000048_customer_groups.sql =====
-- Trusted Picks: customer groups and tags for shops (2026-10-23).
--   * shop_visitors also returns what the automatic groups need (first visit, visits in 60 days,
--     offers used) and the shop's own tags on each person.
--   * Owners make a few tags (VIP, Family, Office lunch...) and put them on visitors.
--   * Tags are private to the shop, hold no free text about a person, never touch reviews, and are
--     removed when the person hides from the shop.

create table if not exists public.customer_tags (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  label      text not null check (length(btrim(label)) between 1 and 24),
  color      text not null default 'sky' check (color in ('sky', 'green', 'amber', 'coral', 'violet', 'gray')),
  created_at timestamptz not null default now()
);
create unique index if not exists customer_tags_label_idx on public.customer_tags (place_id, lower(btrim(label)));
alter table public.customer_tags enable row level security;
revoke all on public.customer_tags from anon, authenticated;

create table if not exists public.customer_tag_links (
  tag_id     uuid not null references public.customer_tags (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  place_id   uuid not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tag_id, user_id)
);
create index if not exists customer_tag_links_place_idx on public.customer_tag_links (place_id, user_id);
alter table public.customer_tag_links enable row level security;
revoke all on public.customer_tag_links from anon, authenticated;

-- The shop's tags, with how many people carry each.
create or replace function public.shop_customer_tags(p_place uuid)
returns table (id uuid, label text, color text, people integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  select t.id, t.label, t.color, (select count(*)::integer from public.customer_tag_links l where l.tag_id = t.id)
  from public.customer_tags t where t.place_id = p_place
  order by t.created_at;
end $$;
revoke execute on function public.shop_customer_tags(uuid) from public, anon;
grant execute on function public.shop_customer_tags(uuid) to authenticated;

-- Make a tag (p_id null) or rename / recolour one. Up to 12 per shop.
create or replace function public.save_customer_tag(p_place uuid, p_label text, p_color text default 'sky', p_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can do this'; end if;
  if length(btrim(coalesce(p_label, ''))) not between 1 and 24 then raise exception 'give the tag a short name, up to 24 letters'; end if;
  if exists (select 1 from public.customer_tags where place_id = p_place and lower(btrim(label)) = lower(btrim(p_label)) and id is distinct from p_id) then
    raise exception 'you already have a tag called %', btrim(p_label);
  end if;
  if p_id is null then
    if (select count(*) from public.customer_tags where place_id = p_place) >= 12 then raise exception 'you can have up to 12 tags. Delete one first'; end if;
    insert into public.customer_tags (place_id, label, color) values (p_place, btrim(p_label), coalesce(p_color, 'sky')) returning id into t;
  else
    update public.customer_tags set label = btrim(p_label), color = coalesce(p_color, color)
     where id = p_id and place_id = p_place returning id into t;
    if t is null then raise exception 'tag not found'; end if;
  end if;
  return t;
end $$;
revoke execute on function public.save_customer_tag(uuid, text, text, uuid) from public, anon;
grant execute on function public.save_customer_tag(uuid, text, text, uuid) to authenticated;

create or replace function public.delete_customer_tag(p_place uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can do this'; end if;
  delete from public.customer_tags where id = p_id and place_id = p_place;
end $$;
revoke execute on function public.delete_customer_tag(uuid, uuid) from public, anon;
grant execute on function public.delete_customer_tag(uuid, uuid) to authenticated;

-- Put a tag on a visitor or take it off. Only people who scanned here in the last year and haven't hidden.
create or replace function public.set_customer_tag(p_place uuid, p_user uuid, p_tag uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can do this'; end if;
  if not exists (select 1 from public.customer_tags where id = p_tag and place_id = p_place) then raise exception 'tag not found'; end if;
  if not p_on then
    delete from public.customer_tag_links where tag_id = p_tag and user_id = p_user;
    return;
  end if;
  if not exists (select 1 from public.visits v where v.place_id = p_place and v.user_id = p_user and v.scanned_at > now() - interval '365 days')
     or exists (select 1 from public.shop_privacy sp where sp.place_id = p_place and sp.user_id = p_user and sp.hidden) then
    raise exception 'you can only tag people who visited and haven''t hidden';
  end if;
  insert into public.customer_tag_links (tag_id, user_id, place_id) values (p_tag, p_user, p_place) on conflict do nothing;
end $$;
revoke execute on function public.set_customer_tag(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.set_customer_tag(uuid, uuid, uuid, boolean) to authenticated;

-- Hiding from a shop takes the person out of every one of its tags.
create or replace function public.clear_tags_on_hide()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.hidden then delete from public.customer_tag_links where place_id = new.place_id and user_id = new.user_id; end if;
  return new;
end $$;
drop trigger if exists shop_privacy_clear_tags on public.shop_privacy;
create trigger shop_privacy_clear_tags after insert or update of hidden on public.shop_privacy
  for each row execute function public.clear_tags_on_hide();

-- Visitors, now with what the groups need and the shop's tags on each person.
drop function if exists public.shop_visitors(uuid, integer);
create or replace function public.shop_visitors(p_place uuid, p_days integer default 30)
returns table (user_id uuid, display_name text, avatar_path text, is_guest boolean, visits integer,
               last_visit timestamptz, last_table text, at_shop boolean, can_offer boolean, last_offer_at timestamptz,
               first_visit timestamptz, visits_60 integer, offers_used integer, tag_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  with v as (
    select vi.user_id, count(*)::integer as n, max(vi.scanned_at) as last_at,
           bool_or(coalesce(vi.near, false)) as near
    from public.visits vi
    where vi.place_id = p_place
      and vi.scanned_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
    group by vi.user_id)
  select v.user_id,
         nullif(btrim(pr.display_name), ''),
         pr.avatar_path,
         coalesce(au.is_anonymous, false),
         v.n, v.last_at,
         (select qc.table_label from public.visits l left join public.qr_codes qc on qc.id = l.qr_code_id
           where l.user_id = v.user_id and l.place_id = p_place order by l.scanned_at desc limit 1),
         v.near,
         not coalesce(sp.no_offers, false) and not exists (
           select 1 from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id and o.created_at > now() - interval '1 day'),
         (select max(o.created_at) from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id),
         (select min(a.scanned_at) from public.visits a where a.place_id = p_place and a.user_id = v.user_id),
         (select count(*)::integer from public.visits a where a.place_id = p_place and a.user_id = v.user_id and a.scanned_at > now() - interval '60 days'),
         (select count(*)::integer from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id and o.used_at is not null),
         coalesce((select array_agg(l.tag_id) from public.customer_tag_links l where l.place_id = p_place and l.user_id = v.user_id), '{}')
  from v
  join public.profiles pr on pr.id = v.user_id
  left join auth.users au on au.id = v.user_id
  left join public.shop_privacy sp on sp.user_id = v.user_id and sp.place_id = p_place
  where not coalesce(sp.hidden, false)
  order by v.last_at desc
  limit 500;
end $$;
revoke execute on function public.shop_visitors(uuid, integer) from public, anon;
grant execute on function public.shop_visitors(uuid, integer) to authenticated;

-- ===== 20261023000049_e2e_fixes.sql =====
-- Trusted Picks: fixes from the end-to-end test run (2026-10-23).
--   * Admin-only functions can no longer be called without signing in (they already refused inside).
--   * Billing > Payments also lists payments the team entered by hand, so it adds up to "collected".
--   * Asking for a recheck keeps the team's note; Verify shows the owner's reply and marks it as a recheck.

-- ---------- Admin functions: signed-in only ----------
revoke execute on function public.admin_alerts() from public, anon;
revoke execute on function public.admin_billing(integer) from public, anon;
revoke execute on function public.admin_claims() from public, anon;
revoke execute on function public.decide_claim(uuid, boolean) from public, anon;
revoke execute on function public.admin_shop_plans() from public, anon;
revoke execute on function public.admin_update_plan(text, text, integer, integer, integer, integer, integer) from public, anon;
revoke execute on function public.admin_daily_stats(integer) from public, anon;
revoke execute on function public.places_without_pin() from public, anon;

-- ---------- Payments list includes the team's own entries ----------
create or replace function public.admin_billing(p_limit integer default 100)
returns table (id uuid, place_id uuid, place_name text, plan text, billing_interval text, currency text,
               amount_minor integer, status text, provider_payment_id text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select o.id, o.place_id, coalesce(p.name, lr.business_name), o.plan, o.billing_interval, o.currency, o.amount_minor, o.status,
           o.provider_payment_id, o.created_at, o.paid_at
    from public.billing_orders o
    left join public.places p on p.id = o.place_id
    left join public.listing_requests lr on lr.id = o.request_id
    where public.is_admin()
    union all
    select m.id, m.place_id, p.name, coalesce(nullif(m.provider_ref, ''), m.kind::text), null, 'INR', m.amount_inr * 100, m.status::text,
           'Entered by the team', m.created_at, m.paid_at
    from public.payments m
    left join public.places p on p.id = m.place_id
    where public.is_admin() and m.provider = 'admin'
  ) x
  order by x.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
revoke execute on function public.admin_billing(integer) from public, anon;
grant execute on function public.admin_billing(integer) to authenticated;

-- ---------- Rechecks keep the team's note ----------
create or replace function public.request_recheck(p_place uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare pl public.places; last_at timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into pl from public.places where id = p_place for update;
  if pl.id is null or pl.owner_id is distinct from auth.uid() then raise exception 'only the shop owner can ask for this'; end if;
  if pl.verification = 'pending' then raise exception 'your shop is already waiting for the team''s check'; end if;
  if not (pl.status = 'removed' or pl.verification = 'rejected') then raise exception 'your shop is already listed'; end if;
  select max(created_at) into last_at from public.place_rechecks where place_id = p_place;
  if last_at is not null and last_at > now() - interval '1 day' then
    raise exception 'you can ask once a day. Try again after %',
      to_char((last_at + interval '1 day') at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM');
  end if;
  insert into public.place_rechecks (place_id, requested_by, note)
  values (p_place, auth.uid(), nullif(left(btrim(coalesce(p_note, '')), 1000), ''));
  perform set_config('app.verification_write', '1', true);
  update public.places set verification = 'pending' where id = p_place;
  perform set_config('app.verification_write', '', true);
  return 'pending';
end $$;
revoke execute on function public.request_recheck(uuid, text) from public, anon;
grant execute on function public.request_recheck(uuid, text) to authenticated;

drop function if exists public.admin_places_to_verify();
create or replace function public.admin_places_to_verify()
returns table (id uuid, name text, category text, area text, city text, google_place_id text, links jsonb,
               contact_phone text, verification_note text, owner_name text, created_at timestamptz, has_location boolean,
               recheck_at timestamptz, recheck_note text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.area, p.city, p.google_place_id, p.links, p.contact_phone, p.verification_note,
         pr.display_name, p.created_at, p.location is not null, rc.created_at, rc.note
  from public.places p
  left join public.profiles pr on pr.id = p.owner_id
  left join lateral (select r.created_at, r.note from public.place_rechecks r where r.place_id = p.id order by r.created_at desc limit 1) rc on true
  where public.is_admin() and p.verification = 'pending'
  order by p.created_at;
$$;
revoke execute on function public.admin_places_to_verify() from public, anon;
grant execute on function public.admin_places_to_verify() to authenticated;

-- ---------- Visitor names never come from an email address ----------
-- A person who signed in by email and never gave a name used to get the part before the @ as their
-- name, which shops then saw. Now they have no name (shown as "Customer") until they add one.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.profiles (id, display_name)
    values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), ''))
    on conflict (id) do nothing;
  exception when others then
    raise warning 'trusted picks: profile for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $$;
-- Clear names that are just the start of the person's email and that they never chose.
update public.profiles p set display_name = ''
from auth.users u
where u.id = p.id and u.email is not null and p.display_name <> ''
  and lower(p.display_name) = lower(split_part(u.email, '@', 1))
  and coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'name'), '')) is null;

-- ---------- Offers and shop news never ask for reviews ----------
-- Google bans rewards for reviews, so neither may mention reviews, ratings, stars or feedback.
create or replace function public.mentions_reviews(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* '\m(reviews?|reviewing|reviewed|ratings?|rated|rate (us|our|your|the)|feedback|testimonials?)\M'
      or coalesce(p_text, '') ~* '(\d\s*-?\s*stars?\M|★|⭐)';
$$;

create or replace function public.send_visitor_offer(p_place uuid, p_users uuid[], p_body text, p_link text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can send offers'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 280 then raise exception 'write an offer of up to 280 characters'; end if;
  if public.mentions_reviews(p_body) then
    raise exception 'offers can''t mention reviews, ratings, stars or feedback. Google bans rewards for reviews';
  end if;
  if coalesce(array_length(p_users, 1), 0) = 0 then raise exception 'pick at least one visitor'; end if;
  insert into public.visitor_offers (place_id, user_id, body, link_url, sent_by)
  select p_place, u, btrim(p_body), nullif(btrim(coalesce(p_link, '')), ''), auth.uid()
  from (select distinct unnest(p_users[1:500]) as u) x
  where exists (select 1 from public.visits vi where vi.place_id = p_place and vi.user_id = x.u and vi.scanned_at > now() - interval '90 days')
    and not exists (select 1 from public.shop_privacy sp where sp.place_id = p_place and sp.user_id = x.u and (sp.hidden or sp.no_offers))
    and not exists (select 1 from public.visitor_offers o where o.place_id = p_place and o.user_id = x.u and o.created_at > now() - interval '1 day');
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.send_visitor_offer(uuid, uuid[], text, text) from public, anon;
grant execute on function public.send_visitor_offer(uuid, uuid[], text, text) to authenticated;

-- Shop news: same rule, and 3 posts a day counts posts made, so deleting one doesn't free a slot.
create table if not exists public.place_update_posts (
  place_id   uuid not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists place_update_posts_idx on public.place_update_posts (place_id, created_at desc);
alter table public.place_update_posts enable row level security;
revoke all on public.place_update_posts from anon, authenticated;
insert into public.place_update_posts (place_id, created_at)
select u.place_id, u.created_at from public.place_updates u
where u.created_at > now() - interval '1 day'
  and not exists (select 1 from public.place_update_posts x where x.place_id = u.place_id and x.created_at = u.created_at);

create or replace function public.limit_place_updates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.mentions_reviews(new.body) then
    raise exception 'news can''t mention reviews, ratings, stars or feedback. Google bans asking for reviews with rewards';
  end if;
  if (select count(*) from public.place_update_posts where place_id = new.place_id and created_at > now() - interval '1 day') >= 3 then
    raise exception 'you can post 3 updates a day';
  end if;
  insert into public.place_update_posts (place_id) values (new.place_id);
  return new;
end $$;
drop trigger if exists place_updates_limit on public.place_updates;
create trigger place_updates_limit before insert on public.place_updates
  for each row execute function public.limit_place_updates();

-- How many news posts the shop has left today (deleted ones count).
create or replace function public.shop_updates_left(p_place uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return greatest(0, 3 - (select count(*) from public.place_update_posts where place_id = p_place and created_at > now() - interval '1 day'))::integer;
end $$;
revoke execute on function public.shop_updates_left(uuid) from public, anon;
grant execute on function public.shop_updates_left(uuid) to authenticated;

-- ---------- Invite codes: the first one made is the one kept ----------
-- Several first calls at once used to each write a new code, so the link shown could already be dead.
create or replace function public.my_invite_code()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'open your profile once, then try again'; end if;
  select invite_code into c from public.profiles where id = auth.uid();
  while c is null loop
    begin
      update public.profiles set invite_code = encode(gen_random_bytes(5), 'hex') where id = auth.uid() and invite_code is null;
    exception when unique_violation then null;
    end;
    select invite_code into c from public.profiles where id = auth.uid();
  end loop;
  return c;
end $$;
revoke execute on function public.my_invite_code() from public, anon;
grant execute on function public.my_invite_code() to authenticated;
-- ===== 20261023000050_deals_stamps_pocket.sql =====
-- Trusted Picks: offers that feel like treats (2026-10-23).
--   * Shop deals: offers for everyone, shown as tickets on the shop page (% off, flat off, free item,
--     2 for 1, happy hour) on the days, hours and dates the owner picks. A diner shows one at the
--     counter and the staff press and hold to use it.
--   * Stamp cards: "N visits, then <reward>". Each day a diner scans a table code at the shop adds a
--     stamp by itself. Stamps count visits only, never reviews.
--   * Personal offers open gift-wrapped until the diner unwraps them (seen_at), and last 30 days.
--   * Your pocket: every offer, deal and stamp card a diner has, in one place.
-- Nothing here mentions reviews: deals and rewards can't use review wording, as with offers.

-- ---------- The shop's own clock ----------
-- Deals run on the shop's local days and hours. India until owners can pick another time zone.
alter table public.places add column if not exists time_zone text not null default 'Asia/Kolkata';

create or replace function public.check_place_time_zone()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.time_zone) then
    raise exception 'unknown time zone %', new.time_zone;
  end if;
  return new;
end $$;
drop trigger if exists places_time_zone_check on public.places;
create trigger places_time_zone_check before insert or update of time_zone on public.places
  for each row execute function public.check_place_time_zone();

create or replace function public.place_local_now(p_place uuid)
returns timestamp language sql stable security definer set search_path = public as $$
  select now() at time zone coalesce((select p.time_zone from public.places p where p.id = p_place), 'Asia/Kolkata');
$$;

-- ---------- Shop deals ----------
create table if not exists public.shop_deals (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  kind        text not null check (kind in ('percent', 'flat', 'free', 'bogo', 'happy_hour', 'other')),
  amount      numeric(10, 2) check (amount is null or amount > 0),
  title       text not null check (length(btrim(title)) between 1 and 60),
  terms       text check (terms is null or length(terms) <= 200),
  days        smallint[] check (days is null or (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(days) between 1 and 7)),
  starts_at   time,
  ends_at     time,
  valid_from  date not null default current_date,
  valid_until date,
  per_person  text not null default 'daily' check (per_person in ('daily', 'once')),
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind <> 'percent' or amount between 1 and 90),
  check (kind <> 'flat' or amount is not null),
  check ((starts_at is null) = (ends_at is null) and (starts_at is null or starts_at <> ends_at)),
  check (valid_until is null or valid_until >= valid_from)
);
create index if not exists shop_deals_place_idx on public.shop_deals (place_id) where active;
alter table public.shop_deals enable row level security;
revoke all on public.shop_deals from anon, authenticated;

create table if not exists public.deal_uses (
  id        uuid primary key default gen_random_uuid(),
  deal_id   uuid not null references public.shop_deals (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  local_day date not null,
  used_at   timestamptz not null default now(),
  unique (deal_id, user_id, local_day)
);
create index if not exists deal_uses_user_idx on public.deal_uses (user_id, used_at desc);
alter table public.deal_uses enable row level security;
revoke all on public.deal_uses from anon, authenticated;

-- Is the deal on at this local time? Hours may run past midnight (10 pm to 2 am).
create or replace function public.deal_on_at(d public.shop_deals, t timestamp)
returns boolean language sql immutable as $$
  select d.active
     and t::date >= d.valid_from and (d.valid_until is null or t::date <= d.valid_until)
     and (d.days is null or extract(dow from t)::smallint = any(d.days))
     and (d.starts_at is null
          or (d.starts_at < d.ends_at and t::time >= d.starts_at and t::time < d.ends_at)
          or (d.starts_at > d.ends_at and (t::time >= d.starts_at or t::time < d.ends_at)));
$$;

-- One deal as the app shows it, with whether it's on now, when today's hours end, and whether I used it.
create or replace function public.deal_json(d public.shop_deals, t timestamp, tz text, p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', d.id, 'place_id', d.place_id, 'kind', d.kind, 'amount', d.amount, 'title', d.title, 'terms', d.terms,
    'days', d.days, 'starts_at', to_char(d.starts_at, 'HH24:MI'), 'ends_at', to_char(d.ends_at, 'HH24:MI'),
    'valid_until', d.valid_until, 'per_person', d.per_person,
    'on_now', public.deal_on_at(d, t),
    'ends_ts', case when d.ends_at is not null and public.deal_on_at(d, t)
                    then ((t::date + d.ends_at) + case when d.ends_at <= t::time then interval '1 day' else interval '0' end) at time zone tz end,
    'used_at', (select max(u.used_at) from public.deal_uses u where u.deal_id = d.id and u.user_id = p_user
                  and (d.per_person = 'once' or u.local_day = t::date)));
$$;
revoke execute on function public.deal_json(public.shop_deals, timestamp, text, uuid) from public, anon, authenticated;

-- ---------- Stamp cards ----------
create table if not exists public.stamp_cards (
  place_id   uuid primary key references public.places (id) on delete cascade,
  goal       smallint not null check (goal between 3 and 12),
  reward     text not null check (length(btrim(reward)) between 1 and 60),
  active     boolean not null default true,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.stamp_cards enable row level security;
revoke all on public.stamp_cards from anon, authenticated;

create table if not exists public.stamp_rewards (
  id       uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  used_at  timestamptz not null default now()
);
create index if not exists stamp_rewards_user_idx on public.stamp_rewards (user_id, place_id, used_at desc);
alter table public.stamp_rewards enable row level security;
revoke all on public.stamp_rewards from anon, authenticated;

-- A diner's stamps at a shop: one per local day they scanned a table code there (not scans known to be
-- far from the shop, not review links), since the card started, minus the ones spent on rewards.
create or replace function public.stamp_json(p_place uuid, p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (
    select sc.*, coalesce(p.time_zone, 'Asia/Kolkata') as tz from public.stamp_cards sc join public.places p on p.id = sc.place_id
    where sc.place_id = p_place and sc.active),
  d as (
    select distinct (v.scanned_at at time zone c.tz)::date as day
    from c join public.visits v on v.place_id = c.place_id and v.user_id = p_user
    where p_user is not null and v.scanned_at >= c.started_at and v.source = 'qr' and v.near is distinct from false),
  r as (select count(*)::integer as n from c join public.stamp_rewards sr on sr.place_id = c.place_id and sr.user_id = p_user and sr.used_at >= c.started_at)
  select jsonb_build_object(
    'place_id', c.place_id, 'goal', c.goal, 'reward', c.reward,
    'stamps', greatest((select count(*) from d)::integer - c.goal * (select n from r), 0),
    'days', coalesce((select jsonb_agg(day order by day desc) from (select day from d order by day desc limit 12) x), '[]'::jsonb),
    'today', exists (select 1 from d where d.day = (now() at time zone c.tz)::date),
    'used', (select n from r))
  from c;
$$;
revoke execute on function public.stamp_json(uuid, uuid) from public, anon, authenticated;

-- ---------- What a shop page shows ----------
-- Deals for everyone; the stamp card (with my stamps); and my personal offers here (unless I turned this shop off).
create or replace function public.place_treats(p_place uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text; t timestamp; me uuid := auth.uid(); off boolean;
begin
  select coalesce(p.time_zone, 'Asia/Kolkata') into tz from public.places p where p.id = p_place and p.status = 'live';
  if tz is null then return jsonb_build_object('deals', '[]'::jsonb, 'offers', '[]'::jsonb, 'stamps', null); end if;
  t := now() at time zone tz;
  select coalesce(sp.hidden or sp.no_offers, false) into off from public.shop_privacy sp where sp.user_id = me and sp.place_id = p_place;
  return jsonb_build_object(
    'deals', coalesce((
      select jsonb_agg(public.deal_json(d, t, tz, me) order by public.deal_on_at(d, t) desc, d.created_at desc)
      from public.shop_deals d
      where d.place_id = p_place and d.active and (d.valid_until is null or d.valid_until >= t::date) and d.valid_from <= t::date + 7), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'body', o.body, 'link_url', o.link_url, 'created_at', o.created_at,
                                          'valid_till', o.created_at + interval '30 days', 'seen', o.seen_at is not null, 'used_at', o.used_at)
                       order by o.used_at is not null, o.created_at desc)
      from (select * from public.visitor_offers o2 where me is not null and not coalesce(off, false) and o2.user_id = me and o2.place_id = p_place
              and o2.created_at > now() - interval '30 days' order by o2.created_at desc limit 10) o), '[]'::jsonb),
    'stamps', public.stamp_json(p_place, me));
end $$;
revoke execute on function public.place_treats(uuid) from public;
grant execute on function public.place_treats(uuid) to anon, authenticated;

-- ---------- Using a deal or a stamp reward at the counter ----------
create or replace function public.use_deal(p_deal uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare d public.shop_deals; tz text; t timestamp; u timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into d from public.shop_deals where id = p_deal;
  if not found then raise exception 'deal not found'; end if;
  select coalesce(time_zone, 'Asia/Kolkata') into tz from public.places where id = d.place_id;
  t := now() at time zone tz;
  select used_at into u from public.deal_uses
   where deal_id = d.id and user_id = auth.uid() and (d.per_person = 'once' or local_day = t::date) limit 1;
  if u is not null then return u; end if;
  if not public.deal_on_at(d, t) then raise exception 'this deal isn''t on right now'; end if;
  insert into public.deal_uses (deal_id, user_id, local_day) values (d.id, auth.uid(), t::date)
  on conflict (deal_id, user_id, local_day) do nothing
  returning used_at into u;
  return coalesce(u, now());
end $$;
revoke execute on function public.use_deal(uuid) from public, anon;
grant execute on function public.use_deal(uuid) to authenticated;

create or replace function public.use_stamp_reward(p_place uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare s jsonb; u timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || p_place::text));
  s := public.stamp_json(p_place, auth.uid());
  if s is null then raise exception 'this shop has no stamp card'; end if;
  if (s->>'stamps')::integer < (s->>'goal')::integer then raise exception 'not enough stamps yet'; end if;
  insert into public.stamp_rewards (place_id, user_id) values (p_place, auth.uid()) returning used_at into u;
  return u;
end $$;
revoke execute on function public.use_stamp_reward(uuid) from public, anon;
grant execute on function public.use_stamp_reward(uuid) to authenticated;

-- ---------- Your pocket ----------
-- My offers, deals from shops I visited in 90 days or saved, my stamp cards, and what I used lately.
create or replace function public.my_pocket()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  return jsonb_build_object(
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'place_id', o.place_id, 'place_name', p.name, 'logo_path', p.logo_path,
                                          'body', o.body, 'link_url', o.link_url, 'created_at', o.created_at,
                                          'valid_till', o.created_at + interval '30 days', 'seen', o.seen_at is not null, 'used_at', null)
                       order by o.created_at desc)
      from public.visitor_offers o join public.places p on p.id = o.place_id and p.status = 'live'
      where o.user_id = me and o.used_at is null and o.created_at > now() - interval '30 days'
        and not exists (select 1 from public.shop_privacy sp where sp.user_id = me and sp.place_id = o.place_id and (sp.hidden or sp.no_offers))), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(x.j || jsonb_build_object('place_name', x.name, 'logo_path', x.logo_path) order by (x.j->>'on_now')::boolean desc, x.name)
      from (
        select public.deal_json(d, now() at time zone coalesce(p.time_zone, 'Asia/Kolkata'), coalesce(p.time_zone, 'Asia/Kolkata'), me) as j, p.name, p.logo_path
        from public.shop_deals d join public.places p on p.id = d.place_id and p.status = 'live'
        where d.active and (d.valid_until is null or d.valid_until >= (now() at time zone coalesce(p.time_zone, 'Asia/Kolkata'))::date)
          and (exists (select 1 from public.visits v where v.user_id = me and v.place_id = d.place_id and v.scanned_at > now() - interval '90 days')
               or exists (select 1 from public.saved_places s where s.user_id = me and s.place_id = d.place_id))
          and not exists (select 1 from public.shop_privacy sp where sp.user_id = me and sp.place_id = d.place_id and (sp.hidden or sp.no_offers))
        limit 40) x), '[]'::jsonb),
    'stamps', coalesce((
      select jsonb_agg(s.j || jsonb_build_object('place_name', s.name, 'logo_path', s.logo_path) order by (s.j->>'stamps')::integer desc)
      from (
        select public.stamp_json(sc.place_id, me) as j, p.name, p.logo_path
        from public.stamp_cards sc join public.places p on p.id = sc.place_id and p.status = 'live'
        where sc.active and exists (select 1 from public.visits v where v.user_id = me and v.place_id = sc.place_id and v.scanned_at >= sc.started_at)
      ) s where s.j is not null), '[]'::jsonb),
    'used', coalesce((
      select jsonb_agg(z.u order by z.u->>'used_at' desc) from (select all_used.u from (
        (select jsonb_build_object('kind', 'offer', 'place_id', o.place_id, 'place_name', p.name, 'title', o.body, 'used_at', o.used_at) as u
         from public.visitor_offers o join public.places p on p.id = o.place_id
         where o.user_id = me and o.used_at is not null order by o.used_at desc limit 20)
        union all
        (select jsonb_build_object('kind', 'deal', 'place_id', d.place_id, 'place_name', p.name, 'title', d.title, 'deal_kind', d.kind,
                                   'amount', d.amount, 'used_at', du.used_at)
         from public.deal_uses du join public.shop_deals d on d.id = du.deal_id join public.places p on p.id = d.place_id
         where du.user_id = me order by du.used_at desc limit 20)
        union all
        (select jsonb_build_object('kind', 'stamps', 'place_id', sr.place_id, 'place_name', p.name, 'title', coalesce(sc.reward, 'Stamp card reward'), 'used_at', sr.used_at)
         from public.stamp_rewards sr join public.places p on p.id = sr.place_id left join public.stamp_cards sc on sc.place_id = sr.place_id
         where sr.user_id = me order by sr.used_at desc limit 20)
      ) all_used order by all_used.u->>'used_at' desc limit 30) z), '[]'::jsonb));
end $$;
revoke execute on function public.my_pocket() from public, anon;
grant execute on function public.my_pocket() to authenticated;

-- ---------- For the owner ----------
create or replace function public.shop_deals_list(p_place uuid)
returns table (id uuid, kind text, amount numeric, title text, terms text, days smallint[], starts_at text, ends_at text,
               valid_from date, valid_until date, per_person text, active boolean, created_at timestamptz,
               uses_7d integer, uses_total integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  select d.id, d.kind, d.amount, d.title, d.terms, d.days, to_char(d.starts_at, 'HH24:MI'), to_char(d.ends_at, 'HH24:MI'),
         d.valid_from, d.valid_until, d.per_person, d.active, d.created_at,
         (select count(*)::integer from public.deal_uses u where u.deal_id = d.id and u.used_at > now() - interval '7 days'),
         (select count(*)::integer from public.deal_uses u where u.deal_id = d.id)
  from public.shop_deals d where d.place_id = p_place
  order by d.active desc, d.created_at desc;
end $$;
revoke execute on function public.shop_deals_list(uuid) from public, anon;
grant execute on function public.shop_deals_list(uuid) to authenticated;

-- Add (p_id null) or change a deal. At most 6 deals on at once; no review wording.
create or replace function public.save_shop_deal(
  p_place uuid, p_kind text, p_title text, p_id uuid default null, p_amount numeric default null, p_terms text default null,
  p_days smallint[] default null, p_starts text default null, p_ends text default null,
  p_valid_until date default null, p_per_person text default 'daily', p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_from date;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change deals'; end if;
  if concat_ws(' ', p_title, p_terms) ~* '\m(reviews?|ratings?|rate us)\M' then
    raise exception 'deals can''t mention reviews or ratings. Google bans rewards for reviews';
  end if;
  if p_active and (select count(*) from public.shop_deals d where d.place_id = p_place and d.active and d.id is distinct from p_id
                     and (d.valid_until is null or d.valid_until >= current_date)) >= 6 then
    raise exception 'you can have 6 deals on at once. Turn one off first';
  end if;
  v_from := (now() at time zone coalesce((select time_zone from public.places where id = p_place), 'Asia/Kolkata'))::date;
  if p_id is null then
    insert into public.shop_deals (place_id, kind, amount, title, terms, days, starts_at, ends_at, valid_from, valid_until, per_person, active, created_by)
    values (p_place, p_kind, case when p_kind in ('percent', 'flat') then p_amount end, btrim(p_title), nullif(btrim(coalesce(p_terms, '')), ''),
            case when cardinality(p_days) between 1 and 6 then p_days end, nullif(p_starts, '')::time, nullif(p_ends, '')::time,
            v_from, p_valid_until, coalesce(p_per_person, 'daily'), coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update public.shop_deals d set kind = p_kind, amount = case when p_kind in ('percent', 'flat') then p_amount end,
           title = btrim(p_title), terms = nullif(btrim(coalesce(p_terms, '')), ''),
           days = case when cardinality(p_days) between 1 and 6 then p_days end,
           starts_at = nullif(p_starts, '')::time, ends_at = nullif(p_ends, '')::time,
           valid_until = p_valid_until, valid_from = least(d.valid_from, coalesce(p_valid_until, d.valid_from)),
           per_person = coalesce(p_per_person, 'daily'), active = coalesce(p_active, true), updated_at = now()
     where d.id = p_id and d.place_id = p_place
    returning d.id into v_id;
    if v_id is null then raise exception 'deal not found'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.save_shop_deal(uuid, text, text, uuid, numeric, text, smallint[], text, text, date, text, boolean) from public, anon;
grant execute on function public.save_shop_deal(uuid, text, text, uuid, numeric, text, smallint[], text, text, date, text, boolean) to authenticated;

create or replace function public.delete_shop_deal(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_place uuid;
begin
  select place_id into v_place from public.shop_deals where id = p_id;
  if v_place is null then return; end if;
  if not (public.is_admin() or public.is_place_owner(v_place)) then raise exception 'only the shop owner can change deals'; end if;
  delete from public.shop_deals where id = p_id;
end $$;
revoke execute on function public.delete_shop_deal(uuid) from public, anon;
grant execute on function public.delete_shop_deal(uuid) to authenticated;

-- The stamp card and how it's going: people collecting, and rewards given.
create or replace function public.shop_stamp_card(p_place uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return (select jsonb_build_object('goal', sc.goal, 'reward', sc.reward, 'active', sc.active, 'started_at', sc.started_at,
           'collectors', (select count(distinct v.user_id) from public.visits v where v.place_id = sc.place_id and v.scanned_at >= sc.started_at and v.source = 'qr'),
           'rewards_used', (select count(*) from public.stamp_rewards sr where sr.place_id = sc.place_id and sr.used_at >= sc.started_at))
          from public.stamp_cards sc where sc.place_id = p_place);
end $$;
revoke execute on function public.shop_stamp_card(uuid) from public, anon;
grant execute on function public.shop_stamp_card(uuid) to authenticated;

create or replace function public.save_stamp_card(p_place uuid, p_goal integer, p_reward text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change the stamp card'; end if;
  if p_reward ~* '\m(reviews?|ratings?|rate us)\M' then
    raise exception 'rewards can''t mention reviews or ratings. Google bans rewards for reviews';
  end if;
  insert into public.stamp_cards as sc (place_id, goal, reward, active)
  values (p_place, p_goal, btrim(p_reward), coalesce(p_active, true))
  on conflict (place_id) do update
    set goal = excluded.goal, reward = excluded.reward, active = excluded.active, updated_at = now(),
        -- Turning a card back on starts it fresh; changing it while on keeps everyone's stamps.
        started_at = case when not sc.active and excluded.active then now() else sc.started_at end;
  return public.shop_stamp_card(p_place);
end $$;
revoke execute on function public.save_stamp_card(uuid, integer, text, boolean) from public, anon;
grant execute on function public.save_stamp_card(uuid, integer, text, boolean) to authenticated;

-- ===== 20261023000051_owner_today.sql =====
-- Trusted Picks: the owner app's Today screen (2026-10-23).
-- One call gives everything the owner's home screen shows: today's visitors against yesterday, the last
-- 14 days, reviews waiting for a reply, deals and stamp cards, offers sent, QR codes and the plan.
-- Counts only: never who visited or who wrote what. Days are the shop's own local days.
-- Safe to run more than once.
set search_path = public, extensions;

create or replace function public.owner_today(p_place uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz    text;
  today date;
  card  public.stamp_cards;
  res   jsonb;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  select coalesce(p.time_zone, 'Asia/Kolkata') into tz from public.places p where p.id = p_place;
  if tz is null then return null; end if;
  today := (now() at time zone tz)::date;
  select * into card from public.stamp_cards sc where sc.place_id = p_place and sc.active;

  with v as (
    select v.user_id, v.source, v.near, (v.scanned_at at time zone tz)::date as day
    from public.visits v
    where v.place_id = p_place and v.scanned_at > now() - interval '15 days'
  ),
  r as (
    select r.rating, r.owner_reply, r.created_at, (r.created_at at time zone tz)::date as day
    from public.reviews r
    where r.place_id = p_place and r.status = 'published'
  ),
  days as (select generate_series(today - 13, today, interval '1 day')::date as day)
  select jsonb_build_object(
    'today', today,
    'visitors_today', (select count(distinct user_id) from v where day = today),
    'visitors_yesterday', (select count(distinct user_id) from v where day = today - 1),
    'scans_today', (select count(*) from v where day = today and source = 'qr'),
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
                'day', d.day,
                'visitors', (select count(distinct user_id) from v where v.day = d.day),
                'reviews', (select count(*) from r where r.day = d.day)) order by d.day), '[]'::jsonb) from days d),
    'reviews_today', (select count(*) from r where day = today),
    'reviews_7d', (select count(*) from r where day > today - 7),
    'reviews', (select count(*) from r),
    'avg_rating', (select round(avg(rating)::numeric, 1) from r),
    'need_reply', (select count(*) from r where owner_reply is null),
    'low_open', (select count(*) from r where owner_reply is null and rating <= 2 and created_at > now() - interval '30 days'),
    'notes_unread', (select count(*) from public.owner_notes n where n.place_id = p_place and n.read_at is null),
    'deals_live', (select count(*) from public.shop_deals d where d.place_id = p_place and d.active
                     and (d.valid_until is null or d.valid_until >= today)),
    'deals_on_now', (select count(*) from public.shop_deals d where d.place_id = p_place
                       and public.deal_on_at(d, (now() at time zone tz)::timestamp)),
    'deal_uses_today', (select count(*) from public.deal_uses u join public.shop_deals d on d.id = u.deal_id
                          where d.place_id = p_place and u.local_day = today),
    'stamp_goal', card.goal,
    'stamp_reward', card.reward,
    'stamps_today', case when card.place_id is null then 0 else
                      (select count(distinct user_id) from v where day = today and source = 'qr' and near is distinct from false) end,
    'rewards_today', (select count(*) from public.stamp_rewards sr where sr.place_id = p_place
                        and (sr.used_at at time zone tz)::date = today),
    'offers_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days'),
    'offers_seen_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days' and o.seen_at is not null),
    'offers_used_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days' and o.used_at is not null),
    'updates_today', (select count(*) from public.place_updates u where u.place_id = p_place and u.created_at > now() - interval '1 day'),
    'qr_active', (select count(*) from public.qr_codes q where q.place_id = p_place and q.active),
    'qr_limit', public.place_qr_limit(p_place),
    'plan', s.plan,
    'plan_name', pl.name,
    'plan_status', s.status,
    'period_end', s.period_end,
    'trial_reviews_left', s.trial_reviews_left,
    'reviews_open', public.reviews_open(p_place)
  ) into res
  from (select 1) one
  left join public.subscriptions s on s.place_id = p_place
  left join public.plans pl on pl.code = s.plan;
  return res;
end $$;
revoke execute on function public.owner_today(uuid) from public, anon;
grant execute on function public.owner_today(uuid) to authenticated;

-- ===== 20261023000053_business_types.sql =====
-- Trusted Picks: every business type gets its own words (2026-10-23).
--   * Quick review tags for a visit, per business type (salon: "Great result", clinic: "Caring doctor",
--     services: "Did it right first time"...). The app picks the set; each label must be a tag row.
--   * QR codes are named for where they go: Table for food, Chair for salons, Desk for clinics, Class for
--     coaching, Card for services (on the bill or visiting card), Counter for the rest.
-- Safe to run more than once.
set search_path = public, extensions;

-- ---------- Visit tags for every business type ----------
insert into public.tags (label, kinds) values
  ('Amazing food', '{visit}'),
  ('Ambience', '{visit}'),
  ('Caring doctor', '{visit}'),
  ('Clean', '{visit}'),
  ('Crowded', '{visit}'),
  ('Crowded classes', '{visit}'),
  ('Did it right first time', '{visit}'),
  ('Didn''t explain', '{visit}'),
  ('Didn''t fix it', '{visit}'),
  ('Doctor', '{visit}'),
  ('Easy returns', '{visit}'),
  ('Equipment', '{visit}'),
  ('Explains clearly', '{visit}'),
  ('Fair quote', '{visit}'),
  ('Fees', '{visit}'),
  ('Felt better', '{visit}'),
  ('Food', '{visit}'),
  ('Genuine products', '{visit}'),
  ('Good equipment', '{visit}'),
  ('Good teachers', '{visit}'),
  ('Good trainers', '{visit}'),
  ('Good variety', '{visit}'),
  ('Good vibe', '{visit}'),
  ('Great equipment', '{visit}'),
  ('Great result', '{visit}'),
  ('Great results', '{visit}'),
  ('Great service', '{visit}'),
  ('Great teachers', '{visit}'),
  ('Great trainers', '{visit}'),
  ('Great value', '{visit}'),
  ('Great variety', '{visit}'),
  ('Great vibe', '{visit}'),
  ('Helpful staff', '{visit}'),
  ('Hygienic', '{visit}'),
  ('Kind staff', '{visit}'),
  ('Late', '{visit}'),
  ('Long wait', '{visit}'),
  ('Loved the result', '{visit}'),
  ('Lovely staff', '{visit}'),
  ('Noisy', '{visit}'),
  ('Not clean', '{visit}'),
  ('Not happy with result', '{visit}'),
  ('Old equipment', '{visit}'),
  ('On time', '{visit}'),
  ('Overcharged', '{visit}'),
  ('Personal attention', '{visit}'),
  ('Poor food', '{visit}'),
  ('Poor quality', '{visit}'),
  ('Poor service', '{visit}'),
  ('Pushy selling', '{visit}'),
  ('Quality', '{visit}'),
  ('Quick', '{visit}'),
  ('Relaxing', '{visit}'),
  ('Result', '{visit}'),
  ('Rude staff', '{visit}'),
  ('Rushed', '{visit}'),
  ('Service', '{visit}'),
  ('Short wait', '{visit}'),
  ('Skilled staff', '{visit}'),
  ('So relaxing', '{visit}'),
  ('Spotless', '{visit}'),
  ('Staff', '{visit}'),
  ('Super quick', '{visit}'),
  ('Teachers', '{visit}'),
  ('Tidy work', '{visit}'),
  ('Too pricey', '{visit}'),
  ('Trainers', '{visit}'),
  ('Unhelpful staff', '{visit}'),
  ('Value', '{visit}'),
  ('Value for fees', '{visit}')
on conflict (label) do nothing;

-- ---------- What one QR spot is called ----------
create or replace function public.place_spot_word(p_kind text)
returns text language sql immutable as $$
  select case p_kind when 'food' then 'Table' when 'beauty' then 'Chair' when 'health' then 'Desk'
                     when 'education' then 'Class' when 'services' then 'Card' else 'Counter' end;
$$;

-- A shop typed "other" uses the type its category suggests, as the app does (modeOf).
-- Codes made by any path (setup, approval, "one more") get the right word instead of "Table".
create or replace function public.qr_label_for_kind()
returns trigger language plpgsql set search_path = public as $$
declare k text;
begin
  if new.table_label ~ '^Table [0-9]+$' then
    select case when p.kind = 'other' then public.guess_place_kind(p.category) else p.kind end into k
    from public.places p where p.id = new.place_id;
    if k is not null and k <> 'food' then
      new.table_label := public.place_spot_word(k) || substr(new.table_label, 6);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists qr_codes_label_kind on public.qr_codes;
create trigger qr_codes_label_kind before insert on public.qr_codes
  for each row execute function public.qr_label_for_kind();

-- Codes already made with the default name, at shops that aren't restaurants.
update public.qr_codes q set table_label = public.place_spot_word(x.k) || substr(q.table_label, 6)
from (select p.id, case when p.kind = 'other' then public.guess_place_kind(p.category) else p.kind end as k from public.places p) x
where x.id = q.place_id and x.k <> 'food' and q.table_label ~ '^Table [0-9]+$';
