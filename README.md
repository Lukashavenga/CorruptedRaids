# Corrupted Raids

A Twitch viewer-engagement game rendered as an OBS browser source. Viewers own
a persistent character, level it, gear it, and join dungeon runs alongside
everyone else watching. The fight resolves itself on stream.

**This file is how to run it. [AGENTS.md](AGENTS.md) is how it works and why** -
the design decisions, the balance model, and the traps. Read that one before
changing anything.

No Twitch integration yet, on purpose: `GameCommand` in
`src/engine/commands/types.ts` is the seam it plugs into.

The engine (`src/`) has zero runtime dependencies - Node 18+, TypeScript, and
`tsx`. The three web pages (`web/`) are a React + Vite app with its own
`package.json`, importing engine types directly.

## Quick start

```bash
npm install          # engine deps (typescript + tsx, both dev-only)
npm run install:web  # React + Vite, separate package.json in web/
npm run build:web    # builds the five pages into overlay/
npm run serve        # http://localhost:8787
```

`build:web` must run once before `serve` has anything to serve - `overlay/` is
build output, not hand-written HTML.

Three pages, all on 8787:

| URL | For |
|---|---|
| `/` | the OBS browser source - add this one to OBS |
| `/loadout.html` | a viewer's character, gear and shop |
| `/admin.html` | dungeon authoring and balancing (hosted: behind the edge gate) |

Append `?sim=0` to the overlay URL to hide the sim-control strip on stream.

**Only the loadout is published.** The hosted copy lives at
<https://corrupted.coster.im/loadout>, and the overlay and admin pages are
dropped from the upload rather than being served to the internet with nothing
to talk to (`scripts/publish-web.ts` says why). Two things follow from that and
are easy to trip over:

- Hosted, the page is `/loadout`, not `/loadout.html`. Cloudflare strips the
  extension, and `redirectTo` is built from the path, so the Supabase redirect
  allowlist has to match the stripped form. Wildcards avoid the question.
- The hosted page is a STATIC site with no game server behind it. Anything the
  loadout fetches from a server path has to be shipped as a file as well, or it
  silently falls back: `/placements` and the shop's prices have both been that
  bug. See DEPLOY.md section 4.

The fastest look at the engine needs no server at all:

```bash
npm run simulate
```

### Developing the web pages

```bash
npm run dev:web
```

Vite with hot reload, proxying `/state`, `/content`, `/events` and `/command`
to `serve` on 8787 (see `web/vite.config.ts`), so run both at once.

`tsx` has no watch mode here - changes under `src/` need a server restart.

### Driving a run by hand

```bash
curl -X POST http://localhost:8787/command -H "Content-Type: application/json" -d '{"type":"open_dungeon","dungeonId":"tillage-hamlet"}'
curl -X POST http://localhost:8787/command -H "Content-Type: application/json" -d '{"type":"sim_join","count":10}'
curl -X POST http://localhost:8787/command -H "Content-Type: application/json" -d '{"type":"start_dungeon"}'
```

`open_dungeon` opens a join window; viewers arrive as `join_dungeon` commands
(`sim_join` fakes them); `start_dungeon` locks the roster and resolves the
fight. If nobody starts it, the window times out and starts itself. On stream
the same thing arrives as a channel-point redeem (`POST /redeem`, which opens a
random dungeon) and `!join` in chat (`POST /chat`) - see DEPLOY.md step 7.

## Content

Everything the game is made of is JSON under `content/`, validated at load:
119 gear pieces, 9 encounters, 5 dungeons, 4 consumables, 1 raid, and
`balance.json` holding every tunable number. Add a field to the schema in
`src/engine/content/schemas.ts` in the same commit you add it to a file.

## Art

Sliced from artist-supplied sheets - there is no live generator.

```bash
npm run slice      # gear, hands, encounter sprites
npm run slice:ui   # the UI chrome sheet
npm run gen:font   # the bitmap display font
```

Slicing traces connected shapes rather than reading a grid, so a redrawn sheet
slices itself. AGENTS.md §7 covers the two ways this has gone wrong before.

**`slice` REFUSES to run when it would discard eraser edits.** Re-slicing
rebuilds each sprite from its source sheet, which silently undoes anything
rubbed out in the admin tool's Sprite Eraser, and those edits are not
recoverable afterwards: `_original` holds the PRE-edit copy, so reverting hands
back the un-erased sprite rather than the edit. The script names what is at
risk and needs `--force` to go ahead anyway. This is not hypothetical; 81
erases were lost to it once.

**Erases live in Supabase now, not in `art/sprites`.** Since
`sql/004_sprites.sql` every erase is saved as a new object in the public
`sprites` bucket, and `sprites.json` in the content store says which one each
sprite draws - so an erase is live for players on their next page load and a
re-slice no longer touches it. The files on disk are only the fallback for a
checkout with no Supabase. `npm run push:sprites` uploaded the 81 disk-era
erases once; it skips anything already in the manifest.

## Verification

```bash
npm.cmd run typecheck && npx.cmd tsc --noEmit -p web/tsconfig.json && npm.cmd run build:web && npm.cmd run check:text && npm.cmd run check:hosted && npm.cmd run simulate
```

On Windows use `npm.cmd` / `npx.cmd`.

All of it is green. `simulate` used to fail one assertion from `cops.json`'s
seasoned-band tuning; that is fixed, so a failure here is now a real one.

## Shipping

```bash
npm run deploy      # publish:web, then wrangler pages deploy
npm run deploy:fn   # re-bundle content and deploy the Supabase Edge Function
```

`deploy` filters the build before uploading: only the loadout goes up. Run
`build:web` first, and run `deploy:fn` in the same breath whenever gear,
prices or `content/balance.json` changed, because the loadout renders from
that bundle and the function validates against it. DEPLOY.md is the full
checklist.

```bash
npm.cmd run chests -- twitch:<id>   # 5 test chests, one of each rarity
```

Loot arrives as a sealed chest the player opens. Winning one honestly means
clearing a run and passing a 60% roll, which is the wrong loop to sit in when
what you are testing is a 1.6 second animation.

## Scripts

| | |
|---|---|
| `serve` | the HTTP/SSE server |
| `simulate` | full fight sequence in the terminal |
| `typecheck` | engine types |
| `dev:web` / `build:web` / `install:web` | the web app |
| `check:text` | verifies overlay copy fits its boxes |
| `slice` / `slice:ui` / `gen:font` | art pipeline |
| `gen:placements` | seeds sprite placements |
| `tune:dungeons` / `retier:gear` | balance passes over content |
| `deploy` / `publish:web` | ship the loadout (loadout only, see above) |
| `deploy:fn` / `bundle:edge` | ship the Edge Function and its content bundle |
| `check:supabase` | walks the hosted setup and stops at the first broken thing |
| `test:edge` / `test:store` | engine-in-the-function, and a real Supabase round trip |
| `chests` | grant test chests to a viewer |
| `check:hosted` | refuses a loadout fetch the hosted site cannot answer |
