import * as THREE from "three";
import { ROLE_RANK } from "../formation.js";
import type { ArenaUnit } from "./types.js";

/**
 * Where the floor is, and who stands where on it.
 *
 * THE SCENE IS THE PAINTING, UNFOLDED. Every backdrop is one flat 16:9 picture
 * with a strip of ground along the bottom. Nothing here models a place: a
 * reference camera is set up to look at an empty floor and a wall standing at
 * the back of it, and the painting is projected through that camera onto both.
 * From exactly that camera the two surfaces reassemble into the picture as it
 * was drawn; from anywhere else the wall and the floor part company, and that
 * parallax is what makes a flat picture read as a room.
 *
 * Which means every number below describes the camera the paintings are
 * IMAGINED to have been taken with, not anything measured from them. They were
 * chosen so that a figure standing on the painted ground is the size the flat
 * overlay draws it.
 */

/** Every backdrop is 876x493. */
export const IMAGE_ASPECT = 876 / 493;

/** Vertical field of view, in degrees. Narrow, because the paintings are close to side-on. */
export const FOV = 30;

/**
 * How far down the picture the horizon sits, 0 at the top.
 *
 * Higher than the middle, and a compromise. With the horizon at the centre of
 * the picture a body at the back of MONKS' courtyard is half the size of one
 * at the front, which reads as a different species rather than as distance;
 * with it at the very top there is no perspective left to speak of. A third of
 * the way down keeps the back rank at about two thirds.
 */
const HORIZON_V = 0.33;

/** Eye height. Sets the scale: at 4.1 the 512px character canvas stands ~29% of the picture's height at the front. */
const CAMERA_HEIGHT = 4.1;

/** World height of the whole 512px character canvas. A body is ~1.7 of it. */
export const CANVAS_WORLD = 2;

/** The strip of a painting that can be stood on, as fractions of its height from the top. */
export interface Floor {
  /**
   * Where the ground meets whatever stands behind it.
   *
   * It is where the picture is FOLDED, so too high and the base of a wall is
   * laid flat along the floor, too low and the floor climbs the wall. Small
   * errors do not show while the camera stays near where it started.
   */
  fold: number;
  /** The nearest a body's feet may come. Below this the painting is not ground. */
  front: number;
}

/**
 * Furthest the front row stands down a picture that is ground all the way to
 * its bottom edge. The pooled enemy bar owns what is below.
 */
const V_FRONT = 0.965;

/**
 * Each painting's floor, read off the art by eye - the kerb the barriers stand
 * on, the lip of the courtyard.
 *
 * MONKS is why `front` exists. Its courtyard stops well short of the bottom of
 * the picture and the last sixth is the rock face it is built on; with the
 * floor run to the edge the party's front rank stood halfway down a cliff.
 */
const FLOORS: Record<string, Floor> = {
  poors: { fold: 0.75, front: 0.95 },
  monks: { fold: 0.69, front: 0.855 },
  cops: { fold: 0.79, front: V_FRONT },
  barbies: { fold: 0.85, front: V_FRONT },
  guards: { fold: 0.86, front: V_FRONT },
  "guards-2": { fold: 0.86, front: V_FRONT },
};
const DEFAULT_FLOOR: Floor = { fold: 0.78, front: V_FRONT };

export function floorFor(background: string | null): Floor {
  return (background ? FLOORS[background] : undefined) ?? DEFAULT_FLOOR;
}

/** The reference camera, and the two questions asked of it. */
export class Projection {
  readonly camera: THREE.PerspectiveCamera;
  /** World -> the painting's clip space. The backdrop shader's only input. */
  readonly matrix = new THREE.Matrix4();
  /** What a camera at rest looks at: a point down the reference axis, about mid-floor. */
  readonly focus = new THREE.Vector3();

  constructor() {
    const half = THREE.MathUtils.degToRad(FOV / 2);
    const pitch = Math.atan((0.5 - HORIZON_V) * 2 * Math.tan(half));
    this.camera = new THREE.PerspectiveCamera(FOV, IMAGE_ASPECT, 0.5, 200);
    this.camera.position.set(0, CAMERA_HEIGHT, 0);
    this.camera.rotation.set(-pitch, 0, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.focus.set(0, CAMERA_HEIGHT - Math.sin(pitch) * 15, -Math.cos(pitch) * 15);
  }

  /** The point on the floor that the painting shows at (u, v), both 0..1 from its top-left. */
  groundAt(u: number, v: number): THREE.Vector3 {
    const far = new THREE.Vector3(u * 2 - 1, 1 - v * 2, 0.5).unproject(this.camera);
    const origin = this.camera.position;
    const dir = far.sub(origin);
    // Above the horizon a ray never lands. Callers only ask about the ground
    // strip, so this is a guard against a bad fold rather than a real case.
    const t = dir.y < -1e-6 ? -origin.y / dir.y : 1000;
    return new THREE.Vector3(origin.x + dir.x * t, 0, origin.z + dir.z * t);
  }
}

export interface Slot {
  position: THREE.Vector3;
  scale: number;
}

/** Clear of the picture's soft edge, as a fraction of its width. */
const EDGE = 0.05;
/** Half the open floor between the two sides, as a fraction of the picture's width. */
const GAP_WAITING = 0.07;
/** ...and once they are fighting. The lines close up; nobody brawls across a car park. */
const GAP_FIGHTING = 0.035;

/** Rows and columns for a block of `n` bodies: roughly square, never deeper than five. */
function grid(n: number): { rows: number; cols: number } {
  const rows = Math.max(1, Math.min(5, Math.round(Math.sqrt(n * 0.9))));
  return { rows, cols: Math.ceil(n / rows) };
}

/**
 * Stands everybody on the floor.
 *
 * Laid out in the PAINTING's coordinates and then dropped onto the ground
 * through the reference camera, rather than in world units. The visible floor
 * is a trapezoid whose shape depends on the fold, the stage's aspect and the
 * camera; a layout in picture space is inside it by construction, and the
 * authored enemy positions - fractions of the enemy half of the stage, placed
 * against this same picture - carry over without a conversion table.
 *
 * The party is blocked by role with tanks nearest the enemy, as in the flat
 * overlay and for the same reason: position means nothing to the resolver, and
 * the formation is there to make aggro legible.
 */
export function layoutUnits(
  units: readonly ArenaUnit[],
  projection: Projection,
  floor: Floor,
  aspect: number,
  fighting: boolean,
): Map<string, Slot> {
  // The stage is narrower than the picture, so only the middle of it is seen.
  const seen = Math.min(1, aspect / IMAGE_ASPECT) / 2;
  const gap = fighting ? GAP_FIGHTING : GAP_WAITING;
  const span = seen - EDGE - gap;
  const vFront = floor.front;
  const vBack = Math.min(floor.fold + 0.035, vFront - 0.04);

  const out = new Map<string, Slot>();
  const stand = (id: string, side: 1 | -1, across: number, depth: number, scale: number, order: number) => {
    const u = 0.5 + side * (gap + Math.max(0, Math.min(1, across)) * span);
    const v = vBack + Math.max(0, Math.min(1, depth)) * (vFront - vBack);
    const position = projection.groundAt(u, v);
    // Two sprites in one row are coplanar and fight over every shared pixel.
    // A few millimetres each settles who is in front, the same way every frame.
    position.z += order * 0.004;
    out.set(id, { position, scale });
  };

  const block = (list: readonly ArenaUnit[], side: 1 | -1) => {
    const { rows, cols } = grid(list.length);
    list.forEach((unit, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const inCol = Math.min(rows, list.length - col * rows);
      // A short last column is centred rather than left hanging at the back.
      const depth = inCol === 1 ? 0.5 : row / (inCol - 1);
      // Odd columns sit half a step forward, so a block reads as a crowd
      // rather than as a spreadsheet.
      const stagger = col % 2 === 1 && rows > 1 ? 0.5 / rows : 0;
      stand(unit.id, side, (col + 0.5) / Math.max(cols, 3), depth * (1 - 0.5 / rows) + stagger, 1, i);
    });
  };

  const party = units
    .filter((u) => u.side === "party")
    .map((unit, index) => ({ unit, index }))
    .sort(
      (a, b) =>
        ROLE_RANK[b.unit.role ?? "dps"] - ROLE_RANK[a.unit.role ?? "dps"] || a.index - b.index,
    )
    .map((entry) => entry.unit);
  block(party, -1);

  const enemies = units.filter((u) => u.side === "enemy");
  block(
    enemies.filter((u) => !u.placed),
    1,
  );
  enemies.forEach((unit, i) => {
    if (!unit.placed) return;
    // `y` is authored against the flat stage, where a figure is anchored by
    // its feet and clamped to its own height - so every real value sits in
    // the bottom third. That third is the whole depth of the floor here.
    stand(unit.id, 1, unit.placed.x, (unit.placed.y - 0.7) / 0.3, unit.placed.scale, i);
  });

  return out;
}
