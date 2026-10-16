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
