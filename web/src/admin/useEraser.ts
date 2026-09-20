import { useCallback, useRef, useState } from "react";
import { adminFetch } from "../adminKey.js";

/**
 * A destructive pixel eraser for one sliced sprite.
 *
 * WHY THIS IS ALLOWED TO BE DESTRUCTIVE
 * -------------------------------------
 * art/sprites is GENERATED — scripts/slice-sheets.py cuts it out of the
 * untouched source sheets in art/New Assets. So an erase is always undoable
 * with `npm run slice`, and there is no need to carry a non-destructive mask
 * alongside every placement, invent an undo stack, or version the edits. The
 * cheap option is the correct one here only because the pipeline is
 * reproducible; against hand-authored files it would not be.
 *
 * The sprite is loaded into a canvas at its NATURAL size, so brush strokes are
 * converted from stage coordinates back into sprite pixels before they are
 * applied. Erasing at display scale would rub out a different set of pixels
 * depending on how big the preview happened to be.
 *
 * The canvas is EXPOSED rather than kept offscreen, so the admin screen can
 * mount it in place of the sprite while erasing. Without that the strokes are
 * invisible until they are saved, which means committing a destructive edit
 * sight-unseen — the whole point of a brush is watching it work.
 */
export function useEraser(): {
  erasing: boolean;
  setErasing: (on: boolean) => void;
  brush: number;
  setBrush: (n: number) => void;
  strokes: number;
  /** The sprite's natural pixel size, known once begin() has loaded it. */
  natural: { w: number; h: number };
  /** The live working canvas — mount this to show the erase as it happens. */
  surface: HTMLCanvasElement | null;
  /** Solid overlay of everything removed so far, so the erase is visible. */
  removedSurface: HTMLCanvasElement | null;
  begin: (url: string) => Promise<void>;
  erase: (sx: number, sy: number) => void;
  commit: (folder: string, id: string) => Promise<boolean>;
  discard: () => void;
  revert: (folder: string, id: string) => Promise<boolean>;
} {
  const [erasing, setErasing] = useState(false);
  const [brush, setBrush] = useState(12);
  const [strokes, setStrokes] = useState(0);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [surface, setSurface] = useState<HTMLCanvasElement | null>(null);
  /**
   * A second canvas holding ONLY what has been rubbed out, painted solid.
   *
   * Erasing makes pixels transparent, and transparent over a character just
   * shows the body underneath — so a careful erase is almost invisible while
   * you are making it, which is the worst possible time not to see it. This
   * layer is drawn over the sprite in a flat colour so the removed area reads
   * as a shape you can judge before committing to it.
   */
  const removed = useRef<HTMLCanvasElement | null>(null);
  const [removedSurface, setRemovedSurface] = useState<HTMLCanvasElement | null>(null);

  /** Load the sprite into an offscreen canvas ready to be rubbed out. */
  const begin = useCallback(async (url: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`could not load ${url}`));
      // Cache-bust so a re-edit picks up the version just written rather than
      // the one the browser already has.
      img.src = `${url}?t=${Date.now()}`;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    canvas.current = c;
    setSurface(c);

    const mask = document.createElement("canvas");
    mask.width = c.width;
    mask.height = c.height;
    removed.current = mask;
    setRemovedSurface(mask);
    setNatural({ w: c.width, h: c.height });
    setStrokes(0);
  }, []);

  /** Rub out a circle, in the sprite's own pixel coordinates. */
  const erase = useCallback(
    (sx: number, sy: number) => {
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(sx, sy, brush, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Paint the same circle solid on the mask, so the removed area is
      // visible as a shape rather than as an absence.
      const mask = removed.current;
      if (mask) {
        const mctx = mask.getContext("2d")!;
        mctx.fillStyle = "rgba(226, 90, 96, 0.75)";
        mctx.beginPath();
        mctx.arc(sx, sy, brush, 0, Math.PI * 2);
        mctx.fill();
      }
      setStrokes((n) => n + 1);
    },
    [brush],
  );

  const commit = useCallback(async (folder: string, id: string) => {
    const c = canvas.current;
    if (!c) return false;
    try {
      const res = await adminFetch("/sprite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, id, png: c.toDataURL("image/png") }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const discard = useCallback(() => {
    canvas.current = null;
    removed.current = null;
    setSurface(null);
    setRemovedSurface(null);
    setStrokes(0);
  }, []);

  /** Restore this sprite from the backup taken before its first erase. */
  const revert = useCallback(async (folder: string, id: string) => {
    try {
      const res = await adminFetch("/sprite/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, id }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return {
    erasing, setErasing, brush, setBrush, strokes, natural, surface, removedSurface,
    begin, erase, commit, discard, revert,
  };
}
