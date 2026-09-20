import type { GearSlot } from "../engine/types.js";

/**
 * How a character is drawn: a stack of sprites on one fixed canvas, each
 * placed by a stored offset and composited back-to-front by z-index.
 *
 * This replaces the generated-art model. The art now comes from the hand-made
 * sheets in art/New Assets, sliced by scripts/slice-sheets.py — and those
 * sprites are drawn as ISOLATED OBJECTS, not pre-aligned to a body. A helmet is
 * a helmet on a transparent field; nothing about the file says where a head is.
 *
 * That is the whole reason placements exist. Every sprite carries an (x, y)
 * offset and a scale, per body type, stored in content/placements.json and
 * edited in the admin screen (web/src/admin). The art pipeline produces the
 * pictures; the placement data says where they go. Neither can be derived from
 * the other, which is why the coordinates are content rather than code.
 */

/**
 * Square canvas every layer is composited on, in px.
 *
 * 512, because the source art is big: the male body sprite is 257x429 and an
 * off-hand torch is 325x539. A smaller canvas would force the art to be
 * downscaled before it was even positioned; keeping the canvas above the art
 * means placement happens at native resolution and only the FINAL composite is
 * scaled to whatever surface draws it.
 *
 * Display sizes are clean power-of-two fractions so the pixel grid survives:
 * the overlay draws at 128 (1/4), the loadout doll at 256 (1/2), and the admin
 * screen at 512 (1:1), because that is the one place single pixels matter.
 */
export const CANVAS = 512;

/** Feet stand here. Body sprites are bottom-aligned to this line. */
export const BASELINE_Y = 470;

/** Horizontal centre of the frame. Body sprites are centred on it. */
export const CENTRE_X = 256;

/**
 * Draw order, back to front. Gapped by 10 so a slot can be inserted later
 * without renumbering.
 */
export const BODY_Z = 0;

export const SLOT_Z: Record<GearSlot, number> = {
  back: -10,
  bottom: 30,
  top: 50,
  face: 85,
  head: 90,
  offHand: 100,
  mainHand: 110,
};

/** Hair is appearance rather than gear, but it still needs a z-index. */
export const HAIR_Z = 80;

/**
 * The character's own fist, re-drawn OVER a held weapon.
 *
 * Above mainHand (110) on purpose. A weapon drawn over the body looks presented
 * rather than gripped; drawn under it, it vanishes behind the arm. The truth is
 * in between — the haft passes behind the fingers and in front of the palm — so
 * the fist is cut out of the body art (scripts/extract-hands.py) and put back
 * on top, sandwiching the weapon.
 */
export const HAND_Z = 120;

/** Slots in the order they should be drawn. */
export const DRAW_ORDER: GearSlot[] = (Object.keys(SLOT_Z) as GearSlot[]).sort(
  (a, b) => SLOT_Z[a] - SLOT_Z[b],
);

/**
 * Equipping a helmet hides the character's hair.
 *
 * Every head sprite in the set is a closed helm, hood or hat that a full head
 * of hair cannot sit inside — the art has no cut-away for it — so drawing both
 * puts hair through steel. The base bodies are bald for exactly this reason:
 * hair is an overlay, and a helmet simply suppresses it.
 */
export const HIDES_HAIR: GearSlot = "head";

/**
 * Where one sprite sits on the canvas.
 *
 * `x`/`y` are the sprite's CENTRE in canvas pixels, and `scale`/`rotation` are
 * applied about that same centre. All three are therefore independent: changing
 * the angle or the size does not move the item, so a placement can be tuned one
 * control at a time.
 *
 * It used to be the top-left corner, which worked only while scaling was also
 * corner-anchored. Rotating about a corner swings the art clear of where it was
 * put, so every nudge of the angle would have needed the position re-found.
 *
 * Stored per body type because the two bodies are different sizes (male
 * 257x429, female 237x389) — a breastplate centred on the male torso sits too
 * low and too wide on the female one.
 */
export interface Placement {
  x: number;
  y: number;
  scale: number;
  /** Degrees clockwise. Optional so existing placement data stays valid. */
  rotation?: number;
  /**
   * Draw order override for this one sprite, replacing its slot's default.
   *
   * Slot z-order (SLOT_Z) is right for the general case — a helmet is above a
   * face, a weapon is above a body — but not for every item. A hood should sit
   * behind hair that a helmet would cover; a backpack strap belongs over a
   * chest piece rather than under it. Those are properties of the individual
   * ARTWORK, not of the slot, so the override lives beside the sprite's other
   * drawing data rather than in the slot table.
   *
   * Absent means "use the slot's default", which is what almost everything
   * should do.
   */
  z?: number;
  /**
   * Regions of the BODY to hide while this item is worn, in canvas pixels.
   *
   * Layering alone cannot make boots read as boots: the art is drawn as a boot,
   * not as a boot-shaped hole, so the character's bare foot stays visible
   * underneath and the two fight. Real layered-character systems solve this by
   * letting an item suppress the body part it replaces, and that is what this
   * is — the boot becomes the foot.
   *
   * Rectangles rather than per-pixel masks on purpose. A rectangle can be drawn
   * by dragging in the admin screen and stored as four numbers; a pixel mask
   * would need its own art file per item per body, which is the cost this whole
   * system exists to avoid.
   */
  bodyMask?: MaskRect[];
  /**
   * Regions of the HAIR to hide while this item is worn, in canvas pixels.
   *
   * The counterpart to bodyMask, and the escape hatch from HIDES_HAIR. A head
   * item suppresses hair entirely by default because the helms in this set are
   * closed and hair would grow through steel — but that is far too blunt for an
   * open helm, a circlet or a hood, where the right answer is that the SKULL is
   * covered and the length still hangs out the back. A face mask has the same
   * problem in miniature: it should cut a fringe, not shave the head.
   *
   * Authoring one is therefore also the item saying "I handle hair myself":
   * a head item carrying a hairMask stops suppressing hair and carves it
   * instead. Items with no mask keep the old all-or-nothing behaviour, so
   * nothing already placed changes.
   *
   * Lives on the COVERING item rather than on the hair, for the same reason
   * bodyMask does — one helmet cutting the same shape out of forty hairstyles
   * is one rectangle, whereas the reverse is forty.
   */
  hairMask?: MaskRect[];
  /**
   * How much hair a head item removes.
   *
   * Two modes, because head art divides cleanly in two and the difference is
   * not a matter of degree:
   *
   *  - `skull` (the default) hides hair anywhere inside the sprite's own
   *    RECTANGLE. A bucket helm, a bascinet, a full hood: the head is inside
   *    it, so nothing should show beside or above it and only hair falling
   *    below the rim escapes. Cutting to the alpha instead leaves hair in the
   *    empty corners of the silhouette — measured on the Crusader Helm, a
   *    hairstyle whose box was 176..304 against the helm's 175..305 still
   *    flared out at the temples, because a bucket does not fill its own box.
   *  - `outline` hides hair only where the sprite is actually opaque. Right for
   *    anything worn ON the head rather than over it — a circlet, a headband, a
   *    hat perched on top — where hair is supposed to surround it.
   *
   *  - `hide` (the DEFAULT) removes hair completely. Blunt, and right far more
   *    often than the other two: most of this set is closed helms, and a
   *    hairstyle that survives one of them reads as a separate blob stuck to
   *    the side of the head rather than as hair. When in doubt this is the
   *    setting that never looks broken.
   *
   * The two carving modes are derived from the art, so neither needs a
   * coordinate — but they are opt-in, because "looks right" is a judgement
   * about a specific drawing that no rule can make.
   */
  hairCoverage?: "hide" | "skull" | "outline";
}

/** An axis-aligned region of the canvas, in canvas pixels. */
export interface MaskRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * placements.json: slot -> spriteId -> bodyType -> placement.
 *
 * A sprite with no entry falls back to DEFAULT_PLACEMENT, which drops it at the
 * canvas origin at 1:1. That is deliberately wrong-looking rather than
 * invisible: an unplaced item should be obvious in the admin screen, not
 * silently missing from the character.
 */
export interface PlacementFile {
  [slot: string]: {
    [spriteId: string]: {
      male?: Placement;
      female?: Placement;
    };
  };
}

export const DEFAULT_PLACEMENT: Placement = { x: 0, y: 0, scale: 1, rotation: 0 };

/**
 * The motions a figure can play. Whole-sprite transforms, not per-limb
 * rotation — see theme.css for what each one does.
 */
export type Motion = "idle" | "attack" | "hit" | "victory" | "defeated";
