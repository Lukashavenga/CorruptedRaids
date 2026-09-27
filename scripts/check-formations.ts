/**
 * Does every level field more bodies than the level below it?
 *
 * THIS IS A STRUCTURAL RULE, NOT A TASTE ONE, which is why it fails the build
 * when the progression simulator deliberately does not. `squadFor` interpolates
 * a fight's body count across a level boundary - at the floor of Level 3 you
 * field as many bodies as Level 2 had, at the ceiling you field all of Level 3
 * - and that ramp exists because the step it replaced was measured as savage:
 * at BARBIEVILLE one extra joiner once took the party from the `weak` layout to
 * the whole `seasoned` one, 85% more enemy HP for one more person, and the win
 * rate went 73% at seven players to 33% at ten.
 *
 * But the ramp is guarded:
 *
 *     if (prev === units || prev.length >= units.length) return units;
 *
 * A level that does not GROW on the one below it turns the smoothing off and
 * restores the exact cliff it was built to prevent. So this is not "we would
 * prefer levels to get bigger" - it is the precondition the engine is written
 * against, and violating it silently disables a feature.
 *
 * Every dungeon in the repo violated it somewhere when this was written:
 *
 *                          L1   L2   L3   L4   L5   L6
 *     poors                 6   11   16   16   18   26
 *     lady-of-knight        5   38   40   40   40   40
 *     monks                13   19   22   21   25    -
 *     barbie                3    6    6    8   11   10
 *     cops                  3    5    7    6    6    7
 *
 * BUT "MORE BODIES" IS THE PROXY, NOT THE RULE. The first version of this
 * failed on body count alone, and the raid immediately proved that wrong: the
 * top level of three raid rooms and the boss is ONE unit where the level below
 * has two or three - a king-boss sprite at scale 1.7, a role, placed by hand.
 * That is a boss encounter, it is a shape the engine supports, and a check
 * that calls it a mistake is a check that tells you to delete your boss
 * fights.
 *
 * So what is actually compared is POWER - every unit the level fields, priced
 * with `ratePoints`, the same scorer §5 uses for party strength and gear, and
 * expanded at that level's own reference party so the band multiplier is in
 * the number. A level that fields fewer bodies but hits harder is a boss and
 * is reported as one. A level that fields no more bodies AND no more power is
 * the real failure: it is not a level, it is a copy of the one below it.
 *
 * WHAT IT READS. The repo's `content/` by default, because a check in the
 * verification chain has to be offline and deterministic. Content actually
 * lives in Supabase now and the hosted admin panel edits it there, so
 * `--live` reads the store instead - that is the copy the game plays, and the
 * one worth checking before a stream. `npm run pull:content` reconciles them.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { ratePoints } from "../src/engine/partyStrength.js";
import { unitStats } from "../src/engine/squad.js";
import { PARTY_BANDS } from "../src/engine/types.js";
import type { FightDefinition, PartyBand } from "../src/engine/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");

/** One fight to check, and enough of a name to find it again in the admin. */
interface Subject {
  label: string;
  fight: FightDefinition;
}

function fightsFrom(dungeons: unknown[], raids: unknown[]): Subject[] {
  const out: Subject[] = [];
  for (const raw of dungeons) {
    const dungeon = raw as FightDefinition & { id: string };
    out.push({ label: `dungeon ${dungeon.id}`, fight: dungeon });
  }
  for (const raw of raids) {
    const raid = raw as {
      id: string;
      rooms?: { id: string; fight?: FightDefinition }[];
      boss?: { id: string; fight?: FightDefinition };
    };
    for (const room of raid.rooms ?? []) {
      if (room.fight) out.push({ label: `raid ${raid.id} / ${room.id}`, fight: room.fight });
    }
    if (raid.boss?.fight) out.push({ label: `raid ${raid.id} / boss`, fight: raid.boss.fight });
  }
  return out;
}

/** The registry, so power can be priced with the real balance and gear. */
let content: ContentRegistry;

function fromDisk(): Subject[] {
  const read = (dir: string): unknown[] => {
    const path = join(ROOT, "content", dir);
    if (!existsSync(path)) return [];
    return readdirSync(path)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(path, f), "utf-8")) as unknown);
  };
  const dungeons = read("dungeons");
  const raids = read("raids");
  content = new ContentRegistry();
  content.loadObjects({
    gear: read("gear"),
    consumables: read("consumables"),
    dungeons,
    raids,
    balance: JSON.parse(readFileSync(join(ROOT, "content", "balance.json"), "utf-8")) as unknown,
  });
  return fightsFrom(dungeons, raids);
}

async function fromStore(): Promise<Subject[]> {
  const { fetchContent } = await import("../src/server/contentStore.js");
  const rows = await fetchContent();
  if (!rows) {
    console.error("--live needs SUPABASE_URL and SUPABASE_SERVICE_KEY. Run with --env-file-if-exists=.env.");
    process.exit(1);
  }
  const dungeons: unknown[] = [];
  const raids: unknown[] = [];
  const gear: unknown[] = [];
  const consumables: unknown[] = [];
  let balance: unknown;
  for (const row of rows) {
    if (row.path.startsWith("dungeons/")) dungeons.push(row.data);
    else if (row.path.startsWith("raids/")) raids.push(row.data);
    else if (row.path.startsWith("gear/")) gear.push(row.data);
    else if (row.path.startsWith("consumables/")) consumables.push(row.data);
    else if (row.path === "balance.json") balance = row.data;
  }
  content = new ContentRegistry();
  content.loadObjects({ gear, consumables, dungeons, raids, balance });
  return fightsFrom(dungeons, raids);
}

const subjects = LIVE ? await fromStore() : fromDisk();

const level = (band: PartyBand): string => `L${PARTY_BANDS.indexOf(band) + 1}`;

/**
 * What the author DREW, priced - with no band multiplier anywhere near it.
 *
 * The first attempt priced the expanded fight, and that was measuring the
 * wrong thing: `bandStatScale` is solved per band to hit a target win rate, so
 * it rises at every level by construction, and every comparison passed. It
 * exempted a level from the rule using the very number that is supposed to be
 * independent of the layout.
 *
 * So this prices the authored units alone - base stats, the unit's own
 * overrides, its role scaling - which is exactly the thing the author controls
 * in the Dungeons tab and exactly what the count rule is about.
 */
function authoredPower(fight: FightDefinition, band: PartyBand): number {
  const units = fight.formations?.[band] ?? [];
  // Strength counts as that many bodies - it multiplies hp AND turns (see
  // EnemyUnit.strength), so a Boss at 8 is priced as eight of whatever it is.
  return units.reduce(
    (sum, unit) => sum + ratePoints(unitStats(fight.stats, unit.role, unit.stats), content.balance) * (unit.strength ?? 1),
    0,
  );
}

/**
 * Units drawn bigger than life, which is how this content marks a boss.
 *
 * There is no `boss` flag on a unit - `scale` is the only signal, and it is a
 * SPRITE SIZE. That distinction is the whole point of reporting it: a level
 * whose units are scaled up but carry no stat overrides is one ordinary body
 * wearing a king's portrait, and it will measure like one.
 */
function drawnBig(fight: FightDefinition, band: PartyBand): boolean {
  const units = fight.formations?.[band] ?? [];
  return units.length > 0 && units.every((u) => (u as { scale?: number }).scale !== undefined && ((u as { scale?: number }).scale ?? 1) > 1);
}

/** 1.2k, 340 - the table is for reading, and exact digits do not help. */
function short(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

const problems: string[] = [];
const warnings: string[] = [];

console.log(`BODIES PER LEVEL  (${LIVE ? "live store" : "content/ on disk"})\n`);
// Wide enough for the longest name present, so a raid room does not shove the
// columns out of line at exactly the moment the table has something to say.
const WIDTH = Math.max(20, ...subjects.map((s) => s.label.length)) + 2;

console.log(`${"".padEnd(WIDTH)}${PARTY_BANDS.map((_, i) => `L${i + 1}`.padStart(5)).join("")}`);

for (const { label, fight } of subjects) {
  const counts = PARTY_BANDS.map((band) => fight.formations?.[band]?.length ?? 0);
  console.log(`${label.padEnd(WIDTH)}${counts.map((n) => (n === 0 ? "-" : String(n)).padStart(5)).join("")}`);

  // The last level anyone authored. Everything above it is unbuilt rather
  // than broken, which is a normal state to leave a dungeon in overnight.
  const highest = counts.reduce((best, n, i) => (n > 0 ? i : best), -1);
  if (highest < 0) {
    problems.push(`${label} has no formations at all - it can field nothing.`);
    continue;
  }

  let previous = 0;
  let previousPower = 0;
  let previousBand: PartyBand | null = null;

  for (const [i, count] of counts.entries()) {
    const band = PARTY_BANDS[i]!;

    if (count === 0) {
      if (i < highest) {
        // A hole UNDER an authored level. The fight falls back to the nearest
        // level below, so this one is identical to it - and the level above
        // then grows off the wrong number.
        problems.push(`${label} ${level(band)} has no formation, but ${level(PARTY_BANDS[highest]!)} does - it will field ${level(previousBand ?? band)}'s layout.`);
      }
      // Trailing gaps are reported once per fight, below, rather than once per
      // level: a raid room that authors only L1 is a normal, deliberate shape,
      // and five identical notes about it buries the nine real failures.
      continue;
    }

    const power = authoredPower(fight, band);

    if (previousBand && count <= previous) {
      const how = count === previous ? "matches" : "is smaller than";
      if (power > previousPower) {
        // Fewer bodies, genuinely harder ones: a boss, and the count ramp
        // being off across this boundary is correct - you do not want to
        // interpolate from three guards to half a king.
        warnings.push(
          `${label} ${level(band)} ${how} ${level(previousBand)} in bodies (${previous} -> ${count}) but hits harder (${short(previousPower)} -> ${short(power)}) - reads as a boss.`,
        );
      } else if (drawnBig(fight, band)) {
        problems.push(
          `${label} ${level(band)} ${how} ${level(previousBand)} in bodies (${previous} -> ${count}) and is WEAKER (${short(previousPower)} -> ${short(power)}). ` +
            `Its units are drawn bigger, but size is only a sprite size - raise their Strength in the unit editor, or it is one ordinary body wearing a king's portrait.`,
        );
      } else {
        problems.push(
          `${label} ${level(band)} ${how} ${level(previousBand)} in bodies (${previous} -> ${count}) and is no stronger (${short(previousPower)} -> ${short(power)}).`,
        );
      }
    }

    previous = count;
    previousPower = power;
    previousBand = band;
  }

  const topAuthored = PARTY_BANDS[highest]!;
  if (highest < PARTY_BANDS.length - 1) {
    const rest = PARTY_BANDS.slice(highest + 1).map(level);
    const verb = rest.length === 1 ? "fields" : "field";
    warnings.push(`${label} stops at ${level(topAuthored)}; ${rest.join(", ")} ${verb} it unchanged.`);
  }
}

console.log("");
for (const warning of warnings) console.log(`  note  ${warning}`);

if (problems.length > 0) {
  console.error("");
  console.error("A level must field more bodies than the one below, or hit harder:");
  for (const problem of problems) console.error(`  FAIL  ${problem}`);
  console.error("");
  console.error("In the admin panel's Dungeons tab, give the level named another body or");
  console.error("make one of its bodies stronger (Elite, Champion, Boss) - a Boss is worth");
  console.error("eight regulars without crowding the stage. Then press Solve all levels,");
  console.error("because a changed squad invalidates the level's old multiplier.");
  process.exit(1);
}

console.log(`\nEvery level grows on the one below it (${subjects.length} fights checked).`);
