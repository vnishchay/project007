-- Trusted Picks: the per-QR review limit is three times as generous, so it never blocks real customers.
-- Each QR holds 3x the review tickets (at most 20) and a ticket comes back 3x as fast (at least every 30 seconds).
-- Still sized by business type, and a shop's own per-QR numbers are multiplied the same way.
create or replace function public.qr_jar(p_qr uuid)
returns table (size integer, refill integer)
language sql stable security definer set search_path = public as $$
  select least(20, 3 * coalesce(q.jar_size, q.seats, case coalesce(p.kind, 'food')
           when 'food' then 4 when 'store' then 3 when 'beauty' then 1 when 'health' then 1 else 2 end))::integer,
         greatest(30, coalesce(q.refill_seconds, case coalesce(p.kind, 'food')
           when 'food' then 900 when 'store' then 120 when 'beauty' then 1500 when 'health' then 1500
           when 'fitness' then 3600 when 'education' then 3600 when 'services' then 3600 else 600 end) / 3)::integer
  from public.qr_codes q join public.places p on p.id = q.place_id where q.id = p_qr;
$$;
