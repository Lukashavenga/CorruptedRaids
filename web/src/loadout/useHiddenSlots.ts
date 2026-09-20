import { useCallback, useEffect, useState } from "react";
import type { GearSlot } from "../../../src/engine/types.js";

/**
 * Which equipped slots the player has chosen not to see.
 *
 * Cosmetic only: the item stays equipped and its stats still count. Players
 * want a helmet's armour without losing the face they picked, so this is a view
 * toggle rather than an unequip.
 *
 * Kept in the browser rather than on the character on purpose. It changes
 * nothing the engine simulates, it is per-viewer taste rather than game state,
 * and routing it through a GameCommand would mean the combat resolver's inputs
 * could differ based on a display preference — which is exactly the coupling
 * the command seam exists to prevent.
 *
 * Every read and write is guarded: storage throws outright in some privacy
 * modes, and a character should still render if it does.
 */
const KEY = "corrupted.hiddenSlots";

function load(viewerId: string): GearSlot[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const mine = all?.[viewerId];
    return Array.isArray(mine) ? (mine as GearSlot[]) : [];
  } catch {
    return [];
  }
}

export function useHiddenSlots(viewerId: string): {
  hiddenSlots: GearSlot[];
  toggleHidden: (slot: GearSlot) => void;
} {
  const [hiddenSlots, setHiddenSlots] = useState<GearSlot[]>([]);

  useEffect(() => setHiddenSlots(load(viewerId)), [viewerId]);

  const toggleHidden = useCallback(
    (slot: GearSlot) => {
      setHiddenSlots((prev) => {
        const next = prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot];
        try {
          const all = JSON.parse(localStorage.getItem(KEY) ?? "{}");
          all[viewerId] = next;
          localStorage.setItem(KEY, JSON.stringify(all));
        } catch {
          // Preference is lost on reload; the character still draws correctly.
        }
        return next;
      });
    },
    [viewerId],
  );

  return { hiddenSlots, toggleHidden };
}
