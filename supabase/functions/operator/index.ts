/**
 * The operator's half of the hosted game.
 *
 * WHY A SECOND FUNCTION rather than a branch inside `character`. That one
 * answers to any signed-in viewer and is deliberately narrow: it will only
 * ever touch the caller's OWN row, and its whole safety argument rests on
 * `requestedBy` being overwritten from the token. This one answers to a named
 * few and touches anyone's row. Those are different trust levels, and putting
 * them in one file means one mistaken `if` collapses the distinction.
 *
 * WHO IS AN OPERATOR. `OPERATOR_TWITCH_IDS`, a comma-separated secret on the
 * function. A secret rather than a table because it is read on every call, it
 * changes about once a year, and a table needs its own policy that is one more
 * thing to get wrong. Set it with:
 *
 *   npx supabase secrets set OPERATOR_TWITCH_IDS=61018650 --project-ref <ref>
 *
 * Unset means NOBODY is an operator, and every call 403s. That is the same
 * fail-closed rule the game server uses for an unset ADMIN_SECRET: a
 * deployment that forgot to configure this should refuse, not run open.
 *
 * THE PAGE IS NOT THE GATE. The hosted admin asks `whoami` and renders
 * nothing until it hears yes, which is a courtesy to the operator, not
 * security - a static page's checks belong to whoever is reading it. Every
 * action below re-derives the caller from the verified JWT and refuses on its
 * own. Deleting the page's check entirely would change nothing about what a
 * stranger can do.
 */
import {
  BAND_SAMPLE_PARTY,
  ContentRegistry,
  DEFAULT_TARGET_WIN,
  GameEngine,
  PARTY_BANDS,
  bandFor,
  beginSolve,
  continueSolve,
  estimateDifficulty,
  expandFight,
  floorFor,
  measureBand,
  ratePoints,
  referencePartyStrength,
  validateConsumableDefinition,
  validateDungeonDefinition,
  validateGearDefinition,
  validateRaidDefinition,
  validateShopStock,
} from "./_engine.js";
import type { Character, FightDefinition, GameCommand, PartyBand, SearchState } from "./_engine.js";

/**
 * How long one solve request may run before handing its state back.
 *
 * The platform kills a request at 2s of CPU. A level of lady-of-knight takes
 * up to 2.5s to solve, and the heaviest single reading in the game was
 * measured at 317ms - so stopping once 800ms is spent leaves the worst case
 * near 1.1s, with room for Deno being slower than the Node it was timed on.
 * The browser sends the state back until the search is done.
 */
const SOLVE_BUDGET_MS = 800;
import bundledContent from "./_content.json" with { type: "json" };

/**
 * The bundled content, as a FALLBACK only.
 *
 * It is a snapshot taken by `npm run bundle:edge`, and it holds gear,
 * consumables, balance and shop - but no dungeons and no raids, because the
 * character function never needed a fight. So it cannot answer "how hard is
 * BARBIEVILLE" at all, and its gear catalogue is as old as the last deploy.
 *
 * Content lives in Supabase now and is edited from the hosted panel. Measuring
 * against this snapshot would mean tuning a gear stat, watching the difficulty
 * meter not move, and having no way to tell that from the change not
 * mattering - which is the exact failure the draft meter was built to end.
 */
const bundled = new ContentRegistry();
bundled.loadObjects(bundledContent as Parameters<ContentRegistry["loadObjects"]>[0]);

/**
 * The LIVE content, cached per isolate.
 *
 * Building a registry from 132 rows costs about 1.4ms - measured, and a good
 * deal cheaper than the note this replaced assumed. The round trip to
 * PostgREST is the real cost, so that is what the cache is for.
 *
 * Sixty seconds, and dropped outright by any write this isolate handles. The
 * write path is what matters: an operator who saves a gear change and
 * re-measures gets the new number immediately, because the same isolate almost
 * always serves both. The TTL only covers the case where another isolate did
 * the writing, and a minute of staleness there is worth one DB read per minute
 * rather than one per click.
 */
let cached: { at: number; content: ContentRegistry } | null = null;
const CONTENT_TTL_MS = 60_000;

/** Group content rows the way the loader wants them. Mirrors groupContent(). */
function groupRows(rows: { path: string; data: unknown }[]) {
  const out = {
    gear: [] as unknown[],
    consumables: [] as unknown[],
    dungeons: [] as unknown[],
    raids: [] as unknown[],
    balance: undefined as unknown,
    shop: undefined as unknown,
  };
  for (const row of rows) {
    if (row.path.startsWith("gear/")) out.gear.push(row.data);
    else if (row.path.startsWith("consumables/")) out.consumables.push(row.data);
    else if (row.path.startsWith("dungeons/")) out.dungeons.push(row.data);
    else if (row.path.startsWith("raids/")) out.raids.push(row.data);
    else if (row.path === "balance.json") out.balance = row.data;
    else if (row.path === "shop.json") out.shop = row.data;
    // Anything else is ignored rather than fatal, same as the server's loader.
  }
  return out;
}

async function liveContent(): Promise<ContentRegistry> {
  if (cached && Date.now() - cached.at < CONTENT_TTL_MS) return cached.content;
  try {
    const res = await db("/content_files?select=path,data");
    const rows = (await res.json()) as { path: string; data: unknown }[];
    const registry = new ContentRegistry();
    registry.loadObjects(groupRows(rows));
    cached = { at: Date.now(), content: registry };
    return registry;
  } catch (err) {
    // The store being unreachable, or holding content this build cannot
    // validate, must not take the roster screens down with it - they only need
    // gear names. Answering from the snapshot is wrong for difficulty and
    // right for everything else, so the difficulty actions say so rather than
    // quietly reporting a number measured against last month's catalogue.
    console.error(`live content unavailable, falling back to the bundle: ${(err as Error).message}`);
    return bundled;
  }
}

/**
 * A fresh engine per request, holding exactly the character being acted on.
 *
 * Per request and deliberately so: the isolate is shared between concurrent
 * calls, and a shared roster would let one operator's edit land on the
 * character another was looking at.
 */
function seed(character: Character, content: ContentRegistry): GameEngine {
  const engine = new GameEngine(content, Math.random);
  engine.roster.hydrate([character]);
  return engine;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Mirrors the character function's allowlist. One idea, spelled the same. */
function cors(req?: Request): Record<string, string> {
  const allowed = (Deno.env.get("LOADOUT_ORIGIN") ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const asked = (req?.headers.get("Origin") ?? "").replace(/\/$/, "");
  const origin = asked && allowed.includes(asked) ? asked : allowed.length === 1 ? allowed[0]! : "";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(req) },
  });
}

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) throw new Error(`db ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

/**
 * The caller's Twitch id, from their verified token and nowhere else.
 *
 * Identical to the character function's version, and duplicated rather than
 * shared on purpose: this is the line the whole file's security rests on, and
 * it should be readable here without following an import.
 */
function callerTwitchId(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = JSON.parse(atob(auth.slice(7).split(".")[1]!));
    const id = payload?.user_metadata?.provider_id ?? payload?.user_metadata?.sub;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

function isOperator(twitchId: string | null): boolean {
  if (!twitchId) return false;
  const ids = (Deno.env.get("OPERATOR_TWITCH_IDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(twitchId);
}

/**
 * Refuse a content write that the game could not load.
 *
 * The SAME validators the disk loader uses, exported through the edge bundle.
 * Content arrives over HTTP now rather than being typed into a file by
 * somebody who restarts the server and watches it start, so the moment to
 * catch a malformed dungeon is while its author is still looking at it - not
 * at the next boot, with nobody around who remembers touching anything.
 *
 * Keyed off the path, because that is what says which shape a file is. A path
 * with no known shape is refused outright rather than written unchecked: an
 * unrecognised path is either a typo or a new kind of content that nobody has
 * taught this to validate, and both deserve a refusal.
 */
function validateContent(path: string, data: unknown): string | null {
  try {
    if (path.startsWith("gear/")) validateGearDefinition(data, path);
    else if (path.startsWith("dungeons/")) validateDungeonDefinition(data, path);
    else if (path.startsWith("raids/")) validateRaidDefinition(data, path);
    else if (path.startsWith("consumables/")) validateConsumableDefinition(data, path);
    else if (path === "shop.json") validateShopStock(data, path);
    else if (path === "balance.json" || path === "placements.json") {
      // Both are partial by design - balance.json names only the knobs it
      // changes and merges over the in-code defaults, and placements.json is a
      // free-form map of sprite to position. Neither has a validator on the
      // disk side either, so inventing one here would be a second opinion.
      if (typeof data !== "object" || data === null || Array.isArray(data)) return `${path} must be a JSON object`;
    } else if (path === "sprites.json") {
      // Normally written by sprite-put / sprite-revert below, but restoring an
      // older version through content-restore or editing it by hand is also
      // legitimate - so the shape every surface relies on is checked here.
      if (typeof data !== "object" || data === null || Array.isArray(data)) return `${path} must be a JSON object`;
      for (const [key, entry] of Object.entries(data as Record<string, unknown>)) {
        const file = (entry as { file?: unknown } | null)?.file;
        if (typeof file !== "string" || !file) return `${path}: "${key}" has no file`;
      }
    } else {
      return `Refusing to write an unrecognised content path "${path}".`;
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Which sprite an erase is for, as "<folder>/<id>".
 *
 * The same alphabet the game server allowed for its disk writes: one optional
 * nested folder for enemy groups ("enemies/cops"), no dots, no slashes in the
 * id. It becomes an object path in the bucket, and a rejected name is better
 * than a clever one.
 */
function spriteKey(folder: unknown, id: unknown): string | null {
  if (typeof folder !== "string" || !/^[a-z0-9]+(?:\/[a-z0-9-]+)?$/i.test(folder)) return null;
  if (typeof id !== "string" || !/^[a-z0-9_-]+$/i.test(id)) return null;
  return `${folder}/${id}`;
}

const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Decode the eraser's data URL, refusing anything that is not a PNG. */
function decodePng(png: unknown): Uint8Array | string {
  if (typeof png !== "string" || !png.startsWith(PNG_PREFIX)) return "png must be a data:image/png;base64 string";
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(png.slice(PNG_PREFIX.length)), (c) => c.charCodeAt(0));
  } catch {
    return "png is not valid base64";
  }
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return "that is not a PNG";
  // The bucket enforces the same limit; checking here gives a readable refusal.
  if (bytes.length > 2 * 1024 * 1024) return "PNG is over 2MB";
  return bytes;
}

/**
 * Upload one object to the public sprites bucket.
 *
 * `x-upsert: false`: every erase is a NEW name, so an existing object here is a
 * bug, and overwriting it would destroy the version history this bucket
 * exists to keep. Cached for a year because a name is never reused.
 */
async function uploadSprite(objectPath: string, bytes: Uint8Array): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sprites/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "image/png",
      "cache-control": "max-age=31536000",
      "x-upsert": "false",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`storage upload ${objectPath}: ${res.status} ${await res.text()}`);
}

/** Call one of the manifest functions in sql/004_sprites.sql. */
async function manifestRpc(fn: "sprites_set" | "sprites_revert", args: Record<string, unknown>): Promise<unknown> {
  const res = await db(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  return await res.json();
}

interface Row {
  id: string;
  twitch_id: string;
  data: unknown;
  in_run: boolean;
  updated_at?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });

  const twitchId = callerTwitchId(req);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "whoami";

  // `whoami` answers for anyone signed in, because the page needs to know
  // which of two screens to draw. It reveals one bit about the caller's own
  // account and nothing about the game.
  if (action === "whoami") {
    return json({ ok: true, operator: isOperator(twitchId), twitchId }, 200, req);
  }

  if (!isOperator(twitchId)) {
    // Deliberately the same answer for "not signed in", "signed in as someone
    // else" and "OPERATOR_TWITCH_IDS is empty". Telling a stranger which of
    // those it was is telling them how close they are.
    return json({ ok: false, message: "Not an operator." }, 403, req);
  }

  try {
    if (action === "roster") {
      const res = await db("/characters?select=id,twitch_id,data,in_run,updated_at&order=updated_at.desc&limit=500");
      const rows = (await res.json()) as Row[];
      // Trimmed to what a list needs. The full character goes out only when
      // one is asked for by id, so a roster of 500 is not 500 inventories.
      return json(
        {
          ok: true,
          characters: rows.map((r) => {
            const c = r.data as { name?: string; level?: number; role?: string; gold?: number; chests?: unknown[] };
            return {
              id: r.id,
              twitchId: r.twitch_id,
              name: c?.name ?? r.id,
              level: c?.level ?? 1,
              role: c?.role ?? "dps",
              gold: c?.gold ?? 0,
              chests: Array.isArray(c?.chests) ? c.chests.length : 0,
              inRun: r.in_run,
              updatedAt: r.updated_at ?? null,
            };
          }),
        },
        200,
        req,
      );
    }

    if (action === "character") {
      const id = url.searchParams.get("id");
      if (!id) return json({ ok: false, message: "id is required" }, 400, req);
      const res = await db(`/characters?id=eq.${encodeURIComponent(id)}&select=id,twitch_id,data,in_run`);
      const rows = (await res.json()) as Row[];
      const row = rows[0];
      if (!row) return json({ ok: false, message: "No such character." }, 404, req);
      const engine = seed(row.data as Character, await liveContent());
      return json({ ok: true, character: engine.getCharacterView(row.id), inRun: row.in_run }, 200, req);
    }

    if (action === "command" && req.method === "POST") {
      const body = (await req.json()) as { target?: string; command?: Record<string, unknown> };
      const target = body.target;
      const command = body.command;
      if (!target || !command?.type) return json({ ok: false, message: "target and command.type are required" }, 400, req);

      const res = await db(`/characters?id=eq.${encodeURIComponent(target)}&select=id,twitch_id,data,in_run`);
      const rows = (await res.json()) as Row[];
      const row = rows[0];
      if (!row) return json({ ok: false, message: "No such character." }, 404, req);

      // MID-RUN IS REFUSED, exactly as it is for the viewer's own edits. The
      // game server holds the roster in memory during a run and writes behind,
      // so a row edited here would be overwritten by the server's next save.
      // Silently losing an operator's grant is worse than refusing it.
      if (row.in_run) return json({ ok: false, message: `${row.id} is mid-run. Try again once the beat ends.` }, 409, req);

      const engine = seed(row.data as Character, await liveContent());
      // `requestedBy` is the TARGET, not the operator: the engine's commands
      // act on the character they name, and the operator's identity has
      // already done its job by getting past the gate above.
      const result = engine.dispatch({ ...command, requestedBy: target } as unknown as GameCommand);
      if (!result.ok) return json({ ok: false, message: result.message }, 400, req);

      const updated = engine.roster.get(target);
      await db("/characters", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([
          { id: target, twitch_id: row.twitch_id, data: updated, updated_at: new Date().toISOString() },
        ]),
      });
      return json({ ok: true, message: result.message, character: engine.getCharacterView(target) }, 200, req);
    }

    if (action === "content-list") {
      const res = await db("/content_files?select=path,updated_at,updated_by&order=path.asc");
      return json({ ok: true, files: await res.json() }, 200, req);
    }

    if (action === "content-all") {
      /*
       * Everything the tuning screens read, in the shape GET /content returns.
       *
       * The admin panel asks the game server for this. Hosted there is no game
       * server, so it asks here instead and gets the same keys - which is what
       * lets one screen serve both without knowing where it is running.
       */
      const res = await db("/content_files?select=path,data");
      const rows = (await res.json()) as { path: string; data: unknown }[];
      const gear: unknown[] = [];
      const dungeons: unknown[] = [];
      const raids: unknown[] = [];
      const consumables: unknown[] = [];
      for (const row of rows) {
        if (row.path.startsWith("gear/")) gear.push(row.data);
        else if (row.path.startsWith("dungeons/")) dungeons.push(row.data);
        else if (row.path.startsWith("raids/")) raids.push(row.data);
        else if (row.path.startsWith("consumables/")) consumables.push(row.data);
      }
      return json({ ok: true, gear, dungeons, raids, consumables }, 200, req);
    }

    if (action === "content-get") {
      const path = url.searchParams.get("path");
      if (!path) return json({ ok: false, message: "path is required" }, 400, req);
      const res = await db(`/content_files?path=eq.${encodeURIComponent(path)}&select=path,data,updated_at,updated_by`);
      const rows = (await res.json()) as { path: string; data: unknown }[];
      if (!rows[0]) return json({ ok: false, message: `No content at "${path}".` }, 404, req);
      return json({ ok: true, file: rows[0] }, 200, req);
    }

    if (action === "content-put" && req.method === "POST") {
      const body = (await req.json()) as { path?: string; data?: unknown };
      const path = body.path;
      if (!path || body.data === undefined) return json({ ok: false, message: "path and data are required" }, 400, req);

      const invalid = validateContent(path, body.data);
      if (invalid) return json({ ok: false, message: invalid }, 400, req);

      await db("/content_files", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([
          { path, data: body.data, updated_at: new Date().toISOString(), updated_by: twitchId },
        ]),
      });
      // The next read rebuilds the registry, so a gear change is reflected by
      // the difficulty meter on the very next measurement rather than up to a
      // minute later. Saving and re-measuring is one gesture in the panel.
      cached = null;
      // The previous contents are already in content_history by the time this
      // returns - the trigger does it, so no caller can skip it.
      return json({ ok: true, message: `Saved ${path}.` }, 200, req);
    }

    if (action === "content-history") {
      const path = url.searchParams.get("path");
      if (!path) return json({ ok: false, message: "path is required" }, 400, req);
      const res = await db(
        `/content_history?path=eq.${encodeURIComponent(path)}&select=id,replaced_at,replaced_by&order=replaced_at.desc&limit=25`,
      );
      return json({ ok: true, versions: await res.json() }, 200, req);
    }

    if (action === "content-restore" && req.method === "POST") {
      // Restoring is a WRITE, so it goes through the same upsert and leaves
      // the version it replaced in history too. Undo is undoable.
      const body = (await req.json()) as { id?: number };
      if (!body.id) return json({ ok: false, message: "id is required" }, 400, req);
      const res = await db(`/content_history?id=eq.${body.id}&select=path,data`);
      const rows = (await res.json()) as { path: string; data: unknown }[];
      if (!rows[0]) return json({ ok: false, message: "No such version." }, 404, req);
      await db("/content_files", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([
          { path: rows[0].path, data: rows[0].data, updated_at: new Date().toISOString(), updated_by: twitchId },
        ]),
      });
      cached = null;
      return json({ ok: true, message: `Restored ${rows[0].path}.` }, 200, req);
    }

    if (action === "sprite-put" && req.method === "POST") {
      /*
       * Save an erase. Uploads the pixels as a new object, then points the
       * manifest at it - in that order, so a failed upload leaves the manifest
       * on the last good version rather than naming an object that is not
       * there. Nothing already in the bucket is touched.
       */
      const body = (await req.json()) as { folder?: unknown; id?: unknown; png?: unknown };
      const key = spriteKey(body.folder, body.id);
      if (!key) return json({ ok: false, message: "bad folder or id" }, 400, req);
      const bytes = decodePng(body.png);
      if (typeof bytes === "string") return json({ ok: false, message: bytes }, 400, req);

      const file = `${key}/${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      await uploadSprite(file, bytes);

      // The existing entry's `original`, if it has one, has to survive: it is
      // the only copy of that sprite's unerased pixels.
      const current = await db(`/content_files?path=eq.sprites.json&select=data`);
      const rows = (await current.json()) as { data: Record<string, { original?: string }> }[];
      const original = rows[0]?.data?.[key]?.original;
      const sprites = await manifestRpc("sprites_set", {
        p_key: key,
        p_entry: original ? { file, original } : { file },
        p_by: twitchId,
      });
      return json({ ok: true, message: `Saved ${key}.`, sprites }, 200, req);
    }

    if (action === "sprite-revert" && req.method === "POST") {
      // A manifest edit only. The erased objects stay in the bucket, and the
      // manifest this replaces goes to content_history, so a revert is itself
      // undoable.
      const body = (await req.json()) as { folder?: unknown; id?: unknown };
      const key = spriteKey(body.folder, body.id);
      if (!key) return json({ ok: false, message: "bad folder or id" }, 400, req);
      const sprites = await manifestRpc("sprites_revert", { p_key: key, p_by: twitchId });
      return json({ ok: true, message: `Reverted ${key}.`, sprites: sprites ?? {} }, 200, req);
    }

    if (action === "difficulty" && req.method === "POST") {
      /*
       * How hard is this fight, for this party? Measured, by playing it.
       *
       * THE SAME SIMULATOR THE GAME SERVER RUNS, exported through the edge
       * bundle - not a cheaper approximation. AGENTS.md section 6 is emphatic
       * that a formula predicting difficulty from stats has been tried here and
       * lied (it once read "Trivial, 100%" for a fight that measured 13%), so a
       * second opinion living at the edge would be the same mistake wearing a
       * different hat.
       *
       * Two ways to name the fight, because the panel asks both questions: a
       * DRAFT in the body, which is what the tuning screens send so the meter
       * answers for what is on screen rather than what is saved, and an ID for
       * a dungeon or a raid room.
       */
      const body = (await req.json()) as {
        fight?: unknown;
        dungeonId?: string;
        raidId?: string;
        roomId?: string;
        composition?: { tanks?: number; dps?: number; healers?: number };
        level?: number;
        gear?: string;
        samples?: number;
      };

      const content = await liveContent();

      // Every number that reaches the simulator is clamped, because all of them
      // are multipliers on work this function does. `samples` is the obvious
      // one; `dps` is not, and a party of fifty thousand is the same denial of
      // service spelled differently.
      const int = (value: unknown, min: number, max: number, fallback: number): number => {
        const n = Math.floor(Number(value));
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
      };
      const composition = {
        tanks: int(body.composition?.tanks, 0, 50, 1),
        dps: int(body.composition?.dps, 0, 100, 4),
        healers: int(body.composition?.healers, 0, 50, 1),
      };
      if (composition.tanks + composition.dps + composition.healers === 0) {
        return json({ ok: false, message: "A party of nobody has no difficulty." }, 400, req);
      }
      const level = int(body.level, 1, 500, 5);
      const gear = body.gear === "none" || body.gear === "best" ? body.gear : "typical";
      // 200 rather than the server's 400. The server runs on one machine the
      // streamer owns and can afford to be told to work; this one is shared.
      const samples = int(body.samples, 1, 200, 60);

      /*
       * The party's RATING, not its headcount.
       *
       * `expandFight` feeds this straight to `bandFor()`, which reads a
       * composition-adjusted rating in the hundreds or thousands. The server's
       * GET twin passed the party SIZE here, and `bandFor(12)` is `weak` for
       * every party that will ever exist - so that endpoint fielded the weak
       * layout whatever the sliders said and answered 100% win at every level.
       * Fixed there in the same commit as this; written correctly here.
       */
      const strength = referencePartyStrength(composition, level, content, gear);

      let enemies: ReturnType<typeof expandFight> = [];
      let multipliers: { hp: number; atk: number } | undefined;

      if (body.fight && typeof body.fight === "object") {
        enemies = expandFight(body.fight as FightDefinition, "draft", "draft", strength, content.balance.bandStatScale);
      } else if (body.dungeonId) {
        const dungeon = content.getDungeon(body.dungeonId);
        if (!dungeon) return json({ ok: false, message: `No such dungeon "${body.dungeonId}".` }, 404, req);
        enemies = content.expandDungeonEnemies(dungeon, strength);
      } else if (body.raidId) {
        const raid = content.getRaid(body.raidId);
        if (!raid) return json({ ok: false, message: `No such raid "${body.raidId}".` }, 404, req);
        const room = body.roomId ? raid.rooms.find((r) => r.id === body.roomId) : undefined;
        if (body.roomId && !room) {
          return json({ ok: false, message: `Raid "${body.raidId}" has no room "${body.roomId}".` }, 404, req);
        }
        if (room?.fight) {
          enemies = expandFight(room.fight, `${raid.id}:${room.id}`, room.name, strength, content.balance.bandStatScale);
        } else if (!room) {
          // No room named means the BOSS: the fixed wall every run ends at, and
          // the only part of a raid there is one answer for.
          enemies = expandFight(
            raid.boss.fight,
            `${raid.id}:${raid.boss.id}`,
            raid.boss.name,
            strength,
            content.balance.bandStatScale,
          );
          multipliers = { hp: raid.boss.hpMultiplier, atk: raid.boss.atkMultiplier };
        }
      } else {
        return json({ ok: false, message: "Pass a fight draft, a dungeonId or a raidId." }, 400, req);
      }

      if (enemies.length === 0) return json({ ok: false, message: "This layout has no units yet." }, 400, req);
      // A formation is authored data and arrives in the body on the draft path,
      // so its size is the caller's choice. The largest real fight is 25.
      if (enemies.length > 200) {
        return json({ ok: false, message: `${enemies.length} bodies is more than this will measure.` }, 400, req);
      }

      const report = estimateDifficulty(enemies, content, {
        composition,
        level,
        gear,
        samples,
        enemyMultipliers: multipliers,
      });
      // The squad's own rating, priced with the same scorer as a party's, so
      // "squad 3,420 against a party of 1,200" is a comparison rather than two
      // unrelated numbers.
      const enemyRating = enemies.reduce((sum, e) => sum + ratePoints(e.stats, content.balance), 0);
      return json(
        { ok: true, ...report, enemyCount: enemies.length, enemyRating, partyRating: Math.round(strength) },
        200,
        req,
      );
    }

    if (action === "ratings") {
      /*
       * What real party shapes rate, and which level each one meets.
       *
       * The reference table for the whole difficulty model - "what do thirty
       * naked players get?", "does a small kitted group outrank a big scruffy
       * one?" - answered by reading a row rather than by reasoning about a
       * formula nobody can hold in their head. Computed here rather than in the
       * browser because dressing the reference parties needs the gear
       * catalogue, and the browser has no copy of it.
       */
      const content = await liveContent();
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
      return json({ ok: true, shapes: rows }, 200, req);
    }

    if (action === "measure-band" && req.method === "POST") {
      // One level of a draft, measured the way the solver measures it - so the
      // percentage on a level's tab is the number the Solve button aimed at.
      const body = (await req.json()) as { fight?: unknown; band?: string; gear?: string };
      if (!body.fight || typeof body.fight !== "object") return json({ ok: false, message: "expected a fight draft" }, 400, req);
      if (!body.band || !PARTY_BANDS.includes(body.band as PartyBand)) {
        return json({ ok: false, message: `expected a band: ${PARTY_BANDS.join(", ")}` }, 400, req);
      }
      const gear = body.gear === "none" || body.gear === "typical" || body.gear === "best" ? body.gear : undefined;
      const reading = measureBand(body.fight as FightDefinition, body.band as PartyBand, await liveContent(), { gear });
      return json({ ok: true, reading }, 200, req);
    }

    if (action === "solve-band" && req.method === "POST") {
      /*
       * One level, solved towards the draft's own target - resumably.
       *
       * The browser sends the fight and the level; this runs the search for up
       * to SOLVE_BUDGET_MS and returns its state. While the state is not
       * "done", the browser sends it straight back. Target and ratchet floor
       * come from the DRAFT, never the request, so a level cannot be solved
       * against numbers the fight does not carry.
       */
      const body = (await req.json()) as { fight?: unknown; band?: string; state?: SearchState };
      if (!body.fight || typeof body.fight !== "object") return json({ ok: false, message: "expected a fight draft" }, 400, req);
      const band = body.band as PartyBand;
      if (!band || !PARTY_BANDS.includes(band)) {
        return json({ ok: false, message: `expected a band: ${PARTY_BANDS.join(", ")}` }, 400, req);
      }
      const fight = body.fight as FightDefinition;
      if (!fight.formations?.[band]?.length) {
        return json({ ok: false, message: `level ${PARTY_BANDS.indexOf(band) + 1} has no units to solve` }, 400, req);
      }
      const content = await liveContent();
      const start =
        body.state ??
        beginSolve(fight, band, content, {
          target: fight.targetWinRate ?? DEFAULT_TARGET_WIN,
          floor: floorFor(fight, band, content),
        });
      const result = continueSolve(fight, band, content, start, SOLVE_BUDGET_MS);
      return json({ ok: true, ...result }, 200, req);
    }

    if (action === "bands") {
      // What party each level is measured against, so the panel does not carry
      // its own copy of a table the engine owns.
      return json({ ok: true, bands: PARTY_BANDS, sample: BAND_SAMPLE_PARTY }, 200, req);
    }

    return json({ ok: false, message: `Unknown action "${action}".` }, 400, req);
  } catch (err) {
    return json({ ok: false, message: (err as Error).message }, 500, req);
  }
});
