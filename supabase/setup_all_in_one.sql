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
