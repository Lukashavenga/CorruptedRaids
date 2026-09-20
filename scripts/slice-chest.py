"""
Slices the loot-chest reveal sheet into the two strips the loadout animates.

    python scripts/slice-chest.py

Source: art/Chest Reveal.png — a 6x2 grid of 362x362 cells, artist-supplied.

    row 0  the chest SHAKING, closed. Six frames of it rocking on the spot.
    row 1  the chest POPPING OPEN. Lid cracks, light spills, sparks burst,
           and it settles open.

Two strips out, not one, because they are two animations with different rules:
the shake loops and the pop plays exactly once. A single twelve-frame strip
would mean expressing "loop the first half, then play the second half once" in
CSS keyframe percentages, which is unreadable and breaks the moment anyone
re-times either half.

WHY THE FRAMES ARE NOT TRIMMED
------------------------------
Every other slicer in this repo traces connected shapes and crops to them
(AGENTS.md §7). This one must NOT: the chest deliberately sits at a different
offset in each cell — that displacement IS the shake — and cropping each frame
to its own content would centre them all and delete the animation, leaving
twelve nearly identical pictures of a chest.

NEAREST, and a whole-number downscale, for the usual reason: this is pixel art
and a smooth resample puts half-tones on the edges the art is defined by.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art" / "Chest Reveal.png"

# Both art roots. The slicers write every sprite to art/ AND to
# web/public/art/ — the first is what a human looks at, the second is what
# Vite serves and what build:web copies into overlay/. See slice-sheets.py.
OUT_DIRS = [ROOT / "art" / "ui", ROOT / "web" / "public" / "art" / "ui"]

COLS, ROWS = 6, 2

# Twice the size it is drawn at in the bag (96px), so it stays crisp on a
# 2x phone screen without shipping the 362px original twelve times over.
FRAME_OUT = 192

ROW_NAMES = ["loot-chest-shake", "loot-chest-open"]


def main() -> int:
    if not SOURCE.exists():
        sys.exit(f"missing {SOURCE}")

    sheet = Image.open(SOURCE).convert("RGBA")
    cell_w, cell_h = sheet.width // COLS, sheet.height // ROWS
    if cell_w * COLS != sheet.width or cell_h * ROWS != sheet.height:
        sys.exit(f"{SOURCE.name} is {sheet.size}, which is not a clean {COLS}x{ROWS} grid")

    for out_dir in OUT_DIRS:
        out_dir.mkdir(parents=True, exist_ok=True)

    for row, name in enumerate(ROW_NAMES):
        strip = Image.new("RGBA", (FRAME_OUT * COLS, FRAME_OUT), (0, 0, 0, 0))
        for col in range(COLS):
            frame = sheet.crop((col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h))
            strip.paste(frame.resize((FRAME_OUT, FRAME_OUT), Image.NEAREST), (col * FRAME_OUT, 0))
        # Palette, like everything else shipped — see scripts/squeeze-art.py.
        out = strip.quantize(colors=255, method=Image.FASTOCTREE, dither=Image.NONE)
        for out_dir in OUT_DIRS:
            path = out_dir / f"{name}.png"
            out.save(path, format="PNG", optimize=True)
        size_kb = (OUT_DIRS[0] / f"{name}.png").stat().st_size / 1024
        print(f"  {name}.png  {COLS} frames  {FRAME_OUT * COLS}x{FRAME_OUT}  {size_kb:.0f} KB")

    print(f"\nwrote {len(ROW_NAMES) * len(OUT_DIRS)} file(s) to art/ui/ and web/public/art/ui/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
