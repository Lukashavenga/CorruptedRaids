/**
 * The logic the loadout's Edge Function runs, without the Deno shell.
 *
 *   npm run test:edge
 *
 * The function is a thin wrapper: verify a JWT, load a row, dispatch, write
 * back. What could actually be wrong is underneath — whether `loadObjects`
 * builds a registry equivalent to the one the game server loads from disk, and
 * whether a GameEngine holding a single character validates a viewer's command
 * the same way the server would. That is what this checks.
 *
 * It deliberately runs the SAME bundle the function ships, so a content bundle
 * that is stale or malformed fails here rather than in production.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { GameEngine } from "../src/engine/state/gameEngine.js";
import type { Character } from "../src/engine/types.js";
import { grantGear } from "../src/engine/character.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- the registry the function will actually have ---------------------------
const bundle = JSON.parse(
  readFileSync(join(ROOT, "supabase", "functions", "character", "_content.json"), "utf-8"),
);
const edge = new ContentRegistry();
edge.loadObjects(bundle);

// --- the one the game server loads from disk --------------------------------
const disk = new ContentRegistry();
disk.loadGearDir(join(ROOT, "content", "gear"));
disk.loadConsumablesDir(join(ROOT, "content", "consumables"));
disk.loadBalance(join(ROOT, "content", "balance.json"));
disk.loadShop(join(ROOT, "content", "shop.json"));

assert.equal(edge.listGear().length, disk.listGear().length, "same gear count");
assert.deepEqual(
  edge.listGear().map((g) => g.id).sort(),
  disk.listGear().map((g) => g.id).sort(),
  "the bundle holds exactly the gear the server does — a stale bundle is a loadout that disagrees with the game",
);
assert.deepEqual(edge.shopView(), disk.shopView(), "same shop, same prices");
assert.deepEqual(edge.balance, disk.balance, "same balance numbers");
console.log(`registry matches disk: ${edge.listGear().length} gear, ${edge.listConsumables().length} consumables`);

// --- one character, as the function seeds it --------------------------------
const VIEWER = "twitch:12345";
function seed(character: Character | null): GameEngine {
  const engine = new GameEngine(edge, Math.random);
  if (character) engine.roster.hydrate([character]);
  return engine;
}

// Creating a character works with no run open — the loadout is used offline.
let engine = seed(null);
let result = engine.dispatch({ type: "ensure_character", requestedBy: VIEWER, displayName: "Tester" });
assert.ok(result.ok, `ensure_character: ${result.message}`);
let me = engine.roster.get(VIEWER)!;
assert.equal(me.level, 1);
console.log(`ensure_character works with no run open (level ${me.level}, ${me.inventory.length} starter items)`);

// --- validation is the whole reason this is not a direct database write -----
engine = seed(me);
result = engine.dispatch({ type: "allocate_points", requestedBy: VIEWER, stat: "hp", amount: 999 });
assert.equal(result.ok, false, "spending points you do not have must be refused");
console.log(`overspend refused: "${result.message}"`);

// Explicitly penniless, rather than assuming a fresh character is.
//
// This used to rely on characters starting on 0 gold, which stopped being true
// when economy.startingGold was introduced so that a new player arrives with
// something to spend. The thing under test is that the engine refuses a
// purchase you cannot afford, so the test now SETS the state it is testing
// instead of inheriting it from a balance number that is free to change.
me.gold = 0;
engine = seed(me);
result = engine.dispatch({ type: "buy_gear", requestedBy: VIEWER, gearId: edge.shopView().gear[0]!.id });
assert.equal(result.ok, false, "buying with no gold must be refused");
console.log(`broke purchase refused: "${result.message}"`);

// A legal move goes through, and the write-back is what the function stores.
me.unspentPoints = 3;
engine = seed(me);
result = engine.dispatch({ type: "allocate_points", requestedBy: VIEWER, stat: "hp", amount: 1 });
assert.ok(result.ok, `legal allocate: ${result.message}`);
const after = engine.roster.get(VIEWER)!;
assert.equal(after.allocated.hp, 1);
assert.equal(after.unspentPoints, 2);
console.log(`legal allocate applied: hp ${after.allocated.hp}, ${after.unspentPoints} left`);

// --- the view the loadout renders -------------------------------------------
const view = engine.getCharacterView(VIEWER)!;
assert.ok(view.corruption >= 0 && view.stats.hp > 0, "the character view is populated");
assert.equal(view.id, VIEWER);
console.log(`character view renders: corruption ${view.corruption}, ${view.stats.hp} hp`);

// --- every gear instance is its own item -----------------------------------
//
// Ids came from a counter that restarted in every process, so a character
// could hold two `x#1`s: the bag selected both and scrapping one left a ghost.
// New ids must not collide, and a stored duplicate must be split the SAME way
// on every load, or the id the loadout sends back names nothing next request.
{
  const dupe = structuredClone(engine.roster.get(VIEWER)!);
  const gearId = dupe.inventory[0]!.gearId;
  dupe.inventory = [
    { instanceId: `${gearId}#1`, gearId, source: "loot" },
    { instanceId: `${gearId}#1`, gearId, source: "loot" },
    { instanceId: `${gearId}#1`, gearId, source: "loot" },
  ];
  dupe.equipment = { [edge.getGear(gearId)!.slot]: { instanceId: `${gearId}#1`, gearId } };
  const ids = (c: Character) => [...Object.values(c.equipment).map((g) => g!.instanceId), ...c.inventory.map((g) => g.instanceId)];
  const first = ids(seed(structuredClone(dupe)).roster.get(VIEWER)!);
  const again = ids(seed(structuredClone(dupe)).roster.get(VIEWER)!);
  assert.equal(new Set(first).size, 4, `four held items, four ids: ${first.join(", ")}`);
  assert.deepEqual(again, first, "a duplicate is renamed the same way on every load");

  const split = seed(structuredClone(dupe));
  const target = ids(split.roster.get(VIEWER)!)[2]!;
  const before = split.roster.get(VIEWER)!.inventory.length;
  assert.ok(split.dispatch({ type: "recycle_gear", requestedBy: VIEWER, instanceId: target }).ok, "scrap one of the split copies");
  assert.equal(split.roster.get(VIEWER)!.inventory.length, before - 1, "scrapping removes exactly one");

  const minted = engine.roster.get(VIEWER)!;
  const fresh = new Set(Array.from({ length: 200 }, () => grantGear(minted, gearId).instanceId));
  assert.equal(fresh.size, 200, "200 new instances, 200 different ids");
  console.log(`duplicate ids split deterministically (${first.slice(1).join(", ")}); new ids unique`);
}

// --- the shopkeeper's percentage --------------------------------------------
//
// A sale is a percent on top of the shelf price, and the shelf, the purchase
// and the struck-through "was" price must all agree on it.
{
  const shop = new ContentRegistry();
  shop.loadObjects(bundle);
  const stocked = shop.shopView().gear[0]!;
  // Priced well above its value, as the suggested prices are: a discount below
  // value is a gold loop while bought gear refunds in full, and the admin
  // refuses to save one.
  const base = 1000;
  const priced = { ...JSON.parse(JSON.stringify(bundle.shop)), gearPrices: { [stocked.id]: base } };
  shop.setShop({ ...priced, gearAdjust: { [stocked.id]: -20 } }, "test");
  const onSale = shop.shopView().gear.find((g) => g.id === stocked.id)!;
  assert.equal(onSale.price, Math.max(1, Math.round(base * 0.8)), "20% off the shelf price");
  assert.equal(onSale.was, base, "the old price travels with it, to be struck through");

  const buyer = structuredClone(engine.roster.get(VIEWER)!);
  buyer.gold = 1_000_000;
  const shopEngine = new GameEngine(shop, Math.random);
  shopEngine.roster.hydrate([buyer]);
  assert.ok(shopEngine.dispatch({ type: "buy_gear", requestedBy: VIEWER, gearId: stocked.id }).ok, "buy on sale");
  assert.equal(shopEngine.roster.get(VIEWER)!.gold, 1_000_000 - onSale.price, "the purchase charges the sale price");

  assert.throws(
    () => shop.setShop({ ...priced, gearAdjust: { [stocked.id]: -100 } }, "test"),
    /percent/,
    "a 100% discount is refused rather than giving the item away",
  );
  assert.equal(shop.shopView().gear.find((g) => g.id === stocked.id)!.price, onSale.price, "a refused shop leaves the shelf as it was");
  console.log(`shop adjustment: ${stocked.id} ${base}g -> ${onSale.price}g, charged and shown alike`);
}

// --- consumables, live --------------------------------------------------------
//
// The function swaps in the store's consumables beside the shop, so a renamed
// tome shows without a deploy. A bad set must be refused whole.
{
  const live = new ContentRegistry();
  live.loadObjects(bundle);
  const defs = live.listConsumables();
  const renamed = defs.map((d) => ({ ...d, name: `${d.name} (renamed)` }));
  live.setConsumables(renamed);
  assert.ok(live.listConsumables().every((d) => d.name.endsWith("(renamed)")), "names come from the new set");

  const stocked = live.shop.consumables[0];
  if (stocked) {
    assert.throws(() => live.setConsumables(renamed.filter((d) => d.id !== stocked)), /stocks/, "a set missing a stocked tome is refused");
    assert.throws(() => live.setConsumables([...renamed, { ...renamed[0]!, price: -1 }]), /price|duplicate/, "a malformed set is refused");
    assert.ok(live.listConsumables().every((d) => d.name.endsWith("(renamed)")), "a refused set leaves the last good one");
  }
  console.log(`consumables swap live: ${defs.length} renamed, bad sets refused`);
}

// --- one engine per request, and it must not leak ---------------------------
const other = seed(null);
assert.equal(other.roster.get(VIEWER), undefined, "a fresh engine holds nobody else's character");
console.log("a per-request engine sees only its own character");

console.log("-".repeat(64));
console.log("All edge logic assertions passed.");
