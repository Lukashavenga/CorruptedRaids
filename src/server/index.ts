import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../engine/content/loader.js";
import {
  loadContentFromSupabase,
  revertSpriteInStore,
  saveSpriteToStore,
  writeContentFile,
} from "./contentStore.js";
import { GameEngine } from "../engine/state/gameEngine.js";
import type { GameCommand } from "../engine/commands/types.js";
import { DungeonController, type DungeonSnapshot, type DungeonUpdate } from "../state/DungeonController.js";
import { estimateDifficulty } from "../engine/difficulty.js";
import { bandFor, expandFight } from "../engine/squad.js";
import { referencePartyStrength } from "../engine/difficulty.js";
import { memberPower, ratePoints } from "../engine/partyStrength.js";
import {
  DEFAULT_TARGET_WIN,
  beginSolve,
  continueSolve,
  floorFor,
  measureBand,
} from "../engine/bandSolver.js";
import type { SearchState } from "../engine/bandSearch.js";
import { PARTY_BANDS, type PartyBand } from "../engine/types.js";
import { FileRosterStore } from "../engine/persistence/fileRosterStore.js";
import { SupabaseRosterStore } from "../engine/persistence/supabaseRosterStore.js";
import { pruneUnknownGear, type RosterStore } from "../engine/persistence/rosterStore.js";
import {
  applyCors,
  checkAdmin,
  clearSessionCookie,
  isViewerCommand,
  issueSession,
  readSession,
  sessionCookie,
  sessionViewer,
} from "./auth.js";
import {
  checkChatBot,
  parseChatLine,
  pickRun,
  redeemKind,
  redeemRole,
  viewerId,
  type ChatLine,
  type Redeem,
  type RedeemKind,
} from "./chat.js";
import type { EnemyDefinition, FightDefinition } from "../engine/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const CONTENT_DIR = join(ROOT, "content");

/**
 * content/placements.json, read straight off disk each time.
 *
 * Not cached: the admin screen saves here and the overlay reads it, and a cache
 * would mean restarting the server to see a placement you just adjusted.
 * The file is a few hundred small objects, so the read is not worth optimising.
 */
const PLACEMENTS_FILE = join(CONTENT_DIR, "placements.json");

/**
 * placements.json out of Supabase, when that is where content came from.
 *
 * Held here rather than written to disk: the whole point of the move is that
 * the hosted panel is the authority, and a server that wrote its copy back
 * would turn every restart into a race between two writers.
 */
let supabasePlacements: unknown = null;

/**
 * The run each kind of redeem opened last, so the next roll can skip it.
 *
 * In the process, like the FSM and the roster — see the ONE MACHINE note in
 * AGENTS.md §3. Forgotten on restart, which costs one possible repeat.
 */
const lastRedeemed: Record<RedeemKind, string | null> = { dungeon: null, raid: null };

function readPlacements(): string {
  try {
    return readFileSync(PLACEMENTS_FILE, "utf-8");
  } catch {
    return "{}";
  }
}

/**
 * Sprite folders the editor may write to.
 *
 * One optional nested segment, because enemy art is filed by group —
 * "enemies/heroic-guards" — while character art is flat ("head", "chest").
 * Still no dots and no backslashes, so nothing can climb out of art/sprites;
 * widening this to a general path would give an unauthenticated endpoint
 * arbitrary write access to the disk.
 */
const SPRITE_FOLDER = /^[a-z0-9]+(?:\/[a-z0-9-]+)?$/i;

function writePlacements(data: unknown): void {
  writeFileSync(PLACEMENTS_FILE, `${JSON.stringify(data, null, 2)}
`);
}

/** Content kinds the admin screen may write, and the directory each lives in. */
const CONTENT_WRITABLE: Record<string, string> = {
  gear: "gear",
  dungeon: "dungeons",
  raid: "raids",
};

const OVERLAY_DIR = join(ROOT, "overlay");
/** Art's source of truth at runtime — see serveStatic for why this wins over the build. */
const PUBLIC_DIR = join(ROOT, "web", "public");
/** Vite serves art from here; an erased sprite has to land in both copies. */
const PUBLIC_SPRITES = join(ROOT, "web", "public", "art", "sprites");
/** Pre-erase originals, so one bad brush stroke costs one sprite, not a re-slice. */
const BACKUP_SPRITES = join(ROOT, "art", "sprites", "_original");
const PORT = Number(process.env.PORT ?? 8787);

const content = new ContentRegistry();

/**
 * Supabase first, the disk second.
 *
 * Content lives in a table now so it can be edited from the hosted operator
 * page rather than only from this machine (sql/003_content.sql). The
 * directory loaders stay as the fallback and are not a legacy path: a fresh
 * clone with no Supabase configured has to boot, the simulator reads content
 * with no network at all, and a stream should not stop because a database is
 * having an afternoon.
 *
 * Loaded ONCE, at boot, exactly as the files were. An edit in the panel
 * reaches the game at the next restart.
 */
let contentSource = "files";
try {
  const fromDb = await loadContentFromSupabase(content);
  if (fromDb.loaded) {
    contentSource = `Supabase (${fromDb.count} files)`;
    if (fromDb.placements) supabasePlacements = fromDb.placements;
  }
} catch (err) {
  // Loud, then carry on with the disk. A silent fallback is how you end up
  // running a stream on last week's balance and wondering why nothing you
  // changed took effect.
  console.error(`[content] Supabase load failed, falling back to content/: ${(err as Error).message}`);
}

if (contentSource === "files") {
  content.loadGearDir(join(CONTENT_DIR, "gear"));
  content.loadDungeonsDir(join(CONTENT_DIR, "dungeons"));
  content.loadConsumablesDir(join(CONTENT_DIR, "consumables"));
  content.loadBalance(join(CONTENT_DIR, "balance.json"));
  // Shop last: it validates its ids against everything loaded above.
  // Raids after gear: every fight in one names the gear it can drop.
  content.loadRaidsDir(join(CONTENT_DIR, "raids"));
  content.loadShop(join(CONTENT_DIR, "shop.json"));
}
console.log(
  `Content: ${contentSource}. ` +
    `Loaded ${content.listGear().length} gear items, ${content.listDungeons().length} dungeons, ${content.listRaids().length} raids.`,
);

/**
 * Where characters live between runs.
 *
 * A file today; the same interface is what Supabase implements when this is
 * hosted. `DATA_DIR` is the one thing a deployment has to point at a volume —
 * everything else the server writes is content, which is in the repo.
 */
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, "data");

/**
 * Supabase when it is configured, a file otherwise.
 *
 * The file store is not a fallback in the sense of being worse — it is the
 * right answer for a single container with a volume, and it needs no account.
 * Supabase earns its place when the data has to outlive the machine: a volume
 * is tied to one host, and losing it loses every character AND every snapshot
 * taken to protect them.
 */
const rosterStore: RosterStore = SupabaseRosterStore.fromEnv() ?? new FileRosterStore(DATA_DIR);
const storeName = SupabaseRosterStore.fromEnv() ? "Supabase" : `file (${DATA_DIR})`;

/**
 * Does this gear id still exist?
 *
 * A Set rather than `content.getGear`, which THROWS on an unknown id — it is
 * written for callers that hold an id the content is supposed to guarantee.
 * A character's inventory carries no such guarantee: the admin can delete the
 * item they are holding.
 */
const knownGear = new Set(content.listGear().map((g) => g.id));
const gearExists = (id: string) => knownGear.has(id);

const engine = new GameEngine(content, Math.random);
// DungeonController wraps the engine with the idle/gathering/combat/results/
// cooldown state machine (see src/state/dungeonStates.config.ts) — it's what
// holds the join window open, gates a second run from overlapping one still
// on screen, and what the overlay's state banner reflects. GameEngine itself
// has no idea any of this exists.
const raid = new DungeonController(engine);

// --- durability ------------------------------------------------------------
/**
 * Write-behind, debounced.
 *
 * Every dispatch can change a character — XP, gold, a looted item — and a
 * fight emits a burst of them. Saving on each would rewrite the whole roster
 * dozens of times inside one combat, so changes are coalesced into one write a
 * moment after they stop. The cost of the delay is bounded and known: a hard
 * crash loses at most `SAVE_DEBOUNCE_MS` of play. A clean shutdown loses
 * nothing — see the signal handlers below.
 */
const SAVE_DEBOUNCE_MS = 1500;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = false;
let saveAgain = false;

async function flushRoster(): Promise<void> {
  // One writer at a time. Without this, two overlapping saves can finish out
  // of order and leave the OLDER roster on disk — the classic write-behind
  // bug, and a silent one.
  if (saving) {
    saveAgain = true;
    return;
  }
  saving = true;
  try {
    await rosterStore.save(engine.roster.snapshot());
  } catch (err) {
    console.error(`[roster] save failed: ${(err as Error).message}`);
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      await flushRoster();
    }
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushRoster(), SAVE_DEBOUNCE_MS);
}

// --- SSE broadcast ---------------------------------------------------------
// Every command dispatched anywhere (HTTP now, Twitch later) flows through
// RaidController, which emits "update" — once per dispatch, plus once more
// whenever a state's own timer elapses (e.g. results -> cooldown -> idle
// with nothing new dispatched). That's the only thing the overlay needs to
// subscribe to. This is intentionally not a WebSocket: the overlay only
// ever needs server -> browser pushes, so SSE (one Node core module, zero
// dependencies) is the simplest thing that works over plain HTTP.
/**
 * Collects a JSON request body.
 *
 * The handlers below each grew their own copy of the same four lines. One
 * helper instead — and it hands back `null` rather than throwing on bad JSON,
 * so a caller decides what a malformed body means to it.
 */
/**
 * Refuses the request unless it is the operator, and says why.
 *
 * Returns true when it has ALREADY answered — the caller returns immediately.
 * Reads as `if (denyNonAdmin(...)) return;` at the top of every privileged
 * handler, which is one line and hard to leave out by accident.
 */
function denyNonAdmin(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean {
  const check = checkAdmin(req);
  if (check.ok) return false;
  res.writeHead(check.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, message: check.message }));
  return true;
}

function readBody(
  req: import("node:http").IncomingMessage,
  done: (body: Record<string, unknown> | null) => void,
): void {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    // ONLY THE PARSE IS GUARDED. The `try` used to wrap the `done(...)` call
    // as well, which made every error thrown inside a handler look like a
    // malformed request body — and ran the callback a SECOND time with null,
    // so the client got "Missing command.type" for what was actually a
    // handler bug. Found when `grant_chest` hit an unknown gear id and
    // `getGear` threw: the real message never reached anyone.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      done(null);
      return;
    }
    done(typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null);
  });
}

type SseClient = { write: (chunk: string) => void };
const sseClients = new Set<SseClient>();

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

/**
 * Who the loadout must not let edit right now.
 *
 * Anything past the join window is locked: once the party is fixed, a viewer
 * changing their gear on their phone would make the fight on screen disagree
 * with the character. `gathering` is deliberately NOT locked — that is exactly
 * when someone should be putting their kit on.
 */
const LOCKED_STATES = new Set(["combat", "results", "choosing", "reveal"]);
let lockedIds: string[] = [];

function syncRunLock(snapshot: DungeonSnapshot): void {
  if (!rosterStore.setInRun) return;
  const ids = LOCKED_STATES.has(snapshot.state)
    ? snapshot.engine.party.map((p: { id: string }) => p.id)
    : [];
  // Only on a real change: this fires on every dispatch, and a fight is
  // hundreds of them.
  if (ids.length === lockedIds.length && ids.every((id, i) => id === lockedIds[i])) return;

  const released = lockedIds.filter((id: string) => !ids.includes(id));
  lockedIds = ids;
  // Release first. If both calls cannot happen, the safe failure is a
  // character that is editable when it should not be, not one locked forever
  // because a run ended while the network was down.
  if (released.length > 0) void rosterStore.setInRun(released, false).catch(warnLock);
  if (ids.length > 0) void rosterStore.setInRun(ids, true).catch(warnLock);
}

function warnLock(err: Error): void {
  console.warn(`[roster] could not update the in-run lock: ${err.message}`);
}

raid.on("update", ({ snapshot, result }: DungeonUpdate) => {
  broadcast("update", { snapshot, result });
  // Every dispatch is a candidate for having changed somebody, and this is
  // the one event that fires for all of them. Cheaper than hooking each
  // mutation, and it cannot be forgotten when a new command is added.
  scheduleSave();
  syncRunLock(snapshot);
});

// --- static file serving for the overlay -----------------------------------
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  // The loadout ships its content bundle as a static asset (see
  // scripts/bundle-edge-content.ts). Without this it is served as
  // application/octet-stream, which fetch().json() survives and a CDN, a
  // proxy or a stricter client may not.
  ".json": "application/json; charset=utf-8",
  // Character/enemy art lives in web/public/ and is copied into overlay/ by
  // the Vite build — without these, sprites would be served as
  // application/octet-stream.
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function serveStatic(urlPath: string): { body: Buffer; contentType: string } | null {
  // Two pages are served out of overlay/: the OBS overlay at / and the
  // loadout screen at /loadout. Both are separate Vite entry points with
  // their own bundles (see web/vite.config.ts) — they share engine types,
  // not a runtime.
  const rel = urlPath === "/" ? "/index.html" : urlPath === "/loadout" ? "/loadout.html" : urlPath;

  // ART IS SERVED FROM ITS SOURCE, not from the build.
  //
  // Vite copies web/public into overlay/ at BUILD time, so a file written to
  // web/public afterwards is invisible until the next build. That is exactly
  // what broke the admin eraser: it wrote the edited PNG to art/sprites and
  // web/public, both correctly, and the browser went on loading the stale copy
  // baked into overlay/ — so a save looked like it did nothing.
  //
  // Checking the source first makes art edits live. Everything else still comes
  // from the build, because bundles genuinely are build output.
  const roots = rel.startsWith("/art/") ? [PUBLIC_DIR, OVERLAY_DIR] : [OVERLAY_DIR];
  for (const root of roots) {
    const filePath = join(root, rel);
    if (!filePath.startsWith(root) || !existsSync(filePath)) continue;
    const ext = extname(filePath);
    return { body: readFileSync(filePath), contentType: MIME[ext] ?? "application/octet-stream" };
  }
  return null;
}

// --- HTTP server -------------------------------------------------------------
const server = createServer((req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    // Chat's door vote is part of the snapshot itself now (`vote`,
    // `choiceDeadline`), so this and the SSE stream cannot disagree about it.
    res.end(JSON.stringify(raid.getSnapshot()));
    return;
  }

  // The loadout screen's own read endpoint (§2.6). Plain request/response
  // rather than a slice of the overlay's SSE stream: this surface is
  // per-viewer and private, whereas /events is a public broadcast of the
  // shared run. `viewer` is the identity seam — a real deployment
  // authenticates here instead of trusting a query parameter.
  /**
   * One character, in full — inventory, gold, unspent points.
   *
   * WHOSE comes from the session. `?viewer=` still works but is now restricted
   * to the operator or to asking about yourself, because this returns a great
   * deal more than the leaderboard does: anyone could previously read any
   * player's entire bags and purse by guessing an id, and the ids are printed
   * on the overlay.
   */
  if (req.method === "GET" && url.pathname === "/character") {
    const asked = url.searchParams.get("viewer");
    const self = sessionViewer(req);
    const viewerId = asked ?? self;

    if (!viewerId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "Not signed in" }));
      return;
    }
    if (asked && asked !== self && !checkAdmin(req).ok) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "That is not your character" }));
      return;
    }

    const view = engine.getCharacterView(viewerId);
    res.writeHead(view ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(view ?? { ok: false, message: "No character for that viewer" }));
    return;
  }

  /**
   * The standings, for the leaderboard screen.
   *
   * Ranked by Corruption, because that is the number the rest of the game
   * already treats as "how strong is this person" — it is what scales a
   * dungeon's band, and it folds level, spent points and worn gear into one
   * figure. Level alone would rank a naked level 40 above a geared level 30
   * who beats them; gold ranks whoever spends least.
   *
   * Everything here is already public: these are the names on the overlay
   * during a run. No viewer ids go out — a leaderboard is a display surface,
   * not a directory of the chat.
   */
  /**
   * Roster snapshots — take one, list them, put one back.
   *
   * GATED, unlike every other POST on this server. That is not inconsistency,
   * it is triage: `/content/*` can lose a dungeon you can rewrite in an
   * afternoon, and `/admin/roster/restore` replaces every character in the
   * channel. The rest of the write surface gets the same treatment in P1;
   * this one could not wait for it.
   *
   * ADMIN_SECRET is read from the environment. If it is unset the endpoints
   * refuse rather than run open — a deployment that forgot to set it should
   * fail closed and say so, not quietly expose the roster.
   */
  if (url.pathname.startsWith("/admin/roster")) {
    if (denyNonAdmin(req, res)) return;

    if (req.method === "GET" && url.pathname === "/admin/roster/snapshots") {
      void rosterStore.listSnapshots().then((snapshots) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, snapshots, live: engine.roster.size }));
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/roster/snapshot") {
      readBody(req, (body) => {
        const label = typeof body?.label === "string" ? body.label : "manual";
        // Flush first: a snapshot of the FILE is a snapshot of whatever was
        // last written, which under a debounce is not what is on screen.
        void flushRoster()
          .then(() => rosterStore.snapshot(label))
          .then((id) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, id, characters: engine.roster.size }));
          })
          .catch((err: Error) => {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, message: err.message }));
          });
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/roster/restore") {
      readBody(req, (body) => {
        const id = typeof body?.id === "string" ? body.id : "";
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Missing snapshot id" }));
          return;
        }
        // A restore is itself destructive, so it takes a snapshot of what it
        // is about to replace. Restoring the wrong one should cost a click,
        // not a channel.
        void flushRoster()
          .then(() => rosterStore.snapshot("before-restore"))
          .then(() => rosterStore.readSnapshot(id))
          .then(async (characters) => {
            pruneUnknownGear(characters, gearExists, (m) =>
              console.warn(`[roster] ${m}`),
            );
            engine.roster.hydrate(characters);
            await flushRoster();
            // The overlay and every open loadout are now looking at a roster
            // that no longer exists. Push the new one.
            broadcast("update", { snapshot: raid.getSnapshot(), result: null });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, restored: characters.length }));
          })
          .catch((err: Error) => {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, message: err.message }));
          });
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Not found" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/leaderboard") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
    const standings = engine.roster
      .list()
      .map((c) => ({
        name: c.name,
        level: c.level,
        role: c.role,
        corruption: memberPower(c, content),
        gold: c.gold,
        gearScore: Object.keys(c.equipment).length,
      }))
      .sort((a, b) => b.corruption - a.corruption || b.level - a.level || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((row, i) => ({ rank: i + 1, ...row }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ standings, rosterSize: engine.roster.size }));
    return;
  }

  /**
   * Sprite placement data — where each item's art sits on the character.
   *
   * Read by every surface that draws a character; written only by the admin
   * screen. It lives in content/ rather than in code because it is authored by
   * eye against the art (see src/character/layers.ts), and it is served from
   * disk on each request rather than cached so that saving in the admin screen
   * is visible in the overlay on the next reload without restarting the server.
   */
  if (req.method === "GET" && url.pathname === "/placements") {
    res.writeHead(200, { "Content-Type": "application/json" });
    // The store wins when content came from it, so the admin screen and the
    // overlay are looking at the same placements the hosted panel edits. The
    // file is what a checkout with no Supabase reads.
    res.end(supabasePlacements ? JSON.stringify(supabasePlacements) : readPlacements());
    return;
  }

  /**
   * Save placements, to wherever content lives.
   *
   * WRITES TO THE STORE when the server booted from it, because otherwise the
   * local admin screen and the hosted panel edit two different copies and the
   * last restart decides which one was real. When there is no Supabase this
   * writes the file exactly as it always did.
   *
   * The store write goes through content_files, so it inherits the history
   * trigger: the version it replaces is kept. That matters more here than
   * anywhere else - placement and mask work is precisely what was lost before,
   * and the recovery plan was a browser tab somebody had not closed yet.
   */
  if (req.method === "POST" && url.pathname === "/placements") {
    // Operator only: this writes content. See auth.ts.
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      void (async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("expected an object of slot -> sprite -> placement");
          }
          const stored = await writeContentFile("placements.json", parsed);
          if (stored) supabasePlacements = parsed;
          else writePlacements(parsed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, stored: stored ? "supabase" : "file" }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
        }
      })();
    });
    return;
  }

  /**
   * Save one erased sprite. Used by the admin eraser.
   *
   * TO THE SPRITES BUCKET when Supabase is configured, exactly as the hosted
   * page does - otherwise an erase made here would live on this disk while the
   * one made hosted lives in the bucket, and players would see whichever the
   * last deploy happened to carry. See sql/004_sprites.sql.
   *
   * Only with no Supabase does it overwrite art/sprites, which is safe because
   * that directory is GENERATED: `npm run slice` rebuilds it from the sheets.
   */
  if (req.method === "POST" && url.pathname === "/sprite") {
    // Operator only: this writes to the repo. See auth.ts.
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => void (async () => {
      try {
        const { folder, id, png } = JSON.parse(body || "{}");
        // Both parts are path segments on disk, so they are constrained to a
        // safe alphabet rather than sanitised — a rejected name is better than
        // a clever one that escapes the directory.
        if (!SPRITE_FOLDER.test(folder ?? "") || !/^[a-z0-9_-]+$/i.test(id ?? "")) {
          throw new Error("bad folder or id");
        }
        if (typeof png !== "string" || !png.startsWith("data:image/png;base64,")) {
          throw new Error("png must be a data:image/png;base64 string");
        }
        const bytes = Buffer.from(png.slice("data:image/png;base64,".length), "base64");
        const sprites = await saveSpriteToStore(`${folder}/${id}`, bytes);
        if (sprites !== null) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, stored: "supabase", sprites }));
          return;
        }
        const source = join(ROOT, "art", "sprites", folder, `${id}.png`);
        // Back up the ORIGINAL once, before the first edit. Re-slicing already
        // restores everything, but that discards every other erase too — a
        // per-sprite backup makes undoing one mistake cost one sprite.
        const backup = join(BACKUP_SPRITES, folder, `${id}.png`);
        if (existsSync(source) && !existsSync(backup)) {
          mkdirSync(dirname(backup), { recursive: true });
          copyFileSync(source, backup);
        }
        for (const dir of [join(ROOT, "art", "sprites", folder), join(PUBLIC_SPRITES, folder)]) {
          writeFileSync(join(dir, `${id}.png`), bytes);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, stored: "file" }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
      }
    })());
    return;
  }

  /**
   * Put one sprite back to its original. A manifest edit in the bucket's case
   * (nothing is deleted); a copy from the pre-erase backup in the disk case.
   */
  if (req.method === "POST" && url.pathname === "/sprite/revert") {
    // Operator only: this writes to the repo. See auth.ts.
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => void (async () => {
      try {
        const { folder, id } = JSON.parse(body || "{}");
        if (!SPRITE_FOLDER.test(folder ?? "") || !/^[a-z0-9_-]+$/i.test(id ?? "")) {
          throw new Error("bad folder or id");
        }
        const sprites = await revertSpriteInStore(`${folder}/${id}`);
        if (sprites !== null) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, stored: "supabase", sprites }));
          return;
        }
        const backup = join(BACKUP_SPRITES, folder, `${id}.png`);
        if (!existsSync(backup)) throw new Error("no backup - this sprite has never been erased");
        for (const dir of [join(ROOT, "art", "sprites", folder), join(PUBLIC_SPRITES, folder)]) {
          copyFileSync(backup, join(dir, `${id}.png`));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, stored: "file" }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
      }
    })());
    return;
  }

  /**
   * Difficulty of a fight, as a measured win rate. See src/engine/difficulty.ts.
   *
   * A GET with query parameters rather than a POST, so the admin screen can
   * fire one per slider change and the browser will coalesce identical reads.
   * Accepts either an encounter list or a dungeon/raid id, because that is how
   * the tuning screen thinks about content.
   */
  if (req.method === "GET" && url.pathname === "/difficulty") {
    // GATED, despite being a GET.
    //
    // It is a read in the HTTP sense and a SIMULATION in every sense that
    // costs anything: it expands a fight and resolves it up to 400 times to
    // answer. Gating the POST twin and leaving this open would close what
    // AGENTS.md section 3 claims while leaving the identical work reachable by
    // changing one verb.
    if (denyNonAdmin(req, res)) return;
    try {
      const q = url.searchParams;
      const num = (key: string, fallback: number) => {
        const v = Number(q.get(key));
        return Number.isFinite(v) ? v : fallback;
      };

      let enemies: EnemyDefinition[] = [];
      let multipliers: { hp: number; atk: number } | undefined;

      const dungeonId = q.get("dungeonId");
      const raidId = q.get("raidId");

      /*
       * The party's RATING, not its headcount.
       *
       * `expandFight`'s `strength` is fed straight to `bandFor()`, which reads
       * a composition-adjusted rating in the hundreds or thousands. This
       * passed the party SIZE - twelve - and `bandFor(12)` is `weak` for every
       * party that will ever exist, so this endpoint fielded the weak layout
       * no matter what the sliders said. Measured on barbie with 2/8/2:
       *
       *   level   as headcount            as rating
       *   L5      weak,  10 bodies, 100%  seasoned, 16 bodies, 100%
       *   L30     weak,  10 bodies, 100%  elite,    18 bodies,  30%
       *   L120    weak,  10 bodies, 100%  infernal, 17 bodies,  92%
       *
       * So the Corruption slider in the raid tuner moved and the reading never
       * did - it answered 100% at every setting, which reads as "this fight is
       * trivial" rather than "this control is not wired up". The POST twin got
       * this right because it was written later, against the draft; the
       * disagreement between them is what made it visible.
       */
      const composition = {
        tanks: num("tanks", 1),
        dps: num("dps", 4),
        healers: num("healers", 1),
      };
      const gearAssumption = (q.get("gear") as "none" | "typical" | "best" | null) ?? "typical";
      const size = referencePartyStrength(composition, num("level", 5), content, gearAssumption);

      if (dungeonId) {
        enemies = content.expandDungeonEnemies(content.getDungeon(dungeonId), size);
      } else if (raidId) {
        // A raid's difficulty means its BOSS: the door fights are drawn at run
        // time from a pool, so there is no single fight to measure, whereas the
        // boss is the fixed wall every run ends at.
        const raid = content.getRaid(raidId);
        if (!raid) throw new Error(`no such raid "${raidId}"`);
        // A named room can be measured on its own now that rooms are content
        // the author edits one at a time. Without `roomId` the boss is still
        // the answer: it is the fixed wall every run ends at.
        const roomId = q.get("roomId");
        const room = roomId ? raid.rooms.find((r) => r.id === roomId) : undefined;
        if (roomId && !room) throw new Error(`raid "${raidId}" has no room "${roomId}"`);
        if (room?.fight) {
          enemies = expandFight(room.fight, `${raid.id}:${room.id}`, room.name, size, content.balance.bandStatScale);
        } else if (!room) {
          enemies = expandFight(raid.boss.fight, `${raid.id}:${raid.boss.id}`, raid.boss.name, size, content.balance.bandStatScale);
          multipliers = { hp: raid.boss.hpMultiplier, atk: raid.boss.atkMultiplier };
        }
      }

      if (enemies.length === 0) throw new Error("nothing to measure - pass dungeonId or raidId");

      const report = estimateDifficulty(enemies, content, {
        composition,
        level: num("level", 5),
        gear: gearAssumption,
        samples: Math.min(400, num("samples", 150)),
        enemyMultipliers: multipliers,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(report));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
    }
    return;
  }

  /**
   * Difficulty of an UNSAVED encounter draft.
   *
   * The GET form takes ids and resolves them from the registry, which means it
   * can only ever report on what is already on disk — so in the admin every
   * slider appeared to do nothing until you pressed Save, and the reading you
   * were staring at belonged to the numbers you had just replaced. This takes
   * the draft itself, so the meter answers for what is on screen.
   */
  if (req.method === "POST" && url.pathname === "/difficulty") {
    // The draft is arbitrary: `samples` is clamped to 400 but the FORMATION in
    // the body is not, and expanding a fight with ten thousand bodies in it is
    // unbounded work on the machine running the stream.
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { fight, composition, level, samples, gear } = JSON.parse(body || "{}");
        if (!fight || typeof fight !== "object") throw new Error("expected a fight draft");
        const comp = {
          tanks: Number(composition?.tanks ?? 1),
          dps: Number(composition?.dps ?? 4),
          healers: Number(composition?.healers ?? 1),
        };
        const assumption = gear === "none" || gear === "best" ? gear : "typical";
        const strength = referencePartyStrength(comp, Number(level) || 5, content, assumption);
        const draft = fight as FightDefinition;
        // A draft with no bodies in it yet has nothing to measure: there is no
        // "N copies of the stat block" fallback any more, because a fight IS
        // its formation now.
        const enemies = expandFight(draft, "draft", "draft", strength, content.balance.bandStatScale);
        if (enemies.length === 0) throw new Error("this layout has no units yet");

        const report = estimateDifficulty(enemies, content, {
          composition: comp,
          level: Number(level) || 5,
          gear: gear === "none" || gear === "best" ? gear : "typical",
          samples: Math.min(400, Number(samples) || 120),
        });
        // The squad's own rating, priced with the same scorer as a party's, so
        // "encounter 3,420 against a party of 1,200" is a comparison rather
        // than two unrelated numbers.
        const enemyRating = enemies.reduce((sum, e) => sum + ratePoints(e.stats, content.balance), 0);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...report, enemyCount: enemies.length, enemyRating }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
      }
    });
    return;
  }

  /**
   * One level of a DRAFT fight, measured against the party that level is for.
   *
   * The balance screen's per-level percentages. Separate from POST /difficulty
   * because this one takes a LEVEL rather than a party composition, and runs
   * through measureBand - the same function the solver aims with - so the
   * number on a level's tab and the number the Solve button targeted are one
   * measurement, not two samples that disagree by five points.
   */
  if (req.method === "POST" && url.pathname === "/difficulty/measure") {
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { fight, band, gear } = JSON.parse(body || "{}") as {
          fight?: FightDefinition;
          band?: PartyBand;
          gear?: "none" | "typical" | "best";
        };
        if (!fight || typeof fight !== "object") throw new Error("expected a fight draft");
        if (!band || !PARTY_BANDS.includes(band)) throw new Error(`expected a band: ${PARTY_BANDS.join(", ")}`);
        const reading = measureBand(fight, band, content, {
          gear: gear === "none" || gear === "typical" || gear === "best" ? gear : undefined,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, reading }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
      }
    });
    return;
  }

  /**
   * Solve one level of a DRAFT fight towards its target.
   *
   * RESUMABLE, because the hosted twin of this runs inside an Edge Function
   * with a 2s CPU budget and one level can take 2.5s. The protocol is the same
   * here so the browser has one loop for both: send the fight and the level,
   * get back a search state; while that state is not "done", send it back.
   * Here the search simply runs to the end, so the first reply is the last.
   *
   * The target and the ratchet floor are read from the DRAFT - its
   * `targetWinRate`, and the multiplier of the level below - rather than taken
   * from the request, so a browser cannot solve a level against numbers the
   * saved fight does not carry.
   */
  if (req.method === "POST" && url.pathname === "/difficulty/solve") {
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { fight, band, state } = JSON.parse(body || "{}") as {
          fight?: FightDefinition;
          band?: PartyBand;
          state?: SearchState;
        };
        if (!fight || typeof fight !== "object") throw new Error("expected a fight draft");
        if (!band || !PARTY_BANDS.includes(band)) throw new Error(`expected a band: ${PARTY_BANDS.join(", ")}`);
        if (!fight.formations?.[band]?.length) throw new Error(`level ${PARTY_BANDS.indexOf(band) + 1} has no units to solve`);
        const start =
          state ??
          beginSolve(fight, band, content, {
            target: fight.targetWinRate ?? DEFAULT_TARGET_WIN,
            floor: floorFor(fight, band, content),
          });
        const result = continueSolve(fight, band, content, start);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
      }
    });
    return;
  }

  /**
   * What real party shapes rate, and which level each meets.
   *
   * The reference table for the whole difficulty model. Every question worth
   * asking about it — what do thirty naked players get, does a small kitted
   * group outrank a big scruffy one — is answered by reading a row rather than
   * by reasoning about a formula nobody can hold in their head. Computed here
   * rather than in the browser because it needs the gear catalogue to dress the
   * reference parties.
   */
  if (req.method === "GET" && url.pathname === "/ratings") {
    try {
      const shapes: { label: string; size: number; gear: "none" | "typical" | "best"; level: number }[] = [
        { label: "5, no gear", size: 5, gear: "none", level: 1 },
        { label: "30, no gear", size: 30, gear: "none", level: 1 },
        { label: "5, mid gear", size: 5, gear: "typical", level: 5 },
        { label: "30, mid gear", size: 30, gear: "typical", level: 5 },
        { label: "5, fully geared", size: 5, gear: "best", level: 12 },
        { label: "30, fully geared", size: 30, gear: "best", level: 12 },
      ];
      const rows = shapes.map((shape) => {
        const t = Math.max(1, Math.round(shape.size / 6));
        const rating = referencePartyStrength(
          { tanks: t, healers: t, dps: Math.max(0, shape.size - 2 * t) },
          shape.level,
          content,
          shape.gear,
        );
        return { label: shape.label, size: shape.size, rating, band: bandFor(rating) };
      });
      // A party with no support roles, to show the composition penalty biting.
      const lopsided = referencePartyStrength({ tanks: 0, healers: 0, dps: 12 }, 5, content, "typical");
      rows.push({ label: "12 all-dps, mid gear", size: 12, rating: lopsided, band: bandFor(lopsided) });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ shapes: rows }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
    }
    return;
  }

  /**
   * Everywhere an encounter id is spoken of.
   *
   * Deleting or renaming one is only safe if you know what points at it, and
   * the references live in other files entirely — a dungeon's spawn list, a
   * raid's boss and fight pool. Collected in one place so delete and rename
   * cannot disagree about what "referenced" means.
   */
  const referencesTo = (encounterId: string) => {
    const hits: { file: string; where: string }[] = [];
    for (const kind of ["dungeons", "raids"] as const) {
      const dir = join(CONTENT_DIR, kind);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        const seen = new Set<string>();
        const walk = (node: unknown, path: string) => {
          if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
          if (!node || typeof node !== "object") return;
          for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            if (k === "encounterId" && v === encounterId) seen.add(path || "root");
            else walk(v, path ? `${path}.${k}` : k);
          }
        };
        walk(raw, "");
        for (const where of seen) hits.push({ file: `${kind}/${file}`, where });
      }
    }
    return hits;
  };

  /** Strips every spawn entry naming `encounterId` from one parsed content file. */
  const stripReferences = (node: unknown, encounterId: string): unknown => {
    if (Array.isArray(node)) {
      return node
        .filter((n) => !(n && typeof n === "object" && (n as Record<string, unknown>).encounterId === encounterId))
        .map((n) => stripReferences(n, encounterId));
    }
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, stripReferences(v, encounterId)]),
    );
  };

  /**
   * Delete one content file.
   *
   * Refuses by default when something still points at it, and says exactly
   * what — a dangling encounterId does not fail at save time, it fails on the
   * night when a dungeon tries to spawn a fight that no longer exists. Pass
   * `force` to strip those references as part of the delete.
   */
  if (req.method === "POST" && url.pathname === "/content/delete") {
    // Operator only: this writes to the repo. See auth.ts.
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { kind, id, force } = JSON.parse(body || "{}");
        const dir = CONTENT_WRITABLE[kind as string];
        if (!dir) throw new Error(`kind must be one of ${Object.keys(CONTENT_WRITABLE).join(", ")}`);
        if (!/^[a-z0-9-]+$/i.test(id ?? "")) throw new Error("bad id");
        const file = join(CONTENT_DIR, dir, `${id}.json`);
        if (!existsSync(file)) throw new Error(`no such ${kind} "${id}"`);

        const refs = kind === "encounter" ? referencesTo(id) : [];
        if (refs.length > 0 && !force) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, references: refs, message: `still used by ${refs.map((r) => r.file).join(", ")}` }));
          return;
        }
        for (const ref of refs) {
          const path = join(CONTENT_DIR, ref.file);
          const raw = JSON.parse(readFileSync(path, "utf-8"));
          writeFileSync(path, `${JSON.stringify(stripReferences(raw, id), null, 2)}
`);
        }
        unlinkSync(file);
        content.reload(CONTENT_DIR);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, strippedFrom: refs.map((r) => r.file) }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
      }
    });
    return;
  }

  /**
   * Rename an encounter's id, carrying every reference with it.
   *
   * The id is permanent from the game's point of view but not from the
   * author's: the generated set arrived with names like "bailiff" that no
   * longer match anything on screen, and living with them forever is a worse
   * outcome than migrating the handful of files that point at them.
   */
  if (req.method === "POST" && url.pathname === "/content/rename") {
    // Operator only: this writes to the repo. See auth.ts.
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { kind, id, newId } = JSON.parse(body || "{}");
        const dir = CONTENT_WRITABLE[kind as string];
        if (!dir) throw new Error(`kind must be one of ${Object.keys(CONTENT_WRITABLE).join(", ")}`);
        for (const candidate of [id, newId]) {
          if (!/^[a-z0-9-]+$/i.test(candidate ?? "")) throw new Error("ids may only contain letters, numbers and dashes");
        }
        if (id === newId) throw new Error("that is already its id");
        const from = join(CONTENT_DIR, dir, `${id}.json`);
        const to = join(CONTENT_DIR, dir, `${newId}.json`);
        if (!existsSync(from)) throw new Error(`no such ${kind} "${id}"`);
        if (existsSync(to)) throw new Error(`"${newId}" already exists`);

        const refs = kind === "encounter" ? referencesTo(id) : [];
        const data = JSON.parse(readFileSync(from, "utf-8"));
        data.id = newId;
        writeFileSync(to, `${JSON.stringify(data, null, 2)}
`);
        unlinkSync(from);
        for (const ref of refs) {
          const path = join(CONTENT_DIR, ref.file);
          const raw = readFileSync(path, "utf-8");
          // Replaced as a JSON value, not as free text, so an id that happens
          // to be a substring of another cannot be corrupted.
          const retargeted = JSON.parse(raw, (key, value) =>
            key === "encounterId" && value === id ? newId : value,
          );
          writeFileSync(path, `${JSON.stringify(retargeted, null, 2)}
`);
        }
        content.reload(CONTENT_DIR);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, updated: refs.map((r) => r.file) }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
      }
    });
    return;
  }

  /**
   * Write one content file and reload the registry.
   *
   * The kind is constrained to a known set of directories rather than taken
   * from the request, and the id to a safe alphabet — this writes to disk from
   * an unauthenticated request, exactly like /placements, and the same warning
   * applies: local use only until auth lands.
   *
   * The write is validated by reloading: if the new JSON does not parse or
   * fails its schema, the reload throws and the response says so. That is worth
   * more than validating the payload separately, because it is the same code
   * path the server uses at startup.
   */
  if (req.method === "POST" && url.pathname === "/content/write") {
    // Operator only: this writes to the repo. See auth.ts.
    if (denyNonAdmin(req, res)) return;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const previous = readFileSync;
      try {
        const { kind, id, data } = JSON.parse(body || "{}");
        const dir = CONTENT_WRITABLE[kind as string];
        if (!dir) throw new Error(`kind must be one of ${Object.keys(CONTENT_WRITABLE).join(", ")}`);
        if (!/^[a-z0-9-]+$/i.test(id ?? "")) throw new Error("bad id");
        if (typeof data !== "object" || data === null) throw new Error("data must be an object");

        const file = join(CONTENT_DIR, dir, `${id}.json`);
        const existed = existsSync(file);
        const backup = existed ? previous(file, "utf-8") : null;
        writeFileSync(file, `${JSON.stringify(data, null, 2)}
`);
        try {
          content.reload(CONTENT_DIR);
        } catch (err) {
          // Roll back rather than leave the server holding content it could not
          // load: a half-saved fight would break every subsequent run.
          //
          // A NEW file has no backup to restore, and restoring nothing used to
          // mean leaving the invalid file exactly where it was — so the reload
          // below threw as well, the registry stayed broken, and the only fix
          // was deleting the file by hand on the server. One bad save could
          // take content down mid-stream. An unwanted file is DELETED; an
          // overwritten one is put back.
          if (backup !== null) writeFileSync(file, backup);
          else if (existsSync(file)) unlinkSync(file);
          try {
            content.reload(CONTENT_DIR);
          } catch (recoveryErr) {
            // The rollback itself failed, which means the content on disk was
            // already broken before this request. Say so plainly rather than
            // blaming the payload that happened to arrive next.
            throw new Error(
              `rejected, and the rollback did not restore a loadable state: ${(recoveryErr as Error).message}`,
            );
          }
          throw err;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: (err as Error).message }));
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/content") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        gear: content.listGear(),
        dungeons: content.listDungeons(),
        raids: content.listRaids(),
        consumables: content.listConsumables(),
        shop: content.shopView(),
        balance: content.balance,
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: update\ndata: ${JSON.stringify({ snapshot: raid.getSnapshot(), result: null })}\n\n`);
    const client: SseClient = { write: (chunk) => res.write(chunk) };
    sseClients.add(client);
    req.on("close", () => sseClients.delete(client));
    return;
  }

  /**
   * The one mutation seam, now with two doors into it.
   *
   * An OPERATOR command runs the show — it opens dungeons, resolves fights,
   * wipes the roster, mints gear — and needs the admin secret. A VIEWER
   * command acts on one character, and WHICH character is taken from the
   * session cookie and written over whatever the body claimed.
   *
   * That overwrite is the point. `requestedBy` used to be a field anyone could
   * type, so any caller could respec, strip or spend another viewer's
   * character. It is now derived server-side, which also means P4 replaces
   * only how a session is issued — every call site is already correct.
   */
  /**
   * Chat, as commands. See src/server/chat.ts for the trust model.
   *
   * ONE endpoint, holding a shared secret, taking a chat line at a time. A bot
   * that already has a verified Twitch connection posts here; this server does
   * not speak IRC and does not want to. `!join` becomes a real
   * `join_dungeon` for a real viewer id, which is the thing that was missing:
   * until now the overlay printed "!join 28s" to an audience that had no way
   * to send it, and every joiner on screen was an operator-fired `sim_join`.
   *
   * A line that is not a command answers `{ ok: true, handled: false }` rather
   * than an error. Nearly every line in a chat is conversation, and a bot
   * forwarding all of them should not be reading 400s all stream.
   */
  if (req.method === "POST" && url.pathname === "/chat") {
    const bot = checkChatBot(req);
    if (!bot.ok) {
      res.writeHead(bot.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: bot.message }));
      return;
    }
    readBody(req, (body) => {
      const line = body as ChatLine | null;
      if (!line || typeof line.userId !== "string" || typeof line.message !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "Expected { userId, userName?, message }" }));
        return;
      }

      const parsed = parseChatLine(line);
      if (!parsed) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, handled: false }));
        return;
      }

      if (parsed.kind === "vote") {
        // False when no doors are up. `!left` typed during a fight is
        // conversation, not an error, and answers like any other line that
        // was not for us.
        const counted = raid.castVote(line.userId, parsed.direction);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, handled: counted, vote: raid.getSnapshot().vote }));
        return;
      }

      const result = raid.dispatch(parsed.command);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...result, handled: true }));
    });
    return;
  }

  /**
   * A channel-point redeem: open a run, picked at random, and put the viewer
   * who paid for it in the party.
   *
   * Behind CHAT_SECRET, not ADMIN_SECRET - see the trust note in chat.ts for
   * why the bot is not simply given the operator's key.
   *
   * `refund` is the contract with the bot. Channel points are the viewer's,
   * and a redeem that arrives while a fight is on screen has bought nothing:
   * the bot reads `refund: true` and hands them back. It is true for every
   * refusal here, because every refusal means no run opened.
   */
  if (req.method === "POST" && url.pathname === "/redeem") {
    const bot = checkChatBot(req);
    if (!bot.ok) {
      res.writeHead(bot.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: bot.message }));
      return;
    }
    readBody(req, (body) => {
      const redeem = body as Redeem | null;
      const kind = redeem ? redeemKind(redeem.reward) : null;
      if (!redeem || typeof redeem.userId !== "string" || !redeem.userId || !kind) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            refund: true,
            message: 'Expected { userId, userName?, reward?: "dungeon" | "raid", role? }',
          }),
        );
        return;
      }

      const ids = (kind === "raid" ? content.listRaids() : content.listDungeons()).map((d) => d.id);
      const id = pickRun(ids, lastRedeemed[kind], Math.random);
      if (!id) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, refund: true, message: `There is no ${kind} to open.` }));
        return;
      }

      const opened = raid.dispatch(
        kind === "raid" ? { type: "open_raid", raidId: id } : { type: "open_dungeon", dungeonId: id },
      );
      if (!opened.ok) {
        // Almost always "a run is already in progress".
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, refund: true, message: opened.message }));
        return;
      }
      lastRedeemed[kind] = id;

      // Whoever paid is in. Making them also type !join inside the window they
      // just bought is how the person who started the dungeon misses it.
      const role = redeemRole(redeem.role);
      const joined = raid.dispatch({
        type: "join_dungeon",
        requestedBy: viewerId(redeem.userId),
        displayName: redeem.userName?.trim() || redeem.userId,
        ...(role ? { role } : {}),
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          refund: false,
          kind,
          opened: id,
          message: opened.message,
          joined: joined.ok,
          joinDeadline: raid.getSnapshot().joinDeadline,
        }),
      );
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/command") {
    readBody(req, (body) => {
      const command = body as GameCommand | null;
      if (!command || typeof command.type !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "Missing command.type" }));
        return;
      }

      if (!isViewerCommand(command.type)) {
        if (denyNonAdmin(req, res)) return;
        const result = raid.dispatch(command);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      // The operator may also act as a viewer — that is how the sim harness
      // drives a character — but a plain viewer must have a session.
      const viewer = sessionViewer(req);
      if (!viewer) {
        const asAdmin = checkAdmin(req);
        if (!asAdmin.ok) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Not signed in" }));
          return;
        }
        const result = raid.dispatch(command);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      const result = raid.dispatch({ ...command, requestedBy: viewer } as GameCommand);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  /**
   * Who am I, and sign me in.
   *
   * GET reports the session. POST creates one, and is DEV ONLY, gated behind
   * ALLOW_DEV_LOGIN, because it takes the viewer id on trust.
   *
   * There used to be a Twitch OAuth flow here too (`/auth/twitch`,
   * `/auth/twitch/callback`), built when this server was meant to serve the
   * loadout itself. It does not any more — the loadout is hosted separately
   * and authenticates straight against Supabase Auth's own Twitch provider
   * (`web/src/loadout/identity.ts`), never touching this server — so that
   * flow had no caller left (nothing under `web/` ever fetched `/session` or
   * `/auth/twitch*`) and was removed along with `src/server/twitch.ts`. What
   * remains is the dev-only shortcut, kept as the seam for whatever P5
   * (Streamer.bot) ends up using to mint a viewer session — see auth.ts.
   */
  if (url.pathname === "/session") {
    if (req.method === "GET") {
      const session = readSession(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          viewer: session?.viewerId ?? null,
          displayName: session?.displayName ?? null,
          devLogin: process.env.ALLOW_DEV_LOGIN === "1",
        }),
      );
      return;
    }

    if (req.method === "POST") {
      if (process.env.ALLOW_DEV_LOGIN !== "1") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            message: "Dev login is disabled on this server. Use Sign in with Twitch.",
          }),
        );
        return;
      }
      readBody(req, (body) => {
        const viewerId = typeof body?.viewerId === "string" ? body.viewerId.trim() : "";
        if (!viewerId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Missing viewerId" }));
          return;
        }
        const displayName =
          typeof body?.displayName === "string" && body.displayName.trim()
            ? body.displayName.trim()
            : viewerId;
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": sessionCookie(issueSession(viewerId, displayName)),
        });
        res.end(JSON.stringify({ ok: true, viewer: viewerId, displayName }));
      });
      return;
    }

    if (req.method === "DELETE") {
      res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": clearSessionCookie() });
      res.end(JSON.stringify({ ok: true, viewer: null }));
      return;
    }
  }

  if (req.method === "GET") {
    const file = serveStatic(url.pathname);
    if (file) {
      res.writeHead(200, { "Content-Type": file.contentType });
      res.end(file.body);
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, message: "Not found" }));
});

/**
 * Load the roster, then open the door — in that order.
 *
 * Serving a single request before the roster is hydrated would let a viewer
 * be created fresh on top of a character that was about to load, and the
 * hydrate that followed would throw their new one away. It is a one-off cost
 * measured in milliseconds and it removes the whole class of race.
 */
async function boot(): Promise<void> {
  try {
    const stored = await rosterStore.load();
    const dropped = pruneUnknownGear(stored, gearExists, (m) =>
      console.warn(`[roster] ${m}`),
    );
    engine.roster.hydrate(stored);
    console.log(
      `Roster: ${stored.length} character(s) from ${storeName}` +
        (dropped > 0 ? ` (${dropped} item(s) dropped - gear no longer in content)` : ""),
    );

    // PROVE THE STORE IS WRITABLE, NOW, BY WRITING TO IT.
    //
    // Reading works fine against a directory nothing can write to, so a
    // misconfigured volume looks perfectly healthy at boot and then fails on
    // every save — which is caught, logged, and otherwise invisible. Measured:
    // a container running as `node` against a root-owned /data served a whole
    // session and persisted nothing.
    //
    // Refusing to start is the right response. A crash-looping deploy is a
    // problem someone fixes in five minutes; a stream that silently discards
    // every character is one they discover the next day.
    await rosterStore.save(stored);
  } catch (err) {
    const message = (err as Error).message;
    // A failed WRITE is fatal; a failed READ is not.
    //
    // The difference is what happens next. An unreadable roster still exists
    // and can be recovered, and the streamer can run the show meanwhile. An
    // unwritable one means everything from here is lost the moment the process
    // ends, and nobody finds out until it has.
    if (/EACCES|EPERM|EROFS|ENOSPC/.test(message)) {
      console.error("[roster] FATAL: cannot write to the store - nothing would be saved.");
      console.error(`[roster] ${message}`);
      console.error("[roster] In a container, the volume at DATA_DIR must be writable by uid 1000.");
      process.exit(1);
    }
    console.error(`[roster] could not load - starting with an empty roster: ${message}`);
  }

  server.listen(PORT, () => {
    console.log(`Dungeon engine server listening on http://localhost:${PORT}`);
    console.log(`  Overlay (add as OBS browser source): http://localhost:${PORT}/?sim=0`);
    console.log(`  Loadout screen (per-viewer):          http://localhost:${PORT}/loadout`);
    console.log(`  Dispatch a command:                  POST http://localhost:${PORT}/command`);
    console.log(`  A full run is three commands:`);
    console.log(`    {"type":"open_dungeon","dungeonId":"${content.listDungeons()[0]?.id ?? "poors"}"}`);
    console.log(`    {"type":"sim_join","count":5,"dress":true}   (or one join_dungeon per real viewer)`);
    console.log(`    {"type":"start_dungeon"}               (or just let the join window time out)`);
  });
}

/**
 * Save on the way out, once, whatever the signal.
 *
 * The debounce means up to a second and a half of play is only in memory at
 * any moment, and a container restart is the most likely way this process
 * ever ends. `once` on each signal rather than a shared flag: two signals in
 * quick succession should still only produce one write, and the flush itself
 * is already serialised.
 */
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    if (saveTimer) clearTimeout(saveTimer);
    void flushRoster().finally(() => {
      console.log("[roster] saved on shutdown");
      process.exit(0);
    });
  });
}

void boot();
