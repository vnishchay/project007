-- Opt-in Web Push alerts. Durable per-device delivery, leases and bounded retries.
create table if not exists public.recovery_alert_preferences (
  place_id uuid not null references public.places(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  primary key(place_id, user_id)
);
create table if not exists public.recovery_alert_delivery (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.recovery_cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null references public.push_subscriptions(endpoint) on delete cascade,
  reason text not null check (reason in ('new', 'reopened', 'overdue')),
  generation timestamptz not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  delivered_at timestamptz,
  last_error text,
  unique(case_id, endpoint, reason, generation)
);
create index if not exists recovery_alert_delivery_due_idx on public.recovery_alert_delivery(next_attempt_at) where delivered_at is null and attempts < 5;
create table if not exists public.recovery_alert_worker (
  singleton boolean primary key default true check (singleton),
  last_seen_at timestamptz not null
);
alter table public.recovery_alert_preferences enable row level security;
alter table public.recovery_alert_delivery enable row level security;
alter table public.recovery_alert_worker enable row level security;
revoke all on public.recovery_alert_preferences, public.recovery_alert_delivery, public.recovery_alert_worker from public, anon, authenticated;

create or replace function public.set_recovery_alerts(p_place uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_manage_place(p_place),false) or auth.uid() is null then raise exception 'Only this shop owner can change alerts.'; end if;
  if p_enabled is null then raise exception 'Choose whether to enable alerts.'; end if;
  if p_enabled and not exists(select 1 from public.push_subscriptions s where s.user_id = auth.uid()) then raise exception 'Enable notifications on this device first.'; end if;
  insert into public.recovery_alert_preferences(place_id,user_id,enabled) values(p_place,auth.uid(),p_enabled)
    on conflict(place_id,user_id) do update set enabled=excluded.enabled;
end $$;
revoke execute on function public.set_recovery_alerts(uuid,boolean) from public, anon;
grant execute on function public.set_recovery_alerts(uuid,boolean) to authenticated;

create or replace function public.recovery_alert_state(p_place uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.can_manage_place(p_place),false) then raise exception 'Only this shop owner can read alerts.'; end if;
  return jsonb_build_object(
    'enabled',coalesce((select p.enabled from public.recovery_alert_preferences p where p.place_id=p_place and p.user_id=auth.uid()),false),
    'subscribed',exists(select 1 from public.push_subscriptions s where s.user_id=auth.uid()),
    'worker_seen_at',(select last_seen_at from public.recovery_alert_worker where singleton),
    'failed',(select count(*) from public.recovery_alert_delivery d join public.recovery_cases c on c.id=d.case_id
      where c.place_id=p_place and d.user_id=auth.uid() and d.attempts>=5 and d.delivered_at is null and c.status<>'resolved'),
    'last_delivered_at',(select max(d.delivered_at) from public.recovery_alert_delivery d join public.recovery_cases c on c.id=d.case_id where c.place_id=p_place and d.user_id=auth.uid())
  );
end $$;
revoke execute on function public.recovery_alert_state(uuid) from public, anon;
grant execute on function public.recovery_alert_state(uuid) to authenticated;

create or replace function public.claim_recovery_alerts(p_limit integer default 100)
returns table(delivery_id uuid, claim_attempt integer, case_id uuid, place_id uuid, place_name text, reason text, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
begin
  insert into public.recovery_alert_worker(singleton,last_seen_at) values(true,now())
    on conflict(singleton) do update set last_seen_at=excluded.last_seen_at;
  -- No new alert for every edit: each new/reopened/overdue generation is delivered once per device.
  insert into public.recovery_alert_delivery(case_id,user_id,endpoint,reason,generation)
  select c.id, pref.user_id, s.endpoint,
    case when c.due_at < now() then 'overdue' when c.confirmation='not_fixed' then 'reopened' else 'new' end,
    case when c.due_at < now() then c.due_at when c.confirmation='not_fixed' then c.confirmed_at else c.created_at end
  from public.recovery_cases c join public.places p on p.id=c.place_id
  join public.recovery_alert_preferences pref on pref.place_id=c.place_id and pref.enabled
  join public.profiles u on u.id=pref.user_id
  join public.push_subscriptions s on s.user_id=pref.user_id
  where c.status<>'resolved' and (p.owner_id=pref.user_id or u.role='admin')
    and (c.status='open' or c.due_at<now())
  on conflict do nothing;

  return query with claimed as (
    update public.recovery_alert_delivery d set attempts=d.attempts+1,leased_until=now()+interval '2 minutes'
    where d.id in (
      select d2.id from public.recovery_alert_delivery d2
      join public.recovery_cases c on c.id=d2.case_id join public.places p on p.id=c.place_id
      join public.recovery_alert_preferences pref on pref.place_id=c.place_id and pref.user_id=d2.user_id and pref.enabled
      join public.profiles u on u.id=d2.user_id
      where d2.delivered_at is null and d2.attempts<5 and d2.next_attempt_at<=now()
        and (d2.leased_until is null or d2.leased_until<now()) and c.status<>'resolved'
        and (p.owner_id=d2.user_id or u.role='admin')
        and ((d2.reason='new' and c.status='open' and c.confirmation='pending' and d2.generation=c.created_at and c.due_at>=now())
          or (d2.reason='reopened' and c.status='open' and c.confirmation='not_fixed' and d2.generation=c.confirmed_at and c.due_at>=now())
          or (d2.reason='overdue' and d2.generation=c.due_at and c.due_at<now()))
      order by d2.next_attempt_at,d2.id limit least(greatest(coalesce(p_limit,100),1),300)
      for update of d2 skip locked
    ) returning d.*
  ) select d.id,d.attempts,c.id,c.place_id,p.name,d.reason,s.endpoint,s.p256dh,s.auth
    from claimed d join public.recovery_cases c on c.id=d.case_id join public.places p on p.id=c.place_id
    join public.push_subscriptions s on s.endpoint=d.endpoint;
end $$;
revoke execute on function public.claim_recovery_alerts(integer) from public, anon, authenticated;
grant execute on function public.claim_recovery_alerts(integer) to service_role;

create or replace function public.finish_recovery_alert(p_delivery uuid, p_attempt integer, p_success boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.recovery_alert_delivery set delivered_at=case when p_success then now() end,
    leased_until=null,last_error=case when p_success then null else left(coalesce(p_error,'Delivery failed'),200) end,
    next_attempt_at=now()+make_interval(mins=>least(30,power(2,attempts)::integer))
  where id=p_delivery and attempts=p_attempt and delivered_at is null and leased_until is not null;
end $$;
revoke execute on function public.finish_recovery_alert(uuid,integer,boolean,text) from public, anon, authenticated;
grant execute on function public.finish_recovery_alert(uuid,integer,boolean,text) to service_role;

-- Existing reminder Vault secrets are reused. No job is scheduled in local PostgreSQL without cron.
do $schedule$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') and exists(select 1 from pg_extension where extname='pg_net') then
    perform cron.schedule('trusted-picks-recovery-alerts','* * * * *',$job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/recovery-alerts',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='remind_cron_secret')),
        body := '{}'::jsonb)
      where exists(select 1 from vault.decrypted_secrets where name='project_url')
        and exists(select 1 from vault.decrypted_secrets where name='remind_cron_secret')
        and exists(select 1 from public.recovery_cases where status<>'resolved');
    $job$);
  end if;
end $schedule$;
