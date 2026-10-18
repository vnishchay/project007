-- Trusted Picks: fixes from the full review of 2026-10-18.
-- Privacy: anonymous friends are never counted; old phone matching and listing requests are switched off.
-- Shops: payments only from a fresh order, plan changes are fair, QRs follow the plan, Google pins and links
-- can't be faked or swapped after the team's check. Reviews: review links aren't wasted, guests can't reset
-- their one visit per phone, uploads are images and audio only.
set search_path = public, extensions;

-- 1. Old phone matching (replaced by invite links): nobody can look up who owns a phone number any more.
drop function if exists public.match_contacts(text[]);
drop function if exists public.set_my_phone(text);
drop function if exists public.my_phone_is_set();
drop function if exists public.stop_contact_sync();
drop function if exists public.are_contacts(uuid, uuid);
drop table if exists public.contact_links;
drop table if exists public.contact_syncs;
update public.profiles set phone_hash = null where phone_hash is not null;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''))
    on conflict (id) do nothing;
  exception when others then
    raise warning 'trusted picks: profile for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $$;
-- Who is an admin isn't public.
revoke select (role) on public.profiles from anon, authenticated;

-- 2. Listing requests are gone (shops list themselves): nobody can start or pay for one.
drop policy if exists "request listing" on public.listing_requests;
do $$ begin
  revoke execute on function public.approve_listing(uuid, double precision, double precision, text[]) from public, anon, authenticated;
  revoke execute on function public.decline_listing(uuid) from public, anon, authenticated;
  revoke execute on function public.mark_request_paid(uuid, text) from public, anon, authenticated;
exception when undefined_function then null; end $$;
create or replace function public.admin_summary()
returns table (to_review integer, live_places integer, collected_inr integer)
language sql stable security definer set search_path = public as $$
  select
    ((select count(*) from public.places where verification = 'pending' and status = 'live')
     + (select count(*) from public.place_claims where status = 'pending'))::integer,
    (select count(*) from public.places where status = 'live')::integer,
    (select coalesce(sum(amount_inr), 0) from public.payments where status = 'paid')::integer
  where public.is_admin();
$$;

-- 3. Search: "friends rated this" counts only friends who posted with their name.
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
      mode() within group (order by w.item_name) as top_item
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

-- 4. Reviews of a shop that was taken down stay hidden (except from their author and admins).
create or replace view public.review_feed with (security_barrier = true) as
select r.id,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.user_id end as user_id,
  r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null) as verified, r.photo_path,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.voice_path end as voice_path,
  r.status, r.is_public, r.created_at,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.display_name end as author_name,
  case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.avatar_path end as author_avatar,
  (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id) as source
from public.reviews r
join public.profiles p on p.id = r.user_id
join public.places pl on pl.id = r.place_id
where (r.status = 'published' and pl.status = 'live') or r.user_id = auth.uid() or public.is_admin();
grant select on public.review_feed to anon, authenticated;

-- 5. A review's photo or voice note can only be set through submit_review (which checks the file is yours),
--    and a guest can't delete a review to get a second visit from the same phone.
revoke update (photo_path, voice_path) on public.reviews from authenticated;
drop policy if exists "delete own review" on public.reviews;
create policy "delete own review" on public.reviews for delete to authenticated
  using ((user_id = auth.uid() and not public.is_guest()) or public.is_admin());

-- 6. Review links: not used up when the person can't review, and an ended visit says so.
drop function if exists public.redeem_review_link(text);
create or replace function public.redeem_review_link(p_token text, p_device text default null)
returns table (visit_id uuid, place_id uuid, place_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare l public.review_links; v public.visits; v_name text; v_device text;
begin
  if auth.uid() is null then raise exception 'open the link again to continue'; end if;
  select * into l from public.review_links where token = p_token for update;
  if l.id is null then raise exception 'this review link doesn''t work'; end if;
  select name into v_name from public.places where id = l.place_id and status = 'live';
  if v_name is null then raise exception 'this shop isn''t listed right now'; end if;

  if l.used_at is not null then
    select * into v from public.visits where id = l.visit_id and user_id = auth.uid();
    if v.id is null then raise exception 'this review link was already used. Ask the shop for a new one'; end if;
    if v.expires_at < now() then raise exception 'the visit from this link has ended. Ask the shop for a new link'; end if;
    return query select v.id, l.place_id, v_name, v.expires_at; return;
  end if;
  if l.expires_at < now() then raise exception 'this review link has expired. Ask the shop for a new one'; end if;
  if public.is_place_owner(l.place_id) then raise exception 'you can''t review your own shop'; end if;
  if not public.reviews_open(l.place_id) then raise exception 'reviews are paused at this shop for now'; end if;
  if public.is_guest() then
    v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
    if exists (select 1 from public.reviews r where r.place_id = l.place_id
               and (r.user_id = auth.uid() or (v_device is not null and r.device_hash = v_device and r.by_guest))) then
      raise exception 'you''ve already reviewed this shop from this phone. Sign in to review again';
    end if;
  end if;

  insert into public.visits (user_id, place_id, source, expires_at)
  values (auth.uid(), l.place_id, 'link', now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
  returning * into v;
  update public.review_links set used_at = now(), visit_id = v.id where id = l.id;
  return query select v.id, l.place_id, v_name, v.expires_at;
end $$;
revoke all on function public.redeem_review_link(text, text) from public, anon;
grant execute on function public.redeem_review_link(text, text) to authenticated;

-- 7. Changing the Google link or the links after the team's check sends the shop back to be checked.
create or replace function public.guard_place_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then new.verification := 'pending';
    else
      if new.verification is distinct from old.verification or new.verification_note is distinct from old.verification_note then
        new.verification := old.verification; new.verification_note := old.verification_note;
      end if;
      if new.google_place_id is distinct from old.google_place_id or new.links is distinct from old.links then
        new.verification := 'pending';
      end if;
    end if;
  end if;
  return new;
end $$;

-- 8. Pins: owners can't relabel where a pin came from, and a "Google" pin from an owner can't jump far
--    from the one already there (Google only moves a pin a little).
create or replace function public.guard_place_owner_edits()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.name is distinct from old.name or new.status is distinct from old.status
     or new.listed_until is distinct from old.listed_until or new.owner_id is distinct from old.owner_id
     or (new.google_place_id is distinct from old.google_place_id and old.google_place_id is not null)
     or new.city is distinct from old.city or new.created_by is distinct from old.created_by then
    raise exception 'ask the Trusted Picks team to change the name, city, Google link or listing dates';
  end if;
  if (new.location_source is distinct from old.location_source or new.location_updated_at is distinct from old.location_updated_at)
     and coalesce(current_setting('app.location_write', true), '') <> '1' then
    new.location_source := old.location_source; new.location_updated_at := old.location_updated_at;
  end if;
  if new.location is distinct from old.location and old.location_source = 'google' and old.google_place_id is not null
     and coalesce(current_setting('app.location_write', true), '') <> '1' then
    raise exception 'this shop''s pin comes from Google. Use "Refresh from Google" instead';
  end if;
  return new;
end $$;

create or replace function public.set_place_location(p_place uuid, p_lat double precision, p_lng double precision, p_source text default 'manual')
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change this'; end if;
  select * into pl from public.places where id = p_place;
  if not found then raise exception 'shop not found'; end if;
  if p_source is null or p_source not in ('google', 'manual') then raise exception 'unknown location source'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'send both latitude and longitude'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180 or (abs(p_lat) < 0.0001 and abs(p_lng) < 0.0001)) then
    raise exception 'that isn''t a real location';
  end if;
  if p_source = 'google' and pl.google_place_id is null then raise exception 'link the shop to Google first'; end if;
  if not public.is_admin() and pl.google_place_id is not null and pl.location_source = 'google' then
    if p_source = 'manual' then raise exception 'this shop''s pin comes from Google. Use "Refresh from Google" instead'; end if;
    if p_lat is null then raise exception 'a Google pin can''t be removed'; end if;
    if pl.location is not null and st_distance(pl.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) > 2000 then
      raise exception 'that''s far from Google''s pin for this shop. Ask the Trusted Picks team to move it';
    end if;
  end if;
  perform set_config('app.location_write', '1', true);
  perform set_config('app.location_source', p_source, true);
  update public.places
    set location = case when p_lat is null then null else st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end
    where id = p_place;
  perform set_config('app.location_write', '', true);
  perform set_config('app.location_source', '', true);
end $$;
revoke all on function public.set_place_location(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.set_place_location(uuid, double precision, double precision, text) to authenticated;

-- 9. A shop's update can carry a link only once the team has checked the shop.
create or replace function public.guard_update_link()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.link_url is not null and not public.is_admin()
     and not exists (select 1 from public.places p where p.id = new.place_id and p.verification = 'verified') then
    new.link_url := null;
  end if;
  return new;
end $$;
drop trigger if exists place_updates_guard_link on public.place_updates;
create trigger place_updates_guard_link before insert or update on public.place_updates
  for each row execute function public.guard_update_link();

-- 10. Plans. A payment only counts once, from a fresh order. Changing plan converts the time left at the
--     old plan's price instead of carrying it over 1:1, and QRs above the new plan's limit are turned off.
create or replace function public.trim_qrs(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lim integer;
begin
  lim := public.place_qr_limit(p_place);
  update public.qr_codes set active = false
  where id in (select id from public.qr_codes where place_id = p_place and active order by created_at desc
               offset greatest(lim, 1));
end $$;
revoke all on function public.trim_qrs(uuid) from public, anon, authenticated;

create or replace function public.apply_plan(p_place uuid, p_plan text, p_interval text, p_months integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.subscriptions; base timestamptz; span interval; old_price numeric; new_price numeric;
begin
  select * into s from public.subscriptions where place_id = p_place for update;
  base := case when s.place_id is not null and s.status in ('active', 'past_due', 'cancelled') and s.period_end > now()
               then s.period_end else now() end;
  -- Time left on a different paid plan is worth what it cost: convert it at the two plans' yearly prices.
  if base > now() and s.plan is distinct from p_plan then
    select price_inr_year into old_price from public.plans where code = s.plan;
    select price_inr_year into new_price from public.plans where code = p_plan;
    if coalesce(old_price, 0) > 0 and coalesce(new_price, 0) > 0 then
      base := now() + (base - now()) * (old_price / new_price);
    else
      base := now();
    end if;
  end if;
  span := case when p_months is not null then make_interval(months => p_months)
               when p_interval = 'month' then interval '1 month' else interval '1 year' end;
  insert into public.subscriptions (place_id, plan, status, period_end, billing_interval, updated_at)
  values (p_place, p_plan, 'active', base + span, case when p_interval in ('month', 'year') then p_interval end, now())
  on conflict (place_id) do update set plan = excluded.plan, status = 'active', period_end = excluded.period_end,
    billing_interval = excluded.billing_interval, cancel_at_period_end = false, updated_at = now();
  perform public.trim_qrs(p_place);
end $$;
revoke all on function public.apply_plan(uuid, text, text, integer) from public, anon, authenticated;

create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.billing_orders; rupees integer;
begin
  select * into o from public.billing_orders where provider_order_id = p_order for update;
  if o.id is null then return false; end if;
  if o.status = 'paid' then return true; end if;
  if o.status <> 'created' then return false; end if;
  if p_amount is not null and p_amount <> o.amount_minor then
    update public.billing_orders set status = 'failed' where id = o.id;
    return false;
  end if;
  if o.place_id is null then return false; end if;
  update public.billing_orders set status = 'paid', provider_payment_id = p_payment, paid_at = now() where id = o.id;
  rupees := o.amount_minor / 100;
  perform public.apply_plan(o.place_id, o.plan, o.billing_interval);
  insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (o.place_id, 'listing', rupees, 'razorpay', p_payment, current_date,
          current_date + case when o.billing_interval = 'month' then interval '1 month' else interval '1 year' end);
  return true;
end $$;
revoke all on function public.billing_mark_paid(text, text, integer) from public, anon, authenticated;

-- The plan card shows the limit that really applies (an ended plan falls back to the trial's one QR).
create or replace function public.my_plan(p_place uuid)
returns table (plan text, plan_name text, status text, period_end timestamptz, trial_reviews_left integer, qr_limit integer,
               qr_used integer, reviews_open boolean, cancel_at_period_end boolean, billing_interval text)
language sql stable security definer set search_path = public as $$
  select s.plan, pl.name, s.status, s.period_end, s.trial_reviews_left, public.place_qr_limit(p_place),
         (select count(*)::integer from public.qr_codes q where q.place_id = p_place and q.active),
         public.reviews_open(p_place), s.cancel_at_period_end, s.billing_interval
  from public.subscriptions s join public.plans pl on pl.code = s.plan
  where s.place_id = p_place and (public.is_place_owner(p_place) or public.is_admin());
$$;

-- 11. Uploads: review photos are images and voice notes are audio, with size limits.
do $$ begin
  update storage.buckets set file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'review-photos';
  update storage.buckets set file_size_limit = 3145728, allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/wav'] where id = 'voice';
exception when undefined_column or undefined_table then null; end $$;
