import type { PartyBand } from "../../../src/engine/types.js";
import type { BandReading } from "../../../src/engine/bandSolver.js";
import type { SearchState } from "../../../src/engine/bandSearch.js";
import { supabase } from "../loadout/supabase.js";

/**
 * The hosted operator console's only way to talk to anything.
 *
 * Every call goes to the `operator` Edge Function with the caller's Supabase
 * session attached, and the function re-derives who that is from the verified
 * token. Nothing here decides whether the caller is allowed; it asks, and the
 * far side refuses. That distinction is the whole security model: a page can
 * be edited by whoever is reading it, so the page must not be the gate.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const OPERATOR_FN = `${url ?? ""}/functions/v1/operator`;

export interface RosterEntry {
  id: string;
  twitchId: string | null;
  name: string;
  level: number;
  role: string;
  gold: number;
  chests: number;
  inRun: boolean;
  updatedAt: string | null;
}

async function call<T>(query: string, init?: RequestInit): Promise<T> {
  if (!supabase) throw new Error("This build has no Supabase project configured.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Signed out.");

  const res = await fetch(`${OPERATOR_FN}${query}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });

  const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  if (!res.ok || body?.ok === false) {
    // 401 is the platform rejecting the token before the function runs; 403 is
    // the function deciding this account is not an operator. Different causes,
    // and an operator debugging their own allowlist needs to tell them apart.
    const reason = res.status === 401 ? "Signed out, or the session expired." : body?.message ?? `Request failed (${res.status})`;
    throw new Error(reason);
  }
  return body as T;
}

/** One bit about the caller's own account. Safe for anyone signed in to ask. */
export function whoami(): Promise<{ operator: boolean; twitchId: string | null }> {
  return call("?action=whoami");
}

export function roster(): Promise<{ characters: RosterEntry[] }> {
  return call("?action=roster");
}

export function character(id: string): Promise<{ character: unknown; inRun: boolean }> {
  return call(`?action=character&id=${encodeURIComponent(id)}`);
}

/** Runs one operator command against one character. */
export function command(target: string, cmd: Record<string, unknown>): Promise<{ message?: string }> {
  return call("?action=command", {
    method: "POST",
    body: JSON.stringify({ target, command: cmd }),
  });
}

// --- content -----------------------------------------------------------------

export interface ContentFile {
  path: string;
  updated_at: string;
  updated_by: string | null;
}

export function contentList(): Promise<{ files: ContentFile[] }> {
  return call("?action=content-list");
}

export function contentGet(path: string): Promise<{ file: { path: string; data: unknown } }> {
  return call(`?action=content-get&path=${encodeURIComponent(path)}`);
}

export function contentPut(path: string, data: unknown): Promise<{ message?: string }> {
  return call("?action=content-put", { method: "POST", body: JSON.stringify({ path, data }) });
}

export function contentHistory(
  path: string,
): Promise<{ versions: { id: number; replaced_at: string; replaced_by: string | null }[] }> {
  return call(`?action=content-history&path=${encodeURIComponent(path)}`);
}

export function contentRestore(id: number): Promise<{ message?: string }> {
  return call("?action=content-restore", { method: "POST", body: JSON.stringify({ id }) });
}

/** Everything the tuning screens read, in the shape GET /content returns. */
export function contentAll(): Promise<{ gear: unknown[]; dungeons: unknown[]; raids: unknown[] }> {
  return call("?action=content-all");
}

// --- measurement -------------------------------------------------------------

/**
 * How hard a fight is, measured by the edge playing it.
 *
 * The same simulator the game server runs, bundled into the function (see
 * src/engine/edgeEntry.ts). This exists because the meter it feeds used to
 * point at the game server from a page with no game server behind it: /ratings
 * 404d, /difficulty 405d, and the panel sat on "measuring..." forever while
 * blaming a missing admin key.
 */
export interface DifficultyRequest {
  /** A draft, for the meter to answer about what is on screen rather than on disk. */
  fight?: unknown;
  dungeonId?: string;
  raidId?: string;
  roomId?: string;
  composition: { tanks: number; dps: number; healers: number };
  level: number;
  gear?: "none" | "typical" | "best";
  samples?: number;
}

export function difficulty(body: DifficultyRequest): Promise<Record<string, unknown>> {
  return call("?action=difficulty", { method: "POST", body: JSON.stringify(body) });
}

/** One level of a draft, measured the way the solver measures it. */
export function measureBand(
  fight: unknown,
  band: PartyBand,
  gear?: "none" | "typical" | "best",
): Promise<{ reading: BandReading }> {
  return call("?action=measure-band", { method: "POST", body: JSON.stringify({ fight, band, gear }) });
}

/**
 * One step of solving a level. Returns the search state and the readings
 * taken; send the state back until its phase is "done". See
 * src/engine/bandSearch.ts for why it is resumable.
 */
export function solveBand(
  fight: unknown,
  band: PartyBand,
  state?: SearchState,
): Promise<{ state: SearchState; readings: BandReading[] }> {
  return call("?action=solve-band", { method: "POST", body: JSON.stringify({ fight, band, state }) });
}

export function ratings(): Promise<{
  shapes: { label: string; size: number; rating: number; band: PartyBand }[];
}> {
  return call("?action=ratings");
}

// --- sprites -----------------------------------------------------------------

/** The erased-sprite manifest after a write. See web/src/sprites.ts. */
type Manifest = Record<string, { file: string; original?: string }>;

/** Save an erase as a new object in the sprites bucket. */
export function spritePut(folder: string, id: string, png: string): Promise<{ sprites: Manifest }> {
  return call("?action=sprite-put", { method: "POST", body: JSON.stringify({ folder, id, png }) });
}

/** Point a sprite back at its original. Deletes nothing. */
export function spriteRevert(folder: string, id: string): Promise<{ sprites: Manifest }> {
  return call("?action=sprite-revert", { method: "POST", body: JSON.stringify({ folder, id }) });
}
