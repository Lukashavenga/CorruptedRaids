import type { Stats } from "../types.js";
import type { BalanceConfig } from "../balance.js";
import type { Rng } from "../rng.js";

export interface AttackResult {
  damage: number;
  /** How much the target shrugged off. `damage + mitigated` is the unreduced hit. */
  mitigated: number;
  crit: boolean;
}

/**
 * Fraction of incoming damage a defender's SKILL shrugs off, on a
 * diminishing-returns curve: `skill / (skill + K)`, capped at `maxMitigation`.
 *
 * This used to read `armour`, and armour no longer exists — two stats both
 * meaning "take less damage" was one too many, and the one that was merely a
 * number beat the one that did the interesting things. Skill carries the curve
 * for every role now; Tanks stack their own reductions on top (see
 * roleMitigation in the resolver).
 *
 * The curve, not flat subtraction, and for a reason that has bitten before:
 * flat negation is degenerate. The moment a defender's number meets an
 * attacker's damage, every hit floors at `minDamage` — so mitigation is either
 * irrelevant or absolute with nothing in between, and a build two points too
 * far becomes unkillable. The curve is meaningful at every value, never
 * reaches 100%, and gives balance exactly one knob (K) to turn.
 *
 * K is scaled to the stat it reads. Skill runs from 0 at a level-1 DPS to the
 * low tens on a built Tank, so K is in single figures — the 50 it was when
 * this read armour would have made every point of Skill worth about 2%.
 */
export function mitigationFraction(skill: number, balance: BalanceConfig): number {
  const { skillCurveK, maxMitigation } = balance.combat;
  if (skill <= 0) return 0;
  return Math.min(maxMitigation, skill / (skill + skillCurveK));
}

/**
 * Resolves one attack. Every attack HITS — there is no to-hit roll.
 *
 * Rationale (decided with Lukas over d20-vs-AC): on a stream overlay the
 * combat log *is* the spectacle, and a miss is a dead line. At five party
 * members against several enemies, a ~35% miss rate means a third of the
 * log says nothing happened. Always-hit keeps every tick a visible number,
 * costs one balance knob instead of two, and makes fight length predictable
 * enough to size the overlay's replay window against.
 *
 * `damageVariance` is what keeps that from reading like a spreadsheet —
 * without it, always-hit combat prints the identical number every exchange.
 */
export function rollAttack(attacker: Stats, defender: Stats, balance: BalanceConfig, rng: Rng): AttackResult {
  const { damageVariance, critMultiplier, minDamage } = balance.combat;

  const spread = 1 + (rng() * 2 - 1) * damageVariance;
  const raw = attacker.atk * spread;

  const crit = rng() < attacker.crit;
  const beforeMitigation = crit ? raw * critMultiplier : raw;

  const mitigationPct = mitigationFraction(defender.skill, balance);
  const afterMitigation = beforeMitigation * (1 - mitigationPct);

  const damage = Math.max(minDamage, Math.round(afterMitigation));
  const mitigated = Math.max(0, Math.round(beforeMitigation) - damage);

  return { damage, mitigated, crit };
}

/** How much a healer restores per heal action. Scales off `skill` (§2.2 — Skill is the Healer's healing factor). */
export function rollHeal(healer: Stats, balance: BalanceConfig, rng: Rng): number {
  const { base, perSkillPoint } = balance.healing;
  const spread = 1 + (rng() * 2 - 1) * balance.combat.damageVariance;
  return Math.max(1, Math.round((base + healer.skill * perSkillPoint) * spread));
}
