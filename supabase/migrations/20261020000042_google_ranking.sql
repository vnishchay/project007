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
