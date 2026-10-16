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
