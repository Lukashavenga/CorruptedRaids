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
 * WHAT IT READS. The repo's `content/` by default, because a check in the
 * verification chain has to be offline and deterministic. Content actually
 * lives in Supabase now and the hosted admin panel edits it there, so
 * `--live` reads the store instead - that is the copy the game plays, and the
 * one worth checking before a stream.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

function fromDisk(): Subject[] {
  const read = (dir: string): unknown[] => {
    const path = join(ROOT, "content", dir);
    if (!existsSync(path)) return [];
    return readdirSync(path)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(path, f), "utf-8")) as unknown);
  };
  return fightsFrom(read("dungeons"), read("raids"));
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
  for (const row of rows) {
    if (row.path.startsWith("dungeons/")) dungeons.push(row.data);
    else if (row.path.startsWith("raids/")) raids.push(row.data);
  }
  return fightsFrom(dungeons, raids);
}

const subjects = LIVE ? await fromStore() : fromDisk();

const level = (band: PartyBand): string => `L${PARTY_BANDS.indexOf(band) + 1}`;

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

    if (previousBand && count <= previous) {
      const how = count === previous ? `matches ${level(previousBand)}` : `is smaller than ${level(previousBand)}`;
      problems.push(
        `${label} ${level(band)} ${how} (${previous} -> ${count}) - squadFor turns the count ramp off across that boundary.`,
      );
    }

    previous = count;
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
  console.error("Levels must grow:");
  for (const problem of problems) console.error(`  FAIL  ${problem}`);
  console.error("");
  console.error("Add bodies to the level named, in the admin panel's Dungeons tab - one");
  console.error("formation per level, each with more units than the level below it. Then");
  console.error("re-solve the stat curve with `npx tsx scripts/author-bands.ts`, because");
  console.error("the two are solved together and a changed layout invalidates the old curve.");
  process.exit(1);
}

console.log(`\nEvery level grows on the one below it (${subjects.length} fights checked).`);
