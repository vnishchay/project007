-- Trusted Picks: FTC-compliant Reputation Shield & VIP Private Feedback
-- Diners can send private feedback directly to the restaurant owner/management
-- to resolve issues (vouchers, apologies, fixes) instead of venting on Google Maps.

create table if not exists public.place_feedback (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places (id) on delete cascade,
  review_id    uuid references public.reviews (id) on delete set null,
  user_id      uuid references public.profiles (id) on delete set null,
  rating       smallint check (rating between 1 and 5),
  item_name    text,
  message      text not null check (length(btrim(message)) between 1 and 2000),
  contact_info text check (contact_info is null or length(contact_info) <= 200),
  status       text not null default 'unread' check (status in ('unread', 'resolved', 'archived')),
  created_at   timestamptz not null default now()
);

create index if not exists place_feedback_place_idx on public.place_feedback (place_id, created_at desc);

alter table public.place_feedback enable row level security;

-- Owners & admins can view feedback for their place
drop policy if exists "owners read place feedback" on public.place_feedback;
create policy "owners read place feedback" on public.place_feedback for select to authenticated
  using (public.is_place_owner(place_id) or public.is_admin());

-- Owners & admins can update status (e.g. mark resolved)
drop policy if exists "owners update place feedback" on public.place_feedback;
create policy "owners update place feedback" on public.place_feedback for update to authenticated
  using (public.is_place_owner(place_id) or public.is_admin())
  with check (public.is_place_owner(place_id) or public.is_admin());

-- RPC to submit private feedback safely from diner
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
declare
  fb_id uuid;
  msg text;
begin
  msg := btrim(coalesce(p_message, ''));
  if length(msg) < 1 then
    raise exception 'Feedback message cannot be empty';
  end if;

  insert into public.place_feedback (
    place_id,
    review_id,
    user_id,
    rating,
    item_name,
    message,
    contact_info
  ) values (
    p_place_id,
    p_review_id,
    auth.uid(),
    p_rating,
    nullif(btrim(p_item_name), ''),
    msg,
    nullif(btrim(p_contact), '')
  ) returning id into fb_id;

  return fb_id;
end;
$$;

grant execute on function public.submit_private_feedback to anon, authenticated;
grant select on public.place_feedback to authenticated;

-- Function for owner to get all feedback for their place
create or replace function public.get_place_feedback(p_place uuid)
returns setof public.place_feedback
language sql
stable
security definer
set search_path = public
as $$
  select * from public.place_feedback
  where place_id = p_place
    and (public.is_place_owner(p_place) or public.is_admin())
  order by created_at desc;
$$;

grant execute on function public.get_place_feedback to authenticated;
