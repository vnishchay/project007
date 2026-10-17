-- Trusted Picks: Razorpay payments for plans (India). One payment buys a month or a year;
-- nothing renews on its own, so there's no lock-in and nothing to cancel.
-- Only the edge functions "billing" and "billing-webhook" (service role) write here.

create table if not exists public.billing_orders (
  id                   uuid primary key default gen_random_uuid(),
  place_id             uuid not null references public.places (id) on delete cascade,
  plan                 text not null references public.plans (code),
  billing_interval     text not null check (billing_interval in ('month', 'year')),
  currency             text not null default 'INR',
  amount_minor         integer not null check (amount_minor > 0),
  provider             text not null default 'razorpay',
  provider_order_id    text unique,
  provider_payment_id  text,
  status               text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded')),
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  paid_at              timestamptz
);
create index if not exists billing_orders_place on public.billing_orders (place_id, created_at desc);
alter table public.billing_orders enable row level security;
drop policy if exists "owners read their orders" on public.billing_orders;
create policy "owners read their orders" on public.billing_orders for select to authenticated
  using (public.is_place_owner(place_id) or public.is_admin());
revoke all on public.billing_orders from anon, authenticated;
grant select on public.billing_orders to authenticated;

-- Each provider event is handled once.
create table if not exists public.billing_events (
  id           text primary key,
  provider     text not null default 'razorpay',
  kind         text not null,
  received_at  timestamptz not null default now()
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

-- Marks an order paid and extends the shop's plan. Safe to call twice (verify + webhook).
-- Time left on a paid plan carries over; a trial ends when a plan starts.
create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.billing_orders; s public.subscriptions; base timestamptz;
begin
  select * into o from public.billing_orders where provider_order_id = p_order for update;
  if o.id is null then return false; end if;
  if o.status = 'paid' then return true; end if;
  if p_amount is not null and p_amount <> o.amount_minor then
    update public.billing_orders set status = 'failed' where id = o.id;
    return false;
  end if;
  update public.billing_orders set status = 'paid', provider_payment_id = p_payment, paid_at = now() where id = o.id;
  select * into s from public.subscriptions where place_id = o.place_id for update;
  base := case when s.status in ('active', 'past_due', 'cancelled') and s.period_end > now() then s.period_end else now() end;
  insert into public.subscriptions (place_id, plan, status, period_end, billing_interval, provider, updated_at)
  values (o.place_id, o.plan, 'active', base + case when o.billing_interval = 'year' then interval '1 year' else interval '1 month' end,
          o.billing_interval, 'razorpay', now())
  on conflict (place_id) do update set plan = excluded.plan, status = 'active', period_end = excluded.period_end,
    billing_interval = excluded.billing_interval, provider = 'razorpay', cancel_at_period_end = false, updated_at = now();
  return true;
end $$;
revoke all on function public.billing_mark_paid(text, text, integer) from public, anon, authenticated;

-- Admins see every plan payment.
create or replace function public.admin_billing(p_limit integer default 100)
returns table (id uuid, place_id uuid, place_name text, plan text, billing_interval text, currency text,
               amount_minor integer, status text, provider_payment_id text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.place_id, p.name, o.plan, o.billing_interval, o.currency, o.amount_minor, o.status,
         o.provider_payment_id, o.created_at, o.paid_at
  from public.billing_orders o join public.places p on p.id = o.place_id
  where public.is_admin()
  order by o.created_at desc limit least(greatest(p_limit, 1), 500);
$$;
grant execute on function public.admin_billing(integer) to authenticated;
