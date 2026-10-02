import type { GearSlot, Rarity, Role, StatKey } from "../engine/types.js";
import type { StateId } from "../state/dungeonStates.config.js";

/**
 * Every user-facing string in the app, in one place. Nothing in web/ or
 * src/server should have an English sentence baked into a component or
 * log line directly — it should be a key here, filled in with `format()`
 * (see format.ts). That's what makes this swappable for a second language
 * later without touching a single component: add `fr.ts` with the same
 * keys, pick it in `text/index.ts`.
 *
 * `{placeholders}` are filled by format() — see the call sites in web/ for
 * examples (e.g. combatLog.attack with {actor}, {target}, {damage}).
 */
export const en = {
  app: {
    title: "Corrupted",
    connecting: "Connecting...",
    disconnected: "Disconnected - retrying...",
  },

  character: {
    levelLabel: "Level {level}",
    hpLabel: "{current} / {max}",
    xpLabel: "{current} / {toNext} XP",
    goldLabel: "{amount}g",
    /* Named in the header and on the character card, so the number a player
       is judged by is never an unlabelled figure. */
    corruptionLabel: "Corruption {amount}",
    downed: "Down",
  },

  role: {
    tank: "Tank",
    dps: "DPS",
    healer: "Healer",
  } satisfies Record<Role, string>,

  /**
   * Player-facing stat names (AGENTS.md §2.2). The engine's internal keys
   * are hp/atk/armour/spd/skill/crit; these are what a viewer actually sees,
   * and they should stay in sync with the concept doc's vocabulary rather
   * than leaking the engine's shorthand.
   */
  stat: {
    hp: "Health",
    atk: "Damage",
    skill: "Skill",
    spd: "Speed",
    crit: "Crit",
  } satisfies Record<StatKey, string>,

  encounter: {
    hpLabel: "{current} / {max}",
    standing: "{count} standing",
    kindMob: "Mob",
    kindBoss: "Boss",
  },

  dungeon: {
    opened: "{name} - the doors are open!",
    joined: "{name} joined the party.",
    simJoined: "{count} viewers joined.",
    cleared: "{name} has fallen!",
    wiped: "Driven out of {name}.",
    reset: "Run reset.",
    rosterReset: "Roster cleared.",
    recommendedLevel: "Suggested Corruption {level}",
    partyCount: "{count} in the party",
    // Terse on purpose: the fight overlay is 450px wide at a 16px bitmap
    // font, which is about 50 characters for the WHOLE banner line. The older
    // copy ("Joining closes in 12s" + "Type !join to enter the dungeon") ran
    // past both edges.
    joinCountdown: "{seconds}s",
    joinPrompt: "!join",
    raidPrompt: "!raid",
    andMore: "+{count}",
    emptyParty: "Nobody has joined yet.",
  },

  /** The five overlay phases — see src/state/dungeonStates.config.ts. */
  state: {
    idle: {
      banner: "Awaiting the next run...",
    },
    gathering: {
      banner: "{name}",
    },
    // Raids: the door choice and the beat after one is opened.
    choosing: {
      banner: "Round {round} of {rounds}",
    },
    reveal: {
      banner: "{detail}",
    },
    combat: {
      banner: "{partyCount} vs {enemyCount}",
    },
    // The outcome is the one banner drawn at 32px, which is about 14
    // characters across a 450px stage — so it names the result, not the
    // dungeon. The dungeon was named on the banner for the whole join window
    // immediately before this.
    results: {
      victoryBanner: "Taken!",
      defeatBanner: "Driven off...",
    },
    cooldown: {
      banner: "Catching a breath...",
    },
  } satisfies Record<StateId, Record<string, string>>,

  /**
   * Combat lines are drawn at 32px on a 450px stage — about 27 characters.
   * That is why these read as a readout rather than as sentences: at 16px the
   * prose fitted but the capitals were 11px tall, and doubling the size was
   * worth more on stream than the verbs were. The signed number carries what
   * "hits" and "heals" used to say, and the colour classes (heal/crit) carry
   * the rest. scripts/check-text-fits.py enforces the width.
   */
  combatLog: {
    /*
     * A swing, with the PARTY NAME ALWAYS LEFT and the ENEMY ALWAYS RIGHT —
     * the side of the stage each of them is standing on.
     *
     * It used to be "{actor} • {target}", so the order flipped with whoever
     * happened to be swinging and the same two names swapped places twice a
     * second. Reading it meant working out which side you were looking at
     * before you could read what happened.
     *
     * Direction is carried by WHERE THE DAMAGE SITS: next to whoever lost the
     * health. No arrow, because the bitmap font has no ">" or "<" glyph (see
     * CHARSET in scripts/build-font.py) and an aliased dash would read as part
     * of the damage number.
     *
     * No "!" on a crit: it pushed the longest line 8px past the stage, and the
     * .crit colour class already marks it. The absorbed amount is dropped for
     * the same reason — the least useful number on screen for the most width.
     * That is why a crit, a mitigated hit and a plain one share these two.
     *
     * THE CEILING IS TWO-DIGIT DAMAGE. Ten-character names either side of a
     * spaced bullet leave 436 of 438px, so a three-digit hit runs 16px past
     * the stage. That is not new — the old "{actor} • {target} -{damage}" is
     * the same characters in a different order and overflowed identically —
     * and closing it costs both spaces around the bullet, which is worth more
     * on stream than a hit nobody has landed yet. Revisit when damage does
     * reach three figures: drop NAME_MAX to 9, or close up the bullet.
     */
    attackOut: "{party} • {enemy} -{damage}",
    attackIn: "{party} -{damage} • {enemy}",
    ability: "{actor}: {detail}",
    heal: "{actor} • {target} +{amount}",
    healSelf: "{actor} • self +{amount}",
    down: "{who} is down!",
    loot: "{who} loots {gearName}!",
    reward: "{who} +{xp}xp +{gold}g",
    levelUp: "{who} corrupts to {level}",
    victory: "The village falls.",
    defeat: "Driven off.",
  },

  gear: {
    slot: {
      head: "Head",
      face: "Face",
      mainHand: "Main Hand",
      offHand: "Off Hand",
      top: "Top",
      bottom: "Bottom",
      back: "Back",
    } satisfies Record<GearSlot, string>,
    rarity: {
      common: "Common",
      uncommon: "Uncommon",
      rare: "Rare",
      epic: "Epic",
      legendary: "Legendary",
    } satisfies Record<Rarity, string>,
    equip: "Equip",
    unequip: "Unequip",
    equipped: "Equipped.",
    unequipped: "Unequipped.",
    empty: "Empty",
    granted: "Granted {gearId} to {name}.",
    requiresLevel: "Needs {level}",
    /* Gates read POINTS SPENT in a stat, not the stat's displayed value —
       AGENTS.md §10. The wording says "spent" for that reason. */
    needsStat: "Needs {amount} spent in {stat}",
    noRequirement: "no requirement",
  },

  /**
   * The loadout screen (§2.6) — a separate, per-viewer surface, not part of
   * the OBS overlay.
   */
  loadout: {
    chest: {
      /* The bag's chest shelf. Deliberately short — these sit under a 96px
         tile on a phone. */
      heading: "Unopened",
      countLabel: "{count} waiting",
      tap: "Tap to open",
      from: "from {place}",
      opened: "{name}!",
      /* Shown when the command answered but the catalogue cannot name the
         item — a pruned id, or a bundle that has not loaded. Better than a
         bare "?", which is what it used to render. */
      openedUnknown: "Something was inside...",
      dismiss: "Tap to close",
      openAll: "Open all",
      openedCount: "{count} items",
      skip: "Tap to skip",
      /* Shown once the bag has no chests left, in place of the shelf. */
      empty: "Nothing waiting. Win a run to earn a chest.",
    },
    title: "Character",
    subtitle: "Loadout & progression",
    signedInAs: "Signed in as {name}",
    signOut: "Sign out",

    /* The signed-out screen. Twitch is the only real way in; the dev shortcut
       is only offered when the server says it is enabled. */
    signIn: {
      title: "Sign in to play",
      lead: "Your character, your gear and your place on the board are tied to your Twitch account.",
      twitch: "Sign in with Twitch",
      unavailable: "Twitch sign-in is not available right now.",
      cancelled: "Sign-in was cancelled.",
      unconfigured: "This build has no Supabase project set - see DEPLOY.md.",
    },
    /* Shown across the screen while a run is live: every edit is refused
       until it ends, so saying so once beats a failure per button. */
    inRunNotice: "You are in a run - changes are locked until it ends.",

    statsHeading: "Stats",
    // format() is deliberately not a plural-aware i18n library (see
    // format.ts), so a singular variant is its own key rather than a rule.
    pointsAvailable: "{count} points to spend",
    pointAvailableOne: "1 point to spend",
    noPoints: "No points to spend - level up to earn more.",
    pointsSpent: "Point spent.",
    spentTotal: "{count} spent",
    spentTotalOne: "1 spent",
    perPoint: "+{amount} per point",
    respec: "Refund all points",
    respecDone: "Points refunded.",
    fromGear: "{amount} from gear",

    roleHeading: "Role",
    roleSet: "Role set to {role}.",
    becomeRole: "Become a {role}",
    roleHint: "Tanks draw attacks. Healers keep the party up. DPS end fights faster.",
    roleBlurb: {
      tank: "Draws enemy attention",
      dps: "High damage dealer",
      healer: "Supports the party",
    } satisfies Record<Role, string>,

    /*
     * The role tooltips.
     *
     * A flavour line, then a stat table. Written the way a game writes a
     * tooltip — a label and a number — rather than as paragraphs explaining
     * the game to the player. The long version said the same things in five
     * times the words and nobody reads five times the words on a character
     * screen.
     *
     * The VALUES are still `{placeholders}` filled from content/balance.json
     * by RoleGuide.tsx. That is the whole reason these are worth keeping:
     * retune `mitigationPerSkill` and the tooltip retunes with it, instead of
     * quietly starting to lie.
     */
    roleGuide: {
      heading: "{role} · {wants}",
      /* Row labels. Short enough to sit in a narrow left column. */
      labels: {
        skill: "Skill",
        guard: "Guard",
        threat: "Threat",
        healed: "Healed",
        heal: "Heal",
        speed: "Speed",
        targets: "Targets",
        damage: "Damage",
      },
      tank: {
        wants: "Health + Skill",
        flavour: "They have to come through you.",
        skill: "−{perPoint}% damage taken per point (max {cap}%)",
        guard: "−{perPoint}% for the whole party per point (max {cap}%)",
        threat: "{base}x base, +{perPoint}% per Skill point (max +{cap}%)",
        healed: "first, and {more}% more",
        note: "{chance}% of attacks ignore threat anyway.",
      },
      healer: {
        wants: "Skill + Speed",
        flavour: "You decide who stays up.",
        heal: "{base} + {perPoint} per Skill point, on anyone below {below}%",
        speed: "how often you heal · +{perPoint} per Skill point (max +{cap})",
        targets: "Tanks {tankMore}% more · yourself {selfLess}% less",
        note: "Nothing else keeps you alive.",
      },
      dps: {
        wants: "Damage + Speed",
        flavour: "Skill is not for you.",
        damage: "straight into every hit",
        speed: "how often you act - multiplies your damage",
        /* At skill == skillCurveK the curve is exactly half, whatever K is
           tuned to. So this stays true without hardcoding a sample. */
        skill: "cuts damage taken - {k} points halves it. Not your buy.",
        note: "",
      },
      everyone: {
        rarity: "Rare role: +{scarceBonus}% main stat under {scarceBelow}% of the party.",
      },
    },
    customiseAppearance: "Customize Appearance",
    hideGear: "Hide from view",
    showGear: "Show on character",
    hairHeading: "Hair",
    hairNone: "Bald",

    appearanceHeading: "Appearance",
    bodyHeading: "Body",
    skinHeading: "Skin",
    bodyType: { male: "Male", female: "Female" },
    appearanceSet: "Appearance updated.",

    /* The socket picker: what is in the bag that fits the slot just clicked. */
    fitsSlot: "Fits {slot}",
    nothingFits: "Nothing in the bags fits this slot.",
    close: "Close",

    gearHeading: "Equipment",
    inventoryHeading: "Inventory",
    inventoryEmpty: "Nothing in the bags yet - clear a dungeon to find gear.",
    bagCount: "{count} carried",

    /* The page shell. The nav names the surfaces a viewer can reach; the
       section tabs are the phone layout's way of showing one panel at a time
       instead of a column four screens long. */
    nav: {
      loadout: "Loadout",
      leaderboard: "Leaderboard",
      howToPlay: "How to Play",
      bestiary: "Bestiary",
      settings: "Settings",
      unavailable: "Not built yet",
      open: "Menu",
      close: "Close menu",
    },

    /* The standings. Ranked by Corruption — see GET /leaderboard. */
    leaderboard: {
      title: "Standings",
      subtitle: "Ranked by Corruption - level, spent points and worn gear as one number.",
      rank: "#",
      name: "Name",
      role: "Role",
      level: "Lvl",
      corruption: "Corruption",
      gold: "Gold",
      you: "you",
      empty: "Nobody has joined a run yet.",
      loading: "Reading the standings…",
      failed: "Could not reach the standings.",
      counted: "{shown} of {total}",
      refresh: "Refresh",
    },

    /*
     * How to Play.
     *
     * Same rule as the role tooltips: anything that is a tunable number is a
     * `{placeholder}` filled from balance.json at render time, so the rules
     * page cannot drift away from the game. Prose that restates a number is
     * one edit from lying.
     */
    howToPlay: {
      title: "How to Play",
      lead: "A run happens in chat. You join, the party fights, and what drops is yours.",
      steps: {
        title: "A run",
        join: {
          title: "Join",
          body: "When a dungeon opens, type !join in chat. You are in until the window closes.",
        },
        fight: {
          title: "Fight",
          body: "The fight resolves itself. Nobody takes a turn by hand - your stats, your role and your gear do the work.",
        },
        loot: {
          title: "Take what is left",
          body: "Win and you take XP, gold and gear. Lose and you still take {defeatShare}% of the XP and a slim chance at gear - a bad night is still a night.",
        },
      },
      raids: {
        title: "Raids",
        body: "A raid is several rounds of doors. The party votes !left, !ahead or !right, the door with the most votes opens, the room behind it is revealed, and whatever is in there is what you get. Boons stack for the rest of the run. The last room is the boss.",
      },
      stats: {
        title: "Your four stats",
        hp: "How much you can take.",
        atk: "How hard you hit.",
        skill: "Cuts damage taken - {k} points halves it. Tanks get more, and it drives their threat and their party guard. Healers heal for more and act more often.",
        spd: "How often you act. Turns are drawn from everyone at once, weighted by Speed.",
      },
      roles: {
        title: "Pick a role",
        body: "Every role wants exactly two stats, so there is no build that is simply correct. Whichever role is scarce is worth +{scarceBonus}% to its main stat - under {scarceBelow}% of the party and you are being paid to fill the gap.",
      },
      gear: {
        title: "Gear",
        body: "Gear moves Health, Damage, Skill and Speed, and some of it moves one down to move another up. Scrap what you will not wear - it pays out, and the bags are not endless.",
      },
      commands: {
        title: "Chat commands",
        join: "join a run that is open",
        path: "vote for a door in a raid",
      },
    },

    /*
     * Settings.
     *
     * Everything here is per-viewer and stored in this browser, because none
     * of it is game state — the server has no opinion about whether you like
     * seeing your own helmet.
     */
    settings: {
      title: "Settings",
      lead: "Yours, on this device. Nothing here changes the game.",
      display: {
        title: "Display",
        hiddenSlots: "Hidden pieces",
        hiddenSlotsHint: "Gear you own and wear, but do not want drawn on your character.",
        showAll: "Show everything",
        noneHidden: "Nothing hidden.",
        hiddenCount: "{count} hidden",
      },
      feel: {
        title: "Feedback",
        haptics: "Vibration",
        hapticsHint: "A short buzz when something equips, refuses, or a chest opens.",
        /* Said plainly rather than hidden, because the control would otherwise
           look broken on an iPhone — navigator.vibrate is Android only. */
        unsupported: "Your browser does not support vibration.",
        on: "On",
        off: "Off",
      },
      identity: {
        title: "You",
        viewerId: "Viewer id",
        viewerIdHint: "How the game knows which character is yours. Keep the link and you keep the character.",
        copy: "Copy link",
        copied: "Link copied.",
      },
      danger: {
        title: "Start over",
        respec: "Refund every point you have spent, so you can put them somewhere else. Your gear and level are untouched.",
        respecButton: "Refund all points",
      },
    },
    sections: {
      character: "Character",
      stats: "Stats",
      role: "Role",
      inventory: "Inventory",
      shop: "Shop",
    },

    characterReady: "{name} is ready.",
    characterCreated: "Created {name}.",
    loading: "Loading character...",
    noCharacter: "No character yet.",
    createCharacter: "Create character",
    cancel: "Cancel",
  },

  /** Shop and recycling — the economy half of the loadout screen (§2.6/§2.7). */
  shop: {
    heading: "Shop",
    consumablesHeading: "Consumables",
    pocketsHeading: "Pockets",
    buy: "Buy",
    price: "{gold}g",
    bought: "Bought {name} for {gold}g.",
    recycle: "Recycle",
    recycleFor: "Recycle · {gold}g",
    recycled: "Recycled for {gold}g.",
    recycleHint: "Recycling destroys the item. Equipped gear must be unequipped first.",
    /* Bulk recycling. Clearing twenty pieces of junk one confirm at a time is
       the most tedious thing on this page, so the bag has a mode for it. */
    recycleMany: "Scrap",
    recycleManyHint: "Scrap several items for gold",
    recycleDone: "Done",
    recycleNone: "Pick what to scrap",
    recycleCount: "{count} marked · {gold}g",
    use: "Use",
    used: "Used.",
    usedXp: "+{xp} XP.",
    usedXpLevelled: "+{xp} XP - level {level}!",
    usedGold: "+{gold}g.",
    owned: "×{count}",
    cannotAfford: "Not enough gold",
    empty: "Nothing in stock.",
    pocketsEmpty: "No consumables. Buy a tome to bank some XP.",
  },

  /** Raid-specific copy: doors, buffs, the boss. */
  raid: {
    door: { left: "Left", up: "Ahead", right: "Right" },
    prompt: "Choose a path",
    // "!ahead", not "!up": the middle door is labelled Ahead, and a hint that
    // names a word the door does not is one more thing to explain on stream.
    // Chat may type either (see DIRECTIONS in src/server/chat.ts).
    chooseHint: "!left  !ahead  !right",
    /** Beside the round label while chat's vote is open. */
    voteCloses: "{seconds}s",
    clear: "The way is clear.",
    buffFound: "{name}",
    ambush: "Ambush!",
    /** Named on the banner while a fight room is being looked at. */
    roomAhead: "{name}",
    /** Under a revealed room's name: how many are in there. */
    roomHolds: "{count} waiting",
    /** A revealed room with nothing in it. */
    roomEmpty: "Nothing here",
    /** A revealed room holding a boon. */
    roomBoon: "A boon",
    bossAhead: "Something large is waiting.",
    bossBanner: "{name}",
    roundLabel: "Round {round}/{rounds}",
    buffsHeld: "{count} boons",
  },

  /** The on-stream simulation controls. Not part of the spectator overlay proper. */
  sim: {
    title: "Sim controls",
    openDungeon: "Open Dungeon",
    raidTitle: "Raid",
    backdrop: "Backdrop",
    backdropMode: { dark: "Dark", checker: "Checker", clear: "Transparent" },
    openRaid: "Open Raid",
    joinFive: "Join 5",
    joinCrowd: "Join 25",
    startDungeon: "Start Dungeon",
    reset: "Reset",
    hint: "Testing harness - the real path is Twitch redeems dispatching the same commands.",
  },

  errors: {
    // Named, not generic, because the caller that hits this is a bot with a
    // typo in it and the only useful thing to hand back is the string it sent.
    unknownCommand: 'No such command "{type}"',
    noSuchChest: "That chest is already open.",
    unknownEncounter: 'No such encounter "{id}"',
    unknownDungeon: 'No such dungeon "{id}"',
    unknownRaid: 'No such raid "{id}"',
    noSuchDoor: "That path is already taken.",
    bossAwaits: "The doors are behind you now.",
    roundsRemain: "There are still doors ahead.",
    unknownGear: 'No such gear "{id}"',
    unknownCharacter: "No character for that viewer yet.",
    cannotEquip: "Could not equip.",
    cannotAllocate: "Could not spend points.",
    cannotRecycle: "Could not recycle that.",
    cannotBuy: "Could not buy that.",
    cannotUse: "Could not use that.",
    unknownConsumable: 'No such consumable "{id}"',
    noOpenRun: "No dungeon is open right now.",
    alreadyJoined: "You're already in the party.",
    emptyParty: "Nobody has joined yet.",
    joinWindowClosed: "The join window has closed.",
    notGathering: "No party is forming right now.",
    notChoosing: "There is no path to choose right now.",
    runInProgress: "A run is already in progress.",
    raidInProgress: "A raid opens with a door, not a fight.",
  },
} as const;

export type TextTree = typeof en;
