import type { BodyType, CombatOutcome, GearSlot, Role } from "../../../src/engine/types.js";
import type { Motion, PlacementFile } from "../../../src/character/layers.js";
import type { FloatingNumber, PlaybackAction } from "../hooks/useCombatPlayback.js";

/**
 * What the 3D arena is told, and nothing it has to work out.
 *
 * This file imports no renderer on purpose. App.tsx builds these values for
 * whichever arena it was handed, and the flat overlay must be able to import
 * the TYPES without three.js following them into its bundle.
 */

/** A body built from the layer stack - a player, or an enemy drawn as a person. */
export interface ArenaCharacter {
  bodyType: BodyType;
  skinTone: string;
  /** Hair sprite id, or null for bald. */
  hair: string | null;
  /** Sprite id per occupied slot, already resolved from gear ids. */
  layers: Partial<Record<GearSlot, string>>;
}

export interface ArenaUnit {
  id: string;
  side: "party" | "enemy";
  /** Decides where a party member stands, and whether a body fights at range. */
  role?: Role;
  /** A finished enemy drawing, "<group>/<id>". Wins over `character`. */
  sprite?: string;
  character?: ArenaCharacter;
  /** Drawn larger - see CombatantFigure's `boss`. */
  boss: boolean;
  /**
   * Where the fight's author stood this body: fractions of the enemy half
   * (EnemyUnit.x / .y) and its sprite scale. Absent for the party and for an
   * enemy with no layout, which are packed into a formation instead.
   */
  placed?: { x: number; y: number; scale: number };
  downed: boolean;
  /** Only `victory` is read; every other motion is choreographed from actions. */
  pose: Motion;
}

export interface ArenaProps {
  /** Empty while there is nothing to stand on the floor (idle, a door choice). */
  units: ArenaUnit[];
  /** Background id, or null for a fight with no scene. */
  background: string | null;
  /**
   * How the scene is lit. `full` is the "here is where you are going" beat;
   * `fight` pulls the painting back so the bodies read against it.
   */
  mood: "full" | "fight";
  /** True while a replay is on the floor - the two lines close up. */
  fighting: boolean;
  action: PlaybackAction | null;
  floats: readonly FloatingNumber[];
  outcome: CombatOutcome | null;
  placements: PlacementFile;
  /** The stage's whole-number scale, so the canvas is drawn at real pixels. */
  scale: number;
}
