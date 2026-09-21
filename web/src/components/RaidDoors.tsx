import type { DoorKind, PathDirection } from "../../../src/engine/types.js";
import { text, format } from "../../../src/text/index.js";

export interface RaidDoorsProps {
  round: number;
  rounds: number;
  doors: { direction: PathDirection; opened: boolean; kind?: DoorKind }[];
  buffs: { id: string; name: string; description: string }[];
  bossPending: boolean;
}

/** Glyphs, not words: three doors have to read at a glance on a 450px stage. */
const FACE: Record<DoorKind, string> = {
  clear: "-",
  buff: "✦",
  fight: "⚔",
};

/**
 * The three doors, and the boons picked up so far.
 *
 * An unopened door shows nothing about what is behind it — not because the
 * component hides it, but because the server does not send it (see RaidView).
 * A choice whose answer is visible in the network tab is not a choice, and the
 * overlay is a public broadcast.
 *
 * The buff strip matters more than it looks: four rounds of accumulation is the
 * only thing distinguishing a raid from four dungeons in a row, and if the
 * audience cannot see what the party is carrying, that accumulation may as well
 * not be happening.
 */
export function RaidDoors({ round, rounds, doors, buffs, bossPending }: RaidDoorsProps): JSX.Element {
  return (
    <div className="raid">
      <div className="raid-head">
        <span className="raid-round">
          {bossPending
            ? text.raid.bossAhead
            : format(text.raid.roundLabel, { round, rounds })}
        </span>
        {buffs.length > 0 && (
          <span className="raid-buffs" title={buffs.map((b) => `${b.name} - ${b.description}`).join("\n")}>
            {buffs.map((b) => (
              <span key={b.id} className="raid-buff">
                {b.name}
              </span>
            ))}
          </span>
        )}
      </div>

      {!bossPending && (
        <div className="raid-doors">
          {doors.map((door) => (
            <div
              key={door.direction}
              className={`raid-door ${door.opened ? `is-open kind-${door.kind}` : ""}`}
            >
              <span className="raid-door-face">
                {door.opened && door.kind ? FACE[door.kind] : "?"}
              </span>
              <span className="raid-door-label">{text.raid.door[door.direction]}</span>
            </div>
          ))}
        </div>
      )}

      {!bossPending && <p className="raid-prompt">{text.raid.chooseHint}</p>}
    </div>
  );
}
