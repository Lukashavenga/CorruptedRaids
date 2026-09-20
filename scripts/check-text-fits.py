"""
Checks that every string the fight overlay can show fits the stage width.

    python scripts/check-text-fits.py

The overlay is a fixed 450px surface rendered in a bitmap font that is only
crisp at whole multiples of its 16px cell (see scripts/build-font.py). That
combination makes copy length a HARD constraint rather than a style question:
there is no intermediate size to fall back to, and a string that overruns is
either clipped or ellipsised on stream, where nobody can fix it.

This measures the real strings with the real font, at the size each element
actually renders at, and fails loudly if one overflows. It exists because the
alternative is finding out from a screenshot mid-fight — which is how the join
prompt and the results banner were both caught running past both edges.

Worst-case substitutions are deliberately pessimistic: the longest viewer name
we choose to support, the longest mob name in content, and two-digit numbers.
"""

import sys
from pathlib import Path

from PIL import ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "web" / "public" / "fonts" / "corrupted.ttf"
if not FONT.exists():
    sys.exit(f"missing {FONT} — run: npm run gen:font")

# stage.ts: STAGE_W 450 minus STAGE_PAD 6 each side.
BUDGET = 450 - 12


def _longest_dungeon_name():
    """The longest dungeon AND raid name on disk.

    Read from content rather than typed here, and that is the whole point:
    this check passed for months against "Marketgate" while the game actually
    shipped "Woop Woop - Dats the Sound of Da Police", which is 38 characters
    and renders about 608px at 32px against a 438px stage. The audience saw
    "- Dats the Sound of Da Polic", clipped at both ends, with the "LEVEL n"
    suffix -- the reason the line exists -- cut off entirely.
    """
    import json

    best = ""
    for folder in ("dungeons", "raids"):
        for path in sorted((ROOT / "content" / folder).glob("*.json")):
            doc = json.loads(path.read_text(encoding="utf-8"))
            best = max(best, doc.get("name", ""), key=len)
    return best or "Marketgate"


# useCombatPlayback.ts clamps a combatant name to this many characters,
# keeping any trailing instance number. It is a real bound, so the log lines
# below can be checked exactly rather than guessed at.
NAME_MAX = 10


def _enemy_names():
    """Every unit name across every dungeon formation and raid room."""
    import json

    names = set()
    for folder in ("dungeons", "raids"):
        for path in sorted((ROOT / "content" / folder).glob("*.json")):
            doc = json.loads(path.read_text(encoding="utf-8"))
            fights = [doc]
            for room in list(doc.get("rooms", [])) + ([doc["boss"]] if doc.get("boss") else []):
                if room.get("fight"):
                    fights.append(room["fight"])
            for fight in fights:
                for units in (fight.get("formations") or {}).values():
                    for unit in units:
                        if unit.get("name"):
                            names.add(unit["name"])
    return names or {"Bog Gobl"}


def _widest_clamped_name(font_size):
    """The WIDEST name once clamped, not the longest.

    The display face is not monospaced, so ten characters of one name and ten
    of another differ by tens of pixels. Picking by length measures the wrong
    string and passes a check the real worst case would fail.
    """
    font = ImageFont.truetype(str(FONT), font_size)
    clamped = {n[:NAME_MAX].rstrip() for n in _enemy_names()}
    return max(clamped, key=font.getlength)


def _longest_room_copy():
    """The longest room name and revealed line across every raid on disk."""
    import json

    name, line = "", ""
    for path in sorted((ROOT / "content" / "raids").glob("*.json")):
        raid = json.loads(path.read_text(encoding="utf-8"))
        rooms = list(raid.get("rooms", []))
        boss = raid.get("boss")
        if boss:
            rooms.append(boss)
        for room in rooms:
            name = max(name, room.get("name", ""), key=len)
            line = max(line, room.get("description", ""), key=len)
    return name or "The Long Hall", line or "Nothing here."

# The longest values each placeholder is allowed to reach. Names are clamped
# by NAME_MAX in the overlay, so this is a real bound rather than a hope.
ACTOR = "PixelWitch"
# NAME_MAX in useCombatPlayback.ts clamps names to 10 chars, keeping any
# trailing instance number — so this is the true worst case, not a guess.
# The widest name the log can actually print, clamped exactly as the overlay
# clamps it. Measured at 32px, the size the log renders at.
TARGET = _widest_clamped_name(32)
# NOT bounded: the headline renders the dungeon name in full. StateBanner
# steps the whole line down to 16px when it will not fit at 32 (see
# useFittedFontSize), so this is checked at BOTH sizes below -- 32px is
# allowed to overflow, 16px is not.
DUNGEON = _longest_dungeon_name()
# The longest room name and revealed line in content/raids/. Read from disk
# rather than typed here, so authoring a room that does not fit fails this
# check instead of being discovered mid-raid.
ROOM, ROOM_LINE = _longest_room_copy()

# (label, rendered size in px, string)
CASES = [
    # The headline, at the size it will actually land on. A name too long for
    # 32px is rendered at 16px instead of clipped, so 16px is the real budget
    # and the one that must hold.
    ("banner.gathering",  16, f"{DUNGEON} — LEVEL 6"),
    ("banner.results",    16, f"{DUNGEON} has fallen!"),
    ("banner.combat",     32, "25 vs 5"),
    ("banner.victory",    32, "Taken!"),
    ("banner.defeat",     32, "Driven off..."),
    ("banner.idle",       32, "Awaiting the next run..."),
    ("banner.cooldown",   32, "Catching a breath..."),
    ("banner.sub",        16, "!join 12s"),
    # Party name left, enemy right, always — both orders are the same
    # characters, so both measure the same. Two-digit damage is the documented
    # ceiling (see combatLog in en.ts); a third digit is 16px past the stage
    # and has been since before the names were reordered.
    # CombatLog steps a line that will not fit down to 16px (see
    # useFittedFontSize), so 16px is the budget that must hold. The real worst
    # case here -- a ten-character viewer beside the widest clamped enemy name
    # -- runs 466px at 32px, which is why the step-down exists.
    ("log.attackOut",     16, f"{ACTOR} • {TARGET} -24"),
    ("log.attackIn",      16, f"{ACTOR} -24 • {TARGET}"),
    ("log.heal",          16, f"{ACTOR} • {TARGET} +16"),
    ("log.down",          32, f"{TARGET} is down!"),
    ("log.reward",        32, f"{ACTOR} +120xp +45g"),
    ("figure.level",      16, "Corruption 12"),
    ("log.levelUp",       32, f"{ACTOR} corrupts to 12"),
    ("log.victory",       32, "The village falls."),
    # The enemy-health strip under the arena: the fight's name plus a count,
    # at 16px. Three digits because a raided stream fields that many.
    ("enemyBar",          16, f"{DUNGEON} • 100 standing"),
    ("log.defeat",        32, "Driven off."),
    # The reveal card. Room names and lines are CONTENT, so these are the
    # longest currently authored — if a new room overruns, this is where it
    # shows up rather than on stream.
    ("room.name",         16, ROOM),
    ("room.holds",        16, "16 waiting"),
    ("room.line",         16, ROOM_LINE),
]


def main() -> int:
    if not FONT.exists():
        sys.exit(f"missing {FONT} — run: npm run gen:font")

    fonts = {}
    failures = []
    print(f"budget {BUDGET}px\n")
    for label, size, s in CASES:
        f = fonts.setdefault(size, ImageFont.truetype(str(FONT), size))
        w = f.getlength(s)
        ok = w <= BUDGET
        if not ok:
            failures.append((label, size, w, s))
        print(f"  {'ok  ' if ok else 'OVER'} {w:6.0f}px  {size}px  {label:18s} {s}")

    if failures:
        print(f"\n{len(failures)} string(s) overflow the stage:")
        for label, size, w, s in failures:
            over = w - BUDGET
            print(f"  {label} is {over:.0f}px too wide at {size}px — shorten it, "
                  f"or drop that element to 16px")
        return 1

    print("\nall overlay copy fits.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
