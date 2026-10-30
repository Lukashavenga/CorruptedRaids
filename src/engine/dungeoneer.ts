import type { BalanceConfig } from "./balance.js";
import type { Character } from "./types.js";

/**
 * The Dungeoneer of the day: whoever has survived the most runs today.
 *
 * Survived means the run was WON and the viewer was standing at the end of
 * it - the same line the payouts draw between a survivor and a casualty. A
 * raid is one run, judged at its boss. Characters from `sim_join` never
 * qualify: a sim party is the operator testing, and a title chat competes
 * for cannot go to a viewer who does not exist (the balance log draws the
 * same line with its `sim` tag).
 *
 * The holder is DERIVED from the roster rather than stored, for the reason
 * Corruption is (AGENTS.md §2): a stored holder is a second copy that can
 * disagree with the counts it was taken from. Each character carries its own
 * count for the day, so the roster store keeps the title across a restart
 * without a table of its own.
 */

export type DungeoneerConfig = BalanceConfig["dungeoneer"];

export interface Dungeoneer {
  id: string;
  name: string;
  survived: number;
}

/**
 * The day an instant belongs to, as the local date on which that day began.
 *
 * Read off the wall clock in the configured zone, never computed from an
 * offset: Amsterdam is UTC+1 in winter and UTC+2 in summer, and a fixed
 * offset puts the reset at 10:00 or 12:00 for half the year. Subtracting the
 * reset hour from the INSTANT is wrong too, on the two days a year the clocks
 * change - the hours between midnight and 11:00 are then 10 or 12 long.
 */
export function dayKey(at: number, cfg: DungeoneerConfig): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Before the reset hour it is still yesterday's day. Date.UTC is only date
  // arithmetic here - rolling day 1 back to the last of the previous month -
  // and no zone is involved in it.
  const back = part("hour") < cfg.resetHour ? 1 : 0;
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") - back)).toISOString().slice(0, 10);
}

/** Whether a character can hold the title at all. */
export function qualifies(character: Character): boolean {
  return !character.id.startsWith("sim:");
}

/** A character's count for `day`: zero if their tally belongs to another day. */
function survivedOn(character: Character, day: string): number {
  return character.daily?.day === day ? character.daily.survived : 0;
}

/**
 * Orders by who leads: most survived, then whoever got there first.
 *
 * "First" is `reachedAt`, the moment the count was last raised, so a viewer
 * who draws level does not take the title from the one already holding it -
 * a title that flipped on every tie would mean nothing. The id is the last
 * resort only so the order is total.
 */
function ahead(day: string) {
  return (a: Character, b: Character): number =>
    survivedOn(b, day) - survivedOn(a, day) ||
    (a.daily?.reachedAt ?? 0) - (b.daily?.reachedAt ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Adds one survived run to each of `survivors`, at `at`.
 *
 * All of one fight's survivors reach their new count at the same moment, so a
 * shared timestamp could not say who got there first. They are stamped one
 * millisecond apart in the order they stood BEFORE the fight instead, which
 * keeps the tie rule: two viewers level on three who both survive are level on
 * four, and the one who led at three still leads.
 */
export function recordSurvivals(survivors: Character[], at: number, cfg: DungeoneerConfig): void {
  const day = dayKey(at, cfg);
  const counted = survivors.filter(qualifies).sort(ahead(day));
  counted.forEach((character, i) => {
    character.daily = { day, survived: survivedOn(character, day) + 1, reachedAt: at + i };
  });
}

/** Today's holder, or null when nobody real has survived a run today. */
export function dungeoneerOf(characters: Iterable<Character>, at: number, cfg: DungeoneerConfig): Dungeoneer | null {
  const day = dayKey(at, cfg);
  let best: Character | null = null;
  const order = ahead(day);
  for (const character of characters) {
    if (!qualifies(character) || survivedOn(character, day) === 0) continue;
    if (best === null || order(character, best) < 0) best = character;
  }
  return best ? { id: best.id, name: best.name, survived: survivedOn(best, day) } : null;
}
