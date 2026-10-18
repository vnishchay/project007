-- Trusted Picks: US & Europe B2B SaaS Tiers & Pricing Model
-- Starter (Free) $0/mo: Up to 15 AI reviews/mo, digital QR kit, top-dish discovery
-- Growth Pro $59/mo: Unlimited AI Google reviews, Private Negative Feedback Shield, sentiment analytics, unblurred contacts
-- Autopilot VIP $119/mo: Growth Pro + 1-Click Guest Retargeting + Verified Partner Badge

insert into public.plans (code, name, qr_limit, price_inr_year, price_inr_month, price_usd_year, price_usd_month, features, sort_order)
values
  ('starter', 'Starter (Free)', 5, 0, 0, 0, 0,
   '{"5 review QRs", "AI Menu onboarding", "Top-Dish discovery view", "Up to 15 AI reviews/mo"}', 1),
  ('growth_pro', 'Growth Pro', 25, 49000, 4900, 590, 59,
   '{"25 review QRs", "Unlimited AI Google reviews", "Private Negative Feedback Shield", "Unblurred guest contacts", "Dish sentiment analytics"}', 2),
  ('autopilot_vip', 'Autopilot VIP', 100, 99000, 9900, 1190, 119,
   '{"Everything in Growth Pro", "100 review QRs", "1-Click Guest Retargeting", "VIP Partner Badge", "Dedicated Onboarding"}', 3)
on conflict (code) do update set
  name = excluded.name,
  qr_limit = excluded.qr_limit,
  price_inr_year = excluded.price_inr_year,
  price_inr_month = excluded.price_inr_month,
  price_usd_year = excluded.price_usd_year,
  price_usd_month = excluded.price_usd_month,
  features = excluded.features,
  sort_order = excluded.sort_order;
