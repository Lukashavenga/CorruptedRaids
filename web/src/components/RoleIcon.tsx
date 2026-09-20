import type { CSSProperties } from "react";
import type { Role } from "../../../src/engine/types.js";
import { text } from "../../../src/text/index.js";
import { roleSpriteStyle, type RoleIconVariant } from "../roleArt.js";

export interface RoleIconProps {
  role: Role;
  /** Which row of the sheet to draw — see roleArt.ts. Defaults to the combat badge. */
  variant?: RoleIconVariant;
  size?: number;
  className?: string;
}

/**
 * One cell of the role sprite sheet (art/Roles.png): shield for Tank, plus
 * for Healer, sword for DPS, in the variant the current state calls for.
 *
 * Rendered as a background-positioned box rather than an <img> so a single
 * request serves every icon and the cell maths stays in one place
 * (roleArt.ts).
 *
 * The default 32px is a clean half of the sheet's native 64px cell, and that
 * matters: pixel art scaled by an exact fraction stays crisp, while an
 * arbitrary size (22px, say) lands source pixels between destination pixels
 * and the detail turns to mush even with `image-rendering: pixelated`.
 */
export function RoleIcon({ role, variant = "combat", size = 32, className }: RoleIconProps): JSX.Element {
  return (
    <span
      className={`role-icon role-${role} ${className ?? ""}`}
      style={roleSpriteStyle(role, variant, size) as CSSProperties}
      role="img"
      aria-label={text.role[role]}
      title={text.role[role]}
    />
  );
}
