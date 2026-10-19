-- Trusted Picks: privacy-friendly usage numbers for the team (marketing needs to know what works).
-- Only daily totals per metric are kept: no user id, no IP, no device, no path beyond a fixed list,
-- so nothing here can say who did what. The funnel (scans, reviews, Google hand-offs, new shops)
-- is counted from the tables that already exist.

create table if not exists public.daily_counts (
  day    date    not null default current_date,
  metric text    not null,
  n      integer not null default 0,
  primary key (day, metric)
);
alter table public.daily_counts enable row level security;
-- No policies: only the functions below read or write it.

-- Adds one to today's count for a known metric. Unknown names are ignored, so it can't be filled with junk.
create or replace function public.bump_stat(p_metric text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_metric is null or p_metric not in (
    'view_home', 'view_place', 'view_best', 'view_qr', 'view_business', 'view_pricing',
    'review_started', 'install_prompt', 'installed', 'share') then
    return;
  end if;
  insert into public.daily_counts (day, metric, n) values (current_date, p_metric, 1)
  on conflict (day, metric) do update set n = public.daily_counts.n + 1;
end $$;
revoke execute on function public.bump_stat(text) from public;
grant execute on function public.bump_stat(text) to anon, authenticated;

-- Admins: one row per day and metric for the last p_days days, the counted ones plus the funnel.
create or replace function public.admin_daily_stats(p_days integer default 30)
returns table (day date, metric text, n bigint)
language sql stable security definer set search_path = public as $$
  with span as (select current_date - (least(greatest(coalesce(p_days, 30), 1), 365) - 1) as since)
  select x.day, x.metric, x.n from (
    select c.day, c.metric, c.n::bigint from public.daily_counts c, span where c.day >= span.since
    union all
    select v.scanned_at::date, 'scans', count(*) from public.visits v, span where v.scanned_at >= span.since group by 1
    union all
    select r.created_at::date, 'reviews', count(*) from public.reviews r, span where r.created_at >= span.since group by 1
    union all
    select g.opened_at::date, 'google_opened', count(*) from public.google_shares g, span where g.opened_at >= span.since group by 1
    union all
    select p.created_at::date, 'new_places', count(*) from public.places p, span where p.created_at >= span.since group by 1
  ) x
  where public.is_admin()
  order by x.day desc, x.metric;
$$;
revoke execute on function public.admin_daily_stats(integer) from public;
grant execute on function public.admin_daily_stats(integer) to authenticated;
