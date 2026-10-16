-- Trusted Picks: small helpers the web app uses.

-- Read a place's coordinates as plain numbers (the column itself is binary).
create or replace function public.place_latlng(p_place uuid)
returns table (lat double precision, lng double precision)
language sql stable security definer set search_path = public, extensions as $$
  select st_y(location::geometry), st_x(location::geometry)
  from public.places where id = p_place and location is not null and (status = 'live' or public.is_admin());
$$;

-- Admins set a place's coordinates from numbers.
create or replace function public.set_place_location(p_place uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.places
    set location = case when p_lat is null or p_lng is null then null
                        else st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end
    where id = p_place;
end $$;

-- Extend a listing by a year from today or from its current end date, whichever is later.
create or replace function public.renew_listing(p_place uuid, p_provider_ref text default null)
returns public.places language plpgsql security definer set search_path = public as $$
declare pl public.places; start_d date;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into pl from public.places where id = p_place for update;
  if not found then raise exception 'place not found'; end if;
  start_d := greatest(current_date, coalesce(pl.listed_until, current_date));
  update public.places set listed_until = start_d + interval '1 year', status = 'live'
    where id = p_place returning * into pl;
  insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, period_start, period_end)
  values (p_place, 'listing', public.setting_int('listing_price_inr', 199), 'manual', p_provider_ref, start_d, start_d + interval '1 year');
  return pl;
end $$;

insert into public.app_settings (key, value) values
  ('upi_id', '""'), ('payee_name', '"Trusted Picks"'), ('support_phone', '""')
on conflict (key) do nothing;
