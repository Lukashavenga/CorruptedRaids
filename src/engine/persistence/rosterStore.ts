import type { Character, GearInstance, GearSlot, SealedChest } from "../types.js";
import { GEAR_SLOTS } from "../types.js";

/**
 * Where the roster lives between runs.
 *
 * ONE INTERFACE, SEVERAL BACKINGS. A JSON file is enough today and needs no
 * dependencies, no account and no network; Supabase is what this becomes when
 * the game is hosted. Both are the same two methods, so the swap is a
 * constructor argument in the server and nothing else moves — which is the
 * same reason `Roster` was written as the only place characters are created
 * or looked up (see roster.ts).
 *
 * WHY WRITE-BEHIND AND NOT WRITE-THROUGH
 * --------------------------------------
 * These are async and the engine is not. `Roster.get()` is called from inside
 * `GameEngine.dispatch()`, which is called from the combat resolver and from a
 * state-machine transition handler, all synchronous. Making the roster async
 * would turn every one of those async too — the entire engine, the resolver,
 * the simulator and every test — to put a network round-trip inside a combat
 * tick, which is the last place anyone wants one.
 *
 * So the in-memory Map stays the source of truth WHILE THE SERVER IS UP, and
 * this is a durable copy of it: hydrated once at boot, written back after
 * changes. A crash can therefore lose the last unsaved moment, which is why
 * the save is debounced in seconds rather than minutes and flushed on
 * shutdown.
 */
export interface RosterStore {
  /** Every character on record. Called once, before the server accepts traffic. */
  load(): Promise<Character[]>;

  /** Replaces the stored roster wholesale. Must be atomic — a torn write loses everyone. */
  save(characters: Character[]): Promise<void>;

  /**
   * A named, restorable copy. Returns the snapshot's id.
   *
   * Separate from `save` because they answer different questions: `save` is
   * "don't lose this", a snapshot is "let me go back to this". The admin panel
   * takes one before anything destructive.
   */
  snapshot(label: string): Promise<string>;

  /** Snapshots, newest first. */
  listSnapshots(): Promise<SnapshotInfo[]>;

  /** The roster as it was in a snapshot. Does NOT install it — the caller decides. */
  readSnapshot(id: string): Promise<Character[]>;

  /**
   * Flags who is mid-fight, so a second writer can refuse edits.
   *
   * OPTIONAL, because it only means something when something else can write.
   * The file store is the only writer of its file and implements nothing;
   * Supabase is shared with the hosted loadout, where a viewer unequipping
   * their armour between the resolver reading their stats and the fight
   * ending would put the result on screen out of step with the character
   * everyone can see.
   */
  setInRun?(ids: string[], inRun: boolean): Promise<void>;

  /**
   * Releases every in-run flag, whoever set it. Called at boot: a server that
   * stopped mid-run - the console closed at the end of a stream, a crash -
   * left its party flagged, and only this server ever clears the flag, for
   * the ids it locked itself. Those viewers were refused every loadout edit
   * until they happened to fight again.
   */
  clearRunLocks?(): Promise<void>;

  /**
   * Picks up characters another writer has changed since this server last
   * read or wrote them.
   *
   * OPTIONAL for the same reason as `setInRun`: only a store with a second
   * writer has anything to pull. Without it the server reads the roster once at
   * boot, so a viewer's loadout edit never reached a fight - and the server's
   * next save of that character wrote its stale copy back over the edit.
   *
   * `live` is the server's own copy. A fresh row is offered to `install` only
   * when that copy has not changed since it was last read or saved: if both
   * sides moved, the server's change (a fight's rewards) is kept and the row is
   * reported as a conflict. `install` runs synchronously and says whether it
   * took the character; only a taken one becomes the new baseline.
   */
  pull?(
    ids: readonly string[],
    live: (id: string) => Character | undefined,
    install: (fresh: Character) => boolean,
  ): Promise<PullResult>;
}

export interface PullResult {
  installed: string[];
  /** Changed on both sides since the last save; the server's copy was kept. */
  conflicts: string[];
}

export interface SnapshotInfo {
  id: string;
  label: string;
  /** Epoch ms. */
  takenAt: number;
  characters: number;
}

/** The shape written to disk. Versioned so a future migration has something to branch on. */
export interface RosterFile {
  version: 1;
  savedAt: number;
  characters: Character[];
}

export const ROSTER_FILE_VERSION = 1;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Turns whatever was on disk back into characters, dropping what it cannot
 * trust and saying so.
 *
 * TOLERANT ON PURPOSE. This is player data, not content: content that fails
 * validation should stop the server, because a broken dungeon is a bug to fix
 * before anyone plays it. A single unreadable character is not worth refusing
 * to start a stream over — the right behaviour is to keep the other four
 * hundred and be loud about the one.
 *
 * `onWarn` gets every drop. The server logs them; a test can assert on them.
 */
export function parseRoster(raw: unknown, onWarn: (message: string) => void): Character[] {
  if (!isRecord(raw)) {
    onWarn("roster file is not an object - starting empty");
    return [];
  }
  if (raw.version !== ROSTER_FILE_VERSION) {
    onWarn(`roster file is version ${String(raw.version)}, expected ${ROSTER_FILE_VERSION} - starting empty`);
    return [];
  }
  if (!Array.isArray(raw.characters)) {
    onWarn("roster file has no characters array - starting empty");
    return [];
  }

  const out: Character[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.characters.entries()) {
    const c = asCharacter(entry, i, onWarn);
    if (!c) continue;
    if (seen.has(c.id)) {
      onWarn(`duplicate character id "${c.id}" - keeping the first`);
      continue;
    }
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function asCharacter(raw: unknown, index: number, onWarn: (m: string) => void): Character | null {
  if (!isRecord(raw)) {
    onWarn(`character[${index}] is not an object - dropped`);
    return null;
  }
  const id = raw.id;
  if (typeof id !== "string" || id === "") {
    onWarn(`character[${index}] has no id - dropped`);
    return null;
  }

  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  // Rebuilt rather than passed through, so inventory and equipment read an
  // instance the same way. `source` is the field this has to remember: the
  // equipment branch once rebuilt `{ instanceId, gearId }` and nothing else,
  // so a bought sword that was worn across a save came back as loot and sold
  // for a tenth. Anything but "shop" is left off, which reads as loot.
  const instance = (g: unknown): GearInstance | null =>
    isRecord(g) && typeof g.instanceId === "string" && typeof g.gearId === "string"
      ? {
          instanceId: g.instanceId,
          gearId: g.gearId,
          ...(g.source === "shop" || g.source === "loot" ? { source: g.source } : {}),
        }
      : null;
  const instances = (v: unknown): GearInstance[] =>
    Array.isArray(v) ? v.map(instance).filter((g): g is GearInstance => g !== null) : [];
  const sealedChests = (v: unknown): SealedChest[] =>
    Array.isArray(v)
      ? v
          .filter(
            (c): c is { id: string; gearId: string; at?: unknown; from?: unknown } =>
              isRecord(c) && typeof c.id === "string" && typeof c.gearId === "string",
          )
          .map((c) => ({
            id: c.id,
            gearId: c.gearId,
            // An undated chest still opens; it just sorts oldest. Dropping it
            // for a missing timestamp would cost somebody an item over a
            // sorting key.
            at: typeof c.at === "number" && Number.isFinite(c.at) ? c.at : 0,
            ...(typeof c.from === "string" ? { from: c.from } : {}),
          }))
      : [];

  const equipment: Character["equipment"] = {};
  if (isRecord(raw.equipment)) {
    for (const [slot, g] of Object.entries(raw.equipment)) {
      const worn = instance(g);
      if (worn) equipment[slot as keyof Character["equipment"]] = worn;
    }
  }

  const consumables: Record<string, number> = {};
  if (isRecord(raw.consumables)) {
    for (const [k, v] of Object.entries(raw.consumables)) {
      if (typeof v === "number" && v > 0) consumables[k] = v;
    }
  }

  const appearance = isRecord(raw.appearance) ? raw.appearance : {};

  return {
    id,
    name: typeof raw.name === "string" && raw.name !== "" ? raw.name : id,
    level: Math.max(1, Math.floor(num(raw.level, 1))),
    xp: Math.max(0, num(raw.xp, 0)),
    gold: Math.max(0, num(raw.gold, 0)),
    role: raw.role === "tank" || raw.role === "healer" ? raw.role : "dps",
    allocated: {
      hp: Math.max(0, num(isRecord(raw.allocated) ? raw.allocated.hp : 0, 0)),
      atk: Math.max(0, num(isRecord(raw.allocated) ? raw.allocated.atk : 0, 0)),
      skill: Math.max(0, num(isRecord(raw.allocated) ? raw.allocated.skill : 0, 0)),
      spd: Math.max(0, num(isRecord(raw.allocated) ? raw.allocated.spd : 0, 0)),
    },
    unspentPoints: Math.max(0, num(raw.unspentPoints, 0)),
    consumables,
    equipment,
    inventory: instances(raw.inventory),
    // Defaulted, not required: rosters written before sealed drops existed
    // have no `chests` at all and must still load rather than losing the
    // character. Malformed entries are dropped individually for the same
    // reason the gear pruning below drops unknown ids — one bad row should
    // not cost somebody their whole bag.
    chests: sealedChests(raw.chests),
    appearance: {
      bodyType: appearance.bodyType === "female" ? "female" : "male",
      skinTone: typeof appearance.skinTone === "string" ? appearance.skinTone : "sand",
      hair: typeof appearance.hair === "string" ? appearance.hair : null,
    },
    // Copied explicitly, like every field above, because this rebuilds a
    // character rather than trusting the row. It was missing: every character
    // the server loaded lost it, and the server's next save of them wrote that
    // back - so the loadout offered character creation again to anyone who had
    // fought since the game started saving to Supabase.
    ...(raw.appearanceChosen === true ? { appearanceChosen: true } : {}),
    // The same trap, closed the day the field was added: anything left off
    // this list is wiped by the server's next save of the character.
    ...hiddenSlotsOf(raw.hiddenSlots),
  };
}

function hiddenSlotsOf(v: unknown): { hiddenSlots?: GearSlot[] } {
  if (!Array.isArray(v)) return {};
  const hidden = GEAR_SLOTS.filter((slot) => v.includes(slot));
  return hidden.length > 0 ? { hiddenSlots: hidden } : {};
}

/**
 * Drops gear a character owns that the content no longer defines.
 *
 * This WILL happen: the admin panel can delete and rename gear, and it rewrites
 * the content that references an item without touching the people carrying one.
 * A held id that no longer resolves is not fatal — every lookup is already
 * `?? undefined` — but it is an item that shows as a blank forever, so it is
 * better removed loudly at boot than left to confuse someone mid-stream.
 *
 * Returns how many were dropped, per character, for the caller to report.
 */
export function pruneUnknownGear(
  characters: Character[],
  knows: (gearId: string) => boolean,
  onWarn: (message: string) => void,
): number {
  let dropped = 0;
  for (const c of characters) {
    const before = c.inventory.length;
    c.inventory = c.inventory.filter((g) => knows(g.gearId));
    dropped += before - c.inventory.length;

    for (const [slot, equipped] of Object.entries(c.equipment)) {
      if (equipped && !knows(equipped.gearId)) {
        delete c.equipment[slot as keyof Character["equipment"]];
        dropped += 1;
      }
    }
    // Sealed chests too, and this one is not cosmetic: `open_chest` calls
    // `getGear` on the way out, so a chest holding a deleted id would throw
    // on the one click the player was looking forward to.
    const chests = c.chests ?? [];
    const chestsBefore = chests.length;
    if (chestsBefore > 0) {
      c.chests = chests.filter((chest) => knows(chest.gearId));
      dropped += chestsBefore - c.chests.length;
    }

    const lost = before - c.inventory.length + (chestsBefore - (c.chests?.length ?? 0));
    if (lost > 0) onWarn(`${c.name} lost ${lost} item(s) whose gear no longer exists`);
  }
  return dropped;
}
