# AGENTS.md - Corrupted Raids

Written for whoever (or whatever) picks this up next. It is deliberately about
**why**, not **what**: the file tree is discoverable, the reasoning behind it is
not, and most rules below exist because getting it wrong already cost us once.

Read §1 and §2 before changing anything. Read §6 before believing a number.

---

## 1. What the game is

A Twitch viewer-engagement game. The streamer runs an OBS browser source; the
chat plays. Viewers own a persistent character, level it, gear it, and throw it
into dungeon runs alongside everyone else who turned up.

Three surfaces, three separate bundles:

| Page | Who sees it | What it is |
|---|---|---|
| `index.html` | the stream | the OBS overlay - the fight, playing out |
| `loadout.html` | one viewer | their character: stats, gear, shop |
| `admin.html` | the streamer | dungeon authoring and balancing |

They are separate entry points on purpose. The overlay is read at 1080p from
across a room; the loadout is read on a phone. One responsive bundle serving
both would compromise both.

The overlay exists twice. `arena3d.html` (served at `/3d`) is the same surface
with the fight drawn in three dimensions - not a fourth surface, a second
renderer for the first one. See §4, "The 3D arena".

### The shape of a run

A dungeon is **one shared fight**. Everybody who joined is in it together, at
the same time, against one encounter. It is not a party of five, and it is not
a sequence of rooms - those were both considered and dropped.

This matters more than it sounds. It is why headcount has to be handled
carefully (§5), why aggro needs a failure mode (§4), and why the difficulty
solver being single-fight-scoped is a real bug rather than a shortcut (§10).

---

## 2. The three settled questions

These were open and are now closed. Do not silently re-open them; if the design
needs to change, change it deliberately and update this file.

**1. A dungeon is one shared fight.** Not a party dungeon, not multi-room.

**2. Difficulty is levels only. Tiers are retired.** There is no
`DungeonTier`, no `tier` field on a dungeon, no normal/heroic/mythic axis. A
dungeon is *a place*. How hard the night is comes from **who turned up** -
their combined power picks one of six levels, and that level's encounter is
what they fight. One axis, measured, legible.

The six levels, shown to players as `POORS - LEVEL 2`:

    weak · seasoned · elite · brutal · infernal · apocalyptic

**3. Corruption is power; Level is the earned number.**

- **Corruption** = the derived power score. Attributes plus gear, computed. It
  is what the game reads to decide which fight you get. Never stored, always
  derived - a stored copy is a copy that drifts.
- **Level** = what you earn by playing. It grants **2 attribute points** and
  nothing else. It is a progress bar, not a gate.
- **Gear gates on attributes, not level.** `GearDefinition.requires` is a
  `Partial<Record<AllocatableStat, number>>`. A level-80 player who dumped
  everything into Speed cannot wear the heavy plate, and that is the point:
  where the points went is the build, so that is what gear should ask about.

### 4. A dungeon IS a fight. There is no encounter.

`content/encounters/` is gone. A dungeon file now declares its own bodies -
`stats`, `loot`, `goldReward`, `xpReward` as the base every unit is built from,
plus `formations` per band saying who stands where. A unit that differs from
the base overrides it (`stats`, `loot`, `xpReward`, `kind`, `abilities`).

The two used to be separate and the boundary had stopped meaning anything.
Both answered "how many enemies": if an encounter had a formation the dungeon's
`count` was **silently ignored**, and if it did not, `count` won. And an
archetype was SHARED, so authoring a squad for `cops` set the difficulty of
every place cops appear - which is measurably why the ladder was out of order
(Saint's Rest, sixteen roleless bodies, was easier than Marketgate's sixteen
including a role-scaled cop squad, despite carrying more HP).

Raids own their fights the same way, inside ROOMS - see §2.5.

`EnemyDefinition` is what a fight expands INTO - one resolved body, runtime
only, never loaded from disk. `expandFight` builds them, folding the base
block, the unit's overrides and its role scaling together. It was called
`EncounterDefinition` when an encounter was a file; the file is gone and the
name followed the shape.

**`role` on a unit is optional, and that is load-bearing.** A body without one
gets no role scaling, no skill floor and threat multiplier 1 - genuinely
weaker. Every counted body in the game was one, so the migration kept them
roleless and every fight measured identically before and after. The admin
shows them as "Plain". Assigning roles makes fights harder; do it deliberately
and re-measure.

### 5. A raid door opens onto a ROOM, and the room is revealed before it is entered.

`doorTable` and `fightPool` are gone. A raid declares `rooms: RaidRoom[]` - each
a place with an `id`, a `name`, a one-line `description`, a `kind`
(fight/buff/clear), an optional `background`, and the `fight` or `buffId` it
holds. `boss` is one more room, with two multipliers: it is never chosen, it is
arrived at.

**THE PATH IS AUTHORED.** `path: RaidStep[]` names what is behind Left, Ahead
and Right for every round, and the number of rounds IS that list's length -
there is no separate count to keep in step with it. Rooms carried a `weight`
and doors were rolled from it; that is gone. The trade was made deliberately
and it is real: two runs of a raid are now identical, and the variety that
bought is spent on the streamer being able to say what a night looks like
before it happens.

What did NOT change is the audience's side. `RaidView` still withholds a
door's `kind` until it is opened, so a chat vote is exactly as blind as it was.
The person authoring the raid is simply no longer guessing too.

A room nothing points at is never seen. The loader warns rather than failing -
parking a room mid-edit is normal - and the admin marks it, because the old
model made this visible as a zero weight and this one hides it completely.

The old model could say "fights are 50% likely" but not WHICH fight, and a
fight had no name, no line and no scene. So there was nothing to add in the
admin and nothing to reveal on the overlay - a fight door went from three
closed doors straight to a resolved combat, and the one moment the choice paid
off was the one moment there was nothing to look at. Per-kind odds are still
expressible: they are the sum of that kind's room weights, and the migration
reproduced the shipped table exactly.

**Opening a door and fighting what is behind it are two beats.** `choose_path`
only opens the door and sets `run.pendingRoomId`; the reveal plays; then
`enter_room` runs the fight. `reveal` carries both the pre-fight look and the
boon/corridor beat, and the TIMER'S EVENT tells them apart - a fight room
enters `reveal` with `timerEventOverride: "roomEntered"`, everything else keeps
`revealElapsed`. That is what `timerEventOverride` is for, and it is why this
did not need a sixth state duplicating the whole hold.

Two ordering rules, both bugs found the hard way:

- **The round advances when the beat ENDS, not when the door opens.**
  `advanceRound` clears the revealed room and, on the last round, replaces it
  with the boss - so advancing eagerly left a boon or corridor with nothing to
  reveal by the time the overlay drew a frame.
- **A survived door fight stays in `combat` while its replay plays.** It used
  to leave for `reveal` the instant the resolver returned, and the overlay only
  draws the arena in `combat` and `results` - so door fights were never shown
  at all. `fightPlaying` is a self-transition that re-arms the hold once the
  replay length is known.

**Chat's vote opens the door, on a timer.** `choosing` holds for
`CHOICE_WINDOW_MS` (20s) and then opens whichever door has the most votes - a
tie is broken at random among the tied doors, and a window nobody voted in
opens one at random, because a stream cannot stall on a decision nobody makes.
The vote lives on `DungeonController` (`src/state/pathVote.ts`), not in the
server: it used to be a tally in the HTTP layer that the operator read and
then clicked for, and a thing the state machine acts on has to be where the
simulator can reach it. The timer dispatches an ordinary `choose_path`, so an
operator clicking a door early and chat voting for one are the same command.
Only the party may vote - the door decides what they fight, so it is theirs.
Twenty seconds rather than fifteen is stream delay: viewers see the doors
several seconds late.

**A raid is active or it is not, and new ones start off.** `enabled: false`
on a raid takes it out of rotation: a redeem never rolls it (`inRotation` in
`src/server/chat.ts`) and the bestiary does not list it, but the operator can
still open it by hand - that is how a raid gets watched once before chat is let
at it. Absent means active, so nothing written before the flag existed changed.
The Raids tab creates, duplicates and deletes raids; a new or duplicated one is
saved inactive, and the switch refuses to turn on over an empty boss room,
because an active raid with nobody in its last room is a night that ends in a
fight against no one. Delete is local-only like every other delete; hosted, set
it inactive instead.

The admin's Raids tab edits both halves: the rooms, and the path that strings
them together. A room the path still points at cannot simply be deleted - the
doors that led there are repointed, because dropping the step would silently
change how long the raid is.

**The path is a list of room ids, so anything that changes an id has to walk
it.** Renaming a room's id in the tab used to leave its doors on the old one,
and the raid then could not be saved - `path[0].up points at "first-passage",
which is not one of its rooms` - with nothing on screen to explain it, because
a dropdown whose value matches none of its options draws the first option. The
rename follows the path now, a door with no room says so, and the tab lists
what would be refused (`raidProblems`, one line per `fail` in the loader)
before Save rather than after.

**A boon is what a shrine gives, and the tab calls them two things.** A `buff`
room is a Shrine on the authoring screens; a boon (`RaidBuff`) is a flat stat
bonus on every party member for the rest of the run, boss included. Boons are
edited in the Raids tab beside the rooms. A shrine either names one or gives
whichever the party has not taken, in list order. Two edges the engine leaves
open, neither fixed: a shrine that NAMES a boon gives it again on a second
visit (`openDoor` does not consult `claimed`), and a shrine with nothing left
to give grants nothing while the reveal still shows the last boon found.

### 6. Four stats, and every role wants exactly two

    Tank    HP + Skill      soak it and shrug it off
    Healer  Skill + Speed   heal for more, and act more often
    DPS     Attack + Speed  hit hard and go first

That symmetry is the design: each stat is wanted by two roles and ignored by
one, so no stat is simply correct for everybody and no role's build is a single
slider.

**Armour is gone. Skill carries mitigation for every role.** Two stats both
meaning "take less damage" was one too many - armour was the number everyone
understood and Skill was the number that did the interesting things, so the
interesting one was the one nobody spent on. `mitigationFraction` now reads
`skill`, and Tanks keep an extra layer on top of it (self-mitigation, and a
guard that covers the whole party). DPS take close to full damage, and that is
the price of their trade.

**Speed is allocatable and may sit on gear**, which it could not before. The
old reason was measured and still true - speed IS initiative, so +1 speed beat
+8 armour while looking like the smallest number on the item. What changed is
that `statMods` may go NEGATIVE: a greatsword that gives Attack and costs Speed
prices itself, where a speed-only bonus could not. `clampStats` floors the
RESULT (health and speed at 1, the rest at zero) so the subtraction stays real
without a character arriving at the resolver already dead.

**Every number is on a level-1 scale.** A character opens with 9-14 health, not
40-70. There is nowhere to go from 70 that feels like anything, and +2 health is
a real decision at 9 and noise at 45. Enemy stat blocks, gear mods, `skillCurveK`
and the healing constants were all scaled to match, and `BAND_THRESHOLDS` was
re-measured against it. If you move `ROLE_BASE_STATS`, move those too - then
run `npm run simulate:progression`.

### The progression budget it is tuned to

Players run 5–20 dungeons/day, 5 days/week. Level 300 should take about **a
year** at that rate. That fixes the XP curve at `40 + 10 × level` (linear, in
`src/engine/stats.ts`) - roughly 2,920 runs to 300.

Linear, not quadratic, and not by accident: a quadratic curve across 300 levels
puts the last levels months apart, which is tolerable in a game you play alone
and poisonous in one where the whole chat is watching the same bar.

---

## 3. Architecture

### The command seam

Every mutation goes through one discriminated union: `GameCommand` in
`src/engine/commands/types.ts` (~25 variants - `join_dungeon`, `equip_gear`,
`allocate_points`, `respec`, `buy_gear`, …).

Nothing mutates state except by dispatching one of these. This is the seam
Twitch plugs into later: chat commands, channel-point redeems and the admin
panel all become the same union, and the engine cannot tell them apart. **If
you add a way to change state, add a command - do not reach into the engine.**

### Content is data

`content/` holds JSON, validated at load by `src/engine/content/schemas.ts`:

    content/gear/          119 pieces
    content/dungeons/        5   (a place AND the fight in it)
    content/consumables/     4
    content/raids/           1   (rooms, plus the authored path through them)

Player data is NOT content and does not live here. The roster and its
snapshots are written to `DATA_DIR` (default `./data`, gitignored) through
`RosterStore` - a file today, Supabase when this is hosted. Two environment
variables matter to a deployment:

    DATA_DIR         where the roster is kept. Point it at a volume.
    ROSTER_STORE     "file" keeps the roster in DATA_DIR even with Supabase
                     configured, so content comes from the store and
                     characters do not go to it. FOR TESTING: `sim_join`
                     creates characters, and a simulated run should be fought
                     against production's dungeons without its fake party
                     landing beside real viewers. The `corrupted-raids-sandbox`
                     launch config sets it (port 8790, roster in
                     ./data/sandbox). Content WRITES from that server's admin
                     panel still go to the live store. To try an admin SAVE
                     without touching it, `corrupted-raids-offline` (port
                     8791) loads no .env at all and writes to content/ on
                     disk.
    ADMIN_SECRET     the operator's key. EVERY write on this server needs it:
                     all /content/*, /sprite*, /placements, /admin/roster/*,
                     and every show-running GameCommand - plus /difficulty on
                     both verbs, which writes nothing but simulates a fight
                     hundreds of times to answer. Unset means those refuse to
                     run rather than run open.
    SESSION_SECRET   signs viewer sessions. Falls back to ADMIN_SECRET, then to
                     a per-boot random value (which signs everyone out on
                     restart, deliberately annoying).
    ALLOWED_ORIGINS  comma-separated. Empty means same-origin only, which is
                     the normal deployment.
    ALLOW_DEV_LOGIN  "1" lets POST /session mint a session for any claimed id.
                     DEV ONLY - it is currently the ONLY way to mint a viewer
                     session on this server at all (see below). Leave unset
                     unless you are testing a viewer-scoped command by hand.
    PUBLIC_ORIGIN    only matters under the Fly/Docker fallback (DEPLOY.md),
                     where it decides whether the session cookie is marked
                     Secure. Does nothing while this server runs locally.

Deployment lives in `DEPLOY.md` and `fly.toml`. The short version: Vercel and
Supabase Edge cannot host this at all (serverless - no timers between requests,
no held-open SSE, no disk), Cloudflare Durable Objects could and would be a
rewrite, so a container host runs the process and Supabase holds the data.
`SUPABASE_URL` + `SUPABASE_SERVICE_KEY` switch `RosterStore` from the file to
Postgres; unset, the file store is used and is perfectly adequate on a volume.

ONE MACHINE, and it is a constraint rather than thrift: the FSM, its timers,
the roster Map and the SSE client set all live in the process, so a second
instance is a second game behind the same URL.

**The loadout's identity and this server's viewer sessions are two unrelated
systems, on purpose.** They used to be one: this server ran its own Twitch
OAuth (`src/server/twitch.ts`, `/auth/twitch`, `/auth/twitch/callback`) and
`GET /session` was how the loadout learned who it was, back when this server
served `loadout.html` to the internet. It does not any more - the loadout is
hosted separately (DEPLOY.md) and authenticates straight against Supabase
Auth's own Twitch provider, from the browser, and never calls this server at
all (`web/src/loadout/identity.ts` says as much). Nothing under `web/` fetches
`/session` or `/auth/twitch*`, so that OAuth flow had no caller left and was
deleted along with `twitch.ts`.

What is left on this server is just the session PRIMITIVE - `issueSession` /
`readSession` / a signed `cr_session` cookie - kept as the seam for `POST
/command` to tell a viewer-scoped command from an operator one. The only way
to mint one today is the dev-only `POST /session` behind `ALLOW_DEV_LOGIN`;
whatever eventually authenticates real viewer commands against this server
(P5, Streamer.bot) mints a session the same way rather than reinventing it.
Characters are keyed `twitch:<numeric id>` on both sides regardless - the
namespace is shared even though nothing else about identity is.

**Two principals, and `requestedBy` is not one of them.** An OPERATOR holds
ADMIN_SECRET and may run the show; a VIEWER may act only on their own
character, and which character that is comes from a signed session cookie -
the server overwrites whatever `requestedBy` the body claimed. Before this, any
caller could respec or strip anyone. See src/server/auth.ts; the privileged
command list is `OPERATOR_COMMANDS` and it is a list of what is FORBIDDEN to
viewers, so a command added later fails safe.

The Map in `Roster` stays the source of truth while the process is up and the
store is a debounced write-behind, because `Roster.get()` is called from inside
the synchronous combat resolver and making it async would make the whole engine
async to put a network round-trip in a combat tick.
    content/balance.json     every tunable number

Validation happens **at load**, so a malformed file fails loudly at boot rather
than mid-fight in front of an audience. When you add a field, add it to the
schema in the same commit - an unvalidated field is one that silently becomes
`undefined` in production.

`content/balance.json` is the single home for tuning constants. A magic number
in a `.ts` file is a bug report waiting to happen.

### Layout

    src/engine/       combat, content, balance, party strength, state
    src/state/        the dungeon state machine
    src/text/         all player-facing copy (en.ts) - nothing is inlined
    src/server/       one dependency-free Node http server (816 lines)
    web/              React + Vite, one entry point per page, builds to overlay/
                      (web/src/arena3d is the 3D overlay's scene - §4)
    content/          the JSON above
    scripts/          slicers, simulator, tuners (TS + Python)
    art/              source art; art/ui is the sliced chrome
    docs/design/      concept-v0.6.html (original brief, partly superseded),
                      plus the art-generation guide, the palette design system
                      and its JSON export - see §11 for the full layout.

`overlay/` is **build output**. Do not edit it; `npm run build:web` empties it.

### The server

`src/server/index.ts`, no framework, port 8787. Routes:

    GET  /state /character /placements /ratings /content /events
    GET  /difficulty                                    (admin)
    POST /command /placements /sprite /sprite/revert
    POST /chat /redeem                                  (chat bot)
    POST /difficulty /difficulty/measure /difficulty/solve   (admin)
    POST /content/write /content/delete /content/rename

`GET /events` is the overlay's stream. `POST /difficulty` exists because the
admin panel needs to measure the **draft** a streamer is editing, not the saved
file - measuring what is on disk while someone drags a unit around reports the
difficulty of a fight nobody is looking at.

> **Security.** Every `POST` above is authenticated, and so is
> `GET /difficulty`. The split is structural rather than a check per route:
> `src/server/auth.ts` holds ADMIN_SECRET behind a timing-safe compare, and
> `OPERATOR_COMMANDS` is a list of what is FORBIDDEN to viewers, so a command
> added later defaults to needing the operator. `requestedBy` is overwritten
> from the signed session cookie and never read from the body.
>
> `GET /difficulty` is gated despite being a GET: it is a read in the HTTP
> sense and a simulation in every sense that costs anything, resolving a fight
> up to 400 times to answer. Gating only its POST twin would have closed the
> claim in this paragraph while leaving the identical work one verb away.
>
> **This paragraph used to be wrong, which is worth recording.** It claimed
> every POST was authenticated and listed `/difficulty` and `/difficulty/solve`
> among them; neither had a gate. It also said "verified by probe" while naming
> only the three routes that were actually probed. The lesson is not about
> those endpoints: a security claim that lists what was checked is useful, and
> one that generalises from a sample to "every" is how a gap survives being
> written down. Current state, probed 2026-09-21: `/difficulty` answers 401
> without the header on both verbs, 200 with it, 401 with a wrong one.
>
> Chat reaches the game through `POST /chat` (`src/server/chat.ts`) behind
> CHAT_SECRET, which parses a line into one of a fixed, tiny set - a
> compromised bot can impersonate a viewer but cannot reach `grant_gear`.
>
> `POST /redeem` is behind the same secret and is the one bot-reachable thing
> that STARTS a run, which is otherwise the operator's alone. It is its own
> endpoint so the bot never holds ADMIN_SECRET. It takes a KIND (`dungeon` or
> `raid`), never an id: the server rolls which one, skipping whichever ran
> last, so a doctored redeem cannot aim the stream. Every refusal answers
> `refund: true` and the bot gives the channel points back. Probed
> 2026-10-02: 401 without the header, 401 with a wrong one, 400 for an id in
> the reward field, 200 `refund: true` while a run is open.

---

## 4. Combat

**Global initiative.** Each turn draws one actor from *all* living combatants,
weighted by `spd × initiativeWeight`. Not side-alternating rounds. With 30
players against 6 enemies, alternating turns would hand the small side half the
actions in the fight; drawing from one pool gives numbers their honest weight.

**Roles** - Tank / DPS / Healer, and enemies have them too. `roleMitigation` is
not party-only, so an armoured enemy frontliner behaves like an armoured player
frontliner. One rule, both sides.

**Aggro is not foolproof, on purpose.** Tanks pull with Skill
(`aggroPerSkill: 0.03`, capped at `maxAggroFromSkill: 1.5`), but every attack
rolls `focusBreakChance: 0.22` first - a 22% chance the attacker ignores threat
entirely and picks at random:

```ts
function pickTarget(candidates, balance, rng) {
  if (rng() < balance.aggro.focusBreakChance) return pickWeightedUnit(candidates, () => 1, rng);
  return pickWeightedUnit(candidates, (rt) => aggroWeight(rt, balance), rng);
}
```

A perfect taunt makes the healer's positioning irrelevant and the tank's build
the only build. The leak is what keeps the other roles honest.

**Everyone gets paid.** The dead still earn: `casualtyXpMultiplier: 0.4` and
`casualtyLootChance: 0.15`. A party that LOSES earns too: `defeatXpMultiplier:
0.15` and `defeatLootChance: 0.08`, no gold. The three loot chances must stay
in that order (survived > died in a win > lost) and `npm run simulate` asserts
it. A viewer who joined, died in turn two and got
nothing has learned not to join.

### The 3D arena

`/3d` (`web/arena3d.html`) is the overlay with the two flat ranks replaced by
a three.js scene in which bodies cross the floor to hit each other. Branch
`3d-arena`; the flat overlay at `/` is untouched and both run off one server.

**It is a renderer, not a second game.** The resolver still decides the whole
fight in one call and `useCombatPlayback` still replays the log. `App.tsx` is
shared - same connection, banner, roster, log and bars - and takes the arena
as a prop (`<App Arena={Arena3D} />`). A prop rather than an import, and that
is the whole reason: an import would put half a megabyte of renderer in the
flat overlay's bundle. Measured after the split: `index` 0.4 kB of its own,
`arena3d` 488 kB, the shared `App` chunk 23 kB.

**The replay announces a move before it lands.** Everything else in
`PlaybackState` is the RESULT of an event, which is all a figure twitching in
a rank needs. A body that has to cross the floor needs to know who is hitting
whom while there is still time to get there, so `PlaybackState.action` is set
`ACTION_LEAD_MS` (240) before each attack, heal and ability. The attacker
leaves on the announcement and arrives on the event, which is why the number
rises as the blow lands rather than before it. The flat overlay ignores the
field.

**The scene is the painting, folded.** There are no models and no level
geometry. Each backdrop is projected through one reference camera onto a floor
and a wall standing at the back of it (`stageGeometry.ts`); from that camera
the two reassemble into the picture as drawn, and as the camera drifts they
part, which is the parallax. Every scene therefore needs two numbers - where
its ground meets its wall, and how near the front the ground stays ground -
and they are in `FLOORS`, read off the art by eye. A new background without an
entry gets a default and will look slightly wrong until it has one. The camera
moves only a little, on purpose: a real orbit smears every painted lamp-post
that stands on the floor strip.

**Bodies are the 2D art, stood up.** Enemy drawings are used as they are.
Characters are composited onto a canvas by `composeCharacter.ts`, which is
CharacterSprite's rules restated for a 2D context because WebGL cannot sample
a stack of DOM images. That is a second compositor and a real cost: change a
layering rule in one and the other has to follow.

**Shadows are contact patches, and cast shadows were built first.** A shadow
map worked and was measurably on screen (3.5% of the frame) and not visibly
there: the camera looks across the floor at about fifteen degrees, so a cast
silhouette is a sliver that lies behind the body casting it. A soft patch
under the feet is what a low camera can see, and it tightens as a body rises,
which is the cue that a hop went up.

**Scheduled on the render clock, not on timers.** A hidden OBS source stops
`requestAnimationFrame`; a `setTimeout` would go on landing blows in a scene
nobody is drawing. Everything due is queued and run from the frame loop, and a
frame that arrives more than 400ms late applies its blows without their
effects - the alternative was forty slashes on the first frame back.
WebGL context loss and restore was forced by hand and the scene came back
whole (2026-10-03).

**What it does not do yet.** Everybody without the healer role closes to
melee, whatever they are holding - the engine has no notion of a ranged
weapon. The floor holds forty of the party (`ARENA_PARTY_CAP`); the rest are
in the fight and in the roster and not on the floor. There are no per-body
health bars.

**The overlay was drawing the wrong squad, and this found it.** `App.tsx`
looked up each enemy's sprite and position with `squadFor(fight, headcount)`.
`squadFor` takes the party's STRENGTH; a headcount is `weak` for every party
that will ever exist, so a level-4 fight of eight was drawn with the three
sprites and three positions of the level-1 layout, stacked. The same mistake
as `GET /difficulty` (§6), on the other side of the wire. `StateSnapshot` now
carries `partyStrength` and both overlays use it.

---

## 5. The balance model

The single most important idea in this repo:

### Party rating is an AVERAGE, not a total

`partyRating()` in `src/engine/partyStrength.ts` returns the
composition-adjusted **mean** member power. That average picks the level.

Why: a total means one geared veteran drags twenty newcomers into a fight
scaled for the veteran, and they all die. An average means the fight matches
*the room*, and a strong player carries rather than condemns.

**Headcount does not pick the level.** It matters, and it is priced somewhere
else:

```ts
export function effectiveRating(rating: number, partySize: number): number {
  void partySize;
  return Math.max(0, Math.round(rating));
}
```

This section used to say headcount was folded into the rating
logarithmically, and for a while the code did exactly that - it multiplied the
rating by `crowdFactor` and handed the product to `bandFor`, so turnout chose
the level. That was survivable while the levels were nearly the same fight and
stopped being survivable when they had teeth: a chat of twelve in mid gear was
inflated a whole level and met a fight priced for ten level-25 characters in
the best gear in the game. Measured at the time: 5-20% win at every dungeon,
for an ordinary night.

So turnout goes through `partyScaling` in `content/balance.json` instead,
which scales the ENEMY and is continuous where a level is a step:

    enemy hp    +5% per member past five          (hpPerExtraMember)
    enemy atk   +65% per DOUBLING of the party    (atkPerDoubling)
    both        clamped to 0.4x .. 6x

A party of 51 meets x3.3 health and x3.18 attack; a party of one meets x0.8
and x0.4. A bigger crowd fights a tougher version of the fight its gear
earned, not a different fight. Attack is sub-linear on purpose - see the
`_comment` on that block for the sweep that set it.

`crowdFactor` is still exported and still the right shape for anything that
wants to weigh turnout (the progression report prints it). It no longer
decides which room the party walks into.

### How a level is picked, end to end

1. Each member's power is `ratePoints` of their stats after gear and spent
   points. That is their Corruption.
2. The party's rating is the MEAN of those, times the composition factor.
3. `bandFor` looks the rating up in `BAND_THRESHOLDS` and the fight fields the
   layout authored for that level, or the nearest authored level below it.
4. Inside a level two things ramp rather than step: the body count climbs from
   the previous level's across the first 35% of the level (`squadFor`), and the
   stat multiplier slides from the previous level's to this one's across its
   whole width (`expandFight`).

It is re-read on every join during the gathering window - which is why the
banner's level can change as people arrive - and fixed when the fight starts.
Raid rooms use the same rating and the same thresholds.

**Measured, 2026-10-03: one level-150 character among fifty naked level-1s.**
Against the live store, 60 fights a dungeon. The veteran rates 4,408, a
newcomer 34-51, and the room averages 130 - the bottom of Level 2. They met the
Level 1 squad plus at most one body, scaled for 51 heads, and won 100% at all
five dungeons with 97-100% of the newcomers alive. The same fifty WITHOUT the
veteran also win 100%, at Level 1. So the average does what it is for - a
strong player lifts a weak room one level rather than condemning it - and its
cost is that the strong player sees content far below their own.

That veteran ALONE rated 2,468 (all-DPS, so x0.56), drew Level 5, and lost all
300 fights. One data point, and a glass cannon - points auto-spent on attack
and speed leave 28 health - but worth knowing before anyone promises that a
high level can solo.

**The sim cannot reach Level 3, and that is the sim.** `sim_join` rolls its
viewers at character level 1-10 in random gear with one in five naked
(`src/engine/sim.ts`). Measured on one run as they were added: 5, 25, 100, 200
and 300 of them rate 161, 154, 148, 150 and 151, and the strongest single one
is 390 - under the Level 3 line by itself. Adding hundreds moves the enemy's
numbers and never the level. Until the sim can dress a party at a chosen
level, Levels 3-6 are reachable only through the admin's meter and
`author-bands.ts`, not on the overlay.

### One scorer for two jobs

`ratePoints()` scores both party strength and gear power. The same function, so
a piece of gear cannot be worth one thing in the shop and another in the
matchmaker:

```ts
export function ratePoints(stats: Stats, balance: BalanceConfig): number {
  const mitigation = Math.min(0.8, mitigationFraction(stats.skill, balance));
  const effectiveHp = stats.hp / (1 - mitigation);
  const speedFactor = (2 * stats.spd) / (stats.spd + DEFAULT_CONTEXT.baseSpd);
  const offence = stats.atk * (1 + stats.crit) * speedFactor;
  return Math.round(effectiveHp * 0.5 + offence * 12 + stats.skill * 5);
}
```

Mitigation is priced by **what it gains you** - `hp / (1 - mitigation)` - not by
the raw stat. 10 Skill added to 5 is transformative; added to 200 it is noise,
and a linear price tag cannot express that.

**Speed saturates.** It was a straight ratio against baseline speed, which was
survivable while nobody could raise it and became nonsense the moment players
could spend points on it: a level-200 DPS scored sixty-eight times a baseline
character's offence and the band thresholds exploded with it. Combat does not
work that way - initiative draws from the whole pool, so a unit's share is
`spd / (spd + everyone else)`. `ratePoints` uses `2s/(s+base)`, which tends to 2
rather than to infinity: being fast is worth at most twice as many turns.

### Composition

    ROLE_IMPORTANCE = { tank: 0.4, healer: 0.4, dps: 0.2 }
    IDEAL_SHARE     = { tank: 1/6, healer: 1/6, dps: 4/6 }
    COMPOSITION_FLOOR = 0.45

Tank and healer outweigh headcount because their contribution is *party-wide*:
one healer changes every player's survival, one more DPS changes one player's
output. The floor stops an all-DPS mob from being rated at zero.

Each role scores its importance once it reaches its ideal share, so the factor
is `0.45 + 0.55 x (what is covered)`: a party with a sixth tanks and a sixth
healers gets the full 1.0, an all-DPS one gets 0.56, and nothing scores below
0.45.

### Thresholds

    ENTRY_RATING = 45           // 10 naked players at level 1 - the floor
    BAND_THRESHOLDS = { weak: 0, seasoned: 110, elite: 430,
                        brutal: 940, infernal: 1640, apocalyptic: 2960 }

`ENTRY_RATING` is measured, not chosen: it is what a squad of ten with nothing
equipped actually scores. It is the anchor everything else sits relative to, so
if you change `ratePoints()`, re-measure it.

Each threshold is what a reference party of ten actually rates
(`BAND_SAMPLE_PARTY`): level 1 naked, level 10 in typical gear, then level 25,
50, 100 and 200 in the best gear they can wear. Ten in all of them, so the
levels differ by how EQUIPPED a party is and not by turnout.

**These numbers were wrong here for a long time** - this section listed
165 and 0/400/1200/2000/3400/6000 after every number had been re-scaled to
level 1 (§2.6) and the code had moved. `src/engine/squad.ts` is the source; if
the two disagree again, the file is right.

---

## 6. Difficulty is MEASURED, never derived

**The rule: if you want to know how hard a fight is, simulate it.**

A formula that predicts win rate from stats has been tried here and it lied.
Specifically:

- The meter once reported *"3× hedge-priest = Trivial, 100%"* while the real
  Marketgate fight measured **13%, Brutal**.
- **Most stat sliders cannot change a fight's outcome.** HP and mitigation
  buy *time*, not victory - against a party that out-damages you, more HP is a
  longer loss. Only the numbers that move the damage race move the result.
- **Gear moves difficulty more than any enemy stat.** The same encounter is
  0% naked and 57% in typical gear. Tuning an enemy's attack by 10% is noise
  next to what the room walked in wearing.

This is why the admin panel measures, why sliders were removed from fight
authoring (they were theatre - the streamer moved them and nothing happened),
and why drag-to-place unit composition replaced them. Composition is the lever
that actually works.

`npm run simulate` is the source of truth. Trust it over your intuition and
over any formula, including the ones in this file.

**It runs in two places now, and they are the same code.** The game server
answers `/difficulty` and `/ratings`; the operator Edge Function answers the
same two questions for the hosted admin panel, using the simulator exported
through `src/engine/edgeEntry.ts`. Not an approximation of it - a second
opinion about difficulty is the exact thing this section exists to forbid. The
edge measures against the LIVE content in Supabase (cached per isolate for 60s,
dropped on any write), because measuring a draft against last deploy's gear
catalogue is how a meter stops meaning anything. One band of 60 samples costs
37-120ms, measured.

**A reading that never changes is a broken control, not a trivial fight.**
`GET /difficulty` passed the party HEADCOUNT where `expandFight` wanted the
party's RATING. `bandFor(12)` is `weak` for every party that will ever exist,
so measuring a dungeon or a raid by id fielded the weak layout whatever the
sliders said, and answered 100% win at every Corruption. Measured on barbie
with 2/8/2 after the fix:

    level   as headcount             as rating
    L5      weak,  10 bodies, 100%   seasoned, 16 bodies, 100%
    L30     weak,  10 bodies, 100%   elite,    18 bodies,  30%
    L120    weak,  10 bodies, 100%   infernal, 17 bodies,  92%

The POST twin took a draft and got this right, which is the only reason it was
findable: two endpoints answering the same question differently. Any raid
tuning done through the meter before 2026-09-27 was done against the weak
layout and is worth re-reading.

### Balancing a dungeon, in practice

Dungeons tab. The whole job is three controls:

1. **Draw each level's squad.** Who is in the fight, and which of them are
   tougher - every unit has a **Strength**: Minion, Regular, Elite, Champion,
   Boss (0.5, 1, 2, 4, 8). A Boss is worth eight regulars in one sprite, which
   is how a fight gets hard without forty villagers on a 450px stage.
2. **Set the Target win rate** at the top. One number for the whole place:
   85% is a starter a fresh chat wins nearly every night, 55% is a coin flip.
3. **Press Solve all levels.** The solver sets each level's **strength** - the
   multiplier on every enemy's health and attack at that level - so it lands on
   the target. The squads are left exactly as drawn. Then Save.

The six level tabs show each level's unit count and measured win rate,
coloured against the target: green inside it, red too hard, pale too easy.

**When a level will not go green, the solver says what to change.** It can
only move the multiplier, and two things it cannot fix are reported under the
level: *too hard even at the lowest strength* (fewer units, or weaker ones) and
*still too easy at the highest* (more, or stronger). The first also fires when
a level is not allowed to be set easier than the level below it - the ratchet,
§10 - which is a squad problem wearing a multiplier's clothes.

Tempo (formerly "fight pressure") is under Advanced, defaults to 1, and opens
itself when a level has it set. It is the last tenth, not a dial to start with.

**The tab, the Solve button, `author-bands.ts` and the hosted panel are one
measurement.** All of them call `src/engine/bandSolver.ts` - the same party
(`bandParty`), the same sixty fights, the same seed. It used to be four: the
tab and the solver used different seeds, so a level solved to 70% could read
64% on its own tab, and the tab judged every dungeon against a fixed 45-70%
window whatever it was aiming for.

The hosted solve is RESUMABLE because it has to be: a Supabase Edge Function is
killed at 2s of CPU, and one level of lady-of-knight takes 2.5s. The search is a
state machine with no simulator in it (`src/engine/bandSearch.ts`); the edge
runs it for ~800ms and hands the state back, and the browser sends it again.
Proven identical to solving in one go on the three heaviest levels in the game.

### Strength multiplies hp and TURNS, not damage per hit

The obvious version is wrong and was measured. Multiplying one body's hp and
attack by 8 gave a unit a party beat 99% of the time where eight regulars won
48%: initiative is drawn per combatant, so eight bodies get eight times the
turns, and one huge hit mostly overkills one player. Multiplying hp and turns
instead tracks eight regulars almost exactly (38% against their 48% - slightly
tougher, because one body does not lose turns as it is hurt). The same lesson
was already recorded on `initiativeWeight`; strength just makes it the default.

    scale   8 regulars   hp&atk x8   hp&turns x8
    x25          94%        100%          93%
    x30          48%         99%          38%
    x35           9%         99%           5%

### How far each lever reaches

Measured on monks at Level 3 against twelve viewers, 400 samples a row:

| lever | bodies | win |
|---|---|---|
| as authored | 22 | 57% |
| +1 body | 23 | 55% (inside the noise) |
| +25% bodies (+6) | 28 | 9% |
| fight pressure 1.1x | 22 | 44% |
| fight pressure 1.25x | 22 | 26% |
| fight pressure 1.5x | 22 | 10% |
| fight pressure 2.0x | 22 | 1% |
| bandStatScale x1.05 | 22 | 27% |
| bandStatScale x1.1 | 22 | 12% |

**This is why the solver exists.** Pressure and the level multiplier are both
cliffs - a 5% nudge to `bandStatScale` costs 30 points of win rate - so nobody
should be finding them by hand. Bodies and Strength decide what the fight IS;
Solve decides how hard it hits.

The pressure dial in the admin used to run 0.5 to 16, so about nine tenths of
its travel said the same thing - everybody dies - and the part that tuned
anything was a few pixels wide. It now runs 0.5 to 2 in steps of 0.05, and
content authored above that (poors' Level 1 at 2.8x, a raid room at 5.3x) is
SHOWN with a button rather than clamped: a range input renders an out-of-range
value pinned at its maximum and writes that maximum back the moment anyone
touches it, so a slider that cannot draw a number would quietly destroy it.

### Every level must field more bodies than the one below

`npm run check:formations` enforces it, and unlike the progression simulator it
FAILS THE BUILD, because this is the engine's precondition rather than a matter
of taste. `squadFor` interpolates a fight's body count across a level boundary
- at the floor of Level 3 you field as many bodies as Level 2 had, at the
ceiling you field all of Level 3 - and that ramp exists because the step it
replaced was measured as savage (BARBIEVILLE: one extra joiner took a party
from the weak layout to the whole seasoned one, 85% more enemy HP for one more
person, 73% win at seven players down to 33% at ten).

But the ramp is guarded: `if (prev.length >= units.length) return units`. A
level that does not GROW turns the smoothing off and restores the exact cliff
it was built to prevent.

It counts Strength as bodies - a Boss at 8 is priced as eight - so a level may
grow by making its units stronger rather than adding more, and a top level
that is one Boss rather than twelve guards passes. What fails is a level no
stronger, in what the author drew, than the one below it.

`--live` (or `npm run check:formations:live`) reads the Supabase store instead
of `content/` on disk. That is the copy the game plays and the two have drifted
apart, so check it before a stream.

### Two simulators, two questions

`npm run simulate` asks **is the engine correct** - aggro pulls, healers heal, a
bigger party is not a free win. It asserts, and it fails the build.

`npm run simulate:progression` asks **is playing it any good** - how long until
the bar moves, how often something drops, whether it is ever anything but grey,
whether a bigger chat does better or worse. It asserts nothing and fails
nothing, deliberately: every number it prints is a design decision, and a test
that fails when a designer changes their mind is a test nobody keeps.

Run the second one after touching `content/balance.json`, a dungeon's
formations, or any loot table. It is the only thing that will tell you a change
made the game worse to play rather than merely different.

---

## 7. Art pipeline

There is no live generator. Assets are sliced from sheets the artist supplies.
(The PixelLab generator scripts were removed - they produced work nobody used.)

    npm run slice      sheets → gear / hands / encounter sprites
    npm run slice:ui   art/reference/assets Mute.png → art/ui/*.png
    npm run gen:font   the bitmap display font

**Slicing is blob detection, not a grid.** Sheets are laid out by eye and the
pieces are all different sizes, so the slicer traces connected shapes and
identifies them **by shape** (the frame is widest, the alcove tallest, the
brackets are the four near-identical small ones). A redrawn sheet therefore
slices itself - there is no coordinate table to keep in step.

Two traps already hit:

- **Bleedover.** A crop is a rectangle and sheets are packed, so a box catches
  its neighbour's corner (`cops-08` once shipped with a crescent of the K9
  officer attached). Every crop is masked to its own blob, then grown by
  `SOFT_EDGE = 2` where the halo may reclaim only *unlabelled* pixels.
- **Alpha never reaches 255.** This art tops out at 254, so the opacity
  threshold is `OPAQUE = 128` (encounters) / `40` (chrome). A `== 255` test
  finds nothing at all.

**Sprites face LEFT.** All five groups are drawn that way. Do not add
`transform: scaleX(-1)` to enemy art - that assumption was in both the overlay
and the admin panel, and it had every enemy fighting the back wall.

### Erased sprites are hosted, not files

The admin eraser saves to the public `sprites` bucket, never to `art/sprites`
(sql/004_sprites.sql). Every save is a NEW object; `sprites.json` in the
content store names the one each sprite draws, and `spriteUrl()` in
`web/src/sprites.ts` is the only place that reads it - so a sprite is erased on
every surface or none. Revert is a manifest edit and deletes nothing; the
manifest's own history (content_history) is how an older erase comes back.
Placements and the manifest are the only two content rows readable with the
public key, because every page needs them to draw a character.

### Turning new art into gear

`scripts/generate-gear-content.py` turns sliced sprites into gear definitions.
It is **additive**: it skips any item whose file already exists and reports how
many it kept. That guard is not decoration - the script began life as a
bootstrap that wiped `content/gear/` on every run, and one regeneration
silently overwrote ten hand-tuned items. Delete a file if you want it rebuilt.

It gates new items on their dominant stat, which is the convention the whole
catalogue follows without exception. The gate is `4 × the item's tier depth`,
and the weakest tier of each slot stays ungated so a new player has something
to put on.

### UI chrome

The sheet is **`art/reference/assets Mute.png`**, and it has to be that file.

A flattened export of the same sheet - one with the transparency checkerboard
painted into it - can be keyed back to alpha, and the result is subtly wrong in
a way that only shows on a dark page: every antialiased edge pixel is the
artwork blended with **white**, so each icon ships with a pale halo. That was
shipped once and the hearts and swords had visible white rims. There is no
clever fix; use the file that still has its alpha.

Nine-sliced through CSS `border-image`. The slice widths are measured:

- **Panel frame, slice 34**, rendered at `border-width: 17px`. The rail sits
  ~5px in from the edge, but the corner bracket runs ~31px along the diagonal,
  so the cut has to clear the CORNER - slicing at the rail shears every bracket
  in half and stretches the halves down the sides. Rendering at half the slice
  scales the frame down rather than re-cutting the source for one call site.
- **Bar frame, slice 14**, rendered at `border-width: 8px`, `box-sizing:
  border-box` and a stated OUTSIDE height. It was content-box on the reasoning
  that the border is art rather than spacing - true, and it made `width: 100%`
  mean "100% plus sixteen pixels of cap", which pushed the page two pixels
  wider than the window and put a scrollbar under everything.

**Sockets and bag cells are the drawn cell, not CSS imitating one.**
`cell.png` is one empty socket cut out of the sheet's four-cell strip;
`tile-*.png` is that same cell with a slot mark already in it. So an empty
socket IS the tile, a filled one is `cell.png` with the item drawn on top, and
the two cannot drift apart. `image-rendering: pixelated` is not optional - the
source is 58px and these render up to 104px.

Lifting the mark off its tile was tried and removed. The key was written
against an earlier sheet whose marks were all bronze; this one draws the
main-hand sword with a steel blade, so a warmth key kept the gold crossguard
and threw the blade away - the slot showed a pickaxe.

**The slicer names pieces by ANCHOR, not by shape.** The old sheet held four
pieces and each was a different shape, so "which blob is widest / tallest /
squarest" named them. This one holds sixty-odd across nine families, and inside
a family they are deliberately identical - nine 67px socket tiles, three
149x100 role plates. Shape cannot tell a helmet tile from a boot tile.

So `ANCHORS` in `scripts/slice-ui.py` records one point inside each piece. The
box is still traced from the art, so a piece redrawn slightly bigger still cuts
at its true edges; only a piece that MOVES needs its anchor nudged, and a moved
piece fails loudly (the anchor lands on empty sheet) rather than silently
swapping two glyphs. The socket tiles go further: two of them touch and trace
as one blob, so each COLUMN is anchored and its tiles are cut by dividing the
column's own height by how many are drawn there - their spacing is never
written down either.

**Two pieces are edited on the way out**, because what the artist drew is a
picture of a state rather than a container:

- `bar-frame` is drawn part-full. Stretched through a nine-slice that one value
  became the whole channel, so a character with no XP rendered with a full bar
  - the art overriding the data. `emptied()` repaints the interior from an
  empty column of the same track.
- `alcove` is drawn framed, and it is used inside a panel that already has a
  frame. The slicer insets 18px past its 13px rail.

`backdrop.png` is a **mirrored** 2x2 of a dungeon-stone swatch: the swatches
are lit from one side, so repeating one directly puts a bright edge against a
dark one every tile width. Mirroring makes every join meet its own reflection.

**The niche goes behind the FIGURE, not behind the whole row.** It is drawn
390x434 and `.doll-center` carries that as an `aspect-ratio`, so `cover` crops
nothing and stretches nothing at any width. Without it the box took the grid's
leftover width and the socket columns' height - a 537x170 letterbox showing the
middle of a portrait painting, which is where the giant skull came from. It
also means the sockets sit on clean ground instead of on torchlight.

**The loadout's stylesheets split by question, not by history:**
`loadout.css` is the shell and its chrome, `loadout-panels.css` is what goes
inside a panel, `loadout-responsive.css` is the layouts. They are read in that
order and nothing below re-states a rule from above.

Breakpoints, and why they are where they are:

    desktop   >= 1340px   three columns
    laptop    >= 1024px   two columns, nav in a drawer
    stacked   <  1024px   one column, one panel at a time

1024 is not a phone concession. The character card needs 470px of the window,
and what is left below that is a stats panel too narrow to fit a stat's name
beside its number and a bag whose cells come out at 26px - two columns are
simply worse than one there.

Anything **inside** a panel is a container query, not a media query, because a
panel is narrow at two columns and wide at one for the same window width. The
stats grid, the bag's column count and the character card's own proportions all
ask `@container`, and every one of them was wrong as a media query first.

**Watch the specificity of `.loadout button`.** It is `0-1-1`, which beats any
bare class - so `.role-choice`, `.inv-cell` and `.nav-scrim` all rendered with
the gold button fill until they were scoped as `.loadout button.role-choice`
and friends. If something on this page is unexpectedly gold, this is why.

**Type carries a drawn edge.** Pixel art is outlined, and type set over it
without an outline reads as a caption pasted onto a picture. `--edge` is the
general shadow; `--edge-hard` is a real four-way keyline, for the labels that
sit ON the artwork where a shadow alone loses against a torch flame.

---

## 8. Conventions

- **All copy lives in `src/text/en.ts`.** Nothing inlined. `npm run check:text`
  verifies overlay strings fit their boxes at the sizes they render - an
  overflowing string on stream is a visible bug in front of an audience.
- **Comments explain why.** The codebase is written this way throughout; match
  it. A comment restating the line below it is noise; a comment recording the
  thing that made the line necessary is why the file stays maintainable.
- **No new dependencies without a reason you can state.** The server has zero.
  `three` is in `web/` for the 3D overlay and the reason is that a depth
  buffer, a camera and a shader pipeline are not things to write by hand; it
  is imported only under `web/src/arena3d` and must stay that way.
- **Container queries over media queries** for panel-internal layout - a panel
  should respond to its own width, not the window's.
- **CSS transform is not a layout box.** A scaled element still occupies its
  original size, which is how the sim controls ended up under the stage. If you
  scale something, reserve the scaled size.
- `tsx` has **no watch mode** here: changes under `src/` need a server restart.
- Use `npm.cmd` / `npx.cmd` on Windows. The execution policy is deliberately
  left alone.

---

## 9. Verification

Run all of these before calling anything done:

```bash
npm.cmd run typecheck && npx.cmd tsc --noEmit -p web/tsconfig.json && npm.cmd run build:web && npm.cmd run check:text && npm.cmd run simulate && npm.cmd run check:formations
```

**`check:formations` is RED as of 2026-09-27 and that is the finding, not a
broken check.** Every dungeon has at least one level that does not grow on the
one below it, which silently disables the count ramp across that boundary - see
§6 and the backlog entry in §10. Fix the content, not the check.

`npm run serve` then hosts every page on `http://localhost:8787` (the 3D
overlay at `/3d`). The admin
panel is ungated there on purpose - it is reached over loopback and its writes
carry `ADMIN_SECRET`. Hosted, `functions/_middleware.ts` refuses it without a
verified operator sign-in; see DEPLOY.md.

`npm run simulate:progression` is not in that chain - it asserts nothing and is
for reading, not passing. Run it whenever you change balance or content.

**Green.** `simulate` used to fail one assertion - *"a balanced party should
bring meaningfully more people home (8% vs 0%)"* - from `cops.json` in the
seasoned band. That was authored tuning rather than a code fault and it has
been adjusted, so the suite passes end to end and a red run now means
something broke.

---

## 10. Open work

> **Measured again 2026-09-22, and most of what was here was noise.**
>
> The findings below were taken from `simulate:progression`, which was
> reporting ONE fight per band in section 8 and seven trials in section 10.
> Against fights solved to roughly 70% win, one sample says "defeat" three
> times in ten; across six bands a couple of defeats are guaranteed, and read
> as a pattern they say things that are not true. Both sections now run 25.
>
> Gone with the re-measurement: the Marketgate 14-30 dead zone (that dungeon
> no longer exists), and "difficulty stops scaling at elite" - all five
> dungeons now field all six bands.

**~~Difficulty stops scaling at `elite`.~~ Done.** All five dungeons field all
six bands. Section 1 of `simulate:progression` confirms it: "0 of 5 dungeons
cannot field the top band."

**Band curves may not fall.** `expandFight` interpolates the stat multiplier
from the band below up to the current band's across the width of that band, so
a dip in `bandStatScale` is not a dip - it is a difficulty curve that FALLS
for the whole width of a band. BARBIEVILLE solved to elite x18.27, brutal
x13.63, infernal x33.60, which measured at 25 runs as elite 100% win, brutal
8%, infernal 84%, with brutal fielding more enemy hp than infernal above it.
`author-bands.ts` now ratchets: a band may never solve below the one under it.
The cost is that a ratcheted band can land harder than its target, and it took
bodies out of the top three bands of four dungeons to bring them back - see
`--keep-layouts` for the other trade.

**~~No dungeon's levels grow all the way up.~~ Done for the dungeons,
2026-09-27.** 14 bodies added, curves re-solved for the changed bands only:

                              L1   L2   L3   L4   L5   L6
    poors                      6   11   16   17   18   26
    lady-of-knight             5   38   40   40   40   40
    monks                     13   19   22   23   25   30
    barbie                     3    6    7    8   11   12
    cops                       3    5    7    8    9   10

`lady-of-knight` is untouched and stays flat above L3 on purpose: it already
fields 40, which is MAX_BODIES in author-bands.ts - "past about forty the
overlay is a smear and the fight is long rather than hard". It is the one
dungeon that has to escalate by making units nastier rather than more numerous.
`monks` got its Level 6 back from the solver, measured into Fair at 70%.

**BARBIEVILLE's top level is unresolved, and the panel now says so.** It
measures 13% against a 78% target and the solver reports it floor-bound: it may
not be set easier than Level 5, and at Level 5's multiplier the level-200 party
loses. Given a free hand the solver wants 8 bodies at x36.77 for 86% - fewer
than Level 5's 11, the opposite of the growth rule. Both cannot hold here; the
ladder ordering work is where that gets decided. Pressing Solve all levels on
BARBIEVILLE puts Levels 1-5 on target (80/78/78/78/78%) and leaves this one
flagged - measured 2026-09-27, not saved.

BARBIEVILLE's Level 1 also runs at **4.6x tempo** in the live store - four and
a half turns to a player's one, on the level a fresh chat meets. The panel
surfaces it now; whether it was meant is a content decision.

Everything else moved the right way - barbie L3 37%->70%, L4 54%->68%.

**The raid still fails the check, and it is not a body-count problem.** Three
rooms and the boss author only L1 (toll-gate, L1-L3) plus an `apocalyptic`
layout holding one hand-placed boss sprite. Those are deliberate - king-boss at
scale 1.7, a role, placed by hand - but `scale` is a SPRITE SIZE and the units
carry no stat overrides, so mechanically the top level of each room is one
ordinary body and measures WEAKER than the level below it (wayside-chapel 98 ->
58, toll-gate 469 -> 73). **Strength is the fix, and it exists now**: set
each boss to Boss in the Raids tab's unit editor and it is worth eight bodies.
Which of them should be Champion and which Boss is a design call, so it has not
been done for you.

The Raids tab has Strength but no Solve, deliberately. A raid is four door
fights and a boss in a row, and solving each room on its own is exactly how
individually-fair fights compound into an unwinnable night (see "Make the
difficulty solver dungeon-aware" below). A per-room button would invite it. `the-watch-house` exists on disk and not in the store.

**The ladder is out of order.** Still true at 25 trials, and the band ratchet
barely moved it, because it is a different problem: not how one dungeon scales
to its party, but which dungeon is harder than which. At level 30 with twelve
viewers:

    poors           says L1    36% win
    barbie          says L4    96%
    monks           says L8    48%
    cops            says L12   80%
    lady-of-knight  says L16   52%

The easiest place in the game is harder than three above it. Every dungeon is
solved to its own target by rung (poors aims at 85%, cops at 62%), so the
labels and the targets disagree with what a level-30 party actually meets.

**The starter dungeon drops only greys.** §4, re-measured 2026-09-22 and still
true: 109 drops over 40 runs, 100% common, and only 5 of the 34 commons can
ever appear. The dungeon named below has since been renamed; the finding has
not changed. The original text:

§4: Tillage Hamlet's loot table is
all common, so a new chat's first several nights - the 100%-win ones - produce
nothing but grey. 20 of 119 items can ever drop at all; the other 99 are
shop-only or unreachable. A fight's table is now editable in one place, and a
single body can carry its own (`unit.loot`), so "the serjeant drops the good
one" is expressible without a second file.

**Gold is not a resource.** §4c: about 100g per run at the STARTER dungeon,
against a shop whose most expensive item is 260g. Everything in stock is one to
three runs away on the first night, so there is nothing to save for and nothing
a drop can be better than.

> ALPHA, DELIBERATELY WORSE. Characters now start on 60g
> (`economy.startingGold`) and recycling refunds the full price
> (`economy.recycleRate: 1`), so gold is currently even less of a resource than
> the finding above describes. That is a testing decision, not a balance one:
> an empty purse means a new player cannot open the shop at all, and a tester
> who loses 60% of an item's value every time they try one stops trying them.
> Both numbers are the levers to pull when the loop is being balanced rather
> than exercised - the reasoning is on the fields in `balance.ts`.

**XP runs about 1.8x the documented budget.** §3: 289 XP per run at Tillage
Hamlet puts level 300 at ~1,590 runs against the ~2,920 §2 is tuned to. Levels
are cheap and the ladder is finished in about 35 runs (§9) - two or three
nights, after which nothing new is reachable.

**Make the difficulty solver dungeon-aware.** It solves ONE fight to a target
win rate. That was the whole problem when a dungeon fielded several encounters
and each was solved in isolation - a run of individually-fair fights compounds
into an unwinnable night, and it shipped broken content **twice**. The merge
removes most of the sting for dungeons, which are now one fight, but a RAID
still runs four door fights and a boss and the solver still cannot see that.

**~~The loadout's nav goes three places that do not exist.~~ Done.** Settings
and How to Play were built; Bestiary was the last dimmed entry and now reads a
prebuilt index of every body a player can meet, grouped by dungeon and by raid
room.

That index is built by `scripts/bundle-edge-content.ts` rather than walked out
of `catalog.dungeons` in the browser, and the reason is worth keeping: those
arrays come from `GET /content`, which the hosted loadout has no server to ask,
so the browser version renders perfectly on localhost and "0 known" for every
real player. It is trimmed rather than whole for two more reasons - 372KB of
dungeon definitions to draw a list of portraits, and their loot tables carry
exact drop weights that nobody asked to publish.

**The bag has a recycle MODE, not a multi-select.** Marking twenty pieces of
junk and scrapping them in one action is the bag's second mode, behind the
button in its header, rather than a modifier-click - half the players are on a
phone and there is no ctrl there. `LoadoutApp.recycle` then dispatches them in
sequence, deliberately: every command re-reads the character afterwards, so
firing twenty at once is twenty overlapping reads racing to be the last one to
set state.

**A socket is a way in, not a readout.** Clicking one opens the list of what
fits it. The only route to putting gear ON used to be the bag - find the item
among everything you own, select it, read the strip that appears below - and
"what can go in my off hand?" is the question a player actually has. Both that
list and the bag's detail strip scroll themselves into view or stick to the
bottom of the viewport, because both of them opened below the fold on a phone
and a tap that changes something you cannot see reads as a tap that did
nothing.

**The bag has no carry limit.** The mock puts "6 / 16" beside the Inventory
heading, and the engine has no cap at all, so that denominator would be a number
a React component invented. The count says what is carried and stops there. A
real cap is an engine rule - a command that can refuse a pickup - not a
stylesheet's opinion. `InventoryGrid` draws in whole rows of 8 and is ready for
one.

**One slot mark is missing and three are unused.** The sheet draws nine socket
tiles (helm, mask, sword, dagger, cloak, pants, glove, boot, ring) and this
catalogue wears seven slots - but not the same seven. `top` has no drawn tile
and keeps an inline SVG in `SlotIcon`; `glove`, `boot` and `ring` are cut and
unused, waiting for slots that may never exist. Ask for a chest mark before
inventing one.

**Seven chest/pants items hold approximate stats.** `generate-gear-content.py`
was run while its chest/pants path still wiped rather than skipped, and it
overwrote the ten hand-tuned top/bottom items. There is no VCS in this repo, so
the originals were not recoverable from disk. What was restored, and how:

- **Rarity** - recovered from a `statGuide` dump in an earlier session
  transcript (Strapped Harness common, Chainmail Rig rare, Knight's Cuirass
  epic) and confirmed as the positional spread. Correct.
- **`requires`** - reconstructed as `4 × tier depth`, the rule the rest of the
  catalogue follows; verified because it reproduces the catalogue-wide gate
  distribution exactly (59 ungated / 33 hp / 26 atk / 1 armour).
- **`statMods`** - the same transcript gave original power scores for three
  items, and those three are restored exactly (9 / 19 / 22). The other seven
  are the generator's formula values and run slightly strong; the recovered
  three were 10–20% below it. Worth an eye in the admin panel.

The visible symptom: the simulator's balanced-party survivor rate reads 13%
where it historically read 8%, because the top-end chest and pants pieces the
level-4 reference party equips are a little stronger than they used to be.

**Gear gates compare POINTS SPENT, not the stat value.** `gearUsableBy()` in
`src/engine/character.ts` reads `character.allocated[stat]`, so `requires:
{hp: 36}` means "has put 36 points into hp" - roughly level 18 at 2 points a
level - not "has 36 hp". Every gate in the catalogue is therefore real and
load-bearing: dropping the 33 hp gates alone moved the simulator's balanced
party from 13% survival to 47%. Do not reason about a gate from a character's
displayed stats.

**`retier:gear` reports 45 of 119 items mis-rarified.** Pre-existing drift: an
item's rarity and its stats were derived independently, so they parted company.
The script prints the corrections and applies them with `--write`. It is left
unapplied because it is a balance decision, not a cleanup - run it when you are
ready to look at the loot table as a whole.

**`docs/design/art-generation-guide.md`** (formerly the root `AGENTS Design.md`
- renamed and relocated in the naming/organization pass, see §11) holds the art
rulebook (25-colour palette, pixel-density rules, consistency checklist) and is
still current - but it references
`a_clean_white_background_reference_sheet.png`, which is not in the repo. Ask
for it before generating art against that spec.

---

## 11. Top-level layout and naming conventions

A naming/organization/dead-file audit passed over the whole repo on
2026-09-08. This section is the map it left behind - keep it in sync with the
tree, the way §3's Layout block is kept in sync with `src/`.

### What each top-level thing is for

    AGENTS.md         this file - why, not what
    README.md         how to run it
    DEPLOY.md          how to ship it
    Dockerfile, fly.toml, .dockerignore, .env.example
                       deployment config - see DEPLOY.md
    package.json       the engine's own scripts/deps (zero runtime deps)
    tsconfig*.json      engine TypeScript config

    src/               the engine - see §3's Layout block for the breakdown
    web/               React + Vite, one entry point per page - see web/package.json
                       and web/vite.config.ts. web/src/ is components, hooks
                       and per-page apps; web/public/ is runtime-served art,
                       managed by the slicers, not hand-edited.
    content/           the game's data (gear/dungeons/consumables/raids +
                       balance.json/shop.json/placements.json) - §3
    data/              runtime roster/save data. Gitignored. Not source.
    overlay/            BUILD OUTPUT of `npm run build:web`. Never edit by
                       hand, never audit by hand - `web/` is the source of
                       truth for everything in here.
    dist/              BUILD OUTPUT of `npm run build` (tsc). Same rule.
    art/               bulk source art - hundreds of sprite sheets, fed to
                       the slicers in scripts/. Not audited file-by-file;
                       too large and too domain-specific for that.
    docs/              human-facing reference material that isn't code
      design/            the original concept brief (`concept-v0.6.html`)
                         plus the art-generation guide, the pixel-art design
                         system and its JSON palette export - moved here
                         together in the 2026-09-08 pass, since all three
                         are reference material for a human or an AI doing
                         art generation, not anything a script reads.
    scripts/           slicers, simulators, tuners - TS run via `tsx`,
                       Python run directly. Every script here either has an
                       `npm run` entry in package.json, or is documented in
                       this file as a manual one-off (e.g.
                       `generate-gear-content.py`, run by hand after adding
                       new art). A script with neither is dead weight.
    sql/               Postgres migrations for the Supabase-backed
                       `RosterStore` - see §3 and DEPLOY.md
    supabase/functions/ the Edge Function the loadout talks to directly.
                       `_content.json` and `_engine.js` are BUILD OUTPUT of
                       `npm run bundle:edge` - never hand-edited, regenerated
                       by that command; `index.ts` is the actual source.
    .claude/           agent definitions and local dev launch config, not
                       part of the shipped game
    TO BE DELETED/     a pending-human-review staging area, NOT part of the
                       live project. See below.

### `TO BE DELETED/`

Created by the 2026-09-08 audit. Anything moved in here was confirmed unused
by grepping every import, `npm run` script, HTML `<script src>`/`<link>`,
and doc reference across the repo - nothing found reading it. It mirrors
each file's original path (so `TO BE DELETED/scripts/_audit.ts` was at
`scripts/_audit.ts`) purely so provenance is obvious and restoring one is a
plain `mv` back.

**Nothing in here was deleted.** That is a deliberate human call, not an
oversight - an agent moved these because it could prove non-use, not because
it is authorized to destroy anything. Review it, then delete the folder (or
individual files) once you agree, or move something back out if the audit
got it wrong.

As of the 2026-09-08 pass it holds:

- `Logo.png` - an unused duplicate of `web/public/art/logo.png` (the file
  actually loaded by `StateBanner.tsx`, `LoadoutApp.tsx` and
  `SignInScreen.tsx`). Nothing referenced the root copy.
- `pallete Reference.png` - misspelled, space in the name, and unreferenced
  anywhere. It duplicates `art/reference/palette Reference.jpg` (correctly
  spelled, inside `art/`, left alone as out-of-scope bulk art) - this looks
  like a stray export of that file that landed at the repo root.
- `scripts/_audit.ts` - a runnable gear-power report script with no `npm
  run` entry, no importer, and no mention in this file. Its leading
  underscore also breaks the sibling naming convention
  (`retier-gear.ts`, `tune-dungeons.ts`: kebab-case, verb-first) without
  actually making it a private helper module - it has no exports, just a
  top-level script body.
- `scripts/retune-gear.ts` - an alternative gear-rebalancing tool (rescales
  power to a per-slot budget) with no `npm run` entry, no importer, and no
  mention in this file. `retier-gear.ts` (relabels rarity to match existing
  stats) is the tool this file documents and `retier:gear` wires up instead;
  this one reads like an earlier or parallel approach that was never
  finished being wired in.

### Naming conventions

These were already mostly followed; this section makes them explicit so the
tree doesn't drift back into what the audit found (a file with a space in
its name, a misspelling, an underscore-prefixed script sitting next to
verb-first ones):

- **No spaces in filenames.** (`AGENTS Design.md` → `art-generation-guide.md`,
  `pallete Reference.png` → moved to `TO BE DELETED/` rather than fixed,
  since nothing used it.)
- **Scripts and docs: kebab-case, verb-first where the file DOES something**
  (`retier-gear.ts`, `tune-dungeons.ts`, `check-text-fits.py`,
  `art-generation-guide.md`).
- **`.ts` modules: camelCase** (`partyStrength.ts`, `statGuide.ts`,
  `useGameConnection.ts`) - **except** a file whose whole job is to export
  one class, which takes that class's PascalCase name
  (`StateMachine.ts` exports `StateMachine`, `DungeonController.ts` exports
  `DungeonController`). That is a deliberate, consistent exception, not a
  gap to close.
- **React components under `web/src/components`, `web/src/admin` and
  `web/src/loadout`: PascalCase** (`CombatLog.tsx`, `GearTuner.tsx`,
  `ShopPanel.tsx`). Vite's own entry points stay lowercase
  (`main.tsx`) - that name is Vite's convention, not this project's, and
  changing it would break the `<script src="/src/.../main.tsx">` tag in the
  matching `.html` file.
- **A private helper module, not a runnable script, is the only thing a
  leading underscore should mean** - and even then, prefer putting it where
  its importer lives rather than in `scripts/` next to the runnable tools,
  so the underscore isn't the only signal.
