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
