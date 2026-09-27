/**
 * How much stronger one enemy is than the rest of its squad.
 *
 * Named steps rather than a slider, because the question an author has is
 * "is this one a regular or the boss?", not "is this one 3.4 or 3.7?". And the
 * steps double, so each one means the same thing: twice the one before.
 *
 * WHAT A STEP MEANS, stated plainly because the obvious reading is wrong: a
 * Boss is worth eight regulars, and it gets there with eight times the health
 * and eight times the turns - NOT eight times the damage per hit. Multiplying
 * the hit was measured and produced a body a party beat 99% of the time where
 * eight regulars won 48%, because one huge hit mostly overkills one player.
 * See EnemyUnit.strength in src/engine/types.ts.
 */
export const STRENGTH_TIERS: readonly { label: string; value: number }[] = [
  { label: "Minion", value: 0.5 },
  { label: "Regular", value: 1 },
  { label: "Elite", value: 2 },
  { label: "Champion", value: 4 },
  { label: "Boss", value: 8 },
];

/** The tier a strength falls in, or "×N" for a value authored outside the steps. */
export function strengthLabel(value: number | undefined): string {
  const v = value ?? 1;
  const tier = STRENGTH_TIERS.find((t) => Math.abs(t.value - v) < 1e-6);
  return tier ? tier.label : `×${Number(v.toFixed(2))}`;
}

/** What a step is worth, in the one unit anybody can picture. */
function worth(value: number): string {
  if (value === 1) return "An ordinary body.";
  if (value < 1) return "Half an ordinary body: half the health, half the turns.";
  return `Worth ${value} ordinary bodies: ${value}× the health and ${value}× the turns, each hit the same as a regular's.`;
}

export function StrengthPicker({
  value,
  onChange,
}: {
  value: number | undefined;
  /** Undefined for Regular, so a plain body stays plain in the JSON. */
  onChange: (next: number | undefined) => void;
}): JSX.Element {
  const current = value ?? 1;
  return (
    <div className="strength">
      <span className="strength-label">Strength</span>
      <div className="strength-tiers">
        {STRENGTH_TIERS.map((t) => (
          <button
            key={t.label}
            type="button"
            className={Math.abs(t.value - current) < 1e-6 ? "is-active" : ""}
            onClick={() => onChange(t.value === 1 ? undefined : t.value)}
            title={worth(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="admin-hint">{worth(current)}</p>
    </div>
  );
}

/** A small tag in the squad list for anything other than a Regular. */
export function StrengthBadge({ value }: { value: number | undefined }): JSX.Element | null {
  if (value === undefined || value === 1) return null;
  return (
    <span className={`strength-badge ${value > 1 ? "is-strong" : "is-weak"}`} title={worth(value)}>
      {strengthLabel(value)}
    </span>
  );
}
