import type { AllocatableStat, CharacterAppearance, GearSlot, PathDirection, Role } from "../types.js";

/**
 * GameCommand is the *only* way anything outside the engine mutates state.
 * This is the seam that makes Twitch integration a later, isolated task:
 * a Twitch EventSub handler (channel point redemption, bits cheer, etc.)
 * just needs to translate a Twitch event into one of these commands and
 * call dispatch(). Nothing in the engine needs to know Twitch exists.
 *
 * `requestedBy` is the viewer's platform identity and is what keys the
 * character roster — it is REQUIRED on anything character-scoped, because
 * "which viewer is this" stopped being ignorable the moment the engine grew
 * past a single shared hero (AGENTS.md §2.2).
 */
export type GameCommand =
  /** Opens the join window for a dungeon run. Nobody is in the party yet. */
  | { type: "open_dungeon"; dungeonId: string; requestedBy?: string }
  /** A viewer joins the open run. Creates their character on first ever join. */
  | { type: "join_dungeon"; requestedBy: string; displayName?: string; role?: Role }
  /** Locks the party and resolves the fight. Fired by the streamer's button, or by the join timer. */
  | { type: "start_dungeon"; requestedBy?: string }
  /** Clears the run and returns the overlay to idle. */
  | { type: "reset_dungeon"; requestedBy?: string }
  /**
   * Opens a RAID's join window. Same shape as open_dungeon because a raid is a
   * run like any other from the outside; what differs is that it resolves as
   * several rounds instead of one fight.
   */
  | { type: "open_raid"; raidId: string; requestedBy?: string }
  /**
   * Opens one of the three doors. The seam a chat vote plugs into: whatever
   * decides the direction — a streamer button now, a tally of !left/!up/!right
   * later — reduces to this one command.
   */
  | { type: "choose_path"; direction: PathDirection; requestedBy?: string }
  /**
   * Walks into the room the party just had revealed to them, resolving its
   * fight.
   *
   * Split out of `choose_path` so that opening a door and fighting what is
   * behind it are two beats rather than one. `choose_path` now only opens the
   * door and names the room; the reveal plays; then this runs the fight. The
   * controller fires it off the reveal timer, so nothing outside has to know
   * the sequence — but it is a command, not a private method, because it
   * mutates the run and the mutation seam is this union (AGENTS.md).
   */
  | { type: "enter_room"; requestedBy?: string }
  /** Starts the boss fight once the rounds are done. */
  | { type: "start_boss"; requestedBy?: string }
  /**
   * Fills the join window with N fake viewers. A testing affordance for the
   * on-stream sim — the real path is N join_dungeon commands from Twitch.
   */
  /**
   * `dress` puts the fake viewers in random gear at a random Corruption.
   *
   * Opt-in, and off by default, because the two callers want opposite things.
   * The overlay's sim strip is there to LOOK at the characters, so a line of
   * near-naked bodies tells it nothing. The balance harness measures how the
   * mechanics behave, and gear is wardrobe noise on top of that — dressing its
   * parties moved the party-scaling reading from 50% to 90% end HP and stopped
   * the healer ever being needed, which is exactly the signal it exists to
   * watch. Off by default keeps every existing caller measuring what it did.
   */
  | { type: "sim_join"; count: number; dress?: boolean; requestedBy?: string }
  | { type: "equip_gear"; requestedBy: string; instanceId: string }
  | { type: "unequip_gear"; requestedBy: string; slot: GearSlot }
  | { type: "grant_gear"; requestedBy: string; gearId: string }

  // --- loadout screen (§2.6). All character-scoped, all keyed by viewer id.
  /** Spends banked level-up points on one stat. */
  | { type: "allocate_points"; requestedBy: string; stat: AllocatableStat; amount: number }
  /** Refunds every spent point back to the pool. */
  | { type: "respec"; requestedBy: string }
  | { type: "set_role"; requestedBy: string; role: Role }
  | { type: "set_appearance"; requestedBy: string; appearance: CharacterAppearance }
  /** Creates a character for a viewer who doesn't have one yet, outside a dungeon run. */
  | { type: "ensure_character"; requestedBy: string; displayName?: string; role?: Role }

  // --- economy (§2.7). In-game gold only; nothing here touches real money.
  /** Destroys an unequipped gear instance for gold. */
  | { type: "recycle_gear"; requestedBy: string; instanceId: string }
  /**
   * Opens a sealed drop, turning it into a real item in the bag.
   *
   * A VIEWER command — it acts on their own chest and mints nothing that was
   * not already rolled, which is what keeps it off the operator list beside
   * `grant_gear`. The roll happened when the fight resolved; this is the
   * telling.
   */
  | { type: "open_chest"; requestedBy: string; chestId: string }
  /**
   * Puts a sealed chest on somebody's shelf, out of nothing.
   *
   * OPERATOR ONLY, and it sits beside `grant_gear` on that list for the same
   * reason: it mints an item that was never earned. It exists because testing
   * the reveal otherwise means winning a real run and waiting on a 60% drop
   * roll, and because the alternative people reach for — editing the roster
   * in the database by hand — races the server's own write-behind and quietly
   * loses whichever side wrote second.
   */
  | { type: "grant_chest"; requestedBy: string; gearId: string; from?: string }
  | { type: "buy_gear"; requestedBy: string; gearId: string }
  | { type: "buy_consumable"; requestedBy: string; consumableId: string }
  | { type: "use_consumable"; requestedBy: string; consumableId: string }

  | { type: "reset_roster"; requestedBy?: string };
