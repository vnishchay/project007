# Trusted Picks database (Supabase)

Tested on a local Postgres 16 + PostGIS with a stand-in for Supabase Auth: QR scan and review links, verified reviews, trust-score search, direct shop listing, plans and payments, and the permission checks.

## Set it up

1. Open your project at supabase.com, then **SQL Editor > New query**.
2. New database: paste all of `setup_all_in_one.sql` and press **Run**. Existing database: run `update_existing_database.sql` instead (safe to run again).
3. Make yourself admin: sign in once on the site, then run:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

`migrations/` holds the same SQL, one change per file, in the layout the Supabase CLI expects (`supabase db push`).

## What's in it

| Part | Contents |
| --- | --- |
| Main tables | profiles, friendships, follows, places, items, topics, reviews, tags, review_tags, qr_codes, review_links, visits, saved_places, place_updates, place_claims, review_reports, plans, subscriptions, billing_orders, payments, app_settings, ai_usage, stock_photos, plus computed item_stats, user_topic_stats, taste_match |
| Functions the app calls | Reviews: `peek_qr`, `scan_qr`, `peek_review_link`, `redeem_review_link`, `submit_review`, `report_review`. Browsing: `search_places`, `place_areas`, `accept_invite`. Shops: `list_my_shop`, `make_table_qrs`, `my_places`, `claim_place`, `set_place_location`, `create_review_link`, `shop_stats`, `my_plan`, `reply_to_review`. Admin: `verify_place`, `admin_places_to_verify`, `admin_alerts`, `admin_claims`, `admin_billing`, `admin_summary` |
| Security | Row-level security on every table. Reviews only during a QR or review-link visit; one guest visit per device and shop. Others read reviews only through `review_feed`, which hides the author unless they chose to show their name. Visits, follows and friend lists are never readable by others. Owners can't verify their own shop, edit a Google pin, or review their own shop |
| Automatic | item_stats updates on every review; a nightly job at 03:00 IST lapses expired plans and rebuilds taste match |
| Storage | Public: `avatars`, `place-media` (shop photos), `review-photos`. Private: `voice`, `claim-photos`, `qr-prints`. Each user writes only to their own folder; shop media only by the shop's owner |
| Settings | The visit window (`visit_window_hours`, 6 hours) and other limits live in `app_settings`, so they change without code |

## Keys

- The publishable key goes in the frontend (Vercel env var). It is safe in the browser because RLS guards every table.
- The secret (service role) key bypasses all security. It is used only inside edge functions, which Supabase provides automatically; never put it in the frontend or in chat.

## Free-tier notes

- Free projects pause after 7 days with no activity; open the dashboard to wake it.
- Email magic link and Google sign-in are free; phone OTP would need a paid SMS provider.

## Passkeys, NFC tags, wallet passes, similar dishes (October 2026)

| Feature | What to switch on |
| --- | --- |
| Passkeys | Supabase > Authentication > Passkeys: turn on, Relying Party ID = the app's domain (e.g. `trustedpicks.app`), origin = `https://<that domain>`. The app shows "Sign in with a passkey" and a Passkeys section on the profile once it's on; guests never see it. |
| NFC table tags | Migration 43. Nothing else: owners open QR > the NFC icon on a table for the link and key to program an NTAG 424 DNA tag. Verified taps (`tap_nfc`) count as "at the shop" without any location. |
| Similar dishes | Migration 44 (pgvector) and redeploy `ai` (`scripts/deploy-ai.ps1`) for its `embed` task. Vectors fill in as shop pages are opened, when owners change products, and at the end of each onboarding run. |
| Wallet passes | Deploy `wallet` (`scripts/deploy-wallet.ps1`) and set its secrets: `SITE_URL`, then Apple (`APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_PASS_CERT`, `APPLE_PASS_KEY`, `APPLE_PASS_KEY_PASSPHRASE` if any, `APPLE_WWDR_CERT`) and/or Google (`GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_JSON`). Buttons appear only for a wallet that's set up. |
| Bot check | Off by default. During a bot flood: set `VITE_TURNSTILE_SITE_KEY` on Vercel and turn on CAPTCHA (Turnstile, same site's secret key) in Supabase > Authentication > Attack Protection. Turn both off again afterwards. |

## Offers at the counter and review reminders (migration 47)

- **Offers:** a diner sees the shop's offers for them on the scan page and on Home, shows one at the counter (a live clock shows it isn't a screenshot) and marks it used. Owners see "used by N" under Offers sent. Nothing to switch on.
- **Ready to rate:** Home shows a shop you scanned at and haven't reviewed while the review is still open. Nothing to switch on.
- **Review reminders (Web Push):** people who tap "Rate later" on the scan page, or switch on Review reminders in Profile, get a phone notification about 90 minutes after scanning and a last one 45 minutes before the review closes, unless they already reviewed. To turn it on:
  1. Run `run-now-47.sql` (or `update_existing_database.sql`).
  2. On the PC: `powershell -ExecutionPolicy Bypass -File scripts/setup-reminders.ps1`. It makes the Web Push keys, sets the Supabase secrets, deploys the `remind` function and prints two last steps.
  3. Run the one SQL line it prints (stores the project address and the cron secret in Vault).
  4. Add `VITE_VAPID_PUBLIC_KEY` on Vercel (it prints the value) and redeploy.
  On iPhone, notifications need the app added to the home screen (iOS 16.4+); the app says so. Until step 4 the app hides the switch and keeps Ready to rate on Home.
