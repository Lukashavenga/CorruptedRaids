import type { PathDirection } from "../engine/types.js";

export interface VoteTally {
  left: number;
  up: number;
  right: number;
  total: number;
  /** Null on a tie or with no votes - the overlay shows a tie as a tie. */
  leader: PathDirection | null;
}

/** How a door came to be picked, for the log line and for tests. */
export type VoteOutcome = { direction: PathDirection; decidedBy: "vote" | "tie" | "nobody" };

/**
 * Chat's door vote for the round in progress.
 *
 * This lived in src/server/chat.ts as a tally nobody acted on: `choosing` had
 * no timer, so the count was shown and the operator still clicked the door.
 * It is owned by the DungeonController now because the vote DECIDES - the
 * choice window's timer reads it - and a thing the state machine acts on
 * cannot live in the HTTP layer where the simulator cannot reach it.
 *
 * One vote per viewer, last one wins - changing your mind mid-vote is normal
 * chat behaviour, and counting every line would let one person spam a door.
 */
export class PathVote {
  private votes = new Map<string, PathDirection>();

  cast(viewerId: string, direction: PathDirection): void {
    this.votes.set(viewerId, direction);
  }

  /** Cleared whenever a door actually opens, so a round starts from zero. */
  reset(): void {
    this.votes.clear();
  }

  tally(): VoteTally {
    const counts: Record<PathDirection, number> = { left: 0, up: 0, right: 0 };
    for (const direction of this.votes.values()) counts[direction] += 1;
    const total = this.votes.size;
    const ranked = (Object.entries(counts) as [PathDirection, number][]).sort((a, b) => b[1] - a[1]);
    const leader = total > 0 && ranked[0]![1] > (ranked[1]?.[1] ?? 0) ? ranked[0]![0] : null;
    return { ...counts, total, leader };
  }

  /**
   * The door the window closes on.
   *
   * A tie is broken at random AMONG THE TIED doors, and a round nobody voted
   * in picks at random among all of them - a stream cannot stall on a decision
   * nobody makes, and a random door is the honest outcome of "nobody chose".
   * `open` is the doors that can still be opened; a vote for one that cannot
   * is ignored rather than wedging the round.
   */
  winner(open: readonly PathDirection[], rng: () => number): VoteOutcome | null {
    if (open.length === 0) return null;
    const counts = this.tally();
    const best = Math.max(...open.map((d) => counts[d]));
    const tied = open.filter((d) => counts[d] === best);
    const direction = tied[Math.floor(rng() * tied.length)] ?? tied[0]!;
    return { direction, decidedBy: best === 0 ? "nobody" : tied.length > 1 ? "tie" : "vote" };
  }
}
