/**
 * Checks a Supabase setup end to end and says which step is wrong.
 *
 *   npm run check:supabase
 *
 * WHY THIS EXISTS
 * ---------------
 * DEPLOY.md §1-§5 is six credential steps across three dashboards, and every
 * way of getting it wrong fails the same way from the outside: the loadout
 * shows a spinner or an empty character and says nothing useful. Wrong key,
 * SQL never run, function not deployed, LOADOUT_ORIGIN unset — all of them
 * look identical to a person staring at a phone.
 *
 * So this walks the same path the real thing walks, in order, and stops at
 * the first thing that is actually broken. It is the difference between "it
 * doesn't work" and "you pasted the publishable key where the secret goes".
 *
 * IT NEVER PRINTS A SECRET. Keys are reported as a shape ("secret key, 48
 * chars") because the useful question is almost always *which kind of key is
 * this* — answered by prefix for the current keys, and by the role claim for
 * the legacy JWTs.
 *
 * BOTH KEY MODELS ARE ACCEPTED. Supabase is retiring `anon` / `service_role`
 * by the end of 2026 in favour of `sb_publishable_…` / `sb_secret_…`, and a
 * project set up before that switch still works — so this recognises either
 * and names which one it found.
 *
 * Read-only: it selects one row and calls OPTIONS. It writes nothing.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

let failures = 0;
let warnings = 0;

function pass(label: string, detail = ""): void {
  console.log(`  ${GREEN}ok${OFF}    ${label}${detail ? `  ${DIM}${detail}${OFF}` : ""}`);
}
function fail(label: string, fix: string): void {
  failures += 1;
  console.log(`  ${RED}FAIL${OFF}  ${label}`);
  console.log(`        ${YELLOW}->${OFF} ${fix}`);
}
function warn(label: string, note: string): void {
  warnings += 1;
  console.log(`  ${YELLOW}warn${OFF}  ${label}`);
  console.log(`        ${DIM}${note}${OFF}`);
}

/** Which kind of key this is, without verifying it. See the header. */
function keyRole(key: string): { kind: "public" | "secret"; label: string } | null {
  // CURRENT MODEL FIRST. Supabase's publishable/secret keys are not JWTs at
  // all — they are prefixed opaque strings — so they are identified by prefix
  // and there is nothing to decode.
  if (key.startsWith("sb_secret_")) return { kind: "secret", label: "secret key" };
  if (key.startsWith("sb_publishable_")) return { kind: "public", label: "publishable key" };

  // LEGACY: the anon / service_role JWTs. Supabase is retiring these by the
  // end of 2026 but they still work, and an existing project very likely
  // still uses them, so read the role claim out of the payload. Not
  // verifying anything — just answering "which kind of key is this", which
  // is the most common way this setup goes wrong and is otherwise invisible
  // until a write fails.
  const part = key.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part, "base64").toString("utf-8")) as { role?: string };
    if (json.role === "service_role") return { kind: "secret", label: "legacy service_role key" };
    if (json.role === "anon") return { kind: "public", label: "legacy anon key" };
    return null;
  } catch {
    return null;
  }
}

/** Reads a KEY=value file without pulling in a dependency for four lines. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const projectRef = (url: string) => url.replace(/^https?:\/\//, "").split(".")[0] ?? "";

async function main(): Promise<number> {
  console.log(`\n${DIM}Checking the Supabase setup described in DEPLOY.md §1-§5.${OFF}\n`);

  // --- 1. the game server's half -------------------------------------------
  console.log("1. Game server  (root .env)");
  const url = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? "";

  if (!url || !serviceKey) {
    fail(
      "SUPABASE_URL / SUPABASE_SERVICE_KEY",
      !existsSync(join(ROOT, ".env"))
        ? "no .env yet — `cp .env.example .env`, then fill both in from Settings -> API Keys"
        : "set both in .env (Settings -> API Keys). Without them the server uses the local file roster and never talks to Supabase.",
    );
    // Everything below needs these, so there is nothing honest left to check.
    return report();
  }
  /*
   * THE URL MUST BE THE BARE PROJECT ORIGIN, and this is checked before
   * anything else because a malformed one poisons every reading below it.
   *
   * The dashboard shows several URLs that all look like "the project URL" —
   * the Data API page in particular shows the REST endpoint
   * (…supabase.co/rest/v1/). Paste that one in and the code builds
   * `${url}/rest/v1/characters`, which becomes
   * `…/rest/v1//rest/v1/characters` and 404s. The old version of this check
   * reported that as "table characters does not exist" and sent people to
   * re-run SQL that was already fine.
   */
  let origin: string;
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    if (parsed.pathname !== "/" && parsed.pathname !== "") {
      fail(
        `SUPABASE_URL has a path on it  (${parsed.pathname})`,
        `use the bare project origin — ${origin} — with no /rest/v1 and no trailing slash. Everything below is unreliable until this is fixed.`,
      );
      return report();
    }
    if (parsed.protocol !== "https:") {
      warn("SUPABASE_URL is not https", `got ${parsed.protocol}//`);
    }
  } catch {
    fail("SUPABASE_URL is not a URL", `expected https://<project-ref>.supabase.co, got "${url}"`);
    return report();
  }
  pass("SUPABASE_URL", origin);

  const role = keyRole(serviceKey);
  if (role?.kind === "public") {
    fail(
      `SUPABASE_SERVICE_KEY holds a ${role.label}`,
      "that key cannot write. Copy the SECRET key (sb_secret_…) instead — Settings -> API Keys — and keep it out of web/.env.",
    );
  } else if (role?.kind === "secret") {
    pass("SUPABASE_SERVICE_KEY", `${role.label}, ${serviceKey.length} chars`);
  } else {
    warn("SUPABASE_SERVICE_KEY", `not a shape this recognises (${serviceKey.length} chars) — carrying on`);
  }

  // --- 2. the schema --------------------------------------------------------
  console.log("\n2. Schema  (sql/*.sql)");
  const rest = async (path: string, key: string) =>
    fetch(`${origin}/rest/v1${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });

  let reachable = true;
  // Every table a page writes to, with the migration that creates it. This
  // listed only the roster's two for a long time, and sql/002 was missing from
  // the setup checklist as well - so the bug report form shipped against a
  // table nobody had been told to create, and the first person to find out was
  // somebody trying to report a different bug.
  const TABLES: [table: string, migration: string][] = [
    ["characters", "sql/001_roster.sql"],
    ["roster_snapshots", "sql/001_roster.sql"],
    ["bug_reports", "sql/002_bug_reports.sql"],
    ["content_files", "sql/003_content.sql"],
  ];
  for (const [table, migration] of TABLES) {
    try {
      // `select=*` rather than a named column: these tables do not share one.
      const res = await rest(`/${table}?select=*&limit=1`, serviceKey);
      if (res.status === 200) {
        pass(`table "${table}"`);
      } else if (res.status === 404) {
        fail(`table "${table}" does not exist`, `run ${migration} in the Supabase SQL editor (DEPLOY.md §1.2)`);
      } else if (res.status === 401) {
        fail("the service key was refused", "re-copy it from Settings -> API Keys. It may have been rotated.");
      } else {
        fail(`table "${table}" answered ${res.status}`, (await res.text()).slice(0, 200));
      }
    } catch (err) {
      reachable = false;
      fail(`could not reach ${origin}`, `${(err as Error).message} — check the URL and that the project is not paused`);
      break;
    }
  }

  // --- 3. the loadout's half ------------------------------------------------
  console.log("\n3. Loadout build  (web/.env)");
  const webEnv = readEnvFile(join(ROOT, "web", ".env"));
  const viteUrl = webEnv.VITE_SUPABASE_URL ?? "";
  // Either name. The variable was renamed away from "ANON" once Supabase
  // started retiring that key; an older web/.env still uses the old one.
  const anonKeyVar = webEnv.VITE_SUPABASE_PUBLISHABLE_KEY ? "VITE_SUPABASE_PUBLISHABLE_KEY" : "VITE_SUPABASE_ANON_KEY";
  const anonKey = webEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? webEnv.VITE_SUPABASE_ANON_KEY ?? "";

  if (!viteUrl || !anonKey) {
    fail(
      "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY",
      "`cp web/.env.example web/.env` and fill both in. Vite inlines these at BUILD time, so restart dev:web after.",
    );
  } else {
    if (projectRef(viteUrl) !== projectRef(url)) {
      fail(
        "web/.env points at a different project",
        `server is "${projectRef(url)}", loadout is "${projectRef(viteUrl)}" — they must be the same project or the two will never see the same character`,
      );
    } else {
      pass("VITE_SUPABASE_URL", "same project as the server");
    }

    const anonRole = keyRole(anonKey);
    if (anonRole?.kind === "secret") {
      fail(
        `${anonKeyVar} holds a ${anonRole.label}`,
        "this is inlined into the browser bundle. Replace it with the PUBLISHABLE key (sb_publishable_…) and REVOKE that secret key — treat it as leaked.",
      );
    } else if (anonRole?.kind === "public") {
      pass(anonKeyVar, `${anonRole.label}, ${anonKey.length} chars`);
    } else {
      warn(anonKeyVar, `not a shape this recognises (${anonKey.length} chars)`);
    }

    // RLS is what makes the anon key safe to ship. Verify it rather than
    // trusting that the SQL ran: an anon SELECT with no JWT must come back
    // EMPTY, never with rows.
    if (reachable && anonRole?.kind !== "secret") {
      try {
        const res = await rest("/characters?select=id&limit=1", anonKey);
        if (res.status === 200) {
          const rows = (await res.json()) as unknown[];
          if (rows.length === 0) {
            pass("row level security", "anon reads return nothing without a viewer token");
          } else {
            fail(
              "RLS IS NOT PROTECTING `characters`",
              "an anonymous request read a row. Re-run sql/001_roster.sql — the `alter table ... enable row level security` did not take.",
            );
          }
        } else if (res.status === 401) {
          fail("the publishable key was refused", "re-copy it from Settings -> API Keys");
        }
      } catch {
        warn("row level security", "could not be checked — the project was unreachable");
      }
    }
  }

  // --- 4. the Edge Function -------------------------------------------------
  console.log("\n4. Edge Function  (character)");
  if (!existsSync(join(ROOT, "supabase", "functions", "character", "_content.json"))) {
    warn("_content.json is missing", "run `npm run bundle:edge` before deploying, or the function ships with no gear");
  }
  if (reachable) {
    /*
     * Probed with the origins you would actually browse FROM, not a made-up
     * one. LOADOUT_ORIGIN is an allowlist and the function echoes back
     * whichever caller it recognises, so asking as `https://example.invalid`
     * correctly gets nothing back — and an earlier version of this check read
     * that as "LOADOUT_ORIGIN is not set" and sent people to fix something
     * that was already right.
     */
    const LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:8787"];
    try {
      let deployed = false;
      const allowedBack: string[] = [];
      for (const candidate of LOCAL_ORIGINS) {
        const res = await fetch(`${origin}/functions/v1/character`, {
          method: "OPTIONS",
          headers: {
            Origin: candidate,
            "Access-Control-Request-Method": "POST",
            // The headers a REAL call asks for. supabase-js sends `apikey`
            // alongside the bearer token, and a preflight that does not list
            // it fails before the function is ever reached — which is not
            // visible unless the probe asks for the same set.
            "Access-Control-Request-Headers": "authorization, content-type, apikey",
          },
        });
        if (res.status === 404) break;
        deployed = true;

        const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
        for (const needed of ["authorization", "content-type", "apikey"]) {
          if (!allowHeaders.includes(needed)) {
            fail(
              `the preflight does not allow the "${needed}" header`,
              "the loadout will hang on \"Loading character…\" with a CORS error and the function will never see a request. Add it to Access-Control-Allow-Headers in supabase/functions/character/index.ts, then `npm run deploy:fn`.",
            );
            break;
          }
        }

        const allow = res.headers.get("access-control-allow-origin");
        if (allow === "*") {
          fail(
            "LOADOUT_ORIGIN is `*`",
            "the function serves credentialed requests and browsers refuse `*` for those. Name the exact origins instead.",
          );
          allowedBack.length = 0;
          break;
        }
        if (allow === candidate) allowedBack.push(candidate);
      }

      if (!deployed) {
        fail("the function is not deployed", "run `npm run deploy:fn` (bundles content, then deploys)");
      } else {
        pass("deployed");
        if (allowedBack.length > 0) {
          pass("LOADOUT_ORIGIN", `allows ${allowedBack.join(", ")}`);
        } else {
          warn(
            "LOADOUT_ORIGIN allows neither localhost origin",
            "fine if this project only serves a hosted loadout. To test locally:\n" +
              `        npx supabase secrets set LOADOUT_ORIGIN=${LOCAL_ORIGINS.join(",")}\n` +
              "        npm run deploy:fn",
          );
        }
      }
    } catch (err) {
      warn("could not reach the function", (err as Error).message);
    }
  }

  return report();
}

function report(): number {
  console.log("");
  if (failures === 0 && warnings === 0) {
    console.log(`${GREEN}Everything checks out.${OFF} Sign in to the loadout and open a chest.\n`);
    return 0;
  }
  if (failures === 0) {
    console.log(`${YELLOW}${warnings} warning(s), nothing broken.${OFF}\n`);
    return 0;
  }
  console.log(`${RED}${failures} step(s) need fixing${OFF}${warnings ? `, ${warnings} warning(s)` : ""}. Fix the first one and re-run.\n`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
