import { useEffect, useState, type CSSProperties } from "react";
import type { BodyType, GearSlot } from "../../../src/engine/types.js";
import {
  CANVAS,
  BASELINE_Y,
  CENTRE_X,
  DRAW_ORDER,
  SLOT_Z,
  BODY_Z,
  HAIR_Z,
  HAND_Z,
  HIDES_HAIR,
  type MaskRect,
  type Motion,
  type PlacementFile,
} from "../../../src/character/layers.js";
import { HAIR_FOLDER, SLOT_FOLDER, bodyUrl, handUrl, placementFor, spriteUrl } from "../sprites.js";
import { HAND_OFFSET } from "../handOffsets.js";

export interface CharacterSpriteProps {
  bodyType: BodyType;
  skinTone: string;
  /** Hair sprite id, or null for bald. Suppressed automatically by a helmet. */
  hair?: string | null;
  /** Already-resolved sprite id per slot — see spriteForGear(). */
  layers: Partial<Record<GearSlot, string>>;
  /**
   * Slots the player has chosen to hide. The item stays equipped and its stats
   * still count; only the art is suppressed. A cosmetic preference, not an
   * unequip, which is why it lives here and not in the engine.
   */
  hiddenSlots?: readonly GearSlot[];
  placements: PlacementFile;
  /** Rendered size in CSS px. Prefer a power-of-two fraction of CANVAS. */
  size?: number;
  /**
   * Take the width of whatever contains this instead of a fixed `size`.
   *
   * A fixed size is right for the overlay, which ships at one resolution the
   * streamer sets once. It is wrong for the loadout, where the figure sits in
   * a column that has to survive a phone: an inline width cannot be overridden
   * by a stylesheet, so the column could not compress and the layout broke
   * before the mobile rules ever ran (AGENTS.md §10).
   */
  fluid?: boolean;
  motion?: Motion;
  /**
   * Which way the character looks. The art is drawn facing right, so "left" is
   * a horizontal flip — used for the enemy line, which faces the party across
   * the stage.
   */
  facing?: "right" | "left";
  className?: string;
}

/**
 * A character, composited from sliced sprites on the shared 512px canvas.
 *
 * Every layer is an independent picture positioned by content/placements.json
 * (see src/character/layers.ts). Nothing here knows what a helmet is or where a
 * head should be — it stacks images at recorded offsets, and the admin screen
 * is what records them.
 *
 * A sprite with no placement lands at the origin at 1:1, which looks obviously
 * wrong on purpose. A sprite whose FILE is missing is dropped silently, so a
 * half-authored item degrades to a bare body rather than a broken image.
 */
export function CharacterSprite({
  bodyType,
  skinTone,
  hair = null,
  layers,
  hiddenSlots = [],
  placements,
  size = CANVAS,
  fluid = false,
  motion = "idle",
  facing = "right",
  className,
}: CharacterSpriteProps): JSX.Element {
  // In fluid mode the box is measured rather than declared. A ResizeObserver
  // and not a container query, because the scale is a NUMBER handed to
  // transform: scale(), and CSS has no way to hand a ratio to a transform that
  // every browser this has to run in agrees on.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    if (!fluid || !box) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setMeasured(entry.contentRect.width);
    });
    observer.observe(box);
    setMeasured(box.clientWidth);
    return () => observer.disconnect();
  }, [fluid, box]);

  // Until the first measurement lands there is nothing honest to draw at, so
  // the rig renders at zero scale rather than flashing at full canvas size.
  const drawn = fluid ? measured : size;
  const scale = drawn / CANVAS;
  const hidden = new Set<GearSlot>(hiddenSlots);

  /**
   * Regions of the body and of the hair suppressed by what is currently worn —
   * boots replacing feet, a helm replacing the top of a head. Collected from
   * the VISIBLE layers only, so hiding a boot brings the bare foot back rather
   * than leaving a gap.
   */
  const collectMask = (key: "bodyMask" | "hairMask"): MaskRect[] =>
    DRAW_ORDER.flatMap((slot) => {
      const spriteId = layers[slot];
      if (!spriteId || hidden.has(slot)) return [];
      return placementFor(placements, slot, spriteId, bodyType)[key] ?? [];
    });

  const bodyMask = collectMask("bodyMask");
  const hairMask = collectMask("hairMask");

  /**
   * The head item that covers the hair, and where it sits.
   *
   * Hair is cut to this sprite's own ALPHA rather than to hand-drawn
   * rectangles. Rectangles could not do the job and the failure was not
   * cosmetic: one rectangle has to serve forty hairstyles, so the box that
   * correctly hides a cropped style under the Crusader Helm erases a ponytail
   * entirely, while a stray lock outside the box survives untouched. Both at
   * once, from the same data.
   *
   * The helmet's alpha is exactly the region the helmet covers, so it needs no
   * tuning, is right for every hairstyle, and stays right when the art changes.
   */

  // Hair is always drawn when the character has any. A head item no longer
  // DELETES it — it carves it, by its own alpha (see HairLayer) — so a closed
  // helm covers the skull while a ponytail still hangs out the back, and a
  // circlet hides almost nothing. That is a property of the drawing, and it
  // needs no per-item data at all.
  const headSprite = layers[HIDES_HAIR];
  const headFolder = SLOT_FOLDER[HIDES_HAIR];
  const occluderUrl =
    headSprite && headFolder && !hidden.has(HIDES_HAIR) ? spriteUrl(headFolder, headSprite) : null;
  const occluderPlacement =
    headSprite && occluderUrl ? placementFor(placements, HIDES_HAIR, headSprite, bodyType) : null;
  const occluderSize = useNaturalSize(occluderUrl);

  // "hide" is the default for a head item, so a helmet suppresses hair outright
  // unless its placement opts into carving. Carving is the better answer for a
  // hood or a circlet and the wrong one for a closed helm, and only a person
  // looking at the drawing can tell which.
  const headCoverage = occluderPlacement?.hairCoverage ?? "hide";
  const showHair = Boolean(hair) && !(occluderUrl && headCoverage === "hide");

  const drop = (e: { currentTarget: HTMLImageElement }) => {
    e.currentTarget.style.display = "none";
  };

  const layerStyle = (z: number, x: number, y: number, s: number, rot = 0): CSSProperties => ({
    position: "absolute",
    left: `${x}px`,
    top: `${y}px`,
    // translate(-50%,-50%) centres the layer on (x, y) without this component
    // ever needing to know the sprite's pixel dimensions — which it cannot know
    // until the image loads. Rotation and scale then apply about that same
    // centre, keeping all three controls independent.
    transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${s})`,
    transformOrigin: "center center",
    imageRendering: "pixelated",
    zIndex: z,
    pointerEvents: "none",
  });

  return (
    <div
      className={`char-sprite motion-${motion} ${className ?? ""}`}
      ref={fluid ? setBox : undefined}
      style={
        fluid
          ? { width: "100%", aspectRatio: "1", position: "relative", overflow: "hidden" }
          : { width: size, height: size, position: "relative", overflow: "hidden" }
      }
    >
      {/* One wrapper carries the whole-canvas scale and the facing flip, so
          every layer stays in register with the body at any size. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: CANVAS,
          height: CANVAS,
          // Order matters. The origin has to stay top-left so the outer scale
          // lines up with the container, which means a bare scaleX(-1) would
          // mirror the whole canvas to negative x and out of view — that bug
          // made every enemy invisible. Translating a full canvas width right
          // BEFORE mirroring lands it back exactly where it started.
          transform: `scale(${scale})${facing === "left" ? ` translateX(${CANVAS}px) scaleX(-1)` : ""}`,
          transformOrigin: "top left",
        }}
      >
        <BodyLayer bodyType={bodyType} skinTone={skinTone} mask={bodyMask} onError={drop} />

        {showHair && hair && (
          <HairLayer
            hair={hair}
            placement={placementFor(placements, "hair", hair, bodyType)}
            mask={hairMask}
            occluder={
              occluderUrl && occluderPlacement && occluderSize
                ? { url: occluderUrl, placement: occluderPlacement, natural: occluderSize }
                : null
            }
            layerStyle={layerStyle}
            onError={drop}
          />
        )}

        {DRAW_ORDER.map((slot) => {
          const spriteId = layers[slot];
          const folder = SLOT_FOLDER[slot];
          if (!spriteId || !folder || hidden.has(slot)) return null;
          const placement = placementFor(placements, slot, spriteId, bodyType);
          return (
            <PlacedLayer
              key={slot}
              // An item may override its slot's draw order — see Placement.z.
              z={placement.z ?? SLOT_Z[slot]}
              url={spriteUrl(folder, spriteId)}
              placement={placement}
              layerStyle={layerStyle}
              onError={drop}
            />
          );
        })}

        {/* The fist, put back on top of whatever it is holding. Only drawn
            when there IS something to hold - over a bare hand it would be an
            invisible duplicate of pixels already there. */}
        {layers.mainHand && !hidden.has("mainHand") && (
          <HandLayer bodyType={bodyType} skinTone={skinTone} onError={drop} />
        )}
      </div>
    </div>
  );
}

/**
 * The natural pixel size of a sprite, once the browser has it.
 *
 * Needed because a CSS mask has to be given an explicit size in pixels, and the
 * only place that size exists is the image itself. The file is already on
 * screen by the time this runs, so it resolves from cache without a second
 * request.
 */
function useNaturalSize(url: string | null): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!url) {
      setSize(null);
      return;
    }
    let live = true;
    const img = new Image();
    img.onload = () => live && setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return size;
}

interface Occluder {
  url: string;
  placement: { x: number; y: number; scale: number; rotation?: number; hairCoverage?: "hide" | "skull" | "outline" };
  natural: { w: number; h: number };
}

/**
 * Hair, carved by whatever is worn over it.
 *
 * Two cuts, and they do different jobs:
 *
 *  - The OCCLUDER is the head item's own alpha, subtracted from the hair. This
 *    is the one that matters — it hides hair exactly where the helmet covers
 *    it, for any hairstyle, with nothing to tune.
 *  - `hairMask` rectangles subtract further, for the cases alpha cannot know
 *    about: a tight helm that should flatten a big hairstyle rather than let it
 *    billow out around the rim.
 *
 * The alpha cut is done with `mask-composite: exclude` over a full-coverage
 * base layer, which is XOR — and since the helmet is wholly inside the canvas,
 * XOR is "everything except the helmet".
 *
 * ROTATION is why this nests. A CSS mask is resolved in the element's own
 * coordinate space before its transforms, so a mask layer cannot be rotated on
 * its own. Rotating the masked element turns the mask correctly but drags the
 * hair with it, so an inner wrapper turns the hair back by the same angle about
 * the same point. The hair ends up where it started and the mask ends up
 * aligned with a helmet that sits at an angle.
 */
function HairLayer({
  hair,
  placement,
  mask,
  occluder,
  layerStyle,
  onError,
}: {
  hair: string;
  placement: { x: number; y: number; scale: number; rotation?: number; z?: number };
  mask: MaskRect[];
  occluder: Occluder | null;
  layerStyle: (z: number, x: number, y: number, s: number, rot?: number) => CSSProperties;
  onError: (e: { currentTarget: HTMLImageElement }) => void;
}): JSX.Element {
  const z = placement.z ?? HAIR_Z;
  let layer: JSX.Element = (
    <PlacedLayer
      z={z}
      url={spriteUrl(HAIR_FOLDER, hair)}
      placement={placement}
      layerStyle={layerStyle}
      onError={onError}
    />
  );

  if (occluder) {
    const { x, y, scale, rotation = 0 } = occluder.placement;
    const w = occluder.natural.w * scale;
    const h = occluder.natural.h * scale;
    // "skull" masks with a solid block the size of the sprite's box; "outline"
    // masks with the sprite itself. Everything downstream — the XOR against a
    // full-coverage layer, the counter-rotation — is identical either way, so
    // the mode is only a choice of which image to subtract.
    const skull = (occluder.placement.hairCoverage ?? "hide") !== "outline";
    const cutImage = skull ? "linear-gradient(#000, #000)" : `url("${occluder.url}")`;
    const cut: CSSProperties = {
      position: "absolute",
      left: 0,
      top: 0,
      width: CANVAS,
      height: CANVAS,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
      transformOrigin: `${x}px ${y}px`,
      // Both spellings: OBS ships whatever CEF build it ships, and an
      // unsupported mask silently means no cut at all rather than a visible
      // fault, which is the worst way for this to fail.
      maskImage: `${cutImage}, linear-gradient(#000, #000)`,
      WebkitMaskImage: `${cutImage}, linear-gradient(#000, #000)`,
      maskPosition: `${x - w / 2}px ${y - h / 2}px, 0 0`,
      WebkitMaskPosition: `${x - w / 2}px ${y - h / 2}px, 0 0`,
      maskSize: `${w}px ${h}px, 100% 100%`,
      WebkitMaskSize: `${w}px ${h}px, 100% 100%`,
      maskRepeat: "no-repeat, no-repeat",
      WebkitMaskRepeat: "no-repeat, no-repeat",
      maskComposite: "exclude, add",
      WebkitMaskComposite: "xor, source-over",
      zIndex: z,
      pointerEvents: "none",
    };
    layer = (
      <div style={cut}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: CANVAS,
            height: CANVAS,
            transform: rotation ? `rotate(${-rotation}deg)` : undefined,
            transformOrigin: `${x}px ${y}px`,
          }}
        >
          {layer}
        </div>
      </div>
    );
  }

  if (mask.length === 0) return layer;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: CANVAS,
        height: CANVAS,
        clipPath: clipWithHoles(mask, 0, 0, CANVAS, CANVAS),
        zIndex: z,
        pointerEvents: "none",
      }}
    >
      {layer}
    </div>
  );
}

/**
 * The character's own fist, re-drawn over the weapon.
 *
 * It carries no placement, and must not: these are the body's own pixels cut
 * from a known offset, so the only correct position is exactly where they came
 * from. Anything adjustable here could only ever be adjusted WRONG.
 */
function HandLayer({
  bodyType,
  skinTone,
  onError,
}: {
  bodyType: BodyType;
  skinTone: string;
  onError: (e: { currentTarget: HTMLImageElement }) => void;
}): JSX.Element {
  const offset = HAND_OFFSET[bodyType] ?? { x: 0, y: 0 };
  return (
    <img
      src={handUrl(bodyType, skinTone)}
      alt=""
      style={{ position: "absolute", imageRendering: "pixelated", zIndex: HAND_Z, pointerEvents: "none" }}
      draggable={false}
      onError={onError}
      ref={(el) => {
        if (!el) return;
        // The body is centred on CENTRE_X and stands on BASELINE_Y, so the cut
        // -out goes back at the body's own origin plus the offset it was taken
        // from. Both need the BODY's size, not the hand's.
        const place = (bw: number, bh: number) => {
          el.style.left = `${CENTRE_X - bw / 2 + offset.x}px`;
          el.style.top = `${BASELINE_Y - bh + offset.y}px`;
        };
        const body = new Image();
        body.onload = () => place(body.naturalWidth, body.naturalHeight);
        body.src = bodyUrl(bodyType, skinTone);
      }}
    />
  );
}

function PlacedLayer({
  z,
  url,
  placement,
  layerStyle,
  onError,
}: {
  z: number;
  url: string;
  placement: { x: number; y: number; scale: number; rotation?: number; z?: number };
  layerStyle: (z: number, x: number, y: number, s: number, rot?: number) => CSSProperties;
  onError: (e: { currentTarget: HTMLImageElement }) => void;
}): JSX.Element {
  return (
    <img
      src={url}
      alt=""
      style={layerStyle(z, placement.x, placement.y, placement.scale, placement.rotation ?? 0)}
      draggable={false}
      onError={onError}
    />
  );
}

/**
 * A clip path covering the whole element with the mask rectangles punched out.
 *
 * even-odd is what makes the holes: the outer rectangle winds one way and each
 * inner one overlaps it, so the overlap is excluded rather than filled. A
 * single CSS property, and no compositing modes to fall foul of.
 */
function clipWithHoles(mask: MaskRect[], left: number, top: number, w: number, h: number): string {
  const rect = (x: number, y: number, rw: number, rh: number) =>
    `M${x} ${y} H${x + rw} V${y + rh} H${x} Z`;
  const holes = mask.map((m) => rect(m.x - left, m.y - top, m.w, m.h)).join(" ");
  return `path(evenodd, "${rect(0, 0, w, h)} ${holes}")`;
}

/**
 * The base body, centred on the frame and standing on the baseline.
 *
 * Unlike gear it has no placement entry — a body IS the frame of reference
 * every placement is measured against, so letting it move would invalidate
 * every coordinate at once. Its position is derived from its own natural size
 * instead, because the two bodies differ (male 257x429, female 237x389) and
 * both have to stand on the same line.
 */
function BodyLayer({
  bodyType,
  skinTone,
  mask,
  onError,
}: {
  bodyType: BodyType;
  skinTone: string;
  mask: MaskRect[];
  onError: (e: { currentTarget: HTMLImageElement }) => void;
}): JSX.Element {
  const maskKey = JSON.stringify(mask);
  return (
    <img
      src={bodyUrl(bodyType, skinTone)}
      alt=""
      style={{
        position: "absolute",
        imageRendering: "pixelated",
        zIndex: BODY_Z,
        pointerEvents: "none",
      }}
      draggable={false}
      onError={onError}
      // Re-run the ref when the mask changes so the clip is rebuilt on equip.
      key={maskKey}
      ref={(el) => {
        if (!el) return;
        const place = () => {
          const left = CENTRE_X - el.naturalWidth / 2;
          const top = BASELINE_Y - el.naturalHeight;
          el.style.left = `${left}px`;
          el.style.top = `${top}px`;
          // clip-path is relative to the element's own box, but masks are
          // stored in CANVAS coordinates — so they have to be offset by where
          // the body actually landed, which is only known once it has loaded.
          el.style.clipPath = mask.length === 0 ? "" : clipWithHoles(mask, left, top, el.naturalWidth, el.naturalHeight);
        };
        if (el.complete && el.naturalWidth) place();
        else el.addEventListener("load", place, { once: true });
      }}
    />
  );
}
