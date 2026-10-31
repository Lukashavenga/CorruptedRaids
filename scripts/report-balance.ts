/**
 * What real nights of play looked like.
 *
 *   npm run report:balance -- [--from=2026-10-01] [--to=2026-10-28]
 *                             [--dungeon=<dungeon or raid id>]
 *                             [--source=live|sim|sandbox|all]   (default live)
 *                             [--store=file|supabase] [--dir=<DATA_DIR>/logs]
 *                             [--no-sim] [--disk]
 *
 * `npm run simulate` asks whether the ENGINE is correct, with a reference party
 * that spends its points exactly as designed. This reads the balance log
 * (AGENTS.md "Balance log") and asks what viewers actually did: win rates and
 * timer rates per level, who takes the hits, where the points really went, what
 * dropped and what gold did.
 *
 * Like `simulate:progression` it prints and asserts NOTHING. Every number here
 * is a design decision for a person to read (AGENTS.md section 6, "Two
 * simulators, two questions").
 *
 * The store follows the game server's rule: Supabase when SUPABASE_URL and
 * SUPABASE_SERVICE_KEY are set and ROSTER_STORE is not "file", the JSON lines
 * under DATA_DIR/logs otherwise. Both give the same FightRecords.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStudyContent } from "./studyContent.js";
import { DEFAULT_TARGET_WIN, measureBand } from "../src/engine/bandSolver.js";
import type { EconomyRecord, FightMemberRecord, FightRecord } from "../src/engine/balanceLog.js";
import { PARTY_BANDS, type AllocatableStat, type Rarity, type Role } from "../src/engine/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- arguments --------------------------------------------------------------

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const from = arg("from") ? new Date(`${arg("from")}T00:00:00Z`) : undefined;
// Inclusive of the whole day named.
const to = arg("to") ? new Date(new Date(`${arg("to")}T00:00:00Z`).getTime() + 86_400_000) : undefined;
const dungeonFilter = arg("dungeon");
const sourceFilter = arg("source") ?? "live";
if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
  console.error("--from / --to must be YYYY-MM-DD");
  process.exit(1);
}

// --- reading ----------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const LOG_DIR = arg("dir") ?? join(DATA_DIR, "logs");
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const store = arg("store") ?? (hasSupabase && process.env.ROSTER_STORE !== "file" ? "supabase" : "file");

function inRange(at: string): boolean {
  const t = Date.parse(at);
  return (!from || t >= from.getTime()) && (!to || t < to.getTime());
}
const wantSource = (s: string): boolean => sourceFilter === "all" || s === sourceFilter;

function readLines<T extends { at: string; source: string }>(prefix: string): T[] {
  if (!existsSync(LOG_DIR)) return [];
  const out: T[] = [];
  for (const file of readdirSync(LOG_DIR).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".jsonl")).sort()) {
    const day = file.slice(prefix.length + 1, -".jsonl".length);
    // Skip whole files outside the range: a log can be months of lines.
    if (from && Date.parse(`${day}T23:59:59Z`) < from.getTime()) continue;
    if (to && Date.parse(`${day}T00:00:00Z`) >= to.getTime()) continue;
    for (const line of readFileSync(join(LOG_DIR, file), "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as T;
        if (inRange(rec.at) && wantSource(rec.source)) out.push(rec);
      } catch {
        console.warn(`[report] skipped a malformed line in ${file}`);
      }
    }
  }
  return out;
}

async function rest<T>(path: string): Promise<T[]> {
  const base = `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/rest/v1`;
  const rows: T[] = [];
  // Paged: PostgREST caps a response, and silently reporting the first
  // thousand fights would look exactly like a quiet month.
  const page = 1000;
  for (let start = 0; ; start += page) {
    const res = await fetch(`${base}${path}`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY!}`,
        Range: `${start}-${start + page - 1}`,
        "Range-Unit": "items",
      },
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const batch = (await res.json()) as T[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

function dateQuery(): string {
  const parts: string[] = [];
  if (from) parts.push(`created_at=gte.${from.toISOString()}`);
  if (to) parts.push(`created_at=lt.${to.toISOString()}`);
  if (sourceFilter !== "all") parts.push(`source=eq.${sourceFilter}`);
  return parts.length ? `&${parts.join("&")}` : "";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function readSupabase(): Promise<{ fights: FightRecord[]; economy: EconomyRecord[] }> {
  // `events` is left out: it is large and nothing here reads it.
  const cols =
    "id,created_at,source,run_id,kind,dungeon_id,raid_id,room_id,level,band,party_rating,headcount,tanks,healers,dps," +
    "enemy_count,stat_scale,party_scale_hp,party_scale_atk,boss_hp_mult,boss_atk_mult,outcome,ticks,tick_ceiling," +
    "end_reason,fingerprint,fight_members(*)";
  const rows = await rest<any>(`/fights?select=${cols}&order=created_at.asc${dateQuery()}`);
  const fights: FightRecord[] = rows.map((r) => ({
    id: r.id,
    at: r.created_at,
    source: r.source,
    runId: r.run_id,
    kind: r.kind,
    dungeonId: r.dungeon_id,
    raidId: r.raid_id,
    roomId: r.room_id,
    level: r.level,
    band: r.band,
    partyRating: r.party_rating,
    headcount: r.headcount,
    roleCounts: { tank: r.tanks, healer: r.healers, dps: r.dps },
    enemyCount: r.enemy_count,
    statScale: r.stat_scale,
    partyScaleHp: r.party_scale_hp,
    partyScaleAtk: r.party_scale_atk,
    bossHpMult: r.boss_hp_mult,
    bossAtkMult: r.boss_atk_mult,
    outcome: r.outcome,
    ticks: r.ticks,
    tickCeiling: r.tick_ceiling,
    endReason: r.end_reason,
    fingerprint: r.fingerprint,
    events: null,
    members: (r.fight_members as any[]).map(
      (m): FightMemberRecord => ({
        characterId: m.character_id,
        role: m.role,
        level: m.level,
        corruption: m.corruption,
        allocated: m.allocated,
        stats: m.stats,
        gear: m.gear,
        damageDealt: m.damage_dealt,
        damageTaken: m.damage_taken,
        hitsTaken: m.hits_taken,
        healsGiven: m.heals_given,
        healsReceived: m.heals_received,
        taunts: m.taunts,
        survived: m.survived,
        deathTick: m.death_tick,
        xp: m.xp,
        gold: m.gold,
        levelUps: m.level_ups,
        loot: m.loot,
      }),
    ),
  }));
  const eco = await rest<any>(`/economy_events?select=*&order=created_at.asc${dateQuery()}`);
  const economy: EconomyRecord[] = eco.map((e) => ({
    at: e.created_at,
    source: e.source,
    characterId: e.character_id,
    kind: e.kind,
    goldDelta: e.gold_delta,
    gearId: e.gear_id,
    rarity: e.rarity,
    gearSource: e.gear_source,
    level: e.level,
    fightId: e.fight_id,
  }));
  return { fights, economy };
}

// --- helpers ----------------------------------------------------------------

function head(title: string): void {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}
const pct = (n: number, of: number): string => (of === 0 ? "—" : `${((n / of) * 100).toFixed(0)}%`);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const lpad = (s: string | number, n: number): string => String(s).padStart(n);
const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
const ROLES: Role[] = ["tank", "healer", "dps"];
/** The two stats each role is designed around (src/engine/difficulty.ts spendPoints). */
const WANTED: Record<Role, [AllocatableStat, AllocatableStat]> = {
  tank: ["hp", "skill"],
  healer: ["skill", "spd"],
  dps: ["atk", "spd"],
};
const STATS: AllocatableStat[] = ["hp", "atk", "spd", "skill"];

const placeOf = (f: FightRecord): string =>
  f.kind === "dungeon" ? f.dungeonId! : `${f.raidId}:${f.kind === "raid_boss" ? "boss" : f.roomId}`;

// --- main -------------------------------------------------------------------

// Targets and the sim column are read off the live store when there is one: a
// real win rate beside a target the game is not using is worse than no target.
const content = await loadStudyContent(ROOT);

const data =
  store === "supabase"
    ? await readSupabase()
    : { fights: readLines<FightRecord & { at: string }>("fights"), economy: readLines<EconomyRecord>("economy") };

const fights = data.fights.filter((f) => !dungeonFilter || f.dungeonId === dungeonFilter || f.raidId === dungeonFilter);
const economy = data.economy;

console.log(
  `Balance log: ${store === "supabase" ? "Supabase" : LOG_DIR}  |  source=${sourceFilter}` +
    `${from ? `  from ${arg("from")}` : ""}${to ? `  to ${arg("to")}` : ""}${dungeonFilter ? `  place ${dungeonFilter}` : ""}`,
);
console.log(`${fights.length} fights, ${fights.reduce((s, f) => s + f.members.length, 0)} member rows, ${economy.length} economy events.`);

if (fights.length === 0) {
  console.log("\nNothing to report. Run a fight against this server with the log enabled, or widen the filters.");
  process.exit(0);
}

const prints = new Set(fights.map((f) => f.fingerprint));
if (prints.size > 1) {
  console.log(
    `NOTE: ${prints.size} different content fingerprints in this range - content or balance changed part-way, ` +
      "so a row below may mix readings taken under different numbers. Narrow --from to compare like with like.",
  );
}

// 1. per place x level ---------------------------------------------------------
head("1. Per place x level: real vs what the solver aimed for");
console.log(
  "target = the place's targetWinRate (default " +
    `${(DEFAULT_TARGET_WIN * 100).toFixed(0)}%); sim = the same level measured against its reference party, now.\n` +
    "Level is the PARTY's level; timer% is fights that ran to the tick ceiling with both sides standing.\n",
);
console.log(
  `${pad("place", 24)}${pad("lvl", 5)}${lpad("fights", 7)}${lpad("win%", 6)}${lpad("target", 8)}${lpad("sim", 6)}` +
    `${lpad("timer%", 8)}${lpad("headcount", 11)}${lpad("rating", 8)}`,
);
const places = [...new Set(fights.map(placeOf))].sort();
for (const place of places) {
  const dungeon = content.listDungeons().find((d) => d.id === place);
  for (let level = 1; level <= PARTY_BANDS.length; level += 1) {
    const rows = fights.filter((f) => placeOf(f) === place && f.level === level);
    if (rows.length === 0) continue;
    const wins = rows.filter((f) => f.outcome === "victory").length;
    const timers = rows.filter((f) => f.endReason === "timer").length;
    const target = dungeon ? `${((dungeon.targetWinRate ?? DEFAULT_TARGET_WIN) * 100).toFixed(0)}%` : "—";
    // Only dungeons can be measured by id here: a raid room needs its run's
    // buffs and the other rooms, which a single-fight reading cannot see.
    const sim =
      dungeon && !flag("no-sim")
        ? `${(measureBand(dungeon, PARTY_BANDS[level - 1]!, content).winRate * 100).toFixed(0)}%`
        : "—";
    console.log(
      `${pad(place, 24)}${pad(`L${level}`, 5)}${lpad(rows.length, 7)}${lpad(pct(wins, rows.length), 6)}${lpad(target, 8)}` +
        `${lpad(sim, 6)}${lpad(pct(timers, rows.length), 8)}${lpad(mean(rows.map((f) => f.headcount)).toFixed(1), 11)}` +
        `${lpad(Math.round(mean(rows.map((f) => f.partyRating))), 8)}`,
    );
  }
}
const reasons = ["cleared", "wiped", "timer"].map((r) => `${r} ${pct(fights.filter((f) => f.endReason === r).length, fights.length)}`);
console.log(`\nHow fights ended, overall: ${reasons.join(", ")}.`);

// 2. per role ------------------------------------------------------------------
head("2. Per role: who takes the hits");
const members = fights.flatMap((f) => f.members.map((m) => ({ f, m })));
const total = (pick: (m: FightMemberRecord) => number): number => members.reduce((s, x) => s + pick(x.m), 0);
const totHits = total((m) => m.hitsTaken);
const totDmgTaken = total((m) => m.damageTaken);
const totHeals = total((m) => m.healsReceived);
const totDealt = total((m) => m.damageDealt);
console.log(
  `${pad("role", 8)}${lpad("rows", 7)}${lpad("seats%", 8)}${lpad("hits%", 8)}${lpad("dmg taken%", 12)}` +
    `${lpad("heals recv%", 13)}${lpad("dmg dealt%", 12)}${lpad("death%", 8)}${lpad("taunts/f", 10)}`,
);
for (const role of ROLES) {
  const rows = members.filter((x) => x.m.role === role).map((x) => x.m);
  if (rows.length === 0) continue;
  const sum = (pick: (m: FightMemberRecord) => number): number => rows.reduce((s, m) => s + pick(m), 0);
  console.log(
    `${pad(role, 8)}${lpad(rows.length, 7)}${lpad(pct(rows.length, members.length), 8)}${lpad(pct(sum((m) => m.hitsTaken), totHits), 8)}` +
      `${lpad(pct(sum((m) => m.damageTaken), totDmgTaken), 12)}${lpad(pct(sum((m) => m.healsReceived), totHeals), 13)}` +
      `${lpad(pct(sum((m) => m.damageDealt), totDealt), 12)}${lpad(pct(rows.filter((m) => !m.survived).length, rows.length), 8)}` +
      `${lpad(role === "tank" ? mean(rows.map((m) => m.taunts)).toFixed(1) : "—", 10)}`,
  );
}
console.log("seats% is each role's share of member rows: compare it with the other columns to read over/under-load.");

// 3. allocation ----------------------------------------------------------------
head("3. Per role: where the points actually went (average) vs the reference party");
console.log(
  "reference = the same points split evenly across the role's two designed stats, which is how the\n" +
    "simulator's party spends them (difficulty.ts spendPoints). 'on-role' = share of SPENT points in those two;\n" +
    "'none spent' = characters with points earned and not one spent, who are not counted in on-role.\n",
);
console.log(
  `${pad("role", 8)}${lpad("n", 6)}${lpad("points", 8)}  ${STATS.map((s) => pad(`${s} real/ref`, 15)).join("")}${lpad("on-role%", 10)}${lpad("none spent", 12)}`,
);
// One row per character per role, from their latest appearance in range: a
// build is a thing a person has, and counting it once per fight would weight
// it by how often they turn up.
const latest = new Map<string, FightMemberRecord>();
for (const { m } of members) latest.set(`${m.characterId}|${m.role}`, m);
for (const role of ROLES) {
  const builds = [...latest.values()].filter((m) => m.role === role);
  if (builds.length === 0) continue;
  const spent = (m: FightMemberRecord): number => STATS.reduce((s, k) => s + (m.allocated[k] ?? 0), 0);
  const avgSpent = mean(builds.map(spent));
  const cells = STATS.map((stat) => {
    const real = mean(builds.map((m) => m.allocated[stat] ?? 0));
    const idx = WANTED[role].indexOf(stat);
    // spendPoints alternates, first stat first: an odd point goes to the first.
    const ref = idx === -1 ? 0 : mean(builds.map((m) => (idx === 0 ? Math.ceil(spent(m) / 2) : Math.floor(spent(m) / 2))));
    return pad(`${real.toFixed(1)}/${ref.toFixed(1)}`, 15);
  });
  // Spenders only. A character with nothing spent has no build to be off-role,
  // and counting them as 0% made the column read far below where points went.
  const spenders = builds.filter((m) => spent(m) > 0);
  const onRole = mean(spenders.map((m) => WANTED[role].reduce((s, k) => s + (m.allocated[k] ?? 0), 0) / spent(m)));
  const noneSpent = builds.filter((m) => spent(m) === 0 && m.level > 1).length;
  console.log(`${pad(role, 8)}${lpad(builds.length, 6)}${lpad(avgSpent.toFixed(1), 8)}  ${cells.join("")}${lpad(`${(onRole * 100).toFixed(0)}%`, 10)}${lpad(noneSpent, 12)}`);
}

// 4. drops and gold ------------------------------------------------------------
head("4. Drops and gold");
const nightOf = (at: string): string => at.slice(0, 10); // UTC date; a stream past midnight UTC splits in two
const viewerRuns = new Set<string>();
const viewerNights = new Set<string>();
const dropsByRarity = new Map<Rarity, number>();
const dropsByNight = new Map<Rarity, number>();
let fightGold = 0;
for (const f of fights) {
  for (const m of f.members) {
    viewerRuns.add(`${m.characterId}|${f.runId}`);
    viewerNights.add(`${m.characterId}|${nightOf(f.at)}`);
    fightGold += m.gold;
    for (const drop of m.loot) {
      dropsByRarity.set(drop.rarity, (dropsByRarity.get(drop.rarity) ?? 0) + 1);
      dropsByNight.set(drop.rarity, (dropsByNight.get(drop.rarity) ?? 0) + 1);
    }
  }
}
console.log(`${viewerRuns.size} viewer-runs over ${viewerNights.size} viewer-nights (a viewer-night is one viewer on one UTC date).\n`);
console.log(`${pad("rarity", 12)}${lpad("drops", 8)}${lpad("per viewer-run", 16)}${lpad("per viewer-night", 18)}`);
let allDrops = 0;
for (const rarity of RARITIES) {
  const n = dropsByRarity.get(rarity) ?? 0;
  allDrops += n;
  console.log(`${pad(rarity, 12)}${lpad(n, 8)}${lpad((n / viewerRuns.size).toFixed(3), 16)}${lpad((n / viewerNights.size).toFixed(2), 18)}`);
}
console.log(`${pad("all", 12)}${lpad(allDrops, 8)}${lpad((allDrops / viewerRuns.size).toFixed(3), 16)}${lpad((allDrops / viewerNights.size).toFixed(2), 18)}`);

const bought = economy.filter((e) => e.kind === "buy_gear" || e.kind === "buy_consumable");
const recycled = economy.filter((e) => e.kind === "recycle_gear");
const opened = economy.filter((e) => e.kind === "open_chest");
const spent = bought.reduce((s, e) => s - e.goldDelta, 0);
const payout = recycled.reduce((s, e) => s + e.goldDelta, 0);
const shopRecycled = recycled.filter((e) => e.gearSource === "shop");
const nights = Math.max(1, viewerNights.size);
console.log(`\n${pad("gold", 28)}${lpad("total", 10)}${lpad("per viewer-night", 18)}`);
for (const [label, value] of [
  ["earned in fights", fightGold],
  ["recycle payouts", payout],
  ["spent in the shop", spent],
  ["net (in - out)", fightGold + payout - spent],
] as [string, number][]) {
  console.log(`${pad(label, 28)}${lpad(value, 10)}${lpad((value / nights).toFixed(1), 18)}`);
}
console.log(
  `\n${bought.length} purchases, ${recycled.length} recycles (${shopRecycled.length} of shop-bought gear, refunded in full), ` +
    `${opened.length} chests opened, ${economy.filter((e) => e.kind === "level_up").length} level-ups.`,
);
const lootScrapped = recycled.filter((e) => e.gearSource !== "shop").length;
console.log(`Found items scrapped against chests opened: ${lootScrapped} of ${opened.length} (${pct(lootScrapped, opened.length)}).`);
console.log("Economy events are not filtered by --dungeon; they belong to the viewer, not to a place.");

// 4b. do low-level viewers open chests? -----------------------------------------
// The nightly loadout prompt (src/engine/loadoutPrompt.ts) exists because 22 of
// the 23 level 1-9 characters in the log had never opened a chest. This is the
// reading that says whether it worked: by night, how many of the low-level
// viewers who fought opened one. It cannot see the prompt itself (the bot's
// message is not logged), so read it as a trend across the date the prompt
// shipped, not as an effect size.
const LOW_LEVEL = 9;
console.log(`\nLow-level viewers (level 1-${LOW_LEVEL}) and chests, by UTC night. A viewer is low-level on a night if they fought at that level.`);
console.log(`${pad("night", 12)}${lpad("fought", 8)}${lpad("opened", 8)}${lpad("share", 8)}${lpad("chests", 8)}`);
const lowFought = new Map<string, Set<string>>();
for (const f of fights) {
  for (const m of f.members) {
    if (m.level > LOW_LEVEL || m.characterId.startsWith("sim:")) continue;
    const night = f.at.slice(0, 10);
    if (!lowFought.has(night)) lowFought.set(night, new Set());
    lowFought.get(night)!.add(m.characterId);
  }
}
const openedBy = new Map<string, Map<string, number>>();
for (const e of opened) {
  const night = e.at.slice(0, 10);
  if (!openedBy.has(night)) openedBy.set(night, new Map());
  const tally = openedBy.get(night)!;
  tally.set(e.characterId, (tally.get(e.characterId) ?? 0) + 1);
}
const everLow = new Set<string>();
const everOpened = new Set<string>();
for (const night of [...lowFought.keys()].sort()) {
  const fought = lowFought.get(night)!;
  const tally = openedBy.get(night) ?? new Map<string, number>();
  const openers = [...fought].filter((id) => tally.has(id));
  const chests = openers.reduce((s, id) => s + (tally.get(id) ?? 0), 0);
  for (const id of fought) everLow.add(id);
  for (const id of openers) everOpened.add(id);
  console.log(`${pad(night, 12)}${lpad(fought.size, 8)}${lpad(openers.length, 8)}${lpad(pct(openers.length, fought.size), 8)}${lpad(chests, 8)}`);
}
if (everLow.size === 0) console.log("(no level 1-9 viewers in this range)");
else console.log(`Ever, in this range: ${everOpened.size} of ${everLow.size} low-level viewers opened a chest (${pct(everOpened.size, everLow.size)}).`);

// 5. the weakest in the room ---------------------------------------------------
head("5. The weakest in the room: power against the party's rating");
console.log(
  "The average protects the party, and this is who pays for it (AGENTS.md section 5). Parties of 3+;\n" +
    "'dmg/fair' is the member's share of the party's damage against an even split, so 1.00 is pulling their weight.\n",
);
console.log(
  `${pad("power vs party", 16)}${lpad("rows", 7)}${lpad("viewers", 9)}${lpad("death%", 8)}${lpad("party won%", 12)}` +
    `${lpad("dmg/fair", 10)}${lpad("gold", 7)}${lpad("xp", 6)}`,
);
const RATIOS: [string, number, number][] = [
  ["under 25%", 0, 0.25],
  ["25-50%", 0.25, 0.5],
  ["50-100%", 0.5, 1],
  ["100-150%", 1, 1.5],
  ["over 150%", 1.5, Infinity],
];
const measured = fights
  .filter((f) => f.headcount >= 3 && f.partyRating > 0)
  .flatMap((f) => {
    const dealt = f.members.reduce((s, m) => s + m.damageDealt, 0);
    return f.members.map((m) => ({ f, m, ratio: m.corruption / f.partyRating, fair: dealt > 0 ? (m.damageDealt / dealt) * f.headcount : 0 }));
  });
for (const [label, lo, hi] of RATIOS) {
  const rows = measured.filter((x) => x.ratio >= lo && x.ratio < hi);
  if (rows.length === 0) continue;
  console.log(
    `${pad(label, 16)}${lpad(rows.length, 7)}${lpad(new Set(rows.map((x) => x.m.characterId)).size, 9)}` +
      `${lpad(pct(rows.filter((x) => !x.m.survived).length, rows.length), 8)}` +
      `${lpad(pct(rows.filter((x) => x.f.outcome === "victory").length, rows.length), 12)}` +
      `${lpad(mean(rows.map((x) => x.fair)).toFixed(2), 10)}${lpad(Math.round(mean(rows.map((x) => x.m.gold))), 7)}` +
      `${lpad(Math.round(mean(rows.map((x) => x.m.xp))), 6)}`,
  );
}
