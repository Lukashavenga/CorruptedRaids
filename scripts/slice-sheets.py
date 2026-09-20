"""
Slices art/New Assets/*.png into individual sprite PNGs.

    python scripts/slice-sheets.py            # slice everything
    python scripts/slice-sheets.py --sheet head
    python scripts/slice-sheets.py --contact  # also write review contact sheets

Output goes to art/sprites/<slot>/<id>.png and is mirrored into
web/public/art/sprites/ so Vite serves it.

WHAT THESE SHEETS ARE
---------------------
Each source file is a grid of finished sprites on a transparent background.
They are ALREADY keyed — 60-72% of every sheet is alpha<16, and the dark
coloured haze visible in an image viewer is faint low-alpha residue, not a
background that needs removing. So the only cleanup needed is a hard alpha
threshold; there is no colour keying or flood fill anywhere in here, and there
should not be, because several sprites are themselves near-black (bucket helm,
ninja mask) and any luminance-based key would eat them.

HOW SPRITES ARE ASSIGNED TO CELLS
---------------------------------
By blob CENTROID, nearest cell centre, then a repair pass. Two other approaches
were tried and measured first, and both fail on this art:

  - Fixed rectangles / gutter splitting. The grids do not divide evenly
    (1536/9 = 170.67 for the weapon sheet) and, more fatally, adjacent sprites
    OVERLAP in x-projection — a spear leans into the column beside it. There is
    no vertical line that separates them, so any 1-D split cuts through art.
    Measured: forcing cuts sliced blades and staves in half.
  - Clustering blobs by x-gap. Same overlap problem from the other side: a row
    of nine weapons clustered into as few as two groups because their bounding
    boxes touch.

Centroids do not overlap even when bounding boxes do, so they are the reliable
signal. The repair pass then fixes the handful of cases where a long diagonal
sprite pulls its own centroid into a neighbour's cell, by moving the blob
nearest an empty cell out of whichever cell holds a spare.

MULTI-PART CELLS
----------------
The chest sheet draws each item as a kit: a torso piece plus two loose bracers
laid out beside it. Those bracers are positioned for the SHEET, not for the
body, so keeping them would put floating cuffs in mid-air on the character.
`largest_only` keeps just the torso for that sheet. Everywhere else all blobs
in a cell are kept, because pairs there are genuine (two horns, two braids).
"""

import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "New Assets"
OUT = ROOT / "art" / "sprites"
PUBLIC = ROOT / "web" / "public" / "art" / "sprites"

#: Below this the pixel is treated as sheet residue, not art.
ALPHA_FLOOR = 128

#: Blobs smaller than this are specks left by the residue threshold.
MIN_BLOB_PX = 40

#: Written into the generated TypeScript, not interpreted here.
Q = chr(34)
NEWLINE = chr(10)

HAIR_COLOURS = ["violet", "brown", "blonde", "red"]
TONES = ["fair", "light", "tan", "brown", "dark"]
SEXES = ["male", "female"]


def grid_name(cols, rows, prefix):
    """Plain <prefix><n> ids, numbered left-to-right, top-to-bottom.

    Numbering walks the per-row counts so a ragged sheet still gets a dense,
    stable sequence.
    """
    per_row = cols if isinstance(cols, list) else [cols] * rows

    def name(c, r):
        return f"{prefix}{sum(per_row[:r]) + c + 1:02d}"

    return name


def sexed(names):
    """Row selects sex, column selects the variant."""
    return lambda c, r: f"{SEXES[r]}-{names[c]}"


def hair_name(c, r):
    """
    Hair is two style blocks side by side, each 4 colour variants wide.

    Columns 0-3 are the four colours of the left block's styles, columns 4-7
    the same four colours for a second set of styles — so the style index is
    the row plus five for the right-hand block, and the colour is the column
    within its block.
    """
    return f"s{(c // 4) * 5 + r + 1:02d}-{HAIR_COLOURS[c % 4]}"


SHEETS = {
    "body":     dict(file="Skin tones sprites.png", cols=5, rows=2,
                     name=sexed(TONES), largest_only=False),
    "hair":     dict(file="hair sprite.png", cols=8, rows=5,
                     name=hair_name, largest_only=False),
    "head":     dict(file="head sprite.png", cols=6, rows=4,
                     name=grid_name(6, 4, "head"), largest_only=False),
    # Also ragged: four rows of nine, then eleven small face-paint marks.
    "face":     dict(file="face sprite.png", cols=[9, 9, 9, 9, 11], rows=5,
                     name=grid_name([9, 9, 9, 9, 11], 5, "face"), largest_only=False),
    "chest":    dict(file="chest sprite.png", cols=5, rows=2,
                     name=sexed([f"t{i + 1}" for i in range(5)]), largest_only=True),
    "pants":    dict(file="pants sprite.png", cols=5, rows=2,
                     name=sexed([f"t{i + 1}" for i in range(5)]), largest_only=False),
    # Ragged on purpose: rows 1 and 2 hold nine weapons, row 3 holds ten
    # (six staves then three shields). Declaring a flat 9 merged two staves
    # into one file.
    "mainhand": dict(file="main hand sprite.png", cols=[9, 9, 10], rows=3,
                     name=grid_name([9, 9, 10], 3, "mh"), largest_only=False),
    "offhand":  dict(file="offhand sprite.png", cols=5, rows=2,
                     name=grid_name(5, 2, "oh"), largest_only=False),
}


def clean(img: Image.Image) -> Image.Image:
    """Drop sub-threshold residue so blob-finding sees only real art."""
    img = img.convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            if px[x, y][3] < ALPHA_FLOOR:
                px[x, y] = (0, 0, 0, 0)
    return img


def blobs(img: Image.Image):
    """Connected opaque regions, as (bbox, pixel-count, centroid)."""
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    out = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or px[sx, sy][3] == 0:
                continue
            stack = [(sx, sy)]
            seen[sy * w + sx] = 1
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            sumx = sumy = 0
            while stack:
                x, y = stack.pop()
                n += 1
                sumx += x
                sumy += y
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and px[nx, ny][3]:
                        seen[ny * w + nx] = 1
                        stack.append((nx, ny))
            if n >= MIN_BLOB_PX:
                out.append(((x0, y0, x1 + 1, y1 + 1), n, (sumx / n, sumy / n)))
    return out


def slice_sheet(slot: str, cfg: dict, contact: bool) -> int:
    path = SRC / cfg["file"]
    if not path.exists():
        print(f"  ! missing {path.name}")
        return 0
    img = clean(Image.open(path))
    rows = cfg["rows"]
    per_row = cfg["cols"] if isinstance(cfg["cols"], list) else [cfg["cols"]] * rows
    ch = img.height / rows

    def centre(c, r):
        return ((c + 0.5) * (img.width / per_row[r]), (r + 0.5) * ch)

    def dist2(pt, c, r):
        gx, gy = centre(c, r)
        return (pt[0] - gx) ** 2 + (pt[1] - gy) ** 2

    found = blobs(img)
    cells = defaultdict(list)
    for bbox, n, pt in found:
        cell = min(((c, r) for r in range(rows) for c in range(per_row[r])),
                   key=lambda cr: dist2(pt, *cr))
        cells[cell].append((bbox, n, pt))

    # Repair: a long diagonal sprite can pull its centroid into the next cell,
    # leaving one cell with two sprites and its neighbour empty. Give each empty
    # cell the blob nearest to it that comes from a cell holding a spare.
    for _ in range(sum(per_row)):
        empty = [(c, r) for r in range(rows) for c in range(per_row[r]) if not cells[(c, r)]]
        if not empty:
            break
        target = empty[0]
        donors = [(cr, i, b) for cr, bs in cells.items() if len(bs) > 1
                  for i, b in enumerate(bs)]
        if not donors:
            break
        cr, i, b = min(donors, key=lambda d: dist2(d[2][2], *target))
        cells[cr].pop(i)
        cells[target].append(b)

    cells = {k: [(b[0], b[1]) for b in v] for k, v in cells.items()}

    out_dir, pub_dir = OUT / slot, PUBLIC / slot
    out_dir.mkdir(parents=True, exist_ok=True)
    pub_dir.mkdir(parents=True, exist_ok=True)

    written = []
    for r in range(rows):
        for c in range(per_row[r]):
            found = cells.get((c, r), [])
            if not found:
                print(f"  ! {slot} cell ({c},{r}) is empty")
                continue
            if cfg["largest_only"]:
                found = [max(found, key=lambda b: b[1])]
            x0 = min(b[0][0] for b in found)
            y0 = min(b[0][1] for b in found)
            x1 = max(b[0][2] for b in found)
            y1 = max(b[0][3] for b in found)
            sprite = img.crop((x0, y0, x1, y1))
            name = cfg["name"](c, r)
            sprite.save(out_dir / f"{name}.png")
            sprite.save(pub_dir / f"{name}.png")
            written.append((name, sprite))

    print(f"  {slot:9s} {len(written):3d} sprites  "
          f"(largest {max((s.width for _, s in written), default=0)}x"
          f"{max((s.height for _, s in written), default=0)})")

    if contact and written:
        wide = max(per_row)
        cell = 180
        sheet = Image.new("RGBA", (wide * cell, -(-len(written) // wide) * cell),
                          (25, 45, 80, 255))
        for i, (_, s) in enumerate(written):
            t = s.copy()
            t.thumbnail((cell - 12, cell - 12), Image.NEAREST)
            sheet.alpha_composite(t, ((i % wide) * cell + (cell - t.width) // 2,
                                      (i // wide) * cell + (cell - t.height) // 2))
        sheet.convert("RGB").save(OUT / f"_contact-{slot}.png")
    return len(written)


def write_index() -> None:
    """Emit web/src/admin/spriteIndex.ts listing what was sliced.

    The admin screen needs to enumerate available sprites, and a browser cannot
    read a directory. Generating the list here — rather than hand-maintaining
    it or adding a server endpoint — means it cannot drift from the art:
    re-slice and the picker updates.
    """
    index = {}
    # _original holds pre-erase backups, not sprites to pick from.
    for folder in sorted(d.name for d in OUT.iterdir() if d.is_dir() and not d.name.startswith('_')):
        index[folder] = sorted(f.stem for f in (OUT / folder).glob("*.png"))

    lines = []
    for folder, ids in index.items():
        joined = ", ".join(Q + i + Q for i in ids)
        lines.append("  " + Q + folder + Q + ": [" + joined + "],")

    target = ROOT / "web" / "src" / "admin" / "spriteIndex.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    header = [
        "// GENERATED by scripts/slice-sheets.py — do not edit.",
        "// Every sprite the slicer produced, by folder. The admin picker reads",
        "// this because a browser cannot list a directory.",
        "export const SPRITE_INDEX: Record<string, string[]> = {",
    ]
    target.write_text(NEWLINE.join(header + lines + ["};", ""]), encoding="utf-8")
    total = sum(len(v) for v in index.values())
    print(f"  index      {total} ids -> web/src/admin/spriteIndex.ts")


if __name__ == "__main__":
    only = None
    if "--sheet" in sys.argv:
        only = sys.argv[sys.argv.index("--sheet") + 1]
    contact = "--contact" in sys.argv

    total = 0
    for slot, cfg in SHEETS.items():
        if only and slot != only:
            continue
        total += slice_sheet(slot, cfg, contact)
    write_index()
    print(f"\n{total} sprites -> art/sprites/ and web/public/art/sprites/")
