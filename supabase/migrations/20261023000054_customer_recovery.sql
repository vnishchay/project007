-- Customer help is independent of public reviews, subscriptions and marketing consent.
-- Owners never receive requester IDs. Contact is shared only with explicit permission.
create table if not exists public.recovery_cases (
  id uuid primary key,
  note_id uuid not null unique references public.owner_notes(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('order', 'service', 'quality', 'other')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  assigned_to text not null default '' check (length(assigned_to) <= 80),
  resolution text not null default '' check (length(resolution) <= 1000),
  internal_note text not null default '' check (length(internal_note) <= 1000),
  created_at timestamptz not null default now(),
  due_at timestamptz not null default now() + interval '30 minutes',
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  confirmation text not null default 'pending' check (confirmation in ('pending', 'fixed', 'not_fixed')),
  confirmed_at timestamptz,
  recovery_cost numeric(12,2) not null default 0 check (recovery_cost >= 0 and recovery_cost <= 10000000),
  purchase_amount numeric(12,2) check (purchase_amount > 0 and purchase_amount <= 10000000),
  bill_reference text check (bill_reference is null or length(bill_reference) between 1 and 100),
  purchase_recorded_at timestamptz,
  currency text not null,
  version integer not null default 1,
  check ((purchase_amount is null and bill_reference is null and purchase_recorded_at is null)
      or (purchase_amount is not null and bill_reference is not null and purchase_recorded_at is not null)),
  check (status <> 'resolved' or (resolved_at is not null and length(btrim(resolution)) > 0))
);
create index if not exists recovery_cases_queue_idx on public.recovery_cases(place_id, status, due_at);
create index if not exists recovery_cases_requester_idx on public.recovery_cases(requester_id, created_at desc);
-- A bill can only be attributed to one case at an outlet, even when two managers save at once.
create unique index if not exists recovery_cases_bill_idx on public.recovery_cases(place_id, lower(bill_reference)) where bill_reference is not null;
alter table public.recovery_cases enable row level security;
revoke all on public.recovery_cases from public, anon, authenticated;

create or replace function public.request_customer_help(
  p_place uuid, p_request uuid, p_body text, p_category text default 'other',
  p_contact text default null, p_allow_contact boolean default false, p_device text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare existing public.recovery_cases; note uuid; cur text;
begin
  if auth.uid() is null then raise exception 'Open the shop QR code to request help.'; end if;
  if p_request is null then raise exception 'A request reference is required.'; end if;
  -- Serialize submissions for this customer: enforce the existing note limits and safe retries.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 54));
  select * into existing from public.recovery_cases where id = p_request;
  if found then
    if existing.requester_id <> auth.uid() or existing.place_id <> p_place then raise exception 'Request reference is already in use.'; end if;
    return existing.id;
  end if;
  if p_category is null or p_category not in ('order', 'service', 'quality', 'other') then raise exception 'Choose a help category.'; end if;
  if nullif(btrim(p_contact), '') is not null and p_allow_contact is distinct from true then raise exception 'Allow the shop to use the contact you provided, or remove it.'; end if;
  if length(coalesce(p_contact, '')) > 200 then raise exception 'Keep contact details under 200 characters.'; end if;
  select coalesce(p.currency, 'INR') into cur from public.places p where p.id = p_place and p.status = 'live';
  if cur is null then raise exception 'This shop is not accepting help requests.'; end if;
  -- Reuse visit authorization, owner exclusion, size and abuse checks; this does not require a paid plan.
  note := public.send_owner_note(p_place, p_body, null, case when p_allow_contact then p_contact end, p_device);
  insert into public.recovery_cases(id, note_id, place_id, requester_id, category, currency)
    values(p_request, note, p_place, auth.uid(), p_category, cur);
  return p_request;
end $$;
revoke execute on function public.request_customer_help(uuid, uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.request_customer_help(uuid, uuid, text, text, text, boolean, text) to authenticated;

-- Open a visit for help without applying review-plan or guest-review quotas.
-- The normal review submission still independently checks review eligibility.
create or replace function public.begin_help_visit(p_token text, p_link boolean default false)
returns table (visit_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare l public.review_links; v public.visits; scanned record;
begin
  if auth.uid() is null then raise exception 'Open the shop code again to ask for help.'; end if;
  if p_link is distinct from true then
    select * into scanned from public.scan_qr(p_token) limit 1;
    return query select scanned.visit_id::uuid, scanned.expires_at::timestamptz;
    return;
  end if;
  select * into l from public.review_links where token = p_token for update;
  if not found then raise exception 'This shop link does not work. Ask the staff for a new one.'; end if;
  if not exists (select 1 from public.places p where p.id = l.place_id and p.status = 'live') then raise exception 'This shop is not accepting requests.'; end if;
  if public.is_place_owner(l.place_id) then raise exception 'Owners cannot send help requests to their own shop.'; end if;
  if l.used_at is not null then
    select * into v from public.visits where id = l.visit_id and user_id = auth.uid() and public.visits.expires_at > now();
    if not found then raise exception 'This link was already used. Ask the staff for a new one.'; end if;
  else
    if l.expires_at <= now() then raise exception 'This link has expired. Ask the staff for a new one.'; end if;
    insert into public.visits(user_id, place_id, source, expires_at)
      values(auth.uid(), l.place_id, 'link', now() + make_interval(hours => public.setting_int('visit_window_hours', 6))) returning * into v;
    update public.review_links set used_at = now(), visit_id = v.id where id = l.id;
  end if;
  return query select v.id, v.expires_at;
end $$;
revoke execute on function public.begin_help_visit(text, boolean) from public, anon;
grant execute on function public.begin_help_visit(text, boolean) to authenticated;

-- Paginated work queue. Summary counts cover ALL cases, not just the current page.
create or replace function public.shop_recovery_cases(p_place uuid, p_filter text default 'active', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not coalesce(public.can_manage_place(p_place), false) then raise exception 'Only this shop owner can read help requests.'; end if;
  if p_filter is null or p_filter not in ('active', 'resolved', 'all') then raise exception 'Choose a valid queue.'; end if;
  select jsonb_build_object(
    'open', (select count(*) from public.recovery_cases c where c.place_id = p_place and c.status <> 'resolved'),
    'overdue', (select count(*) from public.recovery_cases c where c.place_id = p_place and c.status <> 'resolved' and c.due_at < now()),
    'resolved_30d', (select count(*) from public.recovery_cases c where c.place_id = p_place and c.status = 'resolved' and c.resolved_at >= now() - interval '30 days'),
    'confirmed_30d', (select count(*) from public.recovery_cases c where c.place_id = p_place and c.status = 'resolved' and c.confirmation = 'fixed' and c.resolved_at >= now() - interval '30 days'),
    'money', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select c.currency, sum(c.recovery_cost) as cost, sum(coalesce(c.purchase_amount, 0)) as recorded_sales,
        count(c.purchase_amount) as purchases
      from public.recovery_cases c where c.place_id = p_place and c.created_at >= now() - interval '30 days' group by c.currency
    ) x),
    'total', (select count(*) from public.recovery_cases c where c.place_id = p_place
      and (p_filter = 'all' or (p_filter = 'active' and c.status <> 'resolved') or (p_filter = 'resolved' and c.status = 'resolved'))),
    'cases', (select coalesce(jsonb_agg(x order by x.is_resolved, x.due_at, x.id), '[]'::jsonb) from (
      select c.id, c.category, c.status, c.assigned_to, c.resolution, c.internal_note, c.created_at, c.due_at,
        c.acknowledged_at, c.resolved_at, c.confirmation, c.confirmed_at, c.recovery_cost, c.purchase_amount,
        c.bill_reference, c.purchase_recorded_at, c.currency, c.version, n.body, n.contact,
        (c.status = 'resolved') as is_resolved
      from public.recovery_cases c join public.owner_notes n on n.id = c.note_id
      where c.place_id = p_place and (p_filter = 'all' or (p_filter = 'active' and c.status <> 'resolved') or (p_filter = 'resolved' and c.status = 'resolved'))
      order by (c.status = 'resolved'), c.due_at, c.id limit 25 offset greatest(coalesce(p_offset, 0), 0)
    ) x)
  ) into result;
  return result;
end $$;
revoke execute on function public.shop_recovery_cases(uuid, text, integer) from public, anon;
grant execute on function public.shop_recovery_cases(uuid, text, integer) to authenticated;

create or replace function public.update_recovery_case(
  p_case uuid, p_version integer, p_status text, p_assigned_to text, p_resolution text,
  p_internal_note text, p_recovery_cost numeric, p_purchase_amount numeric default null, p_bill_reference text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.recovery_cases; bill text := nullif(btrim(p_bill_reference), '');
begin
  select * into c from public.recovery_cases where id = p_case for update;
  if not found then raise exception 'Help request not found.'; end if;
  if not coalesce(public.can_manage_place(c.place_id), false) then raise exception 'Only this shop owner can update help requests.'; end if;
  if p_version is distinct from c.version then raise exception 'This request changed. Refresh it before saving.'; end if;
  if p_status is null or p_status not in ('open', 'in_progress', 'resolved') then raise exception 'Choose a valid status.'; end if;
  if length(coalesce(p_assigned_to, '')) > 80 or length(coalesce(p_internal_note, '')) > 1000 or length(coalesce(p_resolution, '')) > 1000 then raise exception 'Keep names under 80 and notes under 1,000 characters.'; end if;
  if p_status <> 'open' and nullif(btrim(p_assigned_to), '') is null then raise exception 'Name the person responsible first.'; end if;
  if p_status = 'resolved' and nullif(btrim(p_resolution), '') is null then raise exception 'Explain what was done before resolving.'; end if;
  if p_recovery_cost is null or p_recovery_cost::text in ('NaN', 'Infinity', '-Infinity') or p_recovery_cost < 0 or p_recovery_cost > 10000000 then raise exception 'Enter a valid recovery cost.'; end if;
  if p_purchase_amount is not null and (p_purchase_amount::text in ('NaN', 'Infinity', '-Infinity') or p_purchase_amount <= 0 or p_purchase_amount > 10000000) then raise exception 'Enter a valid purchase amount.'; end if;
  if (p_purchase_amount is null) <> (bill is null) or length(bill) > 100 then raise exception 'A recorded purchase needs an amount and a bill reference.'; end if;
  -- Do not let edits quietly replace an answer already confirmed by the customer.
  if c.confirmation = 'fixed' and p_status = 'resolved' and btrim(coalesce(p_resolution, '')) <> c.resolution then raise exception 'Reopen the request before changing a confirmed resolution.'; end if;
  update public.recovery_cases set
    status = p_status, assigned_to = btrim(coalesce(p_assigned_to, '')), resolution = btrim(coalesce(p_resolution, '')),
    internal_note = btrim(coalesce(p_internal_note, '')), recovery_cost = p_recovery_cost,
    purchase_amount = p_purchase_amount, bill_reference = bill,
    purchase_recorded_at = case when p_purchase_amount is null then null else coalesce(c.purchase_recorded_at, now()) end,
    acknowledged_at = case when p_status <> 'open' then coalesce(c.acknowledged_at, now()) else c.acknowledged_at end,
    resolved_at = case when p_status = 'resolved' then coalesce(c.resolved_at, now()) end,
    due_at = case when c.status = 'resolved' and p_status <> 'resolved' then now() + interval '30 minutes' else c.due_at end,
    confirmation = case when p_status <> c.status or (p_status = 'resolved' and btrim(coalesce(p_resolution, '')) <> c.resolution) then 'pending' else c.confirmation end,
    confirmed_at = case when p_status = c.status and btrim(coalesce(p_resolution, '')) = c.resolution then c.confirmed_at end,
    version = c.version + 1
  where id = p_case;
  update public.owner_notes set read_at = coalesce(read_at, now()) where id = c.note_id;
end $$;
revoke execute on function public.update_recovery_case(uuid, integer, text, text, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.update_recovery_case(uuid, integer, text, text, text, text, numeric, numeric, text) to authenticated;

-- The requester sees only their own request and the customer-facing response. No staff notes or costs.
create or replace function public.my_help_requests(p_place uuid default null, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc, x.id), '[]'::jsonb) from (
    select c.id, c.place_id, p.name as place_name, c.category, c.status, c.created_at, c.resolved_at,
      case when c.status = 'resolved' or c.confirmation = 'not_fixed' then c.resolution else '' end as resolution,
      c.confirmation, c.version, n.body
    from public.recovery_cases c join public.owner_notes n on n.id = c.note_id join public.places p on p.id = c.place_id
    where c.requester_id = auth.uid() and (p_place is null or c.place_id = p_place)
    order by c.created_at desc, c.id limit 25 offset greatest(coalesce(p_offset, 0), 0)
  ) x;
$$;
revoke execute on function public.my_help_requests(uuid, integer) from public, anon;
grant execute on function public.my_help_requests(uuid, integer) to authenticated;

create or replace function public.confirm_help_resolution(p_case uuid, p_version integer, p_fixed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c public.recovery_cases;
begin
  select * into c from public.recovery_cases where id = p_case for update;
  if not found or c.requester_id is distinct from auth.uid() then raise exception 'This is not your help request.'; end if;
  if c.version is distinct from p_version then raise exception 'This request changed. Refresh it before answering.'; end if;
  if c.status <> 'resolved' or c.confirmation = 'fixed' or p_fixed is null then raise exception 'There is no resolution waiting for confirmation.'; end if;
  update public.recovery_cases set confirmation = case when p_fixed then 'fixed' else 'not_fixed' end,
    confirmed_at = now(), status = case when p_fixed then 'resolved' else 'open' end,
    resolved_at = case when p_fixed then c.resolved_at end,
    due_at = case when p_fixed then c.due_at else now() + interval '30 minutes' end,
    version = c.version + 1 where id = p_case;
end $$;
revoke execute on function public.confirm_help_resolution(uuid, integer, boolean) from public, anon;
grant execute on function public.confirm_help_resolution(uuid, integer, boolean) to authenticated;

-- Help requests are always readable by the owner, including after a subscription expires.
-- Keep the legacy notes API shape intact; exclude cases from its list to avoid duplicate handling.
create or replace function public.my_owner_notes(p_place uuid)
returns table (id uuid, item_name text, created_at timestamptz, read_at timestamptz, locked boolean, body text, contact text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.can_manage_place(p_place), false) then raise exception 'Only the shop owner can read notes.'; end if;
  return query select n.id, i.name, n.created_at, n.read_at, false, n.body, n.contact
    from public.owner_notes n left join public.items i on i.id = n.item_id
    where n.place_id = p_place and not exists (select 1 from public.recovery_cases c where c.note_id = n.id)
    order by n.created_at desc limit 100;
end $$;
create or replace function public.mark_note_read(p_note uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_place uuid;
begin
  select place_id into v_place from public.owner_notes where id = p_note;
  if v_place is null or not coalesce(public.can_manage_place(v_place), false) then raise exception 'Only the shop owner can read notes.'; end if;
  update public.owner_notes set read_at = coalesce(read_at, now()) where id = p_note;
end $$;
revoke execute on function public.my_owner_notes(uuid) from public, anon;
revoke execute on function public.mark_note_read(uuid) from public, anon;
grant execute on function public.my_owner_notes(uuid), public.mark_note_read(uuid) to authenticated;

-- Owner home includes actionable help counts; existing review and billing fields retain their shape.
create or replace function public.owner_today(p_place uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz    text;
  today date;
  card  public.stamp_cards;
  res   jsonb;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  select coalesce(p.time_zone, 'Asia/Kolkata') into tz from public.places p where p.id = p_place;
  if tz is null then return null; end if;
  today := (now() at time zone tz)::date;
  select * into card from public.stamp_cards sc where sc.place_id = p_place and sc.active;

  with v as (
    select v.user_id, v.source, v.near, (v.scanned_at at time zone tz)::date as day
    from public.visits v
    where v.place_id = p_place and v.scanned_at > now() - interval '15 days'
  ),
  r as (
    select r.rating, r.owner_reply, r.created_at, (r.created_at at time zone tz)::date as day
    from public.reviews r
    where r.place_id = p_place and r.status = 'published'
  ),
  days as (select generate_series(today - 13, today, interval '1 day')::date as day)
  select jsonb_build_object(
    'today', today,
    'visitors_today', (select count(distinct user_id) from v where day = today),
    'visitors_yesterday', (select count(distinct user_id) from v where day = today - 1),
    'scans_today', (select count(*) from v where day = today and source = 'qr'),
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
                'day', d.day,
                'visitors', (select count(distinct user_id) from v where v.day = d.day),
                'reviews', (select count(*) from r where r.day = d.day)) order by d.day), '[]'::jsonb) from days d),
    'reviews_today', (select count(*) from r where day = today),
    'reviews_7d', (select count(*) from r where day > today - 7),
    'reviews', (select count(*) from r),
    'avg_rating', (select round(avg(rating)::numeric, 1) from r),
    'need_reply', (select count(*) from r where owner_reply is null),
    'low_open', (select count(*) from r where owner_reply is null and rating <= 2 and created_at > now() - interval '30 days'),
    'notes_unread', (select count(*) from public.owner_notes n where n.place_id = p_place and n.read_at is null and not exists (select 1 from public.recovery_cases c where c.note_id = n.id)),
    'recovery_open', (select count(*) from public.recovery_cases c where c.place_id = p_place and c.status <> 'resolved'),
    'recovery_overdue', (select count(*) from public.recovery_cases c where c.place_id = p_place and c.status <> 'resolved' and c.due_at < now()),
    'recovery_resolved_30d', (select count(*) from public.recovery_cases c where c.place_id = p_place and c.status = 'resolved' and c.resolved_at >= now() - interval '30 days'),
    'recovery_confirmed_30d', (select count(*) from public.recovery_cases c where c.place_id = p_place and c.status = 'resolved' and c.confirmation = 'fixed' and c.resolved_at >= now() - interval '30 days'),
    'deals_live', (select count(*) from public.shop_deals d where d.place_id = p_place and d.active
                     and (d.valid_until is null or d.valid_until >= today)),
    'deals_on_now', (select count(*) from public.shop_deals d where d.place_id = p_place
                       and public.deal_on_at(d, (now() at time zone tz)::timestamp)),
    'deal_uses_today', (select count(*) from public.deal_uses u join public.shop_deals d on d.id = u.deal_id
                          where d.place_id = p_place and u.local_day = today),
    'stamp_goal', card.goal,
    'stamp_reward', card.reward,
    'stamps_today', case when card.place_id is null then 0 else
                      (select count(distinct user_id) from v where day = today and source = 'qr' and near is distinct from false) end,
    'rewards_today', (select count(*) from public.stamp_rewards sr where sr.place_id = p_place
                        and (sr.used_at at time zone tz)::date = today),
    'offers_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days'),
    'offers_seen_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days' and o.seen_at is not null),
    'offers_used_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days' and o.used_at is not null),
    'updates_today', (select count(*) from public.place_updates u where u.place_id = p_place and u.created_at > now() - interval '1 day'),
    'qr_active', (select count(*) from public.qr_codes q where q.place_id = p_place and q.active),
    'qr_limit', public.place_qr_limit(p_place),
    'plan', s.plan,
    'plan_name', pl.name,
    'plan_status', s.status,
    'period_end', s.period_end,
    'trial_reviews_left', s.trial_reviews_left,
    'reviews_open', public.reviews_open(p_place)
  ) into res
  from (select 1) one
  left join public.subscriptions s on s.place_id = p_place
  left join public.plans pl on pl.code = s.plan;
  return res;
end $$;
revoke execute on function public.owner_today(uuid) from public, anon;
grant execute on function public.owner_today(uuid) to authenticated;
