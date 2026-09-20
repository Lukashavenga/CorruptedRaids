import { SKIN_TONES } from "../../../src/engine/character.js";
import { BODY_TYPES, type BodyType } from "../../../src/engine/types.js";
import { text } from "../../../src/text/index.js";
import { SPRITE_INDEX } from "../admin/spriteIndex.js";
import { spriteUrl } from "../sprites.js";

export interface AppearancePickerProps {
  bodyType: BodyType;
  /** The character's skin tone id. */
  current: string;
  onPickBody: (bodyType: BodyType) => void;
  onPick: (toneId: string) => void;
  /** Hair sprite id, or null for bald. */
  hair: string | null;
  onPickHair: (hair: string | null) => void;
  busy: boolean;
}

/**
 * Sex, skin tone and hair.
 *
 * All three options are enumerations of what the art actually contains, not
 * free choice: two bodies, five tones, and forty hair drawings, each of which
 * is a real file under art/sprites. That constraint is the point — a character
 * configured here cannot reference art that does not exist.
 *
 * Hair IS offered separately now. The old note here said it was baked into the
 * body because no generator would produce a bald base for a hair layer to
 * cover; the hand-made bodies are bald by design, so the layer works and the
 * limitation is gone.
 */
export function AppearancePicker({
  bodyType,
  current,
  onPickBody,
  onPick,
  hair,
  onPickHair,
  busy,
}: AppearancePickerProps): JSX.Element {
  const hairIds = SPRITE_INDEX.hair ?? [];
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{text.loadout.appearanceHeading}</h2>
      </header>

      <h3 className="sub-heading">{text.loadout.bodyHeading}</h3>
      <div className="body-choices">
        {BODY_TYPES.map((b) => (
          <button
            key={b}
            type="button"
            className={`body-choice ${b === bodyType ? "is-current" : ""}`}
            disabled={busy || b === bodyType}
            onClick={() => onPickBody(b)}
            aria-pressed={b === bodyType}
          >
            {text.loadout.bodyType[b]}
          </button>
        ))}
      </div>

      <h3 className="sub-heading">{text.loadout.skinHeading}</h3>
      <div className="tone-swatches">
        {SKIN_TONES.map((tone) => (
          <button
            key={tone.id}
            type="button"
            className={`tone ${tone.id === current ? "is-current" : ""}`}
            style={{ background: tone.color }}
            disabled={busy}
            onClick={() => onPick(tone.id)}
            title={tone.name}
            aria-label={tone.name}
            aria-pressed={tone.id === current}
          />
        ))}
      </div>

      <h3 className="sub-heading">{text.loadout.hairHeading}</h3>
      <div className="hair-choices">
        {/* Bald first: the bodies are drawn bald, so it is a real option and
            not just the absence of a choice. */}
        <button
          type="button"
          className={`hair-choice ${hair === null ? "is-current" : ""}`}
          disabled={busy}
          onClick={() => onPickHair(null)}
          aria-pressed={hair === null}
        >
          {text.loadout.hairNone}
        </button>
        {hairIds.map((id: string) => (
          <button
            key={id}
            type="button"
            className={`hair-choice is-art ${id === hair ? "is-current" : ""}`}
            disabled={busy}
            onClick={() => onPickHair(id)}
            title={id}
            aria-label={id}
            aria-pressed={id === hair}
          >
            <img src={spriteUrl("hair", id)} alt="" />
          </button>
        ))}
      </div>
    </section>
  );
}
