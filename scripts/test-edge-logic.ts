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

// --- one engine per request, and it must not leak ---------------------------
const other = seed(null);
assert.equal(other.roster.get(VIEWER), undefined, "a fresh engine holds nobody else's character");
console.log("a per-request engine sees only its own character");

console.log("-".repeat(64));
console.log("All edge logic assertions passed.");
