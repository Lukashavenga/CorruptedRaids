"""
Cuts the loot-chest reveal sheet into the PARTS the loadout animates.

    python scripts/slice-chest.py

Source: art/Chest Reveal.png - a 6x2 grid of 150x150 cells, artist-supplied.

    row 0  the chest SHAKING, closed. Cell 0 is the chest at rest.
    row 1  the chest POPPING OPEN. Cell 5 is it settled open and glowing.

It used to write those two rows out as strips and the loadout stepped through
them. Six drawings flipped at 60-130ms is six photographs, not one movement,
so the opening is now built from pieces of the art and moved by the
renderer (web/src/loadout/chest/). The sheet stays the source and the style
guide - same pixels, same palette, same outline - and nothing is redrawn.

WHAT COMES OUT
--------------
Every file is 150x150, the sheet's own cell, and every part sits where it sits
in the CLOSED frame. They stack with no per-part offset, which is the whole
point: the renderer draws them at (0, 0) and the chest reassembles itself.

    loot-chest-body.png      the box below the lid seam, lock plate included
    loot-chest-lid.png       the closed lid, cut at the seam
    loot-chest-lid-open.png  the lid tilted back, from the settled-open frame
    loot-chest-inside.png    the glow in the mouth, from the same frame
    loot-chest-closed.png    body + lid, for the shelf tile (one static chest)

There is no rays part. The fan of light in open frame 4 is drawn inside the
lid and does not cut cleanly, so the renderer draws rays procedurally.

WHY NOTHING IS TRIMMED
----------------------
Every other slicer in this repo traces connected shapes and crops to them
(AGENTS.md section 7). This one must NOT. A part cropped to its own content
would lose its origin, and the renderer would need an offset per part, which is
a table that drifts the first time anybody redraws the chest.

THE OPEN FRAME IS SHIFTED TO MEET THE CLOSED ONE
------------------------------------------------
The artist drew the open chest 8px to the right of the closed one. The body
(and its gold band) is the same width, so it is the reference: the open frame
is moved OPEN_DX left, and the open lid then lands on the closed body. The
seam is the dark outline between lid and band, row 80 in both frames.

THE GLOW IS A SEPARATE LAYER ON PURPOSE
---------------------------------------
Inside the mouth, anything bright enough is moved from the lid part to the
inside part, and the hole it leaves in the lid is filled with the dark of the
chest's own lining. Two reasons: the renderer fades the light in as the gap
opens, and it tints it with the item's rarity colour, neither of which is
possible while the glow is painted into the lid.

NEAREST, never smooth, for the usual reason: this is pixel art and a smooth
resample puts half-tones on the edges the art is defined by. Nothing here is
resampled at all - the parts are cut at the sheet's own size.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art" / "Chest Reveal.png"

# Both art roots. The slicers write every sprite to art/ AND to
# web/public/art/ - the first is what a human looks at, the second is what
# Vite serves and what build:web copies into overlay/. See slice-sheets.py.
OUT_DIRS = [ROOT / "art" / "ui", ROOT / "web" / "public" / "art" / "ui"]

CELL = 150
COLS, ROWS = 6, 2
CLOSED_CELL = (0, 0)
OPEN_CELL = (5, 1)

# First row of the body. Row 80 is the dark outline above the gold band; the
# lid is everything above it. Measured on both frames, which agree.
SEAM_Y = 80

# The closed cell's right-hand columns hold the NEXT cell's shake arcs (the
# sheet is packed with no gutter). Nothing of the chest is past here.
CLOSED_MAX_X = 118

# The open frame's chest spans x 22-125; the sparkles drawn around it sit
# outside this and are not part of the chest.
OPEN_MIN_X, OPEN_MAX_X = 23, 126
# Moves the open frame's body onto the closed frame's. Measured on the body's
# left and right edges (22/123 against 13/116), which are 9 and 7 apart; 8 is
# the split.
OPEN_DX = -8

# The glow: an ellipse over the mouth, in the open frame's own coordinates.
# The brass corner brackets and the top clasp are brighter than the glow's
# edge, so the bound is what keeps them in the lid.
GLOW_CX, GLOW_CY = 74, 66
GLOW_RX, GLOW_RY = 37, 22
# Luminance at which a pixel starts to count as light, and at which it is
# wholly light. The lining the glow sits on is about 70.
GLOW_L0, GLOW_L1 = 70, 170
# Where the ellipse starts to feather, as a fraction of its radius.
GLOW_FEATHER = 0.75
# What the lid shows where light was lifted out of it: the chest's own lining.
LINING = (45, 26, 48, 255)


def smoothstep(a: float, b: float, v: float) -> float:
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def cell(sheet: Image.Image, col: int, row: int) -> Image.Image:
    return sheet.crop((col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL))


def blank() -> Image.Image:
    return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))


def cut_closed(closed: Image.Image) -> tuple[Image.Image, Image.Image]:
    body, lid = blank(), blank()
    src = closed.load()
    for y in range(CELL):
        target = body if y >= SEAM_Y else lid
        out = target.load()
        for x in range(CLOSED_MAX_X + 1):
            if src[x, y][3]:
                out[x, y] = src[x, y]
    return body, lid


def cut_open(opened: Image.Image) -> tuple[Image.Image, Image.Image]:
    lid, inside = blank(), blank()
    src = opened.load()
    lid_px, inside_px = lid.load(), inside.load()
    for y in range(SEAM_Y):
        for x in range(OPEN_MIN_X, OPEN_MAX_X + 1):
            r, g, b, a = src[x, y]
            if not a:
                continue
            tx = x + OPEN_DX
            radius = ((x - GLOW_CX) / GLOW_RX) ** 2 + ((y - GLOW_CY) / GLOW_RY) ** 2
            radius **= 0.5
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            light = (1 - smoothstep(GLOW_FEATHER, 1.0, radius)) * smoothstep(GLOW_L0, GLOW_L1, luma)
            if light > 0.02:
                lid_px[tx, y] = LINING
                inside_px[tx, y] = (r, g, b, round(light * 255))
            else:
                lid_px[tx, y] = (r, g, b, a)
    return lid, inside


def main() -> int:
    if not SOURCE.exists():
        sys.exit(f"missing {SOURCE}")

    sheet = Image.open(SOURCE).convert("RGBA")
    if sheet.width != CELL * COLS or sheet.height != CELL * ROWS:
        sys.exit(f"{SOURCE.name} is {sheet.size}, expected {CELL * COLS}x{CELL * ROWS} ({COLS}x{ROWS} cells of {CELL})")

    body, lid = cut_closed(cell(sheet, *CLOSED_CELL))
    lid_open, inside = cut_open(cell(sheet, *OPEN_CELL))

    closed = body.copy()
    closed.alpha_composite(lid)

    parts = {
        "loot-chest-body": body,
        "loot-chest-lid": lid,
        "loot-chest-lid-open": lid_open,
        "loot-chest-inside": inside,
        "loot-chest-closed": closed,
    }

    for out_dir in OUT_DIRS:
        out_dir.mkdir(parents=True, exist_ok=True)

    for name, image in parts.items():
        # Palette, like everything else shipped - see scripts/squeeze-art.py.
        out = image.quantize(colors=255, method=Image.FASTOCTREE, dither=Image.NONE)
        for out_dir in OUT_DIRS:
            out.save(out_dir / f"{name}.png", format="PNG", optimize=True)
        size_kb = (OUT_DIRS[0] / f"{name}.png").stat().st_size / 1024
        print(f"  {name}.png  {CELL}x{CELL}  {size_kb:.1f} KB")

    print(f"\nwrote {len(parts) * len(OUT_DIRS)} file(s) to art/ui/ and web/public/art/ui/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
