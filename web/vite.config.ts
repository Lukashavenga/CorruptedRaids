import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds straight into ../overlay, which src/server/index.ts already
// serves as static files — see the root README for the dev/build flow.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../overlay",
    emptyOutDir: true,
    // Three separate pages, three separate bundles: the OBS overlay, the
    // per-viewer loadout screen (AGENTS.md §2.6 wants these to be distinct
    // surfaces, not routes inside one app), and the admin placement tool.
    // They share engine types at build time and nothing at runtime.
    //
    // admin is bundled rather than dev-only because it edits content the game
    // reads, and it has to be usable against a built server — but it must be
    // put behind auth before this is deployed anywhere public.
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        loadout: resolve(__dirname, "loadout.html"),
        admin: resolve(__dirname, "admin.html"),
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
