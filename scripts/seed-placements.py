"""
Seeds content/placements.json with a first guess for every sliced sprite.

    python scripts/seed-placements.py           # only fill in what's missing
    python scripts/seed-placements.py --reset   # recompute everything

The sliced sprites are isolated objects — a helmet on a transparent field —
so nothing in the art says where on a body it belongs. That mapping is the
placement data, and the admin screen (web/src/admin) is where it gets set by
hand.

This script exists so that hand-work starts from something close rather than
from a pile of sprites at the canvas origin. It measures each body sprite,
derives anatomical anchor points as fractions of that body's own box, and
centres each sprite on the anchor its slot belongs to. The result is
approximately right and obviously wrong in the places that need a human — which
is exactly what you want to open the admin screen onto.

It never overwrites an existing entry unless --reset is passed, so re-running it
after adding new art is safe and leaves tuned placements alone.
"""

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "art" / "sprites"
OUT = ROOT / "content" / "placements.json"

# Mirrors src/character/layers.ts. Kept in sync by hand — there are three
# numbers and they change roughly never.
CANVAS = 512
BASELINE_Y = 470
CENTRE_X = 256

BODIES = {"male": "male-fair", "female": "female-fair"}

#: Anchor points as (x, y) fractions of the BODY's own bounding box, measured
#: from its top-left. These come from the art: the figure stands in a
#: three-quarter stance facing right, so the anchors are not symmetric — the
#: lead fist sits forward of centre and the rear hand trails behind it.
ANCHORS = {
    "head":     (0.52, 0.10),
    "hair":     (0.52, 0.09),
    "face":     (0.56, 0.13),
    "top":      (0.48, 0.33),
    "bottom":   (0.48, 0.68),
    "mainHand": (0.86, 0.42),
    "offHand":  (0.16, 0.46),
}

#: Which sliced folder feeds which slot, and how big the sprite should be
#: relative to the body's height. Weapons are held rather than worn, so they are
#: sized against the body instead of against the part they cover.
SLOTS = {
    "head":     dict(folder="head", height_frac=0.26),
    "hair":     dict(folder="hair", height_frac=0.22),
    "face":     dict(folder="face", height_frac=0.16),
    "top":      dict(folder="chest", height_frac=0.34),
    "bottom":   dict(folder="pants", height_frac=0.46),
    "mainHand": dict(folder="mainhand", height_frac=0.55),
    "offHand":  dict(folder="offhand", height_frac=0.30),
}


def body_box(body_type: str):
    """Where a body sprite lands on the canvas: (x, y, w, h)."""
    img = Image.open(SPRITES / "body" / f"{BODIES[body_type]}.png")
    w, h = img.size
    return (CENTRE_X - w // 2, BASELINE_Y - h, w, h)


def seed_for(slot: str, sprite: Path, body_type: str):
    cfg = SLOTS[slot]
    bx, by, bw, bh = body_box(body_type)
    ax, ay = ANCHORS[slot]

    img = Image.open(sprite)
    target_h = bh * cfg["height_frac"]
    scale = round(min(1.0, target_h / img.height), 3)

    # A placement's x/y IS the sprite's centre (see Placement in layers.ts), and
    # an anchor is a point on the body — the crown of the head, the lead fist —
    # so the two are the same kind of thing and the anchor can be stored as-is.
    return {
        "x": round(bx + bw * ax),
        "y": round(by + bh * ay),
        "scale": scale,
        "rotation": 0,
    }


def main() -> None:
    reset = "--reset" in sys.argv
    data = {}
    if OUT.exists() and not reset:
        data = json.loads(OUT.read_text())

    added = kept = 0
    for slot, cfg in SLOTS.items():
        folder = SPRITES / cfg["folder"]
        if not folder.exists():
            print(f"  ! no sliced art for {slot} ({folder.name})")
            continue
        bucket = data.setdefault(slot, {})
        for sprite in sorted(folder.glob("*.png")):
            entry = bucket.setdefault(sprite.stem, {})
            for body_type in BODIES:
                if body_type in entry and not reset:
                    kept += 1
                    continue
                entry[body_type] = seed_for(slot, sprite, body_type)
                added += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print(f"{added} placements seeded, {kept} existing kept -> {OUT.relative_to(ROOT)}")
    print("Tune them in the admin screen: /admin.html")


if __name__ == "__main__":
    main()
