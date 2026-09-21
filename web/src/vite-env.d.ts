/// <reference types="vite/client" />

/**
 * The build-time configuration this app is given.
 *
 * Declared rather than left to `vite/client`'s catch-all so that a typo in a
 * variable name is a type error here instead of `undefined` at runtime — which
 * for the Supabase URL means a loadout that silently cannot reach its backend.
 */
interface ImportMetaEnv {
  /** The Supabase project URL, e.g. https://xxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** The ANON key. Public by design — row level security is what protects data. */
  /** Current name. Holds sb_publishable_… (or a legacy anon JWT). */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Previous name for the same thing, still read as a fallback. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * The build identity, injected by web/vite.config.ts `define`.
 *
 * A `define` is a literal substitution at build time, not a variable, so it
 * needs declaring for TypeScript to know it exists. See web/src/build.ts for
 * what it holds and why.
 */
declare const __BUILD_ID__: string;
