import type { Role } from "../../../src/engine/types.js";
import type { BalanceConfig } from "../../../src/engine/balance.js";
import { text, format } from "../../../src/text/index.js";

export interface RoleGuideProps {
  role: Role;
  balance: BalanceConfig;
}

/** A fraction as a whole-number percentage: 0.012 -> "1.2", 0.22 -> "22". */
function pc(fraction: number): string {
  const n = fraction * 100;
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

/** A plain number, without a trailing ".0": 0.5 -> "0.5", 3 -> "3". */
function mult(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * A multiplier as the bonus it is: 1.6 -> "60" (per cent more), 1.15 -> "15".
 *
 * Nobody reads "1.15x". It is engine notation that leaked onto a tooltip, and
 * a player asking "is this worth it" has to do arithmetic to find out that the
 * answer is fifteen per cent.
 */
function bonusPc(multiplier: number): string {
  return String(Math.round((multiplier - 1) * 100));
}

/** The other direction: 0.4 -> "60" (per cent less). */
function penaltyPc(multiplier: number): string {
  return String(Math.round((1 - multiplier) * 100));
}

interface Row {
  label: string;
  value: string;
}

/**
 * What this role does, as a tooltip: one line of voice, then the numbers.
 *
 * It used to be six paragraphs per role explaining the combat model. All of it
 * was true and nobody was going to read it on a character screen — a player
 * picking a role wants to know what their points buy, which is a label and a
 * number.
 *
 * EVERY ROW HAS TO BE SOMETHING THE PLAYER CAN MOVE. That is the rule this
 * screen kept breaking:
 *
 *   - Crit was a row. Crit is off gear and off allocation by design (see
 *     GearStat) — it is a constant handed to you with your role, so a player
 *     could read that row every day of their life and never change it.
 *   - "Armour" was a row. Armour was deleted as a stat and Skill absorbed its
 *     job; putting the name back on Skill's mitigation undoes that decision in
 *     the one place a player would learn the game from.
 *   - Threat showed the flat 6x and stopped there, so it looked like a
 *     constant. It is not: Skill adds to it, capped, and Skill is both
 *     allocatable and on gear.
 *
 * The numbers are READ FROM `content/balance.json` rather than typed into the
 * copy: retune `mitigationPerSkill` and this table retunes with it. A tooltip
 * that restates a tunable number is one edit away from lying to the player.
 *
 * The strings themselves live in src/text/en.ts like all other copy
 * (AGENTS.md §8) — only the arithmetic is here.
 */
export function RoleGuide({ role, balance }: RoleGuideProps): JSX.Element {
  const guide = text.loadout.roleGuide;
  const L = guide.labels;
  const { tank, healer } = balance.roles;
  const { aggro, healing, combat, roleRarity } = balance;

  let rows: Row[];
  let note: string;

  if (role === "tank") {
    rows = [
      {
        label: L.skill,
        value: format(guide.tank.skill, {
          perPoint: pc(tank.mitigationPerSkill),
          cap: pc(tank.maxSelfMitigation),
        }),
      },
      {
        label: L.guard,
        value: format(guide.tank.guard, {
          perPoint: pc(tank.guardPerSkill),
          cap: pc(tank.maxGuard),
        }),
      },
      {
        label: L.threat,
        value: format(guide.tank.threat, {
          base: String(aggro.roleMultiplier.tank),
          perPoint: pc(tank.aggroPerSkill),
          cap: pc(tank.maxAggroFromSkill),
        }),
      },
      {
        label: L.healed,
        value: format(guide.tank.healed, { more: bonusPc(healer.tankHealMultiplier) }),
      },
    ];
    note = format(guide.tank.note, { chance: pc(aggro.focusBreakChance) });
  } else if (role === "healer") {
    rows = [
      {
        label: L.heal,
        value: format(guide.healer.heal, {
          base: String(healing.base),
          perPoint: mult(healing.perSkillPoint),
          below: pc(healing.triggerBelowFraction),
        }),
      },
      {
        label: L.speed,
        value: format(guide.healer.speed, {
          perPoint: mult(healer.spdPerSkill),
          cap: mult(healer.maxSpdBonus),
        }),
      },
      {
        label: L.targets,
        value: format(guide.healer.targets, {
          tankMore: bonusPc(healer.tankHealMultiplier),
          selfLess: penaltyPc(healer.selfHealMultiplier),
        }),
      },
    ];
    note = guide.healer.note;
  } else {
    rows = [
      { label: L.damage, value: guide.dps.damage },
      { label: L.speed, value: guide.dps.speed },
      { label: L.skill, value: format(guide.dps.skill, { k: String(combat.skillCurveK) }) },
    ];
    note = guide.dps.note;
  }

  // True for all three, so it sits under the table rather than inside it — it
  // is a rule about the party, not one of this role's own numbers.
  const rarity = format(guide.everyone.rarity, {
    scarceBonus: bonusPc(roleRarity.scarceMultiplier),
    scarceBelow: pc(roleRarity.scarceBelowShare),
  });

  return (
    <div className="role-guide">
      <h3>{format(guide.heading, { role: text.role[role], wants: guide[role].wants })}</h3>
      <p className="role-flavour">{guide[role].flavour}</p>
      <dl className="role-stats">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="role-note">{note}</p>}
      <p className="role-rarity">{rarity}</p>
    </div>
  );
}
