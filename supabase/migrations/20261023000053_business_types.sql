-- Trusted Picks: every business type gets its own words (2026-10-23).
--   * Quick review tags for a visit, per business type (salon: "Great result", clinic: "Caring doctor",
--     services: "Did it right first time"...). The app picks the set; each label must be a tag row.
--   * QR codes are named for where they go: Table for food, Chair for salons, Desk for clinics, Class for
--     coaching, Card for services (on the bill or visiting card), Counter for the rest.
-- Safe to run more than once.
set search_path = public, extensions;

-- ---------- Visit tags for every business type ----------
insert into public.tags (label, kinds) values
  ('Amazing food', '{visit}'),
  ('Ambience', '{visit}'),
  ('Caring doctor', '{visit}'),
  ('Clean', '{visit}'),
  ('Crowded', '{visit}'),
  ('Crowded classes', '{visit}'),
  ('Did it right first time', '{visit}'),
  ('Didn''t explain', '{visit}'),
  ('Didn''t fix it', '{visit}'),
  ('Doctor', '{visit}'),
  ('Easy returns', '{visit}'),
  ('Equipment', '{visit}'),
  ('Explains clearly', '{visit}'),
  ('Fair quote', '{visit}'),
  ('Fees', '{visit}'),
  ('Felt better', '{visit}'),
  ('Food', '{visit}'),
  ('Genuine products', '{visit}'),
  ('Good equipment', '{visit}'),
  ('Good teachers', '{visit}'),
  ('Good trainers', '{visit}'),
  ('Good variety', '{visit}'),
  ('Good vibe', '{visit}'),
  ('Great equipment', '{visit}'),
  ('Great result', '{visit}'),
  ('Great results', '{visit}'),
  ('Great service', '{visit}'),
  ('Great teachers', '{visit}'),
  ('Great trainers', '{visit}'),
  ('Great value', '{visit}'),
  ('Great variety', '{visit}'),
  ('Great vibe', '{visit}'),
  ('Helpful staff', '{visit}'),
  ('Hygienic', '{visit}'),
  ('Kind staff', '{visit}'),
  ('Late', '{visit}'),
  ('Long wait', '{visit}'),
  ('Loved the result', '{visit}'),
  ('Lovely staff', '{visit}'),
  ('Noisy', '{visit}'),
  ('Not clean', '{visit}'),
  ('Not happy with result', '{visit}'),
  ('Old equipment', '{visit}'),
  ('On time', '{visit}'),
  ('Overcharged', '{visit}'),
  ('Personal attention', '{visit}'),
  ('Poor food', '{visit}'),
  ('Poor quality', '{visit}'),
  ('Poor service', '{visit}'),
  ('Pushy selling', '{visit}'),
  ('Quality', '{visit}'),
  ('Quick', '{visit}'),
  ('Relaxing', '{visit}'),
  ('Result', '{visit}'),
  ('Rude staff', '{visit}'),
  ('Rushed', '{visit}'),
  ('Service', '{visit}'),
  ('Short wait', '{visit}'),
  ('Skilled staff', '{visit}'),
  ('So relaxing', '{visit}'),
  ('Spotless', '{visit}'),
  ('Staff', '{visit}'),
  ('Super quick', '{visit}'),
  ('Teachers', '{visit}'),
  ('Tidy work', '{visit}'),
  ('Too pricey', '{visit}'),
  ('Trainers', '{visit}'),
  ('Unhelpful staff', '{visit}'),
  ('Value', '{visit}'),
  ('Value for fees', '{visit}')
on conflict (label) do nothing;

-- ---------- What one QR spot is called ----------
create or replace function public.place_spot_word(p_kind text)
returns text language sql immutable as $$
  select case p_kind when 'food' then 'Table' when 'beauty' then 'Chair' when 'health' then 'Desk'
                     when 'education' then 'Class' when 'services' then 'Card' else 'Counter' end;
$$;

-- A shop typed "other" uses the type its category suggests, as the app does (modeOf).
-- Codes made by any path (setup, approval, "one more") get the right word instead of "Table".
create or replace function public.qr_label_for_kind()
returns trigger language plpgsql set search_path = public as $$
declare k text;
begin
  if new.table_label ~ '^Table [0-9]+$' then
    select case when p.kind = 'other' then public.guess_place_kind(p.category) else p.kind end into k
    from public.places p where p.id = new.place_id;
    if k is not null and k <> 'food' then
      new.table_label := public.place_spot_word(k) || substr(new.table_label, 6);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists qr_codes_label_kind on public.qr_codes;
create trigger qr_codes_label_kind before insert on public.qr_codes
  for each row execute function public.qr_label_for_kind();

-- Codes already made with the default name, at shops that aren't restaurants.
update public.qr_codes q set table_label = public.place_spot_word(x.k) || substr(q.table_label, 6)
from (select p.id, case when p.kind = 'other' then public.guess_place_kind(p.category) else p.kind end as k from public.places p) x
where x.id = q.place_id and x.k <> 'food' and q.table_label ~ '^Table [0-9]+$';
