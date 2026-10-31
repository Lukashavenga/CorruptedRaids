/**
 * Who gets hit, who gets healed, who dies - per role - and how often the tick
 * ceiling ends a fight.
 *
 *   npm run report:threat
 *   npm run report:threat -- --set aggro.focusBreakChance=0.12 --samples 60
 *
 * Asserts nothing: like simulate:progression, every number is a design call.
 * `--set path=value` overrides a balance knob for this run only, so a change
 * can be measured before it is saved. Reads the live store; see studyContent.ts.
 *
 * The party is 2 tank / 2 healer / 8 DPS, built and spent as estimateDifficulty
 * builds its reference party, and each fight is expanded at that party's own
 * rating (never its headcount - AGENTS.md §6).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStudyContent } from "./studyContent.js";
import { mulberry32 } from "../src/engine/rng.js";
import { runCombat } from "../src/engine/combat/resolver.js";
import { referenceParty, referencePartyStrength, type GearAssumption } from "../src/engine/difficulty.js";
import { expandFight } from "../src/engine/squad.js";
import type { Role } from "../src/engine/types.js";

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
    let node = content.balance as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
    const last = keys[keys.length - 1]!;
    if (!(last in node)) throw new Error(`--set: no balance knob "${path}"`);
    node[last] = Number(raw);
  }
}

const COMP = { tanks: 2, healers: 2, dps: 8 };
const SETUPS: { label: string; level: number; gear: GearAssumption }[] = [
  { label: "L10 typical", level: 10, gear: "typical" },
  { label: "L25 best", level: 25, gear: "best" },
];

type ByRole = Record<Role, number>;
const zero = (): ByRole => ({ tank: 0, healer: 0, dps: 0 });
const sum = (r: ByRole) => r.tank + r.healer + r.dps;
const pc = (n: number, of: number) => (of === 0 ? "-" : `${Math.round((n / of) * 100)}`);
const triple = (r: ByRole, of: (role: Role) => number) =>
  `${pc(r.tank, of("tank"))} / ${pc(r.healer, of("healer"))} / ${pc(r.dps, of("dps"))}`;

console.log(`threat report - ${samples} fights x ${content.listDungeons().length} dungeons per row`);
console.log("T / H / D in percent: hits, damage and heals are shares of the total; deaths are a rate within the role\n");
console.log("| setup | win | timer | hits T/H/D | dmg T/H/D | heals T/H/D | deaths T/H/D |");
console.log("|---|---|---|---|---|---|---|");

for (const setup of SETUPS) {
  const hits = zero();
  const dmg = zero();
  const heals = zero();
  const deaths = zero();
  const heads = zero();
  let fights = 0;
  let wins = 0;
  let timer = 0;
  const strength = referencePartyStrength(COMP, setup.level, content, setup.gear);
  for (const dungeon of content.listDungeons()) {
    const enemies = expandFight(dungeon, dungeon.id, dungeon.name, strength, content.balance.bandStatScale);
    if (enemies.length === 0) continue;
    for (let i = 0; i < samples; i += 1) {
      const rng = mulberry32(1 + i);
      const party = referenceParty(COMP, setup.level, content.balance, content, setup.gear, rng);
      const roleOf = new Map<string, Role>(party.map((c) => [c.id, c.role as Role]));
      const result = runCombat(party, enemies, content, content.balance, rng);
      fights += 1;
      if (result.outcome === "victory") wins += 1;
      for (const c of party) heads[roleOf.get(c.id)!] += 1;
      let lastTick = 0;
      const dead = new Set<string>();
      for (const e of result.events) {
        if (e.type === "tick") lastTick = e.n;
        else if (e.type === "attack" && roleOf.has(e.targetId)) {
          const r = roleOf.get(e.targetId)!;
          hits[r] += 1;
          dmg[r] += e.damage;
          if (e.targetHpAfter <= 0) dead.add(e.targetId);
        } else if (e.type === "heal" && roleOf.has(e.targetId)) {
          heals[roleOf.get(e.targetId)!] += 1;
        }
      }
      for (const id of dead) deaths[roleOf.get(id)!] += 1;
      const ceiling = Math.max(
        content.balance.combat.maxTicks,
        (party.length + enemies.length) * content.balance.combat.maxTicksPerCombatant,
      );
      if (lastTick >= ceiling) timer += 1;
    }
  }
  const share = (total: ByRole) => () => sum(total);
  console.log(
    `| ${setup.label} | ${pc(wins, fights)}% | ${pc(timer, fights)}% | ${triple(hits, share(hits))} | ${triple(dmg, share(dmg))} | ${triple(heals, share(heals))} | ${triple(deaths, (r) => heads[r])} |`,
  );
}
