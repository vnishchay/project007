-- Trusted Picks: helper functions, triggers and the RPCs the app calls.
-- Functions marked "security definer" run with the owner's rights so they can
-- do things a plain user can't (create a visit, attach it to a review), but each
-- one checks auth.uid() itself.

-- ---------- Helpers ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.setting_int(k text, fallback integer)
returns integer language sql stable set search_path = public as $$
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = k), fallback);
$$;

-- A profile row for every new Supabase Auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, phone_hash)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''),
    case when new.phone is not null and new.phone <> ''
         then encode(extensions.digest('+' || ltrim(new.phone, '+'), 'sha256'), 'hex') end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change someone's role.
create or replace function public.guard_profile_role()
returns trigger language plpgsql set search_path = public as $$
begin
  -- auth.uid() is null for the SQL editor and the service key, which are trusted.
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'only admins can change roles';
  end if;
  return new;
end $$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- Requests always start pending, with the price taken from settings.
create or replace function public.prepare_listing_request()
returns trigger language plpgsql set search_path = public as $$
begin
  new.requester_id := auth.uid();
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.place_id := null;
  new.amount_inr := public.setting_int('listing_price_inr', 199)
                  + case when new.wants_qr then public.setting_int('qr_price_inr', 399) else 0 end;
  return new;
end $$;

create trigger listing_requests_prepare
  before insert on public.listing_requests
  for each row execute function public.prepare_listing_request();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

-- A review may only carry a visit that belongs to the same user and place
-- and was still open when the review was written.
create or replace function public.check_review_visit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visit_id is not null and not exists (
    select 1 from public.visits v
    where v.id = new.visit_id and v.user_id = new.user_id and v.place_id = new.place_id
      and new.created_at between v.scanned_at and v.expires_at
  ) then
    raise exception 'visit does not match this review';
  end if;
  if tg_op = 'UPDATE' and new.visit_id is distinct from old.visit_id and not public.is_admin() then
    raise exception 'visit cannot be changed';
  end if;
  return new;
end $$;

create trigger reviews_check_visit before insert or update on public.reviews
  for each row execute function public.check_review_visit();

-- Keep item_stats current on every review change.
create or replace function public.refresh_item_stats(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.item_stats where item_id = p_item;
  insert into public.item_stats (item_id, place_id, avg_rating, review_count, verified_count)
  select r.item_id, r.place_id, round(avg(r.rating), 2), count(*), count(r.visit_id)
  from public.reviews r
  where r.item_id = p_item and r.status = 'published'
  group by r.item_id, r.place_id;
end $$;

create or replace function public.reviews_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.refresh_item_stats(new.item_id); end if;
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.item_id <> new.item_id) then
    perform public.refresh_item_stats(old.item_id);
  end if;
  return null;
end $$;

create trigger reviews_stats after insert or update or delete on public.reviews
  for each row execute function public.reviews_after_change();

-- ---------- RPCs the app calls ----------

-- Scan a table QR: returns the place and opens a 6-hour verified-visit window.
create or replace function public.scan_qr(p_token text)
returns table (visit_id uuid, place_id uuid, place_name text, area text, table_label text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare q record; v public.visits;
begin
  if auth.uid() is null then raise exception 'sign in to scan'; end if;
  select qc.id, qc.place_id, qc.table_label, p.name, p.area into q
  from public.qr_codes qc join public.places p on p.id = qc.place_id
  where qc.token = p_token and qc.active and p.status = 'live';
  if not found then raise exception 'unknown or inactive code'; end if;

  insert into public.visits (user_id, place_id, qr_code_id, expires_at)
  values (auth.uid(), q.place_id, q.id,
          now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
  returning * into v;

  return query select v.id, q.place_id, q.name, q.area, q.table_label, v.expires_at;
end $$;

-- Look up a QR without signing in (to show the place before login).
create or replace function public.peek_qr(p_token text)
returns table (place_id uuid, place_name text, area text, table_label text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, qc.table_label
  from public.qr_codes qc join public.places p on p.id = qc.place_id
  where qc.token = p_token and qc.active and p.status = 'live';
$$;

-- Save a review. Creates the item the first time it's rated, attaches the
-- user's open visit for this place (if any), and sets tags.
create or replace function public.submit_review(
  p_place_id uuid, p_item_name text, p_rating smallint, p_body text default '',
  p_topic_id bigint default null, p_tag_ids bigint[] default '{}',
  p_ai_drafted boolean default false, p_voice_path text default null)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare it public.items; v_visit uuid; r public.reviews;
begin
  if auth.uid() is null then raise exception 'sign in to review'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  if btrim(coalesce(p_item_name, '')) = '' then raise exception 'say what you had'; end if;

  insert into public.items (place_id, topic_id, name)
  values (p_place_id, p_topic_id, btrim(p_item_name))
  on conflict (place_id, name_normalized) do update
    set topic_id = coalesce(public.items.topic_id, excluded.topic_id)
  returning * into it;

  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;

  insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, voice_path, visit_id)
  values (auth.uid(), p_place_id, it.id, p_rating, coalesce(p_body, ''), p_ai_drafted, p_voice_path, v_visit)
  returning * into r;

  insert into public.review_tags (review_id, tag_id)
  select r.id, t from unnest(coalesce(p_tag_ids, '{}')) t
  on conflict do nothing;

  return r;
end $$;

-- Find friends from the phone's contacts. The app sends sha256 hashes of
-- E.164 numbers; raw numbers never leave the phone.
create or replace function public.match_contacts(p_hashes text[])
returns table (id uuid, display_name text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path from public.profiles p
  where p.phone_hash = any (p_hashes[1:2000]) and p.id <> auth.uid();
$$;

-- "Best X near me": places ranked by the viewer's trust score.
-- score = (sum w*r + k*avg) / (sum w + k)
-- w = rel (3 followed, 1.5 expert, else 1) * ver (1.5 verified) * 0.5^(age_days/180)
create or replace function public.search_places(
  p_query text default null, p_lat double precision default null, p_lng double precision default null,
  p_radius_m integer default 5000, p_city text default null, p_limit integer default 20)
returns table (
  place_id uuid, name text, category text, area text, price_level smallint, google_place_id text,
  distance_m integer, trust_score numeric, review_count integer, verified_count integer,
  friend_count integer, friend_ids uuid[], top_item text)
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
      and (p_city is null or p.city ilike p_city)
      and (here.pt is null or p.location is null or st_dwithin(p.location, here.pt, p_radius_m))),
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
         s.score, coalesce(s.n, 0), coalesce(s.nv, 0), coalesce(s.nf, 0), coalesce(s.fids, '{}'), s.top_item
  from cand c left join scored s on s.place_id = c.id, q
  where s.place_id is not null or q.txt is null
     or lower(c.name) like '%' || q.txt || '%' or lower(c.category) like '%' || q.txt || '%'
  order by s.score desc nulls last, c.dist asc nulls last
  limit least(p_limit, 50);
$$;

-- Counts shown on the Circle screen.
create or replace function public.my_circle_stats()
returns table (reviews integer, followers integer, following integer, verified integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.reviews where user_id = auth.uid())::integer,
    (select count(*) from public.follows where followee_id = auth.uid())::integer,
    (select count(*) from public.follows where follower_id = auth.uid())::integer,
    (select count(*) from public.reviews where user_id = auth.uid() and visit_id is not null)::integer;
$$;

-- ---------- Admin RPCs ----------

create or replace function public.mark_request_paid(p_request uuid, p_provider_ref text default null)
returns public.listing_requests
language plpgsql security definer set search_path = public as $$
declare lr public.listing_requests;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.listing_requests set status = 'paid'
  where id = p_request and status = 'pending' returning * into lr;
  if not found then raise exception 'request is not pending'; end if;

  insert into public.payments (request_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (lr.id, 'listing', public.setting_int('listing_price_inr', 199), 'manual', p_provider_ref,
          current_date, current_date + interval '1 year');
  if lr.wants_qr then
    insert into public.payments (request_id, kind, amount_inr, provider, provider_ref)
    values (lr.id, 'qr', public.setting_int('qr_price_inr', 399), 'manual', p_provider_ref);
  end if;
  return lr;
end $$;

-- Approving creates the place, its QR code (if bought), and links payments.
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

  insert into public.places (google_place_id, name, category, area, city, location, status, listed_until, created_by)
  values (nullif(lr.google_place_id, ''), lr.business_name, lr.category, lr.area, lr.city,
          case when p_lat is not null and p_lng is not null
               then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
          'live', current_date + interval '1 year', auth.uid())
  on conflict (google_place_id) do update
    set status = 'live', listed_until = excluded.listed_until
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

create or replace function public.decline_listing(p_request uuid)
returns public.listing_requests
language plpgsql security definer set search_path = public as $$
declare lr public.listing_requests;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.listing_requests
    set status = 'declined', decided_by = auth.uid(), decided_at = now()
    where id = p_request and status in ('pending', 'paid') returning * into lr;
  if not found then raise exception 'request cannot be declined'; end if;
  return lr;
end $$;

create or replace function public.admin_summary()
returns table (to_review integer, live_places integer, collected_inr integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.listing_requests where status in ('pending', 'paid'))::integer,
    (select count(*) from public.places where status = 'live')::integer,
    (select coalesce(sum(amount_inr), 0) from public.payments where status = 'paid')::integer
  where public.is_admin();
$$;

-- ---------- Nightly jobs ----------

-- Lapse listings whose year is up.
create or replace function public.lapse_expired_listings()
returns integer language sql security definer set search_path = public as $$
  with u as (
    update public.places set status = 'lapsed'
    where status = 'live' and listed_until is not null and listed_until < current_date
    returning 1)
  select count(*)::integer from u;
$$;

-- Rebuild user_topic_stats and taste_match from reviews.
create or replace function public.refresh_trust_tables()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_topic_stats;
  insert into public.user_topic_stats (user_id, topic_id, review_count, followers_trusting, is_expert)
  with counts as (
    select r.user_id, i.topic_id, count(*)::integer as n
    from public.reviews r join public.items i on i.id = r.item_id
    where r.status = 'published' and i.topic_id is not null
    group by r.user_id, i.topic_id),
  trusting as (
    select c.user_id, c.topic_id, count(distinct f.follower_id)::integer as ft
    from counts c
    join public.follows f on f.followee_id = c.user_id
    join public.reviews r2 on r2.user_id = f.follower_id and r2.status = 'published'
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
    where r.status = 'published' and i.topic_id is not null
    order by r.user_id, r.item_id, r.created_at desc)
  select a.user_id, b.user_id, a.topic_id,
         round(100 * (1 - avg(abs(a.rating - b.rating)) / 4.0))::smallint, count(*)::integer
  from latest a join latest b on a.item_id = b.item_id and a.user_id <> b.user_id
  group by a.user_id, b.user_id, a.topic_id
  having count(*) >= 3;
end $$;

-- Only signed-in users call RPCs; the nightly jobs are for the scheduler only.
revoke execute on function public.refresh_trust_tables() from public, anon, authenticated;
revoke execute on function public.lapse_expired_listings() from public, anon, authenticated;
revoke execute on function public.refresh_item_stats(uuid) from public, anon, authenticated;
