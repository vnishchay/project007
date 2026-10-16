-- Trusted Picks: storage buckets, the nightly schedule, and starter data.

-- ---------- Storage (Supabase Storage) ----------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('voice', 'voice', false), ('qr-prints', 'qr-prints', false)
on conflict (id) do nothing;

-- Files go under a folder named after the user's id: <uid>/<file>.
create policy "avatars readable" on storage.objects for select using (bucket_id = 'avatars');
create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own voice notes" on storage.objects for all to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admins manage qr prints" on storage.objects for all to authenticated
  using (bucket_id = 'qr-prints' and public.is_admin())
  with check (bucket_id = 'qr-prints' and public.is_admin());

-- ---------- Nightly jobs (pg_cron, free on Supabase) ----------
create extension if not exists pg_cron;
select cron.schedule('trusted-picks-nightly', '30 21 * * *',  -- 03:00 IST
  $$ select public.lapse_expired_listings(); select public.refresh_trust_tables(); $$);

-- ---------- Starter data ----------
insert into public.app_settings (key, value) values
  ('listing_price_inr', '199'),
  ('qr_price_inr', '399'),
  ('visit_window_hours', '6')
on conflict (key) do nothing;

insert into public.topics (name) values
  ('Pizza'), ('Pasta'), ('Burger'), ('Biryani'), ('Dosa'), ('Filter coffee'), ('Coffee'),
  ('Dessert'), ('Cocktails'), ('Haircut'), ('Spa'), ('Bakery')
on conflict (name) do nothing;

insert into public.tags (label) values
  ('Authentic'), ('Worth the price'), ('Generous portion'), ('Quick service'),
  ('Friendly staff'), ('Great for groups'), ('Too pricey'), ('Slow service')
on conflict (label) do nothing;
