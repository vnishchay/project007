-- Trusted Picks: never let profile creation block a sign-in.
-- If the profile insert fails for any reason (for example a user who already has
-- a row, or a project shared with other apps), sign-in still succeeds and the
-- app creates the profile on first load through ensure_profile().

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.profiles (id, display_name, phone_hash)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''),
      case when new.phone is not null and new.phone <> ''
           then encode(extensions.digest('+' || ltrim(new.phone, '+'), 'sha256'), 'hex') end
    )
    on conflict (id) do nothing;
  exception when others then
    raise warning 'trusted picks: profile for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $$;
