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
 */

/** Ids are namespaced by platform on both sides of the game — see AGENTS.md §3. */
const ID_PREFIX = "twitch:";

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
    return { ok: false, status: 503, message: "CHAT_SECRET is not set — chat commands are refused" };
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

  const requestedBy = `${ID_PREFIX}${line.userId}`;

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
 * A running tally of chat's door vote.
 *
 * DELIBERATELY NOT WIRED TO THE STATE MACHINE. `choosing` has no timer — it
 * waits for the operator's `choose_path` — so a vote that resolved itself
 * would mean adding a vote window to the FSM and a fourth way for a raid to
 * advance. That is a real feature with a real design in it (how long is the
 * window? what happens on a tie? can chat be overruled?) and not something to
 * bolt on behind a tally.
 *
 * So this counts, and the operator still opens the door. Chat's vote is
 * visible and it decides what a reasonable streamer clicks, which is most of
 * the value and none of the risk. The overlay reads it from /state.
 *
 * One vote per viewer, last one wins — changing your mind mid-vote is normal
 * chat behaviour, and counting every line would let one person spam a door.
 */
export class PathVote {
  private votes = new Map<string, PathDirection>();

  cast(viewerId: string, direction: PathDirection): void {
    this.votes.set(viewerId, direction);
  }

  /** Cleared whenever a door actually opens, so a round starts from zero. */
  reset(): void {
    this.votes.clear();
  }

  tally(): { left: number; up: number; right: number; total: number; leader: PathDirection | null } {
    const counts: Record<PathDirection, number> = { left: 0, up: 0, right: 0 };
    for (const direction of this.votes.values()) counts[direction] += 1;
    const total = this.votes.size;
    const ranked = (Object.entries(counts) as [PathDirection, number][]).sort((a, b) => b[1] - a[1]);
    // A tie has no leader rather than an arbitrary one — the overlay should
    // show a tie as a tie, and the operator breaks it.
    const leader = total > 0 && ranked[0]![1] > (ranked[1]?.[1] ?? 0) ? ranked[0]![0] : null;
    return { ...counts, total, leader };
  }
}
