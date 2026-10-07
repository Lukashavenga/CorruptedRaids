import type {
  PathDirection,
  RaidBuff,
  RaidDefinition,
  RaidDoor,
  RaidRoom,
  Stats,
} from "./types.js";
import { PATH_DIRECTIONS } from "./types.js";
import type { Rng } from "./rng.js";

/**
 * A raid in progress.
 *
 * Held here rather than folded into the dungeon run state because a raid
 * carries something a dungeon never does: history. Which buffs the party
 * picked up in round one changes how round four resolves, and that
 * accumulation is the whole reason the mode exists.
 */
export interface RaidRun {
  raidId: string;
  name: string;
  /** 1-based. When it exceeds `rounds`, the boss is next. */
  round: number;
  rounds: number;
  /** The three doors currently on offer. Empty while a door's outcome plays out. */
  doors: RaidDoor[];
  /** Buffs collected so far, in the order they were found. */
  buffs: RaidBuff[];
  /** Buff ids already awarded, so a run cannot hand out the same boon twice. */
  claimed: string[];
  /** True once every round is done and only the boss remains. */
  bossPending: boolean;
  /**
   * The room the party has just had revealed to them and not yet walked into.
   *
   * This is what makes the reveal a beat rather than a caption. Opening a door
   * sets it; the reveal scene reads it; entering the room clears it. Held on
   * the RUN rather than passed along in the dispatch result because the
   * snapshot is rebuilt from run state on every tick — a reveal that lived
   * only in a return value would vanish the moment anything else pushed an
   * update, which is most of a second.
   */
  pendingRoomId: string | null;
}

/** The room a door leads to, or undefined if the raid no longer declares it. */
export function roomFor(def: RaidDefinition, roomId: string): RaidRoom | undefined {
  if (roomId === def.boss.id) return def.boss;
  return def.rooms.find((r) => r.id === roomId);
}

/**
 * The three doors for a round, straight off the authored path.
 *
 * Deterministic. This used to roll each door independently from a weighted
 * table — the variety was the point, and it is what has been traded away so
 * that a streamer can say what a night looks like before it happens.
 *
 * `claimed` decides what a shrine still has to give. One that names no boon
 * hands out whichever the party has not taken yet; one that names a boon
 * hands out that boon, ONCE. Either way a door with nothing left to give
 * carries no `buffId`, and that absence is what the reveal reads to say so.
 *
 * The named case used to skip the check - `room.buffId ?? available[0]?.id` -
 * which was harmless while doors were rolled and stopped being harmless when
 * the path was authored: the same shrine behind doors in two rounds stacked
 * its boon twice, in a run whose `claimed` list exists to prevent exactly
 * that.
 */
export function doorsForRound(def: RaidDefinition, round: number, claimed: string[]): RaidDoor[] {
  const step = def.path[round - 1];
  const available = def.buffs.filter((b) => !claimed.includes(b.id));

  return PATH_DIRECTIONS.map((direction) => {
    const roomId = step?.[direction] ?? "";
    const room = roomId ? roomFor(def, roomId) : undefined;

    // An authored door pointing at a room that no longer exists is an empty
    // corridor rather than a crash. The schema rejects this at load, so
    // reaching here means the content changed under a live run.
    if (!room) return { direction, kind: "clear" as const, roomId: "", opened: false };

    const door: RaidDoor = { direction, kind: room.kind, roomId: room.id, opened: false };
    if (room.kind === "buff") {
      const boon =
        room.buffId === undefined
          ? available[0]?.id
          : available.some((b) => b.id === room.buffId)
            ? room.buffId
            : undefined;
      if (boon !== undefined) door.buffId = boon;
    }
    return door;
  });
}

export function startRaid(def: RaidDefinition, _rng: Rng): RaidRun {
  return {
    raidId: def.id,
    name: def.name,
    round: 1,
    // The path IS the round count. There is no separate number to keep in step.
    rounds: def.path.length,
    doors: doorsForRound(def, 1, []),
    buffs: [],
    claimed: [],
    bossPending: false,
    pendingRoomId: null,
  };
}

/**
 * Opens one door and advances the raid.
 *
 * Returns the door that was opened so the caller can decide what happens next —
 * a fight has to be run, a buff or a clear corridor only has to be shown. This
 * function deliberately does NOT resolve combat: keeping the raid's bookkeeping
 * separate from the combat resolver is what lets a door fight use exactly the
 * same code path as a dungeon fight.
 */
export function openDoor(
  run: RaidRun,
  def: RaidDefinition,
  direction: PathDirection,
): RaidDoor | undefined {
  const door = run.doors.find((d) => d.direction === direction);
  if (!door || door.opened) return undefined;

  door.opened = true;
  // The room is now the thing on screen, whatever it holds.
  run.pendingRoomId = door.roomId || null;
  if (door.kind === "buff" && door.buffId) {
    const buff = def.buffs.find((b) => b.id === door.buffId);
    // Checked again here, not only when the doors were laid out: this is the
    // line that adds to the party's stats, so it is the one that must not be
    // reachable twice for one boon whatever built the door.
    if (buff && !run.claimed.includes(buff.id)) {
      run.buffs.push(buff);
      run.claimed.push(buff.id);
    } else {
      delete door.buffId;
    }
  }
  return door;
}

/**
 * The boon the room now on screen gave the party, or undefined if it gave
 * none.
 *
 * Read off the DOOR that was opened. The reveal used to take the last entry
 * in `run.buffs`, which is "the most recent boon found anywhere" - so a shrine
 * with nothing left was announced under the name of whatever an earlier one
 * had given, and the party was told it had gained something it had not.
 */
export function boonGranted(run: RaidRun, def: RaidDefinition): RaidBuff | undefined {
  if (!run.pendingRoomId) return undefined;
  const door = run.doors.find((d) => d.opened && d.roomId === run.pendingRoomId);
  if (!door?.buffId) return undefined;
  return def.buffs.find((b) => b.id === door.buffId);
}

/**
 * Marks the revealed room as walked into.
 *
 * Separate from openDoor because the two are now separate beats: the door
 * opens, the room is shown for as long as it takes to read, and only then does
 * the party step through it.
 */
export function enterRoom(run: RaidRun): void {
  run.pendingRoomId = null;
}

/**
 * Moves to the next round, or marks the boss as next.
 *
 * Called once a door's outcome has finished playing out — after the reveal for
 * a buff or clear corridor, and after combat for a fight.
 */
export function advanceRound(run: RaidRun, def: RaidDefinition, _rng: Rng): void {
  run.pendingRoomId = null;
  if (run.round >= run.rounds) {
    run.bossPending = true;
    run.doors = [];
    // The boss room is revealed like any other, and the party arrives at it
    // rather than choosing it — so it is pending from the moment the last
    // round ends, with no door to open first.
    run.pendingRoomId = def.boss.id;
    return;
  }
  run.round += 1;
  run.doors = doorsForRound(def, run.round, run.claimed);
}

/**
 * The party's accumulated buffs, summed into one stat block.
 *
 * Flat additions, summed rather than multiplied — see RaidBuff. Crit is a
 * fraction and the rest are whole numbers, but they add the same way, so no
 * special case is needed here.
 */
export function buffTotals(run: RaidRun): Partial<Stats> {
  const totals: Partial<Stats> = {};
  for (const buff of run.buffs) {
    for (const [key, value] of Object.entries(buff.statMods)) {
      const stat = key as keyof Stats;
      totals[stat] = (totals[stat] ?? 0) + (value ?? 0);
    }
  }
  return totals;
}
