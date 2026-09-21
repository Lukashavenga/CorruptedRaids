import { text, format } from "../../../src/text/index.js";
import { STAGE_PAD, STAGE_W } from "../stage.js";
import { useFittedFontSize } from "../hooks/useFittedFontSize.js";
import type { StateId } from "../../../src/state/dungeonStates.config.js";
import type { CombatOutcome } from "../../../src/engine/types.js";
import { LOGO_SRC } from "../build.js";

export interface StateBannerProps {
  state: StateId;
  dungeonName: string | null;
  /** Set during a raid — the banner names the raid through its rounds. */
  raidName?: string | null;
  /** What the last opened door held, shown during the reveal beat. */
  revealDetail?: string | null;
  partyCount: number;
  enemyCount: number;
  lastOutcome: CombatOutcome | null;
  /** Seconds left in the join window, or null when not gathering. */
  joinSecondsLeft: number | null;
  /**
   * The tier this party has earned, 1-based, or null outside a dungeon run.
   *
   * Shown while gathering because the fight scales to whoever turns up, and a
   * run that silently got harder is one nobody can feel themselves earning.
   * "THE POORS - LEVEL 2" tells the chat what their kit just bought them.
   */
  encounterLevel?: number | null;
}

/**
 * The crisp sizes the display font has, biggest first.
 *
 * Whole multiples of the 16px cell and nothing between them — see
 * useFittedFontSize for why a fractional shrink is not an option here.
 */
const BANNER_SIZES = [32, 16];

/** The one-line headline above the stage, driven by src/state/dungeonStates.config.ts. */
export function StateBanner({
  state,
  dungeonName,
  partyCount,
  enemyCount,
  lastOutcome,
  joinSecondsLeft,
  encounterLevel = null,
  raidName = null,
  revealDetail = null,
}: StateBannerProps): JSX.Element {
  // A raid has no dungeon, so it falls back to its own name. Without this its
  // join window announced nothing at all — the headline resolved to the empty
  // string and the only thing on the stage was "!join 28s", with no clue what
  // anyone was being invited to.
  const name = dungeonName ?? raidName ?? "";

  let line: string;
  switch (state) {
    case "gathering":
      line = format(text.state.gathering.banner, {
        name: encounterLevel ? `${name} - LEVEL ${encounterLevel}` : name,
      });
      break;
    case "combat":
      // The dungeon name is dropped here on purpose: during the fight the
      // headcount is the live information, and the name was announced for the
      // whole join window immediately before.
      line = format(text.state.combat.banner, { name, partyCount, enemyCount });
      break;
    case "results":
      line =
        lastOutcome === "defeat"
          ? format(text.state.results.defeatBanner, { name })
          : format(text.state.results.victoryBanner, { name });
      break;
    // A raid's rounds are its own beat: name the raid, not "awaiting a run".
    // Without these two the new states fell through to the idle default and
    // the overlay announced that nothing was happening mid-raid.
    case "choosing":
      line = raidName ?? text.raid.prompt;
      break;
    case "reveal":
      line = revealDetail ?? raidName ?? text.raid.prompt;
      break;
    case "cooldown":
      line = text.state.cooldown.banner;
      break;
    default:
      line = text.state.idle.banner;
  }

  // The headline is the one line on the stage whose length is CONTENT rather
  // than copy — a dungeon or raid name an author typed. At 32px a long one
  // overruns the stage and is clipped at both ends, taking the "LEVEL n"
  // suffix with it, so it steps down to the font's other crisp size instead.
  const fontSize = useFittedFontSize(line, STAGE_W - STAGE_PAD * 2, BANNER_SIZES, "CorruptedPixel");

  return (
    <div className={`state-banner state-${state}`}>
      {/* Idle is the only state with nothing happening, so it's where the
          brand mark earns its space - every other state needs the headline. */}
      {state === "idle" && <img className="idle-logo" src={LOGO_SRC} alt="" />}
      <span className="banner-line" style={{ fontSize: `${fontSize}px`, lineHeight: `${fontSize + 2}px` }}>
        {line}
      </span>
      {state === "gathering" && joinSecondsLeft !== null && (
        <span className="banner-sub">
          {text.dungeon.joinPrompt} {format(text.dungeon.joinCountdown, { seconds: joinSecondsLeft })}
        </span>
      )}
    </div>
  );
}
