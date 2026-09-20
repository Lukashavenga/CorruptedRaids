import type { Character, Role, Stats } from "./types.js";
import type { BalanceConfig } from "./balance.js";
import { mitigationFraction } from "./combat/formulas.js";
import { DEFAULT_CONTEXT } from "./statGuide.js";
import { ROLES } from "./types.js";
import { deriveCharacterStats } from "./character.js";
import type { ContentRegistry } from "./content/loader.js";

/**
 * How dangerous a party is, as one number.
 *
 * WHY THIS EXISTS
 * ---------------
 * Encounters used to scale on HEADCOUNT, and headcount is a poor proxy for
 * threat: four viewers in full plate at Corruption 20 are worth more than
 * fifteen fresh characters in their underwear, and scaling on the number of
 * bodies sends the wrong fight to both. Scaling on strength lets an encounter
 * answer the question it should — "how tough is this lot?" — so a weak group
 * meets a few beat cops and a strong one meets the bikes and the negotiators.
 *
 * It folds in the three things that actually make a party dangerous:
 *
 *  1. GEAR, via deriveCharacterStats, which already sums every equipped item.
 *  2. ATTRIBUTES, since the same call includes levelling and spent points.
 *  3. COMPOSITION, as a multiplier — because the parts are not additive. The
 *     resolver gives a tank's guard to the whole party and a healer's output to
 *     whoever is lowest, so the same twelve people are worth substantially more
 *     arranged as 2/4/6 than as twelve damage dealers. Measured on Marketgate:
 *     a balanced six wins 31% where six damage dealers win 4%.
 */

/**
 * A stat block priced as one number: "rating".
 *
 * ONE scorer for both jobs, because they are the same question asked twice.
 * "How strong is this party?" and "how strong is this sword?" were answered by
 * two different formulas with two different sets of weights, so an item's power
 * score and the rating it actually moved were unrelated numbers that happened
 * to share a word. An item's power is now literally the rating it adds to
 * whoever wears it (see gearPower in statGuide.ts), which is what makes the
 * gear screen and the encounter screen denominated in the same thing.
 *
 * Armour is priced by the MITIGATION it buys rather than by its face value, so
 * survivability is `hp / (1 - mitigation)` — real effective health, with the
 * diminishing curve falling out of the arithmetic instead of being approximated
 * by a linear weight. Speed multiplies offence because it is initiative share:
 * acting twice as often is worth about as much as hitting twice as hard.
 *
 * The three coefficients are calibrated, not derived — scripts/simulate.ts
 * asserts that this orders parties the same way measured win rates do.
 */
export function ratePoints(stats: Stats, balance: BalanceConfig): number {
  const mitigation = Math.min(0.8, mitigationFraction(stats.skill, balance));
  const effectiveHp = stats.hp / (1 - mitigation);
  /*
   * Speed SATURATES. It used to be a straight ratio against baseline speed,
   * which was survivable while speed was an engine stat nobody could raise —
   * and became nonsense the moment players could spend points on it: a level
   * 200 DPS with two hundred points in Speed scored sixty-eight times a
   * baseline character's offence, and the band thresholds exploded with it.
   *
   * Combat does not work that way. Initiative draws one actor from the WHOLE
   * pool weighted by speed, so a unit's share is `spd / (spd + everyone else)`
   * — doubling your speed only doubles your actions if the rest of the field
   * stands still. `2s/(s+base)` is that share, normalised so a character at
   * baseline still scores its attack at face value, and it tends to 2 rather
   * than to infinity: being fast is worth at most twice as many turns.
   */
  const speedFactor = (2 * stats.spd) / (stats.spd + DEFAULT_CONTEXT.baseSpd);
  const offence = stats.atk * (1 + stats.crit) * speedFactor;
  return Math.round(effectiveHp * 0.5 + offence * 12 + stats.skill * 5);
}

/** One character's contribution, gear and levelling included. */
export function memberPower(character: Character, content: ContentRegistry): number {
  return ratePoints(deriveCharacterStats(character, content), content.balance);
}

/**
 * The share of a party each role should hold for the trinity to work.
 *
 * One tank and one healer per six is what the encounter tuning assumes and what
 * a stream tends to produce on its own.
 */
const IDEAL_SHARE: Record<Role, number> = { tank: 1 / 6, healer: 1 / 6, dps: 4 / 6 };

/**
 * How much each role's coverage counts toward the composition score.
 *
 * NOT proportional to how many of them a party wants. A tank and a healer are
 * weighted far above their headcount because their contributions are
 * PARTY-WIDE: the best tank's guard reduces damage to everybody, and a healer's
 * output goes wherever it is needed. A missing damage dealer is only less
 * damage, which the score already counts through that person's absent stats —
 * counting it twice here would penalise the same thing at both ends.
 */
const ROLE_IMPORTANCE: Record<Role, number> = { tank: 0.4, healer: 0.4, dps: 0.2 };

/**
 * The worst a composition can be scored at, so an all-dps party is weak rather
 * than worthless.
 *
 * 0.45 rather than something gentler because the penalty has to be big enough
 * to overturn headcount. At 0.65, fourteen damage dealers scored ABOVE a
 * balanced six two Corruption levels higher while winning 38% against their
 * 100% — the score said the crowd was stronger and the fights said otherwise.
 * Missing a tank and a healer is not a small disadvantage; it removes the guard
 * that protects everyone and the healing that undoes the damage.
 */
const COMPOSITION_FLOOR = 0.45;

/**
 * How much a party's role mix is worth, from COMPOSITION_FLOOR to 1.
 *
 * Each role's coverage is capped at its ideal share, so a SECOND healer past
 * what the party needs adds nothing here — which is correct, and is why a
 * fourteen-person party of 2 tanks, 4 healers and 8 dps does not score above a
 * cleanly balanced one. The bonus is for having the roles, not for hoarding
 * them; surplus healers still count through their own stats.
 */
export function compositionFactor(roles: readonly Role[]): number {
  if (roles.length === 0) return COMPOSITION_FLOOR;
  const covered = ROLES.reduce((sum, role) => {
    const share = roles.filter((r) => r === role).length / roles.length;
    return sum + Math.min(1, share / IDEAL_SHARE[role]) * ROLE_IMPORTANCE[role];
  }, 0);
  return COMPOSITION_FLOOR + (1 - COMPOSITION_FLOOR) * covered;
}

/**
 * The party's RATING: the average member, adjusted for how well the roles fit.
 *
 * Average and not total, and the whole difficulty model rests on it. A total is
 * dominated by headcount — measured, thirty naked players scored 6,392 and five
 * fully-kitted ones 6,410, so two parties that are nothing alike met the same
 * fight. Averaging separates the questions that were tangled together:
 *
 *   RATING (this)  — how equipped they are  ->  WHICH units they face
 *   headcount      — how many they are      ->  HOW MANY of them
 *
 * A gear tier therefore maps to a level whatever the turnout, and a bigger
 * crowd meets more of the same rather than something categorically nastier.
 */
export function partyRating(party: readonly Character[], content: ContentRegistry): number {
  if (party.length === 0) return 0;
  const mean = party.reduce((sum, c) => sum + memberPower(c, content), 0) / party.length;
  return Math.round(mean * compositionFactor(party.map((c) => c.role)));
}

/** Kept for anything that wants the party's whole mass rather than its tier. */
export function partyTotal(party: readonly Character[], content: ContentRegistry): number {
  return party.reduce((sum, c) => sum + memberPower(c, content), 0);
}
