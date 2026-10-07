import type { DoorKind } from "../../../src/engine/types.js";
import { text, format } from "../../../src/text/index.js";

export interface RoomRevealProps {
  description: string;
  kind: DoorKind;
  /** How many bodies are standing in there. Zero for a boon or an empty corridor. */
  enemyCount: number;
  /** The boon this room gave. Absent on a shrine that had nothing left. */
  buff?: { name: string; description: string } | undefined;
  /** The last room. Billed differently — nobody chose it. */
  boss: boolean;
}

/** What the room holds, in two or three words. */
function holds(kind: DoorKind, enemyCount: number, buff?: { name: string }): string {
  if (kind === "fight") return format(text.raid.roomHolds, { count: enemyCount });
  if (kind === "buff") return buff?.name ?? text.raid.roomBoonSpent;
  return text.raid.roomEmpty;
}

/**
 * The line under the headline while a door stands open on a room.
 *
 * The reveal used to be a single banner line, and only for the doors that had
 * nothing in them — a fight door went straight from three closed doors to a
 * resolved fight, so the one moment the choice paid off was the one moment
 * there was nothing to look at. Now every door opens onto a room: the banner
 * names it, its occupants stand in the arena, and this says what it holds.
 *
 * ONE LINE, in the row the party roster normally occupies. It was a card over
 * the arena, which read well and was wrong: the arena is 117px tall and a
 * figure is 108 of them, so anything laid over it covered the heads of the
 * very bodies the reveal exists to show. Borrowing an empty row costs the
 * figures nothing.
 */
export function RoomReveal({ description, kind, enemyCount, buff, boss }: RoomRevealProps): JSX.Element {
  return (
    <div className={`room-reveal kind-${kind} ${boss ? "is-boss" : ""}`}>
      <span className="room-holds">{holds(kind, enemyCount, buff)}</span>
      {/* The room's own line carries the tone; a boon's carries the mechanics,
          and wins, because "Blood in the Water" tells a viewer nothing about
          what it does. */}
      <span className="room-line">{buff?.description ?? description}</span>
    </div>
  );
}
