import type { ConsumableDefinition, GearDefinition, Rarity, ShopPricingInputs, ShopStock } from "./types.js";
import type { BalanceConfig } from "./balance.js";
import { powerScore } from "./statGuide.js";

/**
 * Shop prices as pure functions of definitions and balance.
 *
 * Here, with no Node import, rather than only on `ContentRegistry`, because the
 * admin panel has to show the price a stocked item will sell at and whether
 * that price prints gold - in a browser, which cannot import the registry
 * (it reads files). The registry calls these too, so the number on the admin
 * screen, the number on the shelf and the number the purchase takes are one
 * computation.
 */

/** What an item is worth: its own `value`, else its rarity's default. */
export function gearValueOf(def: GearDefinition, economy: BalanceConfig["economy"]): number {
  return def.value ?? economy.valueByRarity[def.rarity];
}

/** What a BOUGHT copy recycles for. Mirrors ContentRegistry.recycleValue(id, "shop"). */
export function boughtRecycleOf(def: GearDefinition, economy: BalanceConfig["economy"]): number {
  return Math.max(1, Math.floor(gearValueOf(def, economy) * economy.recycleRate));
}

/** A price with the shopkeeper's percentage on top. Never below 1g: a free item is not a sale. */
export function adjustedPrice(base: number, percent: number | undefined): number {
  if (!percent) return base;
  return Math.max(1, Math.round(base * (1 + percent / 100)));
}

/** The shelf price before any adjustment: the shop's own price, else the item's value. */
export function shopGearBasePriceOf(stock: ShopStock, def: GearDefinition, economy: BalanceConfig["economy"]): number {
  return stock.gearPrices?.[def.id] ?? gearValueOf(def, economy);
}

export function shopGearPriceOf(stock: ShopStock, def: GearDefinition, economy: BalanceConfig["economy"]): number {
  return adjustedPrice(shopGearBasePriceOf(stock, def, economy), stock.gearAdjust?.[def.id]);
}

export function shopConsumableBasePriceOf(stock: ShopStock, def: ConsumableDefinition): number {
  return stock.consumablePrices?.[def.id] ?? def.price;
}

export function shopConsumablePriceOf(stock: ShopStock, def: ConsumableDefinition): number {
  return adjustedPrice(shopConsumableBasePriceOf(stock, def), stock.consumableAdjust?.[def.id]);
}

/**
 * Where the admin's suggestions start, measured rather than chosen.
 *
 * 116g is what a viewer took home per fight across the 45 live alpha fights
 * (2026-10-28/29, balance log). The run counts are a savings ladder: a common
 * is one run's pay, a rare about a night (8-10 runs), a legendary about a week
 * of nights. Both are editable in the Shop tab and saved in shop.json.
 */
export const DEFAULT_SHOP_PRICING: ShopPricingInputs = {
  goldPerRun: 116,
  runsByRarity: { common: 1, uncommon: 3, rare: 8, epic: 20, legendary: 50 },
};

/** Rounded the way a shopkeeper would write it: to 5 under 100, 10 under 1,000, 50 above. */
export function shopRound(gold: number): number {
  const step = gold < 100 ? 5 : gold < 1000 ? 10 : 50;
  return Math.max(step, Math.round(gold / step) * step);
}

/**
 * The price the admin suggests for a gear item: a rarity's run count times a
 * run's pay, nudged by how strong this item is next to the others of its
 * rarity.
 *
 * Rarity alone was not enough: the catalogue's rarities and stats were set
 * independently (AGENTS.md §10, retier:gear), so a "rare" runs from 7 to 118
 * power. The nudge is the square root of power over the rarity's median, held
 * to 0.6-1.6x, so a standout item costs more without the rarity's name stopping
 * meaning anything. `medianPower` comes from the catalogue the caller has.
 *
 * A SUGGESTION only. The panel writes it into the item's price when asked;
 * the engine never prices from this, so editing an item's stats can never
 * quietly reprice what is on the shelf.
 */
export function suggestedGearPriceOf(
  def: GearDefinition,
  pricing: ShopPricingInputs,
  medianPower: Record<Rarity, number>,
  balance: BalanceConfig,
): number {
  const power = Math.max(1, powerScore(def.statMods, balance));
  const median = Math.max(1, medianPower[def.rarity]);
  const nudge = Math.min(1.6, Math.max(0.6, Math.sqrt(power / median)));
  return shopRound(pricing.goldPerRun * pricing.runsByRarity[def.rarity] * nudge);
}

/** Each rarity's median power across a catalogue, for suggestedGearPriceOf. */
export function medianPowerByRarity(gear: GearDefinition[], balance: BalanceConfig): Record<Rarity, number> {
  const by: Record<string, number[]> = {};
  for (const def of gear) (by[def.rarity] ??= []).push(powerScore(def.statMods, balance));
  const out = {} as Record<Rarity, number>;
  for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"] as Rarity[]) {
    const list = (by[rarity] ?? []).sort((a, b) => a - b);
    out[rarity] = list.length ? list[Math.floor(list.length / 2)]! : 1;
  }
  return out;
}

/** One stocked item that pays out more than it costs. */
export interface ShopLoop {
  kind: "gear" | "consumable";
  id: string;
  price: number;
  /** Gold the item gives back: a tome's payout, or a bought copy's recycle value. */
  payout: number;
}

/**
 * Stock that prints gold.
 *
 * Two shapes: a `grantGold` consumable paying out more than it costs, and gear
 * priced under what a bought copy recycles for (`economy.recycleRate`, 1 while
 * the game is in alpha). Ids with no definition are skipped - an unknown id is
 * the loader's error to raise, not this one's.
 */
export function shopLoops(
  stock: ShopStock,
  gear: (id: string) => GearDefinition | undefined,
  consumable: (id: string) => ConsumableDefinition | undefined,
  economy: BalanceConfig["economy"],
): ShopLoop[] {
  const out: ShopLoop[] = [];
  for (const id of stock.consumables) {
    const def = consumable(id);
    if (!def || def.effect.type !== "grantGold") continue;
    const price = shopConsumablePriceOf(stock, def);
    if (def.effect.amount > price) out.push({ kind: "consumable", id, price, payout: def.effect.amount });
  }
  for (const id of stock.gear) {
    const def = gear(id);
    if (!def) continue;
    const price = shopGearPriceOf(stock, def, economy);
    const refund = boughtRecycleOf(def, economy);
    if (refund > price) out.push({ kind: "gear", id, price, payout: refund });
  }
  return out;
}
