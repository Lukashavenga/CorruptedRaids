/**
 * Does the loadout still work when there is no game server?
 *
 * THE BUG THIS EXISTS FOR has now shipped three times in one day, silently
 * each time, and always the same shape: a loadout component fetches a path the
 * GAME SERVER serves, which works perfectly against localhost:8787 and returns
 * 404 on the hosted site, where the loadout is a static site with nothing
 * behind it. Every one of them failed soft rather than loudly.
 *
 *   - `/placements` 404'd, the hook fell back to `{}`, and `{}` is a LEGAL
 *     placement file meaning "nothing positioned yet" - so every character on
 *     the hosted site drew its gear stacked at the origin, with no error.
 *   - the shop shipped as raw ids where the screen wanted `{ id, price }`, so
 *     every lookup missed and a fully stocked shop rendered "Nothing in stock".
 *   - the bestiary would have read `catalog.dungeons`, which is empty without
 *     `GET /content`, and rendered "0 known" to every real player.
 *
 * None of these break a build, a type check or a test. They are only visible
 * to someone signed in on the hosted site looking at the right screen, which
 * is why they survived. So this walks the loadout's import graph and refuses
 * any fetch of a server-only path.
 *
 * SOURCE, NOT BUNDLE. Scanning the built JS for path substrings is what I
 * tried first and it is too noisy to be a gate: `/events` matches inside
 * Supabase's realtime client and `/sprite` matches the filename
 * `spriteIndex-BgcaFhkg.js`. A gate that cries wolf gets bypassed, so this
 * reads the sources and only looks at the first argument of a `fetch(` call.
 *
 * WHAT IT CANNOT SEE, stated plainly because an undocumented blind spot in a
 * check is worse than no check - it buys confidence it has not earned. This
 * matches a STRING LITERAL first argument. A path built from a variable, or
 * held in an array and looped over (which is what usePlacements does today),
 * goes straight past it. It catches the shape all three real bugs had, and it
 * would not catch a fourth written differently. Widen it when that happens
 * rather than trusting it to be exhaustive now.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "web", "src", "loadout", "main.tsx");

/**
 * The admin panel, which is hosted too now and has the same problem.
 *
 * It arrived later and worse. The loadout at least failed soft; the admin
 * panel's difficulty meter fetched /ratings and /difficulty - both game server
 * routes - from a page with no game server behind it, so /ratings 404d and the
 * table sat on "measuring..." indefinitely while the meter told the operator
 * to enter an admin key that would not have helped. Nothing caught it because
 * this file only ever walked the loadout.
 */
const ADMIN_ENTRY = join(ROOT, "web", "src", "admin", "main.tsx");

/**
 * The ONE file allowed to know the game server exists.
 *
 * web/src/admin/backend.ts probes for the server and picks a path per call:
 * the game server when it answers, the operator Edge Function when it does
 * not. Every server-only fetch in the admin panel belongs in there, so the
 * rule for the rest of the panel is simply "not you" - which is a rule with no
 * exceptions to argue about, unlike a list of which paths have fallbacks.
 */
const ADMIN_SWITCH = "web/src/admin/backend.ts";

/**
 * Paths only `src/server/index.ts` answers. Anything here is unreachable from
 * the hosted loadout.
 */
const SERVER_ONLY = [
  "/state",
  "/content",
  "/events",
  "/command",
  "/character",
  "/ratings",
  "/difficulty",
  "/sprite",
  "/sprite/revert",
  "/placements",
  "/chat",
  "/session",
  "/admin",
];

/**
 * Server paths the loadout may ask for ANYWAY, because it has somewhere to
 * fall back to when the request 404s.
 *
 * The value is the static file that must be published for the fallback to
 * work, and it is checked rather than trusted: an entry here whose file is
 * missing is the same bug wearing a permission slip.
 */
const WITH_FALLBACK: Record<string, string> = {
  // usePlacements tries the game server first so an admin edit shows without a
  // rebuild, then the published snapshot. scripts/publish-web.ts ships it.
  "/placements": "placements.json",
};

/** Files reachable from the loadout entry by relative import. */
function graph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // Relative imports only. A bare specifier is a package, and a package is
    // not going to fetch this project's routes.
    for (const m of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const spec = m[1]!;
      // Written as .js because the project emits ESM; on disk it is .ts/.tsx.
      const base = resolve(dirname(file), spec).replace(/\.js$/, "");
      for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        if (existsSync(base + ext)) {
          queue.push(base + ext);
          break;
        }
      }
    }
  }

  return [...seen];
}

const problems: string[] = [];
const allowed: string[] = [];

for (const file of graph(ENTRY)) {
  const source = readFileSync(file, "utf-8");
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");

  // The first argument of fetch(), when it is a plain string starting with /.
  for (const m of source.matchAll(/fetch\(\s*["'`](\/[^"'`]*)["'`]/g)) {
    const path = m[1]!;
    const hit = SERVER_ONLY.find((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
    if (!hit) continue;

    const fallback = WITH_FALLBACK[hit];
    if (fallback) {
      allowed.push(`${rel} fetches ${path}, falling back to /${fallback}`);
      continue;
    }
    problems.push(`${rel} fetches ${path}, which only the game server answers`);
  }
}

// A declared fallback that is not published is not a fallback.
const PUBLISH = join(ROOT, ".publish");
if (existsSync(PUBLISH)) {
  for (const [path, file] of Object.entries(WITH_FALLBACK)) {
    if (!existsSync(join(PUBLISH, file))) {
      problems.push(`${path} is allowed because it falls back to /${file}, but .publish/${file} does not exist`);
    }
  }
}

for (const note of allowed) console.log(`  ok    ${note}`);

if (problems.length) {
  console.error("");
  console.error("The hosted loadout has no game server behind it:");
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error("");
  console.error("Ship the data as a static file and fall back to it, the way");
  console.error("scripts/publish-web.ts does for placements.json.");
  process.exit(1);
}

console.log(`Hosted loadout: no unguarded server paths (${graph(ENTRY).length} files checked).`);

/*
 * The admin panel, by a different rule.
 *
 * The loadout's rule is "no server-only path without a published fallback",
 * because a viewer's page has to work with nothing behind it. The admin panel
 * has something behind it - the operator Edge Function - so its rule is about
 * ROUTING rather than fallbacks: the server is reachable, but only through the
 * switch that knows whether it is there.
 *
 * Which makes the check a one-liner to state and impossible to drift: a
 * server-only fetch anywhere in web/src/admin except backend.ts is a screen
 * that will work on localhost and do nothing hosted.
 */
const adminFiles = graph(ADMIN_ENTRY);
const adminProblems: string[] = [];

for (const file of adminFiles) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  if (rel === ADMIN_SWITCH) continue;
  // Only files that ARE the admin panel. The graph reaches shared hooks and
  // the loadout's identity module, which the pass above already judged by the
  // rule that applies to them.
  if (!rel.startsWith("web/src/admin/")) continue;

  const source = readFileSync(file, "utf-8");
  // `adminFetch(` as well as `fetch(`. The first version of this matched only
  // `fetch(`, which is lower-case, and so walked straight past every
  // `adminFetch("/content/delete")` - the call that made the hosted Delete
  // button post to a static host and silently do nothing. A check that misses
  // the one wrapper every privileged call goes through is not checking.
  for (const m of source.matchAll(/(?:adminFetch|\bfetch)\(\s*["'`](\/[^"'`]*)["'`]/g)) {
    const path = m[1]!;
    const hit = SERVER_ONLY.find((sp) => path === sp || path.startsWith(`${sp}/`) || path.startsWith(`${sp}?`));
    if (!hit) continue;
    adminProblems.push(`${rel} calls ${path} directly`);
  }
  // Importing adminFetch at all outside the switch is the same mistake one
  // step earlier: the only reason to import it is to call the game server.
  if (/import\s*\{[^}]*\badminFetch\b[^}]*\}\s*from/.test(source)) {
    adminProblems.push(`${rel} imports adminFetch - server calls belong in ${ADMIN_SWITCH}`);
  }
}

if (adminProblems.length) {
  console.error("");
  console.error("The hosted admin panel reaches a game server that is not there:");
  for (const p of adminProblems) console.error(`  FAIL  ${p}`);
  console.error("");
  console.error(`Route it through ${ADMIN_SWITCH}, which picks the game server or the`);
  console.error("operator Edge Function depending on where the page is running.");
  process.exit(1);
}

console.log(`Hosted admin: every server path goes through the switch (${adminFiles.length} files checked).`);
