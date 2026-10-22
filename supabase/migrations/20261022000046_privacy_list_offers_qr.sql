-- Trusted Picks: fixes from the UX review (2026-10-22).
--   * Diners get one list of the shops that can see them, with Hide and Offers switches.
--   * Owners see the offers they sent and how many people saw each one.
--   * Owners can rename a table QR or turn off a lost one (before, only admins could).

-- Every shop the diner scanned at in the last year, with their privacy settings for it.
create or replace function public.my_shop_privacy_list()
returns table (place_id uuid, place_name text, area text, logo_path text, last_visit timestamptz, hidden boolean, no_offers boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, p.logo_path, v.last_at,
         coalesce(sp.hidden, false), coalesce(sp.no_offers, false)
  from (select vi.place_id, max(vi.scanned_at) as last_at
        from public.visits vi
        where vi.user_id = auth.uid() and vi.scanned_at > now() - interval '365 days'
        group by vi.place_id) v
  join public.places p on p.id = v.place_id
  left join public.shop_privacy sp on sp.user_id = auth.uid() and sp.place_id = v.place_id
  where auth.uid() is not null
  order by v.last_at desc
  limit 200;
$$;
revoke execute on function public.my_shop_privacy_list() from public, anon;
grant execute on function public.my_shop_privacy_list() to authenticated;

-- Offers this shop sent, one row per send (same text within the same minute), newest first.
create or replace function public.shop_offers_sent(p_place uuid, p_limit integer default 20)
returns table (body text, link_url text, sent_at timestamptz, recipients integer, seen integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return query
  select o.body, o.link_url, min(o.created_at), count(*)::integer, count(o.seen_at)::integer
  from public.visitor_offers o
  where o.place_id = p_place
  group by o.body, o.link_url, date_trunc('minute', o.created_at)
  order by min(o.created_at) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke execute on function public.shop_offers_sent(uuid, integer) from public, anon;
grant execute on function public.shop_offers_sent(uuid, integer) to authenticated;

-- Rename a table code, or turn it off (a lost or damaged card) and back on. Turning on again
-- counts against the plan's QR limit like any other active code.
create or replace function public.owner_update_qr(p_qr uuid, p_label text default null, p_active boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
declare q public.qr_codes; used integer;
begin
  select * into q from public.qr_codes where id = p_qr;
  if q.id is null then raise exception 'code not found'; end if;
  if not (public.is_admin() or public.is_place_owner(q.place_id)) then raise exception 'not your shop'; end if;
  if p_active is true and not q.active then
    select count(*) into used from public.qr_codes where place_id = q.place_id and active;
    if used >= public.place_qr_limit(q.place_id) then raise exception 'your plan has no free QR codes. Turn another one off first, or get a bigger plan'; end if;
  end if;
  update public.qr_codes
     set table_label = case when p_label is null then table_label else nullif(left(btrim(p_label), 40), '') end,
         active = coalesce(p_active, active)
   where id = p_qr;
end $$;
revoke execute on function public.owner_update_qr(uuid, text, boolean) from public, anon;
grant execute on function public.owner_update_qr(uuid, text, boolean) to authenticated;
