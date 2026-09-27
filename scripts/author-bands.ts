/**
 * Authors the difficulty bands a dungeon cannot field yet, and MEASURES each
 * one into the target band before writing it.
 *
 *   npx tsx scripts/author-bands.ts            # report only
 *   npx tsx scripts/author-bands.ts --write    # write content/dungeons/*.json
 *
 * WHY THIS EXISTS
 * ---------------
 * Every dungeon topped out at `elite` and two had only a `weak` layout, so
 * `squadFor` fell back DOWN and a party rated 3,000 met exactly the fight a
 * party rated 500 met — three of the six bands were decoration. That is an
 * afternoon in the Dungeons tab per dungeon, times five, and every one of them
 * has to be re-measured by hand afterwards. This does the same job against the
 * same estimator the admin's meter uses.
 *
 * WHAT IT TUNES, AND IN WHICH ORDER
 * ---------------------------------
 * 1. **Bodies.** A higher band should look like more of them, so the count
 *    escalates per band — but only gently, and capped. Past about forty the
 *    overlay is a smear and the fight is long rather than hard.
 * 2. **Roles.** A body with no role gets no ENEMY_ROLE_SCALING, no skill floor
 *    and threat multiplier 1 (AGENTS.md §2.4). Every shipped body was
 *    roleless, so assigning them is the single largest untouched lever, and it
 *    escalates a band the way the design intends — nastier units, not merely
 *    more of them.
 * 3. **Initiative weight**, last, as the fine dial. scripts/tune-dungeons.ts
 *    documents why: initiative is drawn from every living combatant, so how
 *    OFTEN the enemy side acts decides a fight where five of six stat sliders
 *    cannot. It is the knob that closes the last few points of win rate
 *    without touching the layout anybody drew.
 *
 * A band is only written once the estimator agrees it lands in "Fair" against
 * that band's own reference party (BAND_SAMPLE_PARTY). Nothing here is derived
 * from a formula — AGENTS.md §6, difficulty is measured or it is a guess.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { ratingFor } from "../src/engine/difficulty.js";
import { measureBand, solveFight } from "../src/engine/bandSolver.js";
import { PARTY_BANDS, type EnemyUnit, type FightDefinition, type PartyBand, type Role } from "../src/engine/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");
const WRITE = process.argv.includes("--write");
/** Never rewrite an authored formation; solve the curve against what is there. */
const KEEP_LAYOUTS = process.argv.includes("--keep-layouts");

/** Aim just inside "Fair" — the party wins most nights but loses people. */
const TARGET_WIN = 0.7;
/** Past this the overlay is a smear and the fight is long rather than hard. */
const MAX_BODIES = 40;

/** How many more bodies each band fields than the one below it. */
const BODY_GROWTH = 1.18;

/**
 * Share of the squad carrying a role, per band.
 *
 * Climbs deliberately: `weak` stays all-Plain so the entry fight is exactly as
 * soft as it reads, and the top band is mostly roled, which is what makes an
 * apocalyptic squad feel like an army rather than a crowd.
 */
const ROLE_SHARE: Record<PartyBand, number> = {
  weak: 0,
  seasoned: 0.15,
  elite: 0.3,
  brutal: 0.45,
  infernal: 0.6,
  apocalyptic: 0.75,
};

/** Tank / healer / dps in the proportions that make a squad awkward to chew. */
const ROLE_CYCLE: Role[] = ["dps", "tank", "dps", "healer", "dps", "tank"];

function load(): ContentRegistry {
  const c = new ContentRegistry();
  c.loadGearDir(join(CONTENT, "gear"));
  c.loadDungeonsDir(join(CONTENT, "dungeons"));
  c.loadConsumablesDir(join(CONTENT, "consumables"));
  c.loadBalance(join(CONTENT, "balance.json"));
  c.loadShop(join(CONTENT, "shop.json"));
  return c;
}

/**
 * Lays `n` bodies out in ranks.
 *
 * Rows go BACK from y=1, and each row is offset half a step in x so the ranks
 * read as a crowd rather than a grid. The existing hand-drawn layouts do the
 * same thing by eye; this reproduces it so a generated band sits beside an
 * authored one without looking machine-made.
 */
function placements(n: number): { x: number; y: number }[] {
  const perRow = Math.min(9, Math.max(5, Math.ceil(n / 3)));
  const rows = Math.ceil(n / perRow);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, n - row * perRow);
    // Deeper rows sit higher on screen and tighter together.
    const y = Number((1 - row * 0.055).toFixed(3));
    const spread = 0.89;
    const step = inRow > 1 ? spread / (inRow - 1) : 0;
    const offset = row % 2 === 1 ? step / 2 : 0;
    out.push({ x: Number(Math.min(0.93, 0.04 + col * step + offset).toFixed(3)), y });
  }
  return out;
}

/**
 * A band's layout, built from the highest one already authored.
 *
 * Unit TEMPLATES (name, sprite, stats, loot, rewards) are reused verbatim and
 * cycled, so a generated band fields the same cast the author drew rather than
 * inventing bodies nobody has art for. Only how many, what role they carry,
 * how often they act and where they stand are decided here.
 */
function buildLayout(seed: EnemyUnit[], band: PartyBand, count: number, weight: number): EnemyUnit[] {
  const templates = seed.length ? seed : [];
  if (!templates.length) return [];
  const spots = placements(count);
  const roled = Math.round(count * ROLE_SHARE[band]);
  const out: EnemyUnit[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = templates[i % templates.length]!;
    // Roles land on the BACK ranks first (highest index), so the front line a
    // viewer actually sees stays the cast they know and the nasty ones are the
    // reinforcements behind them.
    const role: Role | undefined = i >= count - roled ? ROLE_CYCLE[i % ROLE_CYCLE.length] : undefined;
    const unit: EnemyUnit = {
      ...t,
      id: `${band}-${i}`,
      x: spots[i]!.x,
      y: spots[i]!.y,
    };
    if (role) unit.role = role;
    else delete (unit as { role?: Role }).role;
    if (weight !== 1) unit.weight = Number(weight.toFixed(3));
    else delete (unit as { weight?: number }).weight;
    out.push(unit);
  }
  return out;
}

const c = load();

/**
 * The win rate each rung of the ladder aims for, at EVERY band.
 *
 * This is the one number in here that is a design decision rather than a
 * measurement, so it is written down in one place and argued with here.
 *
 * It resolves a fork the repo left open. AGENTS.md §2 settles that difficulty
 * is ONE axis — the band, picked by who turned up — and that "a dungeon is a
 * place". §10 then complains that "the ladder is out of order", which only
 * means anything if a place labelled L16 is supposed to be harder than one
 * labelled L4. Both are true at once if, and only if, the band adapts to the
 * party while the PLACE keeps a fixed premium on top. So:
 *
 *   band    -> how hard tonight is for the people who actually turned up
 *   dungeon -> how hard this place is, at any band
 *
 * `recommendedLevel` is explicitly "display only; nothing gates on it"
 * (types.ts), so it is safe to read it as the rung it always looked like and
 * make the label honest rather than decorative.
 *
 * The floor is 0.5 rather than lower because this is a stream where an
 * audience joined to win (difficulty.ts): the hardest place in the game should
 * be a coin flip you usually take, not a wipe you watch.
 */
const LADDER_TARGET = [0.85, 0.78, 0.7, 0.62, 0.55];

function targetFor(rung: number): number {
  return LADDER_TARGET[Math.min(rung, LADDER_TARGET.length - 1)]!;
}

/**
 * The dungeon's own target when it has one, the ladder's otherwise.
 *
 * The admin panel lets an author set `targetWinRate` per dungeon now, and this
 * script must not quietly solve towards a different number than the panel
 * shows. The ladder is only the default for a dungeon nobody has decided about.
 */
function targetOf(dungeon: { targetWinRate?: number }, rung: number): number {
  return dungeon.targetWinRate ?? targetFor(rung);
}

/**
 * Solve one dungeon's `bandStatScale`, band by band.
 *
 * Per dungeon, because a global curve provably cannot work: solved to the
 * median it put the easy places in "Fair" and left the hard ones at 0% for
 * every band, which is the ladder being flattened from the wrong end.
 *
 * `weak` is included rather than anchored at 1. It is the band a brand-new
 * chat meets — ten characters at level 1 in NO gear — and leaving it alone is
 * how a previous attempt at this shipped a starter dungeon a fresh chat could
 * not beat. If the entry fight needs to come DOWN to be winnable naked, this
 * lets it.
 */
function solveDungeonScale(dungeonId: string, rung: number): Record<PartyBand, number> {
  // The engine's solver - the same one behind the admin panel's Solve buttons
  // and the operator Edge Function - so the three cannot disagree about what a
  // level needs. It carries the ratchet and the reasoning for it; see
  // src/engine/bandSolver.ts.
  const dungeon = c.getDungeon(dungeonId) as unknown as FightDefinition & { targetWinRate?: number };
  const { scale } = solveFight(dungeon, c, { target: targetOf(dungeon, rung) });
  return scale as Record<PartyBand, number>;
}

interface DungeonPlan {
  id: string;
  name: string;
  rung: number;
  target: number;
  layouts: { band: PartyBand; layout: EnemyUnit[] }[];
  scale: Record<PartyBand, number>;
  measured: { band: PartyBand; win: number; bodies: number }[];
}

const plans: DungeonPlan[] = [];
const ladder = [...c.listDungeons()].sort((a, b) => a.recommendedLevel - b.recommendedLevel);

for (const [rung, dungeon] of ladder.entries()) {
  const formations = (dungeon.formations ?? {}) as Record<string, EnemyUnit[]>;
  const target = targetOf(dungeon, rung);
  console.log(`
${"=".repeat(78)}`);
  console.log(`${dungeon.name}  (rung ${rung + 1}, says level ${dungeon.recommendedLevel}) -> target ${(target * 100).toFixed(0)}%`);
  console.log("=".repeat(78));

  // 1. LAYOUTS FIRST, at weight 1. A generated band escalates by bodies and
  //    roles — what the fight LOOKS like — and nothing else. All of the
  //    difficulty is carried by the stat scale solved in step 2, because two
  //    levers bisected against one target just fight each other.
  const layouts: { band: PartyBand; layout: EnemyUnit[] }[] = [];
  let seed: EnemyUnit[] = [];
  let seedCount = 0;
  for (const band of PARTY_BANDS) {
    const existing = formations[band];
    if (existing?.length) {
      seed = existing;
      seedCount = existing.length;
      continue;
    }
    if (!seed.length) continue;
    const count = Math.min(MAX_BODIES, Math.max(seedCount + 1, Math.round(seedCount * BODY_GROWTH)));
    const layout = buildLayout(seed, band, count, 1);
    formations[band] = layout;
    layouts.push({ band, layout });
    seed = layout;
    seedCount = count;
  }

  // 2. Then solve this dungeon's own curve against those layouts.
  let scale = solveDungeonScale(dungeon.id, rung);
  (dungeon as unknown as { bandStatScale?: Record<string, number> }).bandStatScale = scale;

  // 3. TRIM ANY BAND THE SCALE CANNOT RESCUE.
  //
  // A stat multiplier cannot undo a body count. Initiative is drawn from every
  // living combatant, so thirty-two bodies out-act a party of ten however weak
  // each one is made: Ladies of The Knight bottomed out at x0.09 — essentially
  // harmless individually — and still only let a naked party win 17% of the
  // time. That is the entry band of the hardest place in the game, and it is
  // the first thing a new chat would ever see there.
  //
  // So when a band is floor-bound and still short of target, the layout comes
  // down and the curve is re-solved against the smaller one. Trimming from the
  // end keeps the front rank the author drew.
  // `--keep-layouts` stops here. Trimming rewrites formations somebody drew,
  // and a hand-authored layout is content rather than a tuning knob: the body
  // count, the roles and the order are what the fight LOOKS like. With the
  // ratchet above forcing the top bands up, the trim fires on bands that were
  // authored deliberately, so whether it may is a decision for whoever owns
  // the content, not a default.
  for (let pass = 0; pass < 4 && !KEEP_LAYOUTS; pass += 1) {
    let trimmed = false;
    for (const band of PARTY_BANDS) {
      const units = formations[band];
      if (!units || units.length <= 4) continue;
      const reading = measureBand(dungeon as unknown as FightDefinition, band, c);
      if (!reading.enemyCount) continue;
      const win = reading.winRate;
      // The tolerance is sampling noise at SAMPLES trials, not slack — a band
      // inside it is measured as on target by a different seed than solved it.
      if (win >= target - 0.08) continue;
      formations[band] = units.slice(0, Math.max(4, Math.round(units.length * 0.82)));
      if (!layouts.some((l) => l.band === band)) layouts.push({ band, layout: formations[band]! });
      else layouts.find((l) => l.band === band)!.layout = formations[band]!;
      trimmed = true;
    }
    if (!trimmed) break;
    scale = solveDungeonScale(dungeon.id, rung);
    (dungeon as unknown as { bandStatScale?: Record<string, number> }).bandStatScale = scale;
  }

  const measured: DungeonPlan["measured"] = [];
  for (const band of PARTY_BANDS) {
    // measureBand, so this report is the same number the panel's tab shows.
    const reading = measureBand(dungeon as unknown as FightDefinition, band, c);
    const win = reading.winRate;
    const enemies = { length: reading.enemyCount };
    measured.push({ band, win, bodies: reading.enemyCount });
    const generated = layouts.some((l) => l.band === band);
    console.log(
      `  ${band.padEnd(12)} x${(scale[band] ?? 1).toFixed(2).padStart(7)}  ${String(enemies.length).padStart(3)} bodies  ` +
        `${(win * 100).toFixed(0).padStart(3)}%  ${ratingFor(win).padEnd(9)} ${generated ? "generated" : "authored"}`,
    );
  }

  plans.push({ id: dungeon.id, name: dungeon.name, rung, target, layouts, scale, measured });
}

if (!WRITE) {
  const bands = plans.reduce((n, p) => n + p.layouts.length, 0);
  console.log(
    `
${bands} generated band(s) and ${plans.length} per-dungeon stat curve(s) would be written.` +
      `
Re-run with --write to apply.
`,
  );
} else {
  for (const plan of plans) {
    const path = join(CONTENT, "dungeons", `${plan.id}.json`);
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      formations: Record<string, unknown>;
      bandStatScale?: Record<string, number>;
      targetWinRate?: number;
    };
    for (const { band, layout } of plan.layouts) raw.formations[band] = layout;
    // Bands in ladder order, so a diff of this file reads top to bottom.
    const ordered: Record<string, unknown> = {};
    for (const band of PARTY_BANDS) if (raw.formations[band]) ordered[band] = raw.formations[band];
    raw.formations = ordered;
    raw.bandStatScale = plan.scale;
    // Written down, so the admin panel shows the target this curve was solved
    // for instead of re-deriving it from where the dungeon sits in the ladder.
    raw.targetWinRate = plan.target;
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}
`);
    console.log(`wrote ${plan.id}.json  (+${plan.layouts.length} band(s), stat curve solved)`);
  }
  console.log("\nRe-run `npm run simulate:progression` sections 1, 8 and 11 to confirm the ladder.\n");
}
