-- Trusted Picks: the shop's review link, the only way to review besides the table QR.
--
-- An owner creates a link for one customer (say after a delivery or appointment) and sends it
-- on WhatsApp. Each link works once, for one person, and expires in a few days; a shop can make
-- only a few a day. Opening it gives that person a visit, like scanning the table QR.
-- Link reviews count a little less than table scans, because the shop chooses who gets a link.
-- The shop never learns which review came from which link.

insert into public.app_settings (key, value) values
  ('review_links_per_day', '10'), ('review_link_days', '3')
on conflict (key) do nothing;

alter table public.visits add column if not exists source text not null default 'qr';
do $$ begin
  alter table public.visits add constraint visits_source_check check (source in ('qr', 'link'));
exception when duplicate_object then null; end $$;

create table if not exists public.review_links (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  token       text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  visit_id    uuid references public.visits (id) on delete set null
);
create index if not exists review_links_place_idx on public.review_links (place_id, created_at desc);
-- Only the functions below touch it: nobody can list links or see who used one.
alter table public.review_links enable row level security;
revoke all on public.review_links from anon, authenticated;

-- Owner (or admin): make a new single-use link.
create or replace function public.create_review_link(p_place uuid)
returns table (token text, expires_at timestamptz, left_today integer)
language plpgsql security definer set search_path = public, extensions as $$
declare v_cap integer := public.setting_int('review_links_per_day', 10); v_made integer; l public.review_links;
begin
  if not public.can_manage_place(p_place) then raise exception 'only the shop owner can make review links'; end if;
  if not exists (select 1 from public.places where id = p_place and status = 'live') then
    raise exception 'your shop isn''t live yet';
  end if;
  select count(*) into v_made from public.review_links r
  where r.place_id = p_place and r.created_at > now() - interval '1 day';
  if v_made >= v_cap and not public.is_admin() then
    raise exception 'you''ve made % review links today. Make more tomorrow', v_cap;
  end if;
  insert into public.review_links (place_id, expires_at)
  values (p_place, now() + make_interval(days => public.setting_int('review_link_days', 3)))
  returning * into l;
  return query select l.token, l.expires_at, greatest(v_cap - v_made - 1, 0);
end $$;
revoke execute on function public.create_review_link(uuid) from public, anon;
grant execute on function public.create_review_link(uuid) to authenticated;

-- Owner: how many links today, and how many were used (totals only, never which).
create or replace function public.review_link_counts(p_place uuid)
returns table (made_today integer, left_today integer, used_30d integer, made_30d integer)
language plpgsql stable security definer set search_path = public as $$
declare v_cap integer := public.setting_int('review_links_per_day', 10); v_today integer;
begin
  if not public.can_manage_place(p_place) then raise exception 'only the shop owner can see this'; end if;
  select count(*) into v_today from public.review_links where place_id = p_place and created_at > now() - interval '1 day';
  return query select v_today, greatest(v_cap - v_today, 0),
    (select count(*)::integer from public.review_links where place_id = p_place and used_at > now() - interval '30 days'),
    (select count(*)::integer from public.review_links where place_id = p_place and created_at > now() - interval '30 days');
end $$;
grant execute on function public.review_link_counts(uuid) to authenticated;

-- Anyone: which shop is this link for, and does it still work?
create or replace function public.peek_review_link(p_token text)
returns table (place_id uuid, place_name text, area text, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area,
         case when l.used_at is not null then 'used' when l.expires_at < now() then 'expired' else 'ok' end
  from public.review_links l join public.places p on p.id = l.place_id
  where l.token = p_token and p.status = 'live';
$$;
grant execute on function public.peek_review_link(text) to anon, authenticated;

-- The customer opens the link: it's used up and they get a visit. Opening it again
-- from the same account gives back the same visit.
create or replace function public.redeem_review_link(p_token text)
returns table (visit_id uuid, place_id uuid, place_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare l public.review_links; v public.visits; v_name text;
begin
  if auth.uid() is null then raise exception 'open the link again to continue'; end if;
  select * into l from public.review_links where token = p_token for update;
  if l.id is null then raise exception 'this review link doesn''t work'; end if;
  select name into v_name from public.places where id = l.place_id and status = 'live';
  if v_name is null then raise exception 'this shop isn''t listed right now'; end if;

  if l.used_at is not null then
    select * into v from public.visits where id = l.visit_id and user_id = auth.uid();
    if v.id is null then raise exception 'this review link was already used. Ask the shop for a new one'; end if;
    return query select v.id, l.place_id, v_name, v.expires_at; return;
  end if;
  if l.expires_at < now() then raise exception 'this review link has expired. Ask the shop for a new one'; end if;
  if public.is_place_owner(l.place_id) then raise exception 'you can''t review your own shop'; end if;

  insert into public.visits (user_id, place_id, source, expires_at)
  values (auth.uid(), l.place_id, 'link', now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
  returning * into v;
  update public.review_links set used_at = now(), visit_id = v.id where id = l.id;
  return query select v.id, l.place_id, v_name, v.expires_at;
end $$;
revoke execute on function public.redeem_review_link(text) from public, anon;
grant execute on function public.redeem_review_link(text) to authenticated;

-- Table QR: scanning again at the same shop reuses the open visit, and one account can't
-- collect visits at many shops in a day (a photo of a QR shared around stops working fast).
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

  select * into v from public.visits vv
  where vv.user_id = auth.uid() and vv.place_id = q.place_id and now() between vv.scanned_at and vv.expires_at
  order by vv.scanned_at desc limit 1;
  if v.id is null then
    if (select count(distinct vv.place_id) from public.visits vv
        where vv.user_id = auth.uid() and vv.scanned_at > now() - interval '1 day') >= 8 then
      raise exception 'that''s a lot of shops for one day. Try again tomorrow';
    end if;
    insert into public.visits (user_id, place_id, qr_code_id, expires_at)
    values (auth.uid(), q.place_id, q.id, now() + make_interval(hours => public.setting_int('visit_window_hours', 6)))
    returning * into v;
  end if;
  return query select v.id, q.place_id, q.name, q.area, q.table_label, v.expires_at;
end $$;

-- Ranking: a review from a shop's link counts 1.2x, a table scan 1.5x.
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
      * (case when vs.source = 'link' then 1.2 when m.visit_id is not null then 1.5 when m.by_guest then 0.5 else 1.0 end)
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
