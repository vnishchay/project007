-- Trusted Picks: demo businesses for testing. Safe to run more than once.
-- Every demo place starts with "[Demo]" in its About text; remove them with the
-- DELETE at the bottom when you're done testing.

set search_path = public, extensions;

with demo (gid, name, category, area, about, price, lat, lng, hours, items) as (values
  ('demo-forno-napoli', 'Forno Napoli', 'Pizzeria', 'Koregaon Park',
   '[Demo] Wood-fired Neapolitan pizza with imported San Marzano tomatoes.', 3, 18.5362, 73.8940,
   '{"Mon–Sun": "12–11 pm"}', array['Margherita|Pizza', 'Diavola|Pizza', 'Burrata Pizza|Pizza', 'Tiramisu|Dessert']),
  ('demo-kaapi-corner', 'Kaapi Corner', 'Cafe', 'Baner',
   '[Demo] South Indian filter coffee and crisp dosas, brewed in brass dabaras.', 1, 18.5590, 73.7868,
   '{"Mon–Sat": "7 am–9 pm", "Sun": "8 am–1 pm"}', array['Filter Coffee|Filter coffee', 'Masala Dosa|Dosa', 'Ghee Podi Idli|Dosa']),
  ('demo-biryani-house', 'Hyderabad Biryani House', 'Restaurant', 'Viman Nagar',
   '[Demo] Dum-cooked Hyderabadi biryani, slow-cooked in sealed handis.', 2, 18.5679, 73.9143,
   '{"Mon–Sun": "11:30 am–11:30 pm"}', array['Chicken Dum Biryani|Biryani', 'Mutton Biryani|Biryani', 'Double Ka Meetha|Dessert']),
  ('demo-sugar-loaf', 'Sugar Loaf Bakery', 'Bakery', 'Kalyani Nagar',
   '[Demo] Small-batch sourdough, croissants and celebration cakes.', 2, 18.5463, 73.9033,
   '{"Tue–Sun": "8 am–8 pm"}', array['Butter Croissant|Bakery', 'Sourdough Loaf|Bakery', 'Coffee|Coffee']),
  ('demo-fade-studio', 'Fade Studio', 'Salon', 'Aundh',
   '[Demo] Barbers for fades, beard work and quick trims.', 2, 18.5590, 73.8075,
   '{"Mon–Sun": "10 am–9 pm"}', array['Skin Fade|Haircut', 'Beard Trim|Haircut', 'Head Massage|Spa'])
)
insert into public.places (google_place_id, name, category, area, city, about, price_level, location, hours, status, listed_until)
select gid, name, category, area, 'Pune', about, price,
       st_setsrid(st_makepoint(lng, lat), 4326)::geography, hours::jsonb, 'live', current_date + interval '1 year'
from demo
on conflict (google_place_id) do update set status = 'live', listed_until = excluded.listed_until;

-- Menu items, so the review screen has chips to pick from.
with demo (gid, items) as (values
  ('demo-forno-napoli', array['Margherita|Pizza', 'Diavola|Pizza', 'Burrata Pizza|Pizza', 'Tiramisu|Dessert']),
  ('demo-kaapi-corner', array['Filter Coffee|Filter coffee', 'Masala Dosa|Dosa', 'Ghee Podi Idli|Dosa']),
  ('demo-biryani-house', array['Chicken Dum Biryani|Biryani', 'Mutton Biryani|Biryani', 'Double Ka Meetha|Dessert']),
  ('demo-sugar-loaf', array['Butter Croissant|Bakery', 'Sourdough Loaf|Bakery', 'Coffee|Coffee']),
  ('demo-fade-studio', array['Skin Fade|Haircut', 'Beard Trim|Haircut', 'Head Massage|Spa'])
)
insert into public.items (place_id, topic_id, name)
select p.id, t.id, split_part(it, '|', 1)
from demo d
join public.places p on p.google_place_id = d.gid
cross join unnest(d.items) it
left join public.topics t on t.name = split_part(it, '|', 2)
on conflict (place_id, name_normalized) do nothing;

-- Table QR codes with fixed tokens, so the printed codes keep working.
insert into public.qr_codes (place_id, token, style, table_label)
select p.id, q.token, q.style::public.qr_style, q.label
from (values
  ('demo-forno-napoli', '55a233a56de7d4b6', 'paper', 'Table 1'),
  ('demo-forno-napoli', '215a67bb4a6e9fd4', 'neon',  'Table 2'),
  ('demo-kaapi-corner', 'fd1dc6ca818aba38', 'paper', 'Counter'),
  ('demo-biryani-house', '665bf7f2b2ba6f63', 'paper', 'Table 4'),
  ('demo-sugar-loaf', 'a0232967e94b7c3f', 'paper', 'Counter'),
  ('demo-fade-studio', '05b0247f40a8fa4b', 'neon',  'Chair 1')
) as q (gid, token, style, label)
join public.places p on p.google_place_id = q.gid
on conflict (token) do nothing;

select p.name, q.table_label, q.token from public.qr_codes q join public.places p on p.id = q.place_id
where p.google_place_id like 'demo-%' order by p.name, q.table_label;

-- To remove all demo data later (reviews and QR codes go with the places):
-- delete from public.places where google_place_id like 'demo-%';
