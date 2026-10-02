import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { GameCommand } from "../engine/commands/types.js";
import type { PathDirection } from "../engine/types.js";

/**
 * Chat, as commands.
 *
 * THE MISSING HALF OF THE COMMAND SEAM.
 * -------------------------------------
 * `GameCommand` was always described as the seam Twitch plugs into, and until
 * now nothing was plugged into it. The overlay printed `!join 28s` and
 * `!left !up !right` to an audience with no way to send either: `join_dungeon`
 * needs a signed session and the only way to mint one was the dev-only
 * `POST /session`, while `choose_path` is operator-only outright. Every joiner
 * was an operator-fired `sim_join`. A viewer-engagement game that viewers
 * cannot reach is a screensaver.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ---------------------------------------------
 * This is the TRANSPORT — one endpoint a chat bot (Streamer.bot, or anything
 * that can POST) hands lines to. It is not a Twitch client: this server does
 * not connect to IRC, hold an EventSub socket, or know a token from a nonce.
 * That is on purpose and it is the same reason the command union exists. A bot
 * that already has a verified chat connection is better at being a chat client
 * than this process would be, and keeping the protocol out of here means the
 * next one — a different bot, a channel-point redeem, a Discord bridge — is a
 * caller rather than a rewrite.
 *
 * TRUST
 * -----
 * The bot is trusted the way the operator is trusted: it holds a shared secret
 * and this server takes the viewer id it reports. That is a real decision and
 * worth being explicit about — anyone holding CHAT_SECRET can act as any
 * viewer. It is defensible because the bot has ALREADY authenticated the
 * viewer against Twitch (that is what makes it a chat bot), and reproducing
 * that check here would mean this server running its own OAuth again, which is
 * exactly what was deleted for having no caller.
 *
 * What it does NOT do is let the bot pick the command. A chat line is parsed
 * into one of a fixed, tiny set, and `requestedBy` is built from the reported
 * id server-side — so a compromised bot can impersonate a viewer but cannot
 * reach `grant_gear`, `reset_roster` or anything else that runs the show.
 *
 * A REDEEM is the one thing here that starts a run, which is otherwise the
 * operator's alone. It gets its own endpoint (`POST /redeem`) rather than the
 * bot being handed ADMIN_SECRET to call `open_dungeon` with: that key also
 * grants gear and wipes the roster, and a bot is a program somebody else wrote
 * holding a config file. What a redeem can do is fixed - open one run, chosen
 * here, when nothing is running - and that is the whole of it.
 */

/** Ids are namespaced by platform on both sides of the game — see AGENTS.md §3. */
const ID_PREFIX = "twitch:";

/** `twitch:<id>`, the one spelling of a viewer every part of the game shares. */
export function viewerId(userId: string): string {
  return `${ID_PREFIX}${userId}`;
}

/** Chat can reach exactly these. Everything else needs the operator. */
export type ChatCommand =
  | { kind: "join"; command: GameCommand }
  | { kind: "vote"; direction: PathDirection };

export interface ChatLine {
  /** The viewer's numeric platform id, as the bot reports it. */
  userId: string;
  /** Their display name, for the roster. */
  userName?: string;
  /** The raw chat message. */
  message: string;
}

/**
 * Is this request from the chat bot?
 *
 * An unset CHAT_SECRET is a 503 rather than an open door, matching
 * `checkAdmin` — a deployment that forgot to set it should fail loudly on the
 * first message rather than quietly accept anonymous ones for a whole stream.
 */
export type ChatCheck = { ok: true } | { ok: false; status: number; message: string };

export function checkChatBot(req: IncomingMessage): ChatCheck {
  const expected = process.env.CHAT_SECRET ?? "";
  if (!expected) {
    return { ok: false, status: 503, message: "CHAT_SECRET is not set - chat commands are refused" };
  }
  const given = req.headers["x-chat-secret"];
  const value = Array.isArray(given) ? given[0] : given;
  if (!value) return { ok: false, status: 401, message: "Bad or missing X-Chat-Secret" };
  // Constant-time, for the same reason checkAdmin is: string equality returns
  // as soon as two characters differ and leaks the secret a character at a time.
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: "Bad or missing X-Chat-Secret" };
  }
  return { ok: true };
}

const DIRECTIONS: Record<string, PathDirection> = {
  left: "left",
  up: "up",
  // "ahead" is what the overlay actually prints on the middle door, and it is
  // what people type. The engine's direction is "up"; the audience should not
  // have to know that.
  ahead: "up",
  forward: "up",
  right: "right",
};

/** Roles a viewer may pick on the way in, matching Role in the engine. */
const ROLES = new Set(["tank", "healer", "dps"]);

/**
 * Turns one chat line into a command, or null if it was not for us.
 *
 * Null is the common case by a wide margin — nearly every line in a Twitch
 * chat is conversation — so this has to be cheap and silent rather than an
 * error path.
 */
export function parseChatLine(line: ChatLine): ChatCommand | null {
  const text = line.message.trim();
  if (!text.startsWith("!")) return null;

  const [word, ...rest] = text.slice(1).toLowerCase().split(/\s+/);
  if (!word) return null;

  const requestedBy = viewerId(line.userId);

  if (word === "join") {
    const role = rest[0] && ROLES.has(rest[0]) ? (rest[0] as "tank" | "healer" | "dps") : undefined;
    return {
      kind: "join",
      command: {
        type: "join_dungeon",
        requestedBy,
        // Falls back to the id so a bot that sends no display name still
        // produces a readable roster rather than a blank chip on stream.
        displayName: line.userName?.trim() || line.userId,
        ...(role ? { role } : {}),
      },
    };
  }

  const direction = DIRECTIONS[word];
  if (direction) return { kind: "vote", direction };

  return null;
}

/**
 * A channel-point redeem, as the bot reports it.
 *
 * `reward` is the KIND of run being bought, never an id. Which dungeon opens
 * is this server's roll, not the bot's choice - so a compromised bot, or a
 * viewer with a doctored redeem, cannot aim the stream at one place all night.
 */
export interface Redeem {
  userId: string;
  userName?: string;
  /** Defaults to "dungeon". */
  reward?: string;
  /** The role the redeemer walks in as, if the reward asked. */
  role?: string;
}

export const REDEEM_KINDS = ["dungeon", "raid"] as const;
export type RedeemKind = (typeof REDEEM_KINDS)[number];

export function redeemKind(reward: string | undefined): RedeemKind | null {
  const wanted = (reward ?? "dungeon").trim().toLowerCase();
  return (REDEEM_KINDS as readonly string[]).includes(wanted) ? (wanted as RedeemKind) : null;
}

export function redeemRole(role: string | undefined): "tank" | "healer" | "dps" | undefined {
  const wanted = role?.trim().toLowerCase();
  return wanted && ROLES.has(wanted) ? (wanted as "tank" | "healer" | "dps") : undefined;
}

/**
 * The ids a redeem may roll: everything not switched off.
 *
 * Only raids carry `enabled` today, and a dungeon has no such field, so it
 * always passes - written against the shape rather than the kind so the day a
 * dungeon can be rested too, this is already right.
 */
export function inRotation(runs: readonly { id: string; enabled?: boolean }[]): string[] {
  return runs.filter((run) => run.enabled !== false).map((run) => run.id);
}

/**
 * Which run a redeem opens: any of them, except the one that just ran.
 *
 * Uniform, and deliberately not weighted by how hard a place is or who is in
 * chat - the party's own strength already picks the LEVEL they meet there
 * (AGENTS.md section 2), so the place is free to be a surprise. Skipping the
 * last one is the single rule: five dungeons rolled fairly repeat one time in
 * five, and the same scene twice running reads as broken rather than as
 * random. With one candidate there is nothing to skip and it simply opens.
 */
export function pickRun(ids: readonly string[], last: string | null, rng: () => number): string | null {
  if (ids.length === 0) return null;
  const fresh = ids.length > 1 ? ids.filter((id) => id !== last) : ids;
  return fresh[Math.floor(rng() * fresh.length)] ?? fresh[0]!;
}
