import type { Role } from "../../src/engine/types.js";

/**
 * The role icon sprite sheet (art/Roles.png, copied into web/public/art/).
 *
 * A 4x4 grid of 64x64 cells, 256x256 overall.
 *
 *   Columns: Tank | Healer | DPS | (unassigned)
 *   Rows:    detail | combat | dead | missing
 *
 * The fourth column is NOT a role — it holds a "ROLES" header badge, two
 * combination glyphs and a "REQ!" banner, which look like they belong to a
 * legend or a requirements panel. Nothing consumes it yet; it's left out of
 * the mapping deliberately rather than guessed at.
 *
 * Row 0 (`detail`) is the ornate version, reserved for the character
 * creation screen when that exists. It is defined here so the sheet's layout
 * is documented in one place, but nothing renders it today.
 */
export const ROLE_SHEET_URL = "/art/Roles.png";

/** Grid dimensions of the sheet, in cells. */
export const SHEET_COLUMNS = 4;
export const SHEET_ROWS = 4;

/** Native size of one cell, in px — the size real art is authored at. */
export const CELL_SIZE = 64;

/** Which column each role occupies. */
export const ROLE_COLUMN: Record<Role, number> = {
  tank: 0,
  healer: 1,
  dps: 2,
};

/**
 * Which row to draw, by what the icon is currently saying:
 *
 *  - `detail`  — ornate; character creation (not used yet)
 *  - `combat`  — the default badge above a living character's head
 *  - `dead`    — every member of that role is down
 *  - `missing` — nobody has taken that role yet, during the join window
 */
export type RoleIconVariant = "detail" | "combat" | "dead" | "missing";

export const VARIANT_ROW: Record<RoleIconVariant, number> = {
  detail: 0,
  combat: 1,
  dead: 2,
  missing: 3,
};

/**
 * CSS for rendering one cell of the sheet at `size` px.
 *
 * Uses percentage `background-position`, which for a sprite sheet is
 * measured against the *remaining* space rather than the raw offset — hence
 * dividing by (count - 1), not count. Getting that wrong shifts every cell
 * except the first, and the drift is easy to miss on a grid this small.
 */
export function roleSpriteStyle(role: Role, variant: RoleIconVariant, size: number): Record<string, string> {
  const col = ROLE_COLUMN[role];
  const row = VARIANT_ROW[variant];
  return {
    width: `${size}px`,
    height: `${size}px`,
    backgroundImage: `url(${ROLE_SHEET_URL})`,
    backgroundSize: `${SHEET_COLUMNS * 100}% ${SHEET_ROWS * 100}%`,
    backgroundPosition: `${(col * 100) / (SHEET_COLUMNS - 1)}% ${(row * 100) / (SHEET_ROWS - 1)}%`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
}
