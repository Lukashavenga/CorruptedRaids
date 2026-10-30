# Outfit generation pack - for ChatGPT

Everything an image generator needs to draw an outfit that fits the game's
bodies. The rules come from `../outfit-brief.md`; this is the same brief,
written for a generator and carrying its own references.

## Files to upload (all four, every time)

| File | What it is for |
|---|---|
| `1-pose-template.png` | THE image to dress. Both game bodies at exactly 2x, on white, nothing else on it. Same geometry as `../outfit-template.png`. |
| `2-palette.png` | The 25-colour master palette, plus the six leather/skin tones the shipped gear actually uses. |
| `3-style-reference.png` | Shipped chest and pants sprites. Copy the **finish** (outline, shading steps, pixel size), not the pose. |
| `4-dont-do-this.png` | The first Punk outfit. Front-on, wide stance, glow, painterly. It did not fit and is switched off. |

---

## Prompt 1 - paste once at the start of the chat

> I'm making clothing sprites for **Corrupted Raids**, a dark-fantasy pixel-art
> RPG played by a Twitch chat. Every viewer's character is one of two bodies,
> and outfits are drawn as layers on top of those bodies.
>
> **The game's tone:** dark fantasy with a sense of humour. Dungeons are
> places like *The POORS*, *BARBIEVILLE*, *Monkestary*, *Ladies of The Knight*
> and *Woop Woop - Dats the Sound of Da Police*. Gear mixes real medieval kit
> (chainmail, cuirasses, greathelms, cloaks) with joke items (colander crown,
> cycling helmet, party hat, stormtrooper armour). Everything is rendered in
> the same gritty, moody, 16-bit style, however silly the item is.
>
> **Image 1 is the pose template.** It shows the male body (left) and the female
> body (right), standing three-quarter view facing right, lead fist raised, feet
> on the ground. Your job is always to **dress these exact two bodies in this
> exact pose**. Do not move, resize, re-pose or redraw the bodies. Sleeves go
> where these arms are, trouser legs go where these legs are, boots go on these
> feet. The output must be **1536 x 1024, landscape**, with both figures in the
> same place as in Image 1.
>
> **Image 2 is the palette.** Use only these colours. Outlines use the darkest
> ones (`#070c1d`, `#291546`, `#182e41`, `#191b3f`), never pure black.
>
> **Image 3 is the style.** Match its finish: crisp hand-placed pixel art, the
> same pixel size as the bodies in Image 1, chunky dark outlines, 3-6 flat
> shading steps per material, light from the upper left. Leather is warm
> brown, metal is blue-slate with pale mint highlights, cloth is big flat colour
> masses with few folds.
>
> **Image 4 is what NOT to do:** front-on wide stance, glow, painterly
> rendering, dark background.
>
> Rules for every image:
> - Background: one flat solid magenta, #FF00FF, edge to edge. Not white,
>   not transparent, not a checkerboard. No glow, haze, shadow or vignette.
> - No anti-aliasing, gradients, blur or painterly texture. Hard pixel edges.
> - Clothing only on the body. No background props, no text, no labels.
> - Don't draw the body at all, only the clothes. Wherever skin would show
>   through them (rips, bare midriff, fingers out of fingerless gloves), fill
>   it with the same flat #FF00FF magenta. Never paint skin.
>
> Reply "ready" and I'll send the outfits one by one.

## Prompt 2 - one per outfit

> Dress both bodies in Image 1 in a **[OUTFIT NAME]** outfit: **[top]** and
> **[bottoms + boots]**. [Optional: gloves.] Same pose, same position, same
> size, 1536 x 1024, flat #FF00FF background and skin, palette and style as
> before.

The four that need redrawing (their stats and ids already exist, so the names
must stay the same):

- **Punk** - ripped black band tee (crop top on the female) with a pink
  dead-smiley print and a chain necklace; light-blue ripped jeans with a
  studded belt, wallet chain and thigh strap; brown laced combat boots;
  optional spiked leather wrist cuffs.
- **Sailor** - white sailor shirt with navy collar, red neckerchief and anchor
  badge (cropped on the female); white cargo trousers with navy belt and gold
  anchor chain (pleated navy skirt with white thigh socks on the female); navy
  laced boots with gold anchor buckles; optional white gloves with navy cuffs.
- **Pink** - glossy pink plate armour with gold trim and heart motifs: heart
  breastplate and pauldrons; tassets with a pink loincloth, heart knee guards,
  pink sabatons; optional pink gauntlets.
- **Stormtrooper** - white sci-fi trooper plate over a black undersuit:
  chest plate, shoulder caps and utility belt; segmented white leg plates with
  a holster, white boots; optional black gloves.

Ask for **one garment at a time** if it helps the fit: "now only the top, the
rest of the body unchanged". The importer prefers one file per garment
anyway.

## Follow-ups that fix the usual problems

- *"The legs are wider than the template. Redraw with the feet exactly where
  they are in Image 1."*
- *"Remove the glow and the shadow; flat #FF00FF behind the figures."*
- *"The skin in the rips/fingers is painted. Fill those with #FF00FF."*
- *"Too smooth. Re-render as pixel art at the same pixel size as Image 1's
  bodies, with hard edges and no anti-aliasing."*
- *"You changed the body. Keep the body pixel-identical to Image 1 and only
  add clothing."*

---

## After ChatGPT - turning the image into something the importer accepts

**Why magenta.** ChatGPT cannot export transparency: asked for it, it PAINTS a
grey-and-white checkerboard (the first Punk redraw came back that way, as an
RGB file). Keying that out also eats every white stud and chain highlight, and
an enclosed patch of it - inside a neckline - is not reached by a flood fill.
Magenta appears in nothing this game wears, so one colour select removes the
background AND the skin holes in a single step.

ChatGPT will not keep pixels exactly where they were either. So each result
needs a short cleanup in an editor (Aseprite, Photopea, Photoshop):

1. Open `../outfit-template.png` (the labelled one) and put the ChatGPT image
   on a layer above it.
2. If the figures drifted, **move and scale the ChatGPT layer** until its
   bodies sit on the template's bodies. Scale it as a whole; don't warp it.
3. Select by colour #FF00FF (contiguous off) and delete it. Then check for
   anything skin-coloured left behind and erase that too.
4. Hide the template layer and export a **1536 x 1024 transparent PNG**:
   `Punk-top.png`, `Punk-bottoms.png` (and `Punk-gloves.png`), or one
   `Punk.png` with no two pieces touching.
5. Put it in `art/New Assets/outfits/` and run
   `python scripts/import-outfits.py punk --replace-placements`
   (`--replace-placements` only for the four redraws).
6. Check `art/sprites/_contact-outfits/punk.png`, then switch the items on in
   the admin panel.
