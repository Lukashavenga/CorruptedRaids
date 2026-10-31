# Female body, fair - in parts

The fair female body (`web/public/art/sprites/body/female-fair.png`) cut into
six layers plus underwear, so gear can sit BETWEEN parts of the body instead of
only on top of the whole of it: a sleeve over the front arm, a cloak behind the
rear arm, trousers over both legs.

**Not wired into the game yet.** Both renderers still draw the single body
sprite. This is the asset, for review; layering a character from parts in
`CharacterSprite` and `composeCharacter.ts` (which must change together, see
AGENTS.md section 4) is the next step.

## The files

Every file is the full 228 x 393 canvas of the original sprite, so each part
takes the body's existing placement unchanged - no per-part offsets.

| file | what |
|---|---|
| `rear-arm.png` | the hanging arm, shoulder cap to fist |
| `rear-leg.png` | the back leg, from the hip crease down |
| `torso.png` | neck, chest, belly, pelvis |
| `front-leg.png` | the forward leg, from the hip crease down |
| `head.png` | head and jaw |
| `front-arm.png` | the raised arm, shoulder to fist |
| `underwear.png` | bra and briefs, as worn today |
| `_bare.png` | the six parts flattened: the bare base, for reference |
| `preview.png` | bare / parts tinted / exploded / dressed |

Draw order, back to front, is in `layers.json`:

    rear-arm, rear-leg, torso, front-leg, underwear, head, front-arm

## What is guaranteed

- **The six parts stack into `_bare.png` exactly** - every pixel belongs to one
  part. A part's edge that another part covers is simply cut there; nothing is
  painted underneath, because in this pose nothing behind a part is ever seen.
  Posing or hiding a part would need those areas drawn.
- **Adding `underwear.png` reproduces today's body**, except 58 pixels: the tip
  of the bra used to overlap the front arm's edge, and with the arm now in
  front of the underwear it tucks behind it.

## The bare base

The skin under the bra and briefs was never drawn, so it was painted here, in
the body's own skin ramp and on its ~3px pixel grid: breasts lit from the upper
left with a shadowed underside and a crease beneath, the cleavage line, and the
V of the hip creases down to where the thighs meet. Anatomical in form, with no
nipples or genitals: this is a stream overlay, and one missing underwear layer
or a render bug must not put explicit nudity on a Twitch channel.

The cut lines are hand-placed polygons on the sprite (the hip creases for the
legs, the shoulders for the arms, the jaw for the head). The other four skin
tones are one drawing recoloured from fair, so the same masks cut them too.
