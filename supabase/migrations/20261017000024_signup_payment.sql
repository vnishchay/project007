-- Trusted Picks: business sign-up is a step-by-step flow (shop, details, tables and QR, plan, pay).
-- Payment comes last, through Razorpay, and attaches to the sign-up request. When the team
-- approves the request, the paid plan starts on the new shop. Admins can also give or extend a
-- plan by hand and edit plan prices.

-- ---------- Sign-up requests carry the plan, tables and billing period ----------
alter table public.listing_requests add column if not exists plan text references public.plans (code);
alter table public.listing_requests add column if not exists billing_interval text check (billing_interval in ('month', 'year'));
alter table public.listing_requests add column if not exists tables integer check (tables is null or tables between 0 and 200);

create or replace function public.prepare_listing_request()
returns trigger language plpgsql set search_path = public as $$
declare pr public.plans; price integer;
begin
  new.requester_id := auth.uid();
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.place_id := null;
  select * into pr from public.plans where code = coalesce(new.plan, 'trial');
  if pr.code is null then pr.code := 'trial'; pr.qr_limit := 1; end if;
  new.plan := pr.code;
  new.billing_interval := case when pr.code = 'trial' then null else coalesce(new.billing_interval, 'year') end;
  if coalesce(new.tables, 0) > pr.qr_limit then
    raise exception 'the % plan includes % review QR%', pr.name, pr.qr_limit, case when pr.qr_limit = 1 then '' else 's' end;
  end if;
  new.wants_qr := coalesce(new.tables, 0) > 0 or new.wants_qr;
  price := case when pr.code = 'trial' then 0
                when new.billing_interval = 'month' then coalesce(pr.price_inr_month, 0)
                else coalesce(pr.price_inr_year, 0) end;
  new.listing_inr := price;
  new.qr_inr := 0;
  new.amount_inr := price;
  return new;
end $$;

-- ---------- One place to start or extend a plan ----------
create or replace function public.apply_plan(p_place uuid, p_plan text, p_interval text, p_months integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.subscriptions; base timestamptz; span interval;
begin
  select * into s from public.subscriptions where place_id = p_place for update;
  base := case when s.place_id is not null and s.status in ('active', 'past_due', 'cancelled') and s.period_end > now()
               then s.period_end else now() end;
  span := case when p_months is not null then make_interval(months => p_months)
               when p_interval = 'month' then interval '1 month' else interval '1 year' end;
  insert into public.subscriptions (place_id, plan, status, period_end, billing_interval, updated_at)
  values (p_place, p_plan, 'active', base + span, case when p_interval in ('month', 'year') then p_interval end, now())
  on conflict (place_id) do update set plan = excluded.plan, status = 'active', period_end = excluded.period_end,
    billing_interval = excluded.billing_interval, cancel_at_period_end = false, updated_at = now();
end $$;
revoke all on function public.apply_plan(uuid, text, text, integer) from public, anon, authenticated;

-- ---------- Razorpay orders can belong to a sign-up request ----------
alter table public.billing_orders alter column place_id drop not null;
alter table public.billing_orders add column if not exists request_id uuid references public.listing_requests (id) on delete cascade;
do $$ begin
  alter table public.billing_orders add constraint billing_orders_target check (place_id is not null or request_id is not null);
exception when duplicate_object then null; end $$;
create index if not exists billing_orders_request on public.billing_orders (request_id);

drop policy if exists "owners read their orders" on public.billing_orders;
create policy "owners read their orders" on public.billing_orders for select to authenticated
  using (public.is_admin() or (place_id is not null and public.is_place_owner(place_id)) or created_by = auth.uid());

create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.billing_orders; lr public.listing_requests; rupees integer;
begin
  select * into o from public.billing_orders where provider_order_id = p_order for update;
  if o.id is null then return false; end if;
  if o.status = 'paid' then return true; end if;
  if p_amount is not null and p_amount <> o.amount_minor then
    update public.billing_orders set status = 'failed' where id = o.id;
    return false;
  end if;
  update public.billing_orders set status = 'paid', provider_payment_id = p_payment, paid_at = now() where id = o.id;
  rupees := o.amount_minor / 100;

  if o.place_id is not null then
    perform public.apply_plan(o.place_id, o.plan, o.billing_interval);
    insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
    values (o.place_id, 'listing', rupees, 'razorpay', p_payment, current_date,
            current_date + case when o.billing_interval = 'month' then interval '1 month' else interval '1 year' end);
  else
    select * into lr from public.listing_requests where id = o.request_id for update;
    update public.listing_requests set status = 'paid' where id = lr.id and status = 'pending';
    insert into public.payments (request_id, place_id, kind, amount_inr, provider, provider_ref)
    values (lr.id, lr.place_id, 'listing', rupees, 'razorpay', p_payment);
    -- Approved before it was paid: start the plan on the shop now.
    if lr.place_id is not null then perform public.apply_plan(lr.place_id, o.plan, o.billing_interval); end if;
  end if;
  return true;
end $$;
revoke all on function public.billing_mark_paid(text, text, integer) from public, anon, authenticated;

-- ---------- Approving a request starts the paid plan and makes the table QRs ----------
create or replace function public.approve_listing(
  p_request uuid, p_lat double precision default null, p_lng double precision default null,
  p_table_labels text[] default '{}')
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare lr public.listing_requests; pl public.places; lbl text; n integer;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into lr from public.listing_requests where id = p_request for update;
  if not found or lr.status not in ('pending', 'paid') then raise exception 'request cannot be approved'; end if;

  insert into public.places (google_place_id, name, category, area, city, location, status, listed_until, created_by, owner_id)
  values (nullif(lr.google_place_id, ''), lr.business_name, lr.category, lr.area, lr.city,
          case when p_lat is not null and p_lng is not null
               then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
          'live', current_date + interval '1 year', auth.uid(), lr.requester_id)
  on conflict (google_place_id) do update
    set status = 'live', listed_until = excluded.listed_until, owner_id = coalesce(public.places.owner_id, excluded.owner_id)
  returning * into pl;

  -- The shop gets a paid plan first, so its QR limit allows the tables.
  if lr.status = 'paid' and coalesce(lr.plan, 'trial') <> 'trial' then
    perform public.apply_plan(pl.id, lr.plan, coalesce(lr.billing_interval, 'year'));
  end if;

  if lr.wants_qr then
    if coalesce(array_length(p_table_labels, 1), 0) > 0 then
      foreach lbl in array p_table_labels loop
        insert into public.qr_codes (place_id, style, table_label) values (pl.id, coalesce(lr.qr_style, 'neon'), lbl);
      end loop;
    elsif coalesce(lr.tables, 0) > 0 then
      for n in 1..lr.tables loop
        insert into public.qr_codes (place_id, style, table_label) values (pl.id, coalesce(lr.qr_style, 'neon'), 'Table ' || n);
      end loop;
    else
      insert into public.qr_codes (place_id, style) values (pl.id, coalesce(lr.qr_style, 'neon'));
    end if;
  end if;

  update public.payments set place_id = pl.id where request_id = lr.id;
  update public.billing_orders set place_id = pl.id where request_id = lr.id and place_id is null;
  update public.listing_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), place_id = pl.id
    where id = lr.id;
  return pl;
end $$;

-- ---------- Admin: payments, plans, prices ----------
create or replace function public.admin_billing(p_limit integer default 100)
returns table (id uuid, place_id uuid, place_name text, plan text, billing_interval text, currency text,
               amount_minor integer, status text, provider_payment_id text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.place_id, coalesce(p.name, lr.business_name), o.plan, o.billing_interval, o.currency, o.amount_minor, o.status,
         o.provider_payment_id, o.created_at, o.paid_at
  from public.billing_orders o
  left join public.places p on p.id = o.place_id
  left join public.listing_requests lr on lr.id = o.request_id
  where public.is_admin()
  order by o.created_at desc limit least(greatest(p_limit, 1), 500);
$$;
grant execute on function public.admin_billing(integer) to authenticated;

-- Every shop with its plan, so the team can see who is paying, trialling or paused.
create or replace function public.admin_shop_plans()
returns table (place_id uuid, place_name text, area text, plan text, plan_name text, status text, period_end timestamptz,
               qr_used integer, qr_limit integer, reviews_open boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, s.plan, pl.name, s.status, s.period_end,
         (select count(*)::integer from public.qr_codes q where q.place_id = p.id and q.active), pl.qr_limit,
         public.reviews_open(p.id)
  from public.places p
  join public.subscriptions s on s.place_id = p.id
  join public.plans pl on pl.code = s.plan
  where public.is_admin()
  order by (s.status = 'expired') desc, s.period_end;
$$;
grant execute on function public.admin_shop_plans() to authenticated;

-- Give or extend a plan by hand (cash, direct UPI, a gift). Optionally records what was received.
create or replace function public.admin_set_plan(p_place uuid, p_plan text, p_months integer,
                                                 p_amount_inr integer default 0, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'unknown plan'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'choose 1 to 36 months'; end if;
  perform public.apply_plan(p_place, p_plan, null, p_months);
  if coalesce(p_amount_inr, 0) > 0 then
    insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
    values (p_place, 'listing', p_amount_inr, 'manual', nullif(btrim(coalesce(p_ref, '')), ''), current_date,
            current_date + make_interval(months => p_months));
  end if;
end $$;
grant execute on function public.admin_set_plan(uuid, text, integer, integer, text) to authenticated;

create or replace function public.admin_update_plan(p_code text, p_name text, p_qr_limit integer,
  p_price_inr_year integer, p_price_inr_month integer, p_price_usd_year integer, p_price_usd_month integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_qr_limit < 1 or p_qr_limit > 500 then raise exception 'QR limit must be 1 to 500'; end if;
  update public.plans set name = left(btrim(p_name), 40), qr_limit = p_qr_limit,
    price_inr_year = case when p_code = 'trial' then 0 else greatest(p_price_inr_year, 0) end,
    price_inr_month = case when p_code = 'trial' then 0 else greatest(p_price_inr_month, 0) end,
    price_usd_year = case when p_code = 'trial' then 0 else greatest(p_price_usd_year, 0) end,
    price_usd_month = case when p_code = 'trial' then 0 else greatest(p_price_usd_month, 0) end
  where code = p_code;
end $$;
grant execute on function public.admin_update_plan(text, text, integer, integer, integer, integer, integer) to authenticated;
