-- Trusted Picks: row-level security. Every table is locked by default;
-- these policies open exactly what each screen needs.
-- "authenticated" = any signed-in user; is_admin() = profiles.role = 'admin'.

alter table public.profiles          enable row level security;
alter table public.follows           enable row level security;
alter table public.places            enable row level security;
alter table public.topics            enable row level security;
alter table public.items             enable row level security;
alter table public.qr_codes          enable row level security;
alter table public.visits            enable row level security;
alter table public.reviews           enable row level security;
alter table public.tags              enable row level security;
alter table public.review_tags       enable row level security;
alter table public.google_shares     enable row level security;
alter table public.saved_places      enable row level security;
alter table public.app_settings      enable row level security;
alter table public.listing_requests  enable row level security;
alter table public.payments          enable row level security;
alter table public.item_stats        enable row level security;
alter table public.user_topic_stats  enable row level security;
alter table public.taste_match       enable row level security;

-- profiles: names and avatars are public; you edit only your own.
create policy "profiles readable" on public.profiles for select using (true);
create policy "edit own profile"  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
-- Column grants: phone_hash is never readable, and only these fields are editable.
-- (Select columns by name from the app; "select *" on profiles is refused.)
revoke select, update on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_path, city, role, created_at) on public.profiles to anon, authenticated;
grant update (display_name, avatar_path, city, role) on public.profiles to authenticated;

-- follows: anyone signed in sees the graph; you add or remove your own follows.
create policy "follows readable" on public.follows for select to authenticated using (true);
create policy "follow"   on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "unfollow" on public.follows for delete to authenticated using (follower_id = auth.uid());

-- places: everyone sees live listings; only admins create or change them.
create policy "live places readable" on public.places for select using (status = 'live' or public.is_admin());
create policy "admins manage places" on public.places for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- topics, tags, settings: readable by all, managed by admins.
create policy "topics readable" on public.topics for select using (true);
create policy "admins manage topics" on public.topics for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "tags readable" on public.tags for select using (true);
create policy "admins manage tags" on public.tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "settings readable" on public.app_settings for select using (true);
create policy "admins manage settings" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- items: readable by all; created through submit_review(); admins can tidy them.
create policy "items readable" on public.items for select using (true);
create policy "admins manage items" on public.items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- qr_codes: tokens stay private; the public resolves them through peek_qr()/scan_qr().
create policy "admins manage qr" on public.qr_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- visits: you see your own; created only by scan_qr().
create policy "own visits" on public.visits for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- reviews: published ones are public; you edit or delete your own.
-- New reviews go through submit_review() so items, visits and tags stay consistent.
create policy "published reviews readable" on public.reviews for select
  using (status = 'published' or user_id = auth.uid() or public.is_admin());
create policy "edit own review" on public.reviews for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "delete own review" on public.reviews for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- Users may change only the words, stars and voice note; admins hide reviews via status.
revoke update on public.reviews from authenticated;
grant update (rating, body, voice_path, status) on public.reviews to authenticated;
create or replace function public.guard_review_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null and not public.is_admin() then
    raise exception 'only admins can hide or restore reviews';
  end if;
  return new;
end $$;
create trigger reviews_guard_status before update on public.reviews
  for each row execute function public.guard_review_status();

create policy "review tags readable" on public.review_tags for select using (true);
create policy "tag own review" on public.review_tags for insert to authenticated
  with check (exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid()));
create policy "untag own review" on public.review_tags for delete to authenticated
  using (exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid()));

-- google_shares: log your own "Copy and open Google" taps.
create policy "log own share" on public.google_shares for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid()));
create policy "own shares readable" on public.google_shares for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- saved_places: private bookmarks.
create policy "own saved places" on public.saved_places for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- listing_requests: anyone signed in can ask; you see your own; admins decide.
create policy "request listing" on public.listing_requests for insert to authenticated
  with check (requester_id = auth.uid());
create policy "own requests readable" on public.listing_requests for select to authenticated
  using (requester_id = auth.uid() or public.is_admin());
create policy "admins update requests" on public.listing_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- payments: admins see all; a business sees payments for its own requests.
create policy "payments readable" on public.payments for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.listing_requests lr where lr.id = request_id and lr.requester_id = auth.uid()));
create policy "admins manage payments" on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- computed tables: read-only for everyone; written by triggers and nightly jobs.
create policy "item stats readable" on public.item_stats for select using (true);
create policy "topic stats readable" on public.user_topic_stats for select using (true);
create policy "taste match readable" on public.taste_match for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
