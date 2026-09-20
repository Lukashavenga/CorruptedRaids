-- Characters, shared between the loadout (hosted) and the game server (local).
--
-- Run this once in the Supabase SQL editor.
--
-- ONE ROW PER CHARACTER, and that is the whole point of this file.
--
-- The first version stored the entire roster as a single JSON blob, which was
-- right when only the game server touched it: `save()` replaced the roster
-- wholesale and one row made that atomic. It becomes wrong the moment a viewer
-- can edit their gear on their phone while the server has the roster in
-- memory, because the server's next save would write the whole blob back and
-- silently undo them. Per-row, the server upserts only the characters it
-- actually changed and a phone edit to a different character cannot collide.

create table if not exists public.characters (
  -- The engine's viewer id, e.g. "twitch:12345678". Namespaced because the
  -- roster also holds `sim:` viewers from the testing harness.
  id          text primary key,

  -- The numeric Twitch id on its own, which is what RLS matches against. Kept
  -- as a column rather than parsed out of `id` in the policy: a policy that
  -- does string surgery is a policy nobody can read, and this is the one place
  -- getting it wrong hands someone another player's character.
  twitch_id   text,

  -- The whole Character object (see src/engine/types.ts). Deliberately not
  -- shredded into columns: the shape is the engine's business and it changes
  -- with the game, whereas this table only has to store and return it.
  data        jsonb not null,

  -- True while this character is in a live fight. The loadout refuses edits
  -- while it is set — otherwise a viewer could unequip their armour between
  -- the resolver reading their stats and the fight ending, and the result on
  -- screen would not match the character anyone can see.
  in_run      boolean not null default false,

  updated_at  timestamptz not null default now()
);

create index if not exists characters_twitch_id_idx on public.characters (twitch_id);

-- Snapshots stay whole-roster. A snapshot is a point in time you can return
-- to, so partial ones would be useless — and nothing edits them concurrently.
create table if not exists public.roster_snapshots (
  id         text primary key,
  label      text,
  characters jsonb not null,
  taken_at   timestamptz not null default now()
);

create index if not exists roster_snapshots_taken_at_idx
  on public.roster_snapshots (taken_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The game server connects with the SERVICE ROLE key and bypasses all of this
-- by design. These policies exist for the LOADOUT, which reaches Supabase with
-- the viewer's own token.
-- ---------------------------------------------------------------------------

alter table public.characters enable row level security;
alter table public.roster_snapshots enable row level security;

-- Snapshots get no policies at all: they are the operator's backups and a
-- viewer has no business reading a dump of every character in the channel.

-- A viewer may READ their own character.
--
-- Supabase's Twitch provider puts the Twitch user id in the JWT as
-- `user_metadata.provider_id`. Matching on that rather than on `auth.uid()`
-- keeps the id the game already uses — the one Streamer.bot sends with a
-- !join — as the single key, instead of introducing a second identity that
-- then has to be reconciled with the first.
drop policy if exists "read own character" on public.characters;
create policy "read own character" on public.characters
  for select
  using ( twitch_id = (auth.jwt() -> 'user_metadata' ->> 'provider_id') );

-- Deliberately NO insert/update/delete policy for viewers.
--
-- Row level security decides WHICH ROWS you may touch. It cannot decide
-- whether the values are legal, so a viewer with write access could set their
-- own unspent points to 999 and the database would be right to allow it. Every
-- mutation goes through the Edge Function, which runs the real engine
-- validation with the service key. Read-your-own here, write through code.
