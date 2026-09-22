/**
 * The operator's key, and every privileged call that carries it.
 *
 * The server now refuses content writes and show-running commands without
 * `X-Admin-Secret` (see src/server/auth.ts). This is the one place the browser
 * side knows that, so a new admin screen gets it by using `adminFetch` instead
 * of `fetch` and cannot forget the header.
 *
 * SESSION STORAGE, not local: the key is gone when the tab closes. This is a
 * single-operator tool on the streamer's own machine, so the threat is a
 * forgotten key sitting in a browser profile, not a sophisticated attacker —
 * and sessionStorage costs one re-entry per session to remove it.
 */
const KEY = "corrupted.adminKey";

export function getAdminKey(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    // Private modes throw on access. An empty key fails with a clear 401
    // rather than a crash.
    return "";
  }
}

export function setAdminKey(value: string): void {
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* the key simply will not persist; every call still works this session */
  }
}

export class AdminAuthError extends Error {
  constructor(
    message: string,
    /** 401 wrong key, 503 the server has no ADMIN_SECRET set at all. */
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

/**
 * `fetch` with the operator key attached.
 *
 * Throws `AdminAuthError` on 401/503 rather than returning the response, so a
 * caller cannot accidentally treat "you are not signed in" as "the save
 * failed" — they are different problems with different fixes, and the second
 * one sends people looking through their content for a fault that is not
 * there. On 401 it also clears the stored key: it is wrong, and keeping it
 * only produces a second identical failure.
 */
export async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // Captured, because the clear below has to know WHICH key was refused.
  const sent = getAdminKey();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), "X-Admin-Secret": sent },
  });

  if (res.status === 401 || res.status === 503) {
    // Only clear the key that was actually refused.
    //
    // This used to clear unconditionally, which is a race as soon as anything
    // on the screen fetches on its own: the difficulty meter fires on mount
    // and on every slider drag, so a request sent with an EMPTY key could
    // return 401 after the operator had typed a good one and wipe it. They
    // would watch the field they just filled in empty itself.
    if (res.status === 401 && getAdminKey() === sent) setAdminKey("");
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new AdminAuthError(body?.message ?? "Not authorised", res.status);
  }
  return res;
}
