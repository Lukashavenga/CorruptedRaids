import { EventEmitter } from "node:events";
import { compositionFactor, memberPower, partyRating } from "../partyStrength.js";
import { bandFor, effectiveRating, expandFight } from "../squad.js";
import type {
  AllocatableStat,
  RaidDefinition,
  RaidDoor,
  PathDirection,
  DoorKind,
  Character,
  CharacterAppearance,
  CombatResult,
  DungeonDefinition,
  GearSlot,
  Role,
  Stats,
} from "../types.js";
import { ALLOCATABLE_STATS, GEAR_SLOTS, PARTY_BANDS } from "../types.js";
import type { ContentRegistry } from "../content/loader.js";
import type { GameCommand } from "../commands/types.js";
import type { Rng } from "../rng.js";
import { randomInt } from "../rng.js";
import { Roster } from "../roster.js";
import {
  allocatePoints,
  buyConsumable,
  buyGear,
  grantChest,
  openChest,
  recycleGear,
  useConsumable,
  baseStatsFor,
  createCharacter,
  deriveCharacterStats,
  equipGear,
  grantGear,
  grantXp,
  respec,
  setAppearance,
  setRole,
  unequipGear,
} from "../character.js";
import { xpToNextLevel } from "../stats.js";
import { runCombat } from "../combat/resolver.js";
import { advanceRound, buffTotals, enterRoom, openDoor, roomFor, startRaid, type RaidRun } from "../raid.js";
import { dressSimViewer, kitForIndex, simViewers } from "../sim.js";
import { text, format } from "../../text/index.js";

export interface DispatchResult {
  ok: boolean;
  message: string;
  combat?: CombatResult;
  /**
   * The door a `choose_path` opened.
   *
   * Returned so the controller can route the run without re-reading engine
   * state: a fight door goes to combat, anything else goes to the reveal beat.
   * That decision belongs to whoever drives the state machine, and this is the
   * information it needs to make it.
   */
  door?: RaidDoor;
  /**
   * What an `open_chest` turned out to be.
   *
   * Returned rather than left to the caller to diff against the character,
   * because the reveal animation has to name the item at the moment the lid
   * pops and a diff would have to guess which of two identical instances is
   * the new one.
   */
  chest?: { instanceId: string; gearId: string };
}

/** A party member as the overlay needs to see them during the join window. */
export interface PartyMemberView {
  id: string;
  name: string;
  /**
   * How dangerous this character is, all in — gear, spent points and role.
   *
   * The number that decides what they fight, so it is the number they should
   * see. Level only counts how many points someone has been handed; Corruption
   * is what they did with them, and two level-40 characters can differ by a
   * factor of three.
   */
  corruption: number;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  role: Role;
  stats: Stats;
  appearance: CharacterAppearance;
  equipment: Record<string, { instanceId: string; gearId: string; gearName: string } | null>;
}

export interface DungeonRunView {
  id: string;
  name: string;
  recommendedLevel: number;
  /** The party's Corruption as it stands — the average member, composition-adjusted. */
  partyCorruption: number;
  /**
   * The level this party will actually meet, 1-based.
   *
   * Shown to viewers as "THE POORS - LEVEL 2" while they gather, because the
   * fight they get is decided by who turned up and how well equipped they are,
   * and a run that silently scales is a run nobody can feel themselves earning.
   */
  encounterLevel: number;
  /** Scene for the whole run, overriding the enemies' own. */
  background?: string;
  flavorText?: string;
  /** Enemy roster for this run, for the pre-fight preview. */
  enemies: { id: string; name: string; kind: string; maxHp: number }[];
}

/** One viewer's character, as the loadout screen needs it. */
export interface CharacterView {
  id: string;
  name: string;
  /** Their Corruption: gear, spent points and role, as one number. */
  corruption: number;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  role: Role;
  unspentPoints: number;
  allocated: Record<AllocatableStat, number>;
  spentPoints: number;
  /** Role base + allocated points, before gear. */
  baseStats: Stats;
  /** Effective stats, gear included — what combat uses. */
  stats: Stats;
  appearance: CharacterAppearance;
  /** False until the player has been through the appearance picker once. */
  appearanceChosen: boolean;
  equipment: Partial<Record<GearSlot, { instanceId: string; gearId: string } | null>>;
  inventory: { instanceId: string; gearId: string; recycleValue: number }[];
  /**
   * Unopened drops, newest first.
   *
   * `gearId` is deliberately NOT here. This payload reaches the browser, so
   * anything in it is readable in devtools — a chest whose contents ship with
   * the closed chest is a chest with the answer printed on the lid. The
   * `open_chest` result is what names the item.
   */
  chests: { id: string; from?: string; at: number }[];
  consumables: { id: string; count: number }[];
  /** How much one point adds per stat, so the screen can label its buttons. */
  perPoint: Record<AllocatableStat, number>;
}

export interface StateSnapshot {
  /** The dungeon currently open or being fought, or null when idle. */
  run: DungeonRunView | null;
  /** Everyone who has joined the current run. */
  party: PartyMemberView[];
  lastCombat: CombatResult | null;
  rosterSize: number;
  /** The raid in progress, if this run is a raid. */
  raid: RaidView | null;
}

/**
 * A raid as the overlay needs to see it.
 *
 * Doors report their `kind` ONLY once opened. An unopened door sends nothing
 * about what is behind it, because the overlay is a public broadcast — anything
 * put in this payload is readable by anyone watching the network tab, and a
 * choice whose answer is visible in devtools is not a choice.
 */
export interface RaidView {
  id: string;
  name: string;
  round: number;
  rounds: number;
  bossPending: boolean;
  doors: { direction: PathDirection; opened: boolean; kind?: DoorKind }[];
  buffs: { id: string; name: string; description: string }[];
  /**
   * The room the party is looking at, once a door has been opened onto it.
   *
   * Null at every other moment, which is what keeps this from leaking: a room
   * only appears here after it has been chosen, so the payload never describes
   * a door nobody has opened. `enemies` mirrors DungeonRunView.enemies so the
   * overlay can stand the room's occupants on the stage with the code it
   * already has, rather than inventing a second way to draw a fight.
   */
  revealed: RevealedRoomView | null;
}

/** A room, as the reveal scene needs it. */
export interface RevealedRoomView {
  id: string;
  name: string;
  description: string;
  kind: DoorKind;
  background?: string;
  /** Empty for a buff or an empty corridor. */
  enemies: { id: string; name: string; kind: string; maxHp: number }[];
  /** Set when the room holds a boon — which one the party just picked up. */
  buff?: { id: string; name: string; description: string };
  /** True for the last room. The overlay bills it differently. */
  boss: boolean;
}

/**
 * GameEngine owns the character roster + the current dungeon run, and is the
 * single place state mutates. It knows nothing about Twitch, HTTP, or the
 * CLI — those are all just callers of dispatch(). It emits "update" after
 * every command so any transport (the SSE broadcaster in src/server, a
 * future WS layer, tests) can react without the engine depending on them.
 */
export class GameEngine extends EventEmitter {
  readonly content: ContentRegistry;
  readonly roster = new Roster();
  private rng: Rng;

  /** The dungeon whose join window is open, or which is being fought. */
  openDungeon: DungeonDefinition | null = null;
  /**
   * The raid in progress, if this run is a raid.
   *
   * Deliberately a SIBLING of openDungeon rather than a variant of it. Both
   * being null is idle; exactly one is set during a run. Modelling a raid as a
   * kind of dungeon would have meant most of DungeonDefinition being
   * meaningless for it, and every consumer branching anyway.
   */
  openRaid: RaidDefinition | null = null;
  raidRun: RaidRun | null = null;
  /** Viewer ids that have joined the open run, in join order. */
  partyIds: string[] = [];
  lastCombat: CombatResult | null = null;

  constructor(content: ContentRegistry, rng: Rng) {
    super();
    this.content = content;
    this.rng = rng;
  }

  dispatch(command: GameCommand): DispatchResult {
    const result = this.handle(command);
    this.emit("update", { snapshot: this.getStateSnapshot(), result });
    return result;
  }

  /**
   * Whether ANY run is open — dungeon or raid.
   *
   * Joining, and the checks around it, care that there is a run to join, not
   * which kind it is. Every one of these used to test `openDungeon` alone,
   * which silently made a raid unjoinable: the join window ran, the doors were
   * up, and the party was always empty.
   */
  get hasOpenRun(): boolean {
    return this.openDungeon !== null || this.openRaid !== null;
  }

  get party(): Character[] {
    return this.partyIds.map((id) => this.roster.get(id)).filter((c): c is Character => c !== undefined);
  }

  private handle(command: GameCommand): DispatchResult {
    switch (command.type) {
      case "open_dungeon": {
        let def: DungeonDefinition;
        try {
          def = this.content.getDungeon(command.dungeonId);
        } catch {
          return { ok: false, message: format(text.errors.unknownDungeon, { id: command.dungeonId }) };
        }
        this.openDungeon = def;
        this.partyIds = [];
        this.lastCombat = null;
        return { ok: true, message: format(text.dungeon.opened, { name: def.name }) };
      }

      case "join_dungeon": {
        if (!this.hasOpenRun) return { ok: false, message: text.errors.noOpenRun };
        if (this.partyIds.includes(command.requestedBy)) {
          return { ok: false, message: text.errors.alreadyJoined };
        }
        // No party cap by design (§2.4) — the join window is the only gate.
        const character = this.roster.ensure(
          command.requestedBy,
          command.displayName ?? command.requestedBy,
          command.role ?? "dps",
          this.content.balance.economy.startingGold,
        );
        this.partyIds.push(character.id);
        return { ok: true, message: format(text.dungeon.joined, { name: character.name }) };
      }

      case "sim_join": {
        if (!this.hasOpenRun) return { ok: false, message: text.errors.noOpenRun };
        const wanted = Math.max(1, Math.min(command.count, 100));
        let added = 0;
        for (const viewer of simViewers(wanted + this.partyIds.length)) {
          if (added >= wanted) break;
          if (this.partyIds.includes(viewer.id)) continue;
          // Only a viewer who did not already exist gets dressed. Someone who
          // fought a previous run has their own gear on and re-rolling it every
          // time they rejoin would wipe what the last fight awarded them.
          const isNew = !this.roster.has(viewer.id);
          const character = this.roster.ensure(
            viewer.id,
            viewer.name,
            viewer.role,
            this.content.balance.economy.startingGold,
          );
          if (isNew && command.dress) {
            dressSimViewer(character, this.content, this.rng, kitForIndex(this.roster.size - 1));
          }
          this.partyIds.push(viewer.id);
          added += 1;
        }
        return { ok: true, message: format(text.dungeon.simJoined, { count: added }) };
      }

      case "start_dungeon": {
        // A raid does not start with a fight, it starts with a door. Without
        // this, the streamer's Start button resolved a dungeon fight against a
        // raid's (empty) enemy list and dumped the run straight into results.
        if (this.openRaid) return { ok: false, message: text.errors.raidInProgress };
        if (!this.openDungeon) return { ok: false, message: text.errors.noOpenRun };
        const party = this.party;
        if (party.length === 0) return { ok: false, message: text.errors.emptyParty };

        const enemies = this.content.expandDungeonEnemies(this.openDungeon, effectiveRating(partyRating(party, this.content), party.length));
        const combat = runCombat(party, enemies, this.content, this.content.balance, this.rng, {
          scaleToPartySize: this.openDungeon.scalesWithPartySize,
          lootFrom: this.openDungeon.name,
        });

        // Completion bonus: a dungeon-level reward on top of per-enemy XP and
        // gold. Survivors take it whole; the fallen take a share, on the same
        // reasoning as the casualty XP in the resolver — a run they helped win
        // and did not live through should still be worth having joined.
        //
        // The whole party is then paid a composition bonus. It rewards bringing
        // a tank and a healer rather than requiring it, which is the difference
        // between a chat that fills those roles and a chat that resents them.
        if (combat.outcome === "victory") {
          const dungeon = this.openDungeon;
          const { casualtyXpMultiplier, compositionBonusMax } = this.content.balance.rewards;
          const cover = compositionFactor(party.map((c) => c.role));
          // compositionFactor floors at 0.45 for a party with no support at
          // all, so it is rescaled here to 0..1 before paying out.
          const bonus = 1 + compositionBonusMax * Math.max(0, (cover - 0.45) / 0.55);

          for (const character of party) {
            const survived = combat.survivorIds.includes(character.id);
            const share = survived ? 1 : casualtyXpMultiplier;
            if (survived) {
              character.gold += randomInt(dungeon.completionGold[0], dungeon.completionGold[1], this.rng);
            }
            // xpRate: see balance.ts.
            const xp = Math.round(dungeon.completionXp * share * bonus * this.content.balance.progression.xpRate);
            for (const level of grantXp(character, xp, this.content.balance)) {
              combat.events.push({ type: "levelUp", characterId: character.id, newLevel: level });
            }
          }
        }

        this.lastCombat = combat;
        const key = combat.outcome === "victory" ? text.dungeon.cleared : text.dungeon.wiped;
        return { ok: true, message: format(key, { name: this.openDungeon.name }), combat };
      }

      case "reset_dungeon": {
        this.openDungeon = null;
        this.openRaid = null;
        this.raidRun = null;
        this.partyIds = [];
        this.lastCombat = null;
        return { ok: true, message: text.dungeon.reset };
      }

      // --- raids ------------------------------------------------------------
      case "open_raid": {
        const def = this.content.getRaid(command.raidId);
        if (!def) return { ok: false, message: format(text.errors.unknownRaid, { id: command.raidId }) };
        this.openDungeon = null;
        this.openRaid = def;
        this.raidRun = startRaid(def, this.rng);
        this.partyIds = [];
        this.lastCombat = null;
        return { ok: true, message: format(text.dungeon.opened, { name: def.name }) };
      }

      case "choose_path": {
        const def = this.openRaid;
        const run = this.raidRun;
        if (!def || !run) return { ok: false, message: text.errors.noOpenRun };
        if (run.bossPending) return { ok: false, message: text.errors.bossAwaits };
        if (this.party.length === 0) return { ok: false, message: text.errors.emptyParty };

        const door = openDoor(run, def, command.direction);
        if (!door) return { ok: false, message: text.errors.noSuchDoor };

        // Opening a door no longer fights what is behind it. It reveals the
        // room; the controller holds that on screen; `enter_room` runs the
        // fight if there is one. A door that opens straight into combat gave
        // the audience no idea what the party had just walked into — the whole
        // point of choosing a direction is finding out what was down it.
        const room = roomFor(def, door.roomId);
        const detail =
          door.kind === "buff"
            ? format(text.raid.buffFound, { name: run.buffs[run.buffs.length - 1]?.name ?? "" })
            : door.kind === "fight"
              ? format(text.raid.roomAhead, { name: room?.name ?? def.name })
              : text.raid.clear;
        return { ok: true, message: detail, door };
      }

      case "enter_room": {
        const def = this.openRaid;
        const run = this.raidRun;
        if (!def || !run) return { ok: false, message: text.errors.noOpenRun };
        if (this.party.length === 0) return { ok: false, message: text.errors.emptyParty };

        const roomId = run.pendingRoomId;
        const room = roomId ? roomFor(def, roomId) : undefined;
        enterRoom(run);
        // Nothing to walk into is not an error — a boon and an empty corridor
        // both reveal and then simply end, and the controller calls this for
        // every room rather than deciding the shape of the content itself.
        if (!room?.fight) return { ok: true, message: text.raid.clear };

        const enemies = expandFight(
          room.fight,
          // Namespaced by raid so a room id can collide with a dungeon id
          // without the overlay looking up the wrong formation.
          `${def.id}:${room.id}`,
          room.name,
          effectiveRating(partyRating(this.party, this.content), this.party.length),
          this.content.balance.bandStatScale,
        );
        const combat = runCombat(this.party, enemies, this.content, this.content.balance, this.rng, {
          partyBuffs: buffTotals(run),
          // The ROOM, not the raid: "The Watch House" is where a chest came
          // from in a way "The Long Road" is not.
          lootFrom: room.name,
        });
        this.lastCombat = combat;
        return { ok: true, message: text.raid.ambush, combat };
      }

      case "start_boss": {
        const def = this.openRaid;
        const run = this.raidRun;
        if (!def || !run) return { ok: false, message: text.errors.noOpenRun };
        if (!run.bossPending) return { ok: false, message: text.errors.roundsRemain };
        if (this.party.length === 0) return { ok: false, message: text.errors.emptyParty };

        // The boss is a fight like any other — it just usually holds one body.
        // The multipliers are content, so a harder raid tier is a number change
        // rather than a new fight.
        enterRoom(run);
        const bossEnemies = expandFight(
          def.boss.fight,
          `${def.id}:${def.boss.id}`,
          def.boss.name,
          effectiveRating(partyRating(this.party, this.content), this.party.length),
          this.content.balance.bandStatScale,
        );
        if (bossEnemies.length === 0) return { ok: false, message: text.errors.noOpenRun };

        const combat = runCombat(this.party, bossEnemies, this.content, this.content.balance, this.rng, {
          partyBuffs: buffTotals(run),
          lootFrom: def.boss.name,
          enemyMultipliers: { hp: def.boss.hpMultiplier, atk: def.boss.atkMultiplier },
          // Party scaling ON for a boss.
          //
          // It was OFF, and that was right when initiative was a coin flip
          // between the two sides: the party's output was constant regardless
          // of size, so scaling a lone boss up made it unbeatable at every
          // party size. Initiative is now drawn from every combatant at once,
          // which flips the problem — six players out-act a single boss six to
          // one and a 3x boss became Trivial. Scaling is the compensation for
          // being outnumbered, and it belongs here after all.
          scaleToPartySize: true,
        });

        if (combat.outcome === "victory") {
          for (const id of combat.survivorIds) {
            const character = this.roster.get(id);
            if (!character) continue;
            character.gold += randomInt(def.completionGold[0], def.completionGold[1], this.rng);
            for (const level of grantXp(character, def.completionXp, this.content.balance)) {
              combat.events.push({ type: "levelUp", characterId: character.id, newLevel: level });
            }
          }
        }

        this.lastCombat = combat;
        const key = combat.outcome === "victory" ? text.dungeon.cleared : text.dungeon.wiped;
        return { ok: true, message: format(key, { name: def.name }), combat };
      }

      case "equip_gear": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        const result = equipGear(character, command.instanceId, this.content);
        return { ok: result.ok, message: result.ok ? text.gear.equipped : result.reason ?? text.errors.cannotEquip };
      }

      case "unequip_gear": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        const result = unequipGear(character, command.slot);
        return { ok: result.ok, message: result.ok ? text.gear.unequipped : result.reason ?? text.errors.cannotEquip };
      }

      case "allocate_points": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        const result = allocatePoints(character, command.stat, command.amount);
        return { ok: result.ok, message: result.ok ? text.loadout.pointsSpent : result.reason ?? text.errors.cannotAllocate };
      }

      case "respec": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        const result = respec(character);
        return { ok: result.ok, message: result.ok ? text.loadout.respecDone : result.reason ?? text.errors.cannotAllocate };
      }

      case "set_role": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        const result = setRole(character, command.role);
        return { ok: result.ok, message: result.ok ? format(text.loadout.roleSet, { role: text.role[command.role] }) : result.reason ?? "" };
      }

      case "set_appearance": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        const result = setAppearance(character, command.appearance);
        return { ok: result.ok, message: result.ok ? text.loadout.appearanceSet : result.reason ?? "" };
      }

      case "ensure_character": {
        const existing = this.roster.get(command.requestedBy);
        if (existing) return { ok: true, message: format(text.loadout.characterReady, { name: existing.name }) };
        const created = this.roster.ensure(
          command.requestedBy,
          command.displayName ?? command.requestedBy,
          command.role ?? "dps",
          this.content.balance.economy.startingGold,
        );
        return { ok: true, message: format(text.loadout.characterCreated, { name: created.name }) };
      }

      case "grant_gear": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        try {
          this.content.getGear(command.gearId);
        } catch {
          return { ok: false, message: format(text.errors.unknownGear, { id: command.gearId }) };
        }
        grantGear(character, command.gearId);
        return { ok: true, message: format(text.gear.granted, { gearId: command.gearId, name: character.name }) };
      }

      case "grant_chest": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        // Validated before sealing: a chest holding an id the catalogue does
        // not know would throw on the one click it exists for.
        //
        // CAUGHT, not tested. `getGear` THROWS on an unknown id rather than
        // returning undefined, so `if (!def)` is dead code — which is exactly
        // how a typo'd id got reported to the caller as "Missing command.type".
        let def;
        try {
          def = this.content.getGear(command.gearId);
        } catch {
          return { ok: false, message: format(text.errors.unknownGear, { id: command.gearId }) };
        }
        grantChest(character, command.gearId, command.from);
        return { ok: true, message: format(text.gear.granted, { gearId: def.name, name: character.name }) };
      }

      case "open_chest": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        const opened = openChest(character, command.chestId);
        // A chest that is already gone answers ok:false with a calm message
        // rather than an error — a double-tap on a phone sends this twice and
        // the second arrival is the normal case, not a fault.
        if (!opened.ok) return { ok: false, message: text.errors.noSuchChest };
        const def = this.content.getGear(opened.gearId);
        return {
          ok: true,
          message: format(text.loadout.chest.opened, { name: def.name }),
          // The reveal needs to name the item, and this is the only moment the
          // engine and the screen both know which instance the chest became.
          chest: { instanceId: opened.instance.instanceId, gearId: opened.gearId },
        };
      }

      case "recycle_gear": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        const result = recycleGear(character, command.instanceId, this.content);
        return {
          ok: result.ok,
          message: result.ok ? format(text.shop.recycled, { gold: result.gold ?? 0 }) : result.reason ?? text.errors.cannotRecycle,
        };
      }

      case "buy_gear": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        let name: string;
        try {
          name = this.content.getGear(command.gearId).name;
        } catch {
          return { ok: false, message: format(text.errors.unknownGear, { id: command.gearId }) };
        }
        const result = buyGear(character, command.gearId, this.content);
        return {
          ok: result.ok,
          message: result.ok ? format(text.shop.bought, { name, gold: result.cost ?? 0 }) : result.reason ?? text.errors.cannotBuy,
        };
      }

      case "buy_consumable": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        let name: string;
        try {
          name = this.content.getConsumable(command.consumableId).name;
        } catch {
          return { ok: false, message: format(text.errors.unknownConsumable, { id: command.consumableId }) };
        }
        const result = buyConsumable(character, command.consumableId, this.content);
        return {
          ok: result.ok,
          message: result.ok ? format(text.shop.bought, { name, gold: result.cost ?? 0 }) : result.reason ?? text.errors.cannotBuy,
        };
      }

      case "use_consumable": {
        const character = this.roster.get(command.requestedBy);
        if (!character) return { ok: false, message: text.errors.unknownCharacter };
        try {
          this.content.getConsumable(command.consumableId);
        } catch {
          return { ok: false, message: format(text.errors.unknownConsumable, { id: command.consumableId }) };
        }
        const result = useConsumable(character, command.consumableId, this.content, this.content.balance);
        if (!result.ok) return { ok: false, message: result.reason ?? text.errors.cannotUse };
        const gained = result.levelsGained ?? [];
        const message =
          result.gold !== undefined
            ? format(text.shop.usedGold, { gold: result.gold })
            : gained.length > 0
              ? format(text.shop.usedXpLevelled, { xp: result.xp ?? 0, level: gained[gained.length - 1]! })
              : format(text.shop.usedXp, { xp: result.xp ?? 0 });
        return { ok: true, message };
      }

      case "reset_roster": {
        this.roster.clear();
        this.openDungeon = null;
        this.partyIds = [];
        this.lastCombat = null;
        return { ok: true, message: text.dungeon.rosterReset };
      }

      default: {
        // The compile-time half: adding a GameCommand variant without a case
        // above is a type error here, which is what this assignment is for.
        const _exhaustive: never = command;
        // The RUNTIME half, and it is not decoration. `return _exhaustive`
        // returns the command object itself, so an unknown `type` answered
        // 200 with the request echoed back — a silent success. That is
        // survivable while a human is typing curl and a real hazard once a
        // chat bot is the caller: a renamed or misspelled command would look
        // like it worked, every time, forever.
        void _exhaustive;
        return {
          ok: false,
          message: format(text.errors.unknownCommand, {
            type: String((command as { type?: unknown }).type ?? "(missing)"),
          }),
        };
      }
    }
  }

  private viewOf(character: Character): PartyMemberView {
    const equipment: PartyMemberView["equipment"] = {};
    for (const [slot, instance] of Object.entries(character.equipment)) {
      equipment[slot] = instance
        ? { instanceId: instance.instanceId, gearId: instance.gearId, gearName: this.content.getGear(instance.gearId).name }
        : null;
    }
    return {
      id: character.id,
      name: character.name,
      corruption: memberPower(character, this.content),
      level: character.level,
      xp: character.xp,
      xpToNext: xpToNextLevel(character.level),
      gold: character.gold,
      role: character.role,
      stats: deriveCharacterStats(character, this.content),
      appearance: character.appearance,
      equipment,
    };
  }

  getStateSnapshot(): StateSnapshot {
    const dungeon = this.openDungeon;
    let run: DungeonRunView | null = null;
    if (dungeon) {
      const seen = new Map<string, number>();
      run = {
        id: dungeon.id,
        name: dungeon.name,
        recommendedLevel: dungeon.recommendedLevel,
        partyCorruption: partyRating(this.party, this.content),
        encounterLevel:
          PARTY_BANDS.indexOf(
            bandFor(effectiveRating(partyRating(this.party, this.content), this.party.length)),
          ) + 1,
        background: dungeon.background,
        flavorText: dungeon.flavorText,
        enemies: this.content.expandDungeonEnemies(dungeon, effectiveRating(partyRating(this.party, this.content), this.party.length)).map((def, _i, all) => {
          const n = (seen.get(def.id) ?? 0) + 1;
          seen.set(def.id, n);
          return {
            id: `${def.id}#${n}`,
            name: all.filter((e) => e.id === def.id).length > 1 ? `${def.name} ${n}` : def.name,
            kind: def.kind,
            maxHp: def.stats.hp,
          };
        }),
      };
    }

    const raidRun = this.raidRun;
    const raid: RaidView | null = raidRun
      ? {
          id: raidRun.raidId,
          name: raidRun.name,
          round: raidRun.round,
          rounds: raidRun.rounds,
          bossPending: raidRun.bossPending,
          // `kind` is withheld until the door is opened — see RaidView.
          doors: raidRun.doors.map((d) => ({
            direction: d.direction,
            opened: d.opened,
            ...(d.opened ? { kind: d.kind } : {}),
          })),
          buffs: raidRun.buffs.map((b) => ({ id: b.id, name: b.name, description: b.description })),
          revealed: this.revealedRoom(raidRun),
        }
      : null;

    return {
      run,
      party: this.party.map((c) => this.viewOf(c)),
      lastCombat: this.lastCombat,
      rosterSize: this.roster.size,
      raid,
    };
  }

  /**
   * The room currently on screen, or null.
   *
   * Its enemies are expanded here so the reveal shows the SAME bodies the
   * fight will field — same stats, same count, same scaling for this party's
   * size. Anything less and the reveal would be an illustration rather than a
   * look at what is actually waiting, and the audience would learn to ignore
   * it.
   */
  private revealedRoom(run: RaidRun): RevealedRoomView | null {
    const def = this.openRaid;
    if (!def) return null;
    // The boss is pending from the moment the last round ends, but it is only
    // REVEALED once the controller walks the party up to its door.
    const roomId = run.pendingRoomId;
    if (!roomId) return null;
    const room = roomFor(def, roomId);
    if (!room) return null;

    const seen = new Map<string, number>();
    const enemies = room.fight
      ? expandFight(
          room.fight,
          `${def.id}:${room.id}`,
          room.name,
          effectiveRating(partyRating(this.party, this.content), this.party.length),
          this.content.balance.bandStatScale,
        ).map((enemy, _i, all) => {
          const n = (seen.get(enemy.id) ?? 0) + 1;
          seen.set(enemy.id, n);
          return {
            id: `${enemy.id}#${n}`,
            name: all.filter((e) => e.id === enemy.id).length > 1 ? `${enemy.name} ${n}` : enemy.name,
            kind: enemy.kind,
            maxHp: enemy.stats.hp,
          };
        })
      : [];

    const buff = room.kind === "buff" ? run.buffs[run.buffs.length - 1] : undefined;
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      kind: room.kind,
      background: room.background,
      enemies,
      ...(buff ? { buff: { id: buff.id, name: buff.name, description: buff.description } } : {}),
      boss: room.id === def.boss.id,
    };
  }

  /** XP needed for a character's next level - surfaced for the overlay's XP bar. */
  xpToNext(character: Character): number {
    return xpToNextLevel(character.level);
  }

  /**
   * Everything the loadout screen (§2.6) needs about one viewer's character.
   *
   * Gear is returned as ids only; the client joins them against GET /content
   * the same way the overlay does, rather than this duplicating gear
   * definitions into every response.
   *
   * Both stat blocks are included on purpose: `baseStats` is role + spent
   * points, `stats` adds equipped gear on top. The screen needs the pair to
   * show what a piece of gear is actually contributing.
   */
  getCharacterView(viewerId: string): CharacterView | null {
    const character = this.roster.get(viewerId);
    if (!character) return null;

    const equipment: CharacterView["equipment"] = {};
    for (const slot of GEAR_SLOTS) {
      const instance = character.equipment[slot];
      equipment[slot] = instance ? { instanceId: instance.instanceId, gearId: instance.gearId } : null;
    }

    return {
      id: character.id,
      name: character.name,
      corruption: memberPower(character, this.content),
      level: character.level,
      xp: character.xp,
      xpToNext: xpToNextLevel(character.level),
      gold: character.gold,
      role: character.role,
      unspentPoints: character.unspentPoints,
      allocated: { ...character.allocated },
      spentPoints: ALLOCATABLE_STATS.reduce((sum, stat) => sum + character.allocated[stat], 0),
      baseStats: baseStatsFor(character, this.content.balance),
      stats: deriveCharacterStats(character, this.content),
      appearance: character.appearance,
      appearanceChosen: character.appearanceChosen === true,
      equipment,
      inventory: character.inventory.map((i) => ({
        instanceId: i.instanceId,
        gearId: i.gearId,
        // Recycle payout is computed server-side so the screen never has to
        // reimplement the pricing rule and drift from it.
        recycleValue: this.content.recycleValue(i.gearId),
      })),
      // Newest first: the chest you just earned is the one you came to open.
      // `gearId` is stripped here — see CharacterView.chests.
      chests: [...(character.chests ?? [])]
        .sort((a, b) => b.at - a.at)
        .map((c) => ({ id: c.id, at: c.at, ...(c.from ? { from: c.from } : {}) })),
      consumables: Object.entries(character.consumables).map(([id, count]) => ({ id, count })),
      perPoint: { ...this.content.balance.progression.perPoint },
    };
  }
}
