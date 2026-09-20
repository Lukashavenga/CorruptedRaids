import type { BodyType, GearDefinition, GearSlot } from "../../src/engine/types.js";
import { DEFAULT_PLACEMENT, type Placement, type PlacementFile } from "../../src/character/layers.js";

/**
 * Which sliced-art folder each gear slot draws from.
 *
 * The folder names come from the source sheets (art/New Assets) and the slot
 * names from the engine, and the two vocabularies do not match — the sheet is
 * "chest", the slot is "top". This map is the only place that translation
 * lives.
 *
 * `back` has no art in the current set. It stays a slot because the engine and
 * the loadout doll already model it; it simply never resolves to a sprite,
 * which the renderer treats the same as an empty slot.
 */
export const SLOT_FOLDER: Partial<Record<GearSlot, string>> = {
  head: "head",
  face: "face",
  top: "chest",
  bottom: "pants",
  mainHand: "mainhand",
  offHand: "offhand",
};

export const HAIR_FOLDER = "hair";
export const HAND_FOLDER = "hand";
export const BODY_FOLDER = "body";

/**
 * Bumped whenever a sprite is edited, and appended to every sprite URL.
 *
 * Without it an edited sprite looks unchanged after saving: the file on disk is
 * correct and the server serves it, but the URL has not changed so the browser
 * answers from its own cache. Remounting the component does not help — same
 * src, same cache entry. This was the whole of "the erase is not saving".
 *
 * A module-level counter rather than per-component state because every surface
 * showing that sprite has to invalidate together, and they do not share a tree.
 */
let spriteVersion = 0;

export function bumpSpriteVersion(): number {
  spriteVersion += 1;
  return spriteVersion;
}

export function spriteUrl(folder: string, id: string): string {
  const v = spriteVersion > 0 ? `?v=${spriteVersion}` : "";
  return `/art/sprites/${folder}/${id}.png${v}`;
}

export function bodyUrl(bodyType: BodyType, skinTone: string): string {
  return spriteUrl(BODY_FOLDER, `${bodyType}-${skinTone}`);
}

/** A finished enemy sprite, addressed as "<group>/<id>". */
export function enemySpriteUrl(path: string): string {
  const v = spriteVersion > 0 ? `?v=${spriteVersion}` : "";
  return `/art/sprites/enemies/${path}.png${v}`;
}

/** The scene a fight happens in. */
export function backgroundUrl(id: string): string {
  return `/art/backgrounds/${id}.png`;
}

/** Art drawn in front of the characters, before a fight starts. */
export function foregroundUrl(id: string): string {
  return `/art/foregrounds/${id}.png`;
}

/** The fist cut from this body, drawn over a held weapon. */
export function handUrl(bodyType: BodyType, skinTone: string): string {
  return spriteUrl(HAND_FOLDER, `${bodyType}-${skinTone}`);
}

/**
 * The sprite a gear item draws with, for a given body.
 *
 * Worn gear is cut to fit, so chest and leg pieces carry `spriteByBody` and
 * pick by sex; everything else is one drawing worn by anyone. Returning null
 * rather than throwing matters: an item with no art yet should render as a
 * missing layer, not take the whole character down.
 */
export function spriteForGear(def: GearDefinition | undefined, bodyType: BodyType): string | null {
  if (!def) return null;
  if (def.spriteByBody) return def.spriteByBody[bodyType] ?? null;
  return def.sprite ?? null;
}

/** Where a sprite sits, falling back to the origin when nothing is recorded. */
export function placementFor(
  placements: PlacementFile,
  slot: string,
  spriteId: string,
  bodyType: BodyType,
): Placement {
  return placements?.[slot]?.[spriteId]?.[bodyType] ?? DEFAULT_PLACEMENT;
}
