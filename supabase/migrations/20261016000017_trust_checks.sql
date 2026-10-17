-- Trusted Picks: harder to fake, easier to spot.
-- 1. Location check on table scans: the app may send the phone's position with a scan. We keep only
--    whether it was near the shop (true/false/unknown), never the position itself. Far-away scans
--    still work but their reviews count much less, so a shared photo of a QR is nearly worthless.
-- 2. Every review says how it got here: from a table scan or from the shop's link.
-- 3. Anyone can report a review; admins see reports and patterns in one list.

alter table public.visits add column if not exists near boolean;

drop function if exists public.scan_qr(text);
create or replace function public.scan_qr(p_token text, p_lat double precision default null, p_lng double precision default null)
returns table (visit_id uuid, place_id uuid, place_name text, area text, table_label text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare q record; v public.visits; v_near boolean;
begin
  if auth.uid() is null then raise exception 'sign in to scan'; end if;
  select qc.id, qc.place_id, qc.table_label, p.name, p.area, p.location into q
  from public.qr_codes qc join public.places p on p.id = qc.place_id
  where qc.token = p_token and qc.active and p.status = 'live';
  if not found then raise exception 'unknown or inactive code'; end if;

  if q.location is not null and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_near := st_dwithin(q.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                         public.setting_int('scan_near_meters', 300));
  end if;

  select * into v from public.visits vv
  where vv.user_id = auth.uid() and vv.place_id = q.place_id and now() between vv.scanned_at and vv.expires_at
  order by vv.scanned_at desc limit 1;
  if v.id is null then
    if (select count(distinct vv.place_id) from public.visits vv
        where vv.user_id = auth.uid() and vv.scanned_at > now() - interval '1 day') >= 8 then
      raise exception 'that''s a lot of shops for one day. Try again tomorrow';
    end if;
    insert into public.visits (user_id, place_id, qr_code_id, near, expires_at)
    values (auth.uid(), q.place_id, q.id, v_near, now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
    returning * into v;
  elsif v_near is true and v.near is distinct from true then
    update public.visits set near = true where id = v.id returning * into v;  -- a later scan at the shop upgrades it
  end if;
  return query select v.id, q.place_id, q.name, q.area, q.table_label, v.expires_at;
end $$;
revoke execute on function public.scan_qr(text, double precision, double precision) from public, anon;
grant execute on function public.scan_qr(text, double precision, double precision) to authenticated;

-- How a review got here, for the review cards: 'table' or 'link'.
create or replace view public.review_feed with (security_barrier = true) as
  select r.id,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.user_id end as user_id,
         r.place_id, r.item_id, r.rating, r.body, r.ai_drafted,
         (r.visit_id is not null) as verified,
         r.photo_path,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then r.voice_path end as voice_path,
         r.status, r.is_public, r.created_at,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.display_name end as author_name,
         case when r.is_public or r.user_id = auth.uid() or public.is_admin() then p.avatar_path end as author_avatar,
         (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id) as source
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  where r.status = 'published' or r.user_id = auth.uid() or public.is_admin();
revoke all on public.review_feed from public, anon, authenticated;
grant select on public.review_feed to anon, authenticated;

-- Reports. Reporters stay private; only admins read them.
create table if not exists public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews (id) on delete cascade,
  reporter    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason      text not null check (reason in ('fake', 'offensive', 'wrong_place', 'personal_info', 'other')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (review_id, reporter)
);
alter table public.review_reports enable row level security;
revoke all on public.review_reports from anon, authenticated;
grant select, update on public.review_reports to authenticated;
drop policy if exists "admins read reports" on public.review_reports;
create policy "admins read reports" on public.review_reports for select to authenticated using (public.is_admin());
drop policy if exists "admins resolve reports" on public.review_reports;
create policy "admins resolve reports" on public.review_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.report_review(p_review uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'open the page again to report'; end if;
  if p_reason not in ('fake', 'offensive', 'wrong_place', 'personal_info', 'other') then raise exception 'pick a reason'; end if;
  if not exists (select 1 from public.reviews where id = p_review and status = 'published') then raise exception 'review not found'; end if;
  if (select count(*) from public.review_reports where reporter = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'that''s a lot of reports for one day. Try again tomorrow';
  end if;
  insert into public.review_reports (review_id, reason) values (p_review, p_reason)
  on conflict (review_id, reporter) do update set reason = excluded.reason, created_at = now(), resolved_at = null;
end $$;
revoke execute on function public.report_review(uuid, text) from public, anon;
grant execute on function public.report_review(uuid, text) to authenticated;

-- Admin: things worth a look, newest patterns first. Counts and reviews only, never who.
create or replace function public.admin_alerts()
returns table (kind text, place_id uuid, place_name text, review_id uuid, detail text, n integer, seen_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
  -- Reported reviews still open.
  select 'reported'::text, r.place_id, p.name, r.id,
         string_agg(distinct rr.reason, ', ') || ': ' || left(coalesce(nullif(r.body, ''), '(no text)'), 80),
         count(*)::integer, max(rr.created_at)
  from public.review_reports rr join public.reviews r on r.id = rr.review_id join public.places p on p.id = r.place_id
  where rr.resolved_at is null and r.status = 'published'
  group by r.id, r.place_id, p.name, r.body
  union all
  -- A burst of glowing reviews in a day.
  select 'burst', p.id, p.name, null::uuid,
         count(*) || ' reviews in 24 hours, average ' || round(avg(r.rating), 1),
         count(*)::integer, max(r.created_at)
  from public.reviews r join public.places p on p.id = r.place_id
  where r.created_at > now() - interval '1 day' and r.status = 'published'
  group by p.id, p.name having count(*) >= 8 and avg(r.rating) >= 4.5
  union all
  -- Reviews from scans that were far from the shop.
  select 'far_scans', p.id, p.name, null::uuid,
         count(*) || ' reviews this week from scans far from the shop',
         count(*)::integer, max(r.created_at)
  from public.reviews r join public.visits v on v.id = r.visit_id join public.places p on p.id = r.place_id
  where v.near is false and r.created_at > now() - interval '7 days' and r.status = 'published'
  group by p.id, p.name having count(*) >= 3
  union all
  -- Shop-link reviews much rosier than table reviews.
  select 'link_skew', s.place_id, p.name, null::uuid,
         'link reviews ' || round(s.link_avg, 1) || ' vs table ' || round(s.table_avg, 1),
         s.link_n, now()
  from (select r.place_id,
               avg(r.rating) filter (where v.source = 'link') as link_avg, avg(r.rating) filter (where v.source = 'qr') as table_avg,
               (count(*) filter (where v.source = 'link'))::integer as link_n, (count(*) filter (where v.source = 'qr'))::integer as table_n
        from public.reviews r join public.visits v on v.id = r.visit_id
        where r.created_at > now() - interval '30 days' and r.status = 'published'
        group by r.place_id) s
  join public.places p on p.id = s.place_id
  where s.link_n >= 3 and s.table_n >= 3 and s.link_avg - s.table_avg >= 1.5
  union all
  -- One phone writing a lot of guest reviews.
  select 'busy_device', null::uuid, null::text, null::uuid,
         count(*) || ' guest reviews from one phone across ' || count(distinct r.place_id) || ' shops in 24 hours',
         count(*)::integer, max(r.created_at)
  from public.reviews r
  where r.device_hash is not null and r.created_at > now() - interval '1 day'
  group by r.device_hash having count(*) >= 5
  order by 7 desc nulls last;
end $$;
grant execute on function public.admin_alerts() to authenticated;

-- Ranking: table scan at the shop 1.5x, shop link 1.2x, scan with location unknown 1.0x, scan far from the shop 0.4x.
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
      * (case when vs.source = 'link' then 1.2 when vs.near is false then 0.4 when vs.near is null and m.visit_id is not null then 1.0 when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
      * power(0.5, extract(epoch from (now() - m.created_at)) / 86400.0 / 180.0) as w,
      fr.is_friend
    from matched m
    cross join me
    left join public.visits vs on vs.id = m.visit_id
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
