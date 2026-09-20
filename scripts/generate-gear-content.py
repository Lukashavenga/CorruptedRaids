"""
Writes content/gear/*.json from the sliced sprites in art/sprites.

    python scripts/generate-gear-content.py

Every wearable sprite becomes a gear item, so the loadout, shop and character
doll all draw real art instead of placeholders. Stats are derived from the
sprite's position in its sheet: sheets are laid out weakest-to-strongest left to
right, so column order is a usable proxy for tier, and rarity follows from it.
That is a deliberate approximation — it gives a full, playable catalogue to test
against now, and any item can be hand-tuned afterwards because each one is its
own JSON file.

Sex-specific art (chest, pants) becomes ONE item with two sprites rather than
two items. A player should not see "Male Chainmail" and "Female Chainmail" as
separate things to loot; they should loot Chainmail and have it drawn to fit.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "art" / "sprites"
OUT = ROOT / "content" / "gear"

RARITIES = ["common", "uncommon", "rare", "epic", "legendary"]

#: Stats whose base value is so large that a requirement on them is never felt.
#: A character starts with 120 hp, so any hp gate is met before it is read.
UNGATEABLE = {"hp"}

#: An item whose best stat is at or under this stays ungated — the starting
#: tier a player with no points spent can still put on.
UNGATED_BELOW = 16

#: The smallest gate worth writing. Below this it is a requirement in name only.
GATE_FLOOR = 8

# Named by eye from the sheets. Anything not listed falls back to a generated
# name — better a plain name than a wrong one.
HEAD_NAMES = [
    "Crusader Helm", "Rusted Bucket", "Bedsheet Wraith", "Witch's Hat",
    "Horned Warhelm", "Legionary Helm", "Bounty Hunter Helm", "Stormtrooper Helm",
    "Cycling Helmet", "Miner's Lamp Helm", "Aviator Cap", "Bear Skull",
    "Ram Skull", "Colander Crown", "Gentleman's Topper", "Sheriff's Hat",
    "Tyrant's Crown", "Party Hat", "Imp Horns", "Straw Hat",
    "Shinobi Wrap", "Plumed Greathelm", "Poacher's Cap", "Shark Head",
]

MAINHAND_NAMES = [
    "Rusty Dagger", "Iron Shortsword", "Gilded Blade", "Cleaver Greatsword",
    "Woodsman's Axe", "Twin-Bladed Axe", "Spiked Mace", "Siege Hammer", "Iron Flail",
    "Hunting Spear", "Gilded Lance", "Bearded Halberd", "Fisher's Trident",
    "Yew Longbow", "Gilded Recurve", "Field Crossbow", "Paired Kunai", "Kunai Fan",
    "Frost Sceptre", "Bramble Staff", "Warlock's Rod", "Tidecaller Staff",
    "Emberbrand", "Shardspire Staff", "Plain Quarterstaff",
    "Round Shield", "Lion Heater", "Crimson Tower Shield",
]

OFFHAND_NAMES = [
    "Pitch Torch", "Storm Lantern", "Green Draught", "Grimoire of Rot", "Coin Purse",
    "Wailing Skull", "Tavern Tankard", "Stolen Bouquet", "Roast Haunch", "Parrying Dirk",
]

CHEST_NAMES = ["Strapped Harness", "Buckled Jerkin", "Chainmail Rig", "Knight's Cuirass", "Ranger's Mantle"]
PANTS_NAMES = ["Worn Breeches", "Sashed Trousers", "Patched Leggings", "Plated Greaves", "Heralds Tassets"]

# Face items are the game's SKILL gear.
#
# They used to carry spd + crit, which were measured out of the gear pool
# entirely (see GEAR_STAT_KEYS) — leaving these 47 items granting nothing. Skill
# is the natural replacement and it fixed a worse gap at the same time: skill
# was on zero items despite being the tank's mitigation stat and the healer's
# throughput stat, so the two roles the game most wants you to bring had no gear
# supporting them.
FACE_SKILL_BY_RARITY = {"common": 3, "uncommon": 5, "rare": 8, "epic": 12, "legendary": 16}


def rarity_for(index: int, total: int) -> str:
    """Spread items across the five rarities by their order in the sheet."""
    if total <= 1:
        return RARITIES[0]
    return RARITIES[min(len(RARITIES) - 1, index * len(RARITIES) // total)]


def titleise(stem: str) -> str:
    return re.sub(r"[-_]+", " ", stem).title()


def sprite_ids(folder: str):
    return sorted(p.stem for p in (SPRITES / folder).glob("*.png"))


def write(item: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{item['id']}.json").write_text(json.dumps(item, indent=2) + "\n")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def gate_for(stats: dict) -> dict:
    """What a player must have spent before they may wear this.

    Gear gates on ATTRIBUTES, not level: where the points went is the build, so
    that is what a piece of gear should ask about. A level-80 player who dumped
    everything into Speed has not earned the heavy armour.

    The gate names the item's dominant stat — the one it is *for* — pitched just
    under what the item grants, so a piece is a step up rather than a wall.

    HP IS NEVER GATED. `requires` compares against a stat's VALUE, not the
    points spent on it, and every character starts with 120 hp — so an "hp: 36"
    gate is met at level 1 by everyone and gates nothing at all. The catalogue
    carried 33 such gates and not one of them ever stopped anybody. An item
    whose only real stat is hp is therefore left open; gating it would be a
    label, not a requirement.
    """
    gateable = {k: v for k, v in stats.items() if k not in UNGATEABLE}
    if not gateable:
        return {}
    dominant = max(gateable, key=lambda k: gateable[k])
    value = gateable[dominant]
    if value <= UNGATED_BELOW:
        return {}
    return {dominant: max(GATE_FLOOR, round(value * 1.2))}


def build() -> int:
    # Additive, NOT a wipe.
    #
    # This started as a bootstrap that owned the whole catalogue, and wiping was
    # fine when nothing downstream existed. It is not fine now: every item has
    # since been hand-tuned and re-rarified, and `for old in OUT.glob(): unlink()`
    # would throw all of that away to regenerate approximations from sheet
    # position. Skipping what already exists keeps this useful for its remaining
    # job — turning NEW sprite art into gear definitions — without it being a
    # command that silently destroys a day of balancing.
    made = 0
    kept = 0

    def emit(name, slot, sprite, index, total, stats, level):
        nonlocal made, kept
        if (OUT / f"{slug(name)}.json").exists():
            kept += 1
            return
        write({
            "id": slug(name),
            "name": name,
            "slot": slot,
            "rarity": rarity_for(index, total),
            "requires": gate_for(stats),
            "statMods": stats,
            "description": f"{name}. Taken, not given.",
            "tags": [],
            # `sprite` is the join between content and art: it names a file in
            # art/sprites/<folder>/ and is what placements.json is keyed on.
            "sprite": sprite,
        })
        made += 1

    # --- head -------------------------------------------------------------
    heads = sprite_ids("head")
    for i, sid in enumerate(heads):
        name = HEAD_NAMES[i] if i < len(HEAD_NAMES) else titleise(sid)
        emit(name, "head", sid, i, len(heads),
             {"hp": 4 + i, "armour": 1 + i // 3}, 1 + i // 4)

    # --- face -------------------------------------------------------------
    faces = sprite_ids("face")
    for i, sid in enumerate(faces):
        rarity = rarity_for(i, len(faces))
        emit(f"Visage {i + 1:02d}", "face", sid, i, len(faces),
             {"skill": FACE_SKILL_BY_RARITY[rarity]}, 1)

    # --- chest / pants: one item, two sprites ------------------------------
    for slot, folder, names, base in (
        ("top", "chest", CHEST_NAMES, {"hp": 10, "armour": 3}),
        ("bottom", "pants", PANTS_NAMES, {"hp": 6, "armour": 2}),
    ):
        tiers = sorted({s.split("-", 1)[1] for s in sprite_ids(folder)})
        for i, tier in enumerate(tiers):
            name = names[i] if i < len(names) else titleise(f"{folder} {tier}")
            # Same existence check as emit(): this path writes directly rather
            # than through it, and without the guard a regeneration silently
            # overwrote the ten hand-tuned chest and pants items.
            if (OUT / f"{slug(name)}.json").exists():
                kept += 1
                continue
            stats = {k: v + v * i // 2 for k, v in base.items()}
            write({
                "id": slug(name),
                "name": name,
                "slot": slot,
                "rarity": rarity_for(i, len(tiers)),
                "requires": gate_for(stats),
                "statMods": stats,
                "description": f"{name}. Taken, not given.",
                "tags": [],
                # Two sprites, picked by body type at draw time. The item is one
                # thing; only its art differs.
                "spriteByBody": {"male": f"male-{tier}", "female": f"female-{tier}"},
            })
            made += 1

    # --- weapons and off-hands --------------------------------------------
    mh = sprite_ids("mainhand")
    for i, sid in enumerate(mh):
        name = MAINHAND_NAMES[i] if i < len(MAINHAND_NAMES) else titleise(sid)
        emit(name, "mainHand", sid, i, len(mh), {"atk": 3 + i}, 1 + i // 3)

    oh = sprite_ids("offhand")
    for i, sid in enumerate(oh):
        name = OFFHAND_NAMES[i] if i < len(OFFHAND_NAMES) else titleise(sid)
        emit(name, "offHand", sid, i, len(oh), {"hp": 6 + i * 2, "armour": 2 + i}, 1 + i // 3)

    if kept:
        print(f"  kept {kept} existing item(s) — delete a file to have it regenerated")
    return made


if __name__ == "__main__":
    n = build()
    print(f"wrote {n} gear items -> content/gear/")
