-- Trusted Picks: offers you can show at the counter, and reminders to review a visit (2026-10-23).
--   * A diner sees this shop's offers for them on the scan page and can mark one as used at the counter.
--     Owners see how many were used.
--   * Review reminders: a diner who allowed notifications gets a reminder about an hour and a half after
--     scanning, and one last one before the review window closes, unless they already reviewed.
--     Nothing is sent to anyone who didn't switch reminders on.

-- ---------- Offers as coupons ----------
alter table public.visitor_offers add column if not exists used_at timestamptz;

-- This shop's offers for me, for the scan page. Unused first.
create or replace function public.my_offers_here(p_place uuid)
returns table (id uuid, body text, link_url text, created_at timestamptz, seen boolean, used_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.body, o.link_url, o.created_at, o.seen_at is not null, o.used_at
  from public.visitor_offers o
  where o.user_id = auth.uid() and auth.uid() is not null and o.place_id = p_place
    and o.created_at > now() - interval '30 days'
    and not exists (select 1 from public.shop_privacy sp where sp.user_id = o.user_id and sp.place_id = o.place_id and (sp.hidden or sp.no_offers))
  order by o.used_at is not null, o.created_at desc
  limit 10;
$$;
revoke execute on function public.my_offers_here(uuid) from public, anon;
grant execute on function public.my_offers_here(uuid) to authenticated;

-- The diner marks an offer as used, at the counter. It can't be undone.
create or replace function public.use_offer(p_id uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  update public.visitor_offers set used_at = now(), seen_at = coalesce(seen_at, now())
   where id = p_id and user_id = auth.uid() and used_at is null
  returning used_at into t;
  if t is null then
    select used_at into t from public.visitor_offers where id = p_id and user_id = auth.uid();
    if t is null then raise exception 'offer not found'; end if;
  end if;
  return t;
end $$;
revoke execute on function public.use_offer(uuid) from public, anon;
grant execute on function public.use_offer(uuid) to authenticated;

-- Home's news strip leaves out offers already used.
create or replace function public.my_offers(p_limit integer default 10)
returns table (id uuid, place_id uuid, place_name text, logo_path text, body text, link_url text, created_at timestamptz, seen boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.place_id, p.name, p.logo_path, o.body, o.link_url, o.created_at, o.seen_at is not null
  from public.visitor_offers o
  join public.places p on p.id = o.place_id and p.status = 'live'
  where o.user_id = auth.uid() and auth.uid() is not null
    and o.created_at > now() - interval '30 days'
    and o.used_at is null
    and not exists (select 1 from public.shop_privacy sp where sp.user_id = o.user_id and sp.place_id = o.place_id and (sp.hidden or sp.no_offers))
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
revoke execute on function public.my_offers(integer) from public, anon;
grant execute on function public.my_offers(integer) to authenticated;

-- Offers sent, now with how many were used.
drop function if exists public.shop_offers_sent(uuid, integer);
create or replace function public.shop_offers_sent(p_place uuid, p_limit integer default 20)
returns table (body text, link_url text, sent_at timestamptz, recipients integer, seen integer, used integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  select o.body, o.link_url, min(o.created_at), count(*)::integer, count(o.seen_at)::integer, count(o.used_at)::integer
  from public.visitor_offers o
  where o.place_id = p_place
  group by o.body, o.link_url, date_trunc('minute', o.created_at)
  order by min(o.created_at) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke execute on function public.shop_offers_sent(uuid, integer) from public, anon;
grant execute on function public.shop_offers_sent(uuid, integer) to authenticated;

-- Shops I can still review (the visit is open), newest first, and whether I already reviewed since the scan.
create or replace function public.my_open_visits()
returns table (place_id uuid, place_name text, area text, category text, expires_at timestamptz, reviewed boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (v.place_id) v.place_id, p.name, p.area, p.category, v.expires_at,
         exists (select 1 from public.reviews r where r.user_id = v.user_id and r.place_id = v.place_id and r.created_at >= v.scanned_at)
  from public.visits v
  join public.places p on p.id = v.place_id
  where v.user_id = auth.uid() and auth.uid() is not null and v.expires_at > now()
  order by v.place_id, v.expires_at desc
  limit 10;
$$;
revoke execute on function public.my_open_visits() from public, anon;
grant execute on function public.my_open_visits() to authenticated;

-- ---------- Review reminders ----------
-- A phone's push address (Web Push). Only the remind function reads these.
create table if not exists public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh     text not null check (length(p256dh) <= 200),
  auth       text not null check (length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

alter table public.visits add column if not exists remind_at timestamptz;
alter table public.visits add column if not exists reminders_sent smallint not null default 0;
create index if not exists visits_remind_idx on public.visits (remind_at) where remind_at is not null;

-- When the first reminder for a visit goes out: 90 minutes after the scan, but never later than
-- 45 minutes before the window closes, and never sooner than 10 minutes from now.
create or replace function public.first_reminder_at(p_expires timestamptz)
returns timestamptz language sql stable as $$
  select greatest(least(now() + interval '90 minutes', p_expires - interval '45 minutes'), now() + interval '10 minutes');
$$;

-- Switch reminders on for this phone (also schedules one for any visit that's open right now).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'open the page again to turn on reminders'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  -- Ten phones per person is plenty; drop the oldest.
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from public.push_subscriptions where user_id = auth.uid() order by created_at desc offset 10);
  update public.visits set remind_at = public.first_reminder_at(expires_at)
   where user_id = auth.uid() and expires_at > now() + interval '20 minutes' and reminders_sent = 0 and remind_at is null;
end $$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- Switch reminders off for this phone, or for every phone (p_endpoint null).
create or replace function public.delete_push_subscription(p_endpoint text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where user_id = auth.uid() and (p_endpoint is null or endpoint = p_endpoint);
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid()) then
    update public.visits set remind_at = null where user_id = auth.uid() and remind_at is not null;
  end if;
end $$;
revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Every new visit by someone with reminders on gets one scheduled.
create or replace function public.schedule_review_reminder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    new.remind_at := public.first_reminder_at(new.expires_at);
  end if;
  return new;
end $$;
drop trigger if exists visits_schedule_reminder on public.visits;
create trigger visits_schedule_reminder before insert on public.visits
  for each row execute function public.schedule_review_reminder();

-- For the remind function only: reminders due now, each marked as sent. A visit already reviewed
-- (any review by that person at that shop since the scan) is skipped and cleared. The second and
-- last reminder is set 45 minutes before the window closes, if there's time for one.
create or replace function public.take_due_review_reminders(p_limit integer default 200)
returns table (visit_id uuid, place_id uuid, place_name text, expires_at timestamptz, last_one boolean, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
begin
  update public.visits v set remind_at = null
   where v.remind_at <= now()
     and (v.expires_at <= now() + interval '10 minutes'
          or exists (select 1 from public.reviews r where r.user_id = v.user_id and r.place_id = v.place_id and r.created_at >= v.scanned_at));
  return query
  with due as (
    update public.visits v
       set reminders_sent = v.reminders_sent + 1,
           remind_at = case when v.reminders_sent = 0 and v.expires_at - now() > interval '2 hours'
                            then v.expires_at - interval '45 minutes' end
     where v.id in (select v2.id from public.visits v2 where v2.remind_at <= now() order by v2.remind_at
                    limit least(greatest(coalesce(p_limit, 200), 1), 1000) for update skip locked)
    returning v.id, v.user_id, v.place_id, v.expires_at, v.remind_at is null as last_one
  )
  select d.id, d.place_id, p.name, d.expires_at, d.last_one, s.endpoint, s.p256dh, s.auth
  from due d
  join public.places p on p.id = d.place_id
  join public.push_subscriptions s on s.user_id = d.user_id;
end $$;
revoke execute on function public.take_due_review_reminders(integer) from public, anon, authenticated;
grant execute on function public.take_due_review_reminders(integer) to service_role;

-- Every 10 minutes, ask the `remind` Edge Function to send what's due. It reads the project address and
-- the function's secret from Supabase Vault (set once, see supabase/README.md), and does nothing until
-- they're there or when nothing is due.
create extension if not exists pg_net;
select cron.schedule('trusted-picks-review-reminders', '*/10 * * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/remind',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'remind_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from vault.decrypted_secrets where name = 'remind_cron_secret')
    and exists (select 1 from vault.decrypted_secrets where name = 'project_url')
    and exists (select 1 from public.visits where remind_at <= now());
$cron$);
