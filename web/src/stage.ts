/**
 * The overlay's design size, in px.
 *
 * This is a FIXED canvas, not a responsive layout. The overlay ships as an OBS
 * browser source pinned into a corner of a stream, where the streamer sets the
 * source's size once and it never changes — so the honest thing is to design
 * to exact pixels and scale the whole surface, rather than to write breakpoints
 * for widths that will never occur.
 *
 * 450 wide is small enough that almost everything else follows from it: there
 * is room for a banner, a line of combat text and one rank of figures per
 * side, and nothing else. Anything that does not survive at this size does not
 * belong on the fight screen.
 *
 * THE HEIGHT WAS 250 AND IT DID NOT ADD UP.
 * -----------------------------------------
 * 250 matched the 16:9 scene art almost exactly (450x253), which is why it was
 * chosen — and the vertical budget it left was 12px short of one figure. In
 * combat the fixed furniture spends 102px (banner 34, log 36, enemy bar 20,
 * gaps 12) of 238, leaving 136 for the party roster AND the characters. A
 * figure is 122 of that. So the roster could never have more than 14px, one
 * row is 17, and the result was that at 25 viewers every figure on screen lost
 * its head by 60px — which it had been doing since the roster was written.
 *
 * 320 is what closes it. Three rows of names (55) plus a 151px arena fits a
 * 122px figure with its role badge and a 150px boss at the size the art was
 * drawn for, with room to spare. Each further roster row costs 19 more.
 *
 * WHAT IT COSTS: the backdrops are 16:9, so at 450x320 `cover` crops about
 * 21% of their width (~59px off each side). That is the trade — a scene loses
 * its edges, and the fight stops losing its heads.
 *
 * The OBS browser source has to be resized to match, once.
 */
export const STAGE_W = 450;
export const STAGE_H = 320;

/** Outer padding inside the stage. */
export const STAGE_PAD = 6;

/** Gap between the two line-ups, so they read as facing each other. */
export const ARENA_GUTTER = 18;

/** How much width one side of the arena gets, with nothing beside it. */
export const SIDE_WIDTH = Math.floor((STAGE_W - STAGE_PAD * 2 - ARENA_GUTTER) / 2);

/**
 * The party roster's column, when it is standing beside the fight.
 *
 * 188 is not a taste: it is two chips of 93px plus the gap between them, and
 * 93px is what a ten-character name needs at 16px — NAME_MAX in
 * useCombatPlayback clamps names to ten, so that is the real worst case. Any
 * narrower and the thing the column exists for starts ellipsising.
 */
export const ROSTER_WIDTH = 188;

/** Gap either side of the roster column. */
export const ROSTER_GAP = 10;

/**
 * One side of the arena when the roster is beside it.
 *
 * Exported rather than recomputed in the layout code, because `lineup.ts`
 * packs the figures against this number and CSS lays them out against it —
 * if the two disagree the rank overflows its own column, which is exactly
 * what happened when the roster first moved here and the packing still
 * assumed it had the whole half-stage.
 */
export const SIDE_WIDTH_WITH_ROSTER = Math.floor(
  (STAGE_W - STAGE_PAD * 2 - ROSTER_WIDTH - ROSTER_GAP * 2) / 2,
);
