import { useEffect, useState } from "react";
import { STAGE_H, STAGE_W } from "../stage.js";

/**
 * Integer scale factor that fits the fixed 450x250 stage into the window.
 *
 * In OBS the browser source is exactly the stage size, so this returns 1 and
 * the overlay renders pixel for pixel as designed — which is the case that has
 * to be right. The scaling exists for every other context: reviewing the
 * overlay in a normal browser tab, where an unscaled 450x250 surface in a
 * 1400px window is too small to judge.
 *
 * Integer only, and never below 1. The whole surface is pixel art and a bitmap
 * font that is crisp at multiples of its 16px cell; a fractional scale would
 * put glyph edges and sprite pixels on half-pixel boundaries and undo the
 * thing the art is built around.
 */
export function useStageScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const measure = () => {
      const fit = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
      setScale(Math.max(1, Math.floor(fit)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return scale;
}
