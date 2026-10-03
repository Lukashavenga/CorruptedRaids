/**
 * What gets UPLOADED, as opposed to what gets built.
 *
 * `npm run build:web` produces six pages into `overlay/` - the OBS overlay,
 * its 3D twin, the loadout, the admin panel, the operator console and the
 * sign-in door - because they are one Vite project with six entry points, and
 * the local game server serves that whole directory at localhost:8787. All six
 * belong there.
 *
 * Only the overlays do not belong on the public internet. They are browser
 * sources for OBS and have nothing to say on the open web, so they are dropped
 * along with every chunk only they load.
 *
 * ADMIN AND OPERATOR ARE PUBLISHED, which they were not always, and the
 * history is kept here because it is what the gate had to be built to earn:
 *
 *   - First they were dropped, because every admin write was a file write and
 *     a hosted panel had no server to write to.
 *   - Then admin shipped ungated, once content moved into Supabase. Writes
 *     were safe - the operator Edge Function re-derives the caller from a
 *     verified token and refuses - but the PAGE was served to anyone who
 *     guessed the URL, and so was the 66KB bundle behind it, which is the map
 *     of the tooling: every action name, every field, every content shape.
 *     "The buttons do not work" is a weak thing to be relying on.
 *   - Now functions/_middleware.ts refuses both pages, and both bundles, to
 *     anyone without a cookie minted from a Supabase-verified operator
 *     sign-in. That is what makes publishing them defensible.
 *
 * WHICH MEANS THIS SCRIPT HAS A SECOND JOB. The gate names the bundles it
 * protects by prefix (functions/gated.ts), on the strength of Vite naming an
 * entry chunk after its entry. That is true today and is an assumption, and
 * the failure mode of a wrong assumption there is an admin-only chunk served
 * in the clear with nothing to notice. So it is checked, against the real
 * manifest of the real build, every publish - in both directions:
 *
 *   - nothing reachable ONLY from admin or operator may fall outside the gate,
 *     or it ships unprotected;
 *   - nothing reachable from the loadout may fall INSIDE it, or the gate locks
 *     viewers out of a chunk they need and the loadout breaks for everyone.
 *
 * The build itself is untouched: this copies `overlay/` to `.publish/`, drops
 * the overlay page, and points `/` at the loadout so the bare domain is not a
 * 404.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GATED_ASSET_PREFIXES, GATED_PAGES, isGated } from "../functions/gated.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BUILD = join(ROOT, "overlay");
const OUT = join(ROOT, ".publish");

if (!existsSync(join(BUILD, "loadout.html"))) {
  console.error("No build found. Run `npm run build:web` first.");
  process.exit(1);
}

// --- prove the gate covers what it claims to ---------------------------------

interface ManifestEntry {
  file?: string;
  css?: string[];
  assets?: string[];
  imports?: string[];
  dynamicImports?: string[];
}

const MANIFEST = join(BUILD, ".vite", "manifest.json");
if (!existsSync(MANIFEST)) {
  console.error("No .vite/manifest.json in the build. `manifest: true` must stay on in web/vite.config.ts —");
  console.error("without it there is no way to check that the admin bundle is actually behind the gate.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as Record<string, ManifestEntry>;

/** Every file a browser ends up fetching because it opened these entries. */
function reachableFrom(entries: string[]): Set<string> {
  const files = new Set<string>();
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = manifest[key];
    if (!node) continue;
    if (node.file) files.add(node.file);
    for (const css of node.css ?? []) files.add(css);
    for (const asset of node.assets ?? []) files.add(asset);
    // Static and dynamic imports both, because a lazily loaded admin chunk is
    // still an admin chunk - being fetched later does not make it public.
    for (const next of [...(node.imports ?? []), ...(node.dynamicImports ?? [])]) queue.push(next);
  }
  return files;
}

const behindGate = reachableFrom(["admin.html", "operator.html"]);
const publicFiles = reachableFrom(["index.html", "arena3d.html", "loadout.html", "signin.html"]);

/** Files the loadout never loads - the ones the gate is responsible for. */
const adminOnly = [...behindGate].filter((file) => !publicFiles.has(file));

const leaked = adminOnly.filter((file) => !isGated(`/${file}`));
const lockedOut = [...publicFiles].filter((file) => isGated(`/${file}`));

if (leaked.length > 0 || lockedOut.length > 0) {
  console.error("functions/gated.ts no longer matches what the build emits.\n");
  for (const file of leaked) {
    console.error(`  UNPROTECTED  ${file}`);
    console.error("               only admin/operator import it, and the gate would serve it to anyone.");
  }
  for (const file of lockedOut) {
    console.error(`  LOCKED OUT   ${file}`);
    console.error("               the loadout needs it, and the gate would refuse it to viewers.");
  }
  console.error(`\nGate prefixes: ${GATED_ASSET_PREFIXES.join(", ")}`);
  console.error("Fix functions/gated.ts, or name the chunk so an existing prefix covers it.");
  process.exit(1);
}

console.log(`Gate covers ${adminOnly.length} admin-only file(s); loadout untouched.`);

// --- assemble the upload -----------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(BUILD, OUT, { recursive: true });

// The pages themselves. Without the HTML there is no way in, even for someone
// who knows the hashed chunk name. Both overlays: the flat one and the 3D one
// are the same browser source drawn two ways, and neither has anything to say
// on the open web.
const DROP_PAGES = ["index.html", "arena3d.html"];

// ...and everything ONLY they load, so the bundle is not readable either.
//
// Asked of the manifest rather than matched by an `index-` prefix, which is
// what this used to do and which stopped being true the moment there were two
// overlays: what they share is split into a chunk of its own, named after
// neither, and a prefix match would have published the whole overlay under a
// name nobody was looking for - along with half a megabyte of 3D renderer.
const kept = reachableFrom(["loadout.html", "signin.html", "admin.html", "operator.html"]);
const overlayOnly = [...reachableFrom(DROP_PAGES)].filter((file) => !kept.has(file));

const dropped: string[] = [];

for (const file of [...DROP_PAGES, ...overlayOnly]) {
  const path = join(OUT, file);
  if (existsSync(path)) {
    rmSync(path);
    dropped.push(file);
  }
}

// The manifest is a build artefact, not a page. It has just done its job above
// and publishing it would hand a stranger the chunk list for free.
const publishedManifest = join(OUT, ".vite");
if (existsSync(publishedManifest)) {
  rmSync(publishedManifest, { recursive: true, force: true });
  dropped.push(".vite/manifest.json");
}

// content/placements.json, as a static asset.
//
// Every surface that draws a character reads this — it is where each gear
// sprite sits on the body — and web/src/hooks/usePlacements.ts fetches it from
// the GAME SERVER at `/placements`, which is the copy the admin screen edits.
// A static site has no game server, so that request 404s here, and the hook's
// fallback is an empty placement file: a legal value meaning "nothing
// positioned yet". The result is not an error, it is every item drawn at
// DEFAULT_PLACEMENT, stacked at the origin, silently, on every character.
//
// So it ships. Copied at publish time rather than into `web/public/` at build
// time because it belongs to the published tree specifically: locally the
// server's live copy is the one that should win, and a stale snapshot sitting
// in `web/public/` would be one more thing to remember to regenerate.
const PLACEMENTS = join(ROOT, "content", "placements.json");
if (!existsSync(PLACEMENTS)) {
  console.error("content/placements.json is missing — characters would publish unpositioned.");
  process.exit(1);
}
cpSync(PLACEMENTS, join(OUT, "placements.json"));

// `/` was the overlay, which is no longer here. Send it to the loadout instead
// of leaving the bare domain on a 404 — that is the URL people will type.
//
// 302, not 301: a permanent redirect is cached by browsers indefinitely and
// would be a nuisance to undo if the root is ever given its own page.
writeFileSync(join(OUT, "_redirects"), "/  /loadout  302\n");

console.log(`Publishing ${OUT}`);
for (const name of dropped) console.log(`  dropped  ${name}`);
console.log("  added    placements.json");
console.log("  added    _redirects  (/ -> /loadout)");
console.log(`  gated    ${GATED_PAGES.join(", ")} and their bundles`);
