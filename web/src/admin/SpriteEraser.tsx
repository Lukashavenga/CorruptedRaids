import { useEffect, useRef, useState } from "react";
import { useEraser } from "./useEraser.js";
import { bumpSpriteVersion, spriteUrl } from "../sprites.js";

export interface SpriteEraserProps {
  /** Sprite folder, e.g. "enemies/heroic-guards". */
  folder: string;
  id: string;
  onClose: () => void;
  setStatus: (message: string) => void;
  /** Called after a save or revert, so the caller can refresh its thumbnails. */
  onChanged?: () => void;
}

/** Longest side the sprite is shown at while painting, in px. */
const VIEW = 380;

/**
 * Paint unwanted pixels off one finished sprite.
 *
 * The placement screen already has an eraser, but it is welded to that screen's
 * stage: strokes are unprojected through a placement's centre, scale and
 * rotation, none of which an enemy sprite has. This is the same tool without
 * that chain — the sprite is simply drawn at a whole-number zoom and a click is
 * divided by it.
 *
 * What it is FOR is bleedover. The sheets are packed tight enough that a crop
 * can catch a slice of whoever was standing next to it, and while the slicer now
 * masks each figure to its own outline (scripts/slice-encounters.py), that
 * cannot separate two figures whose pixels genuinely touch. Those are the ones
 * that need a brush.
 *
 * Destructive, and safe for the same reason the other eraser is: art/sprites is
 * generated, so `npm run slice` restores everything, and the server keeps a
 * per-sprite backup of the original before the first edit.
 */
export function SpriteEraser({ folder, id, onClose, setStatus, onChanged }: SpriteEraserProps): JSX.Element {
  const eraser = useEraser();
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void eraser.begin(spriteUrl(folder, id)).then(() => {
      if (live) eraser.setErasing(true);
    });
    return () => {
      live = false;
      eraser.discard();
    };
    // Reloading on a new sprite is the point; the eraser's own identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, id]);

  // A whole-number zoom, so the pixels being painted are the pixels on screen.
  // Fractional scaling would put brush strokes half-way into a pixel and make a
  // careful edit impossible to aim.
  const zoom = Math.max(1, Math.floor(VIEW / Math.max(eraser.natural.w, eraser.natural.h)));
  const shownW = eraser.natural.w * zoom;
  const shownH = eraser.natural.h * zoom;

  /** Pointer position in the sprite's own pixels. */
  const toSprite = (e: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect();
    return { sx: (e.clientX - rect.left) / zoom, sy: (e.clientY - rect.top) / zoom };
  };

  const mount = (surface: HTMLCanvasElement | null) => (el: HTMLDivElement | null) => {
    if (el && surface && el.firstChild !== surface) el.replaceChildren(surface);
  };

  const save = async () => {
    const ok = await eraser.commit(folder, id);
    setStatus(ok ? `Saved ${id}.` : `Could not save ${id}.`);
    if (ok) {
      bumpSpriteVersion();
      onChanged?.();
      onClose();
    }
  };

  return (
    <div className="sprite-eraser">
      <div className="sprite-eraser-head">
        <strong>{id}</strong>
        <span className="admin-hint">
          {eraser.natural.w}&times;{eraser.natural.h} at {zoom}:1
        </span>
      </div>

      <div
        className="sprite-eraser-stage"
        ref={boxRef}
        style={{ width: shownW, height: shownH }}
        onPointerDown={(e) => {
          try {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          } catch {
            /* painting still works without capture */
          }
          const p = toSprite(e);
          eraser.erase(p.sx, p.sy);
        }}
        onPointerMove={(e) => {
          const rect = boxRef.current!.getBoundingClientRect();
          setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          if (e.buttons !== 1) return;
          const p = toSprite(e);
          eraser.erase(p.sx, p.sy);
        }}
        onPointerLeave={() => setCursor(null)}
      >
        {/* The working canvas, then the removed area painted solid over it -
            rubbing pixels out against a checkerboard is otherwise almost
            invisible while you are doing it. */}
        <div className="sprite-eraser-canvas" style={{ transform: `scale(${zoom})` }} ref={mount(eraser.surface)} />
        <div className="sprite-eraser-canvas" style={{ transform: `scale(${zoom})` }} ref={mount(eraser.removedSurface)} />
        {cursor && (
          <span
            className="admin-brush"
            style={{
              left: `${cursor.x}px`,
              top: `${cursor.y}px`,
              width: `${eraser.brush * 2 * zoom}px`,
              height: `${eraser.brush * 2 * zoom}px`,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      <label>
        Brush {eraser.brush}px
        <input
          type="range"
          min={1}
          max={40}
          value={eraser.brush}
          onChange={(e) => eraser.setBrush(Number(e.target.value))}
        />
      </label>

      <div className="admin-copy">
        <button type="button" className="admin-danger" onClick={save} disabled={eraser.strokes === 0}>
          Save {eraser.strokes} erase{eraser.strokes === 1 ? "" : "s"}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>

      <button
        type="button"
        className="admin-revert"
        onClick={async () => {
          const ok = await eraser.revert(folder, id);
          setStatus(ok ? `Reverted ${id}.` : "No backup - this sprite has never been edited.");
          if (ok) {
            bumpSpriteVersion();
            onChanged?.();
            await eraser.begin(spriteUrl(folder, id));
          }
        }}
      >
        Revert to the sliced original
      </button>
      <p className="admin-hint">
        Overwrites art/sprites. <code>npm run slice</code> restores everything - the source sheets
        are never touched.
      </p>
    </div>
  );
}
