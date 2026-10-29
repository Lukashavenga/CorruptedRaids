-- The caller's Twitch id, from auth.identities rather than user_metadata.
--
-- 001 and 002 matched on `auth.jwt() -> 'user_metadata' ->> 'provider_id'`,
-- on the reasoning that Supabase's Twitch provider puts the id there. It does,
-- and so can the user: user_metadata is the one part of the token a signed-in
-- account may rewrite itself (`supabase.auth.updateUser({ data: { ... } })`),
-- and the next refreshed token carries whatever it was set to. So "read own
-- character" read any character whose id a caller cared to type. Supabase's
-- advisor flags exactly this ("RLS references user metadata", critical).
--
-- auth.identities.provider_id is written by Supabase Auth from the OAuth
-- provider's own answer and is not reachable from the client, so it is the id
-- that can be trusted. The Edge Functions and the admin gate were moved to the
-- same source in the same change (callerTwitchId / functions/_middleware.ts).
--
-- SECURITY DEFINER because `authenticated` cannot read the auth schema. It
-- answers only for auth.uid(), so the most it can ever tell a caller is their
-- own id. Wrapped in a sub-select in the policies so Postgres evaluates it
-- once per statement rather than once per row.

create or replace function public.current_twitch_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.provider_id
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'twitch'
  limit 1
$$;

revoke all on function public.current_twitch_id() from public, anon;
grant execute on function public.current_twitch_id() to authenticated;

drop policy if exists "read own character" on public.characters;
create policy "read own character" on public.characters
  for select
  to authenticated
  using ( twitch_id = (select public.current_twitch_id()) );

-- bug_reports may not exist on every project (002 is optional), and its
-- insert policy had the same hole: file a report under someone else's id.
do $$
begin
  if to_regclass('public.bug_reports') is not null then
    drop policy if exists "file own bug report" on public.bug_reports;
    create policy "file own bug report" on public.bug_reports
      for insert
      to authenticated
      with check ( twitch_id = (select public.current_twitch_id()) );
  end if;
end $$;
