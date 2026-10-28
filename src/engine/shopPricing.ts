import type { ConsumableDefinition, GearDefinition, ShopStock } from "./types.js";
import type { BalanceConfig } from "./balance.js";

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

export function shopGearPriceOf(stock: ShopStock, def: GearDefinition, economy: BalanceConfig["economy"]): number {
  return stock.gearPrices?.[def.id] ?? gearValueOf(def, economy);
}

export function shopConsumablePriceOf(stock: ShopStock, def: ConsumableDefinition): number {
  return stock.consumablePrices?.[def.id] ?? def.price;
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
