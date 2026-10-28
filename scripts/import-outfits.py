"""
Turns outfit art into a top and a pair of bottoms, per body, ready to wear.

    python scripts/import-outfits.py              # every outfit in the folder
    python scripts/import-outfits.py punk         # just one, by name
    python scripts/import-outfits.py --template   # (re)draw the artist's template

Source: art/New Assets/outfits/. Adding an outfit is: draw it over the
template, drop the PNG(s) in that folder, run this, then tune its stats in the
admin panel. Nothing here needs editing per outfit. The artist's side of this
is art/templates/outfit-brief.md.

THE TEMPLATE IS THE CONTRACT
----------------------------
`--template` writes art/templates/outfit-template.png: the real male body on
the left and the real female body on the right, drawn from the game's own
body sprites at exactly SCALE x and standing on BASELINE. Art drawn over it is
already in the game's geometry, so a piece's placement is ARITHMETIC - see
placement_for() - and arrives exactly where the artist drew it.

That replaced a guess. The first four outfits were drawn in a wider stance
than the body, and no placement can fix a leg drawn at a different angle: the
body's own legs showed beside the trousers. Drawing on the template is what
makes "it fits" a property of the art rather than of an afternoon in the
admin. It is also what makes skin work: rips, midriffs and bare knuckles are
left TRANSPARENT, and the wearer's own body shows through in their own tone -
which only lines up when the cloth sits exactly over the body.

Every number below is the template's. Change one and every outfit drawn so
far is in the wrong place; redraw the template and re-import them all.

TWO WAYS TO HAND IN AN OUTFIT
-----------------------------
  <Name>-top.png + <Name>-bottoms.png (+ <Name>-gloves.png)   PREFERRED
      One garment per file, each the full template size. Garments may
      overlap - a shirt over a belt - because nothing has to pull them apart.
  <Name>.png
      Everything on one sheet. Pieces must NOT touch, because touching pixels
      are one shape and cannot be separated. Then they are sorted by shape:
        - the TORSO is the largest shape whose centre is in the upper half;
        - a GLOVE is a shape whose centre is beside the torso, at its height;
        - everything else is TOP if its centre is above the torso's lower
          edge and BOTTOMS if it is below. The centre, not where a shape
          starts: Punk's jeans begin two pixels above the shirt's hem, and a
          "starts above" rule filed the jeans as part of the shirt.

Either way the male cut is everything whose centre is left of the template's
middle and the female cut everything right of it. Centre, not a straight cut:
Pink's male boot crosses the middle at the floor.

Every piece is cut MASKED to its own shapes, not just cropped to a box - the
bottoms' box overlaps the gloves', and a plain crop would ship a slice of
glove in the corner of the trousers (AGENTS.md section 7, bleedover).

WHAT IT WRITES - additive, like generate-gear-content.py
--------------------------------------------------------
  art/sprites/chest/<id>-<body>.png     the top     (+ web/public mirror)
  art/sprites/pants/<id>-<body>.png     the bottoms (+ web/public mirror)
  art/sprites/_gloves/<id>-<body>-<side>.png
        Cut and parked: there is no gloves slot yet (issue #20). The leading
        underscore keeps them out of the admin's sprite picker until there is.
  art/sprites/_contact-outfits/<id>.png
        Every cut boxed - green top, blue bottoms, orange gloves - over the
        template's bodies in grey. LOOK AT THIS before trusting an import.
  content/gear/<id>-top.json, <id>-bottoms.json
        Only if missing. Common, with the current common top/bottoms' stats
        as a placeholder - tune them in the admin.
  content/placements.json
        See below.

PLACEMENTS ARE REWRITTEN ONLY IF NOBODY TOUCHED THEM
----------------------------------------------------
art/sprites/_outfits.json records the placement this script last wrote for
each sprite. On a re-import a placement is replaced only if it still equals
that record - so redrawn art moves to its new exact spot, and a placement
someone nudged in the admin is kept and reported. Sprites are re-cut every
run (the art is the source); gear files are never overwritten.

A placement with no record is kept too: it was set by hand or by an earlier
version of this script, and nothing says it is safe to move. That is the
first four outfits, imported before the template existed with a guessed
placement. When their redrawn art lands, name them and pass
--replace-placements to move them onto the template's exact spot:

    python scripts/import-outfits.py punk --replace-placements
"""

import importlib.util
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "New Assets" / "outfits"
GEAR = ROOT / "content" / "gear"
PLACEMENTS = ROOT / "content" / "placements.json"
TEMPLATE = ROOT / "art" / "templates" / "outfit-template.png"

# slice-sheets.py has a hyphen in its name, so it cannot be imported by name.
# Loaded rather than copied: its alpha floor, blob rules, output roots and
# sprite index are the definition of "sliced", and two copies would drift.
_spec = importlib.util.spec_from_file_location("slice_sheets", ROOT / "scripts" / "slice-sheets.py")
ss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ss)

OUT = ss.OUT
PUBLIC = ss.PUBLIC
GLOVES = OUT / "_gloves"
CONTACT = OUT / "_contact-outfits"
WRITTEN = OUT / "_outfits.json"

# --- the template's geometry -------------------------------------------------

#: Left half, then right half.
BODIES = ("male", "female")
SHEET = (1536, 1024)
#: Template pixels per character-canvas pixel. A whole number, so the bodies
#: are drawn without resampling and every placement scale is exactly 1/SCALE.
SCALE = 2
#: Where each body's feet are centred on the template.
CENTRE = {"male": 384, "female": 1152}
BASELINE = 980
MIDDLE = SHEET[0] // 2
#: The same two numbers on the character canvas: CENTRE_X and BASELINE_Y in
#: src/character/layers.ts. A body is drawn centred on the first with its
#: feet on the second, and the template stands it the same way.
CANVAS_CENTRE_X = 256
CANVAS_BASELINE_Y = 470
#: The tone the template's bodies are drawn in: the BASE bodies. The
#: female's five tones are one drawing recoloured from fair (2026-10-28,
#: until all five are redrawn), so an outfit that fits fair fits them all.
#: The male's are still five separate drawings that differ by a few pixels;
#: fair is the one they will be redrawn from.
TEMPLATE_TONE = "fair"

#: Placeholder stats: what the catalogue's common top and bottoms carry today.
PLACEHOLDER = {
    "top": {"rarity": "common", "statMods": {"hp": 2, "skill": 1}},
    "bottom": {"rarity": "common", "statMods": {"hp": 2, "skill": 1}},
}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def body_sprite(body: str) -> Image.Image:
    return Image.open(PUBLIC / "body" / f"{body}-{TEMPLATE_TONE}.png").convert("RGBA")


def body_origin(body: str, size) -> tuple:
    """Where a body of `size` sits on the template - centred, feet on the baseline."""
    w, h = size
    return CENTRE[body] - w * SCALE // 2, BASELINE - h * SCALE


def placement_for(body: str, box) -> dict:
    """A piece's placement, from where it was drawn on the template.

    The template and the canvas stand the body the same way (body_origin vs
    CharacterSprite's BodyLayer), so a template point maps to the canvas by
    one offset and one division. CharacterSprite places a sprite by its
    CENTRE, so the box's centre is what is mapped.
    """
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return {
        "x": round(CANVAS_CENTRE_X + (cx - CENTRE[body]) / SCALE, 1),
        "y": round(CANVAS_BASELINE_Y + (cy - BASELINE) / SCALE, 1),
        "scale": round(1 / SCALE, 4),
        "rotation": 0,
    }


def write_template() -> None:
    """The artist's canvas: both bodies, where the game will put the art."""
    sheet = Image.new("RGBA", SHEET, (0, 0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=22)
    guide = (54, 197, 240, 255)
    for body in BODIES:
        sprite = body_sprite(body)
        big = sprite.resize((sprite.width * SCALE, sprite.height * SCALE), Image.NEAREST)
        sheet.alpha_composite(big, body_origin(body, sprite.size))
        x0 = 0 if body == BODIES[0] else MIDDLE
        draw.line((x0 + 20, BASELINE, x0 + MIDDLE - 20, BASELINE), fill=guide, width=2)
        for y in range(40, BASELINE, 16):
            draw.line((CENTRE[body], y, CENTRE[body], y + 7), fill=guide, width=1)
        draw.text((x0 + 24, 20), f"{body.upper()} - draw over this body; export WITHOUT this layer", fill=guide, font=font)
    draw.line((MIDDLE, 0, MIDDLE, SHEET[1]), fill=(230, 70, 70, 255), width=2)
    draw.text((24, BASELINE + 10), "ground line - boots stand on it", fill=guide, font=font)
    TEMPLATE.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(TEMPLATE)
    print(f"template -> {TEMPLATE.relative_to(ROOT)}  ({SHEET[0]}x{SHEET[1]}, bodies at {SCALE}x)")


# --- cutting ------------------------------------------------------------------


def label(img: Image.Image):
    """Connected opaque shapes, with membership, so each piece can be masked.

    slice-sheets.blobs() returns boxes only, which is all a grid needs. Here a
    box is not enough (see the module docstring), so this records which shape
    every pixel belongs to. Same 4-connectivity and MIN_BLOB_PX as blobs().
    """
    w, h = img.size
    alpha = img.getchannel("A").tobytes()
    labels = [0] * (w * h)
    shapes = []
    for start in range(w * h):
        if labels[start] or not alpha[start]:
            continue
        sid = len(shapes) + 1
        labels[start] = sid
        stack = [start]
        members = []
        while stack:
            i = stack.pop()
            members.append(i)
            x, y = i % w, i // w
            if x + 1 < w and not labels[i + 1] and alpha[i + 1]:
                labels[i + 1] = sid
                stack.append(i + 1)
            if x > 0 and not labels[i - 1] and alpha[i - 1]:
                labels[i - 1] = sid
                stack.append(i - 1)
            if y + 1 < h and not labels[i + w] and alpha[i + w]:
                labels[i + w] = sid
                stack.append(i + w)
            if y > 0 and not labels[i - w] and alpha[i - w]:
                labels[i - w] = sid
                stack.append(i - w)
        xs = [i % w for i in members]
        ys = [i // w for i in members]
        shapes.append({
            "n": len(members),
            "box": (min(xs), min(ys), max(xs) + 1, max(ys) + 1),
            "cx": sum(xs) / len(xs),
            "cy": sum(ys) / len(ys),
            "members": members,
        })
    return [s for s in shapes if s["n"] >= ss.MIN_BLOB_PX]


def by_body(shapes):
    return {
        BODIES[0]: [s for s in shapes if s["cx"] < MIDDLE],
        BODIES[1]: [s for s in shapes if s["cx"] >= MIDDLE],
    }


def classify(shapes, height: int):
    """One figure's shapes on a single sheet, sorted into top, bottoms and gloves."""
    upper = [s for s in shapes if s["cy"] < height * 0.5]
    if not upper:
        raise SystemExit("no shape in the upper half to call a torso")
    torso = max(upper, key=lambda s: s["n"])
    tx0, ty0, tx1, ty1 = torso["box"]
    reach = (ty1 - ty0) * 0.4

    top, bottoms, gloves = [torso], [], []
    for s in shapes:
        if s is torso:
            continue
        beside = s["cx"] < tx0 or s["cx"] > tx1
        level = ty0 <= s["cy"] <= ty1 + reach
        if beside and level:
            gloves.append(s)
        elif s["cy"] < ty1:
            top.append(s)
        else:
            bottoms.append(s)
    return {"top": top, "bottoms": bottoms, "gloves": gloves}


def union_box(group):
    return (
        min(s["box"][0] for s in group),
        min(s["box"][1] for s in group),
        max(s["box"][2] for s in group),
        max(s["box"][3] for s in group),
    )


def cut(img: Image.Image, group) -> Image.Image:
    """The group's pixels and nothing else, cropped to their joint box."""
    w = img.width
    x0, y0, x1, y1 = union_box(group)
    src = img.load()
    out = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    dst = out.load()
    for s in group:
        for i in s["members"]:
            x, y = i % w, i // w
            dst[x - x0, y - y0] = src[x, y]
    return out


def save_sprite(img: Image.Image, folder: str, name: str) -> None:
    for root in (OUT, PUBLIC):
        (root / folder).mkdir(parents=True, exist_ok=True)
        img.save(root / folder / f"{name}.png")


# --- one outfit ---------------------------------------------------------------


def load(path: Path) -> Image.Image:
    img = ss.clean(Image.open(path))
    if img.size != SHEET:
        print(f"  WARNING  {path.name} is {img.size[0]}x{img.size[1]}, not the template's {SHEET[0]}x{SHEET[1]}:"
              f" its placement will be wrong. Was it drawn on art/templates/outfit-template.png?")
    return img


def pieces_of(files: dict):
    """{body: {"top": (img, shapes), "bottoms": ..., "gloves": ...}} for one outfit."""
    out = {body: {} for body in BODIES}
    if "sheet" in files:
        img = load(files["sheet"])
        for body, mine in by_body(label(img)).items():
            for kind, group in classify(mine, img.height).items():
                out[body][kind] = (img, group)
    else:
        for kind in ("top", "bottoms", "gloves"):
            if kind not in files:
                continue
            img = load(files[kind])
            for body, mine in by_body(label(img)).items():
                out[body][kind] = (img, mine)
    return out


def import_outfit(outfit: str, files: dict, placements: dict, written: dict, replace: bool) -> dict:
    title = outfit.replace("-", " ").title()
    report = {"outfit": outfit, "mode": "sheet" if "sheet" in files else "layers", "figures": {}}
    contact = []

    for body, kinds in pieces_of(files).items():
        name = f"{outfit}-{body}"
        found = {k: len(v[1]) for k, v in kinds.items()}
        notes = []
        for kind, folder, slot in (("top", "chest", "top"), ("bottoms", "pants", "bottom")):
            if kind not in kinds or not kinds[kind][1]:
                raise SystemExit(f"{outfit} {body}: no {kind} found")
            img, group = kinds[kind]
            save_sprite(cut(img, group), folder, name)
            contact.append((kind, union_box(group)))

            place = placement_for(body, union_box(group))
            key = f"{slot}/{name}/{body}"
            entry = placements.setdefault(slot, {}).setdefault(name, {})
            current = entry.get(body)
            if current is None or current == written.get(key) or replace:
                entry[body] = place
                written[key] = place
            elif current != place:
                notes.append(f"kept the existing {slot} placement (--replace-placements to use the template's)")

        if "gloves" in kinds:
            img, group = kinds["gloves"]
            GLOVES.mkdir(parents=True, exist_ok=True)
            for side, g in zip(("left", "right"), sorted(group, key=lambda s: s["cx"])):
                cut(img, [g]).save(GLOVES / f"{name}-{side}.png")
                contact.append(("gloves", g["box"]))

        report["figures"][body] = {"found": found, "notes": notes}

    contact_sheet(outfit, files, contact)
    report["gear"] = write_gear(outfit, title)
    return report


def write_gear(outfit: str, title: str) -> list:
    written = []
    for slot, suffix, noun in (("top", "top", "Top"), ("bottom", "bottoms", "Bottoms")):
        gid = f"{outfit}-{suffix}"
        path = GEAR / f"{gid}.json"
        if path.exists():
            continue
        item = {
            "id": gid,
            "name": f"{title} {noun}",
            "slot": slot,
            "rarity": PLACEHOLDER[slot]["rarity"],
            "statMods": PLACEHOLDER[slot]["statMods"],
            "description": f"Part of the {title} outfit.",
            "tags": [f"outfit:{outfit}"],
            "spriteByBody": {body: f"{outfit}-{body}" for body in BODIES},
            "requires": {},
        }
        path.write_text(json.dumps(item, indent=2) + "\n", encoding="utf-8")
        written.append(gid)
    return written


def contact_sheet(outfit: str, files: dict, boxes) -> None:
    """The art over the template's bodies, every cut boxed.

    The bodies are drawn in grey underneath so a reviewer can see at a glance
    whether the cloth sits on them - which is the thing that went wrong with
    the first four outfits and was only visible once they were worn.
    """
    sheet = Image.new("RGBA", SHEET, (70, 70, 78, 255))
    for body in BODIES:
        sprite = body_sprite(body)
        ghost = sprite.resize((sprite.width * SCALE, sprite.height * SCALE), Image.NEAREST).convert("LA").convert("RGBA")
        ghost.putalpha(ghost.getchannel("A").point(lambda a: a * 90 // 255))
        sheet.alpha_composite(ghost, body_origin(body, sprite.size))
    for path in files.values():
        art = ss.clean(Image.open(path))
        sheet.alpha_composite(art.crop((0, 0, min(art.width, SHEET[0]), min(art.height, SHEET[1]))))
    draw = ImageDraw.Draw(sheet)
    colours = {"top": (60, 200, 90), "bottoms": (70, 140, 230), "gloves": (240, 150, 40)}
    for kind, box in boxes:
        draw.rectangle(box, outline=colours[kind], width=3)
    CONTACT.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").resize((SHEET[0] // 2, SHEET[1] // 2)).save(CONTACT / f"{outfit}.png")


def outfits_in_folder() -> dict:
    """{outfit id: {"sheet": path} or {"top": path, "bottoms": path, "gloves": path}}."""
    found = {}
    for path in sorted(SRC.glob("*.png")):
        stem = slug(path.stem)
        for kind in ("top", "bottoms", "gloves"):
            if stem.endswith(f"-{kind}"):
                found.setdefault(stem[: -len(kind) - 1], {})[kind] = path
                break
        else:
            found.setdefault(stem, {})["sheet"] = path
    for outfit, files in found.items():
        if "sheet" in files and len(files) > 1:
            raise SystemExit(f"{outfit}: both a single sheet and separate garment files - keep one or the other")
        if "sheet" not in files and not {"top", "bottoms"} <= files.keys():
            raise SystemExit(f"{outfit}: separate files need at least -top and -bottoms")
    return found


if __name__ == "__main__":
    if "--template" in sys.argv:
        write_template()
        sys.exit(0)

    replace = "--replace-placements" in sys.argv
    wanted = {slug(a) for a in sys.argv[1:] if not a.startswith("--")}
    outfits = {k: v for k, v in outfits_in_folder().items() if not wanted or k in wanted}
    if not outfits:
        raise SystemExit(f"no outfits in {SRC}" + (f" matching {sorted(wanted)}" if wanted else ""))
    if replace and not wanted:
        raise SystemExit("--replace-placements throws away hand-tuning: name the outfit(s) it is for")

    placements = json.loads(PLACEMENTS.read_text(encoding="utf-8"))
    written = json.loads(WRITTEN.read_text(encoding="utf-8")) if WRITTEN.exists() else {}
    for outfit, files in outfits.items():
        r = import_outfit(outfit, files, placements, written, replace)
        print(f"{r['outfit']:<14} ({r['mode']})")
        for body, f in r["figures"].items():
            found = ", ".join(f"{k} {n}" for k, n in f["found"].items())
            notes = f"; {'; '.join(f['notes'])}" if f["notes"] else ""
            print(f"  {body:<7} {found}{notes}")
        if r["gear"]:
            print(f"  gear     new: {', '.join(r['gear'])}")

    PLACEMENTS.write_text(json.dumps(placements, indent=2) + "\n", encoding="utf-8")
    WRITTEN.write_text(json.dumps(written, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    ss.write_index()
    print(f"\n{len(outfits)} outfit(s). Contact sheets: art/sprites/_contact-outfits/")
