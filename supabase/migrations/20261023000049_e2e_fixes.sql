-- Trusted Picks: fixes from the end-to-end test run (2026-10-23).
--   * Admin-only functions can no longer be called without signing in (they already refused inside).
--   * Billing > Payments also lists payments the team entered by hand, so it adds up to "collected".
--   * Asking for a recheck keeps the team's note; Verify shows the owner's reply and marks it as a recheck.

-- ---------- Admin functions: signed-in only ----------
revoke execute on function public.admin_alerts() from public, anon;
revoke execute on function public.admin_billing(integer) from public, anon;
revoke execute on function public.admin_claims() from public, anon;
revoke execute on function public.decide_claim(uuid, boolean) from public, anon;
revoke execute on function public.admin_shop_plans() from public, anon;
revoke execute on function public.admin_update_plan(text, text, integer, integer, integer, integer, integer) from public, anon;
revoke execute on function public.admin_daily_stats(integer) from public, anon;
revoke execute on function public.places_without_pin() from public, anon;

-- ---------- Payments list includes the team's own entries ----------
create or replace function public.admin_billing(p_limit integer default 100)
returns table (id uuid, place_id uuid, place_name text, plan text, billing_interval text, currency text,
               amount_minor integer, status text, provider_payment_id text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select o.id, o.place_id, coalesce(p.name, lr.business_name), o.plan, o.billing_interval, o.currency, o.amount_minor, o.status,
           o.provider_payment_id, o.created_at, o.paid_at
    from public.billing_orders o
    left join public.places p on p.id = o.place_id
    left join public.listing_requests lr on lr.id = o.request_id
    where public.is_admin()
    union all
    select m.id, m.place_id, p.name, coalesce(nullif(m.provider_ref, ''), m.kind::text), null, 'INR', m.amount_inr * 100, m.status::text,
           'Entered by the team', m.created_at, m.paid_at
    from public.payments m
    left join public.places p on p.id = m.place_id
    where public.is_admin() and m.provider = 'admin'
  ) x
  order by x.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
revoke execute on function public.admin_billing(integer) from public, anon;
grant execute on function public.admin_billing(integer) to authenticated;

-- ---------- Rechecks keep the team's note ----------
create or replace function public.request_recheck(p_place uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare pl public.places; last_at timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into pl from public.places where id = p_place for update;
  if pl.id is null or pl.owner_id is distinct from auth.uid() then raise exception 'only the shop owner can ask for this'; end if;
  if pl.verification = 'pending' then raise exception 'your shop is already waiting for the team''s check'; end if;
  if not (pl.status = 'removed' or pl.verification = 'rejected') then raise exception 'your shop is already listed'; end if;
  select max(created_at) into last_at from public.place_rechecks where place_id = p_place;
  if last_at is not null and last_at > now() - interval '1 day' then
    raise exception 'you can ask once a day. Try again after %',
      to_char((last_at + interval '1 day') at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM');
  end if;
  insert into public.place_rechecks (place_id, requested_by, note)
  values (p_place, auth.uid(), nullif(left(btrim(coalesce(p_note, '')), 1000), ''));
  perform set_config('app.verification_write', '1', true);
  update public.places set verification = 'pending' where id = p_place;
  perform set_config('app.verification_write', '', true);
  return 'pending';
end $$;
revoke execute on function public.request_recheck(uuid, text) from public, anon;
grant execute on function public.request_recheck(uuid, text) to authenticated;

drop function if exists public.admin_places_to_verify();
create or replace function public.admin_places_to_verify()
returns table (id uuid, name text, category text, area text, city text, google_place_id text, links jsonb,
               contact_phone text, verification_note text, owner_name text, created_at timestamptz, has_location boolean,
               recheck_at timestamptz, recheck_note text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.area, p.city, p.google_place_id, p.links, p.contact_phone, p.verification_note,
         pr.display_name, p.created_at, p.location is not null, rc.created_at, rc.note
  from public.places p
  left join public.profiles pr on pr.id = p.owner_id
  left join lateral (select r.created_at, r.note from public.place_rechecks r where r.place_id = p.id order by r.created_at desc limit 1) rc on true
  where public.is_admin() and p.verification = 'pending'
  order by p.created_at;
$$;
revoke execute on function public.admin_places_to_verify() from public, anon;
grant execute on function public.admin_places_to_verify() to authenticated;

-- ---------- Visitor names never come from an email address ----------
-- A person who signed in by email and never gave a name used to get the part before the @ as their
-- name, which shops then saw. Now they have no name (shown as "Customer") until they add one.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.profiles (id, display_name)
    values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), ''))
    on conflict (id) do nothing;
  exception when others then
    raise warning 'trusted picks: profile for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $$;
-- Clear names that are just the start of the person's email and that they never chose.
update public.profiles p set display_name = ''
from auth.users u
where u.id = p.id and u.email is not null and p.display_name <> ''
  and lower(p.display_name) = lower(split_part(u.email, '@', 1))
  and coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'name'), '')) is null;

-- ---------- Offers and shop news never ask for reviews ----------
-- Google bans rewards for reviews, so neither may mention reviews, ratings, stars or feedback.
create or replace function public.mentions_reviews(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* '\m(reviews?|reviewing|reviewed|ratings?|rated|rate (us|our|your|the)|feedback|testimonials?)\M'
      or coalesce(p_text, '') ~* '(\d\s*-?\s*stars?\M|★|⭐)';
$$;

create or replace function public.send_visitor_offer(p_place uuid, p_users uuid[], p_body text, p_link text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can send offers'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 280 then raise exception 'write an offer of up to 280 characters'; end if;
  if public.mentions_reviews(p_body) then
    raise exception 'offers can''t mention reviews, ratings, stars or feedback. Google bans rewards for reviews';
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

-- Shop news: same rule, and 3 posts a day counts posts made, so deleting one doesn't free a slot.
create table if not exists public.place_update_posts (
  place_id   uuid not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists place_update_posts_idx on public.place_update_posts (place_id, created_at desc);
alter table public.place_update_posts enable row level security;
revoke all on public.place_update_posts from anon, authenticated;
insert into public.place_update_posts (place_id, created_at)
select u.place_id, u.created_at from public.place_updates u
where u.created_at > now() - interval '1 day'
  and not exists (select 1 from public.place_update_posts x where x.place_id = u.place_id and x.created_at = u.created_at);

create or replace function public.limit_place_updates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.mentions_reviews(new.body) then
    raise exception 'news can''t mention reviews, ratings, stars or feedback. Google bans asking for reviews with rewards';
  end if;
  if (select count(*) from public.place_update_posts where place_id = new.place_id and created_at > now() - interval '1 day') >= 3 then
    raise exception 'you can post 3 updates a day';
  end if;
  insert into public.place_update_posts (place_id) values (new.place_id);
  return new;
end $$;
drop trigger if exists place_updates_limit on public.place_updates;
create trigger place_updates_limit before insert on public.place_updates
  for each row execute function public.limit_place_updates();

-- How many news posts the shop has left today (deleted ones count).
create or replace function public.shop_updates_left(p_place uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  return greatest(0, 3 - (select count(*) from public.place_update_posts where place_id = p_place and created_at > now() - interval '1 day'))::integer;
end $$;
revoke execute on function public.shop_updates_left(uuid) from public, anon;
grant execute on function public.shop_updates_left(uuid) to authenticated;

-- ---------- Invite codes: the first one made is the one kept ----------
-- Several first calls at once used to each write a new code, so the link shown could already be dead.
create or replace function public.my_invite_code()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'open your profile once, then try again'; end if;
  select invite_code into c from public.profiles where id = auth.uid();
  while c is null loop
    begin
      update public.profiles set invite_code = encode(gen_random_bytes(5), 'hex') where id = auth.uid() and invite_code is null;
    exception when unique_violation then null;
    end;
    select invite_code into c from public.profiles where id = auth.uid();
  end loop;
  return c;
end $$;
revoke execute on function public.my_invite_code() from public, anon;
grant execute on function public.my_invite_code() to authenticated;
