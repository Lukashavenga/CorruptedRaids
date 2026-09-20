"""
Builds a real webfont out of art/reference/fonts.png.

    python scripts/build-font.py

The source is a bitmap glyph sheet, not a font — an 8x10 grid of 16px cells
that a browser cannot render as text. This turns it into
web/public/fonts/corrupted.ttf so the overlay can simply say
`font-family: CorruptedPixel` and get the project's own lettering, at any size,
with real text selection, wrapping and layout.

WHY A FONT AND NOT CSS SPRITES
------------------------------
The alternative is drawing each character as a positioned background-image.
That works for a fixed HUD label and falls apart for everything this overlay
actually does: a combat log of arbitrary names and numbers, text that has to
wrap and ellipsize, and strings that come from content JSON. A font gets all
of that for free.

HOW THE OUTLINES ARE BUILT
--------------------------
Every ink pixel becomes part of a rectangle, via greedy meshing: maximal
horizontal runs per row, each then extended downward as far as the identical
run continues. A per-pixel square would also render correctly but produces
~250 contours per glyph; meshing typically cuts that by an order of magnitude,
which keeps the file small and the rasteriser fast at the tiny sizes this is
used at.

The font is deliberately NOT hinted and the pixel grid is preserved exactly:
at integer multiples of 16px it renders pixel-perfect, which is the whole
point. Use it at 16/32/48px and it stays crisp; use it at 21px and the
rasteriser will fudge rows.

fontTools is a dev-time dependency, consistent with the rest of scripts/ —
the engine, server and overlay stay dependency-free at runtime, and the TTF
this produces is a committed artefact.
"""

import sys
from collections import Counter
from pathlib import Path

from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "art" / "reference" / "fonts.png"
OUT = ROOT / "web" / "public" / "fonts" / "corrupted.ttf"

CELL = 16
COLS, ROWS = 8, 10

# Read directly off the sheet, row by row. Getting this wrong renders every
# string as plausible-looking gibberish, so it is transcribed from a labelled
# render of the grid rather than assumed to be ASCII order.
CHARSET = (
    "ABCDEFGH"
    "IJKLMNOP"
    "QRSTUVWX"
    "YZabcdef"
    "ghijklmn"
    "opqrstuv"
    "wxyz.,!?"
    ":;'\"-•()"
    "01234567"
    "89/%*=_$"
)

# Characters the sheet has no glyph for, pointed at the nearest one it does.
# Without these the overlay's own copy (an em dash in a banner, an ellipsis in
# "Awaiting the next dungeon…") silently falls back to a system font mid-line,
# which is far more obvious than a slightly wrong dash.
ALIASES = {
    "—": "-",   # em dash
    "–": "-",   # en dash
    "·": "•",
    "’": "'",
    "“": '"',
    "”": '"',
}

# Characters with no single-glyph equivalent, rewritten before they are ever
# drawn. An ellipsis has no glyph on the sheet and was silently rendering as
# one dot, which reads as a full stop and changes the sentence.
TEXT_SUBSTITUTIONS = {"…": "..."}

# The generated sheet drew one glyph badly: its Z has a clean diagonal but
# STIPPLED horizontal bars, so it renders as a hatched box rather than a
# letter. It shows up in ordinary copy ("Grunkzor"), so it is redrawn here
# rather than shipped broken. Patching in the builder keeps art/reference
# untouched as the source of record, and a redrawn sheet just drops the
# override. Rows/cols match the sheet's own capital metrics: rows 3-13,
# cols 3-12, 2px strokes.
GLYPH_OVERRIDES = {
    "Z": [
        "##########",
        "##########",
        ".......###",
        "......###.",
        ".....###..",
        "....###...",
        "...###....",
        "..###.....",
        ".###......",
        "##########",
        "##########",
    ],
}
OVERRIDE_ORIGIN = (3, 3)   # (col, row) of the top-left of the art above

# Glyphs the sheet does not contain at all. The sheet has "-" but no "+", which
# matters because signed numbers are the clearest way to show damage against
# healing in a combat readout — "-24" and "+16" carry the sign without spending
# a word on it, which is the difference between a log line fitting the stage
# and being ellipsised. Drawn to the same 2-3px stroke as the sheet's own
# punctuation and centred on the x-height rather than the cap height.
EXTRA_GLYPHS = {
    "+": [
        "...###...",
        "...###...",
        "...###...",
        "#########",
        "#########",
        "#########",
        "...###...",
        "...###...",
        "...###...",
    ],
}
EXTRA_ORIGIN = (3, 5)

UPM = 1024
PX = UPM // CELL          # font units per source pixel
SPACING = 1               # blank columns between glyphs, in source pixels
SPACE_PX = 4


def blank_grid():
    return [[False] * CELL for _ in range(CELL)]


def paint(grid, art, origin):
    ox, oy = origin
    for dy, line in enumerate(art):
        for dx, pix in enumerate(line):
            grid[oy + dy][ox + dx] = pix == "#"
    return grid


def cells(img: Image.Image):
    """Yield (char, 16x16 alpha matrix) for every glyph on the sheet."""
    alpha = img.split()[3].load()
    for i, ch in enumerate(CHARSET):
        r, c = divmod(i, COLS)
        grid = [[alpha[c * CELL + x, r * CELL + y] > 40 for x in range(CELL)]
                for y in range(CELL)]
        if ch in GLYPH_OVERRIDES:
            grid = paint(blank_grid(), GLYPH_OVERRIDES[ch], OVERRIDE_ORIGIN)
        yield ch, grid

    for ch, art in EXTRA_GLYPHS.items():
        yield ch, paint(blank_grid(), art, EXTRA_ORIGIN)


def ink_box(grid):
    xs = [x for y in range(CELL) for x in range(CELL) if grid[y][x]]
    ys = [y for y in range(CELL) for x in range(CELL) if grid[y][x]]
    if not xs:
        return None
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def mesh(grid):
    """Greedy-mesh the ink into maximal rectangles (x0, y0, x1, y1)."""
    used = [[False] * CELL for _ in range(CELL)]
    rects = []
    for y in range(CELL):
        x = 0
        while x < CELL:
            if not grid[y][x] or used[y][x]:
                x += 1
                continue
            x1 = x
            while x1 < CELL and grid[y][x1] and not used[y][x1]:
                x1 += 1
            # Extend this run downward while the identical span is still ink.
            y1 = y + 1
            while y1 < CELL and all(grid[y1][i] and not used[y1][i] for i in range(x, x1)):
                y1 += 1
            for yy in range(y, y1):
                for xx in range(x, x1):
                    used[yy][xx] = True
            rects.append((x, y, x1, y1))
            x = x1
    return rects


def build():
    img = Image.open(SHEET).convert("RGBA")
    glyphs = list(cells(img))

    # The baseline is wherever the capitals sit, taken as the MODE of their
    # bottom rows rather than the max. Two things break `max` here: Q has a
    # descending tail (it reaches row 15), and the sheet itself is not
    # perfectly regular — A-P bottom out a pixel higher than Q-Z. The mode
    # ignores both the descender and the stray row instead of letting either
    # drag every glyph off the baseline.
    caps = Counter(ink_box(g)[3] for ch, g in glyphs if ch.isupper() and ink_box(g))
    baseline = caps.most_common(1)[0][0]

    pen_glyphs, widths, order = {}, {}, [".notdef"]

    pen = TTGlyphPen(None)
    pen_glyphs[".notdef"] = pen.glyph()
    widths[".notdef"] = SPACE_PX * PX

    pen = TTGlyphPen(None)
    pen_glyphs["space"] = pen.glyph()
    widths["space"] = SPACE_PX * PX
    order.append("space")

    cmap = {0x20: "space"}

    for ch, grid in glyphs:
        box = ink_box(grid)
        name = f"uni{ord(ch):04X}"
        pen = TTGlyphPen(None)
        if box:
            x0, _, x1, _ = box
            for rx0, ry0, rx1, ry1 in mesh(grid):
                # Shift so ink starts at x=0 (zero left bearing), and flip the
                # y axis: image rows count down, font units count up from the
                # baseline.
                ax0 = (rx0 - x0) * PX
                ax1 = (rx1 - x0) * PX
                ay0 = (baseline - ry1) * PX
                ay1 = (baseline - ry0) * PX
                pen.moveTo((ax0, ay0))
                pen.lineTo((ax1, ay0))
                pen.lineTo((ax1, ay1))
                pen.lineTo((ax0, ay1))
                pen.closePath()
            widths[name] = (x1 - x0 + SPACING) * PX
        else:
            widths[name] = SPACE_PX * PX
        pen_glyphs[name] = pen.glyph()
        order.append(name)
        cmap[ord(ch)] = name

    for alias, target in ALIASES.items():
        if target in CHARSET:
            cmap[ord(alias)] = f"uni{ord(target):04X}"

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(pen_glyphs)
    fb.setupHorizontalMetrics({g: (widths[g], 0) for g in order})
    ascent, descent = baseline * PX, (CELL - baseline) * PX
    fb.setupHorizontalHeader(ascent=ascent, descent=-descent, lineGap=0)
    fb.setupNameTable({
        "familyName": "CorruptedPixel",
        "styleName": "Regular",
        "fullName": "CorruptedPixel Regular",
        "psName": "CorruptedPixel-Regular",
        "version": "1.0",
    })
    fb.setupOS2(sTypoAscender=ascent, sTypoDescender=-descent, usWinAscent=ascent,
                usWinDescent=descent, sxHeight=0, sCapHeight=ascent)
    fb.setupPost(isFixedPitch=0)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(OUT))
    print(f"baseline row {baseline}/{CELL}, {len(glyphs)} glyphs "
          f"({len(EXTRA_GLYPHS)} hand-drawn) + space + {len(ALIASES)} aliases")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} kB)")
    print(f"render at multiples of {CELL}px for a pixel-exact grid")


if __name__ == "__main__":
    if not SHEET.exists():
        sys.exit(f"missing {SHEET}")
    build()
