import { useState } from "react";
import type { BodyType, GearDefinition, GearSlot } from "../../../src/engine/types.js";
import { SLOT_FOLDER, spriteForGear, spriteUrl } from "../sprites.js";
import { SlotIcon } from "./SlotIcon.js";

export interface ItemIconProps {
  /** The item's definition, from the content catalogue. */
  def: GearDefinition | undefined;
  /** Drawn if the item has no art. */
  slot: GearSlot;
  /** Which body's cut of the art to show, for gear that has two. */
  bodyType: BodyType;
  size?: number;
  alt?: string;
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
 * Contain-fit rather than fixed dimensions, because the source art ranges from
 * a 175px face mark to a 539px torch and a square icon would squash most of it.
 */
export function ItemIcon({ def, slot, bodyType, size = 40, alt }: ItemIconProps): JSX.Element {
  const [missing, setMissing] = useState(false);

  const folder = SLOT_FOLDER[slot];
  const sprite = spriteForGear(def, bodyType);

  if (missing || !folder || !sprite) return <SlotIcon slot={slot} size={size} />;

  return (
    <img
      className="item-icon"
      src={spriteUrl(folder, sprite)}
      style={{ width: size, height: size, objectFit: "contain" }}
      alt={alt ?? ""}
      onError={() => setMissing(true)}
      draggable={false}
    />
  );
}
