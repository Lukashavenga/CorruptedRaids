import type { AllocatableStat, Role, Stats } from "./types.js";

export function zeroStats(): Stats {
  return { hp: 0, atk: 0, spd: 0, skill: 0, crit: 0 };
}

export function addStats(a: Stats, b: Partial<Stats>): Stats {
  return {
    hp: a.hp + (b.hp ?? 0),
    atk: a.atk + (b.atk ?? 0),
    spd: a.spd + (b.spd ?? 0),
    skill: a.skill + (b.skill ?? 0),
    crit: a.crit + (b.crit ?? 0),
  };
}

export function clampCrit(stats: Stats): Stats {
  return { ...stats, crit: Math.max(0, Math.min(0.95, stats.crit)) };
}

/**
 * The floor under a finished stat block.
 *
 * Gear is allowed to take a stat DOWN — a greatsword that costs you armour, a
 * glass-cannon mask that trades health for damage — because a trade-off is the
 * only thing that makes a choice out of "wear the higher number". Nothing
 * clamped the result, though, so a character in enough negative gear could
 * arrive at the resolver with -4 health and the fight would start with them
 * already dead, or with negative armour, which the mitigation curve reads as
 * *taking extra* damage in a way no item said it would.
 *
 * So the arithmetic stays honest — a -6 Health mask really does subtract six —
 * and only the RESULT is floored. Health and speed floor at 1 because a
 * combatant with neither cannot take a turn; the rest floor at zero.
 */
export function clampStats(stats: Stats): Stats {
  return {
    hp: Math.max(1, stats.hp),
    atk: Math.max(0, stats.atk),
    spd: Math.max(1, stats.spd),
    skill: Math.max(0, stats.skill),
    crit: Math.max(0, Math.min(0.95, stats.crit)),
  };
}

/**
 * The stat each role's population bonus/debuff scales (see balance.ts
 * roleRarity). Tank's survivability, DPS's damage, Healer's heal power.
 */
export const ROLE_PRIMARY_STAT: Record<Role, keyof Stats> = {
  // Tank is HP now that armour is gone: Skill would collide with the healer's,
  // and a scarcity bonus that lifts the same stat for two roles cannot say
  // which of them was scarce.
  tank: "hp",
  dps: "atk",
  healer: "skill",
};

/**
 * Starting stat spread per role, and it is deliberately TINY.
 *
 * A level-1 character used to open with 70 health and 28 armour, which reads
 * as a finished character rather than a starting one — there is nowhere to go
 * from 70 that feels like anything, and the first ten levels move a bar that
 * was already long. Single digits and low teens give the same fight a shape a
 * player can feel: +2 health is a real decision at 9 health and noise at 45.
 *
 * Every other number in the game is scaled to match these — enemy stat blocks,
 * gear mods, the mitigation curve's K, healing. If you change this table,
 * change those, and then MEASURE with `npm run simulate:progression`.
 */
export const ROLE_BASE_STATS: Record<Role, Stats> = {
  tank: { hp: 14, atk: 1, spd: 2, skill: 3, crit: 0.03 },
  dps: { hp: 9, atk: 3, spd: 4, skill: 0, crit: 0.12 },
  healer: { hp: 10, atk: 1, spd: 3, skill: 4, crit: 0.05 },
};

/**
 * Turns a player's spent points into a stat block.
 *
 * This replaces the old automatic per-level stat growth, per AGENTS.md §2.2:
 * levelling grants points, and the player decides where they go on the
 * loadout screen. Nothing grows on its own any more — a character who never
 * opens the loadout screen keeps their role's base spread and banks the
 * points.
 */
export function statsFromAllocation(
  allocated: Record<AllocatableStat, number>,
  perPoint: Record<AllocatableStat, number>,
): Partial<Stats> {
  return {
    hp: allocated.hp * perPoint.hp,
    atk: allocated.atk * perPoint.atk,
    skill: allocated.skill * perPoint.skill,
    spd: allocated.spd * perPoint.spd,
  };
}

/** A fresh, all-zero allocation. */
export function emptyAllocation(): Record<AllocatableStat, number> {
  return { hp: 0, atk: 0, skill: 0, spd: 0 };
}

/** XP required to go from `level` to `level + 1`. */
export function xpToNextLevel(level: number): number {
  // LINEAR, not a power curve, and tuned to a real playing cadence: five to
  // twenty dungeons a day, five days a week, with level 300 as roughly a
  // roughly a year-long goal. This puts 300 at about 2,900 runs of a mid-tier
  // dungeon — around eleven months for someone doing a dozen a day, faster for
  // the obsessive, slower for the casual, which is the spread you want.
  //
  // The old 50*level^1.3 needed roughly 864,000 cumulative XP for level 100
  // alone. A level here is a small, frequent reward rather than a milestone,
  // so the cost rises gently and never runs away.
  return Math.round(40 + 10 * level);
}
