-- Trusted Picks: customer groups and tags for shops (2026-10-23).
--   * shop_visitors also returns what the automatic groups need (first visit, visits in 60 days,
--     offers used) and the shop's own tags on each person.
--   * Owners make a few tags (VIP, Family, Office lunch...) and put them on visitors.
--   * Tags are private to the shop, hold no free text about a person, never touch reviews, and are
--     removed when the person hides from the shop.

create table if not exists public.customer_tags (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  label      text not null check (length(btrim(label)) between 1 and 24),
  color      text not null default 'sky' check (color in ('sky', 'green', 'amber', 'coral', 'violet', 'gray')),
  created_at timestamptz not null default now()
);
create unique index if not exists customer_tags_label_idx on public.customer_tags (place_id, lower(btrim(label)));
alter table public.customer_tags enable row level security;
revoke all on public.customer_tags from anon, authenticated;

create table if not exists public.customer_tag_links (
  tag_id     uuid not null references public.customer_tags (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  place_id   uuid not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tag_id, user_id)
);
create index if not exists customer_tag_links_place_idx on public.customer_tag_links (place_id, user_id);
alter table public.customer_tag_links enable row level security;
revoke all on public.customer_tag_links from anon, authenticated;

-- The shop's tags, with how many people carry each.
create or replace function public.shop_customer_tags(p_place uuid)
returns table (id uuid, label text, color text, people integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  select t.id, t.label, t.color, (select count(*)::integer from public.customer_tag_links l where l.tag_id = t.id)
  from public.customer_tags t where t.place_id = p_place
  order by t.created_at;
end $$;
revoke execute on function public.shop_customer_tags(uuid) from public, anon;
grant execute on function public.shop_customer_tags(uuid) to authenticated;

-- Make a tag (p_id null) or rename / recolour one. Up to 12 per shop.
create or replace function public.save_customer_tag(p_place uuid, p_label text, p_color text default 'sky', p_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can do this'; end if;
  if length(btrim(coalesce(p_label, ''))) not between 1 and 24 then raise exception 'give the tag a short name, up to 24 letters'; end if;
  if exists (select 1 from public.customer_tags where place_id = p_place and lower(btrim(label)) = lower(btrim(p_label)) and id is distinct from p_id) then
    raise exception 'you already have a tag called %', btrim(p_label);
  end if;
  if p_id is null then
    if (select count(*) from public.customer_tags where place_id = p_place) >= 12 then raise exception 'you can have up to 12 tags. Delete one first'; end if;
    insert into public.customer_tags (place_id, label, color) values (p_place, btrim(p_label), coalesce(p_color, 'sky')) returning id into t;
  else
    update public.customer_tags set label = btrim(p_label), color = coalesce(p_color, color)
     where id = p_id and place_id = p_place returning id into t;
    if t is null then raise exception 'tag not found'; end if;
  end if;
  return t;
end $$;
revoke execute on function public.save_customer_tag(uuid, text, text, uuid) from public, anon;
grant execute on function public.save_customer_tag(uuid, text, text, uuid) to authenticated;

create or replace function public.delete_customer_tag(p_place uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can do this'; end if;
  delete from public.customer_tags where id = p_id and place_id = p_place;
end $$;
revoke execute on function public.delete_customer_tag(uuid, uuid) from public, anon;
grant execute on function public.delete_customer_tag(uuid, uuid) to authenticated;

-- Put a tag on a visitor or take it off. Only people who scanned here in the last year and haven't hidden.
create or replace function public.set_customer_tag(p_place uuid, p_user uuid, p_tag uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can do this'; end if;
  if not exists (select 1 from public.customer_tags where id = p_tag and place_id = p_place) then raise exception 'tag not found'; end if;
  if not p_on then
    delete from public.customer_tag_links where tag_id = p_tag and user_id = p_user;
    return;
  end if;
  if not exists (select 1 from public.visits v where v.place_id = p_place and v.user_id = p_user and v.scanned_at > now() - interval '365 days')
     or exists (select 1 from public.shop_privacy sp where sp.place_id = p_place and sp.user_id = p_user and sp.hidden) then
    raise exception 'you can only tag people who visited and haven''t hidden';
  end if;
  insert into public.customer_tag_links (tag_id, user_id, place_id) values (p_tag, p_user, p_place) on conflict do nothing;
end $$;
revoke execute on function public.set_customer_tag(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.set_customer_tag(uuid, uuid, uuid, boolean) to authenticated;

-- Hiding from a shop takes the person out of every one of its tags.
create or replace function public.clear_tags_on_hide()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.hidden then delete from public.customer_tag_links where place_id = new.place_id and user_id = new.user_id; end if;
  return new;
end $$;
drop trigger if exists shop_privacy_clear_tags on public.shop_privacy;
create trigger shop_privacy_clear_tags after insert or update of hidden on public.shop_privacy
  for each row execute function public.clear_tags_on_hide();

-- Visitors, now with what the groups need and the shop's tags on each person.
drop function if exists public.shop_visitors(uuid, integer);
create or replace function public.shop_visitors(p_place uuid, p_days integer default 30)
returns table (user_id uuid, display_name text, avatar_path text, is_guest boolean, visits integer,
               last_visit timestamptz, last_table text, at_shop boolean, can_offer boolean, last_offer_at timestamptz,
               first_visit timestamptz, visits_60 integer, offers_used integer, tag_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  with v as (
    select vi.user_id, count(*)::integer as n, max(vi.scanned_at) as last_at,
           bool_or(coalesce(vi.near, false)) as near
    from public.visits vi
    where vi.place_id = p_place
      and vi.scanned_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
    group by vi.user_id)
  select v.user_id,
         nullif(btrim(pr.display_name), ''),
         pr.avatar_path,
         coalesce(au.is_anonymous, false),
         v.n, v.last_at,
         (select qc.table_label from public.visits l left join public.qr_codes qc on qc.id = l.qr_code_id
           where l.user_id = v.user_id and l.place_id = p_place order by l.scanned_at desc limit 1),
         v.near,
         not coalesce(sp.no_offers, false) and not exists (
           select 1 from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id and o.created_at > now() - interval '1 day'),
         (select max(o.created_at) from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id),
         (select min(a.scanned_at) from public.visits a where a.place_id = p_place and a.user_id = v.user_id),
         (select count(*)::integer from public.visits a where a.place_id = p_place and a.user_id = v.user_id and a.scanned_at > now() - interval '60 days'),
         (select count(*)::integer from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id and o.used_at is not null),
         coalesce((select array_agg(l.tag_id) from public.customer_tag_links l where l.place_id = p_place and l.user_id = v.user_id), '{}')
  from v
  join public.profiles pr on pr.id = v.user_id
  left join auth.users au on au.id = v.user_id
  left join public.shop_privacy sp on sp.user_id = v.user_id and sp.place_id = p_place
  where not coalesce(sp.hidden, false)
  order by v.last_at desc
  limit 500;
end $$;
revoke execute on function public.shop_visitors(uuid, integer) from public, anon;
grant execute on function public.shop_visitors(uuid, integer) to authenticated;
