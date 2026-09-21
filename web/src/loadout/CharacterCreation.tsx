import { useState } from "react";
import { SKIN_TONES } from "../../../src/engine/character.js";
import { BODY_TYPES, type BodyType, type CharacterAppearance } from "../../../src/engine/types.js";
import { LOGO_SRC } from "../build.js";
import { CharacterSprite } from "../components/CharacterSprite.js";
import { usePlacements } from "../hooks/usePlacements.js";
import { spriteUrl } from "../sprites.js";
import { haptic } from "./haptics.js";
import {
  HAIR_COLOURS,
  HAIR_STYLES,
  hairColourName,
  hairId,
  hairSwatch,
  parseHair,
  styleInColour,
} from "./hair.js";

export interface CharacterCreationProps {
  /** What the character currently looks like: the assigned default. */
  initial: CharacterAppearance;
  name: string;
  busy: boolean;
  /**
   * The last dispatch result, shown when it failed.
   *
   * This screen returns BEFORE the loadout's toast markup, so without it a
   * refused save is completely silent and the player is stranded on a screen
   * whose only button appears to do nothing. The one place a dead end can
   * happen is the one place an error has to be visible.
   */
  failure?: string | null;
  onConfirm: (appearance: CharacterAppearance) => void;
}

/**
 * The first screen: who you are, before anything else.
 *
 * WHY IT IS A SCREEN AND NOT A PANEL. The loadout already has an appearance
 * picker, and this is deliberately not it. A panel among nine other panels is
 * something you find later, and a character everyone recognises from the
 * overlay should not be decided by accident on the way to the shop. It shows
 * ONCE, on a character that has never chosen (Character.appearanceChosen), and
 * then never again - the panel stays for edits.
 *
 * THE FIGURE IS THE POINT. Every control changes the same drawing in the
 * middle at the size it appears on stream, because that is the only question
 * being asked here: does this look like someone you want to be. Swatches and
 * thumbnails are how you get there, not what you are choosing.
 *
 * Local state, committed on confirm. The picker in the loadout saves each
 * change immediately, which is right for an edit and wrong for a first choice:
 * trying four hairstyles should not be four writes and four toasts before you
 * have decided anything.
 */
export function CharacterCreation({ initial, name, busy, failure, onConfirm }: CharacterCreationProps): JSX.Element {
  const [bodyType, setBodyType] = useState<BodyType>(initial.bodyType);
  const [skinTone, setSkinTone] = useState(initial.skinTone);
  const [hair, setHair] = useState<string | null>(initial.hair ?? null);

  // Own the fetch rather than taking it as a prop: this screen renders INSTEAD
  // of the loadout, so there is no parent that has already loaded them.
  const { placements } = usePlacements();

  const parts = parseHair(hair);
  const style = parts?.style ?? null;
  const colour = parts?.colour ?? null;

  const pick = <T,>(set: (v: T) => void) => (value: T) => {
    haptic("commit");
    set(value);
  };

  return (
    <main className="loadout is-centered">
      <div className="creation">
        <img className="creation-logo" src={LOGO_SRC} alt="" />
        <h1 className="creation-title">Who are you?</h1>
        <p className="creation-lead">
          This is how {name} appears on stream. You can change it later.
        </p>

        <div className="creation-body">
          {/* The figure, at the size the overlay draws it. */}
          <div className="creation-figure">
            <CharacterSprite
              bodyType={bodyType}
              skinTone={skinTone}
              layers={{}}
              hair={hair}
              placements={placements}
              size={260}
            />
          </div>

          <div className="creation-controls">
            <h2 className="sub-heading">Body</h2>
            <div className="body-choices">
              {BODY_TYPES.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`body-choice ${b === bodyType ? "is-current" : ""}`}
                  disabled={busy}
                  onClick={() => pick(setBodyType)(b)}
                  aria-pressed={b === bodyType}
                >
                  {b === "male" ? "Male" : "Female"}
                </button>
              ))}
            </div>

            <h2 className="sub-heading">Skin</h2>
            <div className="tone-swatches">
              {SKIN_TONES.map((tone) => (
                <button
                  key={tone.id}
                  type="button"
                  className={`tone ${tone.id === skinTone ? "is-current" : ""}`}
                  style={{ background: tone.color }}
                  disabled={busy}
                  onClick={() => pick(setSkinTone)(tone.id)}
                  title={tone.name}
                  aria-label={tone.name}
                  aria-pressed={tone.id === skinTone}
                />
              ))}
            </div>

            <h2 className="sub-heading">Hair colour</h2>
            <div className="hair-colours">
              {HAIR_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`hair-colour ${c === colour ? "is-current" : ""}`}
                  style={{ background: hairSwatch(c) }}
                  disabled={busy}
                  onClick={() => pick(setHair)(hairId(style ?? HAIR_STYLES[0]!, c))}
                  title={hairColourName(c)}
                  aria-label={hairColourName(c)}
                  aria-pressed={c === colour}
                />
              ))}
            </div>

            <h2 className="sub-heading">Hair</h2>
            <div className="hair-choices">
              <button
                type="button"
                className={`hair-choice ${hair === null ? "is-current" : ""}`}
                disabled={busy}
                onClick={() => pick(setHair)(null)}
                aria-pressed={hair === null}
              >
                None
              </button>
              {HAIR_STYLES.map((st) => {
                const shown = styleInColour(st, colour);
                return (
                  <button
                    key={st}
                    type="button"
                    className={`hair-choice is-art ${st === style ? "is-current" : ""}`}
                    disabled={busy}
                    onClick={() => pick(setHair)(shown)}
                    title={st}
                    aria-label={st}
                    aria-pressed={st === style}
                  >
                    <img src={spriteUrl("hair", shown)} alt="" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {failure && <p className="creation-error">{failure}</p>}

        <button
          type="button"
          className="creation-confirm"
          disabled={busy}
          onClick={() => onConfirm({ bodyType, skinTone, hair })}
        >
          {busy ? "Saving..." : "Enter the dungeon"}
        </button>
      </div>
    </main>
  );
}
