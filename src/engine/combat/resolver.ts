import type {
  AbilityDefinition,
  Character,
  CombatEvent,
  CombatResult,
  CombatantSnapshot,
  EnemyDefinition,
  Role,
  Side,
  StatKey,
  Stats,
} from "../types.js";
import type { ContentRegistry } from "../content/loader.js";
import { partyScalingFor, type BalanceConfig } from "../balance.js";
import type { Rng } from "../rng.js";
import { pickWeighted, randomInt } from "../rng.js";
import { deriveCharacterStats, grantChest, grantXp } from "../character.js";
import { ROLE_PRIMARY_STAT } from "../stats.js";
import { rollAttack, rollHeal } from "./formulas.js";

interface ActiveBuff {
  stat: StatKey;
  amount: number;
  actionsLeft: number;
}

/** One unit's live state for the duration of a single fight. */
interface Runtime {
  id: string;
  name: string;
  side: Side;
  role?: Role;
  base: Stats;
  hp: number;
  maxHp: number;
  buffs: ActiveBuff[];
  /** How many actions this unit has taken — drives self-relative ability cooldowns. */
  actions: number;
  /** Running aggro; higher means enemies pick this unit more often. */
  aggro: number;
  /** Set for enemies, so ability/loot/reward lookups can find the source content. */
  def?: EnemyDefinition;
  /** Set for party members, so rewards can be written back to the real character. */
  character?: Character;
  usedThresholds: Set<string>;
  /** Ticks of taunt remaining. While above zero this unit's aggro is multiplied. */
  tauntTicks: number;
}

function currentStats(rt: Runtime): Stats {
  const stats = { ...rt.base };
  for (const buff of rt.buffs) stats[buff.stat] += buff.amount;
  return stats;
}

function tickBuffs(rt: Runtime): void {
  rt.buffs = rt.buffs.filter((b) => --b.actionsLeft > 0);
}

const alive = (rt: Runtime) => rt.hp > 0;

/**
 * Applies the population-based role rarity bonus (§2.5): a role that is
 * scarce in this party gets its primary stat boosted, one that is
 * oversaturated gets it trimmed. Same incentive shape as WoW's role queue —
 * it nudges viewers toward filling whatever the party is missing.
 */
function applyRoleRarity(members: { role: Role; stats: Stats }[], balance: BalanceConfig): void {
  if (members.length === 0) return;
  const { scarceBelowShare, crowdedAboveShare, scarceMultiplier, crowdedMultiplier } = balance.roleRarity;

  const counts: Record<Role, number> = { tank: 0, dps: 0, healer: 0 };
  for (const m of members) counts[m.role] += 1;

  for (const m of members) {
    const share = counts[m.role] / members.length;
    const multiplier = share < scarceBelowShare ? scarceMultiplier : share > crowdedAboveShare ? crowdedMultiplier : 1;
    if (multiplier === 1) continue;
    const stat = ROLE_PRIMARY_STAT[m.role];
    m.stats[stat] = m.stats[stat] * multiplier;
  }
}

/**
 * Picks one living unit from `pool`, weighted by `weightOf`. This is the
 * single primitive behind both act-selection (weighted by spd) and
 * targeting (weighted by aggro) — random at its core, biased by a stat.
 */
function pickWeightedUnit(pool: Runtime[], weightOf: (rt: Runtime) => number, rng: Rng): Runtime | undefined {
  const living = pool.filter(alive);
  if (living.length === 0) return undefined;
  const entries = living.map((rt) => ({ weight: Math.max(0.01, weightOf(rt)), value: rt }));
  return pickWeighted(entries, rng);
}

function readyAbility(rt: Runtime): AbilityDefinition | undefined {
  const abilities = rt.def?.abilities;
  if (!abilities) return undefined;
  for (const ability of abilities) {
    if (ability.trigger.type === "hpThreshold") {
      if (rt.usedThresholds.has(ability.id)) continue;
      if (rt.hp / rt.maxHp < ability.trigger.belowFraction) {
        rt.usedThresholds.add(ability.id);
        return ability;
      }
    } else if (rt.actions > 0 && rt.actions % ability.trigger.everyNActions === 0) {
      return ability;
    }
  }
  return undefined;
}

/**
 * Healer target priority — self, then Tank, then DPS, in that fixed order
 * (§2.3). Deliberately NOT random and NOT aggro-weighted: keeping the tank
 * standing is the whole job, and a healer that randomly tops off a healthy
 * DPS while the tank dies reads as broken to anyone watching.
 */
function pickHealTarget(healer: Runtime, allies: Runtime[], balance: BalanceConfig): Runtime | undefined {
  const hurt = (rt: Runtime) => alive(rt) && rt.hp / rt.maxHp < balance.healing.triggerBelowFraction;
  if (hurt(healer)) return healer;
  const byRole = (role: Role) =>
    allies
      .filter((rt) => rt.id !== healer.id && rt.role === role && hurt(rt))
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  return byRole("tank") ?? byRole("dps") ?? byRole("healer");
}

function applyDamage(target: Runtime, amount: number): void {
  target.hp = Math.max(0, target.hp - amount);
}

/**
 * Damage reduction from ROLES, on top of everyone's Skill mitigation.
 *
 * Two separate effects, both the tank's:
 *
 *  - A tank reduces damage aimed at ITSELF, scaling with its own skill — ON
 *    TOP OF the mitigation that same Skill already bought it. That double dip
 *    is the whole of what makes a Tank tankier than a Healer holding the same
 *    Skill, now that the base curve is shared by every role.
 *  - A tank reduces damage aimed at EVERY OTHER party member. That is the one
 *    that makes a tank worth bringing rather than merely hard to kill: without
 *    it a tank only absorbs the hits it personally attracts, and a party is
 *    better off with another dps.
 *
 * Only the single best living tank guards. Stacking five tanks' guards would
 * trivialise any fight and make an all-tank party optimal, which is the exact
 * opposite of wanting a full roster.
 */
function roleMitigation(target: Runtime, allies: Runtime[], balance: BalanceConfig): number {
  // Both sides. An encounter can now field a squad with its own tank (see
  // src/engine/squad.ts), and a tank that soaks for the party but not for its
  // own side would make enemy tanks decorative. `allies` is the target's own
  // side, so this needs no notion of which side that is.
  const { tank } = balance.roles;

  let reduction = 0;
  if (target.role === "tank") {
    reduction = Math.min(tank.maxSelfMitigation, currentStats(target).skill * tank.mitigationPerSkill);
  }

  const guards = allies.filter((rt) => rt.role === "tank" && rt.id !== target.id && alive(rt));
  if (guards.length > 0) {
    const best = Math.max(...guards.map((rt) => currentStats(rt).skill));
    reduction += Math.min(tank.maxGuard, best * tank.guardPerSkill);
  }

  // Two sources can add past the cap individually; clamp the total so a party
  // can never reach immunity by piling on skill.
  return Math.min(tank.maxSelfMitigation + tank.maxGuard, reduction);
}

/**
 * Folds role mitigation into an already-rolled hit.
 *
 * Reported as `mitigated` alongside the skill curve rather than silently reducing the
 * number, so the combat log stays honest: "hit for 8 (11 absorbed)" is the
 * tank's guard doing visible work, which is the whole point of bringing one.
 */
function withRoleMitigation(
  hit: { damage: number; mitigated: number; crit: boolean },
  target: Runtime,
  allies: Runtime[],
  balance: BalanceConfig,
): { damage: number; mitigated: number; crit: boolean } {
  const reduction = roleMitigation(target, allies, balance);
  if (reduction <= 0) return hit;
  const damage = Math.max(balance.combat.minDamage, Math.round(hit.damage * (1 - reduction)));
  return { damage, mitigated: hit.mitigated + (hit.damage - damage), crit: hit.crit };
}

/** Aggro weight for targeting, including an active taunt. */
function aggroWeight(rt: Runtime, balance: BalanceConfig): number {
  return rt.tauntTicks > 0 ? rt.aggro * balance.roles.tank.tauntAggroMultiplier : rt.aggro;
}

/**
 * Who this attack lands on.
 *
 * Usually aggro-weighted, but a fixed share of the time the attacker simply
 * picks someone — see focusBreakChance. Without it the threat order is decided
 * when the party forms and never changes, so a healer is structurally safe and
 * a tank is a wall rather than a gamble.
 */
function pickTarget(candidates: Runtime[], balance: BalanceConfig, rng: Rng): Runtime | undefined {
  if (rng() < balance.aggro.focusBreakChance) return pickWeightedUnit(candidates, () => 1, rng);
  return pickWeightedUnit(candidates, (rt) => aggroWeight(rt, balance), rng);
}

/**
 * Resolves an entire fight synchronously and returns the full event log.
 *
 * Resolution is RANDOM-TICK, not a turn queue (§2.3): each tick picks a
 * side at random, then a living unit from that side weighted by `spd`, and
 * resolves one action. Two consequences worth knowing:
 *
 *  - Cost does not grow with headcount the way an initiative queue does,
 *    so a party of thirty is no more expensive to resolve than a party of
 *    three.
 *  - Because the *side* coin-flip is even, total party actions per tick
 *    stay constant regardless of party size — which structurally damps the
 *    "an uncapped crowd trivializes a statically-statted boss" tension
 *    flagged in §2.4. A bigger party brings more total HP and more targets,
 *    but not proportionally more damage output.
 *
 * The fight is decided instantly here; the overlay replays `events` with
 * client-side pacing for the on-stream spectacle (see
 * web/src/hooks/useCombatPlayback.ts).
 */
export function runCombat(
  party: Character[],
  enemies: EnemyDefinition[],
  content: ContentRegistry,
  balance: BalanceConfig,
  rng: Rng,
  options: {
    scaleToPartySize?: boolean;
    /**
     * Flat stat bonuses applied to every party member — raid buffs picked up
     * from doors earlier in the run.
     *
     * Applied HERE rather than written onto the characters, because a raid buff
     * lasts the raid and not a moment longer. Mutating the character would make
     * it permanent and leak into the next dungeon; passing it into the fight
     * keeps its lifetime exactly the run that granted it.
     */
    partyBuffs?: Partial<Stats>;
    /** Multiplies the enemy side's stats — how a raid boss differs from the same encounter met in a dungeon. */
    enemyMultipliers?: { hp: number; atk: number };
    /**
     * The name of the place this fight happened, stamped onto any chest it
     * drops so the reveal can say where it came from.
     *
     * Passed in rather than derived: the resolver is handed bodies, not a
     * dungeon, and a raid room's fight has a name the enemies themselves do
     * not carry.
     */
    lootFrom?: string;
  } = {},
): CombatResult {
  const events: CombatEvent[] = [];

  // --- build the party side -------------------------------------------------
  const partyStats = party.map((c) => ({ role: c.role, stats: deriveCharacterStats(c, content) }));
  applyRoleRarity(partyStats, balance);

  const buffs = options.partyBuffs ?? {};
  const partyRt: Runtime[] = party.map((character, i) => {
    const base = partyStats[i]!.stats;
    const stats: Stats = {
      hp: base.hp + (buffs.hp ?? 0),
      atk: base.atk + (buffs.atk ?? 0),
      spd: base.spd + (buffs.spd ?? 0),
      skill: base.skill + (buffs.skill ?? 0),
      crit: base.crit + (buffs.crit ?? 0),
    };
    // A skilled healer acts MORE OFTEN, not just for more. Throughput is
    // actions x amount, and scaling only the amount left a healer's skill
    // nearly invisible in a fight that ends in thirty ticks.
    if (character.role === "healer") {
      const { spdPerSkill, maxSpdBonus } = balance.roles.healer;
      stats.spd += Math.min(maxSpdBonus, stats.skill * spdPerSkill);
    }
    return {
      id: character.id,
      name: character.name,
      side: "party",
      role: character.role,
      base: stats,
      hp: stats.hp,
      maxHp: stats.hp,
      buffs: [],
      actions: 0,
      // A tank's grip on the fight scales with Skill, capped. Everyone else
      // pulls their role's flat share.
      aggro:
        balance.aggro.base *
        balance.aggro.roleMultiplier[character.role] *
        (character.role === "tank"
          ? 1 +
            Math.min(
              balance.roles.tank.maxAggroFromSkill,
              stats.skill * balance.roles.tank.aggroPerSkill,
            )
          : 1),
      character,
      usedThresholds: new Set(),
      tauntTicks: 0,
    };
  });

  // --- build the enemy side -------------------------------------------------
  // Several copies of one encounter are several combatants; the id gets an
  // instance suffix so three rats are individually targetable and killable.
  //
  // Enemy stats are scaled to the party that actually turned up unless the
  // dungeon opts out — an encounter authored for five people is a formality
  // for twenty-five otherwise. See balance.ts partyScaling for why hp and
  // atk scale at very different rates.
  const partyScale = options.scaleToPartySize === false ? { hp: 1, atk: 1 } : partyScalingFor(party.length, balance);
  // A boss multiplier stacks ON TOP of party scaling rather than replacing it:
  // the multiplier says "this is the raid version of that enemy", party scaling
  // says "and there are twenty-five of you". Both are true at once.
  const boss = options.enemyMultipliers ?? { hp: 1, atk: 1 };
  const scale = { hp: partyScale.hp * boss.hp, atk: partyScale.atk * boss.atk };
  const seen = new Map<string, number>();
  const enemyRt: Runtime[] = enemies.map((def) => {
    const n = (seen.get(def.id) ?? 0) + 1;
    seen.set(def.id, n);
    const scaledHp = Math.round(def.stats.hp * scale.hp);
    const stats: Stats = { ...def.stats, hp: scaledHp, atk: def.stats.atk * scale.atk };
    return {
      id: `${def.id}#${n}`,
      name: enemies.filter((e) => e.id === def.id).length > 1 ? `${def.name} ${n}` : def.name,
      side: "enemy",
      role: def.role,
      base: stats,
      hp: scaledHp,
      maxHp: scaledHp,
      buffs: [],
      actions: 0,
      // Role-weighted like the party's, so an enemy tank actually draws the
      // party's fire instead of standing there being hard to kill while the
      // party shoots past it at the healer.
      aggro: balance.aggro.base * (def.role ? balance.aggro.roleMultiplier[def.role] : 1),
      def,
      usedThresholds: new Set(),
      tauntTicks: 0,
    };
  });

  const combatants: CombatantSnapshot[] = [
    ...partyRt.map((rt, i) => ({
      id: rt.id,
      name: rt.name,
      side: "party" as const,
      role: rt.role,
      level: party[i]!.level,
      maxHp: rt.maxHp,
      stats: rt.base,
      appearance: party[i]!.appearance,
    })),
    ...enemyRt.map((rt) => ({
      id: rt.id,
      name: rt.name,
      side: "enemy" as const,
      role: rt.role,
      kind: rt.def!.kind,
      maxHp: rt.maxHp,
      stats: rt.base,
    })),
  ];

  // --- the tick loop --------------------------------------------------------
  //
  // The ceiling scales with how many bodies are in the fight. A tick is ONE
  // actor acting, so a flat cap is an action budget divided by turnout: at 400
  // ticks a fight of fifty-six gave everyone seven swings, and every
  // forty-player run hit the cap with thirteen enemies still up and was scored
  // a defeat. A stream that grows could not finish a fight.
  const tickCeiling = Math.max(
    balance.combat.maxTicks,
    (partyRt.length + enemyRt.length) * balance.combat.maxTicksPerCombatant,
  );
  let tick = 0;
  while (partyRt.some(alive) && enemyRt.some(alive) && tick < tickCeiling) {
    tick += 1;
    events.push({ type: "tick", n: tick });

    // A taunt is measured in ticks, so it decays on the clock rather than on
    // the tank's own actions - otherwise a slow tank's taunt would outlast a
    // fast one's for the same nominal duration.
    for (const rt of partyRt) if (rt.tauntTicks > 0) rt.tauntTicks -= 1;

    // INITIATIVE IS GLOBAL, not a coin flip between the two sides.
    //
    // It used to pick a side 50/50 and then a unit from it, which meant the
    // party's total output was CONSTANT no matter how many people turned up:
    // twenty-five players acted exactly as often as five, and the only effect
    // of a bigger raid was spreading incoming damage thinner. There was no
    // benefit to a full roster because the maths forbade one.
    //
    // Drawing from every living combatant at once makes headcount matter the
    // way it should — more bodies means more actions per tick — and party
    // scaling (see partyScalingFor) is what keeps that from trivialising an
    // encounter authored for five.
    const actor = pickWeightedUnit(
      [...partyRt, ...enemyRt],
      (rt) => currentStats(rt).spd * (rt.def?.initiativeWeight ?? 1),
      rng,
    );
    if (!actor) continue;
    const actingSide = actor.side === "party" ? partyRt : enemyRt;
    const opposing = actor.side === "party" ? enemyRt : partyRt;

    actor.actions += 1;
    const actorStats = currentStats(actor);

    // 1. Healers heal before anything else, if anyone needs it.
    if (actor.role === "healer") {
      const target = pickHealTarget(actor, actingSide, balance);
      if (target) {
        const { tankHealMultiplier, selfHealMultiplier } = balance.roles.healer;
        // A healer heals a tank for more, and itself for less. The self
        // penalty is what stops a lone healer out-healing one weak enemy
        // forever and running the fight into maxTicks.
        const roleFactor =
          target.id === actor.id ? selfHealMultiplier : target.role === "tank" ? tankHealMultiplier : 1;
        const amount = Math.max(1, Math.round(rollHeal(actorStats, balance, rng) * roleFactor));
        target.hp = Math.min(target.maxHp, target.hp + amount);
        events.push({ type: "heal", actorId: actor.id, targetId: target.id, amount, targetHpAfter: target.hp });
        tickBuffs(actor);
        continue;
      }
    }

    // 2. A tank taunts every Nth action instead of attacking. Spending the
    //    action is the cost that stops taunt being free — a taunting tank is
    //    not dealing damage that turn.
    if (actor.role === "tank" && actor.actions % balance.roles.tank.tauntEveryNActions === 0) {
      actor.tauntTicks = balance.roles.tank.tauntTicks;
      events.push({
        type: "ability",
        actorId: actor.id,
        abilityId: "taunt",
        abilityName: "Taunt",
        detail: `${actor.name} roars.`,
      });
      tickBuffs(actor);
      continue;
    }

    // 3. Otherwise fire a ready ability (enemies/bosses only for now).
    const ability = readyAbility(actor);
    if (ability) {
      const effect = ability.effect;
      if (effect.type === "heal") {
        actor.hp = Math.min(actor.maxHp, actor.hp + effect.amount);
        events.push({
          type: "ability",
          actorId: actor.id,
          abilityId: ability.id,
          abilityName: ability.name,
          detail: `${ability.name} heals for ${effect.amount}.`,
        });
        events.push({ type: "heal", actorId: actor.id, targetId: actor.id, amount: effect.amount, targetHpAfter: actor.hp });
        tickBuffs(actor);
        continue;
      }
      if (effect.type === "buff") {
        actor.buffs.push({ stat: effect.stat, amount: effect.amount, actionsLeft: effect.durationActions });
        events.push({
          type: "ability",
          actorId: actor.id,
          abilityId: ability.id,
          abilityName: ability.name,
          detail: `${ability.name}: ${effect.stat} ${effect.amount >= 0 ? "+" : ""}${effect.amount} for ${effect.durationActions} actions.`,
        });
        tickBuffs(actor);
        continue;
      }
      // bonusDamage falls through to a normal attack with a boosted atk.
      const target = pickTarget(opposing, balance, rng);
      if (!target) continue;
      const boosted = { ...actorStats, atk: actorStats.atk * effect.multiplier };
      const raw = rollAttack(boosted, currentStats(target), balance, rng);
      const hit = withRoleMitigation(raw, target, opposing, balance);
      applyDamage(target, hit.damage);
      actor.aggro += hit.damage * balance.aggro.perDamageDealt;
      events.push({
        type: "ability",
        actorId: actor.id,
        abilityId: ability.id,
        abilityName: ability.name,
        detail: `${ability.name} hits for ${hit.damage}${hit.crit ? " (CRIT!)" : ""}!`,
      });
      events.push({
        type: "attack",
        actorId: actor.id,
        targetId: target.id,
        damage: hit.damage,
        mitigated: hit.mitigated,
        crit: hit.crit,
        targetHpAfter: target.hp,
      });
      if (!alive(target)) events.push({ type: "down", combatantId: target.id });
      tickBuffs(actor);
      continue;
    }

    // 3. Plain attack, target chosen randomly but weighted by aggro — this
    //    is what makes a tank actually shield the party (§2.3).
    const target = pickTarget(opposing, balance, rng);
    if (!target) continue;
    const raw = rollAttack(actorStats, currentStats(target), balance, rng);
    const hit = withRoleMitigation(raw, target, opposing, balance);
    applyDamage(target, hit.damage);
    actor.aggro += hit.damage * balance.aggro.perDamageDealt;
    events.push({
      type: "attack",
      actorId: actor.id,
      targetId: target.id,
      damage: hit.damage,
      mitigated: hit.mitigated,
      crit: hit.crit,
      targetHpAfter: target.hp,
    });
    if (!alive(target)) events.push({ type: "down", combatantId: target.id });
    tickBuffs(actor);
  }

  // --- outcome + rewards ----------------------------------------------------
  const survivors = partyRt.filter(alive);
  const outcome = enemyRt.every((rt) => !alive(rt)) && survivors.length > 0 ? "victory" : "defeat";
  events.push({ type: "outcome", outcome });

  {
    const totalXp = enemies.reduce((sum, def) => sum + def.xpReward, 0);
    const won = outcome === "victory";

    for (const rt of partyRt) {
      const character = rt.character!;
      const isSurvivor = alive(rt);

      // Loot rolls independently per participant (§2.7) — survivors only.
      // One roll per participant against the run's combined table, NOT one
      // per enemy: a five-person party clearing three mobs would otherwise
      // walk out with ~nine items and flood the economy.
      // The fallen roll too, at a fraction of the chance. Turning up and dying
      // early should not be worth literally nothing — that is the difference
      // between a newcomer who keeps joining and one who works out that a party
      // stronger than them is a waste of their evening.
      //
      // A LOST fight rolls too, at the smallest chance of the three. It used
      // to drop nothing; see `defeatLootChance` for why that changed.
      //
      // The chance is only drawn when it is needed, so a survivor consumes no
      // random number here and every seeded fight that is WON plays out
      // exactly as it did before a loss could drop anything.
      const lootChance = won
        ? isSurvivor
          ? 1
          : balance.rewards.casualtyLootChance
        : balance.rewards.defeatLootChance;
      if (lootChance >= 1 || rng() < lootChance) {
        const gearId = rollLoot(enemies, content, balance, rng);
        if (gearId) {
          // SEALED, not dropped straight into the bag. The roll happens here
          // and is final; what is deferred is the player seeing it, which
          // happens on their own screen when they open the chest. See
          // SealedChest — the overlay still announces that something dropped,
          // it just no longer says what.
          grantChest(character, gearId, options.lootFrom);
          events.push({ type: "loot", characterId: character.id, gearId, gearName: content.getGear(gearId).name });
        }
      }

      /*
       * Three ways to be paid, and losing is one of them.
       *
       * This block used to sit entirely inside `if (outcome === "victory")`, so
       * a wipe paid nothing whatsoever: thirty people typed !join, watched a
       * fight for two minutes and the game gave them no reason to do it again.
       * That is the exact failure §4 argues against for casualties — "a viewer
       * who joined, died in turn two and got nothing has learned not to join" —
       * and a wipe is that same viewer's experience, multiplied by the whole
       * chat, on the night the streamer picks a dungeon one rung too high.
       *
       * The consolation is small (`defeatXpMultiplier`, and a slim loot roll
       * above). Losing has to stay clearly worse than winning or the choice of
       * what to open stops mattering; it just should not be worth *nothing*.
       */
      const share = won ? (isSurvivor ? 1 : balance.rewards.casualtyXpMultiplier) : balance.rewards.defeatXpMultiplier;
      // xpRate: see balance.ts. Levels outran gear by an order of magnitude.
      const xp = Math.round(totalXp * share * balance.progression.xpRate);
      // Gold is looting the bodies. There are no bodies if you lost.
      const gold =
        won && isSurvivor
          ? enemies.reduce((sum, def) => sum + randomInt(def.goldReward[0], def.goldReward[1], rng), 0)
          : 0;

      character.gold += gold;
      const levelsGained = grantXp(character, xp, balance);
      events.push({ type: "reward", characterId: character.id, xp, gold });
      for (const level of levelsGained) {
        events.push({ type: "levelUp", characterId: character.id, newLevel: level });
      }
    }
  }

  return {
    outcome,
    combatants,
    events,
    survivorIds: survivors.map((rt) => rt.id),
  };
}

/**
 * One loot roll against every defeated enemy's table merged together. A
 * boss anywhere in the run guarantees a drop; otherwise the configured mob
 * drop chance applies once.
 */
function rollLoot(enemies: EnemyDefinition[], content: ContentRegistry, balance: BalanceConfig, rng: Rng): string | undefined {
  // A disabled item stays in the encounter's loot table but stops dropping —
  // same reasoning as the shop: turning it off must not edit the content that
  // references it.
  const table = enemies.flatMap((def) => def.loot).filter((l) => content.getGear(l.gearId).enabled !== false);
  if (table.length === 0) return undefined;
  const dropChance = enemies.some((def) => def.kind === "boss") ? 1 : balance.rewards.mobDropChance;
  if (rng() >= dropChance) return undefined;
  const gearId = pickWeighted(table.map((l) => ({ weight: l.weight, value: l.gearId })), rng);
  content.getGear(gearId); // throws if content is inconsistent — fail loud rather than hand out a ghost item
  return gearId;
}
