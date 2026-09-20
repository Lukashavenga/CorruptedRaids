/**
 * How a line-up of combatants packs into its half of the stage.
 *
 * A party has no size cap by design (AGENTS.md §2.4 — the join window is the
 * only gate), so this has to look right at 1 and still be legible at 25+.
 * Two levers, applied in order:
 *
 *  1. **Overlap.** Figures slide over each other so a crowd occupies the same
 *     width as a small group, like a rank of troops seen from the side.
 *  2. **Overflow cap.** Past a point, overlapping further leaves slivers
 *     nobody can read, so the remainder collapses into a "+N" chip instead.
 *     Not everyone has to be on screen — the combat log names whoever acts.
 *
 * Name plates are dropped once figures overlap past `DENSE_OVERLAP_PX`,
 * because at that spacing adjacent names collide into each other and the
 * result is less readable than no names at all.
 */

/** Width of one figure column, in px. Must match `.figure` in theme.css. */
// 100 = the 200px canvas drawn at 0.5x. The figure inside it is now ~56% of
// the canvas wide (it was 22% when this was 88), so the cell has to match the
// art or neighbours clip into each other before the overlap logic gets a say.
export const FIGURE_WIDTH = 100;

// Derived from the fixed stage rather than hardcoded, so the two cannot drift.
import { SIDE_WIDTH } from "./stage.js";

/**
 * Never overlap so far that less than this much of a figure stays visible.
 *
 * 22 rather than 30: on a 450px stage each side gets ~208px, and at 30 only
 * four figures could ever fit before the overflow chip took over. 22 still
 * leaves a head, a shoulder and the role badge showing, which is enough to
 * count bodies at a glance.
 */
const MIN_VISIBLE_PX = 22;

/**
 * Above this overlap, name plates are hidden.
 *
 * Tuned down from a looser value after seeing seven enemies on screen: at
 * ~30px overlap each name gets so narrow that neighbouring plates read as
 * one run-on string ("WarrenWarren Archer"). Past this point no name is
 * clearer than a clipped one — the combat log still names everyone who acts.
 */
const DENSE_OVERLAP_PX = 26;

/**
 * Hard cap on rendered figures; the rest become a "+N" chip.
 *
 * 6, down from 14. The figures are now half the stage's width between them,
 * and the point of the small canvas is that a few large readable characters
 * beat a smear of unreadable ones. The log names whoever actually acts, and
 * the chip carries the true headcount.
 */
const MAX_RENDERED = 6;

/** A small baseline overlap so even a few figures read as a grouped party. */
const BASE_OVERLAP_PX = 18;

/** HP bar width when there's room for it, and the floor when packed tight. */
const FULL_BAR_PX = 62;
const MIN_BAR_PX = 16;

export interface LineupLayout {
  /** How many figures to actually render. */
  visible: number;
  /**
   * How many are not rendered. No longer drawn as a per-side "+N" chip: at six
   * figures the overlap is already at its floor, so a chip could only be fitted
   * by dropping to three visible characters. The banner carries the real party
   * count instead, which says the same thing once rather than twice.
   */
  overflow: number;
  /** Negative margin applied between figures, in px. */
  overlap: number;
  /** True when figures are packed tightly enough that name plates should be hidden. */
  dense: boolean;
  /**
   * Width the floating HP bar should render at, in px. Must not exceed the
   * visible slice of an overlapped figure — a fixed-width bar on overlapping
   * figures merges into one continuous strip across the whole line-up, which
   * reads as a single health bar rather than one per character.
   */
  barWidth: number;
  /**
   * Width the name plate gets. Same reasoning as barWidth: a name laid out
   * to the full column width spills across the neighbour it's overlapping,
   * so names collide long before the figures do.
   */
  nameWidth: number;
}

/**
 * @param sideWidth How wide the rank's column actually is. Defaults to half
 * the stage, which is what it gets when nothing stands beside it — pass the
 * narrower figure when the roster does, or the rank packs for a column it no
 * longer has and spills out of the one it does.
 */
export function layoutLineup(count: number, sideWidth: number = SIDE_WIDTH): LineupLayout {
  if (count <= 0)
    return { visible: 0, overflow: 0, overlap: 0, dense: false, barWidth: FULL_BAR_PX, nameWidth: FIGURE_WIDTH };

  // How many can actually stand in this column at the tightest spacing
  // allowed. MAX_RENDERED is a taste cap; this is a physical one, and without
  // it a rank asked to fit six figures into a column that holds two simply
  // overflowed it — the overlap is clamped at MIN_VISIBLE_PX and then stops
  // helping. It only bites once something else is sharing the width.
  const fits = Math.max(1, Math.floor((sideWidth - FIGURE_WIDTH) / MIN_VISIBLE_PX) + 1);
  const visible = Math.min(count, MAX_RENDERED, fits);
  const overflow = count - visible;

  if (visible === 1)
    return { visible, overflow, overlap: 0, dense: false, barWidth: FULL_BAR_PX, nameWidth: FIGURE_WIDTH };

  // Width if we only applied the baseline overlap.
  const spacing = FIGURE_WIDTH - BASE_OVERLAP_PX;
  const naturalWidth = FIGURE_WIDTH + (visible - 1) * spacing;

  let overlap = BASE_OVERLAP_PX;
  if (naturalWidth > sideWidth) {
    // Squeeze until the row fits, but never past MIN_VISIBLE_PX per figure.
    const needed = FIGURE_WIDTH - (sideWidth - FIGURE_WIDTH) / (visible - 1);
    overlap = Math.min(FIGURE_WIDTH - MIN_VISIBLE_PX, Math.max(BASE_OVERLAP_PX, needed));
  }

  const rounded = Math.round(overlap);
  // Each bar has to fit inside the part of its figure that isn't covered by
  // the next one, minus a hairline gap so adjacent bars stay distinct.
  const barWidth = Math.max(MIN_BAR_PX, Math.min(FULL_BAR_PX, FIGURE_WIDTH - rounded - 3));
  // -6 so adjacent plates keep a gutter instead of touching edge to edge.
  const nameWidth = Math.max(MIN_BAR_PX, FIGURE_WIDTH - rounded - 6);
  return { visible, overflow, overlap: rounded, dense: rounded > DENSE_OVERLAP_PX, barWidth, nameWidth };
}
