import { existsSync, readdirSync, readFileSync } from "node:fs";
import { expandFight } from "../squad.js";
import { join } from "node:path";
import type {
  FightDefinition,
  RaidDefinition,
  ConsumableDefinition,
  DungeonDefinition,
  EnemyDefinition,
  GearDefinition,
  GearSource,
  ShopStock,
  ShopView,
} from "../types.js";
import {
  validateBalanceFile,
  validateConsumableDefinition,
  validateDungeonDefinition,
  validateGearDefinition,
  validateRaidDefinition,
  validateShopStock,
} from "./schemas.js";
import { DEFAULT_BALANCE, type BalanceConfig } from "../balance.js";
import { shopConsumableBasePriceOf, shopConsumablePriceOf, shopGearBasePriceOf, shopGearPriceOf, shopLoops } from "../shopPricing.js";

/**
 * ContentRegistry is the single seam through which the engine knows about
 * gear, dungeons, raids, consumables and balance. It is populated once at startup
 * by scanning JSON files off disk. To add a new sword, a new boss, another
 * place to raid, whatever: drop a new JSON file in the matching content/
 * directory — nothing else needs to change.
 *
 * Keyed on each file's `id` field, not on its filename. The two are kept in
 * step by convention because it makes the directory readable, but renaming a
 * file alone changes nothing.
 */
export class ContentRegistry {
  private gear = new Map<string, GearDefinition>();
  private dungeons = new Map<string, DungeonDefinition>();
  private consumables = new Map<string, ConsumableDefinition>();
  private raids = new Map<string, RaidDefinition>();
  /** Empty until loadShop() runs — an absent shop file just means nothing is for sale. */
  shop: ShopStock = { gear: [], consumables: [] };
  /** Falls back to the in-code defaults until loadBalance() is called. */
  balance: BalanceConfig = DEFAULT_BALANCE;

  /**
   * Load from already-parsed JSON instead of from a directory.
   *
   * WHY THIS EXISTS: the loadout's Supabase Edge Function runs on Deno and
   * validates a viewer's command with the REAL engine — the alternative was
   * re-implementing gear requirements, prices and point costs in SQL, which
   * would be the same rules written twice and wrong within a month. But every
   * other loader here reaches for `node:fs`, which Deno has no business
   * providing to a function that ships its content bundled.
   *
   * Same validators, same duplicate checks, same order dependencies — only
   * the source of the bytes differs. `where` is used in error messages in
   * place of a filename.
   */
  loadObjects(bundle: {
    gear?: unknown[];
    consumables?: unknown[];
    /**
     * Dungeons and raids as DATA, for a caller with no directory to read.
     *
     * The Edge Function never needed these - it validates a character's own
     * commands and has no opinion about where a fight happens. The game server
     * does, once content lives in Supabase rather than on the disk beside it,
     * and the alternative was a second loader that agrees with the directory
     * one until somebody changes a rule in only one of them.
     */
    dungeons?: unknown[];
    raids?: unknown[];
    balance?: unknown;
    shop?: unknown;
  }): void {
    for (const [i, raw] of (bundle.gear ?? []).entries()) {
      const def = validateGearDefinition(raw, `gear[${i}]`);
      if (this.gear.has(def.id)) throw new Error(`duplicate gear id "${def.id}"`);
      this.gear.set(def.id, def);
    }
    for (const [i, raw] of (bundle.consumables ?? []).entries()) {
      const def = validateConsumableDefinition(raw, `consumables[${i}]`);
      if (this.consumables.has(def.id)) throw new Error(`duplicate consumable id "${def.id}"`);
      this.consumables.set(def.id, def);
    }
    // Dungeons and raids AFTER gear, because both check their loot tables
    // against it - the same ordering the directory loaders document, and for
    // the same reason: a fight that drops a missing item should fail here
    // rather than four rounds into a live run.
    for (const [i, raw] of (bundle.dungeons ?? []).entries()) {
      const def = validateDungeonDefinition(raw, `dungeons[${i}]`);
      if (this.dungeons.has(def.id)) throw new Error(`duplicate dungeon id "${def.id}"`);
      this.checkLoot(def, def.id, `dungeons[${i}]`);
      this.dungeons.set(def.id, def);
    }
    for (const [i, raw] of (bundle.raids ?? []).entries()) {
      const def = validateRaidDefinition(raw, `raids[${i}]`);
      if (this.raids.has(def.id)) throw new Error(`duplicate raid id "${def.id}"`);
      const fights = [def.boss.fight, ...def.rooms.flatMap((r) => (r.fight ? [r.fight] : []))];
      for (const fight of fights) this.checkLoot(fight, def.id, `raids[${i}]`);
      this.raids.set(def.id, def);
    }

    if (bundle.balance && typeof bundle.balance === "object") {
      this.applyBalance(bundle.balance, "balance.json");
    }
    // Shop last: it validates its ids against everything above, exactly as
    // the directory path does.
    if (bundle.shop) this.setShop(bundle.shop, "shop");
  }

  loadGearDir(dir: string): void {
    for (const file of listJsonFiles(dir)) {
      const raw = readJson(join(dir, file));
      const def = validateGearDefinition(raw, file);
      if (this.gear.has(def.id)) {
        throw new Error(`[content:${file}] duplicate gear id "${def.id}" (already defined by another file)`);
      }
      this.gear.set(def.id, def);
    }
  }

  /**
   * Raids. Loaded after gear, because every fight's loot table names gear and
   * a raid that references a missing item should fail at startup rather than
   * four rounds into a live run.
   */
  loadRaidsDir(dir: string): void {
    for (const file of listJsonFiles(dir)) {
      const raw = readJson(join(dir, file));
      const def = validateRaidDefinition(raw, file);
      if (this.raids.has(def.id)) {
        throw new Error(`[content:${file}] duplicate raid id "${def.id}"`);
      }
      // Every fight a raid can field, wherever it lives: the boss, plus each
      // room that holds one. A "clear" room has nothing to check.
      const fights = [def.boss.fight, ...def.rooms.flatMap((r) => (r.fight ? [r.fight] : []))];
      for (const fight of fights) this.checkLoot(fight, def.id, file);
      this.raids.set(def.id, def);
    }
  }

  /** Every gearId a fight can drop has to exist, including on a unit override. */
  private checkLoot(fight: FightDefinition, ownerId: string, file: string): void {
    const tables = [fight.loot, ...Object.values(fight.formations).flatMap((units) => (units ?? []).map((u) => u.loot))];
    for (const table of tables) {
      for (const loot of table ?? []) {
        if (!this.gear.has(loot.gearId)) {
          throw new Error(
            `[content:${file}] "${ownerId}" drops unknown gearId "${loot.gearId}" (load gear before fights)`,
          );
        }
      }
    }
  }

  getRaid(id: string): RaidDefinition | undefined {
    return this.raids.get(id);
  }

  listRaids(): RaidDefinition[] {
    return [...this.raids.values()];
  }

  loadDungeonsDir(dir: string): void {
    if (!existsSync(dir)) return;
    for (const file of listJsonFiles(dir)) {
      const raw = readJson(join(dir, file));
      const def = validateDungeonDefinition(raw, file);
      if (this.dungeons.has(def.id)) {
        throw new Error(`[content:${file}] duplicate dungeon id "${def.id}" (already defined by another file)`);
      }
      this.checkLoot(def, def.id, file);
      this.dungeons.set(def.id, def);
    }
  }

  /**
   * Balance is a single optional file, not a directory — absent is fine and
   * falls back to DEFAULT_BALANCE, but malformed fails loudly like any other
   * content. Deep-merged so a partial file only overrides what it names.
   */
  loadBalance(path: string): void {
    if (!existsSync(path)) return;
    this.applyBalance(readJson(path), path);
  }

  /**
   * Validate a balance file's contents and make them the live numbers.
   *
   * Public because the admin's Loot tab changes the drop dial on a running
   * server: `balance` is replaced on the SAME registry, and the resolver reads
   * it per fight, so the next run uses it with no restart.
   */
  applyBalance(raw: unknown, file = "balance.json"): void {
    this.balance = mergeBalance(DEFAULT_BALANCE, validateBalanceFile(raw, `[content:${file}]`));
  }

  /**
   * Re-read every content directory in place.
   *
   * The admin screen writes JSON that this registry has already parsed, so
   * without a reload a tuning change would need a server restart to take
   * effect — which makes iterating on balance unusable. Reloading into the SAME
   * registry instance matters: the engine, controller and every open run hold a
   * reference to it, and swapping the object would leave them on stale content.
   */
  reload(contentDir: string): void {
    this.gear.clear();
    this.dungeons.clear();
    this.consumables.clear();
    this.raids.clear();
    this.loadGearDir(join(contentDir, "gear"));
    this.loadDungeonsDir(join(contentDir, "dungeons"));
    this.loadConsumablesDir(join(contentDir, "consumables"));
    this.loadBalance(join(contentDir, "balance.json"));
    this.loadRaidsDir(join(contentDir, "raids"));
    this.loadShop(join(contentDir, "shop.json"));
  }

  getDungeon(id: string): DungeonDefinition {
    const def = this.dungeons.get(id);
    if (!def) throw new Error(`Unknown dungeon id "${id}"`);
    return def;
  }

  listDungeons(): DungeonDefinition[] {
    return [...this.dungeons.values()];
  }

  /**
   * A dungeon's bodies, resolved for the party that turned up.
   *
   * Thin on purpose: a dungeon IS a fight now (see FightDefinition), so this
   * is `expandFight` with the dungeon's own name attached. Raid doors call
   * `expandFight` directly with theirs — a fight is a fight, and both produce
   * combatants exactly the same way.
   */
  expandDungeonEnemies(dungeon: DungeonDefinition, strength = 0): EnemyDefinition[] {
    return expandFight(dungeon, dungeon.id, dungeon.name, strength, this.balance.bandStatScale);
  }

  loadConsumablesDir(dir: string): void {
    if (!existsSync(dir)) return;
    for (const file of listJsonFiles(dir)) {
      const raw = readJson(join(dir, file));
      const def = validateConsumableDefinition(raw, file);
      if (this.consumables.has(def.id)) {
        throw new Error(`[content:${file}] duplicate consumable id "${def.id}" (already defined by another file)`);
      }
      this.consumables.set(def.id, def);
    }
  }

  /**
   * Replace every consumable definition, validated, or throw and keep the old.
   *
   * For the loadout's Edge Function, which bundles its content at deploy and
   * so would show a renamed tome under its old name until the next deploy.
   * It re-reads the consumables from the content store beside the shop and
   * swaps them in here. Refused whole, never half-applied: a malformed row,
   * a duplicate, or a set missing something the shop stocks leaves what was
   * there, because a stocked consumable with no definition breaks the shelf.
   */
  setConsumables(raws: unknown[], where = "consumables"): void {
    const next = new Map<string, ConsumableDefinition>();
    for (const [i, raw] of raws.entries()) {
      const def = validateConsumableDefinition(raw, `${where}[${i}]`);
      if (next.has(def.id)) throw new Error(`[content:${where}] duplicate consumable id "${def.id}"`);
      next.set(def.id, def);
    }
    for (const id of this.shop.consumables) {
      if (!next.has(id)) throw new Error(`[content:${where}] the shop stocks "${id}", which this set does not define`);
    }
    this.consumables = next;
  }

  /**
   * Shop stock. Validates that every stocked id actually exists, so a typo
   * fails at startup rather than producing a shop row that can't be bought.
   */
  loadShop(path: string): void {
    if (!existsSync(path)) return;
    this.setShop(readJson(path), path);
  }

  /**
   * Replace the shop's stock, validated, or throw and leave it as it was.
   *
   * The one door every shop change comes through - boot, a bundle, and the
   * admin's save on a running server - so what is checked at boot is checked
   * on a live edit, and a rejected save leaves the shelf viewers can see
   * exactly as it was.
   */
  setShop(raw: unknown, where = "shop"): void {
    const stock = validateShopStock(raw, where);
    for (const id of stock.gear) {
      if (!this.gear.has(id)) throw new Error(`[content:${where}] shop stocks unknown gearId "${id}"`);
    }
    for (const id of stock.consumables) {
      if (!this.consumables.has(id)) throw new Error(`[content:${where}] shop stocks unknown consumableId "${id}"`);
    }
    this.shop = stock;
    for (const problem of this.shopLoops()) console.warn(`[content:${where}] ${problem}`);
  }

  /**
   * What the shop charges for a stocked gear item: the shop's override if it
   * has one, otherwise the item's `gearValue`. The purchase AND the view both
   * ask here, so a buy button cannot disagree with what the buy takes.
   */
  shopGearPrice(id: string): number {
    return shopGearPriceOf(this.shop, this.getGear(id), this.balance.economy);
  }

  /** The consumable's shop price: the shop's override, else its own `price`. */
  shopConsumablePrice(id: string): number {
    return shopConsumablePriceOf(this.shop, this.getConsumable(id));
  }

  /**
   * Stock that pays out more than it costs, as readable lines. Reported at
   * load rather than refused: refusing would let a balance edit stop the
   * server booting. The rule is in shopPricing.ts so the admin panel shows
   * the same verdict.
   */
  shopLoops(): string[] {
    return shopLoops(
      this.shop,
      (id) => this.gear.get(id),
      (id) => this.consumables.get(id),
      this.balance.economy,
    ).map((l) => `"${l.id}" costs ${l.price}g and pays back ${l.payout}g - infinite gold`);
  }

  /** The shop with prices resolved — what GET /content hands the client. */
  shopView(): ShopView {
    return {
      // Disabled items drop out of the shop rather than being removed from
      // shop.json — turning an item off should not lose the fact that it was
      // stocked, or turning it back on becomes a second job.
      gear: this.shop.gear
        .filter((id) => this.getGear(id).enabled !== false)
        .map((id) => {
          const price = this.shopGearPrice(id);
          const was = shopGearBasePriceOf(this.shop, this.getGear(id), this.balance.economy);
          return was !== price ? { id, price, was } : { id, price };
        }),
      consumables: this.shop.consumables.map((id) => {
        const price = this.shopConsumablePrice(id);
        const was = shopConsumableBasePriceOf(this.shop, this.getConsumable(id));
        return was !== price ? { id, price, was } : { id, price };
      }),
    };
  }

  getConsumable(id: string): ConsumableDefinition {
    const def = this.consumables.get(id);
    if (!def) throw new Error(`Unknown consumable id "${id}"`);
    return def;
  }

  listConsumables(): ConsumableDefinition[] {
    return [...this.consumables.values()];
  }

  /**
   * What a gear item is worth in gold: its own `value` if it sets one,
   * otherwise its rarity's default from balance.
   */
  gearValue(id: string): number {
    const def = this.getGear(id);
    return def.value ?? this.balance.economy.valueByRarity[def.rarity];
  }

  /** Gold to transmog this item: by its own rarity, since it is the one keeping its stats. */
  transmogCost(id: string): number {
    return this.balance.economy.transmogCostByRarity[this.getGear(id).rarity];
  }

  /**
   * What recycling a gear item pays out: its value times the rate for where
   * it came from - `economy.recycleRate` if it was bought, `lootRecycleRate`
   * otherwise. See both in balance.ts; the rates are the statement, not the
   * prose, which is why no number is repeated here.
   *
   * `source` is optional and absent means loot: an instance from before the
   * field existed cannot show it was bought.
   */
  recycleValue(id: string, source?: GearSource): number {
    const { recycleRate, lootRecycleRate } = this.balance.economy;
    return Math.max(1, Math.floor(this.gearValue(id) * (source === "shop" ? recycleRate : lootRecycleRate)));
  }

  getGear(id: string): GearDefinition {
    const def = this.gear.get(id);
    if (!def) throw new Error(`Unknown gear id "${id}"`);
    return def;
  }


  listGear(): GearDefinition[] {
    return [...this.gear.values()];
  }

}

/**
 * Recursive shallow-merge of a partial balance JSON over the defaults, so
 * content/balance.json only has to name the knobs it actually changes.
 * Keys the defaults don't define (like the "_comment" field) are ignored.
 */
function mergeBalance(defaults: BalanceConfig, override: Record<string, unknown>): BalanceConfig {
  const merge = (base: any, patch: any): any => {
    if (typeof base !== "object" || base === null || Array.isArray(base)) return patch ?? base;
    if (typeof patch !== "object" || patch === null) return base;
    const out: any = { ...base };
    for (const key of Object.keys(base)) {
      if (key in patch) out[key] = merge(base[key], patch[key]);
    }
    return out;
  };
  return merge(defaults, override) as BalanceConfig;
}

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir).filter((f: string) => f.endsWith(".json")).sort();
}

function readJson(path: string): unknown {
  const text = readFileSync(path, "utf-8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`[content:${path}] invalid JSON: ${(err as Error).message}`);
  }
}
