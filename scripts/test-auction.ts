/**
 * The auction house, in two halves.
 *
 *   npm run test:auction
 *
 * 1. RULES (always runs). The engine's four auction commands against a fake
 *    book: what may be listed, the fee, the minimum price, the cap, expiry, and
 *    above all that a sale writes the BUYER's character only and leaves the
 *    seller's byte-for-byte alone - the property the whole design exists for.
 *
 * 2. SQL (runs only with AUCTION_TEST_DB_URL). sql/006_auction.sql against a
 *    real Postgres that already has sql/001 applied: two simultaneous buys of
 *    one listing give exactly one sale, and proceeds survive a seller who is
 *    mid-run. A stub cannot prove either - atomicity is what Postgres sells -
 *    so with no database this half says it was SKIPPED rather than passing.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { GameEngine } from "../src/engine/state/gameEngine.js";
import { grantGear, equipGear } from "../src/engine/character.js";
import type { AuctionContext, AuctionListing } from "../src/engine/auction.js";
import type { Character } from "../src/engine/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const content = new ContentRegistry();
content.loadGearDir(join(ROOT, "content", "gear"));
content.loadConsumablesDir(join(ROOT, "content", "consumables"));
content.loadBalance(join(ROOT, "content", "balance.json"));
content.loadShop(join(ROOT, "content", "shop.json"));

const NOW = Date.UTC(2026, 9, 28);
const DAY = 86_400_000;
const gearId = content.listGear().find((g) => g.rarity === "rare")!.id;
const min = content.recycleValue(gearId, "loot");

function engineFor(c: Character | null, ctx: Partial<AuctionContext> | null): GameEngine {
  const e = new GameEngine(content, Math.random);
  if (c) e.roster.hydrate([structuredClone(c)]);
  if (ctx) e.auction = { now: NOW, listings: [], proceeds: [], ...ctx };
  return e;
}
function make(id: string, gold = 0): Character {
  const e = engineFor(null, null);
  e.dispatch({ type: "ensure_character", requestedBy: id, displayName: id });
  const c = e.roster.get(id)!;
  c.gold = gold;
  return structuredClone(c);
}

// --- rules ---------------------------------------------------------------------

// No context, no auction house: the game server, file store and standalone overlay.
{
  const seller = make("twitch:1");
  const item = grantGear(seller, gearId, "loot");
  const r = engineFor(seller, null).dispatch({ type: "list_gear", requestedBy: seller.id, instanceId: item.instanceId, price: 500 });
  assert.equal(r.ok, false, "refuses without an auction context");
}

// Listing: found only, unequipped, priced at or above the recycle value, capped.
{
  const seller = make("twitch:1");
  const found = grantGear(seller, gearId, "loot");
  const bought = grantGear(seller, gearId, "shop");
  const list = (c: Character, instanceId: string, price: number, listings: AuctionListing[] = []) =>
    engineFor(c, { listings }).dispatch({ type: "list_gear", requestedBy: c.id, instanceId, price });

  assert.equal(list(seller, bought.instanceId, 500).ok, false, "shop gear cannot be listed");
  assert.equal(list(seller, found.instanceId, min - 1).ok, false, "below the recycle value is refused");
  assert.equal(list(seller, found.instanceId, 1.5 + min).ok, false, "fractional prices are refused");
  const ok = list(seller, found.instanceId, min);
  assert.ok(ok.ok, `listing at the minimum: ${ok.message}`);
  assert.deepEqual(ok.auction, { kind: "list", gearId, price: min, expiresAt: NOW + 7 * DAY });

  const full: AuctionListing[] = Array.from({ length: 10 }, (_, i) => ({
    id: `l${i}`, sellerId: seller.id, gearId, price: 100, status: "open", expiresAt: NOW + DAY,
  }));
  assert.equal(list(seller, found.instanceId, 500, full).ok, false, "the eleventh listing is refused");
  full[0]!.expiresAt = NOW - 1;
  assert.ok(list(seller, found.instanceId, 500, full).ok, "an expired listing does not count against the cap");

  const worn = make("twitch:3");
  const piece = grantGear(worn, gearId, "loot");
  equipGear(worn, piece.instanceId, content);
  const e = engineFor(worn, {});
  const eq = e.dispatch({ type: "list_gear", requestedBy: worn.id, instanceId: piece.instanceId, price: 500 });
  assert.equal(eq.ok, false, "equipped gear cannot be listed");
}

// Listing takes the item out of the bag.
{
  const seller = make("twitch:1");
  const item = grantGear(seller, gearId, "loot");
  const e = engineFor(seller, {});
  assert.ok(e.dispatch({ type: "list_gear", requestedBy: seller.id, instanceId: item.instanceId, price: 300 }).ok);
  assert.equal(e.roster.get(seller.id)!.inventory.some((i) => i.instanceId === item.instanceId), false, "escrowed");
}

// Buying: the buyer pays and receives a LOOT item; the effect names the seller's cut after the fee.
{
  const buyer = make("twitch:2", 1000);
  const listing: AuctionListing = { id: "L", sellerId: "twitch:1", gearId, price: 255, status: "open", expiresAt: NOW + DAY };
  const e = engineFor(buyer, { listings: [listing] });
  const r = e.dispatch({ type: "buy_listing", requestedBy: buyer.id, listingId: "L" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.auction, { kind: "buy", listingId: "L", sellerId: "twitch:1", price: 255, fee: 25, proceeds: 230 });
  const after = e.roster.get(buyer.id)!;
  assert.equal(after.gold, 1000 - 255);
  assert.equal(after.inventory.at(-1)!.gearId, gearId);
  assert.equal(after.inventory.at(-1)!.source, "loot", "a bought resale recycles at the loot rate");
  assert.equal(r.economy?.kind, "auction_buy");

  const poor = make("twitch:4", 10);
  assert.equal(engineFor(poor, { listings: [listing] }).dispatch({ type: "buy_listing", requestedBy: poor.id, listingId: "L" }).ok, false, "cannot afford");
  const own = make("twitch:1", 1000);
  assert.equal(engineFor(own, { listings: [listing] }).dispatch({ type: "buy_listing", requestedBy: own.id, listingId: "L" }).ok, false, "not your own listing");
  const stale = { ...listing, expiresAt: NOW - 1 };
  assert.equal(engineFor(buyer, { listings: [stale] }).dispatch({ type: "buy_listing", requestedBy: buyer.id, listingId: "L" }).ok, false, "expired");
  assert.equal(engineFor(buyer, { listings: [{ ...listing, status: "sold" }] }).dispatch({ type: "buy_listing", requestedBy: buyer.id, listingId: "L" }).ok, false, "sold");
}

// THE POINT: the seller is never loaded by a sale, and collecting is the seller's own write.
{
  const seller = make("twitch:1", 5);
  const before = JSON.stringify(seller);
  const buyer = make("twitch:2", 1000);
  const listing: AuctionListing = { id: "L", sellerId: seller.id, gearId, price: 255, status: "open", expiresAt: NOW + DAY };
  const sale = engineFor(buyer, { listings: [listing] }).dispatch({ type: "buy_listing", requestedBy: buyer.id, listingId: "L" });
  assert.ok(sale.ok);
  assert.equal(JSON.stringify(seller), before, "the sale did not touch the seller");

  const returned: AuctionListing = { id: "C", sellerId: seller.id, gearId, price: 100, status: "cancelled", expiresAt: NOW + DAY };
  const lapsed: AuctionListing = { id: "X", sellerId: seller.id, gearId, price: 100, status: "open", expiresAt: NOW - 1 };
  const live: AuctionListing = { id: "O", sellerId: seller.id, gearId, price: 100, status: "open", expiresAt: NOW + DAY };
  const e = engineFor(seller, { listings: [returned, lapsed, live], proceeds: [{ id: "P1", gold: 230 }, { id: "P2", gold: 40 }] });
  const r = e.dispatch({ type: "collect_proceeds", requestedBy: seller.id });
  assert.ok(r.ok, r.message);
  const c = e.roster.get(seller.id)!;
  assert.equal(c.gold, 5 + 270);
  assert.equal(c.inventory.length, seller.inventory.length + 2, "cancelled and expired items return; the live one does not");
  assert.deepEqual(r.auction, { kind: "collect", proceedsIds: ["P1", "P2"], returnedListingIds: ["C", "X"], gold: 270 });
  assert.equal(engineFor(seller, {}).dispatch({ type: "collect_proceeds", requestedBy: seller.id }).ok, false, "nothing to collect");
}

// Cancelling only withdraws; the item returns through collect.
{
  const seller = make("twitch:1");
  const live: AuctionListing = { id: "O", sellerId: seller.id, gearId, price: 100, status: "open", expiresAt: NOW + DAY };
  const e = engineFor(seller, { listings: [live] });
  const r = e.dispatch({ type: "cancel_listing", requestedBy: seller.id, listingId: "O" });
  assert.ok(r.ok);
  assert.equal(e.roster.get(seller.id)!.inventory.length, seller.inventory.length, "no item yet");
  const other = make("twitch:9");
  assert.equal(engineFor(other, { listings: [live] }).dispatch({ type: "cancel_listing", requestedBy: other.id, listingId: "O" }).ok, false, "only the seller cancels");
}
console.log("auction rules: ok");

// --- SQL -----------------------------------------------------------------------

const url = process.env.AUCTION_TEST_DB_URL;
if (!url) {
  console.log("auction SQL: SKIPPED (set AUCTION_TEST_DB_URL to a Postgres with sql/001 applied; it will be modified)");
} else {
  const run = promisify(execFile);
  const psql = async (sql: string) => (await run("psql", [url, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql])).stdout.trim();
  const tryPsql = async (sql: string) => {
    try { await psql(sql); return "ok"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); }
  };
  await psql("drop schema if exists public cascade; create schema public; create role service_role nologin;").catch(() => undefined);
  for (const f of ["001_roster.sql", "005_balance_log.sql", "006_auction.sql"]) {
    await run("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", join(ROOT, "sql", f)]);
  }
  const char = (id: string, gold: number) => JSON.stringify({ id, gold, inventory: [] }).replace(/'/g, "''");
  const reset = async () => {
    await psql("truncate public.proceeds, public.listings, public.characters cascade");
    for (const [id, gold] of [["twitch:1", 0], ["twitch:2", 1000], ["twitch:3", 1000]] as const) {
      await psql(`insert into public.characters (id, twitch_id, data) values ('${id}', '${id.slice(7)}', '${char(id, gold)}')`);
    }
    return psql(
      "insert into public.listings (seller_id, gear_id, price, expires_at) values ('twitch:1','x',255, now() + interval '1 day') returning id",
    );
  };
  const stamp = (id: string) => psql(`select updated_at from public.characters where id='${id}'`);
  const buy = async (buyer: string, listing: string) =>
    tryPsql(`select public.auction_buy('${buyer}', '${char(buyer, 745)}'::jsonb, '${await stamp(buyer)}', '${listing}', 25)`);

  // Two simultaneous buys of one listing: exactly one sale.
  let id = await reset();
  const [a, b] = await Promise.all([buy("twitch:2", id), buy("twitch:3", id)]);
  const wins = [a, b].filter((r) => r === "ok").length;
  assert.equal(wins, 1, `exactly one buy wins, got: ${a} / ${b}`);
  assert.ok([a, b].find((r) => r !== "ok")!.includes("auction:gone"), "the loser is told the listing is gone");
  assert.equal(await psql("select count(*) from public.proceeds"), "1", "one proceeds row");
  assert.equal(await psql("select gold from public.proceeds"), "230", "price minus fee");
  const charged = await psql("select count(*) from public.characters where (data->>'gold')::int = 745");
  assert.equal(charged, "1", "only the winner was charged");

  // The seller is mid-run: the sale still lands, and they collect afterwards.
  id = await reset();
  await psql("update public.characters set in_run = true where id = 'twitch:1'");
  assert.equal(await buy("twitch:2", id), "ok", "a sale does not need the seller to be free");
  assert.equal(await psql("select data->>'gold' from public.characters where id='twitch:1'"), "0", "seller row untouched");
  const pid = await psql("select id from public.proceeds");
  const collectArgs = async () =>
    `select public.auction_collect('twitch:1', '${char("twitch:1", 230)}'::jsonb, '${await stamp("twitch:1")}', array['${pid}']::uuid[], array[]::uuid[])`;
  assert.ok((await tryPsql(await collectArgs())).includes("auction:in_run"), "collect waits for the run to end");
  await psql("update public.characters set in_run = false where id = 'twitch:1'");
  assert.equal(await tryPsql(await collectArgs()), "ok", "collect after the run");
  assert.equal(await psql("select data->>'gold' from public.characters where id='twitch:1'"), "230");
  assert.ok((await tryPsql(await collectArgs())).includes("auction:stale"), "proceeds cannot be collected twice");
  console.log("auction SQL: ok");
}
