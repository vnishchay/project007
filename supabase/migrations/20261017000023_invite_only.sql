-- Trusted Picks: connections are invite-only. Nobody can find people by name or from
-- suggestions, and you can only follow someone who is already your friend through a link.
revoke execute on function public.find_people(text, integer) from public, anon, authenticated;
revoke execute on function public.suggested_people(bigint, integer) from public, anon, authenticated;

drop policy if exists "follow" on public.follows;
create policy "follow" on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and exists (
    select 1 from public.friendships f where f.user_id = auth.uid() and f.friend_id = follows.followee_id));
