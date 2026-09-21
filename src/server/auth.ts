import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GameCommand } from "../engine/commands/types.js";

/**
 * Who is allowed to do what.
 *
 * Until now the answer was "anyone": every POST on this server was open, and
 * `requestedBy` was whatever the caller typed. That is fine for a tool running
 * on one laptop and indefensible the moment it has a public URL — a stranger
 * could delete a dungeon, mint gear into their own character, or wipe the
 * roster, from a browser console.
 *
 * There are exactly two principals:
 *
 *   OPERATOR  the streamer. Holds ADMIN_SECRET. Runs the show and edits
 *             content. Proven by a header on the request.
 *   VIEWER    a member of chat. May only act on their OWN character, and
 *             which character that is comes from a SESSION — never from the
 *             request body.
 *
 * That second rule is the structural half of this file and it matters more
 * than the cryptography: once `requestedBy` is derived server-side, swapping
 * how a session is created changes one function and nothing else. While the
 * seam was in the body, every call site was a place to get it wrong.
 *
 * A session used to be minted by a Twitch OAuth flow on this server
 * (`src/server/twitch.ts`, routes `/auth/twitch*`) — built when this server
 * was meant to serve the loadout itself. It no longer does: the loadout is
 * hosted separately and authenticates against Supabase Auth's own Twitch
 * provider directly, so that flow had no caller left and was removed. The
 * only way to mint a session today is the dev-only shortcut on `POST
 * /session` (`ALLOW_DEV_LOGIN=1`); whatever eventually drives real viewer
 * commands (P5, Streamer.bot) mints one the same way, through `issueSession`.
 */

/**
 * Commands that run the show, as opposed to acting on one character.
 *
 * Deliberately a list of what is PRIVILEGED rather than what is public: a
 * command added later and forgotten defaults to needing the operator, which
 * fails safe. Getting that backwards is how a `grant_gear` ends up open.
 */
const OPERATOR_COMMANDS = new Set<GameCommand["type"]>([
  "open_dungeon",
  "open_raid",
  "start_dungeon",
  "reset_dungeon",
  "reset_roster",
  "choose_path",
  "start_boss",
  "enter_room",
  "sim_join",
  // Mints an item from nothing. A testing affordance, and the single most
  // abusable command in the union.
  "grant_gear",
  // Mints a drop from nothing, exactly like grant_gear. See the union.
  "grant_chest",
]);

/** Commands a viewer may run against their own character. Everything else is operator-only. */
export function isViewerCommand(type: GameCommand["type"]): boolean {
  return !OPERATOR_COMMANDS.has(type);
}

// --- operator ---------------------------------------------------------------

/**
 * Constant-time comparison, because the obvious `a === b` leaks the secret.
 *
 * String equality returns as soon as two characters differ, so the time it
 * takes reveals how much of a guess was right — enough to recover a secret a
 * character at a time over many requests. Rare in practice against a small
 * server, free to avoid, and the kind of thing that is embarrassing to have
 * skipped.
 */
function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type AdminCheck = { ok: true } | { ok: false; status: number; message: string };

/**
 * Is this request from the operator?
 *
 * An unset ADMIN_SECRET is a 503, not an open door. A deployment that forgot
 * to configure it should fail loudly and completely rather than quietly
 * serving its content editor to the internet.
 */
export function checkAdmin(req: IncomingMessage): AdminCheck {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return { ok: false, status: 503, message: "ADMIN_SECRET is not set on the server" };
  }
  const given = req.headers["x-admin-secret"];
  if (!secretMatches(typeof given === "string" ? given : undefined, expected)) {
    return { ok: false, status: 401, message: "Bad or missing X-Admin-Secret" };
  }
  return { ok: true };
}

// --- viewer sessions --------------------------------------------------------

export const SESSION_COOKIE = "cr_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The key sessions are signed with.
 *
 * Falls back to a value generated at boot, which is deliberately inconvenient:
 * it works, and every restart signs out every viewer, which is exactly the
 * nuisance that prompts someone to set the variable properly. Silently
 * accepting unsigned sessions would be the alternative, and that is not a
 * trade worth making.
 */
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? process.env.ADMIN_SECRET ?? randomBytes(32).toString("hex");

if (!process.env.SESSION_SECRET && !process.env.ADMIN_SECRET) {
  console.warn("[auth] No SESSION_SECRET or ADMIN_SECRET - sessions will not survive a restart.");
}

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

export interface Session {
  viewerId: string;
  /** What to call them on screen. Twitch's display name, or the dev id. */
  displayName: string;
}

/**
 * A session token: who, what they are called, until when, and a signature.
 *
 * Not a JWT, because this needs none of what a JWT brings — no third party
 * verifies it, there are no claims beyond an id and a label, and a dependency
 * to encode three fields is a dependency to keep patched. The expiry is INSIDE
 * the signed payload so it cannot be edited by the holder.
 *
 * The DISPLAY NAME rides along deliberately. It is only a label, but the
 * alternative — a server-side map from viewer id to name — is state that dies
 * on restart and has to be rebuilt from somewhere. Signed, it cannot be
 * tampered with, and it costs a few dozen bytes in a cookie.
 */
export function issueSession(viewerId: string, displayName: string): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = [
    Buffer.from(viewerId).toString("base64url"),
    Buffer.from(displayName).toString("base64url"),
    expires,
  ].join(".");
  return `${payload}.${sign(payload)}`;
}

/** The session this request carries, or null. */
export function readSession(req: IncomingMessage): Session | null {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [id, name, expires, signature] = parts as [string, string, string, string];

  const expected = sign(`${id}.${name}.${expires}`);
  // Same reasoning as the admin secret: compare in constant time.
  if (!secretMatches(signature, expected)) return null;
  if (!Number.isFinite(Number(expires)) || Number(expires) < Date.now()) return null;

  const viewerId = Buffer.from(id, "base64url").toString("utf-8");
  if (!viewerId) return null;
  return { viewerId, displayName: Buffer.from(name, "base64url").toString("utf-8") || viewerId };
}

/** Just the id, for the many callers that only need to know whose it is. */
export function sessionViewer(req: IncomingMessage): string | null {
  return readSession(req)?.viewerId ?? null;
}

export function sessionCookie(token: string): string {
  // HttpOnly so a script on the page cannot read it; SameSite=Lax so it is not
  // sent on cross-site POSTs, which is the cheap half of CSRF protection.
  // Secure is set only when behind TLS — on plain http://localhost a Secure
  // cookie is silently dropped and nothing works. This server runs on
  // localhost today and always will under the current architecture (see
  // DEPLOY.md); PUBLIC_ORIGIN only matters again if it is ever run behind the
  // documented Dockerfile/fly.toml fallback, and costs nothing to leave here
  // for that day.
  const secure = process.env.PUBLIC_ORIGIN?.startsWith("https://") ? " Secure;" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Lax;${secure}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

// --- CORS -------------------------------------------------------------------

/**
 * Which origins may call this server from a browser.
 *
 * It was `*` on every response, which is the correct setting for a local tool
 * and an open invitation for a hosted one: any page on the internet could
 * script a logged-in viewer's browser into calling `/command`. An allowlist
 * from the environment instead.
 *
 * Same-origin requests are unaffected — a browser sends no `Origin` on them —
 * so the overlay, loadout and admin all keep working when served by this
 * server, which is the normal deployment.
 */
export function allowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!origin) return;
  if (!allowedOrigins().includes(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  // Required for the session cookie to be sent cross-origin at all.
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Secret");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
