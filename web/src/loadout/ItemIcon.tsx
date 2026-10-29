import { useState } from "react";
import type { BodyType, GearDefinition, GearSlot } from "../../../src/engine/types.js";
import type { IconFraming } from "../../../src/character/layers.js";
import { SLOT_FOLDER, iconFramingFor, originalSpriteUrl, spriteForLook } from "../sprites.js";
import { SlotIcon } from "./SlotIcon.js";

export interface ItemIconProps {
  /** The item's definition, from the content catalogue. */
  def: GearDefinition | undefined;
  /** A transmog look: draw this item's picture instead of `def`'s (same slot). */
  look?: GearDefinition;
  /** Drawn if the item has no art. */
  slot: GearSlot;
  /** Which body's cut of the art to show, for gear that has two. */
  bodyType: BodyType;
  size?: number;
  alt?: string;
  /** Overrides the stored framing; the admin previews unsaved edits with it. */
  framing?: IconFraming | null;
}

/**
 * A gear item's icon: the same sliced sprite it wears on the character.
 *
 * There is no separate icon set. There used to be — a generated art/items/
 * folder keyed by gear id — and it broke the moment the catalogue was rebuilt
 * from the new sprite sheets: 119 items, 22 stale icons, and every inventory
 * tile 404ing to a slot glyph. A second set of pictures of the same objects is
 * a second thing to keep in sync, and this one had already fallen out of sync
 * before anyone looked at it.
 *
 * Showing the worn sprite is also just better: what you see in the bag is
 * exactly what appears on the character.
 *
 * It shows the ORIGINAL drawing, not the erased copy. An erase carves a helm
 * hollow so it sits over a head: right on the doll, broken in a 38px bag cell.
 * It can also be zoomed and nudged per item (placements.json, `icon`). The box
 * is fixed-size with overflow hidden and the image transforms inside it, so the
 * transform never changes layout and a zoomed image cannot spill from its cell.
 *
 * Contain-fit rather than fixed dimensions, because the source art ranges from
 * a 175px face mark to a 539px torch and a square icon would squash most of it.
 */
export function ItemIcon({ def, look, slot, bodyType, size = 40, alt, framing }: ItemIconProps): JSX.Element {
  const [missing, setMissing] = useState(false);

  const folder = SLOT_FOLDER[slot];
  const sprite = spriteForLook(def, look, bodyType);

  if (missing || !folder || !sprite) return <SlotIcon slot={slot} size={size} />;

  const f = framing !== undefined ? framing : iconFramingFor(slot, sprite);
  const transform = f ? `translate(${f.x * 100}%, ${f.y * 100}%) scale(${f.zoom})` : undefined;

  return (
    <span className="item-icon" style={{ width: size, height: size, overflow: "hidden" }}>
      <img
        src={originalSpriteUrl(folder, sprite)}
        style={{ width: "100%", height: "100%", objectFit: "contain", transform, transformOrigin: "center" }}
        alt={alt ?? ""}
        onError={() => setMissing(true)}
        draggable={false}
      />
    </span>
  );
}
