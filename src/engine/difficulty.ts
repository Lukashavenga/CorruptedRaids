import type { ContentRegistry } from "./content/loader.js";
import type { BalanceConfig } from "./balance.js";
import type { Character, EnemyDefinition, Role, Stats } from "./types.js";
import { GEAR_SLOTS } from "./types.js";
import { createCharacter, equipGear, gearUsableBy, grantGear, grantXp } from "./character.js";
import { runCombat } from "./combat/resolver.js";
import { powerScore } from "./statGuide.js";
import { xpToNextLevel } from "./stats.js";
import { mulberry32, randomInt, type Rng } from "./rng.js";
import { partyRating } from "./partyStrength.js";
import { effectiveRating } from "./squad.js";

/**
 * How hard is this fight?
 *
 * MEASURED, NOT DERIVED. The obvious approach is a formula — total enemy HP
 * over party DPS, or some ratio of stat blocks — and it would be wrong here,
 * because the things that decide a fight in this engine are not in the stat
 * blocks: aggro-weighted targeting, a tank's guard, whether a healer's
 * throughput outpaces incoming damage, and the fact that initiative is drawn
 * from every combatant at once so headcount changes the shape of the fight.
 * No closed form captures that.
 *
 * So difficulty is the WIN RATE over a few hundred simulated fights against a
 * reference party. It is slower than arithmetic and it is the only number that
 * tells the truth. On this engine a fight resolves synchronously in well under
 * a millisecond, so a few hundred of them is still instant.
 *
 * The rating is deliberately reported with the win rate beside it: "Hard" is a
 * label for a number, and the number is what you tune against.
 */

export interface PartyComposition {
  tanks: number;
  dps: number;
  healers: number;
}

export interface DifficultyOptions {
  composition: PartyComposition;
  /** Corruption level the reference party is built at. */
  level: number;
  /**
   * What the party is assumed to be wearing. Defaults to "typical".
   *
   * It used to be "none", silently — the readings were taken against a naked
   * party, which on Marketgate is the difference between 0% and 57% win.
   */
  gear?: GearAssumption;
  /** How many fights to simulate. More is steadier; 200 is well under a second. */
  samples?: number;
  scaleToPartySize?: boolean;
  enemyMultipliers?: { hp: number; atk: number };
  partyBuffs?: Partial<Stats>;
  /** Seed, so the same inputs always give the same reading. */
  seed?: number;
}

export interface DifficultyReport {
  winRate: number;
  /** Mean fraction of the party still standing at the end, across all samples. */
  survivorRate: number;
  /** Mean fight length in ticks — a proxy for whether a fight reads well on stream. */
  avgTicks: number;
  partySize: number;
  rating: DifficultyRating;
  /** Fights that hit the tick ceiling — a stalemate, which is its own bug. */
  stalemateRate: number;
}

export type DifficultyRating =
  | "Trivial"
  | "Easy"
  | "Fair"
  | "Hard"
  | "Brutal"
  | "Punishing";

/**
 * Win-rate bands.
 *
 * "Fair" sits at 55-80% rather than at 50%: this is a stream where an audience
 * joined to win, and a coin flip every run reads as unfair rather than tense.
 * A boss that a full raid clears three times in four is the target feel.
 */
const BANDS: { min: number; rating: DifficultyRating }[] = [
  { min: 0.95, rating: "Trivial" },
  { min: 0.8, rating: "Easy" },
  { min: 0.55, rating: "Fair" },
  { min: 0.3, rating: "Hard" },
  { min: 0.1, rating: "Brutal" },
  { min: 0, rating: "Punishing" },
];

export function ratingFor(winRate: number): DifficultyRating {
  return BANDS.find((b) => winRate >= b.min)!.rating;
}

/**
 * A throwaway party at a given level and composition.
 *
 * Built fresh per reading and never registered in a roster: this must not be
 * able to touch real characters, because it awards XP and gear as it fights.
 * Points are spent evenly across the role's own stats rather than left
 * unallocated, since a real player at level 10 has spent theirs and an
 * estimate against an unspent party would read every fight as harder than it
 * is.
 */
/**
 * How well equipped the party is assumed to be.
 *
 * It has to be a choice, because it is not a detail: measured on Marketgate, a
 * party of six at Corruption 4 wins 0% of fights with no gear and 57% in a
 * mixed bag of what actually drops. A single number could only ever be right
 * for one of those, so the meter names which one it is answering for.
 */
export type GearAssumption = "none" | "typical" | "best";

/** Equips `character` under a gear assumption, using only what it may wear. */
function dress(character: Character, content: ContentRegistry, gear: GearAssumption, rng: Rng): void {
  if (gear === "none") return;
  for (const slot of GEAR_SLOTS) {
    const usable = content.listGear().filter((g) => g.slot === slot && gearUsableBy(g, character).ok);
    if (usable.length === 0) continue;
    let pick;
    if (gear === "best") {
      pick = usable.reduce((a, b) =>
        powerScore(b.statMods, content.balance) > powerScore(a.statMods, content.balance) ? b : a,
      );
    } else {
      // A third of slots left empty, the rest filled at random — what a party
      // that has been playing a while actually looks like, rather than a
      // best-in-slot fantasy nobody has on the night.
      if (rng() < 0.35) continue;
      pick = usable[randomInt(0, usable.length - 1, rng)];
    }
    if (!pick) continue;
    const instance = grantGear(character, pick.id);
    equipGear(character, instance.instanceId, content);
  }
}

function referenceParty(
  comp: PartyComposition,
  level: number,
  balance: BalanceConfig,
  content: ContentRegistry,
  gear: GearAssumption,
  rng: Rng,
): Character[] {
  const roles: Role[] = [
    ...Array<Role>(Math.max(0, comp.tanks)).fill("tank"),
    ...Array<Role>(Math.max(0, comp.dps)).fill("dps"),
    ...Array<Role>(Math.max(0, comp.healers)).fill("healer"),
  ];

  return roles.map((role, i) => {
    const character = createCharacter({ id: `ref:${i}`, name: `Ref${i}`, role });
    // grantXp walks the level curve, so the reference party levels exactly the
    // way a real one does rather than by a separate formula that could drift.
    for (let lvl = 1; lvl < level; lvl += 1) {
      grantXp(character, xpForLevel(lvl, balance), balance);
    }
    spendPoints(character, role, balance);
    dress(character, content, gear, rng);
    return character;
  });
}

/** Exactly enough XP to clear one level, from the real curve. */
function xpForLevel(level: number, _balance: BalanceConfig): number {
  // Must be EXACT, not an over-estimate. grantXp carries the remainder into the
  // next level, so a formula that overshoots compounds: the old 50*level^2
  // asked for a level-16 party and produced a level-32 one, and a level-10
  // party came out at 17. Every difficulty reading was taken against a party
  // far stronger than the one it named.
  return xpToNextLevel(level);
}

/** Spend banked points on the stat the role actually wants. */
/**
 * Spends every banked point on the stats the role actually scales with.
 *
 * Exported because the sim's fake viewers need the same treatment — a party
 * dressed for a screenshot but sitting on ten unspent points would fight like
 * nothing in the balance model, and two copies of this priority table would
 * drift the moment the roles are retuned.
 */
export function spendPoints(character: Character, role: Role, balance: BalanceConfig): void {
  // Two stats per role, alternating — the pairs from ALLOCATABLE_STATS. Tank
  // wants to be hit and survive it, Healer to heal big and often, DPS to hit
  // hard and go first.
  const priority: Record<Role, ("hp" | "skill" | "atk" | "spd")[]> = {
    tank: ["hp", "skill"],
    dps: ["atk", "spd"],
    healer: ["skill", "spd"],
  };
  const order = priority[role];
  let i = 0;
  while (character.unspentPoints > 0) {
    const stat = order[i % order.length]!;
    character.allocated[stat] += 1;
    character.unspentPoints -= 1;
    i += 1;
  }
}

/**
 * The strength of the party a reading would be taken against.
 *
 * Exported because an encounter's squad now depends on party STRENGTH (see
 * src/engine/squad.ts), so anything that wants to expand a squad for a
 * hypothetical party has to be able to score that party first — and it must
 * score the same party `estimateDifficulty` will build, or the fight measured
 * is not the fight expanded.
 */
export function referencePartyStrength(
  composition: PartyComposition,
  level: number,
  content: ContentRegistry,
  gear: GearAssumption = "typical",
  seed = 1,
): number {
  const party = referenceParty(composition, level, content.balance, content, gear, mulberry32(seed));
  // Effective, not raw: this is the number an encounter is expanded against,
  // and the fight the admin measures must be the fight the game runs.
  return effectiveRating(partyRating(party, content), party.length);
}

export function estimateDifficulty(
  enemies: EnemyDefinition[],
  content: ContentRegistry,
  options: DifficultyOptions,
): DifficultyReport {
  const balance = content.balance;
  const samples = options.samples ?? 200;
  const partySize = Math.max(1, options.composition.tanks + options.composition.dps + options.composition.healers);

  let wins = 0;
  let survivorFraction = 0;
  let ticks = 0;
  let stalemates = 0;

  for (let i = 0; i < samples; i += 1) {
    // Fresh party per sample: runCombat writes XP, gold and loot onto the
    // characters it is handed, so reusing one would make later samples
    // measure a stronger party than the first.
    const rng = mulberry32((options.seed ?? 1) + i);
    const party = referenceParty(options.composition, options.level, balance, content, options.gear ?? "typical", rng);

    const result = runCombat(party, enemies, content, balance, rng, {
      scaleToPartySize: options.scaleToPartySize,
      enemyMultipliers: options.enemyMultipliers,
      partyBuffs: options.partyBuffs,
    });

    if (result.outcome === "victory") wins += 1;
    survivorFraction += result.survivorIds.length / party.length;

    const lastTick = [...result.events].reverse().find((e) => e.type === "tick");
    const n = lastTick && lastTick.type === "tick" ? lastTick.n : 0;
    ticks += n;
    if (n >= balance.combat.maxTicks) stalemates += 1;
  }

  const winRate = wins / samples;
  return {
    winRate,
    survivorRate: survivorFraction / samples,
    avgTicks: ticks / samples,
    partySize,
    rating: ratingFor(winRate),
    stalemateRate: stalemates / samples,
  };
}
