# Onboarding real businesses

`npm run onboard` fills Trusted Picks with real, public facts about local businesses. It never writes
reviews, ratings or visits, never uses AI to write or picture anything, and never scrapes Zomato, Swiggy,
Justdial or Google.

```bash
npm run onboard -- --city Varanasi --dry-run              # look first: writes a report, touches nothing
npm run onboard -- --city Varanasi --limit 200            # restaurants, cafés, sweet shops, bakeries
npm run onboard -- --city Varanasi --kinds food,beauty,health,fitness --limit 500
npm run onboard -- --city Varanasi --around 25.3109,83.0107 --radius 1500
npm run onboard -- --input my-shops.json                  # businesses you collected yourself
npm run onboard -- --help
```

Needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env` (not for `--dry-run`), and optionally
`GOOGLE_MAPS_KEY` to link places to Google. Every run writes a JSON report to `scripts/onboard/out/`.

## Where each fact comes from

| Source | What we take | Rules we follow |
| --- | --- | --- |
| OpenStreetMap (Nominatim + Overpass) | Name, type, cuisine, map pin, opening hours, phone, email, website, Instagram/Facebook/WhatsApp, diet (pure veg, vegan, Jain), amenities, year founded | ODbL: credited on the Terms page. 1 Nominatim request a second |
| Google Places API (New) | Only the Place ID, after the name matches within 250 m. Places Google marks closed for good are skipped | Google lets us keep Place IDs, not ratings, reviews, photos or hours. The app shows those live |
| The business's own website | schema.org menu items or services with prices and diet tags, hours, price range, and the links it gives to its own Zomato/Swiggy/Instagram pages | robots.txt respected, 2 pages at most, no photos or prose copied |
| Wikimedia Commons | A cover photo, only public domain, CC0, CC BY or CC BY-SA, with its credit added to the about text | Never stock or AI pictures |
| `--input` file | Whatever you collected from the owner or by hand | Same writer, same checks |

## What it writes

- `places`: new places go live with `verification = verified` when matched to Google, otherwise `pending`
  (the admin Verify tab). Existing places are matched by Google ID, or by name in the same city within
  250 m (so chain branches stay separate). They only get empty fields filled and new links added;
  `--overwrite` replaces details on places no owner has claimed. Search-page links saved by older scripts
  are dropped, since the app builds those itself.
- `items`: new names only, `is_listed = false`, prices only when in the shop's currency.
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
