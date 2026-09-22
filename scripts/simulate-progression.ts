/**
 * What a viewer's evening actually feels like.
 *
 *   npx tsx scripts/simulate-progression.ts
 *
 * `npm run simulate` asserts the ENGINE is correct: aggro pulls, healers heal,
 * a bigger party is not a free win. This asks a different question, and one no
 * assertion can answer — is playing it any good? How long until the bar moves,
 * how often does something drop, is it ever anything but grey, and is turning
 * up to a fight above your weight worth the click.
 *
 * Everything here is MEASURED by running fights (AGENTS.md §6). Nothing is
 * predicted from a formula, because the formulas in this repo have lied before.
 *
 * It prints and asserts nothing: the numbers are for a person to read and
 * decide about. Balance is a design call, not a test.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { GameEngine } from "../src/engine/state/gameEngine.js";
import { mulberry32 } from "../src/engine/rng.js";
import { partyRating } from "../src/engine/partyStrength.js";
import { bandFor, crowdFactor, effectiveRating, BAND_THRESHOLDS, CROWD_FLOOR } from "../src/engine/squad.js";
import { spendPoints } from "../src/engine/difficulty.js";
import { xpToNextLevel } from "../src/engine/stats.js";
import { equipGear, gearUsableBy } from "../src/engine/character.js";
import { PARTY_BANDS, type Character, type PartyBand, type Rarity } from "../src/engine/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "content");

const content = new ContentRegistry();
content.loadGearDir(join(CONTENT_DIR, "gear"));
content.loadDungeonsDir(join(CONTENT_DIR, "dungeons"));
content.loadConsumablesDir(join(CONTENT_DIR, "consumables"));
content.loadBalance(join(CONTENT_DIR, "balance.json"));
content.loadShop(join(CONTENT_DIR, "shop.json"));

/**
 * The two rungs this report keeps returning to, resolved by recommendedLevel.
 *
 * Hardcoded ids ("tillage-hamlet", "marketgate") broke the moment the
 * settlements were renamed. What the report is actually about is the SHAPE of
 * the ladder -- the first night a new chat plays, and the first step up from
 * it -- so it asks the content which those are.
 */
const ladder = [...content.listDungeons()].sort((a, b) => a.recommendedLevel - b.recommendedLevel);
const STARTER = ladder[0]!;
const MID = ladder[1] ?? ladder[0]!;

const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

function head(title: string): void {
  console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);
}

function pct(n: number, of: number): string {
  return of === 0 ? "—" : `${((n / of) * 100).toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// 1. Which fights can a party actually meet?
// ---------------------------------------------------------------------------
//
// Static, not simulated: an encounter either has a layout authored for a band
// or it does not, and `squadFor` falls back DOWN the list. A party past the
// highest authored band therefore meets the same squad forever, however strong
// it gets — which is the difference between six difficulty levels and three.

head("1. BAND COVERAGE — what a dungeon can field");
console.log(`\n${"dungeon".padEnd(22)}${PARTY_BANDS.map((b) => b.slice(0, 5).padEnd(7)).join("")}  fields`);
const missingTop: string[] = [];
for (const def of content.listDungeons()) {
  const cells = PARTY_BANDS.map((b) => (def.formations?.[b]?.length ? "  yes  " : "   ·   ")).join("");
  const authored = PARTY_BANDS.filter((b) => def.formations?.[b]?.length);
  const top = authored[authored.length - 1];
  if (!top || top !== PARTY_BANDS[PARTY_BANDS.length - 1]) missingTop.push(def.id);
  console.log(`${def.id.padEnd(22)}${cells}  ${authored.length === 0 ? "NO LAYOUT AT ALL" : `tops out at ${top}`}`);
}
console.log(
  `\n${missingTop.length} of ${content.listDungeons().length} dungeons cannot field the top band.` +
    `\nA party past a dungeon's highest authored layout meets the same fight forever.`,
);

// ---------------------------------------------------------------------------
// 2. A night, measured
// ---------------------------------------------------------------------------
//
// One roster, many runs, tracking what each viewer walks away with. The party
// carries its progress between runs — the point is what an EVENING does to a
// character, not what one fight does.

interface NightResult {
  runs: number;
  wins: number;
  bands: Map<PartyBand, number>;
  xp: number[];
  gold: number[];
  levels: number[];
  drops: number;
  dropsByRarity: Map<Rarity, number>;
  survivals: number;
  participations: number;
  ticks: number[];
}

function night(dungeonId: string, partySize: number, runs: number, seed: number, opts: { spend?: boolean } = {}): NightResult {
  const engine = new GameEngine(content, mulberry32(seed));
  const out: NightResult = {
    runs: 0,
    wins: 0,
    bands: new Map(),
    xp: [],
    gold: [],
    levels: [],
    drops: 0,
    dropsByRarity: new Map(),
    survivals: 0,
    participations: 0,
    ticks: [],
  };

  for (let r = 0; r < runs; r += 1) {
    engine.dispatch({ type: "reset_dungeon" });
    engine.dispatch({ type: "open_dungeon", dungeonId });
    engine.dispatch({ type: "sim_join", count: partySize });
    const party = engine.party;
    if (party.length === 0) break;

    // A real player spends their points and wears what they find. A sim that
    // banks both is measuring a character nobody plays.
    if (opts.spend !== false) for (const c of party) equipEverything(c);

    const band = bandFor(effectiveRating(partyRating(party, content), party.length));
    out.bands.set(band, (out.bands.get(band) ?? 0) + 1);

    const result = engine.dispatch({ type: "start_dungeon" });
    const combat = result.combat;
    if (!combat) break;
    out.runs += 1;
    if (combat.outcome === "victory") out.wins += 1;
    out.participations += party.length;
    out.survivals += combat.survivorIds.length;
    for (const e of combat.events) {
      if (e.type === "tick") out.ticks[out.runs - 1] = e.n;
      if (e.type === "loot") {
        out.drops += 1;
        const rarity = content.getGear(e.gearId).rarity;
        out.dropsByRarity.set(rarity, (out.dropsByRarity.get(rarity) ?? 0) + 1);
      }
    }
  }

  for (const c of engine.roster.list()) {
    out.xp.push(c.xp + cumulativeXpFor(c.level));
    out.gold.push(c.gold);
    out.levels.push(c.level);
  }
  return out;
}

/** Total XP a character has earned to reach `level` with `xp` banked toward the next. */
function cumulativeXpFor(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l += 1) total += xpToNextLevel(l);
  return total;
}

/**
 * Spend the points and put the gear on.
 *
 * The engine hands out levels and items; a character only gets STRONGER if a
 * player then does something with them, and the difference between those two
 * is most of what this script is trying to see.
 */
function equipEverything(character: Character): void {
  if (character.unspentPoints > 0) spendPoints(character, character.role, content.balance);
  for (const item of [...character.inventory]) {
    const def = content.getGear(item.gearId);
    const worn = character.equipment[def.slot];
    if (worn && content.getGear(worn.gearId).rarity >= def.rarity) continue;
    if (!gearUsableBy(def, character).ok) continue;
    equipGear(character, item.instanceId, content);
  }
}

head("2. A NIGHT AT EACH DUNGEON — 20 runs, 12 viewers");
console.log(
  `\n${"dungeon".padEnd(17)}${"win".padEnd(6)}${"survive".padEnd(9)}${"xp/run".padEnd(9)}${"gold/run".padEnd(10)}` +
    `${"drops/run".padEnd(11)}${"levels".padEnd(8)}bands met`,
);
for (const dungeon of content.listDungeons()) {
  const n = night(dungeon.id, 12, 20, 7);
  const avgXp = n.xp.reduce((a, b) => a + b, 0) / Math.max(1, n.xp.length) / Math.max(1, n.runs);
  const avgGold = n.gold.reduce((a, b) => a + b, 0) / Math.max(1, n.gold.length) / Math.max(1, n.runs);
  const avgLevel = n.levels.reduce((a, b) => a + b, 0) / Math.max(1, n.levels.length);
  const bands = [...n.bands.entries()].map(([b, c]) => `${b}×${c}`).join(" ");
  console.log(
    `${dungeon.id.padEnd(17)}${pct(n.wins, n.runs).padEnd(6)}${pct(n.survivals, n.participations).padEnd(9)}` +
      `${avgXp.toFixed(0).padEnd(9)}${avgGold.toFixed(0).padEnd(10)}` +
      `${(n.drops / Math.max(1, n.runs) / 12).toFixed(2).padEnd(11)}${avgLevel.toFixed(1).padEnd(8)}${bands}`,
  );
}

// ---------------------------------------------------------------------------
// 3. How long until the bar moves?
// ---------------------------------------------------------------------------

head("3. THE XP CURVE — runs to reach a level, at each dungeon's rate");
{
  const perRun = new Map<string, number>();
  for (const dungeon of content.listDungeons()) {
    const n = night(dungeon.id, 12, 12, 11);
    const xp = n.xp.reduce((a, b) => a + b, 0) / Math.max(1, n.xp.length) / Math.max(1, n.runs);
    perRun.set(dungeon.id, xp);
  }
  const milestones = [5, 10, 25, 50, 100, 200, 300];
  console.log(`\n${"dungeon".padEnd(17)}${"xp/run".padEnd(9)}${milestones.map((m) => `L${m}`.padStart(9)).join("")}`);
  for (const [id, xp] of perRun) {
    const cells = milestones
      .map((m) => (xp <= 0 ? "—" : Math.ceil(cumulativeXpFor(m) / xp).toLocaleString()).padStart(9))
      .join("");
    console.log(`${id.padEnd(17)}${xp.toFixed(0).padEnd(9)}${cells}`);
  }
  const best = Math.max(...perRun.values());
  console.log(
    `\nAGENTS.md §2 budgets level 300 at ~2,920 runs (a year at 5-20/day).` +
      `\nAt the best rate measured here that is ${Math.ceil(cumulativeXpFor(300) / best).toLocaleString()} runs.`,
  );
}

// ---------------------------------------------------------------------------
// 4. What actually drops
// ---------------------------------------------------------------------------

head("4. LOOT — 40 runs of Tillage Hamlet, 12 viewers");
{
  const n = night(STARTER.id, 12, 40, 3);
  const perViewerPerRun = n.drops / Math.max(1, n.runs) / 12;
  console.log(`\n${n.drops} items over ${n.runs} runs — ${perViewerPerRun.toFixed(2)} per viewer per run.`);
  console.log(`A viewer doing 12 runs a night walks away with about ${(perViewerPerRun * 12).toFixed(0)} items.\n`);
  console.log(`${"rarity".padEnd(12)}${"dropped".padEnd(9)}share`);
  for (const rarity of RARITIES) {
    const c = n.dropsByRarity.get(rarity) ?? 0;
    console.log(`${rarity.padEnd(12)}${String(c).padEnd(9)}${pct(c, n.drops)}`);
  }

  // What the loot TABLES could ever produce, against what the catalogue holds.
  const inTables = new Set<string>();
  for (const def of content.listDungeons()) {
    for (const l of def.loot) inTables.add(l.gearId);
    for (const units of Object.values(def.formations)) {
      for (const u of units ?? []) for (const l of u.loot ?? []) inTables.add(l.gearId);
    }
  }
  const tableRarities = new Map<Rarity, number>();
  for (const id of inTables) {
    const r = content.getGear(id).rarity;
    tableRarities.set(r, (tableRarities.get(r) ?? 0) + 1);
  }
  const catalogue = new Map<Rarity, number>();
  for (const def of content.listGear()) catalogue.set(def.rarity, (catalogue.get(def.rarity) ?? 0) + 1);
  console.log(`\n${"rarity".padEnd(12)}${"in catalogue".padEnd(14)}reachable as loot`);
  for (const rarity of RARITIES) {
    console.log(
      `${rarity.padEnd(12)}${String(catalogue.get(rarity) ?? 0).padEnd(14)}${tableRarities.get(rarity) ?? 0}`,
    );
  }
  console.log(
    `\n${inTables.size} of ${content.listGear().length} items can ever drop.` +
      ` The rest exist only in the shop, or nowhere.`,
  );
}

// ---------------------------------------------------------------------------
// 4b. Where does rarity live, and can anyone afford the shop?
// ---------------------------------------------------------------------------

head("4b. WHERE RARITY LIVES");
console.log(`\n${"dungeon".padEnd(22)}${"table".padEnd(7)}rarities it can drop`);
for (const def of content.listDungeons()) {
  // A fight's own table, plus anything a single body overrides with.
  const ids = new Set<string>(def.loot.map((l) => l.gearId));
  for (const units of Object.values(def.formations)) {
    for (const u of units ?? []) for (const l of u.loot ?? []) ids.add(l.gearId);
  }
  const rs = [...ids].map((id) => content.getGear(id).rarity);
  const counts = RARITIES.filter((r) => rs.includes(r)).map((r) => `${r}x${rs.filter((x) => x === r).length}`);
  console.log(`${def.id.padEnd(22)}${String(ids.size).padEnd(7)}${counts.join(" ") || "(empty)"}`);
}

head("4c. THE ECONOMY — gold earned against what it buys");
{
  const n = night(STARTER.id, 12, 20, 5);
  const goldPerRun = n.gold.reduce((a, b) => a + b, 0) / Math.max(1, n.gold.length) / Math.max(1, n.runs);
  const shop = content.shopView();
  console.log(`\nA viewer earns about ${goldPerRun.toFixed(0)}g per run at Tillage Hamlet.`);
  console.log(`\n${"stock".padEnd(26)}${"rarity".padEnd(12)}${"price".padEnd(8)}runs to afford`);
  for (const entry of shop.gear) {
    const def = content.getGear(entry.id);
    console.log(
      `${def.name.padEnd(26)}${def.rarity.padEnd(12)}${`${entry.price}g`.padEnd(8)}` +
        `${goldPerRun > 0 ? Math.ceil(entry.price / goldPerRun) : "-"}`,
    );
  }
}


// ---------------------------------------------------------------------------
// 5. Is turning up worth it when you are the weakest in the room?
// ---------------------------------------------------------------------------
//
// The whole design rests on this: party rating is an AVERAGE so a strong player
// carries rather than condemns (§5). What it does not say is whether the
// newcomer enjoys being carried.

head("5. THE NEWCOMER — a fresh level 1 in a party that has been playing");
{
  const engine = new GameEngine(content, mulberry32(19));
  // Bring the regulars up over a few nights, at a dungeon they can win — a
  // party farming a fight they always lose earns nothing and stays level 1.
  for (let r = 0; r < 25; r += 1) {
    engine.dispatch({ type: "reset_dungeon" });
    engine.dispatch({ type: "open_dungeon", dungeonId: STARTER.id });
    engine.dispatch({ type: "sim_join", count: 11 });
    for (const c of engine.party) equipEverything(c);
    engine.dispatch({ type: "start_dungeon" });
  }
  const veterans = engine.roster.list();
  const vetLevel = veterans.reduce((a, c) => a + c.level, 0) / veterans.length;

  engine.dispatch({ type: "reset_dungeon" });
  engine.dispatch({ type: "open_dungeon", dungeonId: STARTER.id });
  engine.dispatch({ type: "sim_join", count: 11 });
  const newcomer = engine.roster.ensure("viewer:newbie", "Newbie", "dps");
  engine.dispatch({ type: "join_dungeon", requestedBy: "viewer:newbie", displayName: "Newbie" });

  const before = { xp: newcomer.xp, gold: newcomer.gold, items: newcomer.inventory.length };
  const rating = partyRating(engine.party, content);
  const band = bandFor(effectiveRating(rating, engine.party.length));
  const combat = engine.dispatch({ type: "start_dungeon" }).combat!;
  const survived = combat.survivorIds.includes(newcomer.id);

  console.log(`\nRegulars after 25 runs: average level ${vetLevel.toFixed(1)}`);
  console.log(`Party rating ${rating} -> band ${band} with the newcomer in it.`);
  console.log(`Outcome: ${combat.outcome}, ${combat.survivorIds.length}/${engine.party.length} survived.`);
  console.log(
    `The newcomer ${survived ? "survived" : "died"} and took away ` +
      `+${newcomer.xp - before.xp} xp, +${newcomer.gold - before.gold} gold, ` +
      `${newcomer.inventory.length - before.items} item(s).`,
  );
  console.log(`That is ${pct(newcomer.xp - before.xp, xpToNextLevel(1))} of a level from one run.`);
}

// ---------------------------------------------------------------------------
// 6. What a loss is worth
// ---------------------------------------------------------------------------
//
// AGENTS.md §4 says "Everyone gets paid. The dead still earn." That is true of
// the dead in a fight the party WON. This measures the other case, which is the
// one a chat meets on the night a streamer picks the wrong dungeon.

head("6. WHAT A LOSS PAYS — 20 viewers wiped at Marketgate");
{
  const engine = new GameEngine(content, mulberry32(77));
  engine.dispatch({ type: "open_dungeon", dungeonId: MID.id });
  engine.dispatch({ type: "sim_join", count: 20 });
  const before = engine.party.map((c) => ({ id: c.id, xp: c.xp, gold: c.gold, items: c.inventory.length }));
  const combat = engine.dispatch({ type: "start_dungeon" }).combat!;
  const after = engine.party;
  const xp = after.reduce((a, c, i) => a + (c.xp - before[i]!.xp), 0);
  const gold = after.reduce((a, c, i) => a + (c.gold - before[i]!.gold), 0);
  const items = after.reduce((a, c, i) => a + (c.inventory.length - before[i]!.items), 0);
  const ticks = combat.events.reduce((n, e) => (e.type === "tick" ? e.n : n), 0);
  console.log(`\nOutcome: ${combat.outcome}, ${combat.survivorIds.length}/20 survived, ${ticks} ticks.`);
  console.log(`Across all 20 viewers the run paid: ${xp} xp, ${gold} gold, ${items} items.`);
  console.log(
    `\nThat is \`rewards.defeatXpMultiplier\` (${content.balance.rewards.defeatXpMultiplier}) of the` +
      `\nfight's XP, and nothing else — no gold, no loot. Before that knob existed` +
      `\nevery reward sat inside \`if (outcome === "victory")\` and a wipe paid` +
      `\nliterally zero: twenty people typed !join, watched a fight, and the game` +
      `\ngave them no reason to do it again.`,
  );
}

// ---------------------------------------------------------------------------
// 7. Turnout
// ---------------------------------------------------------------------------

head("7. TURNOUT — the same dungeon at different headcounts");
console.log(`\ncrowdFactor multiplies a party's rating by how many turned up (pivot 10):`);
console.log(
  `  ${[1, 2, 3, 5, 8, 10, 15, 20, 30, 40]
    .map((n) => `${n}:${crowdFactor(n).toFixed(2)}`)
    .join("  ")}`,
);
console.log(
  `  Floored at ${CROWD_FLOOR} — the raw log curve went NEGATIVE below four players,` +
    `\n  so effectiveRating clamped to zero and any small group was rated as` +
    `\n  though it owned nothing at all.`,
);
console.log(`\n${"size".padEnd(7)}${"rating".padEnd(9)}${"effective".padEnd(11)}${"band".padEnd(13)}${"win".padEnd(6)}${"survive".padEnd(9)}enemies`);
for (const size of [1, 3, 5, 10, 15, 25, 40]) {
  let wins = 0;
  let survivals = 0;
  let participations = 0;
  let enemies = 0;
  let rating = 0;
  let effective = 0;
  let band: PartyBand = "weak";
  const trials = 12;
  for (let t = 0; t < trials; t += 1) {
    const engine = new GameEngine(content, mulberry32(100 + t));
    engine.dispatch({ type: "open_dungeon", dungeonId: MID.id });
    engine.dispatch({ type: "sim_join", count: size, dress: true });
    rating = partyRating(engine.party, content);
    effective = effectiveRating(rating, engine.party.length);
    band = bandFor(effective);
    const combat = engine.dispatch({ type: "start_dungeon" }).combat!;
    if (combat.outcome === "victory") wins += 1;
    survivals += combat.survivorIds.length;
    participations += engine.party.length;
    enemies = combat.combatants.filter((c) => c.side === "enemy").length;
  }
  console.log(
    `${String(size).padEnd(7)}${String(rating).padEnd(9)}${String(effective).padEnd(11)}${band.padEnd(13)}` +
      `${pct(wins, trials).padEnd(6)}${pct(survivals, participations).padEnd(9)}${enemies}`,
  );
}

// ---------------------------------------------------------------------------
// 7. Does getting stronger change the fight?
// ---------------------------------------------------------------------------

head("8. THE CEILING — what a party meets as it outgrows the content");

/*
 * TWENTY-FIVE RUNS PER BAND, not one.
 *
 * This printed a single victory/defeat per band, which is a coin flip reported
 * as a measurement. author-bands.ts solves every band to roughly "Fair" - call
 * it 70% - so one sample says "defeat" about three times in ten, and across
 * six bands a couple of defeats are certain. Read as a pattern, they said the
 * ladder inverted: brutal a wall, infernal a walkover. It said nothing of the
 * kind, and AGENTS.md section 10 carried conclusions drawn from it for months.
 *
 * Twenty-five is still a wide interval - plus or minus about nine points at
 * 70% - so the column is a rate to compare against author-bands, not a number
 * to tune against. The place to tune is author-bands, which runs a hundred
 * samples per band and exists for that.
 */
const CEILING_TRIALS = 25;
console.log(`\n${"band".padEnd(14)}${"threshold".padEnd(11)}${"enemies".padEnd(9)}${"enemy hp".padEnd(10)}win at ${MID.id} (${CEILING_TRIALS} runs)`);
for (const band of PARTY_BANDS) {
  const target = BAND_THRESHOLDS[band];
  let wins = 0;
  let survivors = 0;
  let enemyCount = 0;
  let hp = 0;

  for (let t = 0; t < CEILING_TRIALS; t += 1) {
    // Build a party rated into this band by handing it levels, then measure.
    const engine = new GameEngine(content, mulberry32(55 + t * 7919));
    engine.dispatch({ type: "open_dungeon", dungeonId: MID.id });
    engine.dispatch({ type: "sim_join", count: 10, dress: true });
    let guard = 0;
    while (partyRating(engine.party, content) < target && guard < 4000) {
      for (const c of engine.party) {
        c.unspentPoints += 2;
        spendPoints(c, c.role, content.balance);
      }
      guard += 1;
    }
    const rating = partyRating(engine.party, content);
    const enemies = content.expandDungeonEnemies(content.getDungeon(MID.id), effectiveRating(rating, 10));
    enemyCount = enemies.length;
    hp = enemies.reduce((a, e) => a + e.stats.hp, 0);

    const combat = engine.dispatch({ type: "start_dungeon" }).combat!;
    if (combat.outcome === "victory") wins += 1;
    survivors += combat.survivorIds.length;
  }

  console.log(
    `${band.padEnd(14)}${String(target).padEnd(11)}${String(enemyCount).padEnd(9)}${hp.toFixed(0).padEnd(10)}` +
      `${pct(wins, CEILING_TRIALS)} win, ${(survivors / CEILING_TRIALS).toFixed(1)}/10 alive`,
  );
}


// ---------------------------------------------------------------------------
// 9. A career
// ---------------------------------------------------------------------------
//
// The question the other sections cannot answer on their own: does the ladder
// CONNECT? A chat starts at the easiest dungeon, gets stronger, and at some
// point the next one becomes winnable. If that point never arrives, the game is
// one dungeon with four locked doors.

head("9. THE CAREER — one chat, climbing");
{
  const engine = new GameEngine(content, mulberry32(2024));
  const ladder = [...content.listDungeons()].sort((a, b) => a.recommendedLevel - b.recommendedLevel);
  const party = 12;
  let runs = 0;

  console.log(`\nA chat of ${party} plays the easiest dungeon and tries the next one every 5 runs.`);
  console.log(`\n${"after".padEnd(9)}${"level".padEnd(8)}${"rating".padEnd(9)}${"band".padEnd(13)}winnable now`);

  const home = ladder[0]!;
  for (let block = 0; block < 12; block += 1) {
    for (let i = 0; i < 5; i += 1) {
      engine.dispatch({ type: "reset_dungeon" });
      engine.dispatch({ type: "open_dungeon", dungeonId: home.id });
      engine.dispatch({ type: "sim_join", count: party });
      for (const c of engine.party) equipEverything(c);
      engine.dispatch({ type: "start_dungeon" });
      runs += 1;
    }

    // Probe every dungeon with a COPY of the roster's current strength, so the
    // probe itself never awards anything and cannot pull the career forward.
    const level = engine.roster.list().reduce((a, c) => a + c.level, 0) / Math.max(1, engine.roster.size);
    let rating = 0;
    let band: PartyBand = "weak";
    const winnable: string[] = [];
    for (const dungeon of ladder) {
      let wins = 0;
      const trials = 5;
      for (let t = 0; t < trials; t += 1) {
        const probe = new GameEngine(content, mulberry32(9000 + t));
        probe.dispatch({ type: "open_dungeon", dungeonId: dungeon.id });
        probe.dispatch({ type: "sim_join", count: party });
        for (let i = 0; i < probe.party.length; i += 1) {
          const source = engine.roster.list()[i];
          const target = probe.party[i]!;
          if (!source) continue;
          target.level = source.level;
          target.allocated = { ...source.allocated };
          target.unspentPoints = 0;
          for (const [slot, item] of Object.entries(source.equipment)) {
            if (item) target.equipment[slot as keyof typeof target.equipment] = { ...item };
          }
        }
        rating = partyRating(probe.party, content);
        band = bandFor(effectiveRating(rating, probe.party.length));
        if (probe.dispatch({ type: "start_dungeon" }).combat!.outcome === "victory") wins += 1;
      }
      if (wins >= 3) winnable.push(dungeon.id);
    }
    console.log(
      `${`${runs} runs`.padEnd(9)}${level.toFixed(0).padEnd(8)}${String(rating).padEnd(9)}${band.padEnd(13)}` +
        `${winnable.join(", ") || "none"}`,
    );
  }
}


// ---------------------------------------------------------------------------
// 10. Is the ladder in the right order?
// ---------------------------------------------------------------------------
//
// `recommendedLevel` is what the streamer sees when choosing what to open. It
// is authored, not measured, so it can disagree with the fight — and a chat
// that meets a wall where the label promised a step does not read that as
// "wrong number", it reads it as the game being unfair.

head("10. LADDER ORDER — the label against the fight");
console.log(`\n${"dungeon".padEnd(17)}${"says".padEnd(7)}${"enemies".padEnd(9)}${"enemy hp".padEnd(11)}win at level 10   win at level 30`);
{
  // 25, not 7. At a true 70% win rate, seven trials routinely read anywhere
  // from 29% to 100%, which is wide enough to invent a ladder inversion that
  // is not there - and did.
  function winRateAt(dungeonId: string, level: number, trials = 25): { win: number; enemies: number; hp: number } {
    let wins = 0;
    let enemies = 0;
    let hp = 0;
    for (let t = 0; t < trials; t += 1) {
      const probe = new GameEngine(content, mulberry32(4200 + t));
      probe.dispatch({ type: "open_dungeon", dungeonId });
      probe.dispatch({ type: "sim_join", count: 12, dress: true });
      for (const c of probe.party) {
        c.unspentPoints += (level - c.level) * content.balance.progression.pointsPerLevel;
        c.level = level;
        spendPoints(c, c.role, content.balance);
      }
      const combat = probe.dispatch({ type: "start_dungeon" }).combat!;
      const foes = combat.combatants.filter((c) => c.side === "enemy");
      enemies = foes.length;
      hp = foes.reduce((a, c) => a + c.maxHp, 0);
      if (combat.outcome === "victory") wins += 1;
    }
    return { win: wins / trials, enemies, hp };
  }

  const rows = [...content.listDungeons()]
    .sort((a, b) => a.recommendedLevel - b.recommendedLevel)
    .map((d) => ({ d, low: winRateAt(d.id, 10), high: winRateAt(d.id, 30) }));
  for (const { d, low, high } of rows) {
    console.log(
      `${d.id.padEnd(17)}${`L${d.recommendedLevel}`.padEnd(7)}${String(low.enemies).padEnd(9)}${String(low.hp).padEnd(11)}` +
        `${`${(low.win * 100).toFixed(0)}%`.padEnd(18)}${(high.win * 100).toFixed(0)}%`,
    );
  }
  const outOfOrder = rows.filter((r, i) => i > 0 && r.low.win > rows[i - 1]!.low.win + 0.2);
  if (outOfOrder.length > 0) {
    console.log(
      `\nOut of order: ${outOfOrder.map((r) => r.d.id).join(", ")} — ` +
        `easier than something the ladder puts BELOW it.`,
    );
  }
}


// ---------------------------------------------------------------------------
// 11. The shape of the difficulty curve against turnout
// ---------------------------------------------------------------------------
//
// The one a Twitch game cannot afford to get wrong. A stream that grows should
// not get WORSE at the game, and the curve here should be flat or gently
// falling — never a hole in the middle, which is exactly the size a healthy
// small stream is.
//
// `party acts %` is the share of all actions the party took. When it collapses
// the party is not fighting, it is dying: the fight is over before most of them
// swing, and no amount of headcount helps.

head("11. THE HEADCOUNT CURVE — does a bigger chat do better or worse?");
for (const dungeon of [...content.listDungeons()].sort((a, b) => a.recommendedLevel - b.recommendedLevel)) {
  console.log(`\n${dungeon.name}  (says level ${dungeon.recommendedLevel})`);
  console.log(`${"size".padEnd(7)}${"win".padEnd(7)}${"survive".padEnd(10)}${"party acts".padEnd(12)}enemy atk`);
  const shape: number[] = [];
  for (const size of [5, 8, 10, 12, 14, 16, 20, 25, 30, 40]) {
    let wins = 0;
    let surv = 0;
    let part = 0;
    let byParty = 0;
    let byEnemy = 0;
    const trials = 15;
    for (let t = 0; t < trials; t += 1) {
      const probe = new GameEngine(content, mulberry32(2100 + t));
      probe.dispatch({ type: "open_dungeon", dungeonId: dungeon.id });
      probe.dispatch({ type: "sim_join", count: size, dress: true });
      const combat = probe.dispatch({ type: "start_dungeon" }).combat!;
      if (combat.outcome === "victory") wins += 1;
      surv += combat.survivorIds.length;
      part += probe.party.length;
      const sideOf = new Map(combat.combatants.map((c) => [c.id, c.side]));
      for (const e of combat.events) {
        if (e.type === "attack" || e.type === "heal") {
          if (sideOf.get(e.actorId) === "party") byParty += 1;
          else byEnemy += 1;
        }
      }
    }
    const ps = content.balance.partyScaling;
    // Sub-linear in headcount — per DOUBLING, not per head. Mirrors
    // partyScalingFor; printed here so the table shows what the fight was
    // actually pitched at rather than a number this file invented.
    const mult = Math.min(
      ps.maxMultiplier,
      Math.max(ps.minMultiplier, 1 + ps.atkPerDoubling * Math.log2(Math.max(1, size) / ps.baselinePartySize)),
    );
    shape.push(wins / trials);
    console.log(
      `${String(size).padEnd(7)}${pct(wins, trials).padEnd(7)}${pct(surv, part).padEnd(10)}` +
        `${pct(byParty, byParty + byEnemy).padEnd(12)}x${mult.toFixed(2)}`,
    );
  }
  // A hole is a run of sizes that lose, with winnable sizes on BOTH sides.
  const first = shape.findIndex((w) => w >= 0.4);
  const last = shape.length - 1 - [...shape].reverse().findIndex((w) => w >= 0.4);
  const hole = first >= 0 && last > first && shape.slice(first, last).some((w) => w < 0.1);
  if (hole) {
    console.log(`  ^ a dead zone: winnable at both ends, unwinnable in the middle.`);
  }
}

console.log("");
