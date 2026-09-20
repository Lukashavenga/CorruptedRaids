import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The loadout's connection to Supabase.
 *
 * WHY THE SDK HERE AND NOWHERE ELSE. The game server talks to PostgREST with
 * plain `fetch` and stays dependency-free, because all it does is read and
 * write rows with a service key — the SDK would be a large dependency for four
 * HTTP calls. The browser's job is different: it has to run an OAuth redirect,
 * persist a session, and silently refresh an access token before it expires.
 * Hand-rolling token refresh is exactly the kind of thing that works in
 * testing and logs everyone out on a Friday night.
 *
 * The PUBLIC key, not the secret one. It is meant to be public — it
 * identifies the project, and row level security is what actually decides
 * what a caller can see (sql/001_roster.sql). The secret key never leaves
 * the server.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
/**
 * The project's PUBLIC key — whichever model this project issues.
 *
 * Named "publishable" after the current key (`sb_publishable_…`) rather than
 * after `anon`, which Supabase is retiring by the end of 2026. The old
 * variable name is still read as a fallback so an existing deployment does
 * not break on the rename; the two hold the same kind of thing.
 *
 * Either way it is safe in a browser bundle. This key identifies the project
 * and nothing more — row level security is what decides what a caller can
 * actually read (sql/001_roster.sql).
 */
const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

/** True when this build was given a project to talk to. */
export const isConfigured = Boolean(url && anonKey);

/**
 * Null when unconfigured, rather than a client that throws on first use.
 *
 * A build with no Supabase project is a real state — someone checking out the
 * repo and running `npm run dev:web` — and it should say so on screen instead
 * of failing at the first click with a network error.
 */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        // The session lives in this browser and is restored on return, which
        // is what "keep me connected" means to a viewer on a phone.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Where the character Edge Function lives. */
export const CHARACTER_FN = `${url ?? ""}/functions/v1/character`;

/**
 * Calls the character function with the signed-in viewer's token.
 *
 * The token is what tells the function whose character this is — it reads the
 * Twitch id out of the verified JWT and ignores anything the body claims. That
 * is the same rule the game server follows for `requestedBy`, for the same
 * reason: a field the caller can type is a field the caller can lie in.
 */
export async function callCharacterFn(
  init: RequestInit = {},
  /** Appended to the URL — the board is the same function with a query flag. */
  query = "",
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!supabase) return { status: 503, body: { ok: false, message: "Supabase is not configured" } };

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: 401, body: { ok: false, message: "Not signed in" } };

  const res = await fetch(CHARACTER_FN + query, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: anonKey!,
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}
