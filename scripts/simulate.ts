/**
 * End-to-end smoke test / demo for the engine, run without any server or
 * Twitch integration at all — it drives GameEngine.dispatch() directly,
 * exactly the way the future Twitch command translator will. Run with:
 *   npm run simulate
 */
import assert from "node:assert/strict";
import { partyRating } from "../src/engine/partyStrength.js";
import { bandFor, BAND_SAMPLE_PARTY, ENTRY_RATING } from "../src/engine/squad.js";
import { PARTY_BANDS } from "../src/engine/types.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { GameEngine } from "../src/engine/state/gameEngine.js";
import { mulberry32 } from "../src/engine/rng.js";
import { SIM_VIEWERS } from "../src/engine/sim.js";
import type { CombatResult } from "../src/engine/types.js";
import { DungeonController } from "../src/state/DungeonController.js";
import { PathVote } from "../src/state/pathVote.js";
import { parseChatLine, pickRun, redeemKind } from "../src/server/chat.js";
import { grantXp } from "../src/engine/character.js";
import { estimateDifficulty, referencePartyStrength } from "../src/engine/difficulty.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONTENT_DIR = join(ROOT, "content");

function line(): void {
  console.log("-".repeat(70));
}

function printCombat(label: string, combat: CombatResult): void {
  line();
  const nameOf = (id: string) => combat.combatants.find((c) => c.id === id)?.name ?? id;
  const party = combat.combatants.filter((c) => c.side === "party");
  const enemies = combat.combatants.filter((c) => c.side === "enemy");
  console.log(`${label}  ->  ${combat.outcome.toUpperCase()}`);
  console.log(`  Party:   ${party.map((c) => `${c.name} (${c.role}, ${c.maxHp}hp)`).join(", ")}`);
  console.log(`  Enemies: ${enemies.map((c) => `${c.name} (${c.maxHp}hp)`).join(", ")}`);
  line();

  let ticks = 0;
  for (const event of combat.events) {
    switch (event.type) {
      case "tick":
        ticks = event.n;
        break;
      case "attack":
        console.log(
          `  ${nameOf(event.actorId)} hits ${nameOf(event.targetId)} for ${event.damage}` +
            `${event.crit ? " (CRIT)" : ""}${event.mitigated > 0 ? ` [${event.mitigated} absorbed]` : ""}` +
            ` -> ${event.targetHpAfter}hp`,
        );
        break;
      case "heal":
        console.log(`  ${nameOf(event.actorId)} heals ${nameOf(event.targetId)} for ${event.amount} -> ${event.targetHpAfter}hp`);
        break;
      case "ability":
        console.log(`  ${nameOf(event.actorId)} ${event.abilityName}: ${event.detail}`);
        break;
      case "down":
        console.log(`  *** ${nameOf(event.combatantId)} goes down ***`);
        break;
      case "loot":
        console.log(`  loot: ${nameOf(event.characterId)} gets ${event.gearName}`);
        break;
      case "reward":
        console.log(`  reward: ${nameOf(event.characterId)} +${event.xp} xp, +${event.gold} gold`);
        break;
      case "levelUp":
        console.log(`  LEVEL UP: ${nameOf(event.characterId)} -> ${event.newLevel}`);
        break;
      case "outcome":
        console.log(`  === ${event.outcome.toUpperCase()} ===`);
        break;
    }
  }
  console.log(`  (${ticks} ticks, ${combat.events.length} events, ${combat.survivorIds.length}/${party.length} survived)`);
}

// --- content loads and validates -------------------------------------------
const content = new ContentRegistry();
content.loadGearDir(join(CONTENT_DIR, "gear"));
content.loadDungeonsDir(join(CONTENT_DIR, "dungeons"));
content.loadConsumablesDir(join(CONTENT_DIR, "consumables"));
content.loadBalance(join(CONTENT_DIR, "balance.json"));
// Shop last — it validates its stocked ids against everything above.
content.loadShop(join(CONTENT_DIR, "shop.json"));
console.log(
  `Loaded ${content.listGear().length} gear, ${content.listDungeons().length} dungeons, ` +
    `${content.listRaids().length} raids, ${content.listConsumables().length} consumables.`,
);
assert.ok(content.listGear().length >= 1, "expected at least one gear item to load");
assert.ok(content.listDungeons().length >= 1, "expected at least one dungeon to load");
// Guards the guard: the economy assertions below are vacuous if nothing is stocked.
assert.ok(content.shopView().gear.length >= 1, "expected the shop to stock at least one gear item");
assert.ok(content.shopView().consumables.length >= 1, "expected the shop to stock at least one consumable");

/**
 * The ladder, resolved by recommendedLevel rather than by id.
 *
 * These used to be the literals "tillage-hamlet" and "marketgate". A dungeon
 * id is content the streamer owns and renames, and when they did the whole
 * suite died on "No such dungeon" -- the assertions here are about the ENGINE,
 * so they should follow the ladder rather than any particular settlement.
 * STARTER is the gentlest place in the game, MID the next one up.
 */
const ladder = [...content.listDungeons()].sort((a, b) => a.recommendedLevel - b.recommendedLevel);
assert.ok(ladder.length >= 2, "expected at least two dungeons to form a ladder");
const STARTER = ladder[0]!.id;
const MID = ladder[1]!.id;
console.log(`Ladder: starter "${STARTER}" (L${ladder[0]!.recommendedLevel}), mid "${MID}" (L${ladder[1]!.recommendedLevel}).`);


// --- engine setup: seeded RNG so this run is reproducible -------------------
const engine = new GameEngine(content, mulberry32(42));

// --- unknown targets fail gracefully, not with an exception -----------------
assert.equal(engine.dispatch({ type: "open_dungeon", dungeonId: "nope" }).ok, false, "unknown dungeon should fail cleanly");
assert.equal(engine.dispatch({ type: "start_dungeon" }).ok, false, "starting with no open run should fail cleanly");

// --- the full five-viewer Easy Dungeon run ----------------------------------
const opened = engine.dispatch({ type: "open_dungeon", dungeonId: STARTER });
assert.equal(opened.ok, true, opened.message);

const joined = engine.dispatch({ type: "sim_join", count: 5 });
assert.equal(joined.ok, true, joined.message);
assert.equal(engine.party.length, 5, "expected five viewers in the party");
console.log(`\nParty formed: ${engine.party.map((c) => `${c.name} (${c.role})`).join(", ")}`);

// A viewer can't join twice.
const dupe = engine.dispatch({ type: "join_dungeon", requestedBy: SIM_VIEWERS[0]!.id });
assert.equal(dupe.ok, false, "joining twice should be rejected");

const run = engine.dispatch({ type: "start_dungeon" });
assert.ok(run.combat, "expected a combat result");
printCombat("The Shallow Warrens (Easy)", run.combat!);

const combat = run.combat!;
assert.ok(combat.events.some((e) => e.type === "outcome"), "every fight ends with an outcome event");
assert.ok(combat.combatants.filter((c) => c.side === "party").length === 5, "five party combatants");
// Every declared spawn has to REACH the fight. Deliberately not a headcount:
// an encounter that lays out a squad decides its own numbers and the dungeon's
// `count` no longer applies (see ContentRegistry.expandEnemies), so comparing
// against the sum of counts asserts the model this replaced. What must still
// hold is that nothing silently vanishes — a spawn that expands to nobody is
// a fight the streamer authored and the game quietly dropped.
{
  const dungeon = content.getDungeon(STARTER);
  const enemies = combat.combatants.filter((c) => c.side === "enemy");
  assert.ok(enemies.length > 0, "a dungeon fight should field enemies");
  // A dungeon IS its formation now, so the check is that the fight fielded
  // exactly the bodies the dungeon lays out for this party — no more, and in
  // particular no fewer. A band that expands to nobody is a fight the streamer
  // authored and the game quietly dropped.
  assert.equal(
    enemies.length,
    content.expandDungeonEnemies(dungeon, partyRating(engine.party, content)).length,
    "the fight should field exactly what the dungeon expands to for this party",
  );
}

// --- aggro actually shielded the squishies ----------------------------------
const damageTaken = new Map<string, number>();
for (const e of combat.events) {
  if (e.type === "attack" && combat.combatants.find((c) => c.id === e.targetId)?.side === "party") {
    damageTaken.set(e.targetId, (damageTaken.get(e.targetId) ?? 0) + e.damage);
  }
}
const tank = combat.combatants.find((c) => c.role === "tank");
console.log("\nDamage soaked per party member:");
for (const c of combat.combatants.filter((c) => c.side === "party")) {
  console.log(`  ${c.name.padEnd(12)} ${damageTaken.get(c.id) ?? 0}`);
}
if (tank) {
  const tankDamage = damageTaken.get(tank.id) ?? 0;
  const others = combat.combatants
    .filter((c) => c.side === "party" && c.id !== tank.id)
    .map((c) => damageTaken.get(c.id) ?? 0);
  const avgOther = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
  console.log(`  -> tank took ${tankDamage}, party average excluding tank ${avgOther.toFixed(1)}`);
  assert.ok(tankDamage > avgOther, "aggro weighting should send more damage at the tank than at the average non-tank");
}

// --- the healer actually healed ---------------------------------------------
const heals = combat.events.filter((e) => e.type === "heal");
console.log(`Healer fired ${heals.length} heals.`);

// --- damage variance is doing its job (no identical-number log) -------------
const damages = combat.events.filter((e) => e.type === "attack").map((e) => (e as { damage: number }).damage);
const distinct = new Set(damages).size;
console.log(`${damages.length} attacks produced ${distinct} distinct damage values.`);
assert.ok(distinct > 3, "damage variance should produce a range of numbers, not a repeated constant");

// --- party scaling actually bites --------------------------------------------
// The failure this guards against is subtle and was real: with an even
// side-flip the party's damage output per tick is constant, so a bigger party
// brings more total HP without more damage — meaning without scaling, a big
// crowd finishes a fight in BETTER shape than a small one. Enemies must get
// harder with headcount or the whole difficulty curve inverts.
function endHpFraction(partySize: number, seed: number): number {
  const e = new GameEngine(content, mulberry32(seed));
  e.dispatch({ type: "open_dungeon", dungeonId: STARTER });
  // Dressed, unlike most of this harness. Difficulty is authored and solved
  // against a party in typical gear (see GearAssumption in difficulty.ts), so a
  // naked party here would measure a fight nobody is tuning for and disagree
  // with the admin screen permanently.
  e.dispatch({ type: "sim_join", count: partySize, dress: true });
  const c = e.dispatch({ type: "start_dungeon" }).combat!;
  const maxHp = new Map(c.combatants.filter((x) => x.side === "party").map((x) => [x.id, x.maxHp]));
  const cur = new Map(maxHp);
  for (const ev of c.events) {
    if ((ev.type === "attack" || ev.type === "heal") && maxHp.has(ev.targetId)) {
      cur.set(ev.targetId, ev.type === "attack" ? ev.targetHpAfter : ev.targetHpAfter);
    }
  }
  let left = 0;
  let total = 0;
  for (const [id, m] of maxHp) {
    left += Math.max(0, cur.get(id) ?? m);
    total += m;
  }
  return total > 0 ? left / total : 0;
}

const RUNS = 12;
const avg = (size: number) =>
  Array.from({ length: RUNS }, (_, i) => endHpFraction(size, 2000 + i)).reduce((a, b) => a + b, 0) / RUNS;
const smallParty = avg(5);
const bigParty = avg(25);
console.log(
  `
Party scaling: a party of 5 ends at ${(smallParty * 100).toFixed(0)}% HP, a party of 25 at ${(bigParty * 100).toFixed(0)}%.`,
);
// WHAT THIS NOW GUARDS
//
// It used to assert that a bigger party fares BETTER, which was right while a
// dungeon fielded one fixed squad however many turned up. It is wrong now.
// An encounter lays out three squads — a few, a crowd, loads — and each is
// tuned to the same target win rate on purpose, so twenty-five people meet a
// fight built for twenty-five. The promise changed from "a full roster is an
// advantage" to "the night is worth watching whoever shows up", and asserting
// the old promise would fail every time a band is tuned correctly.
//
// So: neither size may be a walkover, and neither may be hopeless.
for (const [size, left] of [[5, smallParty], [25, bigParty]] as const) {
  assert.ok(
    left > 0.005,
    `a party of ${size} finished at ${(left * 100).toFixed(1)}% HP — that band is a guaranteed wipe`,
  );
  assert.ok(
    left < 0.995,
    `a party of ${size} finished at ${(left * 100).toFixed(1)}% HP — that band is untouchable`,
  );
}

// --- party strength stays calibrated ----------------------------------------
//
// The bands are priced against ONE party — ten fresh characters with no gear —
// and everything downstream (which squad an encounter fields, what the admin
// measures) hangs off that. If the balance config moves and this drifts, the
// bands quietly stop meaning what they say, so it is asserted rather than
// trusted.
{
  const entry = referencePartyStrength({ tanks: 2, dps: 6, healers: 2 }, 1, content, "none");
  assert.ok(
    Math.abs(entry - ENTRY_RATING) / ENTRY_RATING < 0.15,
    `a naked ten rates ${entry}, but the levels are priced against ${ENTRY_RATING} — retune BAND_THRESHOLDS`,
  );
  for (const band of PARTY_BANDS) {
    const s = BAND_SAMPLE_PARTY[band];
    const t = Math.max(1, Math.round(s.size / 6));
    const got = bandFor(
      referencePartyStrength({ tanks: t, healers: t, dps: s.size - 2 * t }, s.level, content, s.gear),
    );
    assert.equal(got, band, `the sample party for "${band}" scores into "${got}" instead`);
  }
  console.log(`
Party strength: a naked ten scores ${entry}; every band's sample party lands in its own band.`);
}

// --- economy invariants ------------------------------------------------------
// Content-level guards. These are cheap here and expensive to notice live:
// a shop is a place where a bad number becomes free gold.
for (const entry of content.shopView().gear) {
  const value = content.gearValue(entry.id);
  const back = content.recycleValue(entry.id);
  // `<=`, not `<`.
  //
  // What prints gold is a recycle paying MORE than the item costs; that is the
  // invariant, and it is the one asserted here. Paying exactly the price is
  // break-even, and during alpha it is deliberate: economy.recycleRate is 1 so
  // testers can try gear without being taxed for it (see balance.ts).
  //
  // This assertion used to demand strictly less, which conflated "no free
  // gold" with "gear choices must cost something". The second is a balance
  // opinion and belongs in the rate, not in a guard that fails the build.
  assert.ok(
    back <= value,
    `recycling "${entry.id}" pays ${back}g but it only costs ${value}g, which prints gold`,
  );
}
for (const entry of content.shopView().consumables) {
  const def = content.getConsumable(entry.id);
  if (def.effect.type !== "grantGold") continue;
  assert.ok(
    def.effect.amount < entry.price,
    `stocked consumable "${def.id}" pays out ${def.effect.amount}g but costs ${entry.price}g — that is an infinite gold loop`,
  );
}
console.log(
  `Economy: ${content.shopView().gear.length} gear + ${content.shopView().consumables.length} consumables stocked, no buy/recycle loops.`,
);

// --- roles earn their slot ---------------------------------------------------
//
// The point of the role rework is that a party WANTS one of each. These assert
// the shape of that, not exact numbers — the numbers are for the admin screen
// to tune, but the ordering must hold or the roles are decorative.
{
  // MEASURED AT TEN, NOT SIX, AND THAT IS THE WHOLE TEST.
  //
  // This used to ask the question of a party of six at level 4 and read 100%
  // against 100% — it could not discriminate, because a six is exactly the
  // party the band system deliberately hands an easy room to. `crowdFactor`
  // is 0.59 at six against 1.0 at ten (CROWD_PIVOT), so a six is discounted
  // to a lower band whatever it is wearing, meets the softest layout the
  // fight has, and wins with any composition at all. Roles cannot show up in
  // a fight nobody can lose, so the assertion was measuring the band system
  // rather than the roles.
  //
  // Ten is CROWD_PIVOT: the party size every band threshold is priced
  // against, which is the one headcount that meets the fight its band
  // actually authored. Level 10 with typical gear is the `seasoned` sample
  // party (BAND_SAMPLE_PARTY), so this is a contested fight by construction
  // and composition has room to matter.
  const COMP = { tanks: 2, dps: 6, healers: 2 };
  const LEVEL = 10;
  const enemies = content.expandDungeonEnemies(
    content.getDungeon(MID),
    referencePartyStrength(COMP, LEVEL, content),
  );
  const at = (composition: { tanks: number; dps: number; healers: number }) =>
    estimateDifficulty(enemies, content, { composition, level: LEVEL, samples: 120, seed: 7 });

  const balanced = at(COMP);
  const allDps = at({ tanks: 0, dps: 10, healers: 0 });

  assert.ok(
    balanced.winRate > allDps.winRate,
    `a balanced ten (${(balanced.winRate * 100).toFixed(0)}%) should beat ten damage dealers ` +
      `(${(allDps.winRate * 100).toFixed(0)}%) — otherwise tanks and healers are decoration`,
  );
  assert.ok(
    balanced.survivorRate > allDps.survivorRate + 0.1,
    `a balanced party should bring meaningfully more people home ` +
      `(${(balanced.survivorRate * 100).toFixed(0)}% vs ${(allDps.survivorRate * 100).toFixed(0)}%)`,
  );

  // Headcount has to matter too, or a raid is just a party of five with extras.
  const twenty = at({ tanks: 4, dps: 12, healers: 4 });
  assert.ok(
    twenty.winRate > balanced.winRate,
    `twenty should out-perform ten (${(twenty.winRate * 100).toFixed(0)}% vs ${(balanced.winRate * 100).toFixed(0)}%) — ` +
      `initiative is drawn from every combatant so more bodies must mean more actions`,
  );

  console.log(
    `Roles: balanced ${(balanced.winRate * 100).toFixed(0)}% win / ` +
      `${(balanced.survivorRate * 100).toFixed(0)}% survive, ` +
      `all-dps ${(allDps.winRate * 100).toFixed(0)}% / ${(allDps.survivorRate * 100).toFixed(0)}%, ` +
      `twenty ${(twenty.winRate * 100).toFixed(0)}%.`,
  );
}

// --- a healer cannot out-heal a single weak enemy -----------------------------
//
// Explicitly requested, and it is a real failure mode rather than a theoretical
// one: without the self-heal penalty a lone healer restores more than one
// farmhand deals, the fight never resolves, and the run hits the tick ceiling
// with the overlay stuck on it.
{
  // Derived, not named. Encounter ids are the streamer's to rename from the
  // admin now — "farmhand" became "poors" between one run of this and the next
  // — so a hardcoded id turns their content edit into a broken test suite. The
  // weakest mob in the catalogue is what this scenario actually means.
  const weakest = content
    .listDungeons()
    .flatMap((d) => content.expandDungeonEnemies(d, 0))
    .filter((e) => e.kind !== "boss")
    .reduce((a, b) => (b.stats.hp * b.stats.atk < a.stats.hp * a.stats.atk ? b : a));
  const farmhand = [weakest];
  const solo = estimateDifficulty(farmhand, content, {
    composition: { tanks: 0, dps: 0, healers: 1 },
    level: 3,
    samples: 100,
    seed: 11,
  });
  assert.equal(
    solo.stalemateRate,
    0,
    `a lone healer against one farmhand stalemated ${(solo.stalemateRate * 100).toFixed(0)}% of the time — ` +
      `roles.healer.selfHealMultiplier is what stops a healer out-healing itself forever`,
  );
  console.log(`Healer: solo vs one ${weakest.name} resolves every time (${(solo.winRate * 100).toFixed(0)}% win).`);
}

// --- raids terminate ---------------------------------------------------------
//
// The thing worth asserting about a raid is not its balance but that it ENDS.
// A branching run has more ways to get stuck than a single fight: two were
// found during development — a door fight won on the final round left the boss
// pending with nothing to start it, and a rejected start still walked the state
// machine into results. Both looked fine until a run was driven to completion,
// which is exactly what this does.
{
  const raidContent = new ContentRegistry();
  raidContent.loadGearDir(join(CONTENT_DIR, "gear"));
  raidContent.loadDungeonsDir(join(CONTENT_DIR, "dungeons"));
  raidContent.loadConsumablesDir(join(CONTENT_DIR, "consumables"));
  raidContent.loadBalance(join(CONTENT_DIR, "balance.json"));
  raidContent.loadRaidsDir(join(CONTENT_DIR, "raids"));

  const raidDef = raidContent.listRaids()[0];
  assert.ok(raidDef, "expected at least one raid in content/raids");

  const directions = ["left", "up", "right"] as const;
  let finished = 0;
  let bossesFought = 0;
  const RUNS = 25;

  for (let i = 0; i < RUNS; i += 1) {
    const raidEngine = new GameEngine(raidContent, Math.random);
    const controller = new DungeonController(raidEngine);
    controller.dispatch({ type: "open_raid", raidId: raidDef.id });
    controller.dispatch({ type: "sim_join", count: 12 });
    for (const character of raidEngine.party) grantXp(character, 2200, raidContent.balance);
    controller.dispatch({ type: "start_dungeon" });

    // Step the machine by hand: the reveal and the post-fight hold are both
    // timer-driven on the server, and a simulator must not wait in real time to
    // prove a loop terminates. Anything that is waiting on a timer gets that
    // timer fired; only `choosing` needs a decision made for it.
    for (let step = 0; step < 60; step += 1) {
      if (controller.state === "results" || controller.state === "idle") break;
      if (controller.state !== "choosing") {
        if (controller.forceTimerElapsed()) continue;
        break;
      }
      if (!controller.getSnapshot().engine.raid) break;
      const direction = directions[Math.floor(Math.random() * directions.length)]!;
      controller.dispatch({ type: "choose_path", direction });
    }

    assert.equal(
      controller.state,
      "results",
      `raid run ${i + 1} ended in state "${controller.state}" — a raid must always reach results`,
    );
    finished += 1;

    const foes = raidEngine.lastCombat?.combatants.filter((c) => c.side === "enemy") ?? [];
    if (foes.length === 1) bossesFought += 1;
  }

  assert.equal(finished, RUNS, "every raid run should terminate");
  assert.ok(
    bossesFought > RUNS / 2,
    `only ${bossesFought}/${RUNS} raids reached the boss — most runs should get there`,
  );
  console.log(`Raids: ${finished}/${RUNS} runs terminated, ${bossesFought} reached the boss.`);

  // --- chat's vote opens the door ---------------------------------------------
  //
  // The vote used to be a tally the operator read and then clicked for. It
  // decides now, on a timer, so the thing to prove is that the door which
  // opens is the one chat picked - for every direction, since an off-by-one in
  // a three-way count is invisible in any single run.
  for (const wanted of directions) {
    const voteEngine = new GameEngine(raidContent, Math.random);
    const controller = new DungeonController(voteEngine);
    controller.dispatch({ type: "open_raid", raidId: raidDef.id });
    controller.dispatch({ type: "sim_join", count: 12 });

    assert.equal(controller.castVote("early", wanted), false, "a vote before the doors are up is not counted");
    controller.dispatch({ type: "start_dungeon" });
    assert.equal(controller.state, "choosing");
    assert.ok(controller.getSnapshot().choiceDeadline, "an open vote says when it closes");

    const others = directions.filter((d) => d !== wanted);
    const [a, b, c, d] = voteEngine.party.map((member) => member.id) as [string, string, string, string];
    // The door is the party's to choose. Someone watching does not get a say,
    // and must not be able to swing it by outnumbering the people at risk.
    for (let i = 0; i < 20; i += 1) {
      assert.equal(controller.castVote(`twitch:spectator-${i}`, others[0]!), false, "a spectator's vote was counted");
    }
    controller.castVote(a, wanted);
    controller.castVote(b, wanted);
    controller.castVote(c, others[0]!);
    // One viewer, one vote: a change of mind MOVES it rather than adding one.
    controller.castVote(d, others[1]!);
    controller.castVote(d, wanted);
    const tally = controller.getSnapshot().vote;
    assert.equal(tally?.total, 4, "four viewers voted, however many lines they typed");
    assert.equal(tally?.leader, wanted);

    assert.ok(controller.forceTimerElapsed(), "the choice window has a timer to run out");
    assert.equal(controller.state, "reveal", "the window closing opens a door");
    const opened = controller.getSnapshot().engine.raid?.doors.filter((d) => d.opened) ?? [];
    assert.deepEqual(
      opened.map((d) => d.direction),
      [wanted],
      `chat voted ${wanted} and a different door opened`,
    );
    assert.equal(controller.getSnapshot().vote, null, "the tally does not outlive the door it opened");
    controller.dispose();
  }

  // Nobody voting must not stall the stream: the window still opens a door.
  {
    const quietEngine = new GameEngine(raidContent, Math.random);
    const controller = new DungeonController(quietEngine);
    controller.dispatch({ type: "open_raid", raidId: raidDef.id });
    controller.dispatch({ type: "sim_join", count: 12 });
    controller.dispatch({ type: "start_dungeon" });
    controller.forceTimerElapsed();
    assert.equal(controller.state, "reveal", "a silent chat still gets a door opened");
    controller.dispose();
  }

  // A tie is broken among the TIED doors, never by opening the third.
  {
    const vote = new PathVote();
    vote.cast("a", "left");
    vote.cast("b", "right");
    for (let i = 0; i < 200; i += 1) {
      const pick = vote.winner(directions, Math.random);
      assert.ok(pick && pick.direction !== "up", "a left/right tie opened the door nobody voted for");
      assert.equal(pick.decidedBy, "tie");
    }
    assert.equal(vote.tally().leader, null, "a tie has no leader to highlight");
  }
  console.log("Raids: chat's vote opens the door it picked, and silence does not stall.");
}

// --- chat lines and redeems ---------------------------------------------------
{
  const join = parseChatLine({ userId: "42", userName: "Ada", message: "!join healer" });
  assert.ok(join?.kind === "join" && join.command.type === "join_dungeon");
  assert.equal(join.command.requestedBy, "twitch:42", "a viewer is twitch:<id> everywhere");
  assert.equal(join.command.role, "healer");

  // The middle door is LABELLED Ahead, so that is what people type.
  const ahead = parseChatLine({ userId: "42", message: "!ahead" });
  assert.ok(ahead?.kind === "vote" && ahead.direction === "up");
  assert.equal(parseChatLine({ userId: "42", message: "left is the best door" }), null);
  // Whatever a chat line says, it cannot become an operator command.
  assert.equal(parseChatLine({ userId: "42", message: "!grant_gear rare-sword" }), null);

  // A redeem buys a KIND of run. An id in that field is refused, not honoured.
  assert.equal(redeemKind(undefined), "dungeon");
  assert.equal(redeemKind("Raid"), "raid");
  assert.equal(redeemKind("lady-of-knight"), null);

  const ids = ["a", "b", "c", "d", "e"];
  let last: string | null = null;
  const seen = new Set<string>();
  for (let i = 0; i < 400; i += 1) {
    const next = pickRun(ids, last, Math.random);
    assert.ok(next, "a non-empty list always opens something");
    assert.notEqual(next, last, "the same dungeon opened twice running");
    seen.add(next);
    last = next;
  }
  assert.equal(seen.size, ids.length, "every dungeon should be reachable by a redeem");
  assert.equal(pickRun(["only"], "only", Math.random), "only", "one dungeon may repeat - there is nothing else");
  assert.equal(pickRun([], null, Math.random), null);
  console.log("Chat: lines parse to join/vote only, and redeems roll without repeating.");
}

// --- everyone who turns up is paid --------------------------------------------
//
// The promise to a viewer, as the streamer put it: XP for attending, more for
// surviving, and a chance at gear whether you lived or not. Each clause is a
// separate branch in the resolver and none of them was asserted, so any one
// could be dropped by a refactor and nothing would have gone red.
{
  const rewardRng = mulberry32(2026);
  const paid = {
    survivor: { n: 0, xp: 0, loot: 0 },
    casualty: { n: 0, xp: 0, loot: 0 },
    loser: { n: 0, xp: 0, loot: 0 },
  };
  let mixedWins = 0;

  for (const dungeon of content.listDungeons()) {
    for (let run = 0; run < 120; run += 1) {
      const rewardEngine = new GameEngine(content, rewardRng);
      rewardEngine.dispatch({ type: "open_dungeon", dungeonId: dungeon.id });
      // Party size and gear both vary, on purpose. Twelve dressed viewers win
      // nearly everything with nobody down, which measured 34 deaths-in-a-win
      // across 200 runs - one chest among them, and a "9%" that was noise.
      rewardEngine.dispatch({ type: "sim_join", count: 4 + (run % 5) * 4, dress: run % 2 === 0 });
      const combat = rewardEngine.dispatch({ type: "start_dungeon" }).combat;
      assert.ok(combat, `${dungeon.id} did not resolve a fight`);

      const won = combat.outcome === "victory";
      const looted = new Set(combat.events.flatMap((e) => (e.type === "loot" ? [e.characterId] : [])));
      const xpOf = new Map(combat.events.flatMap((e) => (e.type === "reward" ? [[e.characterId, e.xp] as const] : [])));
      const members = combat.combatants.filter((c) => c.side === "party");

      for (const member of members) {
        const xp = xpOf.get(member.id);
        assert.ok(xp !== undefined && xp > 0, `${member.name} attended ${dungeon.id} and was paid no XP`);
        const survived = combat.survivorIds.includes(member.id);
        const bucket = !won ? paid.loser : survived ? paid.survivor : paid.casualty;
        bucket.n += 1;
        bucket.xp += xp;
        if (looted.has(member.id)) bucket.loot += 1;
      }

      // Inside ONE fight, so the comparison is against the same enemies.
      if (won && combat.survivorIds.length < members.length) {
        mixedWins += 1;
        const alive = xpOf.get(combat.survivorIds[0]!)!;
        const dead = xpOf.get(members.find((m) => !combat.survivorIds.includes(m.id))!.id)!;
        assert.ok(alive > dead, `surviving ${dungeon.id} paid ${alive} xp and dying paid ${dead}`);
      }
    }
  }

  assert.ok(mixedWins > 0, "no run had both survivors and casualties - the comparison above never ran");
  assert.ok(paid.survivor.loot > 0, "survivors never got gear");
  assert.ok(paid.casualty.loot > 0, "the fallen never got gear - casualtyLootChance is not reaching them");
  assert.ok(
    paid.survivor.loot / paid.survivor.n > paid.casualty.loot / paid.casualty.n,
    "dying should not be the better way to get gear",
  );
  // A wipe can still send somebody home with something - but rarely, and
  // never more readily than dying in a fight the party went on to win.
  assert.ok(paid.loser.loot > 0, "a lost fight never dropped gear - defeatLootChance is not reaching it");
  // The ORDER is asserted on the configured chances, not on the measured
  // rates: deaths in a won fight are rare enough (a few hundred in 600 runs)
  // that 7% against 4% is inside the noise, and a test that fails on a
  // reshuffled seed is one that gets deleted.
  const { casualtyLootChance, defeatLootChance } = content.balance.rewards;
  assert.ok(
    defeatLootChance < casualtyLootChance && casualtyLootChance < 1,
    "loot chances must run survived > died in a win > lost",
  );
  assert.ok(
    paid.loser.loot / paid.loser.n < paid.survivor.loot / paid.survivor.n / 4,
    "losing pays gear too readily against winning",
  );

  const pct = (b: { n: number; loot: number }) => (b.n ? `${Math.round((b.loot / b.n) * 100)}%` : "n/a");
  const avg = (b: { n: number; xp: number }) => (b.n ? Math.round(b.xp / b.n) : 0);
  console.log(
    `Rewards: survived ${avg(paid.survivor)} xp / ${pct(paid.survivor)} gear, ` +
      `died in a win ${avg(paid.casualty)} xp / ${pct(paid.casualty)} gear, ` +
      `lost ${avg(paid.loser)} xp / ${pct(paid.loser)} gear.`,
  );
}

// --- reset returns to idle ---------------------------------------------------
engine.dispatch({ type: "reset_dungeon" });
const afterReset = engine.getStateSnapshot();
assert.equal(afterReset.run, null, "reset should clear the open run");
assert.equal(afterReset.party.length, 0, "reset should clear the party");
// Characters persist across runs even though the run was reset (§2.7).
assert.equal(engine.roster.size, 5, "characters should outlive the run they were created in");

line();
console.log("All simulator assertions passed.");
