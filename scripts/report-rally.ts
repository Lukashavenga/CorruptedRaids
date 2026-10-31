/**
 * What Rally (balance.rally) does to the parties people really bring.
 *
 *   npm run report:rally -- --disk --samples 40
 *   npm run report:rally -- --disk --set rally.toFraction=0.7
 *
 * Reference parties are all one level, so Rally never fires on them. This
 * builds the parties the live log shows instead: 1-14 players (5-9 most
 * common), a quarter tanks and a quarter healers, and a few level-30+
 * characters beside newcomers, some of them naked with points unspent.
 *
 * Every party is fought twice from the same seed, Rally off and on, so the
 * difference between the two rows is Rally and nothing else. Like the other
 * studies it reads the live store unless `--disk`, and says which. It asserts
 * nothing: every number is for a person to read.
 *
 * Spending is modelled two ways, because they differ: ON-ROLE is the design
 * (tank hp+skill, healer skill+speed, dps attack+speed); REAL follows what the
 * live log shows level-30+ players doing (tanks 26 attack against 13 skill,
 * healers 37 against 26). The REAL weights below are an assumption fitted to
 * those two figures, not a measurement of every stat.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStudyContent } from "./studyContent.js";
import { mulberry32, randomInt, type Rng } from "../src/engine/rng.js";
import { runCombat } from "../src/engine/combat/resolver.js";
import { dress, spendPoints } from "../src/engine/difficulty.js";
import { createCharacter, grantXp } from "../src/engine/character.js";
import { memberPower, partyRating } from "../src/engine/partyStrength.js";
import { effectiveRating } from "../src/engine/squad.js";
import { expandFight } from "../src/engine/squad.js";
import { xpToNextLevel } from "../src/engine/stats.js";
import type { AllocatableStat, Character, Role } from "../src/engine/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const content = await loadStudyContent(join(__dirname, ".."));

const args = process.argv.slice(2);
let samples = 40;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--samples") {
    i += 1;
    samples = Number(args[i]);
  } else if (args[i] === "--set") {
    i += 1;
    const [path, raw] = (args[i] ?? "").split("=");
    const keys = (path ?? "").split(".");
    let node: any = content.balance;
    for (const k of keys.slice(0, -1)) node = node[k];
    const last = keys[keys.length - 1]!;
    if (!(last in node)) throw new Error(`--set: no balance knob "${path}"`);
    node[last] = Number(raw);
  }
}

// Party sizes 1..14, 5-9 most common.
const SIZE_WEIGHTS = [1, 2, 3, 4, 8, 10, 12, 10, 8, 4, 3, 2, 1, 1];
function pickSize(rng: Rng): number {
  const total = SIZE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < SIZE_WEIGHTS.length; i += 1) {
    r -= SIZE_WEIGHTS[i]!;
    if (r < 0) return i + 1;
  }
  return 7;
}

function pickRole(rng: Rng): Role {
  const r = rng();
  return r < 0.25 ? "tank" : r < 0.5 ? "healer" : "dps";
}

type Spending = "on-role" | "real";
const REAL_WEIGHTS: Record<Role, Partial<Record<AllocatableStat, number>>> = {
  tank: { atk: 40, skill: 20, hp: 25, spd: 15 },
  healer: { atk: 40, skill: 28, spd: 22, hp: 10 },
  dps: { atk: 55, spd: 35, hp: 10 },
};
function spendReal(c: Character, rng: Rng): void {
  const w = REAL_WEIGHTS[c.role];
  const entries = Object.entries(w) as [AllocatableStat, number][];
  const total = entries.reduce((s, [, n]) => s + n, 0);
  while (c.unspentPoints > 0) {
    let r = rng() * total;
    for (const [stat, n] of entries) {
      r -= n;
      if (r < 0) {
        c.allocated[stat] += 1;
        break;
      }
    }
    c.unspentPoints -= 1;
  }
}

function levelTo(c: Character, level: number): void {
  for (let l = 1; l < level; l += 1) grantXp(c, xpToNextLevel(l), content.balance);
}

/** A mixed-level party: a few level 30-50 in typical gear, newcomers of 1-6, a share of them naked and unspent. */
function mixedParty(seed: number, spending: Spending): Character[] {
  const rng = mulberry32(seed);
  const size = pickSize(rng);
  const veterans = Math.min(size, Math.max(1, Math.round(size * 0.3)));
  const party: Character[] = [];
  for (let i = 0; i < size; i += 1) {
    const c = createCharacter({ id: `rally:${i}`, name: `R${i}`, role: pickRole(rng) });
    const veteran = i < veterans;
    levelTo(c, veteran ? randomInt(30, 50, rng) : randomInt(1, 6, rng));
    const naked = !veteran && rng() < 0.4;
    if (!naked) {
      if (spending === "real") spendReal(c, rng);
      else spendPoints(c, c.role, content.balance);
      dress(c, content, "typical", rng);
    }
    party.push(c);
  }
  return party;
}

const BUCKETS: [string, number, number][] = [
  ["under 25%", 0, 0.25],
  ["25-50%", 0.25, 0.5],
  ["50-100%", 0.5, 1],
  ["over 100%", 1, Infinity],
];

interface Acc {
  fights: number;
  wins: number;
  rows: Record<string, { n: number; dead: number; fair: number }>;
}
const fresh = (): Acc => ({ fights: 0, wins: 0, rows: Object.fromEntries(BUCKETS.map(([l]) => [l, { n: 0, dead: 0, fair: 0 }])) });

function run(spending: Spending, rallyOn: boolean): Acc {
  content.balance.rally.enabled = rallyOn;
  const acc = fresh();
  for (const dungeon of content.listDungeons()) {
    for (let s = 0; s < samples; s += 1) {
      const party = mixedParty(1000 + s, spending);
      if (party.length < 3) continue; // Rally needs 3+; the live numbers are parties of 3+ too.
      const rating = partyRating(party, content);
      const ratio = new Map(party.map((c) => [c.id, rating > 0 ? memberPower(c, content) / rating : 0]));
      const strength = effectiveRating(rating, party.length);
      const enemies = expandFight(dungeon, dungeon.id, dungeon.name, strength, content.balance.bandStatScale);
      if (enemies.length === 0) continue;
      const result = runCombat(party, enemies, content, content.balance, mulberry32(5000 + s));
      acc.fights += 1;
      if (result.outcome === "victory") acc.wins += 1;
      const dealt = new Map<string, number>();
      let total = 0;
      for (const e of result.events) {
        if (e.type === "attack") {
          dealt.set(e.actorId, (dealt.get(e.actorId) ?? 0) + e.damage);
          if (ratio.has(e.actorId)) total += e.damage;
        }
      }
      for (const c of party) {
        const r = ratio.get(c.id)!;
        const bucket = BUCKETS.find(([, lo, hi]) => r >= lo && r < hi)![0];
        const row = acc.rows[bucket]!;
        row.n += 1;
        if (!result.survivorIds.includes(c.id)) row.dead += 1;
        row.fair += total > 0 ? ((dealt.get(c.id) ?? 0) / total) * party.length : 0;
      }
    }
  }
  return acc;
}

const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}%`);
console.log(`rally study - ${samples} parties x ${content.listDungeons().length} dungeons per row, parties of 3-14`);
console.log(`rally: ${JSON.stringify({ ...content.balance.rally })}`);
for (const spending of ["on-role", "real"] as Spending[]) {
  const off = run(spending, false);
  const on = run(spending, true);
  console.log(`\n## spending: ${spending}`);
  console.log(`party win rate   Rally off ${pct(off.wins, off.fights)}   Rally on ${pct(on.wins, on.fights)}   (${off.fights} fights each)`);
  console.log("| power vs party | members off/on | death% off | death% on | dmg/fair off | dmg/fair on |");
  console.log("|---|---|---|---|---|---|");
  for (const [label] of BUCKETS) {
    const a = off.rows[label]!;
    const b = on.rows[label]!;
    if (a.n === 0 && b.n === 0) continue;
    console.log(
      `| ${label} | ${a.n}/${b.n} | ${pct(a.dead, a.n)} | ${pct(b.dead, b.n)} | ${(a.fair / Math.max(1, a.n)).toFixed(2)} | ${(b.fair / Math.max(1, b.n)).toFixed(2)} |`,
    );
  }
}
