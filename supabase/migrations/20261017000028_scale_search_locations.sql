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
