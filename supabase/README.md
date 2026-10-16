# Trusted Picks database (Supabase)

Tested end to end on a local Postgres 16 + PostGIS with a stand-in for Supabase Auth: listing request, payment, approval, QR scan, verified review, trust-score search, and the permission checks.

## Set it up (about 2 minutes)

1. Open your project at supabase.com, then **SQL Editor > New query**.
2. Paste all of `setup_all_in_one.sql` and press **Run**.
3. Make yourself admin: **Authentication > Users > Add user** with your email, then run:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

The four files in `migrations/` are the same SQL split up, in the layout the Supabase CLI expects (`supabase db push`) once the app has a repo.

## What's in it

| Part | Contents |
| --- | --- |
| Tables | profiles, follows, places, topics, items, reviews, tags, review_tags, qr_codes, visits, google_shares, saved_places, listing_requests, payments, app_settings, plus computed item_stats, user_topic_stats, taste_match |
| Functions the app calls | `scan_qr`, `peek_qr`, `submit_review`, `search_places`, `match_contacts`, `my_circle_stats`; admin: `mark_request_paid`, `approve_listing`, `decline_listing`, `admin_summary` |
| Security | Row-level security on every table. Only admins create places and QR codes. QR tokens are never readable directly. Phone hashes are never readable. Users edit only their own reviews' words and stars |
| Automatic | item_stats updates on every review; a nightly job at 03:00 IST lapses expired listings and rebuilds taste match |
| Storage | `avatars` (public), `voice` and `qr-prints` (private), each user writing only to their own folder |
| Settings | Prices (199, 399) and the 6-hour visit window live in `app_settings`, so you can change them without code |

## Differences from the design doc

- Users are Supabase Auth users; `profiles` holds the app fields. Phone numbers stay in Auth; only a hash is kept for friend matching.
- `place_score_cache` is left out. `search_places` works out the trust score live, which is fast enough until there are many thousands of reviews.

## Keys

- The publishable key goes in the frontend (Vercel env var). It is safe in the browser because RLS guards every table.
- The secret key bypasses all security. Keep it only in server env vars, never in the frontend or in chat.

## Free-tier notes

- Free projects pause after 7 days with no activity; open the dashboard to wake it.
- Phone OTP login needs a paid SMS provider (Twilio, MessageBird, Textlocal or Vonage). Email magic link and Google sign-in are free, so they are cheaper to start with.
