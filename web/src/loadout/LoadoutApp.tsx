import { useEffect, useState } from "react";
import { useCharacter } from "./useCharacter.js";
import { useContentCatalog } from "../hooks/useContentCatalog.js";
import { EquipmentDoll } from "./EquipmentDoll.js";
import { StatAllocator } from "./StatAllocator.js";
import { RolePicker } from "./RolePicker.js";
import { AppearancePicker } from "./AppearancePicker.js";
import "./loadout.css";
import "./loadout-panels.css";
import "./loadout-responsive.css";
import "./motion.css";
import { usePlacements } from "../hooks/usePlacements.js";
import { useHiddenSlots } from "./useHiddenSlots.js";
import { InventoryGrid } from "./InventoryGrid.js";
import { ChestShelf } from "./ChestShelf.js";
import { BugReport } from "./BugReport.js";
import { CharacterCreation } from "./CharacterCreation.js";
import { BestiaryScreen } from "./BestiaryScreen.js";
import { BUILD_LABEL } from "../build.js";
import { haptic } from "./haptics.js";
import { ShopPanel } from "./ShopPanel.js";
import { signOut } from "./identity.js";
import { SignInScreen } from "./SignInScreen.js";
import { LeaderboardScreen } from "./LeaderboardScreen.js";
import { HowToPlayScreen } from "./HowToPlayScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { text, format } from "../../../src/text/index.js";
import { LOGO_SRC } from "../build.js";

/**
 * The per-viewer loadout screen (AGENTS.md §2.6) — a separate surface from
 * the OBS overlay, served at /loadout.
 *
 * Everything it does goes through `GameCommand` exactly like the overlay and
 * a future Twitch layer do (§5.2); there is no private back door into engine
 * state. The only thing that isn't real yet is *who you are* — see
 * identity.ts.
 *
 * ONE TREE, THREE LAYOUTS
 * -----------------------
 * The desktop, laptop and phone forms are the same markup arranged three ways
 * in CSS, not three components. The alternative — a layout per breakpoint —
 * means a behaviour change has to be made in three places and will eventually
 * be made in two.
 *
 * The single piece of JS the responsive story needs is `section`: on a phone
 * the four panels are stacked four screens deep, so the tab bar shows one at a
 * time. Above that breakpoint every panel is on screen at once and `section`
 * is inert — which is why it drives a class rather than an early return.
 */

/** The panels the phone tab bar switches between. */
const SECTIONS = ["stats", "role", "inventory", "shop"] as const;
type Section = (typeof SECTIONS)[number];

/**
 * The surfaces a viewer can reach.
 *
 * `ready: false` renders a disabled tab rather than hiding it — a locked door
 * says the room exists. Bestiary is the only one left; Encounters is gone
 * because a dungeon IS its fight now, so an "encounters" browser had nothing
 * left to browse that the Bestiary would not cover better.
 */
const NAV = [
  { id: "loadout", ready: true },
  { id: "leaderboard", ready: true },
  { id: "howToPlay", ready: true },
  { id: "bestiary", ready: true },
  { id: "settings", ready: true },
] as const;

type Page = (typeof NAV)[number]["id"];

export function LoadoutApp(): JSX.Element {
  const { character, loading, message, error, viewer, session, inRun, dispatch, reload } = useCharacter();
  // The bundle shipped with this build, not the game server's live `/content`
  // — the loadout is hosted and has no game server to ask. See the note on
  // useContentCatalog.
  const catalog = useContentCatalog("/loadout-content.json");
  const [busy, setBusy] = useState(false);
  // Appearance is a secondary concern, so it stays behind a toggle rather
  // than occupying permanent space next to stats and gear.
  const [showAppearance, setShowAppearance] = useState(false);
  const [section, setSection] = useState<Section>("stats");
  /** Whether the last command succeeded, and a counter so a repeat re-animates. */
  const [lastOk, setLastOk] = useState(true);
  const [toastSeq, setToastSeq] = useState(0);
  // Which top-level screen is showing. The nav used to be four dead buttons;
  // this is the state that makes them go somewhere.
  const [page, setPage] = useState<Page>("loadout");
  const [menuOpen, setMenuOpen] = useState(false);
  const { placements } = usePlacements();
  const { hiddenSlots, toggleHidden } = useHiddenSlots(viewer?.id ?? "");

  // The nav drawer is a phone-and-laptop affordance; at desktop width the nav
  // is always on screen and an "open" flag left over from a narrower window
  // would keep a scrim over the page nobody could see the cause of.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [menuOpen]);

  const run = async (command: Parameters<typeof dispatch>[0]) => {
    setBusy(true);
    try {
      const body = await dispatch(command);
      const ok = body?.ok !== false;
      setLastOk(ok);
      setToastSeq((n) => n + 1);
      // The third feedback channel, after the message and the animation — and
      // never the only one. See haptics.ts: on iOS this does nothing at all,
      // so nothing may depend on feeling it.
      haptic(ok ? "commit" : "refuse");
      return body;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Opens a sealed drop.
   *
   * Deliberately NOT routed through `run()`: that sets `busy`, which disables
   * the whole screen, and the chest is mid-animation for about a second. The
   * shelf does its own guarding (one chest at a time, ignores taps while
   * open), so locking the rest of the loadout would only stop somebody reading
   * their stats while a lid comes up. The haptics here belong to the animation
   * beats rather than to the request, so they live in ChestShelf.
   */
  const openChest = async (chestId: string): Promise<{ gearId: string } | null> => {
    const body = await dispatch({ type: "open_chest", requestedBy: viewer?.id ?? "", chestId });
    const chest = body?.chest as { gearId?: string } | undefined;
    return chest?.gearId ? { gearId: chest.gearId } : null;
  };

  /**
   * Recycling, one item or twenty.
   *
   * Sequential and not `Promise.all`: every command re-reads the character
   * afterwards (see useCharacter), so firing twenty at once means twenty
   * overlapping reads racing to be the last one to set state, and the bag ends
   * up showing whichever reply happened to land last. In order, the last read
   * is the last write.
   */
  const recycle = async (instanceIds: string[]) => {
    setBusy(true);
    try {
      for (const instanceId of instanceIds) {
        // `requestedBy` is vestigial on this screen — the server overwrites it
        // from the session cookie and never reads what is sent (see
        // src/server/auth.ts). It stays because the command type requires it.
        await dispatch({ type: "recycle_gear", requestedBy: viewer?.id ?? "", instanceId });
      }
    } finally {
      setBusy(false);
    }
  };

  // Nothing is known yet — not even whether we are signed in. Showing the
  // sign-in prompt here would flash it at somebody who is already signed in.
  if (!session) return <main className="loadout is-centered">{text.loadout.loading}</main>;

  // Signed out. Everything below this line assumes a viewer, and TypeScript
  // enforces that: `viewer` is nullable right up until here.
  if (!session.viewer || !viewer) {
    return <SignInScreen session={session} />;
  }

  if (loading) return <main className="loadout is-centered">{text.loadout.loading}</main>;
  if (error) return <main className="loadout is-centered error">{error}</main>;

  /*
   * Never chosen a look? Choose one before anything else.
   *
   * Roster.ensure hands every new character a body and skin by join order, so
   * one always LOOKS decided even when nobody decided it. appearanceChosen is
   * what tells those apart, and it flips the first time an appearance is
   * saved, so this screen shows exactly once. The picker in the panels below
   * stays for every change after that.
   */
  if (character && !character.appearanceChosen) {
    return (
      <CharacterCreation
        initial={character.appearance}
        name={character.name}
        busy={busy}
        failure={lastOk ? null : message}
        onConfirm={(appearance) => run({ type: "set_appearance", requestedBy: viewer.id, appearance })}
      />
    );
  }

  if (!character) {
    return (
      <main className="loadout is-centered">
        <p>{text.loadout.noCharacter}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => run({ type: "ensure_character", requestedBy: viewer.id, displayName: viewer.displayName })}
        >
          {text.loadout.createCharacter}
        </button>
      </main>
    );
  }

  const xpPct = character.xpToNext > 0 ? Math.min(100, (character.xp / character.xpToNext) * 100) : 0;
  const summary = `${format(text.character.levelLabel, { level: character.level })} · ${text.role[character.role]} · ${format(text.character.corruptionLabel, { amount: character.corruption })}`;

  const nav = (
    <nav className="site-nav" aria-label={text.loadout.title}>
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-item ${page === item.id ? "is-current" : ""} ${item.ready ? "" : "is-locked"}`}
          aria-current={page === item.id ? "page" : undefined}
          disabled={!item.ready}
          title={item.ready ? undefined : text.loadout.nav.unavailable}
          onClick={() => {
            setPage(item.id);
            // The drawer is modal on a phone; leaving it open over the screen
            // it just navigated to would hide the thing that was asked for.
            setMenuOpen(false);
          }}
        >
          {text.loadout.nav[item.id]}
        </button>
      ))}
    </nav>
  );

  return (
    <div className={`loadout-shell ${menuOpen ? "menu-open" : ""}`}>
      <main className="loadout">
        <header className="topbar">
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? text.loadout.nav.close : text.loadout.nav.open}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" />
          </button>

          {/* The logo carries the brand; the h1 stays as the accessible name
              and is hidden visually rather than removed. */}
          <img className="brand-logo" src={LOGO_SRC} alt="" />
          <h1 className="visually-hidden">{text.loadout.title}</h1>

          {nav}

          {/* Level, role and corruption as one line with the bar under it -
              the mock's arrangement, and the one that reads: the sentence says
              where you are, the bar says how far to the next step. */}
          <div className="head-status">
            <span className="head-level">{summary}</span>
            <div className="xp-bar" aria-hidden="true">
              <div className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
            </div>
            <span className="head-xp">
              {format(text.character.xpLabel, { current: character.xp, toNext: character.xpToNext })}
            </span>
          </div>

          {/* The two numbers a player checks constantly, given their own chips.
              Corruption first because it is the one that decides what they fight;
              gold only decides what they can buy. */}
          <div className="head-purse">
            <span
              className="purse-chip is-corruption"
              title="Gear, spent points and role as one number - this is what decides which fight you get."
            >
              {/* Corruption's own mark, not a stat's. It is a derived power
                  score, and borrowing the Skill shield made the header read as
                  "Skill 51" to anyone glancing at it. */}
              <img
                className="chip-mark"
                src="/art/ui/prop-skull.png"
                alt=""
                aria-hidden="true"
                draggable={false}
              />
              {character.corruption}
            </span>
            <span className="purse-chip is-gold">
              {format(text.character.goldLabel, { amount: character.gold })}
            </span>
          </div>
        </header>

        {/* The drawer nav, and the scrim that closes it. Same links as the bar
            above; at desktop width both the toggle and this are display:none,
            so there is nothing to keep in sync. */}
        <div className="nav-drawer">{nav}</div>
        <button
          type="button"
          className="nav-scrim"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
        />

        {inRun && <p className="in-run-notice">{text.loadout.inRunNotice}</p>}

        <p className="identity">
          {format(text.loadout.signedInAs, { name: viewer.displayName })}
          <button
            type="button"
            className="ghost identity-out"
            onClick={() => void signOut().then(() => reload())}
          >
            {text.loadout.signOut}
          </button>
        </p>

        {page === "leaderboard" && <LeaderboardScreen viewerName={character.name} />}
        {page === "howToPlay" && <HowToPlayScreen balance={catalog.balance} />}
        {page === "bestiary" && <BestiaryScreen catalog={catalog} />}
        {page === "settings" && (
          <SettingsScreen
            viewerId={viewer.id}
            hiddenSlots={hiddenSlots}
            toggleHidden={toggleHidden}
            busy={busy}
            onRespec={() => run({ type: "respec", requestedBy: viewer.id })}
          />
        )}

        {page === "loadout" && (
        <div key={section} className={`loadout-grid section-${section} panel-enter`}>
          <section className="panel doll-wrap" data-section="character">
            <EquipmentDoll
              character={character}
              catalog={catalog}
              busy={busy}
              placements={placements}
              hiddenSlots={hiddenSlots}
              onToggleHidden={toggleHidden}
              onEquip={(instanceId) => run({ type: "equip_gear", requestedBy: viewer.id, instanceId })}
              onUnequip={(slot) => run({ type: "unequip_gear", requestedBy: viewer.id, slot })}
            />

            <button
              type="button"
              className="ghost appearance-toggle"
              onClick={() => setShowAppearance((open) => !open)}
              aria-expanded={showAppearance}
            >
              {text.loadout.customiseAppearance}
            </button>

            {showAppearance && (
              <AppearancePicker
                bodyType={character.appearance.bodyType}
                current={character.appearance.skinTone}
                hair={character.appearance.hair ?? null}
                onPickHair={(hair) =>
                  run({
                    type: "set_appearance",
                    requestedBy: viewer.id,
                    appearance: { ...character.appearance, hair },
                  })
                }
                busy={busy}
                onPickBody={(bodyType) =>
                  run({
                    type: "set_appearance",
                    requestedBy: viewer.id,
                    appearance: { ...character.appearance, bodyType },
                  })
                }
                onPick={(toneId) =>
                  run({
                    type: "set_appearance",
                    requestedBy: viewer.id,
                    appearance: { ...character.appearance, skinTone: toneId },
                  })
                }
              />
            )}
          </section>

          <div className="col col-build">
            <StatAllocator
              character={character}
              busy={busy}
              onAllocate={(stat, amount) => run({ type: "allocate_points", requestedBy: viewer.id, stat, amount })}
              onRespec={() => run({ type: "respec", requestedBy: viewer.id })}
            />
            <RolePicker
              current={character.role}
              busy={busy}
              balance={catalog.balance}
              onPick={(role) => run({ type: "set_role", requestedBy: viewer.id, role })}
            />
            <ChestShelf character={character} catalog={catalog} busy={busy} onOpen={openChest} />
            <InventoryGrid
              character={character}
              catalog={catalog}
              busy={busy}
              onEquip={(instanceId) => run({ type: "equip_gear", requestedBy: viewer.id, instanceId })}
              onRecycle={recycle}
              onUse={(consumableId) => run({ type: "use_consumable", requestedBy: viewer.id, consumableId })}
            />
          </div>

          {/* Just the shop. It shared this column with a "Pockets" panel behind
              a tab switch, which asked a player to keep two bags in their head -
              consumables now sit in the Inventory, where what you are carrying
              belongs. */}
          <div className="col side-drawer">
            <ShopPanel
              character={character}
              catalog={catalog}
              busy={busy}
              onBuyGear={(gearId) => run({ type: "buy_gear", requestedBy: viewer.id, gearId })}
              onBuyConsumable={(consumableId) => run({ type: "buy_consumable", requestedBy: viewer.id, consumableId })}
            />
          </div>
        </div>
        )}

        {/* The toast animates by WHAT HAPPENED, not just by appearing: a
            commit swells, a refusal shakes. Two different shapes read apart in
            peripheral vision where two colours do not - and on this screen the
            message is often the only confirmation, because haptics do nothing
            on iOS (see haptics.ts). `key` restarts the animation when the same
            message arrives twice. */}
        {message && (
          <p key={`${message}:${toastSeq}`} className={`toast ${lastOk ? "just-changed" : "just-refused"}`}>
            {message}
          </p>
        )}
      </main>

      {/* Which build, and a way to say it is broken.
          Outside <main> so it is the last thing in the tab order: present on
          every screen, in the way of nothing. During an alpha the build string
          is the difference between a report that can be acted on and one that
          cannot, so it is shown as well as attached. */}
      <footer className="build-bar">
        <span className="build-id" title="The build you are on. Include this in any report.">
          {BUILD_LABEL}
        </span>
        <BugReport viewer={viewer} />
      </footer>

      {/* The phone's section switch. Rendered always and hidden by CSS above
          the breakpoint, so which panels exist is stated once, here.
          Only on the loadout screen: the other three are one column each and
          have no panels to switch between, so the bar would be four buttons
          that change nothing. */}
      {page === "loadout" && (
      <nav className="section-tabs" aria-label={text.loadout.sections.character}>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            className={`tab ${section === id ? "is-current" : ""}`}
            aria-current={section === id ? "true" : undefined}
            onClick={() => {
              haptic("tap");
              setSection(id);
            }}
          >
            <TabGlyph section={id} />
            <span>{text.loadout.sections[id]}</span>
          </button>
        ))}
      </nav>
      )}
    </div>
  );
}

/**
 * The tab bar's marks.
 *
 * Stats and Role reuse the art already on those panels, which is what makes a
 * tab and the thing it opens recognisably the same. Inventory and Shop have no
 * single glyph on the sheet, so they get the two props that say those words
 * without any: a coin sack is a bag, a pile of gold is a shop.
 */
const TAB_MARK: Record<Section, string> = {
  stats: "/art/ui/icon-hp.png",
  role: "/art/ui/icon-atk.png",
  inventory: "/art/ui/prop-bag.png",
  shop: "/art/ui/prop-coins.png",
};

function TabGlyph({ section }: { section: Section }): JSX.Element {
  return <img className="tab-glyph" src={TAB_MARK[section]} alt="" aria-hidden="true" draggable={false} />;
}
