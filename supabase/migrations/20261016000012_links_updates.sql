-- Trusted Picks: a shop's links (Swiggy, Zomato, Instagram, website...), short updates
-- from the shop to its customers, and numbers that show the owner what the app brings in.

-- ---------- Links ----------
-- [{ "kind": "zomato", "url": "https://...", "label": "Order on Zomato" }, ...]
alter table public.places add column if not exists links jsonb not null default '[]'::jsonb;

create or replace function public.check_place_links()
returns trigger language plpgsql set search_path = public as $$
declare l jsonb;
begin
  if jsonb_typeof(new.links) <> 'array' then raise exception 'links must be a list'; end if;
  if jsonb_array_length(new.links) > 12 then raise exception 'up to 12 links'; end if;
  for l in select * from jsonb_array_elements(new.links) loop
    if coalesce(l ->> 'url', '') !~* '^(https?://|tel:|mailto:)' or length(l ->> 'url') > 500 then
      raise exception 'each link needs a web address starting with https://';
    end if;
    if length(coalesce(l ->> 'label', '')) > 40 then raise exception 'keep link names under 40 characters'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists places_check_links on public.places;
create trigger places_check_links before insert or update of links on public.places
  for each row execute function public.check_place_links();

grant select (links) on public.places to anon, authenticated;

-- ---------- Updates from the shop ----------
create table if not exists public.place_updates (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 280),
  link_url   text check (link_url is null or (link_url ~* '^https?://' and length(link_url) <= 500)),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists place_updates_place_idx on public.place_updates (place_id, created_at desc);
alter table public.place_updates enable row level security;

drop policy if exists "updates readable" on public.place_updates;
create policy "updates readable" on public.place_updates for select
  using (exists (select 1 from public.places p where p.id = place_id and p.status = 'live'));
drop policy if exists "owners post updates" on public.place_updates;
create policy "owners post updates" on public.place_updates for insert to authenticated
  with check ((public.is_place_owner(place_id) or public.is_admin()) and created_by = auth.uid());
drop policy if exists "owners delete updates" on public.place_updates;
create policy "owners delete updates" on public.place_updates for delete to authenticated
  using (public.is_place_owner(place_id) or public.is_admin());
-- Who posted is not shown to customers.
revoke select on public.place_updates from anon, authenticated;
grant select (id, place_id, body, link_url, created_at) on public.place_updates to anon, authenticated;
grant insert (place_id, body, link_url, created_by), delete on public.place_updates to authenticated;

-- A few a day is plenty; stops a shop from spamming its customers.
create or replace function public.limit_place_updates()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.place_updates where place_id = new.place_id and created_at > now() - interval '1 day') >= 3 then
    raise exception 'you can post 3 updates a day';
  end if;
  return new;
end $$;
drop trigger if exists place_updates_limit on public.place_updates;
create trigger place_updates_limit before insert on public.place_updates
  for each row execute function public.limit_place_updates();

-- Updates from shops you saved or reviewed. The shop never learns who you are.
create or replace function public.my_shop_updates(p_limit integer default 10)
returns table (id uuid, place_id uuid, place_name text, logo_path text, body text, link_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.place_id, p.name, p.logo_path, u.body, u.link_url, u.created_at
  from public.place_updates u
  join public.places p on p.id = u.place_id and p.status = 'live'
  where auth.uid() is not null
    and u.created_at > now() - interval '30 days'
    and (exists (select 1 from public.saved_places s where s.user_id = auth.uid() and s.place_id = u.place_id)
         or exists (select 1 from public.reviews r where r.user_id = auth.uid() and r.place_id = u.place_id))
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;
revoke execute on function public.my_shop_updates(integer) from public, anon;
grant execute on function public.my_shop_updates(integer) to authenticated;

-- ---------- What the app brings the shop ----------
-- Counts only, never who. Shown to the owner and admins.
create or replace function public.shop_stats(p_place uuid)
returns table (reviews integer, avg_rating numeric, reviews_30d integer, verified integer,
               google_handoffs integer, google_handoffs_30d integer, scans_30d integer, saves integer, items_rated integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query select
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.place_id = p_place and r.status = 'published'),
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.created_at > now() - interval '30 days'),
    (select count(*)::integer from public.reviews r where r.place_id = p_place and r.status = 'published' and r.visit_id is not null),
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place),
    (select count(distinct g.review_id)::integer from public.google_shares g join public.reviews r on r.id = g.review_id where r.place_id = p_place and g.opened_at > now() - interval '30 days'),
    (select count(*)::integer from public.visits v where v.place_id = p_place and v.scanned_at > now() - interval '30 days'),
    (select count(*)::integer from public.saved_places s where s.place_id = p_place),
    (select count(distinct r.item_id)::integer from public.reviews r where r.place_id = p_place and r.status = 'published');
end $$;
revoke execute on function public.shop_stats(uuid) from public, anon;
grant execute on function public.shop_stats(uuid) to authenticated;

-- Per product: average and count, best and worst first for the owner.
create or replace function public.shop_item_stats(p_place uuid)
returns table (item_id uuid, name text, image_path text, reviews integer, avg_rating numeric, low_ratings integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
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

-- ---------- Owners connect their Google profile ----------
-- An owner may link their shop to its Google Place ID once (when none is set yet);
-- changing an existing link still goes through the Trusted Picks team.
create or replace function public.guard_place_owner_edits()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.name is distinct from old.name or new.status is distinct from old.status
     or new.listed_until is distinct from old.listed_until or new.owner_id is distinct from old.owner_id
     or (new.google_place_id is distinct from old.google_place_id and old.google_place_id is not null)
     or new.city is distinct from old.city or new.created_by is distinct from old.created_by then
    raise exception 'ask the Trusted Picks team to change the name, city, Google link or listing dates';
  end if;
  return new;
end $$;
