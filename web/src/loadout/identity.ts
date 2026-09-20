import { isConfigured, supabase } from "./supabase.js";

/**
 * Who the loadout is signed in as.
 *
 * SUPABASE AUTH, Twitch provider. The game server has its own Twitch OAuth for
 * the operator, and this is deliberately not that: the loadout is hosted, the
 * server is on the streamer's PC, and the two never talk. What the loadout
 * needs is a token Postgres can check, because row level security is what
 * decides which character a viewer may read — and only Supabase can issue one.
 *
 * This file cannot assert an identity. The most it can do is start a redirect
 * and read back what came home.
 */

export interface Viewer {
  id: string;
  displayName: string;
}

export interface SessionState {
  /** Null when signed out — the screen shows the sign-in prompt. */
  viewer: Viewer | null;
  /** False when this build has no Supabase project, which is its own message. */
  configured: boolean;
}

/**
 * The character id for a Twitch account.
 *
 * Namespaced to match what the game server and Streamer.bot use: the roster
 * also holds `sim:` viewers from the testing harness, and an unprefixed
 * numeric id could collide with one.
 */
function viewerIdFor(providerId: string): string {
  return `twitch:${providerId}`;
}

export async function readSession(): Promise<SessionState> {
  if (!supabase) return { viewer: null, configured: false };

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  // `provider_id` is the numeric Twitch id. It is what the RLS policy matches
  // and what the game server keys characters on, so it — not Supabase's own
  // uid — is the identity that matters here.
  const providerId = user?.user_metadata?.["provider_id"] as string | undefined;
  if (!user || !providerId) return { viewer: null, configured: true };

  const name =
    (user.user_metadata?.["nickname"] as string | undefined) ??
    (user.user_metadata?.["name"] as string | undefined) ??
    (user.user_metadata?.["full_name"] as string | undefined) ??
    providerId;

  return { viewer: { id: viewerIdFor(providerId), displayName: name }, configured: true };
}

/**
 * Starts the Twitch redirect.
 *
 * A full navigation, not a popup or a fetch: the viewer has to land on
 * Twitch's own domain and see Twitch's own consent screen, which is the entire
 * security value of OAuth.
 */
export async function signIn(): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Supabase is not configured" };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "twitch",
    // Back to the page they started on, so a viewer who opened the loadout
    // from a link does not land on a different one.
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

/** Re-exported so callers do not need to know where the flag lives. */
export const supabaseConfigured = isConfigured;
