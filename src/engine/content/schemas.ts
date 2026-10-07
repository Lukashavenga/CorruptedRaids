/**
 * Hand-rolled validation for content files (no external schema library —
 * this project is dependency-free by design so it runs anywhere with just
 * Node + tsx). Each validator throws a descriptive Error naming the file
 * and field at fault, so a bad content JSON fails loudly at startup instead
 * of corrupting engine state.
 */
import { ALLOCATABLE_STATS, DOOR_KINDS, GEAR_SLOTS, GEAR_STAT_KEYS, PARTY_BANDS, PATH_DIRECTIONS, RARITIES, ROLES, STAT_KEYS } from "../types.js";
import type {
  Formations,
  FightDefinition,
  AbilityDefinition,
  AbilityEffect,
  AbilityTrigger,
  ConsumableDefinition,
  ConsumableEffect,
  DungeonDefinition,
  EnemyDefinition,
  GearDefinition,
  GearVisual,
  LootEntry,
  PartyBand,
  RaidBuff,
  RaidDefinition,
  RaidRoom,
  RaidStep,
  ShopStock,
  Stats,
} from "../types.js";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function validateGearVisual(raw: unknown, file: string): GearVisual | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null) fail(file, `"visual" must be an object if present`);
  const obj = raw as any;
  if (obj.tint !== undefined) {
    if (typeof obj.tint !== "string" || !HEX_COLOR.test(obj.tint)) {
      fail(file, `"visual.tint" must be a 6-digit hex color like "#8a5fc2", got ${JSON.stringify(obj.tint)}`);
    }
  }
  return { tint: obj.tint };
}

class ContentValidationError extends Error {
  constructor(file: string, message: string) {
    super(`[content:${file}] ${message}`);
    this.name = "ContentValidationError";
  }
}

function fail(file: string, message: string): never {
  throw new ContentValidationError(file, message);
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function requireString(obj: any, key: string, file: string): string {
  if (typeof obj[key] !== "string" || obj[key].length === 0) fail(file, `"${key}" must be a non-empty string`);
  return obj[key];
}

function requireNumber(obj: any, key: string, file: string): number {
  if (!isNumber(obj[key])) fail(file, `"${key}" must be a number`);
  return obj[key];
}

function optionalPartialStats(obj: any, key: string, file: string): Partial<Stats> {
  if (obj[key] === undefined) return {};
  const raw = obj[key];
  if (typeof raw !== "object" || raw === null) fail(file, `"${key}" must be an object of stat -> number`);
  const out: Partial<Stats> = {};
  for (const k of Object.keys(raw)) {
    if (k === "def") {
      fail(file, `"${key}.def" was renamed to "armour" when flat mitigation was replaced by the armour curve - update this file`);
    }
    if (!STAT_KEYS.includes(k as any)) {
      fail(file, `"${key}.${k}" is not a recognized stat (expected one of ${STAT_KEYS.join(", ")})`);
    }
    if (!isNumber(raw[k])) fail(file, `"${key}.${k}" must be a number`);
    (out as any)[k] = raw[k];
  }
  return out;
}

function requireStats(obj: any, key: string, file: string): Stats {
  const partial = optionalPartialStats(obj, key, file);
  for (const stat of STAT_KEYS) {
    if (partial[stat] === undefined) fail(file, `"${key}.${stat}" is required`);
  }
  return partial as Stats;
}

export function validateGearDefinition(raw: unknown, file: string): GearDefinition {
  if (typeof raw !== "object" || raw === null) fail(file, "gear file must contain a JSON object");
  const obj = raw as any;
  const id = requireString(obj, "id", file);
  const name = requireString(obj, "name", file);
  const slot = requireString(obj, "slot", file);
  if (!GEAR_SLOTS.includes(slot as any)) fail(file, `"slot" must be one of ${GEAR_SLOTS.join(", ")}, got "${slot}"`);
  const rarity = requireString(obj, "rarity", file);
  if (!RARITIES.includes(rarity as any)) fail(file, `"rarity" must be one of ${RARITIES.join(", ")}, got "${rarity}"`);
  const requires: Record<string, number> = {};
  if (obj.requires !== undefined) {
    if (typeof obj.requires !== "object" || obj.requires === null || Array.isArray(obj.requires)) {
      fail(file, `"requires" must be an object of attribute -> points`);
    }
    for (const [stat, value] of Object.entries(obj.requires as Record<string, unknown>)) {
      if (!ALLOCATABLE_STATS.includes(stat as never)) {
        fail(file, `"requires" names "${stat}", which is not an attribute a player can spend on`);
      }
      if (typeof value !== "number" || value < 0) fail(file, `"requires.${stat}" must be a number of points`);
      if ((value as number) > 0) requires[stat] = value as number;
    }
  }
  const statMods = optionalPartialStats(obj, "statMods", file);
  // Gear may only grant what a player can also allocate — see GEAR_STAT_KEYS.
  // Failing loudly here rather than silently ignoring the field: an item that
  // says it gives speed and does not is worse than one that will not load.
  for (const key of Object.keys(statMods)) {
    if (!GEAR_STAT_KEYS.includes(key as any)) {
      fail(
        file,
        `"statMods.${key}" is not a gear stat - gear may only grant ${GEAR_STAT_KEYS.join(", ")}. ` +
          `Speed and crit are engine stats (role baselines and encounters), not item rolls.`,
      );
    }
  }
  const description = requireString(obj, "description", file);
  const tags = obj.tags === undefined ? undefined : obj.tags;
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t: unknown) => typeof t === "string"))) {
    fail(file, `"tags" must be an array of strings if present`);
  }
  const visual = validateGearVisual(obj.visual, file);
  if (obj.value !== undefined && (!isNumber(obj.value) || obj.value < 0)) {
    fail(file, `"value" must be a number >= 0 if present`);
  }
  // Art join. `sprite` names one file in art/sprites/; `spriteByBody` names two
  // for gear that is cut to fit a body. An item may declare either, never both
  // — two sources of truth for the same picture is how they drift apart.
  if (obj.sprite !== undefined && typeof obj.sprite !== "string") {
    fail(file, `"sprite" must be a string if present`);
  }
  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    fail(file, `"enabled" must be a boolean if present`);
  }
  if (obj.bodyTypes !== undefined) {
    const list = obj.bodyTypes;
    if (!Array.isArray(list) || list.length === 0 || !list.every((b: unknown) => b === "male" || b === "female")) {
      fail(file, `"bodyTypes" must be a non-empty array of "male" / "female" if present`);
    }
  }
  if (obj.spriteByBody !== undefined) {
    const s = obj.spriteByBody;
    if (typeof s !== "object" || s === null || typeof s.male !== "string" || typeof s.female !== "string") {
      fail(file, `"spriteByBody" must be an object with string "male" and "female" if present`);
    }
    if (obj.sprite !== undefined) {
      fail(file, `set "sprite" or "spriteByBody", not both`);
    }
  }
  return {
    id,
    name,
    slot: slot as any,
    rarity: rarity as any,
    requires,
    statMods,
    description,
    tags,
    sprite: obj.sprite,
    spriteByBody: obj.spriteByBody,
    enabled: obj.enabled,
    bodyTypes: obj.bodyTypes,
    value: obj.value,
  };
}

function validateAbilityTrigger(raw: any, file: string, abilityId: string): AbilityTrigger {
  if (typeof raw !== "object" || raw === null) fail(file, `ability "${abilityId}".trigger must be an object`);
  if (raw.type === "hpThreshold") {
    if (!isNumber(raw.belowFraction) || raw.belowFraction <= 0 || raw.belowFraction >= 1) {
      fail(file, `ability "${abilityId}".trigger.belowFraction must be a number between 0 and 1 exclusive`);
    }
    return { type: "hpThreshold", belowFraction: raw.belowFraction };
  }
  if (raw.type === "cooldown") {
    if (raw.everyNRounds !== undefined) {
      fail(file, `ability "${abilityId}".trigger.everyNRounds was renamed to "everyNActions" (cooldowns now count the unit's own actions, not global rounds) - update this file`);
    }
    if (!isNumber(raw.everyNActions) || raw.everyNActions < 1) {
      fail(file, `ability "${abilityId}".trigger.everyNActions must be an integer >= 1`);
    }
    return { type: "cooldown", everyNActions: raw.everyNActions };
  }
  fail(file, `ability "${abilityId}".trigger.type must be "hpThreshold" or "cooldown", got "${raw.type}"`);
}

function validateAbilityEffect(raw: any, file: string, abilityId: string): AbilityEffect {
  if (typeof raw !== "object" || raw === null) fail(file, `ability "${abilityId}".effect must be an object`);
  if (raw.type === "bonusDamage") {
    if (!isNumber(raw.multiplier) || raw.multiplier <= 0) fail(file, `ability "${abilityId}".effect.multiplier must be a positive number`);
    return { type: "bonusDamage", multiplier: raw.multiplier };
  }
  if (raw.type === "heal") {
    if (!isNumber(raw.amount) || raw.amount <= 0) fail(file, `ability "${abilityId}".effect.amount must be a positive number`);
    return { type: "heal", amount: raw.amount };
  }
  if (raw.type === "buff") {
    if (!STAT_KEYS.includes(raw.stat)) fail(file, `ability "${abilityId}".effect.stat must be one of ${STAT_KEYS.join(", ")}`);
    if (!isNumber(raw.amount)) fail(file, `ability "${abilityId}".effect.amount must be a number`);
    if (raw.durationRounds !== undefined) {
      fail(file, `ability "${abilityId}".effect.durationRounds was renamed to "durationActions" - update this file`);
    }
    if (!isNumber(raw.durationActions) || raw.durationActions < 1) {
      fail(file, `ability "${abilityId}".effect.durationActions must be an integer >= 1`);
    }
    return { type: "buff", stat: raw.stat, amount: raw.amount, durationActions: raw.durationActions };
  }
  fail(file, `ability "${abilityId}".effect.type must be "bonusDamage", "heal", or "buff", got "${raw.type}"`);
}

function validateAbilities(raw: unknown, file: string): AbilityDefinition[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) fail(file, `"abilities" must be an array`);
  return raw.map((a: any, idx: number) => {
    if (typeof a !== "object" || a === null) fail(file, `abilities[${idx}] must be an object`);
    const id = requireString(a, "id", file);
    const name = requireString(a, "name", file);
    const trigger = validateAbilityTrigger(a.trigger, file, id);
    const effect = validateAbilityEffect(a.effect, file, id);
    const flavorText = a.flavorText === undefined ? undefined : String(a.flavorText);
    return { id, name, trigger, effect, flavorText };
  });
}

function validateLoot(raw: unknown, file: string): LootEntry[] {
  if (!Array.isArray(raw)) fail(file, `"loot" must be an array`);
  return raw.map((entry: any, idx: number) => {
    if (typeof entry !== "object" || entry === null) fail(file, `loot[${idx}] must be an object`);
    const gearId = requireString(entry, "gearId", file);
    const weight = requireNumber(entry, "weight", file);
    if (weight <= 0) fail(file, `loot[${idx}].weight must be > 0`);
    return { gearId, weight };
  });
}

function validateConsumableEffect(raw: any, file: string, id: string): ConsumableEffect {
  if (typeof raw !== "object" || raw === null) fail(file, `consumable "${id}".effect must be an object`);
  if (raw.type === "grantXp" || raw.type === "grantGold") {
    if (!isNumber(raw.amount) || raw.amount <= 0) fail(file, `consumable "${id}".effect.amount must be a positive number`);
    return { type: raw.type, amount: raw.amount };
  }
  fail(file, `consumable "${id}".effect.type must be "grantXp" or "grantGold", got "${raw.type}"`);
}

export function validateConsumableDefinition(raw: unknown, file: string): ConsumableDefinition {
  if (typeof raw !== "object" || raw === null) fail(file, "consumable file must contain a JSON object");
  const obj = raw as any;
  const id = requireString(obj, "id", file);
  const name = requireString(obj, "name", file);
  const rarity = requireString(obj, "rarity", file);
  if (!RARITIES.includes(rarity as any)) fail(file, `"rarity" must be one of ${RARITIES.join(", ")}, got "${rarity}"`);
  const price = requireNumber(obj, "price", file);
  if (price < 0) fail(file, `"price" must be >= 0`);
  const description = requireString(obj, "description", file);
  const effect = validateConsumableEffect(obj.effect, file, id);
  return { id, name, rarity: rarity as any, price, description, effect };
}

export function validateShopStock(raw: unknown, file: string): ShopStock {
  if (typeof raw !== "object" || raw === null) fail(file, "shop file must contain a JSON object");
  const obj = raw as any;
  const list = (key: string): string[] => {
    if (obj[key] === undefined) return [];
    if (!Array.isArray(obj[key]) || !obj[key].every((v: unknown) => typeof v === "string")) {
      fail(file, `"${key}" must be an array of ids`);
    }
    return obj[key];
  };
  return { gear: list("gear"), consumables: list("consumables") };
}

export function validateDungeonDefinition(raw: unknown, file: string): DungeonDefinition {
  if (typeof raw !== "object" || raw === null) fail(file, "dungeon file must contain a JSON object");
  const obj = raw as any;
  const id = requireString(obj, "id", file);
  const name = requireString(obj, "name", file);
  const joinWindowMs = requireNumber(obj, "joinWindowMs", file);
  if (joinWindowMs < 0) fail(file, `"joinWindowMs" must be >= 0`);
  const recommendedLevel = requireNumber(obj, "recommendedLevel", file);
  if (obj.scalesWithPartySize !== undefined && typeof obj.scalesWithPartySize !== "boolean") {
    fail(file, `"scalesWithPartySize" must be a boolean if present`);
  }
  for (const key of ["background", "foreground"]) {
    if (obj[key] !== undefined && typeof obj[key] !== "string") {
      fail(file, `"${key}" must be a string if present`);
    }
  }
  return {
    ...validateFight(obj, file, `dungeon "${id}"`),
    id,
    name,
    joinWindowMs,
    recommendedLevel,
    scalesWithPartySize: obj.scalesWithPartySize ?? true,
    background: obj.background,
    completionXp: requireNumber(obj, "completionXp", file),
    completionGold: requireRange(obj, "completionGold", file),
    flavorText: obj.flavorText === undefined ? undefined : String(obj.flavorText),
  };
}


/**
 * A human enemy's appearance. Validated but NOT cross-checked against the gear
 * registry here: encounters load before gear in some call orders, and the
 * loader already does registry-level checks for loot. A bad gear id shows up as
 * a missing layer rather than a crash, which is the right failure for art.
 */
function validateEncounterCharacter(raw: any, file: string) {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null) fail(file, `"character" must be an object if present`);
  if (raw.bodyType !== "male" && raw.bodyType !== "female") {
    fail(file, `"character.bodyType" must be "male" or "female"`);
  }
  if (typeof raw.skinTone !== "string") fail(file, `"character.skinTone" must be a string`);
  const equipment = raw.equipment;
  if (equipment !== undefined) {
    if (typeof equipment !== "object" || equipment === null) {
      fail(file, `"character.equipment" must be an object if present`);
    }
    for (const [slot, gearId] of Object.entries(equipment)) {
      if (!GEAR_SLOTS.includes(slot as any)) fail(file, `"character.equipment" has unknown slot "${slot}"`);
      if (typeof gearId !== "string") fail(file, `"character.equipment.${slot}" must be a gear id string`);
    }
  }
  return { bodyType: raw.bodyType, skinTone: raw.skinTone, equipment };
}

/**
 * A raid: rounds of door choices, then a boss.
 *
 * Validated harder than most content because a raid is generated at RUN time
 * from these tables — a bad weight or an empty pool does not fail at load, it
 * fails four rounds into a live stream.
 */
/** A [min, max] numeric tuple, as used by every gold reward in content. */
function requireRange(obj: any, key: string, file: string): [number, number] {
  const v = obj?.[key];
  if (!Array.isArray(v) || v.length !== 2 || !isNumber(v[0]) || !isNumber(v[1])) {
    fail(file, `"${key}" must be a [min, max] number tuple`);
  }
  if (v[0] > v[1]) fail(file, `"${key}" has min greater than max`);
  return [v[0], v[1]];
}

export function validateRaidDefinition(raw: unknown, file: string): RaidDefinition {
  if (typeof raw !== "object" || raw === null) fail(file, "raid file must contain a JSON object");
  const obj = raw as any;
  const id = requireString(obj, "id", file);
  const name = requireString(obj, "name", file);

  if (!Array.isArray(obj.buffs)) fail(file, `"buffs" must be an array`);
  // `statMods` went unchecked for as long as boons could only be written by
  // hand. `buffTotals` walks it with Object.entries, so a boon saved without
  // one loaded cleanly and threw at the first fight after the party claimed
  // it. Absent now means "changes nothing", and a stat that does not exist is
  // refused here rather than silently added to nobody.
  const buffs: RaidBuff[] = obj.buffs.map((b: any, i: number) => {
    if (typeof b !== "object" || b === null) fail(file, `raid "${id}" buffs[${i}] must be an object`);
    return {
      id: requireString(b, "id", file),
      name: requireString(b, "name", file),
      description: requireString(b, "description", file),
      statMods: optionalPartialStats(b, "statMods", file),
    };
  });
  const buffIds: string[] = buffs.map((b) => b.id);
  // A shrine names its boon by id, so two boons sharing one is a shrine that
  // gives whichever happens to be first.
  for (const [i, buffId] of buffIds.entries()) {
    if (buffIds.indexOf(buffId) !== i) fail(file, `duplicate buff id "${buffId}" in raid "${id}"`);
  }

  if (!Array.isArray(obj.rooms) || obj.rooms.length === 0) {
    fail(file, `"rooms" must be a non-empty array - a raid with no rooms has nothing behind its doors`);
  }

  const seen = new Set<string>();
  const rooms: RaidRoom[] = obj.rooms.map((raw: any, i: number) => {
    const where = `raid "${id}" rooms[${i}]`;
    if (typeof raw !== "object" || raw === null) fail(file, `${where} must be an object`);
    const roomId = requireString(raw, "id", file);
    if (seen.has(roomId)) fail(file, `duplicate room id "${roomId}" in raid "${id}"`);
    seen.add(roomId);
    if (!DOOR_KINDS.includes(raw.kind)) {
      fail(file, `${where} kind must be one of ${DOOR_KINDS.join(", ")}, got "${raw.kind}"`);
    }
    // Each kind has to carry the thing that makes it that kind. A fight room
    // with no fight, or a buff room naming a boon the raid does not define,
    // does not fail at load — it fails four rounds into a live stream, which
    // is the whole reason raids are validated harder than other content.
    if (raw.kind === "fight" && (typeof raw.fight !== "object" || raw.fight === null)) {
      fail(file, `${where} is a "fight" room but has no "fight"`);
    }
    if (raw.kind === "buff") {
      if (raw.buffId !== undefined && !buffIds.includes(raw.buffId)) {
        fail(file, `${where} names buff "${raw.buffId}", which this raid does not define`);
      }
      if (raw.buffId === undefined && buffIds.length === 0) {
        fail(file, `${where} is a "buff" room but the raid defines no buffs`);
      }
    }

    return {
      id: roomId,
      name: requireString(raw, "name", file),
      description: requireString(raw, "description", file),
      kind: raw.kind,
      background: raw.background,
      ...(raw.fight ? { fight: validateFight(raw.fight, file, `${where} fight`) } : {}),
      ...(raw.buffId ? { buffId: raw.buffId } : {}),
    };
  });

  // The path. Authored, so every door is checked against the rooms that exist
  // — a typo here is a live raid walking into nothing four rounds in, and this
  // is the last place it can be caught cheaply.
  if (!Array.isArray(obj.path) || obj.path.length === 0) {
    fail(file, `"path" must be a non-empty array - a raid with no path has no rounds`);
  }
  const known = new Set(rooms.map((r) => r.id));
  const path = obj.path.map((raw: any, i: number) => {
    if (typeof raw !== "object" || raw === null) fail(file, `raid "${id}" path[${i}] must be an object`);
    const step: any = {};
    for (const dir of PATH_DIRECTIONS) {
      const roomId = raw[dir];
      if (typeof roomId !== "string" || roomId === "") {
        fail(file, `raid "${id}" path[${i}] is missing "${dir}"`);
      }
      if (!known.has(roomId)) {
        fail(file, `raid "${id}" path[${i}].${dir} points at "${roomId}", which is not one of its rooms`);
      }
      step[dir] = roomId;
    }
    return step as RaidStep;
  });

  // A room nobody can reach is authored work that will never be seen. Not an
  // error — parking a room mid-edit is normal — but worth saying out loud,
  // because the old model made it visible as a zero weight and this one hides
  // it completely.
  const reachable = new Set(path.flatMap((st: RaidStep) => PATH_DIRECTIONS.map((d) => st[d])));
  const stranded = rooms.filter((r) => !reachable.has(r.id)).map((r) => r.id);
  if (stranded.length > 0) {
    console.warn(`[content:${file}] rooms off the path, never reachable: ${stranded.join(", ")}`);
  }

  const boss = obj.boss;
  if (typeof boss !== "object" || boss === null) fail(file, `"boss" must be an object`);
  if (!isNumber(boss.hpMultiplier) || boss.hpMultiplier <= 0) fail(file, `"boss.hpMultiplier" must be > 0`);
  if (!isNumber(boss.atkMultiplier) || boss.atkMultiplier <= 0) fail(file, `"boss.atkMultiplier" must be > 0`);
  if (typeof boss.fight !== "object" || boss.fight === null) fail(file, `"boss.fight" must be an object`);
  const bossId = requireString(boss, "id", file);
  if (seen.has(bossId)) fail(file, `boss id "${bossId}" collides with a room id in raid "${id}"`);

  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    fail(file, `"enabled" must be true or false`);
  }

  return {
    id,
    name,
    ...(obj.enabled === false ? { enabled: false } : {}),
    recommendedLevel: requireNumber(obj, "recommendedLevel", file),
    joinWindowMs: requireNumber(obj, "joinWindowMs", file),
    path,
    buffs,
    rooms,
    boss: {
      id: bossId,
      name: requireString(boss, "name", file),
      description: requireString(boss, "description", file),
      kind: "fight",
      background: boss.background,
      fight: validateFight(boss.fight, file, `raid "${id}" boss`),
      hpMultiplier: boss.hpMultiplier,
      atkMultiplier: boss.atkMultiplier,
    },
    completionXp: requireNumber(obj, "completionXp", file),
    completionGold: requireRange(obj, "completionGold", file),
    flavorText: obj.flavorText,
  };
}


/**
 * The part of a fight that says who is in it.
 *
 * Shared by dungeons and by every fight inside a raid, because a fight is a
 * fight: the same base block, the same loot table, the same bodies per band.
 * There is no separate encounter file to validate any more — see
 * FightDefinition in types.ts for why that concept was folded in.
 */
function validateFight(obj: any, file: string, what: string): FightDefinition {
  const kind = obj.kind ?? "mob";
  if (kind !== "mob" && kind !== "boss") fail(file, `${what}: "kind" must be "mob" or "boss", got "${kind}"`);
  const stats = requireStats(obj, "stats", file);
  const loot = validateLoot(obj.loot, file);
  if (!Array.isArray(obj.goldReward) || obj.goldReward.length !== 2 || !isNumber(obj.goldReward[0]) || !isNumber(obj.goldReward[1])) {
    fail(file, `${what}: "goldReward" must be a [min, max] number tuple`);
  }
  const xpReward = requireNumber(obj, "xpReward", file);

  if (typeof obj.formations !== "object" || obj.formations === null || Array.isArray(obj.formations)) {
    fail(file, `${what}: "formations" must be an object keyed by party band`);
  }
  const formations: Formations = {};
  for (const [band, units] of Object.entries(obj.formations as Record<string, unknown>)) {
    if (!PARTY_BANDS.includes(band as never)) {
      fail(file, `${what}: "formations" has unknown band "${band}" - expected ${PARTY_BANDS.join(", ")}`);
    }
    if (!Array.isArray(units)) fail(file, `${what}: "formations.${band}" must be an array of units`);
    for (const u of units as Record<string, any>[]) {
      if (typeof u?.id !== "string" || typeof u?.sprite !== "string") {
        fail(file, `${what}: every unit in "formations.${band}" needs an id and a sprite`);
      }
      // Role is OPTIONAL. A body without one gets no role scaling, no skill
      // floor and no threat multiplier — genuinely weaker, and that is what a
      // counted body used to be. Kept expressible so the merge could preserve
      // every fight's difficulty exactly.
      if (u.role !== undefined && !ROLES.includes(u.role as never)) {
        fail(file, `${what}: unit "${String(u.id)}" has role "${String(u.role)}" - expected ${ROLES.join(", ")}`);
      }
      if (u.kind !== undefined && u.kind !== "mob" && u.kind !== "boss") {
        fail(file, `${what}: unit "${String(u.id)}" has kind "${String(u.kind)}" - expected mob or boss`);
      }
      if (u.name !== undefined && typeof u.name !== "string") {
        fail(file, `${what}: unit "${String(u.id)}" has a non-string name`);
      }
      if (u.weight !== undefined && (typeof u.weight !== "number" || u.weight <= 0)) {
        fail(file, `${what}: unit "${String(u.id)}" has a non-positive weight`);
      }
      // Validated because it multiplies a body's hp and attack: a typo that
      // became `undefined` would silently turn a boss back into a villager,
      // and a zero would put an unkillable-because-harmless body on stage.
      if (u.strength !== undefined && (typeof u.strength !== "number" || !Number.isFinite(u.strength) || u.strength <= 0)) {
        fail(file, `${what}: unit "${String(u.id)}" has a non-positive strength`);
      }
      if (u.xpReward !== undefined && !isNumber(u.xpReward)) {
        fail(file, `${what}: unit "${String(u.id)}" has a non-numeric xpReward`);
      }
      if (u.stats !== undefined) optionalPartialStats(u, "stats", file);
      if (u.loot !== undefined) validateLoot(u.loot, file);
      for (const k of ["x", "y"]) {
        if (typeof u[k] !== "number" || u[k] < -0.5 || (u[k] as number) > 1.5) {
          fail(file, `${what}: unit "${String(u.id)}" needs a numeric ${k} roughly within 0..1`);
        }
      }
    }
    (formations as any)[band] = units;
  }

  // Optional per-band stat curve. Validated here rather than trusted, because
  // an unvalidated field is one that silently becomes `undefined` in
  // production (AGENTS.md §3) — and this one multiplies every enemy in the
  // fight, so a typo'd band name would quietly halve a night's difficulty.
  let bandStatScale: Partial<Record<PartyBand, number>> | undefined;
  if (obj.bandStatScale !== undefined) {
    if (typeof obj.bandStatScale !== "object" || obj.bandStatScale === null || Array.isArray(obj.bandStatScale)) {
      fail(file, `${what}: "bandStatScale" must be an object keyed by party band`);
    }
    bandStatScale = {};
    for (const [band, value] of Object.entries(obj.bandStatScale as Record<string, unknown>)) {
      if (!(PARTY_BANDS as readonly string[]).includes(band)) {
        fail(file, `${what}: "bandStatScale" has unknown band "${band}" - expected ${PARTY_BANDS.join(", ")}`);
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        fail(file, `${what}: "bandStatScale.${band}" must be a positive number`);
      }
      (bandStatScale as Record<string, number>)[band] = value as number;
    }
  }

  // The target is a win RATE, so it has to be one. Outside 0.05..0.95 the
  // solver is being asked for a fight nobody ever wins or nobody ever loses,
  // and it would dutifully push every level to its floor or ceiling trying.
  let targetWinRate: number | undefined;
  if (obj.targetWinRate !== undefined) {
    if (typeof obj.targetWinRate !== "number" || obj.targetWinRate < 0.05 || obj.targetWinRate > 0.95) {
      fail(file, `${what}: "targetWinRate" must be a number between 0.05 and 0.95`);
    }
    targetWinRate = obj.targetWinRate as number;
  }

  return {
    kind,
    stats,
    loot,
    goldReward: [obj.goldReward[0], obj.goldReward[1]],
    xpReward,
    formations,
    ...(bandStatScale ? { bandStatScale } : {}),
    ...(targetWinRate !== undefined ? { targetWinRate } : {}),
  };
}
