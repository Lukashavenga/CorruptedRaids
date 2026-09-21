/**
 * What gets UPLOADED, as opposed to what gets built.
 *
 * `npm run build:web` produces three pages into `overlay/` — the OBS overlay,
 * the loadout, and the admin panel — because they are one Vite project with
 * three entry points, and the local game server serves that whole directory at
 * localhost:8787. All three belong there.
 *
 * Only ONE of them belongs on the public internet.
 *
 * DEPLOY.md used to argue the other two were harmless up there, on the grounds
 * that they are static shells which only do anything when talking to
 * localhost:8787, and the public internet cannot reach that. Both halves are
 * true and the conclusion is still wrong:
 *
 *   - It served the operator's console, live, to anyone who guessed `/admin`.
 *     No write could succeed — every one carries `X-Admin-Secret` and the
 *     server refuses without it (src/server/auth.ts) — but "the buttons do not
 *     work" is a weak thing to be relying on, and it reads as an oversight to
 *     anyone who finds it.
 *   - It published the admin bundle, which is the map of the tooling: every
 *     endpoint name, every field, every content shape the panel can edit.
 *   - It only holds while the admin screen never talks to anything but
 *     localhost. The loadout already talks to Supabase from the browser. The
 *     day some admin action follows it, the exposure changes silently and
 *     nothing here would have flagged it.
 *
 * So the upload is filtered rather than argued about. The build is untouched:
 * this copies `overlay/` to `.publish/`, drops the two pages that are not the
 * loadout along with their entry chunks, and points `/` at the loadout so the
 * bare domain is not a 404.
 *
 * Shared chunks (the theme, the sprite index) stay — the loadout imports them.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BUILD = join(ROOT, "overlay");
const OUT = join(ROOT, ".publish");

if (!existsSync(join(BUILD, "loadout.html"))) {
  console.error("No build found. Run `npm run build:web` first.");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(BUILD, OUT, { recursive: true });

// The pages themselves. Without the HTML there is no way in, even for someone
// who knows the hashed chunk name.
const DROP_PAGES = ["admin.html", "index.html"];

// ...and their entry chunks, so the bundle is not readable either. These are
// content-hashed, hence the prefix match rather than a fixed list.
const DROP_PREFIXES = ["admin-", "index-"];

const dropped: string[] = [];

for (const page of DROP_PAGES) {
  const p = join(OUT, page);
  if (existsSync(p)) {
    rmSync(p);
    dropped.push(page);
  }
}

const assets = join(OUT, "assets");
if (existsSync(assets)) {
  for (const file of readdirSync(assets)) {
    if (DROP_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      rmSync(join(assets, file));
      dropped.push(`assets/${file}`);
    }
  }
}

// `/` was the overlay, which is no longer here. Send it to the loadout instead
// of leaving the bare domain on a 404 — that is the URL people will type.
//
// 302, not 301: a permanent redirect is cached by browsers indefinitely and
// would be a nuisance to undo if the root is ever given its own page.
writeFileSync(join(OUT, "_redirects"), "/  /loadout  302\n");

console.log(`Publishing ${OUT}`);
for (const name of dropped) console.log(`  dropped  ${name}`);
console.log(`  added    _redirects  (/ -> /loadout)`);
