-- Trusted Picks: shop links (Google Maps, Zomato, Swiggy, Instagram...) collected during setup.
-- The owner pastes them while setting up; approving the request puts them on the shop page.
alter table public.listing_requests add column if not exists links jsonb not null default '[]'::jsonb;

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

  insert into public.places (google_place_id, name, category, area, city, location, status, listed_until, created_by, owner_id, links)
  values (nullif(lr.google_place_id, ''), lr.business_name, lr.category, lr.area, lr.city,
          case when p_lat is not null and p_lng is not null
               then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
          'live', current_date + interval '1 year', auth.uid(), lr.requester_id,
          coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(lr.links, '[]'::jsonb)) e
                    where coalesce(e ->> 'url', '') ~* '^(https?://|tel:|mailto:)' and length(e ->> 'url') <= 500), '[]'::jsonb))
  on conflict (google_place_id) do update
    set status = 'live', listed_until = excluded.listed_until, owner_id = coalesce(public.places.owner_id, excluded.owner_id),
        links = case when jsonb_array_length(public.places.links) = 0 then excluded.links else public.places.links end
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
