import { RARITIES, type CombatEvent, type CombatResult, type Rarity } from "../engine/types.js";

/**
 * Per-event-type pacing of the overlay's fight replay, in ms. Tuning the felt
 * speed of a fight happens here.
 *
 * Roughly doubled from the first pass. The old timings resolved a fight fast,
 * but on a 450x250 overlay a viewer is reading a line of text AND watching for
 * their own name in the roster AND tracking two health bars — and every line
 * was gone before any of that could land. A raid that takes longer to watch is
 * the point; the spectacle is the product, not the throughput.
 *
 * `down` and `outcome` get the longest holds because they are the beats an
 * audience reacts to.
 *
 * It lives here rather than in the overlay because the server has to know it
 * too: how long `results` holds is how long this replay takes. The server used
 * to estimate that at a flat 240ms per event while this table was doubled
 * beside it, and `tick` - one per turn, free to replay - was billed like an
 * attack. The hold came out at about half the replay, so every fight left
 * `results` before the overlay reached its outcome and the result was never
 * shown. One table, read by both, cannot drift like that.
 *
 * Keyed by event type so a new kind of event does not compile until somebody
 * has decided how long it takes to watch.
 */
export const REPLAY_PACING: Record<Exclude<CombatEvent["type"], "tick">, number> = {
  attack: 750,
  heal: 800,
  ability: 1100,
  down: 1400,
  loot: 950,
  reward: 700,
  levelUp: 1200,
  outcome: 1600,
};

/** The beat before the first event, so the opening blow does not land on the first frame. */
export const REPLAY_LEAD_IN_MS = 250;

/**
 * Past this many members, what comes after the outcome is summarised.
 *
 * Every member used to get a reward line, a loot line and a line per level,
 * and with a real chat that tail WAS the replay: measured 2026-10-22 over 100
 * fights a size, it was 56% of a 25-viewer replay (80s) and 73% of a
 * 100-viewer one (318s), against a fight of one to two minutes. Nobody finds
 * their own name in a log scrolling for five minutes, and the stage cannot
 * take the next run until it ends. Six and under is unchanged: that tail is a
 * few seconds and naming everyone in it is the nice part.
 */
export const SUMMARISE_PAST = 6;
/** Drops of these rarities are still named in a summarised tail - they are the ones worth announcing. */
const NAMED_RARITIES: ReadonlySet<Rarity> = new Set(["rare", "epic", "legendary"]);
/** At most this many drops are named; the rest are one "+N more loot" line. */
export const NAMED_DROPS = 4;

/**
 * How long the fight itself, lead-in to outcome, may take to watch.
 *
 * A fight that would run longer has its attacks, heals and abilities sped up
 * evenly to fit - not progressively, so it does not change tempo halfway
 * through. Downs and the outcome keep their full beats: they are what the
 * audience reacts to, and they are few. Measured, this only touches big
 * parties and the occasional long small one (a five-viewer barbie fight ran
 * 160s).
 */
export const FIGHT_BUDGET_MS = 60_000;
/**
 * The fastest an attack may play, however far over budget the fight is.
 *
 * Below this a line is gone before it can be read, and the 3D arena's
 * announce-then-land (ACTION_LEAD_MS, 240) needs room before the next blow.
 * A fight still over budget at this floor simply runs long.
 */
export const MIN_ATTACK_BEAT_MS = 400;
const COMPRESSIBLE: ReadonlySet<CombatEvent["type"]> = new Set(["attack", "heal", "ability"]);

type PlayedEvent = Exclude<CombatEvent, { type: "tick" }>;

/** One thing the replay shows, and how long it holds before the next. */
export type ReplayBeat = { ms: number } & (
  | { kind: "event"; event: PlayedEvent }
  /** Everyone paid the same XP for the same reason, as one line. */
  | { kind: "rewardGroup"; count: number; xp: number; survived: boolean }
  /** The drops a summarised tail did not name. */
  | { kind: "lootRest"; count: number }
  /** Everyone who levelled, as one line. */
  | { kind: "levelGroup"; count: number }
);

export type ReplayInput = Pick<CombatResult, "combatants" | "events" | "survivorIds">;

/**
 * The replay, as the overlay plays it: what is shown, in order, and for how
 * long.
 *
 * THE ONE PLACE the replay's shape is decided. useCombatPlayback draws these
 * beats and the server holds `results` for their sum (replayLengthMs), so a
 * pacing change made here is made on both sides of the wire at once. Pure on
 * the event log on purpose - nothing it reads can differ between the two.
 */
export function replayBeats(combat: ReplayInput): ReplayBeat[] {
  const played = combat.events.filter((e): e is PlayedEvent => e.type !== "tick");
  const end = played.findIndex((e) => e.type === "outcome");
  const fight = end === -1 ? played : played.slice(0, end + 1);
  const tail = end === -1 ? [] : played.slice(end + 1);
  return [...fightBeats(fight), ...tailBeats(tail, combat)];
}

/** How long the overlay takes to replay this fight, start to finish. */
export function replayLengthMs(combat: ReplayInput | null | undefined): number {
  if (!combat) return REPLAY_LEAD_IN_MS;
  return replayBeats(combat).reduce((total, beat) => total + beat.ms, REPLAY_LEAD_IN_MS);
}

function fightBeats(fight: PlayedEvent[]): ReplayBeat[] {
  let paced = 0;
  let fixed = REPLAY_LEAD_IN_MS;
  for (const event of fight) {
    if (COMPRESSIBLE.has(event.type)) paced += REPLAY_PACING[event.type];
    else fixed += REPLAY_PACING[event.type];
  }
  const room = FIGHT_BUDGET_MS - fixed;
  const scale = paced <= room ? 1 : Math.max(MIN_ATTACK_BEAT_MS / REPLAY_PACING.attack, room / paced);
  return fight.map((event) => ({
    kind: "event",
    event,
    ms: COMPRESSIBLE.has(event.type) ? Math.round(REPLAY_PACING[event.type] * scale) : REPLAY_PACING[event.type],
  }));
}

function tailBeats(tail: PlayedEvent[], combat: ReplayInput): ReplayBeat[] {
  const partySize = combat.combatants.filter((c) => c.side === "party").length;
  const asEvent = (event: PlayedEvent): ReplayBeat => ({ kind: "event", event, ms: REPLAY_PACING[event.type] });
  if (partySize <= SUMMARISE_PAST) return tail.map(asEvent);

  const beats: ReplayBeat[] = [];
  const survivors = new Set(combat.survivorIds);

  // XP is the fight's total times a share that depends only on how the member
  // came out of it (resolver.ts), so this is two lines at most. Gold is not
  // summarised: it is rolled per member and has no one number to print.
  const groups = new Map<string, { count: number; xp: number; survived: boolean }>();
  for (const event of tail) {
    if (event.type !== "reward") continue;
    const survived = survivors.has(event.characterId);
    const key = `${survived}:${event.xp}`;
    const group = groups.get(key) ?? { count: 0, xp: event.xp, survived };
    group.count += 1;
    groups.set(key, group);
  }
  for (const group of [...groups.values()].sort((a, b) => Number(b.survived) - Number(a.survived))) {
    beats.push({ kind: "rewardGroup", ...group, ms: REPLAY_PACING.reward });
  }

  // Best first, so a cap of four keeps the four worth having. A tail with
  // nothing rare still names its best drop: "+16 more loot" with nothing
  // before it reads as a line with its subject missing.
  const loot = tail
    .filter((e): e is Extract<PlayedEvent, { type: "loot" }> => e.type === "loot")
    .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
  let named = loot.filter((e) => NAMED_RARITIES.has(e.rarity)).slice(0, NAMED_DROPS);
  if (named.length === 0) named = loot.slice(0, 1);
  beats.push(...named.map(asEvent));
  if (loot.length > named.length) beats.push({ kind: "lootRest", count: loot.length - named.length, ms: REPLAY_PACING.loot });

  // One member levelling is still their own line, at the level they reached -
  // there is nothing to summarise, and "1 corrupt further" is not English.
  const levels = tail.filter((e): e is Extract<PlayedEvent, { type: "levelUp" }> => e.type === "levelUp");
  const levelled = new Set(levels.map((e) => e.characterId));
  if (levelled.size === 1) beats.push(asEvent(levels[levels.length - 1]!));
  else if (levelled.size > 1) beats.push({ kind: "levelGroup", count: levelled.size, ms: REPLAY_PACING.levelUp });

  // Nothing else follows an outcome today. Anything that one day does is
  // played as it is rather than silently dropped from the summary.
  beats.push(...tail.filter((e) => e.type !== "reward" && e.type !== "loot" && e.type !== "levelUp").map(asEvent));
  return beats;
}
