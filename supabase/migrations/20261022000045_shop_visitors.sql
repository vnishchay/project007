-- Trusted Picks: shops can see who scanned their QR codes and send them an offer.
-- Decided by Akanksha on 2026-10-22: owners see visitors by name so they can reach them.
-- What stays private:
--   * Reviews are never linked to a visitor here, so an anonymous review stays anonymous.
--   * No email, phone or location is shared, only the profile name and photo (or "Guest").
--   * The diner is told on the scan page and can hide from that shop with one tap; hiding also
--     stops its offers. They can stop offers alone from any offer card.
-- Offers can't be tied to reviewing (Google's rules), and each person gets at most one offer per
-- shop per day.

-- One row per diner and shop, only once they change something. No row = shown, offers on.
create table if not exists public.shop_privacy (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  place_id   uuid not null references public.places (id) on delete cascade,
  hidden     boolean not null default false,   -- the shop doesn't see me in its visitors
  no_offers  boolean not null default false,   -- the shop can't send me offers
  updated_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.shop_privacy enable row level security;
revoke all on public.shop_privacy from anon, authenticated;

create table if not exists public.visitor_offers (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 280),
  link_url   text check (link_url is null or (link_url ~* '^https?://' and length(link_url) <= 500)),
  sent_by    uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists visitor_offers_user_idx on public.visitor_offers (user_id, created_at desc);
create index if not exists visitor_offers_place_idx on public.visitor_offers (place_id, created_at desc);
alter table public.visitor_offers enable row level security;
revoke all on public.visitor_offers from anon, authenticated;

-- The diner's own settings for one shop.
create or replace function public.my_shop_privacy(p_place uuid)
returns table (hidden boolean, no_offers boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(sp.hidden, false), coalesce(sp.no_offers, false)
  from (select 1) one
  left join public.shop_privacy sp on sp.user_id = auth.uid() and sp.place_id = p_place
  where auth.uid() is not null;
$$;
revoke execute on function public.my_shop_privacy(uuid) from public, anon;
grant execute on function public.my_shop_privacy(uuid) to authenticated;

-- Change either setting; null leaves it as it is. Hiding also stops offers.
create or replace function public.set_shop_privacy(p_place uuid, p_hidden boolean default null, p_no_offers boolean default null)
returns table (hidden boolean, no_offers boolean)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into public.shop_privacy as sp (user_id, place_id, hidden, no_offers)
  values (auth.uid(), p_place, coalesce(p_hidden, false), coalesce(p_no_offers, false) or coalesce(p_hidden, false))
  on conflict (user_id, place_id) do update
    set hidden = coalesce(p_hidden, sp.hidden),
        no_offers = coalesce(p_no_offers, sp.no_offers) or coalesce(p_hidden, sp.hidden),
        updated_at = now();
  return query select * from public.my_shop_privacy(p_place);
end $$;
revoke execute on function public.set_shop_privacy(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_shop_privacy(uuid, boolean, boolean) to authenticated;

-- For the owner (or an admin): people who scanned in the last p_days, newest first.
create or replace function public.shop_visitors(p_place uuid, p_days integer default 30)
returns table (user_id uuid, display_name text, avatar_path text, is_guest boolean, visits integer,
               last_visit timestamptz, last_table text, at_shop boolean, can_offer boolean, last_offer_at timestamptz)
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
         (select max(o.created_at) from public.visitor_offers o where o.place_id = p_place and o.user_id = v.user_id)
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

-- Send one offer to some visitors. Skips anyone who hid, turned offers off, didn't visit in
-- the last 90 days, or already got an offer from this shop today. Returns how many got it.
create or replace function public.send_visitor_offer(p_place uuid, p_users uuid[], p_body text, p_link text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can send offers'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 280 then raise exception 'write an offer of up to 280 characters'; end if;
  if p_body ~* '\m(reviews?|ratings?|rate us)\M' then
    raise exception 'offers can''t mention reviews or ratings. Google bans rewards for reviews';
  end if;
  if coalesce(array_length(p_users, 1), 0) = 0 then raise exception 'pick at least one visitor'; end if;
  insert into public.visitor_offers (place_id, user_id, body, link_url, sent_by)
  select p_place, u, btrim(p_body), nullif(btrim(coalesce(p_link, '')), ''), auth.uid()
  from (select distinct unnest(p_users[1:500]) as u) x
  where exists (select 1 from public.visits vi where vi.place_id = p_place and vi.user_id = x.u and vi.scanned_at > now() - interval '90 days')
    and not exists (select 1 from public.shop_privacy sp where sp.place_id = p_place and sp.user_id = x.u and (sp.hidden or sp.no_offers))
    and not exists (select 1 from public.visitor_offers o where o.place_id = p_place and o.user_id = x.u and o.created_at > now() - interval '1 day');
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.send_visitor_offer(uuid, uuid[], text, text) from public, anon;
grant execute on function public.send_visitor_offer(uuid, uuid[], text, text) to authenticated;

-- The diner's offers from the last 30 days (not from shops they've since turned off).
create or replace function public.my_offers(p_limit integer default 10)
returns table (id uuid, place_id uuid, place_name text, logo_path text, body text, link_url text, created_at timestamptz, seen boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.place_id, p.name, p.logo_path, o.body, o.link_url, o.created_at, o.seen_at is not null
  from public.visitor_offers o
  join public.places p on p.id = o.place_id and p.status = 'live'
  where o.user_id = auth.uid() and auth.uid() is not null
    and o.created_at > now() - interval '30 days'
    and not exists (select 1 from public.shop_privacy sp where sp.user_id = o.user_id and sp.place_id = o.place_id and (sp.hidden or sp.no_offers))
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
revoke execute on function public.my_offers(integer) from public, anon;
grant execute on function public.my_offers(integer) to authenticated;

create or replace function public.mark_offers_seen(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.visitor_offers set seen_at = now()
  where user_id = auth.uid() and id = any(p_ids) and seen_at is null;
$$;
revoke execute on function public.mark_offers_seen(uuid[]) from public, anon;
grant execute on function public.mark_offers_seen(uuid[]) to authenticated;
