/**
 * Put `content/` into Supabase.
 *
 * One row per file, keyed by the path it has on disk, so `gear/rusty-dagger.json`
 * stays addressable by that name everywhere. See sql/003_content.sql for why a
 * row per file rather than a normalised schema.
 *
 * SAFE TO RE-RUN, and safe to run against a store that is already ahead: every
 * write goes through the history trigger, so a row this overwrites is kept.
 * That is deliberate, because the obvious accident with a seed script is
 * running it after editing content in the hosted panel and flattening the
 * edits with whatever is on this disk. The trigger means that is recoverable
 * rather than final - but it is still an accident, so the script says what it
 * is about to replace and needs --write to do it.
 *
 *   npm run push:content          # report what would change
 *   npm run push:content -- --write
 */
import { readFileSync, readdirSync, statSync } from "node:fs";

/**
 * The same value with its object keys in a fixed order, for COMPARISON ONLY.
 *
 * `jsonb` does not preserve key order, so a value that has been through
 * Postgres comes back reordered and a plain JSON.stringify comparison calls
 * every file changed. Measured: this script offered to rewrite 129 of 133 rows
 * when five had actually changed - which is not just noise, it is 124 no-op
 * versions in content_history burying the real ones.
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
import { join, dirname, relative } from "node:path";
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

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${URL_BASE}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: KEY!,
      Authorization: `Bearer ${KEY!}`,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

/** Every .json under content/, as repo-relative paths with forward slashes. */
function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...files(full));
    } else if (name.endsWith(".json")) {
      out.push(relative(CONTENT, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

const local = files(CONTENT).sort();
console.log(`\n${local.length} content files on disk.`);

const existing = new Map<string, string>();
{
  const res = await db("/content_files?select=path,data");
  for (const row of (await res.json()) as { path: string; data: unknown }[]) {
    existing.set(row.path, canonical(row.data));
  }
}
console.log(`${existing.size} rows already in Supabase.\n`);

const toWrite: { path: string; data: unknown }[] = [];
let same = 0;

for (const path of local) {
  const data = JSON.parse(readFileSync(join(CONTENT, path), "utf-8"));
  const serialised = canonical(data);
  const was = existing.get(path);
  if (was === undefined) {
    console.log(`  new       ${path}`);
    toWrite.push({ path, data });
  } else if (was !== serialised) {
    console.log(`  REPLACES  ${path}`);
    toWrite.push({ path, data });
  } else {
    same += 1;
  }
}

// A row with no file is NOT deleted. Deleting content because it is missing
// from one checkout is how a stale clone erases a night's work.
const orphans = [...existing.keys()].filter((p) => !local.includes(p));
for (const path of orphans) console.log(`  in db only, left alone: ${path}`);

console.log(`\n${same} unchanged, ${toWrite.length} to write, ${orphans.length} only in the database.`);

if (!toWrite.length) {
  console.log("Nothing to do.\n");
  process.exit(0);
}

if (!WRITE) {
  console.log("Re-run with --write to apply. Replaced rows are kept in content_history.\n");
  process.exit(0);
}

// Chunked: a single request with 119 gear definitions in it is large enough to
// be refused, and a failure halfway through a chunk is easier to reason about
// than one halfway through everything.
const CHUNK = 25;
for (let i = 0; i < toWrite.length; i += CHUNK) {
  const batch = toWrite.slice(i, i + CHUNK).map((r) => ({
    path: r.path,
    data: r.data,
    updated_at: new Date().toISOString(),
    updated_by: "push-content",
  }));
  await db("/content_files", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(batch),
  });
  console.log(`  wrote ${Math.min(i + CHUNK, toWrite.length)}/${toWrite.length}`);
}

console.log(`\nDone. ${toWrite.length} file(s) in Supabase.\n`);
