import type { Role } from "../../src/engine/types.js";

/**
 * Where each role stands in the party line-up.
 *
 * The party occupies the LEFT half of the arena and the enemies the right,
 * so the party's "front" — the rank nearest the fighting — is its RIGHTMOST
 * edge. Sorting ascending by this rank therefore puts healers at the far
 * left (back), dps in the middle, and tanks on the right, closest to the
 * enemy line.
 *
 * This is presentation only. The resolver has no notion of position:
 * a tank soaks damage because of aggro weighting (see the resolver and
 * balance.ts), not because of where it is drawn. The formation exists to
 * make that mechanic legible to someone watching the stream.
 */
export const ROLE_RANK: Record<Role, number> = {
  healer: 0,
  dps: 1,
  tank: 2,
};

/**
 * Orders a party line-up back-to-front. Stable within a role, so people keep
 * their join order relative to their peers instead of shuffling every update.
 */
export function byFormation<T extends { role?: Role }>(members: T[]): T[] {
  return members
    .map((member, index) => ({ member, index }))
    .sort((a, b) => {
      const rank = ROLE_RANK[a.member.role ?? "dps"] - ROLE_RANK[b.member.role ?? "dps"];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.member);
}
