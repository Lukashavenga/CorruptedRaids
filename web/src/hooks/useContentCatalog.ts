import { useEffect, useState } from "react";
import type {
  ConsumableDefinition,
  DungeonDefinition,
  FightDefinition,
  RaidDefinition,
  GearDefinition,
  ShopView,
} from "../../../src/engine/types.js";
import { DEFAULT_BALANCE, type BalanceConfig } from "../../../src/engine/balance.js";

export interface ContentCatalog {
  gearById: Map<string, GearDefinition>;
  /** Everything openable, so the sim controls can offer a choice rather than a constant. */
  dungeons: DungeonDefinition[];
  raids: RaidDefinition[];
  /**
   * Every fight the overlay might have to draw, keyed by the id its combatants
   * carry — which is what the overlay looks an enemy up in.
   *
   * A combatant's id is `<fightId>#n`. For a dungeon that is the dungeon's own
   * id, because a dungeon IS a fight. For a raid it is `<raidId>:<roomId>`,
   * namespaced so a room called "the-toll-gate" cannot be mistaken for a
   * dungeon of the same name. Either way the entry carries the formation that
   * says where each body stands and the scene it stands in.
   */
  fightsById: Map<string, { fight: FightDefinition; background?: string; foreground?: string }>;
  consumablesById: Map<string, ConsumableDefinition>;
  /** Stocked ids with server-resolved prices — join against the maps above for details. */
  shop: ShopView;
  /**
   * The live tuning numbers.
   *
   * Here so the game can EXPLAIN itself in its own current terms. The role
   * picker tells a player what Skill does for them, and those sentences quote
   * `roles.tank.mitigationPerSkill` and friends directly — so a streamer who
   * retunes a number in balance.json changes the explanation with it, instead
   * of leaving prose that quietly stops being true.
   */
  balance: BalanceConfig;
}

const EMPTY: ContentCatalog = {
  gearById: new Map(),
  dungeons: [],
  raids: [],
  fightsById: new Map(),
  consumablesById: new Map(),
  shop: { gear: [], consumables: [] },
  // The in-code defaults until /content answers, so nothing renders "undefined
  // per point" for the half-second before it does.
  balance: DEFAULT_BALANCE,
};

/**
 * Indexes every drawable fight by the id its combatants will carry.
 *
 * A raid's rooms are in here alongside the dungeons. That is not a leak: the
 * catalogue is the POOL, and which room is behind which door is the roll —
 * `RaidView.doors` still withholds a door's kind until it is opened.
 */
function buildFightIndex(
  dungeons: DungeonDefinition[],
  raids: RaidDefinition[],
): ContentCatalog["fightsById"] {
  const out: ContentCatalog["fightsById"] = new Map();
  for (const d of dungeons) {
    out.set(d.id, { fight: d, background: d.background, foreground: d.foreground });
  }
  for (const raid of raids) {
    for (const room of raid.rooms) {
      if (room.fight) out.set(`${raid.id}:${room.id}`, { fight: room.fight, background: room.background });
    }
    out.set(`${raid.id}:${raid.boss.id}`, { fight: raid.boss.fight, background: raid.boss.background });
  }
  return out;
}

/**
 * Fetches the static content catalog once (GET /content — see src/server/
 * index.ts): gear definitions, consumables, and the shop's stock list. The
 * overlay uses it to resolve a gear item's `visual.tint`; the loadout screen
 * uses it to render item details and the shop.
 *
 * Separate from the live SSE snapshot on purpose: content definitions don't
 * change while the server is running, only character/run state does.
 */
/**
 * @param source Where to read content from. The overlay and admin run beside
 * the game server and want `/content`, which is live — a balance change shows
 * up on the next reload. The LOADOUT is hosted somewhere else entirely and has
 * no game server to ask, so it reads a static bundle shipped with the build
 * (see scripts/bundle-edge-content.ts). That bundle is the same one the Edge
 * Function validates against, which is the point: the screen and the rules
 * behind it cannot disagree.
 */
export function useContentCatalog(source = "/content"): ContentCatalog {
  const [catalog, setCatalog] = useState<ContentCatalog>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetch(source)
      .then((r) => r.json())
      .then(
        (data: {
          gear: GearDefinition[];
          dungeons?: DungeonDefinition[];
          raids?: RaidDefinition[];
          consumables?: ConsumableDefinition[];
          shop?: ShopView;
          balance?: BalanceConfig;
        }) => {
        if (cancelled) return;
        setCatalog({
          gearById: new Map(data.gear.map((g) => [g.id, g])),
          dungeons: data.dungeons ?? [],
          raids: data.raids ?? [],
          fightsById: buildFightIndex(data.dungeons ?? [], data.raids ?? []),
          consumablesById: new Map((data.consumables ?? []).map((c) => [c.id, c])),
          shop: data.shop ?? { gear: [], consumables: [] },
          balance: data.balance ?? DEFAULT_BALANCE,
        });
        },
      )
      .catch(() => {
        /* overlay still renders fine with no tints if this fails — see App.tsx fallback to base skin color */
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return catalog;
}
