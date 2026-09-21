import { useState } from "react";
import { ROLES, type Role } from "../../../src/engine/types.js";
import type { BalanceConfig } from "../../../src/engine/balance.js";
import { RoleIcon } from "../components/RoleIcon.js";
import { RoleGuide } from "./RoleGuide.js";
import { text, format } from "../../../src/text/index.js";

export interface RolePickerProps {
  current: Role;
  onPick: (role: Role) => void;
  busy: boolean;
  /** The live tuning numbers, so the guide can quote them. */
  balance: BalanceConfig;
}

/**
 * Role selection. Per AGENTS.md §2.6 this belongs here and not on the
 * overlay — it's a personal choice, not a spectator control.
 *
 * Switching role keeps whatever points the player has already spent; only
 * the role's base spread swaps beneath them (see setRole in character.ts).
 * That's why this is a plain toggle with no confirmation: nothing is lost.
 *
 * The three cards are the sheet's own role plates — teal, violet, green — so
 * which one is chosen is legible from across a room and does not depend on
 * spotting a border that is one shade different from the other two.
 */
export function RolePicker({ current, onPick, busy, balance }: RolePickerProps): JSX.Element {
  /*
   * Which role's guide is open, which is NOT necessarily the one you are.
   *
   * Clicking a card you already play would otherwise do nothing at all, and
   * clicking one you do not play would switch you to it before you had read
   * what it does. So a click opens the explanation; the button under it
   * commits. Starts on your own role, because that is the one you most want
   * to understand.
   */
  const [reading, setReading] = useState<Role>(current);
  return (
    <section className="panel" data-section="role">
      <header className="panel-head">
        <h2>{text.loadout.roleHeading}</h2>
      </header>

      <div className="role-choices">
        {ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className={`role-choice role-is-${role} ${role === current ? "is-current" : ""} ${
              role === reading ? "is-reading" : ""
            }`}
            disabled={busy}
            onClick={() => setReading(role)}
            aria-pressed={role === current}
            aria-expanded={role === reading}
            aria-label={text.role[role]}
          >
            <RoleIcon role={role} variant="combat" size={32} />
            <span>{text.role[role]}</span>
          </button>
        ))}
      </div>

      {/* What the role you are reading about actually does, in the game's own
          current numbers. This was a one-line blurb at the foot of the page -
          "Tanks draw attacks" - which is true, unfalsifiable and no use to
          anyone deciding where to put a point. */}
      <RoleGuide role={reading} balance={balance} />

      {reading !== current && (
        <button
          type="button"
          className="role-commit"
          disabled={busy}
          onClick={() => onPick(reading)}
        >
          {format(text.loadout.becomeRole, { role: text.role[reading] })}
        </button>
      )}
    </section>
  );
}
