-- Trusted Picks: each shop page is the business's own website, in a style the owner picks.
-- site_style: which homepage template (null = the default for its business type).
-- tagline: one line in the owner's words, shown at the top of the site.
alter table public.places add column if not exists site_style text;
alter table public.places add column if not exists tagline text;
do $$ begin
  alter table public.places add constraint places_site_style_check
    check (site_style is null or site_style in ('classic', 'noir', 'glass', 'editorial', 'pop'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.places add constraint places_tagline_len check (tagline is null or char_length(tagline) <= 120);
exception when duplicate_object then null; end $$;
grant select (site_style, tagline) on public.places to anon, authenticated;
