"""
Material variants of existing gear: the same piece, re-dyed.

    python scripts/recolour-gear.py                    # every variant below
    python scripts/recolour-gear.py knight-s-cuirass   # one base item's variants
    python scripts/recolour-gear.py --preview          # contact sheet only, writes nothing

A Crimson Knight's Cuirass is the Knight's Cuirass with its STEEL repainted and
everything else - the leather strap, the gold trim, the outline - left alone.
That is the whole trick, and the reason it is a script rather than a tint in
CSS: a tint recolours the strap as well, and a cuirass with a red belt reads as
a mistake rather than as a red cuirass.

HOW A PIXEL IS RECOLOURED
-------------------------
Each base names its MATERIALS as colour ranges (MATERIAL below): steel is
low-saturation blue-grey, trim is bright saturated gold, leather is warm brown,
and cloth is whatever the piece is dyed. A variant says which material becomes
which RAMP. A pixel in that material is ranked by brightness against the rest
of that material in the same sprite (2nd to 98th percentile), and that rank
picks its colour off the ramp - so the artist's shading survives, step for
step, in the new colour. Outlines are below every material's brightness floor
and are never touched.

The ramps are built from the palette (docs/design/pixel-rpg-palette.json),
plus the leather/skin tones the shipped gear already uses.

ERASED SPRITES
--------------
Most bases were hand-erased in the admin's Sprite Eraser (a helm carved hollow
so the face shows, a cuirass with the arm cut out). Those erases live in the
public `sprites` bucket, not in art/sprites, so a variant made from the file
on disk would put the un-erased version back on the doll. Pass the bucket's
base URL (or set SUPABASE_URL) and the erased version is fetched and recoloured
instead; without it the script says which sprites it fell back on.

    python scripts/recolour-gear.py --sprite-base https://<ref>.supabase.co

WHAT IT WRITES - additive, like import-outfits.py
-------------------------------------------------
  art/sprites/<folder>/<sprite>-<variant>.png   (+ web/public mirror)
  content/gear/<base>-<variant>.json            stats copied from the base
  content/placements.json                       the base sprite's placement, copied
  web/src/admin/spriteIndex.ts                  regenerated

An existing gear file is left alone (delete it to rebuild), so stats tuned in
the admin are never reset; the sprite is always rewritten. Variants are written
SWITCHED OFF, like every other import: unreviewed art goes on in the admin.
They are in no shop and no loot table until someone puts them there.

Placements are copied from the BASE's entry in content/placements.json - pull
the live store's copy first (npm run pull:content) or a variant inherits a
placement the live game no longer uses.
"""
from __future__ import annotations

import colorsys
import importlib.util
import json
import os
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GEAR = ROOT / "content" / "gear"
PLACEMENTS = ROOT / "content" / "placements.json"
MANIFEST = ROOT / "content" / "sprites.json"

# Loaded rather than copied, as import-outfits.py does: its output roots and
# sprite index are the definition of where a sprite lives.
_spec = importlib.util.spec_from_file_location("slice_sheets", ROOT / "scripts" / "slice-sheets.py")
ss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ss)
OUT, PUBLIC = ss.OUT, ss.PUBLIC

SLOT_FOLDER = {"head": "head", "top": "chest", "bottom": "pants", "mainHand": "mainhand", "offHand": "offhand"}
#: The slot key placements.json files a sprite under.
PLACEMENT_SLOT = {"head": "head", "top": "top", "bottom": "bottom", "mainHand": "mainHand", "offHand": "offHand"}

# --- materials ---------------------------------------------------------------
# (hue in degrees, saturation, value) -> is this pixel that material.
# Measured on the shipped sprites, not guessed: steel sits at hue 200-260 and
# saturation 0.1-0.4, leather at 320-40 (its shadows drift into the palette's
# wines), gold trim is the only thing both warm AND bright.


def _gold(h, s, v):
    return 22 <= h <= 58 and s >= 0.4 and v >= 0.55


MATERIAL = {
    "steel": lambda h, s, v: (175 <= h <= 300 and s <= 0.45) or s < 0.22,
    "gold": _gold,
    "leather": lambda h, s, v: (h >= 300 or h <= 45) and s >= 0.12 and not _gold(h, s, v),
    # Cloth is named by the colour it is dyed, because that is how it is told
    # apart from the leather on the same sprite (boots, belts).
    "wine": lambda h, s, v: 295 <= h <= 352 and s >= 0.42,
    "navy": lambda h, s, v: 185 <= h <= 300 and s >= 0.15 and (v < 0.6 or s >= 0.3),
    "green": lambda h, s, v: 65 <= h <= 175 and s >= 0.18,
    "plume": lambda h, s, v: (h >= 320 or h <= 8) and s >= 0.6,
}
#: Darker than this is outline, whatever its hue.
OUTLINE_V = 0.15

# --- ramps, dark to light ----------------------------------------------------
RAMP = {
    "crimson": ["#2a0a12", "#3d1430", "#632240", "#913a52", "#bc5960", "#e58f7f"],
    "gold": ["#3d1430", "#7d4830", "#b57a4b", "#e2b570", "#eee98a", "#fbf6c8"],
    # The palette's darks are all navy or violet, and a ramp built only from
    # them reads as blue steel. Black is the one place it is left, slightly.
    "black-steel": ["#08080d", "#121219", "#1d1d27", "#2c2c38", "#454552", "#8a8f9c"],
    "tan": ["#4b262f", "#7d4830", "#b57a4b", "#dfa974", "#f7d7ab"],
    "black-leather": ["#08080c", "#121117", "#1d1b23", "#2b2832", "#423d4a"],
    "forest": ["#08150f", "#10261c", "#1a3a2b", "#285454", "#39755c"],
    "black-cloth": ["#08080c", "#121117", "#1d1b23", "#2b2832", "#423d4a"],
}

# --- the variants ------------------------------------------------------------
#: variant id -> (name prefix, {material: ramp})
VARIANT = {
    "crimson": ("Crimson", {"steel": "crimson"}),
    "gilded": ("Gilded", {"steel": "gold"}),
    "blackened": ("Blackened", {"steel": "black-steel"}),
    "tanned": ("Tanned", {"leather": "tan"}),
    "black": ("Black", {"leather": "black-leather"}),
    "forest": ("Forest", {"leather": "forest"}),
}
#: Cloth pieces swap the CLOTH, and say which of their colours that is.
#: A dict names it per sprite, with an optional ceiling (fraction of the
#: height) when the cloth shares its colour with the boots below it.
CLOTH = {
    "worn-breeches": {"male-t1": ("wine", None), "female-t1": ("leather", 0.45)},
    "sashed-trousers": "navy",
    "patched-leggings": "green",
    "ranger-s-mantle": "green",
}

#: base gear id -> the variants that make sense for it. Metal pieces get the
#: three metals; leather pieces the leathers; cloth the dyes.
BASES = {
    # steel
    "knight-s-cuirass": ["crimson", "gilded", "blackened"],
    "chainmail-rig": ["crimson", "gilded", "blackened"],
    "plated-greaves": ["crimson", "gilded", "blackened"],
    "crusader-helm": ["crimson", "gilded", "blackened"],
    "horned-warhelm": ["crimson", "gilded", "blackened"],
    "legionary-helm": ["gilded", "blackened"],
    "plumed-greathelm": ["crimson", "gilded", "blackened"],
    "iron-shortsword": ["crimson", "gilded", "blackened"],
    # leather
    "strapped-harness": ["tanned", "black"],
    "buckled-jerkin": ["tanned", "black", "forest"],
    "heralds-tassets": ["tanned", "black"],
    # cloth
    "worn-breeches": ["forest", "black"],
    "sashed-trousers": ["forest"],
    "patched-leggings": ["black"],
    "ranger-s-mantle": ["black"],
}


def hexrgb(h: str):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def ramp_at(ramp: list, t: float):
    """Linear between stops: the source keeps as many shades as it had."""
    stops = [hexrgb(c) for c in ramp]
    t = min(1.0, max(0.0, t)) * (len(stops) - 1)
    i = min(int(t), len(stops) - 2)
    f = t - i
    a, b = stops[i], stops[i + 1]
    return tuple(round(a[k] + (b[k] - a[k]) * f) for k in range(3))


def lum(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b


def recolour(img: Image.Image, swaps: dict, ceiling: float | None = None) -> Image.Image:
    """swaps: {material: ramp name}. Every other pixel is returned untouched,
    and so is everything below `ceiling` (a fraction of the height) if given."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    hits = {m: [] for m in swaps}
    for y in range(h if ceiling is None else int(h * ceiling)):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if v < OUTLINE_V:
                continue
            hh *= 360
            for m in swaps:
                if MATERIAL[m](hh, s, v):
                    hits[m].append((x, y, lum(r, g, b)))
                    break
    out = img.copy()
    po = out.load()
    for m, pts in hits.items():
        if not pts:
            continue
        ls = sorted(p[2] for p in pts)
        lo, hi = ls[len(ls) * 2 // 100], ls[min(len(ls) - 1, len(ls) * 98 // 100)]
        span = max(1.0, hi - lo)
        ramp = RAMP[swaps[m]]
        for x, y, l in pts:
            r, g, b = ramp_at(ramp, (l - lo) / span)
            po[x, y] = (r, g, b, px[x, y][3])
    return out


def sprite_ids(gear: dict) -> list:
    if gear.get("spriteByBody"):
        return sorted(set(gear["spriteByBody"].values()))
    return [gear["sprite"]]


def load_base_sprite(folder: str, sprite: str, manifest: dict, base_url: str | None, fell_back: list) -> Image.Image:
    key = f"{folder}/{sprite}"
    if key in manifest:
        if base_url:
            url = f"{base_url.rstrip('/')}/storage/v1/object/public/sprites/{manifest[key]['file']}"
            with urllib.request.urlopen(url) as r:
                return Image.open(BytesIO(r.read())).convert("RGBA")
        fell_back.append(key)
    return Image.open(PUBLIC / folder / f"{sprite}.png").convert("RGBA")


def variant_gear(base: dict, variant: str) -> dict:
    prefix = VARIANT[variant][0]
    g = {k: v for k, v in base.items() if k not in ("sprite", "spriteByBody", "enabled")}
    g["id"] = f"{base['id']}-{variant}"
    g["name"] = f"{prefix} {base['name']}"
    g["tags"] = sorted(set(base.get("tags") or []) | {f"variant-of:{base['id']}"})
    g["enabled"] = False
    if base.get("spriteByBody"):
        g["spriteByBody"] = {body: f"{s}-{variant}" for body, s in base["spriteByBody"].items()}
    else:
        g["sprite"] = f"{base['sprite']}-{variant}"
    return g


def swaps_for(base_id: str, sprite: str, variant: str) -> tuple:
    """(swaps, ceiling) for one sprite of one variant."""
    if base_id not in CLOTH:
        return VARIANT[variant][1], None
    # A cloth piece swaps its dye, whichever ramp the variant names.
    ramp = {"forest": "forest", "black": "black-cloth"}[variant]
    cloth = CLOTH[base_id]
    material, ceiling = cloth[sprite] if isinstance(cloth, dict) else (cloth, None)
    return {material: ramp}, ceiling


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    preview = "--preview" in sys.argv
    base_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    if "--sprite-base" in sys.argv:
        base_url = sys.argv[sys.argv.index("--sprite-base") + 1]
        args = [a for a in args if a != base_url]
    unknown = [a for a in args if a not in BASES]
    if unknown:
        raise SystemExit(f"not a base with variants: {', '.join(unknown)}")
    bases = args or list(BASES)

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    placements = json.loads(PLACEMENTS.read_text(encoding="utf-8"))
    fell_back: list = []
    sheet_rows = []
    made = kept = 0

    for base_id in bases:
        base = json.loads((GEAR / f"{base_id}.json").read_text(encoding="utf-8"))
        folder = SLOT_FOLDER[base["slot"]]
        pslot = PLACEMENT_SLOT[base["slot"]]
        sources = {s: load_base_sprite(folder, s, manifest, base_url, fell_back) for s in sprite_ids(base)}
        row = [img for img in sources.values()]
        for variant in BASES[base_id]:
            for sprite, img in sources.items():
                out = recolour(img, *swaps_for(base_id, sprite, variant))
                row.append(out)
                if preview:
                    continue
                vid = f"{sprite}-{variant}"
                for root in (OUT, PUBLIC):
                    (root / folder).mkdir(parents=True, exist_ok=True)
                    out.save(root / folder / f"{vid}.png")
                if sprite in placements.get(pslot, {}):
                    placements[pslot][vid] = json.loads(json.dumps(placements[pslot][sprite]))
            if preview:
                continue
            target = GEAR / f"{base_id}-{variant}.json"
            if target.exists():
                kept += 1
            else:
                target.write_text(json.dumps(variant_gear(base, variant), indent=2) + "\n", encoding="utf-8")
                made += 1
        sheet_rows.append(row)

    contact(sheet_rows, OUT / "_contact-variants.png")
    if fell_back:
        print(f"  {len(set(fell_back))} erased sprite(s) recoloured from the UN-erased file "
              f"(pass --sprite-base): {', '.join(sorted(set(fell_back)))}")
    if preview:
        print(f"  preview -> {(OUT / '_contact-variants.png').relative_to(ROOT)}")
        return
    PLACEMENTS.write_text(json.dumps(placements, indent=2) + "\n", encoding="utf-8")
    ss.write_index()
    print(f"  gear       {made} written, {kept} kept (delete a file to rebuild it)")
    print(f"  contact -> {(OUT / '_contact-variants.png').relative_to(ROOT)}")


def contact(rows: list, path: Path, cell: int = 96) -> None:
    """Base first on each row, then its variants - what to look at before Save."""
    width = max(len(r) for r in rows) * cell
    sheet = Image.new("RGBA", (width, len(rows) * cell), (31, 41, 64, 255))
    for j, row in enumerate(rows):
        for i, img in enumerate(row):
            im = img.copy()
            im.thumbnail((cell - 6, cell - 6), Image.NEAREST)
            sheet.alpha_composite(im, (i * cell + (cell - im.width) // 2, j * cell + (cell - im.height) // 2))
    sheet.save(path)


if __name__ == "__main__":
    main()
