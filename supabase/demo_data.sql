-- Trusted Picks: demo businesses for testing. Safe to run more than once.
-- Every demo place starts with "[Demo]" in its About text; remove them with the
-- DELETE at the bottom when you're done testing. Demo places have no Google Place ID,
-- so the Google step falls back to a Maps search by name.

set search_path = public, extensions;

-- Older copies of this file stored fake ids such as "demo-forno-napoli"; clear them.
update public.places set google_place_id = null where google_place_id like 'demo-%';


with demo (key, name, category, area, about, price, lat, lng, hours, items) as (values
  ('Forno Napoli', 'Forno Napoli', 'Pizzeria', 'Koregaon Park',
   '[Demo] Wood-fired Neapolitan pizza with imported San Marzano tomatoes.', 3, 18.5362, 73.8940,
   '{"Mon–Sun": "12–11 pm"}', array['Margherita|Pizza', 'Diavola|Pizza', 'Burrata Pizza|Pizza', 'Tiramisu|Dessert']),
  ('Kaapi Corner', 'Kaapi Corner', 'Cafe', 'Baner',
   '[Demo] South Indian filter coffee and crisp dosas, brewed in brass dabaras.', 1, 18.5590, 73.7868,
   '{"Mon–Sat": "7 am–9 pm", "Sun": "8 am–1 pm"}', array['Filter Coffee|Filter coffee', 'Masala Dosa|Dosa', 'Ghee Podi Idli|Dosa']),
  ('Hyderabad Biryani House', 'Hyderabad Biryani House', 'Restaurant', 'Viman Nagar',
   '[Demo] Dum-cooked Hyderabadi biryani, slow-cooked in sealed handis.', 2, 18.5679, 73.9143,
   '{"Mon–Sun": "11:30 am–11:30 pm"}', array['Chicken Dum Biryani|Biryani', 'Mutton Biryani|Biryani', 'Double Ka Meetha|Dessert']),
  ('Sugar Loaf Bakery', 'Sugar Loaf Bakery', 'Bakery', 'Kalyani Nagar',
   '[Demo] Small-batch sourdough, croissants and celebration cakes.', 2, 18.5463, 73.9033,
   '{"Tue–Sun": "8 am–8 pm"}', array['Butter Croissant|Bakery', 'Sourdough Loaf|Bakery', 'Coffee|Coffee']),
  ('Fade Studio', 'Fade Studio', 'Salon', 'Aundh',
   '[Demo] Barbers for fades, beard work and quick trims.', 2, 18.5590, 73.8075,
   '{"Mon–Sun": "10 am–9 pm"}', array['Skin Fade|Haircut', 'Beard Trim|Haircut', 'Head Massage|Spa'])
)
insert into public.places (name, category, area, city, about, price_level, location, hours, status, listed_until)
select name, category, area, 'Pune', about, price,
       st_setsrid(st_makepoint(lng, lat), 4326)::geography, hours::jsonb, 'live', current_date + interval '1 year'
from demo d
where not exists (select 1 from public.places p where p.name = d.name and p.about like '[Demo]%');

update public.places set status = 'live', listed_until = current_date + interval '1 year'
where about like '[Demo]%';

-- Menu items, so the review screen has chips to pick from.
with demo (pname, items) as (values
  ('Forno Napoli', array['Margherita|Pizza', 'Diavola|Pizza', 'Burrata Pizza|Pizza', 'Tiramisu|Dessert']),
  ('Kaapi Corner', array['Filter Coffee|Filter coffee', 'Masala Dosa|Dosa', 'Ghee Podi Idli|Dosa']),
  ('Hyderabad Biryani House', array['Chicken Dum Biryani|Biryani', 'Mutton Biryani|Biryani', 'Double Ka Meetha|Dessert']),
  ('Sugar Loaf Bakery', array['Butter Croissant|Bakery', 'Sourdough Loaf|Bakery', 'Coffee|Coffee']),
  ('Fade Studio', array['Skin Fade|Haircut', 'Beard Trim|Haircut', 'Head Massage|Spa'])
)
insert into public.items (place_id, topic_id, name)
select p.id, t.id, split_part(it, '|', 1)
from demo d
join public.places p on p.name = d.pname and p.about like '[Demo]%'
cross join unnest(d.items) it
left join public.topics t on t.name = split_part(it, '|', 2)
on conflict (place_id, name_normalized) do nothing;

-- Table QR codes with fixed tokens, so the printed codes keep working.
insert into public.qr_codes (place_id, token, style, table_label)
select p.id, q.token, q.style::public.qr_style, q.label
from (values
  ('Forno Napoli', '55a233a56de7d4b6', 'paper', 'Table 1'),
  ('Forno Napoli', '215a67bb4a6e9fd4', 'neon',  'Table 2'),
  ('Kaapi Corner', 'fd1dc6ca818aba38', 'paper', 'Counter'),
  ('Hyderabad Biryani House', '665bf7f2b2ba6f63', 'paper', 'Table 4'),
  ('Sugar Loaf Bakery', 'a0232967e94b7c3f', 'paper', 'Counter'),
  ('Fade Studio', '05b0247f40a8fa4b', 'neon',  'Chair 1')
) as q (pname, token, style, label)
join public.places p on p.name = q.pname and p.about like '[Demo]%'
on conflict (token) do nothing;

select p.name, q.table_label, q.token from public.qr_codes q join public.places p on p.id = q.place_id
where p.about like '[Demo]%' order by p.name, q.table_label;

-- To remove all demo data later (reviews and QR codes go with the places):
-- delete from public.places where about like '[Demo]%';
