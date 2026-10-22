/**
 * Everything between "I want to go live" and the game being up.
 *
 * `start-stream.cmd` in the repo root runs this, so a stream starts with a
 * double-click rather than a terminal and a remembered sequence. It does the
 * three things that were being done by hand, and only when each is needed:
 *
 *   1. Fills in any of the three secrets `.env` is missing.
 *   2. Rebuilds the web pages if their sources are newer than the build.
 *   3. Starts the server, exactly as `npm run serve` does.
 *
 * It is not a second way to run the game. Step 3 is the same process with the
 * same flags; the rest is what a person was expected to have remembered first.
 *
 * NOTHING SECRET IS PRINTED. This window is on the streaming PC and one
 * careless scene away from being on stream, so a generated value goes to
 * `.env` and - for the one that has to be pasted into Streamer.bot - to the
 * clipboard, never to the terminal.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The secrets the server refuses to work without, or works worse without. */
const SECRETS = ["ADMIN_SECRET", "SESSION_SECRET", "CHAT_SECRET"] as const;

/**
 * `KEY=value` lines, as Node's own `--env-file` reads them closely enough for
 * what is asked of it here: whether a key has a value, and what PORT is.
 */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    out.set(match[1]!, match[2]!.trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  return out;
}

/**
 * Gives every secret in `keys` a value if it has none, and says which it made.
 *
 * A key that is present but empty is filled IN PLACE - that is what a fresh
 * copy of `.env.example` looks like, and appending a second `ADMIN_SECRET=`
 * under the comment explaining the first would leave a file that reads as
 * unset to anyone who opens it. A key that is absent is appended.
 *
 * A key with a value is never touched. Regenerating one would sign every
 * viewer out or lock Streamer.bot out, to fix nothing.
 */
export function fillSecrets(
  text: string,
  keys: readonly string[],
  make: () => string = () => randomBytes(24).toString("base64url"),
): { text: string; made: string[]; values: Map<string, string> } {
  const have = parseEnv(text);
  const made: string[] = [];
  const values = new Map<string, string>();
  let next = text;
  for (const key of keys) {
    if (have.get(key)) continue;
    const value = make();
    const empty = new RegExp(`^(\\s*${key}\\s*=).*$`, "m");
    if (empty.test(next)) next = next.replace(empty, `$1${value}`);
    else next = `${next}${next === "" || next.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
    made.push(key);
    values.set(key, value);
  }
  return { text: next, made, values };
}

/** The newest modification time under a path, or 0 if it is not there. */
function newest(path: string, only?: (name: string) => boolean): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return !only || only(path) ? stat.mtimeMs : 0;
  let latest = 0;
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules") continue;
    latest = Math.max(latest, newest(join(path, entry), only));
  }
  return latest;
}

/**
 * Whether `overlay/` is older than something it was built from.
 *
 * `src/` counts as well as `web/`: the pages import the engine's types and
 * all of the copy from there, so an edited string in src/text is a stale
 * overlay. `content/` counts only for its sounds, which are the one thing in
 * it the pages bundle - a tuned dungeon is read by the server at boot and is
 * no reason to spend twenty seconds rebuilding.
 */
export function buildIsStale(root: string): boolean {
  const built = newest(join(root, "overlay", "index.html"));
  if (built === 0) return true;
  const sources = Math.max(
    newest(join(root, "web", "src")),
    newest(join(root, "web", "public")),
    newest(join(root, "web"), (name) => /\.(html|json|ts|env)$/.test(name) && !name.includes("timestamp-")),
    // Not src/server: no page imports it, and it is the part of src/ most
    // often edited between streams.
    newest(join(root, "src"), (name) => !name.includes(`${sep}server${sep}`)),
    newest(join(root, "content"), (name) => name.endsWith(".mp3")),
  );
  return sources > built;
}

/** Is a game already answering on this port? */
async function alreadyRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/state`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Puts text on the clipboard. Windows only, and quietly nothing anywhere else. */
function toClipboard(value: string): boolean {
  if (process.platform !== "win32") return false;
  return spawnSync("clip", { input: value }).status === 0;
}

function say(line = ""): void {
  console.log(line);
}

async function main(): Promise<number> {
  const envPath = join(ROOT, ".env");
  say("Corrupted Raids");
  say("---------------");

  // --- 1. secrets ------------------------------------------------------------
  if (!existsSync(envPath)) {
    copyFileSync(join(ROOT, ".env.example"), envPath);
    say("No .env found, so one was made from .env.example.");
  }
  const filled = fillSecrets(readFileSync(envPath, "utf-8"), SECRETS);
  if (filled.made.length > 0) {
    writeFileSync(envPath, filled.text);
    say(`Generated and saved to .env: ${filled.made.join(", ")}.`);
    const chat = filled.values.get("CHAT_SECRET");
    if (chat) {
      say(
        toClipboard(chat)
          ? "CHAT_SECRET is on your clipboard - paste it into Streamer.bot as the global crChatSecret."
          : "Copy CHAT_SECRET from .env into Streamer.bot as the global crChatSecret.",
      );
    }
  }

  // What is in the environment already wins over the file, as it will for the
  // server, so this reads both the same way round.
  const env = parseEnv(filled.text);
  const setting = (key: string): string => process.env[key] ?? env.get(key) ?? "";
  const port = Number(setting("PORT") || 8787);

  // --- 2. is it already up? --------------------------------------------------
  // Checked before the build, because the build empties overlay/ - the very
  // directory a running server is serving to OBS.
  if (await alreadyRunning(port)) {
    say(`The game is already running on http://localhost:${port} - nothing to start.`);
    return 0;
  }

  // --- 3. the things that make a stream quietly wrong ------------------------
  if (!setting("SUPABASE_URL") || !setting("SUPABASE_SERVICE_KEY")) {
    say();
    say("WARNING: .env has no SUPABASE_URL / SUPABASE_SERVICE_KEY.");
    say("  The roster will be a local file, and what viewers equip on the loadout");
    say("  will not reach the fight. Fine for a test, wrong for a stream.");
  }
  if (setting("ROSTER_STORE") === "file") {
    say();
    say("WARNING: ROSTER_STORE=file - characters stay on this disk, apart from the loadout's.");
  }
  if (setting("ALLOW_DEV_LOGIN") === "1") {
    say();
    say("WARNING: ALLOW_DEV_LOGIN=1 - anyone who can reach this server can act as any viewer.");
  }

  // --- 4. build, if the pages are behind their sources -----------------------
  if (buildIsStale(ROOT)) {
    say();
    say("The web pages are out of date - building them...");
    // `shell` because npm is a .cmd on Windows, and Node refuses to spawn one
    // of those directly.
    const build = spawnSync("npm run build:web", { cwd: ROOT, stdio: "inherit", shell: true });
    if (build.status !== 0) {
      say();
      say("The build failed, so the game was not started. The error is above.");
      return build.status ?? 1;
    }
  }

  // --- 5. the server ---------------------------------------------------------
  say();
  // The same process `npm run serve` starts: `tsx` is this loader, and the
  // flag is what reads .env. Spelled out rather than run through npm so that
  // the only thing between Ctrl+C and the server is this script.
  const server = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "--import", "tsx", "src/server/index.ts"],
    { cwd: ROOT, stdio: "inherit" },
  );

  // Ctrl+C and a closed window reach the server too, because it shares this
  // console. It saves the roster and exits by itself; all this has to do is
  // not die first and take the terminal away while that write is in flight.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => undefined);

  return await new Promise<number>((done) => {
    server.on("exit", (code) => done(code ?? 0));
    server.on("error", (err) => {
      say(`The server could not be started: ${err.message}`);
      done(1);
    });
  });
}

// Only when run, not when imported - the functions above are worth testing
// without starting a game to do it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => process.exit(code));
}
