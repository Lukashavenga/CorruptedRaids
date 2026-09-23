import type { PlacementFile } from "../../src/character/layers.js";
import type { SpriteManifest } from "./sprites.js";

/**
 * placements.json and sprites.json, read live from the content store.
 *
 * These two are what every surface needs to DRAW a character - where each
 * piece sits, and which PNG it is - and both are edited from the hosted admin.
 * Read from anywhere else (the static copy baked into the loadout at deploy,
 * the game server's copy from boot) and an edit reaches players at the next
 * deploy or restart, so an erased helm could show up at last week's position.
 *
 * PLAIN FETCH, not the Supabase client. The overlay has no sign-in and no
 * reason to carry the SDK; these rows are readable with the public key alone
 * (sql/004_sprites.sql scopes that read to exactly these two paths).
 *
 * Null when this build has no project configured or the store cannot be
 * reached, so the caller falls back to what it had before.
 */
export async function fetchLiveArt(): Promise<{ placements?: PlacementFile; sprites?: SpriteManifest } | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
    | string
    | undefined;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/content_files?path=in.(placements.json,sprites.json)&select=path,data`,
      { headers: { apikey: key }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { path: string; data: unknown }[];
    const out: { placements?: PlacementFile; sprites?: SpriteManifest } = {};
    for (const row of rows) {
      if (row.path === "placements.json") out.placements = row.data as PlacementFile;
      else if (row.path === "sprites.json") out.sprites = row.data as SpriteManifest;
    }
    return out;
  } catch {
    return null;
  }
}
