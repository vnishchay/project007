-- Trusted Picks: review photos, playable voice notes, phone numbers for contact
-- matching, suggested people, one trust-score formula for every screen, and
-- payments that record what the business was actually asked to pay.

-- ---------- Review photos ----------
alter table public.reviews add column if not exists photo_path text;
grant update (photo_path) on public.reviews to authenticated;

insert into storage.buckets (id, name, public)
values ('review-photos', 'review-photos', true)
on conflict (id) do nothing;

drop policy if exists "review photos readable" on storage.objects;
create policy "review photos readable" on storage.objects for select using (bucket_id = 'review-photos');
drop policy if exists "own review photos" on storage.objects;
create policy "own review photos" on storage.objects for all to authenticated
  using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Voice notes stay private until they are attached to a published review.
drop policy if exists "voice notes of published reviews" on storage.objects;
create policy "voice notes of published reviews" on storage.objects for select
  using (bucket_id = 'voice' and exists (
    select 1 from public.reviews r where r.voice_path = storage.objects.name and r.status = 'published'));

-- ---------- submit_review: photo, and a topic guessed when none is picked ----------
drop function if exists public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text);
create or replace function public.submit_review(
  p_place_id uuid, p_item_name text, p_rating smallint, p_body text default '',
  p_topic_id bigint default null, p_tag_ids bigint[] default '{}',
  p_ai_drafted boolean default false, p_voice_path text default null, p_photo_path text default null)
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
  if p_voice_path is not null and split_part(p_voice_path, '/', 1) <> auth.uid()::text then raise exception 'bad voice note'; end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> auth.uid()::text then raise exception 'bad photo'; end if;

  -- Without a topic, guess one from the item name, then from the place's category.
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

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, voice_path, photo_path, visit_id)
  values (auth.uid(), p_place_id, it.id, p_rating, coalesce(p_body, ''), p_ai_drafted, p_voice_path, p_photo_path, v_visit)
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t from unnest(coalesce(p_tag_ids, '{}')) t
  on conflict do nothing;

  return r;
end $$;
revoke execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text) from public, anon;
grant execute on function public.submit_review(uuid, text, smallint, text, bigint, bigint[], boolean, text, text) to authenticated;

-- ---------- Phone number for contact matching ----------
-- Only a sha256 of the number is kept. Numbers without a country code are taken as Indian (+91).
create or replace function public.set_my_phone(p_phone text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare digits text; h text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if btrim(coalesce(p_phone, '')) = '' then
    update public.profiles set phone_hash = null where id = auth.uid();
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

create or replace function public.my_phone_is_set()
returns boolean language sql stable security definer set search_path = public as $$
  select phone_hash is not null from public.profiles where id = auth.uid();
$$;

revoke execute on function public.set_my_phone(text) from public, anon;
revoke execute on function public.my_phone_is_set() from public, anon;
revoke execute on function public.match_contacts(text[]) from public, anon;
grant execute on function public.set_my_phone(text) to authenticated;
grant execute on function public.my_phone_is_set() to authenticated;
grant execute on function public.match_contacts(text[]) to authenticated;

-- ---------- Suggested people: local experts and active reviewers you don't follow ----------
drop function if exists public.suggested_people(bigint, integer);
create or replace function public.suggested_people(p_topic bigint default null, p_limit integer default 10)
returns table (id uuid, display_name text, avatar_path text, city text, review_count integer, is_expert boolean, topic_name text)
language sql stable security definer set search_path = public as $$
  with mine as (select city from public.profiles where id = auth.uid()),
  cand as (
    select s.user_id, sum(s.review_count)::integer as n, bool_or(s.is_expert) as expert,
           (array_agg(t.name order by s.is_expert desc, s.review_count desc))[1] as topic_name
    from public.user_topic_stats s join public.topics t on t.id = s.topic_id
    where p_topic is null or s.topic_id = p_topic
    group by s.user_id
    union all
    select r.user_id, count(*)::integer, false, null
    from public.reviews r
    where r.status = 'published' and p_topic is null
      and not exists (select 1 from public.user_topic_stats s where s.user_id = r.user_id)
    group by r.user_id)
  select p.id, p.display_name, p.avatar_path, p.city, c.n, c.expert, c.topic_name
  from cand c join public.profiles p on p.id = c.user_id
  where p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id)
  order by c.expert desc, (p.city is not null and p.city ilike (select city from mine)) desc, c.n desc
  limit least(greatest(p_limit, 1), 30);
$$;
grant execute on function public.suggested_people(bigint, integer) to anon, authenticated;

-- ---------- One trust-score formula for Discover and the place page ----------
-- Adds p_area (match an area within the city), p_place (score one place), has_qr,
-- and in "near me" searches leaves out places with no map location.
drop function if exists public.search_places(text, double precision, double precision, integer, text, integer);
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
      (case when f.follower_id is not null then 3.0
            when uts.is_expert then 1.5 else 1.0 end)
      * (case when m.visit_id is not null then 1.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      f.follower_id is not null as is_friend
    from matched m
    cross join me
    left join public.follows f on f.follower_id = me.uid and f.followee_id = m.user_id
    left join public.items i on i.id = m.item_id
    left join public.user_topic_stats uts on uts.user_id = m.user_id and uts.topic_id = i.topic_id),
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

-- ---------- Payments record the price quoted on the request ----------
alter table public.listing_requests add column if not exists listing_inr integer;
alter table public.listing_requests add column if not exists qr_inr integer;

create or replace function public.prepare_listing_request()
returns trigger language plpgsql set search_path = public as $$
begin
  new.requester_id := auth.uid();
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.place_id := null;
  new.listing_inr := public.setting_int('listing_price_inr', 199);
  new.qr_inr := case when new.wants_qr then public.setting_int('qr_price_inr', 399) else 0 end;
  new.amount_inr := new.listing_inr + new.qr_inr;
  return new;
end $$;

create or replace function public.mark_request_paid(p_request uuid, p_provider_ref text default null)
returns public.listing_requests
language plpgsql security definer set search_path = public as $$
declare lr public.listing_requests; v_qr integer; v_listing integer;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.listing_requests set status = 'paid'
  where id = p_request and status = 'pending' returning * into lr;
  if not found then raise exception 'request is not pending'; end if;

  -- Older requests have no split stored: take the QR part at today's price, the rest is the listing.
  v_qr := case when lr.wants_qr then coalesce(lr.qr_inr, least(lr.amount_inr, public.setting_int('qr_price_inr', 399))) else 0 end;
  v_listing := coalesce(lr.listing_inr, lr.amount_inr - v_qr);

  insert into public.payments (request_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (lr.id, 'listing', v_listing, 'manual', p_provider_ref, current_date, current_date + interval '1 year');
  if lr.wants_qr then
    insert into public.payments (request_id, kind, amount_inr, provider, provider_ref)
    values (lr.id, 'qr', v_qr, 'manual', p_provider_ref);
  end if;
  return lr;
end $$;

-- ---------- Demo places: no fake Google IDs ----------
-- Earlier demo data used ids like "demo-forno-napoli", which break Google links.
update public.places set google_place_id = null where google_place_id like 'demo-%';
