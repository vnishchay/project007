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
