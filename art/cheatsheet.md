# Peasant Frame & Gear System — Cheat Sheet

Condensed from the Art Bible (v0.2). Keep this open while drawing; it's the
part you actually need pixel-to-pixel. Full rationale lives in the Art
Bible itself — this is the reference card, not the argument.

## Every asset, no exceptions

- **128 × 128 canvas**, transparent background, exported at 1× — no
  anti-aliasing, no soft edges, no half-pixel detail.
- **1px `#0B0D12` outline**, fully enclosing the shape. No gaps on the lit
  side, no tinted outlines, no 2px corners.
- **One light source**, upper left (~10 o'clock, slightly in front), fixed
  across every asset in the game. No rim light, no second fill, no bloom.
- **Shading is hue-shifted, not brightness-only.** Each step down a ramp
  rotates toward the world-shadow blue-violet (`#232936`) and gains
  saturation; each step up rotates toward bone and loses it. 4–5 steps per
  material, hard boundaries, dithering only across large flat metal.
- **Ground contact** is a flat ellipse at 35% alpha in `#232936`, on its own
  layer under the sprite — never baked into the asset PNG.
- **Colour comes only from the ramps below.** No new hues invented per-item.
- **Rarity and element never glow on the sprite.** They live in the
  inventory frame / name colour / corner notch (see Rarity table below) —
  keeps one PNG usable at every tier.
- **Drawn to fit the *stout* body.** It fully contains the slim outline, so
  one gear layer serves both builds.

## Naming

`slot_name_tier.png` — e.g. `head_horned-helm_epic.png`, `mainhand_rusty-shortsword_common.png`.

## Rejection checklist — any one sends it back

- Soft or semi-transparent edge pixels
- More than 5 values used in one material
- A second light source or rim glow
- Detail finer than the 1px grid
- Colour that isn't from a ramp below
- Silhouette that reads as mush at 1×
- Anatomy outside the 3-head peasant frame

## The peasant frame

> **AMENDED — what actually shipped.** The numbers below are the v0.2 design.
> `src/character/layers.ts` is the authority where they disagree.
>
> - **The canvas is 200, not 128** — 150px figure (y 38→187), baseline
>   **y = 188**, centre **x = 100**. Every y-value in the z-order table below
>   scales by 200/128. The number is the PixelLab ceiling: bitforge, /rotate
>   and the inpainting that fits gear to a body all cap at 200x200, so
>   authoring any larger meant every one of them ran small and got resampled
>   back on a non-integer ratio, softening the hard edges the style depends on.
>   At 200 nothing is ever resampled. The overlay draws at 100 (0.5x), the
>   loadout at 200 (1:1).
> - **Readability comes from bold shapes, not resolution.** A 256 canvas was
>   tried and rejected: the extra pixels went into muscle striation that turned
>   to mush the moment the overlay halved it. Thick dark outline, few flat
>   colours, high contrast, minimal interior detail — the reference gear art
>   works exactly this way, and `outline()` in generate-base-body.py and
>   `outline_layer()` in generate-gear-layer.py enforce the edge in code rather
>   than hoping the generator supplies it.
> - **Party figures face three-quarter right** (`direction: south-east`), toward
>   the enemy line. Neither generator produces this directly — pixflux ignores
>   `direction`, and bitforge needs an init image to hold onto — so the pipeline
>   is pixflux (front) → /rotate (turn) → bitforge (redraw at full canvas).
> - **The +/-3px silhouette rule holds, and gear is drawn once.** Front-facing
>   bases diverged badly (male 88px across the shoulders, female 60) and gear
>   had to be authored per body; turning both to three-quarter brought them to
>   45px each, and a single layer now sits correctly on both. The rule is not
>   arbitrary — it is exactly the tolerance at which gear can be drawn once.

128×128 canvas, 96px figure (y 24→119), 20px head, 4.8-heads lean adult
build, feet plant on baseline **y = 120**, silhouette centred on **x = 64**.
Two bodies — slim (18px shoulders) and stout (20px shoulders) — share
identical shoulder/waist/ankle y-values; only torso width changes (±3px).
Gear is drawn once, for stout, and fits both.

8 skin tones × 10 hair styles × 5 expressions = **17 authored layers**, not
hundreds of combinations.

## Z-order and slot bounds

Z is gapped by 10 so a slot can be inserted later without renumbering. A
layer may cross into a neighbour's silhouette but must not paint outside
its own listed Y bounds. `shadow` is engine-drawn, never an asset.

| Z | Slot | Y bounds | Notes |
|---|------|----------|-------|
| -20 | `aura.back` | full canvas | Trails, ground rings, motes. Animated, 4 frames max |
| -10 | `back` | 30–119 | Wings, cloak, pack. Clear the body silhouette by 3px each side |
| 0 | `body` | 24–119 | Base rig — not a content slot |
| 10 | `face` | 30–41 | 5 expressions — not a content slot |
| 20 | `hair` | 18–46 | 10 styles — not a content slot |
| 25 | `face.hair` | 38–50 | Beards/moustaches. Cosmetic, not equipment |
| 30 | `legs` | 74–113 | Trousers, greaves. Hem never below y=110 |
| 40 | `feet` | 106–119 | Sole meets baseline exactly; cuff top at y=106 |
| 50 | `chest` | 46–80 | Torso + upper arms; leave forearms bare for gloves |
| 60 | `waist` | 66–82 | Belts, sashes. Buckle centred on **x = 64** |
| 70 | `shoulders` | 46–62 | Pauldrons — may extend 4px past the torso each side |
| 80 | `hands` | 74–84 | Both hands in one asset |
| 90 | `head` | 12–46 | Over hair. Tall crests may reach y=12 |
| 100 | `offhand` | 40–124 | Held at **HAND.R (51, 80)**. Shields, pints, torches |
| 110 | `mainhand` | 10–126 | Held at **HAND.L (77, 80)**. Grip pixel is the contract |
| 120 | `aura.front` | full canvas | Sparks, drips, frost — max 30% coverage, never over the face |

`head` assets carry one flag, `hidesHair` — the only conditional in the
whole system (a full helmet masks hair; a hat doesn't).

## Rarity — lives in the UI, not the sprite

| Rarity | Colour | Frame |
|---|---|---|
| Common | `#6C7A86` | 2px frame |
| Uncommon | `#98A377` | 2px frame |
| Rare | `#5490BD` | 2px frame |
| Epic | `#9B83CF` | 2px frame |
| Legendary | `#D8A24A` | 2px frame + 2 corner notches |

## Type

- **Bevan** (display) — item/boss names, headers, big numbers. Five words
  or fewer, never a paragraph.
- **Barlow** (text) — flavour text, tooltips, menus. 15px minimum in-game.
- **IBM Plex Mono** (data) — stats, coordinates, damage rolls, asset IDs.

All three are open-licensed, on Google Fonts.

## Palette quick reference

Full ramps (hex) are in `palette.gpl` — import it into your editor rather
than retyping these. Anchors: World Grey `#7A8794`, Outline `#0B0D12`,
Ochre Accent `#D8A24A`, Bone Highlight `#E7EEF2`. Materials: Steel, Stone,
Cast Iron, Leather & Wood, Cloth, Brass & Gold — each a 5-step ramp.
Elements (themed sets, layered *onto* a material, never instead of it, kept
under ~12% coverage): Ember, Rime, Void, Toxin.
