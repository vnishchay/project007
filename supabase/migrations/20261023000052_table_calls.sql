-- Trusted Picks: table calls (2026-10-23).
--   * From the table code (or NFC tap), a diner can call the staff, ask for the bill, or tell the
--     shop something is wrong right now ("Tell the shop now"). It reaches the shop's live board at
--     once, with the table, and a push alert on any phone the owner switched alerts on.
--   * Calls and bill requests only when the owner has switched table calls on (off by default, so
--     nobody calls a shop that isn't watching). "Tell the shop now" always works.
--   * A request carries the table and the message only: never the diner's name, and it is never
--     linked to a review. It never stands in the way of a review either: the review flow is unchanged.
--   * Only from an open visit that isn't known to be far away. One open call or bill per table visit,
--     3 messages per visit, and a cap per shop so a prank can't flood the board.

alter table public.places add column if not exists table_calls boolean not null default false;

create table if not exists public.table_requests (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  visit_id    uuid references public.visits (id) on delete set null,
  qr_code_id  uuid references public.qr_codes (id) on delete set null,
  table_label text check (table_label is null or length(table_label) <= 60),
  kind        text not null check (kind in ('waiter', 'bill', 'help')),
  message     text check (message is null or length(btrim(message)) between 1 and 280),
  created_at  timestamptz not null default now(),
  pinged_at   timestamptz not null default now(),
  seen_at     timestamptz,
  done_at     timestamptz,
  cancelled   boolean not null default false
);
create index if not exists table_requests_place_idx on public.table_requests (place_id, created_at desc);
create index if not exists table_requests_visit_idx on public.table_requests (visit_id) where visit_id is not null;
alter table public.table_requests enable row level security;
revoke all on public.table_requests from anon, authenticated;

-- Phones that get a push the moment a table calls (the owner turns this on per shop, per account).
create table if not exists public.shop_alerts (
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (place_id, user_id)
);
alter table public.shop_alerts enable row level security;
revoke all on public.shop_alerts from anon, authenticated;

-- ---------- Diner side ----------

-- What the scan page offers here: calls and bill (if switched on) and the table's name.
create or replace function public.place_service(p_place uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('calls', coalesce((select p.table_calls from public.places p where p.id = p_place and p.status = 'live'), false));
$$;
revoke execute on function public.place_service(uuid) from public;
grant execute on function public.place_service(uuid) to anon, authenticated;

-- The caller's open visit at this shop (the newest), or null.
create or replace function public.open_visit_at(p_place uuid)
returns public.visits language sql stable security definer set search_path = public as $$
  select v.* from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;
$$;
revoke execute on function public.open_visit_at(uuid) from public, anon, authenticated;

create or replace function public.request_json(r public.table_requests)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', r.id, 'kind', r.kind, 'message', r.message, 'table_label', r.table_label,
    'created_at', r.created_at, 'pinged_at', r.pinged_at, 'seen_at', r.seen_at, 'done_at', r.done_at);
$$;
revoke execute on function public.request_json(public.table_requests) from public, anon, authenticated;

-- Call the staff ('waiter'), ask for the bill ('bill'), or tell the shop something now ('help').
-- Tapping call or bill again while one is open pings it again (at most once a minute).
create or replace function public.table_request(p_place uuid, p_kind text, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.visits; r public.table_requests; v_msg text := nullif(btrim(coalesce(p_message, '')), '');
        v_label text; v_calls boolean;
begin
  if auth.uid() is null then raise exception 'open the page again to reach the shop'; end if;
  if p_kind not in ('waiter', 'bill', 'help') then raise exception 'unknown request'; end if;
  if public.is_place_owner(p_place) then raise exception 'this is your own shop'; end if;
  select p.table_calls into v_calls from public.places p where p.id = p_place and p.status = 'live';
  if not found then raise exception 'this shop isn''t taking requests'; end if;
  if p_kind <> 'help' and not v_calls then raise exception 'this shop doesn''t take calls from the table. Wave to the staff'; end if;
  v := public.open_visit_at(p_place);
  if v.id is null then raise exception 'scan the table code again to reach the shop'; end if;
  if v.near is false then raise exception 'you need to be at the shop for this'; end if;
  if p_kind = 'help' and v_msg is null then raise exception 'write a few words for the shop'; end if;
  if length(v_msg) > 280 then raise exception 'keep it under 280 characters'; end if;
  if p_kind <> 'help' then v_msg := null; end if;
  if v_msg ~* '(https?://|www\.)' then raise exception 'links can''t be sent to the shop'; end if;

  -- Same call still open: ping it again instead of adding another.
  if p_kind <> 'help' then
    select * into r from public.table_requests t
    where t.visit_id = v.id and t.kind = p_kind and t.done_at is null and not t.cancelled
      and t.created_at > now() - interval '2 hours'
    order by t.created_at desc limit 1 for update;
    if found then
      if r.pinged_at < now() - interval '1 minute' then
        update public.table_requests set pinged_at = now(), seen_at = null where id = r.id returning * into r;
      end if;
      return public.request_json(r);
    end if;
  end if;

  if (select count(*) from public.table_requests t where t.visit_id = v.id and t.created_at > now() - interval '1 hour') >= 8 then
    raise exception 'you''ve called a few times. The staff will be with you';
  end if;
  if p_kind = 'help' and (select count(*) from public.table_requests t where t.visit_id = v.id and t.kind = 'help') >= 3 then
    raise exception 'you''ve sent a few messages already. The shop has them';
  end if;
  if (select count(*) from public.table_requests t where t.place_id = p_place and t.created_at > now() - interval '10 minutes') >= 120 then
    raise exception 'the shop is very busy right now. Please ask the staff';
  end if;

  select q.table_label into v_label from public.qr_codes q where q.id = v.qr_code_id;
  insert into public.table_requests (place_id, visit_id, qr_code_id, table_label, kind, message)
  values (p_place, v.id, v.qr_code_id, left(v_label, 60), p_kind, v_msg)
  returning * into r;
  return public.request_json(r);
end $$;
revoke execute on function public.table_request(uuid, text, text) from public, anon;
grant execute on function public.table_request(uuid, text, text) to authenticated;

-- The diner's own requests during this visit, so the page can say "The shop is on it".
create or replace function public.my_table_requests(p_place uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.request_json(t) order by t.created_at desc), '[]'::jsonb)
  from public.table_requests t
  where t.visit_id = (select (public.open_visit_at(p_place)).id) and not t.cancelled;
$$;
revoke execute on function public.my_table_requests(uuid) from public, anon;
grant execute on function public.my_table_requests(uuid) to authenticated;

create or replace function public.cancel_table_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.table_requests t set cancelled = true
  where t.id = p_id and t.done_at is null
    and t.visit_id in (select v.id from public.visits v where v.user_id = auth.uid());
end $$;
revoke execute on function public.cancel_table_request(uuid) from public, anon;
grant execute on function public.cancel_table_request(uuid) to authenticated;

-- ---------- Shop side ----------

-- The live board: open requests (oldest first) and today's handled ones, plus how fast the shop answers.
create or replace function public.shop_live_requests(p_place uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_day timestamptz;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  v_day := date_trunc('day', public.place_local_now(p_place)) at time zone
           coalesce((select time_zone from public.places where id = p_place), 'Asia/Kolkata');
  return jsonb_build_object(
    'calls', (select table_calls from public.places where id = p_place),
    'alerts', exists (select 1 from public.shop_alerts a where a.place_id = p_place and a.user_id = auth.uid()),
    'open', (select coalesce(jsonb_agg(public.request_json(t) order by t.pinged_at), '[]'::jsonb)
             from public.table_requests t
             where t.place_id = p_place and t.done_at is null and not t.cancelled and t.created_at > now() - interval '3 hours'),
    'done', (select coalesce(jsonb_agg(x.j order by x.done_at desc), '[]'::jsonb) from (
               select public.request_json(t) as j, t.done_at from public.table_requests t
               where t.place_id = p_place and t.done_at >= v_day and not t.cancelled
               order by t.done_at desc limit 30) x),
    'today', (select jsonb_build_object(
                'count', count(*),
                'answer_s', round(extract(epoch from percentile_cont(0.5) within group (order by coalesce(t.seen_at, t.done_at) - t.created_at)))::integer)
              from public.table_requests t
              where t.place_id = p_place and t.created_at >= v_day and not t.cancelled)
  );
end $$;
revoke execute on function public.shop_live_requests(uuid) from public, anon;
grant execute on function public.shop_live_requests(uuid) to authenticated;

-- 'seen' (On it) or 'done'.
create or replace function public.shop_answer_request(p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare v_place uuid;
begin
  select place_id into v_place from public.table_requests where id = p_id;
  if v_place is null then return; end if;
  if not (public.is_admin() or public.is_place_owner(v_place)) then raise exception 'only the shop owner can do this'; end if;
  if p_action = 'seen' then
    update public.table_requests set seen_at = coalesce(seen_at, now()) where id = p_id;
  elsif p_action = 'done' then
    update public.table_requests set seen_at = coalesce(seen_at, now()), done_at = coalesce(done_at, now()) where id = p_id;
  else
    raise exception 'unknown action';
  end if;
end $$;
revoke execute on function public.shop_answer_request(uuid, text) from public, anon;
grant execute on function public.shop_answer_request(uuid, text) to authenticated;

create or replace function public.set_table_calls(p_place uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change this'; end if;
  update public.places set table_calls = coalesce(p_on, false) where id = p_place;
end $$;
revoke execute on function public.set_table_calls(uuid, boolean) from public, anon;
grant execute on function public.set_table_calls(uuid, boolean) to authenticated;

-- Push alerts on this account's phones for this shop (the phone's push address is saved by
-- save_push_subscription, the same as review reminders).
create or replace function public.set_shop_alerts(p_place uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can change this'; end if;
  if p_on then
    insert into public.shop_alerts (place_id, user_id) values (p_place, auth.uid()) on conflict do nothing;
  else
    delete from public.shop_alerts where place_id = p_place and user_id = auth.uid();
  end if;
end $$;
revoke execute on function public.set_shop_alerts(uuid, boolean) from public, anon;
grant execute on function public.set_shop_alerts(uuid, boolean) to authenticated;

-- Owner check for a given account (shop_alerts rows outlive a change of owner).
create or replace function public.is_place_owner_of(p_user uuid, p_place uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.places p where p.id = p_place and p.owner_id = p_user)
      or exists (select 1 from public.profiles pr where pr.id = p_user and pr.role = 'admin');
$$;
-- For the remind function only: where to send the alert for one request.
create or replace function public.request_alert_targets(p_id uuid)
returns table (place_id uuid, place_name text, kind text, table_label text, message text, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select t.place_id, p.name, t.kind, t.table_label, t.message, s.endpoint, s.p256dh, s.auth
  from public.table_requests t
  join public.places p on p.id = t.place_id
  join public.shop_alerts a on a.place_id = t.place_id
  join public.push_subscriptions s on s.user_id = a.user_id
  where t.id = p_id and t.done_at is null and not t.cancelled
    and public.is_place_owner_of(a.user_id, t.place_id);
$$;

revoke execute on function public.is_place_owner_of(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.request_alert_targets(uuid) from public, anon, authenticated;
grant execute on function public.request_alert_targets(uuid) to service_role;

-- A new request (or a ping) asks the remind function to alert the shop's phones straight away.
-- Does nothing until the Vault secrets from migration 47 are set, or when nobody has alerts on.
create or replace function public.alert_shop_request()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.shop_alerts a where a.place_id = new.place_id) then return null; end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'remind_cron_secret')
     or not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then return null; end if;
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/remind',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'remind_cron_secret')),
    body := jsonb_build_object('request', new.id));
  return null;
exception when others then
  -- An alert must never stop the request itself.
  return null;
end $$;
drop trigger if exists table_requests_alert on public.table_requests;
create trigger table_requests_alert after insert or update of pinged_at on public.table_requests
  for each row execute function public.alert_shop_request();
