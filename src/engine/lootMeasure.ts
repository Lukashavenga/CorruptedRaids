/**
 * How many items a set of loot chances actually produces, MEASURED.
 *
 * Section 2 of `npm run simulate:progression` is the reference: twelve viewers,
 * twenty runs at each dungeon, the party carrying its progress between runs and
 * wearing what it finds. This is that loop with the chances as an input, so the
 * admin's Loot tab can show what a dial setting does before it is saved.
 * Nothing here predicts anything from a formula (AGENTS.md section 6) -
 * drops-per-roll depends on boss fights, party survival and the loot tables.
 *
 * The seed is fixed so two readings of the same setting agree. It does not make
 * two DIFFERENT settings comparable run for run, since loot rolls consume the
 * same stream the fights do; the difference between settings is the signal.
 */
import type { ContentRegistry } from "./content/loader.js";
import type { LootChances } from "./content/schemas.js";
import { GameEngine } from "./state/gameEngine.js";
import { mulberry32 } from "./rng.js";
import { spendPoints } from "./difficulty.js";
import { equipGear, gearUsableBy } from "./character.js";
import type { Character } from "./types.js";

/** Section 2's party and night. */
export const LOOT_MEASURE_VIEWERS = 12;
export const LOOT_MEASURE_RUNS = 20;
/** "A night" for the readout: about twelve runs a viewer. */
export const RUNS_PER_NIGHT = 12;
const SEED = 7;

export interface LootDungeonReading {
  dungeonId: string;
  name: string;
  runs: number;
  drops: number;
  perViewerPerRun: number;
}

export interface LootReading {
  chances: LootChances;
  viewers: number;
  dungeons: LootDungeonReading[];
  /** Mean over dungeons. */
  perViewerPerRun: number;
  /** Per viewer, over `runsPerNight` runs. */
  perViewerPerNight: number;
  /** Carried in the reading because the browser may not import this module's values (it pulls in the engine). */
  runsPerNight: number;
}

/** Spend the points and wear what dropped, as a player would. Same as the report. */
function equipEverything(content: ContentRegistry, character: Character): void {
  if (character.unspentPoints > 0) spendPoints(character, character.role, content.balance);
  for (const item of [...character.inventory]) {
    const def = content.getGear(item.gearId);
    const worn = character.equipment[def.slot];
    if (worn && content.getGear(worn.gearId).rarity >= def.rarity) continue;
    if (!gearUsableBy(def, character).ok) continue;
    equipGear(character, item.instanceId, content);
  }
}

export function measureLoot(content: ContentRegistry, chances: LootChances): LootReading {
  // A view of the registry with only the balance replaced. The real one is
  // never touched, so a measurement cannot leak into a run that is live.
  const draft = Object.create(content) as ContentRegistry;
  draft.balance = { ...content.balance, rewards: { ...content.balance.rewards, ...chances } };

  const dungeons: LootDungeonReading[] = [];
  for (const dungeon of content.listDungeons()) {
    const engine = new GameEngine(draft, mulberry32(SEED));
    let runs = 0;
    let drops = 0;
    for (let r = 0; r < LOOT_MEASURE_RUNS; r += 1) {
      engine.dispatch({ type: "reset_dungeon" });
      engine.dispatch({ type: "open_dungeon", dungeonId: dungeon.id });
      engine.dispatch({ type: "sim_join", count: LOOT_MEASURE_VIEWERS });
      for (const c of engine.party) equipEverything(draft, c);
      const combat = engine.dispatch({ type: "start_dungeon" }).combat;
      if (!combat) break;
      runs += 1;
      for (const e of combat.events) if (e.type === "loot") drops += 1;
    }
    dungeons.push({
      dungeonId: dungeon.id,
      name: dungeon.name,
      runs,
      drops,
      perViewerPerRun: drops / Math.max(1, runs) / LOOT_MEASURE_VIEWERS,
    });
  }

  const perViewerPerRun = dungeons.reduce((sum, d) => sum + d.perViewerPerRun, 0) / Math.max(1, dungeons.length);
  return {
    chances,
    viewers: LOOT_MEASURE_VIEWERS,
    dungeons,
    perViewerPerRun,
    perViewerPerNight: perViewerPerRun * RUNS_PER_NIGHT,
    runsPerNight: RUNS_PER_NIGHT,
  };
}
