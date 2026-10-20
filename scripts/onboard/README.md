# Onboarding real businesses

`npm run onboard` fills Trusted Picks with real, public facts about local businesses: hours, phone,
socials, price range, amenities, a cover photo, Google rating and review count, and the menu or service list.
It never writes reviews or visits and never invents text or pictures. AI is used only to read a real menu
(website text, PDF or menu photo) into items, through the `ai` edge function.

```bash
npm run onboard -- --city Varanasi --dry-run              # look first: writes a report, touches nothing
npm run onboard -- --city Varanasi --limit 200            # restaurants, cafés, sweet shops, bakeries
npm run onboard -- --city Varanasi --kinds food,beauty,health,fitness --limit 500
npm run onboard -- --city Varanasi --around 25.3109,83.0107 --radius 1500
npm run onboard -- --input my-shops.json                  # businesses you collected yourself
npm run onboard -- --help
```

Needs in `.env`: `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (not for `--dry-run`), `GOOGLE_MAPS_KEY`
(Places API (New)) and `ONBOARD_TOKEN` for menu reading. Every run writes a JSON report to `scripts/onboard/out/`.

One-time setup for menu reading and Google ranking:

1. Run `/mnt/project-files/sql/run-now-42.sql` (migration 42) in the Supabase SQL Editor.
2. Pick a random token of 24+ characters, put it in `.env` as `ONBOARD_TOKEN=...` and run
   `npx supabase secrets set ONBOARD_TOKEN=...`.
3. Redeploy the `ai` function: `powershell -ExecutionPolicy Bypass -File scripts/deploy-ai.ps1`.

The token only unlocks the `menu` task of the `ai` function, for any place, so keep it out of the app.

Flags to skip a source: `--no-google --no-website --no-photos --no-wiki --no-menus --no-marketplaces --no-qr`.
`--menu-photos 8` sets how many Google photos are checked for a menu.

## Where each fact comes from

| Source | What we take | Rules we follow |
| --- | --- | --- |
| OpenStreetMap (Nominatim + Overpass) | Name, type, cuisine, map pin, opening hours, phone, email, website, Instagram/Facebook/WhatsApp, diet (pure veg, vegan, Jain), year founded, and amenity chips: seats, outdoor seating, AC, Wi-Fi, bookings, takeaway, delivery, high chairs, baby changing, toilets, wheelchair access, no smoking, UPI/cards, kitchen hours, women/men/unisex salons | ODbL: credited on the Terms page. 1 Nominatim request a second |
| Google Places API (New) | Place ID (name match within 250 m), rating and review count, hours, phone, website, price level and range, editorial summary, type, dine-in/takeaway/delivery/serves, payment, parking, accessibility, and photos (first one as cover, credited to its author; others checked for a menu). Closed-for-good places are skipped | Storing these goes beyond Google's terms; Akanksha decided on 2026-10-20 to store them and check with Google. Review text is never stored |
| The business's own website | schema.org menu items or services with prices and diet tags, hours, price range, menu pages, menu PDFs and menu images, and its own Zomato/Swiggy/Instagram links | robots.txt respected, 6 pages at most |
| Zomato / Swiggy | Menu items, prices and veg tags, only from the page the business itself links to | One plain request, robots.txt respected. If the site refuses, the report says so; nothing tries to get around it |
| Menu photos and PDFs | Items read by the `ai` function's `menu` task (DeepSeek) from real menus only, saved unlisted for the owner to check | Kept only when at least 3 items are read |
| Wikipedia / Wikidata | A short history (up to 600 characters) and founding year, only for places OpenStreetMap links to their article | CC BY-SA: the credit is saved under the history |
| Wikimedia Commons | A cover photo, only public domain, CC0, CC BY or CC BY-SA, with its credit added to the about text | Never stock or AI pictures |
| `--input` file | Whatever you collected from the owner or by hand | Same writer, same checks |

Google rating and review count are saved in `places.google_rating`, `google_rating_count` and
`google_synced_at`. Search ranks by our own reviews first, then by Google's rating weighted by its review
count (`gscore`), then distance. Home cards show a small "G 4.4★ 28K" pill.

Still shown live on the shop page from Google: open now and Google's review summary (written by Gemini and
labelled so).

## What it writes

- `places`: new places go live with `verification = verified` when matched to Google, otherwise `pending`
  (the admin Verify tab). Existing places are matched by Google ID, or by name in the same city within
  250 m (so chain branches stay separate). They only get empty fields filled and new links added;
  `--overwrite` replaces details on places no owner has claimed. Search-page links saved by older scripts
  are dropped, since the app builds those itself.
- `items`: new names only, `is_listed = false`, prices only when in the shop's currency. Menus are only
  looked for when the place has no items yet.
- `qr_codes`: one "Counter" QR if the place has none, with the database's per-type review limits.
- `subscriptions`: untouched (every new place starts on the free trial) unless you pass `--plan starter --months 12`.

## `--input` format

A JSON list. The older `onboardBusiness()` fields are accepted:

```json
[{
  "name": "Example Sweets", "kind": "food", "category": "Sweet shop", "city": "Varanasi", "area": "Lanka",
  "lat": 25.2789, "lng": 82.9993, "phone": "+91 542 000 0000", "website_url": "https://example.com",
  "zomato_url": "https://www.zomato.com/varanasi/example-sweets-lanka", "instagram_url": "https://www.instagram.com/example",
  "hours": { "Mon–Sun": "8 am–10 pm" },
  "items": [{ "name": "Kaju Katli", "price_inr": 900, "section": "Sweets", "diet": ["veg"] }]
}]
```

`kind` is one of food, store, beauty, health, fitness, education, services, other (salon, retail, gym,
clinic and school are understood too).
