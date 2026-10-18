# Trusted Picks

Friend-trusted, item-level reviews for local places. React + Vite frontend on Vercel, Supabase backend (database, auth, storage and three edge functions: `ai`, `billing`, `billing-webhook`), and one small Vercel function that opens Google Maps share links.

## 1. Database (Supabase, once)

In Supabase, open **SQL Editor > New query**, paste `supabase/setup_all_in_one.sql` and press **Run**. That builds a new database with everything.

Already have a database from an earlier copy? Run `supabase/update_existing_database.sql` instead. It holds every change from migration 0006 onwards and is safe to run again, so you never have to work out which parts you ran before. The files in `supabase/migrations/` are the same SQL, one change per file.

For test data, run `supabase/demo_data.sql`: 42 shops in five cities with every field filled (hours, links to Swiggy, Zomato, Instagram, WhatsApp and more, logo, cover, a picture for every dish), menus, table QR codes, about 190 demo people and shop owners, friendships, about 2,000 reviews (some with photos), saved places, plans, payments, review links, reports, alerts and claims. Pictures are stock photos named by tokens such as `demo:pizza:3` (see `src/lib/demoPools.ts`); the app resolves them and falls back to other pictures if one will not load. It is safe to run again (it rebuilds only the demo people's own reviews), and the removal queries are at the bottom of the file.

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

3. Deploy.

## Payments (Razorpay)

Shops pay for QR plans with Razorpay: one-off payments, no auto-renew. Every new shop starts with one free trial QR.

1. Deploy the edge functions `billing` and `billing-webhook` (`supabase/functions/`). Turn **Verify JWT** off for `billing-webhook` only (Razorpay calls it, and it checks Razorpay's signature itself).
2. Supabase > Edge Functions > Secrets: add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`.
3. In Razorpay > Webhooks, point a webhook at `https://<project>.supabase.co/functions/v1/billing-webhook` with the same secret, for `payment.captured` and `order.paid`.
4. Plan prices and QR limits live in the `plans` table (Admin > Billing).

## Speed and map pins

- **Search stays fast as data grows.** `search_places` scores only the 250 nearest (or most reviewed) shops, reads each one's newest 80 matching reviews plus your friends' reviews, and pages with `p_offset`. On a test database of 1,700 shops and 200,000 reviews it went from 5 to 10 seconds down to about 0.3 seconds. Lists (home, shop reviews, your reviews, admin) load a page at a time with a "Show more" button. Migration 28 also adds the missing indexes.
- **Map pins.** A shop linked to Google uses Google's own pin: it is read from Google when the shop is linked, refreshed about every 25 days (Google lets us keep a pin for 30), and owners can't type over it. Shops without a Google link use a pin typed in or taken from the owner's phone. Owners and admins see when a shop has no pin, because such a shop can't appear under "Near you".

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

## How listing a shop works

1. A business owner opens **For businesses > List my shop** and answers six short screens: the shop (or paste its Google Maps link), how to reach them, other links, how many tables need a QR, the plan, then payment. The X closes the setup from any screen.
2. The shop goes live at once with its free trial QR. Paid plans are bought with Razorpay on the last screen, or later from the shop's **Plan** tab; the QR codes are created as soon as the payment goes through.
3. The team checks the listing in **Admin > Verify** (name, Google page, links) and marks it verified or removes it. Until then the shop's links stay off its public page.
4. The owner manages the shop at `/manage/<shop id>`: Insights, Products (with menu-photo import), Links, Updates, Details, QR codes and Plan.
5. A shop that already exists from Google can be claimed from its page (**Own this business? Claim it free**).

## Reviews come from real visits

Only someone who scanned the shop's table QR, or opened a one-time review link the shop sent, can write a review, for a few hours afterwards (`visit_window_hours` in Admin > Settings). Within that visit they can rate several dishes. Everyone else, invited friends included, can read. Without signing in, each phone gets one review per shop (the app keeps a random id on the device; only its hash is stored). Owners can't review their own shop.

Google content (description, photos, reviews) is shown live through the official Places API with Google's credit and never copied into the database, as Google's terms require. Only the Place ID is stored.

## Friends

Friends are invite-only. Every link someone shares from the app (their invite, a review, a place) carries their invite code (`?ref=`). Whoever opens it and then uses the app, even as a guest, becomes their friend. There is no search by name and no suggested people. Friends' ratings count most in rankings, and a shop page shows "Your friends liked" only for reviews posted with a name.

## Map of the code

- `src/pages` one file per screen: Discover (home), Place (shop page), QrLanding (`/q/:token` table QR, `/r/:token` review link), Review, Saved (Google handoff), Person, Me, SignIn, Business, BusinessSetup (`/business/setup`), Manage, Claim, Admin, AdminPlace, Check (`/check`, guest self-test), Legal
- `src/components` shared UI (`ui.tsx`), the shop setup (`business/`), shop management tabs (`manage/`), shop page parts (`place/`) and home parts (`home/`)
- `src/lib` Supabase client, auth, settings, chosen location, Google Places, billing, navigation helpers (`nav.ts`), map pins (the trust score is computed in the database by `search_places`)
- `api/resolve-link.ts` opens a Google Maps share link (maps.app.goo.gl) so onboarding can find the business
- `supabase/functions/ai/index.ts` every AI feature, server-side (see "AI" above)
- `supabase/functions/billing` and `billing-webhook` Razorpay orders and payment confirmation
- `supabase/` database schema, security rules and functions
