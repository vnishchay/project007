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
