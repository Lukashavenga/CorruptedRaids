/**
 * Retunes each dungeon's PRESSURE until it sits in a target difficulty band.
 *
 *   npx tsx scripts/tune-dungeons.ts            # report only
 *   npx tsx scripts/tune-dungeons.ts --write    # write content/dungeons/*.json
 *
 * WHY WEIGHT AND NOT COUNTS OR STATS
 * ----------------------------------
 * This used to scale `enemies[].count`, and that field no longer exists: a
 * dungeon owns its own bodies now (see FightDefinition), so "how many" is a
 * layout somebody authored rather than a multiplier this can turn.
 *
 * What is left is the right lever anyway. Initiative is drawn from every
 * living combatant at once, so how often the enemy side acts is what decides a
 * fight — measured, five of six stat sliders cannot move an outcome at all,
 * while the initiative weight took one squad from 93% win to 0% between 2 and
 * 4. `weight` is that dial, per body, and scaling it leaves the authored
 * layout — who stands where, who is the healer — exactly as drawn.
 *
 * The target band is "Fair" (see src/engine/difficulty.ts): the party wins
 * most of the time but loses people doing it. A stream wants tension, not a
 * coin flip.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { estimateDifficulty, referencePartyStrength } from "../src/engine/difficulty.js";
import type { DungeonDefinition } from "../src/engine/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");

/** Aim just inside "Fair", leaving room for gear and levels to push it easier. */
const TARGET_WIN = 0.7;
const SAMPLES = 120;

/** The party a dungeon is authored against: one of each support, the rest damage. */
function referenceComposition(size: number) {
  const tanks = Math.max(1, Math.round(size * 0.2));
  const healers = Math.max(1, Math.round(size * 0.2));
  return { tanks, healers, dps: Math.max(1, size - tanks - healers) };
}

function load(): ContentRegistry {
  const c = new ContentRegistry();
  c.loadGearDir(join(CONTENT, "gear"));
  c.loadDungeonsDir(join(CONTENT, "dungeons"));
  c.loadConsumablesDir(join(CONTENT, "consumables"));
  c.loadBalance(join(CONTENT, "balance.json"));
  return c;
}

function winRateWith(c: ContentRegistry, dungeon: DungeonDefinition, multiplier: number, partySize: number): number {
  // Expanded at the strength the reference party actually is, so this measures
  // the band that party would meet rather than a layout nobody sees.
  const strength = referencePartyStrength(referenceComposition(partySize), dungeon.recommendedLevel, c);
  const enemies = c
    .expandDungeonEnemies(dungeon, strength)
    .map((e) => ({ ...e, initiativeWeight: (e.initiativeWeight ?? 1) * multiplier }));
  return estimateDifficulty(enemies, c, {
    composition: referenceComposition(partySize),
    level: dungeon.recommendedLevel,
    samples: SAMPLES,
  }).winRate;
}

const write = process.argv.includes("--write");
const content = load();
const PARTY = 6;

console.log(`target win rate ${(TARGET_WIN * 100).toFixed(0)}% for a party of ${PARTY} at each dungeon's own level\n`);
console.log("dungeon              before   x     after   bodies");

for (const dungeon of [...content.listDungeons()].sort((a, b) => a.recommendedLevel - b.recommendedLevel)) {
  const before = winRateWith(content, dungeon, 1, PARTY);

  // Pick the multiplier CLOSEST to the target, not the first one under it.
  // Stopping at the first pass overshot wildly — enemy counts are integers, so
  // one step of the multiplier can take a fight from 100% to 7%, and "the
  // first value below target" is then nowhere near it.
  let best = 1;
  let bestGap = Infinity;
  // Downward as well as up. This list used to start at 1, so the search could
  // only ever make a dungeon harder — which was survivable while the reference
  // party was accidentally over-levelled and every fight read as too easy, and
  // useless the moment that was fixed and the late tiers turned out to be
  // unwinnable.
  for (const m of [0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.85, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8, 10]) {
    const gap = Math.abs(winRateWith(content, dungeon, m, PARTY) - TARGET_WIN);
    if (gap < bestGap) {
      bestGap = gap;
      best = m;
    }
  }

  const after = winRateWith(content, dungeon, best, PARTY);
  const total = content.expandDungeonEnemies(dungeon, 0).length;

  console.log(
    `${dungeon.name.padEnd(20)} ${(before * 100).toFixed(0).padStart(4)}%  ${String(best).padStart(4)}  ` +
      `${(after * 100).toFixed(0).padStart(4)}%   ${total}`,
  );

  if (write) {
    // Multiplies every body's weight in place. The layout is untouched — this
    // only changes how often the people already standing there get to act.
    const path = join(CONTENT, "dungeons", `${dungeon.id}.json`);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    for (const units of Object.values(raw.formations) as any[]) {
      for (const unit of units ?? []) {
        unit.weight = Math.round((unit.weight ?? 1) * best * 100) / 100;
      }
    }
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  }
}

console.log(write ? "\nwritten to content/dungeons/" : "\nre-run with --write to apply");
