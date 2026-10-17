# Trusted Picks

Friend-trusted, item-level reviews for local places. React + Vite frontend, Supabase backend, one Vercel serverless function for AI review drafts.

## 1. Database (Supabase, once)

In Supabase, open **SQL Editor > New query**, paste `supabase/setup_all_in_one.sql` and press **Run**.
If you already ran an earlier copy, run only the migration files you haven't run yet from `supabase/migrations/`, in order. Each one is safe to run once:

- `20261016000006_existing_users.sql`: profiles for users who signed up through other apps on the same project
- `20261016000007_safe_signup.sql`: a profile problem can never block a sign-up
- `20261016000008_features.sql`: review photos and voice notes, phone numbers for contact matching, suggested people, area search, and payments that keep the quoted price
- `20261016000009_privacy.sql`: anonymous-by-default reviews, mutual contact sync, private visits, follows and city
- `20261016000010_guests.sql`: reviews without an account, with daily limits
- `20261016000011_shops_friends.sql`: shop owners manage their page, products and photos; friends are made through shared links (phone matching is no longer used)
- `20261016000012_links_updates.sql`: a shop's links (Swiggy, Zomato, Instagram...), updates from the shop to its customers, owner insights, connecting a Google profile
- `20261016000013_business_modes.sql`: business types (food, shop, salon, clinic, gym, school, services) with their own review tags
- `20261016000014_review_by_scan.sql`: reviews only during a table-QR visit; guests get one review per shop per device; owners can't review their own shop

Or run `supabase/update_existing_database.sql`, which bundles 0006 onwards.

For test data, run `supabase/demo_data.sql`: twelve Pune shops with menus and table QR codes, 28 demo people, friendships, and a few hundred reviews. It is safe to run again, and the removal queries are at the bottom of the file.

## 2. Supabase settings

- **Authentication > URL Configuration**: set **Site URL** to your Vercel URL (for example `https://trustedpicks.vercel.app`) and add your exact site address followed by `/**` (for example `https://project007.vercel.app/**`) and `http://localhost:5173/**` to **Redirect URLs**. Avoid a `*.vercel.app` wildcard: it would let any Vercel site receive your users' sign-in tokens. If the Supabase project is shared with other apps, leave Site URL as it is and only add Redirect URLs.
- **Authentication > Sign In / Providers**: Email is on by default (magic link). For "Continue with Google", turn on Google and paste a Google OAuth client ID and secret.
- **If Google or email sign-in returns you signed out**: the app now shows the reason in a red banner. "redirect" problems mean the address you signed in from is missing from **Redirect URLs** (each Vercel preview address is different; add the one you use, or use your main address). "Database error saving new user" means run `20261016000007_safe_signup.sql`.
- **Reviews without an account**: in **Authentication > Sign In / Providers**, turn on **Allow anonymous sign-ins** (guests review anonymously, 5 a day) and **Allow manual linking** (a guest who later signs in with Google keeps their reviews).
- **Stay signed in**: in **Authentication > Sessions**, leave "Time-box user sessions" and "Inactivity timeout" off. One sign-in then lasts on that device until the person signs out.
- Make yourself admin: sign in once on the site, then run in SQL Editor:
  ```sql
  update public.profiles set role = 'admin'
  where id = (select id from auth.users where email = 'you@example.com');
  ```

## 3. Deploy on Vercel

1. Push this folder to a GitHub repo and import it in Vercel (framework: Vite, detected automatically).
2. Add these environment variables (Project Settings > Environment Variables):

| Name | Value | Needed |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://ymkyrlquyietmuukzwqe.supabase.co` | yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | your `sb_publishable_…` key | yes |
| `VITE_GOOGLE_MAPS_KEY` | Places API (New) key, restricted to your site's address | optional: live Google rating, description, photos and reviews on shop pages, and "paste your Google link" onboarding |

Never put the Supabase **secret** key anywhere in this app.

3. Deploy. Then in the app: **Admin > Settings**, add your UPI ID so businesses can pay you.

## AI (Supabase Edge Function)

Every AI feature (review drafts, menu photos, shop updates, About text, review tips, "What people say")
runs in one Supabase Edge Function, `supabase/functions/ai/index.ts`. The browser never holds an AI key
and never calls the AI itself; it calls the function with the user's session.

1. Supabase > Edge Functions > Deploy a new function > Via editor. Name it `ai`, paste `supabase/functions/ai/index.ts`, deploy.
2. In the function's settings, turn **Verify JWT** off (the function checks sign-in itself, and shop pages call it for signed-out visitors).
3. Supabase > Edge Functions > Secrets: add `DEEPSEEK_API_KEY`. Optional: `DEEPSEEK_MODEL` (default `deepseek-flash`, the cheapest; thinking is turned off).

Limits: 10 AI calls a day per guest, 40 per signed-in person (a menu read counts 3); "What people say" runs at most once a day per shop.
With the CLI instead: `supabase functions deploy ai --no-verify-jwt` and `supabase secrets set DEEPSEEK_API_KEY=...`.

## Run locally

```bash
cp .env.example .env.local   # fill in the two VITE_ values
npm install
npm run dev
```
(AI features need the `ai` edge function deployed to your Supabase project.)

## How selling works

1. A business opens **List your business**, fills the form and sends the request (₹199/year, +₹399 for table QRs; prices are in Admin > Settings).
2. They see a UPI QR and pay link with a reference like `TP-6A095087`.
3. You check the payment, tap **Mark paid**, add the Google Place ID and map coordinates, and tap **Approve**. The place goes live and table QR codes are created.
4. **Admin > Places > (place)** prints the table cards or downloads each QR as a PNG.
5. The business owner (whoever sent the request) can now open **You > Your shops** or `/manage/<place id>` to add products with photos and prices, a cover photo, logo, about and hours. Customers pick those products when they review.
6. Listings lapse automatically after a year (nightly job). **Renew 1 year** extends them and records the payment.

## Reviews come from real visits

Only someone who scanned the shop's table QR can write a review, for a few hours after the scan (Admin > Settings). Everyone else, invited friends included, can read. Without signing in, each phone gets one review per shop (the app keeps a random id on the device; only its hash is stored). Owners can't review their own shop.

Google content (description, photos, reviews) is shown live through the official Places API with Google's credit and never copied into the database, as Google's terms require. Only the Place ID is stored.

## Friends

Every link someone shares from the app (their invite, a review, a place) carries their invite code (`?ref=`). Whoever opens it and then uses the app, even as a guest, becomes their friend. Friends' ratings count most in rankings; a friend's name is shown only on reviews they chose to post with their name.

## Map of the code

- `src/pages` one file per screen: Discover, Place, QrLanding (`/q/:token`), Scan, Rate (pick a place to review), Review, Saved (Google handoff), Circle (friends), Person, Me, Business, Manage (shop owner products and photos), Admin, AdminPlace
- `src/lib` Supabase client, auth, settings, chosen location, Google rating (the trust score is computed in the database by `search_places`)
- `api/resolve-link.ts` opens a Google Maps share link (maps.app.goo.gl) so onboarding can find the business
- `supabase/functions/ai/index.ts` every AI feature, server-side (see "AI" above)
- `supabase/` database schema, security rules and functions
