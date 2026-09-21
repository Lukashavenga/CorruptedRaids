-- Bug reports from the loadout.
--
-- Run this in the Supabase SQL editor the same way as 001_roster.sql. It is
-- additive and safe to re-run.
--
-- WHY VIEWERS MAY INSERT HERE, WHEN THEY MAY NOT INSERT A CHARACTER
-- -----------------------------------------------------------------
-- 001_roster.sql gives viewers read-their-own and no write at all, because row
-- level security decides WHICH ROW you may touch and cannot decide whether the
-- values in it are legal — a viewer with write access to their character could
-- set their own unspent points to 999 and the database would be right to allow
-- it. Every character mutation therefore goes through the Edge Function, which
-- runs the real engine validation.
--
-- A bug report has no such legality. It is free text from a person about their
-- own experience; there is no rule the engine could check it against and no
-- state it can corrupt. So the whole reason for routing writes through code
-- is absent, and a direct insert under RLS is the honest shape. What RLS is
-- still doing is real: it pins `twitch_id` to the caller's own token, so a
-- report cannot be filed in someone else's name.

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),

  -- The reporter, as the same Twitch id the rest of the game keys on, so a
  -- report joins to a character without a second identity to reconcile.
  twitch_id text not null,
  -- Denormalised on purpose: the display name AT THE TIME OF REPORTING. A
  -- viewer who renames should not make an old report harder to place.
  handle text,

  -- What they said.
  message text not null,

  -- Context they should never be asked to supply.
  --
  -- `build` is the single most valuable column here: without it, "the chest
  -- did not open" cannot be told apart from "the chest did not open in a build
  -- we fixed a week ago". web/src/build.ts stamps it automatically.
  build text,
  -- Which screen they were on, and what they were using. Both are attached by
  -- the client; neither is worth interrogating a viewer for.
  page text,
  user_agent text,

  created_at timestamptz not null default now(),

  -- A bound, not a validation. Long enough for a real description, short
  -- enough that the table cannot be used as free storage.
  constraint bug_reports_message_length check (char_length(message) between 1 and 4000)
);

-- Triage order. Reports are read newest-first and almost never by id.
create index if not exists bug_reports_created_at_idx
  on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

-- A viewer may FILE a report, as themselves.
--
-- `with check` rather than `using`: this is an insert, so there is no existing
-- row to test — the check runs against the row being written, and pins its
-- twitch_id to the one in the caller's own token. Matching on
-- `user_metadata.provider_id` for the same reason 001_roster.sql does.
drop policy if exists "file own bug report" on public.bug_reports;
create policy "file own bug report" on public.bug_reports
  for insert
  to authenticated
  with check ( twitch_id = (auth.jwt() -> 'user_metadata' ->> 'provider_id') );

-- Deliberately NO select policy.
--
-- Reports are read by the operator with the service key, which bypasses RLS.
-- Letting a viewer read even their own back sounds harmless and is not: the
-- message column is free text people paste session details into, and a table
-- with no read path cannot leak one report into another account's hands
-- through a policy written slightly wrong later.
