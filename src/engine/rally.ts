import type { Character, Stats } from "./types.js";
import type { BalanceConfig } from "./balance.js";
import type { ContentRegistry } from "./content/loader.js";
import { memberPower, partyRating, ratePoints } from "./partyStrength.js";

/**
 * Rally (balance.rally): a member far below the party's power fights stronger
 * for that fight only.
 *
 * PURE and read-only. It never touches a Character: the resolver applies the
 * result to its own copy of the fight stats, and the overlay asks the same
 * function who to badge, so the roster chip and the fight cannot disagree.
 * Corruption (memberPower) and the party rating are computed from the REAL
 * stats and are not changed by it - the band a party meets is picked as before.
 */

/** Who is Rallied in this party, by character id. Empty when Rally is off or the party too small. */
export function rallied(party: readonly Character[], content: ContentRegistry): Set<string> {
  const cfg = content.balance.rally;
  const out = new Set<string>();
  if (!cfg.enabled || party.length < cfg.minPartySize) return out;
  const rating = partyRating(party, content);
  if (rating <= 0) return out;
  for (const c of party) {
    if (memberPower(c, content) < cfg.belowFraction * rating) out.add(c.id);
  }
  return out;
}

/**
 * Hp, Attack and Skill scaled by one factor so the member's power reaches
 * `toFraction` of the party's rating, or `maxMultiplier` if that is not enough.
 * Speed and crit stay: speed is initiative share, and a newcomer who suddenly
 * acts twice as often is a different fix from the one asked for.
 *
 * Bisection, because ratePoints is monotone in all three but not linear
 * (mitigation saturates).
 */
export function rallyStats(stats: Stats, rating: number, balance: BalanceConfig): Stats {
  const { toFraction, maxMultiplier } = balance.rally;
  const target = toFraction * rating;
  const scaled = (m: number): Stats => ({ ...stats, hp: stats.hp * m, atk: stats.atk * m, skill: stats.skill * m });
  if (ratePoints(stats, balance) >= target) return stats;
  if (ratePoints(scaled(maxMultiplier), balance) <= target) return scaled(maxMultiplier);
  let lo = 1;
  let hi = maxMultiplier;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ratePoints(scaled(mid), balance) < target) lo = mid;
    else hi = mid;
  }
  return scaled(hi);
}
