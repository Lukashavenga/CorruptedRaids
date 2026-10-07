/**
 * Whether this build carries its own game, and the way to it.
 *
 * `vite build --mode standalone` produces an overlay with the engine inside it
 * (web/src/standalone/localGame.ts), for a static host with no game server.
 * Every other build is the ordinary overlay, which talks to one.
 *
 * Null in an ordinary build, and the shape of this line is load-bearing: the
 * mode is substituted at build time, so the bundler sees a constant condition
 * and drops the import along with the engine, the content and the validators
 * behind it. Written as a runtime check instead, the flat overlay would carry
 * all of that to serve a branch it can never take - the same reason the 3D
 * arena is a prop on App rather than an import in it.
 *
 * Callers test it for null and that is the whole seam: connection, commands,
 * content and placements each ask here first and fall through to the server.
 */
export const loadLocalGame =
  import.meta.env.MODE === "standalone" ? () => import("./standalone/localGame.js").then((m) => m.localGame()) : null;

/**
 * A file from `web/public`, under wherever this build is served from.
 *
 * `/art/...` is right at a domain root, which is everywhere this ran until
 * GitHub Pages: a project site lives under `/<repo>/`, and Vite rewrites the
 * paths it can see (HTML, CSS, imports) but not a string assembled at runtime.
 * BASE_URL is "/" for every other build, so those produce exactly the paths
 * they always did.
 */
export function publicUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}
