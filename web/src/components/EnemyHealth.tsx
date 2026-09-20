import { text, format } from "../../../src/text/index.js";

export interface EnemyHealthProps {
  /** Every enemy in the encounter, alive or not. */
  units: { id: string; hp: number; maxHp: number; downed: boolean }[];
  /** Shown as the bar's label — the settlement being raided. */
  label: string;
}

/**
 * One pooled health bar for the whole enemy side.
 *
 * Per-enemy bars do not survive this stage. Five floating bars above five
 * overlapping figures at 128px are five things too small to read individually,
 * and none of them answers the question an audience actually has: are we
 * winning? Summing them does.
 *
 * The segment ticks mark each individual enemy, so the bar still shows the
 * shape of the fight — a boss draining slowly reads differently from four
 * militia dropping one after another — without asking anyone to track five
 * numbers at once.
 */
export function EnemyHealth({ units, label }: EnemyHealthProps): JSX.Element | null {
  if (units.length === 0) return null;

  const total = units.reduce((sum, u) => sum + u.maxHp, 0);
  const left = units.reduce((sum, u) => sum + Math.max(0, u.hp), 0);
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  const standing = units.filter((u) => !u.downed).length;

  return (
    <div className="enemy-health">
      <div className="enemy-health-bar">
        <div className="enemy-health-fill" style={{ width: `${pct}%` }} />
        {/* Dividers at each unit boundary. Drawn over the fill so they read as
            notches in the bar rather than as part of it. */}
        {units.slice(1).map((u, i) => (
          <span
            key={u.id}
            className="enemy-health-tick"
            style={{ left: `${((i + 1) / units.length) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <span className="enemy-health-label">
          {label} &middot; {format(text.encounter.standing, { count: standing })}
        </span>
      </div>
    </div>
  );
}
