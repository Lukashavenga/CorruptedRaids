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
  ContentRegistry,
  GameEngine,
  validateConsumableDefinition,
  validateDungeonDefinition,
  validateGearDefinition,
  validateRaidDefinition,
  validateShopStock,
} from "./_engine.js";
import type { Character, GameCommand } from "./_engine.js";
import bundledContent from "./_content.json" with { type: "json" };

// Built once per isolate, not per request, for the same reason the character
// function does it: validating 119 gear definitions on every click would
// dominate the response time. Shared safely because it is read-only.
const content = new ContentRegistry();
content.loadObjects(bundledContent as Parameters<ContentRegistry["loadObjects"]>[0]);

/**
 * A fresh engine per request, holding exactly the character being acted on.
 *
 * Per request and deliberately so: the isolate is shared between concurrent
 * calls, and a shared roster would let one operator's edit land on the
 * character another was looking at.
 */
function seed(character: Character): GameEngine {
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
    } else {
      return `Refusing to write an unrecognised content path "${path}".`;
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
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
      const engine = seed(row.data as Character);
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

      const engine = seed(row.data as Character);
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
      return json({ ok: true, message: `Restored ${rows[0].path}.` }, 200, req);
    }

    return json({ ok: false, message: `Unknown action "${action}".` }, 400, req);
  } catch (err) {
    return json({ ok: false, message: (err as Error).message }, 500, req);
  }
});
