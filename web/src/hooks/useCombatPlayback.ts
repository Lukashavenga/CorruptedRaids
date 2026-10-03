import { useEffect, useRef, useState } from "react";
import type { DispatchResult } from "../../../src/engine/state/gameEngine.js";
import type { CombatOutcome, CombatantSnapshot } from "../../../src/engine/types.js";
import type { Motion } from "../../../src/character/layers.js";
import { text, format } from "../../../src/text/index.js";

export interface LogLine {
  id: number;
  text: string;
  cls?: "crit" | "loot" | "levelup" | "down" | "heal" | "outcome";
}

export type PulseKind = "shake" | "flash" | "heal" | null;

export interface PlaybackState {
  isReplaying: boolean;
  logLines: LogLine[];
  /** combatantId -> current hp. Empty outside a replay; the overlay falls back to full HP. */
  hp: Record<string, number>;
  pulses: Record<string, PulseKind>;
  /**
   * Numbers currently floating off combatants — the damage and heals as they
   * land, rather than only as a line of text.
   *
   * A flat list with its own ids rather than one-per-combatant, because two
   * hits can land on the same body inside the float's lifetime and the second
   * must not silently replace the first. That is exactly the moment worth
   * seeing: a tank eating two swings in a row.
   */
  floats: FloatingNumber[];
  poses: Record<string, Motion>;
  downed: Record<string, boolean>;
  /** Both sides' opening state for the fight being replayed — the overlay builds its panels from this. */
  combatants: CombatantSnapshot[];
  outcome: CombatOutcome | null;
  /**
   * The move that is about to land, announced `leadMs` BEFORE it does.
   *
   * Everything else in this state is the result of an event - hp already
   * changed, a number already floating - which is all a figure standing in a
   * rank needs. A figure that has to CROSS THE FLOOR to deliver the blow needs
   * to know who is hitting whom while there is still time to get there, and
   * `poses` cannot say it: it marks an attacker and a victim at the same
   * instant and never pairs them.
   *
   * The flat overlay ignores this. The 3D arena is choreographed from it.
   */
  action: PlaybackAction | null;
}

export interface PlaybackAction {
  /** Bumps per action, so two identical blows in a row are still two. */
  seq: number;
  kind: "attack" | "heal" | "ability";
  actorId: string;
  /** The actor itself for an ability, which names nobody else. */
  targetId: string;
  crit: boolean;
  /** How long from this announcement until the event lands. */
  leadMs: number;
}

export interface FloatingNumber {
  id: number;
  /** Whose head it comes off. */
  combatantId: string;
  /** Already signed and formatted — "-12", "+8". */
  text: string;
  kind: "damage" | "crit" | "heal";
}

const IDLE: PlaybackState = {
  isReplaying: false,
  logLines: [],
  hp: {},
  pulses: {},
  floats: [],
  poses: {},
  downed: {},
  combatants: [],
  outcome: null,
  action: null,
};

const MAX_LOG_LINES = 8;
/**
 * How long a number floats before it is dropped from state.
 *
 * Must outlast the CSS animation that draws it (.combat-float, 0.9s) or the
 * element is unmounted mid-rise and the number vanishes halfway up.
 */
const FLOAT_LIFETIME_MS = 950;
let nextFloatId = 0;
const PULSE_DURATION_MS = 420;
/** How long a combatant holds an attack/hit pose before relaxing back to idle. */
const POSE_HOLD_MS = 620;
/**
 * How far ahead of its event a move is announced (see PlaybackState.action).
 *
 * Must stay under the shortest gap between two events (PACING.reward, 700) and
 * under the 250ms the replay waits before its first one, or an announcement
 * would be scheduled before the blow in front of it has landed.
 */
const ACTION_LEAD_MS = 240;
let nextActionSeq = 0;

/**
 * Per-event-type pacing, in ms. Tuning the felt speed of a fight happens here.
 *
 * Roughly doubled from the first pass. The old timings resolved a fight fast,
 * but on a 450x250 overlay a viewer is reading a line of text AND watching for
 * their own name in the roster AND tracking two health bars — and every line
 * was gone before any of that could land. A raid that takes longer to watch is
 * the point; the spectacle is the product, not the throughput.
 *
 * `down` and `outcome` get the longest holds because they are the beats an
 * audience reacts to.
 */
const PACING = {
  attack: 750,
  heal: 800,
  ability: 1100,
  down: 1400,
  loot: 950,
  reward: 700,
  levelUp: 1200,
  outcome: 1600,
} as const;

/**
 * The server resolves a whole fight instantly and hands over the complete
 * event log in one message (see src/engine/combat/resolver.ts); this hook
 * replays that log with pacing so it reads as a live fight on stream.
 *
 * Every event carries explicit combatant ids, so unlike the single-hero
 * version this keeps per-combatant HP/pose/pulse maps rather than one
 * hero + one encounter.
 */
export function useCombatPlayback(result: DispatchResult | null, updateSeq: number): PlaybackState {
  const [playback, setPlayback] = useState<PlaybackState>(IDLE);
  const timers = useRef<number[]>([]);

  // Unmount only. Deliberately NOT the per-update effect's cleanup: that
  // would cancel the in-flight replay on every unrelated server message.
  useEffect(() => {
    const pending = timers;
    return () => {
      for (const id of pending.current) window.clearTimeout(id);
      pending.current = [];
    };
  }, []);

  useEffect(() => {
    const combat = result?.combat;
    // Nothing to replay for this update — a viewer joining, a rejected
    // command, a state timer elapsing. Bail out WITHOUT touching the timers
    // of a replay that's still running.
    //
    // This ordering is load-bearing. Clearing timers before this check (or
    // clearing them from this effect's cleanup) silently freezes a fight
    // mid-replay the moment any other message arrives — and on a live
    // stream those arrive constantly, so the overlay would lock up with
    // half the party still standing and the log stuck on one line.
    if (!combat) return;

    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];

    const byId = new Map(combat.combatants.map((c) => [c.id, c]));
    /**
     * Longest name a combat line can carry, in characters.
     *
     * Viewer names are arbitrary and mob names are long ("Bog Goblin Raider
     * 2"), while a 32px line on the 450px stage holds about 27 characters
     * total. Clamping here rather than letting CSS ellipsise keeps the
     * TRAILING INSTANCE NUMBER, which is the part that tells two identical
     * mobs apart — an ellipsis would eat exactly that.
     */
    const NAME_MAX = 10;

    const clampName = (name: string): string => {
      if (name.length <= NAME_MAX) return name;

      const parts = name.split(" ");
      const last = parts[parts.length - 1] ?? "";
      const numbered = parts.length > 1 && /^\d+$/.test(last);
      const words = numbered ? parts.slice(0, -1) : parts;
      const suffix = numbered ? ` ${last}` : "";

      // Drop words from the FRONT, not characters from the end. Truncating
      // "Village Watch 1" by characters gave "Village 1", which reads as a
      // place rather than a person; dropping the leading word gives "Watch 1",
      // which is both shorter and the half that identifies them. English names
      // put the distinguishing word last, and so do these.
      const STOPWORDS = new Set(["of", "the", "a", "an"]);
      for (let i = 0; i < words.length; i += 1) {
        // Never START on a joining word: "Hero of the Vale" would otherwise
        // clamp to "the Vale", which reads as a fragment rather than a name.
        if (STOPWORDS.has((words[i] ?? "").toLowerCase())) continue;
        const candidate = words.slice(i).join(" ") + suffix;
        if (candidate.length <= NAME_MAX) return candidate;
      }
      return (last || name).slice(0, NAME_MAX).trimEnd();
    };

    const nameOf = (id: string) => clampName(byId.get(id)?.name ?? id);
    let nextLineId = 0;

    setPlayback({
      isReplaying: true,
      logLines: [],
      hp: Object.fromEntries(combat.combatants.map((c) => [c.id, c.maxHp])),
      pulses: {},
      floats: [],
      poses: {},
      downed: {},
      combatants: combat.combatants,
      outcome: null,
      action: null,
    });

    /**
     * Runs `fn` in `ms` FROM NOW.
     *
     * Relative, not absolute, and that distinction has bitten this file: the
     * top-level scheduling loop calls `at(when, …)` synchronously during
     * setup, where `when` is the cumulative offset from the start of the
     * replay and "now" is the start, so the two agree. Anything scheduled
     * from INSIDE one of those callbacks is already at `when`, so passing
     * `when + duration` there schedules `2 × when + duration` — a pose late
     * in a long fight was holding for many seconds instead of 620ms.
     *
     * Rule: inside an `at` callback, pass the duration alone.
     */
    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };

    const pushLine = (lineText: string, cls?: LogLine["cls"]) => {
      setPlayback((p) => ({
        ...p,
        logLines: [...p.logLines.slice(-(MAX_LOG_LINES - 1)), { id: nextLineId++, text: lineText, cls }],
      }));
    };

    const pulse = (id: string, kind: NonNullable<PulseKind>) => {
      setPlayback((p) => ({ ...p, pulses: { ...p.pulses, [id]: kind } }));
      // Duration alone — this runs inside an `at` callback. See `at`.
      at(PULSE_DURATION_MS, () =>
        setPlayback((p) => ({ ...p, pulses: { ...p.pulses, [id]: null } })),
      );
    };

    /**
     * Sends a number up off a combatant.
     *
     * The overlay is 450px wide and read from across a room, where the combat
     * log is one line that has already scrolled by the time anybody has
     * finished reading the last one. A number that appears ON the body it
     * belongs to is the only damage feedback that survives at that size, and
     * it is what makes a fight look like it is happening rather than being
     * reported.
     */
    const floatNumber = (combatantId: string, value: string, kind: FloatingNumber["kind"]) => {
      const id = (nextFloatId += 1);
      setPlayback((p) => ({ ...p, floats: [...p.floats, { id, combatantId, text: value, kind }] }));
      // Duration alone — this runs inside an `at` callback. See `at`.
      at(FLOAT_LIFETIME_MS, () =>
        setPlayback((p) => (p.floats.some((f) => f.id === id) ? { ...p, floats: p.floats.filter((f) => f.id !== id) } : p)),
      );
    };

    /**
     * Announces a move ahead of the event that resolves it.
     *
     * Called from the top-level scheduling loop, so `when` is an offset from
     * the start of the replay and `at` is given an absolute time - the one
     * place in this file where that is the right thing to pass.
     */
    const announce = (when: number, action: Omit<PlaybackAction, "seq" | "leadMs">) => {
      const leadMs = Math.min(ACTION_LEAD_MS, when);
      at(when - leadMs, () =>
        setPlayback((p) => ({ ...p, action: { ...action, seq: (nextActionSeq += 1), leadMs } })),
      );
    };

    const posePulse = (id: string, pose: Motion) => {
      setPlayback((p) => ({ ...p, poses: { ...p.poses, [id]: pose } }));
      // Duration alone — this runs inside an `at` callback. See `at`.
      at(POSE_HOLD_MS, () =>
        setPlayback((p) => (p.poses[id] === pose ? { ...p, poses: { ...p.poses, [id]: "idle" } } : p)),
      );
    };

    let delay = 250;
    for (const event of combat.events) {
      const when = delay;
      switch (event.type) {
        // `tick` is structural bookkeeping, not something the audience needs
        // a log line for — it costs no time and prints nothing.
        case "tick":
          break;

        case "attack": {
          delay += PACING.attack;
          // Party name left, enemy name right, whoever swung — the sides they
          // are standing on. Which of them is being hit is carried by the
          // template, which puts the damage next to the one losing it.
          const incoming =
            byId.get(event.actorId)?.side === "enemy" && byId.get(event.targetId)?.side === "party";
          // Same-side hits (nothing does this today) fall through to the
          // outgoing form with the actor on the left, which is the old
          // behaviour and still reads correctly.
          const party = nameOf(incoming ? event.targetId : event.actorId);
          const enemy = nameOf(incoming ? event.actorId : event.targetId);
          announce(when, { kind: "attack", actorId: event.actorId, targetId: event.targetId, crit: event.crit });
          at(when, () => {
            pushLine(
              format(incoming ? text.combatLog.attackIn : text.combatLog.attackOut, {
                party,
                enemy,
                damage: event.damage,
              }),
              event.crit ? "crit" : undefined,
            );
            setPlayback((p) => ({ ...p, hp: { ...p.hp, [event.targetId]: event.targetHpAfter } }));
            pulse(event.targetId, event.crit ? "flash" : "shake");
            floatNumber(event.targetId, `-${event.damage}`, event.crit ? "crit" : "damage");
            posePulse(event.actorId, "attack");
            posePulse(event.targetId, "hit");
          });
          break;
        }

        case "heal": {
          delay += PACING.heal;
          const actor = nameOf(event.actorId);
          announce(when, { kind: "heal", actorId: event.actorId, targetId: event.targetId, crit: false });
          at(when, () => {
            const isSelf = event.actorId === event.targetId;
            pushLine(
              format(isSelf ? text.combatLog.healSelf : text.combatLog.heal, {
                actor,
                target: nameOf(event.targetId),
                amount: event.amount,
              }),
              "heal",
            );
            setPlayback((p) => ({ ...p, hp: { ...p.hp, [event.targetId]: event.targetHpAfter } }));
            floatNumber(event.targetId, `+${event.amount}`, "heal");
            pulse(event.targetId, "heal");
          });
          break;
        }

        case "ability": {
          delay += PACING.ability;
          const actor = nameOf(event.actorId);
          announce(when, { kind: "ability", actorId: event.actorId, targetId: event.actorId, crit: false });
          at(when, () => pushLine(format(text.combatLog.ability, { actor, detail: event.detail })));
          break;
        }

        case "down": {
          delay += PACING.down;
          const who = nameOf(event.combatantId);
          at(when, () => {
            pushLine(format(text.combatLog.down, { who }), "down");
            setPlayback((p) => ({
              ...p,
              downed: { ...p.downed, [event.combatantId]: true },
              poses: { ...p.poses, [event.combatantId]: "defeated" },
            }));
          });
          break;
        }

        case "loot":
          delay += PACING.loot;
          at(when, () =>
            pushLine(format(text.combatLog.loot, { who: nameOf(event.characterId), gearName: event.gearName }), "loot"),
          );
          break;

        case "reward":
          delay += PACING.reward;
          at(when, () =>
            pushLine(format(text.combatLog.reward, { who: nameOf(event.characterId), xp: event.xp, gold: event.gold })),
          );
          break;

        case "levelUp":
          delay += PACING.levelUp;
          at(when, () =>
            pushLine(format(text.combatLog.levelUp, { who: nameOf(event.characterId), level: event.newLevel }), "levelup"),
          );
          break;

        case "outcome": {
          delay += PACING.outcome;
          const won = event.outcome === "victory";
          at(when, () => {
            pushLine(won ? text.combatLog.victory : text.combatLog.defeat, "outcome");
            setPlayback((p) => {
              // Survivors take a victory pose; the fallen stay down.
              const poses = { ...p.poses };
              if (won) {
                for (const c of p.combatants) {
                  if (c.side === "party" && !p.downed[c.id]) poses[c.id] = "victory";
                }
              }
              return { ...p, outcome: event.outcome, poses };
            });
          });
          break;
        }
      }
    }

    at(delay, () => setPlayback((p) => ({ ...p, isReplaying: false })));

    // No cleanup returned on purpose — see the note at the top of this
    // effect. React runs an effect's cleanup before every re-run, so
    // cancelling timers here would kill the running replay on any incoming
    // message. Teardown happens in the unmount-only effect above.
    // Intentionally keyed on updateSeq alone — a fresh combat result is what
    // should restart the replay, not incidental re-renders between updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateSeq]);

  return playback;
}
