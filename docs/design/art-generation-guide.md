# Pixel RPG Asset Project — Art Generation Guide

## Visual Design Source of Truth

Before creating or modifying game art, read:

- `pixel-rpg-design-system.md` (same folder)
- `a_clean_white_background_reference_sheet.png`

These define the project's visual language.

> **Dangling reference, confirmed 2026-09-08.** No file named
> `a_clean_white_background_reference_sheet.png` (or the
> `..._sprite.png` variant `pixel-rpg-design-system.md` also names) exists
> anywhere in this repo — checked the root, `docs/`, and `art/` (including
> `art/reference/`). The closest candidates are `art/reference/palette
> Reference.jpg` and a duplicate that had escaped to the repo root
> (`pallete Reference.png`, now in `TO BE DELETED/` pending human review) —
> both are palette/example boards, not an isolated-sprite white-background
> reference sheet, so neither is a confident match. Whoever wrote this brief
> had a reference image that never made it into version control. Ask for it
> before generating art against this spec.

## Required Art Rules

All generated RPG assets should:

- Use the 25-color master palette from `pixel-rpg-design-system.md`.
- Match the supplied base reference's pixel density and finish.
- Use hard pixel edges and deliberate pixel clusters.
- Use chunky, readable silhouettes and outlines.
- Use discrete stepped shading rather than gradients.
- Avoid anti-aliasing, blur, bloom, painterly rendering, photographic texture and random AI noise.
- Prefer dark palette colors for outlines rather than pure black.
- Keep isolated assets on a flat white `#ffffff` background unless the task explicitly requests a scene.
- Ensure the asset remains recognizable at game/UI scale.
- Make new assets feel like they belong to the same coherent RPG asset pack.

## Generation Prompt Pattern

When writing an image-generation request, include the requested asset first, then reference:

> Match the supplied Pixel RPG Visual Design System and base reference. Crisp hand-authored pixel art, hard pixel edges, chunky readable outlines, deliberate pixel clusters, limited 25-color palette, discrete stepped shading, dark fantasy 16-bit RPG aesthetic, strong silhouette, clean flat white background, no anti-aliasing, no gradients, no blur, no painterly texture, no photographic detail, no muddy AI artifacts.

## Implementation Guidance

When implementing these assets in a game UI:

- Preserve nearest-neighbor pixel scaling.
- Do not introduce smoothing during texture scaling.
- Keep source sprites at native resolution where practical.
- Use integer scaling factors when possible.
- Preserve transparent edges without interpolation.
- Treat palette colors as design tokens rather than arbitrary per-asset colors.

## Consistency Check

Before accepting an asset, verify:

1. Is the silhouette immediately readable?
2. Does it use the master palette?
3. Are edges crisp?
4. Are shadows discrete pixel clusters?
5. Does the object match the reference's visual density?
6. Is the background clean and extractable?
7. Does it look like it belongs to the same game?
