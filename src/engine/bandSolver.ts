import type { ContentRegistry } from "./content/loader.js";
import type { EnemyDefinition, FightDefinition, PartyBand } from "./types.js";
import { PARTY_BANDS } from "./types.js";
import { BAND_SAMPLE_PARTY, expandFight } from "./squad.js";
import { estimateDifficulty, referencePartyStrength, type PartyComposition } from "./difficulty.js";
import { ratePoints } from "./partyStrength.js";
import {
  DEFAULT_TARGET_WIN,
  SCALE_MAX,
  SCALE_MIN,
  TARGET_TOLERANCE,
  advanceSearch,
  startSearch,
  type SearchState,
} from "./bandSearch.js";

// Re-exported so existing importers keep one place to ask. They are DEFINED in
// bandSearch.ts, which has no imports - see TARGET_TOLERANCE there for why.
export { DEFAULT_TARGET_WIN, SCALE_MAX, SCALE_MIN, TARGET_TOLERANCE };

/**
 * Measuring and solving a level, in one place.
 *
 * WHY THIS IS IN THE ENGINE. It used to live inside scripts/author-bands.ts,
 * which meant the only way to finish balancing a dungeon was a terminal
 * command run after the admin panel had been closed - and the panel's own
 * meter measured against a different seed than the solver aimed with, so a
 * level solved to 70% could read 64% on its tab. Now the script, the game
 * server and the operator Edge Function all call these, and the percentage on
 * the tab and the number the solver aimed at are the same measurement by
 * construction. AGENTS.md section 6: a second opinion about difficulty is the
 * thing to avoid.
 *
 * WHAT IS BEING SOLVED. A fight's `bandStatScale[band]` - one multiplier on
 * every enemy's hp and attack at that level. The author decides WHO is in the
 * fight (bodies, roles, which ones are elites). This decides how hard those
 * people hit, so each level lands on the dungeon's target win rate.
 */

/** Fights per reading. The panel and the solver use the same number. */
export const READING_SAMPLES = 60;

/**
 * The seed every reading uses.
 *
 * FIXED, and that is what makes solving possible at all: the same sixty
 * parties fight every candidate multiplier, so a difference in win rate is the
 * multiplier's doing and not the dice's. It is also why the tab and the solver
 * agree - they are not two samples of the same fight, they are one.
 */
export const READING_SEED = 7;

type GearAssumption = "none" | "typical" | "best";

/**
 * The party a level is measured against.
 *
 * One definition, where there used to be two: author-bands built its party
 * 20% tanks / 20% healers and the admin meter built it one-in-six. They agree
 * at ten players and would have quietly parted the day BAND_SAMPLE_PARTY
 * changed size.
 */
export function bandParty(band: PartyBand): { composition: PartyComposition; level: number; gear: GearAssumption } {
  const sample = BAND_SAMPLE_PARTY[band];
  const tanks = Math.max(1, Math.round(sample.size * 0.2));
  const healers = Math.max(1, Math.round(sample.size * 0.2));
  return {
    composition: { tanks, healers, dps: Math.max(1, sample.size - tanks - healers) },
    level: sample.level,
    gear: sample.gear,
  };
}

export interface BandReading {
  band: PartyBand;
  winRate: number;
  survivorRate: number;
  stalemateRate: number;
  /** Bodies the party actually meets - after the count ramp across the level floor. */
  enemyCount: number;
  /** The squad priced with ratePoints, the same scorer as a party. */
  enemyRating: number;
  /** The multiplier this reading was taken at. */
  scale: number;
}

/**
 * What a squad is worth, priced with ratePoints - the same scorer as a party.
 *
 * A strong body is priced as that many bodies. Its hp is already multiplied by
 * its strength and its turns are too, so scoring its stats directly would
 * count the extra hp and none of the extra turns, and a Boss would read as a
 * slightly sturdier villager. Undo the hp, score one body, count it strength
 * times.
 */
export function squadRating(enemies: EnemyDefinition[], content: ContentRegistry): number {
  return enemies.reduce((sum, e) => {
    const k = e.strength ?? 1;
    return sum + ratePoints(k === 1 ? e.stats : { ...e.stats, hp: e.stats.hp / k }, content.balance) * k;
  }, 0);
}

/** The multiplier a fight uses at a level: its own curve first, then the global one. */
export function scaleAt(fight: FightDefinition, band: PartyBand, content: ContentRegistry): number {
  return fight.bandStatScale?.[band] ?? content.balance.bandStatScale[band] ?? 1;
}

/**
 * How a level plays, measured against the party it is for.
 *
 * `scale` measures a CANDIDATE multiplier without touching the fight, which is
 * what lets the solver try values against a draft nobody has saved. `gear`
 * overrides what the party is wearing, for the panel's what-if readings; the
 * solver never passes it.
 */
export function measureBand(
  fight: FightDefinition,
  band: PartyBand,
  content: ContentRegistry,
  options: { scale?: number; gear?: GearAssumption; samples?: number } = {},
): BandReading {
  const party = bandParty(band);
  const gear = options.gear ?? party.gear;
  const candidate =
    options.scale === undefined
      ? fight
      : { ...fight, bandStatScale: { ...(fight.bandStatScale ?? {}), [band]: options.scale } };
  const strength = referencePartyStrength(party.composition, party.level, content, gear);
  const enemies = expandFight(candidate, "draft", "draft", strength, content.balance.bandStatScale);
  const scale = scaleAt(candidate, band, content);

  if (enemies.length === 0) {
    // Nothing to fight is a win, not an error: the level simply is not built.
    return { band, winRate: 1, survivorRate: 1, stalemateRate: 0, enemyCount: 0, enemyRating: 0, scale };
  }

  const report = estimateDifficulty(enemies, content, {
    composition: party.composition,
    level: party.level,
    gear,
    samples: options.samples ?? READING_SAMPLES,
    seed: READING_SEED,
  });
  return {
    band,
    winRate: report.winRate,
    survivorRate: report.survivorRate,
    stalemateRate: report.stalemateRate,
    enemyCount: enemies.length,
    enemyRating: squadRating(enemies, content),
    scale,
  };
}

/** Begin solving one level, from wherever its multiplier currently sits. */
export function beginSolve(
  fight: FightDefinition,
  band: PartyBand,
  content: ContentRegistry,
  options: { target: number; floor?: number },
): SearchState {
  return startSearch({
    start: scaleAt(fight, band, content),
    target: options.target,
    floor: Math.max(SCALE_MIN, options.floor ?? SCALE_MIN),
    ceiling: SCALE_MAX,
    tolerance: TARGET_TOLERANCE,
  });
}

/**
 * Advance a solve until it finishes or runs out of time.
 *
 * `budgetMs` is for the Edge Function, whose requests are killed at 2s of CPU.
 * The loop stops once it has spent the budget, so the worst case is the budget
 * plus one reading - and one reading is at most ~250ms, measured on the
 * heaviest level in the game. Everything else passes Infinity and finishes.
 *
 * Returns every reading taken, because the caller needs the FULL reading for
 * whichever candidate turns out best, and it may have been taken on an
 * earlier request than the one that finished the search.
 */
export function continueSolve(
  fight: FightDefinition,
  band: PartyBand,
  content: ContentRegistry,
  state: SearchState,
  budgetMs = Infinity,
): { state: SearchState; readings: BandReading[] } {
  const began = Date.now();
  const readings: BandReading[] = [];
  let current = state;
  while (current.pending !== null && Date.now() - began < budgetMs) {
    const reading = measureBand(fight, band, content, { scale: current.pending });
    readings.push(reading);
    current = advanceSearch(current, reading.winRate);
  }
  return { state: current, readings };
}

export interface BandSolution extends BandReading {
  /**
   * Why the solver stopped short of the target, when it did.
   *
   * THE USEFUL PART. A multiplier can only do so much, and when it cannot, the
   * answer is in the squad rather than the number:
   *
   *   "floor"   - too hard even at the lowest multiplier allowed. The squad is
   *               too much, or the level below is set so high that this one
   *               may not go under it. Fewer units, or weaker ones.
   *   "ceiling" - the party walks it even at the highest multiplier. More
   *               units, or stronger ones.
   *
   * Null when the level landed within tolerance.
   */
  bound: "floor" | "ceiling" | null;
  evaluations: number;
}

/** The full reading for a finished search's answer. */
export function solutionOf(state: SearchState, readings: BandReading[]): BandSolution | null {
  if (state.phase !== "done" || !state.best) return null;
  const best = state.best;
  const reading = readings.find((r) => r.scale === best.scale);
  if (!reading) return null;
  return { ...reading, scale: Number(best.scale.toFixed(3)), bound: state.bound, evaluations: state.evaluations };
}

/**
 * The multiplier that puts one level on its target, solved to the end.
 *
 * RATCHETED through `floor`: a level may never solve below the one under it.
 * expandFight interpolates the multiplier from the level below up to this
 * level's across the whole width of the band, so a dip is not a dip - it is a
 * difficulty curve that FALLS for that entire band, a party meeting weaker
 * opposition the stronger it grows (AGENTS.md §10). Landing slightly over
 * target is the better failure, and `bound` says when it happened.
 */
export function solveBand(
  fight: FightDefinition,
  band: PartyBand,
  content: ContentRegistry,
  options: { target: number; floor?: number },
): BandSolution {
  const { state, readings } = continueSolve(fight, band, content, beginSolve(fight, band, content, options));
  const solution = solutionOf(state, readings);
  if (!solution) throw new Error(`solving ${band} did not converge`);
  return solution;
}

/**
 * Every level of a fight, in order, each floored on the one below.
 *
 * In order because they are coupled twice: a level's floor is the answer for
 * the level below, and a level's measurement interpolates FROM the level
 * below. Solving level three before level two would be solving against a
 * number that is about to change. The reverse is not true - nothing reads the
 * level ABOVE - so once a level is solved in order, it stays solved.
 *
 * Levels with no bodies are skipped and do not move the floor.
 */
export function solveFight(
  fight: FightDefinition,
  content: ContentRegistry,
  options: { target: number },
): { scale: Partial<Record<PartyBand, number>>; solutions: BandSolution[] } {
  const scale: Partial<Record<PartyBand, number>> = { ...(fight.bandStatScale ?? {}) };
  const solutions: BandSolution[] = [];
  let floor = SCALE_MIN;
  for (const band of PARTY_BANDS) {
    if (!fight.formations?.[band]?.length) continue;
    const solved = solveBand({ ...fight, bandStatScale: scale }, band, content, { ...options, floor });
    scale[band] = solved.scale;
    solutions.push(solved);
    floor = solved.scale;
  }
  return { scale, solutions };
}

/** The floor a level may not solve below: the level beneath it, if it has one. */
export function floorFor(fight: FightDefinition, band: PartyBand, content: ContentRegistry): number {
  const i = PARTY_BANDS.indexOf(band);
  for (let j = i - 1; j >= 0; j -= 1) {
    const below = PARTY_BANDS[j]!;
    if (fight.formations?.[below]?.length) return scaleAt(fight, below, content);
  }
  return SCALE_MIN;
}
