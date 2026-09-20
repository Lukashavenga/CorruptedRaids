# Pixel RPG Visual Design System — Base v1

## Purpose

This is the **master visual reference** for subsequent RPG asset-generation prompts and implementation work.

Use this file together with the supplied base reference image:

`a_clean_white_background_reference_sheet_sprite.png`

The reference image establishes the target visual language. This document turns that language into repeatable rules.

---

## Core Art Direction

**Genre:** Fantasy RPG / pixel-art adventure  
**Visual era:** polished 16-bit / modern pixel-art interpretation  
**Mood:** dark fantasy, adventurous, slightly mystical  
**Rendering:** deliberate pixel clusters, hard-edged shapes, controlled dithering where useful  
**Primary characteristic:** rich readable silhouettes with restrained but substantial shading.

### Non-negotiables

- Pixel art must look intentionally pixel-authored.
- Use **hard pixel edges**.
- **No anti-aliasing.**
- No smooth vector-like gradients.
- No blurry glow effects.
- No photographic texture.
- No painterly brushwork.
- No AI-looking surface noise.
- Avoid excessive micro-detail that destroys the silhouette.
- Flat backgrounds should remain clean and easily removable.
- Shading should come from discrete palette steps rather than blended tones.
- Outlines should be chunky enough to remain readable at game scale.
- Keep objects visually separated from their background.

---

## Master Palette

Use these 25 colors as the default palette. Do not introduce arbitrary colors unless a prompt explicitly requests an exception.

| Token | Hex |
|---|---|
| deep_plum | `#9f3c91` |
| dark_violet | `#452060` |
| near_black_purple | `#291546` |
| void_navy | `#070c1d` |
| deep_wine | `#3d1430` |
| wine | `#632240` |
| muted_magenta | `#913a52` |
| warm_red | `#bc5960` |
| gold | `#e2b570` |
| pale_gold | `#eee98a` |
| lime | `#b7d974` |
| moss | `#5da75d` |
| teal_green | `#39755c` |
| deep_teal | `#285454` |
| steel_blue | `#1f394d` |
| deep_blue | `#191b3f` |
| blue | `#192d50` |
| ocean | `#286080` |
| aqua | `#3fa0a4` |
| mint | `#86e0ce` |
| pale_mint | `#e3f5f1` |
| dusty_blue | `#81afb5` |
| slate | `#446374` |
| blue_slate | `#32495f` |
| dark_blue | `#182e41` |

### Palette usage

**Dark foundations**
- `#070c1d`, `#291546`, `#182e41`, `#191b3f`

**Purple / magical accents**
- `#9f3c91`, `#452060`, `#913a52`, `#3d1430`

**Warm accents**
- `#bc5960`, `#e2b570`, `#eee98a`

**Natural greens**
- `#b7d974`, `#5da75d`, `#39755c`, `#285454`

**Blue / water / metal**
- `#1f394d`, `#192d50`, `#286080`, `#3fa0a4`

**Highlights**
- `#86e0ce`, `#e3f5f1`, `#81afb5`

---

## Contrast & Shading

Prefer approximately **3–6 discrete value steps per object**.

Typical object construction:

1. Dark silhouette / outline
2. Main local color
3. Shadow mass
4. Secondary shadow
5. Light-facing plane
6. Small highlight pixels

Do not outline every internal detail equally. Use heavier outer contours and lighter internal separation.

### Light

Default lighting should be:
- soft but directional,
- generally from upper-left / upper-front,
- strongest highlights reserved for metal, magic, water and important interactable details.

Dark fantasy scenes should remain predominantly dark even when illuminated.

---

## Outlines

Use dark palette colors rather than pure black whenever possible.

Preferred outline colors:
- `#070c1d`
- `#291546`
- `#182e41`
- `#191b3f`

Pure black is not part of the master palette and should generally be avoided.

Outlines should be:
- chunky,
- stepped,
- intentional,
- slightly variable in thickness.

Avoid uniform 1px vector-like contouring around every shape.

---

## Pixel Construction

### Silhouettes

Every asset should read clearly at a glance.

For characters:
- oversized readable head / hair shapes,
- strong shoulder and cloak silhouettes,
- clearly separated hands, weapons and feet,
- recognizable class identity.

For props:
- exaggerated shape language,
- clear base/contact shadow,
- enough contrast to separate from the environment.

### Pixel clusters

Favor coherent clusters over isolated noisy pixels.

Good:
- grouped 2–8 pixel highlight/shadow shapes,
- stepped curves,
- intentional corners,
- controlled texture.

Avoid:
- random single-pixel noise,
- photographic grain,
- excessive dithering,
- noisy AI texture.

---

## Characters

The base reference establishes a compact RPG character proportion.

Default character language:
- chibi / compact heroic proportions,
- large readable face,
- chunky clothing,
- strong boots and gloves,
- exaggerated class equipment.

Classes can vary, but should belong to the same visual universe.

### Face

Keep facial features minimal and readable:
- dark hair/eye pixels,
- small skin-color clusters,
- restrained highlights.

Do not render realistic facial anatomy.

### Clothing

Use large color blocks first, then pixel shading.

Cloaks, tunics and armor should have:
- strong silhouette,
- 2–4 major shading regions,
- small material-specific highlights.

---

## Environment & Props

The reference establishes a fantasy campsite / adventure-world vocabulary:

- ancient trees,
- conifers,
- tents,
- signposts,
- crates,
- barrels,
- campfires,
- rocks,
- chests,
- lanterns,
- fantasy vegetation,
- magical crystals.

Props should feel handcrafted and slightly exaggerated.

Natural objects should combine:
- dark trunks / rock masses,
- muted greens,
- controlled warm highlights,
- small accent pixels.

---

## Materials

### Metal
Use:
- deep blue/slate shadow,
- blue/steel midtones,
- pale mint or dusty blue highlights,
- tiny sharp highlight clusters.

### Wood
Use:
- dark wine/brown-adjacent tones,
- warm red,
- gold accents,
- deep outlines.

### Cloth
Use larger uninterrupted color masses with sparse folds.

### Magic / crystals
Use:
- purple, aqua, mint and pale mint,
- strong contrast,
- small bright focal highlights,
- minimal glow simulation using adjacent palette steps rather than blur.

### Fire
Use:
- warm red → gold → pale gold,
- dark red outer flame,
- compact bright core.

---

## Backgrounds

When an asset is intended for extraction, use a **flat white background**:

`#ffffff`

No shadow unless explicitly requested.

For full scene illustrations, use the master dark palette and preserve strong atmospheric depth.

---

## Composition

For isolated asset sheets:
- generous spacing,
- no overlapping objects,
- centered objects,
- consistent scale within each category,
- clean white background.

For game scenes:
- foreground / midground / background separation,
- strong focal point,
- dark atmospheric framing,
- controlled accent colors.

---

## Effects

Use pixel-art representations of:
- sparks,
- embers,
- magic particles,
- rain,
- stars,
- leaves,
- dust.

Effects must be discrete pixel clusters.

Never use:
- Gaussian blur,
- bloom,
- soft airbrush,
- lens effects,
- photographic particles.

---

## Asset Consistency

When generating a new asset, preserve:

1. The same palette.
2. The same outline language.
3. The same pixel density.
4. The same character proportions where applicable.
5. The same level of shading.
6. The same dark-fantasy color balance.
7. The same clean extraction-friendly presentation.

A new asset should look like it came from the **same game asset pack**, not merely the same genre.

---

## Prompt Suffix

For image-generation prompts, this compact suffix can be appended when useful:

> Match the supplied Pixel RPG Visual Design System and base reference. Crisp hand-authored pixel art, hard pixel edges, chunky readable outlines, deliberate pixel clusters, limited 25-color palette, discrete stepped shading, dark fantasy 16-bit RPG aesthetic, strong silhouette, clean flat white background, no anti-aliasing, no gradients, no blur, no painterly texture, no photographic detail, no muddy AI artifacts.

---

## Reference Priority

When references conflict, prioritize in this order:

1. **Current asset request**
2. **Base reference image**
3. **This design system**
4. Generic pixel-art conventions

The base reference is the visual authority for proportions, density, rendering and overall finish.
