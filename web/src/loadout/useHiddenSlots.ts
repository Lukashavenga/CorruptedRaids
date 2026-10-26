import { useCallback, useEffect, useState } from "react";
import type { GearSlot } from "../../../src/engine/types.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import type { GameCommand } from "../../../src/engine/commands/types.js";

/**
 * Which equipped slots the player has chosen not to see.
 *
 * Cosmetic only: the item stays equipped and its stats still count. Players
 * want a helmet's armour without losing the face they picked, so this is a view
 * toggle rather than an unequip.
 *
 * ON THE CHARACTER NOW, NOT IN THIS BROWSER. It lived in localStorage on the
 * reasoning that it was taste rather than game state - and it is taste, but the
 * stream is where people look, so a helmet hidden on your phone and drawn on
 * everyone else's screen was the bug. It is a `set_hidden_slots` command, and
 * the overlay leaves those layers off. Nothing the resolver reads changes.
 *
 * localStorage is kept as a fallback for one reason: a character view from a
 * backend that predates the field has no `hiddenSlots`, and the toggle should
 * still work on this screen while the hosted pieces are deployed one by one.
 * A device that had slots hidden before uploads them once, so nobody's helmet
 * suddenly reappears on their own screen.
 *
 * Every storage read and write is guarded: storage throws outright in some
 * privacy modes, and a character should still render if it does.
 */
const KEY = "corrupted.hiddenSlots";
const UPLOADED = "corrupted.hiddenSlots.uploaded";

function readMap(key: string): Record<string, unknown> {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? "{}");
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

function writeEntry(key: string, viewerId: string, value: unknown): void {
  try {
    const all = readMap(key);
    all[viewerId] = value;
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    // Preference is lost on reload; the character still draws correctly.
  }
}

function loadLocal(viewerId: string): GearSlot[] {
  const mine = readMap(KEY)[viewerId];
  return Array.isArray(mine) ? (mine as GearSlot[]) : [];
}

export function useHiddenSlots(
  viewerId: string,
  character: CharacterView | null,
  dispatch: (command: GameCommand) => Promise<unknown>,
): {
  hiddenSlots: GearSlot[];
  toggleHidden: (slot: GearSlot) => void;
} {
  const [local, setLocal] = useState<GearSlot[]>([]);
  useEffect(() => setLocal(loadLocal(viewerId)), [viewerId]);

  // The backend's list when it sends one; this device's otherwise. A backend
  // that sends none does not know the command either, so nothing is sent to it
  // - a refusal would only put an error on screen for a toggle that works.
  const stored = character?.hiddenSlots;
  const backendKnows = Array.isArray(stored);

  // What was just clicked, until the character re-read after the command
  // brings the real list back - otherwise the eye flips a round trip late.
  const [pending, setPending] = useState<GearSlot[] | null>(null);
  useEffect(() => setPending(null), [stored]);

  const hiddenSlots = pending ?? (backendKnows ? stored : local);

  // One-time upload of what this device had hidden before the setting moved
  // onto the character. Only into an empty list: a list that already has
  // something in it was set deliberately, perhaps on another device.
  useEffect(() => {
    if (!viewerId || !Array.isArray(stored) || stored.length > 0) return;
    if (readMap(UPLOADED)[viewerId] === true) return;
    const before = loadLocal(viewerId);
    writeEntry(UPLOADED, viewerId, true);
    if (before.length > 0) void dispatch({ type: "set_hidden_slots", requestedBy: viewerId, slots: before });
  }, [viewerId, stored, dispatch]);

  const toggleHidden = useCallback(
    (slot: GearSlot) => {
      const next = hiddenSlots.includes(slot) ? hiddenSlots.filter((s) => s !== slot) : [...hiddenSlots, slot];
      setLocal(next);
      writeEntry(KEY, viewerId, next);
      if (!backendKnows) return;
      setPending(next);
      // `requestedBy` is replaced from the signed-in token server-side; it is
      // here because the command type requires it.
      void dispatch({ type: "set_hidden_slots", requestedBy: viewerId, slots: next });
    },
    [hiddenSlots, viewerId, dispatch, backendKnows],
  );

  return { hiddenSlots, toggleHidden };
}
