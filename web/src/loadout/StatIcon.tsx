import type { AllocatableStat } from "../../../src/engine/types.js";
import { text } from "../../../src/text/index.js";

export interface StatIconProps {
  stat: AllocatableStat;
  size?: number;
}

/**
 * The four player-facing stats as drawn marks.
 *
 * Real art (art/ui/icon-*.png, cut by scripts/slice-ui.py), replacing the
 * inline SVG placeholders these were — the same promotion RoleIcon got when
 * art/Roles.png arrived.
 *
 * The sheet's marks are named for what they DEPICT, and the mapping to a game
 * concept lives here. Two of them are worth explaining:
 *
 *   skill -> the SHIELD. Skill is what reduces incoming damage now that Armour
 *            is gone, so the shield is literally correct rather than a
 *            leftover: it is the same picture doing the same job under a
 *            better name.
 *   spd   -> the STAR. Speed is how often you are drawn to act, and the star
 *            is the sheet's mark for "quick, sharp, goes first". It is also
 *            the only mark left, which is honest to say out loud.
 */
const MARK: Record<AllocatableStat, string> = {
  hp: "hp",
  atk: "atk",
  skill: "armour",
  spd: "skill",
};

export function StatIcon({ stat, size = 22 }: StatIconProps): JSX.Element {
  return (
    <img
      className={`stat-icon stat-icon-${stat}`}
      src={`/art/ui/icon-${MARK[stat]}.png`}
      // Contain-fit, not fixed dimensions: the marks are drawn to different
      // proportions (the sword is tall, the shield narrow) and squaring them
      // squashes four of the five.
      style={{ width: size, height: size, objectFit: "contain" }}
      alt=""
      title={text.stat[stat]}
      draggable={false}
    />
  );
}
