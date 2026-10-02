import type { PartyBand } from "../../../src/engine/types.js";
import type { BandReading, BandSolution } from "../../../src/engine/bandSolver.js";
import type { SearchState } from "../../../src/engine/bandSearch.js";
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

// --- measurement -------------------------------------------------------------

/**
 * Does this screen need the operator to type an admin key first?
 *
 * Only locally. The key is `ADMIN_SECRET`, which belongs to the game server;
 * hosted there is no game server and the caller has already proved who they
 * are with a Twitch sign-in the edge verified. Asking for a key there is
 * asking for a password to a machine that is not in the conversation - and
 * that is exactly what the difficulty meter did: it refused to measure,
 * saying "enter the admin key above", when no key would have helped.
 */
export async function needsAdminKey(): Promise<boolean> {
  return (await backendMode()) === "local";
}

export interface DifficultyRequest {
  /** The draft on screen. Takes precedence over the ids below. */
  fight?: unknown;
  dungeonId?: string;
  raidId?: string;
  roomId?: string;
  composition: { tanks: number; dps: number; healers: number };
  level: number;
  gear?: "none" | "typical" | "best";
  samples?: number;
}

/**
 * Measure one fight against one party.
 *
 * The two backends take the same question in different shapes - the game
 * server has a GET form for ids and a POST form for drafts, the Edge Function
 * takes one POST for both - so this is where that is reconciled rather than in
 * each screen.
 */
export async function measureDifficulty(req: DifficultyRequest): Promise<Record<string, unknown>> {
  if ((await backendMode()) === "local") {
    const { composition, level, gear, samples } = req;
    if (req.fight) {
      const res = await adminFetch("/difficulty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const body = await res.json();
      if (typeof body?.winRate !== "number") throw new Error(body?.message ?? "could not measure");
      return body;
    }
    const target = req.dungeonId
      ? `dungeonId=${encodeURIComponent(req.dungeonId)}`
      : `raidId=${encodeURIComponent(req.raidId ?? "")}${req.roomId ? `&roomId=${encodeURIComponent(req.roomId)}` : ""}`;
    const query =
      `${target}&tanks=${composition.tanks}&dps=${composition.dps}&healers=${composition.healers}` +
      `&level=${level}&gear=${gear ?? "typical"}&samples=${samples ?? 150}`;
    const res = await adminFetch(`/difficulty?${query}`);
    const body = await res.json();
    if (typeof body?.winRate !== "number") throw new Error(body?.message ?? "could not measure");
    return body;
  }
  return operator.difficulty(req);
}

/**
 * One level of a draft, measured against the party that level is for.
 *
 * The per-level percentages on the balance screen. The game server and the
 * Edge Function both run measureBand from src/engine/bandSolver.ts, which is
 * the function the solver aims with - so the number on the tab is the number
 * Solve targeted, not a second sample that disagrees with it.
 */
export async function measureLevel(
  fight: unknown,
  band: PartyBand,
  gear?: "none" | "typical" | "best",
): Promise<BandReading> {
  if ((await backendMode()) === "local") {
    const res = await adminFetch("/difficulty/measure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fight, band, gear }),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.message ?? "could not measure");
    return body.reading as BandReading;
  }
  return (await operator.measureBand(fight, band, gear)).reading;
}

/**
 * Solve one level of a draft towards the draft's own target.
 *
 * THE LOOP LIVES HERE, not in the server, because the hosted server is an Edge
 * Function killed at 2s of CPU and one level can take 2.5s. Each request runs
 * the search as far as it can and hands its state back; this sends it again
 * until the search says it is done. Locally the game server finishes in one
 * reply and the loop runs once. Either way the search itself is the engine's
 * (src/engine/bandSearch.ts) - this only carries it back and forth.
 *
 * `onStep` reports progress, so a level that takes several round trips on the
 * hosted panel shows it is working rather than looking hung.
 */
export async function solveLevel(
  fight: unknown,
  band: PartyBand,
  onStep?: (evaluations: number) => void,
): Promise<BandSolution> {
  const local = (await backendMode()) === "local";
  const readings: BandReading[] = [];
  let state: SearchState | undefined;

  for (let round = 0; round < 40; round += 1) {
    let reply: { state: SearchState; readings: BandReading[] };
    if (local) {
      const res = await adminFetch("/difficulty/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fight, band, state }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.message ?? "could not solve");
      reply = body;
    } else {
      reply = await operator.solveBand(fight, band, state);
    }
    readings.push(...reply.readings);
    state = reply.state;
    onStep?.(state.evaluations);

    if (state.phase === "done" && state.best) {
      const best = state.best;
      // The full reading for the winning candidate. It may have been taken on
      // an earlier request than the one that finished, which is why every
      // request's readings are kept.
      const reading = readings.find((r) => r.scale === best.scale);
      if (!reading) throw new Error("the solver finished on a reading it did not return");
      return { ...reading, scale: Number(best.scale.toFixed(3)), bound: state.bound, evaluations: state.evaluations };
    }
  }
  // A backstop against a server that never finishes. The search itself stops
  // at 24 readings, so reaching this means something other than the search
  // is wrong.
  throw new Error("solving did not finish");
}

/** One row of the reference table. */
export interface RatingShape {
  label: string;
  size: number;
  rating: number;
  band: PartyBand;
}

/** The reference table: what real party shapes rate, and which level each meets. */
export async function readRatings(): Promise<RatingShape[]> {
  if ((await backendMode()) === "local") {
    const res = await fetch("/ratings");
    if (!res.ok) throw new Error(`the game server refused /ratings (${res.status})`);
    const data = await res.json();
    return data.shapes ?? [];
  }
  const data = await operator.ratings();
  return data.shapes ?? [];
}

// --- local-only operations --------------------------------------------------
//
// Two things still need the game server, and both used to be called straight
// from their screens. One refused properly when hosted; the other posted to a
// static host, got an HTML error page back, failed to parse it, and did
// nothing at all - a Delete button that silently did not delete. They live here
// now, where the switch is, and say so in words when there is no server.

/** Thrown when an operation needs the game server and this page is hosted. */
export class NeedsLocalPanel extends Error {
  constructor(what: string) {
    super(`${what} needs the local admin panel for now.`);
    this.name = "NeedsLocalPanel";
  }
}

/**
 * Change a dungeon's ID. LOCAL ONLY: it moves a file, and the hosted store has
 * no atomic equivalent - a rename there is a delete plus an insert, and a
 * half-finished one leaves a dungeon under two ids.
 */
export async function renameContent(kind: string, id: string, newId: string): Promise<void> {
  if ((await backendMode()) === "hosted") throw new NeedsLocalPanel("Changing an id");
  const res = await adminFetch("/content/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id, newId }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.message);
}

/**
 * Delete a piece of content. LOCAL ONLY for now: the game server knows which
 * other files name it and offers to remove it from them too, and that
 * reference check has no hosted equivalent yet. Deleting without it would leave
 * a raid pointing at a dungeon that no longer exists.
 *
 * Returns the server's answer, including `references` when other content still
 * uses it and `force` was not set.
 */
export async function deleteContent(
  kind: string,
  id: string,
  force: boolean,
): Promise<{ ok: boolean; message?: string; references?: { file: string }[] }> {
  if ((await backendMode()) === "hosted") throw new NeedsLocalPanel(`Deleting a ${kind}`);
  const res = await adminFetch("/content/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id, force }),
  });
  return res.json();
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
