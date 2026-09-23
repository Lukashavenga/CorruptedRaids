import { adminFetch } from "../adminKey.js";
import * as operator from "../operator/api.js";

/**
 * Where the admin panel's content comes from, and where it goes.
 *
 * The panel used to be local-only because every write was a file write through
 * the game server. Content lives in Supabase now (sql/003_content.sql), so the
 * same screens can run against either:
 *
 *   LOCAL   served by the game server on its own port. Reads GET /content and
 *           writes POST /content/write, authenticated by ADMIN_SECRET. This is
 *           the path that also re-reads the registry, so a saved fight is live
 *           in the running game immediately.
 *
 *   HOSTED  served as a static page with no game server anywhere near it.
 *           Reads and writes go through the operator Edge Function, gated on a
 *           Supabase-verified operator allowlist, and reach the game at its
 *           next restart.
 *
 * DETECTED, NOT CONFIGURED. A build flag would have to be right in two builds,
 * and the failure mode is a hosted page quietly posting to a localhost that
 * does not answer. Asking the game server whether it is there is one request
 * and cannot be wrong.
 */

let mode: "local" | "hosted" | null = null;

/**
 * Probe once, remember the answer.
 *
 * `/state` rather than `/content`: it is the smallest thing the game server
 * serves, and a hosted deployment 404s it immediately rather than waiting on a
 * timeout. The catch covers the static host answering with its own 404 page.
 */
export async function backendMode(): Promise<"local" | "hosted"> {
  if (mode) return mode;
  try {
    const res = await fetch("/state", { method: "GET" });
    mode = res.ok ? "local" : "hosted";
  } catch {
    mode = "hosted";
  }
  return mode;
}

export interface TuningContent {
  gear: unknown[];
  dungeons: unknown[];
  raids: unknown[];
}

export async function readContent(): Promise<TuningContent> {
  if ((await backendMode()) === "local") {
    const res = await fetch("/content");
    const data = await res.json();
    return { gear: data.gear ?? [], dungeons: data.dungeons ?? [], raids: data.raids ?? [] };
  }
  const data = await operator.contentAll();
  return { gear: data.gear, dungeons: data.dungeons, raids: data.raids };
}

/**
 * The path a piece of content lives at, from the `kind` the panel already
 * passes. One mapping, so a screen never has to know that a dungeon is
 * `dungeons/<id>.json` - which is the kind of detail that ends up spelled two
 * different ways in two components.
 */
function pathFor(kind: string, id: string): string {
  if (kind === "dungeon") return `dungeons/${id}.json`;
  if (kind === "raid") return `raids/${id}.json`;
  if (kind === "gear") return `gear/${id}.json`;
  if (kind === "consumable") return `consumables/${id}.json`;
  throw new Error(`Unknown content kind "${kind}"`);
}

/** Save one piece of content. Throws with the server's reason on refusal. */
export async function writeContent(kind: string, id: string, data: unknown): Promise<void> {
  if ((await backendMode()) === "local") {
    const res = await adminFetch("/content/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, data }),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.message ?? "Rejected");
    return;
  }
  await operator.contentPut(pathFor(kind, id), data);
}
