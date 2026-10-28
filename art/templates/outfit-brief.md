# Outfit brief

What an artist needs to hand in an outfit (a top and a pair of bottoms, for
both bodies) so it goes into the game with no hand-fitting.

The canvas is **`art/templates/outfit-template.png`**. Draw on it, and nothing
else. It is generated from the game's own body sprites by
`python scripts/import-outfits.py --template`. Do not move, resize or redraw
the bodies on it.

## The one rule

**Draw the clothes ON the bodies in the template, in their pose.** The bodies
stand in a three-quarter view, facing right, with the lead fist raised and the
feet on the blue ground line. The clothes have to follow that exact pose: the
sleeves go where these arms are, the trouser legs where these legs are, and
the boots on these feet.

The first four outfits (Pink, Punk, Sailor, Stormtrooper) were drawn
front-on, in a wide stance. In the game the body's own legs showed beside the
trousers, and no amount of nudging fixes a leg drawn at a different angle.
They need redrawing on the template.

## The sheet

- **1536 × 1024 PNG with real transparency.** Do not flatten it onto white or
  a colour, and do not crop it: the importer reads each piece's position from
  where it sits on this canvas.
- **Male on the left half, female on the right.** The red line is the middle.
- **Hide the template layer before exporting.** Export the clothes only.
- **No glow, haze or drop shadow** around the pieces. Anything faint is thrown
  away, and anything strong becomes part of the sprite.

## Skin: leave it empty

Wherever skin would show (rips in jeans, a bare midriff, a sleeveless
shoulder, fingers through fingerless gloves), **leave the pixels fully
transparent**. Don't paint skin. The wearer's own body is drawn underneath,
so their own skin tone shows through. That is the only way one drawing
works for all five skin tones, and it only lines up because you drew on the
same body.

## How to hand it in

**Preferred: one file per garment.**

    Punk-top.png        just the top, both bodies, on the full canvas
    Punk-bottoms.png    just the bottoms (legs + boots), both bodies
    Punk-gloves.png     optional, see Gloves

Each file is the full 1536 × 1024 canvas with everything still in place. The
garments may overlap, so a shirt can hang over a belt.

**Also accepted: everything on one sheet**, `Punk.png`. Then **no two pieces
may touch**, not even by one pixel, because touching pixels can't be pulled
apart. Leave a clear gap between the shirt's hem and the waistband.

The file name is the outfit's name. The gear is called "Punk Top" and
"Punk Bottoms", with ids `punk-top` and `punk-bottoms`.

## Gloves

There's no gloves slot in the game yet (issue #20). If an outfit has gloves,
draw them **on the template's hands, in place**, in `<Name>-gloves.png`. On a
single sheet, keep them clear of the sleeves. They're cut and kept, ready for
when the slot exists.

## Checklist before handing in

- [ ] Drawn on `outfit-template.png`, pose unchanged, boots on the ground line
- [ ] 1536 × 1024, transparent background, template layer hidden
- [ ] Male left, female right
- [ ] Skin areas transparent, not painted
- [ ] No glow or shadow around the pieces
- [ ] One file per garment, or one sheet with no pieces touching

## If the art is generated rather than drawn

Use the template as the **starting image or pose guide** and keep the pose
locked. A generator left to its own devices goes back to a front-on, wide
stance, which is exactly what didn't fit. Then erase the painted skin to
transparency before handing it in.

## Importing (for whoever runs it)

Drop the file(s) in `art/New Assets/outfits/`, then:

    python scripts/import-outfits.py punk

New outfits are imported **switched off**: not in the shop, not in loot, and not wearable. Turn them on in the admin once they look right on a character.

Check `art/sprites/_contact-outfits/punk.png`. It shows the pieces boxed over
the template's bodies in grey, so a piece that doesn't sit on its body is
obvious there. The importer places each piece exactly where it was drawn.

For a redraw of one of the first four outfits, add `--replace-placements` so
the old guessed placement is replaced by the exact one.
