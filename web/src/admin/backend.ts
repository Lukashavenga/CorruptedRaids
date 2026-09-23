import { adminFetch } from "../adminKey.js";
import * as operator from "../operator/api.js";
import type { PlacementFile } from "../../../src/character/layers.js";
import { setSpriteManifest, type SpriteManifest } from "../sprites.js";

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

/**
 * placements.json - where every sprite sits, and the body and hair masks it
 * carves. Read from wherever the screen will write it back to.
 *
 * NO EMPTY FALLBACK. The file is saved WHOLE on every nudge, so a read that
 * quietly became `{}` would make the next drag write one sprite's position over
 * everybody else's. A read that fails throws, and the screen refuses to save
 * until it has the real file. (The overlay's own hook does fall back to `{}`,
 * and is right to: it never writes.)
 */
export async function readPlacements(): Promise<PlacementFile> {
  if ((await backendMode()) === "local") {
    const res = await fetch("/placements");
    if (!res.ok) throw new Error(`GET /placements answered ${res.status}`);
    return (await res.json()) as PlacementFile;
  }
  const { file } = await operator.contentGet("placements.json");
  if (!file.data || typeof file.data !== "object" || Array.isArray(file.data)) {
    throw new Error("placements.json in the store is not an object");
  }
  return file.data as PlacementFile;
}

async function sendPlacements(data: PlacementFile): Promise<void> {
  if ((await backendMode()) === "local") {
    const res = await adminFetch("/placements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    if (!res.ok || !body?.ok) throw new Error(body?.message ?? `Rejected (${res.status})`);
    return;
  }
  await operator.contentPut("placements.json", data);
}

/**
 * One write in flight, and only the newest waiting behind it.
 *
 * The placement screen saves on every pointermove of a drag. Sent as they come,
 * those are dozens of whole-file writes racing each other, and whichever lands
 * LAST wins - not whichever was made last - so a drag could end with the
 * sprite back where it was three frames earlier. Over the network to the Edge
 * Function that stops being theoretical. Each write also files the previous
 * version into content_history, so racing them buries the useful history under
 * a hundred copies of one drag.
 *
 * Serialising them fixes both: the writes arrive in order, and everything made
 * while one is in flight collapses into the newest. Every caller is answered
 * with the outcome of the write that carried their change.
 */
let inFlight: Promise<void> | null = null;
let queued: { data: PlacementFile; waiters: { resolve: () => void; reject: (e: unknown) => void }[] } | null = null;

export function writePlacements(data: PlacementFile): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (queued) {
      queued.data = data;
      queued.waiters.push({ resolve, reject });
    } else {
      queued = { data, waiters: [{ resolve, reject }] };
    }
    if (!inFlight) void drain();
  });
}

async function drain(): Promise<void> {
  while (queued) {
    const batch = queued;
    queued = null;
    inFlight = sendPlacements(batch.data);
    try {
      await inFlight;
      for (const w of batch.waiters) w.resolve();
    } catch (err) {
      for (const w of batch.waiters) w.reject(err);
    }
  }
  inFlight = null;
}

/**
 * Save an erased sprite, or put one back. Null when done, else the reason.
 *
 * Hosted, through the operator function into the public sprites bucket. Local,
 * through the game server, which writes to the same bucket when it has
 * Supabase and to art/sprites only when it does not - so an erase has one home
 * whichever panel made it.
 *
 * The manifest the write produced is applied here, before returning, so the
 * caller's re-render already draws the new object. Waiting for the next
 * reload would show the unerased sprite straight after a successful save.
 */
export function saveSprite(folder: string, id: string, png: string): Promise<string | null> {
  return spriteWrite(() => operator.spritePut(folder, id, png), "/sprite", { folder, id, png });
}

export function revertSprite(folder: string, id: string): Promise<string | null> {
  return spriteWrite(() => operator.spriteRevert(folder, id), "/sprite/revert", { folder, id });
}

async function spriteWrite(
  hosted: () => Promise<{ sprites: SpriteManifest }>,
  localPath: string,
  body: unknown,
): Promise<string | null> {
  try {
    if ((await backendMode()) === "hosted") {
      setSpriteManifest((await hosted()).sprites);
      return null;
    }
    const res = await adminFetch(localPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; sprites?: SpriteManifest } | null;
    if (!res.ok || !out?.ok) return out?.message ?? `Rejected (${res.status})`;
    if (out.sprites) setSpriteManifest(out.sprites);
    return null;
  } catch (err) {
    return (err as Error).message ?? String(err);
  }
}
