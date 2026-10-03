import type { GearSlot } from "../../../src/engine/types.js";
import {
  BASELINE_Y,
  BODY_Z,
  CANVAS,
  CENTRE_X,
  DRAW_ORDER,
  HAIR_Z,
  HAND_Z,
  HIDES_HAIR,
  SLOT_Z,
  type MaskRect,
  type Placement,
  type PlacementFile,
} from "../../../src/character/layers.js";
import { HAIR_FOLDER, SLOT_FOLDER, bodyUrl, handUrl, placementFor, spriteUrl } from "../sprites.js";
import { HAND_OFFSET } from "../handOffsets.js";
import type { ArenaCharacter } from "./types.js";

/**
 * A character, flattened onto one canvas so it can be a texture.
 *
 * THIS IS A SECOND COMPOSITOR, and that is a cost worth naming. CharacterSprite
 * stacks the same layers as DOM images and lets CSS do the cutting; WebGL
 * cannot sample a stack of DOM images, so the stack has to be drawn. Every rule
 * here is CharacterSprite's rule restated for a 2D context - same draw order,
 * same placements, same masks, same answer to "does this helm hide hair". If
 * one of them changes, the other has to, and the place to look is the comment
 * on the matching piece of CharacterSprite.tsx, which explains WHY each rule
 * exists. This file only says how it is done on a canvas.
 *
 * Hidden slots are not handled because the overlay never hides one: that is a
 * loadout preference and it does not travel with a party member.
 */

const images = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * Loads a sprite once. Resolves null for a missing file rather than rejecting,
 * because a half-authored item should cost a layer and not the character.
 */
function load(url: string): Promise<HTMLImageElement | null> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise((resolve) => {
      const img = new Image();
      // An erased sprite is served from the storage bucket, which is another
      // origin. Without this the canvas it is drawn onto is tainted and WebGL
      // refuses to read it - the whole character would come out blank because
      // of one edited hat.
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, pending);
  }
  return pending;
}

function scratch(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Runs `draw` in the placement's own frame: centred on (x, y), turned and scaled about it. */
function inPlacement(ctx: CanvasRenderingContext2D, p: Placement, draw: () => void): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(((p.rotation ?? 0) * Math.PI) / 180);
  ctx.scale(p.scale, p.scale);
  draw();
  ctx.restore();
}

function punch(ctx: CanvasRenderingContext2D, mask: readonly MaskRect[]): void {
  for (const m of mask) ctx.clearRect(m.x, m.y, m.w, m.h);
}

/** Everything that decides what a character looks like, as one comparable string. */
export function characterKey(spec: ArenaCharacter, placements: PlacementFile): string {
  const worn = DRAW_ORDER.map((slot) => {
    const id = spec.layers[slot];
    return id ? `${slot}:${id}:${JSON.stringify(placementFor(placements, slot, id, spec.bodyType))}` : "";
  }).join("|");
  const hair = spec.hair ? JSON.stringify(placementFor(placements, "hair", spec.hair, spec.bodyType)) : "";
  return `${spec.bodyType}/${spec.skinTone}/${spec.hair ?? ""}${hair}/${worn}`;
}

export async function composeCharacter(
  spec: ArenaCharacter,
  placements: PlacementFile,
): Promise<HTMLCanvasElement> {
  const { bodyType, skinTone, hair, layers } = spec;
  const worn = DRAW_ORDER.flatMap((slot) => {
    const id = layers[slot];
    const folder = SLOT_FOLDER[slot];
    return id && folder ? [{ slot, url: spriteUrl(folder, id), placement: placementFor(placements, slot, id, bodyType) }] : [];
  });

  const mask = (key: "bodyMask" | "hairMask"): MaskRect[] => worn.flatMap((w) => w.placement[key] ?? []);

  const head = worn.find((w) => w.slot === HIDES_HAIR);
  const coverage = head?.placement.hairCoverage ?? "hide";
  const showHair = Boolean(hair) && !(head && coverage === "hide");

  const [body, hand, hairImg, ...gear] = await Promise.all([
    load(bodyUrl(bodyType, skinTone)),
    layers.mainHand ? load(handUrl(bodyType, skinTone)) : Promise.resolve(null),
    showHair && hair ? load(spriteUrl(HAIR_FOLDER, hair)) : Promise.resolve(null),
    ...worn.map((w) => load(w.url)),
  ]);

  // One entry per layer, drawn onto the output in z order. Listed in the order
  // CharacterSprite emits its elements, and sorted stably, so two layers on
  // the same z resolve the way the DOM resolves them.
  const stack: { z: number; draw: (out: CanvasRenderingContext2D) => void }[] = [];

  if (body) {
    const left = CENTRE_X - body.naturalWidth / 2;
    const top = BASELINE_Y - body.naturalHeight;
    stack.push({
      z: BODY_Z,
      draw: (out) => {
        const ctx = scratch();
        ctx.drawImage(body, left, top);
        punch(ctx, mask("bodyMask"));
        out.drawImage(ctx.canvas, 0, 0);
      },
    });

  }

  if (hairImg && hair) {
    const placement = placementFor(placements, "hair", hair, bodyType);
    const headIndex = head ? worn.indexOf(head) : -1;
    const occluder = headIndex >= 0 ? gear[headIndex] : null;
    stack.push({
      z: placement.z ?? HAIR_Z,
      draw: (out) => {
        const ctx = scratch();
        inPlacement(ctx, placement, () => ctx.drawImage(hairImg, -hairImg.naturalWidth / 2, -hairImg.naturalHeight / 2));
        if (head && occluder) {
          // `outline` subtracts the head item's own alpha; `skull` subtracts
          // the whole box it sits in. Both are placed and turned exactly as
          // the item is, which is the point of cutting with it.
          ctx.globalCompositeOperation = "destination-out";
          inPlacement(ctx, head.placement, () => {
            const w = occluder.naturalWidth;
            const h = occluder.naturalHeight;
            if (coverage === "outline") ctx.drawImage(occluder, -w / 2, -h / 2);
            else ctx.fillRect(-w / 2, -h / 2, w, h);
          });
          ctx.globalCompositeOperation = "source-over";
        }
        punch(ctx, mask("hairMask"));
        out.drawImage(ctx.canvas, 0, 0);
      },
    });
  }

  worn.forEach((w, i) => {
    const img = gear[i];
    if (!img) return;
    stack.push({
      z: w.placement.z ?? SLOT_Z[w.slot as GearSlot],
      draw: (out) =>
        inPlacement(out, w.placement, () => out.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)),
    });
  });

  // The fist goes back exactly where it was cut from, which is measured from
  // the BODY's corner - so it only exists if the body does. Last in the list,
  // as it is last in the DOM, so it wins a tie against a layer on its own z.
  if (body && hand) {
    const offset = HAND_OFFSET[bodyType] ?? { x: 0, y: 0 };
    const left = CENTRE_X - body.naturalWidth / 2 + offset.x;
    const top = BASELINE_Y - body.naturalHeight + offset.y;
    stack.push({ z: HAND_Z, draw: (out) => out.drawImage(hand, left, top) });
  }

  const out = scratch();
  stack
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.z - b.layer.z || a.index - b.index)
    .forEach(({ layer }) => layer.draw(out));
  return out.canvas;
}
