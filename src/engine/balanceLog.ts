import type { BalanceConfig } from "./balance.js";
import { deriveCharacterStats } from "./character.js";
import type { ContentRegistry } from "./content/loader.js";
import { memberPower } from "./partyStrength.js";
import { bandFor, statScaleFor } from "./squad.js";
import {
  PARTY_BANDS,
  type AllocatableStat,
  type Character,
  type CombatEvent,
  type CombatOutcome,
  type CombatResult,
  type FightDefinition,
  type FightEndReason,
  type GearSlot,
  type PartyBand,
  type Rarity,
  type Role,
  type Stats,
} from "./types.js";

/**
 * What the balance log records, and how a record is built.
 *
 * The simulator answers "is the engine correct". It cannot answer what real
 * viewers did with the engine - whether tanks put points into Skill, how often
 * the timer ends a fight, how much gold a night pays - because its reference
 * party spends exactly as designed. This is the other half: one record per
 * fight, derived from the CombatResult the resolver already returns.
 *
 * PURE, and in the engine on purpose. The record is built where the fight
 * happens (it needs what the engine knew going in - the band, the scale in
 * force, the party's pre-fight builds) and handed to whoever listens on the
 * engine's "fight" event. Where it is WRITTEN is src/server/balanceLog.ts's
 * business; the engine never does I/O, which is also why the standalone
 * overlay, with no listener, logs nothing.
 */

/**
 * Which numbers a record belongs in.
 *
 * `sim`: any member was a `sim_join` viewer (ids start `sim:` - src/engine/
 * sim.ts). `sandbox`: stamped by the SERVER for the whole process, because
 * only it knows it was started against a throwaway roster. `live`: the rest.
 */
export type LogSource = "live" | "sim" | "sandbox";

/** An id that marks a simulated viewer. The one marker sim characters carry. */
export const SIM_ID_PREFIX = "sim:";
export const isSimId = (id: string): boolean => id.startsWith(SIM_ID_PREFIX);

export type FightKind = "dungeon" | "raid_room" | "raid_boss";

export interface FightMemberRecord {
  characterId: string;
  role: Role;
  level: number;
  /** ratePoints of the derived stats - the number the matchmaker read. */
  corruption: number;
  allocated: Record<AllocatableStat, number>;
  /** Stats after gear and points, before the fight's role rarity and buffs. */
  stats: Stats;
  gear: Partial<Record<GearSlot, string>>;
  damageDealt: number;
  damageTaken: number;
  hitsTaken: number;
  healsGiven: number;
  healsReceived: number;
  taunts: number;
  survived: boolean;
  /** Tick the member went down, or null if they never did. */
  deathTick: number | null;
  xp: number;
  gold: number;
  levelUps: number[];
  loot: { gearId: string; rarity: Rarity }[];
}

export interface FightRecord {
  /** Unique per fight, so a retried write cannot duplicate a row. */
  id: string;
  at: string;
  source: LogSource;
  runId: string;
  kind: FightKind;
  dungeonId: string | null;
  raidId: string | null;
  roomId: string | null;
  /** 1..6, the party's level: `weak` is 1. */
  level: number;
  band: PartyBand;
  partyRating: number;
  headcount: number;
  roleCounts: Record<Role, number>;
  enemyCount: number;
  /** The hp/atk multiplier the level put on every body (expandFight). */
  statScale: number;
  partyScaleHp: number;
  partyScaleAtk: number;
  /** Raid boss only. */
  bossHpMult: number | null;
  bossAtkMult: number | null;
  outcome: CombatOutcome;
  ticks: number;
  tickCeiling: number;
  endReason: FightEndReason;
  /** `<fight>.<balance>`: short hashes of what was played. See fingerprintOf. */
  fingerprint: string;
  /** The full event log, kept for one fight in `balanceLog.rawEventsOneIn`. */
  events: CombatEvent[] | null;
  members: FightMemberRecord[];
}

export type EconomyKind = "buy_gear" | "buy_consumable" | "recycle_gear" | "combine_gear" | "open_chest" | "level_up";

/** One thing that moved gold or gear outside a fight. */
export interface EconomyRecord {
  at: string;
  source: LogSource;
  characterId: string;
  kind: EconomyKind;
  /** Signed: a purchase is negative, a recycle positive. */
  goldDelta: number;
  gearId: string | null;
  rarity: Rarity | null;
  /** `shop` / `loot` for a recycle - the thing the payout depends on. */
  gearSource: string | null;
  /** New level, for a level_up. */
  level: number | null;
  /** Fight the level-up came out of; null for everything else. */
  fightId: string | null;
}

/** What the engine knows at the moment a command succeeds; the rest is stamped on. */
export type EconomyDraft = Omit<EconomyRecord, "at" | "source">;

/**
 * The `economy_events` row for a record (sql/005_balance_log.sql).
 *
 * Here and not beside the writer because TWO things write it - the game server
 * and the loadout's Edge Function - and a column list written twice is how
 * they stop agreeing.
 */
export function economyRow(e: EconomyRecord): Record<string, unknown> {
  return {
    created_at: e.at,
    source: e.source,
    character_id: e.characterId,
    kind: e.kind,
    gold_delta: e.goldDelta,
    gear_id: e.gearId,
    rarity: e.rarity,
    gear_source: e.gearSource,
    level: e.level,
    fight_id: e.fightId,
  };
}

// --- fingerprint ------------------------------------------------------------

/** JSON with sorted keys, so two equal objects hash equal whatever order they were built in. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
    .join(",")}}`;
}

/** cyrb53: 53 bits, no dependency, same answer in Node, Deno and a browser. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/**
 * A short hash of the fight as authored plus `balance.json` as played.
 *
 * Balance is retuned often and a reading only means something next to the
 * numbers it was taken under. Two halves, so a report can tell "the dungeon
 * changed" from "the economy changed". `balanceLog` and `_comment` are left
 * out: turning the log's own knobs is not a rebalance.
 */
export function fingerprintOf(fight: unknown, balance: BalanceConfig): string {
  const { balanceLog: _log, ...rest } = balance as BalanceConfig & { balanceLog?: unknown };
  const dropComments = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(dropComments);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => k !== "_comment")
          .map(([k, x]) => [k, dropComments(x)]),
      );
    }
    return v;
  };
  return `${hash53(stable(dropComments(fight)))}.${hash53(stable(dropComments(rest)))}`;
}

// --- building a record ------------------------------------------------------

/** A member as they were BEFORE the fight; combat pays out and levels them after. */
export interface MemberSnapshot {
  characterId: string;
  role: Role;
  level: number;
  corruption: number;
  allocated: Record<AllocatableStat, number>;
  stats: Stats;
  gear: Partial<Record<GearSlot, string>>;
}

export function snapshotParty(party: readonly Character[], content: ContentRegistry): MemberSnapshot[] {
  return party.map((c) => {
    const gear: Partial<Record<GearSlot, string>> = {};
    for (const [slot, instance] of Object.entries(c.equipment) as [GearSlot, { gearId: string } | undefined][]) {
      if (instance) gear[slot] = instance.gearId;
    }
    return {
      characterId: c.id,
      role: c.role,
      level: c.level,
      corruption: memberPower(c, content),
      allocated: { ...c.allocated },
      stats: deriveCharacterStats(c, content),
      gear,
    };
  });
}

export interface FightContext {
  runId: string;
  kind: FightKind;
  dungeonId?: string;
  raidId?: string;
  roomId?: string;
  /** The fight as authored, for the fingerprint and the stat scale. */
  fight: FightDefinition;
  /** The strength the squad was expanded at (effectiveRating of the party). */
  strength: number;
  enemyCount: number;
  /** Whether party scaling applied - runCombat's `scaleToPartySize !== false`. */
  scaledToParty: boolean;
  partyScale: { hp: number; atk: number };
  boss?: { hp: number; atk: number };
  /** XP and gold paid outside the resolver (completion bonuses), by character id. */
  extras: Map<string, { xp: number; gold: number }>;
}

export function buildFightRecord(
  ctx: FightContext,
  members: MemberSnapshot[],
  combat: CombatResult,
  content: ContentRegistry,
  now: Date,
  rng: () => number = Math.random,
): FightRecord {
  const balance = content.balance;
  const partyIds = new Set(combat.combatants.filter((c) => c.side === "party").map((c) => c.id));

  const rows = new Map<string, FightMemberRecord>();
  for (const m of members) {
    rows.set(m.characterId, {
      ...m,
      damageDealt: 0,
      damageTaken: 0,
      hitsTaken: 0,
      healsGiven: 0,
      healsReceived: 0,
      taunts: 0,
      survived: combat.survivorIds.includes(m.characterId),
      deathTick: null,
      xp: 0,
      gold: 0,
      levelUps: [],
      loot: [],
    });
  }

  // One pass over the log. The tick is the last `tick` event seen, which is
  // when a `down` happened.
  let tick = 0;
  for (const e of combat.events) {
    switch (e.type) {
      case "tick":
        tick = e.n;
        break;
      case "attack": {
        const dealer = rows.get(e.actorId);
        if (dealer) dealer.damageDealt += e.damage;
        const taker = rows.get(e.targetId);
        if (taker) {
          taker.damageTaken += e.damage;
          taker.hitsTaken += 1;
        }
        break;
      }
      case "heal": {
        // An enemy healing itself is not a party number.
        if (!partyIds.has(e.actorId)) break;
        const healer = rows.get(e.actorId);
        if (healer) healer.healsGiven += e.amount;
        const healed = rows.get(e.targetId);
        if (healed) healed.healsReceived += e.amount;
        break;
      }
      case "ability": {
        if (e.abilityId === "taunt") {
          const tank = rows.get(e.actorId);
          if (tank) tank.taunts += 1;
        }
        break;
      }
      case "down": {
        const row = rows.get(e.combatantId);
        if (row && row.deathTick === null) row.deathTick = tick;
        break;
      }
      case "loot": {
        rows.get(e.characterId)?.loot.push({ gearId: e.gearId, rarity: e.rarity });
        break;
      }
      case "reward": {
        const row = rows.get(e.characterId);
        if (row) {
          row.xp += e.xp;
          row.gold += e.gold;
        }
        break;
      }
      case "levelUp": {
        rows.get(e.characterId)?.levelUps.push(e.newLevel);
        break;
      }
      default:
        break;
    }
  }
  for (const [id, extra] of ctx.extras) {
    const row = rows.get(id);
    if (row) {
      row.xp += extra.xp;
      row.gold += extra.gold;
    }
  }

  const band = bandFor(ctx.strength);
  const roleCounts: Record<Role, number> = { tank: 0, healer: 0, dps: 0 };
  for (const m of members) roleCounts[m.role] += 1;

  const oneIn = balance.balanceLog.rawEventsOneIn;
  const keepEvents = oneIn > 0 && rng() * oneIn < 1;
  const sim = members.some((m) => isSimId(m.characterId));

  return {
    id: `${now.getTime().toString(36)}-${Math.floor(rng() * 36 ** 6).toString(36).padStart(6, "0")}`,
    at: now.toISOString(),
    source: sim ? "sim" : "live",
    runId: ctx.runId,
    kind: ctx.kind,
    dungeonId: ctx.dungeonId ?? null,
    raidId: ctx.raidId ?? null,
    roomId: ctx.roomId ?? null,
    level: PARTY_BANDS.indexOf(band) + 1,
    band,
    partyRating: ctx.strength,
    headcount: members.length,
    roleCounts,
    enemyCount: ctx.enemyCount,
    statScale: statScaleFor(ctx.fight, ctx.strength, balance.bandStatScale),
    partyScaleHp: ctx.scaledToParty ? ctx.partyScale.hp : 1,
    partyScaleAtk: ctx.scaledToParty ? ctx.partyScale.atk : 1,
    bossHpMult: ctx.boss?.hp ?? null,
    bossAtkMult: ctx.boss?.atk ?? null,
    outcome: combat.outcome,
    ticks: combat.ticks,
    tickCeiling: combat.tickCeiling,
    endReason: combat.endReason,
    fingerprint: fingerprintOf({ fight: ctx.fight, boss: ctx.boss ?? null }, balance),
    events: keepEvents ? combat.events : null,
    members: [...rows.values()],
  };
}
