import type { StateMachineConfig } from "./StateMachine.js";

/**
 * The dungeon run lifecycle, as it appears on the stream overlay.
 *
 *   idle -------runOpened--------> gathering   (join window — viewers join here)
 *   gathering --runStarted-------> combat      (party locks; fight resolves instantly server-side)
 *   combat ----combatResolved----> results     (hold time computed per-fight from the event log)
 *   results ---resultsElapsed----> cooldown
 *   cooldown --cooldownElapsed---> idle
 *
 * A RAID takes the same machine around a loop before it ends:
 *
 *   gathering --raidStarted------> choosing    (three doors, one gets picked)
 *   choosing ---pathChosen-------> reveal      (EVERY door: the room is shown)
 *   reveal -----roomEntered------> combat      (the room held enemies)
 *   reveal -----revealElapsed----> choosing    (a boon or an empty corridor: next round)
 *   combat -----roundSurvived----> reveal      (door fight won, rounds remain)
 *   combat -----combatResolved---> results     (boss down, or the party wiped)
 *
 * `reveal` carries two different beats and the timer's EVENT is what tells
 * them apart, not the state: a room with a fight in it enters `reveal` with
 * the timer overridden to `roomEntered`, so the scene plays and then the
 * fight starts; everything else keeps the default `revealElapsed` and moves
 * to the next round. That is the mechanism `timerEventOverride` exists for
 * (see StateMachine.send) and it is why the pre-fight reveal did not need a
 * sixth state duplicating the whole hold.
 *
 * `gathering` is the state the previous four-state config had no concept of
 * — it is the "5 viewers are joining in" window, and it is why this is a new
 * config rather than an edit to raidStates: the state GRAPH changed, the
 * StateMachine mechanism did not (AGENTS.md §5.4).
 *
 * The join window has no timer here on purpose. Its duration is content
 * (`joinWindowMs` on the dungeon), so the controller passes it in as a timer
 * override when it enters `gathering` — that way an Easy dungeon and a Raid
 * can hold the window open for different lengths without a second config.
 *
 * `combat` is near-instantaneous server-side (the resolver decides a whole
 * fight synchronously) — its role is to gate a second start from overlapping
 * a fight still on screen, not to model fight duration. The overlay's own
 * client-side pacing (web/src/hooks/useCombatPlayback.ts) times the animation.
 */
export const STATE_IDS = [
  "idle",
  "gathering",
  "choosing",
  "reveal",
  "combat",
  "results",
  "cooldown",
] as const;
export type StateId = (typeof STATE_IDS)[number];

export const DUNGEON_EVENTS = [
  "runOpened",
  "joinWindowElapsed",
  "runStarted",
  // Raids leave the join window into a door choice rather than a fight. Two
  // events rather than two gathering states: the waiting is identical, only
  // the exit differs, and the timer's event is overridden per run.
  "raidWindowElapsed",
  "raidStarted",
  "pathChosen",
  // The revealed room's fight begins. Distinct from revealElapsed because the
  // same state has to be able to end in either a fight or the next round.
  "roomEntered",
  // Re-enters `combat` purely to re-arm its hold now that the fight has
  // resolved and its replay length is known. See the note on the transition.
  "fightPlaying",
  "revealElapsed",
  "roundSurvived",
  "combatResolved",
  "resultsElapsed",
  "cooldownElapsed",
  "runReset",
] as const;
export type DungeonEvent = (typeof DUNGEON_EVENTS)[number];

/** Fallback results-hold time if a duration can't be estimated for some reason. */
export const DEFAULT_RESULTS_MS = 4000;
/** Floor/ceiling clamp for the per-fight estimated results-hold time. */
export const MIN_RESULTS_MS = 3000;
export const MAX_RESULTS_MS = 90000;
/**
 * Estimated on-screen time per combat-log event, for sizing the results hold.
 * Deliberately a slight OVER-estimate of the client's real pacing (see
 * PACING in web/src/hooks/useCombatPlayback.ts): holding the results state a
 * few seconds longer than the replay needs is harmless, whereas
 * under-estimating would cut a fight off mid-log.
 */
export const MS_PER_EVENT = 240;

/** Fallback join window if a dungeon somehow doesn't specify one. */
export const DEFAULT_JOIN_WINDOW_MS = 20000;

/** Quiet beat between a run's results clearing and the overlay going idle again. */
export const COOLDOWN_MS = 2500;

/**
 * How long an opened door's contents stay on screen before the next choice.
 *
 * Long enough to read a buff's name and what it does — the whole value of a
 * buff door is the party knowing they got something.
 */
export const REVEAL_MS = 3000;

/**
 * How long a room with a fight in it is shown before the fight starts.
 *
 * Longer than REVEAL_MS on purpose. A boon is a name and a line; a fight room
 * is a place with bodies standing in it, and the audience is being given the
 * chance to see what the choice just cost them before it plays out. Too short
 * and the reveal is a flicker between the doors and the combat, which is worse
 * than not having it.
 */
export const ROOM_REVEAL_MS = 4200;

/**
 * How long the boss room is held before the boss fight.
 *
 * The one room nobody chose and everybody knew was coming — it gets the
 * longest beat in the run.
 */
export const BOSS_REVEAL_MS = 5200;

/**
 * How long a raid waits for a path to be chosen before picking one itself.
 *
 * A stream cannot stall on a decision nobody makes. The auto-pick is random,
 * which is also the honest outcome of "nobody chose".
 */
export const CHOICE_WINDOW_MS = 15000;

export const DUNGEON_STATE_CONFIG: StateMachineConfig<StateId, DungeonEvent> = {
  initial: "idle",
  transitions: {
    idle: { runOpened: "gathering" },
    // joinWindowElapsed auto-starts the run when the window times out; the
    // streamer's button fires runStarted directly and skips the wait. The raid
    // pair does the same thing into the door choice instead of into a fight.
    gathering: {
      runStarted: "combat",
      joinWindowElapsed: "combat",
      raidStarted: "choosing",
      raidWindowElapsed: "choosing",
      runReset: "idle",
    },
    // The raid loop. A door either opens onto a fight (-> combat) or onto a
    // buff or an empty corridor, which is a beat to SHOW rather than to play
    // (-> reveal). Surviving a door fight returns to the next choice; only the
    // boss dying, or the party wiping, ends the run.
    // Every door reveals its room first, so there is only one exit from a
    // choice. `pathCleared` is gone with the second exit it existed for.
    choosing: { pathChosen: "reveal", runReset: "idle" },
    // The self-transition on pathChosen is how the party walks up to the boss
    // room: afterRound() re-enters the reveal with a new room and a new timer.
    reveal: { revealElapsed: "choosing", pathChosen: "reveal", roomEntered: "combat", runReset: "idle" },
    // A survived door fight STAYS in combat while its replay plays, then goes
    // to the next choice.
    //
    // It used to leave for `reveal` the instant the resolver returned, which
    // meant the overlay — which only draws the arena in `combat` and `results`
    // — put the doors back up over a fight it had never shown. Door fights
    // were invisible. `fightPlaying` is a self-transition whose only job is to
    // re-arm this state's hold once the replay length is known, which cannot
    // be passed in on the way IN because the fight has not been resolved yet
    // at that point.
    combat: {
      combatResolved: "results",
      fightPlaying: "combat",
      roundSurvived: "choosing",
      runReset: "idle",
    },
    results: { resultsElapsed: "cooldown", runReset: "idle" },
    cooldown: { cooldownElapsed: "idle", runReset: "idle" },
  },
  timers: {
    gathering: { afterMs: DEFAULT_JOIN_WINDOW_MS, event: "joinWindowElapsed" },
    // Only ever reached via `fightPlaying`, which always overrides both the
    // delay and the event. The default is a backstop so a raid cannot wedge in
    // `combat` if a replay length ever came back as nonsense.
    combat: { afterMs: MAX_RESULTS_MS, event: "combatResolved" },
    reveal: { afterMs: REVEAL_MS, event: "revealElapsed" },
    results: { afterMs: DEFAULT_RESULTS_MS, event: "resultsElapsed" },
    cooldown: { afterMs: COOLDOWN_MS, event: "cooldownElapsed" },
  },
};

/** Estimates how long the client will spend replaying `eventCount` combat-log events, clamped to a sane range. */
export function replayDurationMs(eventCount: number): number {
  const estimate = eventCount * MS_PER_EVENT;
  return Math.min(MAX_RESULTS_MS, Math.max(MIN_RESULTS_MS, estimate));
}
