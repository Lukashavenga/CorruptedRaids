import { ROLES, type Role } from "../../../src/engine/types.js";
import { RoleIcon } from "./RoleIcon.js";
import type { RoleIconVariant } from "../roleArt.js";

export interface RoleCount {
  total: number;
  down: number;
}

export interface RoleRosterProps {
  counts: Record<Role, RoleCount>;
  /** True during the join window — an absent role is "not filled yet" rather than "wiped". */
  gathering: boolean;
}

/**
 * The party composition strip: one badge per role, showing whether that role
 * is present, absent, or wiped.
 *
 * This is the home for the two category-level states in the sprite sheet —
 * "every member of this role is down" and "nobody has taken this role yet".
 * Neither can be said above an individual character's head, because in both
 * cases there's no living character of that role to put a badge over.
 */
export function RoleRoster({ counts, gathering }: RoleRosterProps): JSX.Element {
  const variantFor = (role: Role): RoleIconVariant => {
    const { total, down } = counts[role];
    if (total === 0) return gathering ? "missing" : "dead";
    if (down >= total) return "dead";
    return "combat";
  };

  return (
    <div className="role-roster">
      {ROLES.map((role) => {
        const { total, down } = counts[role];
        // Outside the join window, a role nobody ever took is simply absent —
        // drawing the "wiped" badge for it would claim those characters died.
        if (total === 0 && !gathering) return null;
        const variant = variantFor(role);
        const alive = total - down;
        return (
          <span key={role} className={`role-roster-entry is-${variant}`}>
            <RoleIcon role={role} variant={variant} size={24} />
            <span className="role-roster-count">{variant === "missing" ? "0" : `${alive}/${total}`}</span>
          </span>
        );
      })}
    </div>
  );
}
