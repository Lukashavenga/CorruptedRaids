# Deploying

## Almost nothing is hosted

The game server does not belong on the internet. It runs on the streamer's PC,
where OBS and Streamer.bot already are:

| | Where | Cost |
|---|---|---|
| Game server | `localhost:8787` | — |
| Overlay | OBS browser source -> `http://localhost:8787/?sim=0` | — |
| Admin panel | localhost. **Never exposed.** | — |
| `!join`, Bits, channel points | Streamer.bot -> `POST http://localhost:8787/command` (P5, **not built yet**) | — |
| `content/` | files in the repo | — |
| **Loadout** | the only hosted piece | free tier |

This removes the whole class of problem the earlier "host everything on
Fly.io" plan was built around: no deploys of the game process, no volume, no
single-machine constraint to defend, no SSE dropped by a redeploy, no admin
surface on the internet, no "content edited in production is lost on the next
deploy". The overlay's latency goes to zero because it is a loopback request.

`Dockerfile` and `fly.toml` are kept as a fallback for the day the game server
should run somewhere else. They are not the plan — see the bottom of this file.

## Why the loadout can be serverless when the game server cannot

The game server needs timers, a held-open SSE stream and in-memory run state.
The loadout needs none of that — equip an item, spend a point, buy from the
shop, respec, are all request/response — so it is a static site plus:

- **Auth** — Supabase Auth's Twitch provider, called directly from the
  browser (`web/src/loadout/identity.ts`). The loadout never talks to the game
  server for this or anything else; it works while the stream is offline.
- **Data** — Supabase Postgres, one row per character (`sql/001_roster.sql`).
- **Mutations** — a Supabase Edge Function (`supabase/functions/character`)
  running the real `GameEngine` to validate them. Row level security decides
  *which row* a viewer may touch; it cannot decide whether the values in it
  are legal, so writes go through the function and reads go through RLS.

The local game server is a second, independent client of the same tables: it
loads the roster at boot and upserts back only the characters it changed, so a
viewer's phone edit mid-stream is never clobbered by the server's own save
(`npm run test:store` asserts this). It also never deletes implicitly, and it
flags characters `in_run` while they're mid-fight so the loadout refuses edits
until the beat is over.

---

## Setup checklist

Everything below is a one-time, by-hand step. Nothing here can be scripted
from inside this repo — they all need an account you own.

### 1. Supabase project

1. Create a project at supabase.com.
2. Run `sql/001_roster.sql` in its SQL editor. It creates `characters` and
   `roster_snapshots`, enables RLS, and adds the one policy viewers get
   (read their own character — see the file for why there's no write policy).
3. **Authentication → Sign in / Providers → Twitch**: open its settings panel
   (don't enable or save yet — Supabase won't let you save it enabled without
   a Client ID and Secret, and you don't have those yet). The panel shows the
   callback URL you need for the next step even before you've filled anything
   in.
4. **Authentication → URL Configuration → Redirect URLs**: add the loadout's
   own URL (the Cloudflare Pages domain from step 4) once you have it. This is
   where `signInWithOAuth`'s `redirectTo` is allowed to send someone back to.

### 2. Twitch developer app

At `dev.twitch.tv/console/apps`, register an application. The OAuth Redirect
URL is **Supabase's callback**, not this repo's:

```
https://<your-project-ref>.supabase.co/auth/v1/callback
```

(Exact value is on the Twitch provider's config screen you opened in step
1.3 — copy it from there rather than guessing the project ref.) Paste the
resulting Client ID and Secret into that same panel, then toggle it enabled
and save — only now can it actually be turned on.

There is no more Twitch app registration on this repo's side. An earlier
version of this game ran its own OAuth flow on the local server
(`src/server/twitch.ts`, `/auth/twitch*`) for a plan where the game server
served the loadout itself; that flow is gone now that the loadout talks to
Supabase directly, and it has been deleted from the code.

### 3. Bundle content and deploy the Edge Function

```bash
npm run deploy:fn        # bundle:edge, then `supabase functions deploy character`
```

The Supabase CLI ships with the repo (a dev dependency), so there is nothing
to install globally — but it does need `npx supabase login` once, with an
access token from your Supabase account.

Bundling and deploying as one script is deliberate: they are two halves of one
change, and deploying without re-bundling ships the PREVIOUS content with the
new code. `npm run test:edge` fails when the checked-in bundle has drifted
from disk, which is the other half of the same guard.

The function needs exactly one secret set by hand — `LOADOUT_ORIGIN`, the
loadout's own origin, which it returns as its CORS header. (Supabase injects
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into every Edge Function
automatically.) Not `*` — the function serves credentialed requests, and `*`
is refused for those by the browser and wrong besides. `verify_jwt` should
stay on (the default); the function trusts the Twitch id in the token
specifically because the platform already verified it.

You don't have that domain yet at this point — step 4 creates it. Either come
back here after step 4, or do step 4 first (Cloudflare Pages hands you a
`*.pages.dev` domain as soon as the project is created, before the build even
has to succeed). Once you know it:

```bash
supabase secrets set LOADOUT_ORIGIN=https://<your-pages-domain>
supabase functions deploy character
```

Until that's set correctly, every call the loadout makes is CORS-blocked.

**Re-run `npm run bundle:edge` and redeploy after changing gear, prices, or
`content/balance.json`.** The bundle is what the loadout renders *and* what
the function validates against, generated from the same `content/` the game
server reads live — so re-running it is what keeps the three from disagreeing.
`npm run test:edge` fails when the checked-in bundle has drifted from disk.

### 4. Build and deploy the loadout

The Vite app in `web/` builds all three pages (overlay, loadout, admin) into
one output directory, `overlay/`, because it's one project with three entry
points (`web/vite.config.ts`). Point Cloudflare Pages at this repo:

| Setting | Value |
|---|---|
| Build command | `npm install && npm run install:web && npm run bundle:edge && npm run build:web` |
| Build output directory | `overlay` |
| Root directory | repo root |

Build-time environment variables (Pages project settings, not secrets — a
publishable key is meant to be public, RLS is what actually protects the data):

    VITE_SUPABASE_URL              https://<your-project-ref>.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY  sb_publishable_… — never the secret key

Supabase is retiring the `anon` / `service_role` JWTs by the end of 2026 in
favour of `sb_publishable_…` / `sb_secret_…`. Both still work; a legacy `anon`
JWT goes in the same variable. It was called `VITE_SUPABASE_ANON_KEY` before
that rename and the old name is still read as a fallback, so an existing Pages
deployment keeps working.

The loadout's URL is `https://<your-pages-domain>/loadout.html` — deploying
`overlay/` also publishes `index.html` (the OBS overlay) and `admin.html` at
that same domain, since all three share one build. That's harmless: both are
static shells that only do anything when talking to `localhost:8787`, which
the public internet cannot reach — but it means the loadout is not at the bare
domain root, it's at `/loadout.html`.

Now go back and, if you haven't yet, use that domain for the two things that
needed it: Supabase's redirect URL allowlist (step 1.4), and the function's
`LOADOUT_ORIGIN` secret (step 3). Sign-in fails without the first; every call
the loadout makes is CORS-blocked without the second.

### 5. Point the local server at Supabase

On the streamer's PC, in `.env` (start from `.env.example`):

```
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<the SECRET key (sb_secret_…) — never the publishable one, never a browser>
```

`npm run serve` and `npm run start` load this file via Node's
`--env-file-if-exists`, so a fresh clone with no `.env` still boots — it just
uses the local file roster instead.

The server logs which store it chose at boot: `Roster: N character(s) from
Supabase` or `from file (/data)`. Without these two set, the local game and
the hosted loadout have two separate rosters that never sync — set them
before going live.

**To run the loadout locally against the same project**, it needs its own
pair — the browser cannot use the service key:

```bash
cp web/.env.example web/.env     # then fill in the URL + publishable key
npm run dev:web
```

Vite INLINES these at build time, so changing either one needs a restart of
`dev:web` or a fresh `build:web`. Nothing re-reads them at runtime.

**You do not need Cloudflare Pages to test the loadout.** `dev:web` serves it
at `http://localhost:5173/loadout.html`, and that is a perfectly good origin
for both of the places step 1 and step 3 asked for a domain:

| Where | Value for local testing |
|---|---|
| Supabase → Authentication → URL Configuration → Redirect URLs | `http://localhost:5173/loadout.html` |
| `supabase secrets set LOADOUT_ORIGIN=` | `http://localhost:5173` |

Add the Pages domain alongside them when you deploy for real — the redirect
allowlist takes several entries, so local and hosted can coexist. That breaks
the chicken-and-egg in steps 1.4 and 3, where each seems to want a domain you
do not have yet.

### 5b. Check it before you trust it

```bash
npm run check:supabase
```

Walks the whole path in order and stops at the first thing actually broken:
keys present and of the right KIND (publishable vs secret, and it recognises
both the current `sb_…` keys and the legacy JWTs, so "you pasted the
publishable key into the secret slot" is caught by name), both tables created,
row level security actually protecting `characters`, the function deployed,
and `LOADOUT_ORIGIN` set to something a browser will accept. It prints no
secrets and writes nothing.

Every one of those fails the same way from outside — a spinner, or an empty
character — which is why this exists rather than a paragraph telling you to
check carefully.

`npm run test:store` is the heavier follow-up: it round-trips a real
character through Supabase.

### 6. OBS

Add a Browser Source pointing at:

```
http://localhost:8787/?sim=0
```

`?sim=0` hides the sim control strip — a testing harness, not part of the
broadcast. Size it **450 × 320** to match `STAGE_W`/`STAGE_H`
(`web/src/stage.ts`); at that size the overlay renders pixel-for-pixel with no
scaling.

### 7. Chat and channel points — not yet

`!join`, `!left/!up/!right` and channel-point/Bits redemptions all depend on
Streamer.bot hitting `POST localhost:8787/command` (P5) and the EventSub
listener (P6). Neither is built. There is nothing to configure here yet;
until then, joins happen through the admin panel or the sim harness.

---

## Local `.env`

See `.env.example` for the full list with reasoning. The short version:

- `ADMIN_SECRET` — set it always. Every write endpoint refuses to run without
  it, on purpose.
- `SESSION_SECRET` — set it, or every restart signs viewers out.
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — set both once you've done the
  checklist above; unset, the roster is a local file (`DATA_DIR`, default
  `./data`) and never syncs with the loadout.
- `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS`, `ALLOW_DEV_LOGIN` — leave unset for
  normal local use. They matter only for the Fly/Docker fallback below, or for
  testing a viewer-scoped command by hand without Twitch.

## Backups

The admin panel's snapshot endpoints are the manual path, run against the
local server:

```bash
curl -X POST http://localhost:8787/admin/roster/snapshot \
  -H "X-Admin-Secret: $ADMIN_SECRET" -H 'Content-Type: application/json' \
  -d '{"label":"before stream"}'
```

A restore snapshots what it is about to replace first, so restoring the wrong
one costs a click rather than a channel. If `SUPABASE_URL` is set, this
snapshots the Supabase-backed roster; otherwise it snapshots the local file.

## The Fly/Docker fallback (not the current plan)

`Dockerfile` and `fly.toml` exist for the day the game server itself needs to
run somewhere other than the streamer's PC — a fundamentally different
decision (ONE always-on machine, a volume for the roster, `PUBLIC_ORIGIN`
suddenly meaning something) and not one this game currently needs. If that day
comes: the Dockerfile already chowns `/data` to the `node` user before
declaring the volume (a root-owned volume under a non-root process silently
dropped every write and lost a full roster once — do not remove that fix or
the boot-time write-probe in `src/server/index.ts` that now exits on
`EACCES`/`EPERM`/`EROFS`/`ENOSPC` instead of logging and continuing).

## What is still open

- **`content/` is edited on whichever filesystem the game server runs on.**
  Locally that's this repo, so admin edits just are the source of truth. Only
  the Fly fallback above turns this into a problem (a redeploy ships the
  image's copy, discarding live edits) — one more reason it isn't the plan.
- **Chat is not wired** (P5) — `!join` and `!left/!up/!right` have no listener.
- **No redemptions yet** (P6).
