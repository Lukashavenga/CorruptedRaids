/**
 * Put the sprites erased on this disk into the hosted sprites bucket.
 *
 * Before sql/004_sprites.sql an erase rewrote art/sprites in place and kept the
 * untouched pixels in art/sprites/_original. Hosted, the manifest decides what
 * players see, so each of those erases has to be uploaded once or the first
 * page load after the switch would draw them from the build - where the erased
 * version happens to be committed today, but only until the next re-slice
 * wipes it.
 *
 * Both halves go up: the erased version, and the original as `original.png`,
 * because for these sprites the build no longer has the original in it. The
 * manifest entry carries both so Revert has somewhere to go.
 *
 * ADDITIVE. A sprite that already has a manifest entry is skipped - that entry
 * was made in the admin panel after this migration and is newer than anything
 * on this disk. Uploads use fixed names with upsert, so a re-run after a
 * partial failure overwrites its own objects and nothing else.
 *
 *   npm run push:sprites            # report what would be uploaded
 *   npm run push:sprites -- --write
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGINALS = join(ROOT, "art", "sprites", "_original");
// What ships: the eraser wrote both art/sprites and here, and this is the copy
// players were actually seeing.
const PUBLIC = join(ROOT, "web", "public", "art", "sprites");
const WRITE = process.argv.includes("--write");

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

if (!URL_BASE || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. See DEPLOY.md section 5.");
  process.exit(1);
}

const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };

function pngs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pngs(full);
    return name.endsWith(".png") ? [full] : [];
  });
}

async function upload(objectPath: string, bytes: Buffer): Promise<void> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/sprites/${objectPath}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "image/png", "cache-control": "max-age=31536000", "x-upsert": "true" },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`upload ${objectPath}: ${res.status} ${await res.text()}`);
}

const cur = await fetch(`${URL_BASE}/rest/v1/content_files?path=eq.sprites.json&select=data`, { headers: auth });
if (!cur.ok) throw new Error(`sprites.json: ${cur.status} ${await cur.text()}`);
const existing = (((await cur.json()) as { data: Record<string, unknown> }[])[0]?.data ?? {}) as Record<string, unknown>;

const todo: { key: string; erased: Buffer; original: Buffer }[] = [];
let skippedNewer = 0;
let skippedSame = 0;
for (const file of pngs(ORIGINALS)) {
  const key = relative(ORIGINALS, file).replace(/\\/g, "/").replace(/\.png$/, "");
  if (existing[key]) {
    skippedNewer++;
    continue;
  }
  const shipped = join(PUBLIC, `${key}.png`);
  if (!existsSync(shipped)) {
    console.warn(`  missing  ${key} - has a backup but no shipped sprite; skipped`);
    continue;
  }
  const erased = readFileSync(shipped);
  const original = readFileSync(file);
  // A backup identical to what ships is an erase that was reverted, or never
  // saved. Nothing to host.
  if (erased.equals(original)) {
    skippedSame++;
    continue;
  }
  todo.push({ key, erased, original });
}

console.log(`${todo.length} erased sprite(s) to upload`);
console.log(`  ${skippedNewer} already in the manifest (left alone), ${skippedSame} identical to their original`);
for (const t of todo) console.log(`  ${t.key}`);

if (!WRITE) {
  console.log("\nDry run. Re-run with --write to upload.");
  process.exit(0);
}

for (const t of todo) {
  const file = `${t.key}/migrated.png`;
  const original = `${t.key}/original.png`;
  await upload(file, t.erased);
  await upload(original, t.original);
  // One entry at a time through the same function the panel uses, so an
  // entry made in the panel while this runs is merged rather than flattened.
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/sprites_set`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_key: t.key, p_entry: { file, original }, p_by: "push-sprites" }),
  });
  if (!res.ok) throw new Error(`sprites_set ${t.key}: ${res.status} ${await res.text()}`);
  console.log(`  uploaded ${t.key}`);
}
console.log(`\nDone: ${todo.length} uploaded.`);
