"""
Slices the UI chrome sheet into the pieces the loadout screen uses.

    python scripts/slice-ui.py "art/reference/assets Mute.png"

THE SOURCE HAS TO BE THE ARTIST'S OWN FILE, WITH ITS ALPHA INTACT
-----------------------------------------------------------------
A flattened export of this sheet — one with the transparency checkerboard
painted into it — can be keyed back to alpha, and the result is subtly wrong
in a way that only shows up on a dark page: every antialiased edge pixel is
the artwork blended with WHITE, so each icon ships with a pale rim around it.
This was shipped once and the hearts and swords had visible white halos.

There is no clever fix. Use the file that still has its alpha.

Output (and mirrored into web/public so the server can serve it):

    art/ui/panel-frame.png    the bronze-railed panel, used as a border-image
    art/ui/bar-frame.png      the capsule bar track (XP, meters)
    art/ui/alcove.png         the torch-lit niche the character stands on
    art/ui/backdrop.png       a seamless page tile, mirrored from dungeon stone
    art/ui/cell.png           one empty socket, cut out of the four-cell strip
    art/ui/tile-*.png         the equipment slot tiles, mark and all
    art/ui/icon-*.png         heart, sword, shield, star, cross
    art/ui/prop-*.png         the coin sack and the gold pile, for the tab bar

WHY ANCHORS AND NOT PURE SHAPE DETECTION
----------------------------------------
The previous sheet held four pieces and each was a different shape, so it could
be sliced by asking "which blob is widest / tallest / squarest" and nothing had
to be written down. This sheet holds sixty-odd pieces across nine families, and
inside a family they are DELIBERATELY identical — the nine socket tiles are the
same 67px square, the three role plates the same 149x100 plate. Shape cannot
tell a helmet tile from a boot tile, so shape cannot name them.

What is written down is therefore an ANCHOR: one point that lands inside the
piece. The box is still traced from the art (`snap`), so a piece that is
redrawn slightly bigger still slices at its true edges — only a piece that
MOVES needs its anchor nudged, and a moved piece that takes its anchor with it
fails loudly (the anchor lands on empty sheet) rather than silently swapping
two glyphs.

The socket tiles are the exception inside the exception: they are packed close
enough that two of them touch and trace as one blob. Each COLUMN is anchored
instead, and the tiles in it are cut by dividing the column's own height by how
many are drawn there — so their spacing is never written down either.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "art" / "ui"
PUBLIC = ROOT / "web" / "public" / "art" / "ui"

#: Alpha at or above this counts as part of a piece. The art tops out at 254,
#: never 255 — see AGENTS.md §7. A `== 255` test finds nothing at all.
OPAQUE = 40

#: Below this many pixels a shape is a stray speck rather than a piece.
MIN_BLOB_PX = 300

#: One point inside each piece we ship. See the module docstring for why this
#: is a table rather than a heuristic.
ANCHORS = {
    # Nine-sliceable chrome.
    "panel-frame": (600, 260),
    "bar-frame": (1300, 640),
    "alcove": (120, 200),
    # The three role plates are NOT cut. They were, and they are drawn 1.5:1
    # while a role card in the picker is nearly square, so the plate's corners
    # arrive at full size on a 106px card and read as a thick frame around a
    # small middle. What was wanted from them is their COLOURS, and those are
    # sampled into loadout.css. Anchors kept so the next person does not have
    # to find them again: tank (1040, 70), dps (1200, 70), healer (1390, 70).
    #
    # The stat glyphs. Shield doubles as the Tank read and sword as the DPS
    # one, which is why these are named for what they DEPICT — the mapping
    # from a game concept to a glyph belongs in the app, not in the slicer.
    "icon-hp": (60, 835),
    "icon-atk": (150, 835),
    "icon-armour": (245, 835),
    "icon-skill": (330, 830),
    "icon-heal": (420, 830),
    # Two props, for the phone tab bar. A tab needs a mark that says what is
    # behind it at 28px, and "inventory" and "shop" have no single glyph on
    # the sheet — but a coin sack and a pile of gold say bag and shop as
    # directly as a heart says health.
    "prop-bag": (570, 920),
    "prop-coins": (820, 935),
    # Corruption's mark. It is a derived power score rather than a stat, so
    # borrowing a stat's icon made the header say "Skill 51" to anyone reading
    # quickly. A skull is the one thing on the sheet that means what Corruption
    # means.
    "prop-skull": (680, 945),
    # Page tile, taken from the dungeon-stone swatch.
    "stone": (1220, 840),
    # The four-cell strip. Only its first cell is shipped — see the `cells`
    # branch in main(): a UI that has to draw five sockets or sixteen bag
    # slots cannot use a picture of four.
    "cells": (1100, 300),
}

#: The socket tiles, top to bottom as they are drawn, with a point inside the
#: TOP tile of each column.
#:
#: Named for the glyph, not for a gear slot: `EquipmentDoll` decides which slot
#: wears which tile, and a slot list that changes should not mean re-cutting
#: art.
TILE_COLUMNS = [
    ((1085, 400), ["helm", "mask", "sword", "dagger"]),
    ((1232, 400), ["cloak", "pants", "glove", "boot", "ring"]),
]

#: Where the first cell sits inside the four-cell strip, and how big it is.
#: Measured off the drawn rims: the strip's frame is ~17px and a cell 56x57,
#: and a pixel of margin each way keeps the rim's own outline.
CELL_INSET = (16, 18)
CELL_SIZE = (58, 59)


def trace(img: Image.Image):
    """Every connected shape on the sheet, as a label map plus its boxes."""
    w, h = img.size
    px = img.load()
    labels = [0] * (w * h)
    boxes: dict[int, tuple[int, int, int, int]] = {}
    for sy in range(h):
        for sx in range(w):
            if labels[sy * w + sx] or px[sx, sy][3] < OPAQUE:
                continue
            mark = len(boxes) + 1
            stack = [(sx, sy)]
            labels[sy * w + sx] = mark
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            while stack:
                x, y = stack.pop()
                n += 1
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not labels[ny * w + nx] and px[nx, ny][3] >= OPAQUE:
                        labels[ny * w + nx] = mark
                        stack.append((nx, ny))
            if n >= MIN_BLOB_PX:
                boxes[mark] = (x0, y0, x1 + 1, y1 + 1)
            # A speck keeps its label so `cut` still knows it is not ours.
    return labels, boxes


def cut(img: Image.Image, box, mark: int, labels) -> Image.Image:
    """The piece inside `box` with every other piece's pixels removed.

    A crop is a rectangle and the sheet is packed, so a box can catch a corner
    of its neighbour. Masking to the traced shape is what keeps a frame from
    shipping with somebody else's bracket stuck to it.
    """
    x0, y0, x1, y1 = box
    w = img.size[0]
    piece = img.crop(box)
    out = piece.load()
    for y in range(y0, y1):
        row = y * w
        for x in range(x0, x1):
            if labels[row + x] not in (mark, 0):
                out[x - x0, y - y0] = (0, 0, 0, 0)
    return piece


def snap(anchor, labels, boxes, size):
    """The traced piece the anchor point lands in.

    Returns `(box, mark)`. Raises if the anchor has drifted off its piece,
    which is the loud failure the docstring promises: a renamed or moved piece
    stops the slice rather than quietly shipping the wrong art.
    """
    x, y = anchor
    mark = labels[y * size[0] + x]
    if not mark or mark not in boxes:
        raise SystemExit(f"anchor {anchor} is not on a piece — has the sheet been re-laid-out?")
    return boxes[mark], mark


def emptied(bar: Image.Image) -> Image.Image:
    """A bar track with the drawn fill wiped out of it.

    The sheet draws each bar part-full, which is a picture of a bar at one
    particular value. Stretched across a nine-slice that value becomes the
    whole channel, so a character with no XP rendered with a full bar — the
    art was overriding the data.

    The empty stretch to the right of the drawn fill is the same channel, so
    one column of it repainted across the interior gives a track that shows
    exactly what the fill element on top of it says and nothing else. The caps
    at both ends are left alone: they are the part worth keeping.
    """
    w, h = bar.size
    px = bar.load()
    # Far enough right to be past any drawn fill, far enough left of the cap.
    source = [px[int(w * 0.6), y] for y in range(h)]
    cap = max(6, round(w * 0.055))
    for x in range(cap, w - cap):
        for y in range(h):
            px[x, y] = source[y]
    return bar


def seamless(patch: Image.Image) -> Image.Image:
    """A 2x2 mirror of `patch`, which tiles without a visible seam.

    The stone swatches on the sheet are lit from one side, so repeating one
    directly puts a bright edge against a dark one every tile width. Mirroring
    makes every join meet its own reflection, so the seam has nothing to be:
    the price is a faint symmetry, which at 4% opacity behind a whole page is
    not something an eye finds.
    """
    w, h = patch.size
    out = Image.new("RGBA", (w * 2, h * 2))
    out.paste(patch, (0, 0))
    out.paste(patch.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    out.paste(patch.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    out.paste(patch.transpose(Image.ROTATE_180), (w, h))
    return out


def save(art: Image.Image, name: str) -> None:
    for target in (OUT, PUBLIC):
        art.save(target / f"{name}.png")
    print(f"  {name:16s} {art.size[0]}x{art.size[1]}")


def main() -> None:
    sheet = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "art" / "reference" / "assets Mute.png"
    if not sheet.exists():
        sys.exit(f"missing {sheet}")

    img = Image.open(sheet).convert("RGBA")
    labels, boxes = trace(img)
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    print(f"{len(boxes)} pieces traced on {sheet.name}\n")

    for name, anchor in ANCHORS.items():
        box, mark = snap(anchor, labels, boxes, img.size)
        art = cut(img, box, mark, labels)
        if name == "cells":
            save(art.crop((CELL_INSET[0], CELL_INSET[1],
                           CELL_INSET[0] + CELL_SIZE[0], CELL_INSET[1] + CELL_SIZE[1])), "cell")
            continue
        if name == "bar-frame":
            save(emptied(art), name)
            continue
        if name == "alcove":
            # The niche is drawn with a frame around it, and it is used as the
            # BACKGROUND of a panel that already has one — two bronze rails a
            # centimetre apart, which reads as a picture of a frame hung inside
            # a frame. Only the scene is wanted. The rail measures 13px, so 18
            # clears it and the shadow it casts inward.
            w, h = art.size
            save(art.crop((18, 18, w - 18, h - 18)), name)
            continue
        if name == "stone":
            # Not shipped as-is: the page needs something that repeats.
            #
            # Inset first. The swatch is a lit slab, so its outermost pixels
            # are its own shaded rim — mirroring those puts a dark band down
            # the middle of every second tile, which reads as a drawn line
            # rather than as stone.
            w, h = art.size
            save(seamless(art.crop((10, 10, w - 10, h - 10))), "backdrop")
            continue
        save(art, name)

    # The socket tiles.
    #
    # Cut on the COLUMN's own extent, not one blob at a time and not on a
    # written-down pitch: two of the tiles touch, so tracing returns them as a
    # single tall shape and no shape question separates them — while a hard
    # pitch is a number that silently stops being true the moment the artist
    # nudges a column. Taking the column's full height and dividing by how many
    # tiles are drawn in it uses the art's own spacing and has nothing to keep
    # in step.
    tiles = 0
    for anchor, names in TILE_COLUMNS:
        box, _ = snap(anchor, labels, boxes, img.size)
        left, top, right, _ = box
        width = right - left
        # The rest of the column: same left edge, same width, at or below the
        # top tile. Width is what separates it from the bars and swatches that
        # sit at similar x — they are drawn twice as wide.
        column = [
            b for b in boxes.values()
            if abs(b[0] - left) <= 6 and abs((b[2] - b[0]) - width) <= 8 and b[1] >= top
        ]
        pitch = (max(b[3] for b in column) - top) / len(names)
        for i, name in enumerate(names):
            y = top + round(i * pitch)
            # The WHOLE tile, frame and all — not the mark lifted off it.
            #
            # Lifting the mark was tried, keyed on warmth, and it was written
            # against a sheet whose marks were all bronze. This one draws the
            # main-hand sword with a steel blade, so the key kept the gold
            # crossguard and threw the blade away: the slot showed a pickaxe.
            #
            # The tile is a drawn cell with a mark already sitting in it, and
            # `cell.png` is that same cell empty, so an empty socket and a
            # filled one are the same object either way — which is the thing
            # extraction was supposed to buy and did not.
            save(img.crop((left, y, left + width, y + round(pitch))), f"tile-{name}")
            tiles += 1

    print(f"\n{len(ANCHORS) + tiles} pieces written to art/ui/")


if __name__ == "__main__":
    main()
