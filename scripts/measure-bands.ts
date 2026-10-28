// Prints what each level's sample party actually rates, plus the naked ten.
// The numbers BAND_THRESHOLDS and ENTRY_RATING are set from (AGENTS.md §5).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { referencePartyStrength } from "../src/engine/difficulty.js";
import { BAND_SAMPLE_PARTY, BAND_THRESHOLDS, ENTRY_RATING } from "../src/engine/squad.js";
import { PARTY_BANDS } from "../src/engine/types.js";

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content");
const content = new ContentRegistry();
content.loadGearDir(join(CONTENT_DIR, "gear"));
content.loadBalance(join(CONTENT_DIR, "balance.json"));
// Seed 1 is the one the solver, the admin meter and `simulate` all build their
// sample parties with, so it is the reading the thresholds must agree with.
// SEEDS > 1 averages "typical" gear (which is random) for a sense of the spread.
const SEEDS = Number(process.argv[2] ?? 1);

const entry = referencePartyStrength({ tanks: 2, dps: 6, healers: 2 }, 1, content, "none");
console.log(`naked ten: ${entry} (ENTRY_RATING ${ENTRY_RATING})`);
const readings: number[] = [];
for (const band of PARTY_BANDS) {
  const s = BAND_SAMPLE_PARTY[band];
  const t = Math.max(1, Math.round(s.size / 6));
  const comp = { tanks: t, healers: t, dps: s.size - 2 * t };
  const seeds = s.gear === "typical" ? SEEDS : 1;
  let sum = 0;
  for (let seed = 1; seed <= seeds; seed += 1) sum += referencePartyStrength(comp, s.level, content, s.gear, seed);
  const rating = Math.round(sum / seeds);
  readings.push(rating);
  console.log(`${band.padEnd(12)} L${String(s.level).padEnd(4)} ${s.gear.padEnd(8)} rating ${String(rating).padStart(6)}   threshold now ${BAND_THRESHOLDS[band]}`);
}
console.log("geometric midpoints:", readings.slice(1).map((r, i) => Math.round(Math.sqrt(r * readings[i]!))).join(" "));
