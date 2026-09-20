import { text, format } from "../../../src/text/index.js";

export interface RosterEntry {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  downed: boolean;
}

/**
 * How many names fit, and in how many columns.
 *
 * COLUMNS is the dial between long names and many names, and 438px is 438px:
 * two gives 217px a chip and five gives 86, which is about ten characters of
 * the 16px font and is why names are clamped to ten. Two was chosen — the
 * names are the point, and a truncated name is a name that failed at its one
 * job.
 *
 * MAX_ROWS is bounded by the stage's height, not by taste. Each row costs 19px
 * that the arena does not get, and the arena has to hold a 122px figure and a
 * 150px boss. At the 320px stage, three rows leaves it 151. A fourth would
 * leave 132 and put the boss's head through the ceiling — see STAGE_H.
 */
const COLUMNS = 2;
const MAX_ROWS = 3;
/**
 * One cell short of full, so the "+N" chip has somewhere to go.
 *
 * It is a chip like any other, and counting it as a name overflowed the grid
 * by a whole row — which, at this height, is the difference between figures
 * with heads and figures without.
 */
const MAX_NAMES = COLUMNS * MAX_ROWS - 1;

/**
 * Every viewer in the party, as a grid of names filled by their health.
 *
 * This is the "find yourself" surface. Only six or so figures fit on the stage
 * and they overlap, so a viewer who joined a 25-strong raid has no way to tell
 * whether they are in it — let alone how they are doing. A name they can scan
 * for solves that where a figure cannot.
 *
 * Health is the chip's BACKGROUND rather than a separate bar: at this size a
 * bar under each name would double the grid's height for information the fill
 * already carries, and a block of names draining from green to empty reads as a
 * party losing at a glance.
 */
export function PartyRoster({ entries }: { entries: RosterEntry[] }): JSX.Element | null {
  if (entries.length === 0) return null;

  const shown = entries.slice(0, MAX_NAMES);
  const overflow = entries.length - shown.length;

  return (
    <ul className="roster" style={{ ["--roster-cols" as string]: COLUMNS }}>
      {shown.map((e) => {
        const pct = e.maxHp > 0 ? Math.max(0, Math.min(100, (e.hp / e.maxHp) * 100)) : 0;
        return (
          <li key={e.id} className={`roster-chip ${e.downed ? "is-down" : ""}`} title={e.name}>
            {/* The fill is a sibling behind the text rather than a background
                gradient on the chip, so it can animate its width smoothly
                without the label inheriting the transition. */}
            <span className="roster-fill" style={{ width: `${pct}%` }} aria-hidden="true" />
            <span className="roster-name">{e.name}</span>
          </li>
        );
      })}
      {overflow > 0 && (
        <li className="roster-chip roster-more">
          <span className="roster-name">{format(text.dungeon.andMore, { count: overflow })}</span>
        </li>
      )}
    </ul>
  );
}
