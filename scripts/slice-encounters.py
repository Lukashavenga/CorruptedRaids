"""
Slices art/New Assets/encounters into enemy sprites and stage backgrounds.

    python scripts/slice-encounters.py
    python scripts/slice-encounters.py --contact   # also write review sheets

Output:
    art/sprites/enemies/<group>/<group>-NN.png   one enemy per file
    art/backgrounds/<group>.png                  the scene they fight in
Both mirrored into web/public so the server can serve them.

WHY THIS DOES NOT USE A GRID
----------------------------
The gear sheets needed a declared grid because an item is several disconnected
pieces (a cuirass plus two loose bracers) and a blob finder would have split
them. These sheets are the opposite: every enemy is ONE complete figure, so a
connected blob IS a sprite. Detecting them directly means the layout does not
have to be declared at all — which matters because these sheets are ragged
(the guards run 6/5/5 across three rows) and because more groups are coming.
Drop a new sheet in and it slices itself.

Rows are recovered afterwards by vertical overlap, purely so the output is
numbered in reading order rather than in whatever order the scan found them.

BACKGROUNDS AND FOREGROUNDS
---------------------------
"<name> background.png" is the scene its group fights in, drawn behind
everything. "<name> foreground.png" is drawn in FRONT of the characters and only
while the party is still gathering — framing for the shot before the fight
starts, which then gets out of the way so it cannot obscure the combat.

Both are 16:9 (1672x941), almost exactly the overlay's 450x250 stage, so they
need no cropping.

An index of everything found is written to web/src/admin/encounterArt.ts, since
a browser cannot list a directory and the admin needs to offer these as choices.
"""

import re
import sys
from pathlib import Path

from array import array

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "New Assets" / "encounters"
SPRITE_OUT = ROOT / "art" / "sprites" / "enemies"
BG_OUT = ROOT / "art" / "backgrounds"
FG_OUT = ROOT / "art" / "foregrounds"
PUBLIC = ROOT / "web" / "public" / "art"

#: Anything smaller than this is a stray speck, not a character.
MIN_BLOB_PX = 800

#: Alpha at or above this counts as the figure's body when tracing it.
#: The art tops out at 254, never 255, so this cannot be an equality test.
OPAQUE = 128

#: How far a figure may reclaim its own anti-aliased fringe, in px.
#: Two is enough for the soft edge these sheets carry and short enough that
#: it cannot bridge the gap to whoever is standing next to it.
SOFT_EDGE = 2

#: Rows are grouped by vertical overlap; figures in a row vary in height, so
#: this is a fraction of the taller one rather than a pixel count.
ROW_OVERLAP = 0.35

#: Source filenames are informal. These map them to stable content ids — the
#: ids end up in JSON and cannot be quietly changed later, so the typo in
#: "heroic gaurds" is corrected here rather than being carried forever.
ID_FIXES = {
    "heroic-gaurds": "heroic-guards",
    # Three boss models arrived with generator filenames. An id ends up in
    # content JSON and cannot be quietly changed later, so they are named for
    # WHAT THEY ARE here rather than being carried as a uuid forever.
    "a4405197-c0ef-46df-b116-e280182aa239": "lady-boss",
    "chatgpt-image-sep-2-2026-02-15-41-pm": "lady-boss-2",
    "chatgpt-image-sep-2-2026-03-17-13-pm": "sister-boss",
}

#: Scenes whose filename does not say "background".
#:
#: `poors.png` is the village at dusk that The POORS is fought in — 1672x941
#: like every other scene, and it sliced to a single "enemy" the size of the
#: whole picture before this existed.
EXTRA_SCENES = {"poors"}

#: Scene ids, where the file's own name is not the id content already uses.
#: Renaming these would silently blank the stage for every dungeon and room
#: that points at them.
SCENE_IDS = {"barbie": "barbies", "cop": "cops", "monk": "monks"}

#: "<name> background.png", "<name> background2.png", "<name> foreground.png".
SCENE_RE = re.compile(r"^(?P<base>.*?)[\s_-]*(?P<kind>back|fore)ground[\s_-]*(?P<n>\d*)$", re.I)


def scene_of(path):
    """(kind, id) if this file is a scene, else None.

    Scenes are named from their OWN filename and are not paired with a sprite
    group. They used to be matched to a group by name prefix, which worked
    until boss sheets arrived: "cop background.png" then resolved to the
    `cops-boss` group and overwrote the cops scene, and "monk background.png"
    landed on `monk-boss-hq`. A scene belongs to whoever points at it, and
    since a raid room picks its own, that is nobody in particular.
    """
    stem = path.stem
    if slug(stem) in EXTRA_SCENES:
        return "background", slug(stem)
    m = SCENE_RE.match(stem)
    if not m:
        return None
    base = slug(m.group("base"))
    ident = SCENE_IDS.get(base, base)
    if m.group("n"):
        ident = f"{ident}-{m.group('n')}"
    return m.group("kind") + "ground", ident


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return ID_FIXES.get(s, s)


def has_alpha(img: Image.Image) -> bool:
    """Whether this file was cut out at all.

    A sheet exported flat on solid black has no transparency, and there is no
    honest way to recover it: the king's own armour contains pure black that
    touches the pure black behind him, so a flood fill from the edge walks
    straight through him and shatters the figure into twenty-nine islands
    (measured). Keying by colour cannot separate a black cloak from a black
    background — the information is not in the file.

    This is the same lesson the UI sheet taught in reverse (see slice-ui.py):
    use the export that still has its alpha. `king.png` is a flat duplicate of
    `king Boss.png`, which is cut out properly, so it is skipped rather than
    mangled.
    """
    return img.getchannel("A").getextrema()[0] < 255


def merge_satellites(found):
    """Fold a detached fragment back into the figure whose box encloses it.

    A wisp of smoke or a thrown highlight can be its own connected region, and
    on a one-figure boss sheet that shipped as a second "enemy" 54px across.
    Containment is the test rather than proximity: two people standing shoulder
    to shoulder overlap constantly, but neither one's box ever swallows the
    other's whole.

    Returns [(box, marks)] — a figure now owns a SET of labels.
    """
    order = sorted(range(len(found)), key=lambda i: -area(found[i]))
    taken = [False] * len(found)
    out = []
    for i in order:
        if taken[i]:
            continue
        taken[i] = True
        x0, y0, x1, y1 = found[i]
        marks = {i + 1}
        for j in range(len(found)):
            if taken[j]:
                continue
            a0, b0, a1, b1 = found[j]
            if a0 >= x0 and b0 >= y0 and a1 <= x1 and b1 <= y1:
                taken[j] = True
                marks.add(j + 1)
        out.append(((x0, y0, x1, y1), marks))
    return out


def area(box):
    return (box[2] - box[0]) * (box[3] - box[1])


def blobs(img: Image.Image):
    """Connected opaque regions — one per complete figure.

    Returns (boxes, labels) where `labels` marks every pixel with the 1-based
    index of the figure it belongs to, and 0 for background. The labels are what
    let a crop keep only its OWN figure: see cut_out().
    """
    w, h = img.size
    px = img.load()
    labels = array("i", bytes(4 * w * h))
    found = []
    for sy in range(h):
        for sx in range(w):
            if labels[sy * w + sx] or px[sx, sy][3] < OPAQUE:
                continue
            mark = len(found) + 1
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
                found.append((x0, y0, x1 + 1, y1 + 1))
            else:
                # Too small to be a character. Unmark it so the speck counts as
                # background and cannot be mistaken for a neighbour later.
                for y in range(y0, y1 + 1):
                    row = y * w
                    for x in range(x0, x1 + 1):
                        if labels[row + x] == mark:
                            labels[row + x] = 0
    return found, labels


def cut_out(img: Image.Image, box, marks, labels) -> Image.Image:
    """The figure inside `box`, with every other figure's pixels removed.

    A crop is a RECTANGLE and these sheets are packed tightly, so the box around
    one figure routinely contains slices of the people standing beside it — a
    neighbour's shoulder, the tip of a halberd. Shipped as-is, those fragments
    turn up floating next to the sprite in game, which is what "cut them out
    well" means here.

    Soft edges are the reason this is not simply `labels == mark`. Nothing in
    these sheets is fully opaque (the alpha tops out at 254) and every figure
    carries a fringe of semi-transparent pixels that never got labelled, so
    keeping only labelled pixels would shave the anti-aliasing off and leave a
    hard, jagged outline. Instead the figure's own mask is grown by a couple of
    pixels and that halo is allowed to keep UNLABELLED pixels only — near enough
    to reclaim its own fringe, never enough to reach into a neighbour's body.
    """
    x0, y0, x1, y1 = box
    w = img.size[0]
    bw, bh = x1 - x0, y1 - y0

    mine = bytearray(bw * bh)
    free = bytearray(bw * bh)
    for y in range(y0, y1):
        row = y * w
        out = (y - y0) * bw
        for x in range(x0, x1):
            label = labels[row + x]
            if label in marks:
                mine[out + x - x0] = 255
            elif label == 0:
                free[out + x - x0] = 255

    own = Image.frombytes("L", (bw, bh), bytes(mine))
    unclaimed = Image.frombytes("L", (bw, bh), bytes(free))
    halo = own.filter(ImageFilter.MaxFilter(2 * SOFT_EDGE + 1))
    keep = ImageChops.lighter(own, ImageChops.multiply(halo, unclaimed))

    sprite = img.crop(box)
    sprite.putalpha(ImageChops.multiply(sprite.getchannel("A"), keep))
    return sprite.crop(sprite.getbbox() or (0, 0, bw, bh))


def in_reading_order(boxes):
    """Group boxes into rows by vertical overlap, then sort each row by x.

    Reading order is a presentation choice, so the boxes are re-sorted here —
    but each one has to keep the label it was traced with, or a crop would be
    masked against somebody else's figure. Hence (box, mark) pairs throughout.
    """
    rows: list[list[tuple]] = []
    for box in sorted(boxes, key=lambda b: b[1]):
        placed = False
        for row in rows:
            top = min(b[1] for b in row)
            bottom = max(b[3] for b in row)
            overlap = min(bottom, box[3]) - max(top, box[1])
            if overlap > ROW_OVERLAP * min(bottom - top, box[3] - box[1]):
                row.append(box)
                placed = True
                break
        if not placed:
            rows.append([box])
    return [b for row in rows for b in sorted(row, key=lambda b: b[0])]


Q = chr(34)
NEWLINE = chr(10)


def write_index(groups, backgrounds, foregrounds) -> None:
    """Emit web/src/admin/encounterArt.ts listing everything available.

    The admin has to offer these as choices and a browser cannot list a
    directory. Generated rather than hand-kept so it cannot drift from the art:
    re-slice and the pickers update.
    """
    def arr(values):
        return "[" + ", ".join(Q + v + Q for v in values) + "]"

    lines = [
        "// GENERATED by scripts/slice-encounters.py — do not edit.",
        "// Every enemy sprite, background and foreground the slicer produced.",
        "// The admin pickers read this because a browser cannot list a directory.",
        "export const ENEMY_SPRITES: Record<string, string[]> = {",
    ]
    for group, ids in sorted(groups.items()):
        lines.append("  " + Q + group + Q + ": " + arr(ids) + ",")
    lines.append("};")
    lines.append("")
    lines.append("export const BACKGROUNDS: string[] = " + arr(sorted(set(backgrounds))) + ";")
    lines.append("export const FOREGROUNDS: string[] = " + arr(sorted(set(foregrounds))) + ";")
    lines.append("")

    target = ROOT / "web" / "src" / "admin" / "encounterArt.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(NEWLINE.join(lines), encoding="utf-8")
    print(f"  index      {sum(len(v) for v in groups.values())} sprites -> web/src/admin/encounterArt.ts")


def main() -> None:
    contact = "--contact" in sys.argv
    if not SRC.exists():
        sys.exit(f"missing {SRC}")

    groups: dict[str, list[str]] = {}
    backgrounds: list[str] = []

    every = sorted(SRC.glob("*.png"))
    scenes = [(p, scene_of(p)) for p in every]
    sheets = [p for p, sc in scenes if sc is None]
    foregrounds: list[str] = []

    for path, sc in scenes:
        if sc is None:
            continue
        kind, ident = sc
        out_dir, public_sub, collected = (
            (BG_OUT, "backgrounds", backgrounds) if kind == "background"
            else (FG_OUT, "foregrounds", foregrounds)
        )
        out_dir.mkdir(parents=True, exist_ok=True)
        (PUBLIC / public_sub).mkdir(parents=True, exist_ok=True)
        img = Image.open(path).convert("RGBA")
        for target in (out_dir, PUBLIC / public_sub):
            img.save(target / f"{ident}.png")
        collected.append(ident)
        print(f"  {kind} {ident:20s} {img.width}x{img.height}")

    for path in sheets:
        group = slug(path.stem)
        img = Image.open(path).convert("RGBA")
        if not has_alpha(img):
            print(f"  {group:16s} SKIPPED — no transparency; export it cut out")
            continue
        found, labels = blobs(img)
        # Fold detached fragments back into the figure they belong to, THEN
        # pair each box with its labels before reordering — the mask that cuts
        # a figure out has to be the one that traced it.
        merged = merge_satellites(found)
        marks = {box: ms for box, ms in merged}
        boxes = in_reading_order([box for box, _ in merged])

        out = SPRITE_OUT / group
        pub = PUBLIC / "sprites" / "enemies" / group
        out.mkdir(parents=True, exist_ok=True)
        pub.mkdir(parents=True, exist_ok=True)
        # Both sides, not just the source tree: the mirror is what the server
        # actually serves, so an id that disappears from a re-drawn sheet has to
        # disappear from there as well or it stays live in the game.
        for stale in [*out.glob("*.png"), *pub.glob("*.png")]:
            stale.unlink()

        ids = []
        for i, box in enumerate(boxes, start=1):
            sprite = cut_out(img, box, marks[box], labels)
            name = f"{group}-{i:02d}"
            sprite.save(out / f"{name}.png")
            sprite.save(pub / f"{name}.png")
            ids.append(name)
        groups[group] = ids
        tallest = max((b[3] - b[1] for b in boxes), default=0)
        print(f"  {group:16s} {len(ids):3d} enemies (tallest {tallest}px)")

        if contact and boxes:
            cell = 200
            per = 8
            sheet = Image.new("RGBA", (per * cell, -(-len(boxes) // per) * cell), (25, 45, 80, 255))
            for i, box in enumerate(boxes):
                t = cut_out(img, box, marks[box], labels)
                t.thumbnail((cell - 10, cell - 10), Image.NEAREST)
                sheet.alpha_composite(t, ((i % per) * cell + (cell - t.width) // 2,
                                          (i // per) * cell + (cell - t.height) // 2))
            sheet.convert("RGB").save(SPRITE_OUT / f"_contact-{group}.png")

    # A scene is no longer owned by a group, so there is nothing to be missing:
    # any room or dungeon may point at any of them.

    write_index(groups, backgrounds, foregrounds)
    total = sum(len(v) for v in groups.values())
    print(f"\n{total} enemy sprites across {len(groups)} groups, {len(backgrounds)} backgrounds, {len(foregrounds)} foregrounds")


if __name__ == "__main__":
    main()
