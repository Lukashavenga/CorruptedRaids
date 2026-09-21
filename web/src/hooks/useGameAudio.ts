import { useEffect, useRef } from "react";
import type { DungeonSnapshot } from "../../../src/state/DungeonController.js";
import { play, preload } from "../audio.js";

/**
 * Sound, derived from the state the overlay already has.
 *
 * NO NEW EVENT CHANNEL. The server streams snapshots, not events, and the
 * overlay draws whatever the latest one says — so a cue is a TRANSITION between
 * two snapshots, found by comparing this one against the last. Adding a
 * parallel "sound event" stream would mean two descriptions of the same moment
 * that can disagree, and the one that loses is always the audio, silently.
 *
 * That choice has one consequence worth stating: a transition the overlay never
 * observes makes no sound. If a reconnect skips from idle straight to combat,
 * the dungeon sting does not play, because as far as this surface is concerned
 * the run did not start — it was already running. That is the right answer for
 * a browser source that may be added to a scene mid-fight.
 */
export function useGameAudio(snapshot: DungeonSnapshot | null): void {
  /** The last snapshot we made a decision about. */
  const wasIdle = useRef(true);
  const lastRoom = useRef<string | null>(null);
  const bossWasPending = useRef(false);

  // Warm the decoder before the first transition needs it, not during.
  useEffect(() => {
    preload("dungeonStart", "raidStart", "roomDiscover", "bossFound");
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const idle = snapshot.state === "idle";
    const raid = snapshot.engine.raid;

    /*
     * A run beginning. Raids get their own sting — they are the bigger event
     * and the audience is being told something different is happening.
     */
    if (wasIdle.current && !idle) play(raid ? "raidStart" : "dungeonStart");
    wasIdle.current = idle;

    /*
     * A room being revealed. Keyed on the room ID rather than on the reveal
     * state, because the overlay re-renders on every snapshot and `state`
     * stays "reveal" across all of them — firing on the state would retrigger
     * the cue several times a second for as long as the card is up.
     */
    const room = raid?.revealed ?? null;
    if (room && room.id !== lastRoom.current) {
      lastRoom.current = room.id;
      // Every revealed room gets the discover cue. There is no "boss" DoorKind
      // — it is clear/buff/fight — so the boss is announced by bossPending
      // below rather than by anything about the room.
      play("roomDiscover");
    } else if (!room) {
      lastRoom.current = null;
    }

    /*
     * The boss becoming pending — the raid has run its rounds and the boss is
     * next. This fires on the EDGE, and separately from the room cue above,
     * because a raid can reach its boss without a boss room having been
     * revealed first.
     */
    const pending = raid?.bossPending ?? false;
    if (pending && !bossWasPending.current) play("bossFound");
    bossWasPending.current = pending;

    // Leaving a run resets everything, so the next one sounds like a first.
    if (idle) {
      lastRoom.current = null;
      bossWasPending.current = false;
    }
  }, [snapshot]);
}
