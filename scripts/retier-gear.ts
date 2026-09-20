/**
 * Sets each gear item's rarity to match what it actually does.
 *
 *   npx tsx scripts/retier-gear.ts            # report
 *   npx tsx scripts/retier-gear.ts --write    # apply
 *
 * The generated catalogue derives stats from a sprite's position in its sheet
 * and rarity from that same position, INDEPENDENTLY — so the two drifted apart
 * and 70 of 119 items ended up outside the power band their rarity implies. A
 * legendary that is weaker than an uncommon is not a interesting surprise, it
 * is a bug the player feels as the loot table lying to them.
 *
 * Rarity is the derived property here, not the stats. An item's numbers are the
 * design decision; its label should follow from them. Doing it the other way
 * round — forcing stats to fit a chosen rarity — would flatten every item in a
 * tier to the same power and make loot boring.
 *
 * Uses powerScore from src/engine/statGuide.ts rather than reimplementing the
 * weights, so this cannot drift from what the admin screen shows.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { powerScore, RARITY_POWER_BAND } from "../src/engine/statGuide.js";
import { RARITIES } from "../src/engine/types.js";
import type { Rarity } from "../src/engine/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");

const content = new ContentRegistry();
content.loadGearDir(join(CONTENT, "gear"));
content.loadBalance(join(CONTENT, "balance.json"));

/** The lowest rarity whose band contains this power, or legendary if it exceeds them all. */
function rarityFor(power: number): Rarity {
  for (const rarity of RARITIES) {
    const [lo, hi] = RARITY_POWER_BAND[rarity]!;
    if (power >= lo && power <= hi) return rarity;
  }
  return power > (RARITY_POWER_BAND.legendary?.[1] ?? 0) ? "legendary" : "common";
}

const write = process.argv.includes("--write");
let moved = 0;
const counts: Record<string, number> = {};

for (const item of content.listGear()) {
  const power = powerScore(item.statMods, content.balance);
  const next = rarityFor(power);
  counts[next] = (counts[next] ?? 0) + 1;
  if (next === item.rarity) continue;

  moved += 1;
  console.log(`${item.name.padEnd(24)} ${item.rarity.padEnd(10)} -> ${next.padEnd(10)} (power ${power})`);

  if (write) {
    const path = join(CONTENT, "gear", `${item.id}.json`);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    raw.rarity = next;
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  }
}

console.log(`\n${moved} of ${content.listGear().length} items re-tiered.`);
console.log("resulting spread:", RARITIES.map((r) => `${r} ${counts[r] ?? 0}`).join(", "));
console.log(write ? "written to content/gear/" : "re-run with --write to apply");
