-- Trusted Picks: owner and admin fixes from the review of 2026-10-18 (part 2).
-- Shops: a removed shop's owner can still open it, read the team's note and ask for another check.
-- Admin: the old "Renew" tool is gone and "collected" counts real payments only; payments that need a
-- person's look are listed. Insights count what they say. Uploads have type and size limits.
-- Speed and cost: profile reviews by user id, no unused nightly table, an overall daily AI ceiling.
-- Safe to run more than once.
set search_path = public, extensions;

-- 1. Removed shops aren't a dead end.
--    Owners can read their own shop whatever its status (everyone else still only sees live shops).
drop policy if exists "owners read own place" on public.places;
create policy "owners read own place" on public.places for select to authenticated
  using (owner_id = auth.uid());

-- Owners' "check again" requests, at most one a day per shop. Nobody reads this table directly.
create table if not exists public.place_rechecks (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists place_rechecks_place_idx on public.place_rechecks (place_id, created_at desc);
alter table public.place_rechecks enable row level security;
revoke all on public.place_rechecks from anon, authenticated;

-- The verification guard (from migration 30), now letting request_recheck put the shop back in the queue.
create or replace function public.guard_place_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and coalesce(current_setting('app.verification_write', true), '') <> '1' then
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

-- The team's check: verified puts the links on the page and brings a removed shop back; rejected takes it down.
create or replace function public.verify_place(p_place uuid, p_ok boolean, p_note text default null,
  p_lat double precision default null, p_lng double precision default null)
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.places set
    verification = case when p_ok then 'verified' else 'rejected' end,
    verification_note = nullif(trim(coalesce(p_note, '')), ''),
    status = case when not p_ok then 'removed'::public.place_status
                  when status = 'removed' then 'live'::public.place_status
                  else status end,
    location = case when p_lat is not null and p_lng is not null
                    then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography else location end
  where id = p_place
  returning * into pl;
  if pl.id is null then raise exception 'shop not found'; end if;
  return pl;
end $$;
revoke all on function public.verify_place(uuid, boolean, text, double precision, double precision) from public, anon;
grant execute on function public.verify_place(uuid, boolean, text, double precision, double precision) to authenticated;

-- Where the team's check stands, for the owner's Manage page. The note is the team's (or, while it is being
-- checked again, the owner's own message to the team).
create or replace function public.my_place_check(p_place uuid)
returns table (status public.place_status, verification text, note text, next_recheck_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.status, p.verification,
         case when p.verification in ('rejected', 'pending') or p.status = 'removed' then p.verification_note end,
         (select max(r.created_at) + interval '1 day' from public.place_rechecks r where r.place_id = p.id)
  from public.places p
  where p.id = p_place and auth.uid() is not null and (p.owner_id = auth.uid() or public.is_admin());
$$;
revoke all on function public.my_place_check(uuid) from public, anon;
grant execute on function public.my_place_check(uuid) to authenticated;

-- "I've fixed it, check again": a removed or rejected shop goes back in the team's queue, once a day.
-- It stays off the public app until the team verifies it.
create or replace function public.request_recheck(p_place uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare pl public.places; last_at timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into pl from public.places where id = p_place for update;
  if pl.id is null or pl.owner_id is distinct from auth.uid() then raise exception 'only the shop owner can ask for this'; end if;
  if pl.verification = 'pending' then raise exception 'your shop is already waiting for the team''s check'; end if;
  if not (pl.status = 'removed' or pl.verification = 'rejected') then raise exception 'your shop is already listed'; end if;
  select max(created_at) into last_at from public.place_rechecks where place_id = p_place;
  if last_at is not null and last_at > now() - interval '1 day' then
    raise exception 'you can ask once a day. Try again after %',
      to_char((last_at + interval '1 day') at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM');
  end if;
  insert into public.place_rechecks (place_id, requested_by, note)
  values (p_place, auth.uid(), nullif(left(btrim(coalesce(p_note, '')), 1000), ''));
  perform set_config('app.verification_write', '1', true);
  update public.places
    set verification = 'pending',
        verification_note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''), verification_note)
    where id = p_place;
  perform set_config('app.verification_write', '', true);
  return 'pending';
end $$;
revoke all on function public.request_recheck(uuid, text) from public, anon;
grant execute on function public.request_recheck(uuid, text) to authenticated;

-- 2. The old Renew tool recorded a made-up ₹199 and didn't touch the plan: it's gone.
drop function if exists public.renew_listing(uuid, text);

-- Payments the team records by hand (admin_set_plan) are marked 'admin', so they can be told apart from
-- the old Renew rows (provider 'manual') and the copies of Razorpay orders (provider 'razorpay').
create or replace function public.admin_set_plan(p_place uuid, p_plan text, p_months integer, p_amount_inr integer default 0, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'unknown plan'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'choose 1 to 36 months'; end if;
  perform public.apply_plan(p_place, p_plan, null, p_months);
  if coalesce(p_amount_inr, 0) > 0 then
    insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
    values (p_place, 'listing', p_amount_inr, 'admin', nullif(btrim(coalesce(p_ref, '')), ''), current_date,
            current_date + make_interval(months => p_months));
  end if;
end $$;
revoke all on function public.admin_set_plan(uuid, text, integer, integer, text) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, integer, integer, text) to authenticated;

-- Collected = Razorpay orders that are paid (a refunded order is no longer 'paid') plus money the team
-- recorded by hand. "To review" includes removed shops that asked to be checked again.
create or replace function public.admin_summary()
returns table (to_review integer, live_places integer, collected_inr integer)
language sql stable security definer set search_path = public as $$
  select
    ((select count(*) from public.places where verification = 'pending')
     + (select count(*) from public.place_claims where status = 'pending'))::integer,
    (select count(*) from public.places where status = 'live')::integer,
    ((select coalesce(sum(amount_minor), 0) from public.billing_orders where status = 'paid') / 100
     + (select coalesce(sum(amount_inr), 0) from public.payments where status = 'paid' and provider = 'admin'))::integer
  where public.is_admin();
$$;
revoke all on function public.admin_summary() from public, anon;
grant execute on function public.admin_summary() to authenticated;

-- 3. Insights: "visits with a review" counts visits, table scans and review-link visits are counted apart.
drop function if exists public.shop_stats(uuid);
create function public.shop_stats(p_place uuid)
returns table (reviews integer, avg_rating numeric, reviews_30d integer, verified integer,
               google_handoffs integer, google_handoffs_30d integer, scans_30d integer, saves integer, items_rated integer,
               link_visits_30d integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query select
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.created_at > now() - interval '30 days'),
    -- Visits (a table scan or a review link) that led to at least one published review.
    (select count(distinct r.visit_id)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.visit_id is not null),
    -- Reviews whose writer opened Google to post them there (we can't see whether they did post).
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place),
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place and g.opened_at > now() - interval '30 days'),
    (select count(*)::integer from public.visits v where v.place_id = p_place and v.source = 'qr' and v.scanned_at > now() - interval '30 days'),
    (select count(*)::integer from public.saved_places s where s.place_id = p_place),
    (select count(distinct r.item_id)::integer from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select count(*)::integer from public.visits v where v.place_id = p_place and v.source = 'link' and v.scanned_at > now() - interval '30 days');
end $$;
revoke all on function public.shop_stats(uuid) from public, anon;
grant execute on function public.shop_stats(uuid) to authenticated;

-- 4. Payments that need a person's look: a second payment for an order that was already paid, the wrong
--    amount, money for a closed or unknown order. Nothing is refunded automatically.
create table if not exists public.billing_alerts (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('second_payment', 'amount_mismatch', 'closed_order', 'unknown_order', 'no_shop')),
  order_id            uuid references public.billing_orders (id) on delete set null,
  place_id            uuid references public.places (id) on delete set null,
  provider_order_id   text,
  provider_payment_id text,
  amount_minor        integer,
  expected_minor      integer,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);
create unique index if not exists billing_alerts_once on public.billing_alerts (kind, provider_order_id, provider_payment_id) nulls not distinct;
create index if not exists billing_alerts_open on public.billing_alerts (created_at desc) where resolved_at is null;
alter table public.billing_alerts enable row level security;
revoke all on public.billing_alerts from anon, authenticated;
grant select on public.billing_alerts to authenticated;
grant update (resolved_at) on public.billing_alerts to authenticated;
drop policy if exists "admins read billing alerts" on public.billing_alerts;
create policy "admins read billing alerts" on public.billing_alerts for select to authenticated using (public.is_admin());
drop policy if exists "admins resolve billing alerts" on public.billing_alerts;
create policy "admins resolve billing alerts" on public.billing_alerts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.billing_alert(p_kind text, o public.billing_orders, p_order text, p_payment text, p_amount integer)
returns void language sql security definer set search_path = public as $$
  insert into public.billing_alerts (kind, order_id, place_id, provider_order_id, provider_payment_id, amount_minor, expected_minor)
  values (p_kind, o.id, o.place_id, p_order, p_payment, p_amount, o.amount_minor)
  on conflict (kind, provider_order_id, provider_payment_id) do nothing;
$$;
revoke all on function public.billing_alert(text, public.billing_orders, text, text, integer) from public, anon, authenticated;

create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.billing_orders; rupees integer;
begin
  select * into o from public.billing_orders where provider_order_id = p_order for update;
  if o.id is null then
    perform public.billing_alert('unknown_order', o, p_order, p_payment, p_amount);
    return false;
  end if;
  if o.status = 'paid' then
    if o.provider_payment_id is distinct from p_payment then
      perform public.billing_alert('second_payment', o, p_order, p_payment, p_amount);
    end if;
    return true;
  end if;
  if o.status <> 'created' then
    -- (A retry of the payment already flagged as the wrong amount isn't flagged again.)
    if not (o.status = 'failed' and o.provider_payment_id is not distinct from p_payment) then
      perform public.billing_alert('closed_order', o, p_order, p_payment, p_amount);
    end if;
    return false;
  end if;
  if p_amount is not null and p_amount <> o.amount_minor then
    update public.billing_orders set status = 'failed', provider_payment_id = p_payment where id = o.id;
    perform public.billing_alert('amount_mismatch', o, p_order, p_payment, p_amount);
    return false;
  end if;
  if o.place_id is null then
    perform public.billing_alert('no_shop', o, p_order, p_payment, p_amount);
    return false;
  end if;
  update public.billing_orders set status = 'paid', provider_payment_id = p_payment, paid_at = now() where id = o.id;
  rupees := o.amount_minor / 100;
  perform public.apply_plan(o.place_id, o.plan, o.billing_interval);
  insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (o.place_id, 'listing', rupees, 'razorpay', p_payment, current_date,
          current_date + case when o.billing_interval = 'month' then interval '1 month' else interval '1 year' end);
  return true;
end $$;
revoke all on function public.billing_mark_paid(text, text, integer) from public, anon, authenticated;
do $$ begin
  grant execute on function public.billing_mark_paid(text, text, integer) to service_role;
exception when undefined_object then null; end $$;

-- 5. Uploads: profile, shop and claim photos are images only, with size limits.
do $$ begin
  update storage.buckets set file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'avatars';
  update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'place-media';
  update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'claim-photos';
exception when undefined_column or undefined_table then null; end $$;

-- 6. A person's reviews, read by reviews.user_id (indexed) instead of the view's hidden-author column.
--    Same columns as review_feed, so the app can embed items, places and tags as before. Newest first,
--    paged with the last row's created_at and id.
create or replace function public.my_reviews(p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns setof public.review_feed
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null), r.photo_path,
         r.voice_path, r.status, r.is_public, r.created_at, p.display_name, p.avatar_path,
         (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id)
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  where auth.uid() is not null and r.user_id = auth.uid()
    and (p_before_created is null or (r.created_at, r.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.my_reviews(timestamptz, uuid, integer) from public, anon;
grant execute on function public.my_reviews(timestamptz, uuid, integer) to authenticated;

create or replace function public.person_reviews(p_user uuid, p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns setof public.review_feed
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, r.place_id, r.item_id, r.rating, r.body, r.ai_drafted, (r.visit_id is not null), r.photo_path,
         r.voice_path, r.status, r.is_public, r.created_at, p.display_name, p.avatar_path,
         (select case when v.source = 'link' then 'link' else 'table' end from public.visits v where v.id = r.visit_id)
  from public.reviews r
  join public.profiles p on p.id = r.user_id
  join public.places pl on pl.id = r.place_id
  where r.user_id = p_user and r.is_public and r.status = 'published' and pl.status = 'live'
    and (p_before_created is null or (r.created_at, r.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.person_reviews(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.person_reviews(uuid, timestamptz, uuid, integer) to anon, authenticated;

-- The nightly job no longer rebuilds taste_match: nothing reads it.
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
end $$;
revoke execute on function public.refresh_trust_tables() from public, anon, authenticated;
drop table if exists public.taste_match;

-- 7. AI cost: an overall daily ceiling for everyone together (app setting ai_daily_ceiling, in credits),
--    credits given back when the AI call fails.
insert into public.app_settings (key, value) values ('ai_daily_ceiling', '3000') on conflict (key) do nothing;

create table if not exists public.ai_usage_total (
  day     date primary key default current_date,
  credits integer not null default 0
);
alter table public.ai_usage_total enable row level security;
revoke all on public.ai_usage_total from anon, authenticated;

-- Count a call if it fits the person's allowance; raises 'ai_daily_ceiling' when everyone's total is used up
-- (which also undoes the person's count).
create or replace function public.ai_take(p_user uuid, p_cost integer, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v integer; t integer; c integer := greatest(coalesce(p_cost, 1), 1);
begin
  insert into public.ai_usage (user_id, day, calls) values (p_user, current_date, 0)
  on conflict (user_id, day) do nothing;
  update public.ai_usage set calls = calls + c
  where user_id = p_user and day = current_date and calls + c <= p_limit
  returning calls into v;
  if v is null then return false; end if;
  insert into public.ai_usage_total (day, credits) values (current_date, 0) on conflict (day) do nothing;
  update public.ai_usage_total set credits = credits + c
  where day = current_date and credits + c <= public.setting_int('ai_daily_ceiling', 3000)
  returning credits into t;
  if t is null then raise exception 'ai_daily_ceiling: AI help has reached today''s limit'; end if;
  delete from public.ai_usage where day < current_date - 7;
  delete from public.ai_usage_total where day < current_date - 60;
  return true;
end $$;
revoke execute on function public.ai_take(uuid, integer, integer) from public, anon, authenticated;
do $$ begin
  grant execute on function public.ai_take(uuid, integer, integer) to service_role;
exception when undefined_object then null; end $$;

-- Give back what a failed AI call took (today's counts only).
create or replace function public.ai_give_back(p_user uuid, p_cost integer)
returns void language plpgsql security definer set search_path = public as $$
declare c integer := greatest(coalesce(p_cost, 0), 0);
begin
  if c = 0 then return; end if;
  update public.ai_usage set calls = greatest(calls - c, 0) where user_id = p_user and day = current_date;
  update public.ai_usage_total set credits = greatest(credits - c, 0) where day = current_date;
end $$;
revoke execute on function public.ai_give_back(uuid, integer) from public, anon, authenticated;
do $$ begin
  grant execute on function public.ai_give_back(uuid, integer) to service_role;
exception when undefined_object then null; end $$;
