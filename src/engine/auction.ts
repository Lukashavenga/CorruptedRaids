/**
 * The auction house's rules, as pure functions over ONE character.
 *
 * A sale moves gold and an item between two characters, and a viewer only ever
 * writes their own (AGENTS.md "Auction house"). So nothing here touches a
 * second character: listing takes the item out of the seller's bag, buying
 * debits the buyer and hands them the item, and what the seller is owed
 * waits in a `proceeds` row until the seller collects it as their own write.
 *
 * The rules live here, once, and the `character` Edge Function applies them;
 * Postgres (sql/006_auction.sql) only guarantees that the result lands
 * atomically. It does not know what a fee or a minimum price is.
 */
import type { ContentRegistry } from "./content/loader.js";
import type { Character } from "./types.js";
import { grantGear } from "./character.js";

export type ListingStatus = "open" | "sold" | "cancelled" | "returned";

/** A listing as the engine needs to see it. Never loaded from disk. */
export interface AuctionListing {
  id: string;
  sellerId: string;
  gearId: string;
  price: number;
  status: ListingStatus;
  /** Epoch ms. */
  expiresAt: number;
}

/** Gold a sale left for its seller, not yet collected. */
export interface AuctionProceeds {
  id: string;
  gold: number;
}

/**
 * What the caller read from the database before dispatching.
 *
 * The engine is synchronous and does no I/O, so whoever hosts it loads this
 * first. Without one set, every auction command refuses - which is how the
 * standalone overlay and the file roster store have no auction house without
 * a stub.
 */
export interface AuctionContext {
  now: number;
  /** The caller's own listings that are not yet returned, and the one being bought. */
  listings: AuctionListing[];
  /** The caller's uncollected proceeds. */
  proceeds: AuctionProceeds[];
}

/** What a successful auction command asks the database to do, atomically with the character write. */
export type AuctionEffect =
  | { kind: "list"; gearId: string; price: number; expiresAt: number }
  | { kind: "cancel"; listingId: string }
  | { kind: "buy"; listingId: string; sellerId: string; price: number; fee: number; proceeds: number }
  | { kind: "collect"; proceedsIds: string[]; returnedListingIds: string[]; gold: number };

export type AuctionResult<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/** The whole price that is not the seller's: floored, so the sink never exceeds the rate. */
export function auctionFee(price: number, content: ContentRegistry): number {
  const rate = Math.min(0.95, Math.max(0, content.balance.economy.auctionFee));
  return Math.floor(price * rate);
}

/**
 * The lowest price a found item may be listed at: what recycling it pays.
 * Under that, listing would lose to scrapping and a mis-typed price would be
 * a gift; pricing it above it is the point of the auction.
 */
export function auctionMinPrice(gearId: string, content: ContentRegistry): number {
  return content.recycleValue(gearId, "loot");
}

export function isLive(listing: AuctionListing, now: number): boolean {
  return listing.status === "open" && listing.expiresAt > now;
}

export function listGear(
  character: Character,
  instanceId: string,
  price: number,
  ctx: AuctionContext,
  content: ContentRegistry,
): AuctionResult<{ effect: AuctionEffect; gearId: string }> {
  const idx = character.inventory.findIndex((i) => i.instanceId === instanceId);
  if (idx === -1) {
    const equipped = Object.values(character.equipment).some((g) => g?.instanceId === instanceId);
    return { ok: false, reason: equipped ? "Unequip it first" : "You don't own that item" };
  }
  const instance = character.inventory[idx]!;
  // An instance from before `source` existed counts as found, as it does for recycling.
  if ((instance.source ?? "loot") !== "loot") return { ok: false, reason: "Only found gear can be listed" };
  if (!Number.isSafeInteger(price) || price < 1) return { ok: false, reason: "Set a price in whole gold" };
  const min = auctionMinPrice(instance.gearId, content);
  if (price < min) return { ok: false, reason: `The lowest price for that is ${min}g` };

  const { auctionMaxListings, auctionListingDays } = content.balance.economy;
  const open = ctx.listings.filter((l) => l.sellerId === character.id && isLive(l, ctx.now)).length;
  if (open >= auctionMaxListings) return { ok: false, reason: `You can have ${auctionMaxListings} listings at once` };

  character.inventory.splice(idx, 1);
  return {
    ok: true,
    gearId: instance.gearId,
    effect: { kind: "list", gearId: instance.gearId, price, expiresAt: ctx.now + auctionListingDays * 86_400_000 },
  };
}

/** The item is not handed back here: it returns through `collectProceeds`, like an expiry. */
export function cancelListing(character: Character, listingId: string, ctx: AuctionContext): AuctionResult<{ effect: AuctionEffect }> {
  const listing = ctx.listings.find((l) => l.id === listingId && l.sellerId === character.id);
  if (!listing) return { ok: false, reason: "That is not your listing" };
  if (!isLive(listing, ctx.now)) return { ok: false, reason: "That listing is over" };
  return { ok: true, effect: { kind: "cancel", listingId } };
}

export function buyListing(
  character: Character,
  listingId: string,
  ctx: AuctionContext,
  content: ContentRegistry,
): AuctionResult<{ effect: AuctionEffect; gearId: string; price: number }> {
  const listing = ctx.listings.find((l) => l.id === listingId);
  if (!listing || !isLive(listing, ctx.now)) return { ok: false, reason: "That listing is gone" };
  if (listing.sellerId === character.id) return { ok: false, reason: "That is your own listing" };
  try {
    content.getGear(listing.gearId);
  } catch {
    return { ok: false, reason: "That item no longer exists" };
  }
  if (character.gold < listing.price) {
    return { ok: false, reason: `Costs ${listing.price}g - you have ${character.gold}g` };
  }
  const fee = auctionFee(listing.price, content);
  character.gold -= listing.price;
  // "loot", whatever it was before: a resale must not turn into a full shop refund.
  grantGear(character, listing.gearId, "loot");
  return {
    ok: true,
    gearId: listing.gearId,
    price: listing.price,
    effect: { kind: "buy", listingId, sellerId: listing.sellerId, price: listing.price, fee, proceeds: listing.price - fee },
  };
}

/**
 * Moves what the seller is owed into their own character: sale proceeds as
 * gold, and cancelled or expired listings back into the bag.
 */
export function collectProceeds(
  character: Character,
  ctx: AuctionContext,
): AuctionResult<{ effect: AuctionEffect; gold: number; items: number }> {
  const returning = ctx.listings.filter(
    (l) => l.sellerId === character.id && (l.status === "cancelled" || (l.status === "open" && l.expiresAt <= ctx.now)),
  );
  const gold = ctx.proceeds.reduce((sum, p) => sum + p.gold, 0);
  if (gold === 0 && returning.length === 0) return { ok: false, reason: "Nothing to collect" };
  character.gold += gold;
  for (const l of returning) grantGear(character, l.gearId, "loot");
  return {
    ok: true,
    gold,
    items: returning.length,
    effect: {
      kind: "collect",
      proceedsIds: ctx.proceeds.map((p) => p.id),
      returnedListingIds: returning.map((l) => l.id),
      gold,
    },
  };
}
