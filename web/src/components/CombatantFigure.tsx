import type { CSSProperties } from "react";
import { CharacterSprite } from "./CharacterSprite.js";
import { text, format } from "../../../src/text/index.js";
import { enemySpriteUrl } from "../sprites.js";
import { RoleIcon } from "./RoleIcon.js";
import type { Motion, PlacementFile } from "../../../src/character/layers.js";
import type { BodyType, GearSlot, Role } from "../../../src/engine/types.js";
import type { PulseKind } from "../hooks/useCombatPlayback.js";

export interface CombatantFigureProps {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  pulse: PulseKind;
  /**
   * Numbers currently rising off this body — damage taken, healing received.
   *
   * Passed in rather than read from a hook, because a figure is drawn in three
   * places (the party rank, the enemy rank, the room reveal) and only one of
   * them is inside a replay.
   */
  floats?: readonly { id: number; text: string; kind: "damage" | "crit" | "heal" }[];
  downed: boolean;
  side: "party" | "enemy";
  role?: Role;
  level?: number;
  /** Body shape + skin tone select the base sprite. Party members only. */
  bodyType?: BodyType;
  skinTone?: string;
  motion?: Motion;
  /**
   * Sprite id per occupied slot, already resolved from gear ids by the caller
   * (spriteForGear). Resolution needs the gear catalogue, and a figure should
   * not have to know what a catalogue is.
   */
  layers?: Partial<Record<GearSlot, string>>;
  /** Hair sprite id, or null for bald. */
  hair?: string | null;
  /** Slots equipped but hidden by player preference. */
  hiddenSlots?: readonly GearSlot[];
  placements?: PlacementFile;
  /**
   * A finished enemy sprite ("<group>/<id>"), from the encounter's content.
   *
   * Takes precedence over both the composited character and the old sheet cell:
   * these are complete drawings — a milkmaid, a king, a sheep — that layering
   * could not produce.
   */
  enemySprite?: string;
  /** Which sprite-sheet cell this enemy draws with, from its encounter content. Enemies only. */
  /**
   * An enemy drawn as a person rather than a sheet cell.
   *
   * The premise is that the party raid villages, so most of what they fight is
   * human and is built from the same bodies and gear they wear — see
   * EncounterCharacter. Enemies face LEFT, toward the party.
   */
  enemyCharacter?: {
    bodyType: BodyType;
    skinTone: string;
    layers: Partial<Record<GearSlot, string>>;
  };
  /** Hides the name plate — set when the line-up is packed too tightly for names to read (see lineup.ts). */
  dense?: boolean;
  /** Stacking order within the line-up, so overlapping figures layer predictably. */
  depth?: number;
  /**
   * Draw this enemy larger.
   *
   * A raid boss is one enemy against a whole party, and at the same size as the
   * militia it just replaced it reads as an ordinary fight with fewer people in
   * it. Scale is the cheapest possible way to say "this one is different", and
   * it needs no new art.
   */
  boss?: boolean;
}

/**
 * One combatant standing on the stage: a small floating HP bar and name
 * above, the character beneath it.
 *
 * Party members composite from layers (CharacterSprite); enemies render one
 * cell of a sprite sheet (enemyArt.ts). Both sides share this component so
 * the HP bar, hit pulse and downed treatment stay identical between them.
 */
export function CombatantFigure({
  id,
  name,
  hp,
  maxHp,
  pulse,
  downed,
  side,
  role,
  level,
  bodyType = "male",
  skinTone,
  motion = "idle",
  floats,
  layers = {},
  hair = null,
  hiddenSlots = [],
  placements = {},
  enemySprite,
  enemyCharacter,
  dense = false,
  depth = 0,
  boss = false,
}: CombatantFigureProps): JSX.Element {
  const classes = [
    "figure",
    `figure-${side}`,
    boss ? "is-boss" : "",
    downed ? "is-down" : "",
    pulse ? `pulse-${pulse}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // z-index rises toward the centre line on both sides, so the front rank
    // of each line-up is the one facing the enemy rather than a random
    // figure being painted over its neighbours.
    <div className={classes} style={{ zIndex: depth }}>
      {/* Damage and healing, on the body it happened to.
          Rendered before everything else so it paints over the figure rather
          than behind its role badge, and keyed by the float's own id so two
          hits landing on the same tank animate as two numbers rather than one
          restarting. */}
      {floats && floats.length > 0 && (
        <div className="figure-floats" aria-hidden="true">
          {floats.map((f) => (
            <span key={f.id} className={`combat-float is-${f.kind}`}>
              {f.text}
            </span>
          ))}
        </div>
      )}

      {/* Role badge floats above the head and survives dense mode — at a
          glance it's the formation read (shields front, plus signs back),
          which matters more than any individual name. */}
      {role && (
        <div className="figure-role">
          <RoleIcon role={role} />
        </div>
      )}

      {!dense && (
        <div className="figure-plate">
          <span className="figure-name" title={name}>
            {name}
          </span>
        </div>
      )}

      {/* No per-figure health bar. Party health is the roster grid's chip
          fill and enemy health is the pooled bar, so a third copy above each
          figure was the same information a third time — and it was the copy
          nobody could read, being ~60px wide behind overlapping sprites. What
          it cost in height the characters now get. */}

      <div className="figure-art">
        {side === "party" ? (
          <CharacterSprite
            bodyType={bodyType}
            skinTone={skinTone ?? "fair"}
            hair={hair}
            layers={layers}
            hiddenSlots={hiddenSlots}
            placements={placements}
            size={88}
            motion={motion}
          />
        ) : enemySprite ? (
          // Drawn as authored. The encounter sheets are hand-drawn facing
          // left, which is the way an enemy on the right of the stage should
          // already be looking — so unlike CharacterSprite below, this needs
          // no flip.
          <img
            className="enemy-art"
            src={enemySpriteUrl(enemySprite)}
            alt=""
            style={{ maxHeight: boss ? 150 : 88 }}
            draggable={false}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : enemyCharacter ? (
          <CharacterSprite
            bodyType={enemyCharacter.bodyType}
            skinTone={enemyCharacter.skinTone}
            layers={enemyCharacter.layers}
            placements={placements}
            size={boss ? 150 : 88}
            motion={motion}
            facing="left"
          />
        ) : null}
        {/* Level sits as a corner badge on the art rather than on the name
            line — at this column width a name plus a level tag collide. */}
        {level !== undefined && <span className="figure-level">{format(text.character.levelLabel, { level })}</span>}
      </div>
    </div>
  );
}
