-- Trusted Picks: Phase A & B Improvements
-- 1. Diet tags on items: veg, non_veg, egg, vegan, jain, gluten_free
-- 2. Owner notes & FTC Reputation Shield (private feedback to management)
-- 3. Plan feature checks (place_has_feature) for gated insights and blurred notes

-- 1. Diet tags on items
alter table public.items add column if not exists diet text[] default '{}';

alter table public.items drop constraint if exists items_diet_chk;
alter table public.items add constraint items_diet_chk check (
  diet is null or diet <@ array['veg', 'non_veg', 'egg', 'vegan', 'jain', 'gluten_free']::text[]
);

-- 2. Owner notes (Private diner notes to management)
create table if not exists public.owner_notes (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places (id) on delete cascade,
  review_id    uuid references public.reviews (id) on delete set null,
  item_id      uuid references public.items (id) on delete set null,
  body         text not null check (length(btrim(body)) between 1 and 2000),
  contact      text check (contact is null or length(contact) <= 200),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  replied_at   timestamptz
);

create index if not exists owner_notes_place_idx on public.owner_notes (place_id, created_at desc);

alter table public.owner_notes enable row level security;

-- Owners read own place's notes
drop policy if exists "owners read notes" on public.owner_notes;
create policy "owners read notes" on public.owner_notes for select to authenticated
  using (public.is_place_owner(place_id) or public.is_admin());

-- Owners update notes (mark read/replied)
drop policy if exists "owners update notes" on public.owner_notes;
create policy "owners update notes" on public.owner_notes for update to authenticated
  using (public.is_place_owner(place_id) or public.is_admin())
  with check (public.is_place_owner(place_id) or public.is_admin());

-- RPC to send note safely from diner
create or replace function public.send_owner_note(
  p_place uuid,
  p_body text,
  p_item uuid default null,
  p_contact text default null,
  p_review uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nid uuid;
  msg text;
begin
  msg := btrim(coalesce(p_body, ''));
  if length(msg) < 1 then
    raise exception 'Note cannot be empty';
  end if;

  insert into public.owner_notes (place_id, review_id, item_id, body, contact)
  values (p_place, p_review, p_item, msg, nullif(btrim(p_contact), ''))
  returning id into nid;

  return nid;
end;
$$;

grant execute on function public.send_owner_note to anon, authenticated;

-- Also support submit_private_feedback for backwards compatibility
create or replace function public.submit_private_feedback(
  p_place_id uuid,
  p_review_id uuid default null,
  p_message text default '',
  p_contact text default null,
  p_rating smallint default null,
  p_item_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.send_owner_note(p_place_id, p_message, null, p_contact, p_review_id);
end;
$$;

grant execute on function public.submit_private_feedback to anon, authenticated;

-- 3. Plan feature checks (place_has_feature)
create or replace function public.place_has_feature(p_place uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sub_plan text;
  sub_status text;
  plan_order integer;
begin
  if public.is_admin() then
    return true;
  end if;

  select s.plan, s.status, coalesce(p.sort_order, 0)
    into sub_plan, sub_status, plan_order
  from public.subscriptions s
  left join public.plans p on p.code = s.plan
  where s.place_id = p_place;

  if sub_plan is null then
    return false;
  end if;

  if sub_status in ('cancelled', 'expired', 'past_due') then
    return false;
  end if;

  if p_feature = 'insights' or p_feature = 'notes' then
    -- Available on standard, pro, growth_pro, autopilot_vip (sort_order >= 2)
    return plan_order >= 2;
  elsif p_feature = 'ai_insights' then
    -- Available on pro, growth_pro, autopilot_vip (sort_order >= 3)
    return plan_order >= 3;
  else
    return false;
  end if;
end;
$$;

grant execute on function public.place_has_feature to anon, authenticated;
