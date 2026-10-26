import { useCallback, useEffect } from "react";
import type { CharacterAppearance, GearSlot } from "../../../src/engine/types.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";

/**
 * Which equipped slots the player has chosen not to see.
 *
 * Cosmetic only: the item stays equipped and its stats still count. Players
 * want a helmet's Skill without losing the face they picked, so this is a view
 * toggle rather than an unequip.
 *
 * ON THE CHARACTER, as part of its appearance. It used to live in this
 * browser's storage, on the reasoning that it changed nothing the engine
 * simulates - which is true, and it is still nothing the resolver reads. But
 * the place a viewer wants to look like themselves is the overlay, on stream,
 * and a preference kept in one phone's storage never reached it: a tester hid
 * their helmet and wore it into every dungeon anyway.
 */
const LEGACY_KEY = "corrupted.hiddenSlots";

/** What an earlier build kept in this browser for this viewer, if anything. */
function legacyLocal(viewerId: string): GearSlot[] {
  try {
    const mine = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}")?.[viewerId];
    return Array.isArray(mine) ? (mine as GearSlot[]) : [];
  } catch {
    return [];
  }
}

function forgetLegacy(viewerId: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}");
    delete all[viewerId];
    localStorage.setItem(LEGACY_KEY, JSON.stringify(all));
  } catch {
    // Nothing to forget, or storage refuses; either way the character holds it now.
  }
}

export function useHiddenSlots(
  character: CharacterView | null,
  /** Sends `set_appearance`; resolves to whether the server took it. */
  save: (appearance: CharacterAppearance) => Promise<boolean>,
): {
  hiddenSlots: GearSlot[];
  toggleHidden: (slot: GearSlot) => void;
} {
  const hiddenSlots = character?.appearance.hiddenSlots ?? [];

  /*
   * Carries a choice made under the old build across, once.
   *
   * Only for a character that has been through creation - `set_appearance` is
   * what marks a look as chosen, and sending it from here must not skip
   * somebody past that screen. The local copy is dropped only once the server
   * has it, so a refusal (mid-run, say) is tried again on the next visit.
   */
  const id = character?.id;
  const chosen = character?.appearanceChosen === true;
  const hasStored = (character?.appearance.hiddenSlots?.length ?? 0) > 0;
  useEffect(() => {
    if (!id || !chosen || !character) return;
    const local = legacyLocal(id);
    if (local.length === 0) return;
    if (hasStored) {
      forgetLegacy(id);
      return;
    }
    void save({ ...character.appearance, hiddenSlots: local }).then((ok) => {
      if (ok) forgetLegacy(id);
    });
    // Keyed on who and whether, not on the character object: every command
    // returns a new one, and this must run once per viewer, not once per click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, chosen, hasStored]);

  const toggleHidden = useCallback(
    (slot: GearSlot) => {
      if (!character) return;
      const next = hiddenSlots.includes(slot) ? hiddenSlots.filter((s) => s !== slot) : [...hiddenSlots, slot];
      void save({ ...character.appearance, hiddenSlots: next });
    },
    [character, hiddenSlots, save],
  );

  return { hiddenSlots, toggleHidden };
}
