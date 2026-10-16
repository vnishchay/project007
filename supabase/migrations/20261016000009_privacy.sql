-- Trusted Picks: privacy by default.
--
-- * Every review is anonymous unless its author chooses "Show my name". Nobody else
--   can see who wrote an anonymous review: the reviews table is readable only by its
--   author and admins, and everyone else reads through the review_feed view, which
--   blanks out the author on anonymous reviews.
-- * "Your friends were here" only appears between people who have both synced
--   contacts and have each other's numbers, and only for reviews posted with a name.
-- * Visits stay private (only you see yours). Follower lists, contact links, phone
--   fingerprints and home city are never readable by other users.
-- * Uploaded photos and voice notes get random file names, so a link never reveals who
--   posted it.

-- ---------- Reviews: anonymous unless the author shows their name ----------
alter table public.reviews add column if not exists is_public boolean not null default false;
grant update (is_public) on public.reviews to authenticated;

drop policy if exists "published reviews readable" on public.reviews;
drop policy if exists "own reviews readable" on public.reviews;
create policy "own reviews readable" on public.reviews for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- What everyone else sees. Runs with the view owner's rights so it can blank out
-- authors; it shows only published reviews (plus your own).
drop view if exists public.review_feed;
create view public.review_feed with (security_barrier = true) as
  select r.id,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.user_id end as user_id,
         r.place_id, r.item_id, r.rating, r.body, r.ai_drafted,
         (r.visit_id is not null) as verified,
         r.photo_path,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.voice_path end as voice_path,
         r.status, r.is_public, r.created_at,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.display_name end as author_name,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.avatar_path end as author_avatar
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  where r.status = 'published' or r.user_id = auth.uid() or public.is_admin();
revoke all on public.review_feed from public, anon, authenticated;
grant select on public.review_feed to anon, authenticated;

-- ---------- Uploads: random names, ownership checked by the database ----------
update storage.buckets set public = true where id = 'review-photos';

drop policy if exists "own review photos" on storage.objects;
drop policy if exists "upload review photos" on storage.objects;
drop policy if exists "manage own review photos" on storage.objects;
drop policy if exists "delete own review photos" on storage.objects;
create policy "upload review photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-photos' and position('/' in name) = 0);
create policy "manage own review photos" on storage.objects for update to authenticated
  using (bucket_id = 'review-photos' and owner = auth.uid());
create policy "delete own review photos" on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos' and owner = auth.uid());

drop policy if exists "own voice notes" on storage.objects;
drop policy if exists "voice notes of published reviews" on storage.objects;
drop policy if exists "upload voice notes" on storage.objects;
drop policy if exists "read voice notes" on storage.objects;
drop policy if exists "delete own voice notes" on storage.objects;
create policy "upload voice notes" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and position('/' in name) = 0);
create policy "read voice notes" on storage.objects for select
  using (bucket_id = 'voice' and (owner = auth.uid() or exists (
    select 1 from public.reviews r
    where r.voice_path = storage.objects.name and r.status = 'published' and r.is_public)));
create policy "delete own voice notes" on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and owner = auth.uid());

-- ---------- submit_review: choose anonymous or named ----------
drop function if exists public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text);
create or replace function public.submit_review(
  p_place_id uuid, p_item_name text, p_rating smallint, p_body text default '',
  p_topic_id bigint default null, p_tag_ids bigint[] default '{}',
  p_ai_drafted boolean default false, p_voice_path text default null, p_photo_path text default null,
  p_is_public boolean default false)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare it public.items; v_visit uuid; r public.reviews; v_topic bigint; v_name text;
begin
  if auth.uid() is null then raise exception 'sign in to review'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  v_name := btrim(coalesce(p_item_name, ''));
  if v_name = '' then raise exception 'say what you had'; end if;
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

  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, voice_path, photo_path, visit_id, is_public)
  values (auth.uid(), p_place_id, it.id, p_rating, coalesce(p_body, ''), p_ai_drafted, p_voice_path, p_photo_path, v_visit, coalesce(p_is_public, false))
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t from unnest(coalesce(p_tag_ids, '{}')) t
  on conflict do nothing;

  return r;
end $$;
revoke execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean) from public, anon;
grant execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text, boolean) to authenticated;

-- ---------- Profiles: home city is private ----------
alter table public.profiles add column if not exists contacts_synced_at timestamptz;
revoke select (city) on public.profiles from anon, authenticated;

create or replace function public.my_profile()
returns table (id uuid, display_name text, avatar_path text, city text, role public.app_role, created_at timestamptz,
               phone_set boolean, contacts_synced boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path, p.city, p.role, p.created_at,
         p.phone_hash is not null, p.contacts_synced_at is not null
  from public.profiles p where p.id = auth.uid();
$$;

-- ---------- Follows: only you see your own follows and followers ----------
drop policy if exists "follows readable" on public.follows;
drop policy if exists "own follows readable" on public.follows;
create policy "own follows readable" on public.follows for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid() or public.is_admin());

-- Public counts for a profile page, from named reviews only.
create or replace function public.person_stats(p_user uuid)
returns table (reviews integer, followers integer, verified integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.reviews r where r.user_id = p_user and r.status = 'published'
       and (r.is_public or p_user = auth.uid()))::integer,
    (select count(*) from public.follows f where f.followee_id = p_user)::integer,
    (select count(*) from public.reviews r where r.user_id = p_user and r.status = 'published' and r.visit_id is not null
       and (r.is_public or p_user = auth.uid()))::integer;
$$;
grant execute on function public.person_stats(uuid) to anon, authenticated;

-- Find people by name: only people who have posted a review with their name.
create or replace function public.find_people(p_query text, p_limit integer default 15)
returns table (id uuid, display_name text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path from public.profiles p
  where length(btrim(coalesce(p_query, ''))) >= 2
    and p.display_name ilike '%' || btrim(p_query) || '%'
    and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and exists (select 1 from public.reviews r where r.user_id = p.id and r.status = 'published' and r.is_public)
  order by p.display_name
  limit least(greatest(p_limit, 1), 30);
$$;
grant execute on function public.find_people(text, integer) to authenticated;

-- ---------- Contact sync: opt-in, private, mutual ----------
create table if not exists public.contact_links (
  owner_id    uuid not null references public.profiles (id) on delete cascade,   -- has contact_id's number saved
  contact_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (owner_id, contact_id)
);
create index if not exists contact_links_contact_idx on public.contact_links (contact_id);
alter table public.contact_links enable row level security;
-- No policies: nobody reads or writes this table directly, only through the functions below.

create table if not exists public.contact_syncs (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  synced_at  timestamptz not null default now()
);
create index if not exists contact_syncs_user_idx on public.contact_syncs (user_id, synced_at desc);
alter table public.contact_syncs enable row level security;

-- Mutual contacts: each has the other's number, and both turned on contact sync.
create or replace function public.are_contacts(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and a <> b
    and exists (select 1 from public.contact_links where owner_id = a and contact_id = b)
    and exists (select 1 from public.contact_links where owner_id = b and contact_id = a)
    and exists (select 1 from public.profiles where id = a and contacts_synced_at is not null)
    and exists (select 1 from public.profiles where id = b and contacts_synced_at is not null);
$$;
revoke execute on function public.are_contacts(uuid, uuid) from public, anon, authenticated;

-- Matching your contacts needs your own number on file (so it works both ways),
-- is limited to 5 syncs a day and 2000 numbers, and only finds people who added
-- their number to be found.
drop function if exists public.match_contacts(text[]);
create or replace function public.match_contacts(p_hashes text[])
returns table (id uuid, display_name text, avatar_path text, mutual boolean)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where profiles.id = auth.uid() and phone_hash is not null) then
    raise exception 'add your own number first, so your contacts can find you too';
  end if;
  if (select count(*) from public.contact_syncs s where s.user_id = auth.uid() and s.synced_at > now() - interval '1 day') >= 5 then
    raise exception 'you can sync contacts 5 times a day; try again tomorrow';
  end if;
  insert into public.contact_syncs (user_id) values (auth.uid());

  delete from public.contact_links where owner_id = auth.uid();
  insert into public.contact_links (owner_id, contact_id)
  select auth.uid(), p.id from public.profiles p
  where p.phone_hash = any (p_hashes[1:2000]) and p.id <> auth.uid()
  on conflict do nothing;
  update public.profiles set contacts_synced_at = now() where profiles.id = auth.uid();

  return query
    select p.id, p.display_name, p.avatar_path, public.are_contacts(auth.uid(), p.id)
    from public.contact_links l join public.profiles p on p.id = l.contact_id
    where l.owner_id = auth.uid()
    order by p.display_name;
end $$;
revoke execute on function public.match_contacts(text[]) from public, anon;
grant execute on function public.match_contacts(text[]) to authenticated;

-- Turn contact sync off: forget who is in your contacts.
create or replace function public.stop_contact_sync()
returns void language sql security definer set search_path = public as $$
  delete from public.contact_links where owner_id = auth.uid();
  update public.profiles set contacts_synced_at = null where id = auth.uid();
$$;
revoke execute on function public.stop_contact_sync() from public, anon;
grant execute on function public.stop_contact_sync() to authenticated;

-- Removing your number also stops others from matching you.
create or replace function public.set_my_phone(p_phone text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare digits text; h text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if btrim(coalesce(p_phone, '')) = '' then
    update public.profiles set phone_hash = null where id = auth.uid();
    delete from public.contact_links where contact_id = auth.uid();
    return false;
  end if;
  digits := regexp_replace(p_phone, '\D', '', 'g');
  if p_phone !~ '^\s*\+' then
    digits := regexp_replace(digits, '^0+', '');
    if length(digits) = 10 then digits := '91' || digits; end if;
  end if;
  if length(digits) < 8 or length(digits) > 15 then raise exception 'enter a full phone number'; end if;
  h := encode(digest('+' || digits, 'sha256'), 'hex');
  if exists (select 1 from public.profiles where phone_hash = h and id <> auth.uid()) then
    raise exception 'that number is already linked to another account';
  end if;
  update public.profiles set phone_hash = h where id = auth.uid();
  return true;
end $$;

-- ---------- Suggestions: no home city in the output ----------
drop function if exists public.suggested_people(bigint, integer);
create or replace function public.suggested_people(p_topic bigint default null, p_limit integer default 10)
returns table (id uuid, display_name text, avatar_path text, review_count integer, is_expert boolean, topic_name text)
language sql stable security definer set search_path = public as $$
  with mine as (select city from public.profiles where id = auth.uid()),
  cand as (
    select s.user_id, sum(s.review_count)::integer as n, bool_or(s.is_expert) as expert,
           (array_agg(t.name order by s.is_expert desc, s.review_count desc))[1] as topic_name
    from public.user_topic_stats s join public.topics t on t.id = s.topic_id
    where p_topic is null or s.topic_id = p_topic
    group by s.user_id)
  select p.id, p.display_name, p.avatar_path, c.n, c.expert, c.topic_name
  from cand c join public.profiles p on p.id = c.user_id
  where p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id)
  order by c.expert desc, (p.city is not null and p.city ilike (select city from mine)) desc, c.n desc
  limit least(greatest(p_limit, 1), 30);
$$;
grant execute on function public.suggested_people(bigint, integer) to anon, authenticated;

-- ---------- Trust tables: built from named reviews only ----------
create or replace function public.refresh_trust_tables()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_topic_stats;
  insert into public.user_topic_stats (user_id, topic_id, review_count, followers_trusting, is_expert)
  with counts as (
    select r.user_id, i.topic_id, count(*)::integer as n
    from public.reviews r join public.items i on i.id = r.item_id
    where r.status = 'published' and r.is_public and i.topic_id is not null
    group by r.user_id, i.topic_id),
  trusting as (
    select c.user_id, c.topic_id, count(distinct f.follower_id)::integer as ft
    from counts c
    join public.follows f on f.followee_id = c.user_id
    join public.reviews r2 on r2.user_id = f.follower_id and r2.status = 'published' and r2.is_public
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
    where r.status = 'published' and r.is_public and i.topic_id is not null
    order by r.user_id, r.item_id, r.created_at desc)
  select a.user_id, b.user_id, a.topic_id,
         round(100 * (1 - avg(abs(a.rating - b.rating)) / 4.0))::smallint, count(*)::integer
  from latest a join latest b on a.item_id = b.item_id and a.user_id <> b.user_id
  group by a.user_id, b.user_id, a.topic_id
  having count(*) >= 3;
end $$;
revoke execute on function public.refresh_trust_tables() from public, anon, authenticated;
select public.refresh_trust_tables();

-- ---------- Search: friend signals only from mutual contacts' named reviews ----------
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
    select m.place_id, m.rating, m.user_id, m.visit_id, m.item_name,
      -- Anonymous reviews count, but never with extra weight that could hint at who wrote them.
      (case when not m.is_public then 1.0
            when f.follower_id is not null or fr.is_contact then 3.0
            when uts.is_expert then 1.5 else 1.0 end)
      * (case when m.visit_id is not null then 1.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      m.is_public and fr.is_contact as is_friend
    from matched m
    cross join me
    left join public.follows f on m.is_public and f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.items i on i.id = m.item_id
    left join public.user_topic_stats uts on uts.user_id = m.user_id and uts.topic_id = i.topic_id
    cross join lateral (select m.is_public and public.are_contacts(me.uid, m.user_id) as is_contact) fr),
  scored as (
    select w.place_id,
      round(((sum(w.w * w.rating) + 3 * (select avg_r from prior)) / (sum(w.w) + 3))::numeric, 1) as score,
      count(*)::integer as n, count(w.visit_id)::integer as nv,
      count(distinct w.user_id) filter (where w.is_friend)::integer as nf,
      coalesce(array_agg(distinct w.user_id) filter (where w.is_friend), '{}') as fids,
      mode() within group (order by w.item_name) as top_item
    from weighted w group by w.place_id)
  select c.id, c.name, c.category, c.area, c.price_level, c.google_place_id, c.dist,
         s.score, coalesce(s.n, 0), coalesce(s.nv, 0), coalesce(s.nf, 0), coalesce(s.fids, '{}'), s.top_item,
         exists (select 1 from public.qr_codes qc where qc.place_id = c.id and qc.active)
  from cand c left join scored s on s.place_id = c.id, q
  where s.place_id is not null or q.txt is null
     or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
  order by s.score desc nulls last, c.dist asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.search_places(text, double precision, double precision, integer, text, integer, text, uuid) to anon, authenticated;

-- ---------- Visit history stays private ----------
-- visits are readable only by their owner (and admins) already. Make sure nobody can
-- read another user's Google share log or saved places either.
revoke all on public.contact_links, public.contact_syncs from anon, authenticated;
