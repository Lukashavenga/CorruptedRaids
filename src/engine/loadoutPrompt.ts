import type { BalanceConfig } from "./balance.js";
import { dayKey } from "./dungeoneer.js";
import { STARTER_KIT } from "./roster.js";
import type { Character, GearSlot } from "./types.js";
import { text, format } from "../text/index.js";

/**
 * The one nightly prompt: "you have something waiting in your loadout".
 *
 * WHY IT EXISTS. New viewers stay naked on purpose - wanting to get dressed is
 * the reason to visit the loadout - but 22 of the 23 level 1-9 characters in
 * the balance log had never opened a chest and 19 had never touched their
 * character, so many may not know the page exists. This tells each of them
 * once a night, and only when there is something to tell.
 *
 * WHAT IT NEVER DOES. It does not open a chest, spend a point or put the kit
 * on. Everything it mentions stays exactly as it was until the viewer acts.
 *
 * "A night" is the `balance.dungeoneer` day (11:00 to 11:00 Amsterdam), the
 * same boundary the Dungeoneer title resets on, so one stream is one night.
 */

export interface Waiting {
  /** Sealed chests not yet opened. */
  chests: number;
  /** Level-up points not yet spent. */
  points: number;
  /** Starter-kit pieces still in the bag whose slot is empty. */
  kit: number;
}

export function isNothing(w: Waiting): boolean {
  return w.chests === 0 && w.points === 0 && w.kit === 0;
}

/**
 * What a character has waiting.
 *
 * A kit piece counts only while it is still carried AND nothing is worn in its
 * slot: a viewer who has dressed themselves, even in something else, has found
 * the page and is not who this is for. `slotOf` is passed in because this
 * module knows nothing about content.
 */
export function waitingFor(character: Character, slotOf: (gearId: string) => GearSlot | null): Waiting {
  const kit = character.inventory.filter((item) => {
    if (!STARTER_KIT.includes(item.gearId)) return false;
    const slot = slotOf(item.gearId);
    return slot !== null && !character.equipment[slot];
  }).length;
  return { chests: character.chests?.length ?? 0, points: character.unspentPoints, kit };
}

/** Why a prompt would not go out, or null when it may. */
export function promptRefusal(
  character: Character,
  waiting: Waiting,
  at: number,
  balance: BalanceConfig,
): "disabled" | "sim" | "already" | "nothing" | null {
  if (!balance.loadoutPrompt.enabled) return "disabled";
  // A sim viewer is the operator testing; there is nobody to message.
  if (character.id.startsWith("sim:")) return "sim";
  if (character.promptedOn === dayKey(at, balance.dungeoneer)) return "already";
  if (isNothing(waiting)) return "nothing";
  return null;
}

/** The sentence the bot says: only the things that are actually waiting. */
export function promptText(character: Character, waiting: Waiting, url: string): string {
  const t = text.loadoutPrompt;
  const parts: string[] = [];
  if (waiting.chests > 0) {
    parts.push(format(waiting.chests === 1 ? t.chestOne : t.chestMany, { count: waiting.chests }));
  }
  if (waiting.points > 0) {
    parts.push(format(waiting.points === 1 ? t.pointOne : t.pointMany, { count: waiting.points }));
  }
  if (waiting.kit > 0) parts.push(t.kit);
  return format(t.message, { name: character.name, waiting: parts.join(", "), url });
}
