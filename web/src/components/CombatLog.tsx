import type { LogLine } from "../hooks/useCombatPlayback.js";
import { STAGE_PAD, STAGE_W } from "../stage.js";
import { useFittedFontSize } from "../hooks/useFittedFontSize.js";

/**
 * How many lines of combat text the stage shows at once.
 *
 * One. It was three at 16px, then two at 32px; now the text sits UNDER the
 * characters, where the height it takes is height the figures do not get.
 *
 * One line only works because the playback was slowed at the same time (see
 * PACING in useCombatPlayback.ts) — a single line held for the better part of a
 * second is more readable than three that scroll past faster than they can be
 * read. Making the feed slower is what let it get smaller.
 */
const VISIBLE_LINES = 1;

/**
 * The crisp sizes the display font has, biggest first. See
 * useFittedFontSize for why there is nothing between them.
 */
const LOG_SIZES = [32, 16];

/**
 * One line of combat text, at the largest crisp size it fits at.
 *
 * A log line is TWO names and a number, and both names come from content and
 * from whatever a viewer called themselves. `scripts/check-text-fits.py`
 * measures the real worst case — a ten-character viewer beside the widest
 * clamped enemy name in the catalogue — and it runs 466px against a 438px
 * stage: "PixelWitch • Woop WOOP -24" was being clipped on stream, and would
 * be by more the moment somebody authors a wider name.
 *
 * Stepping the offending line down rather than truncating it keeps the thing
 * the line exists for — who hit whom, for how much — legible. Short lines,
 * which is nearly all of them, are untouched at 32px.
 */
function LogRow({ line }: { line: LogLine }): JSX.Element {
  const size = useFittedFontSize(line.text, STAGE_W - STAGE_PAD * 2, LOG_SIZES, "CorruptedPixel");
  return (
    <li className={line.cls} style={{ fontSize: `${size}px`, lineHeight: `${size + 4}px` }}>
      {line.text}
    </li>
  );
}

/**
 * The rolling combat text.
 *
 * Oldest at the top, newest at the bottom, so the feed reads downward the way
 * chat does and the newest line is always in the same place. The previous
 * version reversed the list to put the newest first, which meant the line you
 * most wanted to read moved every time one arrived.
 */
export function CombatLog({ lines }: { lines: LogLine[] }): JSX.Element {
  const visible = lines.slice(-VISIBLE_LINES);

  return (
    <ul className="combat-log">
      {visible.map((line) => (
        <LogRow key={line.id} line={line} />
      ))}
    </ul>
  );
}
