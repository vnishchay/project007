-- Trusted Picks: free listing for every business, plans that switch reviews on, and per-QR review limits.
--  * Listing is free and never lapses. What a plan buys is review QRs.
--  * Every shop starts with a trial: 1 review QR for 30 days or 25 reviews.
--  * When a plan or trial ends, QRs still open the shop page; only new reviews pause.
--    Customers never see an expiry date.
--  * Each QR has a small "jar" of review tickets that refills over time, sized by business type,
--    so a whole table can review together but nobody can post twenty in a row.

-- ---------- Plans ----------
create table if not exists public.plans (
  code             text primary key,
  name             text not null,
  qr_limit         integer not null,
  price_inr_year   integer,
  price_inr_month  integer,
  price_usd_year   integer,
  price_usd_month  integer,
  features         text[] not null default '{}',
  sort_order       integer not null default 0
);
alter table public.plans enable row level security;
drop policy if exists "anyone reads plans" on public.plans;
create policy "anyone reads plans" on public.plans for select using (true);
grant select on public.plans to anon, authenticated;

insert into public.plans (code, name, qr_limit, price_inr_year, price_inr_month, price_usd_year, price_usd_month, features, sort_order) values
  ('trial',    'Free trial', 1,  0,    0,   0,   0,  '{"1 review QR","30 days or 25 reviews"}', 0),
  ('starter',  'Starter',    5,  1499, 149, 39,  4,  '{"5 review QRs","Styled QRs and print kit","Review links"}', 1),
  ('standard', 'Standard',   15, 2999, 299, 79,  8,  '{"15 review QRs","Everything in Starter","Insights"}', 2),
  ('pro',      'Pro',        40, 5999, 599, 149, 15, '{"40 review QRs","Everything in Standard","AI insights and offers"}', 3)
on conflict (code) do nothing;

-- ---------- Subscriptions: one per shop ----------
create table if not exists public.subscriptions (
  place_id                  uuid primary key references public.places (id) on delete cascade,
  plan                      text not null references public.plans (code),
  status                    text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  period_end                timestamptz not null,
  trial_reviews_left        integer not null default 25,
  billing_interval          text check (billing_interval in ('month', 'year')),
  provider                  text,
  provider_customer_id      text,
  provider_subscription_id  text,
  cancel_at_period_end      boolean not null default false,
  updated_at                timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "owners read their subscription" on public.subscriptions;
create policy "owners read their subscription" on public.subscriptions for select to authenticated
  using (public.is_place_owner(place_id) or public.is_admin());
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- Every shop gets a trial; shops that paid for a listing keep a Starter plan until their paid date.
insert into public.subscriptions (place_id, plan, status, period_end, trial_reviews_left)
select p.id,
       case when p.listed_until is not null and p.listed_until >= current_date then 'starter' else 'trial' end,
       case when p.listed_until is not null and p.listed_until >= current_date then 'active' else 'trial' end,
       case when p.listed_until is not null and p.listed_until >= current_date then p.listed_until::timestamptz else now() + interval '30 days' end,
       25
from public.places p
on conflict (place_id) do nothing;

create or replace function public.place_start_trial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (place_id, plan, status, period_end)
  values (new.id, 'trial', 'trial', now() + interval '30 days')
  on conflict (place_id) do nothing;
  return new;
end $$;
drop trigger if exists places_start_trial on public.places;
create trigger places_start_trial after insert on public.places
  for each row execute function public.place_start_trial();

-- Listing is free now: nothing lapses, and shops that lapsed come back.
update public.places set status = 'live' where status = 'lapsed';
create or replace function public.lapse_expired_listings()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  -- Ended trials and plans stop taking reviews; the shop page stays up.
  update public.subscriptions set status = 'expired', updated_at = now()
  where status in ('trial', 'active', 'past_due', 'cancelled') and period_end < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Are reviews open at this shop? ----------
create or replace function public.reviews_open(p_place uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when s.status = 'trial' then s.period_end > now() and s.trial_reviews_left > 0
      when s.status in ('active', 'past_due', 'cancelled') then s.period_end > now()
      else false end
    from public.subscriptions s where s.place_id = p_place), false);
$$;
grant execute on function public.reviews_open(uuid) to anon, authenticated;

-- A plan's QR limit.
create or replace function public.place_qr_limit(p_place uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select pl.qr_limit from public.subscriptions s join public.plans pl on pl.code = s.plan
                   where s.place_id = p_place and s.status <> 'expired'), 1);
$$;
grant execute on function public.place_qr_limit(uuid) to authenticated;

create or replace function public.check_qr_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim integer; n integer;
begin
  -- The SQL editor and server jobs (no signed-in user) and admins aren't limited.
  if auth.uid() is null or public.is_admin() or not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  lim := public.place_qr_limit(new.place_id);
  select count(*) into n from public.qr_codes where place_id = new.place_id and active and id <> new.id;
  if n >= lim then raise exception 'your plan includes % review QR%. Upgrade for more', lim, case when lim = 1 then '' else 's' end; end if;
  return new;
end $$;
drop trigger if exists qr_codes_limit on public.qr_codes;
create trigger qr_codes_limit before insert or update of active on public.qr_codes
  for each row execute function public.check_qr_limit();

-- ---------- Review ticket jars per QR ----------
alter table public.qr_codes add column if not exists seats integer check (seats is null or seats between 1 and 20);
alter table public.qr_codes add column if not exists jar_size integer check (jar_size is null or jar_size between 1 and 20);
alter table public.qr_codes add column if not exists refill_seconds integer check (refill_seconds is null or refill_seconds between 30 and 86400);
alter table public.qr_codes add column if not exists tickets double precision;
alter table public.qr_codes add column if not exists tickets_at timestamptz;

-- Jar size and refill time by business type: a table refills slowly, a counter quickly.
create or replace function public.qr_jar(p_qr uuid)
returns table (size integer, refill integer)
language sql stable security definer set search_path = public as $$
  select coalesce(q.jar_size, q.seats, case coalesce(p.kind, 'food')
           when 'food' then 4 when 'store' then 3 when 'beauty' then 1 when 'health' then 1 else 2 end),
         coalesce(q.refill_seconds, case coalesce(p.kind, 'food')
           when 'food' then 900 when 'store' then 120 when 'beauty' then 1500 when 'health' then 1500
           when 'fitness' then 3600 when 'education' then 3600 when 'services' then 3600 else 600 end)
  from public.qr_codes q join public.places p on p.id = q.place_id where q.id = p_qr;
$$;

-- Runs before a review is saved: reviews must be open here, and a QR visit takes one ticket from its jar.
-- Several items rated in one visit cost one ticket, so a person can rate their whole meal.
create or replace function public.check_review_allowed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.visits; j record; q public.qr_codes; t double precision; wait_min integer;
begin
  if new.visit_id is null or public.is_admin() then return new; end if;
  if not public.reviews_open(new.place_id) then
    raise exception 'reviews are paused at this shop for now';
  end if;
  select * into v from public.visits where id = new.visit_id;
  if v.qr_code_id is not null and not exists (select 1 from public.reviews where visit_id = new.visit_id) then
    select * into q from public.qr_codes where id = v.qr_code_id for update;
    select * into j from public.qr_jar(q.id);
    t := least(j.size, coalesce(q.tickets, j.size) + extract(epoch from now() - coalesce(q.tickets_at, now())) / j.refill);
    if t < 1 then
      wait_min := greatest(1, ceil((1 - t) * j.refill / 60.0));
      raise exception 'lots of reviews from this table just now. Try again in about % minute%', wait_min, case when wait_min = 1 then '' else 's' end;
    end if;
    update public.qr_codes set tickets = t - 1, tickets_at = now() where id = q.id;
  end if;
  update public.subscriptions set trial_reviews_left = greatest(trial_reviews_left - 1, 0), updated_at = now()
  where place_id = new.place_id and status = 'trial';
  return new;
end $$;
drop trigger if exists reviews_check_allowed on public.reviews;
create trigger reviews_check_allowed before insert on public.reviews
  for each row execute function public.check_review_allowed();

-- can_review also says when reviews are paused (no dates, no reasons shown to customers).
create or replace function public.can_review(p_place uuid, p_device text default null)
returns table (allowed boolean, reason text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v public.visits; v_device text;
begin
  if auth.uid() is null then return query select false, 'scan', null::timestamptz; return; end if;
  select * into v from public.visits
  where user_id = auth.uid() and place_id = p_place and now() between scanned_at and visits.expires_at
  order by scanned_at desc limit 1;
  if v.id is null then return query select false, 'scan', null::timestamptz; return; end if;
  if public.is_place_owner(p_place) then return query select false, 'owner', v.expires_at; return; end if;
  if not public.reviews_open(p_place) then return query select false, 'paused', v.expires_at; return; end if;
  if public.is_guest() then
    v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
    if exists (select 1 from public.reviews where place_id = p_place
               and (user_id = auth.uid() or (v_device is not null and device_hash = v_device and by_guest))) then
      return query select false, 'guest_used', v.expires_at; return;
    end if;
  end if;
  return query select true, 'ok', v.expires_at;
end $$;
grant execute on function public.can_review(uuid, text) to authenticated;

-- Owners see their plan, QR use and review status in one call.
create or replace function public.my_plan(p_place uuid)
returns table (plan text, plan_name text, status text, period_end timestamptz, trial_reviews_left integer,
               qr_limit integer, qr_used integer, reviews_open boolean, cancel_at_period_end boolean, billing_interval text)
language sql stable security definer set search_path = public as $$
  select s.plan, pl.name, s.status, s.period_end, s.trial_reviews_left, pl.qr_limit,
         (select count(*)::integer from public.qr_codes q where q.place_id = p_place and q.active),
         public.reviews_open(p_place), s.cancel_at_period_end, s.billing_interval
  from public.subscriptions s join public.plans pl on pl.code = s.plan
  where s.place_id = p_place and (public.is_place_owner(p_place) or public.is_admin());
$$;
grant execute on function public.my_plan(uuid) to authenticated;
