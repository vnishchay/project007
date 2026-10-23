-- Trusted Picks: offers that feel like treats (2026-10-23).
--   * Shop deals: offers for everyone, shown as tickets on the shop page (% off, flat off, free item,
--     2 for 1, happy hour) on the days, hours and dates the owner picks. A diner shows one at the
--     counter and the staff press and hold to use it.
--   * Stamp cards: "N visits, then <reward>". Each day a diner scans a table code at the shop adds a
--     stamp by itself. Stamps count visits only, never reviews.
--   * Personal offers open gift-wrapped until the diner unwraps them (seen_at), and last 30 days.
--   * Your pocket: every offer, deal and stamp card a diner has, in one place.
-- Nothing here mentions reviews: deals and rewards can't use review wording, as with offers.

-- ---------- The shop's own clock ----------
-- Deals run on the shop's local days and hours. India until owners can pick another time zone.
alter table public.places add column if not exists time_zone text not null default 'Asia/Kolkata';

create or replace function public.check_place_time_zone()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.time_zone) then
    raise exception 'unknown time zone %', new.time_zone;
  end if;
  return new;
end $$;
drop trigger if exists places_time_zone_check on public.places;
create trigger places_time_zone_check before insert or update of time_zone on public.places
  for each row execute function public.check_place_time_zone();

create or replace function public.place_local_now(p_place uuid)
returns timestamp language sql stable security definer set search_path = public as $$
  select now() at time zone coalesce((select p.time_zone from public.places p where p.id = p_place), 'Asia/Kolkata');
$$;

-- ---------- Shop deals ----------
create table if not exists public.shop_deals (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  kind        text not null check (kind in ('percent', 'flat', 'free', 'bogo', 'happy_hour', 'other')),
  amount      numeric(10, 2) check (amount is null or amount > 0),
  title       text not null check (length(btrim(title)) between 1 and 60),
  terms       text check (terms is null or length(terms) <= 200),
  days        smallint[] check (days is null or (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(days) between 1 and 7)),
  starts_at   time,
  ends_at     time,
  valid_from  date not null default current_date,
  valid_until date,
  per_person  text not null default 'daily' check (per_person in ('daily', 'once')),
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind <> 'percent' or amount between 1 and 90),
  check (kind <> 'flat' or amount is not null),
  check ((starts_at is null) = (ends_at is null) and (starts_at is null or starts_at <> ends_at)),
  check (valid_until is null or valid_until >= valid_from)
);
create index if not exists shop_deals_place_idx on public.shop_deals (place_id) where active;
alter table public.shop_deals enable row level security;
revoke all on public.shop_deals from anon, authenticated;

create table if not exists public.deal_uses (
  id        uuid primary key default gen_random_uuid(),
  deal_id   uuid not null references public.shop_deals (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  local_day date not null,
  used_at   timestamptz not null default now(),
  unique (deal_id, user_id, local_day)
);
create index if not exists deal_uses_user_idx on public.deal_uses (user_id, used_at desc);
alter table public.deal_uses enable row level security;
revoke all on public.deal_uses from anon, authenticated;

-- Is the deal on at this local time? Hours may run past midnight (10 pm to 2 am).
create or replace function public.deal_on_at(d public.shop_deals, t timestamp)
returns boolean language sql immutable as $$
  select d.active
     and t::date >= d.valid_from and (d.valid_until is null or t::date <= d.valid_until)
     and (d.days is null or extract(dow from t)::smallint = any(d.days))
     and (d.starts_at is null
          or (d.starts_at < d.ends_at and t::time >= d.starts_at and t::time < d.ends_at)
          or (d.starts_at > d.ends_at and (t::time >= d.starts_at or t::time < d.ends_at)));
$$;

-- One deal as the app shows it, with whether it's on now, when today's hours end, and whether I used it.
create or replace function public.deal_json(d public.shop_deals, t timestamp, tz text, p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', d.id, 'place_id', d.place_id, 'kind', d.kind, 'amount', d.amount, 'title', d.title, 'terms', d.terms,
    'days', d.days, 'starts_at', to_char(d.starts_at, 'HH24:MI'), 'ends_at', to_char(d.ends_at, 'HH24:MI'),
    'valid_until', d.valid_until, 'per_person', d.per_person,
    'on_now', public.deal_on_at(d, t),
    'ends_ts', case when d.ends_at is not null and public.deal_on_at(d, t)
                    then ((t::date + d.ends_at) + case when d.ends_at <= t::time then interval '1 day' else interval '0' end) at time zone tz end,
    'used_at', (select max(u.used_at) from public.deal_uses u where u.deal_id = d.id and u.user_id = p_user
                  and (d.per_person = 'once' or u.local_day = t::date)));
$$;
revoke execute on function public.deal_json(public.shop_deals, timestamp, text, uuid) from public, anon, authenticated;

-- ---------- Stamp cards ----------
create table if not exists public.stamp_cards (
  place_id   uuid primary key references public.places (id) on delete cascade,
  goal       smallint not null check (goal between 3 and 12),
  reward     text not null check (length(btrim(reward)) between 1 and 60),
  active     boolean not null default true,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.stamp_cards enable row level security;
revoke all on public.stamp_cards from anon, authenticated;

create table if not exists public.stamp_rewards (
  id       uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  used_at  timestamptz not null default now()
);
create index if not exists stamp_rewards_user_idx on public.stamp_rewards (user_id, place_id, used_at desc);
alter table public.stamp_rewards enable row level security;
revoke all on public.stamp_rewards from anon, authenticated;

-- A diner's stamps at a shop: one per local day they scanned a table code there (not scans known to be
-- far from the shop, not review links), since the card started, minus the ones spent on rewards.
create or replace function public.stamp_json(p_place uuid, p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (
    select sc.*, coalesce(p.time_zone, 'Asia/Kolkata') as tz from public.stamp_cards sc join public.places p on p.id = sc.place_id
    where sc.place_id = p_place and sc.active),
  d as (
    select distinct (v.scanned_at at time zone c.tz)::date as day
    from c join public.visits v on v.place_id = c.place_id and v.user_id = p_user
    where p_user is not null and v.scanned_at >= c.started_at and v.source = 'qr' and v.near is distinct from false),
  r as (select count(*)::integer as n from c join public.stamp_rewards sr on sr.place_id = c.place_id and sr.user_id = p_user and sr.used_at >= c.started_at)
  select jsonb_build_object(
    'place_id', c.place_id, 'goal', c.goal, 'reward', c.reward,
    'stamps', greatest((select count(*) from d)::integer - c.goal * (select n from r), 0),
    'days', coalesce((select jsonb_agg(day order by day desc) from (select day from d order by day desc limit 12) x), '[]'::jsonb),
    'today', exists (select 1 from d where d.day = (now() at time zone c.tz)::date),
    'used', (select n from r))
  from c;
$$;
revoke execute on function public.stamp_json(uuid, uuid) from public, anon, authenticated;

-- ---------- What a shop page shows ----------
-- Deals for everyone; the stamp card (with my stamps); and my personal offers here (unless I turned this shop off).
create or replace function public.place_treats(p_place uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text; t timestamp; me uuid := auth.uid(); off boolean;
begin
  select coalesce(p.time_zone, 'Asia/Kolkata') into tz from public.places p where p.id = p_place and p.status = 'live';
  if tz is null then return jsonb_build_object('deals', '[]'::jsonb, 'offers', '[]'::jsonb, 'stamps', null); end if;
  t := now() at time zone tz;
  select coalesce(sp.hidden or sp.no_offers, false) into off from public.shop_privacy sp where sp.user_id = me and sp.place_id = p_place;
  return jsonb_build_object(
    'deals', coalesce((
      select jsonb_agg(public.deal_json(d, t, tz, me) order by public.deal_on_at(d, t) desc, d.created_at desc)
      from public.shop_deals d
      where d.place_id = p_place and d.active and (d.valid_until is null or d.valid_until >= t::date) and d.valid_from <= t::date + 7), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'body', o.body, 'link_url', o.link_url, 'created_at', o.created_at,
                                          'valid_till', o.created_at + interval '30 days', 'seen', o.seen_at is not null, 'used_at', o.used_at)
                       order by o.used_at is not null, o.created_at desc)
      from (select * from public.visitor_offers o2 where me is not null and not coalesce(off, false) and o2.user_id = me and o2.place_id = p_place
              and o2.created_at > now() - interval '30 days' order by o2.created_at desc limit 10) o), '[]'::jsonb),
    'stamps', public.stamp_json(p_place, me));
end $$;
revoke execute on function public.place_treats(uuid) from public;
grant execute on function public.place_treats(uuid) to anon, authenticated;

-- ---------- Using a deal or a stamp reward at the counter ----------
create or replace function public.use_deal(p_deal uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare d public.shop_deals; tz text; t timestamp; u timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into d from public.shop_deals where id = p_deal;
  if not found then raise exception 'deal not found'; end if;
  select coalesce(time_zone, 'Asia/Kolkata') into tz from public.places where id = d.place_id;
  t := now() at time zone tz;
  select used_at into u from public.deal_uses
   where deal_id = d.id and user_id = auth.uid() and (d.per_person = 'once' or local_day = t::date) limit 1;
  if u is not null then return u; end if;
  if not public.deal_on_at(d, t) then raise exception 'this deal isn''t on right now'; end if;
  insert into public.deal_uses (deal_id, user_id, local_day) values (d.id, auth.uid(), t::date)
  on conflict (deal_id, user_id, local_day) do nothing
  returning used_at into u;
  return coalesce(u, now());
end $$;
revoke execute on function public.use_deal(uuid) from public, anon;
grant execute on function public.use_deal(uuid) to authenticated;

create or replace function public.use_stamp_reward(p_place uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare s jsonb; u timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || p_place::text));
  s := public.stamp_json(p_place, auth.uid());
  if s is null then raise exception 'this shop has no stamp card'; end if;
  if (s->>'stamps')::integer < (s->>'goal')::integer then raise exception 'not enough stamps yet'; end if;
  insert into public.stamp_rewards (place_id, user_id) values (p_place, auth.uid()) returning used_at into u;
  return u;
end $$;
revoke execute on function public.use_stamp_reward(uuid) from public, anon;
grant execute on function public.use_stamp_reward(uuid) to authenticated;

-- ---------- Your pocket ----------
-- My offers, deals from shops I visited in 90 days or saved, my stamp cards, and what I used lately.
create or replace function public.my_pocket()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  return jsonb_build_object(
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'place_id', o.place_id, 'place_name', p.name, 'logo_path', p.logo_path,
                                          'body', o.body, 'link_url', o.link_url, 'created_at', o.created_at,
                                          'valid_till', o.created_at + interval '30 days', 'seen', o.seen_at is not null, 'used_at', null)
                       order by o.created_at desc)
      from public.visitor_offers o join public.places p on p.id = o.place_id and p.status = 'live'
      where o.user_id = me and o.used_at is null and o.created_at > now() - interval '30 days'
        and not exists (select 1 from public.shop_privacy sp where sp.user_id = me and sp.place_id = o.place_id and (sp.hidden or sp.no_offers))), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(x.j || jsonb_build_object('place_name', x.name, 'logo_path', x.logo_path) order by (x.j->>'on_now')::boolean desc, x.name)
      from (
        select public.deal_json(d, now() at time zone coalesce(p.time_zone, 'Asia/Kolkata'), coalesce(p.time_zone, 'Asia/Kolkata'), me) as j, p.name, p.logo_path
        from public.shop_deals d join public.places p on p.id = d.place_id and p.status = 'live'
        where d.active and (d.valid_until is null or d.valid_until >= (now() at time zone coalesce(p.time_zone, 'Asia/Kolkata'))::date)
          and (exists (select 1 from public.visits v where v.user_id = me and v.place_id = d.place_id and v.scanned_at > now() - interval '90 days')
               or exists (select 1 from public.saved_places s where s.user_id = me and s.place_id = d.place_id))
          and not exists (select 1 from public.shop_privacy sp where sp.user_id = me and sp.place_id = d.place_id and (sp.hidden or sp.no_offers))
        limit 40) x), '[]'::jsonb),
    'stamps', coalesce((
      select jsonb_agg(s.j || jsonb_build_object('place_name', s.name, 'logo_path', s.logo_path) order by (s.j->>'stamps')::integer desc)
      from (
        select public.stamp_json(sc.place_id, me) as j, p.name, p.logo_path
        from public.stamp_cards sc join public.places p on p.id = sc.place_id and p.status = 'live'
        where sc.active and exists (select 1 from public.visits v where v.user_id = me and v.place_id = sc.place_id and v.scanned_at >= sc.started_at)
      ) s where s.j is not null), '[]'::jsonb),
    'used', coalesce((
      select jsonb_agg(z.u order by z.u->>'used_at' desc) from (select all_used.u from (
        (select jsonb_build_object('kind', 'offer', 'place_id', o.place_id, 'place_name', p.name, 'title', o.body, 'used_at', o.used_at) as u
         from public.visitor_offers o join public.places p on p.id = o.place_id
         where o.user_id = me and o.used_at is not null order by o.used_at desc limit 20)
        union all
        (select jsonb_build_object('kind', 'deal', 'place_id', d.place_id, 'place_name', p.name, 'title', d.title, 'deal_kind', d.kind,
                                   'amount', d.amount, 'used_at', du.used_at)
         from public.deal_uses du join public.shop_deals d on d.id = du.deal_id join public.places p on p.id = d.place_id
         where du.user_id = me order by du.used_at desc limit 20)
        union all
        (select jsonb_build_object('kind', 'stamps', 'place_id', sr.place_id, 'place_name', p.name, 'title', coalesce(sc.reward, 'Stamp card reward'), 'used_at', sr.used_at)
         from public.stamp_rewards sr join public.places p on p.id = sr.place_id left join public.stamp_cards sc on sc.place_id = sr.place_id
         where sr.user_id = me order by sr.used_at desc limit 20)
      ) all_used order by all_used.u->>'used_at' desc limit 30) z), '[]'::jsonb));
end $$;
revoke execute on function public.my_pocket() from public, anon;
grant execute on function public.my_pocket() to authenticated;

-- ---------- For the owner ----------
create or replace function public.shop_deals_list(p_place uuid)
returns table (id uuid, kind text, amount numeric, title text, terms text, days smallint[], starts_at text, ends_at text,
               valid_from date, valid_until date, per_person text, active boolean, created_at timestamptz,
               uses_7d integer, uses_total integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  select d.id, d.kind, d.amount, d.title, d.terms, d.days, to_char(d.starts_at, 'HH24:MI'), to_char(d.ends_at, 'HH24:MI'),
         d.valid_from, d.valid_until, d.per_person, d.active, d.created_at,
         (select count(*)::integer from public.deal_uses u where u.deal_id = d.id and u.used_at > now() - interval '7 days'),
         (select count(*)::integer from public.deal_uses u where u.deal_id = d.id)
  from public.shop_deals d where d.place_id = p_place
  order by d.active desc, d.created_at desc;
end $$;
revoke execute on function public.shop_deals_list(uuid) from public, anon;
grant execute on function public.shop_deals_list(uuid) to authenticated;

-- Add (p_id null) or change a deal. At most 6 deals on at once; no review wording.
create or replace function public.save_shop_deal(
  p_place uuid, p_kind text, p_title text, p_id uuid default null, p_amount numeric default null, p_terms text default null,
  p_days smallint[] default null, p_starts text default null, p_ends text default null,
  p_valid_until date default null, p_per_person text default 'daily', p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_from date;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change deals'; end if;
  if concat_ws(' ', p_title, p_terms) ~* '\m(reviews?|ratings?|rate us)\M' then
    raise exception 'deals can''t mention reviews or ratings. Google bans rewards for reviews';
  end if;
  if p_active and (select count(*) from public.shop_deals d where d.place_id = p_place and d.active and d.id is distinct from p_id
                     and (d.valid_until is null or d.valid_until >= current_date)) >= 6 then
    raise exception 'you can have 6 deals on at once. Turn one off first';
  end if;
  v_from := (now() at time zone coalesce((select time_zone from public.places where id = p_place), 'Asia/Kolkata'))::date;
  if p_id is null then
    insert into public.shop_deals (place_id, kind, amount, title, terms, days, starts_at, ends_at, valid_from, valid_until, per_person, active, created_by)
    values (p_place, p_kind, case when p_kind in ('percent', 'flat') then p_amount end, btrim(p_title), nullif(btrim(coalesce(p_terms, '')), ''),
            case when cardinality(p_days) between 1 and 6 then p_days end, nullif(p_starts, '')::time, nullif(p_ends, '')::time,
            v_from, p_valid_until, coalesce(p_per_person, 'daily'), coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update public.shop_deals d set kind = p_kind, amount = case when p_kind in ('percent', 'flat') then p_amount end,
           title = btrim(p_title), terms = nullif(btrim(coalesce(p_terms, '')), ''),
           days = case when cardinality(p_days) between 1 and 6 then p_days end,
           starts_at = nullif(p_starts, '')::time, ends_at = nullif(p_ends, '')::time,
           valid_until = p_valid_until, valid_from = least(d.valid_from, coalesce(p_valid_until, d.valid_from)),
           per_person = coalesce(p_per_person, 'daily'), active = coalesce(p_active, true), updated_at = now()
     where d.id = p_id and d.place_id = p_place
    returning d.id into v_id;
    if v_id is null then raise exception 'deal not found'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.save_shop_deal(uuid, text, text, uuid, numeric, text, smallint[], text, text, date, text, boolean) from public, anon;
grant execute on function public.save_shop_deal(uuid, text, text, uuid, numeric, text, smallint[], text, text, date, text, boolean) to authenticated;

create or replace function public.delete_shop_deal(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_place uuid;
begin
  select place_id into v_place from public.shop_deals where id = p_id;
  if v_place is null then return; end if;
  if not (public.is_admin() or public.is_place_owner(v_place)) then raise exception 'only the shop owner can change deals'; end if;
  delete from public.shop_deals where id = p_id;
end $$;
revoke execute on function public.delete_shop_deal(uuid) from public, anon;
grant execute on function public.delete_shop_deal(uuid) to authenticated;

-- The stamp card and how it's going: people collecting, and rewards given.
create or replace function public.shop_stamp_card(p_place uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return (select jsonb_build_object('goal', sc.goal, 'reward', sc.reward, 'active', sc.active, 'started_at', sc.started_at,
           'collectors', (select count(distinct v.user_id) from public.visits v where v.place_id = sc.place_id and v.scanned_at >= sc.started_at and v.source = 'qr'),
           'rewards_used', (select count(*) from public.stamp_rewards sr where sr.place_id = sc.place_id and sr.used_at >= sc.started_at))
          from public.stamp_cards sc where sc.place_id = p_place);
end $$;
revoke execute on function public.shop_stamp_card(uuid) from public, anon;
grant execute on function public.shop_stamp_card(uuid) to authenticated;

create or replace function public.save_stamp_card(p_place uuid, p_goal integer, p_reward text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change the stamp card'; end if;
  if p_reward ~* '\m(reviews?|ratings?|rate us)\M' then
    raise exception 'rewards can''t mention reviews or ratings. Google bans rewards for reviews';
  end if;
  insert into public.stamp_cards as sc (place_id, goal, reward, active)
  values (p_place, p_goal, btrim(p_reward), coalesce(p_active, true))
  on conflict (place_id) do update
    set goal = excluded.goal, reward = excluded.reward, active = excluded.active, updated_at = now(),
        -- Turning a card back on starts it fresh; changing it while on keeps everyone's stamps.
        started_at = case when not sc.active and excluded.active then now() else sc.started_at end;
  return public.shop_stamp_card(p_place);
end $$;
revoke execute on function public.save_stamp_card(uuid, integer, text, boolean) from public, anon;
grant execute on function public.save_stamp_card(uuid, integer, text, boolean) to authenticated;
