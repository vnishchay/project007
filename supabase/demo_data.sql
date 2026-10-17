-- Trusted Picks: demo businesses, people, friends and reviews, so every screen has something on it.
-- Safe to run more than once. Nothing here is real: shops start with "[Demo]" in About, and people
-- cannot sign in (no password) and carry {"demo": true}. Removal queries are at the bottom.
-- Put the email you sign in with at "my_email" in the People block, so the demo friends appear in your account.

set search_path = public, extensions;

-- Older copies of this file stored fake ids such as "demo-forno-napoli"; clear them.
update public.places set google_place_id = null where google_place_id like 'demo-%';

with demo (name, category, area, about, price, lat, lng, hours) as (values
  ('Forno Napoli', 'Pizzeria', 'Koregaon Park', '[Demo] Wood-fired Neapolitan pizza with imported San Marzano tomatoes.', 3, 18.5362, 73.894, '{"Mon–Sun": "12–11 pm"}'),
  ('Kaapi Corner', 'Cafe', 'Baner', '[Demo] South Indian filter coffee and crisp dosas, brewed in brass dabaras.', 1, 18.559, 73.7868, '{"Mon–Sat": "7 am–9 pm", "Sun": "8 am–1 pm"}'),
  ('Hyderabad Biryani House', 'Restaurant', 'Viman Nagar', '[Demo] Dum-cooked Hyderabadi biryani, slow-cooked in sealed handis.', 2, 18.5679, 73.9143, '{"Mon–Sun": "11:30 am–11:30 pm"}'),
  ('Sugar Loaf Bakery', 'Bakery', 'Kalyani Nagar', '[Demo] Small-batch sourdough, croissants and celebration cakes.', 2, 18.5463, 73.9033, '{"Tue–Sun": "8 am–8 pm"}'),
  ('Fade Studio', 'Salon', 'Aundh', '[Demo] Barbers for fades, beard work and quick trims.', 2, 18.559, 73.8075, '{"Mon–Sun": "10 am–9 pm"}'),
  ('Masala Library', 'Restaurant', 'Koregaon Park', '[Demo] Modern Indian plates: smoky kebabs, slow curries and hot breads.', 3, 18.5402, 73.8972, '{"Mon–Sun": "12 pm–11:30 pm"}'),
  ('Brew Society', 'Cafe', 'Aundh', '[Demo] Small-batch coffee, cold brews and all-day brunch.', 2, 18.5584, 73.8089, '{"Mon–Sun": "8 am–11 pm"}'),
  ('Tandoor Tales', 'Restaurant', 'Kothrud', '[Demo] Family tandoor house: kebabs, rolls and rich gravies.', 2, 18.5074, 73.8077, '{"Mon–Sun": "11 am–11 pm"}'),
  ('Iron Temple Gym', 'Gym', 'Baner', '[Demo] Strength floor, group classes and friendly coaches.', 2, 18.5642, 73.7769, '{"Mon–Sat": "5 am–10 pm"}'),
  ('Glow Beauty Parlour', 'Beauty parlour', 'Viman Nagar', '[Demo] Facials, hair spa and bridal makeup by a careful team.', 2, 18.5701, 73.9186, '{"Mon–Sun": "10 am–8 pm"}'),
  ('Urban Threads', 'Clothing store', 'FC Road', '[Demo] Everyday cotton wear, kurtas and easy-returns shopping.', 2, 18.5196, 73.8419, '{"Mon–Sun": "11 am–9 pm"}'),
  ('CarePlus Clinic', 'Clinic', 'Kalyani Nagar', '[Demo] Family doctor and walk-in clinic, short waits.', 2, 18.5467, 73.9061, '{"Mon–Sat": "9 am–8 pm"}'),
  ('Pasta Fresca', 'Italian restaurant', 'Camp', '[Demo] Hand-rolled pasta, slow ragù and a small, honest wine list.', 3, 18.5171, 73.8795, '{"Mon–Sun": "12 pm–11 pm"}'),
  ('Burger Barn', 'Burger restaurant', 'Wakad', '[Demo] Smash burgers, loaded fries and thick shakes.', 2, 18.599, 73.76, '{"Mon–Sun": "12 pm–12 am"}'),
  ('Madras Tiffin Room', 'Tiffin restaurant', 'Karve Nagar', '[Demo] Old-school South Indian tiffin served on banana leaf.', 1, 18.4915, 73.82, '{"Mon–Sun": "7 am–10 pm"}'),
  ('Chaat Street', 'Street food', 'Deccan', '[Demo] Tangy, crunchy chaat made fresh to order.', 1, 18.5164, 73.841, '{"Mon–Sun": "4 pm–11 pm"}'),
  ('Sweet Tooth Creamery', 'Dessert parlour', 'Koregaon Park', '[Demo] Small-batch gelato, sundaes and warm brownies.', 2, 18.539, 73.896, '{"Mon–Sun": "1 pm–11 pm"}'),
  ('Bombay Bites', 'Restaurant', 'Pimple Saudagar', '[Demo] Mumbai street classics: vada pav, pav bhaji and cutting chai.', 1, 18.597, 73.793, '{"Mon–Sun": "8 am–11 pm"}'),
  ('Green Bowl', 'Cafe', 'Baner', '[Demo] Fresh salads, grain bowls and cold-pressed juices.', 2, 18.561, 73.79, '{"Mon–Sat": "8 am–9 pm"}'),
  ('The Book Nook Cafe', 'Cafe', 'Kothrud', '[Demo] Coffee and cake among shelves of second-hand books.', 2, 18.503, 73.807, '{"Mon–Sun": "10 am–10 pm"}'),
  ('Spice Route', 'Restaurant', 'Viman Nagar', '[Demo] Indo-Chinese and Thai plates cooked on a roaring wok.', 2, 18.566, 73.91, '{"Mon–Sun": "12 pm–11 pm"}'),
  ('Smoke House BBQ', 'Restaurant', 'Hadapsar', '[Demo] Slow-smoked meats, house rubs and big sides.', 3, 18.5089, 73.926, '{"Mon–Sun": "1 pm–11:30 pm"}'),
  ('Studio Zen Yoga', 'Yoga studio', 'Aundh', '[Demo] Hatha, vinyasa and breathwork in a calm sunlit room.', 2, 18.56, 73.805, '{"Mon–Sat": "6 am–8 pm"}'),
  ('FitHub CrossFit', 'CrossFit gym', 'Kalyani Nagar', '[Demo] Coached CrossFit classes, small groups and open gym.', 3, 18.548, 73.904, '{"Mon–Sat": "5:30 am–9 pm"}'),
  ('Blade & Co Barbers', 'Barber shop', 'Camp', '[Demo] Classic cuts, hot towel shaves and beard sculpting.', 2, 18.515, 73.878, '{"Mon–Sun": "10 am–9 pm"}'),
  ('Nail Bar', 'Nail studio', 'Koregaon Park', '[Demo] Gel manicures, pedicures and custom nail art.', 2, 18.538, 73.892, '{"Mon–Sun": "11 am–8 pm"}'),
  ('BrightPath Coaching', 'Coaching class', 'Kothrud', '[Demo] Small-batch maths and science coaching for classes 8 to 12.', 2, 18.506, 73.81, '{"Mon–Sat": "4 pm–9 pm"}'),
  ('Little Steps Preschool', 'School', 'Baner', '[Demo] Play-based preschool with caring teachers and a safe campus.', 3, 18.565, 73.78, '{"Mon–Fri": "8 am–2 pm"}'),
  ('FixIt Home Services', 'Home repair service', 'Hadapsar', '[Demo] On-time electricians, plumbers and AC technicians.', 2, 18.51, 73.925, '{"Mon–Sun": "8 am–8 pm"}'),
  ('Wheels Garage', 'Car garage', 'Wakad', '[Demo] Honest car servicing with photo updates at every step.', 2, 18.598, 73.759, '{"Mon–Sat": "9 am–7 pm"}'),
  ('SmileCare Dental', 'Dental clinic', 'Camp', '[Demo] Gentle dentistry, clear explanations and fair prices.', 2, 18.516, 73.88, '{"Mon–Sat": "10 am–7 pm"}'),
  ('PetPals Vet', 'Vet clinic', 'Aundh', '[Demo] Friendly vets for dogs, cats and small pets.', 2, 18.557, 73.806, '{"Mon–Sat": "10 am–8 pm"}'),
  ('Paper Trail Books', 'Bookstore', 'FC Road', '[Demo] Independent bookshop with a loved staff-picks wall.', 2, 18.521, 73.843, '{"Mon–Sun": "10 am–9 pm"}'),
  ('Gadget Galaxy', 'Electronics store', 'Hadapsar', '[Demo] Phones, audio and accessories with a real warranty.', 2, 18.507, 73.928, '{"Mon–Sun": "11 am–9 pm"}')
)
insert into public.places (name, category, area, city, about, price_level, location, hours, status, listed_until)
select name, category, area, 'Pune', about, price, st_setsrid(st_makepoint(lng, lat), 4326)::geography, hours::jsonb, 'live', current_date + interval '1 year'
from demo d
where not exists (select 1 from public.places p where p.name = d.name and p.about like '[Demo]%');

update public.places set status = 'live', listed_until = current_date + interval '1 year'
where about like '[Demo]%';

-- Menu items with prices, so the review screen has dishes to pick from.
with demo (pname, iname, topic, price, descr, ord) as (values
  ('Forno Napoli', 'Margherita', 'Pizza', 450, 'San Marzano tomato, fior di latte, fresh basil', 1),
  ('Forno Napoli', 'Diavola', 'Pizza', 560, 'Spicy salami and chilli oil', 2),
  ('Forno Napoli', 'Burrata Pizza', 'Pizza', 690, 'Creamy burrata and rocket', 3),
  ('Forno Napoli', 'Tiramisu', 'Dessert', 320, 'Espresso-soaked, mascarpone cream', 4),
  ('Kaapi Corner', 'Filter Coffee', 'Filter coffee', 80, 'Brass-tumbler decoction coffee', 1),
  ('Kaapi Corner', 'Masala Dosa', 'Dosa', 140, 'Crisp dosa, potato masala, coconut chutney', 2),
  ('Kaapi Corner', 'Ghee Podi Idli', 'Dosa', 120, 'Soft idlis tossed in ghee and podi', 3),
  ('Hyderabad Biryani House', 'Chicken Dum Biryani', 'Biryani', 320, 'Sealed handi, saffron rice, raita', 1),
  ('Hyderabad Biryani House', 'Mutton Biryani', 'Biryani', 420, 'Slow-cooked mutton, long grain rice', 2),
  ('Hyderabad Biryani House', 'Double Ka Meetha', 'Dessert', 140, 'Warm bread pudding with rabri', 3),
  ('Sugar Loaf Bakery', 'Butter Croissant', 'Bakery', 160, 'Laminated all-butter croissant', 1),
  ('Sugar Loaf Bakery', 'Sourdough Loaf', 'Bakery', 260, '48-hour fermented sourdough', 2),
  ('Sugar Loaf Bakery', 'Coffee', 'Coffee', 120, 'Fresh filter or espresso', 3),
  ('Sugar Loaf Bakery', 'Chocolate Cake', 'Dessert', 480, 'Dark chocolate ganache layers', 4),
  ('Fade Studio', 'Skin Fade', 'Haircut', 400, 'Clean skin fade with finish', 1),
  ('Fade Studio', 'Beard Trim', 'Haircut', 200, 'Shaping, line-up and hot towel', 2),
  ('Fade Studio', 'Head Massage', 'Spa', 250, '15 minutes, oil or dry', 3),
  ('Masala Library', 'Butter Chicken', null, 520, 'Charred chicken in tomato butter gravy', 1),
  ('Masala Library', 'Paneer Tikka', null, 380, 'Clay oven paneer, mint chutney', 2),
  ('Masala Library', 'Garlic Naan', null, 90, 'Blistered naan with garlic butter', 3),
  ('Masala Library', 'Dal Makhani', null, 340, 'Overnight black dal, cream', 4),
  ('Masala Library', 'Gulab Jamun', 'Dessert', 160, 'Warm, with cardamom syrup', 5),
  ('Brew Society', 'Flat White', 'Coffee', 220, 'Double ristretto, silky milk', 1),
  ('Brew Society', 'Cold Brew', 'Coffee', 240, '18-hour steeped, over ice', 2),
  ('Brew Society', 'Avocado Toast', null, 360, 'Sourdough, smashed avocado, poached egg', 3),
  ('Brew Society', 'Blueberry Muffin', 'Bakery', 150, 'Baked every morning', 4),
  ('Tandoor Tales', 'Chicken Tikka', null, 340, 'Yoghurt-marinated, clay oven', 1),
  ('Tandoor Tales', 'Seekh Kebab Roll', null, 220, 'Lamb seekh, onions, mint chutney', 2),
  ('Tandoor Tales', 'Tandoori Roti', null, 30, 'Fresh from the tandoor', 3),
  ('Tandoor Tales', 'Chicken Handi', null, 390, 'Slow-cooked, thick gravy', 4),
  ('Iron Temple Gym', 'Monthly Membership', null, 1800, 'Full floor access, all classes', 1),
  ('Iron Temple Gym', 'Personal Training', null, 6000, '12 sessions with a coach', 2),
  ('Iron Temple Gym', 'Yoga Class', null, 400, 'Drop-in morning class', 3),
  ('Glow Beauty Parlour', 'Hair Spa', 'Spa', 1200, 'Deep conditioning and massage', 1),
  ('Glow Beauty Parlour', 'Gold Facial', 'Spa', 1500, 'Brightening 60-minute facial', 2),
  ('Glow Beauty Parlour', 'Haircut', 'Haircut', 500, 'Wash, cut and blow-dry', 3),
  ('Urban Threads', 'Cotton Kurta', null, 1299, 'Breathable cotton, easy returns', 1),
  ('Urban Threads', 'Linen Shirt', null, 1599, 'Relaxed fit, soft linen', 2),
  ('Urban Threads', 'Denim Jacket', null, 2499, 'Classic wash, lined', 3),
  ('CarePlus Clinic', 'General Consultation', null, 500, '15-minute visit with the doctor', 1),
  ('CarePlus Clinic', 'Health Check', null, 1800, 'Blood work and consultation', 2),
  ('Pasta Fresca', 'Penne Arrabbiata', 'Pasta', 420, 'Spicy tomato, garlic, parsley', 1),
  ('Pasta Fresca', 'Truffle Mushroom Risotto', 'Pasta', 560, 'Arborio rice, wild mushrooms, truffle oil', 2),
  ('Pasta Fresca', 'Garlic Bread', 'Bakery', 220, 'Toasted ciabatta, garlic butter', 3),
  ('Pasta Fresca', 'Panna Cotta', 'Dessert', 260, 'Vanilla bean, berry compote', 4),
  ('Burger Barn', 'Classic Smash Burger', 'Burger', 280, 'Double patty, American cheese, pickles', 1),
  ('Burger Barn', 'Peri Peri Fries', null, 160, 'Crispy fries, peri peri seasoning', 2),
  ('Burger Barn', 'Chicken Crunch Burger', 'Burger', 310, 'Buttermilk fried chicken, slaw', 3),
  ('Burger Barn', 'Oreo Shake', 'Dessert', 210, 'Thick shake with cookie crumble', 4),
  ('Madras Tiffin Room', 'Idli Sambar', 'Dosa', 90, 'Four idlis, sambar, three chutneys', 1),
  ('Madras Tiffin Room', 'Ghee Pongal', null, 110, 'Peppery rice and dal, ghee', 2),
  ('Madras Tiffin Room', 'Medu Vada', 'Dosa', 80, 'Crisp outside, fluffy inside', 3),
  ('Madras Tiffin Room', 'Filter Kaapi', 'Filter coffee', 60, 'Strong decoction, frothy milk', 4),
  ('Chaat Street', 'Pani Puri', null, 70, 'Six puris with spiced water', 1),
  ('Chaat Street', 'Sev Puri', null, 80, 'Crisp puris, chutneys, sev', 2),
  ('Chaat Street', 'Dahi Papdi Chaat', null, 100, 'Papdi, curd, tamarind, pomegranate', 3),
  ('Sweet Tooth Creamery', 'Salted Caramel Gelato', 'Dessert', 180, 'House-made, two scoops', 1),
  ('Sweet Tooth Creamery', 'Warm Brownie Sundae', 'Dessert', 280, 'Brownie, vanilla gelato, fudge', 2),
  ('Sweet Tooth Creamery', 'Mango Sorbet', 'Dessert', 160, 'Alphonso mango, dairy free', 3),
  ('Bombay Bites', 'Vada Pav', null, 40, 'Spicy potato fritter in a soft pav', 1),
  ('Bombay Bites', 'Pav Bhaji', null, 160, 'Buttery bhaji with toasted pav', 2),
  ('Bombay Bites', 'Masala Chai', null, 30, 'Strong, ginger and cardamom', 3),
  ('Green Bowl', 'Quinoa Power Bowl', null, 380, 'Quinoa, roasted veg, tahini', 1),
  ('Green Bowl', 'Greek Salad', null, 320, 'Feta, olives, cucumber', 2),
  ('Green Bowl', 'Cold-pressed Green Juice', null, 180, 'Spinach, apple, cucumber', 3),
  ('The Book Nook Cafe', 'Cappuccino', 'Coffee', 170, 'Double shot, velvety foam', 1),
  ('The Book Nook Cafe', 'Lemon Drizzle Cake', 'Dessert', 190, 'Fresh lemon, light crumb', 2),
  ('The Book Nook Cafe', 'Cheese Toastie', null, 210, 'Three cheeses, sourdough', 3),
  ('Spice Route', 'Hakka Noodles', null, 260, 'Wok-tossed, crisp veg', 1),
  ('Spice Route', 'Chilli Chicken', null, 320, 'Dry or gravy', 2),
  ('Spice Route', 'Thai Green Curry', null, 380, 'Coconut, basil, jasmine rice', 3),
  ('Spice Route', 'Crispy Spring Rolls', null, 180, 'Veg, sweet chilli dip', 4),
  ('Smoke House BBQ', 'Smoked Pork Ribs', null, 640, '12-hour smoke, sticky glaze', 1),
  ('Smoke House BBQ', 'BBQ Chicken Wings', null, 360, 'Hickory glaze', 2),
  ('Smoke House BBQ', 'Brisket Burger', 'Burger', 450, 'Smoked brisket, pickled onions', 3),
  ('Smoke House BBQ', 'Mac and Cheese', null, 280, 'Baked, crunchy top', 4),
  ('Studio Zen Yoga', 'Drop-in Class', null, 500, '60-minute group class', 1),
  ('Studio Zen Yoga', 'Monthly Pass', null, 3000, 'Unlimited classes', 2),
  ('Studio Zen Yoga', 'Private Session', null, 1500, 'One-to-one, tailored', 3),
  ('FitHub CrossFit', 'Monthly Membership', null, 3500, 'Unlimited classes and open gym', 1),
  ('FitHub CrossFit', 'Intro Course', null, 2000, 'Four beginner sessions', 2),
  ('FitHub CrossFit', 'Personal Training', null, 900, 'Per session', 3),
  ('Blade & Co Barbers', 'Classic Haircut', 'Haircut', 350, 'Scissor cut and style', 1),
  ('Blade & Co Barbers', 'Hot Towel Shave', null, 300, 'Straight razor, essential oils', 2),
  ('Blade & Co Barbers', 'Beard Sculpt', 'Haircut', 250, 'Shape, trim and line-up', 3),
  ('Nail Bar', 'Gel Manicure', null, 900, 'Long-wear gel, 45 minutes', 1),
  ('Nail Bar', 'Spa Pedicure', 'Spa', 1100, 'Soak, scrub, massage, polish', 2),
  ('Nail Bar', 'Nail Art', null, 600, 'Per set, custom designs', 3),
  ('BrightPath Coaching', 'Maths Batch', null, 2500, 'Per month, 3 classes a week', 1),
  ('BrightPath Coaching', 'Science Batch', null, 2500, 'Per month, 3 classes a week', 2),
  ('BrightPath Coaching', 'Doubt Clearing Session', null, 300, 'One-hour one-to-one', 3),
  ('Little Steps Preschool', 'Morning Batch', null, 4500, 'Per month, 8 am to 12 pm', 1),
  ('Little Steps Preschool', 'Daycare', null, 6500, 'Per month, until 5 pm', 2),
  ('Little Steps Preschool', 'Summer Camp', null, 5000, 'Four-week programme', 3),
  ('FixIt Home Services', 'AC Service', null, 699, 'Deep clean and gas check', 1),
  ('FixIt Home Services', 'Plumbing Visit', null, 349, 'Per visit, parts extra', 2),
  ('FixIt Home Services', 'Electrician Visit', null, 299, 'Per visit, parts extra', 3),
  ('Wheels Garage', 'Full Car Service', null, 4500, 'Oil, filters, 40-point check', 1),
  ('Wheels Garage', 'Wheel Alignment', null, 800, 'Computerised', 2),
  ('Wheels Garage', 'Car Wash and Detail', null, 1200, 'Interior and exterior', 3),
  ('SmileCare Dental', 'Teeth Cleaning', null, 900, 'Scaling and polish', 1),
  ('SmileCare Dental', 'Root Canal', null, 6500, 'Single sitting where possible', 2),
  ('SmileCare Dental', 'Teeth Whitening', null, 8000, 'In-clinic, 60 minutes', 3),
  ('PetPals Vet', 'Health Checkup', null, 600, 'Full examination', 1),
  ('PetPals Vet', 'Vaccination', null, 900, 'Per vaccine', 2),
  ('PetPals Vet', 'Grooming', null, 1200, 'Bath, trim, nails', 3),
  ('Paper Trail Books', 'Staff Pick Novel', null, 499, 'Hand-picked every month', 1),
  ('Paper Trail Books', 'Stationery Set', null, 350, 'Notebook and pens', 2),
  ('Paper Trail Books', 'Gift Voucher', null, 1000, 'Redeemable in store', 3),
  ('Gadget Galaxy', 'Wireless Earbuds', null, 2499, '12-hour battery, one-year warranty', 1),
  ('Gadget Galaxy', 'Phone Case', null, 499, 'Shockproof', 2),
  ('Gadget Galaxy', 'Power Bank 20000 mAh', null, 1799, 'Fast charging', 3)
)
insert into public.items (place_id, topic_id, name, price_inr, description, is_listed, sort_order)
select p.id, t.id, d.iname, d.price, d.descr, true, d.ord
from demo d
join public.places p on p.name = d.pname and p.about like '[Demo]%'
left join public.topics t on t.name = d.topic
on conflict (place_id, name_normalized) do update
  set price_inr = excluded.price_inr, description = excluded.description, is_listed = true, sort_order = excluded.sort_order,
      topic_id = coalesce(public.items.topic_id, excluded.topic_id);

-- A few news posts so the Updates section isn't empty.
insert into public.place_updates (place_id, body)
select p.id, u.body
from (values
  ('Forno Napoli', '[Demo] New on the menu this week: Burrata Pizza with rocket and cherry tomatoes.'),
  ('Kaapi Corner', '[Demo] Filter coffee tastings every Saturday morning, free with any breakfast.'),
  ('Hyderabad Biryani House', '[Demo] Weekend special: Mutton Biryani with a free Double Ka Meetha.'),
  ('Brew Society', '[Demo] Cold Brew is now on tap. Ask for a taster.'),
  ('Iron Temple Gym', '[Demo] Morning yoga batch starts Monday at 6:30 am.'),
  ('Pasta Fresca', '[Demo] Fresh truffle risotto is back for the season.'),
  ('Burger Barn', '[Demo] Free peri peri fries with every Classic Smash Burger this week.'),
  ('Sweet Tooth Creamery', '[Demo] New flavour: Mango Sorbet, made with Alphonso mangoes.'),
  ('Glow Beauty Parlour', '[Demo] Festive facial offers all month. Ask at reception.'),
  ('CarePlus Clinic', '[Demo] Free health check camp on the first Sunday of the month.'),
  ('Studio Zen Yoga', '[Demo] New evening breathwork class on Thursdays.'),
  ('Urban Threads', '[Demo] Linen shirts restocked in four new colours.')
) as u (pname, body)
join public.places p on p.name = u.pname and p.about like '[Demo]%'
where not exists (select 1 from public.place_updates x where x.place_id = p.id and x.body = u.body);

-- Table QR codes with fixed tokens, so printed codes keep working.
insert into public.qr_codes (place_id, token, style, table_label)
select p.id, q.token, q.style::public.qr_style, q.label
from (values
  ('Forno Napoli', '55a233a56de7d4b6', 'paper', 'Table 1'),
  ('Forno Napoli', '215a67bb4a6e9fd4', 'neon', 'Table 2'),
  ('Kaapi Corner', 'fd1dc6ca818aba38', 'paper', 'Counter'),
  ('Hyderabad Biryani House', '665bf7f2b2ba6f63', 'paper', 'Table 4'),
  ('Sugar Loaf Bakery', 'a0232967e94b7c3f', 'paper', 'Counter'),
  ('Fade Studio', '05b0247f40a8fa4b', 'neon', 'Chair 1'),
  ('Masala Library', '7a1c0e5d2b9f4c11', 'paper', 'Table 3'),
  ('Brew Society', '9b3d7e1a4c5f2d22', 'paper', 'Counter'),
  ('Tandoor Tales', 'c4e8a2f6d1b03e33', 'paper', 'Table 2'),
  ('Iron Temple Gym', 'e5f9b3a7c2d14f44', 'paper', 'Front desk'),
  ('Glow Beauty Parlour', '1a6c2e8f4b7d5a55', 'neon', 'Reception'),
  ('Urban Threads', '3c8e4a0b6d9f7c66', 'paper', 'Billing counter'),
  ('CarePlus Clinic', '5e0a6c2d8f1b9e77', 'paper', 'Reception'),
  ('Pasta Fresca', '37101633d2246bd9', 'matrix', 'Table 1'),
  ('Pasta Fresca', '5c7f681ff88ec5e6', 'matrix', 'Table 2'),
  ('Burger Barn', '00c2ea8572e8787e', 'paper', 'Table 1'),
  ('Burger Barn', 'd79cd12fbe3f34f8', 'paper', 'Table 2'),
  ('Madras Tiffin Room', 'f892f0284d699264', 'neon', 'Table 1'),
  ('Madras Tiffin Room', 'c78b954a0f0c6b2e', 'neon', 'Table 2'),
  ('Chaat Street', '59af27c6a535fb6f', 'aurora', 'Table 1'),
  ('Chaat Street', '917e3d52dce1c7ae', 'aurora', 'Table 2'),
  ('Sweet Tooth Creamery', 'f2254a0e69da6fb1', 'matrix', 'Table 1'),
  ('Sweet Tooth Creamery', '173b3919928a9a93', 'matrix', 'Table 2'),
  ('Bombay Bites', '6d331fa3b4cd52e9', 'paper', 'Table 1'),
  ('Bombay Bites', '22fa1c0248295bae', 'paper', 'Table 2'),
  ('Green Bowl', 'b266235e8fb26655', 'neon', 'Table 1'),
  ('Green Bowl', '5e018e1833c6fd35', 'neon', 'Table 2'),
  ('The Book Nook Cafe', '2cfb40613ffcad84', 'aurora', 'Table 1'),
  ('The Book Nook Cafe', '0a16ccb808c3f1f8', 'aurora', 'Table 2'),
  ('Spice Route', '69cd00287e1c812a', 'matrix', 'Table 1'),
  ('Spice Route', 'ec3e8761be30335f', 'matrix', 'Table 2'),
  ('Smoke House BBQ', 'bac783e6f13c1759', 'paper', 'Table 1'),
  ('Smoke House BBQ', '92a42eeff5124e80', 'paper', 'Table 2'),
  ('Studio Zen Yoga', 'b59f1e313699aa84', 'matrix', 'Reception'),
  ('FitHub CrossFit', '329a31c6554d8ac6', 'paper', 'Reception'),
  ('Blade & Co Barbers', '695ba07a634b862d', 'neon', 'Reception'),
  ('Nail Bar', '73c5370ce8b282f8', 'aurora', 'Reception'),
  ('BrightPath Coaching', '4eb1ef4f58eebcc8', 'matrix', 'Reception'),
  ('Little Steps Preschool', '99c8c9a65c7b0ee0', 'paper', 'Reception'),
  ('FixIt Home Services', 'c4234a131e71110b', 'neon', 'Reception'),
  ('Wheels Garage', '9c9cf41db1c333f7', 'aurora', 'Reception'),
  ('SmileCare Dental', '665a8a9f8e38038f', 'matrix', 'Reception'),
  ('PetPals Vet', 'f88bab6165bc0511', 'paper', 'Reception'),
  ('Paper Trail Books', '8b0a492a3a679fba', 'neon', 'Reception'),
  ('Gadget Galaxy', '5c88b9fc066e45e0', 'aurora', 'Reception')
) as q (pname, token, style, label)
join public.places p on p.name = q.pname and p.about like '[Demo]%'
on conflict (token) do nothing;


-- =====================================================================================
-- People: 48 named demo users and 8 guests, all with fixed ids so this is safe to re-run.
-- Demo users carry {"demo": true} in their sign-up data and the address ...@demo.trustedpicks.test.
-- They cannot sign in (no password), so they are only ever people you read about.
-- =====================================================================================
do $demo$
declare
  names text[] := array['Aarav Sharma','Priya Nair','Rohan Mehta','Ananya Iyer','Kabir Singh','Meera Kulkarni','Vikram Patil','Sneha Joshi',
    'Arjun Reddy','Isha Deshmukh','Nikhil Rao','Divya Menon','Rahul Verma','Pooja Bhatt','Siddharth Jain','Neha Kapoor',
    'Aditya Kulkarni','Riya Shah','Karan Malhotra','Tanvi Gokhale','Manish Gupta','Shruti Pillai','Omkar Jadhav','Zoya Khan',
    'Harsh Agarwal','Kavya Krishnan','Yash Thakur','Mitali Sen','Rajat Bansal','Ishaan Chopra','Aditi Rane','Sahil Dsouza',
    'Nandini Bose','Varun Saxena','Pallavi More','Ritesh Kale','Simran Kaur','Gautam Naik','Lakshmi Subramanian','Dev Patel',
    'Anjali Pawar','Mohit Sinha','Bhavna Shetty','Tushar Gaikwad','Farah Sheikh','Abhishek Dubey','Sakshi Wagh','Jayesh Chavan'];
  -- The email you sign in with, so the demo friends appear in YOUR account. Leave as is to use the admin account(s).
  my_email text := 'you@example.com';
  want text[] := array['id','instance_id','aud','role','email','encrypted_password','email_confirmed_at','raw_app_meta_data','raw_user_meta_data',
                       'created_at','updated_at','is_anonymous','confirmation_token','recovery_token','email_change_token_new','email_change'];
  vals text[]; cols text := ''; lits text := ''; k int; i int; j int; d int; uid uuid; other uuid; guest boolean; nm text;
  real_user uuid;
begin
  for i in 1..56 loop
    uid := ('de000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    guest := i > 48;
    nm := case when guest then '' else names[i] end;
    if not exists (select 1 from auth.users where id = uid) then
      vals := array[uid::text, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        case when guest then null else 'demo' || lpad(i::text, 2, '0') || '@demo.trustedpicks.test' end,
        '', case when guest then null else now()::text end, '{"provider":"email","providers":["email"]}',
        case when guest then '{"demo":true}' else jsonb_build_object('demo', true, 'full_name', nm)::text end,
        (now() - interval '120 days' + make_interval(days => i))::text, now()::text, guest::text, '', '', '', ''];
      cols := ''; lits := '';
      for k in 1..array_length(want, 1) loop
        if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = want[k]) then
          cols := cols || case when cols = '' then '' else ', ' end || quote_ident(want[k]);
          lits := lits || case when lits = '' then '' else ', ' end || quote_nullable(vals[k]);
        end if;
      end loop;
      execute format('insert into auth.users (%s) values (%s) on conflict do nothing', cols, lits);
    end if;
    -- The sign-up trigger normally makes this; make sure it exists with the right name either way.
    insert into public.profiles (id, display_name, city, created_at)
    values (uid, nm, case when guest then null else 'Pune' end, now() - interval '120 days' + make_interval(days => i))
    on conflict (id) do update set display_name = excluded.display_name, city = excluded.city;
  end loop;

  -- Friends among the demo users: each is friends with 4 others, both ways (about 8 each).
  for i in 1..48 loop
    foreach d in array array[1, 3, 8, 15] loop
      uid := ('de000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
      other := ('de000000-0000-4000-8000-' || lpad((((i - 1 + d) % 48) + 1)::text, 12, '0'))::uuid;
      insert into public.friendships (user_id, friend_id, via) values (uid, other, case when d = 1 then 'review' else 'invite' end), (other, uid, case when d = 1 then 'review' else 'invite' end) on conflict do nothing;
    end loop;
    -- A few people follow each other too: followed names count for more in rankings.
    foreach d in array array[2, 5] loop
      insert into public.follows (follower_id, followee_id, source)
      values (('de000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, ('de000000-0000-4000-8000-' || lpad((((i - 1 + d) % 48) + 1)::text, 12, '0'))::uuid, 'in_app')
      on conflict do nothing;
    end loop;
  end loop;

  -- Make the demo friends yours: the admin account(s), and the address above if it's an account.
  for real_user in
    select p.id from public.profiles p
    where p.id::text not like 'de000000-%'
      and (p.role = 'admin' or exists (select 1 from auth.users u where u.id = p.id and lower(u.email) = lower(my_email)))
  loop
    for j in 1..16 loop
      other := ('de000000-0000-4000-8000-' || lpad(j::text, 12, '0'))::uuid;
      insert into public.friendships (user_id, friend_id, via) values (real_user, other, case when j % 3 = 0 then 'review' else 'invite' end), (other, real_user, case when j % 3 = 0 then 'review' else 'invite' end) on conflict do nothing;
      if j <= 8 then insert into public.follows (follower_id, followee_id, source) values (real_user, other, 'in_app') on conflict do nothing; end if;
    end loop;
  end loop;
end
$demo$;

-- =====================================================================================
-- Reviews: every live place gets about twenty demo reviewers. Each reviewer visits once,
-- and rates one to three things from that visit. Mix of named and anonymous, all verified
-- by a table scan, spread over the last three months. Existing reviews are never touched.
-- Places with no menu items get three placeholder items marked "[Demo item]".
-- =====================================================================================
do $demo$
declare
  p record; u record; it record; kind_group text; h bigint; hi bigint; k int; rate int; rid uuid; vid uuid; made timestamptz; named boolean;
  base numeric; bias numeric; noise numeric; body text; idx int; pool text[]; ntags int;
  neg text[] := array['Too pricey','Slow service','Crowded','Small portion','Not fresh','Served cold','Too oily','Rude staff','Not clean','Long wait','Poor quality','Damaged item','Pushy selling','Late','Overcharged','Rushed','Old equipment'];
  food_pos text[] := array['The %s was fantastic. Would order it again in a heartbeat.', 'Easily the best %s I have had in the area. Fresh and full of flavour.', 'Came for the %s and it did not disappoint. Great value too.', 'Loved the %s. Generous portion and it arrived piping hot.', 'The %s here is the real deal. You can taste the care.', 'Solid %s and lovely staff. Quick service even when it was busy.', 'Honestly the %s alone is worth the visit.', 'Brought friends for the %s and everyone loved it.', 'My go-to for %s now. Consistent every single time.', 'Did not expect the %s to be this good. Pleasantly surprised.'];
  food_mid text[] := array['The %s was good, but the wait was longer than I expected.', 'Decent %s for the price. Nothing special, nothing wrong.', 'Fine %s. I would try something else next time.', 'The %s was okay. Service could be warmer.', 'Average %s. Portion could be bigger for the price.'];
  food_low text[] := array['The %s was cold when it arrived and a little bland.', 'Disappointed by the %s this time. It felt overpriced.', 'Not great. The %s was not as fresh as before.', 'Waited a long time and the %s did not make up for it.'];
  svc_pos text[] := array['Really happy with the %s. Skilled, on time and no upselling.', 'The %s was exactly what I wanted. Clean place and kind people.', 'Great %s. I will be coming back and sending friends.', 'Very professional. The %s was done right the first time.', 'Booked the %s on a friend''s advice and I understand why.', 'Super friendly team and an excellent %s.', 'Clear about the price up front. The %s was worth it.'];
  svc_mid text[] := array['The %s was fine, though I waited a while before starting.', 'Good %s overall. A bit rushed at the end.', 'Okay %s. Fair price, average experience.', 'The %s was decent but the place was crowded.'];
  svc_low text[] := array['The %s was not what I expected and I had to wait a long time.', 'Not happy with the %s. Felt rushed and a bit overcharged.', 'The %s needed a redo. Staff were polite but it was not right.'];
begin
  alter table public.reviews disable trigger reviews_check_allowed;

  -- Placeholder items for live places that have none (your own test shops, say).
  for p in select pl.id, pl.kind from public.places pl
           where pl.status = 'live' and not exists (select 1 from public.items x where x.place_id = pl.id)
  loop
    insert into public.items (place_id, name, description)
    select p.id, n, '[Demo item]'
    from unnest(case p.kind
      when 'food' then array['House special', 'Chef''s pick', 'Seasonal favourite']
      when 'store' then array['Best seller', 'New arrival', 'Gift pick']
      when 'beauty' then array['Haircut', 'Facial', 'Hair spa']
      else array['Main service', 'Express service', 'Premium service'] end) as n
    on conflict (place_id, name_normalized) do nothing;
  end loop;

  for p in select pl.id, pl.kind from public.places pl where pl.status = 'live' loop
    kind_group := case when p.kind in ('food', 'store') then 'food' else 'svc' end;
    for u in select pr.id, substring(pr.id::text from 25)::int as ord from public.profiles pr where pr.id::text like 'de000000-%' order by pr.id loop
      h := abs(hashtext(p.id::text || u.id::text))::bigint;
      -- About 40% of named demo users and 15% of the guests review any given place.
      if (h % 100) >= (case when u.ord > 48 then 15 else 40 end) then continue; end if;
      if exists (select 1 from public.reviews r where r.user_id = u.id and r.place_id = p.id) then continue; end if;
      k := 1 + ((h / 100) % 3)::int;
      made := now() - make_interval(days => (((h / 7) % 90) * ((h / 7) % 90) / 90)::int, hours => ((h / 13) % 20)::int + 1, mins => ((h / 17) % 60)::int);
      named := u.ord <= 48 and ((h / 11) % 100) < (case when u.ord <= 28 then 80 else 25 end);
      insert into public.visits (user_id, place_id, scanned_at, expires_at, source, near)
      values (u.id, p.id, made - interval '1 hour', made + interval '5 hours',
              case when (h / 29) % 5 = 0 then 'link' else 'qr' end, case when (h / 31) % 4 = 0 then null else true end)
      returning id into vid;
      for it in select i.id, i.name from public.items i where i.place_id = p.id and not i.is_hidden order by md5(i.id::text || u.id::text) limit k loop
        hi := abs(hashtext(it.id::text))::bigint;
        base := 3.4 + (hi % 14) / 10.0;
        bias := ((abs(hashtext(u.id::text))::bigint % 7) - 3) / 10.0;
        noise := (((h / 3) + hi) % 9 - 4) / 4.0;
        rate := greatest(1, least(5, round(base + bias + noise)))::int;
        pool := case when kind_group = 'food' then (case when rate >= 4 then food_pos when rate = 3 then food_mid else food_low end)
                     else (case when rate >= 4 then svc_pos when rate = 3 then svc_mid else svc_low end) end;
        idx := 1 + ((h / 19 + hi) % array_length(pool, 1))::int;
        body := case when ((h / 37 + hi) % 10) < 7 then format(pool[idx], it.name) else '' end;
        insert into public.reviews (user_id, place_id, item_id, rating, body, ai_drafted, visit_id, is_public, by_guest, device_hash, created_at, updated_at)
        values (u.id, p.id, it.id, rate, body, ((h / 23) % 10) = 0, vid, named, u.ord > 48,
                case when u.ord > 48 then md5(u.id::text || p.id::text) end, made, made)
        returning id into rid;
        -- Good tags from the ones that fit this kind of place; "could be better" tags when it wasn't great.
        ntags := case when rate >= 4 then 1 + ((h / 41) % 3)::int when rate = 3 then 1 else 0 end;
        insert into public.review_tags (review_id, tag_id)
        select rid, t.id from public.tags t
        where (t.kinds is null or p.kind = any(t.kinds)) and not (t.label = any(neg))
        order by md5(t.id::text || rid::text) limit ntags
        on conflict do nothing;
        if rate <= 3 then
          insert into public.review_tags (review_id, tag_id)
          select rid, t.id from public.tags t
          where (t.kinds is null or p.kind = any(t.kinds)) and t.label = any(neg)
          order by md5(t.id::text || rid::text) limit (case when rate <= 2 then 2 else 1 end)
          on conflict do nothing;
        end if;
      end loop;
    end loop;
  end loop;

  alter table public.reviews enable trigger reviews_check_allowed;
end
$demo$;

-- =====================================================================================
-- Around the reviews: scans that didn't turn into a review, saved places, owners, plans and
-- payments, review links, reports, listing and claim requests, AI summaries, and usage.
-- =====================================================================================
do $demo$
declare
  rp record; ru record; h bigint; made timestamptz; me uuid; rr record;
begin
  -- People who scanned but didn't review (so Insights shows scans above reviews).
  for rp in select id from public.places where status = 'live' loop
    for ru in select pr.id from public.profiles pr where pr.id::text like 'de000000-%' loop
      h := abs(hashtext('scan' || rp.id::text || ru.id::text))::bigint;
      if (h % 100) >= 12 or exists (select 1 from public.visits v where v.user_id = ru.id and v.place_id = rp.id) then continue; end if;
      made := now() - make_interval(days => ((h / 7) % 60)::int, hours => ((h / 13) % 20)::int + 1);
      insert into public.visits (user_id, place_id, scanned_at, expires_at, source, near)
      values (ru.id, rp.id, made, made + interval '6 hours', case when (h / 29) % 6 = 0 then 'link' else 'qr' end, true);
    end loop;
  end loop;

  -- Some named reviews were also sent on to Google from the thank-you screen.
  insert into public.google_shares (review_id, user_id, opened_at)
  select r.id, r.user_id, r.created_at + interval '2 minutes'
  from public.reviews r
  where r.user_id::text like 'de000000-%' and r.is_public and abs(hashtext('g' || r.id::text)) % 100 < 20
    and not exists (select 1 from public.google_shares g where g.review_id = r.id);

  -- Saved places: each demo person saves a few; real admin accounts save the first six demo shops.
  insert into public.saved_places (user_id, place_id, created_at)
  select u.id, p.id, now() - make_interval(days => (abs(hashtext(u.id::text || p.id::text)) % 60)::int)
  from public.profiles u cross join public.places p
  where u.id::text like 'de000000-%' and p.status = 'live' and abs(hashtext('save' || u.id::text || p.id::text)) % 100 < 9
  on conflict do nothing;
  insert into public.saved_places (user_id, place_id)
  select a.id, p.id from public.profiles a
  cross join lateral (select id from public.places where about like '[Demo]%' order by name limit 6) p
  where a.role = 'admin' and a.id::text not like 'de000000-%'
  on conflict do nothing;

  -- Owners: the admin account owns three demo shops, so Manage, Insights and Plan have real data.
  select id into me from public.profiles where role = 'admin' and id::text not like 'de000000-%' order by created_at limit 1;
  if me is not null then
    update public.places set owner_id = me
    where about like '[Demo]%' and name in ('Sugar Loaf Bakery', 'Fade Studio', 'Masala Library') and owner_id is null;
    insert into public.ai_usage (user_id, day, calls)
    select me, current_date - g, 2 + g % 5 from generate_series(0, 6) g on conflict do nothing;
  end if;

  -- Plans: a spread of plans and states across the demo shops.
  with ranked as (select id, row_number() over (order by name) as rn from public.places where about like '[Demo]%')
  update public.subscriptions s set
    plan = case r.rn % 6 when 0 then 'pro' when 1 then 'standard' when 2 then 'starter' when 3 then 'trial' when 4 then 'standard' else 'pro' end,
    status = case r.rn % 6 when 3 then 'trial' when 4 then 'past_due' when 5 then 'cancelled' else 'active' end,
    period_end = case when r.rn % 6 = 3 then now() + interval '12 days' else now() + interval '200 days' end,
    billing_interval = case when r.rn % 6 = 3 then null when r.rn % 2 = 0 then 'month' else 'year' end,
    provider = case when r.rn % 6 = 3 then null else 'razorpay' end,
    cancel_at_period_end = (r.rn % 6 = 5),
    trial_reviews_left = 25
  from ranked r where s.place_id = r.id;

  -- What those plans paid.
  insert into public.billing_orders (place_id, plan, billing_interval, currency, amount_minor, provider, provider_order_id, provider_payment_id, status, paid_at)
  select s.place_id, s.plan, s.billing_interval, 'INR',
         100 * greatest(1, case when s.billing_interval = 'month' then pl.price_inr_month else pl.price_inr_year end),
         'razorpay', 'order_demo_' || left(md5(s.place_id::text), 12), 'pay_demo_' || left(md5(s.place_id::text || 'p'), 12),
         'paid', now() - make_interval(days => abs(hashtext(s.place_id::text)) % 120)
  from public.subscriptions s join public.plans pl on pl.code = s.plan join public.places p on p.id = s.place_id
  where p.about like '[Demo]%' and s.status in ('active', 'past_due', 'cancelled')
    and not exists (select 1 from public.billing_orders b where b.place_id = s.place_id and b.provider_order_id like 'order_demo_%');
  insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, status, paid_at, period_start, period_end)
  select p.id, 'listing', 199, 'demo', 'demo-listing-' || left(md5(p.id::text), 10), 'paid',
         now() - make_interval(days => 20 + abs(hashtext(p.id::text)) % 100), current_date - 30, current_date + 335
  from public.places p
  where p.about like '[Demo]%' and abs(hashtext('pay' || p.id::text)) % 3 <> 0
    and not exists (select 1 from public.payments x where x.place_id = p.id and x.kind = 'listing');

  -- One-time review links the shops have handed out (some unused, some used).
  insert into public.review_links (place_id, token, created_by, expires_at, used_at)
  select p.id, left(md5('link' || p.id::text || g), 24), coalesce(p.owner_id, 'de000000-0000-4000-8000-000000000001'::uuid), now() + interval '3 days', case when g = 2 then now() - interval '5 hours' end
  from (select id, owner_id from public.places where about like '[Demo]%' order by name limit 10) p cross join generate_series(1, 2) g
  on conflict (token) do nothing;

  -- Reports: some open for the Admin Alerts tab, some already handled.
  for rr in select rv.id, row_number() over (order by md5(rv.id::text)) as rn
           from public.reviews rv where rv.user_id::text like 'de000000-%' and rv.body <> '' and rv.rating <= 3 limit 8
  loop
    insert into public.review_reports (review_id, reporter, reason, resolved_at)
    select rr.id, ('de000000-0000-4000-8000-' || lpad(((rr.rn * 5) % 48 + 1)::text, 12, '0'))::uuid,
           (array['fake', 'offensive', 'wrong_place', 'personal_info', 'other'])[1 + (rr.rn % 5)::int],
           case when rr.rn > 5 then now() - interval '2 days' end
    where not exists (select 1 from public.review_reports x where x.review_id = rr.id);
  end loop;

  -- Shops asking to be listed, and people claiming a listed shop.
  alter table public.listing_requests disable trigger listing_requests_prepare;
  insert into public.listing_requests (requester_id, business_name, category, area, city, phone, note, wants_qr, qr_style, plan, billing_interval, tables, listing_inr, qr_inr, amount_inr, status, decided_at)
  select ('de000000-0000-4000-8000-' || lpad(v.u::text, 12, '0'))::uuid, v.nm, v.cat, v.area, 'Pune', v.phone, '[Demo] ' || v.nm, true, v.sty::public.qr_style, v.pl, 'year', v.t,
         v.amt, 0, v.amt, v.st::public.request_status, case when v.st in ('approved', 'declined') then now() - interval '2 days' end
  from (values
    ('Dosa Dhaba Express', 'Restaurant', 'Pimpri', '+919800000001', 'paper', 'starter', 3, 1499, 'pending', 4),
    ('Zen Spa and Wellness', 'Spa', 'Koregaon Park', '+919800000002', 'neon', 'standard', 6, 2999, 'approved', 9),
    ('QuickFix Mobile Repair', 'Repair service', 'Camp', '+919800000003', 'paper', 'trial', 1, 0, 'declined', 15),
    ('Royal Sweets', 'Sweet shop', 'Shivajinagar', '+919800000004', 'aurora', 'starter', 2, 1499, 'paid', 22)
  ) as v (nm, cat, area, phone, sty, pl, t, amt, st, u)
  where not exists (select 1 from public.listing_requests x where x.business_name = v.nm and x.note like '[Demo]%');
  alter table public.listing_requests enable trigger listing_requests_prepare;

  insert into public.place_claims (place_id, user_id, kind, near, role, phone, status)
  select p.id, ('de000000-0000-4000-8000-' || lpad(v.u::text, 12, '0'))::uuid, v.k, true, v.r, v.ph, 'pending'
  from (values ('Tandoor Tales', 7, 'claim', 'owner', '+919800000011'), ('Chaat Street', 12, 'claim', 'manager', '+919800000012'), ('Green Bowl', 20, 'access', 'staff', '+919800000013')) as v (pn, u, k, r, ph)
  join public.places p on p.name = v.pn and p.about like '[Demo]%'
  where not exists (select 1 from public.place_claims c where c.place_id = p.id and c.user_id = ('de000000-0000-4000-8000-' || lpad(v.u::text, 12, '0'))::uuid);

  -- A written summary on each shop page, built from its own best-rated dishes.
  insert into public.place_ai_summaries (place_id, summary, highlights, review_count, updated_at)
  select p.id,
         format('People keep coming back for the %s (%s from %s reviews). %s', top.name, top.avg, top.n,
                case when s.avg >= 4.3 then 'Reviewers say it is consistent and worth the trip.' when s.avg >= 3.9 then 'Most are happy, with a few mentions of waits at busy times.' else 'Opinions are mixed, mostly about consistency.' end),
         array[top.name, coalesce(tg.l1, 'Friendly staff'), coalesce(tg.l2, 'Worth the price')], s.n, now()
  from public.places p
  join lateral (select count(*)::int as n, round(avg(rating), 1) as avg from public.reviews where place_id = p.id) s on s.n > 0
  join lateral (select i.name, round(ist.avg_rating, 1) as avg, ist.review_count as n from public.item_stats ist join public.items i on i.id = ist.item_id
                where ist.place_id = p.id order by ist.avg_rating desc, ist.review_count desc limit 1) top on true
  left join lateral (select (array_agg(t.label order by c.n desc))[1] as l1, (array_agg(t.label order by c.n desc))[2] as l2
                     from (select rt.tag_id, count(*) as n from public.review_tags rt join public.reviews r on r.id = rt.review_id where r.place_id = p.id group by 1) c
                     join public.tags t on t.id = c.tag_id where t.label <> all (array['Too pricey','Slow service','Crowded','Small portion','Not fresh','Served cold','Too oily','Rude staff','Not clean','Long wait','Poor quality','Damaged item','Pushy selling','Late','Overcharged','Rushed','Old equipment'])) tg on true
  where p.about like '[Demo]%'
  on conflict (place_id) do update set summary = excluded.summary, highlights = excluded.highlights, review_count = excluded.review_count, updated_at = excluded.updated_at;
end
$demo$;

-- Who is an expert, who tastes alike, and so on.
do $demo$ begin perform public.refresh_trust_tables(); exception when others then raise notice 'trust tables not refreshed: %', sqlerrm; end $demo$;

-- What you got:
select p.name, p.category,
       count(r.id) as reviews, round(avg(r.rating), 1) as avg_stars,
       count(r.id) filter (where r.is_public) as named, count(r.id) filter (where not r.is_public) as anonymous
from public.places p left join public.reviews r on r.place_id = p.id and r.user_id::text like 'de000000-%'
where p.status = 'live' group by p.id order by p.name;

-- To remove the people, friendships, visits, reviews, reports and saved places later (shops stay):
--   delete from auth.users where raw_user_meta_data ->> 'demo' = 'true';
--   delete from public.items where description = '[Demo item]';
--   delete from public.listing_requests where note like '[Demo]%';
-- To remove the demo shops as well (their reviews, QR codes, plans and payments go with them):
--   delete from public.places where about like '[Demo]%';
