-- Trusted Picks: the owner app's Today screen (2026-10-23).
-- One call gives everything the owner's home screen shows: today's visitors against yesterday, the last
-- 14 days, reviews waiting for a reply, deals and stamp cards, offers sent, QR codes and the plan.
-- Counts only: never who visited or who wrote what. Days are the shop's own local days.
-- Safe to run more than once.
set search_path = public, extensions;

create or replace function public.owner_today(p_place uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz    text;
  today date;
  card  public.stamp_cards;
  res   jsonb;
begin
  if not (public.is_admin() or public.is_place_owner(p_place)) then raise exception 'only the shop owner can see this'; end if;
  select coalesce(p.time_zone, 'Asia/Kolkata') into tz from public.places p where p.id = p_place;
  if tz is null then return null; end if;
  today := (now() at time zone tz)::date;
  select * into card from public.stamp_cards sc where sc.place_id = p_place and sc.active;

  with v as (
    select v.user_id, v.source, v.near, (v.scanned_at at time zone tz)::date as day
    from public.visits v
    where v.place_id = p_place and v.scanned_at > now() - interval '15 days'
  ),
  r as (
    select r.rating, r.owner_reply, r.created_at, (r.created_at at time zone tz)::date as day
    from public.reviews r
    where r.place_id = p_place and r.status = 'published'
  ),
  days as (select generate_series(today - 13, today, interval '1 day')::date as day)
  select jsonb_build_object(
    'today', today,
    'visitors_today', (select count(distinct user_id) from v where day = today),
    'visitors_yesterday', (select count(distinct user_id) from v where day = today - 1),
    'scans_today', (select count(*) from v where day = today and source = 'qr'),
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
                'day', d.day,
                'visitors', (select count(distinct user_id) from v where v.day = d.day),
                'reviews', (select count(*) from r where r.day = d.day)) order by d.day), '[]'::jsonb) from days d),
    'reviews_today', (select count(*) from r where day = today),
    'reviews_7d', (select count(*) from r where day > today - 7),
    'reviews', (select count(*) from r),
    'avg_rating', (select round(avg(rating)::numeric, 1) from r),
    'need_reply', (select count(*) from r where owner_reply is null),
    'low_open', (select count(*) from r where owner_reply is null and rating <= 2 and created_at > now() - interval '30 days'),
    'notes_unread', (select count(*) from public.owner_notes n where n.place_id = p_place and n.read_at is null),
    'deals_live', (select count(*) from public.shop_deals d where d.place_id = p_place and d.active
                     and (d.valid_until is null or d.valid_until >= today)),
    'deals_on_now', (select count(*) from public.shop_deals d where d.place_id = p_place
                       and public.deal_on_at(d, (now() at time zone tz)::timestamp)),
    'deal_uses_today', (select count(*) from public.deal_uses u join public.shop_deals d on d.id = u.deal_id
                          where d.place_id = p_place and u.local_day = today),
    'stamp_goal', card.goal,
    'stamp_reward', card.reward,
    'stamps_today', case when card.place_id is null then 0 else
                      (select count(distinct user_id) from v where day = today and source = 'qr' and near is distinct from false) end,
    'rewards_today', (select count(*) from public.stamp_rewards sr where sr.place_id = p_place
                        and (sr.used_at at time zone tz)::date = today),
    'offers_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days'),
    'offers_seen_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days' and o.seen_at is not null),
    'offers_used_7d', (select count(*) from public.visitor_offers o where o.place_id = p_place and o.created_at > now() - interval '7 days' and o.used_at is not null),
    'updates_today', (select count(*) from public.place_updates u where u.place_id = p_place and u.created_at > now() - interval '1 day'),
    'qr_active', (select count(*) from public.qr_codes q where q.place_id = p_place and q.active),
    'qr_limit', public.place_qr_limit(p_place),
    'plan', s.plan,
    'plan_name', pl.name,
    'plan_status', s.status,
    'period_end', s.period_end,
    'trial_reviews_left', s.trial_reviews_left,
    'reviews_open', public.reviews_open(p_place)
  ) into res
  from (select 1) one
  left join public.subscriptions s on s.place_id = p_place
  left join public.plans pl on pl.code = s.plan;
  return res;
end $$;
revoke execute on function public.owner_today(uuid) from public, anon;
grant execute on function public.owner_today(uuid) to authenticated;
