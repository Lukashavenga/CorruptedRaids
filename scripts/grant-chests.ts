/**
 * Puts sealed chests on somebody's shelf, for testing the reveal.
 *
 *   npm run chests -- twitch:61018650            # 5, one of each rarity
 *   npm run chests -- twitch:61018650 3          # 3 random items
 *   npm run chests -- twitch:61018650 1 pitch-torch
 *
 * WHY THIS EXISTS
 * ---------------
 * The honest way to get a chest is to win a run and pass a 60% drop roll,
 * which is the wrong loop to sit in when what you are testing is a 1.6s
 * animation. The tempting shortcut is to edit the roster row in Postgres
 * directly — and that races the game server's write-behind, so whichever
 * side writes second wins and the chests you just added quietly vanish.
 *
 * This goes through `grant_chest` on the running server, so the in-memory
 * roster and the database agree by construction. No restart, no DB poke.
 *
 * The server must be running, and it answers only to the operator — see
 * ADMIN_SECRET below.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { RARITIES, type Rarity } from "../src/engine/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = process.env.SERVER_URL ?? "http://localhost:8787";

/**
 * Defaults to the value in .claude/launch.json, which is what the preview
 * server runs with. A real deployment sets ADMIN_SECRET and this picks it up
 * from the environment instead.
 */
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "devkey";

const [viewerId, countArg, gearArg] = process.argv.slice(2);

if (!viewerId) {
  console.error(
    "\nusage: npm run chests -- <viewerId> [count] [gearId]\n\n" +
      "  viewerId   e.g. twitch:61018650  (GET /character?viewer=... to check)\n" +
      "  count      default 5\n" +
      "  gearId     a specific item; omitted, it spreads across rarities\n",
  );
  process.exit(1);
}

const content = new ContentRegistry();
content.loadGearDir(join(ROOT, "content", "gear"));
content.loadConsumablesDir(join(ROOT, "content", "consumables"));
content.loadBalance(join(ROOT, "content", "balance.json"));

const count = Number(countArg ?? 5) || 5;

/**
 * One item per rarity, rotating — so a test run exercises every colour the
 * reveal card can draw rather than five greys.
 */
function pickItems(): string[] {
  if (gearArg) return Array.from({ length: count }, () => gearArg);

  const byRarity = new Map<Rarity, string[]>();
  for (const g of content.listGear()) {
    if (g.enabled === false) continue;
    const list = byRarity.get(g.rarity) ?? [];
    list.push(g.id);
    byRarity.set(g.rarity, list);
  }
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const rarity = RARITIES[i % RARITIES.length]!;
    const pool = byRarity.get(rarity) ?? [];
    if (!pool.length) continue;
    out.push(pool[Math.floor(Math.random() * pool.length)]!);
  }
  return out;
}

async function main(): Promise<number> {
  const items = pickItems();
  console.log(`\nGranting ${items.length} chest(s) to ${viewerId} via ${SERVER}\n`);

  let ok = 0;
  for (const gearId of items) {
    let res: Response;
    try {
      res = await fetch(`${SERVER}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ type: "grant_chest", requestedBy: viewerId, gearId, from: "Testing" }),
      });
    } catch (err) {
      console.error(`  could not reach ${SERVER} — is the server running? (${(err as Error).message})`);
      return 1;
    }
    const body = (await res.json()) as { ok?: boolean; message?: string };
    const def = content.listGear().find((g) => g.id === gearId);
    if (body.ok) {
      ok += 1;
      console.log(`  ok    ${(def?.rarity ?? "?").padEnd(10)} ${def?.name ?? gearId}`);
    } else {
      console.log(`  FAIL  ${gearId}: ${body.message}`);
    }
  }

  console.log(
    ok === items.length
      ? `\n${ok} chest(s) waiting. Reload the loadout.\n`
      : `\n${ok} of ${items.length} granted.\n`,
  );
  return ok === items.length ? 0 : 1;
}

if (!existsSync(join(ROOT, "content", "gear"))) {
  console.error("run this from the repo root");
  process.exit(1);
}

// `process.exitCode`, not `process.exit()`. Exiting hard while fetch's
// sockets are still closing trips a libuv assertion on Windows
// ("!(handle->flags & UV_HANDLE_CLOSING)") — the work is already done, but it
// prints a crash after a successful run, which is worse than useless.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);
