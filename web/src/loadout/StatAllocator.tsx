import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { haptic } from "./haptics.js";
import { ALLOCATABLE_STATS, type AllocatableStat } from "../../../src/engine/types.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import { StatIcon } from "./StatIcon.js";
import type { Role } from "../../../src/engine/types.js";
import type { BalanceConfig } from "../../../src/engine/balance.js";
import { text, format } from "../../../src/text/index.js";

/** Points staged locally and not yet sent, per stat. Absent means zero. */
export type StatDraft = Partial<Record<AllocatableStat, number>>;

export interface StatAllocatorProps {
  character: CharacterView;
  /**
   * The staged points. Owned by LoadoutApp, not by this component: on the
   * stacked phone layout one panel shows at a time and leaving this one
   * unmounts it, which would throw a half-built draft away.
   */
  draft: StatDraft;
  setDraft: Dispatch<SetStateAction<StatDraft>>;
  /** Sends the whole draft as one command. The draft is kept if it is refused. */
  onConfirm: () => void;
  /** Refunds committed points. Clears the draft first (LoadoutApp). */
  onRespec: () => void;
  busy: boolean;
  /** For the Skill explanation, whose half-way point is a tuned number. */
  balance: BalanceConfig;
}

export function draftTotal(draft: StatDraft): number {
  return ALLOCATABLE_STATS.reduce((sum, stat) => sum + (draft[stat] ?? 0), 0);
}

/**
 * The two stats each role wants (AGENTS.md section 6): every stat is wanted by
 * two roles and ignored by one. Read from the character's CURRENT role, so a
 * `set_role` re-marks the cards with no state of its own to go stale.
 */
const ROLE_STATS: Record<Role, readonly AllocatableStat[]> = {
  tank: ["hp", "skill"],
  healer: ["skill", "spd"],
  dps: ["atk", "spd"],
};

/** Press-and-hold timing: slow first so a tap is one point, then fast. */
const REPEAT_SLOW_MS = 150;
const REPEAT_FAST_MS = 50;
const REPEAT_RAMP_AFTER_MS = 1000;
/** Haptic ticks are throttled so a fast repeat reads as a buzz, not a stutter. */
const TICK_MIN_GAP_MS = 90;

/**
 * What a stat DOES, in the How to Play screen's words.
 *
 * Shared with that screen rather than restated, so the two cannot drift - and
 * Skill's sentence names `skillCurveK`, which is read from the balance so it
 * survives a retune.
 */
function statBlurb(stat: AllocatableStat, balance: BalanceConfig): string {
  const stats = text.loadout.howToPlay.stats;
  return stat === "skill" ? format(stats.skill, { k: String(balance.combat.skillCurveK) }) : stats[stat];
}

/**
 * The four stats as cards, each with its staging buttons (AGENTS.md §2.2 —
 * this is what replaced automatic stat growth).
 *
 * Tapping stages points in a local draft - no request, no lock - and one
 * Confirm sends the lot as a single atomic `allocate_many`.
 *
 * A card shows the effective value and, when gear is contributing, that
 * contribution separately. The split is the reason the engine returns two
 * stat blocks: without it, someone swapping gear can't tell whether a number
 * moved because of the item or because of a point they spent.
 */
export function StatAllocator({
  character,
  draft,
  setDraft,
  onConfirm,
  onRespec,
  busy,
  balance,
}: StatAllocatorProps): JSX.Element {
  const staged = draftTotal(draft);
  const left = Math.max(0, character.unspentPoints - staged);
  const canSpend = character.unspentPoints > 0;
  /*
   * Which card has its explanation open.
   *
   * A tap, not a hover. The card used to answer a hover with the stat's NAME -
   * which is already printed beside it - and a phone cannot hover at all, so
   * half the players had no way to find out what Skill does short of the How
   * to Play page. The explanation is on the card's `title` too, for a mouse.
   */
  const [open, setOpen] = useState<AllocatableStat | null>(null);

  /*
   * Points ARRIVING gets an animation; points being spent does not.
   *
   * Levelling happens while the player is watching a fight on someone else's
   * stream, so the first they see of it is a number that is silently larger
   * than last time they looked. Spending is the opposite — they pressed the
   * button, they know. Comparing against the previous render is what tells
   * those two apart, and it is why this is a ref rather than a prop.
   */
  const previous = useRef(character.unspentPoints);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const grew = character.unspentPoints > previous.current;
    previous.current = character.unspentPoints;
    if (!grew) return;
    setArrived(true);
    haptic("levelUp");
    const id = window.setTimeout(() => setArrived(false), 800);
    return () => window.clearTimeout(id);
  }, [character.unspentPoints]);

  /*
   * The repeat loop reads `left` through a ref: its timers outlive the render
   * that started them, and a closed-over count would keep adding past zero.
   * The draft itself goes through the functional setter for the same reason.
   */
  const leftRef = useRef(left);
  leftRef.current = left;
  const holdTimer = useRef<number | null>(null);
  const lastTick = useRef(0);

  const stage = useCallback(
    (stat: AllocatableStat, want: number): boolean => {
      const add = Math.min(want, leftRef.current);
      if (add <= 0) return false;
      // Keep the ref in step now: a hold can fire twice before React re-renders.
      leftRef.current -= add;
      setDraft((d) => ({ ...d, [stat]: (d[stat] ?? 0) + add }));
      const now = Date.now();
      if (now - lastTick.current >= TICK_MIN_GAP_MS) {
        lastTick.current = now;
        haptic("tap");
      }
      return true;
    },
    [setDraft],
  );

  const unstage = useCallback(
    (stat: AllocatableStat) => {
      setDraft((d) => {
        const have = d[stat] ?? 0;
        if (have <= 0) return d;
        const next = { ...d };
        if (have === 1) delete next[stat];
        else next[stat] = have - 1;
        return next;
      });
      haptic("tap");
    },
    [setDraft],
  );

  const stopHold = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);
  useEffect(() => stopHold, [stopHold]);

  const startHold = (stat: AllocatableStat) => {
    stopHold();
    if (!stage(stat, 1)) return;
    const startedAt = Date.now();
    const tick = () => {
      if (!stage(stat, 1)) {
        stopHold();
        return;
      }
      const delay = Date.now() - startedAt > REPEAT_RAMP_AFTER_MS ? REPEAT_FAST_MS : REPEAT_SLOW_MS;
      holdTimer.current = window.setTimeout(tick, delay);
    };
    holdTimer.current = window.setTimeout(tick, REPEAT_SLOW_MS);
  };

  const headline = !canSpend
    ? text.loadout.noPoints
    : staged > 0
      ? format(text.loadout.pointsLeftStaged, { left, staged })
      : left === 1
        ? text.loadout.pointLeftOne
        : format(text.loadout.pointsLeft, { count: left });

  return (
    <section className="panel" data-section="stats">
      <header className="panel-head">
        <h2>{text.loadout.statsHeading}</h2>
        <span
          className={`points ${canSpend ? "has-points" : ""} ${arrived ? "points-fresh" : ""}`}
          aria-live="polite"
        >
          {headline}
        </span>
      </header>

      <p className="role-stats-line">{text.loadout.roleStatsLine[character.role]}</p>

      <ul className="stat-grid">
        {ALLOCATABLE_STATS.map((stat) => {
          const base = character.baseStats[stat];
          const total = character.stats[stat];
          const fromGear = total - base;
          const spent = character.allocated[stat];
          const pending = draft[stat] ?? 0;
          const gain = character.perPoint[stat];
          /*
           * The preview is `stat + perPoint x staged` and nothing cleverer, on
           * purpose. `character.stats` is the engine's deriveCharacterStats, and
           * the allocation enters it only through statsFromAllocation
           * (allocated x perPoint), so this is the same sum the server will do.
           * A healer's Skill->speed bonus (roles.healer.spdPerSkill) is applied
           * by the combat resolver, not here, so the displayed Speed does not
           * include it before OR after and the preview stays honest without it.
           * Known gap: if gear has pushed a stat under clampStats' floor the
           * floored number is all we are given, so a preview there can read
           * high. No shipped item gets near it.
           */
          const after = total + gain * pending;
          const stepLabel = (n: number) => `${text.stat[stat]} ${format(text.loadout.stageAria, { count: n })}`;
          const five = Math.min(5, left);
          const key = ROLE_STATS[character.role].includes(stat);
          return (
            <li key={stat} className={`stat-card ${key ? "is-key" : ""} ${open === stat ? "is-open" : ""} ${pending > 0 ? "has-pending" : ""}`}>
              <button
                type="button"
                className="stat-card-about"
                aria-expanded={open === stat}
                title={statBlurb(stat, balance)}
                onClick={() => setOpen((current) => (current === stat ? null : stat))}
              >
                <span className="stat-card-icon">
                  <StatIcon stat={stat} />
                </span>

                <span className="stat-card-body">
                  <span className="stat-card-name">
                    {text.stat[stat]}
                    {key && <span className="stat-card-key">{text.loadout.roleStatsMark}</span>}
                    <span className="stat-card-more" aria-hidden="true">
                      ?
                    </span>
                  </span>
                  <span className="stat-card-value">
                    {pending > 0 ? (
                      <>
                        {Math.round(total)}
                        <span className="stat-arrow" aria-hidden="true">
                          {" → "}
                        </span>
                        <span className="stat-pending">{Math.round(after)}</span>
                      </>
                    ) : (
                      Math.round(total)
                    )}
                    {fromGear !== 0 && (
                      <span className={`stat-gear ${fromGear > 0 ? "up" : "down"}`}>
                        {fromGear > 0 ? "+" : ""}
                        {Math.round(fromGear)}
                      </span>
                    )}
                  </span>
                  <span className="stat-card-spent">
                    {format(text.loadout.perPoint, { amount: gain })}
                    {pending > 0 && <> · {format(text.loadout.pending, { count: pending })}</>}
                    {pending === 0 && spent > 0 && (
                      <> · {spent === 1 ? text.loadout.spentTotalOne : format(text.loadout.spentTotal, { count: spent })}</>
                    )}
                  </span>
                </span>
              </button>

              <div className="stat-steps">
                <button
                  type="button"
                  className="stat-step stat-step-minus"
                  disabled={busy || pending === 0}
                  onClick={() => unstage(stat)}
                  aria-label={`${text.stat[stat]} ${text.loadout.unstageAria}`}
                >
                  {text.loadout.stageMinus}
                </button>
                {/* Pointer down stages and a held press repeats; `detail === 0`
                    is a keyboard "click", which pointer events never reach. */}
                <button
                  type="button"
                  className="stat-step"
                  disabled={busy || left === 0}
                  aria-label={stepLabel(1)}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    startHold(stat);
                  }}
                  onPointerUp={stopHold}
                  onPointerLeave={stopHold}
                  onPointerCancel={stopHold}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={(e) => {
                    if (e.detail === 0) stage(stat, 1);
                  }}
                >
                  {format(text.loadout.stagePlus, { count: 1 })}
                </button>
                <button
                  type="button"
                  className="stat-step"
                  disabled={busy || left === 0}
                  aria-label={stepLabel(five)}
                  onClick={() => stage(stat, 5)}
                >
                  {format(text.loadout.stagePlus, { count: left > 0 ? five : 5 })}
                </button>
              </div>

              {open === stat && (
                <p className="stat-card-info">
                  {statBlurb(stat, balance)}
                  <span className="stat-card-split">
                    {format(text.loadout.statSplit, { base: Math.round(base), gear: signed(Math.round(fromGear)) })}
                  </span>
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {staged > 0 && (
        <div className="stage-bar" role="group" aria-label={text.loadout.stageBarLabel}>
          <button type="button" className="ghost" disabled={busy} onClick={() => setDraft({})}>
            {text.loadout.stageReset}
          </button>
          <button type="button" className="stage-confirm" disabled={busy} onClick={onConfirm}>
            {staged === 1 ? text.loadout.stageConfirmOne : format(text.loadout.stageConfirm, { count: staged })}
          </button>
        </div>
      )}

      <footer className="panel-foot">
        <button
          type="button"
          className="ghost small"
          disabled={busy || (character.spentPoints === 0 && staged === 0)}
          onClick={onRespec}
        >
          {text.loadout.respec}
        </button>
      </footer>
    </section>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
