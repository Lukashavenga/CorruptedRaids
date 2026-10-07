import { ContentRegistry } from "../../../src/engine/content/loader.js";
import { GameEngine, type DispatchResult } from "../../../src/engine/state/gameEngine.js";
import { DungeonController, type DungeonUpdate } from "../../../src/state/DungeonController.js";
import type { GameCommand } from "../../../src/engine/commands/types.js";
import type { PlacementFile } from "../../../src/character/layers.js";
import balance from "../../../content/balance.json";
import shop from "../../../content/shop.json";
import placementFile from "../../../content/placements.json";

/**
 * The game, running in the page instead of behind it.
 *
 * WHY THIS EXISTS: the overlay is a view of a server - it listens to
 * `GET /events` and its sim strip posts to `/command` - and a static host has
 * no server. GitHub Pages cannot run one (no process, no timers between
 * requests, no held-open stream; the same reasons DEPLOY.md gives for Vercel),
 * so for a build that has to work from static files the only place left for
 * the state machine is the tab.
 *
 * It is the SAME game, not a mock of it: the real ContentRegistry, GameEngine
 * and DungeonController, built exactly as src/server/index.ts builds them. The
 * engine never knew it was behind HTTP, so nothing in it had to change - what
 * is missing here is only what the server ADDS:
 *
 *   - no roster store. Characters live in the engine's Map and nowhere else,
 *     so a reload is a clean roster and nothing a sim run hands out is kept.
 *     That is the point of this build, not a gap in it.
 *   - no auth. Every command is the operator's; there is nobody else here.
 *   - no chat, no redeems, no admin. Those are the server's routes.
 *
 * CONTENT IS THE REPO'S, FROZEN AT BUILD TIME. The server reads Supabase first
 * and `content/` second; this reads `content/` only, bundled by the globs
 * below, because the store's dungeons are not readable with a public key and a
 * static page has no other kind. So this fights what `content/` held when it
 * was built - `npm run pull:content` and a commit are how the store's copy
 * gets here.
 *
 * Only ever imported behind the standalone check in web/src/localGameLink.ts,
 * so none of this - nor the engine it drags in - reaches the ordinary overlay
 * bundle.
 */

/** A content directory as the loader would have read it: every file, in filename order. */
function directory(files: Record<string, unknown>): unknown[] {
  return Object.keys(files)
    .sort()
    .map((path) => files[path]);
}

const gear = import.meta.glob("../../../content/gear/*.json", { eager: true, import: "default" });
const dungeons = import.meta.glob("../../../content/dungeons/*.json", { eager: true, import: "default" });
const consumables = import.meta.glob("../../../content/consumables/*.json", { eager: true, import: "default" });
const raids = import.meta.glob("../../../content/raids/*.json", { eager: true, import: "default" });

export interface LocalGame {
  /**
   * Every update the controller emits, starting with the current state - the
   * same first message `GET /events` writes on connect. Returns the unsubscribe.
   */
  subscribe: (listener: (update: DungeonUpdate) => void) => () => void;
  dispatch: (command: GameCommand) => DispatchResult;
  /** What `GET /content` answers. */
  content: () => unknown;
  placements: PlacementFile;
}

let game: LocalGame | undefined;

/**
 * One game per page, built on first use.
 *
 * Lazily rather than at import, so malformed content throws where a caller can
 * catch and report it instead of failing the module and taking every importer
 * down with an error that names none of them.
 */
export function localGame(): LocalGame {
  if (game) return game;

  const content = new ContentRegistry();
  // loadObjects validates in the order the directory loaders document: gear
  // before the fights that drop it, the shop last.
  content.loadObjects({
    gear: directory(gear),
    consumables: directory(consumables),
    dungeons: directory(dungeons),
    raids: directory(raids),
    balance,
    shop,
  });

  const controller = new DungeonController(new GameEngine(content, Math.random));

  /**
   * Through JSON, as it would have been on the wire.
   *
   * Not ceremony. A snapshot holds the engine's LIVE objects - the party's
   * characters are mutated in place by the next command - and over SSE the
   * overlay only ever received copies. Handing React the originals means state
   * that changes underneath it without a render, and a replay comparing a
   * result against the "previous" one that is the same object.
   */
  const overTheWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  game = {
    subscribe(listener) {
      const forward = (update: DungeonUpdate) => listener(overTheWire(update));
      controller.on("update", forward);
      listener(overTheWire({ snapshot: controller.getSnapshot(), result: null }));
      return () => {
        controller.off("update", forward);
      };
    },
    dispatch: (command) => overTheWire(controller.dispatch(command)),
    content: () =>
      overTheWire({
        gear: content.listGear(),
        dungeons: content.listDungeons(),
        raids: content.listRaids(),
        consumables: content.listConsumables(),
        shop: content.shopView(),
        balance: content.balance,
      }),
    placements: placementFile as unknown as PlacementFile,
  };
  return game;
}
