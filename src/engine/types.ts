/**
 * Core domain types for the dungeon engine.
 *
 * Design intent: everything a content author needs to add a new gear item,
 * a new encounter, or a new dungeon tier is expressible as *data* conforming
 * to these shapes. No engine code should need to change to add content — see
 * src/engine/content/loader.ts and the README for the extensibility contract.
 *
 * Reconciled against concept doc v0.6 (see AGENTS.md §2) — this file now
 * models a PARTY of per-viewer characters fighting a GROUP of enemies, not
 * the single hero vs. single encounter the first scaffold assumed.
 */

/**
 * The five combat stats.
 *
 * Mapping to the concept doc's player-facing names (AGENTS.md §2.2):
 *   Health -> hp      Damage -> atk      Armour -> armour      Skill -> skill
 *
 * `skill` carries the damage-reduction curve for every role — it is a *rating*
 * fed through diminishing returns into a percentage, not flat subtraction (see
 * combat/formulas.ts for why). It replaced `armour`, which replaced the older
 * `def`. `spd` weights how often a unit is picked to act under random-tick
 * resolution, which is the only job it has now that fixed turn order is gone —
 * and is why it is the second stat both DPS and Healers want.
 */
export type StatKey = "hp" | "atk" | "spd" | "skill" | "crit";

export const STAT_KEYS: readonly StatKey[] = ["hp", "atk", "spd", "skill", "crit"];

/** crit is a 0-1 chance. All others are flat point values. */
export interface Stats {
  hp: number;
  atk: number;
  spd: number;
  /**
   * How hard you are to hurt, and — for a Tank or a Healer — what your role
   * runs on.
   *
   * This is where ARMOUR went. Two stats both meaning "take less damage" was
   * one too many: armour was the number everybody understood and Skill was the
   * number that did the interesting things, so the interesting one was the one
   * nobody spent on. Skill now carries the mitigation curve for every role,
   * and Tanks keep an extra layer on top of it (self-mitigation, and a guard
   * that covers the whole party). See mitigationFraction.
   */
  skill: number;
  crit: number;
}

/**
 * Tank / DPS / Healer. Chosen by the viewer in the loadout surface (§2.6),
 * never on the stream overlay. Drives aggro generation (Tank) and heal
 * priority (Healer) in the resolver.
 */
export type Role = "tank" | "dps" | "healer";

export const ROLES: readonly Role[] = ["tank", "dps", "healer"];

/**
 * The stats a player can spend level-up points on — the concept doc's four
 * player-facing stats (§2.2: Health, Damage, Armour, Skill).
 *
 * `spd` and `crit` are deliberately NOT allocatable: spd only weights act
 * frequency under random-tick resolution, and crit is a probability, so
 * neither reads as a meaningful choice next to the other four. They come
 * from the role's base spread and from gear.
 */
export type AllocatableStat = "hp" | "atk" | "skill" | "spd";

/**
 * Four stats, and every role wants exactly two of them.
 *
 *   Tank    HP + Skill      soak it and shrug it off
 *   Healer  Skill + Speed   heal for more, and act more often
 *   DPS     Attack + Speed  hit hard and go first
 *
 * That symmetry is the point: each stat is wanted by two roles and ignored by
 * one, so there is no stat that is simply correct for everybody and no role
 * whose build is a single slider. Armour used to be the odd one out — wanted
 * by one role, understood by all three, and mechanically the same idea as
 * Skill — so it is gone and Skill absorbed its job.
 */
export const ALLOCATABLE_STATS: readonly AllocatableStat[] = ["hp", "atk", "skill", "spd"];

/**
 * The stats GEAR may move. The same four a player can allocate.
 *
 * SPEED IS NOW ON ITEMS, and it was cut once for a measured reason worth
 * keeping in view: speed IS initiative, so +1 speed beat +8 armour in testing
 * while looking like the smallest number on the item — simultaneously the
 * strongest stat and the least legible, which is a trap for whoever authors
 * the gear. What changes that is `statMods` being allowed to go NEGATIVE: a
 * greatsword that gives Attack and costs Speed prices itself, where a
 * speed-only bonus could not. Re-measure with
 * `npm run simulate:progression` after authoring speed onto anything.
 *
 * CRIT stays off items. It is the least efficient stat in the game — about a
 * quarter of HP's win rate per point of apparent power — and is mathematically
 * just a noisier attack (E[damage] = atk * (1 + crit * (critMultiplier-1))).
 * Its only unique contribution is spectacle, which damageVariance already
 * provides. Encounters may still roll it so a boss can spike.
 */
export type GearStat = AllocatableStat;

export const GEAR_STAT_KEYS: readonly GearStat[] = ALLOCATABLE_STATS;

/**
 * The seven equipment slots.
 *
 * Note there is no feet or neck/trinket slot — this set is deliberately
 * smaller than the Art Bible's full z-order table (which also lists feet,
 * waist, shoulders and hands). Those are layers the art system can draw, not
 * slots the game equips into.
 */
export type GearSlot = "head" | "face" | "mainHand" | "offHand" | "top" | "bottom" | "back";

/** Declaration order only. The paper doll positions slots anatomically — see EquipmentDoll. */
/**
 * How strong a party an encounter is laid out for.
 *
 * STRENGTH, not headcount. Counting bodies sends the wrong fight to both ends:
 * four viewers in full plate at Corruption 20 are a harder proposition than
 * fifteen fresh characters in their underwear, and a rule that cannot tell them
 * apart hands the first a walkover and wipes the second. The score behind these
 * bands folds in gear, levelling and composition — see src/engine/partyStrength.ts.
 *
 * Tiers, not a curve. A continuous rule is what the old `partyScaling` config
 * was, and it measurably did nothing. Hand-authored layouts are cruder, but
 * they are honest and the person tuning them can SEE each one.
 *
 * Six, because three could not reach. Party rating runs from about 160 for ten
 * fresh characters to 9,500 for ten at level 300, and three tiers covered only
 * the first thirtieth of that. A tier with no units authored simply falls back
 * to the one below, so the unused ones cost nothing until somebody fills them.
 */
export const PARTY_BANDS = [
  "weak",
  "seasoned",
  "elite",
  "brutal",
  "infernal",
  "apocalyptic",
] as const;
export type PartyBand = (typeof PARTY_BANDS)[number];

/**
 * An enemy drawn as a person: a body, a skin tone and worn gear.
 *
 * The alternative to a finished `sprite`, and the right one when an enemy is
 * meant to read as somebody wearing equipment you could loot off them.
 */
export interface EnemyAppearance {
  bodyType: BodyType;
  skinTone: string;
  equipment?: Partial<Record<GearSlot, string>>;
}

/** A squad per party size. A band with no units falls back to the one below. */
export type Formations = Partial<Record<PartyBand, EnemyUnit[]>>;

/**
 * What a fight is made of.
 *
 * ONE CONCEPT. There used to be two — an `Encounter` (an enemy archetype: a
 * stat block, a loot table, sprites) and a `Dungeon` (a place that spawned N
 * of them) — and the boundary between them had stopped meaning anything. Both
 * answered "how many enemies": if an encounter had a formation the dungeon's
 * `count` was silently ignored, and if it did not, `count` won. Worse, an
 * archetype was SHARED, so authoring a squad for `cops` set the difficulty of
 * every place cops appear — which is measurably why the dungeon ladder was out
 * of order.
 *
 * A fight now owns its own bodies. The base block below is what an unqualified
 * body is built from; a body that wants to differ says so (see EnemyUnit).
 */
export interface FightDefinition {
  /** The body every unit is built from unless it overrides. */
  stats: Stats;
  /** What this fight drops. A unit may carry its own table instead. */
  loot: LootEntry[];
  goldReward: [min: number, max: number];
  xpReward: number;
  /** Mob or boss, for anything that does not say otherwise. */
  kind: EncounterKind;
  /** The bodies, per band. A band with none falls back to the one below. */
  formations: Formations;
  /**
   * Multiplier on every body's hp and atk, by the band the PARTY landed in.
   *
   * PER FIGHT, because a global curve cannot be right for five places at once.
   * The band says how hard tonight is for the people who turned up (AGENTS.md
   * §2, one axis); the fight's own curve is what keeps a place labelled L16
   * harder than one labelled L4 at every band, which is the ladder ordering
   * §10 asks for. Both at once, and neither expressible without this.
   *
   * Absent means fall back to `balance.bandStatScale`, which is identity
   * unless solved — so an un-tuned fight behaves exactly as it always did.
   *
   * SOLVED, NOT AUTHORED BY HAND: `npx tsx scripts/author-bands.ts --write`.
   */
  bandStatScale?: Partial<Record<PartyBand, number>>;
}

/**
 * One enemy standing in one place.
 *
 * `x`/`y` are fractions of the enemy half of the stage, not pixels, so a layout
 * survives the stage being re-sized and can be authored against the background
 * picture at whatever size the admin happens to show it.
 */
export interface EnemyUnit {
  /** Stable key, so re-ordering the squad does not renumber combatants. */
  id: string;
  /** Sprite path, "<group>/<id>". */
  sprite: string;
  /**
   * What to call this one in the squad list.
   *
   * Per unit, not per encounter: a police squad is a chief, two SWAT and four
   * officers, and a list that says "cops/cops-04" seven times is a list nobody
   * can read. Falls back to the sprite id when unset.
   */
  name?: string;
  /**
   * What this one does in the fight.
   *
   * The same three roles the players have, and deliberately so: the resolver's
   * heal priority, taunt and guard already work from `role` without caring
   * which side is acting, so an enemy squad gets the whole mechanic for free.
   *
   * OPTIONAL, and a body without one is genuinely weaker: no role scaling, no
   * skill floor, threat multiplier 1. That used to be the silent difference
   * between an authored fight and a counted one, and it is why Saint's Rest
   * (sixteen roleless blocks) measured easier than Marketgate (sixteen
   * including a role-scaled squad) despite carrying more HP. It is left
   * optional so the merge did not change any fight's difficulty on the way
   * through; assign roles deliberately, and re-measure when you do.
   */
  role?: Role;
  /** 0..1 across the enemy half, 0 nearest the party. */
  x: number;
  /** 0..1 down the stage, 1 at the feet line. Also the depth cue. */
  y: number;
  /** Size multiplier, for standing someone further back or making a brute. */
  scale?: number;
  /**
   * How often this unit acts, relative to one ordinary combatant.
   *
   * The difficulty dial, and the only one that reaches far enough. Initiative
   * is drawn from every living combatant at once, so a squad of seven facing
   * twenty-four players gets under a quarter of the actions — and measured, no
   * amount of hit points, armour or damage on those seven bodies recovers that.
   * Raising this buys back action share without needing fifty sprites on a
   * 450x250 stage.
   *
   * The useful range is narrow and not guessable — on one measured squad it ran
   * from 93% win at 2 to 0% at 4 — which is why the editor solves for it rather
   * than asking anyone to find it by hand.
   */
  weight?: number;

  /* --- overrides -----------------------------------------------------------
   *
   * Everything below overrides the fight's own base block, and every one of
   * them is optional because most bodies in a fight are the same body. A
   * militia line is twelve identical soldiers and one serjeant: the twelve say
   * nothing, the serjeant says `stats` and `xpReward`.
   *
   * This is what "one thing" costs and what it buys. There is no archetype
   * file to look up any more — a fight declares its own bodies — but a fight
   * with sixteen bodies is not sixteen stat blocks either.
   */

  /** Whether this body is a mob or the boss. Defaults to the fight's kind. */
  kind?: EncounterKind;
  /** Replaces the fight's base stats, key by key. */
  stats?: Partial<Stats>;
  /** Replaces the fight's loot table entirely, if present. */
  loot?: LootEntry[];
  /**
   * Drawn as a dressed PERSON rather than as a finished sprite.
   *
   * Per body, not per fight, which is the merge doing its job: a militia line
   * used to share one appearance because it shared one archetype, and now the
   * serjeant can wear different armour from the twelve behind him without a
   * second file existing.
   */
  character?: EnemyAppearance;
  goldReward?: [min: number, max: number];
  xpReward?: number;
  abilities?: AbilityDefinition[];
}

export const GEAR_SLOTS: readonly GearSlot[] = ["head", "face", "mainHand", "offHand", "top", "bottom", "back"];

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/**
 * Optional visual metadata for a gear item.
 *
 * `tint` is a leftover from the retired bone rig, which recoloured a bone
 * instead of drawing the item. Under the layered system (src/character/
 * layers.ts) an item shows by having its own art at
 * `art/gear-layers/<id>.png`, so nothing reads this today — it is kept only
 * so existing content files stay valid, and should go once every item has a
 * layer.
 */
export interface GearVisual {
  /** @deprecated Bone tint from the retired rig; unused by the layered renderer. */
  tint?: string;
}

/**
 * A gear item's static definition, loaded from content/gear/*.json.
 * `statMods` are flat additive bonuses applied on top of the character's
 * base stats. `tags` is an open-ended extension point for future special
 * effects (e.g. "lifesteal", "burn-on-hit") that the combat resolver can key
 * off of later without changing this shape.
 */
export interface GearDefinition {
  id: string;
  name: string;
  slot: GearSlot;
  rarity: Rarity;
  /**
   * What a character must have SPENT to wear this, per attribute.
   *
   * Attributes, not level. A level is now just a count of how many points you
   * have been handed; where they went is the actual decision, and it is the one
   * gear should care about. Plate that needs 40 Armour is a statement about the
   * character who wears it — someone who committed to soaking — in a way that
   * "Corruption 8" never was, because at level 8 everybody is identical apart
   * from a choice this requirement can now read.
   *
   * Checked against `allocated`, so gear cannot lift you into more gear: only
   * points you spent yourself count, never points other items granted.
   */
  requires: Partial<Record<AllocatableStat, number>>;
  statMods: Partial<Stats>;
  description: string;
  tags?: string[];
  visual?: GearVisual;
  /**
   * Which sliced sprite this item draws with — a filename (without extension)
   * in art/sprites/<slot folder>/, and the key placements.json is stored
   * against. This is the join between content and art: the art pipeline
   * produces the picture, content says which item wears it, and placements
   * says where it sits.
   */
  sprite?: string;
  /**
   * Whether this item exists in the game right now.
   *
   * Absent means enabled — 119 items already shipped without the field, and a
   * missing flag must never silently delete content. Disabling takes an item
   * out of shops and loot tables and stops it being equipped, WITHOUT deleting
   * the file: half-finished art or a broken stat line can be parked rather than
   * thrown away, and turned back on when it is ready.
   */
  enabled?: boolean;
  /**
   * Which bodies this item can be worn by. Absent means both.
   *
   * Some art only exists for one body, and some items only make sense on one.
   * An item restricted to a body a character does not have simply cannot be
   * equipped, rather than equipping and rendering nothing.
   */
  bodyTypes?: BodyType[];
  /**
   * Sex-specific art for the same item. Worn gear is cut to fit a body, so a
   * cuirass has a male and a female drawing — but it is ONE item, not two.
   * A player loots "Chainmail Rig", not "Male Chainmail Rig".
   */
  spriteByBody?: { male: string; female: string };
  /**
   * Gold value, if this item is worth something other than its rarity's
   * default. Optional so the existing content didn't all need editing —
   * see economy.valueByRarity in balance.ts for the fallback.
   */
  value?: number;
}

/** An owned copy of a gear item. v1 has no rolled variance — one definition == one instance shape. */
export interface GearInstance {
  instanceId: string;
  gearId: string;
}

/**
 * A drop the player has not looked at yet.
 *
 * Loot from a run lands here rather than in `inventory`, and the player opens
 * it on their own screen, in their own time. The item is DECIDED the moment
 * the fight resolves — `gearId` is already filled in — so this is not a second
 * roll and cannot be re-rolled by reloading. What is deferred is only the
 * telling.
 *
 * That split is the whole point of it. A run currently resolves in about a
 * fifth of a second and the loot line scrolls past on the overlay while
 * seventeen other people are also being named; by the time a viewer opens
 * their bag the item is simply there, with no moment attached to it. A sealed
 * chest moves the moment to the one screen that belongs to them.
 *
 * Shop purchases are NOT sealed. You picked it off a shelf and paid for it;
 * there is nothing to reveal, and a chest there would be a click between a
 * player and the thing they just chose.
 */
export interface SealedChest {
  /** Stable id, so opening one is idempotent and two chests cannot collide. */
  id: string;
  /** What is inside. Already rolled, never shown until opened. */
  gearId: string;
  /** Where it dropped, for the line under the reveal. */
  from?: string;
  /** When it dropped, epoch ms — the bag shows newest first. */
  at: number;
}

export type AbilityTrigger =
  | { type: "hpThreshold"; belowFraction: number } // fires once, first time HP drops below this fraction
  /**
   * Fires every Nth action THIS unit takes — not every Nth global tick.
   * Deliberately self-relative: under random-tick resolution the number of
   * global ticks per unit-action scales with headcount, so a global counter
   * would make a boss's cooldown fire wildly more often against a party of
   * twenty than against a party of three. Counting the unit's own actions
   * keeps content tuned once and correct at any party size.
   */
  | { type: "cooldown"; everyNActions: number };

export type AbilityEffect =
  | { type: "bonusDamage"; multiplier: number } // this attack deals atk * multiplier
  | { type: "heal"; amount: number } // flat heal to self
  | { type: "buff"; stat: StatKey; amount: number; durationActions: number }; // temporary self stat change

export interface AbilityDefinition {
  id: string;
  name: string;
  trigger: AbilityTrigger;
  effect: AbilityEffect;
  flavorText?: string;
}

export interface LootEntry {
  gearId: string;
  weight: number;
}

export type EncounterKind = "mob" | "boss";


/**
 * An encounter's static definition, loaded from content/encounters/*.json.
 * Trash mobs typically have no abilities; bosses use `abilities` for
 * phase behavior (hp-threshold triggers) and periodic special attacks
 * (cooldown triggers).
 */
/**
 * ONE ENEMY BODY, resolved and ready to fight. Runtime only.
 *
 * Never loaded from disk any more — `expandFight` builds one of these per unit
 * in a fight's formation, folding the fight's base block, the unit's overrides
 * and its role scaling together. It was called `EnemyDefinition` when an
 * encounter was a content file; the file is gone and the shape remains, so the
 * name follows the shape.
 */
export interface EnemyDefinition {
  id: string;
  name: string;
  kind: EncounterKind;
  levelTier: number;
  stats: Stats;
  abilities?: AbilityDefinition[];
  loot: LootEntry[];
  goldReward: [min: number, max: number];
  xpReward: number;
  flavorText?: string;
  /**
   * How many combatants' worth of initiative this enemy gets. Default 1.
   *
   * Initiative is drawn from every living combatant at once, so a lone enemy
   * facing six players acts a sixth as often as they do collectively — and no
   * amount of HP or damage fixes that, because one action still only hits one
   * person. Measured, a boss at 3x HP and 1.6x damage was still Trivial for a
   * party of six.
   *
   * This is the knob that makes a boss a boss: at 8 it acts roughly as often as
   * eight ordinary combatants, which is the raid-boss fantasy of one thing that
   * keeps up with a whole party. Left at 1 for mobs, where being outnumbered is
   * already answered by there being several of them.
   */
  initiativeWeight?: number;
  /**
   * A finished enemy sprite, as "<group>/<id>" under art/sprites/enemies.
   *
   * The THIRD way an enemy can be drawn, and now the preferred one. The others
   * exist for different reasons and are kept:
   *
   *  - `character` composites an enemy from the player bodies and gear. Right
   *    when an enemy is meant to read as a person wearing lootable equipment.
   *
   * These sheets are complete figures — a milkmaid, a king, a sheep — that no
   * amount of layering would produce, so they are drawn as-is. Precedence is
   * enemySprite, then character, then visual, so adding art to an existing
   * encounter upgrades it without editing anything else.
   */
  enemySprite?: string;
  /**
   * The individuals this encounter is made of, as "<group>/<id>" paths.
   *
   * An encounter is ONE stat block that a dungeon spawns several copies of, and
   * with a single `enemySprite` those copies are literally the same drawing
   * repeated — six identical farmhands standing in a row, which reads as a
   * rendering bug rather than as a mob. A cast fixes that without touching
   * combat: copy n draws cast member n, cycling when there are more bodies than
   * faces. Same stats, different people.
   *
   * Empty or absent falls back to `enemySprite`, so every encounter authored
   * before this keeps working and looking exactly as it did.
   */
  enemySprites?: string[];
  /**
   * The squad this encounter fields, laid out for three sizes of party.
   *
   * This is what an encounter IS now, and it replaces "one stat block, spawned
   * N times by the dungeon". That old shape had two problems that could not be
   * tuned away. It rendered a mob as the same drawing repeated down the line,
   * and — measured — it gave no legible way to make a fight hard: pushing every
   * stat slider to its maximum one at a time left 3 enemies vs 6 players at
   * 95-100% win, because HP and armour buy TIME rather than outcome, and
   * outcome is decided by damage throughput times share of actions.
   *
   * A squad fixes both. Units carry roles, so a fight gets harder in a way a
   * person can reason about — add a healer and the party has to burst it down,
   * add a tank and their damage gets soaked — instead of by nudging armour from
   * 7 to 9 and hoping. And because the three bands are authored by hand rather
   * than derived from a formula, four viewers and thirty viewers each get a
   * fight somebody actually designed.
   *
   * Absent falls back to `enemySprites`/`enemySprite` spawned by dungeon count,
   * so every encounter authored before this still works.
   */
  formations?: Formations;
  /**
   * Role this body plays, when the encounter has been expanded into a squad.
   *
   * Set by expandSquad, never authored — a formation's units carry the roles
   * and this is how one of them reaches the resolver.
   */
  role?: Role;
  /** Which formation unit this body came from. Set by expandSquad. */
  unitId?: string;
  /**
   * The scene this enemy is fought in, as a background id.
   *
   * On the encounter rather than only on the dungeon because a raid's door
   * fights can each be a different group in a different place, and the run has
   * no single location to speak for them. A dungeon may still override it.
   */
  background?: string;
  /**
   * Art drawn IN FRONT of the characters while the party is still gathering.
   *
   * Framing for the shot before the fight — foliage, a gateway, a crowd — that
   * then gets out of the way. Deliberately limited to the join window: anything
   * in front of the figures during combat would obscure the thing an audience
   * is watching, and at 88px there is no room to spare.
   */
  foreground?: string;
    /**
   * Draw this enemy as a CHARACTER rather than as a sprite-sheet cell.
   *
   * The premise changed: the party are the corrupted, and what they raid is
   * villages — farmhands, militia, hedge priests, the odd hero. Those are
   * people, so they are built from the same bodies and gear the players use
   * instead of needing a separate bestiary sheet. One art pipeline, and an
   * enemy's kit is readable at a glance because it is the same kit the player
   * can loot from them.
   *
   * Mutually exclusive with `visual` — an enemy is either a person or a
   * sheet cell.
   */
  character?: EncounterCharacter;
}

/** A human enemy, described the same way a player character is. */
export interface EncounterCharacter {
  bodyType: BodyType;
  skinTone: string;
  /** Gear ids per slot, drawn through the same layer stack as a player's. */
  equipment?: Partial<Record<GearSlot, string>>;
}

/**
 * The three doors a raid offers each round.
 *
 * Named by position rather than by number because that is what the audience
 * sees and says out loud — "go left" is a thing chat can shout, "door 0" is
 * not. This is the vocabulary of the choice, so it is the vocabulary of the
 * type.
 */
export type PathDirection = "left" | "up" | "right";

export const PATH_DIRECTIONS: readonly PathDirection[] = ["left", "up", "right"];

/**
 * What is behind a door.
 *
 * `clear` is not filler. A raid where every door costs something is just a
 * gauntlet; the chance of a free passage is what makes the choice feel like a
 * gamble rather than a toll.
 */
export type DoorKind = "clear" | "buff" | "fight";

export const DOOR_KINDS: readonly DoorKind[] = ["clear", "buff", "fight"];

/**
 * A party-wide effect picked up from a door, lasting the rest of the raid.
 *
 * Flat stat additions rather than multipliers: they stack across four rounds,
 * and multiplicative stacking on a party that can be 25 strong compounds into
 * numbers the balance pass has no hope of predicting.
 */
export interface RaidBuff {
  id: string;
  name: string;
  description: string;
  statMods: Partial<Stats>;
}

/**
 * One room in a raid: a named place with something in it.
 *
 * This replaced a `doorTable` of per-kind weights plus a nameless `fightPool`.
 * That model could say "fights are 40% likely" but could not say WHICH fight,
 * and a fight had no name, no description and no scene — so there was nothing
 * to reveal when a door opened, and nothing for the admin to add or edit. A
 * room is the thing an author actually thinks in: a place, what waits there,
 * and how often the party finds it.
 *
 * The per-kind odds the old table expressed are still expressible — they are
 * the sum of that kind's room weights — so nothing was lost by dropping it.
 */
export interface RaidRoom {
  id: string;
  /** What the reveal calls this place. */
  name: string;
  /** One line, shown under the name while the room is revealed. */
  description: string;
  kind: DoorKind;
  /** Scene art for the reveal, and for the fight if there is one. */
  background?: string;
  /** kind "fight" — the fight that waits here. */
  fight?: FightDefinition;
  /**
   * kind "buff" — which boon this room holds.
   *
   * Optional: a room that names no buff hands out any the party has not
   * claimed yet, which is how a generic "a shrine" room stays useful for a
   * whole run instead of being spent after one visit.
   */
  buffId?: string;
}

/** One round of the path: which room lies down each of the three directions. */
export type RaidStep = Record<PathDirection, string>;

/** One door, as the run knows it. `kind` is hidden from the overlay until opened. */
export interface RaidDoor {
  direction: PathDirection;
  kind: DoorKind;
  /**
   * Which room waits behind it.
   *
   * An id rather than the room itself: a door is rolled, stored and later
   * opened, and copying a whole room into it would mean the run carried a
   * stale duplicate of content the raid already owns.
   */
  roomId: string;
  /** Set when kind is "buff" — resolved at roll time so a run cannot repeat a boon. */
  buffId?: string;
  opened: boolean;
}

/**
 * A raid: several rounds of door choices, then a boss.
 *
 * Distinct from a dungeon rather than a tier of one, because the SHAPE of the
 * run differs — a dungeon is one fight, a raid is a branching sequence with
 * state carried between rounds (which buffs the party picked up). Squeezing
 * that into DungeonDefinition would have meant most of its fields being
 * meaningless for most content.
 */
export interface RaidDefinition {
  id: string;
  name: string;
  recommendedLevel: number;
  joinWindowMs: number;
  /**
   * The path, one step per round: what is behind Left, Ahead and Right.
   *
   * AUTHORED, not rolled. This replaced a weighted table the doors were drawn
   * from, which gave variety at the cost of the streamer being able to say
   * what a night actually looks like. The trade is real and it was made
   * deliberately: two runs of a raid are now identical, and a run's shape is
   * something you build rather than something you tune the odds of.
   *
   * The audience still cannot see what is behind a door — `RaidView` withholds
   * a door's kind until it is opened — so a chat vote is as blind as it ever
   * was. What changed is that the person authoring the raid is no longer
   * guessing either.
   *
   * The number of rounds IS the length of this list; there is no separate
   * count to keep in step with it.
   */
  path: RaidStep[];
  /** Buffs a "buff" room can award, drawn without replacement within a run. */
  buffs: RaidBuff[];
  /**
   * Every room a door can open onto, with the odds of finding each. A raid
   * owns its rooms the same way a dungeon owns its one fight.
   */
  rooms: RaidRoom[];
  /**
   * The last room. It is a room like any other — it gets a name, a line and a
   * scene, and it is revealed before the party walks in — plus the two
   * multipliers that make a raid boss different from the same body met
   * anywhere else. No `weight`: it is never drawn, it is arrived at.
   */
  boss: Omit<RaidRoom, "buffId"> & {
    fight: FightDefinition;
    /** Multiplies the boss's own stats, on top of party scaling. */
    hpMultiplier: number;
    atkMultiplier: number;
  };
  completionXp: number;
  completionGold: [min: number, max: number];
  flavorText?: string;
}

/**
 * A consumable's static definition, loaded from content/consumables/*.json.
 *
 * Deliberately its own content type rather than a flag on GearDefinition:
 * AGENTS.md §2.6 flags the schema gap that an XP tome has no `slot`, and
 * making `slot` optional would push an "is this equippable?" check into
 * every existing gear consumer. A separate type keeps gear code unchanged
 * and follows the same content-is-data pattern as everything else.
 */
export interface ConsumableDefinition {
  id: string;
  name: string;
  rarity: Rarity;
  /** Gold cost in the shop. Consumables are priced explicitly — there is no rarity fallback. */
  price: number;
  description: string;
  effect: ConsumableEffect;
}

/** Deliberately a small closed set — extend here (+ schemas.ts) when the design calls for more. */
export type ConsumableEffect =
  | { type: "grantXp"; amount: number }
  | { type: "grantGold"; amount: number };

/** What the shop currently stocks, from content/shop.json. Ids only. */
export interface ShopStock {
  gear: string[];
  consumables: string[];
}

/**
 * The shop as a client sees it: the same stock with prices already
 * resolved. Pricing lives server-side (a gear item's own `value`, else its
 * rarity default) so a buy button can never disagree with what the purchase
 * actually charges.
 */
export interface ShopView {
  gear: { id: string; price: number }[];
  consumables: { id: string; price: number }[];
}

/*
 * Dungeon TIERS are gone.
 *
 * A dungeon used to carry a fixed difficulty band — easy through infernal —
 * chosen when it was authored. That was a second, unrelated difficulty axis
 * sitting beside the one that actually decides a fight: the encounter LEVEL,
 * picked at run time from the party's rating. Two axes that never referenced
 * each other meant "Saint's Rest (hard)" could hand a fresh party a Level 1
 * squad and say "hard" while doing it.
 *
 * A dungeon is now just a place. How hard the night is comes from who turned
 * up, which is the only thing that can actually know.
 */

/**
 * A dungeon: a place, and the fight that happens in it.
 *
 * The two used to be separate files — a dungeon listed `enemies` by
 * `encounterId` and the encounter said what those were. See FightDefinition
 * for why that boundary was removed.
 *
 * The join window is content, not code, so tuning "how long do viewers get to
 * join" is a JSON edit rather than a deploy.
 */
export interface DungeonDefinition extends FightDefinition {
  id: string;
  name: string;
  /** How long the join window stays open before the party locks, in ms. */
  joinWindowMs: number;
  /** Recommended character level — display only; nothing gates on it in v1. */
  recommendedLevel: number;
  /**
   * Whether enemy stats scale to the party that turned up (see balance.ts
   * partyScaling). Defaults to true; set false for a fight whose stat block is
   * meant to be absolute regardless of headcount.
   */
  scalesWithPartySize: boolean;
  /** The backdrop this fight is staged against. */
  background?: string;
  /** Drawn in front of the fight — railings, crates, a wall to fight behind. */
  foreground?: string;
  /** Flat completion bonus on top of per-enemy rewards, split to every survivor. */
  completionXp: number;
  completionGold: [min: number, max: number];
  flavorText?: string;
}

/** The two base body shapes. Selects which sprite set a character draws from. */
export type BodyType = "male" | "female";

export const BODY_TYPES: readonly BodyType[] = ["male", "female"];

/**
 * Per-character visual identity.
 *
 * Together `bodyType` and `skinTone` select a drawn sprite —
 * `art/body/<bodyType>-<skinTone>.png` — rather than tinting a silhouette at
 * runtime, which is why both are ids and neither is a colour.
 *
 * Hairstyle is deliberately absent: it is baked into the body art. PixelLab
 * will not generate a bald base (see AGENTS.md §6), so hair cannot be a
 * reliable overlay layer — a hair sprite has nothing predictable to cover.
 */
export interface CharacterAppearance {
  bodyType: BodyType;
  skinTone: string;
  /**
   * Hair sprite id (art/sprites/hair), or null for bald.
   *
   * One id rather than a style+colour pair: the art ships as 40 finished
   * drawings, one per style-and-colour combination, so a split would just be
   * two fields that always have to be recombined into the filename they came
   * from. Equipping a helmet suppresses it — see HIDES_HAIR in
   * src/character/layers.ts.
   */
  hair?: string | null;
}

/**
 * One viewer's persistent character. Keyed by `id`, which is the viewer's
 * platform identity (`requestedBy` on a command) — that is the seam a real
 * Twitch layer plugs into without touching anything here.
 */
export interface Character {
  id: string;
  name: string;
  level: number;
  xp: number;
  gold: number;
  role: Role;
  /**
   * Points the player has spent, per stat. Kept separately from the role's
   * base spread rather than baked into a single `baseStats` block, so that
   * switching role swaps the base spread without silently discarding
   * everything the player allocated. Effective stats are
   * role base + allocated + equipped gear — see deriveCharacterStats().
   */
  allocated: Record<AllocatableStat, number>;
  /** Level-up points not yet spent. The loadout screen is where they get spent. */
  unspentPoints: number;
  /** Owned consumables, by definition id -> count. */
  consumables: Record<string, number>;
  equipment: Partial<Record<GearSlot, GearInstance>>;
  inventory: GearInstance[];
  /**
   * Drops from runs that have not been opened yet. See SealedChest.
   *
   * Optional because 119 characters already exist without the field and a
   * roster written before this shipped must still load — `parseRoster`
   * defaults it to empty rather than dropping the character.
   */
  chests?: SealedChest[];
  appearance: CharacterAppearance;
}

export type Side = "party" | "enemy";

/**
 * A participant in a resolved fight. `id` is unique *within that fight* —
 * for party members it is the character/viewer id, for enemies it is the
 * encounter id plus an instance suffix (three rats are three combatants).
 */
export interface CombatantSnapshot {
  id: string;
  name: string;
  side: Side;
  /** Party members only. */
  role?: Role;
  /** Party members only. */
  level?: number;
  /** Enemies only. */
  kind?: EncounterKind;
  maxHp: number;
  stats: Stats;
  appearance?: CharacterAppearance;
}

/**
 * Every event a fight produces, in resolution order. Note every event that
 * involves a unit carries an explicit combatant id — the old
 * `actor: "hero" | "encounter"` shape cannot express "which of the five".
 */
export type CombatEvent =
  | { type: "tick"; n: number }
  | {
      type: "attack";
      actorId: string;
      targetId: string;
      damage: number;
      /** Damage absorbed by the target's armour this hit — surfaced so the log can show it. */
      mitigated: number;
      crit: boolean;
      targetHpAfter: number;
    }
  | { type: "heal"; actorId: string; targetId: string; amount: number; targetHpAfter: number }
  | { type: "ability"; actorId: string; abilityId: string; abilityName: string; detail: string }
  | { type: "down"; combatantId: string }
  | { type: "loot"; characterId: string; gearId: string; gearName: string }
  | { type: "reward"; characterId: string; xp: number; gold: number }
  | { type: "levelUp"; characterId: string; newLevel: number }
  | { type: "outcome"; outcome: CombatOutcome };

export type CombatOutcome = "victory" | "defeat";

export interface CombatResult {
  outcome: CombatOutcome;
  /** Both sides' opening state — the overlay builds its panels from this. */
  combatants: CombatantSnapshot[];
  events: CombatEvent[];
  /** Ids of party members still standing at the end. Casualties keep XP but get no gear (§2.1). */
  survivorIds: string[];
}
