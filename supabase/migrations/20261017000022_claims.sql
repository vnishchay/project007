-- Trusted Picks: owners claim their shop. Proof = standing at the shop (location check)
-- plus a photo of the shop front. An admin approves; the claimer becomes the owner.
-- If the shop already has an owner, the request is "access" and the admin decides.
-- Locations are never stored, only whether the person was near the shop.

insert into storage.buckets (id, name, public) values ('claim-photos', 'claim-photos', false)
on conflict (id) do nothing;
drop policy if exists "own claim photos" on storage.objects;
create policy "own claim photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-photos' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists "admins read claim photos" on storage.objects;
create policy "admins read claim photos" on storage.objects for select to authenticated
  using (bucket_id = 'claim-photos' and (public.is_admin() or split_part(name, '/', 1) = auth.uid()::text));

create table if not exists public.place_claims (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null default 'claim' check (kind in ('claim', 'access')),
  near        boolean,
  photo_path  text,
  role        text,
  phone       text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create unique index if not exists place_claims_one_open on public.place_claims (place_id, user_id) where status = 'pending';
alter table public.place_claims enable row level security;
drop policy if exists "own claims readable" on public.place_claims;
create policy "own claims readable" on public.place_claims for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke all on public.place_claims from anon, authenticated;
grant select on public.place_claims to authenticated;

-- Start a claim. Signed-in, non-guest accounts only; 3 open claims at a time.
create or replace function public.claim_place(p_place uuid, p_lat double precision, p_lng double precision,
                                              p_photo text, p_role text default null, p_phone text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare pl public.places; v_near boolean; v_kind text;
begin
  if auth.uid() is null or public.is_guest() then raise exception 'sign in to claim a shop'; end if;
  select * into pl from public.places where id = p_place;
  if pl.id is null then raise exception 'shop not found'; end if;
  if pl.owner_id = auth.uid() then return 'owner'; end if;
  if p_photo is null or split_part(p_photo, '/', 1) <> auth.uid()::text then raise exception 'add a photo of the shop front'; end if;
  if (select count(*) from public.place_claims where user_id = auth.uid() and status = 'pending') >= 3 then
    raise exception 'you have 3 claims waiting. We''ll check them soon';
  end if;
  if pl.location is not null and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_near := st_dwithin(pl.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, 300);
  end if;
  v_kind := case when pl.owner_id is null then 'claim' else 'access' end;
  insert into public.place_claims (place_id, user_id, kind, near, photo_path, role, phone)
  values (p_place, auth.uid(), v_kind, v_near, p_photo, left(btrim(coalesce(p_role, '')), 60), left(btrim(coalesce(p_phone, '')), 20))
  on conflict (place_id, user_id) where status = 'pending'
  do update set near = excluded.near, photo_path = excluded.photo_path, role = excluded.role, phone = excluded.phone, created_at = now();
  return v_kind;
end $$;
grant execute on function public.claim_place(uuid, double precision, double precision, text, text, text) to authenticated;

-- Admin: open claims with what they need to decide.
create or replace function public.admin_claims()
returns table (id uuid, place_id uuid, place_name text, area text, kind text, near boolean, photo_path text,
               role text, phone text, claimer_name text, has_owner boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.place_id, p.name, p.area, c.kind, c.near, c.photo_path, c.role, c.phone,
         pr.display_name, p.owner_id is not null, c.created_at
  from public.place_claims c join public.places p on p.id = c.place_id
  left join public.profiles pr on pr.id = c.user_id
  where public.is_admin() and c.status = 'pending'
  order by c.created_at;
$$;
grant execute on function public.admin_claims() to authenticated;

create or replace function public.decide_claim(p_claim uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c public.place_claims;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into c from public.place_claims where id = p_claim and status = 'pending' for update;
  if c.id is null then raise exception 'claim already handled'; end if;
  update public.place_claims set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now() where id = c.id;
  if p_approve then
    update public.places set owner_id = c.user_id where id = c.place_id;
    update public.place_claims set status = 'rejected', decided_at = now()
    where place_id = c.place_id and status = 'pending' and id <> c.id;
  end if;
end $$;
grant execute on function public.decide_claim(uuid, boolean) to authenticated;
