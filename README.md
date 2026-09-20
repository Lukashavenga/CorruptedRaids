# Corrupted Raids

A Twitch viewer-engagement game rendered as an OBS browser source. Viewers own
a persistent character, level it, gear it, and join dungeon runs alongside
everyone else watching. The fight resolves itself on stream.

**This file is how to run it. [AGENTS.md](AGENTS.md) is how it works and why** —
the design decisions, the balance model, and the traps. Read that one before
changing anything.

No Twitch integration yet, on purpose: `GameCommand` in
`src/engine/commands/types.ts` is the seam it plugs into.

The engine (`src/`) has zero runtime dependencies — Node 18+, TypeScript, and
`tsx`. The three web pages (`web/`) are a React + Vite app with its own
`package.json`, importing engine types directly.

## Quick start

```bash
npm install          # engine deps (typescript + tsx, both dev-only)
npm run install:web  # React + Vite, separate package.json in web/
npm run build:web    # builds the three pages into overlay/
npm run serve        # http://localhost:8787
```

`build:web` must run once before `serve` has anything to serve — `overlay/` is
build output, not hand-written HTML.

Three pages, all on 8787:

| URL | For |
|---|---|
| `/` | the OBS browser source — add this one to OBS |
| `/loadout.html` | a viewer's character, gear and shop |
| `/admin.html` | dungeon authoring and balancing |

Append `?sim=0` to the overlay URL to hide the sim-control strip on stream.

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

`tsx` has no watch mode here — changes under `src/` need a server restart.

### Driving a run by hand

```bash
curl -X POST http://localhost:8787/command -H "Content-Type: application/json" -d '{"type":"open_dungeon","dungeonId":"tillage-hamlet"}'
curl -X POST http://localhost:8787/command -H "Content-Type: application/json" -d '{"type":"sim_join","count":10}'
curl -X POST http://localhost:8787/command -H "Content-Type: application/json" -d '{"type":"start_dungeon"}'
```

`open_dungeon` opens a join window; viewers arrive as `join_dungeon` commands
(`sim_join` fakes them); `start_dungeon` locks the roster and resolves the
fight. If nobody starts it, the window times out and starts itself. These are
stand-ins for a channel-point redeem.

## Content

Everything the game is made of is JSON under `content/`, validated at load:
119 gear pieces, 9 encounters, 5 dungeons, 4 consumables, 1 raid, and
`balance.json` holding every tunable number. Add a field to the schema in
`src/engine/content/schemas.ts` in the same commit you add it to a file.

## Art

Sliced from artist-supplied sheets — there is no live generator.

```bash
npm run slice      # gear, hands, encounter sprites
npm run slice:ui   # the UI chrome sheet
npm run gen:font   # the bitmap display font
```

Slicing traces connected shapes rather than reading a grid, so a redrawn sheet
slices itself. AGENTS.md §7 covers the two ways this has gone wrong before.

## Verification

```bash
npm.cmd run typecheck && npx.cmd tsc --noEmit -p web/tsconfig.json && npm.cmd run build:web && npm.cmd run check:text && npm.cmd run simulate
```

On Windows use `npm.cmd` / `npx.cmd`.

`simulate` currently fails one assertion from `cops.json`'s seasoned-band
tuning — see AGENTS.md §9. Everything else is green.

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
