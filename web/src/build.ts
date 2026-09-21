/**
 * Which build this is, and how it says so.
 *
 * ONE PLACE, because "we are in alpha" shows up in more than one surface — the
 * loadout header, the sign-in screen, the overlay's idle card — and a release
 * that is alpha in two of them and beta in the third is worse than one that is
 * honestly wrong everywhere. Promoting a build is editing STAGE and nothing
 * else; `art/` already carries logo.png, logo_alpha.png and logo_beta.png, so
 * the file name follows from the stage rather than being chosen by hand.
 *
 * PROMOTING A STAGE IS TWO STEPS, not one: change STAGE here, and copy the
 * matching logo from `art/` into `web/public/art/`. Only the stage in use is
 * kept there — logo_beta.png is a megabyte that would otherwise ship with
 * every alpha build for nothing. A missing file shows as a broken image in
 * the header, which is loud enough to catch before it reaches anyone.
 */
export type ReleaseStage = "alpha" | "beta" | "release";

export const STAGE: ReleaseStage = "alpha";

/**
 * The logo for this stage. `release` is the unsuffixed one.
 *
 * A lookup rather than a comparison against STAGE: TypeScript narrows a `const`
 * to the literal it was initialised with, so `STAGE === "release"` is a type
 * error ("no overlap") the moment STAGE is alpha. The table has to name every
 * stage, which is the better failure anyway — adding a stage without deciding
 * its logo stops compiling.
 */
const LOGO_BY_STAGE: Record<ReleaseStage, string> = {
  alpha: "/art/logo_alpha.png",
  beta: "/art/logo_beta.png",
  release: "/art/logo.png",
};

export const LOGO_SRC = LOGO_BY_STAGE[STAGE];

/**
 * What build someone is actually looking at.
 *
 * Injected at build time by web/vite.config.ts — the commit it was built from
 * and the day it was built, e.g. `alpha 2026-09-21.f3553fe`. Date first so a
 * screenshot sorts, sha second so a bug report points at code rather than at a
 * vague afternoon.
 *
 * The reason this exists at all is the bug reporter: a report that says "the
 * chest did not open" is nearly useless without knowing which build it did not
 * open in, and asking a viewer on their phone to find that out is asking them
 * to not report it. So it is shown on screen AND attached to every report
 * automatically.
 */
export const BUILD_ID: string = __BUILD_ID__;

/** `alpha 2026-09-21.f3553fe` — what gets rendered and stored. */
export const BUILD_LABEL = `${STAGE} ${BUILD_ID}`;
