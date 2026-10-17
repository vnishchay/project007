-- Trusted Picks: "could be better" review tags, so a review can say what was good and what wasn't.
-- The app groups tags by these labels; no column change needed.
insert into public.tags (label, kinds) values
  ('Small portion', '{food}'), ('Not fresh', '{food}'), ('Served cold', '{food}'), ('Too oily', '{food}'),
  ('Rude staff', null), ('Not clean', null), ('Long wait', '{beauty,health,services,food}'),
  ('Poor quality', '{store,services}'), ('Damaged item', '{store}'), ('Pushy selling', '{store,beauty,fitness}'),
  ('Late', '{beauty,health,services,education}'), ('Overcharged', '{services,beauty,health}'),
  ('Rushed', '{health,beauty,education}'), ('Old equipment', '{fitness}')
on conflict (label) do nothing;
