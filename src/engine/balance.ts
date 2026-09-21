import type { AllocatableStat, PartyBand, Rarity, Role } from "./types.js";

/**
 * Every balance knob in the game, in one place, loaded from
 * content/balance.json so tuning a fight is a JSON edit + server restart
 * rather than a code change.
 *
 * AGENTS.md §8 is explicit that the *numbers* here — aggro strength, heal
 * power, role population bonuses, the mitigation curve constant — are all
 * unresolved design questions. Nothing below is a considered balance
 * decision; they are deliberately-placeholder starting values chosen to
 * produce a fight that reads well on stream (roughly 20-40 ticks, visible
 * healing, tanks visibly eating most of the damage). Tune freely.
 */
export interface BalanceConfig {
  /**
   * Multiplier on every enemy's hp and atk, by the band the PARTY landed in.
   *
   * See BandStatScale in src/engine/squad.ts for why the band system does not
   * work without it: count, roles and initiative together cannot span a range
   * whose top rung is a level-200 party in the best gear in the game.
   *
   * Solved by measurement, not chosen — `npx tsx scripts/author-bands.ts`
   * re-solves it. Re-run that after touching the stat scale, the gear
   * catalogue or the progression curve.
   */
  bandStatScale: Record<PartyBand, number>;

  combat: {
    /**
     * Curve constant K in `mitigation = skill / (skill + K)`.
     * Lower K = Skill is stronger. At K=10: 5 Skill -> 33% reduction,
     * 50 -> 50%, 100 -> 67%. Chosen over flat subtraction because flat
     * negation degenerates once the rating >= incoming damage (every hit floors
     * at minDamage and mitigation becomes either useless or absolute with no
     * middle ground). See combat/formulas.ts.
     */
    skillCurveK: number;
    /** Hard ceiling on damage reduction, so nothing is ever unkillable. */
    maxMitigation: number;
    /**
     * Per-hit damage roll spread, as a fraction either side of the base.
     * 0.2 = damage lands somewhere in 80%-120% of nominal. This exists
     * specifically so the combat log doesn't read "hits for 5" five times
     * in a row — with always-hit combat, variance is what makes the log
     * feel alive. Set to 0 for deterministic damage.
     */
    damageVariance: number;
    /** Multiplier applied to a critical hit's damage. */
    critMultiplier: number;
    /** Damage floor — a hit never does less than this, so fights always progress. */
    minDamage: number;
    /** Safety valve: a fight is called a draw-by-timeout past this many ticks. */
    maxTicks: number;
    /**
     * The safety valve, per body in the fight.
     *
     * A tick is ONE actor acting (global initiative draws one combatant from
     * the whole pool), so a flat ceiling is a budget of actions divided by how
     * many people turned up. At 400 ticks a fight of 56 — forty viewers against
     * sixteen enemies — gave everyone about seven swings, which is not enough
     * to resolve anything: measured, 100% of forty-player runs hit the cap with
     * thirteen enemies still standing and were scored a DEFEAT. A popular
     * stream could not finish a fight.
     *
     * The real ceiling is therefore `max(maxTicks, combatants × this)`. It is
     * still a safety valve — it exists to stop a heal-lock running forever, not
     * to decide how long a fight is — so it is generous.
     */
    maxTicksPerCombatant: number;
  };

  aggro: {
    /** Every party member starts with this much aggro, so targeting is never divide-by-zero. */
    base: number;
    /**
     * Aggro multiplier by role. Targeting is random but weighted by these —
     * a tank at 6x is picked ~6x as often as a dps at 1x, which is the whole
     * mechanism by which tanks shield squishier party members (§2.3).
     */
    roleMultiplier: Record<Role, number>;
    /** Extra aggro a unit accrues per point of damage it deals, so active damage draws attention. */
    perDamageDealt: number;
    /**
     * Chance an attack ignores aggro entirely and picks at random.
     *
     * The knob that stops tanking being a solved problem. Weighted targeting
     * alone means the party's threat order is fixed the moment it forms: the
     * tank eats a predictable share, the healer is safe behind the smallest
     * weight in the table, and no fight ever surprises anyone. A flat chance to
     * break focus puts every member genuinely in reach — the healer takes real
     * hits, the tank cannot promise to absorb everything — while leaving the
     * tank the majority of the attention it is built for.
     */
    focusBreakChance: number;
  };

  healing: {
    /** A healer only acts if someone is below this fraction of max HP; otherwise it attacks. */
    triggerBelowFraction: number;
    /** Flat heal amount before the skill scaling below. */
    base: number;
    /** Additional healing per point of the healer's `skill` stat. */
    perSkillPoint: number;
  };

  /**
   * What each role actually DOES beyond its stat block.
   *
   * The stat spread alone made the three roles differ only in numbers: a tank
   * was a dps with more HP. These are the mechanics that make a party want one
   * of each — a tank that protects other people, and a healer whose value goes
   * up when there is a tank to keep alive.
   */
  roles: {
    tank: {
      /**
       * Damage reduction on the TANK ITSELF, per point of skill, on top of
       * the shared curve. Skill is the tank's scaling stat the way it is the
       * healer's, and this is the part only a tank gets.
       */
      mitigationPerSkill: number;
      maxSelfMitigation: number;
      /**
       * Damage reduction the tank grants EVERY OTHER party member, per point
       * of its skill. This is the one that makes a tank worth bringing rather
       * than just hard to kill: it is the difference between "absorbs hits
       * aimed at it" and "protects the party".
       *
       * Only the single best living tank's guard applies — stacking guards
       * from five tanks would trivialise any fight and reward an all-tank
       * party, which is the opposite of wanting a full roster.
       */
      guardPerSkill: number;
      maxGuard: number;
      /** A tank taunts every Nth action instead of attacking. */
      tauntEveryNActions: number;
      /** How many ticks a taunt holds enemy attention. */
      tauntTicks: number;
      /** Aggro multiplier while taunting, on top of the role multiplier. */
      tauntAggroMultiplier: number;
    /**
     * Extra aggro per point of Skill, as a fraction of the tank's base pull.
     *
     * Skill is the tank's stat everywhere else — it drives self-mitigation and
     * the guard the party gets — and holding a mob's attention is the third
     * part of the same job. Without this a tank pulls the same share whether it
     * has spent everything on Skill or nothing, so the stat that is supposed to
     * define the role had no effect on the most visible thing the role does.
     */
    aggroPerSkill: number;
    /** Ceiling on that bonus, so a Skill stack cannot make a tank untargetable-adjacent. */
    maxAggroFromSkill: number;
    };
    healer: {
      /**
       * Speed granted per point of skill — a skilled healer acts MORE OFTEN,
       * not just for more. Healing throughput is actions x amount, and scaling
       * only the amount made a healer's skill invisible in a fast fight.
       */
      spdPerSkill: number;
      maxSpdBonus: number;
      /** Healing on a tank is multiplied by this. */
      tankHealMultiplier: number;
      /**
       * Healing on SELF is multiplied by this — deliberately below 1.
       *
       * Without it a healer alone against one weak enemy simply never dies:
       * it out-heals the incoming damage forever and the fight hits maxTicks.
       * A healer should keep a party alive, not be unkillable on its own.
       */
      selfHealMultiplier: number;
    };
  };

  /**
   * Population-based role rarity (§2.5): an underpopulated role gets a
   * bonus, an oversaturated one a debuff — the same incentive trick WoW's
   * role queue uses. Applied as a multiplier on the role's primary stat.
   */
  roleRarity: {
    /** Below this share of the party, a role counts as underpopulated. */
    scarceBelowShare: number;
    /** Above this share, a role counts as oversaturated. */
    crowdedAboveShare: number;
    /** Primary-stat multiplier when scarce / when crowded. */
    scarceMultiplier: number;
    crowdedMultiplier: number;
  };

  /**
   * Scales enemies to the size of the party that turned up (AGENTS.md §2.4
   * flagged the uncapped-crowd problem and listed this as one mitigation).
   *
   * The coefficients are lopsided on purpose, and the reason is specific to
   * this resolver: side selection is an even coin-flip, so the party's
   * damage output *per tick* is constant no matter how many people are in
   * it (see runCombat). That has two consequences:
   *
   *  - Scaling enemy **hp** with party size does NOT make the fight harder,
   *    it makes it LONGER — time-to-kill is enemyHp / party-damage-per-tick,
   *    and the denominator doesn't move. A big multiplier here just drags
   *    the replay out on stream.
   *  - Scaling enemy **atk** is what actually restores danger, because the
   *    thing that grows with party size is the party's total HP pool, and
   *    incoming damage per tick is what eats it.
   *
   * So atk carries most of the scaling and hp gets a light touch for
   * texture. Both are capped so a raid-sized crowd can't create a boss with
   * absurd numbers.
   */
  partyScaling: {
    /** Party size the encounter's authored stats are balanced for. No scaling at or below this. */
    baselinePartySize: number;
    /** Added to the hp multiplier per party member above the baseline. */
    hpPerExtraMember: number;
    /**
     * Added to the atk multiplier every time the party DOUBLES — NOT per head.
     *
     * This replaced a per-head `atkPerExtraMember`, and the replacement is the
     * point rather than a retune. Linear-per-head is what made the top of the
     * ladder unreachable: at 0.24 a party of twenty-five faced 5.8x attack
     * while their own HP had not moved at all, so they were one-shot before
     * they swung. Woop Woop read 0-7% at EVERY headcount from five to thirty
     * and Ladies of The Knight never won at all. The fights were not too big —
     * the multiplier was.
     *
     * Sub-linear is the same shape `crowdFactor` already uses for the band,
     * and for the same reason: doubling a crowd is a fixed step, not a
     * proportional one. Measured across the ladder (7 curves x 3 dungeons x 10
     * headcounts), 0.65 is where the top two dungeons gain a real turnout
     * curve without the top end flattening to a guaranteed win, which is what
     * 0.45 did.
     *
     * If you put a per-head number here by muscle memory the game will get
     * very easy very quietly: 0.65 PER DOUBLING is ~2.9x at forty players,
     * where 0.65 per head would have been capped at 6x by twelve.
     */
    atkPerDoubling: number;
    /** Ceiling on both multipliers, for very large parties. */
    maxMultiplier: number;
    /**
     * Floor on both multipliers, for parties SMALLER than the baseline.
     * Scaling runs in both directions on purpose: without this, one viewer
     * redeeming a dungeon built for five is a guaranteed wipe, which makes
     * the feature unusable on a quiet stream.
     */
    minMultiplier: number;
  };

  /**
   * Levelling. Points are spent by the player on the loadout screen (§2.2) —
   * nothing grows automatically, so these numbers are the entire progression
   * curve alongside xpToNextLevel().
   */
  progression: {
    /** Points granted per level gained. */
    pointsPerLevel: number;
    /** How much one spent point adds to each stat. */
    perPoint: Record<AllocatableStat, number>;
  };

  /**
   * Gold economy. In-game gold only — deliberately unrelated to any
   * real-money Twitch cost (§2.7), which v1 doesn't have at all.
   */
  economy: {
    /**
     * Fraction of an item's value returned when recycling it.
     *
     * 1 DURING ALPHA — a full refund, deliberately. This was 0.4, and the
     * argument for a fraction is real: at full price, buying and re-selling is
     * a no-op, so a gear decision costs nothing and carries no weight.
     *
     * That is the right tension for a live game and the wrong one for testing.
     * A tester who loses 60% every time they try an item stops trying items,
     * and trying items is the entire thing being tested. Put it back under 1
     * when the loop is being balanced rather than exercised.
     *
     * It does not open a gold loop: the shop sells at `gearValue` and recycling
     * pays `gearValue * rate`, so at 1 the round trip is exactly break-even.
     * (The loop to watch for is the one named in content/shop.json: a
     * grantGold consumable priced below its own payout.)
     */
    recycleRate: number;
    /** Default gold value per rarity, used when a gear item doesn't set its own `value`. */
    valueByRarity: Record<Rarity, number>;
    /**
     * Gold a character is created with.
     *
     * Enough for two or three of the cheapest items, which is the point: a new
     * player arrives with something to spend and a reason to open the shop,
     * rather than an empty purse and a wall of prices they cannot reach. The
     * shop's commons are 20 each, so this buys three of them.
     */
    startingGold: number;
  };

  rewards: {
    /** Drop chance for a mob's loot table. Bosses always drop. */
    mobDropChance: number;
    /** Casualties keep XP but forfeit gear (§2.1) — this scales the XP they keep. */
    /**
     * Share of XP a casualty still earns.
     *
     * Was 1 — dying cost nothing — and is now 0.4, which makes surviving worth
     * something without making death a wasted evening. This is the number that
     * decides whether a newcomer who joins a party far above their weight can
     * climb: they will die in the first ten ticks either way, and the question
     * is only whether they get anything for turning up.
     */
    casualtyXpMultiplier: number;
    /** Chance a casualty still takes something home. Small, deliberately. */
    casualtyLootChance: number;
    /**
     * Share of XP the whole party earns from a fight it LOST.
     *
     * Not a consolation prize so much as a floor under the worst night the game
     * can give a chat. Every reward used to sit inside a victory check, so a
     * wipe paid nothing at all — measured: twenty viewers, one Marketgate run
     * above their weight, 0 xp / 0 gold / 0 items between them. §4 already
     * argues the case for casualties ("a viewer who joined, died in turn two
     * and got nothing has learned not to join"); a wipe is that, for everyone,
     * on the night the streamer picks one rung too high.
     *
     * No gold and no loot on a loss — those are for clearing the room. Keep
     * this well under `casualtyXpMultiplier` so winning stays the point.
     */
    defeatXpMultiplier: number;
    /**
     * Extra XP for the whole party when the roles cover each other, at most.
     *
     * Paid rather than mandated. A party that brings a tank and a healer has a
     * better night anyway; this makes it worth SAYING so, which is what nudges
     * a chat toward filling the roles nobody volunteers for.
     */
    compositionBonusMax: number;
  };
}

/**
 * Fallback used if content/balance.json is missing. Keeping a complete
 * default in code means the engine still boots (and tests still run) with
 * no content directory at all, matching how the rest of the content system
 * fails: loudly on malformed data, gracefully on absent optional data.
 */
export const DEFAULT_BALANCE: BalanceConfig = {
  // Identity by default: a build that has not solved these behaves exactly as
  // it did before bands could scale a body, rather than silently retuning
  // every fight in the game on upgrade.
  bandStatScale: { weak: 1, seasoned: 1, elite: 1, brutal: 1, infernal: 1, apocalyptic: 1 },

  combat: {
    skillCurveK: 10,
    maxMitigation: 0.75,
    damageVariance: 0.2,
    critMultiplier: 1.8,
    minDamage: 1,
    maxTicks: 400,
    maxTicksPerCombatant: 20,
  },
  aggro: {
    base: 10,
    roleMultiplier: { tank: 6, dps: 1, healer: 0.6 },
    perDamageDealt: 0.08,
    focusBreakChance: 0.22,
  },
  healing: {
    triggerBelowFraction: 0.7,
    base: 2,
    perSkillPoint: 0.5,
  },
  roles: {
    tank: {
      mitigationPerSkill: 0.012,
      maxSelfMitigation: 0.4,
      guardPerSkill: 0.01,
      maxGuard: 0.35,
      tauntEveryNActions: 3,
      tauntTicks: 6,
      tauntAggroMultiplier: 4,
      aggroPerSkill: 0.03,
      maxAggroFromSkill: 1.5,
    },
    healer: {
      spdPerSkill: 0.15,
      maxSpdBonus: 3,
      tankHealMultiplier: 1.6,
      selfHealMultiplier: 0.4,
    },
  },
  roleRarity: {
    scarceBelowShare: 0.2,
    crowdedAboveShare: 0.5,
    scarceMultiplier: 1.15,
    crowdedMultiplier: 0.92,
  },
  partyScaling: {
    baselinePartySize: 5,
    hpPerExtraMember: 0.02,
    atkPerDoubling: 0.65,
    maxMultiplier: 6,
    minMultiplier: 0.4,
  },
  progression: {
    pointsPerLevel: 2,
    perPoint: { hp: 2, atk: 1, skill: 1, spd: 1 },
  },
  economy: {
    recycleRate: 1,
    valueByRarity: { common: 20, uncommon: 45, rare: 110, epic: 260, legendary: 600 },
    startingGold: 60,
  },
  rewards: {
    mobDropChance: 0.6,
    casualtyXpMultiplier: 0.4,
    casualtyLootChance: 0.15,
    defeatXpMultiplier: 0.15,
    compositionBonusMax: 0.25,
  },
};

/**
 * Enemy stat multipliers for a party of `partySize`. See
 * BalanceConfig.partyScaling. `delta` is signed, so a party below the
 * baseline gets weaker enemies and one above gets stronger ones.
 */
export function partyScalingFor(partySize: number, balance: BalanceConfig): { hp: number; atk: number } {
  const { baselinePartySize, hpPerExtraMember, atkPerDoubling, maxMultiplier, minMultiplier } = balance.partyScaling;
  const delta = partySize - baselinePartySize;
  if (delta === 0) return { hp: 1, atk: 1 };
  const clamp = (v: number) => Math.max(minMultiplier, Math.min(maxMultiplier, v));
  // HP stays LINEAR. It was never the problem: at 0.05 a party of twenty-five
  // meets 2.0x hp, which is a longer fight rather than a lethal one. Attack is
  // what decides whether anybody gets to swing, so attack is what changed.
  return {
    hp: clamp(1 + delta * hpPerExtraMember),
    atk: clamp(1 + atkPerDoubling * Math.log2(Math.max(1, partySize) / baselinePartySize)),
  };
}
