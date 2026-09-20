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
  ShopStock,
  ShopView,
} from "../types.js";
import {
  validateConsumableDefinition,
  validateDungeonDefinition,
  validateGearDefinition,
  validateRaidDefinition,
  validateShopStock,
} from "./schemas.js";
import { DEFAULT_BALANCE, type BalanceConfig } from "../balance.js";

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
    if (bundle.balance && typeof bundle.balance === "object") {
      this.balance = mergeBalance(DEFAULT_BALANCE, bundle.balance as Record<string, unknown>);
    }
    // Shop last: it validates its ids against everything above, exactly as
    // the directory path does.
    if (bundle.shop) {
      const stock = validateShopStock(bundle.shop, "shop");
      for (const id of stock.gear) {
        if (!this.gear.has(id)) throw new Error(`shop stocks unknown gearId "${id}"`);
      }
      for (const id of stock.consumables) {
        if (!this.consumables.has(id)) throw new Error(`shop stocks unknown consumableId "${id}"`);
      }
      this.shop = stock;
    }
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
    const raw = readJson(path);
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`[content:${path}] balance file must contain a JSON object`);
    }
    this.balance = mergeBalance(DEFAULT_BALANCE, raw as Record<string, unknown>);
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
   * Shop stock. Validates that every stocked id actually exists, so a typo
   * fails at startup rather than producing a shop row that can't be bought.
   */
  loadShop(path: string): void {
    if (!existsSync(path)) return;
    const stock = validateShopStock(readJson(path), path);
    for (const id of stock.gear) {
      if (!this.gear.has(id)) throw new Error(`[content:${path}] shop stocks unknown gearId "${id}"`);
    }
    for (const id of stock.consumables) {
      if (!this.consumables.has(id)) throw new Error(`[content:${path}] shop stocks unknown consumableId "${id}"`);
    }
    this.shop = stock;
  }

  /** The shop with prices resolved — what GET /content hands the client. */
  shopView(): ShopView {
    return {
      // Disabled items drop out of the shop rather than being removed from
      // shop.json — turning an item off should not lose the fact that it was
      // stocked, or turning it back on becomes a second job.
      gear: this.shop.gear
        .filter((id) => this.getGear(id).enabled !== false)
        .map((id) => ({ id, price: this.gearValue(id) })),
      consumables: this.shop.consumables.map((id) => ({ id, price: this.getConsumable(id).price })),
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

  /** What recycling a gear item pays out. Always less than its value — see balance.economy. */
  recycleValue(id: string): number {
    return Math.max(1, Math.floor(this.gearValue(id) * this.balance.economy.recycleRate));
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
