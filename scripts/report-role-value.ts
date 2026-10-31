/**
 * Does spending on-role win more than spending off-role? (#57, step 1)
 *
 *   npm run report:role-value -- --disk --samples 60
 *   npm run report:role-value -- --disk --set rally.toFraction=0.7
 *
 * One role at a time is switched between REAL spending (what the live log
 * shows level-30+ players doing) and ON-ROLE spending (tank hp+skill, healer
 * skill+speed, dps attack+speed), at the SAME total points, with the rest of
 * the party left on real spending. Gear is dressed from a per-character seed,
 * so both variants wear identical kit.
 *
 * Two readings per cell, and the gap between them is the rating loophole:
 *   FIXED  - the fight is expanded ONCE, at the rating of the REAL party, and
 *            both variants fight it with the same seeds. This is the
 *            measurement that answers "does on-role win more".
 *   OWN    - each variant draws the fight its own rating picks, as in play.
 *
 * Rally stays as the content has it. Like the other studies it reads the live
 * store unless `--disk`, says which, and asserts nothing.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStudyContent } from "./studyContent.js";
import { mulberry32, randomInt, type Rng } from "../src/engine/rng.js";
import { runCombat } from "../src/engine/combat/resolver.js";
import { dress, referenceParty, spendPoints } from "../src/engine/difficulty.js";
import { createCharacter, grantXp } from "../src/engine/character.js";
import { memberPower, partyRating } from "../src/engine/partyStrength.js";
import { effectiveRating, expandFight } from "../src/engine/squad.js";
import { xpToNextLevel } from "../src/engine/stats.js";
import type { AllocatableStat, Character, Role } from "../src/engine/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const content = await loadStudyContent(join(__dirname, ".."));

const args = process.argv.slice(2);
let samples = 60;
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

type Spending = "on-role" | "real";
// An assumption fitted to the live figures (level 30+ tanks ~26 attack against
// 13 skill, healers ~37 against ~26); not a measurement of every stat.
const REAL_WEIGHTS: Record<Role, Partial<Record<AllocatableStat, number>>> = {
  tank: { atk: 40, skill: 20, hp: 25, spd: 15 },
  healer: { atk: 40, skill: 28, spd: 22, hp: 10 },
  dps: { atk: 55, spd: 35, hp: 10 },
};
function spendReal(c: Character, rng: Rng): void {
  const entries = Object.entries(REAL_WEIGHTS[c.role]) as [AllocatableStat, number][];
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

type Shape = "reference" | "mix";
type Points = "low" | "high";

/**
 * Builds one party. `switched` is the role spent on-role (or null for none).
 * Everything random is drawn from per-character seeds, never a shared stream,
 * so switching one role cannot shift another character's gear or points.
 */
function build(shape: Shape, points: Points, seed: number, switched: Role | null): Character[] {
  const rng = mulberry32(seed);
  let roles: Role[];
  let levels: number[];
  if (shape === "reference") {
    roles = ["tank", "tank", "healer", "healer", "dps", "dps", "dps", "dps", "dps", "dps"];
    const lv = points === "low" ? 10 : 40;
    levels = roles.map(() => lv);
  } else {
    const size = Math.max(3, pickSize(rng));
    roles = Array.from({ length: size }, () => {
      const r = rng();
      return r < 0.25 ? "tank" : r < 0.5 ? "healer" : "dps";
    });
    // Guarantee the role under test is present at least once per party; the
    // mix is otherwise left as the live one.
    if (switched && !roles.includes(switched)) roles[roles.length - 1] = switched;
    const veterans = Math.max(1, Math.round(size * 0.3));
    levels = roles.map((_, i) =>
      i < veterans ? (points === "low" ? randomInt(10, 20, rng) : randomInt(30, 50, rng)) : randomInt(1, points === "low" ? 4 : 6, rng),
    );
  }
  return roles.map((role, i) => {
    const crng = mulberry32(seed * 131 + i * 7919 + 1);
    const c = createCharacter({ id: `rv:${i}`, name: `V${i}`, role });
    levelTo(c, levels[i]!);
    const naked = shape === "mix" && levels[i]! < 7 && crng() < 0.4;
    if (!naked) {
      if (role === switched) spendPoints(c, role, content.balance);
      else spendReal(c, crng);
      dress(c, content, "typical", crng);
    }
    return c;
  });
}

interface Tally {
  n: number;
  wins: number;
  /** deaths among members of the tested role / members of that role. */
  roleDead: number;
  roleN: number;
  survivors: number;
  size: number;
  enemyHp: number;
}
const blank = (): Tally => ({ n: 0, wins: 0, roleDead: 0, roleN: 0, survivors: 0, size: 0, enemyHp: 0 });

function fight(party: Character[], dungeonId: string, rating: number, seed: number, role: Role, t: Tally): void {
  const dungeon = content.getDungeon(dungeonId);
  const enemies = expandFight(dungeon, dungeon.id, dungeon.name, effectiveRating(rating, party.length), content.balance.bandStatScale);
  if (enemies.length === 0) return;
  const result = runCombat(party, enemies, content, content.balance, mulberry32(seed));
  t.n += 1;
  if (result.outcome === "victory") t.wins += 1;
  for (const c of party) {
    if (c.role !== role) continue;
    t.roleN += 1;
    if (!result.survivorIds.includes(c.id)) t.roleDead += 1;
  }
  t.survivors += result.survivorIds.length;
  t.size += party.length;
  t.enemyHp += enemies.reduce((s, e) => s + e.stats.hp, 0);
}

const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}%`);
const se = (p: number, n: number) => (n === 0 ? 0 : Math.sqrt((p * (1 - p)) / n) * 100);

console.log(`role-value study - ${samples} parties x ${content.listDungeons().length} dungeons per cell`);
console.log(`rally: ${JSON.stringify({ ...content.balance.rally })}`);
console.log("FIXED = both variants fight the fight the REAL party's rating picks. OWN = each draws its own.");
console.log("win = party win rate; role dead = deaths among that role's members; surv = party survivor share.\n");
console.log("| role | party | points | reading | real win | on-role win | delta | real role-dead | on-role role-dead | real rating | on-role rating | n/cell | +-1se |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");

const summary: Record<string, number[]> = {};
for (const role of ["tank", "healer", "dps"] as Role[]) {
  for (const shape of ["reference", "mix"] as Shape[]) {
    for (const points of ["low", "high"] as Points[]) {
      const cells: Record<string, Tally> = { fixedReal: blank(), fixedOn: blank(), ownReal: blank(), ownOn: blank() };
      let rReal = 0;
      let rOn = 0;
      let rn = 0;
      for (const dungeon of content.listDungeons()) {
        for (let s = 0; s < samples; s += 1) {
          const seed = 1000 + s;
          const real = build(shape, points, seed, null);
          const on = build(shape, points, seed, role);
          const ratingReal = partyRating(real, content);
          const ratingOn = partyRating(on, content);
          rReal += ratingReal;
          rOn += ratingOn;
          rn += 1;
          const fseed = 5000 + s;
          // Fresh copies per fight: combat awards nothing to the Character it is
          // handed, but build() is cheap and this keeps variants independent.
          fight(real, dungeon.id, ratingReal, fseed, role, cells.fixedReal!);
          fight(on, dungeon.id, ratingReal, fseed, role, cells.fixedOn!);
          fight(real, dungeon.id, ratingReal, fseed, role, cells.ownReal!);
          fight(on, dungeon.id, ratingOn, fseed, role, cells.ownOn!);
        }
      }
      for (const [reading, a, b] of [
        ["FIXED", cells.fixedReal!, cells.fixedOn!],
        ["OWN", cells.ownReal!, cells.ownOn!],
      ] as const) {
        const pa = a.wins / Math.max(1, a.n);
        const pb = b.wins / Math.max(1, b.n);
        const delta = Math.round((pb - pa) * 100);
        const noise = Math.round(Math.sqrt(se(pa, a.n) ** 2 + se(pb, b.n) ** 2));
        console.log(
          `| ${role} | ${shape} | ${points} | ${reading} | ${pct(a.wins, a.n)} | ${pct(b.wins, b.n)} | ${delta >= 0 ? "+" : ""}${delta} | ${pct(a.roleDead, a.roleN)} | ${pct(b.roleDead, b.roleN)} | ${Math.round(rReal / rn)} | ${Math.round(rOn / rn)} | ${a.n} | ${noise} |`,
        );
        (summary[`${role} ${reading}`] ??= []).push(delta);
      }
    }
  }
}
console.log("\nmean win-rate delta (on-role minus real), points, across the four shape x points cells:");
for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}`);
void referenceParty;
