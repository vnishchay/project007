# Trusted Picks

Friend-trusted, item-level reviews for local places. React + Vite frontend, Supabase backend, one Vercel serverless function for AI review drafts.

## 1. Database (Supabase, once)

In Supabase, open **SQL Editor > New query**, paste `supabase/setup_all_in_one.sql` and press **Run**.
If you already ran an earlier copy, run only the migration files you haven't run yet from `supabase/migrations/`, in order. Each one is safe to run once:

- `20261016000006_existing_users.sql`: profiles for users who signed up through other apps on the same project
- `20261016000007_safe_signup.sql`: a profile problem can never block a sign-up
- `20261016000008_features.sql`: review photos and voice notes, phone numbers for contact matching, suggested people, area search, and payments that keep the quoted price

For test data, run `supabase/demo_data.sql` (five Pune places with table QR codes).

## 2. Supabase settings

- **Authentication > URL Configuration**: set **Site URL** to your Vercel URL (for example `https://trustedpicks.vercel.app`) and add your exact site address followed by `/**` (for example `https://project007.vercel.app/**`) and `http://localhost:5173/**` to **Redirect URLs**. Avoid a `*.vercel.app` wildcard: it would let any Vercel site receive your users' sign-in tokens. If the Supabase project is shared with other apps, leave Site URL as it is and only add Redirect URLs.
- **Authentication > Sign In / Providers**: Email is on by default (magic link). For "Continue with Google", turn on Google and paste a Google OAuth client ID and secret.
- **If Google or email sign-in returns you signed out**: the app now shows the reason in a red banner. "redirect" problems mean the address you signed in from is missing from **Redirect URLs** (each Vercel preview address is different; add the one you use, or use your main address). "Database error saving new user" means run `20261016000007_safe_signup.sql`.
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
| `SUPABASE_URL` | same URL | for AI drafts |
| `SUPABASE_PUBLISHABLE_KEY` | same publishable key | for AI drafts |
| `ANTHROPIC_API_KEY` | from console.anthropic.com | for AI drafts |
| `CLAUDE_MODEL` | defaults to `claude-opus-5-5`; `claude-haiku-5-5` is much cheaper | optional |
| `VITE_GOOGLE_MAPS_KEY` | Places API key, restricted to your domain | optional, shows live Google rating |

Never put the Supabase **secret** key anywhere in this app.

3. Deploy. Then in the app: **Admin > Settings**, add your UPI ID so businesses can pay you.

## Run locally

```bash
cp .env.example .env.local   # fill in the two VITE_ values
npm install
npm run dev
```
(`/api/draft` only runs on Vercel or with `vercel dev`.)

## How selling works

1. A business opens **List your business**, fills the form and sends the request (₹199/year, +₹399 for table QRs; prices are in Admin > Settings).
2. They see a UPI QR and pay link with a reference like `TP-6A095087`.
3. You check the payment, tap **Mark paid**, add the Google Place ID and map coordinates, and tap **Approve**. The place goes live and table QR codes are created.
4. **Admin > Places > (place)** prints the table cards or downloads each QR as a PNG.
5. Listings lapse automatically after a year (nightly job). **Renew 1 year** extends them and records the payment.

## Map of the code

- `src/pages` one file per screen: Discover, Place, QrLanding (`/q/:token`), Scan, Rate (pick a place to review), Review, Saved (Google handoff), Circle, Person, Me, Business, Admin, AdminPlace
- `src/lib` Supabase client, auth, settings, chosen location, Google rating (the trust score is computed in the database by `search_places`)
- `api/draft.ts` AI review draft (checks the user's Supabase session first)
- `supabase/` database schema, security rules and functions
