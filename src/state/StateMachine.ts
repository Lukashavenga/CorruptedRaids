import { EventEmitter } from "node:events";

/**
 * Generic, config-driven finite state machine. Deliberately knows nothing
 * about raids, combat, or gear — see raidStates.config.ts for the concrete
 * game states built on top of this. Keeping the mechanism generic and the
 * game's states as pure data is the same split the rest of this project
 * uses (content vs. engine, proportions vs. rig, poses vs. renderer).
 */
export type TransitionTable<TState extends string, TEvent extends string> = Record<
  TState,
  Partial<Record<TEvent, TState>>
>;

export interface StateTimer<TEvent extends string> {
  /** How long after entering the state to auto-fire `event`, unless something else transitions first. */
  afterMs: number;
  event: TEvent;
}

export interface StateMachineConfig<TState extends string, TEvent extends string> {
  initial: TState;
  transitions: TransitionTable<TState, TEvent>;
  /** Optional per-state auto-advance timer. Not every state needs one. */
  timers?: Partial<Record<TState, StateTimer<TEvent>>>;
}

export interface TransitionInfo<TState extends string, TEvent extends string> {
  from: TState;
  to: TState;
  event: TEvent;
}

/**
 * Emits "transition" ({from, to, event}) on every state change. `send()`
 * returns false and does nothing if `event` has no transition defined for
 * the current state — a state machine should be robust to a stray/late
 * event, not throw and take the process down with it.
 */
export class StateMachine<TState extends string, TEvent extends string> extends EventEmitter {
  private readonly config: StateMachineConfig<TState, TEvent>;
  private current: TState;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The event the pending timer will fire.
   *
   * Tracked because `timerEventOverride` means the answer is not always the
   * one in config, and something has to be able to ask — see forceTimer().
   */
  private armed: TEvent | undefined;

  constructor(config: StateMachineConfig<TState, TEvent>) {
    super();
    this.config = config;
    this.current = config.initial;
    this.armTimer();
  }

  get state(): TState {
    return this.current;
  }

  /**
   * Fires `event`. `timerOverrideMs` replaces the configured timer's delay
   * for this one transition only (e.g. "hold the results state for exactly
   * as long as the combat log takes to replay," computed per-fight rather
   * than fixed in config) — the state's configured event still fires, just
   * after this delay instead of its default.
   *
   * `timerEventOverride` replaces which event that timer fires. One state can
   * legitimately need to auto-advance to different places depending on the
   * content it was entered with: the join window ends in a fight for a dungeon
   * and in a door choice for a raid, and both are the same `gathering` state
   * waiting the same way. Encoding that as two states would duplicate the
   * whole join-window behaviour to change its exit.
   */
  send(event: TEvent, opts?: { timerOverrideMs?: number; timerEventOverride?: TEvent }): boolean {
    const next = this.config.transitions[this.current]?.[event];
    if (next === undefined) return false;
    const from = this.current;
    this.current = next;
    this.clearTimer();
    this.armTimer(opts?.timerOverrideMs, opts?.timerEventOverride);
    this.emit("transition", { from, to: next, event } satisfies TransitionInfo<TState, TEvent>);
    return true;
  }

  /**
   * Fires the pending auto-advance NOW instead of waiting for it, and returns
   * whether there was one.
   *
   * For tests and simulators, which have to prove a loop terminates without
   * spending its real running time doing so. It fires whatever event is
   * actually armed rather than the one in config, which is the whole point: a
   * caller that guessed would silently stop testing the real path the day a
   * state learned to exit two ways.
   */
  forceTimer(): boolean {
    const event = this.armed;
    if (event === undefined) return false;
    return this.send(event);
  }

  /** Stops any pending auto-advance timer. Call when the machine is no longer needed (e.g. server shutdown). */
  dispose(): void {
    this.clearTimer();
  }

  private armTimer(overrideMs?: number, eventOverride?: TEvent): void {
    const configured = this.config.timers?.[this.current];
    if (!configured) return;
    const delay = overrideMs ?? configured.afterMs;
    const event = eventOverride ?? configured.event;
    this.armed = event;
    this.timer = setTimeout(() => this.send(event), delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.armed = undefined;
  }
}
