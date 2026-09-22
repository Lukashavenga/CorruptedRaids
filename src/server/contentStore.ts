/**
 * Content, fetched from Supabase instead of read off this machine's disk.
 *
 * WHY. Every authoring surface used to write a file in this repo, which made
 * the admin panel usable from exactly one computer and put the only copy of
 * hours of work on a disk with no history. The roster made this move already:
 * it was data/roster.json and is now a table the server reads at boot. This is
 * the same move for gear, dungeons, raids, consumables, balance, the shop and
 * placements.
 *
 * THE DISK IS STILL THE FALLBACK, not a legacy path to delete. A fresh clone
 * with no Supabase configured has to boot and run, `npm run simulate` reads
 * content without a network, and a stream should not stop because a database
 * is having an afternoon. So: Supabase when configured and reachable,
 * otherwise `content/`, and the server says which it used.
 *
 * NO WATCHING, NO POLLING. The server loads once at boot, the same as it
 * always did with files. An edit made in the hosted panel reaches the game at
 * the next restart, and a reload endpoint already exists for pulling it in
 * sooner. Live-reloading content underneath a running fight is a different
 * feature with its own questions - what happens to a dungeon being fought in
 * when it changes - and inventing answers to those silently is worse than
 * asking for a restart.
 */
import type { ContentRegistry } from "../engine/content/loader.js";

export interface ContentRow {
  path: string;
  data: unknown;
}

/** Every content file in the store, or null when Supabase is not configured. */
export async function fetchContent(): Promise<ContentRow[] | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  const res = await fetch(`${url}/rest/v1/content_files?select=path,data`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`content_files: ${res.status} ${await res.text()}`);
  return (await res.json()) as ContentRow[];
}

/**
 * Sort rows into the shape `loadObjects` wants.
 *
 * Keyed off the path, which is the same thing that decides a file's shape on
 * disk - `gear/rusty-dagger.json` is a gear definition because of where it
 * lives, and that stayed true when the directory became a table.
 */
export function groupContent(rows: ContentRow[]): {
  gear: unknown[];
  consumables: unknown[];
  dungeons: unknown[];
  raids: unknown[];
  balance?: unknown;
  shop?: unknown;
  placements?: unknown;
} {
  const out = {
    gear: [] as unknown[],
    consumables: [] as unknown[],
    dungeons: [] as unknown[],
    raids: [] as unknown[],
    balance: undefined as unknown,
    shop: undefined as unknown,
    placements: undefined as unknown,
  };
  for (const row of rows) {
    if (row.path.startsWith("gear/")) out.gear.push(row.data);
    else if (row.path.startsWith("consumables/")) out.consumables.push(row.data);
    else if (row.path.startsWith("dungeons/")) out.dungeons.push(row.data);
    else if (row.path.startsWith("raids/")) out.raids.push(row.data);
    else if (row.path === "balance.json") out.balance = row.data;
    else if (row.path === "shop.json") out.shop = row.data;
    else if (row.path === "placements.json") out.placements = row.data;
    // An unrecognised path is IGNORED rather than fatal: the store is shared
    // with whatever a later version of the panel decides to keep there, and an
    // old server refusing to boot over a file it has never heard of is a bad
    // way to find out somebody added a feature.
  }
  return out;
}

/**
 * Fill a registry from the store. Returns false when Supabase is not
 * configured, so the caller can fall back to the directory loaders.
 */
export async function loadContentFromSupabase(
  content: ContentRegistry,
): Promise<{ loaded: boolean; placements?: unknown; count: number }> {
  const rows = await fetchContent();
  if (!rows) return { loaded: false, count: 0 };
  if (!rows.length) throw new Error("content_files is empty - run `npm run push:content -- --write`");

  const grouped = groupContent(rows);
  content.loadObjects({
    gear: grouped.gear,
    consumables: grouped.consumables,
    dungeons: grouped.dungeons,
    raids: grouped.raids,
    balance: grouped.balance,
    shop: grouped.shop,
  });
  return { loaded: true, placements: grouped.placements, count: rows.length };
}

/**
 * Write one content file to the store.
 *
 * Returns false when Supabase is not configured, so the caller can fall back
 * to writing the file - the same shape as the read path, and for the same
 * reason.
 *
 * `updated_by` is "game-server" rather than a person: this path is reached
 * from the LOCAL admin screen, which is authenticated by ADMIN_SECRET and has
 * no notion of which human is holding it. The hosted panel records a Twitch
 * id because it actually knows one.
 */
export async function writeContentFile(path: string, data: unknown): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return false;

  const res = await fetch(`${url}/rest/v1/content_files`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([
      { path, data, updated_at: new Date().toISOString(), updated_by: "game-server" },
    ]),
  });
  if (!res.ok) throw new Error(`content_files write ${path}: ${res.status} ${await res.text()}`);
  return true;
}
