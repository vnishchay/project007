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
