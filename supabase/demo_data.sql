-- Trusted Picks: demo businesses, people, friends and reviews, so every screen has something on it.
-- Safe to run more than once. Nothing here is real: shops start with "[Demo]" in About, people sign in
-- with nothing (no password) and carry {"demo": true}. Removal queries are at the bottom.
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
   '{"Tue–Sun": "8 am–8 pm"}', array['Butter Croissant|Bakery', 'Sourdough Loaf|Bakery', 'Coffee|Coffee', 'Chocolate Cake|Dessert']),
  ('Fade Studio', 'Fade Studio', 'Salon', 'Aundh',
   '[Demo] Barbers for fades, beard work and quick trims.', 2, 18.5590, 73.8075,
   '{"Mon–Sun": "10 am–9 pm"}', array['Skin Fade|Haircut', 'Beard Trim|Haircut', 'Head Massage|Spa']),
  ('Masala Library', 'Masala Library', 'Restaurant', 'Koregaon Park',
   '[Demo] Modern Indian plates: smoky kebabs, slow curries and hot breads.', 3, 18.5402, 73.8972,
   '{"Mon–Sun": "12 pm–11:30 pm"}', array['Butter Chicken|Curry', 'Paneer Tikka|Starter', 'Garlic Naan|Bread', 'Dal Makhani|Curry', 'Gulab Jamun|Dessert']),
  ('Brew Society', 'Brew Society', 'Cafe', 'Aundh',
   '[Demo] Small-batch coffee, cold brews and all-day brunch.', 2, 18.5584, 73.8089,
   '{"Mon–Sun": "8 am–11 pm"}', array['Flat White|Coffee', 'Cold Brew|Coffee', 'Avocado Toast|Brunch', 'Blueberry Muffin|Bakery']),
  ('Tandoor Tales', 'Tandoor Tales', 'Restaurant', 'Kothrud',
   '[Demo] Family tandoor house: kebabs, rolls and rich gravies.', 2, 18.5074, 73.8077,
   '{"Mon–Sun": "11 am–11 pm"}', array['Chicken Tikka|Starter', 'Seekh Kebab Roll|Roll', 'Tandoori Roti|Bread', 'Chicken Handi|Curry']),
  ('Iron Temple Gym', 'Iron Temple Gym', 'Gym', 'Baner',
   '[Demo] Strength floor, group classes and friendly coaches.', 2, 18.5642, 73.7769,
   '{"Mon–Sat": "5 am–10 pm"}', array['Monthly Membership|Membership', 'Personal Training|Training', 'Yoga Class|Class']),
  ('Glow Beauty Parlour', 'Glow Beauty Parlour', 'Beauty parlour', 'Viman Nagar',
   '[Demo] Facials, hair spa and bridal makeup by a careful team.', 2, 18.5701, 73.9186,
   '{"Mon–Sun": "10 am–8 pm"}', array['Hair Spa|Spa', 'Gold Facial|Spa', 'Haircut|Haircut']),
  ('Urban Threads', 'Urban Threads', 'Clothing store', 'FC Road',
   '[Demo] Everyday cotton wear, kurtas and easy-returns shopping.', 2, 18.5196, 73.8419,
   '{"Mon–Sun": "11 am–9 pm"}', array['Cotton Kurta|Clothing', 'Linen Shirt|Clothing', 'Denim Jacket|Clothing']),
  ('CarePlus Clinic', 'CarePlus Clinic', 'Clinic', 'Kalyani Nagar',
   '[Demo] Family doctor and walk-in clinic, short waits.', 2, 18.5467, 73.9061,
   '{"Mon–Sat": "9 am–8 pm"}', array['General Consultation|Consultation', 'Health Check|Consultation'])
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
  ('Fade Studio', array['Skin Fade|Haircut', 'Beard Trim|Haircut', 'Head Massage|Spa']),
  ('Masala Library', array['Butter Chicken|Curry', 'Paneer Tikka|Starter', 'Garlic Naan|Bread', 'Dal Makhani|Curry', 'Gulab Jamun|Dessert']),
  ('Brew Society', array['Flat White|Coffee', 'Cold Brew|Coffee', 'Avocado Toast|Brunch', 'Blueberry Muffin|Bakery']),
  ('Tandoor Tales', array['Chicken Tikka|Starter', 'Seekh Kebab Roll|Roll', 'Tandoori Roti|Bread', 'Chicken Handi|Curry']),
  ('Iron Temple Gym', array['Monthly Membership|Membership', 'Personal Training|Training', 'Yoga Class|Class']),
  ('Glow Beauty Parlour', array['Hair Spa|Spa', 'Gold Facial|Spa', 'Haircut|Haircut']),
  ('Urban Threads', array['Cotton Kurta|Clothing', 'Linen Shirt|Clothing', 'Denim Jacket|Clothing']),
  ('CarePlus Clinic', array['General Consultation|Consultation', 'Health Check|Consultation'])
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
  ('Fade Studio', '05b0247f40a8fa4b', 'neon',  'Chair 1'),
  ('Masala Library', '7a1c0e5d2b9f4c11', 'paper', 'Table 3'),
  ('Brew Society', '9b3d7e1a4c5f2d22', 'paper', 'Counter'),
  ('Tandoor Tales', 'c4e8a2f6d1b03e33', 'paper', 'Table 2'),
  ('Iron Temple Gym', 'e5f9b3a7c2d14f44', 'paper', 'Front desk'),
  ('Glow Beauty Parlour', '1a6c2e8f4b7d5a55', 'neon', 'Reception'),
  ('Urban Threads', '3c8e4a0b6d9f7c66', 'paper', 'Billing counter'),
  ('CarePlus Clinic', '5e0a6c2d8f1b9e77', 'paper', 'Reception')
) as q (pname, token, style, label)
join public.places p on p.name = q.pname and p.about like '[Demo]%'
on conflict (token) do nothing;


-- =====================================================================================
-- Menu details, so the review screens show prices and descriptions.
-- =====================================================================================
update public.items i
set price_inr = d.price, description = d.descr, is_listed = true, sort_order = d.ord
from (values
  ('Forno Napoli', 'Margherita', 450, 'San Marzano tomato, fior di latte, fresh basil', 1),
  ('Forno Napoli', 'Diavola', 560, 'Spicy salami and chilli oil', 2),
  ('Forno Napoli', 'Burrata Pizza', 690, 'Creamy burrata and rocket', 3),
  ('Forno Napoli', 'Tiramisu', 320, 'Espresso-soaked, mascarpone cream', 4),
  ('Kaapi Corner', 'Filter Coffee', 80, 'Brass-tumbler decoction coffee', 1),
  ('Kaapi Corner', 'Masala Dosa', 140, 'Crisp dosa, potato masala, coconut chutney', 2),
  ('Kaapi Corner', 'Ghee Podi Idli', 120, 'Soft idlis tossed in ghee and podi', 3),
  ('Hyderabad Biryani House', 'Chicken Dum Biryani', 320, 'Sealed handi, saffron rice, raita', 1),
  ('Hyderabad Biryani House', 'Mutton Biryani', 420, 'Slow-cooked mutton, long grain rice', 2),
  ('Hyderabad Biryani House', 'Double Ka Meetha', 140, 'Warm bread pudding with rabri', 3),
  ('Sugar Loaf Bakery', 'Butter Croissant', 160, 'Laminated all-butter croissant', 1),
  ('Sugar Loaf Bakery', 'Sourdough Loaf', 260, '48-hour fermented sourdough', 2),
  ('Sugar Loaf Bakery', 'Coffee', 120, 'Fresh filter or espresso', 3),
  ('Sugar Loaf Bakery', 'Chocolate Cake', 480, 'Dark chocolate ganache layers', 4),
  ('Fade Studio', 'Skin Fade', 400, 'Clean skin fade with finish', 1),
  ('Fade Studio', 'Beard Trim', 200, 'Shaping, line-up and hot towel', 2),
  ('Fade Studio', 'Head Massage', 250, '15 minutes, oil or dry', 3),
  ('Masala Library', 'Butter Chicken', 520, 'Charred chicken in tomato butter gravy', 1),
  ('Masala Library', 'Paneer Tikka', 380, 'Clay oven paneer, mint chutney', 2),
  ('Masala Library', 'Garlic Naan', 90, 'Blistered naan with garlic butter', 3),
  ('Masala Library', 'Dal Makhani', 340, 'Overnight black dal, cream', 4),
  ('Masala Library', 'Gulab Jamun', 160, 'Warm, with cardamom syrup', 5),
  ('Brew Society', 'Flat White', 220, 'Double ristretto, silky milk', 1),
  ('Brew Society', 'Cold Brew', 240, '18-hour steeped, over ice', 2),
  ('Brew Society', 'Avocado Toast', 360, 'Sourdough, smashed avocado, poached egg', 3),
  ('Brew Society', 'Blueberry Muffin', 150, 'Baked every morning', 4),
  ('Tandoor Tales', 'Chicken Tikka', 340, 'Yoghurt-marinated, clay oven', 1),
  ('Tandoor Tales', 'Seekh Kebab Roll', 220, 'Lamb seekh, onions, mint chutney', 2),
  ('Tandoor Tales', 'Tandoori Roti', 30, 'Fresh from the tandoor', 3),
  ('Tandoor Tales', 'Chicken Handi', 390, 'Slow-cooked, thick gravy', 4),
  ('Iron Temple Gym', 'Monthly Membership', 1800, 'Full floor access, all classes', 1),
  ('Iron Temple Gym', 'Personal Training', 6000, '12 sessions with a coach', 2),
  ('Iron Temple Gym', 'Yoga Class', 400, 'Drop-in morning class', 3),
  ('Glow Beauty Parlour', 'Hair Spa', 1200, 'Deep conditioning and massage', 1),
  ('Glow Beauty Parlour', 'Gold Facial', 1500, 'Brightening 60-minute facial', 2),
  ('Glow Beauty Parlour', 'Haircut', 500, 'Wash, cut and blow-dry', 3),
  ('Urban Threads', 'Cotton Kurta', 1299, 'Breathable cotton, easy returns', 1),
  ('Urban Threads', 'Linen Shirt', 1599, 'Relaxed fit, soft linen', 2),
  ('Urban Threads', 'Denim Jacket', 2499, 'Classic wash, lined', 3),
  ('CarePlus Clinic', 'General Consultation', 500, '15-minute visit with the doctor', 1),
  ('CarePlus Clinic', 'Health Check', 1800, 'Blood work and consultation', 2)
) as d (pname, iname, price, descr, ord)
join public.places p on p.name = d.pname and p.about like '[Demo]%'
where i.place_id = p.id and i.name_normalized = lower(d.iname);

-- A few news posts so the Updates section isn't empty.
insert into public.place_updates (place_id, body)
select p.id, u.body
from (values
  ('Forno Napoli', '[Demo] New on the menu this week: Burrata Pizza with rocket and cherry tomatoes.'),
  ('Kaapi Corner', '[Demo] Filter coffee tastings every Saturday morning, free with any breakfast.'),
  ('Hyderabad Biryani House', '[Demo] Weekend special: Mutton Biryani with a free Double Ka Meetha.'),
  ('Brew Society', '[Demo] Cold Brew is now on tap. Ask for a taster.'),
  ('Iron Temple Gym', '[Demo] Morning yoga batch starts Monday at 6:30 am.')
) as u (pname, body)
join public.places p on p.name = u.pname and p.about like '[Demo]%'
where not exists (select 1 from public.place_updates x where x.place_id = p.id and x.body = u.body);

-- =====================================================================================
-- People: 24 named demo users and 4 guests, all with fixed ids so this is safe to re-run.
-- Demo users carry {"demo": true} in their sign-up data and the address ...@demo.trustedpicks.test.
-- They cannot sign in (no password), so they are only ever people you read about.
-- =====================================================================================
do $demo$
declare
  names text[] := array['Aarav Sharma','Priya Nair','Rohan Mehta','Ananya Iyer','Kabir Singh','Meera Kulkarni','Vikram Patil','Sneha Joshi',
    'Arjun Reddy','Isha Deshmukh','Nikhil Rao','Divya Menon','Rahul Verma','Pooja Bhatt','Siddharth Jain','Neha Kapoor',
    'Aditya Kulkarni','Riya Shah','Karan Malhotra','Tanvi Gokhale','Manish Gupta','Shruti Pillai','Omkar Jadhav','Zoya Khan'];
  -- The email you sign in with, so the demo friends appear in YOUR account. Leave as is to use the admin account(s).
  my_email text := 'you@example.com';
  want text[] := array['id','instance_id','aud','role','email','encrypted_password','email_confirmed_at','raw_app_meta_data','raw_user_meta_data',
                       'created_at','updated_at','is_anonymous','confirmation_token','recovery_token','email_change_token_new','email_change'];
  have text[]; vals text[]; cols text := ''; lits text := ''; k int; i int; j int; d int; uid uuid; other uuid; guest boolean; nm text;
  real_user uuid;
begin
  for i in 1..28 loop
    uid := ('de000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    guest := i > 24;
    nm := case when guest then '' else names[i] end;
    if not exists (select 1 from auth.users where id = uid) then
      vals := array[uid::text, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        case when guest then null else 'demo' || lpad(i::text, 2, '0') || '@demo.trustedpicks.test' end,
        '', case when guest then null else now()::text end, '{"provider":"email","providers":["email"]}',
        case when guest then '{"demo":true}' else jsonb_build_object('demo', true, 'full_name', nm)::text end,
        (now() - interval '100 days')::text, now()::text, guest::text, '', '', '', ''];
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
    values (uid, nm, case when guest then null else 'Pune' end, now() - interval '100 days')
    on conflict (id) do update set display_name = excluded.display_name, city = excluded.city;
  end loop;

  -- Friends among the demo users: each is friends with 3 others, both ways (about 6 each).
  for i in 1..24 loop
    foreach d in array array[1, 3, 8] loop
      uid := ('de000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
      other := ('de000000-0000-4000-8000-' || lpad((((i - 1 + d) % 24) + 1)::text, 12, '0'))::uuid;
      insert into public.friendships (user_id, friend_id, via) values (uid, other, 'invite'), (other, uid, 'invite') on conflict do nothing;
    end loop;
  end loop;

  -- Make the demo friends yours: the admin account(s), and the address above if it's an account.
  for real_user in
    select p.id from public.profiles p
    where p.id not in (select id from public.profiles where id::text like 'de000000-%')
      and (p.role = 'admin' or exists (select 1 from auth.users u where u.id = p.id and lower(u.email) = lower(my_email)))
  loop
    for j in 1..12 loop
      other := ('de000000-0000-4000-8000-' || lpad(j::text, 12, '0'))::uuid;
      insert into public.friendships (user_id, friend_id, via) values (real_user, other, 'invite'), (other, real_user, 'invite') on conflict do nothing;
    end loop;
  end loop;
end
$demo$;

-- =====================================================================================
-- Reviews: every live place gets about a dozen demo reviewers. Each reviewer visits once,
-- and rates one to three things from that visit. Mix of named and anonymous, all verified
-- by a table scan, spread over the last three months. Existing reviews are never touched.
-- Places with no menu items get three placeholder items marked "[Demo item]".
-- =====================================================================================
do $demo$
declare
  p record; u record; it record; kind_group text; h bigint; hi bigint; k int; rate int; rid uuid; vid uuid; made timestamptz; named boolean;
  base numeric; bias numeric; noise numeric; body text; idx int; pool text[]; ntags int;
  neg text[] := array['Too pricey','Slow service','Crowded','Small portion','Not fresh','Served cold','Too oily','Rude staff','Not clean','Long wait','Poor quality','Damaged item','Pushy selling','Late','Overcharged','Rushed','Old equipment'];
  food_pos text[] := array['The %s was fantastic. Would order it again in a heartbeat.', 'Easily the best %s I have had in the area. Fresh and full of flavour.', 'Came for the %s and it did not disappoint. Great value too.', 'Loved the %s. Generous portion and it arrived piping hot.', 'The %s here is the real deal. You can taste the care.', 'Solid %s and lovely staff. Quick service even when it was busy.', 'Honestly the %s alone is worth the visit.', 'Brought friends for the %s and everyone loved it.'];
  food_mid text[] := array['The %s was good, but the wait was longer than I expected.', 'Decent %s for the price. Nothing special, nothing wrong.', 'Fine %s. I would try something else next time.', 'The %s was okay. Service could be warmer.'];
  food_low text[] := array['The %s was cold when it arrived and a little bland.', 'Disappointed by the %s this time. It felt overpriced.', 'Not great. The %s was not as fresh as before.', 'Waited a long time and the %s did not make up for it.'];
  svc_pos text[] := array['Really happy with the %s. Skilled, on time and no upselling.', 'The %s was exactly what I wanted. Clean place and kind people.', 'Great %s. I will be coming back and sending friends.', 'Very professional. The %s was done right the first time.', 'Booked the %s on a friend''s advice and I understand why.', 'Super friendly team and an excellent %s.'];
  svc_mid text[] := array['The %s was fine, though I waited a while before starting.', 'Good %s overall. A bit rushed at the end.', 'Okay %s. Fair price, average experience.'];
  svc_low text[] := array['The %s was not what I expected and I had to wait a long time.', 'Not happy with the %s. Felt rushed and a bit overcharged.', 'The %s needed a redo. Staff were polite but it was not right.'];
  tagged int;
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
    for u in select pr.id, substring(pr.id::text from 33)::int as ord from public.profiles pr where pr.id::text like 'de000000-%' order by pr.id loop
      h := abs(hashtext(p.id::text || u.id::text))::bigint;
      -- About 48% of named demo users and 18% of the guests review any given place.
      if (h % 100) >= (case when u.ord > 24 then 18 else 48 end) then continue; end if;
      if exists (select 1 from public.reviews r where r.user_id = u.id and r.place_id = p.id) then continue; end if;
      k := 1 + ((h / 100) % 3)::int;
      made := now() - make_interval(days => (((h / 7) % 90) * ((h / 7) % 90) / 90)::int, hours => ((h / 13) % 20)::int + 1, mins => ((h / 17) % 60)::int);
      named := u.ord <= 24 and ((h / 11) % 100) < (case when u.ord <= 14 then 80 else 25 end);
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
        values (u.id, p.id, it.id, rate, body, ((h / 23) % 10) = 0, vid, named, u.ord > 24,
                case when u.ord > 24 then md5(u.id::text || p.id::text) end, made, made)
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

-- Who is an expert, who tastes alike, and so on.
do $demo$ begin perform public.refresh_trust_tables(); exception when others then raise notice 'trust tables not refreshed: %', sqlerrm; end $demo$;

-- What you got:
select p.name, p.category,
       count(r.id) as reviews, round(avg(r.rating), 1) as avg_stars,
       count(r.id) filter (where r.is_public) as named, count(r.id) filter (where not r.is_public) as anonymous
from public.places p left join public.reviews r on r.place_id = p.id and r.user_id::text like 'de000000-%'
where p.status = 'live' group by p.id order by p.name;

-- To remove the people, friendships, visits and reviews later (shops stay):
--   delete from auth.users where raw_user_meta_data ->> 'demo' = 'true';
--   delete from public.items where description = '[Demo item]';
-- To remove the demo shops as well (their reviews and QR codes go with them):
--   delete from public.places where about like '[Demo]%';
