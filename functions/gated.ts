/**
 * Which URLs the hosted deployment refuses to serve to a stranger.
 *
 * ONE list, in one file, because it is used twice and the two uses must agree:
 * `_middleware.ts` enforces it at request time, and `scripts/publish-web.ts`
 * proves at build time that nothing admin-only escaped it. A second copy that
 * drifted would be a chunk served in the clear with nothing to notice.
 *
 * Shared through `functions/` rather than `src/` so the edge bundle stays a
 * closed set - wrangler compiles this directory on its own, and an import
 * reaching back into the game's source would pull the engine into it.
 */

/** The pages themselves. Pages serves both spellings, so both are named. */
export const GATED_PAGES = ["/admin", "/admin.html", "/operator", "/operator.html"];

/**
 * ...and the bundles behind them.
 *
 * Vite names an entry chunk after its entry (`admin.html` -> `assets/admin-<hash>.js`),
 * so a prefix is enough and a hash change does not need a code change. `api-`
 * is the operator API client, which admin and operator share and nothing else
 * imports. The publish step checks this claim against the real manifest rather
 * than trusting it.
 */
export const GATED_ASSET_PREFIXES = ["/assets/admin-", "/assets/operator-", "/assets/api-"];

/** True when this path must not be served without a valid gate cookie. */
export function isGated(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (GATED_PAGES.includes(path)) return true;
  return GATED_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix));
}
