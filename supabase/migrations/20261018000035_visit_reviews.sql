-- Trusted Picks: a review of the whole visit. Many diners don't want to rate every dish, so the review
-- flow asks "How was your visit?" first and dishes become optional. A visit review needs the same open
-- visit as a dish review, keeps a guest to one visit per phone and place, and counts towards the daily cap.

create table if not exists public.visit_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  visit_id    uuid references public.visits (id) on delete set null,
  rating      smallint not null check (rating between 1 and 5),
  body        text not null default '' check (length(body) <= 2000),
  tags        text[] not null default '{}' check (cardinality(tags) <= 12),
  ai_drafted  boolean not null default false,
  is_public   boolean not null default false,
  by_guest    boolean not null default false,
  device_hash text,
  status      public.review_status not null default 'published',
  created_at  timestamptz not null default now()
);
create unique index if not exists visit_reviews_one_per_visit on public.visit_reviews (user_id, visit_id);
create index if not exists visit_reviews_place_idx on public.visit_reviews (place_id, status, created_at desc);
create index if not exists visit_reviews_user_idx on public.visit_reviews (user_id, created_at desc);

alter table public.visit_reviews enable row level security;
drop policy if exists visit_reviews_own on public.visit_reviews;
create policy visit_reviews_own on public.visit_reviews for select using (user_id = auth.uid());
-- Everyone else reads them through place_visit_reviews(), which never exposes who wrote an anonymous one.

create or replace function public.submit_visit_review(
  p_place_id uuid, p_rating smallint, p_body text default '', p_tags text[] default '{}',
  p_ai_drafted boolean default false, p_is_public boolean default false, p_device text default null)
returns public.visit_reviews
language plpgsql security definer set search_path = public, extensions as $$
declare v_visit uuid; r public.visit_reviews; v_guest boolean := coalesce(public.is_guest(), false); v_device text; v_tags text[];
begin
  if auth.uid() is null then raise exception 'open the review page again to continue'; end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'live') then
    raise exception 'place is not listed';
  end if;
  select v.id into v_visit from public.visits v
  where v.user_id = auth.uid() and v.place_id = p_place_id and now() between v.scanned_at and v.expires_at
  order by v.scanned_at desc limit 1;
  if v_visit is null then raise exception 'scan the table QR at the shop to write a review'; end if;
  if public.is_place_owner(p_place_id) then raise exception 'you can''t review your own shop'; end if;
  if not public.reviews_open(p_place_id) then raise exception 'reviews are paused here for now'; end if;

  v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
  if v_guest then
    if v_device is null then raise exception 'refresh the page and try again'; end if;
    if exists (select 1 from public.reviews where place_id = p_place_id and visit_id is distinct from v_visit
               and (user_id = auth.uid() or (device_hash = v_device and by_guest)))
       or exists (select 1 from public.visit_reviews where place_id = p_place_id and visit_id is distinct from v_visit
               and (user_id = auth.uid() or (device_hash = v_device and by_guest))) then
      raise exception 'you''ve already reviewed this place from this phone. Sign in to review more';
    end if;
  end if;

  if (select count(*) from public.reviews where user_id = auth.uid() and created_at > now() - interval '1 day')
     + (select count(*) from public.visit_reviews where user_id = auth.uid() and created_at > now() - interval '1 day')
     >= (case when v_guest then 5 else 25 end) then
    raise exception 'that''s a lot of reviews for one day. Try again tomorrow';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'pick how your visit went'; end if;
  if length(coalesce(p_body, '')) > 2000 then raise exception 'keep the review under 2000 characters'; end if;
  if exists (select 1 from public.visit_reviews where user_id = auth.uid() and visit_id = v_visit) then
    raise exception 'you''ve already reviewed this visit';
  end if;

  select coalesce(array_agg(t), '{}') into v_tags
  from (select distinct left(btrim(x), 30) t from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> '' limit 12) s;

  insert into public.visit_reviews (user_id, place_id, visit_id, rating, body, tags, ai_drafted, is_public, by_guest, device_hash)
  values (auth.uid(), p_place_id, v_visit, p_rating, btrim(coalesce(p_body, '')), v_tags, coalesce(p_ai_drafted, false),
          coalesce(p_is_public, false) and not v_guest, v_guest, v_device)
  returning * into r;
  return r;
end $$;
revoke execute on function public.submit_visit_review(uuid, smallint, text, text[], boolean, boolean, text) from public, anon;
grant execute on function public.submit_visit_review(uuid, smallint, text, text[], boolean, boolean, text) to authenticated;

-- Recent visit reviews for a shop page. The writer's name shows only when they chose "Show my name".
create or replace function public.place_visit_reviews(p_place uuid, p_limit integer default 20)
returns table (id uuid, rating smallint, body text, tags text[], created_at timestamptz, author text, verified boolean)
language sql stable security definer set search_path = public as $$
  select vr.id, vr.rating, vr.body, vr.tags, vr.created_at,
         case when vr.is_public then nullif(p.display_name, '') end,
         vr.visit_id is not null
  from public.visit_reviews vr
  join public.places pl on pl.id = vr.place_id and pl.status = 'live'
  left join public.profiles p on p.id = vr.user_id
  where vr.place_id = p_place and vr.status = 'published'
  order by vr.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
grant execute on function public.place_visit_reviews(uuid, integer) to anon, authenticated;

-- A guest who only reviewed the visit has also used this phone's one visit here.
create or replace function public.can_review(p_place uuid, p_device text default null)
returns table (allowed boolean, reason text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v public.visits; v_device text;
begin
  if auth.uid() is null then return query select false, 'scan', null::timestamptz; return; end if;
  select * into v from public.visits
  where user_id = auth.uid() and place_id = p_place and now() between scanned_at and visits.expires_at
  order by scanned_at desc limit 1;
  if v.id is null then return query select false, 'scan', null::timestamptz; return; end if;
  if public.is_place_owner(p_place) then return query select false, 'owner', v.expires_at; return; end if;
  if not public.reviews_open(p_place) then return query select false, 'paused', v.expires_at; return; end if;
  if public.is_guest() then
    v_device := case when btrim(coalesce(p_device, '')) <> '' then encode(digest('tp-device:' || btrim(p_device), 'sha256'), 'hex') end;
    if exists (select 1 from public.reviews where place_id = p_place and visit_id is distinct from v.id
               and (user_id = auth.uid() or (v_device is not null and device_hash = v_device and by_guest)))
       or exists (select 1 from public.visit_reviews where place_id = p_place and visit_id is distinct from v.id
               and (user_id = auth.uid() or (v_device is not null and device_hash = v_device and by_guest))) then
      return query select false, 'guest_used', v.expires_at; return;
    end if;
  end if;
  return query select true, 'ok', v.expires_at;
end $$;
grant execute on function public.can_review(uuid, text) to authenticated;
