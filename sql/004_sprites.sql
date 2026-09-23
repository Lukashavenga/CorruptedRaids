-- Erased sprites, hosted.
--
-- Run this in the Supabase SQL editor like the others. Additive, re-runnable.
--
-- WHY THIS EXISTS
-- ---------------
-- The admin eraser rewrote PNGs in art/sprites through the game server, so an
-- erase could only be made at one machine and only reached players when that
-- machine committed and deployed. Positions and masks already moved into
-- content_files (003); this is the same move for the pixels.
--
-- NOTHING IS OVERWRITTEN. Every erase is uploaded as a NEW object named by the
-- time it was made, and `sprites.json` (a content_files row) says which object
-- each sprite currently draws. So:
--   - the untouched original is the sliced art already in the build, or, for
--     the sprites erased before this existed, an `original.png` uploaded
--     beside them;
--   - reverting is a manifest edit, never a delete;
--   - any older erase is recoverable, because every manifest write files the
--     previous manifest in content_history (the 003 trigger).

-- PUBLIC, because players' browsers draw these directly. Everything in it is
-- art the site already serves; nothing here is a secret. Writes need the
-- service key, which only the operator function and the game server hold.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sprites', 'sprites', true, 2097152, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- READ ACCESS TO TWO ROWS, for everyone.
--
-- 003 deliberately gave content_files no policies, because the raw store holds
-- loot tables with exact drop weights. These two rows hold no such thing:
-- placements.json is where art sits on a body and sprites.json is which PNG to
-- draw, and every player's browser needs both to draw a character correctly.
-- Scoped by path, so the rest of the store stays exactly as private as it was.
drop policy if exists content_files_public_art on public.content_files;
create policy content_files_public_art on public.content_files
  for select to anon, authenticated
  using (path in ('placements.json', 'sprites.json'));

grant select on public.content_files to anon, authenticated;

-- The manifest's two writes, as functions so each is ONE statement.
--
-- Read-modify-write from the caller would lose an erase whenever two saves
-- overlapped - the second writer's copy of the manifest predates the first
-- one's entry. A single UPDATE cannot interleave that way. Both writers (the
-- operator function and the game server) call these, so the rule lives once.

create or replace function public.sprites_set(p_key text, p_entry jsonb, p_by text)
returns jsonb
language sql
as $$
  insert into public.content_files as cf (path, data, updated_at, updated_by)
  values ('sprites.json', jsonb_build_object(p_key, p_entry), now(), p_by)
  on conflict (path) do update
    set data = cf.data || jsonb_build_object(p_key, p_entry),
        updated_at = now(),
        updated_by = p_by
  returning data;
$$;

-- Back to the original. A sprite with an uploaded `original` points at it;
-- one without has its original in the build, so its entry is simply dropped.
-- Either way the erased objects stay in the bucket.
create or replace function public.sprites_revert(p_key text, p_by text)
returns jsonb
language sql
as $$
  update public.content_files
    set data = case
          when data -> p_key ? 'original'
            then jsonb_set(data, array[p_key, 'file'], data -> p_key -> 'original')
          else data - p_key
        end,
        updated_at = now(),
        updated_by = p_by
    where path = 'sprites.json'
  returning data;
$$;

-- PostgREST exposes every function in `public` to every role unless told
-- otherwise, and these write. Service role only.
revoke execute on function public.sprites_set(text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.sprites_revert(text, text) from public, anon, authenticated;
grant execute on function public.sprites_set(text, jsonb, text) to service_role;
grant execute on function public.sprites_revert(text, text) to service_role;
