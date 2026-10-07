/**
 * `node:fs` and `node:path`, for the standalone build only.
 *
 * src/engine/content/loader.ts imports both at the top for its directory
 * loaders. The standalone game never calls those - it hands the registry
 * already-parsed JSON through `loadObjects`, the same door the Edge Function
 * uses - but an import has to resolve to something for the bundle to build.
 *
 * They throw rather than return something empty. A directory loader that
 * quietly found no files would be a game with no dungeons and no explanation.
 */
function unavailable(name: string): never {
  throw new Error(`${name} is not available in the browser - the standalone build loads content with loadObjects`);
}

export function existsSync(): never {
  return unavailable("fs.existsSync");
}

export function readdirSync(): never {
  return unavailable("fs.readdirSync");
}

export function readFileSync(): never {
  return unavailable("fs.readFileSync");
}

export function join(): never {
  return unavailable("path.join");
}
