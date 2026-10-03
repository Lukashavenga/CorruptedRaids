import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The build identity, stamped in at build time. See web/src/build.ts.
 *
 * `git describe` is not used because this repo does not tag; the short sha is
 * what actually identifies the code, and the date is what a person reads. A
 * dirty tree gets a `+` so a build made from uncommitted work cannot be
 * mistaken in a bug report for the commit it was nearly made from.
 *
 * Falls back rather than throwing: a build from a tarball with no git history
 * should still produce a loadout, just one that says it does not know.
 */
function buildId(): string {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    // `--untracked-files=no`, and it is load-bearing.
    //
    // Vite writes a temporary `vite.config.ts.timestamp-*.mjs` beside this
    // file while loading a TypeScript config, so a plain `git status` is NEVER
    // empty during a build and every build stamped itself dirty — which makes
    // the marker noise, and a marker that is always on tells you nothing.
    // Tracked modifications are also the honest definition: an untracked
    // scratch file is not what the bundle was built from.
    const dirty = execSync("git status --porcelain --untracked-files=no", {
      encoding: "utf-8",
    }).trim() !== "";
    return `${day}.${sha}${dirty ? "+" : ""}`;
  } catch {
    return `${day}.unknown`;
  }
}

// Builds straight into ../overlay, which src/server/index.ts already
// serves as static files — see the root README for the dev/build flow.
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  build: {
    outDir: "../overlay",
    emptyOutDir: true,
    // Emitted so scripts/publish-web.ts can prove, against the real output,
    // that every chunk only the admin and operator pages import is covered by
    // functions/gated.ts. Without it that coverage is an assumption about how
    // Vite names things, and an assumption there means a bundle served in the
    // clear with nothing to notice.
    manifest: true,
    // One page per surface, one bundle per page: the OBS overlay, the
    // per-viewer loadout screen (AGENTS.md §2.6 wants these to be distinct
    // surfaces, not routes inside one app), the admin tool, the operator
    // console and the sign-in door. They share engine types at build time and
    // nothing at runtime.
    //
    // admin is bundled rather than dev-only because it edits content the game
    // reads and has to be usable against a built server. It used to carry a
    // note here that it must be put behind auth before being deployed
    // anywhere public; that is now functions/_middleware.ts, which refuses to
    // serve this bundle without a verified operator sign-in.
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        // The same overlay with the fight drawn in three dimensions. Its own
        // entry so the renderer it needs is in its bundle and no other - see
        // web/src/arena3d/main.tsx.
        arena3d: resolve(__dirname, "arena3d.html"),
        loadout: resolve(__dirname, "loadout.html"),
        admin: resolve(__dirname, "admin.html"),
        // The hosted operator console. Unlike admin.html this one DOES ship:
        // it talks to Supabase rather than the game server, so it works with
        // no game process behind it. See scripts/publish-web.ts.
        operator: resolve(__dirname, "operator.html"),
        // The public door to both of the above. It has to be its own entry
        // because functions/_middleware.ts refuses to serve their bundles to
        // anyone who has not signed in yet, and a sign-in screen inside one of
        // them would be behind the lock it opens.
        signin: resolve(__dirname, "signin.html"),
      },
    },
  },
  server: {
    // Needed because web/ imports shared rig/text/state config from ../src
    // (see the root README's "The overlay" section) — Vite's dev server
    // otherwise refuses to serve files outside its project root.
    fs: { allow: [".."] },
    proxy: {
      "/state": "http://localhost:8787",
      "/content": "http://localhost:8787",
      "/events": "http://localhost:8787",
      "/command": "http://localhost:8787",
      "/character": "http://localhost:8787",
      "/placements": "http://localhost:8787",
      "/sprite": "http://localhost:8787",
      "/sprite/revert": "http://localhost:8787",
      "/difficulty": "http://localhost:8787",
      "/content/write": "http://localhost:8787",
    },
  },
});
