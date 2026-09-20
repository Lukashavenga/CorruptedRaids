import { useEffect, useState } from "react";

/**
 * The largest of `sizes` at which `text` fits `maxWidth`, measured in the real
 * display font.
 *
 * WHY MEASURED, AND WHY ONLY WHOLE SIZES
 * --------------------------------------
 * The display face is a bitmap font that is only crisp at whole multiples of
 * its 16px cell (scripts/build-font.py), so the usual answers — shrink to fit,
 * `font-size: clamp()`, a transform scale — all put glyph edges on half pixels
 * and undo the thing the art is built around. The only honest fallback is to
 * step DOWN a whole size, which is what `sizes` is: the crisp sizes, biggest
 * first.
 *
 * And it has to be measured rather than estimated from character count,
 * because the face is not monospaced — "Marketgate" runs 18.2px per character
 * at 32px where "Awaiting the next run..." runs 15.9.
 *
 * WHAT IT IS FOR
 * --------------
 * The gathering banner is `NAME — LEVEL n`, and the name is content. At ten
 * characters ("Marketgate") that fits the 438px stage with room to spare; at
 * thirty-eight ("Woop Woop - Dats the Sound of Da Police") it renders about
 * 608px and the stage clips it at BOTH ends — the audience saw
 * "- Dats the Sound of Da Polic", with the level, which is the whole point of
 * the line, cut off the right-hand side.
 *
 * Returns the first size while the font is still loading, which is the right
 * guess: it is the size everything short enough already uses.
 */
export function useFittedFontSize(text: string, maxWidth: number, sizes: number[], family: string): number {
  const [size, setSize] = useState(sizes[0] ?? 32);

  useEffect(() => {
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const canvas = (measure as { c?: HTMLCanvasElement }).c ?? document.createElement("canvas");
      (measure as { c?: HTMLCanvasElement }).c = canvas;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      for (const candidate of sizes) {
        ctx.font = `${candidate}px ${family}`;
        if (ctx.measureText(text).width <= maxWidth) {
          setSize(candidate);
          return;
        }
      }
      // Nothing fits: take the smallest and let it clip rather than return
      // something that was never in the caller's list of crisp sizes.
      setSize(sizes[sizes.length - 1] ?? 16);
    };

    measure();
    // A web font that has not loaded yet measures as the fallback face, which
    // is a different width — so measure again once the real one is in.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) void fonts.ready.then(measure);

    return () => {
      cancelled = true;
    };
  }, [text, maxWidth, family, sizes.join(",")]);

  return size;
}
