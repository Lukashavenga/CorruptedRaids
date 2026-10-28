/**
 * The balance log, end to end against the file backend (no Supabase needed).
 *
 *   npm run test:balance-log
 *
 * Drives real engine commands, then checks: a fight and its members come out
 * with the right shape, sim viewers are tagged `sim`, a real viewer's shop
 * actions become economy rows, and a backend that throws costs nothing but a
 * warning. Writes under data/test-balance-log, which is gitignored.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { GameEngine } from "../src/engine/state/gameEngine.js";
import { mulberry32 } from "../src/engine/rng.js";
import type { FightRecord } from "../src/engine/balanceLog.js";
import { BalanceLog, FileLogBackend, type LogItem } from "../src/server/balanceLog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "test-balance-log");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
}

const content = new ContentRegistry();
content.loadGearDir(join(ROOT, "content", "gear"));
content.loadDungeonsDir(join(ROOT, "content", "dungeons"));
content.loadConsumablesDir(join(ROOT, "content", "consumables"));
content.loadBalance(join(ROOT, "content", "balance.json"));
content.loadShop(join(ROOT, "content", "shop.json"));

const engine = new GameEngine(content, mulberry32(11));
const log = new BalanceLog(new FileLogBackend(join(OUT, "logs")), "live", () => content.balance.balanceLog);
log.attach(engine);

const dungeon = content.listDungeons()[0]!;

// A mixed party fights: sim viewers + one real one.
engine.dispatch({ type: "open_dungeon", dungeonId: dungeon.id, requestedBy: "op" } as never);
engine.dispatch({ type: "join_dungeon", requestedBy: "twitch:1", displayName: "Real", role: "tank" } as never);
engine.dispatch({ type: "sim_join", count: 3, dress: true, requestedBy: "op" } as never);
engine.dispatch({ type: "start_dungeon", requestedBy: "op" } as never);

// A second, fully real party, then a shop action.
engine.dispatch({ type: "reset_dungeon", requestedBy: "op" } as never);
engine.dispatch({ type: "open_dungeon", dungeonId: dungeon.id, requestedBy: "op" } as never);
engine.dispatch({ type: "join_dungeon", requestedBy: "twitch:1", displayName: "Real", role: "tank" } as never);
engine.dispatch({ type: "join_dungeon", requestedBy: "twitch:2", displayName: "Real2", role: "dps" } as never);
engine.dispatch({ type: "start_dungeon", requestedBy: "op" } as never);
const real = engine.roster.get("twitch:1")!;
real.gold = 1000;
const gearId = content.shop.gear[0]!;
const bought = engine.dispatch({ type: "buy_gear", gearId, requestedBy: "twitch:1" } as never);
check(bought.ok, "a shop purchase succeeds");

await log.drain();

const files = readdirSync(join(OUT, "logs"));
const fights = files
  .filter((f) => f.startsWith("fights-"))
  .flatMap((f) => readFileSync(join(OUT, "logs", f), "utf-8").trim().split("\n").map((l) => JSON.parse(l) as FightRecord));
const economy = files
  .filter((f) => f.startsWith("economy-"))
  .flatMap((f) => readFileSync(join(OUT, "logs", f), "utf-8").trim().split("\n").map((l) => JSON.parse(l)));

check(fights.length === 2, `two fights recorded (${fights.length})`);
check(fights[0]?.source === "sim", "a fight with a sim viewer in it is tagged sim");
check(fights[1]?.source === "live", "a fight of real viewers is tagged live");
const f = fights[1]!;
check(f.members.length === 2 && f.headcount === 2, "one row per member");
check(["wiped", "cleared", "timer"].includes(f.endReason) && f.ticks > 0 && f.tickCeiling >= f.ticks, "end reason and ticks present");
check(/^[0-9a-f]{14}\.[0-9a-f]{14}$/.test(f.fingerprint), "fingerprint is <fight>.<balance>");
check(f.members.every((m) => typeof m.damageDealt === "number" && m.corruption > 0), "members carry damage and corruption");
check(f.members.some((m) => m.damageDealt > 0), "damage is attributed to someone");
check(economy.some((e) => e.kind === "buy_gear" && e.goldDelta < 0 && e.source === "live"), "the purchase became an economy row");

// A backend that fails must cost a warning and nothing else.
const warn = console.warn;
let warned = 0;
console.warn = () => {
  warned += 1;
};
const broken = new BalanceLog(
  { name: "broken", write: (_: LogItem[]) => Promise.reject(new Error("db down")) },
  "live",
  () => content.balance.balanceLog,
);
const engine2 = new GameEngine(content, mulberry32(12));
broken.attach(engine2);
let threw = false;
try {
  engine2.dispatch({ type: "open_dungeon", dungeonId: dungeon.id, requestedBy: "op" } as never);
  engine2.dispatch({ type: "join_dungeon", requestedBy: "twitch:9", displayName: "X", role: "dps" } as never);
  const res = engine2.dispatch({ type: "start_dungeon", requestedBy: "op" } as never);
  check(res.ok && Boolean(res.combat), "the fight resolves with the log down");
  await broken.drain();
} catch {
  threw = true;
}
console.warn = warn;
check(!threw, "nothing threw");
check(warned > 0, "the failure was warned about");
check(broken.pending === 0, "the failed batch was dropped, not kept");

// --keep leaves the files for `npm run report:balance -- --dir=data/test-balance-log/logs --source=all`.
if (!process.argv.includes("--keep")) rmSync(OUT, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
