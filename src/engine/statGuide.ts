import type { BalanceConfig } from "./balance.js";
import type { Role, StatKey, Stats } from "./types.js";
import { mitigationFraction } from "./combat/formulas.js";
import { ratePoints } from "./partyStrength.js";

/**
 * What a stat actually DOES, computed from the live balance config.
 *
 * Written as code rather than as documentation on purpose. Every sentence this
 * produces is derived from the same constants the resolver uses, so it cannot
 * drift the way a paragraph in a README does the moment somebody changes
 * armourCurveK. If the curve is retuned, these explanations retune with it.
 *
 * The distinction that matters most for authoring gear: some stats are LINEAR
 * and some have DIMINISHING returns, and mixing them up is how an item ends up
 * three times stronger than intended.
 */

export interface StatExplanation {
  /** One line on what the stat does at all. */
  what: string;
  /** What THIS much of it is worth, in context. */
  marginal: string;
  /** Which roles actually care. */
  matters: string;
  /** Linear stats scale predictably; diminishing ones do not. */
  scaling: "linear" | "diminishing" | "share";
}

/** A representative defender, so armour can be explained at a real value. */
export interface StatContext {
  /** Armour the wearer already has, for the diminishing-returns explanation. */
  baseSkill: number;
  /** Speed the wearer already has, for the initiative-share explanation. */
  baseSpd: number;
  /** Typical incoming hit, for turning HP into "hits survived". */
  typicalHit: number;
}

// Re-scaled with the stat model: a mid-build character now holds single-figure
// Skill and Speed and a hit is a handful of points, not fourteen.
export const DEFAULT_CONTEXT: StatContext = { baseSkill: 4, baseSpd: 3, typicalHit: 4 };

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function explainStat(
  stat: StatKey,
  amount: number,
  balance: BalanceConfig,
  context: StatContext = DEFAULT_CONTEXT,
): StatExplanation {
  switch (stat) {
    case "hp":
      return {
        what: "Raw survivability. Nothing else changes.",
        marginal: `+${amount} HP is about ${(amount / Math.max(1, context.typicalHit)).toFixed(1)} extra hits survived at ${context.typicalHit} damage a hit.`,
        matters: "Everyone, but it is what keeps a tank standing long enough for its guard to matter.",
        scaling: "linear",
      };

    case "atk":
      return {
        what: "Damage per action, before the target's Skill reduces it.",
        marginal: `+${amount} attack is +${amount} damage every time this character acts — the most directly powerful stat in the game.`,
        matters: "DPS above all. On a tank it is close to wasted; tanks are meant to be low damage.",
        scaling: "linear",
      };

    case "spd": {
      return {
        what: "How often you are picked to act. Turns are drawn from every combatant at once, weighted by Speed.",
        marginal:
          `+${amount} speed is +${Math.round((amount / context.baseSpd) * 100)}% more actions than a character at ${context.baseSpd}. ` +
          `It multiplies everything else you have, which is why it is the second stat both DPS and Healers want.`,
        matters: "DPS and Healers. A tank wants to be hit, not to act more often.",
        scaling: "linear",
      };
    }

    case "skill": {
      const tank = balance.roles.tank;
      const healer = balance.roles.healer;
      const self = Math.min(tank.maxSelfMitigation, amount * tank.mitigationPerSkill);
      const guard = Math.min(tank.maxGuard, amount * tank.guardPerSkill);
      const heal = amount * balance.healing.perSkillPoint;
      const hasteRaw = amount * healer.spdPerSkill;
      return {
        what: "Role-dependent. It does something different for each role, and nothing at all for one of them.",
        marginal:
          `TANK: +${pct(self)} damage reduction on itself and +${pct(guard)} for every other party member. ` +
          `HEALER: +${heal.toFixed(0)} per heal and +${Math.min(healer.maxSpdBonus, hasteRaw).toFixed(1)} speed, so more heals AND bigger ones. ` +
          `DPS: nothing.`,
        matters:
          "Tanks and healers only. Skill on a DPS item is a dead stat — worth knowing before pricing one by its numbers.",
        scaling: "linear",
      };
    }

    case "crit": {
      const extra = amount * (balance.combat.critMultiplier - 1);
      return {
        what: `Chance to deal ${balance.combat.critMultiplier}x damage.`,
        marginal: `+${pct(amount)} crit is about +${pct(extra)} average damage — a crit adds ${pct(balance.combat.critMultiplier - 1)} on top, and it only lands ${pct(amount)} of the time.`,
        matters: "DPS. It multiplies attack, so it is worth more on a character that already hits hard.",
        scaling: "linear",
      };
    }
  }
}

/**
 * How strong an item's bonuses are, in WIN-RATE POINTS.
 *
 * The unit is meaningful: roughly how many percentage points of win rate this
 * item adds if every member of a six-person party wore one. That makes the
 * number comparable across stats that are otherwise nothing alike.
 *
 * The weights are MEASURED, not guessed. Each stat was buffed across a whole
 * party against Marketgate over 300 simulated fights and the win-rate delta
 * recorded:
 *
 *     +16 hp     -> +22 points   (1.4 per hp)
 *     +8  atk    -> +28 points   (3.5 per atk)
 *     +8  armour -> +18 points   (1.95 per point of mitigation gained)
 *     +10 skill  -> +24 points   (2.4 per skill)
 *
 * The previous weights were invented and badly wrong — they priced attack at
 * eight times HP when HP is actually the more efficient stat per point.
 *
 * Still a GUIDE, and it says so where it is shown: real value depends on who
 * wears it. Skill is worth nothing on a DPS, and armour is worth less the more
 * the wearer already has. This catches a wildly mispriced item; it is not a
 * valuation.
 */
export function powerScore(mods: Partial<Record<StatKey, number>>, balance: BalanceConfig): number {
  // The rating this item ADDS to a reference wearer — the same rating that
  // decides which encounter level a party meets. Before, gear was scored by its
  // own private weights, so "power 40" on this screen and the party score it
  // moved were unrelated numbers; an author had no way to tell whether an item
  // was worth a tier. Now it is the same unit, and a legendary that adds 300 is
  // a legendary that pushes a party a third of the way to the next level.
  // Scaled with the stat model — a mid-build character, not the 120hp/12atk
  // one this measured against when a level-1 opened with 70 health.
  const ref: Stats = {
    hp: 26,
    atk: 5,
    spd: DEFAULT_CONTEXT.baseSpd,
    skill: DEFAULT_CONTEXT.baseSkill,
    crit: 0.05,
  };
  const worn: Stats = {
    ...ref,
    hp: ref.hp + (mods.hp ?? 0),
    atk: ref.atk + (mods.atk ?? 0),
    skill: ref.skill + (mods.skill ?? 0),
    spd: ref.spd + (mods.spd ?? 0),
  };
  return Math.round(ratePoints(worn, balance) - ratePoints(ref, balance));
}

/**
 * Where a rarity's items are EXPECTED to land, in win-rate points.
 *
 * These describe intent, not the current catalogue. Fitting them to what the
 * generated items happen to score would make the check unfalsifiable — every
 * item would sit in its own band by construction, and nothing could ever be
 * flagged as mispriced.
 *
 * The bands overlap on purpose: a strong common and a weak uncommon should be
 * allowed to meet, or every item ends up clustered at its tier's midpoint and
 * loot stops being interesting.
 */
export const RARITY_POWER_BAND: Record<string, [number, number]> = {
  // Re-scaled when gear power became the RATING an item adds rather than its
  // own private score. For sense of scale: a mid-geared party member rates
  // about 490 all in, so a legendary at ~340 is worth two-thirds of an entire
  // average character — which is what a legendary ought to feel like.
  common: [0, 60],
  uncommon: [40, 120],
  rare: [90, 200],
  epic: [160, 300],
  legendary: [260, 450],
};

export function roleFor(stat: StatKey): Role | null {
  if (stat === "atk" || stat === "crit") return "dps";
  if (stat === "hp") return "tank";
  // Skill and Speed are each wanted by two roles, so neither names one.
  return null;
}
