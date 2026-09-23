import { isGated } from "./gated.js";

/**
 * The gate in front of the hosted admin and operator pages.
 *
 * WHY THIS EXISTS AT ALL, given the Edge Function already refuses strangers.
 * That refusal covers every ACTION: a stranger who opened /admin got a console
 * whose every button 403d. It does not cover the PAGE. Cloudflare served the
 * HTML and the 66KB bundle behind it to anyone who typed the URL, and that
 * bundle is the map of the tooling - every action name, every field, every
 * content shape the panel can edit. "The buttons do not work" was always a
 * weak thing to be relying on, and it is not what was asked for.
 *
 * So the gate moved to the edge. Nothing admin-shaped leaves Cloudflare
 * without a cookie this file minted.
 *
 * WHY NOT CLOUDFLARE ACCESS, which does this with no code. Access needs the
 * zone on Cloudflare nameservers. coster.im's must stay at Vercel, because
 * calorie.coster.im and fit.coster.im are live there (see wrangler.jsonc).
 * corrupted.coster.im reaches Pages by an external CNAME, and Access cannot
 * see a request that never touches a Cloudflare-hosted zone.
 *
 * WHY NOT A PASSWORD, which was offered. A password is a short secret typed
 * into a box that answers yes or no, and at the edge there is no shared
 * counter to rate-limit one with - Pages Functions are stateless and this
 * project has no KV namespace. It would be exactly the guessable thing the
 * request asked to avoid. The credential here is a Twitch sign-in that
 * Supabase verifies, checked against the same operator allowlist the Edge
 * Function uses. There is nothing to guess.
 *
 * WHAT IS ACTUALLY TRUSTED. Two things, and only these:
 *
 *   1. Supabase's own /auth/v1/user endpoint, which is handed the access token
 *      and answers with the account it belongs to. The signature and expiry
 *      are checked THERE, not here - this file never decodes a JWT and so
 *      cannot get that wrong.
 *   2. An HMAC-SHA256 cookie minted from GATE_SECRET after step 1 said yes.
 *      Forging one means finding the secret.
 *
 * FAIL CLOSED. Missing configuration refuses rather than opens: a deployment
 * that forgot to set GATE_SECRET should serve nobody, not everybody. That is
 * the same rule the game server follows for an unset ADMIN_SECRET.
 *
 * AND THE PAGE'S OWN CHECK STAYS. AdminGate still asks whoami, and every write
 * still goes through the operator Edge Function, which re-derives the caller
 * from a verified token. This file is a third lock, not a replacement for
 * either - someone who somehow got past it finds a console that still refuses
 * to do anything.
 */

interface Env {
  /** HMAC key for the gate cookie. Unset means nobody gets in. */
  GATE_SECRET?: string;
  /** Comma-separated Twitch ids. Same name, same value as the Supabase secret. */
  OPERATOR_TWITCH_IDS?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

interface Ctx {
  request: Request;
  env: Env;
  next(): Promise<Response>;
}

const COOKIE = "cr_gate";

/**
 * Twelve hours, which is about one long stream day.
 *
 * Short enough that a cookie left on a borrowed laptop dies on its own, long
 * enough that tuning a raid does not get interrupted by a Twitch redirect. It
 * is not the only revocation: removing an id from OPERATOR_TWITCH_IDS takes
 * effect on the next request, because the id is re-checked against the list
 * every time rather than being trusted because it is signed.
 */
const TTL_SECONDS = 12 * 60 * 60;

/**
 * Returns a plain ArrayBuffer, not the encoder's view.
 *
 * `TextEncoder.encode` is typed `Uint8Array<ArrayBufferLike>`, and a
 * SharedArrayBuffer is not a `BufferSource` as far as SubtleCrypto is
 * concerned. Copying two short strings per request is not worth an assertion
 * that says the checker is wrong.
 */
function bytes(value: string): ArrayBuffer {
  const view = new TextEncoder().encode(value);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function base64url(raw: ArrayBuffer): string {
  let out = "";
  for (const byte of new Uint8Array(raw)) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, bytes(body)));
}

/**
 * Compared without an early return, so the time taken does not describe how
 * much of a guess was right. Overkill for a signature nobody can iterate on
 * quickly over the network, and cheap enough not to argue about.
 */
function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Config {
  secret: string;
  ids: string[];
  supabaseUrl: string;
  publishableKey: string;
  ready: boolean;
}

function config(env: Env): Config {
  const secret = env.GATE_SECRET ?? "";
  const ids = (env.OPERATOR_TWITCH_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const supabaseUrl = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? "";
  return {
    secret,
    ids,
    supabaseUrl,
    publishableKey,
    ready: Boolean(secret && ids.length > 0 && supabaseUrl && publishableKey),
  };
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const split = part.indexOf("=");
    if (split < 0) continue;
    if (part.slice(0, split).trim() === name) return part.slice(split + 1).trim();
  }
  return null;
}

async function cookieIsValid(value: string | null, cfg: Config): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  const [version, expires, twitchId, signature] = parts as [string, string, string, string];
  if (version !== "v1") return false;

  const deadline = Number(expires);
  if (!Number.isFinite(deadline) || deadline * 1000 <= Date.now()) return false;

  // Re-checked rather than trusted because it is signed: the allowlist is the
  // live answer, and a cookie minted for someone since removed must stop
  // working now, not in twelve hours.
  if (!cfg.ids.includes(twitchId)) return false;

  return sameSignature(signature, await sign(cfg.secret, `v1.${expires}.${twitchId}`));
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...extra },
  });
}

function cookieHeader(value: string, maxAge: number): string {
  // HttpOnly so no script on the page can read it, Secure so it never crosses
  // plain HTTP, Lax so the return trip from Twitch still carries it.
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Trades a Supabase access token for a gate cookie.
 *
 * The token is not decoded here. It is handed to Supabase, which owns the
 * signing key and answers with the account or refuses - so a forged token
 * fails at the only place able to tell, and this file has no JWT parsing to
 * get subtly wrong.
 */
async function openGate(ctx: Ctx): Promise<Response> {
  const cfg = config(ctx.env);
  if (!cfg.ready) return json({ ok: false, message: "The gate is not configured." }, 503);

  const body = (await ctx.request.json().catch(() => null)) as { token?: unknown } | null;
  const token = body?.token;
  // Shape first, so a spray of junk costs this function one string check
  // rather than a round trip to Supabase each time.
  if (typeof token !== "string" || token.length < 20 || token.length > 4096 || token.split(".").length !== 3) {
    return json({ ok: false, message: "Bad token." }, 400);
  }

  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: cfg.publishableKey },
  });
  if (!res.ok) return json({ ok: false, message: "That sign-in could not be verified." }, 401);

  const user = (await res.json().catch(() => null)) as { user_metadata?: { provider_id?: unknown } } | null;
  const twitchId = user?.user_metadata?.provider_id;
  // Digits only: the id becomes a field in a dot-separated cookie, and one
  // containing a dot would let a caller choose where the fields split.
  if (typeof twitchId !== "string" || !/^[0-9]+$/.test(twitchId) || !cfg.ids.includes(twitchId)) {
    // The same answer whether the account is unknown, not on the list, or the
    // list is empty. Which one it was is information about how close they are.
    return json({ ok: false, message: "This account does not have operator access." }, 403);
  }

  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const signature = await sign(cfg.secret, `v1.${expires}.${twitchId}`);
  return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(`v1.${expires}.${twitchId}.${signature}`, TTL_SECONDS) });
}

export async function onRequest(ctx: Ctx): Promise<Response> {
  const url = new URL(ctx.request.url);

  if (url.pathname === "/__gate" || url.pathname === "/__gate/out") {
    if (ctx.request.method !== "POST") return json({ ok: false, message: "POST only." }, 405);
    // Signing out drops the cookie here as well as the session in the browser,
    // so a shared machine is not left twelve hours of access behind.
    if (url.pathname === "/__gate/out") return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
    return openGate(ctx);
  }

  if (!isGated(url.pathname)) return ctx.next();

  const cfg = config(ctx.env);
  if (!cfg.ready) {
    return new Response("The admin gate is not configured on this deployment.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  if (await cookieIsValid(readCookie(ctx.request, COOKIE), cfg)) {
    const res = await ctx.next();
    const out = new Response(res.body, res);
    // Nothing behind this gate may sit in a shared cache. `private` keeps it
    // out of Cloudflare's; `no-store` keeps it out of a proxy at the far end.
    out.headers.set("Cache-Control", "private, no-store");
    return out;
  }

  // A navigation gets sent somewhere it can do something about it. A script or
  // stylesheet gets a flat refusal - redirecting one to an HTML page produces
  // a confusing parse error instead of an honest 401.
  if ((ctx.request.headers.get("Accept") ?? "").includes("text/html")) {
    const signin = new URL("/signin", url);
    signin.searchParams.set("to", url.pathname);
    return Response.redirect(signin.toString(), 302);
  }
  return new Response("Not signed in.", { status: 401, headers: { "Cache-Control": "private, no-store" } });
}
