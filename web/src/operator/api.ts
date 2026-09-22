import { supabase } from "../loadout/supabase.js";

/**
 * The hosted operator console's only way to talk to anything.
 *
 * Every call goes to the `operator` Edge Function with the caller's Supabase
 * session attached, and the function re-derives who that is from the verified
 * token. Nothing here decides whether the caller is allowed; it asks, and the
 * far side refuses. That distinction is the whole security model: a page can
 * be edited by whoever is reading it, so the page must not be the gate.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const OPERATOR_FN = `${url ?? ""}/functions/v1/operator`;

export interface RosterEntry {
  id: string;
  twitchId: string | null;
  name: string;
  level: number;
  role: string;
  gold: number;
  chests: number;
  inRun: boolean;
  updatedAt: string | null;
}

async function call<T>(query: string, init?: RequestInit): Promise<T> {
  if (!supabase) throw new Error("This build has no Supabase project configured.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Signed out.");

  const res = await fetch(`${OPERATOR_FN}${query}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });

  const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  if (!res.ok || body?.ok === false) {
    // 401 is the platform rejecting the token before the function runs; 403 is
    // the function deciding this account is not an operator. Different causes,
    // and an operator debugging their own allowlist needs to tell them apart.
    const reason = res.status === 401 ? "Signed out, or the session expired." : body?.message ?? `Request failed (${res.status})`;
    throw new Error(reason);
  }
  return body as T;
}

/** One bit about the caller's own account. Safe for anyone signed in to ask. */
export function whoami(): Promise<{ operator: boolean; twitchId: string | null }> {
  return call("?action=whoami");
}

export function roster(): Promise<{ characters: RosterEntry[] }> {
  return call("?action=roster");
}

export function character(id: string): Promise<{ character: unknown; inRun: boolean }> {
  return call(`?action=character&id=${encodeURIComponent(id)}`);
}

/** Runs one operator command against one character. */
export function command(target: string, cmd: Record<string, unknown>): Promise<{ message?: string }> {
  return call("?action=command", {
    method: "POST",
    body: JSON.stringify({ target, command: cmd }),
  });
}

// --- content -----------------------------------------------------------------

export interface ContentFile {
  path: string;
  updated_at: string;
  updated_by: string | null;
}

export function contentList(): Promise<{ files: ContentFile[] }> {
  return call("?action=content-list");
}

export function contentGet(path: string): Promise<{ file: { path: string; data: unknown } }> {
  return call(`?action=content-get&path=${encodeURIComponent(path)}`);
}

export function contentPut(path: string, data: unknown): Promise<{ message?: string }> {
  return call("?action=content-put", { method: "POST", body: JSON.stringify({ path, data }) });
}

export function contentHistory(
  path: string,
): Promise<{ versions: { id: number; replaced_at: string; replaced_by: string | null }[] }> {
  return call(`?action=content-history&path=${encodeURIComponent(path)}`);
}

export function contentRestore(id: number): Promise<{ message?: string }> {
  return call("?action=content-restore", { method: "POST", body: JSON.stringify({ id }) });
}
