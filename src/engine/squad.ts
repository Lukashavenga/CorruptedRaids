import type {
  EnemyDefinition,
  EnemyUnit,
  FightDefinition,
  PartyBand,
  Role,
  Stats,
} from "./types.js";
import { PARTY_BANDS } from "./types.js";

/**
 * Which layout a party of this size meets.
 *
 * The thresholds are where the fight visibly changes character rather than
 * round numbers: below six there is rarely a full trinity, past sixteen the
 * party's share of the initiative pool is large enough that a handful of
 * enemies can no longer act often enough to matter (measured: six enemies read
 * Trivial against every party size from 4 to 30).
 */
/**
 * The rating of the weakest party the game expects: ten fresh characters, no
 * gear. Everything else is priced against it.
 *
 * scripts/simulate.ts asserts this still holds, which is what catches the
 * thresholds drifting away from the content.
 */
export const ENTRY_RATING = 45;

/**
 * Where one level ends and the next begins, as a party RATING.
 *
 * MEASURED against real party shapes, never chosen. Each threshold is the
 * geometric midpoint between the two sample parties either side of it, so a
 * band is the range in which its own reference build sits comfortably rather
 * than a round number somebody liked.
 *
 * The current readings (npm run simulate prints them, and asserts them):
 *
 *     weak         L1   no gear      45
 *     seasoned     L10  typical     256
 *     elite        L25  best        715
 *     brutal       L50  best      1,233
 *     infernal     L100 best      2,172
 *     apocalyptic  L200 best      4,046
 *
 * These are an order of magnitude below what they were, and deliberately: the
 * whole stat scale came down when Armour was removed and a level-1 character
 * stopped opening with 70 health. Crucially the same numbers hold at five
 * players and at thirty — rating is an average, so turnout does not move a
 * party between levels; `crowdFactor` handles headcount separately.
 */
export const BAND_THRESHOLDS: Record<PartyBand, number> = {
  weak: 0,
  seasoned: 110,
  elite: 430,
  brutal: 940,
  infernal: 1640,
  apocalyptic: 2960,
};

/**
 * A party that sits in the middle of each band, for measuring against.
 *
 * Given as size + Corruption + gear rather than as a raw score, because the
 * admin has to BUILD one to simulate with and a number alone cannot be built
 * from. These land roughly at 2000 / 4000 / 7000 on the strength scale.
 */
export const BAND_SAMPLE_PARTY: Record<PartyBand, { size: number; level: number; gear: "none" | "typical" | "best" }> = {
  // Ten in all of them, so the tiers differ by how EQUIPPED a party is rather
  // than by turnout — which the crowd factor handles separately. The character
  // levels here are the ones that actually reach each threshold, measured
  // rather than guessed.
  weak: { size: 10, level: 1, gear: "none" },
  seasoned: { size: 10, level: 10, gear: "typical" },
  elite: { size: 10, level: 25, gear: "best" },
  brutal: { size: 10, level: 50, gear: "best" },
  infernal: { size: 10, level: 100, gear: "best" },
  apocalyptic: { size: 10, level: 200, gear: "best" },
};

/**
 * How much a crowd counts toward the level, on top of how equipped they are.
 *
 * A big turnout should meet nastier units, not merely more of the same — thirty
 * mid-geared players steamroll a fight built for five, and "more cops" stops
 * being an answer long before thirty. So headcount folds into the rating
 * logarithmically: doubling the party is worth a fixed step, and the step
 * shrinks in relative terms as the crowd grows. Linear would let turnout swamp
 * gear entirely, which is the very thing averaging was introduced to prevent.
 *
 * Ten is the pivot because it is the party the levels are priced against, so a
 * party of ten is judged on its gear and nothing else.
 */
export const CROWD_PIVOT = 10;
export const CROWD_WEIGHT = 0.55;

/**
 * The floor under the curve.
 *
 * log2 heads for negative infinity below the pivot, and the curve was left
 * unclamped: measured, a party of one scored **-0.83** and a party of three
 * **0.04**, so `effectiveRating` clamped both to zero and any group under about
 * four was rated as though it owned nothing at all. Three fully-kitted regulars
 * met the same layout as three naked newcomers, because a multiplier had gone
 * negative and taken their gear with it.
 *
 * Half is the floor rather than something smaller because it is still a real
 * discount — a short-handed party genuinely should meet an easier room — while
 * keeping the reading proportional to what they are actually wearing.
 */
export const CROWD_FLOOR = 0.5;

export function crowdFactor(partySize: number): number {
  if (partySize <= 0) return 1;
  return Math.max(CROWD_FLOOR, 1 + CROWD_WEIGHT * Math.log2(Math.max(1, partySize) / CROWD_PIVOT));
}

/**
 * What a fight is actually pitched at.
 *
 * HEADCOUNT NO LONGER MOVES A PARTY BETWEEN BANDS, and BAND_THRESHOLDS above
 * has always said so: "rating is an average, so turnout does not move a party
 * between levels; `crowdFactor` handles headcount separately." The code did
 * the opposite — it multiplied the rating by `crowdFactor` and handed the
 * product to `bandFor`, so turnout picked the band.
 *
 * That was survivable while the bands were nearly identical fights. It stopped
 * being survivable the moment they had teeth: with a solved `bandStatScale` a
 * chat of twelve in mid gear was inflated into `elite` — x1.14 on the rating
 * is a whole band near a threshold — and met a fight priced for ten characters
 * at level 25 in the best gear in the game. Measured: 5-20% win at every
 * dungeon on the ladder, for a perfectly ordinary night.
 *
 * Headcount still matters, and still through the channel that was built for
 * it: `partyScalingFor` scales enemy hp and atk by how many turned up, and it
 * is continuous where a band is a step. A bigger crowd meets a tougher version
 * of the fight its GEAR earned, rather than a different fight entirely.
 *
 * `crowdFactor` is kept and still exported — the progression report prints the
 * curve, and it is the right shape for anything that wants to weigh turnout —
 * but it no longer decides which room the party walks into.
 */
export function effectiveRating(rating: number, partySize: number): number {
  void partySize;
  return Math.max(0, Math.round(rating));
}

/**
 * Which layout a party of this effective rating meets.
 *
 * Walks the tiers from the top down rather than testing them by name, so
 * adding a tier is a line in BAND_THRESHOLDS and nothing else — the previous
 * hand-written chain silently ignored every tier past the third.
 */
export function bandFor(strength: number): PartyBand {
  for (let i = PARTY_BANDS.length - 1; i >= 0; i -= 1) {
    const band = PARTY_BANDS[i]!;
    if (strength >= BAND_THRESHOLDS[band]) return band;
  }
  return PARTY_BANDS[0]!;
}

/**
 * The layout authored at `band`, or the nearest one BELOW it.
 *
 * Falls back DOWN the bands rather than up: a half-authored fight with only a
 * "weak" layout should field that against a big party — too easy, and obvious
 * in the admin — rather than field nothing at all and hand them a walkover
 * against an empty room.
 */
function layoutAtOrBelow(fight: FightDefinition, band: PartyBand): EnemyUnit[] {
  const order = PARTY_BANDS.slice(0, PARTY_BANDS.indexOf(band) + 1).reverse();
  for (const b of order) {
    const units = fight.formations?.[b];
    if (units?.length) return units;
  }
  return [];
}

/**
 * How much of a band's width the ramp is spread over.
 *
 * NOT the whole band, and the difference is measurable. Ramping across the
 * full band sounds cleaner and makes the game much too easy: `seasoned` runs
 * from 110 to 430, real parties sit in the low 100s to low 300s, so a
 * band-long ramp left almost everybody fighting something close to the `weak`
 * layout — BARBIEVILLE went to 100% at every headcount from four to forty.
 *
 * A third of the band is enough to turn the step into a slope while still
 * delivering the layout its author drew to anyone properly inside the band.
 */
const BAND_RAMP_SPAN = 0.35;

/** The width of `band` on the rating axis. The top band borrows the one below. */
function bandWidth(band: PartyBand): number {
  const i = PARTY_BANDS.indexOf(band);
  const lo = BAND_THRESHOLDS[band];
  const next = PARTY_BANDS[i + 1];
  const below = PARTY_BANDS[i - 1];
  return next ? BAND_THRESHOLDS[next] - lo : below ? lo - BAND_THRESHOLDS[below] : lo || 1;
}

/**
 * Where `strength` sits across the WHOLE band: 0 at the floor, 1 at the
 * ceiling. Used for the stat curve, which should be continuous everywhere.
 */
function bandSpan(strength: number, band: PartyBand): number {
  const width = bandWidth(band);
  if (width <= 0) return 1;
  return Math.max(0, Math.min(1, (strength - BAND_THRESHOLDS[band]) / width));
}

/**
 * Where `strength` sits along the ramp at the bottom of its band: 0 at the
 * floor, 1 once it is `BAND_RAMP_SPAN` of the way in and from then on.
 *
 * The top band has no ceiling, so it borrows the width of the band below it.
 */
function bandProgress(strength: number, band: PartyBand): number {
  const ramp = bandWidth(band) * BAND_RAMP_SPAN;
  if (ramp <= 0) return 1;
  return Math.max(0, Math.min(1, (strength - BAND_THRESHOLDS[band]) / ramp));
}

/**
 * The bodies a fight fields against a party of this strength.
 *
 * THE COUNT RAMPS ACROSS A THRESHOLD; IT DOES NOT STEP.
 * -----------------------------------------------------
 * This used to return `formations[band]` whole, and that made every band
 * boundary a cliff. Measured at BARBIEVILLE: a party of seven met the `weak`
 * layout — 10 bodies, 126 HP — and a party of EIGHT met `seasoned` whole — 16
 * bodies, 233 HP. One extra joiner added 85% more enemy HP, while the party's
 * own rating was flat or falling (it is an average, and late joiners are the
 * least equipped). Win rate went 73% at seven, 33% at ten, and did not recover
 * until twenty-five. A stream that grew got worse at the game.
 *
 * The obvious suspect was `partyScaling.atkPerExtraMember` and it was the
 * wrong one: the notch survives every slope from 0.24 down to 0.08 and every
 * sub-linear curve tried, because a threshold is not a slope.
 *
 * So the layout's SIZE is interpolated between the band below and the band
 * asked for, by how far into the band the party actually sits. At the floor of
 * `seasoned` a party fields as many bodies as `weak` had; at the ceiling it
 * fields the whole `seasoned` layout. The units themselves still come from the
 * authored layout — only how many of them turn up is interpolated — so what an
 * author draws is what appears, in the order they placed it.
 *
 * A fight whose band is its own fallback (nothing authored above `weak`) has
 * nothing to ramp between and fields its layout whole, exactly as before.
 */
export function squadFor(fight: FightDefinition, strength: number): EnemyUnit[] {
  const wanted = bandFor(strength);
  const units = layoutAtOrBelow(fight, wanted);
  if (!units.length) return [];

  const below = PARTY_BANDS[PARTY_BANDS.indexOf(wanted) - 1];
  // No band below (already at `weak`), or the band below resolves to the same
  // authored layout — either way there is no step here to smooth.
  const prev = below ? layoutAtOrBelow(fight, below) : units;
  if (prev === units || prev.length >= units.length) return units;

  const t = bandProgress(strength, wanted);
  const count = Math.round(prev.length + (units.length - prev.length) * t);
  return units.slice(0, Math.max(1, Math.min(units.length, count)));
}

/**
 * How a role bends a fight's base stat block.
 *
 * A fight carries ONE set of numbers — how tough these people are — and a role
 * is a multiplier on it. That is the whole reason this model is easier to tune
 * than the last one: there is one difficulty dial per fight and the squad
 * composition says everything else. Authoring per-unit stats for every body
 * would put the six-slider problem back, once each — which is why `stats` on a
 * unit is an OVERRIDE for the one body that differs, not the normal way in.
 *
 * The shape mirrors ROLE_BASE_STATS on the player side, so an enemy tank feels
 * like a tank: it soaks and taunts and barely scratches you, while an enemy
 * healer is fragile and exists to undo your damage.
 */
export const ENEMY_ROLE_SCALING: Record<Role, Partial<Record<keyof Stats, number>>> = {
  tank: { hp: 2.2, atk: 0.5, spd: 0.8 },
  dps: { hp: 0.85, atk: 1.35, spd: 1.1 },
  healer: { hp: 0.7, atk: 0.4, spd: 1 },
};

/**
 * Skill floor per role, because a fight's authored skill is usually 0.
 *
 * Skill is what makes a tank's guard and a healer's throughput real, so a squad
 * whose author never touched the skill slider would field tanks that guard
 * nothing and healers that trickle. Applied as a floor rather than a multiplier
 * for exactly that reason — multiplying zero stays zero.
 */
// Scaled to the new stat range: 12 was a chunk of mitigation on the old
// numbers and is most of the cap on these. An enemy tank should be hard to
// chew through, not immune.
const ROLE_SKILL_FLOOR: Record<Role, number> = { tank: 5, dps: 0, healer: 6 };

/** One body's stat block: the fight's numbers, the unit's overrides, its role. */
export function unitStats(base: Stats, role: Role | undefined, overrides?: Partial<Stats>): Stats {
  const out: Stats = { ...base, ...overrides };
  if (!role) return out;
  const scale = ENEMY_ROLE_SCALING[role];
  for (const key of Object.keys(scale) as (keyof Stats)[]) {
    out[key] = out[key] * (scale[key] ?? 1);
  }
  out.skill = Math.max(out.skill, ROLE_SKILL_FLOOR[role]);
  return out;
}

/**
 * A fight, as one resolved body per unit, ready for the resolver.
 *
 * This is where the merge lands. There is no archetype to look up any more:
 * everything a body needs comes from the fight it belongs to (`fight`), from
 * the unit itself (overrides), and from its role. The resolver's input shape
 * has not changed at all — only where the numbers were read from.
 */
/**
 * How much tougher a body is in each band, as a multiplier on hp and atk.
 *
 * THE BAND SYSTEM WAS MISSING THIS DIMENSION AND COULD NOT WORK WITHOUT IT.
 * ------------------------------------------------------------------------
 * A fight carries ONE stat block and only its `formations` vary per band, so
 * until now the only per-band levers were how many bodies, what roles they
 * carried, and how often they acted. None of the three can span the range the
 * bands claim to: `apocalyptic`'s reference party is ten characters at level
 * 200 in the best gear in the game — roughly four hundred allocated points
 * each — and a level-200 party beats FORTY bodies of `hp 17 / atk 3` at eight
 * times normal initiative, one hundred times out of a hundred. Measured, with
 * scripts/author-bands.ts: every generated band above `elite` read Trivial no
 * matter what was done to it.
 *
 * So a band scales what a body IS, not just how many there are. That is also
 * the honest reading of the design: `apocalyptic` was never meant to be the
 * same villagers in greater numbers.
 *
 * SOLVED, NOT CHOSEN. Each value is bisected until that band's own reference
 * party (BAND_SAMPLE_PARTY) lands in "Fair" against the real ladder — run
 * `npx tsx scripts/author-bands.ts` to re-solve after changing the stat scale,
 * the gear catalogue or the progression curve.
 */
export type BandStatScale = Record<PartyBand, number>;

/** No scaling — what a caller with no balance config in reach gets. */
export const NO_BAND_SCALE: BandStatScale = {
  weak: 1,
  seasoned: 1,
  elite: 1,
  brutal: 1,
  infernal: 1,
  apocalyptic: 1,
};

export function expandFight(
  fight: FightDefinition,
  id: string,
  name: string,
  strength: number,
  bandScale: BandStatScale = NO_BAND_SCALE,
): EnemyDefinition[] {
  // The band the party actually landed in — NOT the band whose layout got
  // fielded. Those differ when a fight is half-authored and `squadFor` falls
  // back down, and it is the party's band that says how hard the night is.
  //
  // The FIGHT'S own curve wins over the global one. That is what lets a place
  // labelled L16 stay harder than one labelled L4 at every band, while the
  // band itself still adapts to who turned up — see FightDefinition.
  const band = bandFor(strength);
  const curveAt = (b: PartyBand): number => fight.bandStatScale?.[b] ?? bandScale[b] ?? 1;
  // RAMPED ACROSS THE WHOLE BAND, not stepped at its floor.
  //
  // A band is WIDE — `seasoned` runs from 110 to 430 — and the curve between
  // adjacent bands is steep, because the parties they are priced against are
  // (BARBIEVILLE solves to x0.76 / x2.18 / x11.93 for weak / seasoned /
  // elite). Stepping meant a party at 136, barely over the seasoned floor,
  // met a fight solved for one at 256: measured, a chat of twelve went to
  // 5-20% win at every dungeon the moment the curve had real teeth.
  //
  // So the multiplier interpolates by where the party actually sits in its
  // band. The full width here rather than squadFor's BAND_RAMP_SPAN — the
  // count ramp only has to kill a cliff at the threshold, whereas this is the
  // difficulty curve itself and should be continuous everywhere.
  const below = PARTY_BANDS[PARTY_BANDS.indexOf(band) - 1];
  const t = bandSpan(strength, band);
  const scale = below ? curveAt(below) + (curveAt(band) - curveAt(below)) * t : curveAt(band);
  // The level multiplier scales hp and attack for every body. A unit's own
  // strength scales hp and TURNS - its attack per hit is left alone, because
  // multiplying that was measured to waste itself on overkill (see
  // EnemyUnit.strength). The turns are applied to initiativeWeight below.
  const scaled = (s: Stats, strength = 1): Stats =>
    scale === 1 && strength === 1 ? s : { ...s, hp: s.hp * scale * strength, atk: s.atk * scale };
  return squadFor(fight, strength).map((unit) => ({
    // The fight's id, not the unit's, so loot, XP and combatant numbering
    // behave exactly as they did when a fight was one repeated stat block.
    id,
    name: unit.name ?? name,
    kind: unit.kind ?? fight.kind,
    levelTier: 1,
    stats: scaled(unitStats(fight.stats, unit.role, unit.stats), unit.strength),
    abilities: unit.abilities,
    loot: unit.loot ?? fight.loot,
    goldReward: unit.goldReward ?? fight.goldReward,
    xpReward: unit.xpReward ?? fight.xpReward,
    role: unit.role,
    enemySprite: unit.sprite,
    unitId: unit.id,
    initiativeWeight: (unit.weight ?? 1) * (unit.strength ?? 1),
    ...(unit.strength !== undefined && unit.strength !== 1 ? { strength: unit.strength } : {}),
  }));
}
