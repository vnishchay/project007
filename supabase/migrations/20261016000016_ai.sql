-- Trusted Picks: AI runs only inside the Supabase Edge Function "ai" (key = Supabase secret).
-- The browser never holds an AI key and never calls the AI directly.

-- "What people say" for each shop, written by the edge function at most once a day.
create table if not exists public.place_ai_summaries (
  place_id     uuid primary key references public.places (id) on delete cascade,
  summary      text not null default '',
  highlights   text[] not null default '{}',
  review_count integer not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.place_ai_summaries enable row level security;
revoke all on public.place_ai_summaries from anon, authenticated;
grant select on public.place_ai_summaries to anon, authenticated;
drop policy if exists "summaries of live places are public" on public.place_ai_summaries;
create policy "summaries of live places are public" on public.place_ai_summaries for select
  using (exists (select 1 from public.places p where p.id = place_id and p.status = 'live'));

-- How much AI help each person used today. Nobody can read or change it except the edge function.
create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null default current_date,
  calls   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Count a call if it fits today's allowance. Only the edge function (service role) may call it.
create or replace function public.ai_take(p_user uuid, p_cost integer, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.ai_usage (user_id, day, calls) values (p_user, current_date, 0)
  on conflict (user_id, day) do nothing;
  update public.ai_usage set calls = calls + greatest(p_cost, 1)
  where user_id = p_user and day = current_date and calls + greatest(p_cost, 1) <= p_limit
  returning calls into v;
  delete from public.ai_usage where day < current_date - 7;
  return v is not null;
end $$;
revoke execute on function public.ai_take(uuid, integer, integer) from public, anon, authenticated;
do $$ begin
  grant execute on function public.ai_take(uuid, integer, integer) to service_role;
exception when undefined_object then null; end $$;
