import type { Character, GearSlot, Role } from "./types.js";
import { GEAR_SLOTS } from "./types.js";
import { equipGear, gearUsableBy, grantGear, grantXp } from "./character.js";
import { spendPoints } from "./difficulty.js";
import { xpToNextLevel } from "./stats.js";
import { randomInt, type Rng } from "./rng.js";
import type { ContentRegistry } from "./content/loader.js";

/**
 * Fake viewers for the on-stream simulation. This exists purely so a
 * dungeon run can be exercised end-to-end without Twitch wired up — the
 * real path is one `join_dungeon` command per viewer arriving from the
 * EventSub layer, which is why `sim_join` produces exactly those commands
 * rather than reaching into engine state directly.
 *
 * Roles are spread deliberately (a tank, a healer, three dps) so the aggro
 * and heal-priority mechanics in the resolver are actually visible on
 * screen rather than theoretically present.
 */
export interface SimViewer {
  id: string;
  name: string;
  role: Role;
}

export const SIM_VIEWERS: readonly SimViewer[] = [
  { id: "sim:grunkzor", name: "Grunkzor", role: "tank" },
  { id: "sim:pixelwitch", name: "PixelWitch", role: "healer" },
  { id: "sim:dvxlord", name: "dvxLord", role: "dps" },
  { id: "sim:mossbeard", name: "Mossbeard", role: "dps" },
  { id: "sim:nyxbyte", name: "NyxByte", role: "dps" },
  { id: "sim:kettlehop", name: "Kettlehop", role: "dps" },
  { id: "sim:varlathorn", name: "Varlathorn", role: "tank" },
  { id: "sim:sablequill", name: "SableQuill", role: "healer" },
];

/** Name pool for generated viewers past the hand-written list above. */
const EXTRA_NAMES = [
  "Brackenfoot", "Cinderwisp", "Hollowpine", "Ratcatcher", "Tumblegrit",
  "Vexlin", "Wyrmsong", "Ashenvale", "Gutterking", "Snarlbeak",
  "Pipwhistle", "Thornbite", "Emberlash", "Cragmaw", "Duskrattle",
  "Fenwick", "Glimmerdock", "Hexwarden", "Ironhollow", "Jackdaw",
];

/**
 * `count` sim viewers, using the named list first and generating the rest.
 * Generated roles cycle tank/healer/dps/dps/dps so a big party keeps a
 * plausible composition instead of turning into 25 tanks.
 */
export function simViewers(count: number): SimViewer[] {
  const out: SimViewer[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i < SIM_VIEWERS.length) {
      out.push(SIM_VIEWERS[i]!);
      continue;
    }
    const n = i - SIM_VIEWERS.length;
    const name = EXTRA_NAMES[n % EXTRA_NAMES.length]!;
    const suffix = n >= EXTRA_NAMES.length ? String(Math.floor(n / EXTRA_NAMES.length) + 1) : "";
    const roleCycle: SimViewer["role"][] = ["tank", "healer", "dps", "dps", "dps"];
    out.push({
      id: `sim:gen-${i}`,
      name: `${name}${suffix}`,
      role: roleCycle[i % roleCycle.length]!,
    });
  }
  return out;
}

/**
 * How much of a fake viewer's kit is filled in.
 *
 * A party where everyone is dressed identically is no better for eyeballing the
 * art than a party where nobody is: the interesting cases are the half-equipped
 * ones, where a helmet has to sit next to bare shoulders and a mask over a
 * plain chest. So the tiers are assigned by JOIN ORDER rather than rolled —
 * every sim party is guaranteed to contain all three — while WHICH items fill
 * them is random.
 */
export type SimKit = "bare" | "partial" | "full";

const KIT_CYCLE: readonly SimKit[] = ["full", "partial", "full", "partial", "bare"];

export function kitForIndex(index: number): SimKit {
  return KIT_CYCLE[index % KIT_CYCLE.length]!;
}

/**
 * The Corruption a fake viewer arrives at.
 *
 * Not cosmetic: gear is gated on level, and at level 1 the catalogue offers a
 * single top and a single pair of legs — so a party of level-1 sim viewers
 * comes out in the same outfit however hard the item pick is randomised. A
 * spread across the range the catalogue actually covers is what makes them look
 * like different people.
 */
const SIM_LEVEL_RANGE: readonly [number, number] = [1, 10];

/**
 * Dresses a fake viewer in random gear.
 *
 * SIM ONLY. Real viewers arrive through `join_dungeon` and equip themselves on
 * the loadout screen; nothing here runs for them. It exists because a sim party
 * was rendering as a line of near-naked bodies — the roster grants a starter
 * kit but never puts it on, which is right for a real player and useless for
 * looking at the art.
 *
 * Everything goes through grantGear/equipGear rather than writing
 * `character.equipment` directly, so the same body-type, level and enabled
 * checks a player is held to apply here too. An item the sim cannot legally
 * wear is one the screenshot should not show.
 *
 * This DOES change how a sim party fights — equipped gear contributes its
 * statMods like anyone else's. The measured difficulty in the admin is read
 * against an ungeared reference party (see referenceParty in difficulty.ts), so
 * a geared sim run plays easier than that number suggests.
 */
export function dressSimViewer(
  character: Character,
  content: ContentRegistry,
  rng: Rng,
  kit: SimKit,
): void {
  if (kit === "bare") return;

  // Level first: it decides what the character is allowed to wear, so raising
  // it afterwards would gate the picks on a level they no longer have.
  const target = randomInt(SIM_LEVEL_RANGE[0], SIM_LEVEL_RANGE[1], rng);
  for (let lvl = 1; lvl < target; lvl += 1) grantXp(character, xpToNextLevel(lvl), content.balance);
  spendPoints(character, character.role, content.balance);

  const catalogue = content.listGear();
  for (const slot of GEAR_SLOTS) {
    // "Partial" leaves roughly half the kit empty, and which half is the point
    // — that is the case where an item has to read against bare skin.
    if (kit === "partial" && rng() < 0.5) continue;
    const candidates = catalogue.filter(
      (def) => def.slot === slot && gearUsableBy(def, character).ok,
    );
    const pick = candidates[randomInt(0, candidates.length - 1, rng)];
    if (!pick) continue;
    const instance = grantGear(character, pick.id);
    equipGear(character, instance.instanceId, content);
  }
}

/** Slots a sim viewer ended up actually wearing — for reporting, not logic. */
export function wornSlots(character: Character): GearSlot[] {
  return GEAR_SLOTS.filter((slot) => Boolean(character.equipment[slot]));
}
