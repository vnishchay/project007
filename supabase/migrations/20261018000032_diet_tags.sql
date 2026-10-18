-- Trusted Picks: diet tags on items (veg, non_veg, egg, vegan, jain, gluten_free).
alter table public.items add column if not exists diet text[] default '{}';

alter table public.items drop constraint if exists items_diet_chk;
alter table public.items add constraint items_diet_chk check (
  diet is null or diet <@ array['veg', 'non_veg', 'egg', 'vegan', 'jain', 'gluten_free']::text[]
);
