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
