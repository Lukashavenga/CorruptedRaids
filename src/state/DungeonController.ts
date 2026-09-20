import { EventEmitter } from "node:events";
import type { GameEngine, DispatchResult, StateSnapshot } from "../engine/state/gameEngine.js";
import type { GameCommand } from "../engine/commands/types.js";
import { StateMachine } from "./StateMachine.js";
import { advanceRound } from "../engine/raid.js";
import {
  DUNGEON_STATE_CONFIG,
  DEFAULT_JOIN_WINDOW_MS,
  BOSS_REVEAL_MS,
  ROOM_REVEAL_MS,
  replayDurationMs,
  type DungeonEvent,
  type StateId,
} from "./dungeonStates.config.js";
import { text } from "../text/index.js";

export interface DungeonSnapshot {
  engine: StateSnapshot;
  state: StateId;
  /**
   * When the join window closes, as an epoch ms timestamp — the overlay
   * counts down against this rather than being pushed a tick every second.
   * Null outside the `gathering` state.
   */
  joinDeadline: number | null;
}

export interface DungeonUpdate {
  snapshot: DungeonSnapshot;
  /** Null for updates caused by a state timer elapsing rather than a dispatched command. */
  result: DispatchResult | null;
}

/**
 * Wraps GameEngine with the dungeon run state machine
 * (dungeonStates.config.ts). This is the seam src/server talks to instead of
 * GameEngine directly — it is the one place a command gets checked against
 * "what phase is the run in?" before it is allowed to run, and the one place
 * a fight's estimated on-screen time turns into how long `results` holds.
 *
 * GameEngine itself is untouched: it still knows nothing about state
 * machines, HTTP, or Twitch.
 */
export class DungeonController extends EventEmitter {
  readonly engine: GameEngine;
  private readonly fsm: StateMachine<StateId, DungeonEvent>;
  private dispatching = false;
  private joinDeadline: number | null = null;

  constructor(engine: GameEngine) {
    super();
    this.engine = engine;
    this.fsm = new StateMachine(DUNGEON_STATE_CONFIG);

    this.fsm.on("transition", ({ to, event }: { to: StateId; event: DungeonEvent }) => {
      if (to !== "gathering") this.joinDeadline = null;

      // The join window timing out is the one transition that has to *do*
      // something rather than just be announced: it starts the fight the
      // streamer's button would otherwise have started.
      //
      // This MUST key on the triggering event, not on `to === "combat"`
      // alone — the manual start path also transitions into `combat`, and
      // gating on engine state instead (e.g. "no combat resolved yet")
      // cannot tell the two apart, because at the instant of the transition
      // the manual dispatch hasn't run the fight either. Keying on the
      // event is what stops one button press from resolving two fights.
      // A raid's join window ends in a door choice, not a fight — the doors
      // are already rolled, so there is nothing to do but let the state stand.
      // Except the empty-party case, which is the same disappointment either
      // way and should not leave three doors up for nobody.
      if (event === "raidWindowElapsed" && this.engine.party.length === 0) {
        const result = this.engine.dispatch({ type: "reset_dungeon" });
        this.fsm.send("runReset");
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return;
      }

      // The revealed room's fight begins. The party has now looked at what is
      // waiting for as long as the reveal held, and walks in.
      if (event === "roomEntered") {
        this.enterRevealedRoom();
        return;
      }

      // The room is finished with — its reveal has played out, or its fight
      // has. Only NOW does the round move on.
      //
      // Advancing any earlier is a bug that hides the thing this whole beat
      // exists for: `advanceRound` clears the revealed room (and, on the last
      // round, replaces it with the boss), so a boon or an empty corridor that
      // advanced the moment its door opened had nothing left to reveal by the
      // time the overlay drew a frame.
      if (event === "revealElapsed" || event === "roundSurvived") {
        this.advance();
        this.afterRound();
        return;
      }

      if (event === "joinWindowElapsed") {
        // Nobody turned up — drop straight back to idle rather than showing
        // a results screen for a fight that never happened.
        if (this.engine.party.length === 0) {
          const result = this.engine.dispatch({ type: "reset_dungeon" });
          this.fsm.send("runReset");
          this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
          return;
        }
        const result = this.engine.dispatch({ type: "start_dungeon" });
        this.fsm.send("combatResolved", { timerOverrideMs: replayDurationMs(result.combat?.events.length ?? 0) });
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return;
      }

      if (this.dispatching) return;
      this.emit("update", { snapshot: this.getSnapshot(), result: null } satisfies DungeonUpdate);
    });
  }

  get state(): StateId {
    return this.fsm.state;
  }

  /**
   * Fire the current state's pending auto-advance immediately instead of
   * waiting for its timer, and say whether there was one.
   *
   * For tests and the simulator, which have to prove a raid's loop terminates
   * without spending its real running time doing so. Public rather than left
   * to reach into `fsm` privately, because a simulator poking at internals
   * silently stops testing the real path the day they change.
   *
   * It used to send `revealElapsed` by name. That stopped being right when a
   * reveal learned to end in a fight instead of in the next round: naming the
   * event meant the simulator walked a path no live raid takes, skipping every
   * room fight it was supposed to be proving terminated.
   */
  forceTimerElapsed(): boolean {
    return this.fsm.forceTimer();
  }

  dispatch(command: GameCommand): DispatchResult {
    this.dispatching = true;
    try {
      const gate = this.checkPhase(command);
      if (gate) return gate;

      // --- transitions that must happen BEFORE the engine handles the command
      if (command.type === "open_raid") {
        const result = this.engine.dispatch(command);
        if (result.ok) {
          const windowMs = this.engine.openRaid?.joinWindowMs ?? DEFAULT_JOIN_WINDOW_MS;
          this.joinDeadline = Date.now() + windowMs;
          // Same waiting, different exit: the timer is redirected so the window
          // ends at the door choice instead of at a fight.
          this.fsm.send("runOpened", {
            timerOverrideMs: windowMs,
            timerEventOverride: "raidWindowElapsed",
          });
        }
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return result;
      }

      if (command.type === "choose_path") {
        const result = this.engine.dispatch(command);
        if (result.ok && result.door) {
          if (result.door.kind === "fight") {
            // Show the room, THEN fight it. The timer's event is redirected so
            // this same `reveal` state ends in combat instead of in the next
            // round — see the note in dungeonStates.config.ts.
            this.fsm.send("pathChosen", {
              timerOverrideMs: ROOM_REVEAL_MS,
              timerEventOverride: "roomEntered",
            });
          } else {
            // A boon or an empty corridor has nothing to resolve — but it
            // still has to be SHOWN, so the round advances when the reveal
            // ends, not here.
            this.fsm.send("pathChosen");
          }
        }
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return result;
      }

      if (command.type === "start_boss") {
        const result = this.engine.dispatch(command);
        if (!result.ok) {
          this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
          return result;
        }
        // Already in `reveal`, standing at the boss's door — go straight to
        // the fight rather than re-opening a choice that is long over.
        this.fsm.send("roomEntered");
        this.fsm.send("combatResolved", {
          timerOverrideMs: replayDurationMs(result.combat?.events.length ?? 0),
        });
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return result;
      }

      if (command.type === "open_dungeon") {
        const result = this.engine.dispatch(command);
        if (result.ok) {
          const windowMs = this.engine.openDungeon?.joinWindowMs ?? DEFAULT_JOIN_WINDOW_MS;
          this.joinDeadline = Date.now() + windowMs;
          this.fsm.send("runOpened", { timerOverrideMs: windowMs });
        }
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return result;
      }

      // "Start" on a raid locks the party and opens the first doors. It runs
      // no fight, so it never reaches the engine — the raid was already rolled
      // when its join window opened, and there is nothing to resolve until a
      // door is chosen. Reusing start_dungeon rather than adding a command
      // keeps one Start button meaning one thing to the streamer.
      if (command.type === "start_dungeon" && this.engine.openRaid) {
        if (this.engine.party.length === 0) {
          return { ok: false, message: text.errors.emptyParty };
        }
        this.fsm.send("raidStarted");
        const result: DispatchResult = { ok: true, message: text.raid.prompt };
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return result;
      }

      if (command.type === "start_dungeon") {
        // Dispatch FIRST, transition only if the engine accepted. Driving the
        // machine ahead of the engine meant a REJECTED start still walked
        // gathering -> combat -> results, stranding the overlay on a results
        // screen for a fight that never ran. It surfaced when raids began
        // rejecting start_dungeon, but it was always wrong.
        const result = this.engine.dispatch(command);
        if (result.ok) {
          this.fsm.send("runStarted");
          this.fsm.send("combatResolved", {
            timerOverrideMs: replayDurationMs(result.combat?.events.length ?? 0),
          });
        }
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return result;
      }

      // Both resets clear the engine's current run, so both have to drive
      // the state machine back to idle. Letting reset_roster through without
      // the runReset would leave the FSM mid-run against an engine that no
      // longer has a dungeon open — the overlay then shows a join window for
      // a run that doesn't exist.
      if (command.type === "reset_dungeon" || command.type === "reset_roster") {
        const result = this.engine.dispatch(command);
        this.fsm.send("runReset");
        this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
        return result;
      }

      const result = this.engine.dispatch(command);
      this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
      return result;
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * Move the raid on one round. Called once a door's outcome has resolved.
   *
   * Separate from the FSM transition because "which round are we on" is engine
   * state and "what is on screen" is machine state — conflating them is how a
   * reveal that gets interrupted leaves the round counter wrong.
   */
  private advance(): void {
    const def = this.engine.openRaid;
    const run = this.engine.raidRun;
    if (def && run) advanceRound(run, def, Math.random);
  }

  /**
   * After a reveal: show the next doors, or start the boss.
   *
   * The boss is auto-started rather than waiting for another command. There is
   * no choice left to make at that point, and a stream should not sit on a
   * screen whose only content is "press the button".
   */
  private afterRound(): void {
    const run = this.engine.raidRun;
    if (run?.bossPending) {
      // Walk the party up to the boss's door and hold there. The boss room is
      // revealed like every other room — it is the one nobody chose and
      // everybody knew was coming, so it gets the longest look — and the timer
      // starts the fight when the beat is over.
      this.fsm.send("pathChosen", {
        timerOverrideMs: BOSS_REVEAL_MS,
        timerEventOverride: "roomEntered",
      });
      return;
    }
    this.emit("update", { snapshot: this.getSnapshot(), result: null } satisfies DungeonUpdate);
  }

  /**
   * The party walks into the room they have just been shown.
   *
   * Reached only off the reveal timer, by which point the machine is already in
   * `combat`. It dispatches straight at the engine rather than through
   * `this.dispatch`, because the phase gate there exists to police commands
   * arriving from OUTSIDE — the server, a chat vote — and it would reject
   * these on the grounds that the fight it is itself starting has started.
   */
  private enterRevealedRoom(): void {
    const boss = this.engine.raidRun?.bossPending ?? false;
    const result = this.engine.dispatch(boss ? { type: "start_boss" } : { type: "enter_room" });
    const holdMs = replayDurationMs(result.combat?.events.length ?? 0);

    if (boss || !result.combat || result.combat.outcome !== "victory") {
      // The boss ends the run either way, and a wipe ends it anywhere.
      this.fsm.send("combatResolved", { timerOverrideMs: holdMs });
    } else {
      // A door fight the party survives is the end of a ROUND, not of the run.
      // Stay in `combat` until the replay has actually been shown; the round
      // advances when that hold ends.
      this.fsm.send("fightPlaying", {
        timerOverrideMs: holdMs,
        timerEventOverride: "roundSurvived",
      });
    }
    this.emit("update", { snapshot: this.getSnapshot(), result } satisfies DungeonUpdate);
  }

  /** Rejects commands that don't make sense in the current phase, with a message the overlay can show. */
  private checkPhase(command: GameCommand): DispatchResult | null {
    switch (command.type) {
      case "open_dungeon":
      case "open_raid":
        return this.fsm.state === "idle" ? null : { ok: false, message: text.errors.runInProgress };
      case "join_dungeon":
      case "sim_join":
        return this.fsm.state === "gathering" ? null : { ok: false, message: text.errors.joinWindowClosed };
      case "choose_path":
        // `choosing` only. It used to be allowed from `reveal` too, so an eager
        // vote during the beat after a boon was not swallowed — but a reveal is
        // now a room being shown, the doors are off screen while it plays, and
        // a second choice landing mid-reveal would open a second door of a
        // round that is already resolving.
        return this.fsm.state === "choosing"
          ? null
          : { ok: false, message: text.errors.notChoosing };
      case "enter_room":
        // Driven by the reveal timer, never from outside.
        return { ok: false, message: text.errors.notChoosing };
      case "start_boss":
        // Ungated, this could be re-sent once the run was already over and
        // fight the boss a second time against a party that had just lost to
        // it — the engine's own check only asks whether the boss is pending,
        // and it stays pending after a defeat.
        return this.fsm.state === "choosing" || this.fsm.state === "reveal"
          ? null
          : { ok: false, message: text.errors.notChoosing };
      case "start_dungeon":
        return this.fsm.state === "gathering" ? null : { ok: false, message: text.errors.notGathering };
      default:
        return null;
    }
  }

  getSnapshot(): DungeonSnapshot {
    return {
      engine: this.engine.getStateSnapshot(),
      state: this.fsm.state,
      joinDeadline: this.fsm.state === "gathering" ? this.joinDeadline : null,
    };
  }

  dispose(): void {
    this.fsm.dispose();
  }
}
