import type {
  GearDefinition,
  AllocatableStat,
  Character,
  CharacterAppearance,
  GearInstance,
  GearSource,
  GearSlot,
  Role,
  SealedChest,
  Stats,
} from "./types.js";
import { ALLOCATABLE_STATS, GEAR_SLOTS } from "./types.js";
import { addStats, clampStats, emptyAllocation, statsFromAllocation, xpToNextLevel, ROLE_BASE_STATS } from "./stats.js";
import type { BalanceConfig } from "./balance.js";
import type { ContentRegistry } from "./content/loader.js";

let instanceCounter = 0;
export function nextInstanceId(gearId: string): string {
  instanceCounter += 1;
  return `${gearId}#${instanceCounter}`;
}

/**
 * The five skin tones the body art actually ships in.
 *
 * These ids ARE filenames: art/sprites/body/<bodyType>-<tone>.png, sliced from
 * the source sheet by scripts/slice-sheets.py. There used to be eight, taken
 * from a palette rather than from art, and every one of them beyond the first
 * five pointed at a sprite that did not exist. The list is short because the
 * art is; adding a tone means adding a column to the sheet.
 *
 * `color` is only a swatch for the picker — the sprite carries the real ramp.
 */
export const SKIN_TONES: readonly { id: string; name: string; color: string }[] = [
  { id: "fair", name: "Fair", color: "#f2b184" },
  { id: "light", name: "Light", color: "#dc9b66" },
  { id: "tan", name: "Tan", color: "#c07d4f" },
  { id: "brown", name: "Brown", color: "#9c5f3a" },
  { id: "dark", name: "Dark", color: "#6f3f28" },
];

export interface CreateCharacterOptions {
  id: string;
  name: string;
  role: Role;
  appearance?: CharacterAppearance;
  /**
   * Gold to start with. Defaults to 0 so a caller with no balance to hand —
   * the difficulty reference characters, for one — is unaffected; the real
   * game passes `economy.startingGold`.
   */
  gold?: number;
}

/**
 * Creates a viewer's character. `id` is the viewer's platform identity —
 * the same value that arrives as `requestedBy` on a command, which is the
 * seam a real Twitch layer plugs into (AGENTS.md §2.2).
 */
export function createCharacter({ id, name, role, appearance, gold = 0 }: CreateCharacterOptions): Character {
  return {
    id,
    name,
    level: 1,
    xp: 0,
    gold,
    role,
    allocated: emptyAllocation(),
    unspentPoints: 0,
    consumables: {},
    equipment: {},
    inventory: [],
    appearance: appearance ?? { bodyType: "male", skinTone: SKIN_TONES[0]!.id, hair: null },
  };
}

/**
 * A character's stats before gear: their role's base spread plus whatever
 * they've spent level-up points on. Kept separate from deriveCharacterStats
 * so the loadout screen can show "what gear is adding" as its own number.
 */
export function baseStatsFor(character: Character, balance: BalanceConfig): Stats {
  return addStats(
    { ...ROLE_BASE_STATS[character.role] },
    statsFromAllocation(character.allocated, balance.progression.perPoint),
  );
}

/** Role base + allocated points + every equipped item's statMods. This is what combat actually uses. */
export function deriveCharacterStats(character: Character, content: ContentRegistry): Stats {
  let stats = baseStatsFor(character, content.balance);
  for (const slot of GEAR_SLOTS) {
    const instance = character.equipment[slot];
    if (!instance) continue;
    stats = addStats(stats, content.getGear(instance.gearId).statMods);
  }
  // Floored, not clamped per-item: see clampStats. Gear may subtract, and the
  // subtraction is real — it just cannot take a combatant below what the
  // resolver can act on.
  return clampStats(stats);
}

/**
 * Adds a new gear instance to inventory and returns it (does not equip).
 *
 * `source` defaults to "loot" because only one route is a purchase: buyGear
 * says so, and every other way to come by an item sells back at the low rate.
 */
export function grantGear(character: Character, gearId: string, source: GearSource = "loot"): GearInstance {
  const instance: GearInstance = { instanceId: nextInstanceId(gearId), gearId, source };
  character.inventory.push(instance);
  return instance;
}

/**
 * Seals a drop into a chest instead of dropping it in the bag. See SealedChest.
 *
 * The item is already decided here — this defers the TELLING, not the roll, so
 * a player who never opens a chest has still earned exactly what they earned
 * and a player who reloads cannot re-roll it.
 */
export function grantChest(character: Character, gearId: string, from?: string): SealedChest {
  const chest: SealedChest = {
    id: `chest:${nextInstanceId(gearId)}`,
    gearId,
    at: Date.now(),
    ...(from ? { from } : {}),
  };
  (character.chests ??= []).push(chest);
  return chest;
}

/**
 * Opens a sealed chest: its contents become a real item in the bag.
 *
 * Returns the instance so the caller can name it — the loadout reveals the
 * item by id, and the engine is the only thing that knows which instance the
 * chest turned into.
 */
export function openChest(
  character: Character,
  chestId: string,
): { ok: true; instance: GearInstance; gearId: string } | { ok: false; reason: string } {
  const chests = character.chests ?? [];
  const index = chests.findIndex((c) => c.id === chestId);
  // Not an error worth shouting about: a double-tap on a phone sends this
  // twice, and the second one arriving after the first succeeded is the normal
  // case rather than a bug.
  if (index === -1) return { ok: false, reason: `no chest ${chestId}` };
  const [chest] = chests.splice(index, 1);
  return { ok: true, instance: grantGear(character, chest!.gearId), gearId: chest!.gearId };
}

export interface MutationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Whether an item is usable by this character at all.
 *
 * One function rather than checks scattered across equip, the shop and loot,
 * because "usable" has three independent reasons to be false and they must
 * agree everywhere — an item the shop sells but equip refuses is worse than
 * one that simply is not for sale.
 */
export function gearUsableBy(def: GearDefinition, character: Character): MutationResult {
  if (def.enabled === false) return { ok: false, reason: `${def.name} is not available.` };
  if (def.bodyTypes && !def.bodyTypes.includes(character.appearance.bodyType)) {
    return { ok: false, reason: `${def.name} is not cut for that body.` };
  }
  return { ok: true };
}

export function equipGear(character: Character, instanceId: string, content: ContentRegistry): MutationResult {
  const idx = character.inventory.findIndex((i) => i.instanceId === instanceId);
  if (idx === -1) return { ok: false, reason: `${character.name} does not own gear instance ${instanceId}` };
  const instance = character.inventory[idx]!;
  const def = content.getGear(instance.gearId);
  const usable = gearUsableBy(def, character);
  if (!usable.ok) return usable;
  const slot: GearSlot = def.slot;
  const replaced = character.equipment[slot];
  character.equipment[slot] = instance;
  character.inventory.splice(idx, 1);
  if (replaced) character.inventory.push(replaced);
  return { ok: true };
}

/** Moves whatever is in `slot` back to the inventory. */
export function unequipGear(character: Character, slot: GearSlot): MutationResult {
  const instance = character.equipment[slot];
  if (!instance) return { ok: false, reason: `Nothing equipped in ${slot}` };
  delete character.equipment[slot];
  character.inventory.push(instance);
  return { ok: true };
}

/**
 * Spends `amount` unspent points on `stat`. All-or-nothing: a request for
 * more points than the character has is rejected rather than partially
 * applied, so the UI can't silently spend a different number than it showed.
 */
export function allocatePoints(character: Character, stat: AllocatableStat, amount: number): MutationResult {
  if (!ALLOCATABLE_STATS.includes(stat)) return { ok: false, reason: `"${stat}" is not an allocatable stat` };
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, reason: "Amount must be a positive whole number" };
  if (amount > character.unspentPoints) {
    return { ok: false, reason: `Only ${character.unspentPoints} point(s) available` };
  }
  character.allocated[stat] += amount;
  character.unspentPoints -= amount;
  return { ok: true };
}

/**
 * Spends points on several stats at once, all or nothing.
 *
 * The loadout stages a whole build locally and confirms it in one request;
 * four `allocate_points` in a row could leave half of it applied if the third
 * failed. Everything is validated before anything is written, so a refusal
 * leaves the character exactly as it was.
 */
export function allocateMany(character: Character, points: Partial<Record<AllocatableStat, number>>): MutationResult {
  const entries = Object.entries(points);
  if (entries.length === 0) return { ok: false, reason: "Nothing to spend" };
  let total = 0;
  for (const [stat, amount] of entries) {
    if (!(ALLOCATABLE_STATS as readonly string[]).includes(stat)) {
      return { ok: false, reason: `"${stat}" is not an allocatable stat` };
    }
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      return { ok: false, reason: "Amount must be a positive whole number" };
    }
    total += amount;
  }
  if (total > character.unspentPoints) {
    return { ok: false, reason: `Only ${character.unspentPoints} point(s) available` };
  }
  for (const [stat, amount] of entries as [AllocatableStat, number][]) {
    character.allocated[stat] += amount;
  }
  character.unspentPoints -= total;
  return { ok: true };
}

/**
 * Refunds every spent point back to the pool.
 *
 * Free and unlimited for now. If respeccing should cost gold or be limited,
 * this is the one place that changes — the UI just dispatches the command.
 */
export function respec(character: Character): MutationResult {
  const spent = ALLOCATABLE_STATS.reduce((sum, stat) => sum + character.allocated[stat], 0);
  if (spent === 0) return { ok: false, reason: "Nothing to refund" };
  character.allocated = emptyAllocation();
  character.unspentPoints += spent;
  return { ok: true };
}

/**
 * Switches role. Allocated points are deliberately kept: they're the
 * player's own investment, and only the role's base spread swaps underneath
 * them. A tank who respecs to healer keeps the Health they bought.
 */
export function setRole(character: Character, role: Role): MutationResult {
  if (character.role === role) return { ok: false, reason: `Already a ${role}` };
  character.role = role;
  return { ok: true };
}

export function setAppearance(character: Character, appearance: CharacterAppearance): MutationResult {
  character.appearance = appearance;
  // Saving a look IS the act of choosing one, so this is the only place the
  // flag is set. It is deliberately not set anywhere else: a character that
  // has never been through the picker must keep reading as unchosen no matter
  // what else happens to it.
  character.appearanceChosen = true;
  return { ok: true };
}

/**
 * Sets which equipped slots are not drawn. Replaces the whole list rather than
 * toggling one, so a repeated or reordered request lands in the same state.
 *
 * Refuses an unknown slot rather than dropping it: this arrives from a phone,
 * and a typo silently ignored is a "hide" button that does nothing.
 */
export function setHiddenSlots(character: Character, slots: readonly string[]): MutationResult {
  const unknown = slots.filter((s) => !(GEAR_SLOTS as readonly string[]).includes(s));
  if (unknown.length > 0) return { ok: false, reason: `Not a slot: ${unknown.join(", ")}` };
  // Kept in GEAR_SLOTS order, so the same set always serialises the same way
  // and a save does not mistake a reorder for a change.
  const hidden = GEAR_SLOTS.filter((slot) => slots.includes(slot));
  if (hidden.length > 0) character.hiddenSlots = hidden;
  else delete character.hiddenSlots;
  return { ok: true };
}

/**
 * Recycles an owned, UNEQUIPPED gear instance for gold.
 *
 * Equipped items are refused rather than auto-unequipped: silently stripping
 * someone's weapon because they mis-clicked in a list is worse than making
 * them unequip first.
 */
export function recycleGear(character: Character, instanceId: string, content: ContentRegistry): MutationResult & { gold?: number } {
  const idx = character.inventory.findIndex((i) => i.instanceId === instanceId);
  if (idx === -1) {
    const equipped = Object.values(character.equipment).some((g) => g?.instanceId === instanceId);
    return { ok: false, reason: equipped ? "Unequip it first" : "You don't own that item" };
  }
  const instance = character.inventory[idx]!;
  const gold = content.recycleValue(instance.gearId, instance.source);
  character.inventory.splice(idx, 1);
  character.gold += gold;
  return { ok: true, gold };
}

/** Buys a stocked gear item, if the shop stocks it and the character can afford it. */
export function buyGear(character: Character, gearId: string, content: ContentRegistry): MutationResult & { cost?: number } {
  if (!content.shop.gear.includes(gearId)) return { ok: false, reason: "The shop doesn't stock that" };
  const cost = content.shopGearPrice(gearId);
  if (character.gold < cost) return { ok: false, reason: `Costs ${cost}g - you have ${character.gold}g` };
  character.gold -= cost;
  grantGear(character, gearId, "shop");
  return { ok: true, cost };
}

export function buyConsumable(
  character: Character,
  consumableId: string,
  content: ContentRegistry,
): MutationResult & { cost?: number } {
  if (!content.shop.consumables.includes(consumableId)) return { ok: false, reason: "The shop doesn't stock that" };
  const price = content.shopConsumablePrice(consumableId);
  if (character.gold < price) return { ok: false, reason: `Costs ${price}g - you have ${character.gold}g` };
  character.gold -= price;
  character.consumables[consumableId] = (character.consumables[consumableId] ?? 0) + 1;
  return { ok: true, cost: price };
}

export interface UseConsumableResult extends MutationResult {
  levelsGained?: number[];
  xp?: number;
  gold?: number;
}

/** Consumes one of `consumableId` and applies its effect. */
export function useConsumable(
  character: Character,
  consumableId: string,
  content: ContentRegistry,
  balance: BalanceConfig,
): UseConsumableResult {
  const owned = character.consumables[consumableId] ?? 0;
  if (owned < 1) return { ok: false, reason: "You don't have one of those" };
  const def = content.getConsumable(consumableId);

  character.consumables[consumableId] = owned - 1;
  if (character.consumables[consumableId] === 0) delete character.consumables[consumableId];

  if (def.effect.type === "grantGold") {
    character.gold += def.effect.amount;
    return { ok: true, gold: def.effect.amount };
  }
  const levelsGained = grantXp(character, def.effect.amount, balance);
  return { ok: true, xp: def.effect.amount, levelsGained };
}

/**
 * Grants xp, applying as many level-ups as the xp total covers, and banking
 * the points each level awards. Returns the levels gained (empty if none).
 */
export function grantXp(character: Character, amount: number, balance: BalanceConfig): number[] {
  character.xp += amount;
  const levelsGained: number[] = [];
  let needed = xpToNextLevel(character.level);
  while (character.xp >= needed) {
    character.xp -= needed;
    character.level += 1;
    character.unspentPoints += balance.progression.pointsPerLevel;
    levelsGained.push(character.level);
    needed = xpToNextLevel(character.level);
  }
  return levelsGained;
}
