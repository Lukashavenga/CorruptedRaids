import type { GearSlot } from "../../../src/engine/types.js";
import { text } from "../../../src/text/index.js";

export interface SlotIconProps {
  slot: GearSlot;
  size?: number;
}

/**
 * Which drawn tile stands for which slot.
 *
 * The mapping lives here rather than in the slicer because it is a GAME fact,
 * not an art one: the sheet draws a glove, a boot and a ring this catalogue has
 * no slot for, and a slot list that changes should not mean re-cutting art.
 * See scripts/slice-ui.py.
 *
 * `top` has no tile — the artist drew nine and we wear seven, but not the same
 * seven — so it falls back to the mark below. That is the honest gap;
 * recolouring somebody else's glyph would be worse than one icon in a
 * different hand.
 */
const TILE: Partial<Record<GearSlot, string>> = {
  head: "helm",
  face: "mask",
  mainHand: "sword",
  offHand: "dagger",
  back: "cloak",
  bottom: "pants",
};

/**
 * The drawn tile for a slot, or null if the sheet has none.
 *
 * A tile is a complete socket — the cell frame with its mark already sitting
 * in it — so an empty socket IS this picture rather than a box with a picture
 * inside it. `cell.png` is the same cell drawn empty, which is what a filled
 * socket wears under its item. That is why nothing here extracts a mark: the
 * two states are the same drawn object either way.
 */
export function slotTileUrl(slot: GearSlot): string | null {
  const tile = TILE[slot];
  return tile ? `/art/ui/tile-${tile}.png` : null;
}

/**
 * The mark for a slot the sheet does not draw. Currently `top` alone.
 *
 * Drawn in the tiles' own bronze so it sits in the same row as them without
 * pretending to be one of them.
 */
export function SlotIcon({ slot, size = 30 }: SlotIconProps): JSX.Element {
  return (
    <svg
      className={`slot-icon slot-icon-${slot}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={text.gear.slot[slot]}
    >
      <title>{text.gear.slot[slot]}</title>
      {/* A tunic with shoulders. */}
      <g fill="#9a7a4e" stroke="rgba(0,0,0,0.5)" strokeWidth="1" strokeLinejoin="round">
        <path d="M9 3 L12 5 L15 3 L20 5.4 L18.4 10 L16.4 9.2V21H7.6V9.2L5.6 10 L4 5.4Z" />
      </g>
    </svg>
  );
}
