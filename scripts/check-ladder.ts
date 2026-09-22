/**
 * Does the ladder hold its order, and do you ever outgrow anything?
 *
 * TWO PROPERTIES, and they are not the same question.
 *
 *   ORDER - at one party strength, a higher rung should be harder. If the
 *   starter dungeon is harder than the fourth one for the same people, the
 *   labels are lying.
 *
 *   PROGRESS - for one dungeon, getting stronger should make it easier. This
 *   is the one the band system works against by design: a band adapts the
 *   fight to whoever turned up, so a place engineered to be a fair fight for
 *   its reference party stays a fair fight forever and is never outgrown.
 *
 * Measured across several party strengths because a single one cannot tell
 * those apart, and because the only reason this file exists is that
 * conclusions were repeatedly drawn here from one sample.
 *
 * This is a MEASUREMENT, not a gate. It prints a table and says which
 * properties hold. Tuning happens in author-bands.ts, which runs a hundred
 * samples per band; the numbers here are for reading the shape.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { GameEngine } from "../src/engine/state/gameEngine.js";
import { mulberry32 } from "../src/engine/rng.js";
import { spendPoints } from "../src/engine/difficulty.js";
import { partyRating } from "../src/engine/partyStrength.js";
import { bandFor, effectiveRating } from "../src/engine/squad.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");
const c = new ContentRegistry();
c.loadGearDir(join(CONTENT, "gear"));
c.loadDungeonsDir(join(CONTENT, "dungeons"));
c.loadConsumablesDir(join(CONTENT, "consumables"));
c.loadBalance(join(CONTENT, "balance.json"));

/** Party strengths a real chat passes through, not band reference parties. */
const RUNGS = [
  { label: "L5", level: 5, size: 12 },
  { label: "L15", level: 15, size: 12 },
  { label: "L30", level: 30, size: 12 },
  { label: "L60", level: 60, size: 12 },
  { label: "L120", level: 120, size: 12 },
];

const TRIALS = 25;

function winRate(dungeonId: string, level: number, size: number): { win: number; rating: number; band: string } {
  let wins = 0;
  let rating = 0;
  let band = "";
  for (let t = 0; t < TRIALS; t += 1) {
    const probe = new GameEngine(c, mulberry32(9100 + t * 131));
    probe.dispatch({ type: "open_dungeon", dungeonId });
    probe.dispatch({ type: "sim_join", count: size, dress: true });
    for (const ch of probe.party) {
      ch.unspentPoints += (level - ch.level) * c.balance.progression.pointsPerLevel;
      ch.level = level;
      spendPoints(ch, ch.role, c.balance);
    }
    rating = partyRating(probe.party, c);
    band = bandFor(effectiveRating(rating, size));
    const combat = probe.dispatch({ type: "start_dungeon" }).combat!;
    if (combat.outcome === "victory") wins += 1;
  }
  return { win: wins / TRIALS, rating, band };
}

const ladder = [...c.listDungeons()].sort((a, b) => a.recommendedLevel - b.recommendedLevel);
const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(5);

console.log(`\nWin rate, ${TRIALS} runs per cell, a chat of 12.\n`);
console.log(`${"dungeon".padEnd(26)}${"says".padEnd(6)}${RUNGS.map((r) => r.label.padStart(7)).join("")}`);

const table: Record<string, number[]> = {};
for (const d of ladder) {
  const row = RUNGS.map((r) => winRate(d.id, r.level, r.size).win);
  table[d.id] = row;
  console.log(`${d.name.slice(0, 24).padEnd(26)}${`L${d.recommendedLevel}`.padEnd(6)}${row.map(pct).map((s) => s.padStart(7)).join("")}`);
}

console.log(`\n${"party band at each strength".padEnd(26)}${"".padEnd(6)}` +
  RUNGS.map((r) => winRate(ladder[0]!.id, r.level, r.size).band.slice(0, 6).padStart(7)).join(""));

// --- does ORDER hold at each strength? -------------------------------------
console.log("\nORDER - at one strength, a higher rung should not be easier:\n");
let orderBad = 0;
for (let col = 0; col < RUNGS.length; col += 1) {
  const breaks: string[] = [];
  for (let i = 1; i < ladder.length; i += 1) {
    const lower = table[ladder[i - 1]!.id]![col]!;
    const upper = table[ladder[i]!.id]![col]!;
    if (upper > lower + 0.12) breaks.push(`${ladder[i]!.name.slice(0, 14)} easier than ${ladder[i - 1]!.name.slice(0, 14)}`);
  }
  if (breaks.length) orderBad += 1;
  console.log(`  ${RUNGS[col]!.label.padEnd(5)} ${breaks.length ? breaks.join("; ") : "holds"}`);
}

// --- does PROGRESS hold for each dungeon? ----------------------------------
console.log("\nPROGRESS - one dungeon should get easier as the party grows:\n");
let progressBad = 0;
for (const d of ladder) {
  const row = table[d.id]!;
  const first = row[0]!;
  const last = row[row.length - 1]!;
  const outgrown = last >= first - 0.05;
  if (!outgrown) progressBad += 1;
  console.log(`  ${d.name.slice(0, 24).padEnd(26)} ${pct(first)} at L5 -> ${pct(last)} at L120  ${outgrown ? "" : "<-- HARDER as it grows"}`);
}

console.log("");
console.log(`${orderBad} of ${RUNGS.length} strengths break the ladder order.`);
console.log(`${progressBad} of ${ladder.length} dungeons get HARDER as the party grows.`);
console.log("");
