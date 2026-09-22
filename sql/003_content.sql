-- Content, in the database instead of on one person's disk.
--
-- Run this in the Supabase SQL editor like the others. Additive, re-runnable.
--
-- WHY THIS EXISTS
-- ---------------
-- Every authoring surface in the admin panel wrote a file in the repo through
-- the game server: gear stats, dungeons, raids, names, placements. That made
-- the panel local-only, which made it unusable from anywhere but the one
-- machine - and worse, it put the only copy of hours of work on a disk with no
-- history, behind a save path that could fail silently. Mask work was lost
-- exactly that way.
--
-- The roster already solved this. It used to be data/roster.json and now lives
-- in `characters`, with the game server reading at boot and writing behind. A
-- file per row, keyed by the path it used to have, is the same move for
-- content.
--
-- ONE ROW PER FILE, not a normalised schema of gear and dungeons. The shapes
-- are already validated by the engine's own loader (src/engine/content/
-- schemas.ts) and change whenever a field is added; encoding them as columns
-- would mean a migration every time somebody adds a stat, and two definitions
-- of the same thing that can disagree. The database's job here is durability
-- and history, not re-describing the game.

create table if not exists public.content_files (
  -- The repo-relative path this row replaces: "gear/rusty-dagger.json",
  -- "dungeons/barbie.json", "placements.json". Keeping the path as the key
  -- means the seed, the server and the bundler all address content the same
  -- way they did when it was a directory, and a row maps back to a file
  -- without a lookup table.
  path text primary key,

  -- The file's contents. jsonb rather than text so a malformed write is
  -- rejected by the database rather than discovered by the game at boot.
  data jsonb not null,

  updated_at timestamptz not null default now(),
  -- Who last wrote it, as a Twitch id. Not for access control - the operator
  -- function decides that - but so a change that breaks a fight can be traced
  -- to a person and a time.
  updated_by text
);

create index if not exists content_files_updated_at_idx
  on public.content_files (updated_at desc);

-- HISTORY, because the whole reason this table exists is that work was lost.
--
-- Every write appends the PREVIOUS contents here first. That makes an
-- accidental overwrite recoverable by whoever notices, rather than by whoever
-- happens to have the right file still open in a browser tab - which was the
-- actual recovery plan last time, and it failed.
create table if not exists public.content_history (
  id bigserial primary key,
  path text not null,
  data jsonb not null,
  replaced_at timestamptz not null default now(),
  replaced_by text
);

create index if not exists content_history_path_idx
  on public.content_history (path, replaced_at desc);

-- The trigger, so history cannot be forgotten by a caller.
--
-- In the database rather than in the function that writes: a second writer
-- added later - a script, a migration, a person in the SQL editor - gets the
-- same protection without having to remember it. The thing being protected
-- against is exactly somebody not remembering.
create or replace function public.content_files_keep_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.data is distinct from new.data then
    insert into public.content_history (path, data, replaced_by)
    values (old.path, old.data, old.updated_by);
  end if;
  return new;
end;
$$;

drop trigger if exists content_files_history on public.content_files;
create trigger content_files_history
  before update on public.content_files
  for each row execute function public.content_files_keep_history();

alter table public.content_files enable row level security;
alter table public.content_history enable row level security;

-- NO POLICIES AT ALL, on either table.
--
-- Content is read by the game server and the operator function, both of which
-- hold the service key and bypass RLS. A viewer has no business reading the
-- raw content store: the loadout already gets everything it needs as a
-- published bundle, and the bundle is deliberately trimmed - it does not carry
-- loot tables with exact drop weights. Granting a read here would quietly
-- publish them.
