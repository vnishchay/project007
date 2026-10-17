-- ===== 20261017000029_direct_listing.sql =====
-- Trusted Picks: shops list themselves straight away; there are no listing requests any more.
-- A new shop goes live at once with its free trial QR. Paid plans are bought through Razorpay on
-- the shop itself. The team then checks the listing (name, Google page, links) and marks it
-- verified or removes it. Until it is verified, the shop's links stay off its public page.

alter table public.places add column if not exists verification text not null default 'verified'
  check (verification in ('pending', 'verified', 'rejected'));
alter table public.places add column if not exists verification_note text;
alter table public.places add column if not exists contact_phone text;
create index if not exists places_verification_idx on public.places (verification) where verification = 'pending';

-- Owners can't mark their own shop verified.
create or replace function public.guard_place_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then new.verification := 'pending';
    elsif new.verification is distinct from old.verification or new.verification_note is distinct from old.verification_note then
      new.verification := old.verification; new.verification_note := old.verification_note;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists places_guard_verification on public.places;
create trigger places_guard_verification before insert or update on public.places
  for each row execute function public.guard_place_verification();

-- List a shop. Live at once, owned by the caller, waiting for the team's check.
create or replace function public.list_my_shop(
  p_name text, p_category text, p_city text, p_phone text,
  p_area text default null, p_google_place_id text default null, p_links jsonb default '[]'::jsonb,
  p_note text default null)
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places; existing public.places; recent integer;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'sign in to list a shop';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(coalesce(p_city, ''))) < 2 then
    raise exception 'add the shop name and city';
  end if;
  select count(*) into recent from public.places where owner_id = auth.uid() and created_at > now() - interval '1 day';
  if recent >= 3 then raise exception 'you can list up to 3 shops a day. Message us if you need more'; end if;

  if nullif(trim(p_google_place_id), '') is not null then
    select * into existing from public.places where google_place_id = trim(p_google_place_id);
    if found then
      if existing.owner_id = auth.uid() then return existing; end if;
      raise exception 'this Google listing is already on Trusted Picks. Claim it from its shop page instead';
    end if;
  end if;

  insert into public.places (google_place_id, name, category, area, city, status, created_by, owner_id, links,
                             verification, verification_note, contact_phone)
  values (nullif(trim(p_google_place_id), ''), trim(p_name), trim(p_category), nullif(trim(p_area), ''), trim(p_city),
          'live', auth.uid(), auth.uid(),
          coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) e
                    where coalesce(e ->> 'url', '') ~* '^https?://' and length(e ->> 'url') <= 500), '[]'::jsonb),
          'pending', nullif(left(trim(coalesce(p_note, '')), 1000), ''), nullif(trim(p_phone), ''))
  returning * into pl;
  return pl;
end $$;
revoke all on function public.list_my_shop(text, text, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.list_my_shop(text, text, text, text, text, text, jsonb, text) to authenticated;

-- Make table QRs up to what the shop's plan allows. Returns how many exist afterwards.
create or replace function public.make_table_qrs(p_place uuid, p_tables integer, p_style text default 'paper')
returns integer
language plpgsql security definer set search_path = public as $$
declare lim integer; have integer; n integer;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'not your shop'; end if;
  lim := public.place_qr_limit(p_place);
  select count(*) into have from public.qr_codes where place_id = p_place and active;
  for n in (have + 1)..least(greatest(coalesce(p_tables, 1), 1), lim, 200) loop
    insert into public.qr_codes (place_id, style, table_label) values (p_place, coalesce(nullif(p_style, ''), 'paper'), 'Table ' || n);
  end loop;
  select count(*) into have from public.qr_codes where place_id = p_place and active;
  return have;
end $$;
revoke all on function public.make_table_qrs(uuid, integer, text) from public, anon;
grant execute on function public.make_table_qrs(uuid, integer, text) to authenticated;

-- The team's check: verified puts the links on the page; rejected takes the shop down.
create or replace function public.verify_place(p_place uuid, p_ok boolean, p_note text default null,
  p_lat double precision default null, p_lng double precision default null)
returns public.places
language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.places set
    verification = case when p_ok then 'verified' else 'rejected' end,
    verification_note = nullif(trim(coalesce(p_note, '')), ''),
    status = case when p_ok then status else 'removed' end,
    location = case when p_lat is not null and p_lng is not null
                    then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography else location end
  where id = p_place
  returning * into pl;
  if pl.id is null then raise exception 'shop not found'; end if;
  return pl;
end $$;
revoke all on function public.verify_place(uuid, boolean, text, double precision, double precision) from public, anon;
grant execute on function public.verify_place(uuid, boolean, text, double precision, double precision) to authenticated;

-- Everyone can see whether a shop is verified (the page hides links until it is).
grant select (verification) on public.places to anon, authenticated;

-- Your shops, now with their check status.
drop function if exists public.my_places();
create function public.my_places()
returns table (id uuid, name text, area text, city text, status public.place_status, listed_until date,
               cover_path text, logo_path text, verification text, verification_note text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.area, p.city, p.status, p.listed_until, p.cover_path, p.logo_path,
         p.verification, case when p.verification = 'rejected' then p.verification_note end
  from public.places p
  where auth.uid() is not null and p.owner_id = auth.uid()
  order by p.name;
$$;
grant execute on function public.my_places() to authenticated;

-- The team's queue of shops to check.
create or replace function public.admin_places_to_verify()
returns table (id uuid, name text, category text, area text, city text, google_place_id text, links jsonb,
               contact_phone text, verification_note text, owner_name text, created_at timestamptz, has_location boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.area, p.city, p.google_place_id, p.links, p.contact_phone, p.verification_note,
         pr.display_name, p.created_at, p.location is not null
  from public.places p left join public.profiles pr on pr.id = p.owner_id
  where public.is_admin() and p.verification = 'pending'
  order by p.created_at;
$$;
revoke all on function public.admin_places_to_verify() from public, anon;
grant execute on function public.admin_places_to_verify() to authenticated;
