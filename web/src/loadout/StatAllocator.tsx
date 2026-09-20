import { useEffect, useRef, useState } from "react";
import { haptic } from "./haptics.js";
import { ALLOCATABLE_STATS, type AllocatableStat } from "../../../src/engine/types.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import { StatIcon } from "./StatIcon.js";
import { text, format } from "../../../src/text/index.js";

export interface StatAllocatorProps {
  character: CharacterView;
  onAllocate: (stat: AllocatableStat, amount: number) => void;
  onRespec: () => void;
  busy: boolean;
}

/**
 * The four stats as cards, each with its spend button (AGENTS.md §2.2 —
 * this is what replaced automatic stat growth).
 *
 * A card shows the effective value and, when gear is contributing, that
 * contribution separately. The split is the reason the engine returns two
 * stat blocks: without it, someone swapping gear can't tell whether a number
 * moved because of the item or because of a point they spent.
 */
export function StatAllocator({ character, onAllocate, onRespec, busy }: StatAllocatorProps): JSX.Element {
  const canSpend = character.unspentPoints > 0;

  /*
   * Points ARRIVING gets an animation; points being spent does not.
   *
   * Levelling happens while the player is watching a fight on someone else's
   * stream, so the first they see of it is a number that is silently larger
   * than last time they looked. Spending is the opposite — they pressed the
   * button, they know. Comparing against the previous render is what tells
   * those two apart, and it is why this is a ref rather than a prop.
   */
  const previous = useRef(character.unspentPoints);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const grew = character.unspentPoints > previous.current;
    previous.current = character.unspentPoints;
    if (!grew) return;
    setArrived(true);
    haptic("levelUp");
    const id = window.setTimeout(() => setArrived(false), 800);
    return () => window.clearTimeout(id);
  }, [character.unspentPoints]);

  return (
    <section className="panel" data-section="stats">
      <header className="panel-head">
        <h2>{text.loadout.statsHeading}</h2>
        <span className={`points ${canSpend ? "has-points" : ""} ${arrived ? "points-fresh" : ""}`}>
          {!canSpend
            ? text.loadout.noPoints
            : character.unspentPoints === 1
              ? text.loadout.pointAvailableOne
              : format(text.loadout.pointsAvailable, { count: character.unspentPoints })}
        </span>
      </header>

      <ul className="stat-grid">
        {ALLOCATABLE_STATS.map((stat) => {
          const base = character.baseStats[stat];
          const total = character.stats[stat];
          const fromGear = total - base;
          const spent = character.allocated[stat];
          return (
            <li key={stat} className="stat-card">
              <span className="stat-card-icon">
                <StatIcon stat={stat} />
              </span>

              <span className="stat-card-body">
                <span className="stat-card-name">{text.stat[stat]}</span>
                <span className="stat-card-value">
                  {Math.round(total)}
                  {fromGear !== 0 && (
                    <span className={`stat-gear ${fromGear > 0 ? "up" : "down"}`}>
                      {fromGear > 0 ? "+" : ""}
                      {Math.round(fromGear)}
                    </span>
                  )}
                </span>
                {spent > 0 && (
                  <span className="stat-card-spent">
                    {spent === 1 ? text.loadout.spentTotalOne : format(text.loadout.spentTotal, { count: spent })}
                  </span>
                )}
              </span>

              <button
                type="button"
                className="stat-add"
                disabled={busy || !canSpend}
                onClick={() => onAllocate(stat, 1)}
                title={format(text.loadout.perPoint, { amount: character.perPoint[stat] })}
                aria-label={`${text.stat[stat]} ${format(text.loadout.perPoint, { amount: character.perPoint[stat] })}`}
              >
                +{character.perPoint[stat]}
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="panel-foot">
        <button type="button" className="ghost small" disabled={busy || character.spentPoints === 0} onClick={onRespec}>
          {text.loadout.respec}
        </button>
      </footer>
    </section>
  );
}
