-- Trusted Picks: private notes to the owner, anonymous and visit-only, and plan checks on the server.
--  * One notes table (owner_notes). The earlier place_feedback table is folded in and dropped.
--  * A note is not linked to any review or account the owner can see. Owners read notes only through
--    my_owner_notes(); the text and contact are withheld unless the plan includes notes.
--  * Sending needs an open visit (table QR or review link) at that shop: at most 3 notes per visit and
--    5 per phone per day.
--  * place_has_feature() also checks that the plan period has not ended.
--  * shop_item_stats() returns rows only when the plan includes insights.

-- 1. owner_notes: no link to a review; remember the visit and phone only to limit abuse.
create table if not exists public.owner_notes (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places (id) on delete cascade,
  item_id      uuid references public.items (id) on delete set null,
  body         text not null check (length(btrim(body)) between 1 and 2000),
  contact      text check (contact is null or length(contact) <= 200),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  replied_at   timestamptz
);
alter table public.owner_notes drop column if exists review_id;
alter table public.owner_notes add column if not exists visit_id uuid references public.visits (id) on delete set null;
alter table public.owner_notes add column if not exists device_hash text;
create index if not exists owner_notes_place_idx on public.owner_notes (place_id, created_at desc);
create index if not exists owner_notes_visit_idx on public.owner_notes (visit_id) where visit_id is not null;
create index if not exists owner_notes_device_idx on public.owner_notes (device_hash, created_at) where device_hash is not null;

-- 2. Fold in notes from the older table, without who sent them, then drop it.
-- Clear out every overload of the old feedback functions, whatever their arguments (a database patched by hand may have others).
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('submit_private_feedback', 'get_place_feedback') loop
    execute 'drop function ' || r.sig;
  end loop;
  -- A stray my_reviews(limit, offset) made by hand makes my_reviews(p_limit => n) ambiguous for the app.
  drop function if exists public.my_reviews(integer, integer);
end $$;
do $$ begin
  if to_regclass('public.place_feedback') is not null then
    if (select relkind from pg_class where oid = 'public.place_feedback'::regclass) = 'r' then
      insert into public.owner_notes (place_id, body, contact, created_at, read_at)
      select f.place_id, left(btrim(f.message), 2000), f.contact_info, f.created_at,
             case when f.status = 'unread' then null else f.created_at end
      from public.place_feedback f
      where length(btrim(f.message)) > 0
        and not exists (select 1 from public.owner_notes n where n.place_id = f.place_id and n.created_at = f.created_at and n.body = left(btrim(f.message), 2000));
      drop table public.place_feedback;
    else
      -- Only a compatibility view over owner_notes (made by hand): nothing to copy, just remove it.
      drop view public.place_feedback cascade;
    end if;
  end if;
end $$;

-- 3. Nobody reads the table directly any more.
alter table public.owner_notes enable row level security;
drop policy if exists "owners read notes" on public.owner_notes;
drop policy if exists "owners update notes" on public.owner_notes;
revoke all on public.owner_notes from public, anon, authenticated;

-- 4. Sending a note.
drop function if exists public.send_owner_note(uuid, text, uuid, text, uuid);
create or replace function public.send_owner_note(
  p_place uuid, p_body text, p_item uuid default null, p_contact text default null, p_device text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_visit uuid; v_id uuid; v_msg text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'open the page again to send a note'; end if;
  if length(v_msg) < 1 then raise exception 'write a few words first'; end if;
  if length(v_msg) > 1000 then raise exception 'keep the note under 1,000 characters'; end if;
  if public.is_place_owner(p_place) then raise exception 'owners can''t send a note to their own shop'; end if;
  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;
  if v_visit is null then raise exception 'notes come from people at the shop. Scan the table code again'; end if;
  if (select count(*) from public.owner_notes where visit_id = v_visit) >= 3 then
    raise exception 'you''ve sent a few notes already. The owner will see them';
  end if;
  if p_device is not null and (select count(*) from public.owner_notes
       where device_hash = left(p_device, 80) and created_at > now() - interval '1 day') >= 5 then
    raise exception 'that''s a lot of notes for one day. Try again tomorrow';
  end if;
  if p_item is not null and not exists (select 1 from public.items where id = p_item and place_id = p_place) then p_item := null; end if;
  insert into public.owner_notes (place_id, item_id, body, contact, visit_id, device_hash)
  values (p_place, p_item, v_msg, nullif(left(btrim(coalesce(p_contact, '')), 200), ''), v_visit, left(p_device, 80))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.send_owner_note(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.send_owner_note(uuid, text, uuid, text, text) to authenticated;

-- 5. Plan features, checked on the server.
create or replace function public.place_has_feature(p_place uuid, p_feature text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_order integer; v_status text; v_end timestamptz;
begin
  if public.is_admin() then return true; end if;
  select coalesce(pl.sort_order, 0), s.status, s.period_end into v_order, v_status, v_end
  from public.subscriptions s left join public.plans pl on pl.code = s.plan
  where s.place_id = p_place;
  if not found then return false; end if;
  if v_status in ('cancelled', 'expired', 'past_due', 'trial') or v_end < now() then return false; end if;
  if p_feature in ('insights', 'notes') then return v_order >= 2; end if;
  if p_feature = 'ai_insights' then return v_order >= 3; end if;
  return false;
end $$;
revoke execute on function public.place_has_feature(uuid, text) from public, anon;
grant execute on function public.place_has_feature(uuid, text) to authenticated;

-- 6. Owner reads notes. Text and contact only when the plan includes notes.
create or replace function public.my_owner_notes(p_place uuid)
returns table (id uuid, item_name text, created_at timestamptz, read_at timestamptz, locked boolean, body text, contact text)
language plpgsql stable security definer set search_path = public as $$
declare v_open boolean;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  v_open := public.place_has_feature(p_place, 'notes');
  return query
    select n.id, i.name, n.created_at, n.read_at, not v_open,
           case when v_open then n.body end, case when v_open then n.contact end
    from public.owner_notes n left join public.items i on i.id = n.item_id
    where n.place_id = p_place
    order by n.created_at desc limit 100;
end $$;
revoke execute on function public.my_owner_notes(uuid) from public, anon;
grant execute on function public.my_owner_notes(uuid) to authenticated;

create or replace function public.mark_note_read(p_note uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_place uuid;
begin
  select place_id into v_place from public.owner_notes where id = p_note;
  if v_place is null then return; end if;
  if not (public.is_admin() or public.is_place_owner(v_place)) then raise exception 'only the shop owner can do this'; end if;
  if not public.place_has_feature(v_place, 'notes') then raise exception 'upgrade your plan to read notes'; end if;
  update public.owner_notes set read_at = coalesce(read_at, now()) where id = p_note;
end $$;
revoke execute on function public.mark_note_read(uuid) from public, anon;
grant execute on function public.mark_note_read(uuid) to authenticated;

-- 7. Dish-level stats follow the plan.
create or replace function public.shop_item_stats(p_place uuid)
returns table (item_id uuid, name text, image_path text, reviews integer, avg_rating numeric, low_ratings integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  if not public.place_has_feature(p_place, 'insights') then return; end if;
  return query
    select i.id, i.name, i.image_path, count(r.id)::integer, round(avg(r.rating)::numeric, 1),
           count(r.id) filter (where r.rating <= 2)::integer
    from public.items i
    join public.reviews r on r.item_id = i.id and r.status = 'published'
    where i.place_id = p_place
    group by i.id
    order by avg(r.rating) desc, count(r.id) desc;
end $$;
revoke execute on function public.shop_item_stats(uuid) from public, anon;
grant execute on function public.shop_item_stats(uuid) to authenticated;
