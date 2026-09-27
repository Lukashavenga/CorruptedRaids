/**
 * Bring Supabase's content back down to `content/`.
 *
 * The mirror of push-content.ts, and it should have existed at the same time.
 * Content moved into Supabase and the hosted panel edits it there, so the store
 * is the copy the game plays and the disk became a seed nobody re-read. Two
 * things followed from having no way back:
 *
 *   - THE TWO DRIFTED, silently and a long way. Measured 2026-09-27, the disk
 *     had BARBIEVILLE fielding 10/16/18/17/17/25 bodies across its six levels
 *     and the store had 3/6/6/8/11/10 - a different fight, authored in the
 *     panel five days after the last commit touched the file.
 *   - EVERY OFFLINE TOOL WAS READING THE WRONG CONTENT. check-formations,
 *     author-bands, the simulators and check-ladder all open `content/`, so
 *     they were measuring a game nobody plays and reporting on it confidently.
 *
 * SAFE TO RE-RUN, and it says what it would change before changing it. Disk is
 * under git, so a pull that overwrites something is recoverable with `git
 * checkout` - which is the asymmetry with push-content, where the safety net is
 * the history trigger instead.
 *
 *   npm run pull:content          # report what would change
 *   npm run pull:content -- --write
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");
const WRITE = process.argv.includes("--write");

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

if (!URL_BASE || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. See DEPLOY.md section 5.");
  process.exit(1);
}

const res = await fetch(`${URL_BASE}/rest/v1/content_files?select=path,data,updated_at,updated_by&order=path.asc`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  console.error(`Reading content_files failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = (await res.json()) as { path: string; data: unknown; updated_at: string; updated_by: string | null }[];

/**
 * Written as two-space JSON with a trailing newline, in LF - git's autocrlf
 * turns that into CRLF in the working tree on Windows, so writing CRLF here
 * would put the file permanently one normalisation away from itself.
 */
function serialise(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * The same value with its object keys in a fixed order, for COMPARISON ONLY.
 *
 * Two things make a byte comparison useless here and both are invisible:
 * the working tree is CRLF and this writes LF, and `jsonb` does not preserve
 * key order, so a round trip through Postgres reorders every object. Compared
 * as text, all 133 files "differ" on the first run - which is indistinguishable
 * from the store having genuinely replaced the entire content tree, and would
 * bury the four files that really changed under 129 that did not.
 */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

const changed: string[] = [];
const added: string[] = [];

for (const row of rows) {
  // The store holds exactly the path the file has on disk, which is the whole
  // point of the row-per-file schema (sql/003_content.sql).
  const target = join(CONTENT, row.path);
  const next = serialise(row.data);

  const when = `${row.updated_at?.slice(0, 16)} by ${row.updated_by ?? "seed"}`;

  if (!existsSync(target)) {
    added.push(`${row.path}  (new here; store wrote it ${when})`);
  } else {
    let onDisk: unknown;
    try {
      onDisk = JSON.parse(readFileSync(target, "utf-8"));
    } catch {
      // Unparseable on disk counts as different - the store's copy is the one
      // the game is playing, so it wins.
      onDisk = Symbol("unparseable");
    }
    if (canonical(onDisk) === canonical(row.data)) continue;
    changed.push(`${row.path}  (store wrote it ${when})`);
  }

  if (WRITE) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, next);
  }
}

for (const name of added) console.log(`  new      ${name}`);
for (const name of changed) console.log(`  updated  ${name}`);

if (added.length === 0 && changed.length === 0) {
  console.log(`content/ already matches the store (${rows.length} files).`);
} else if (WRITE) {
  console.log(`\nPulled ${added.length + changed.length} of ${rows.length} files into content/.`);
  console.log("Review with `git diff content/` before committing.");
} else {
  console.log(`\n${added.length + changed.length} of ${rows.length} files differ. Re-run with --write to pull them.`);
}

/*
 * NOT DELETED: a file on disk that the store has no row for.
 *
 * It is the ambiguous case - either the store dropped it and the disk copy is
 * stale, or somebody added it locally and has not pushed yet - and guessing
 * wrong destroys work. push-content makes the same call in the other
 * direction, for the same reason.
 */
const paths = new Set(rows.map((r) => r.path));
const orphans: string[] = [];
for (const dir of ["dungeons", "raids", "gear", "consumables"]) {
  const base = join(CONTENT, dir);
  if (!existsSync(base)) continue;
  const { readdirSync } = await import("node:fs");
  for (const file of readdirSync(base)) {
    if (file.endsWith(".json") && !paths.has(`${dir}/${file}`)) orphans.push(`${dir}/${file}`);
  }
}
if (orphans.length > 0) {
  console.log("\nOn disk but not in the store, left alone:");
  for (const name of orphans) console.log(`  ${name}`);
  console.log("Either push it, or delete it once you know which way round it is.");
}
