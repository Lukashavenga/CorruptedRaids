"""
Squeezes the shipped art down to what the stage can actually draw.

    python scripts/squeeze-art.py            # report only
    python scripts/squeeze-art.py --write    # rewrite art/ in place

WHY
---
The overlay is a 450x320 surface (src/stage.ts) and `overlay/` shipped 47 MB
of art into it. The backdrops are 1672x941 at ~2.4 MB each and are drawn into
an arena roughly 438x151; the boss sprites run to 1312x1184 at 1.8 MB and are
drawn at about 150px. Nothing is preloaded, so the backdrop request fires when
the fight starts and the opening seconds of a run play out on black -- measured
on a real run: cops.png arrived after the first combat frames had drawn.

It is also a phone problem. The loadout renders worn sprites as 40px inventory
icons straight from these files, so a full bag pulls several megabytes to draw
thumbnails.

WHAT IT DOES
------------
Two lossless-for-this-art passes, in order:

1. **Downscale** to a cap of 2x the largest size the art is ever drawn at.
   2x rather than 1x because the stage scales by whole integers on a big
   display (useStageScale) and because NEAREST upscaling from an exact-size
   source would be visibly soft on a 4K browser source.

2. **Quantise to a palette.** The whole catalogue is drawn against a 25-colour
   palette (docs/design/art-generation-guide.md), so a 24-bit PNG is storing
   millions of colours to represent dozens. Palette mode with an alpha index
   keeps every pixel value that was actually used.

Resampling is NEAREST throughout, and that is not a default -- it is the whole
point. This is pixel art on a bitmap-font stage; a smooth resample would put
half-tones on edges the art defines itself by, which is the same reason
useStageScale refuses a fractional scale.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
# BOTH copies. The slicers write every sprite to art/ AND to web/public/art/
# (see scripts/slice-sheets.py) — the first is the source of truth a human
# looks at, the second is what Vite serves and what `build:web` copies into
# overlay/. Squeezing only the first leaves the shipped bytes untouched, which
# is exactly the mistake this comment exists to stop you repeating.
ART_ROOTS = [ROOT / "art", ROOT / "web" / "public" / "art"]
WRITE = "--write" in sys.argv

# Largest size each family is ever drawn at on the 450x320 stage, doubled.
# stage.ts and lineup.ts are where these come from:
#   backdrop  -> the arena, 438 wide
#   boss      -> 150px tall (STAGE_H budget note in stage.ts)
#   body/gear -> FIGURE_WIDTH 100, on a 200px canvas at 0.5x
CAPS = {
    "backgrounds": (876, 640),
    "foregrounds": (876, 640),
    "sprites/enemies": (400, 400),
    "sprites": (400, 400),
    "ui": (900, 900),
}

# Bosses are the one family drawn larger than their neighbours, and they are
# also the heaviest files in the repo. Matched by directory name.
BOSS_CAP = (600, 600)

# NEVER RESIZED, ONLY QUANTISED.
#
# These are the layers the character doll composites, and content/placements.json
# positions every piece of gear against them IN THEIR OWN PIXEL COORDINATES.
# Rescaling one silently invalidates every placement authored against it — and
# it does so per-file, so a family where only some files cross the cap breaks
# only those.
#
# That is not hypothetical. An earlier run of this script capped at 400px: the
# five MALE bodies were 425-429 tall and got shrunk ~6%, the five female bodies
# were 388-392 and did not, and the result was every item sitting wrong on male
# characters and correct on female ones. Quantisation alone still takes most of
# the weight out of these; the resize was never where the saving was.
NO_RESIZE = {
    "body",
    "sprites/body",
    "sprites/chest",
    "sprites/pants",
    "sprites/head",
    "sprites/face",
    "sprites/hair",
    "sprites/hand",
    "sprites/mainhand",
    "sprites/offhand",
    # Pristine sources the slicers read from — never a shipped asset, and
    # rescaling them would poison every future slice.
    "sprites/_original",
}


def cap_for(path: Path) -> tuple[int, int] | None:
    """The size cap for this file, or None when it must not be resized."""
    root = next(r for r in ART_ROOTS if r in path.parents)
    rel = path.relative_to(root).as_posix()
    folder = rel.rsplit("/", 1)[0] if "/" in rel else ""
    if folder in NO_RESIZE or any(folder.startswith(f"{p}/") for p in NO_RESIZE):
        return None
    if "-boss" in rel:
        return BOSS_CAP
    for prefix, cap in CAPS.items():
        if rel.startswith(f"{prefix}/"):
            return cap
    return (900, 900)


def squeeze(path: Path) -> tuple[int, int]:
    """Returns (bytes before, bytes after) without writing unless --write."""
    before = path.stat().st_size
    with Image.open(path) as im:
        im = im.convert("RGBA")
        cap = cap_for(path)
        cap_w, cap_h = cap if cap else (im.width, im.height)
        if cap and (im.width > cap_w or im.height > cap_h):
            scale = min(cap_w / im.width, cap_h / im.height)
            # NEAREST: this is pixel art. See the module docstring.
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.NEAREST)

        # Palette with a transparency index. 255 colours rather than 256
        # because quantize reserves one for full transparency, and the art
        # uses far fewer than either.
        #
        # FASTOCTREE, not the default MEDIANCUT: median cut cannot quantize an
        # RGBA image at all in Pillow, and every sprite here has an alpha
        # channel it cannot lose — they are cut-outs standing on a backdrop.
        out = im.quantize(colors=255, method=Image.FASTOCTREE, dither=Image.NONE)

        if WRITE:
            out.save(path, format="PNG", optimize=True)
            return before, path.stat().st_size

        # Measure without touching the file.
        import io

        buf = io.BytesIO()
        out.save(buf, format="PNG", optimize=True)
        return before, buf.tell()


def main() -> int:
    files = sorted(
        p
        for root in ART_ROOTS
        if root.exists()
        for p in root.rglob("*.png")
        if "reference" not in p.parts and "New Assets" not in p.parts
    )
    if not files:
        sys.exit(f"no PNGs under {' or '.join(str(r) for r in ART_ROOTS)}")

    total_before = total_after = 0
    rows = []
    for path in files:
        before, after = squeeze(path)
        total_before += before
        total_after += after
        if before - after > 200_000:
            rows.append((before, after, path.relative_to(ROOT).as_posix()))

    rows.sort(reverse=True)
    print(f"{len(files)} files\n")
    print("biggest savings:")
    for before, after, name in rows[:12]:
        print(f"  {before/1048576:6.2f} MB -> {after/1048576:5.2f} MB   {name}")

    pct = 100 * (1 - total_after / total_before) if total_before else 0
    print(f"\ntotal  {total_before/1048576:.1f} MB -> {total_after/1048576:.1f} MB   ({pct:.0f}% smaller)")
    if not WRITE:
        print("\nreport only — re-run with --write to rewrite art/ in place.")
        print("`npm run build:web` copies art/ into overlay/, so build after writing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
