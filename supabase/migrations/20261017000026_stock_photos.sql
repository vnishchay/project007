-- Stock pictures for products. The "ai" edge function finds one per product (Pexels), caches the search here
-- and saves the picture's URL in items.image_path. Only Pexels picture URLs may be saved in place of an upload.

create table if not exists public.stock_photos (
  query       text primary key,                 -- lower-cased photo search
  url         text not null,
  created_at  timestamptz not null default now()
);
alter table public.stock_photos enable row level security;   -- no policies: only the edge function (service role) reads or writes

alter table public.items drop constraint if exists items_image_path_chk;
alter table public.items add constraint items_image_path_chk
  check (image_path is null or image_path !~* '^https?://'
         or (image_path ~ '^https://images\.pexels\.com/[A-Za-z0-9/_.?=&%-]+$' and char_length(image_path) <= 400));
