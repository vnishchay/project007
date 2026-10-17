-- Trusted Picks demo data: shops, people, friends, reviews and everything around them, so every screen has something on it.
-- Safe to run more than once. Nothing here is real: shops start with "[Demo]" in About, and people cannot sign in
-- (no password) and carry {"demo": true}. Pictures are stock photos, named by tokens such as "demo:pizza:3" that the app
-- turns into pictures; real shops and people upload their own. Removal queries are at the bottom.
-- Put the email you sign in with at "my_email" in the People block, so the demo friends appear in your account.
-- Running it again first clears the demo people's own reviews and visits (only theirs) and builds them fresh.

set search_path = public, extensions;

-- Older copies of this file stored fake ids such as "demo-forno-napoli"; clear them.
update public.places set google_place_id = null where google_place_id like 'demo-%';

-- =====================================================================================
-- People: named demo users, guests (no name, no sign-in) and shop owners, with fixed ids.
-- They cannot sign in (no password), so they are only ever people you read about.
-- =====================================================================================
drop table if exists tp_people;
create temp table tp_people (ord int primary key, name text not null, g text, city text, role text, avatar text);
insert into tp_people values
  (1, 'Aarav Sharma', 'm', 'Pune', 'user', 'demo:person:m:3'),
  (2, 'Priya Nair', 'w', 'Pune', 'user', 'demo:person:w:3'),
  (3, 'Rohan Mehta', 'm', 'Pune', 'user', 'demo:person:m:4'),
  (4, 'Ananya Iyer', 'w', 'Pune', 'user', 'demo:person:w:4'),
  (5, 'Kabir Singh', 'm', 'Pune', 'user', 'demo:person:m:5'),
  (6, 'Meera Kulkarni', 'w', 'Pune', 'user', 'demo:person:w:5'),
  (7, 'Vikram Patil', 'm', 'Pune', 'user', 'demo:person:m:6'),
  (8, 'Sneha Joshi', 'w', 'Pune', 'user', 'demo:person:w:6'),
  (9, 'Arjun Reddy', 'm', 'Pune', 'user', 'demo:person:m:7'),
  (10, 'Isha Deshmukh', 'w', 'Pune', 'user', 'demo:person:w:7'),
  (11, 'Nikhil Rao', 'm', 'Pune', 'user', 'demo:person:m:8'),
  (12, 'Divya Menon', 'w', 'Pune', 'user', 'demo:person:w:8'),
  (13, 'Rahul Verma', 'm', 'Pune', 'user', 'demo:person:m:9'),
  (14, 'Pooja Bhatt', 'w', 'Pune', 'user', 'demo:person:w:9'),
  (15, 'Siddharth Jain', 'm', 'Pune', 'user', 'demo:person:m:10'),
  (16, 'Neha Kapoor', 'w', 'Pune', 'user', 'demo:person:w:10'),
  (17, 'Aditya Kulkarni', 'm', 'Pune', 'user', 'demo:person:m:11'),
  (18, 'Riya Shah', 'w', 'Pune', 'user', 'demo:person:w:11'),
  (19, 'Karan Malhotra', 'm', 'Pune', 'user', 'demo:person:m:12'),
  (20, 'Tanvi Gokhale', 'w', 'Pune', 'user', 'demo:person:w:12'),
  (21, 'Manish Gupta', 'm', 'Pune', 'user', 'demo:person:m:13'),
  (22, 'Shruti Pillai', 'w', 'Pune', 'user', 'demo:person:w:13'),
  (23, 'Omkar Jadhav', 'm', 'Pune', 'user', 'demo:person:m:14'),
  (24, 'Zoya Khan', 'w', 'Pune', 'user', 'demo:person:w:14'),
  (25, 'Harsh Agarwal', 'm', 'Pune', 'user', 'demo:person:m:15'),
  (26, 'Kavya Krishnan', 'w', 'Pune', 'user', 'demo:person:w:15'),
  (27, 'Yash Thakur', 'm', 'Pune', 'user', 'demo:person:m:16'),
  (28, 'Mitali Sen', 'w', 'Pune', 'user', 'demo:person:w:16'),
  (29, 'Rajat Bansal', 'm', 'Pune', 'user', 'demo:person:m:17'),
  (30, 'Ishaan Chopra', 'm', 'Pune', 'user', 'demo:person:m:18'),
  (31, 'Aditi Rane', 'w', 'Pune', 'user', 'demo:person:w:17'),
  (32, 'Sahil Dsouza', 'm', 'Pune', 'user', 'demo:person:m:19'),
  (33, 'Nandini Bose', 'w', 'Pune', 'user', 'demo:person:w:18'),
  (34, 'Varun Saxena', 'm', 'Pune', 'user', 'demo:person:m:20'),
  (35, 'Pallavi More', 'w', 'Pune', 'user', 'demo:person:w:19'),
  (36, 'Ritesh Kale', 'm', 'Pune', 'user', 'demo:person:m:21'),
  (37, 'Simran Kaur', 'w', 'Pune', 'user', 'demo:person:w:20'),
  (38, 'Gautam Naik', 'm', 'Pune', 'user', 'demo:person:m:22'),
  (39, 'Lakshmi Subramanian', 'w', 'Pune', 'user', 'demo:person:w:21'),
  (40, 'Dev Patel', 'm', 'Pune', 'user', 'demo:person:m:23'),
  (41, 'Anjali Pawar', 'w', 'Pune', 'user', 'demo:person:w:22'),
  (42, 'Mohit Sinha', 'm', 'Pune', 'user', 'demo:person:m:24'),
  (43, 'Bhavna Shetty', 'w', 'Pune', 'user', 'demo:person:w:23'),
  (44, 'Tushar Gaikwad', 'm', 'Pune', 'user', 'demo:person:m:25'),
  (45, 'Farah Sheikh', 'w', 'Pune', 'user', 'demo:person:w:24'),
  (46, 'Abhishek Dubey', 'm', 'Pune', 'user', 'demo:person:m:26'),
  (47, 'Sakshi Wagh', 'w', 'Pune', 'user', 'demo:person:w:25'),
  (48, 'Jayesh Chavan', 'm', 'Pune', 'user', 'demo:person:m:27'),
  (49, '', '', 'Pune', 'user', null),
  (50, '', '', 'Pune', 'user', null),
  (51, '', '', 'Pune', 'user', null),
  (52, '', '', 'Pune', 'user', null),
  (53, '', '', 'Pune', 'user', null),
  (54, '', '', 'Pune', 'user', null),
  (55, '', '', 'Pune', 'user', null),
  (56, '', '', 'Pune', 'user', null),
  (57, 'Chinmay Apte', 'm', 'Pune', 'user', 'demo:person:m:28'),
  (58, 'Gauri Sathe', 'w', 'Pune', 'user', 'demo:person:w:26'),
  (59, 'Aniket Deshpande', 'm', 'Pune', 'user', 'demo:person:m:29'),
  (60, 'Rutuja Bhosale', 'w', 'Pune', 'user', 'demo:person:w:27'),
  (61, 'Sameer Phadke', 'm', 'Pune', 'user', 'demo:person:m:30'),
  (62, 'Madhuri Karve', 'w', 'Pune', 'user', 'demo:person:w:28'),
  (63, 'Pranav Kelkar', 'm', 'Pune', 'user', 'demo:person:m:31'),
  (64, 'Ketaki Oak', 'w', 'Pune', 'user', 'demo:person:w:29'),
  (65, 'Swapnil Mane', 'm', 'Pune', 'user', 'demo:person:m:32'),
  (66, 'Aarti Inamdar', 'w', 'Pune', 'user', 'demo:person:w:30'),
  (67, 'Tejas Barve', 'm', 'Pune', 'user', 'demo:person:m:33'),
  (68, 'Vaishali Nene', 'w', 'Pune', 'user', 'demo:person:w:31'),
  (69, 'Rohit Sawant', 'm', 'Pune', 'user', 'demo:person:m:34'),
  (70, 'Namrata Limaye', 'w', 'Pune', 'user', 'demo:person:w:32'),
  (71, 'Hemant Joglekar', 'm', 'Pune', 'user', 'demo:person:m:35'),
  (72, 'Shweta Dixit', 'w', 'Pune', 'user', 'demo:person:w:33'),
  (73, 'Amol Patwardhan', 'm', 'Pune', 'user', 'demo:person:m:36'),
  (74, 'Radhika Ranade', 'w', 'Pune', 'user', 'demo:person:w:34'),
  (75, 'Elena Rossi', 'w', 'Pune', 'user', 'demo:person:w:35'),
  (76, 'Hannah Becker', 'w', 'Pune', 'user', 'demo:person:w:36'),
  (77, 'Imran Shaikh', 'm', 'Pune', 'user', 'demo:person:m:37'),
  (78, 'Deepa Krishnamurthy', 'w', 'Pune', 'user', 'demo:person:w:37'),
  (79, 'Suraj Lokhande', 'm', 'Pune', 'user', 'demo:person:m:38'),
  (80, 'Trupti Salunkhe', 'w', 'Pune', 'user', 'demo:person:w:38'),
  (81, 'Cyrus Irani', 'm', 'Mumbai', 'user', 'demo:person:m:39'),
  (82, 'Hiral Doshi', 'w', 'Mumbai', 'user', 'demo:person:w:39'),
  (83, 'Rustom Mistry', 'm', 'Mumbai', 'user', 'demo:person:m:40'),
  (84, 'Jinal Mehta', 'w', 'Mumbai', 'user', 'demo:person:w:40'),
  (85, 'Ashwin Shroff', 'm', 'Mumbai', 'user', 'demo:person:m:41'),
  (86, 'Nisha Kothari', 'w', 'Mumbai', 'user', 'demo:person:w:41'),
  (87, 'Vivek Naidu', 'm', 'Mumbai', 'user', 'demo:person:m:42'),
  (88, 'Tanya Fernandes', 'w', 'Mumbai', 'user', 'demo:person:w:42'),
  (89, 'Gaurav Sanghvi', 'm', 'Mumbai', 'user', 'demo:person:m:43'),
  (90, 'Pritika Menon', 'w', 'Mumbai', 'user', 'demo:person:w:43'),
  (91, 'Kunal Desai', 'm', 'Mumbai', 'user', 'demo:person:m:44'),
  (92, 'Mei Lin', 'w', 'Mumbai', 'user', 'demo:person:w:44'),
  (93, 'Aakash Parekh', 'm', 'Mumbai', 'user', 'demo:person:m:45'),
  (94, 'Sana Merchant', 'w', 'Mumbai', 'user', 'demo:person:w:45'),
  (95, 'Dhruv Kamath', 'm', 'Mumbai', 'user', 'demo:person:m:46'),
  (96, 'Rhea D''Souza', 'w', 'Mumbai', 'user', 'demo:person:w:46'),
  (97, 'Jay Thakkar', 'm', 'Mumbai', 'user', 'demo:person:m:47'),
  (98, 'Kritika Joshi', 'w', 'Mumbai', 'user', 'demo:person:w:47'),
  (99, 'Karthik Gowda', 'm', 'Bengaluru', 'user', 'demo:person:m:48'),
  (100, 'Meghana Rao', 'w', 'Bengaluru', 'user', 'demo:person:w:48'),
  (101, 'Prashanth Hegde', 'm', 'Bengaluru', 'user', 'demo:person:m:49'),
  (102, 'Shilpa Bhat', 'w', 'Bengaluru', 'user', 'demo:person:w:49'),
  (103, 'Naveen Kumar', 'm', 'Bengaluru', 'user', 'demo:person:m:50'),
  (104, 'Divya Prakash', 'w', 'Bengaluru', 'user', 'demo:person:w:50'),
  (105, 'Arvind Swamy', 'm', 'Bengaluru', 'user', 'demo:person:m:51'),
  (106, 'Chitra Venkatesh', 'w', 'Bengaluru', 'user', 'demo:person:w:51'),
  (107, 'Rakesh Shenoy', 'm', 'Bengaluru', 'user', 'demo:person:m:52'),
  (108, 'Anusha Murthy', 'w', 'Bengaluru', 'user', 'demo:person:w:52'),
  (109, 'Suhas Acharya', 'm', 'Bengaluru', 'user', 'demo:person:m:53'),
  (110, 'Deepti Nayak', 'w', 'Bengaluru', 'user', 'demo:person:w:53'),
  (111, 'Daniel Brooks', 'm', 'Bengaluru', 'user', 'demo:person:m:54'),
  (112, 'Lavanya Iyengar', 'w', 'Bengaluru', 'user', 'demo:person:w:54'),
  (113, 'Manoj Pai', 'm', 'Bengaluru', 'user', 'demo:person:m:55'),
  (114, 'Sindhu Reddy', 'w', 'Bengaluru', 'user', 'demo:person:w:55'),
  (115, 'Vinay Kamat', 'm', 'Bengaluru', 'user', 'demo:person:m:56'),
  (116, 'Harini Raman', 'w', 'Bengaluru', 'user', 'demo:person:w:56'),
  (117, 'Gurpreet Singh', 'm', 'Delhi', 'user', 'demo:person:m:57'),
  (118, 'Simran Arora', 'w', 'Delhi', 'user', 'demo:person:w:57'),
  (119, 'Ankur Khanna', 'm', 'Delhi', 'user', 'demo:person:m:58'),
  (120, 'Tanvi Bajaj', 'w', 'Delhi', 'user', 'demo:person:w:58'),
  (121, 'Mayank Tyagi', 'm', 'Delhi', 'user', 'demo:person:m:59'),
  (122, 'Ritu Sethi', 'w', 'Delhi', 'user', 'demo:person:w:59'),
  (123, 'Harpreet Gill', 'm', 'Delhi', 'user', 'demo:person:m:60'),
  (124, 'Nidhi Mathur', 'w', 'Delhi', 'user', 'demo:person:w:60'),
  (125, 'Sofia Garcia', 'w', 'Delhi', 'user', 'demo:person:w:61'),
  (126, 'Pankaj Chauhan', 'm', 'Delhi', 'user', 'demo:person:m:61'),
  (127, 'Ishita Bhalla', 'w', 'Delhi', 'user', 'demo:person:w:62'),
  (128, 'Lokesh Yadav', 'm', 'Delhi', 'user', 'demo:person:m:62'),
  (129, 'Srinivas Chary', 'm', 'Hyderabad', 'user', 'demo:person:m:63'),
  (130, 'Sravani Reddy', 'w', 'Hyderabad', 'user', 'demo:person:w:63'),
  (131, 'Mohammed Faizan', 'm', 'Hyderabad', 'user', 'demo:person:m:64'),
  (132, 'Ayesha Siddiqui', 'w', 'Hyderabad', 'user', 'demo:person:w:64'),
  (133, 'Venkat Rao', 'm', 'Hyderabad', 'user', 'demo:person:m:65'),
  (134, 'Harika Devi', 'w', 'Hyderabad', 'user', 'demo:person:w:65'),
  (135, 'Omar Haddad', 'm', 'Hyderabad', 'user', 'demo:person:m:66'),
  (136, 'Zainab Hussain', 'w', 'Hyderabad', 'user', 'demo:person:w:66'),
  (137, 'Praveen Goud', 'm', 'Hyderabad', 'user', 'demo:person:m:67'),
  (138, 'Swathi Nair', 'w', 'Hyderabad', 'user', 'demo:person:w:67'),
  (139, 'Imtiaz Ali', 'm', 'Hyderabad', 'user', 'demo:person:m:68'),
  (140, 'Bhavya Sri', 'w', 'Hyderabad', 'user', 'demo:person:w:68'),
  (141, '', '', 'Pune', 'user', null),
  (142, '', '', 'Pune', 'user', null),
  (143, '', '', 'Pune', 'user', null),
  (144, '', '', 'Pune', 'user', null),
  (145, '', '', 'Pune', 'user', null),
  (146, '', '', 'Pune', 'user', null),
  (147, '', '', 'Pune', 'user', null),
  (148, '', '', 'Pune', 'user', null),
  (149, '', '', 'Pune', 'user', null),
  (150, '', '', 'Pune', 'user', null),
  (151, '', '', 'Mumbai', 'user', null),
  (152, '', '', 'Mumbai', 'user', null),
  (153, '', '', 'Mumbai', 'user', null),
  (154, '', '', 'Mumbai', 'user', null),
  (155, '', '', 'Bengaluru', 'user', null),
  (156, '', '', 'Bengaluru', 'user', null),
  (157, '', '', 'Bengaluru', 'user', null),
  (158, '', '', 'Delhi', 'user', null),
  (159, '', '', 'Delhi', 'user', null),
  (160, '', '', 'Hyderabad', 'user', null),
  (161, 'Giulia Ferraro', 'w', 'Pune', 'business', 'demo:person:w:69'),
  (162, 'Venkat Subramaniam', 'm', 'Pune', 'business', 'demo:person:m:69'),
  (163, 'Mirza Ashfaq', 'm', 'Pune', 'business', 'demo:person:m:70'),
  (164, 'Aisha Qureshi', 'w', 'Pune', 'business', 'demo:person:w:70'),
  (165, 'Marco Bellini', 'm', 'Pune', 'business', 'demo:person:m:71'),
  (166, 'Rohan Bhandari', 'm', 'Pune', 'business', 'demo:person:m:72'),
  (167, 'Lakshmi Narayanan', 'w', 'Pune', 'business', 'demo:person:w:71'),
  (168, 'Neelam Chitale', 'w', 'Pune', 'business', 'demo:person:w:72'),
  (169, 'Sunita Deshmukh', 'w', 'Pune', 'business', 'demo:person:w:73'),
  (170, 'Kenneth Dsilva', 'm', 'Pune', 'business', 'demo:person:m:73'),
  (171, 'Dennis Pereira', 'm', 'Pune', 'business', 'demo:person:m:74'),
  (172, 'Ravi Kulkarni', 'm', 'Pune', 'business', 'demo:person:m:75'),
  (173, 'Shalini Rao', 'w', 'Pune', 'business', 'demo:person:w:74'),
  (174, 'Imran Qureshi', 'm', 'Pune', 'business', 'demo:person:m:76'),
  (175, 'Dr. Anita Joshi', 'w', 'Pune', 'business', 'demo:person:w:75'),
  (176, 'Meera Pillai', 'w', 'Pune', 'business', 'demo:person:w:76'),
  (177, 'Kunal Mehra', 'm', 'Pune', 'business', 'demo:person:m:77'),
  (178, 'Farhan Ansari', 'm', 'Pune', 'business', 'demo:person:m:78'),
  (179, 'Tanisha Bhasin', 'w', 'Pune', 'business', 'demo:person:w:77'),
  (180, 'Prof. Suresh Naik', 'm', 'Pune', 'business', 'demo:person:m:79'),
  (181, 'Neha Saxena', 'w', 'Pune', 'business', 'demo:person:w:78'),
  (182, 'Ganesh Pawar', 'm', 'Pune', 'business', 'demo:person:m:80'),
  (183, 'Sandeep Yadav', 'm', 'Pune', 'business', 'demo:person:m:81'),
  (184, 'Dr. Rahul Menon', 'm', 'Pune', 'business', 'demo:person:m:82'),
  (185, 'Dr. Kavita Rane', 'w', 'Pune', 'business', 'demo:person:w:79'),
  (186, 'Rohini Gokhale', 'w', 'Pune', 'business', 'demo:person:w:80'),
  (187, 'Madhav Kale', 'm', 'Pune', 'business', 'demo:person:m:83'),
  (188, 'Cyrus Wadia', 'm', 'Mumbai', 'business', 'demo:person:m:84'),
  (189, 'Rhea Pinto', 'w', 'Mumbai', 'business', 'demo:person:w:81'),
  (190, 'Naveen Gowda', 'm', 'Bengaluru', 'business', 'demo:person:m:85'),
  (191, 'Arjun Hegde', 'm', 'Bengaluru', 'business', 'demo:person:m:86'),
  (192, 'Gurpreet Anand', 'm', 'Delhi', 'business', 'demo:person:m:87'),
  (193, 'Mohammed Rafi', 'm', 'Hyderabad', 'business', 'demo:person:m:88');

do $demo$
declare
  -- The email you sign in with, so the demo friends appear in YOUR account. Leave as is to use the admin account(s).
  my_email text := 'you@example.com';
  want text[] := array['id','instance_id','aud','role','email','encrypted_password','email_confirmed_at','raw_app_meta_data','raw_user_meta_data',
                       'created_at','updated_at','is_anonymous','confirmation_token','recovery_token','email_change_token_new','email_change'];
  vals text[]; cols text; lits text; k int; j int; r record; uid uuid; other uuid; guest boolean; real_user uuid;
begin
  for r in select * from tp_people order by ord loop
    uid := ('de000000-0000-4000-8000-' || lpad(r.ord::text, 12, '0'))::uuid;
    guest := r.name = '';
    if not exists (select 1 from auth.users where id = uid) then
      vals := array[uid::text, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        case when guest then null else 'demo' || lpad(r.ord::text, 3, '0') || '@demo.trustedpicks.test' end,
        '', case when guest then null else now()::text end, '{"provider":"email","providers":["email"]}',
        case when guest then '{"demo":true}' else jsonb_build_object('demo', true, 'full_name', r.name)::text end,
        (now() - interval '150 days' + make_interval(days => r.ord % 120))::text, now()::text, guest::text, '', '', '', ''];
      cols := ''; lits := '';
      for k in 1..array_length(want, 1) loop
        if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = want[k]) then
          cols := cols || case when cols = '' then '' else ', ' end || quote_ident(want[k]);
          lits := lits || case when lits = '' then '' else ', ' end || quote_nullable(vals[k]);
        end if;
      end loop;
      execute format('insert into auth.users (%s) values (%s) on conflict do nothing', cols, lits);
    end if;
    -- The sign-up trigger normally makes this; make sure it exists with the right details either way.
    insert into public.profiles (id, display_name, avatar_path, city, role, invite_code, created_at)
    values (uid, r.name, r.avatar, case when guest then null else r.city end, r.role::public.app_role,
            case when guest then null else 'de' || lpad(to_hex(r.ord), 8, '0') end,
            now() - interval '150 days' + make_interval(days => r.ord % 120))
    on conflict (id) do update set display_name = excluded.display_name, avatar_path = excluded.avatar_path, city = excluded.city,
                                   role = excluded.role, invite_code = excluded.invite_code;
  end loop;

  -- Make the demo friends yours: the admin account(s), and the address above if it's an account.
  for real_user in
    select p.id from public.profiles p
    where p.id::text not like 'de000000-%'
      and (p.role = 'admin' or exists (select 1 from auth.users u where u.id = p.id and lower(u.email) = lower(my_email)))
  loop
    for j in 1..24 loop
      other := ('de000000-0000-4000-8000-' || lpad(j::text, 12, '0'))::uuid;
      insert into public.friendships (user_id, friend_id, via) values (real_user, other, case when j % 3 = 0 then 'review' else 'invite' end), (other, real_user, case when j % 3 = 0 then 'review' else 'invite' end) on conflict do nothing;
      if j <= 8 then insert into public.follows (follower_id, followee_id, source) values (real_user, other, 'in_app') on conflict do nothing; end if;
    end loop;
  end loop;
end
$demo$;

-- Friends among the demo users: inside each city, everyone is friends with four others, both ways (about 8 each).
with ranked as (
  select ord, city, row_number() over (partition by city order by ord) - 1 as rn, count(*) over (partition by city) as n
  from tp_people where name <> '' and role = 'user'
), pairs as (
  select a.ord as a, b.ord as b, d.d
  from ranked a cross join (values (1), (3), (8), (15)) d (d)
  join ranked b on b.city = a.city and b.rn = (a.rn + d.d) % a.n
  where a.n > d.d and a.ord <> b.ord
), ids as (
  select ('de000000-0000-4000-8000-' || lpad(a::text, 12, '0'))::uuid as u, ('de000000-0000-4000-8000-' || lpad(b::text, 12, '0'))::uuid as f,
         case when d = 1 then 'review' else 'invite' end as via from pairs
)
insert into public.friendships (user_id, friend_id, via)
select u, f, via from ids union all select f, u, via from ids
on conflict do nothing;

-- A few people follow each other too: followed names count for more in rankings.
with ranked as (
  select ord, city, row_number() over (partition by city order by ord) - 1 as rn, count(*) over (partition by city) as n
  from tp_people where name <> '' and role = 'user'
)
insert into public.follows (follower_id, followee_id, source)
select ('de000000-0000-4000-8000-' || lpad(a.ord::text, 12, '0'))::uuid, ('de000000-0000-4000-8000-' || lpad(b.ord::text, 12, '0'))::uuid, 'in_app'
from ranked a cross join (values (2), (5)) d (d) join ranked b on b.city = a.city and b.rn = (a.rn + d.d) % a.n
where a.n > d.d and a.ord <> b.ord
on conflict do nothing;

-- =====================================================================================
-- Shops: every field filled (about, hours, pictures, links, owner), 42 of them in 5 cities.
-- =====================================================================================
drop table if exists tp_shops;
create temp table tp_shops (name text primary key, category text, area text, city text, about text, price int, lat float8, lng float8, hours text,
  kind text, cover text, logo text, links text, status text, listed_days int, age int, owner_ord int, admin_owned boolean,
  plan text, sub_status text, billing_interval text, trial_left int, pop numeric, q numeric);
insert into tp_shops values
  ('Forno Napoli', 'Pizzeria', 'Koregaon Park', 'Pune', 'Wood-fired Neapolitan pizza from a 450°C oven, made with imported San Marzano tomatoes and fior di latte. Tiny, loud and always full on weekends, so come early.', 3, 18.5362, 73.894, '{"Mon–Thu":"12 pm–11 pm","Fri–Sat":"12 pm–12 am","Sun":"12 pm–11 pm"}', 'food', 'demo:pizza:2', 'demo:logo:1d4ed8:Forno Napoli', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/fornonapoli-koregaon-park-pune-808760","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/fornonapoli-koregaon-park","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/fornonapoli/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/fornonapoli.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/fornonapoli.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876576478","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/fornonapoli","label":"Website"},{"kind":"email","url":"mailto:hello@fornonapoli.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@fornonapoli.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876576478","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5362,73.894","label":"Directions"}]', 'live', 285, 168, 161, false, 'starter', 'active', 'month', 25, 0.5, 0.2),
  ('Kaapi Corner', 'Cafe', 'Baner', 'Pune', 'A South Indian filter coffee bar with crisp dosas and soft idlis. Coffee is brewed in brass dabaras, chutneys are ground fresh every morning and the Sunday queue is worth it.', 1, 18.559, 73.7868, '{"Mon–Sat":"7 am–9 pm","Sun":"8 am–1 pm"}', 'food', 'demo:coffee:2', 'demo:logo:b91c1c:Kaapi Corner', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/kaapicorner-baner-pune-567342","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/kaapicorner-baner","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/kaapicorner/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/kaapicorner.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/kaapicorner.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876552912","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/kaapicorner","label":"Website"},{"kind":"email","url":"mailto:hello@kaapicorner.example","label":"Email us"},{"kind":"phone","url":"tel:+919876552912","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.559,73.7868","label":"Directions"}]', 'live', 139, 370, 162, false, 'starter', 'active', 'month', 25, 0.45, 0.3),
  ('Hyderabad Biryani House', 'Restaurant', 'Viman Nagar', 'Pune', 'Dum-cooked Hyderabadi biryani, sealed in handis and opened at the table. Long-grain rice, saffron, slow heat and a raita that needs no help.', 2, 18.5679, 73.9143, '{"Mon–Thu":"11:30 am–11 pm","Fri–Sun":"11:30 am–11:30 pm"}', 'food', 'demo:biryani:0', 'demo:logo:6d28d9:Hyderabad Biryani House', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/hyderabadbiryanihouse-viman-nagar-pune-641161","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/hyderabadbiryanihouse-viman-nagar","label":"Order on Zomato"},{"kind":"magicpin","url":"https://magicpin.in/Pune/Viman-Nagar/Restaurant/Hyderabad-Biryani-House/store/9c889/","label":"magicpin offers"},{"kind":"other","url":"https://example.com/hyderabadbiryanihouse/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/hyderabadbiryanihouse.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/hyderabadbiryanihouse.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876557924","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/hyderabadbiryanihouse","label":"Website"},{"kind":"email","url":"mailto:hello@hyderabadbiryanihouse.example","label":"Email us"},{"kind":"phone","url":"tel:+919876557924","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5679,73.9143","label":"Directions"}]', 'live', 265, 310, 163, false, 'starter', 'active', 'year', 25, 0.5, 0),
  ('Masala Library', 'Restaurant', 'Koregaon Park', 'Pune', 'Modern Indian plates: smoky kebabs, slow curries and hot breads from a pass-through kitchen. A short menu that changes with the season and a bar that knows its spices.', 3, 18.5402, 73.8972, '{"Mon–Thu":"12 pm–11:30 pm","Fri–Sun":"12 pm–12:30 am"}', 'food', 'demo:dining:1', 'demo:logo:0f766e:Masala Library', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/masalalibrary-koregaon-park-pune-207560","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/masalalibrary-koregaon-park","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/masalalibrary/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/masalalibrary.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/masalalibrary.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876573959","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/masalalibrary","label":"Website"},{"kind":"email","url":"mailto:hello@masalalibrary.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@masalalibrary.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876573959","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5402,73.8972","label":"Directions"}]', 'live', 356, 281, null, true, 'pro', 'active', 'year', 25, 0.45, 0),
  ('Brew Society', 'Cafe', 'Aundh', 'Pune', 'Small-batch coffee, cold brews and all-day brunch in a bright corner space. Beans from three estates, roasted twice a week, and a pastry case that empties by noon.', 2, 18.5584, 73.8089, '{"Mon–Fri":"8 am–11 pm","Sat–Sun":"8 am–12 am"}', 'food', 'demo:cafe:0', 'demo:logo:334155:Brew Society', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/brewsociety-aundh-pune-512974","label":"Order on Swiggy"},{"kind":"other","url":"https://example.com/brewsociety/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/brewsociety.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/brewsociety.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876537304","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/brewsociety","label":"Website"},{"kind":"email","url":"mailto:hello@brewsociety.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@brewsociety.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876537304","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5584,73.8089","label":"Directions"}]', 'live', 349, 378, 164, false, 'starter', 'active', 'month', 25, 0.45, 0),
  ('Tandoor Tales', 'Restaurant', 'Kothrud', 'Pune', 'A family tandoor house with kebabs, rolls and rich gravies. Marinades are made the day before and the clay oven never goes cold.', 2, 18.5074, 73.8077, '{"Mon–Sun":"11 am–11 pm"}', 'food', 'demo:tandoor:1', 'demo:logo:9333ea:Tandoor Tales', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/tandoortales-kothrud-pune-388903","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/tandoortales-kothrud","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/tandoortales/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/tandoortales.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/tandoortales.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876547603","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/tandoortales","label":"Website"},{"kind":"email","url":"mailto:hello@tandoortales.example","label":"Email us"},{"kind":"phone","url":"tel:+919876547603","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5074,73.8077","label":"Directions"}]', 'live', 304, 228, null, false, 'standard', 'active', 'year', 25, 0.25, -0.3),
  ('Pasta Fresca', 'Italian restaurant', 'Camp', 'Pune', 'Hand-rolled pasta, slow ragù and a small, honest wine list. The kitchen makes tagliatelle, ravioli and gnocchi in the window every afternoon.', 3, 18.5171, 73.8795, '{"Mon–Thu":"12 pm–11 pm","Fri–Sun":"12 pm–11:30 pm"}', 'food', 'demo:pasta:1', 'demo:logo:334155:Pasta Fresca', '[{"kind":"other","url":"https://example.com/pastafresca/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/pastafresca.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/pastafresca.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876517165","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/pastafresca","label":"Website"},{"kind":"email","url":"mailto:hello@pastafresca.example","label":"Email us"},{"kind":"phone","url":"tel:+919876517165","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5171,73.8795","label":"Directions"}]', 'live', 142, 251, 165, false, 'standard', 'past_due', 'month', 25, 0.25, 0),
  ('Burger Barn', 'Burger restaurant', 'Wakad', 'Pune', 'Smash burgers, loaded fries and thick shakes in a barn-style room with a loud playlist. Patties are ground in-house and pressed on a screaming-hot griddle.', 2, 18.599, 73.76, '{"Mon–Thu":"12 pm–12 am","Fri–Sun":"12 pm–1 am"}', 'food', 'demo:burger:0', 'demo:logo:334155:Burger Barn', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/burgerbarn-wakad-pune-752812","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/burgerbarn-wakad","label":"Order on Zomato"},{"kind":"eatsure","url":"https://www.eatsure.com/pune/burgerbarn","label":"EatSure"},{"kind":"other","url":"https://example.com/burgerbarn/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/burgerbarn.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/burgerbarn.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876547867","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/burgerbarn","label":"Website"},{"kind":"email","url":"mailto:hello@burgerbarn.example","label":"Email us"},{"kind":"phone","url":"tel:+919876547867","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.599,73.76","label":"Directions"}]', 'live', 120, 236, 166, false, 'pro', 'active', 'year', 25, 0.4, -0.2),
  ('Madras Tiffin Room', 'Tiffin restaurant', 'Karve Nagar', 'Pune', 'Old-school South Indian tiffin served on banana leaf. Sambar is made the traditional way, with a hand-pounded spice mix, and the filter coffee comes in a davara set.', 1, 18.4915, 73.82, '{"Mon–Sun":"7 am–10 pm"}', 'food', 'demo:dosa:0', 'demo:logo:be185d:Madras Tiffin Room', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/madrastiffinroom-karve-nagar-pune-129005","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/madrastiffinroom-karve-nagar","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/madrastiffinroom/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/madrastiffinroom.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/madrastiffinroom.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876534559","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/madrastiffinroom","label":"Website"},{"kind":"email","url":"mailto:hello@madrastiffinroom.example","label":"Email us"},{"kind":"phone","url":"tel:+919876534559","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.4915,73.82","label":"Directions"}]', 'live', 145, 351, 167, false, 'starter', 'active', 'month', 25, 0.25, 0),
  ('Chaat Street', 'Street food', 'Deccan', 'Pune', 'Tangy, crunchy chaat made fresh to order at a streetside counter. The pani is mixed thrice a day and the chutneys are never from a bottle.', 1, 18.5164, 73.841, '{"Mon–Sun":"4 pm–11 pm"}', 'food', 'demo:chaat:1', 'demo:logo:be185d:Chaat Street', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/chaatstreet-deccan-pune-687450","label":"Order on Swiggy"},{"kind":"other","url":"https://example.com/chaatstreet/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/chaatstreet.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/chaatstreet.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876533040","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/chaatstreet","label":"Website"},{"kind":"email","url":"mailto:hello@chaatstreet.example","label":"Email us"},{"kind":"phone","url":"tel:+919876533040","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5164,73.841","label":"Directions"}]', 'live', 192, 308, null, false, 'starter', 'active', 'month', 25, 0.25, 0.1),
  ('Sweet Tooth Creamery', 'Dessert parlour', 'Koregaon Park', 'Pune', 'Small-batch gelato, sundaes and warm brownies. Twelve flavours a day, all churned in the shop with real fruit and no artificial colour.', 2, 18.539, 73.896, '{"Mon–Thu":"1 pm–11 pm","Fri–Sun":"12 pm–12 am"}', 'food', 'demo:icecream:0', 'demo:logo:a16207:Sweet Tooth Creamery', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/sweettoothcreamery-koregaon-park-pune-204179","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/sweettoothcreamery-koregaon-park","label":"Order on Zomato"},{"kind":"eatsure","url":"https://www.eatsure.com/pune/sweettoothcreamery","label":"EatSure"},{"kind":"other","url":"https://example.com/sweettoothcreamery/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/sweettoothcreamery.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/sweettoothcreamery.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876510845","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/sweettoothcreamery","label":"Website"},{"kind":"email","url":"mailto:hello@sweettoothcreamery.example","label":"Email us"},{"kind":"phone","url":"tel:+919876510845","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.539,73.896","label":"Directions"}]', 'live', 230, 335, 168, false, 'pro', 'active', 'month', 25, 0.25, 0),
  ('Bombay Bites', 'Restaurant', 'Pimple Saudagar', 'Pune', 'Mumbai street classics: vada pav, pav bhaji and cutting chai. Everything comes off a flat tawa with a lot of butter.', 1, 18.597, 73.793, '{"Mon–Sun":"8 am–11 pm"}', 'food', 'demo:chaat:0', 'demo:logo:be185d:Bombay Bites', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/bombaybites-pimple-saudagar-pune-430213","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/bombaybites-pimple-saudagar","label":"Order on Zomato"},{"kind":"magicpin","url":"https://magicpin.in/Pune/Pimple-Saudagar/Restaurant/Bombay-Bites/store/69085/","label":"magicpin offers"},{"kind":"other","url":"https://example.com/bombaybites/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/bombaybites.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/bombaybites.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876574309","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/bombaybites","label":"Website"},{"kind":"email","url":"mailto:hello@bombaybites.example","label":"Email us"},{"kind":"phone","url":"tel:+919876574309","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.597,73.793","label":"Directions"}]', 'live', 295, 389, null, false, 'starter', 'active', 'year', 25, 0.25, 0.2),
  ('Green Bowl', 'Cafe', 'Baner', 'Pune', 'Fresh salads, grain bowls and cold-pressed juices for a lighter lunch. Vegetables come from a farm near Mulshi and the menu leans plant-based.', 2, 18.561, 73.79, '{"Mon–Sat":"8 am–9 pm","Sun":"9 am–6 pm"}', 'food', 'demo:salad:0', 'demo:logo:6d28d9:Green Bowl', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/greenbowl-baner-pune-507361","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/greenbowl-baner","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/greenbowl/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/greenbowl.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/greenbowl.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876553843","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/greenbowl","label":"Website"},{"kind":"email","url":"mailto:hello@greenbowl.example","label":"Email us"},{"kind":"phone","url":"tel:+919876553843","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.561,73.79","label":"Directions"}]', 'live', 297, 329, null, false, 'standard', 'active', 'year', 25, 0.25, 0),
  ('The Book Nook Cafe', 'Cafe', 'Kothrud', 'Pune', 'Coffee and cake among shelves of second-hand books. Read for free, borrow for a small deposit and leave a book to get one back.', 2, 18.503, 73.807, '{"Mon–Fri":"10 am–10 pm","Sat–Sun":"9 am–11 pm"}', 'food', 'demo:cafe:1', 'demo:logo:334155:The Book Nook Cafe', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/thebooknookcafe-kothrud-pune-662582","label":"Order on Swiggy"},{"kind":"other","url":"https://example.com/thebooknookcafe/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/thebooknookcafe.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/thebooknookcafe.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876529269","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/thebooknookcafe","label":"Website"},{"kind":"email","url":"mailto:hello@thebooknookcafe.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@thebooknookcafe.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876529269","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.503,73.807","label":"Directions"}]', 'live', 277, 379, 169, false, 'pro', 'active', 'year', 25, 0.25, 0),
  ('Spice Route', 'Restaurant', 'Viman Nagar', 'Pune', 'Indo-Chinese and Thai plates cooked on a roaring wok. Big flavours, quick service and a lot of garlic.', 2, 18.566, 73.91, '{"Mon–Sun":"12 pm–11 pm"}', 'food', 'demo:noodles:0', 'demo:logo:6d28d9:Spice Route', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/spiceroute-viman-nagar-pune-219922","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/spiceroute-viman-nagar","label":"Order on Zomato"},{"kind":"magicpin","url":"https://magicpin.in/Pune/Viman-Nagar/Restaurant/Spice-Route/store/35b12/","label":"magicpin offers"},{"kind":"other","url":"https://example.com/spiceroute/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/spiceroute.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/spiceroute.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876589033","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/spiceroute","label":"Website"},{"kind":"email","url":"mailto:hello@spiceroute.example","label":"Email us"},{"kind":"phone","url":"tel:+919876589033","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.566,73.91","label":"Directions"}]', 'live', 182, 167, 170, false, 'starter', 'active', 'year', 25, 0.25, -0.1),
  ('Smoke House BBQ', 'Restaurant', 'Hadapsar', 'Pune', 'Slow-smoked meats, house rubs and big sides. Ribs spend twelve hours over hickory and the brisket sells out by eight.', 3, 18.5089, 73.926, '{"Mon–Thu":"1 pm–11 pm","Fri–Sun":"1 pm–11:30 pm"}', 'food', 'demo:grill:0', 'demo:logo:be185d:Smoke House BBQ', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/smokehousebbq-hadapsar-pune-716715","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/smokehousebbq-hadapsar","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/smokehousebbq/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/smokehousebbq.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/smokehousebbq.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876568904","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/smokehousebbq","label":"Website"},{"kind":"email","url":"mailto:hello@smokehousebbq.example","label":"Email us"},{"kind":"phone","url":"tel:+919876568904","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5089,73.926","label":"Directions"}]', 'live', 329, 180, 171, false, 'starter', 'active', 'month', 25, 0.25, 0.3),
  ('Sugar Loaf Bakery', 'Bakery', 'Kalyani Nagar', 'Pune', 'Small-batch sourdough, all-butter croissants and celebration cakes, baked before sunrise. Order cakes two days ahead and ask about the Sunday tasting box.', 2, 18.5463, 73.9033, '{"Tue–Sun":"8 am–8 pm","Mon":"Closed"}', 'food', 'demo:bakeshop:0', 'demo:logo:1d4ed8:Sugar Loaf Bakery', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/sugarloafbakery-kalyani-nagar-pune-812041","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/pune/sugarloafbakery-kalyani-nagar","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/sugarloafbakery/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/sugarloafbakery.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/sugarloafbakery.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876530052","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/sugarloafbakery","label":"Website"},{"kind":"email","url":"mailto:hello@sugarloafbakery.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@sugarloafbakery.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876530052","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5463,73.9033","label":"Directions"}]', 'live', 311, 164, null, true, 'pro', 'active', 'month', 25, 0.4, 0),
  ('Fade Studio', 'Salon', 'Aundh', 'Pune', 'Barbers for sharp fades, beard work and quick trims. Book a chair online or walk in, and the head massage comes with a cup of chai.', 2, 18.559, 73.8075, '{"Mon–Sun":"10 am–9 pm"}', 'beauty', 'demo:barber:0', 'demo:logo:c026d3:Fade Studio', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Fade-Studio-Aundh/361307","label":"Justdial"},{"kind":"other","url":"https://example.com/fadestudio/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/fadestudio.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/fadestudio.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876514508","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/fadestudio","label":"Website"},{"kind":"email","url":"mailto:hello@fadestudio.example","label":"Email us"},{"kind":"phone","url":"tel:+919876514508","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.559,73.8075","label":"Directions"}]', 'live', 279, 142, null, true, 'standard', 'active', 'month', 25, 0.35, 0.3),
  ('Iron Temple Gym', 'Gym', 'Baner', 'Pune', 'A strength floor with free weights, group classes and coaches who actually correct your form. Lockers, showers and a protein bar on site.', 2, 18.5642, 73.7769, '{"Mon–Sat":"5 am–10 pm","Sun":"7 am–1 pm"}', 'fitness', 'demo:gym:0', 'demo:logo:be185d:Iron Temple Gym', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Iron-Temple-Gym-Baner/637427","label":"Justdial"},{"kind":"other","url":"https://example.com/irontemplegym/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/irontemplegym.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/irontemplegym.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876538397","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/irontemplegym","label":"Website"},{"kind":"email","url":"mailto:hello@irontemplegym.example","label":"Email us"},{"kind":"phone","url":"tel:+919876538397","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5642,73.7769","label":"Directions"}]', 'live', 217, 245, 172, false, 'standard', 'active', 'year', 25, 0.3, 0),
  ('Glow Beauty Parlour', 'Beauty parlour', 'Viman Nagar', 'Pune', 'Facials, hair spa and bridal makeup by a careful, hygiene-first team. Appointments are kept on time and prices are written down before we start.', 2, 18.5701, 73.9186, '{"Mon–Sun":"10 am–8 pm"}', 'beauty', 'demo:salon:0', 'demo:logo:b91c1c:Glow Beauty Parlour', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Glow-Beauty-Parlour-Viman-Nagar/118099","label":"Justdial"},{"kind":"other","url":"https://example.com/glowbeautyparlour/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/glowbeautyparlour.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/glowbeautyparlour.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876536990","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/glowbeautyparlour","label":"Website"},{"kind":"email","url":"mailto:hello@glowbeautyparlour.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@glowbeautyparlour.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876536990","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5701,73.9186","label":"Directions"}]', 'live', 147, 303, 173, false, 'starter', 'active', 'year', 25, 0.3, 0),
  ('Urban Threads', 'Clothing store', 'FC Road', 'Pune', 'Everyday cotton wear, kurtas and easy-returns shopping. New stock every fortnight and a tailor on the premises for same-day fixes.', 2, 18.5196, 73.8419, '{"Mon–Sun":"11 am–9 pm"}', 'store', 'demo:fashion:1', 'demo:logo:be185d:Urban Threads', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Urban-Threads-FC-Road/694059","label":"Justdial"},{"kind":"other","url":"https://example.com/urbanthreads/shop","label":"Shop online"},{"kind":"instagram","url":"https://instagram.com/urbanthreads.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/urbanthreads.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876599729","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/urbanthreads","label":"Website"},{"kind":"email","url":"mailto:hello@urbanthreads.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@urbanthreads.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876599729","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5196,73.8419","label":"Directions"}]', 'live', 255, 179, 174, false, 'standard', 'cancelled', 'year', 25, 0.25, 0),
  ('CarePlus Clinic', 'Clinic', 'Kalyani Nagar', 'Pune', 'Family doctor and walk-in clinic with short waits. Appointments by phone or WhatsApp, and prescriptions come with a clear written plan.', 2, 18.5467, 73.9061, '{"Mon–Sat":"9 am–8 pm","Sun":"Closed"}', 'health', 'demo:clinic:0', 'demo:logo:0f766e:CarePlus Clinic', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/CarePlus-Clinic-Kalyani-Nagar/106510","label":"Justdial"},{"kind":"other","url":"https://example.com/careplusclinic/book","label":"Book an appointment"},{"kind":"facebook","url":"https://facebook.com/careplusclinic.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876547208","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/careplusclinic","label":"Website"},{"kind":"email","url":"mailto:hello@careplusclinic.example","label":"Email us"},{"kind":"phone","url":"tel:+919876547208","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5467,73.9061","label":"Directions"}]', 'live', 276, 142, 175, false, 'pro', 'active', 'year', 25, 0.25, 0),
  ('Studio Zen Yoga', 'Yoga studio', 'Aundh', 'Pune', 'Hatha, vinyasa and breathwork in a calm, sunlit room. Mats and blocks are provided, and every class is capped at fifteen people.', 2, 18.56, 73.805, '{"Mon–Sat":"6 am–8 pm","Sun":"7 am–11 am"}', 'fitness', 'demo:yoga:0', 'demo:logo:15803d:Studio Zen Yoga', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Studio-Zen-Yoga-Aundh/449500","label":"Justdial"},{"kind":"other","url":"https://example.com/studiozenyoga/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/studiozenyoga.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/studiozenyoga.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876552569","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/studiozenyoga","label":"Website"},{"kind":"email","url":"mailto:hello@studiozenyoga.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@studiozenyoga.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876552569","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.56,73.805","label":"Directions"}]', 'live', 233, 242, 176, false, 'starter', 'active', 'month', 25, 0.25, 0),
  ('FitHub CrossFit', 'CrossFit gym', 'Kalyani Nagar', 'Pune', 'Coached CrossFit classes in small groups, with an open gym for members. Beginners start with a four-session intro.', 3, 18.548, 73.904, '{"Mon–Sat":"5:30 am–9 pm","Sun":"8 am–11 am"}', 'fitness', 'demo:crossfit:0', 'demo:logo:15803d:FitHub CrossFit', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/FitHub-CrossFit-Kalyani-Nagar/245304","label":"Justdial"},{"kind":"other","url":"https://example.com/fithubcrossfit/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/fithubcrossfit.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/fithubcrossfit.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876589433","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/fithubcrossfit","label":"Website"},{"kind":"email","url":"mailto:hello@fithubcrossfit.example","label":"Email us"},{"kind":"phone","url":"tel:+919876589433","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.548,73.904","label":"Directions"}]', 'live', 120, 244, 177, false, 'trial', 'trial', 'year', 19, 0.08, 0),
  ('Blade & Co Barbers', 'Barber shop', 'Camp', 'Pune', 'Classic cuts, hot towel shaves and beard sculpting in a leather-and-wood shop. Walk-ins welcome, appointments get priority.', 2, 18.515, 73.878, '{"Mon–Sun":"10 am–9 pm"}', 'beauty', 'demo:barber:1', 'demo:logo:6d28d9:Blade & Co Barbers', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Blade-Co-Barbers-Camp/454952","label":"Justdial"},{"kind":"other","url":"https://example.com/bladecobarbers/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/bladecobarbers.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/bladecobarbers.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876522847","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/bladecobarbers","label":"Website"},{"kind":"email","url":"mailto:hello@bladecobarbers.example","label":"Email us"},{"kind":"phone","url":"tel:+919876522847","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.515,73.878","label":"Directions"}]', 'live', 308, 209, 178, false, 'starter', 'active', 'month', 25, 0.25, 0),
  ('Nail Bar', 'Nail studio', 'Koregaon Park', 'Pune', 'Gel manicures, pedicures and custom nail art in a bright, quiet studio. Tools are sterilised between every client.', 2, 18.538, 73.892, '{"Mon–Sun":"11 am–8 pm"}', 'beauty', 'demo:nails:0', 'demo:logo:15803d:Nail Bar', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Nail-Bar-Koregaon-Park/453048","label":"Justdial"},{"kind":"other","url":"https://example.com/nailbar/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/nailbar.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/nailbar.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876566776","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/nailbar","label":"Website"},{"kind":"email","url":"mailto:hello@nailbar.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@nailbar.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876566776","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.538,73.892","label":"Directions"}]', 'live', 248, 231, 179, false, 'trial', 'trial', 'month', 12, 0.08, 0),
  ('BrightPath Coaching', 'Coaching class', 'Kothrud', 'Pune', 'Small-batch maths and science coaching for classes 8 to 12. Weekly tests, doubt sessions and a parent update every month.', 2, 18.506, 73.81, '{"Mon–Sat":"4 pm–9 pm","Sun":"Closed"}', 'education', 'demo:class:0', 'demo:logo:a16207:BrightPath Coaching', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/BrightPath-Coaching-Kothrud/158651","label":"Justdial"},{"kind":"other","url":"https://example.com/brightpathcoaching/book","label":"Book an appointment"},{"kind":"facebook","url":"https://facebook.com/brightpathcoaching.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876599046","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/brightpathcoaching","label":"Website"},{"kind":"email","url":"mailto:hello@brightpathcoaching.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@brightpathcoaching.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876599046","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.506,73.81","label":"Directions"}]', 'live', 176, 362, 180, false, 'standard', 'active', 'year', 25, 0.25, 0),
  ('Little Steps Preschool', 'School', 'Baner', 'Pune', 'Play-based preschool with caring teachers, a safe campus and a small garden. Parents get a daily photo update.', 3, 18.565, 73.78, '{"Mon–Fri":"8 am–2 pm","Sat":"9 am–12 pm"}', 'education', 'demo:school:0', 'demo:logo:6d28d9:Little Steps Preschool', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Little-Steps-Preschool-Baner/370278","label":"Justdial"},{"kind":"other","url":"https://example.com/littlestepspreschool/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/littlestepspreschool.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/littlestepspreschool.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876548304","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/littlestepspreschool","label":"Website"},{"kind":"email","url":"mailto:hello@littlestepspreschool.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@littlestepspreschool.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876548304","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.565,73.78","label":"Directions"}]', 'live', 184, 156, 181, false, 'pro', 'active', 'month', 25, 0.25, 0.3),
  ('FixIt Home Services', 'Home repair service', 'Hadapsar', 'Pune', 'On-time electricians, plumbers and AC technicians in uniform. Quotes are fixed before work starts and every job carries a 30-day guarantee.', 2, 18.51, 73.925, '{"Mon–Sun":"8 am–8 pm"}', 'services', 'demo:repair:0', 'demo:logo:a16207:FixIt Home Services', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/FixIt-Home-Services-Hadapsar/498867","label":"Justdial"},{"kind":"other","url":"https://example.com/fixithomeservices/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/fixithomeservices.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/fixithomeservices.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876515428","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/fixithomeservices","label":"Website"},{"kind":"email","url":"mailto:hello@fixithomeservices.example","label":"Email us"},{"kind":"phone","url":"tel:+919876515428","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.51,73.925","label":"Directions"}]', 'live', 134, 204, 182, false, 'starter', 'active', 'year', 25, 0.25, -0.7),
  ('Wheels Garage', 'Car garage', 'Wakad', 'Pune', 'Honest car servicing with photo updates at every step. Old parts are shown back to you and the bill matches the quote.', 2, 18.598, 73.759, '{"Mon–Sat":"9 am–7 pm","Sun":"Closed"}', 'services', 'demo:garage:0', 'demo:logo:c2410c:Wheels Garage', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Wheels-Garage-Wakad/593817","label":"Justdial"},{"kind":"other","url":"https://example.com/wheelsgarage/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/wheelsgarage.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/wheelsgarage.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876503577","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/wheelsgarage","label":"Website"},{"kind":"email","url":"mailto:hello@wheelsgarage.example","label":"Email us"},{"kind":"phone","url":"tel:+919876503577","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.598,73.759","label":"Directions"}]', 'live', 132, 189, 183, false, 'standard', 'active', 'month', 25, 0.25, -0.4),
  ('SmileCare Dental', 'Dental clinic', 'Camp', 'Pune', 'Gentle dentistry, clear explanations and fair prices. X-rays on site, and every treatment plan is shared with the cost first.', 2, 18.516, 73.88, '{"Mon–Sat":"10 am–7 pm","Sun":"Closed"}', 'health', 'demo:dental:0', 'demo:logo:be185d:SmileCare Dental', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/SmileCare-Dental-Camp/302655","label":"Justdial"},{"kind":"other","url":"https://example.com/smilecaredental/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/smilecaredental.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/smilecaredental.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876510928","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/smilecaredental","label":"Website"},{"kind":"email","url":"mailto:hello@smilecaredental.example","label":"Email us"},{"kind":"phone","url":"tel:+919876510928","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.516,73.88","label":"Directions"}]', 'live', 218, 246, 184, false, 'pro', 'active', 'year', 25, 0.25, 0.4),
  ('PetPals Vet', 'Vet clinic', 'Aundh', 'Pune', 'Friendly vets for dogs, cats and small pets, with in-house diagnostics. Home visits can be booked on WhatsApp.', 2, 18.557, 73.806, '{"Mon–Sat":"10 am–8 pm","Sun":"10 am–1 pm"}', 'health', 'demo:vet:0', 'demo:logo:9333ea:PetPals Vet', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/PetPals-Vet-Aundh/243851","label":"Justdial"},{"kind":"other","url":"https://example.com/petpalsvet/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/petpalsvet.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/petpalsvet.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876517677","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/petpalsvet","label":"Website"},{"kind":"email","url":"mailto:hello@petpalsvet.example","label":"Email us"},{"kind":"phone","url":"tel:+919876517677","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.557,73.806","label":"Directions"}]', 'live', 235, 167, 185, false, 'trial', 'trial', 'year', 7, 0.08, 0),
  ('Paper Trail Books', 'Bookstore', 'FC Road', 'Pune', 'An independent bookshop with a much-loved staff-picks wall, a kids corner and a reading nook upstairs.', 2, 18.521, 73.843, '{"Mon–Sun":"10 am–9 pm"}', 'store', 'demo:shopfront:1', 'demo:logo:a16207:Paper Trail Books', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Paper-Trail-Books-FC-Road/724575","label":"Justdial"},{"kind":"other","url":"https://example.com/papertrailbooks/shop","label":"Shop online"},{"kind":"instagram","url":"https://instagram.com/papertrailbooks.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/papertrailbooks.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876575700","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/papertrailbooks","label":"Website"},{"kind":"email","url":"mailto:hello@papertrailbooks.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@papertrailbooks.pun","label":"YouTube"},{"kind":"phone","url":"tel:+919876575700","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.521,73.843","label":"Directions"}]', 'live', 237, 300, 186, false, 'standard', 'active', 'year', 25, 0.25, 0.4),
  ('Gadget Galaxy', 'Electronics store', 'Hadapsar', 'Pune', 'Phones, audio and accessories with a real warranty and honest advice. Repairs and screen guards are done while you wait.', 2, 18.507, 73.928, '{"Mon–Sun":"11 am–9 pm"}', 'store', 'demo:shopfront:2', 'demo:logo:be185d:Gadget Galaxy', '[{"kind":"justdial","url":"https://www.justdial.com/Pune/Gadget-Galaxy-Hadapsar/751246","label":"Justdial"},{"kind":"other","url":"https://example.com/gadgetgalaxy/shop","label":"Shop online"},{"kind":"facebook","url":"https://facebook.com/gadgetgalaxy.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876512006","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/gadgetgalaxy","label":"Website"},{"kind":"email","url":"mailto:hello@gadgetgalaxy.example","label":"Email us"},{"kind":"phone","url":"tel:+919876512006","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.507,73.928","label":"Directions"}]', 'live', 247, 324, null, false, 'starter', 'active', 'year', 25, 0.15, -0.5),
  ('Chai Tapri Co.', 'Cafe', 'Pashan', 'Pune', 'A roadside-style chai counter with kulhad chai, bun maska and bhajiyas. Brand new, so be among the first to review.', 1, 18.538, 73.792, '{"Mon–Sun":"6 am–11 pm"}', 'food', 'demo:cafe:3', 'demo:logo:c2410c:Chai Tapri Co.', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/chaitaprico-pashan-pune-621617","label":"Order on Swiggy"},{"kind":"other","url":"https://example.com/chaitaprico/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/chaitaprico.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/chaitaprico.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876511289","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/chaitaprico","label":"Website"},{"kind":"email","url":"mailto:hello@chaitaprico.example","label":"Email us"},{"kind":"phone","url":"tel:+919876511289","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.538,73.792","label":"Directions"}]', 'live', 239, 307, 169, false, 'trial', 'trial', 'month', 25, 0, 0),
  ('Old Wada Kitchen', 'Restaurant', 'Shaniwar Peth', 'Pune', 'Traditional Maharashtrian thalis in a restored wada. The shop is renewing its listing, so it is hidden from search for now.', 2, 18.5196, 73.8553, '{"Mon–Sun":"11:30 am–3:30 pm, 7 pm–10 pm"}', 'food', 'demo:dining:2', 'demo:logo:15803d:Old Wada Kitchen', '[{"kind":"zomato","url":"https://www.zomato.com/pune/oldwadakitchen-shaniwar-peth","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/oldwadakitchen/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/oldwadakitchen.pun","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/oldwadakitchen.pun","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876568278","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/oldwadakitchen","label":"Website"},{"kind":"email","url":"mailto:hello@oldwadakitchen.example","label":"Email us"},{"kind":"phone","url":"tel:+919876568278","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.5196,73.8553","label":"Directions"}]', 'lapsed', -20, 282, 187, false, 'standard', 'expired', 'month', 25, 0.2, 0),
  ('Cafe Colaba Nights', 'Cafe', 'Colaba', 'Mumbai', 'A late-night cafe near the Causeway with Irani chai, bun maska, keema pav and a sea breeze. Open until the last customer leaves.', 3, 18.9067, 72.8147, '{"Mon–Sun":"7 am–2 am"}', 'food', 'demo:cafe:1', 'demo:logo:be185d:Cafe Colaba Nights', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/cafecolabanights-colaba-mumbai-204164","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/mumbai/cafecolabanights-colaba","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/cafecolabanights/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/cafecolabanights.mum","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/cafecolabanights.mum","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876560590","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/cafecolabanights","label":"Website"},{"kind":"email","url":"mailto:hello@cafecolabanights.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@cafecolabanights.mum","label":"YouTube"},{"kind":"phone","url":"tel:+919876560590","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=18.9067,72.8147","label":"Directions"}]', 'live', 277, 359, 188, false, 'pro', 'active', 'month', 25, 0.75, 0),
  ('Bandra Bistro', 'Restaurant', 'Bandra West', 'Mumbai', 'A neighbourhood bistro with wood-fired pizzas, pastas and a short cocktail list. Reservations on weekends.', 3, 19.0596, 72.8295, '{"Mon–Thu":"12 pm–12 am","Fri–Sun":"12 pm–1 am"}', 'food', 'demo:bistro:0', 'demo:logo:0369a1:Bandra Bistro', '[{"kind":"zomato","url":"https://www.zomato.com/mumbai/bandrabistro-bandra-west","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/bandrabistro/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/bandrabistro.mum","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/bandrabistro.mum","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876521881","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/bandrabistro","label":"Website"},{"kind":"email","url":"mailto:hello@bandrabistro.example","label":"Email us"},{"kind":"phone","url":"tel:+919876521881","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=19.0596,72.8295","label":"Directions"}]', 'live', 142, 374, 189, false, 'standard', 'active', 'month', 25, 0.7, 0),
  ('Filter Kaapi Junction', 'Cafe', 'Indiranagar', 'Bengaluru', 'Bengaluru-style filter coffee, benne dosa and idli vada, standing room only before 9 am.', 1, 12.9784, 77.6408, '{"Mon–Sun":"6:30 am–10 pm"}', 'food', 'demo:coffee:1', 'demo:logo:c026d3:Filter Kaapi Junction', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/filterkaapijunction-indiranagar-bengaluru-419403","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/bengaluru/filterkaapijunction-indiranagar","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/filterkaapijunction/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/filterkaapijunction.ben","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/filterkaapijunction.ben","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876572223","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/filterkaapijunction","label":"Website"},{"kind":"email","url":"mailto:hello@filterkaapijunction.example","label":"Email us"},{"kind":"phone","url":"tel:+919876572223","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=12.9784,77.6408","label":"Directions"}]', 'live', 134, 360, 190, false, 'standard', 'active', 'year', 25, 0.75, 0),
  ('Koramangala Barber Co.', 'Barber shop', 'Koramangala', 'Bengaluru', 'Sharp cuts, beard grooming and a quiet chair in the middle of a busy block. Book on WhatsApp.', 2, 12.9352, 77.6245, '{"Mon–Sat":"10 am–9 pm","Sun":"10 am–6 pm"}', 'beauty', 'demo:barber:2', 'demo:logo:be185d:Koramangala Barber Co.', '[{"kind":"justdial","url":"https://www.justdial.com/Bengaluru/Koramangala-Barber-Co-Koramangala/611064","label":"Justdial"},{"kind":"other","url":"https://example.com/koramangalabarberco/book","label":"Book an appointment"},{"kind":"instagram","url":"https://instagram.com/koramangalabarberco.ben","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/koramangalabarberco.ben","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876592712","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/koramangalabarberco","label":"Website"},{"kind":"email","url":"mailto:hello@koramangalabarberco.example","label":"Email us"},{"kind":"phone","url":"tel:+919876592712","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=12.9352,77.6245","label":"Directions"}]', 'live', 249, 312, 191, false, 'starter', 'active', 'year', 25, 0.6, 0),
  ('Chandni Chowk Chaat House', 'Street food', 'Chandni Chowk', 'Delhi', 'Four generations of aloo tikki, papdi chaat and daulat ki chaat from the same lane in Old Delhi.', 1, 28.6562, 77.23, '{"Mon–Sat":"10 am–10 pm","Sun":"Closed"}', 'food', 'demo:chaat:2', 'demo:logo:c026d3:Chandni Chowk Chaat House', '[{"kind":"zomato","url":"https://www.zomato.com/delhi/chandnichowkchaathouse-chandni-chowk","label":"Order on Zomato"},{"kind":"other","url":"https://example.com/chandnichowkchaathouse/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/chandnichowkchaathouse.del","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/chandnichowkchaathouse.del","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876551603","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/chandnichowkchaathouse","label":"Website"},{"kind":"email","url":"mailto:hello@chandnichowkchaathouse.example","label":"Email us"},{"kind":"phone","url":"tel:+919876551603","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=28.6562,77.23","label":"Directions"}]', 'live', 351, 233, 192, false, 'starter', 'active', 'year', 25, 0.7, 0),
  ('Charminar Biryani Point', 'Restaurant', 'Charminar', 'Hyderabad', 'Hyderabadi dum biryani, haleem in season and irani chai, a short walk from the Charminar.', 2, 17.3616, 78.4747, '{"Mon–Sun":"11 am–11:30 pm"}', 'food', 'demo:biryani:3', 'demo:logo:0f766e:Charminar Biryani Point', '[{"kind":"swiggy","url":"https://www.swiggy.com/restaurants/charminarbiryanipoint-charminar-hyderabad-497734","label":"Order on Swiggy"},{"kind":"zomato","url":"https://www.zomato.com/hyderabad/charminarbiryanipoint-charminar","label":"Order on Zomato"},{"kind":"magicpin","url":"https://magicpin.in/Hyderabad/Charminar/Restaurant/Charminar-Biryani-Point/store/79846/","label":"magicpin offers"},{"kind":"other","url":"https://example.com/charminarbiryanipoint/menu.pdf","label":"Full menu (PDF)"},{"kind":"instagram","url":"https://instagram.com/charminarbiryanipoint.hyd","label":"Instagram"},{"kind":"facebook","url":"https://facebook.com/charminarbiryanipoint.hyd","label":"Facebook"},{"kind":"whatsapp","url":"https://wa.me/919876507437","label":"WhatsApp us"},{"kind":"website","url":"https://example.com/charminarbiryanipoint","label":"Website"},{"kind":"email","url":"mailto:hello@charminarbiryanipoint.example","label":"Email us"},{"kind":"youtube","url":"https://youtube.com/@charminarbiryanipoint.hyd","label":"YouTube"},{"kind":"phone","url":"tel:+919876507437","label":"Call us"},{"kind":"maps","url":"https://www.google.com/maps/search/?api=1&query=17.3616,78.4747","label":"Directions"}]', 'live', 191, 189, 193, false, 'pro', 'active', 'month', 25, 0.75, 0);

update public.places p set
  category = s.category, area = s.area, city = s.city, about = '[Demo] ' || s.about, price_level = s.price,
  location = st_setsrid(st_makepoint(s.lng, s.lat), 4326)::geography, hours = s.hours::jsonb, kind = s.kind,
  cover_path = coalesce(nullif(p.cover_path, ''), s.cover), logo_path = coalesce(nullif(p.logo_path, ''), s.logo),
  links = s.links::jsonb, status = s.status::public.place_status, listed_until = current_date + s.listed_days,
  owner_id = coalesce(p.owner_id, case when s.owner_ord is not null then ('de000000-0000-4000-8000-' || lpad(s.owner_ord::text, 12, '0'))::uuid end),
  created_by = coalesce(p.created_by, case when s.owner_ord is not null then ('de000000-0000-4000-8000-' || lpad(s.owner_ord::text, 12, '0'))::uuid end)
from tp_shops s where p.name = s.name and p.about like '[Demo]%';

insert into public.places (name, category, area, city, about, price_level, location, hours, kind, cover_path, logo_path, links, status, listed_until, owner_id, created_by, created_at)
select s.name, s.category, s.area, s.city, '[Demo] ' || s.about, s.price, st_setsrid(st_makepoint(s.lng, s.lat), 4326)::geography, s.hours::jsonb, s.kind,
       s.cover, s.logo, s.links::jsonb, s.status::public.place_status, current_date + s.listed_days,
       case when s.owner_ord is not null then ('de000000-0000-4000-8000-' || lpad(s.owner_ord::text, 12, '0'))::uuid end,
       case when s.owner_ord is not null then ('de000000-0000-4000-8000-' || lpad(s.owner_ord::text, 12, '0'))::uuid end,
       now() - make_interval(days => s.age)
from tp_shops s
where not exists (select 1 from public.places p where p.name = s.name and p.about like '[Demo]%');

-- The admin account owns three demo shops, so Manage, Insights and Plan have real data.
do $demo$
declare me uuid;
begin
  select id into me from public.profiles where role = 'admin' and id::text not like 'de000000-%' order by created_at limit 1;
  if me is not null then
    update public.places p set owner_id = me, created_by = coalesce(p.created_by, me)
    from tp_shops s where p.name = s.name and p.about like '[Demo]%' and s.admin_owned and (p.owner_id is null or p.owner_id::text like 'de000000-%');
    insert into public.ai_usage (user_id, day, calls)
    select me, current_date - g, 2 + g % 5 from generate_series(0, 6) g on conflict do nothing;
  end if;
end
$demo$;

-- =====================================================================================
-- Menu: every dish and service with price, description, section and a picture.
-- =====================================================================================
drop table if exists tp_items;
create temp table tp_items (shop text, name text, section text, price int, descr text, ord int, topic text, pic text);
insert into tp_items values
  ('Forno Napoli', 'Margherita', 'Pizzas', 450, 'San Marzano tomato, fior di latte, fresh basil', 1, 'Pizza', 'demo:pizza:5'),
  ('Forno Napoli', 'Diavola', 'Pizzas', 560, 'Spicy salami and chilli oil', 2, 'Pizza', 'demo:pizza:6'),
  ('Forno Napoli', 'Burrata Pizza', 'Pizzas', 690, 'Creamy burrata and rocket', 3, 'Pizza', 'demo:pizza:7'),
  ('Forno Napoli', 'Quattro Formaggi', 'Pizzas', 620, 'Mozzarella, gorgonzola, parmesan and fontina', 4, 'Pizza', 'demo:pizza:8'),
  ('Forno Napoli', 'Funghi e Tartufo', 'Pizzas', 650, 'Wild mushrooms and a drizzle of truffle oil', 5, 'Pizza', 'demo:pizza:9'),
  ('Forno Napoli', 'Calzone', 'Pizzas', 520, 'Folded pizza with ricotta and spinach', 6, 'Pizza', 'demo:pizza:10'),
  ('Forno Napoli', 'Garlic Focaccia', 'Starters', 240, 'Rosemary, sea salt and olive oil', 7, null, 'demo:bakery:5'),
  ('Forno Napoli', 'Caprese Salad', 'Starters', 380, 'Buffalo mozzarella, tomato and basil', 8, null, 'demo:salad:5'),
  ('Forno Napoli', 'Tiramisu', 'Desserts', 320, 'Espresso-soaked, mascarpone cream', 9, 'Dessert', 'demo:cake:5'),
  ('Forno Napoli', 'Affogato', 'Desserts', 260, 'Vanilla gelato drowned in hot espresso', 10, 'Dessert', 'demo:icecream:5'),
  ('Kaapi Corner', 'Filter Coffee', 'Hot drinks', 80, 'Brass-tumbler decoction coffee', 1, 'Filter coffee', 'demo:coffee:4'),
  ('Kaapi Corner', 'Masala Dosa', 'Tiffin', 140, 'Crisp dosa, potato masala, coconut chutney', 2, 'Dosa', 'demo:dosa:4'),
  ('Kaapi Corner', 'Ghee Podi Idli', 'Tiffin', 120, 'Soft idlis tossed in ghee and podi', 3, 'Dosa', 'demo:dosa:5'),
  ('Kaapi Corner', 'Rava Dosa', 'Tiffin', 150, 'Lacy semolina dosa with onion and cashew', 4, 'Dosa', 'demo:dosa:6'),
  ('Kaapi Corner', 'Mysore Masala Dosa', 'Tiffin', 170, 'Red chilli chutney spread inside', 5, 'Dosa', 'demo:dosa:7'),
  ('Kaapi Corner', 'Medu Vada', 'Tiffin', 90, 'Two crisp lentil doughnuts with sambar', 6, null, 'demo:dosa:8'),
  ('Kaapi Corner', 'Upma', 'Tiffin', 80, 'Soft semolina with mustard and curry leaves', 7, null, 'demo:dosa:9'),
  ('Kaapi Corner', 'Kesari Bath', 'Sweets', 70, 'Saffron semolina sweet finished with ghee', 8, null, 'demo:sweets:4'),
  ('Kaapi Corner', 'Badam Milk', 'Hot drinks', 90, 'Warm milk with almonds and saffron', 9, null, 'demo:tea:4'),
  ('Hyderabad Biryani House', 'Chicken Dum Biryani', 'Biryani', 320, 'Sealed handi, saffron rice, raita', 1, 'Biryani', 'demo:biryani:5'),
  ('Hyderabad Biryani House', 'Mutton Biryani', 'Biryani', 420, 'Slow-cooked mutton, long grain rice', 2, 'Biryani', 'demo:biryani:6'),
  ('Hyderabad Biryani House', 'Veg Dum Biryani', 'Biryani', 260, 'Seasonal vegetables and saffron rice', 3, 'Biryani', 'demo:biryani:7'),
  ('Hyderabad Biryani House', 'Egg Biryani', 'Biryani', 240, 'Masala-fried eggs layered with dum rice', 4, 'Biryani', 'demo:biryani:8'),
  ('Hyderabad Biryani House', 'Chicken 65', 'Starters', 280, 'Crisp, spicy and tempered with curry leaves', 5, null, 'demo:tandoor:5'),
  ('Hyderabad Biryani House', 'Mirchi Ka Salan', 'Sides', 120, 'Peanut and sesame chilli curry', 6, null, 'demo:curry:5'),
  ('Hyderabad Biryani House', 'Haleem', 'Specials', 340, 'Slow-cooked wheat and mutton, thick and rich', 7, null, 'demo:curry:6'),
  ('Hyderabad Biryani House', 'Irani Chai', 'Drinks', 50, 'Sweet, milky and strong', 8, null, 'demo:tea:5'),
  ('Hyderabad Biryani House', 'Double Ka Meetha', 'Desserts', 140, 'Warm bread pudding with rabri', 9, 'Dessert', 'demo:cake:6'),
  ('Hyderabad Biryani House', 'Qubani Ka Meetha', 'Desserts', 180, 'Stewed apricots with fresh cream', 10, 'Dessert', 'demo:cake:7'),
  ('Masala Library', 'Butter Chicken', 'Mains', 520, 'Charred chicken in tomato butter gravy', 1, null, 'demo:curry:7'),
  ('Masala Library', 'Paneer Tikka', 'Starters', 380, 'Clay oven paneer with mint chutney', 2, null, 'demo:tandoor:6'),
  ('Masala Library', 'Garlic Naan', 'Breads', 90, 'Blistered naan with garlic butter', 3, null, 'demo:bread:1'),
  ('Masala Library', 'Dal Makhani', 'Mains', 340, 'Overnight black dal finished with cream', 4, null, 'demo:curry:8'),
  ('Masala Library', 'Gulab Jamun', 'Desserts', 160, 'Warm, with cardamom syrup', 5, 'Dessert', 'demo:sweets:5'),
  ('Masala Library', 'Lamb Seekh Kebab', 'Starters', 460, 'Hand-minced lamb on the coal grill', 6, null, 'demo:tandoor:7'),
  ('Masala Library', 'Amritsari Fish', 'Starters', 440, 'Ajwain-spiced batter, crisp and light', 7, null, 'demo:fish:1'),
  ('Masala Library', 'Laccha Paratha', 'Breads', 80, 'Flaky and layered', 8, null, 'demo:bread:2'),
  ('Masala Library', 'Kulfi Falooda', 'Desserts', 240, 'Pistachio kulfi, rose syrup, vermicelli', 9, 'Dessert', 'demo:icecream:6'),
  ('Masala Library', 'Masala Chaas', 'Drinks', 90, 'Spiced buttermilk, served cold', 10, null, 'demo:tea:6'),
  ('Brew Society', 'Flat White', 'Coffee', 220, 'Double ristretto, silky milk', 1, 'Coffee', 'demo:coffee:5'),
  ('Brew Society', 'Cold Brew', 'Coffee', 240, '18-hour steeped, over ice', 2, 'Coffee', 'demo:coffee:6'),
  ('Brew Society', 'Avocado Toast', 'Brunch', 360, 'Sourdough, smashed avocado, poached egg', 3, null, 'demo:breakfast:3'),
  ('Brew Society', 'Blueberry Muffin', 'Bakery', 150, 'Baked every morning', 4, 'Bakery', 'demo:bakery:6'),
  ('Brew Society', 'Cappuccino', 'Coffee', 200, 'Equal parts espresso, milk and foam', 5, 'Coffee', 'demo:coffee:7'),
  ('Brew Society', 'Pour Over', 'Coffee', 280, 'Single estate, brewed to order', 6, 'Coffee', 'demo:coffee:8'),
  ('Brew Society', 'Eggs Benedict', 'Brunch', 420, 'Poached eggs, hollandaise, toasted muffin', 7, null, 'demo:breakfast:4'),
  ('Brew Society', 'Banana Pancakes', 'Brunch', 340, 'Maple syrup and toasted walnuts', 8, null, 'demo:pancakes:3'),
  ('Brew Society', 'Iced Matcha Latte', 'Cold', 260, 'Ceremonial matcha, oat milk', 9, null, 'demo:tea:7'),
  ('Brew Society', 'Almond Croissant', 'Bakery', 190, 'Twice-baked with frangipane', 10, 'Bakery', 'demo:bakery:7'),
  ('Tandoor Tales', 'Chicken Tikka', 'Tandoor', 340, 'Yoghurt-marinated, clay oven', 1, null, 'demo:tandoor:8'),
  ('Tandoor Tales', 'Seekh Kebab Roll', 'Rolls', 220, 'Lamb seekh, onions, mint chutney', 2, null, 'demo:tacos:1'),
  ('Tandoor Tales', 'Tandoori Roti', 'Breads', 30, 'Fresh from the tandoor', 3, null, 'demo:bread:3'),
  ('Tandoor Tales', 'Chicken Handi', 'Mains', 390, 'Slow-cooked, thick gravy', 4, null, 'demo:curry:9'),
  ('Tandoor Tales', 'Afghani Chicken', 'Tandoor', 360, 'Creamy, mild and charred at the edges', 5, null, 'demo:tandoor:9'),
  ('Tandoor Tales', 'Paneer Butter Masala', 'Mains', 320, 'Silky tomato gravy with soft paneer', 6, null, 'demo:curry:10'),
  ('Tandoor Tales', 'Butter Naan', 'Breads', 60, 'Soft, buttery and blistered', 7, null, 'demo:bread:4'),
  ('Tandoor Tales', 'Jeera Rice', 'Sides', 140, 'Basmati with cumin and ghee', 8, null, 'demo:biryani:9'),
  ('Tandoor Tales', 'Phirni', 'Desserts', 110, 'Ground rice pudding set in clay bowls', 9, 'Dessert', 'demo:sweets:6'),
  ('Pasta Fresca', 'Penne Arrabbiata', 'Pasta', 420, 'Spicy tomato, garlic, parsley', 1, 'Pasta', 'demo:pasta:5'),
  ('Pasta Fresca', 'Truffle Mushroom Risotto', 'Pasta', 560, 'Arborio rice, wild mushrooms, truffle oil', 2, 'Pasta', 'demo:pasta:6'),
  ('Pasta Fresca', 'Garlic Bread', 'Starters', 220, 'Toasted ciabatta, garlic butter', 3, 'Bakery', 'demo:bakery:8'),
  ('Pasta Fresca', 'Panna Cotta', 'Desserts', 260, 'Vanilla bean, berry compote', 4, 'Dessert', 'demo:cake:8'),
  ('Pasta Fresca', 'Tagliatelle al Ragù', 'Pasta', 590, 'Slow-cooked beef and pork ragù', 5, 'Pasta', 'demo:pasta:7'),
  ('Pasta Fresca', 'Spinach Ricotta Ravioli', 'Pasta', 540, 'Brown butter and sage', 6, 'Pasta', 'demo:pasta:8'),
  ('Pasta Fresca', 'Gnocchi Pomodoro', 'Pasta', 480, 'Potato gnocchi, tomato and basil', 7, 'Pasta', 'demo:pasta:9'),
  ('Pasta Fresca', 'Bruschetta', 'Starters', 280, 'Tomato, garlic and basil on grilled bread', 8, null, 'demo:bistro:5'),
  ('Pasta Fresca', 'Minestrone', 'Starters', 260, 'Vegetable soup with white beans', 9, null, 'demo:bistro:6'),
  ('Burger Barn', 'Classic Smash Burger', 'Burgers', 280, 'Double patty, American cheese, pickles', 1, 'Burger', 'demo:burger:4'),
  ('Burger Barn', 'Peri Peri Fries', 'Sides', 160, 'Crispy fries, peri peri seasoning', 2, null, 'demo:fries:4'),
  ('Burger Barn', 'Chicken Crunch Burger', 'Burgers', 310, 'Buttermilk fried chicken, slaw', 3, 'Burger', 'demo:burger:5'),
  ('Burger Barn', 'Oreo Shake', 'Shakes', 210, 'Thick shake with cookie crumble', 4, 'Dessert', 'demo:icecream:7'),
  ('Burger Barn', 'Bacon Cheeseburger', 'Burgers', 340, 'Smoked bacon, cheddar, burger sauce', 5, 'Burger', 'demo:burger:6'),
  ('Burger Barn', 'Paneer Tikka Burger', 'Burgers', 260, 'Spiced paneer patty, mint mayo', 6, 'Burger', 'demo:burger:7'),
  ('Burger Barn', 'Loaded Nachos', 'Sides', 280, 'Cheese sauce, jalapeño, salsa', 7, null, 'demo:tacos:2'),
  ('Burger Barn', 'Onion Rings', 'Sides', 170, 'Beer-battered and golden', 8, null, 'demo:fries:5'),
  ('Burger Barn', 'Chocolate Shake', 'Shakes', 200, 'Belgian chocolate, whipped cream', 9, 'Dessert', 'demo:icecream:8'),
  ('Madras Tiffin Room', 'Idli Sambar', 'Tiffin', 90, 'Four idlis, sambar, three chutneys', 1, 'Dosa', 'demo:dosa:10'),
  ('Madras Tiffin Room', 'Ghee Pongal', 'Tiffin', 110, 'Peppery rice and dal, ghee', 2, null, 'demo:dosa:11'),
  ('Madras Tiffin Room', 'Medu Vada', 'Tiffin', 80, 'Crisp outside, fluffy inside', 3, 'Dosa', 'demo:dosa:12'),
  ('Madras Tiffin Room', 'Filter Kaapi', 'Hot drinks', 60, 'Strong decoction, frothy milk', 4, 'Filter coffee', 'demo:coffee:9'),
  ('Madras Tiffin Room', 'Plain Dosa', 'Tiffin', 80, 'Thin, crisp and golden', 5, 'Dosa', 'demo:dosa:13'),
  ('Madras Tiffin Room', 'Onion Uttapam', 'Tiffin', 120, 'Thick, soft and topped with onions', 6, 'Dosa', 'demo:dosa:14'),
  ('Madras Tiffin Room', 'Meals', 'Meals', 180, 'Rice, sambar, rasam, two curries, curd, payasam', 7, null, 'demo:curry:11'),
  ('Madras Tiffin Room', 'Lemon Rice', 'Rice', 100, 'Tempered with peanuts and curry leaves', 8, null, 'demo:biryani:10'),
  ('Madras Tiffin Room', 'Payasam', 'Sweets', 70, 'Vermicelli and milk with cardamom', 9, null, 'demo:sweets:7'),
  ('Chaat Street', 'Pani Puri', 'Chaat', 70, 'Six puris with spiced water', 1, null, 'demo:chaat:5'),
  ('Chaat Street', 'Sev Puri', 'Chaat', 80, 'Crisp puris, chutneys, sev', 2, null, 'demo:chaat:6'),
  ('Chaat Street', 'Dahi Papdi Chaat', 'Chaat', 100, 'Papdi, curd, tamarind, pomegranate', 3, null, 'demo:chaat:7'),
  ('Chaat Street', 'Bhel Puri', 'Chaat', 70, 'Puffed rice, sev, tamarind and mint', 4, null, 'demo:chaat:8'),
  ('Chaat Street', 'Ragda Pattice', 'Chaat', 110, 'Potato patties in white pea curry', 5, null, 'demo:chaat:9'),
  ('Chaat Street', 'Samosa Chaat', 'Chaat', 100, 'Crushed samosa, chole, chutneys', 6, null, 'demo:chaat:10'),
  ('Chaat Street', 'Masala Soda', 'Drinks', 50, 'Lemon, black salt, cumin', 7, null, 'demo:juice:5'),
  ('Chaat Street', 'Kulfi Stick', 'Sweets', 60, 'Malai kulfi on a stick', 8, 'Dessert', 'demo:icecream:9'),
  ('Sweet Tooth Creamery', 'Salted Caramel Gelato', 'Gelato', 180, 'House-made, two scoops', 1, 'Dessert', 'demo:icecream:10'),
  ('Sweet Tooth Creamery', 'Warm Brownie Sundae', 'Sundaes', 280, 'Brownie, vanilla gelato, fudge', 2, 'Dessert', 'demo:cake:9'),
  ('Sweet Tooth Creamery', 'Mango Sorbet', 'Gelato', 160, 'Alphonso mango, dairy free', 3, 'Dessert', 'demo:icecream:11'),
  ('Sweet Tooth Creamery', 'Pistachio Gelato', 'Gelato', 200, 'Sicilian pistachio, lightly salted', 4, 'Dessert', 'demo:icecream:12'),
  ('Sweet Tooth Creamery', 'Belgian Waffle', 'Waffles', 260, 'Warm waffle, berries and cream', 5, 'Dessert', 'demo:pancakes:4'),
  ('Sweet Tooth Creamery', 'Banana Split', 'Sundaes', 300, 'Three gelatos, banana, chocolate sauce', 6, 'Dessert', 'demo:icecream:13'),
  ('Sweet Tooth Creamery', 'Cookie Dough Shake', 'Shakes', 240, 'Thick shake with cookie dough', 7, 'Dessert', 'demo:icecream:14'),
  ('Sweet Tooth Creamery', 'Red Velvet Slice', 'Cakes', 220, 'Cream cheese frosting', 8, 'Dessert', 'demo:cake:10'),
  ('Bombay Bites', 'Vada Pav', 'Snacks', 40, 'Spicy potato fritter in a soft pav', 1, null, 'demo:chaat:11'),
  ('Bombay Bites', 'Pav Bhaji', 'Mains', 160, 'Buttery bhaji with toasted pav', 2, null, 'demo:curry:12'),
  ('Bombay Bites', 'Masala Chai', 'Drinks', 30, 'Strong, ginger and cardamom', 3, null, 'demo:tea:8'),
  ('Bombay Bites', 'Misal Pav', 'Mains', 140, 'Sprouted moth curry, farsan, pav', 4, null, 'demo:curry:13'),
  ('Bombay Bites', 'Frankie Roll', 'Snacks', 120, 'Spiced potato and egg in a flaky roll', 5, null, 'demo:tacos:3'),
  ('Bombay Bites', 'Bun Maska', 'Snacks', 50, 'Soft bun with a thick slab of butter', 6, null, 'demo:bread:5'),
  ('Bombay Bites', 'Cutting Chai', 'Drinks', 20, 'Half a glass of strong sweet tea', 7, null, 'demo:tea:9'),
  ('Bombay Bites', 'Sabudana Khichdi', 'Mains', 110, 'Peanuts, potato and green chilli', 8, null, 'demo:bowl:3'),
  ('Green Bowl', 'Quinoa Power Bowl', 'Bowls', 380, 'Quinoa, roasted veg, tahini', 1, null, 'demo:bowl:4'),
  ('Green Bowl', 'Greek Salad', 'Salads', 320, 'Feta, olives, cucumber', 2, null, 'demo:salad:6'),
  ('Green Bowl', 'Cold-pressed Green Juice', 'Juices', 180, 'Spinach, apple, cucumber', 3, null, 'demo:juice:6'),
  ('Green Bowl', 'Avocado Hummus Wrap', 'Wraps', 290, 'Whole wheat wrap, hummus, avocado', 4, null, 'demo:sandwich:1'),
  ('Green Bowl', 'Poke Bowl', 'Bowls', 420, 'Brown rice, edamame, mango, sesame', 5, null, 'demo:bowl:5'),
  ('Green Bowl', 'Caesar Salad', 'Salads', 340, 'Romaine, parmesan, sourdough croutons', 6, null, 'demo:salad:7'),
  ('Green Bowl', 'Acai Smoothie Bowl', 'Bowls', 360, 'Acai, banana, granola and berries', 7, null, 'demo:bowl:6'),
  ('Green Bowl', 'Beetroot Cooler', 'Juices', 170, 'Beetroot, ginger, lemon', 8, null, 'demo:juice:7'),
  ('The Book Nook Cafe', 'Cappuccino', 'Coffee', 170, 'Double shot, velvety foam', 1, 'Coffee', 'demo:coffee:10'),
  ('The Book Nook Cafe', 'Lemon Drizzle Cake', 'Cakes', 190, 'Fresh lemon, light crumb', 2, 'Dessert', 'demo:cake:11'),
  ('The Book Nook Cafe', 'Cheese Toastie', 'Bites', 210, 'Three cheeses, sourdough', 3, null, 'demo:sandwich:2'),
  ('The Book Nook Cafe', 'Masala Chai', 'Tea', 90, 'Brewed with whole spices', 4, null, 'demo:tea:10'),
  ('The Book Nook Cafe', 'Banana Walnut Cake', 'Cakes', 180, 'Moist, with toasted walnuts', 5, 'Dessert', 'demo:cake:12'),
  ('The Book Nook Cafe', 'Hot Chocolate', 'Hot drinks', 190, 'Dark chocolate, whipped cream', 6, null, 'demo:coffee:11'),
  ('The Book Nook Cafe', 'Veg Club Sandwich', 'Bites', 230, 'Triple-decker with fries', 7, null, 'demo:sandwich:3'),
  ('The Book Nook Cafe', 'Brownie', 'Cakes', 150, 'Fudgy, with a salted top', 8, 'Dessert', 'demo:cake:13'),
  ('Spice Route', 'Hakka Noodles', 'Noodles', 260, 'Wok-tossed, crisp veg', 1, null, 'demo:noodles:3'),
  ('Spice Route', 'Chilli Chicken', 'Starters', 320, 'Dry or gravy', 2, null, 'demo:tandoor:10'),
  ('Spice Route', 'Thai Green Curry', 'Mains', 380, 'Coconut, basil, jasmine rice', 3, null, 'demo:curry:14'),
  ('Spice Route', 'Crispy Spring Rolls', 'Starters', 180, 'Veg, sweet chilli dip', 4, null, 'demo:momos:3'),
  ('Spice Route', 'Veg Manchurian', 'Starters', 240, 'Crisp dumplings in a garlic soy sauce', 5, null, 'demo:momos:4'),
  ('Spice Route', 'Schezwan Fried Rice', 'Rice', 270, 'Wok-fired with schezwan sauce', 6, null, 'demo:noodles:4'),
  ('Spice Route', 'Pad Thai', 'Noodles', 340, 'Rice noodles, tamarind, peanuts, lime', 7, null, 'demo:noodles:5'),
  ('Spice Route', 'Steamed Momos', 'Starters', 200, 'Eight pieces with fiery red chutney', 8, null, 'demo:momos:5'),
  ('Spice Route', 'Tom Yum Soup', 'Soups', 220, 'Hot and sour with lemongrass', 9, null, 'demo:bistro:7'),
  ('Smoke House BBQ', 'Smoked Pork Ribs', 'Smoked', 640, '12-hour smoke, sticky glaze', 1, null, 'demo:grill:5'),
  ('Smoke House BBQ', 'BBQ Chicken Wings', 'Smoked', 360, 'Hickory glaze', 2, null, 'demo:grill:6'),
  ('Smoke House BBQ', 'Brisket Burger', 'Burgers', 450, 'Smoked brisket, pickled onions', 3, 'Burger', 'demo:burger:8'),
  ('Smoke House BBQ', 'Mac and Cheese', 'Sides', 280, 'Baked, crunchy top', 4, null, 'demo:pasta:10'),
  ('Smoke House BBQ', 'Pulled Pork Sandwich', 'Burgers', 380, 'Slow-cooked pork, slaw, brioche', 5, null, 'demo:sandwich:4'),
  ('Smoke House BBQ', 'Corn on the Cob', 'Sides', 160, 'Charred, with chilli butter', 6, null, 'demo:salad:8'),
  ('Smoke House BBQ', 'Coleslaw', 'Sides', 120, 'Crunchy and tangy', 7, null, 'demo:salad:9'),
  ('Smoke House BBQ', 'Peach Cobbler', 'Desserts', 260, 'Warm, with vanilla ice cream', 8, 'Dessert', 'demo:cake:14'),
  ('Smoke House BBQ', 'Smoked Sausage Platter', 'Smoked', 520, 'Three sausages, mustard and pickles', 9, null, 'demo:grill:7'),
  ('Sugar Loaf Bakery', 'Butter Croissant', 'Bakery', 160, 'Laminated all-butter croissant', 1, 'Bakery', 'demo:bakery:9'),
  ('Sugar Loaf Bakery', 'Sourdough Loaf', 'Bread', 260, '48-hour fermented sourdough', 2, 'Bakery', 'demo:bread:6'),
  ('Sugar Loaf Bakery', 'Coffee', 'Drinks', 120, 'Fresh filter or espresso', 3, 'Coffee', 'demo:coffee:12'),
  ('Sugar Loaf Bakery', 'Chocolate Cake', 'Cakes', 480, 'Dark chocolate ganache layers', 4, 'Dessert', 'demo:cake:15'),
  ('Sugar Loaf Bakery', 'Cinnamon Roll', 'Bakery', 140, 'Soft, sticky and iced', 5, 'Bakery', 'demo:bakery:10'),
  ('Sugar Loaf Bakery', 'Baguette', 'Bread', 120, 'Crisp crust, open crumb', 6, 'Bakery', 'demo:bread:7'),
  ('Sugar Loaf Bakery', 'Lemon Tart', 'Cakes', 190, 'Sharp lemon curd, buttery base', 7, 'Dessert', 'demo:cake:16'),
  ('Sugar Loaf Bakery', 'Almond Danish', 'Bakery', 170, 'Frangipane and flaked almonds', 8, 'Bakery', 'demo:bakery:11'),
  ('Fade Studio', 'Skin Fade', 'Haircuts', 400, 'Clean skin fade with finish', 1, 'Haircut', 'demo:barber:4'),
  ('Fade Studio', 'Beard Trim', 'Beard', 200, 'Shaping, line-up and hot towel', 2, 'Haircut', 'demo:barber:5'),
  ('Fade Studio', 'Head Massage', 'Spa', 250, '15 minutes, oil or dry', 3, 'Spa', 'demo:barber:6'),
  ('Fade Studio', 'Classic Cut', 'Haircuts', 300, 'Scissor cut and style', 4, 'Haircut', 'demo:barber:7'),
  ('Fade Studio', 'Hair Colour', 'Colour', 900, 'Global colour with a wash', 5, 'Haircut', 'demo:salon:4'),
  ('Fade Studio', 'Kids Haircut', 'Haircuts', 220, 'For under 12s', 6, 'Haircut', 'demo:barber:8'),
  ('Iron Temple Gym', 'Monthly Membership', 'Memberships', 1800, 'Full floor access, all classes', 1, null, 'demo:gym:5'),
  ('Iron Temple Gym', 'Personal Training', 'Training', 6000, '12 sessions with a coach', 2, null, 'demo:gym:6'),
  ('Iron Temple Gym', 'Yoga Class', 'Classes', 400, 'Drop-in morning class', 3, null, 'demo:gym:7'),
  ('Iron Temple Gym', 'Quarterly Membership', 'Memberships', 4800, 'Three months, one freeze allowed', 4, null, 'demo:gym:8'),
  ('Iron Temple Gym', 'Zumba Class', 'Classes', 350, 'Evening dance fitness', 5, null, 'demo:gym:9'),
  ('Iron Temple Gym', 'Day Pass', 'Memberships', 300, 'One visit, no commitment', 6, null, 'demo:gym:10'),
  ('Glow Beauty Parlour', 'Hair Spa', 'Hair', 1200, 'Deep conditioning and massage', 1, 'Spa', 'demo:salon:5'),
  ('Glow Beauty Parlour', 'Gold Facial', 'Skin', 1500, 'Brightening 60-minute facial', 2, 'Spa', 'demo:salon:6'),
  ('Glow Beauty Parlour', 'Haircut', 'Hair', 500, 'Wash, cut and blow-dry', 3, 'Haircut', 'demo:salon:7'),
  ('Glow Beauty Parlour', 'Bridal Makeup', 'Makeup', 9000, 'Trial included, HD finish', 4, null, 'demo:beauty:2'),
  ('Glow Beauty Parlour', 'Threading', 'Skin', 60, 'Eyebrows or upper lip', 5, null, 'demo:beauty:3'),
  ('Glow Beauty Parlour', 'Full Arms Waxing', 'Skin', 400, 'Rica wax, gentle on skin', 6, null, 'demo:spa:2'),
  ('Glow Beauty Parlour', 'Manicure', 'Nails', 600, 'Clean, shape and polish', 7, 'Spa', 'demo:nails:2'),
  ('Urban Threads', 'Cotton Kurta', 'Ethnic', 1299, 'Breathable cotton, easy returns', 1, null, 'demo:fashion:4'),
  ('Urban Threads', 'Linen Shirt', 'Shirts', 1599, 'Relaxed fit, soft linen', 2, null, 'demo:fashion:5'),
  ('Urban Threads', 'Denim Jacket', 'Outerwear', 2499, 'Classic wash, lined', 3, null, 'demo:fashion:6'),
  ('Urban Threads', 'Chinos', 'Trousers', 1799, 'Slim fit, stretch cotton', 4, null, 'demo:fashion:7'),
  ('Urban Threads', 'Silk Dupatta', 'Ethnic', 899, 'Handwoven, six colours', 5, null, 'demo:fashion:8'),
  ('Urban Threads', 'Canvas Sneakers', 'Shoes', 1999, 'Cushioned sole', 6, null, 'demo:shoes:4'),
  ('Urban Threads', 'Leather Belt', 'Accessories', 699, 'Full-grain leather', 7, null, 'demo:bag:4'),
  ('CarePlus Clinic', 'General Consultation', 'Consultations', 500, '15-minute visit with the doctor', 1, null, 'demo:clinic:2'),
  ('CarePlus Clinic', 'Health Check', 'Packages', 1800, 'Blood work and consultation', 2, null, 'demo:clinic:3'),
  ('CarePlus Clinic', 'Child Vaccination', 'Consultations', 600, 'Per dose, paediatrician on call', 3, null, 'demo:clinic:4'),
  ('CarePlus Clinic', 'Diabetes Screening', 'Packages', 900, 'Sugar tests and diet advice', 4, null, 'demo:clinic:5'),
  ('CarePlus Clinic', 'Follow-up Visit', 'Consultations', 250, 'Within 7 days of a consultation', 5, null, 'demo:clinic:6'),
  ('Studio Zen Yoga', 'Drop-in Class', 'Classes', 500, '60-minute group class', 1, null, 'demo:yoga:4'),
  ('Studio Zen Yoga', 'Monthly Pass', 'Passes', 3000, 'Unlimited classes', 2, null, 'demo:yoga:5'),
  ('Studio Zen Yoga', 'Private Session', 'Classes', 1500, 'One-to-one, tailored', 3, null, 'demo:yoga:6'),
  ('Studio Zen Yoga', 'Breathwork Evening', 'Workshops', 700, '90 minutes, Thursdays', 4, null, 'demo:yoga:7'),
  ('Studio Zen Yoga', 'Weekend Retreat', 'Workshops', 6500, 'Two days outside the city', 5, null, 'demo:yoga:8'),
  ('FitHub CrossFit', 'Monthly Membership', 'Memberships', 3500, 'Unlimited classes and open gym', 1, null, 'demo:crossfit:1'),
  ('FitHub CrossFit', 'Intro Course', 'Courses', 2000, 'Four beginner sessions', 2, null, 'demo:crossfit:2'),
  ('FitHub CrossFit', 'Personal Training', 'Training', 900, 'Per session', 3, null, 'demo:crossfit:3'),
  ('FitHub CrossFit', 'Open Gym Pass', 'Memberships', 500, 'Day access, no class', 4, null, 'demo:crossfit:4'),
  ('FitHub CrossFit', 'Nutrition Plan', 'Training', 1500, 'Four-week meal plan with check-ins', 5, null, 'demo:crossfit:5'),
  ('Blade & Co Barbers', 'Classic Haircut', 'Haircuts', 350, 'Scissor cut and style', 1, 'Haircut', 'demo:barber:9'),
  ('Blade & Co Barbers', 'Hot Towel Shave', 'Shaves', 300, 'Straight razor, essential oils', 2, null, 'demo:barber:10'),
  ('Blade & Co Barbers', 'Beard Sculpt', 'Beard', 250, 'Shape, trim and line-up', 3, 'Haircut', 'demo:barber:11'),
  ('Blade & Co Barbers', 'Cut and Shave Combo', 'Haircuts', 600, 'The full treatment', 4, 'Haircut', 'demo:barber:12'),
  ('Blade & Co Barbers', 'Head Massage', 'Spa', 200, '10 minutes with warm oil', 5, 'Spa', 'demo:barber:13'),
  ('Nail Bar', 'Gel Manicure', 'Hands', 900, 'Long-wear gel, 45 minutes', 1, null, 'demo:nails:3'),
  ('Nail Bar', 'Spa Pedicure', 'Feet', 1100, 'Soak, scrub, massage, polish', 2, 'Spa', 'demo:nails:4'),
  ('Nail Bar', 'Nail Art', 'Hands', 600, 'Per set, custom designs', 3, null, 'demo:nails:5'),
  ('Nail Bar', 'Acrylic Extensions', 'Hands', 1800, 'Full set, any shape', 4, null, 'demo:nails:6'),
  ('Nail Bar', 'Nail Repair', 'Hands', 150, 'Per nail', 5, null, 'demo:nails:7'),
  ('BrightPath Coaching', 'Maths Batch', 'Batches', 2500, 'Per month, 3 classes a week', 1, null, 'demo:class:1'),
  ('BrightPath Coaching', 'Science Batch', 'Batches', 2500, 'Per month, 3 classes a week', 2, null, 'demo:class:2'),
  ('BrightPath Coaching', 'Doubt Clearing Session', 'Sessions', 300, 'One-hour one-to-one', 3, null, 'demo:class:3'),
  ('BrightPath Coaching', 'Board Exam Crash Course', 'Courses', 4000, 'Six weeks before the exams', 4, null, 'demo:class:4'),
  ('BrightPath Coaching', 'Mock Test Series', 'Courses', 1200, 'Ten timed papers with feedback', 5, null, 'demo:class:5'),
  ('Little Steps Preschool', 'Morning Batch', 'Programmes', 4500, 'Per month, 8 am to 12 pm', 1, null, 'demo:school:3'),
  ('Little Steps Preschool', 'Daycare', 'Programmes', 6500, 'Per month, until 5 pm', 2, null, 'demo:school:4'),
  ('Little Steps Preschool', 'Summer Camp', 'Camps', 5000, 'Four-week programme', 3, null, 'demo:school:5'),
  ('Little Steps Preschool', 'Admission Visit', 'Admissions', 0, 'Free campus tour, book a slot', 4, null, 'demo:school:6'),
  ('Little Steps Preschool', 'Saturday Art Club', 'Camps', 1200, 'Per month, ages 3 to 6', 5, null, 'demo:school:7'),
  ('FixIt Home Services', 'AC Service', 'Appliances', 699, 'Deep clean and gas check', 1, null, 'demo:repair:5'),
  ('FixIt Home Services', 'Plumbing Visit', 'Repairs', 349, 'Per visit, parts extra', 2, null, 'demo:repair:6'),
  ('FixIt Home Services', 'Electrician Visit', 'Repairs', 299, 'Per visit, parts extra', 3, null, 'demo:repair:7'),
  ('FixIt Home Services', 'Water Purifier Service', 'Appliances', 549, 'Filter check and clean', 4, null, 'demo:repair:8'),
  ('FixIt Home Services', 'Deep Home Cleaning', 'Cleaning', 3499, '2 BHK, team of four', 5, null, 'demo:repair:9'),
  ('Wheels Garage', 'Full Car Service', 'Servicing', 4500, 'Oil, filters, 40-point check', 1, null, 'demo:garage:3'),
  ('Wheels Garage', 'Wheel Alignment', 'Tyres', 800, 'Computerised', 2, null, 'demo:garage:4'),
  ('Wheels Garage', 'Car Wash and Detail', 'Cleaning', 1200, 'Interior and exterior', 3, null, 'demo:garage:5'),
  ('Wheels Garage', 'Brake Pad Replacement', 'Repairs', 2200, 'Per axle, parts included', 4, null, 'demo:garage:6'),
  ('Wheels Garage', 'AC Gas Refill', 'Repairs', 1800, 'Leak test included', 5, null, 'demo:garage:7'),
  ('SmileCare Dental', 'Teeth Cleaning', 'Care', 900, 'Scaling and polish', 1, null, 'demo:dental:2'),
  ('SmileCare Dental', 'Root Canal', 'Treatment', 6500, 'Single sitting where possible', 2, null, 'demo:dental:3'),
  ('SmileCare Dental', 'Teeth Whitening', 'Cosmetic', 8000, 'In-clinic, 60 minutes', 3, null, 'demo:dental:4'),
  ('SmileCare Dental', 'Dental Checkup', 'Care', 400, 'Exam with X-ray if needed', 4, null, 'demo:dental:5'),
  ('SmileCare Dental', 'Braces Consultation', 'Cosmetic', 500, 'Plan and cost, no obligation', 5, null, 'demo:dental:6'),
  ('PetPals Vet', 'Health Checkup', 'Care', 600, 'Full examination', 1, null, 'demo:vet:1'),
  ('PetPals Vet', 'Vaccination', 'Care', 900, 'Per vaccine', 2, null, 'demo:vet:2'),
  ('PetPals Vet', 'Grooming', 'Grooming', 1200, 'Bath, trim, nails', 3, null, 'demo:vet:3'),
  ('PetPals Vet', 'Dental Cleaning', 'Care', 2500, 'Under mild sedation', 4, null, 'demo:vet:4'),
  ('PetPals Vet', 'Home Visit', 'Care', 1000, 'Within 8 km', 5, null, 'demo:vet:5'),
  ('Paper Trail Books', 'Staff Pick Novel', 'Books', 499, 'Hand-picked every month', 1, null, 'demo:books:3'),
  ('Paper Trail Books', 'Stationery Set', 'Stationery', 350, 'Notebook and pens', 2, null, 'demo:books:4'),
  ('Paper Trail Books', 'Gift Voucher', 'Gifts', 1000, 'Redeemable in store', 3, null, 'demo:books:5'),
  ('Paper Trail Books', 'Children''s Picture Book', 'Books', 299, 'Illustrated, ages 3 to 7', 4, null, 'demo:books:6'),
  ('Paper Trail Books', 'Hardbound Journal', 'Stationery', 450, 'Dotted pages, ribbon marker', 5, null, 'demo:books:7'),
  ('Paper Trail Books', 'Book Club Membership', 'Gifts', 1500, 'Three picks a quarter', 6, null, 'demo:books:8'),
  ('Gadget Galaxy', 'Wireless Earbuds', 'Audio', 2499, '12-hour battery, one-year warranty', 1, null, 'demo:audio:2'),
  ('Gadget Galaxy', 'Phone Case', 'Accessories', 499, 'Shockproof', 2, null, 'demo:audio:3'),
  ('Gadget Galaxy', 'Power Bank 20000 mAh', 'Accessories', 1799, 'Fast charging', 3, null, 'demo:audio:4'),
  ('Gadget Galaxy', 'Bluetooth Speaker', 'Audio', 2999, 'Waterproof, 10 hours', 4, null, 'demo:audio:5'),
  ('Gadget Galaxy', 'Smartwatch', 'Wearables', 3999, 'Heart rate and sleep tracking', 5, null, 'demo:audio:6'),
  ('Gadget Galaxy', 'Fast Charger 65W', 'Accessories', 1299, 'USB-C, folding plug', 6, null, 'demo:audio:7'),
  ('Chai Tapri Co.', 'Kulhad Chai', 'Chai', 40, 'Clay-cup masala chai', 1, null, 'demo:tea:11'),
  ('Chai Tapri Co.', 'Bun Maska', 'Snacks', 60, 'Soft bun, thick butter', 2, null, 'demo:bread:8'),
  ('Chai Tapri Co.', 'Onion Bhajiya', 'Snacks', 80, 'Crisp gram-flour fritters', 3, null, 'demo:chaat:12'),
  ('Chai Tapri Co.', 'Elaichi Chai', 'Chai', 50, 'Cardamom-forward and strong', 4, null, 'demo:tea:12'),
  ('Old Wada Kitchen', 'Puran Poli Thali', 'Thali', 360, 'Puran poli, amti, bhaji, koshimbir', 1, null, 'demo:curry:15'),
  ('Old Wada Kitchen', 'Misal Pav', 'Mains', 160, 'Kolhapuri style, extra hot', 2, null, 'demo:curry:16'),
  ('Old Wada Kitchen', 'Modak', 'Sweets', 120, 'Steamed with fresh coconut', 3, null, 'demo:sweets:8'),
  ('Old Wada Kitchen', 'Solkadhi', 'Drinks', 70, 'Kokum and coconut cooler', 4, null, 'demo:juice:8'),
  ('Cafe Colaba Nights', 'Irani Chai', 'Chai', 80, 'Strong, sweet, served in a glass', 1, null, 'demo:tea:13'),
  ('Cafe Colaba Nights', 'Keema Pav', 'Mains', 290, 'Spiced mutton mince, buttered pav', 2, null, 'demo:curry:17'),
  ('Cafe Colaba Nights', 'Bun Maska', 'Snacks', 90, 'Soft bun, thick butter', 3, null, 'demo:bread:9'),
  ('Cafe Colaba Nights', 'Akuri on Toast', 'Breakfast', 240, 'Parsi scrambled eggs', 4, null, 'demo:breakfast:5'),
  ('Cafe Colaba Nights', 'Caramel Custard', 'Desserts', 190, 'Set the old way', 5, 'Dessert', 'demo:cake:17'),
  ('Bandra Bistro', 'Margherita Pizza', 'Pizzas', 540, 'Tomato, mozzarella, basil', 1, 'Pizza', 'demo:pizza:11'),
  ('Bandra Bistro', 'Truffle Fries', 'Sides', 320, 'Parmesan and truffle oil', 2, null, 'demo:fries:6'),
  ('Bandra Bistro', 'Penne Alfredo', 'Pasta', 480, 'Creamy white sauce', 3, 'Pasta', 'demo:pasta:11'),
  ('Bandra Bistro', 'Tiramisu', 'Desserts', 340, 'Mascarpone and coffee', 4, 'Dessert', 'demo:cake:18'),
  ('Bandra Bistro', 'Old Fashioned', 'Cocktails', 620, 'Bourbon, bitters, orange peel', 5, 'Cocktails', 'demo:cocktail:3'),
  ('Filter Kaapi Junction', 'Filter Coffee', 'Coffee', 45, 'Strong decoction, hot milk', 1, 'Filter coffee', 'demo:coffee:13'),
  ('Filter Kaapi Junction', 'Benne Dosa', 'Tiffin', 90, 'Butter-crisp, with chutney', 2, 'Dosa', 'demo:dosa:15'),
  ('Filter Kaapi Junction', 'Idli Vada', 'Tiffin', 70, 'Two idlis and one vada', 3, null, 'demo:dosa:16'),
  ('Filter Kaapi Junction', 'Khara Bath', 'Tiffin', 60, 'Spicy semolina upma', 4, null, 'demo:dosa:17'),
  ('Koramangala Barber Co.', 'Haircut', 'Haircuts', 400, 'Wash, cut and style', 1, 'Haircut', 'demo:barber:14'),
  ('Koramangala Barber Co.', 'Beard Trim', 'Beard', 200, 'Line-up and finish', 2, 'Haircut', 'demo:barber:15'),
  ('Koramangala Barber Co.', 'Facial', 'Skin', 600, 'Deep cleanse and mask', 3, 'Spa', 'demo:barber:16'),
  ('Koramangala Barber Co.', 'Hair Colour', 'Colour', 1100, 'Includes wash and style', 4, 'Haircut', 'demo:salon:8'),
  ('Chandni Chowk Chaat House', 'Aloo Tikki Chaat', 'Chaat', 90, 'Crisp tikki, chole, curd and chutneys', 1, null, 'demo:chaat:13'),
  ('Chandni Chowk Chaat House', 'Papdi Chaat', 'Chaat', 80, 'Crisp papdi, curd, tamarind', 2, null, 'demo:chaat:14'),
  ('Chandni Chowk Chaat House', 'Daulat Ki Chaat', 'Sweets', 120, 'Milk foam, winter special', 3, null, 'demo:sweets:9'),
  ('Chandni Chowk Chaat House', 'Lassi', 'Drinks', 70, 'Thick, sweet, in a kulhad', 4, null, 'demo:juice:9'),
  ('Charminar Biryani Point', 'Chicken Dum Biryani', 'Biryani', 260, 'Sealed handi, saffron rice', 1, 'Biryani', 'demo:biryani:11'),
  ('Charminar Biryani Point', 'Mutton Biryani', 'Biryani', 360, 'Slow-cooked, bone-in', 2, 'Biryani', 'demo:biryani:12'),
  ('Charminar Biryani Point', 'Haleem', 'Specials', 280, 'Wheat, mutton and ghee', 3, null, 'demo:curry:18'),
  ('Charminar Biryani Point', 'Irani Chai', 'Drinks', 40, 'Sweet and milky', 4, null, 'demo:tea:14'),
  ('Charminar Biryani Point', 'Double Ka Meetha', 'Desserts', 120, 'Warm bread pudding', 5, 'Dessert', 'demo:sweets:10');

insert into public.items (place_id, topic_id, name, price_inr, description, section, image_path, is_listed, is_hidden, sort_order)
select p.id, t.id, d.name, d.price, d.descr, d.section, d.pic, true, false, d.ord
from tp_items d
join public.places p on p.name = d.shop and p.about like '[Demo]%'
left join public.topics t on t.name = d.topic
on conflict (place_id, name_normalized) do update
  set price_inr = excluded.price_inr, description = excluded.description, section = excluded.section, is_listed = true, is_hidden = false,
      sort_order = excluded.sort_order, image_path = coalesce(nullif(public.items.image_path, ''), excluded.image_path),
      topic_id = coalesce(public.items.topic_id, excluded.topic_id);

-- Your own test shops get three placeholder items if they have none, so they can be reviewed too.
insert into public.items (place_id, name, description)
select p.id, n, '[Demo item]'
from public.places p
cross join lateral unnest(case p.kind
  when 'food' then array['House special', 'Chef''s pick', 'Seasonal favourite']
  when 'store' then array['Best seller', 'New arrival', 'Gift pick']
  when 'beauty' then array['Haircut', 'Facial', 'Hair spa']
  else array['Main service', 'Express service', 'Premium service'] end) as n
where p.status = 'live' and not exists (select 1 from public.items x where x.place_id = p.id)
on conflict (place_id, name_normalized) do nothing;

-- =====================================================================================
-- News posts (the Updates section on each shop page and the home page strip).
-- =====================================================================================
delete from public.place_updates where body like '[Demo] %';
drop table if exists tp_news;
create temp table tp_news (shop text, body text, link text, days_ago int);
insert into tp_news values
  ('Forno Napoli', 'New on the menu this week: Burrata Pizza with rocket and cherry tomatoes.', null, 8),
  ('Forno Napoli', 'Pizza masterclass this Sunday at 11 am. Learn to stretch dough from our pizzaiolo.', 'https://instagram.com/fornonapoli.pun', 14),
  ('Kaapi Corner', 'Filter coffee tastings every Saturday morning, free with any breakfast.', null, 4),
  ('Kaapi Corner', 'We now open at 7 am on weekdays for the early walkers.', 'https://instagram.com/kaapicorner.pun', 15),
  ('Hyderabad Biryani House', 'Weekend special: Mutton Biryani with a free Double Ka Meetha.', null, 7),
  ('Hyderabad Biryani House', 'Haleem season is here. Available every evening from 6 pm.', 'https://instagram.com/hyderabadbiryanihouse.pun', 17),
  ('Masala Library', 'Chef''s tasting menu returns on Friday nights. Six courses, limited seats.', 'https://instagram.com/masalalibrary.pun', 5),
  ('Masala Library', 'Weekday lunch thalis from ₹449, served 12 to 3 pm.', null, 15),
  ('Brew Society', 'Cold Brew is now on tap. Ask for a taster.', null, 6),
  ('Brew Society', 'Laptop-friendly mornings: Wi-Fi, sockets and a filter refill for ₹49 until 11 am.', 'https://instagram.com/brewsociety.pun', 18),
  ('Tandoor Tales', 'Family combo for four: two tandoor starters, two gravies, breads and rice for ₹1,299.', null, 6),
  ('Pasta Fresca', 'Fresh truffle risotto is back for the season.', null, 3),
  ('Pasta Fresca', 'Wine and pasta pairing night every second Thursday. Four glasses, four plates.', 'https://instagram.com/pastafresca.pun', 17),
  ('Burger Barn', 'Free peri peri fries with every Classic Smash Burger this week.', null, 3),
  ('Madras Tiffin Room', 'Banana leaf meals every day from 12 to 3 pm. Unlimited refills.', null, 5),
  ('Chaat Street', 'New: Samosa Chaat, topped with fresh pomegranate.', null, 3),
  ('Sweet Tooth Creamery', 'New flavour: Mango Sorbet, made with Alphonso mangoes.', null, 8),
  ('Bombay Bites', 'Monsoon special: hot bhajiyas with every cutting chai after 5 pm.', null, 8),
  ('Green Bowl', 'Weekend farmers'' table: seasonal veg bowls, only on Saturdays.', null, 8),
  ('The Book Nook Cafe', 'Open mic poetry evening this Friday at 7 pm. Walk-ins welcome.', 'https://instagram.com/thebooknookcafe.pun', 8),
  ('Spice Route', 'Lunch express: any noodle bowl and a soup for ₹299 until 3 pm.', null, 7),
  ('Smoke House BBQ', 'Brisket Sundays: all you can eat from 1 pm till it runs out.', 'https://instagram.com/smokehousebbq.pun', 4),
  ('Sugar Loaf Bakery', 'Sourdough Saturdays: fresh loaves out of the oven at 9 am.', null, 5),
  ('Sugar Loaf Bakery', 'Custom cakes for Diwali are now open for orders.', 'https://instagram.com/sugarloafbakery.pun', 18),
  ('Fade Studio', 'Weekday happy hours: 20% off cuts between 11 am and 2 pm.', null, 8),
  ('Fade Studio', 'Our new beard oil range is on the counter.', 'https://instagram.com/fadestudio.pun', 17),
  ('Iron Temple Gym', 'Morning yoga batch starts Monday at 6:30 am.', null, 3),
  ('Iron Temple Gym', 'Join in October and get the first month of personal training at half price.', 'https://example.com/irontemplegym', 17),
  ('Glow Beauty Parlour', 'Festive facial offers all month. Ask at reception.', null, 5),
  ('Glow Beauty Parlour', 'Bridal bookings for the wedding season are open.', 'https://instagram.com/glowbeautyparlour.pun', 17),
  ('Urban Threads', 'Linen shirts restocked in four new colours.', null, 6),
  ('Urban Threads', 'Festive sale: flat 25% off on kurtas till the 31st.', 'https://example.com/urbanthreads', 14),
  ('CarePlus Clinic', 'Free health check camp on the first Sunday of the month.', null, 3),
  ('CarePlus Clinic', 'Flu vaccines are now available. Call to book a slot.', null, 17),
  ('Studio Zen Yoga', 'New evening breathwork class on Thursdays.', null, 8),
  ('Studio Zen Yoga', 'Sunrise yoga on the hill this Sunday. Free for members.', 'https://instagram.com/studiozenyoga.pun', 15),
  ('FitHub CrossFit', 'Open competition week: partner WODs every evening.', 'https://instagram.com/fithubcrossfit.pun', 7),
  ('Blade & Co Barbers', 'Father and son haircut combo on Sundays: two cuts for ₹550.', null, 4),
  ('Nail Bar', 'Autumn nail art collection is live. Bookings on WhatsApp.', 'https://instagram.com/nailbar.pun', 5),
  ('BrightPath Coaching', 'New batch for class 10 starts on the 1st. Seats are limited.', null, 8),
  ('BrightPath Coaching', 'Free demo class this Saturday at 5 pm.', 'https://example.com/brightpathcoaching', 14),
  ('Little Steps Preschool', 'Admissions for next year are open. Book a campus visit.', 'https://example.com/littlestepspreschool', 3),
  ('Little Steps Preschool', 'Annual day photos are up on our Instagram.', 'https://instagram.com/littlestepspreschool.pun', 17),
  ('FixIt Home Services', 'Monsoon check-up: free leak inspection with any plumbing visit.', null, 8),
  ('Wheels Garage', 'Pre-monsoon service package: wipers, brakes and a free wash.', null, 3),
  ('SmileCare Dental', 'Free dental check-up for children every second Saturday.', null, 4),
  ('PetPals Vet', 'Anti-rabies vaccination drive this weekend at a reduced price.', null, 6),
  ('Paper Trail Books', 'Author reading and signing this Saturday at 6 pm.', 'https://instagram.com/papertrailbooks.pun', 5),
  ('Gadget Galaxy', 'Diwali offers on speakers and watches, in store and online.', 'https://example.com/gadgetgalaxy', 3),
  ('Chai Tapri Co.', 'We just opened! First 100 customers get a free bun maska.', 'https://instagram.com/chaitaprico.pun', 8),
  ('Old Wada Kitchen', 'Gudi Padwa thali with puran poli, booking required.', null, 4),
  ('Cafe Colaba Nights', 'Monsoon menu: hot pakoras with every chai after 5 pm.', null, 6),
  ('Bandra Bistro', 'Live acoustic night every Thursday from 8 pm.', 'https://instagram.com/bandrabistro.mum', 8),
  ('Filter Kaapi Junction', 'Now open at 6:30 am for the morning walkers.', null, 7),
  ('Chandni Chowk Chaat House', 'Daulat ki chaat is back for the winter.', null, 4),
  ('Charminar Biryani Point', 'Haleem season: available every evening from 5 pm.', 'https://instagram.com/charminarbiryanipoint.hyd', 4);

insert into public.place_updates (place_id, body, link_url, created_by, created_at)
select p.id, n.body, n.link, p.owner_id, now() - make_interval(days => n.days_ago, hours => (abs(hashtext(n.body)::bigint) % 10)::int)
from tp_news n join public.places p on p.name = n.shop and p.about like '[Demo]%'
where not exists (select 1 from public.place_updates x where x.place_id = p.id and x.body = n.body);

-- =====================================================================================
-- Table QR codes with fixed tokens, so printed codes keep working. Each shop has as many as its plan allows.
-- =====================================================================================
drop table if exists tp_qr;
create temp table tp_qr (shop text, token text, style text, label text, seats int, age int);
insert into tp_qr values
  ('Forno Napoli', '55a233a56de7d4b6', 'paper', 'Table 1', 2, 143),
  ('Forno Napoli', '215a67bb4a6e9fd4', 'neon', 'Table 2', 4, 202),
  ('Forno Napoli', 'd7d48f4355913a92', 'matrix', 'Table 3', 4, 228),
  ('Forno Napoli', 'a9da5310d327fa81', 'matrix', 'Table 4', 6, 234),
  ('Forno Napoli', '0a2a757aabd2c223', 'matrix', 'Table 5', 2, 194),
  ('Kaapi Corner', 'fd1dc6ca818aba38', 'paper', 'Counter', 6, 126),
  ('Kaapi Corner', '2a7701b840fadb6b', 'paper', 'Table 1', 4, 121),
  ('Kaapi Corner', '7b0ce910f740cc08', 'paper', 'Table 2', 4, 186),
  ('Kaapi Corner', '6f224b1e675dee8f', 'paper', 'Table 3', 6, 132),
  ('Hyderabad Biryani House', '665bf7f2b2ba6f63', 'paper', 'Table 4', 2, 105),
  ('Hyderabad Biryani House', '854ca350e06270f2', 'neon', 'Table 1', 4, 50),
  ('Hyderabad Biryani House', '979873ebbfa8c6fc', 'neon', 'Table 2', 4, 167),
  ('Hyderabad Biryani House', 'a4725590176427b5', 'neon', 'Table 3', 6, 55),
  ('Hyderabad Biryani House', '77edc3d8a0d3f262', 'neon', 'Table 5', 2, 177),
  ('Masala Library', '7a1c0e5d2b9f4c11', 'paper', 'Table 3', 2, 145),
  ('Masala Library', '0ec8ee3ff28ee47b', 'aurora', 'Table 1', 4, 143),
  ('Masala Library', '9320a04698b0371c', 'aurora', 'Table 2', 4, 126),
  ('Masala Library', 'c2a4a4c6389ea193', 'aurora', 'Table 4', 6, 148),
  ('Masala Library', '3e8d1d81ee5ff641', 'aurora', 'Table 5', 2, 188),
  ('Masala Library', '0ddf4cd65e411a35', 'aurora', 'Table 6', 4, 67),
  ('Masala Library', '3c2171ffe75ba9f8', 'aurora', 'Table 7', 4, 128),
  ('Brew Society', '9b3d7e1a4c5f2d22', 'paper', 'Counter', 6, 141),
  ('Brew Society', '4b509a4e984fb591', 'matrix', 'Table 1', 4, 150),
  ('Brew Society', '4f4fda58ae37504b', 'matrix', 'Table 2', 4, 91),
  ('Brew Society', '68648d0236e33497', 'matrix', 'Table 3', 6, 46),
  ('Brew Society', '342cbf3a70a77fd6', 'matrix', 'Table 4', 2, 185),
  ('Tandoor Tales', 'a8da5472eee98697', 'paper', 'Table 1', 2, 196),
  ('Tandoor Tales', 'c4e8a2f6d1b03e33', 'paper', 'Table 2', 4, 68),
  ('Tandoor Tales', '4d45f507d492d398', 'paper', 'Table 3', 4, 82),
  ('Tandoor Tales', '272e795f8be4d8df', 'paper', 'Table 4', 6, 54),
  ('Tandoor Tales', 'fe74c96eed3a70d4', 'paper', 'Table 5', 2, 67),
  ('Pasta Fresca', '37101633d2246bd9', 'neon', 'Table 1', 2, 173),
  ('Pasta Fresca', '5c7f681ff88ec5e6', 'neon', 'Table 2', 4, 218),
  ('Pasta Fresca', 'db2b3321ed20a162', 'neon', 'Table 3', 4, 93),
  ('Pasta Fresca', 'b0ad0c24b8614065', 'neon', 'Table 4', 6, 76),
  ('Pasta Fresca', 'bd28f72612eea658', 'neon', 'Table 5', 2, 178),
  ('Pasta Fresca', '6162352a68a23b73', 'neon', 'Table 6', 4, 213),
  ('Burger Barn', '00c2ea8572e8787e', 'aurora', 'Table 1', 2, 193),
  ('Burger Barn', 'd79cd12fbe3f34f8', 'aurora', 'Table 2', 4, 142),
  ('Burger Barn', '19c052061ddf42c2', 'aurora', 'Table 3', 4, 202),
  ('Burger Barn', '77bff950700c7563', 'aurora', 'Table 4', 6, 54),
  ('Burger Barn', 'f2e416c799dd4571', 'aurora', 'Table 5', 2, 202),
  ('Burger Barn', '2ded001edc04ea3c', 'aurora', 'Table 6', 4, 150),
  ('Burger Barn', '13c31aa877b6b95c', 'aurora', 'Table 7', 4, 130),
  ('Burger Barn', '906580e19fc37c5b', 'aurora', 'Table 8', 6, 140),
  ('Madras Tiffin Room', 'f892f0284d699264', 'matrix', 'Table 1', 2, 135),
  ('Madras Tiffin Room', 'c78b954a0f0c6b2e', 'matrix', 'Table 2', 4, 197),
  ('Madras Tiffin Room', '7ce83183a0f3a7f8', 'matrix', 'Table 3', 4, 91),
  ('Madras Tiffin Room', '958e8f4e18e7586f', 'matrix', 'Table 4', 6, 80),
  ('Madras Tiffin Room', 'cbc0fcf5f1517225', 'matrix', 'Table 5', 2, 70),
  ('Chaat Street', 'd6cb3c9341956039', 'paper', 'Counter', 6, 152),
  ('Sweet Tooth Creamery', 'e205d45c63090960', 'neon', 'Counter', 6, 213),
  ('Sweet Tooth Creamery', 'f2254a0e69da6fb1', 'neon', 'Table 1', 4, 188),
  ('Sweet Tooth Creamery', '173b3919928a9a93', 'neon', 'Table 2', 4, 68),
  ('Sweet Tooth Creamery', 'b19ffeacc5051eb9', 'neon', 'Table 3', 6, 163),
  ('Sweet Tooth Creamery', 'a2c9ce92f8794081', 'neon', 'Table 4', 2, 208),
  ('Bombay Bites', '6d331fa3b4cd52e9', 'aurora', 'Table 1', 2, 87),
  ('Bombay Bites', '22fa1c0248295bae', 'aurora', 'Table 2', 4, 85),
  ('Bombay Bites', '6b6207dd33145683', 'aurora', 'Table 3', 4, 171),
  ('Bombay Bites', 'e36cd7451cde4928', 'aurora', 'Table 4', 6, 175),
  ('Green Bowl', 'b266235e8fb26655', 'matrix', 'Table 1', 2, 42),
  ('Green Bowl', '5e018e1833c6fd35', 'matrix', 'Table 2', 4, 102),
  ('Green Bowl', '2eb9f5de91dd4e60', 'matrix', 'Table 3', 4, 137),
  ('Green Bowl', '04eb56482ce8e2ac', 'matrix', 'Table 4', 6, 231),
  ('The Book Nook Cafe', '2cfb40613ffcad84', 'paper', 'Table 1', 2, 83),
  ('The Book Nook Cafe', '0a16ccb808c3f1f8', 'paper', 'Table 2', 4, 80),
  ('The Book Nook Cafe', '8f2b47b19fa311b0', 'paper', 'Table 3', 4, 228),
  ('The Book Nook Cafe', '5d8328f11d028ae8', 'paper', 'Table 4', 6, 41),
  ('The Book Nook Cafe', 'd796fc1531f67d16', 'paper', 'Table 5', 2, 204),
  ('Spice Route', '69cd00287e1c812a', 'neon', 'Table 1', 2, 215),
  ('Spice Route', 'ec3e8761be30335f', 'neon', 'Table 2', 4, 47),
  ('Spice Route', '88fc48805c1d4027', 'neon', 'Table 3', 4, 73),
  ('Spice Route', '58e507ec2042c2de', 'neon', 'Table 4', 6, 155),
  ('Spice Route', '01848a64c2ca661b', 'neon', 'Table 5', 2, 172),
  ('Smoke House BBQ', 'bac783e6f13c1759', 'aurora', 'Table 1', 2, 85),
  ('Smoke House BBQ', '92a42eeff5124e80', 'aurora', 'Table 2', 4, 119),
  ('Smoke House BBQ', '163fce90e1211e53', 'aurora', 'Table 3', 4, 171),
  ('Smoke House BBQ', 'eabff07826494043', 'aurora', 'Table 4', 6, 155),
  ('Smoke House BBQ', '43bbce5bb24ab754', 'aurora', 'Table 5', 2, 214),
  ('Sugar Loaf Bakery', 'a0232967e94b7c3f', 'paper', 'Counter', 6, 184),
  ('Sugar Loaf Bakery', 'f82de313d1513730', 'matrix', 'Table 1', 4, 161),
  ('Sugar Loaf Bakery', '33eb5078fb9ebebb', 'matrix', 'Table 2', 4, 191),
  ('Fade Studio', '05b0247f40a8fa4b', 'neon', 'Chair 1', 1, 231),
  ('Fade Studio', 'e2caba9a187571d3', 'paper', 'Chair 2', 1, 210),
  ('Fade Studio', '4a60b175681c539f', 'paper', 'Chair 3', 1, 122),
  ('Iron Temple Gym', 'e5f9b3a7c2d14f44', 'paper', 'Front desk', 4, 190),
  ('Iron Temple Gym', '9b4045a70a1b41df', 'aurora', 'Cardio floor', 4, 41),
  ('Glow Beauty Parlour', '1a6c2e8f4b7d5a55', 'neon', 'Reception', 4, 136),
  ('Glow Beauty Parlour', 'c49173b7af4f033e', 'aurora', 'Chair 1', 1, 168),
  ('Urban Threads', '3c8e4a0b6d9f7c66', 'paper', 'Billing counter', 4, 96),
  ('Urban Threads', '7aa8e58aa8cb5e3b', 'aurora', 'Trial room', 4, 126),
  ('CarePlus Clinic', '5e0a6c2d8f1b9e77', 'paper', 'Reception', 4, 164),
  ('Studio Zen Yoga', 'b59f1e313699aa84', 'matrix', 'Reception', 4, 123),
  ('FitHub CrossFit', 'c5b262f52acd8fa4', 'neon', 'Front desk', 4, 112),
  ('Blade & Co Barbers', '3507cadbae4a25e3', 'matrix', 'Chair 1', 1, 93),
  ('Blade & Co Barbers', '0dddbb6d41fecd66', 'matrix', 'Chair 2', 1, 228),
  ('Nail Bar', '73c5370ce8b282f8', 'aurora', 'Reception', 4, 41),
  ('BrightPath Coaching', '4eb1ef4f58eebcc8', 'matrix', 'Reception', 4, 193),
  ('Little Steps Preschool', '99c8c9a65c7b0ee0', 'paper', 'Reception', 4, 189),
  ('FixIt Home Services', 'c4234a131e71110b', 'neon', 'Reception', 4, 77),
  ('Wheels Garage', '9c9cf41db1c333f7', 'aurora', 'Reception', 4, 44),
  ('SmileCare Dental', '665a8a9f8e38038f', 'matrix', 'Reception', 4, 87),
  ('PetPals Vet', 'f88bab6165bc0511', 'paper', 'Reception', 4, 46),
  ('Paper Trail Books', 'f3a0a094440cf6d4', 'matrix', 'Billing counter', 4, 132),
  ('Gadget Galaxy', '90f6d057fdc1fa7d', 'paper', 'Billing counter', 4, 56),
  ('Chai Tapri Co.', '2cb0b624c4bcffc6', 'neon', 'Counter', 6, 192),
  ('Old Wada Kitchen', '95a2fa58b4e6d6fd', 'aurora', 'Table 1', 2, 78),
  ('Old Wada Kitchen', 'b286fee603cb9d1c', 'aurora', 'Table 2', 4, 148),
  ('Old Wada Kitchen', 'cde0c68da77e43a3', 'aurora', 'Table 3', 4, 197),
  ('Cafe Colaba Nights', '6a87989d8e696f05', 'matrix', 'Counter', 6, 77),
  ('Cafe Colaba Nights', '09a12dd37de76c5d', 'matrix', 'Table 1', 4, 180),
  ('Cafe Colaba Nights', '4e10453801f15245', 'matrix', 'Table 2', 4, 151),
  ('Cafe Colaba Nights', 'bc2de4b0214a274c', 'matrix', 'Table 3', 6, 232),
  ('Cafe Colaba Nights', '2acfaa6da488e142', 'matrix', 'Table 4', 2, 233),
  ('Bandra Bistro', 'a6f7155c5f388359', 'paper', 'Table 1', 2, 171),
  ('Bandra Bistro', '6ac6fdafdfc294c3', 'paper', 'Table 2', 4, 212),
  ('Bandra Bistro', 'c4096af22f455128', 'paper', 'Table 3', 4, 165),
  ('Bandra Bistro', '000ea1d1a5c983ca', 'paper', 'Table 4', 6, 126),
  ('Bandra Bistro', '83ca2a61d8f80ff5', 'paper', 'Table 5', 2, 74),
  ('Bandra Bistro', 'f6c64dfd2cd76d8f', 'paper', 'Table 6', 4, 139),
  ('Filter Kaapi Junction', '19592864e3e7f630', 'neon', 'Counter', 6, 143),
  ('Koramangala Barber Co.', '3e7dfe820821b940', 'aurora', 'Chair 1', 1, 174),
  ('Koramangala Barber Co.', '28c8cea2f932eaf0', 'aurora', 'Chair 2', 1, 102),
  ('Chandni Chowk Chaat House', '3029b78332e0bd68', 'matrix', 'Counter', 6, 46),
  ('Charminar Biryani Point', 'c87aa3501e608956', 'paper', 'Table 1', 2, 134),
  ('Charminar Biryani Point', 'b0d70e7387f50b91', 'paper', 'Table 2', 4, 72),
  ('Charminar Biryani Point', 'b4f0c2e1dcbf8f01', 'paper', 'Table 3', 4, 224),
  ('Charminar Biryani Point', '985c0a49caadf1d6', 'paper', 'Table 4', 6, 186),
  ('Charminar Biryani Point', 'b4c354a93276a943', 'paper', 'Table 5', 2, 220),
  ('Charminar Biryani Point', 'd094cde067435da0', 'paper', 'Table 6', 4, 187);

insert into public.qr_codes (place_id, token, style, table_label, seats, jar_size, active, created_at)
select p.id, d.token, d.style::public.qr_style, d.label, d.seats, d.seats, true, now() - make_interval(days => d.age)
from tp_qr d join public.places p on p.name = d.shop and p.about like '[Demo]%'
on conflict (token) do update set table_label = excluded.table_label, seats = excluded.seats, jar_size = excluded.jar_size, active = true;


-- =====================================================================================
-- Reviews: the demo people visit shops in their own city (a few travel), once each, and rate one to three
-- things from that visit. Mix of named and anonymous, all verified by a table scan or a shop link, spread over
-- four months with more recent ones. Only the demo people's own reviews and visits are cleared and rebuilt.
-- =====================================================================================
alter table public.reviews disable trigger reviews_check_allowed;
alter table public.reviews disable trigger reviews_stats;
delete from public.reviews where user_id::text like 'de000000-%';
delete from public.visits where user_id::text like 'de000000-%';

drop table if exists tp_phrases, tp_extras, tp_extra, tp_pairs, tp_rev;
create temp table tp_phrases (grp text, bucket text, idx int, cnt int, tpl text);
insert into tp_phrases values
  ('food', 'pos', 1, 12, 'The %s was fantastic. Would order it again in a heartbeat.'),
  ('food', 'pos', 2, 12, 'Easily the best %s I have had in the area. Fresh and full of flavour.'),
  ('food', 'pos', 3, 12, 'Came for the %s and it did not disappoint. Great value too.'),
  ('food', 'pos', 4, 12, 'Loved the %s. Generous portion and it arrived piping hot.'),
  ('food', 'pos', 5, 12, 'The %s here is the real deal. You can taste the care.'),
  ('food', 'pos', 6, 12, 'Solid %s and lovely staff. Quick service even when it was busy.'),
  ('food', 'pos', 7, 12, 'Honestly the %s alone is worth the visit.'),
  ('food', 'pos', 8, 12, 'Brought friends for the %s and everyone loved it.'),
  ('food', 'pos', 9, 12, 'My go-to for %s now. Consistent every single time.'),
  ('food', 'pos', 10, 12, 'Did not expect the %s to be this good. Pleasantly surprised.'),
  ('food', 'pos', 11, 12, 'Ekdum mast %s! Paisa vasool.'),
  ('food', 'pos', 12, 12, 'The %s ticks every box: taste, texture and temperature.'),
  ('food', 'mid', 1, 6, 'The %s was good, but the wait was longer than I expected.'),
  ('food', 'mid', 2, 6, 'Decent %s for the price. Nothing special, nothing wrong.'),
  ('food', 'mid', 3, 6, 'Fine %s. I would try something else next time.'),
  ('food', 'mid', 4, 6, 'The %s was okay. Service could be warmer.'),
  ('food', 'mid', 5, 6, 'Average %s. Portion could be bigger for the price.'),
  ('food', 'mid', 6, 6, 'Liked the %s but it was a little too salty for me.'),
  ('food', 'low', 1, 5, 'The %s was cold when it arrived and a little bland.'),
  ('food', 'low', 2, 5, 'Disappointed by the %s this time. It felt overpriced.'),
  ('food', 'low', 3, 5, 'Not great. The %s was not as fresh as before.'),
  ('food', 'low', 4, 5, 'Waited a long time and the %s did not make up for it.'),
  ('food', 'low', 5, 5, 'The %s was greasy and the staff seemed distracted.'),
  ('beauty', 'pos', 1, 8, 'Really happy with the %s. Skilled, on time and no upselling.'),
  ('beauty', 'pos', 2, 8, 'The %s was exactly what I wanted. Clean place and kind people.'),
  ('beauty', 'pos', 3, 8, 'Great %s. I will be coming back and sending friends.'),
  ('beauty', 'pos', 4, 8, 'Very professional. The %s was done right the first time.'),
  ('beauty', 'pos', 5, 8, 'Booked the %s on a friend''s advice and I understand why.'),
  ('beauty', 'pos', 6, 8, 'Super friendly team and an excellent %s.'),
  ('beauty', 'pos', 7, 8, 'Clear about the price up front. The %s was worth it.'),
  ('beauty', 'pos', 8, 8, 'Best %s I have had in a long time. The finish was spot on.'),
  ('beauty', 'mid', 1, 4, 'The %s was fine, though I waited a while before starting.'),
  ('beauty', 'mid', 2, 4, 'Good %s overall. A bit rushed at the end.'),
  ('beauty', 'mid', 3, 4, 'Okay %s. Fair price, average experience.'),
  ('beauty', 'mid', 4, 4, 'The %s was decent but the place was crowded.'),
  ('beauty', 'low', 1, 3, 'The %s was not what I expected and I had to wait a long time.'),
  ('beauty', 'low', 2, 3, 'Not happy with the %s. Felt rushed and a bit overcharged.'),
  ('beauty', 'low', 3, 3, 'The %s needed a redo. Staff were polite but it was not right.'),
  ('fitness', 'pos', 1, 6, 'Joined for the %s and stayed for the coaches. Everyone is attentive and the place is spotless.'),
  ('fitness', 'pos', 2, 6, 'Great %s. Equipment is well kept and the trainers actually correct your form.'),
  ('fitness', 'pos', 3, 6, 'The %s is worth every rupee. Motivating crowd and never too packed.'),
  ('fitness', 'pos', 4, 6, 'Tried the %s and signed up the same day.'),
  ('fitness', 'pos', 5, 6, 'Excellent %s. Clear plan, friendly coach, and no pressure to upgrade.'),
  ('fitness', 'pos', 6, 6, 'Solid %s. The place is clean, well-ventilated and on time.'),
  ('fitness', 'mid', 1, 3, 'The %s is good, but evenings get crowded.'),
  ('fitness', 'mid', 2, 3, 'Decent %s. Equipment is fine though some of it is old.'),
  ('fitness', 'mid', 3, 3, 'Okay %s. Coaches are nice, timings could be more flexible.'),
  ('fitness', 'low', 1, 3, 'The %s was disappointing. Overcrowded and hard to get a machine.'),
  ('fitness', 'low', 2, 3, 'Not impressed by the %s. Felt like a sales pitch.'),
  ('fitness', 'low', 3, 3, 'The %s was rushed and the room was stuffy.'),
  ('health', 'pos', 1, 6, 'The %s was thorough and the doctor listened properly.'),
  ('health', 'pos', 2, 6, 'Short wait and a clear explanation. The %s was worth it.'),
  ('health', 'pos', 3, 6, 'Very caring team. The %s was painless and well explained.'),
  ('health', 'pos', 4, 6, 'Clean clinic, fair price, and the %s was done on time.'),
  ('health', 'pos', 5, 6, 'Excellent %s. They followed up the next day to check on me.'),
  ('health', 'pos', 6, 6, 'Honest advice and no unnecessary tests. The %s was good value.'),
  ('health', 'mid', 1, 3, 'The %s was fine but I waited about forty minutes.'),
  ('health', 'mid', 2, 3, 'Good %s. The explanation could have been clearer.'),
  ('health', 'mid', 3, 3, 'Okay %s. Staff were polite, the wait was long.'),
  ('health', 'low', 1, 3, 'The %s felt rushed and I left with questions.'),
  ('health', 'low', 2, 3, 'Long wait and the %s was not what was promised.'),
  ('health', 'low', 3, 3, 'Not happy with the %s. The bill was higher than quoted.'),
  ('education', 'pos', 1, 6, 'The %s has been great for my child. Teachers are patient and communicate often.'),
  ('education', 'pos', 2, 6, 'Very good %s. Small group, weekly feedback and no pressure.'),
  ('education', 'pos', 3, 6, 'We joined for the %s and saw improvement within a month.'),
  ('education', 'pos', 4, 6, 'Teachers explain concepts properly. The %s is worth the fees.'),
  ('education', 'pos', 5, 6, 'Great %s. Clean, safe and well organised.'),
  ('education', 'pos', 6, 6, 'Well-run %s. Classes start on time and doubts are cleared.'),
  ('education', 'mid', 1, 3, 'The %s is good but the batch is a bit large.'),
  ('education', 'mid', 2, 3, 'Decent %s. Fees are on the higher side.'),
  ('education', 'mid', 3, 3, 'Okay %s. Teaching is fine, the schedule changes often.'),
  ('education', 'low', 1, 3, 'The %s did not deliver what was promised.'),
  ('education', 'low', 2, 3, 'Disappointed with the %s. Hard to reach anyone when needed.'),
  ('education', 'low', 3, 3, 'Not worth the fees. The %s felt rushed.'),
  ('store', 'pos', 1, 6, 'Bought the %s here and it is exactly as described. Easy returns too.'),
  ('store', 'pos', 2, 6, 'Great %s at a fair price. The staff did not push anything.'),
  ('store', 'pos', 3, 6, 'Loved the %s. Well packed and genuine.'),
  ('store', 'pos', 4, 6, 'The %s quality is much better than I expected for the price.'),
  ('store', 'pos', 5, 6, 'Picked up the %s as a gift and it was a hit.'),
  ('store', 'pos', 6, 6, 'Fair prices, genuine stock and a really good %s.'),
  ('store', 'mid', 1, 3, 'The %s is decent but the choice was limited.'),
  ('store', 'mid', 2, 3, 'Okay %s. Pricing is a bit steep.'),
  ('store', 'mid', 3, 3, 'Fine %s, though billing took a while.'),
  ('store', 'low', 1, 3, 'The %s was not as good as the photos suggested.'),
  ('store', 'low', 2, 3, 'Not happy with the %s. Return was a hassle.'),
  ('store', 'low', 3, 3, 'The %s felt overpriced for the quality.'),
  ('services', 'pos', 1, 6, 'The %s was done on time and the quote did not change. Very happy.'),
  ('services', 'pos', 2, 6, 'Professional team and a neat %s. Will call them again.'),
  ('services', 'pos', 3, 6, 'Great %s. They explained the problem and the price before starting.'),
  ('services', 'pos', 4, 6, 'Quick, clean and honest. The %s was exactly what I needed.'),
  ('services', 'pos', 5, 6, 'The %s was fixed properly the first time. Rare these days.'),
  ('services', 'pos', 6, 6, 'Fair price for the %s and the work is guaranteed.'),
  ('services', 'mid', 1, 3, 'The %s was fine but they arrived late.'),
  ('services', 'mid', 2, 3, 'Okay %s. The price was a bit higher than expected.'),
  ('services', 'mid', 3, 3, 'Decent %s. Communication could be better.'),
  ('services', 'low', 1, 3, 'The %s had to be redone and the wait was long.'),
  ('services', 'low', 2, 3, 'Not happy with the %s. The final bill was higher than quoted.'),
  ('services', 'low', 3, 3, 'Late and rushed. The %s was not right.');
create temp table tp_extras (bucket text, idx int, cnt int, txt text);
insert into tp_extras values
  ('pos', 1, 9, 'Will definitely be back.'),
  ('pos', 2, 9, 'Highly recommended.'),
  ('pos', 3, 9, 'Staff were lovely.'),
  ('pos', 4, 9, 'Great value for money.'),
  ('pos', 5, 9, 'Told all my friends.'),
  ('pos', 6, 9, 'Five stars from me.'),
  ('pos', 7, 9, 'Worth every rupee.'),
  ('pos', 8, 9, 'Loved it ❤️'),
  ('pos', 9, 9, 'So good 😋'),
  ('mid', 1, 3, 'Might give it another go.'),
  ('mid', 2, 3, 'Fair enough for the price.'),
  ('mid', 3, 3, 'Could be better, could be worse.'),
  ('low', 1, 3, 'Hope they improve.'),
  ('low', 2, 3, 'Would not rush back.'),
  ('low', 3, 3, 'Expected more.');
create temp table tp_extra (shop text, user_ord int, item_ord int, rating int, ago_hours int, src text, near boolean, body text, device text);
insert into tp_extra values
  ('Gadget Galaxy', 150, 1, 5, 2, 'qr', true, 'Excellent!', ''),
  ('Gadget Galaxy', 151, 2, 5, 4, 'qr', true, 'Best shop ever', ''),
  ('Gadget Galaxy', 152, 3, 5, 6, 'qr', true, 'Super service', ''),
  ('Gadget Galaxy', 153, 4, 5, 8, 'qr', true, '5 stars', ''),
  ('Gadget Galaxy', 154, 5, 5, 10, 'qr', true, 'Amazing prices', ''),
  ('Gadget Galaxy', 155, 6, 5, 12, 'qr', true, 'Loved it', ''),
  ('Gadget Galaxy', 156, 1, 5, 14, 'qr', true, 'Highly recommend', ''),
  ('Gadget Galaxy', 157, 2, 5, 16, 'qr', true, 'Great deals', ''),
  ('Gadget Galaxy', 158, 3, 5, 18, 'qr', true, 'Perfect', ''),
  ('Wheels Garage', 40, 1, 5, 24, 'qr', false, '', ''),
  ('Wheels Garage', 41, 2, 5, 48, 'qr', false, '', ''),
  ('Wheels Garage', 42, 3, 4, 72, 'qr', false, '', ''),
  ('Wheels Garage', 43, 4, 5, 96, 'qr', false, '', ''),
  ('Nail Bar', 44, 1, 5, 72, 'link', null, 'Absolutely perfect, best nails ever.', ''),
  ('Nail Bar', 45, 2, 5, 144, 'link', null, 'Absolutely perfect, best nails ever.', ''),
  ('Nail Bar', 46, 3, 5, 216, 'link', null, 'Absolutely perfect, best nails ever.', ''),
  ('Nail Bar', 47, 4, 5, 288, 'link', null, 'Absolutely perfect, best nails ever.', ''),
  ('Nail Bar', 48, 1, 2, 96, 'qr', true, 'Chipped within two days. Not worth it.', ''),
  ('Nail Bar', 57, 2, 2, 192, 'qr', true, 'Chipped within two days. Not worth it.', ''),
  ('Nail Bar', 58, 3, 2, 288, 'qr', true, 'Chipped within two days. Not worth it.', ''),
  ('Nail Bar', 59, 4, 2, 384, 'qr', true, 'Chipped within two days. Not worth it.', ''),
  ('Forno Napoli', 160, 1, 5, 1, 'link', null, 'Great place!', 'busy'),
  ('Kaapi Corner', 160, 1, 5, 4, 'link', null, 'Great place!', 'busy'),
  ('Brew Society', 160, 1, 5, 7, 'link', null, 'Great place!', 'busy'),
  ('Burger Barn', 160, 1, 5, 10, 'link', null, 'Great place!', 'busy'),
  ('Pasta Fresca', 160, 1, 5, 13, 'link', null, 'Great place!', 'busy'),
  ('Spice Route', 160, 1, 5, 16, 'link', null, 'Great place!', 'busy');

-- Who visits what: a stable pick from every demo reviewer and every place.
create temp table tp_pairs as
select x.*, ('de000000-0000-4000-8000-' || lpad(x.ord::text, 12, '0'))::uuid as user_id,
       md5('visit' || x.place_id::text || x.ord::text)::uuid as vid,
       now() - make_interval(days => ((((x.h / 7) % 120) * ((x.h / 7) % 120)) / 120)::int, hours => ((x.h / 13) % 20)::int + 1, mins => ((x.h / 17) % 60)::int) as made,
       case when (x.h / 29) % 5 = 0 then 'link' else 'qr' end as src,
       case when (x.h / 31) % 4 = 0 then null else true end as nr
from (
  select p.id as place_id, p.name as place_name, p.kind, coalesce(s.q, 0) as q, u.ord, u.guest,
         abs(hashtext(p.id::text || u.ord::text)::bigint) as h,
         coalesce(s.pop, 0.25) * u.act * case when u.home = p.city then 1 else 0.05 end as pr
  from public.places p
  left join tp_shops s on s.name = p.name and p.about like '[Demo]%'
  cross join (select t.ord, t.city as home, (t.name = '') as guest, case when t.name = '' then 0.45 when t.ord <= 28 then 1.5 else 1.0 end as act
              from tp_people t where t.role = 'user') u
  where p.status <> 'removed'
) x
where (x.h % 1000) < least(0.9, x.pr) * 1000
  and not exists (select 1 from tp_extra e where e.shop = x.place_name and e.user_ord = x.ord);

insert into public.visits (id, user_id, place_id, qr_code_id, scanned_at, expires_at, source, near)
select pr.vid, pr.user_id, pr.place_id,
       case when pr.src = 'qr' then (select c.id from public.qr_codes c where c.place_id = pr.place_id and c.active order by md5(c.id::text || pr.ord::text) limit 1) end,
       pr.made - interval '1 hour', pr.made + interval '5 hours', pr.src, pr.nr
from tp_pairs pr
on conflict (id) do nothing;

-- One to three things rated per visit.
create temp table tp_rev as
select * from (
  select pr.*, it.id as item_id, it.name as item_name, it.image_path as pic, abs(hashtext(it.id::text)::bigint) as hi,
         row_number() over (partition by pr.place_id, pr.ord order by md5(it.id::text || pr.ord::text)) as rk
  from tp_pairs pr join public.items it on it.place_id = pr.place_id and not it.is_hidden
) z where z.rk <= 1 + ((z.h / 100) % 3);

create temp table tp_rev2 as
select r.*, md5('review' || r.vid::text || r.item_id::text)::uuid as rid,
       greatest(1, least(5, round(3.4 + (r.hi % 14) / 10.0 + r.q + ((abs(hashtext(r.ord::text)::bigint) % 7) - 3) / 10.0 + ((((r.h / 3) + r.hi) % 9) - 4) / 4.0)))::int as rate,
       case r.kind when 'food' then 'food' when 'beauty' then 'beauty' when 'fitness' then 'fitness' when 'health' then 'health'
                   when 'education' then 'education' when 'store' then 'store' else 'services' end as grp
from tp_rev r;
alter table tp_rev2 add column bucket text, add column body text;
update tp_rev2 set bucket = case when rate >= 4 then 'pos' when rate = 3 then 'mid' else 'low' end;
update tp_rev2 r set body = case when ((r.h / 37 + r.hi) % 10) < 7 then
    replace(ph.tpl, '%s', r.item_name)
    || case when ((r.h / 43 + r.hi) % 100) < 45 then ' ' || e1.txt else '' end
    || case when ((r.h / 47 + r.hi) % 100) < 5 then ' ' || e2.txt else '' end
  else '' end
from tp_phrases ph, tp_extras e1, tp_extras e2
where ph.grp = r.grp and ph.bucket = r.bucket and ph.idx = 1 + ((r.h / 19 + r.hi) % ph.cnt)
  and e1.bucket = r.bucket and e1.idx = 1 + ((r.h / 53 + r.hi) % e1.cnt)
  and e2.bucket = r.bucket and e2.idx = 1 + ((r.h / 59 + r.hi) % e2.cnt);

insert into public.reviews (id, user_id, place_id, item_id, rating, body, ai_drafted, visit_id, is_public, by_guest, device_hash, photo_path, created_at, updated_at)
select r.rid, r.user_id, r.place_id, r.item_id, r.rate, coalesce(r.body, ''), ((r.h / 23) % 10) = 0, r.vid,
       (not r.guest) and ((r.h / 11) % 100) < (case when r.ord <= 28 then 80 else 30 end), r.guest,
       case when r.guest then md5(r.user_id::text || r.place_id::text) end,
       case when r.pic like 'demo:%' and ((r.h / 61 + r.hi) % 100) < (case r.kind when 'food' then 28 when 'store' then 20 when 'beauty' then 16 when 'fitness' then 8 when 'services' then 8 else 0 end)
            then 'demo:' || split_part(r.pic, ':', 2) || ':' || (coalesce(nullif(split_part(r.pic, ':', 3), ''), '0')::int + 5 + ((r.h / 67) % 9)) end,
       r.made, r.made
from tp_rev2 r
on conflict (id) do nothing;

-- What fits the place ("Fresh", "Good trainers"...) when it went well, and "could be better" tags when it did not.
insert into public.review_tags (review_id, tag_id)
select r.rid, g.id
from tp_rev2 r
cross join lateral (select tg.id, row_number() over (order by md5(tg.id::text || r.rid::text)) as n from public.tags tg
                    where (tg.kinds is null or r.kind = any(tg.kinds)) and not (tg.label = any(array['Too pricey','Slow service','Crowded','Small portion','Not fresh','Served cold','Too oily','Rude staff','Not clean','Long wait','Poor quality','Damaged item','Pushy selling','Late','Overcharged','Rushed','Old equipment']))) g
where g.n <= case when r.rate >= 4 then 1 + ((r.h / 41) % 3) when r.rate = 3 then 1 else 0 end
on conflict do nothing;
insert into public.review_tags (review_id, tag_id)
select r.rid, g.id
from tp_rev2 r
cross join lateral (select tg.id, row_number() over (order by md5(tg.id::text || r.rid::text)) as n from public.tags tg
                    where (tg.kinds is null or r.kind = any(tg.kinds)) and tg.label = any(array['Too pricey','Slow service','Crowded','Small portion','Not fresh','Served cold','Too oily','Rude staff','Not clean','Long wait','Poor quality','Damaged item','Pushy selling','Late','Overcharged','Rushed','Old equipment'])) g
where r.rate <= 3 and g.n <= case when r.rate <= 2 then 2 else 1 end
on conflict do nothing;

-- Scenarios for the Admin "Alerts" tab: a burst of five-star reviews, reviews from scans far from the shop,
-- shop-link reviews much rosier than table reviews, and one phone reviewing many shops.
insert into public.visits (id, user_id, place_id, qr_code_id, scanned_at, expires_at, source, near)
select md5('xv' || e.shop || e.user_ord::text || e.item_ord::text)::uuid, ('de000000-0000-4000-8000-' || lpad(e.user_ord::text, 12, '0'))::uuid, p.id,
       case when e.src = 'qr' then (select c.id from public.qr_codes c where c.place_id = p.id and c.active order by c.created_at limit 1) end,
       now() - make_interval(hours => e.ago_hours) - interval '1 hour', now() - make_interval(hours => e.ago_hours) + interval '5 hours', e.src, e.near
from tp_extra e join public.places p on p.name = e.shop and p.about like '[Demo]%'
on conflict (id) do nothing;
insert into public.reviews (id, user_id, place_id, item_id, rating, body, ai_drafted, visit_id, is_public, by_guest, device_hash, created_at, updated_at)
select md5('xr' || e.shop || e.user_ord::text || e.item_ord::text)::uuid, ('de000000-0000-4000-8000-' || lpad(e.user_ord::text, 12, '0'))::uuid, p.id, it.id, e.rating, e.body, false,
       md5('xv' || e.shop || e.user_ord::text || e.item_ord::text)::uuid, e.user_ord <= 48 or e.user_ord between 57 and 140, e.user_ord > 140 or e.user_ord between 49 and 56,
       case when e.device = 'busy' then md5('busy-device') when e.user_ord > 140 or e.user_ord between 49 and 56 then md5(e.user_ord::text || p.id::text) end,
       now() - make_interval(hours => e.ago_hours), now() - make_interval(hours => e.ago_hours)
from tp_extra e join public.places p on p.name = e.shop and p.about like '[Demo]%'
join public.items it on it.place_id = p.id and it.sort_order = e.item_ord
on conflict (id) do nothing;


-- =====================================================================================
-- Around the reviews: scans that didn't turn into a review, Google shares, saved places, plans and
-- payments, review links, reports, listing and claim requests, AI summaries.
-- =====================================================================================
-- People who scanned but didn't review (so Insights shows scans above reviews).
insert into public.visits (id, user_id, place_id, qr_code_id, scanned_at, expires_at, source, near)
select md5('scan' || x.place_id::text || x.ord::text)::uuid, x.user_id, x.place_id,
       (select c.id from public.qr_codes c where c.place_id = x.place_id and c.active order by md5(c.id::text || x.ord::text) limit 1),
       x.made, x.made + interval '6 hours', 'qr', true
from (
  select p.id as place_id, t.ord, ('de000000-0000-4000-8000-' || lpad(t.ord::text, 12, '0'))::uuid as user_id,
         abs(hashtext('scan' || p.id::text || t.ord::text)::bigint) as h
  from public.places p cross join tp_people t
  where p.status = 'live' and t.role = 'user' and t.city = p.city
) y
cross join lateral (select y.place_id, y.ord, y.user_id, y.h, now() - make_interval(days => ((y.h / 7) % 60)::int, hours => ((y.h / 13) % 20)::int + 1) as made) x
where (y.h % 100) < 9
  and not exists (select 1 from public.visits v where v.user_id = y.user_id and v.place_id = y.place_id)
on conflict (id) do nothing;

-- Some named reviews were also sent on to Google from the thank-you screen.
insert into public.google_shares (review_id, user_id, opened_at)
select r.id, r.user_id, r.created_at + interval '2 minutes'
from public.reviews r
where r.user_id::text like 'de000000-%' and r.is_public and abs(hashtext('g' || r.id::text)::bigint) % 100 < 20
  and not exists (select 1 from public.google_shares g where g.review_id = r.id);

-- Saved places: each demo person saves a few in their city; real admin accounts save the first six demo shops.
insert into public.saved_places (user_id, place_id, created_at)
select u.id, p.id, now() - make_interval(days => (abs(hashtext(u.id::text || p.id::text)::bigint) % 60)::int)
from public.profiles u cross join public.places p
where u.id::text like 'de000000-%' and u.display_name <> '' and p.status = 'live' and u.city = p.city
  and abs(hashtext('save' || u.id::text || p.id::text)::bigint) % 100 < 10
on conflict do nothing;
insert into public.saved_places (user_id, place_id)
select a.id, p.id from public.profiles a
cross join lateral (select id from public.places where about like '[Demo]%' order by name limit 6) p
where a.role = 'admin' and a.id::text not like 'de000000-%'
on conflict do nothing;

-- Plans: each shop's plan, state and renewal date, with an order or two behind it.
update public.subscriptions s set
  plan = t.plan, status = t.sub_status,
  period_end = case t.sub_status when 'trial' then now() + interval '12 days' when 'expired' then now() - interval '20 days'
                                 when 'past_due' then now() + interval '2 days' when 'cancelled' then now() + interval '40 days'
                                 else now() + make_interval(days => 40 + (abs(hashtext(t.name)::bigint) % 300)::int) end,
  billing_interval = case when t.sub_status = 'trial' then null else t.billing_interval end,
  provider = case when t.sub_status = 'trial' then null else 'razorpay' end,
  provider_customer_id = case when t.sub_status = 'trial' then null else 'cust_demo_' || left(md5(p.id::text), 10) end,
  cancel_at_period_end = (t.sub_status = 'cancelled'),
  trial_reviews_left = t.trial_left, updated_at = now()
from tp_shops t join public.places p on p.name = t.name and p.about like '[Demo]%'
where s.place_id = p.id;

delete from public.billing_orders where provider_order_id like 'order_demo_%';
insert into public.billing_orders (place_id, plan, billing_interval, currency, amount_minor, provider, provider_order_id, provider_payment_id, status, created_by, created_at, paid_at)
select s.place_id, s.plan, s.billing_interval, 'INR',
       100 * greatest(1, case when s.billing_interval = 'month' then pl.price_inr_month else pl.price_inr_year end),
       'razorpay', 'order_demo_' || left(md5(s.place_id::text || n), 12), 'pay_demo_' || left(md5(s.place_id::text || 'p' || n), 12), 'paid',
       p.owner_id, now() - make_interval(days => 20 + n * 30 + (abs(hashtext(s.place_id::text)::bigint) % 20)::int),
       now() - make_interval(days => 20 + n * 30 + (abs(hashtext(s.place_id::text)::bigint) % 20)::int)
from public.subscriptions s join public.plans pl on pl.code = s.plan join public.places p on p.id = s.place_id
cross join generate_series(0, 2) n
where p.about like '[Demo]%' and s.status in ('active', 'past_due', 'cancelled', 'expired') and (n = 0 or (s.billing_interval = 'month' and n <= 2));

delete from public.payments where provider = 'demo';
insert into public.payments (place_id, kind, amount_inr, provider, provider_ref, status, paid_at, period_start, period_end)
select p.id, k.kind::public.payment_kind, k.amt, 'demo', 'demo-' || k.kind || '-' || left(md5(p.id::text), 10), 'paid',
       now() - make_interval(days => (20 + abs(hashtext(p.id::text)::bigint) % 100)::int), current_date - 30, current_date + 335
from public.places p cross join (values ('listing', 199), ('qr', 399)) k (kind, amt)
where p.about like '[Demo]%' and p.status = 'live' and (k.kind = 'listing' or abs(hashtext('qrpay' || p.id::text)::bigint) % 3 = 0);

-- One-time review links the shops have handed out (some unused, some used).
insert into public.review_links (place_id, token, created_by, expires_at, used_at)
select p.id, left(md5('link' || p.id::text || g), 24), coalesce(p.owner_id, 'de000000-0000-4000-8000-000000000001'::uuid),
       now() + interval '3 days', case when g = 2 then now() - interval '5 hours' end
from (select id, owner_id from public.places where about like '[Demo]%' order by name limit 12) p cross join generate_series(1, 2) g
on conflict (token) do nothing;

-- Reports: some open for the Admin Alerts tab, some already handled (and their review hidden).
delete from public.review_reports where reporter::text like 'de000000-%';
insert into public.review_reports (review_id, reporter, reason, resolved_at)
select rr.id, ('de000000-0000-4000-8000-' || lpad(((rr.rn * 5) % 48 + 1)::text, 12, '0'))::uuid,
       (array['fake', 'offensive', 'wrong_place', 'personal_info', 'other'])[1 + (rr.rn % 5)::int],
       case when rr.rn > 6 then now() - interval '2 days' end
from (select rv.id, row_number() over (order by md5(rv.id::text)) as rn
      from public.reviews rv where rv.user_id::text like 'de000000-%' and rv.body <> '' and rv.rating <= 3 limit 9) rr;
update public.reviews set status = 'hidden'
where id in (select review_id from public.review_reports where reporter::text like 'de000000-%' and resolved_at is not null and reason in ('offensive', 'fake'));

-- Shops asking to be listed, and people claiming a listed shop.
alter table public.listing_requests disable trigger listing_requests_prepare;
delete from public.listing_requests where note like '[Demo]%';
insert into public.listing_requests (requester_id, business_name, category, area, city, phone, note, wants_qr, qr_style, plan, billing_interval, tables, listing_inr, qr_inr, amount_inr, links, status, decided_at)
select ('de000000-0000-4000-8000-' || lpad(v.u::text, 12, '0'))::uuid, v.nm, v.cat, v.area, v.city, v.phone, '[Demo] ' || v.nm, true, v.sty::public.qr_style, v.pl, 'year', v.t,
       v.amt, 0, v.amt,
       jsonb_build_array(jsonb_build_object('kind', 'instagram', 'url', 'https://instagram.com/' || v.slug, 'label', 'Instagram'),
                         jsonb_build_object('kind', 'phone', 'url', 'tel:' || v.phone, 'label', 'Call us')),
       v.st::public.request_status, case when v.st in ('approved', 'declined') then now() - interval '2 days' end
from (values
  ('Dosa Dhaba Express', 'Restaurant', 'Pimpri', 'Pune', '+919876500001', 'paper', 'starter', 3, 1499, 'pending', 4, 'dosadhabaexpress'),
  ('Zen Spa and Wellness', 'Spa', 'Koregaon Park', 'Pune', '+919876500002', 'neon', 'standard', 6, 2999, 'approved', 9, 'zenspawellness'),
  ('QuickFix Mobile Repair', 'Repair service', 'Camp', 'Pune', '+919876500003', 'paper', 'trial', 1, 0, 'declined', 15, 'quickfixmobile'),
  ('Royal Sweets', 'Sweet shop', 'Shivajinagar', 'Pune', '+919876500004', 'aurora', 'starter', 2, 1499, 'paid', 22, 'royalsweetspune'),
  ('Marine Drive Juice Centre', 'Juice bar', 'Marine Lines', 'Mumbai', '+919876500005', 'matrix', 'standard', 4, 2999, 'pending', 30, 'marinedrivejuice')
) as v (nm, cat, area, city, phone, sty, pl, t, amt, st, u, slug);
alter table public.listing_requests enable trigger listing_requests_prepare;

delete from public.place_claims where user_id::text like 'de000000-%';
insert into public.place_claims (place_id, user_id, kind, near, photo_path, role, phone, status, created_at, decided_at)
select p.id, ('de000000-0000-4000-8000-' || lpad(v.u::text, 12, '0'))::uuid, v.k, true, 'demo:shopfront:' || v.u, v.r, v.ph, v.st,
       now() - make_interval(days => v.d), case when v.st <> 'pending' then now() - make_interval(days => v.d - 1) end
from (values ('Tandoor Tales', 7, 'claim', 'owner', '+919876500011', 'pending', 3), ('Chaat Street', 12, 'claim', 'manager', '+919876500012', 'pending', 5),
             ('Green Bowl', 20, 'access', 'staff', '+919876500013', 'pending', 2), ('Bombay Bites', 33, 'claim', 'owner', '+919876500014', 'rejected', 12),
             ('Gadget Galaxy', 36, 'claim', 'owner', '+919876500015', 'pending', 1)) as v (pn, u, k, r, ph, st, d)
join public.places p on p.name = v.pn and p.about like '[Demo]%';

alter table public.reviews enable trigger reviews_check_allowed;
alter table public.reviews enable trigger reviews_stats;

-- Per-dish scores, rebuilt once for everything.
delete from public.item_stats;
insert into public.item_stats (item_id, place_id, avg_rating, review_count, verified_count)
select r.item_id, r.place_id, round(avg(r.rating), 2), count(*), count(r.visit_id)
from public.reviews r where r.status = 'published' group by r.item_id, r.place_id;

-- Trial shops: reviews left in the free trial.
update public.subscriptions s set trial_reviews_left = greatest(25 - c.n, 0)
from (select place_id, count(*) as n from public.reviews group by place_id) c
where s.place_id = c.place_id and s.status = 'trial' and s.place_id in (select id from public.places where about like '[Demo]%');

-- A written summary on each shop page, built from its own best-rated dishes.
insert into public.place_ai_summaries (place_id, summary, highlights, review_count, updated_at)
select p.id,
       format('People keep coming back for the %s (%s from %s reviews). %s', top.name, top.avg, top.n,
              case when s.avg >= 4.3 then 'Reviewers say it is consistent and worth the trip.' when s.avg >= 3.9 then 'Most are happy, with a few mentions of waits at busy times.' else 'Opinions are mixed, mostly about consistency.' end),
       array[top.name, coalesce(tg.l1, 'Friendly staff'), coalesce(tg.l2, 'Worth the price')], s.n, now()
from public.places p
join lateral (select count(*)::int as n, round(avg(rating), 1) as avg from public.reviews where place_id = p.id and status = 'published') s on s.n > 0
join lateral (select i.name, round(ist.avg_rating, 1) as avg, ist.review_count as n from public.item_stats ist join public.items i on i.id = ist.item_id
              where ist.place_id = p.id order by ist.avg_rating desc, ist.review_count desc limit 1) top on true
left join lateral (select (array_agg(t.label order by c.n desc))[1] as l1, (array_agg(t.label order by c.n desc))[2] as l2
                   from (select rt.tag_id, count(*) as n from public.review_tags rt join public.reviews r on r.id = rt.review_id where r.place_id = p.id group by 1) c
                   join public.tags t on t.id = c.tag_id where t.label <> all(array['Too pricey','Slow service','Crowded','Small portion','Not fresh','Served cold','Too oily','Rude staff','Not clean','Long wait','Poor quality','Damaged item','Pushy selling','Late','Overcharged','Rushed','Old equipment'])) tg on true
where p.about like '[Demo]%'
on conflict (place_id) do update set summary = excluded.summary, highlights = excluded.highlights, review_count = excluded.review_count, updated_at = excluded.updated_at;

-- Who is an expert, who tastes alike, and so on.
do $demo$ begin perform public.refresh_trust_tables(); exception when others then raise notice 'trust tables not refreshed: %', sqlerrm; end $demo$;

-- What you got:
select p.name, p.city, p.category, count(r.id) as reviews, round(avg(r.rating), 1) as avg_stars,
       count(r.id) filter (where r.is_public) as named, count(r.id) filter (where not r.is_public) as anonymous
from public.places p left join public.reviews r on r.place_id = p.id and r.user_id::text like 'de000000-%'
where p.about like '[Demo]%' group by p.id order by p.city, p.name;

-- Try the invite flow: open your app address with ?ref=de00000001 (Aarav Sharma) and use the app; you become friends.
-- To remove the people, friendships, visits, reviews, reports and saved places later (shops stay):
--   delete from auth.users where raw_user_meta_data ->> 'demo' = 'true';
--   delete from public.items where description = '[Demo item]';
--   delete from public.listing_requests where note like '[Demo]%';
-- To remove the demo shops as well (their reviews, QR codes, plans and payments go with them):
--   delete from public.places where about like '[Demo]%';
