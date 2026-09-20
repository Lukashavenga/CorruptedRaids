import type { Character, Role } from "./types.js";
import { createCharacter, grantGear, SKIN_TONES } from "./character.js";

/**
 * Hair sprite ids from art/sprites/hair, cycled so a crowd looks like people
 * rather than clones. Players choose their own on the loadout screen; this is
 * only what they start as.
 *
 * A subset rather than all forty: these are the styles that read at overlay
 * size, where a figure is 128px and hair is a few dozen pixels of it.
 */
const STARTER_HAIR = [
  "s01-brown", "s02-blonde", "s03-red", "s04-violet", "s05-brown",
  "s06-blonde", "s07-red", "s08-violet", "s09-brown", "s10-blonde",
];

/**
 * What a brand-new character finds in their bags.
 *
 * A TESTING AFFORDANCE, and deliberately obvious as one. Everything here is a
 * common, level-1 item, so it changes nothing about progression — but without
 * it a fresh character has an empty inventory and there is no way to exercise
 * equipping, hiding, or the placement art without hand-granting gear over HTTP
 * first. Delete this constant to ship an empty-handed start.
 */
const STARTER_KIT = [
  "crusader-helm",
  "strapped-harness",
  "worn-breeches",
  "rusty-dagger",
  "pitch-torch",
];

/**
 * Every viewer's character, keyed by viewer id.
 *
 * This replaces the scaffold's single `hero: Hero` (AGENTS.md §3) and is the
 * structural change everything else in the concept doc depends on.
 *
 * STILL A MAP, AND DELIBERATELY SO. Durability lives behind `RosterStore`
 * (persistence/rosterStore.ts) and works as a write-behind: this Map is
 * hydrated once at boot and is the source of truth while the process is up,
 * with changes written back after the fact. The alternative — reading through
 * to a database — would make `get()` async, and `get()` is called from inside
 * the synchronous combat resolver. Nobody wants a network round-trip in a
 * combat tick.
 *
 * That is why this class stays the only place characters are created or looked
 * up: hydration and serialisation are two more methods here, not a change
 * everywhere else.
 */
export class Roster {
  private characters = new Map<string, Character>();

  /** Returns the existing character for `viewerId`, or creates one. */
  ensure(viewerId: string, name: string, role: Role): Character {
    const existing = this.characters.get(viewerId);
    if (existing) return existing;
    const character = createCharacter({
      id: viewerId,
      name,
      role,
      // Cycle both axes by join order so a party reads as distinct people.
      // Players pick their own on the loadout screen.
      appearance: {
        bodyType: this.characters.size % 2 === 0 ? "male" : "female",
        skinTone: SKIN_TONES[this.characters.size % SKIN_TONES.length]!.id,
        hair: STARTER_HAIR[this.characters.size % STARTER_HAIR.length]!,
      },
    });
    // Granting rather than equipping: the point is to have something to put on,
    // and a character that arrives pre-dressed hides exactly the bugs this is
    // meant to surface.
    for (const gearId of STARTER_KIT) grantGear(character, gearId);
    this.characters.set(viewerId, character);
    return character;
  }

  get(viewerId: string): Character | undefined {
    return this.characters.get(viewerId);
  }

  has(viewerId: string): boolean {
    return this.characters.has(viewerId);
  }

  list(): Character[] {
    return [...this.characters.values()];
  }

  get size(): number {
    return this.characters.size;
  }

  remove(viewerId: string): boolean {
    return this.characters.delete(viewerId);
  }

  /**
   * Fills the roster from storage, replacing whatever is here.
   *
   * Called once, before the server accepts traffic. Replacing rather than
   * merging is the honest behaviour for a restore: half the old roster and
   * half a snapshot is a state nobody asked for and nobody can reason about.
   */
  hydrate(characters: Character[]): void {
    this.characters.clear();
    for (const c of characters) this.characters.set(c.id, c);
  }

  /**
   * Everything worth saving.
   *
   * The live objects, not copies — the caller serialises them immediately and
   * the engine mutates them in place, so cloning here would only be a lie
   * about isolation that costs an allocation per character per save.
   */
  snapshot(): Character[] {
    return [...this.characters.values()];
  }

  clear(): void {
    this.characters.clear();
  }
}
