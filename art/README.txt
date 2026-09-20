DUNGEON RAIDS — ARTIST TEMPLATE PACK
=====================================
Generated from the "Peasant Frame & Gear System" Art Bible (v0.2). This is
the artist-ready companion to that doc: guide underlays, one starting
canvas per gear slot, a real palette file, and a condensed cheat sheet.
The Art Bible itself stays the source of truth for *why* — this pack is
for the moment you actually have a pixel editor open.

WHAT'S IN HERE
--------------
cheatsheet.md            Condensed spec: canvas/outline/light rules, the
                          full z-order table, naming convention, rarity
                          colours, type, and the rejection checklist.

palette.gpl               Every ramp in the Art Bible (materials, skin
                          tones, hair, elements, rarity) as a GIMP palette.
                          Imports directly into GIMP, Krita, and Aseprite.
                          (Photoshop: Edit > Presets > Preset Manager >
                          Swatches can also load .gpl on recent versions;
                          ask if you want a native .aco instead.)

reference/
  body_stout_full.png      The peasant frame, stout build, full opacity —
  body_slim_full.png       for reference/comparison, not for tracing over.
  body_stout_guide.png     Same, at ~27% opacity — this is what's baked
  body_slim_guide.png      into every template below.

templates/
  template_<slot>.png      One 128x128 starting canvas per extensible
                          slot (13 total — every slot in the z-order table
                          except shadow/body/face/hair, which are the fixed
                          base rig, not ongoing content). Each one already
                          has the stout-body guide baked in at low opacity,
                          plus a magenta band marking that slot's exact Y
                          bounds from the cheat sheet's table, plus a cyan
                          crosshair on the grip point for mainhand/offhand
                          or the buckle centreline for waist.

HOW TO USE A TEMPLATE
----------------------
1. Open template_<slot>.png in Aseprite / Photoshop / GIMP / Krita.
2. Import palette.gpl as your working palette.
3. Add a NEW layer above it and draw your gear on that layer, using the
   magenta band as the "must stay inside" bound and the faint body as
   alignment (shoulders, waist, wrists, etc. line up against it).
4. Delete or hide the guide layer (it's the bottom layer — the magenta
   band and cyan markers are guide colours that never appear in the
   documented ramps, so they're easy to spot and never get exported by
   accident if you keep them on their own layer).
5. Flatten to just your art on transparent background and export as
   slot_name_tier.png — e.g. head_horned-helm_epic.png,
   mainhand_rusty-shortsword_common.png — per the naming rule in the
   cheat sheet.
6. Enclose the whole shape in the 1px #0B0D12 outline before exporting if
   your tool doesn't do it live.

That PNG is then a drop-in for content/gear/<slot>/ in the engine — same
canvas, same origin (0,0), same slot name the engine's GearSlot type
already expects.

WHAT THIS PACK DELIBERATELY DOESN'T COVER
-------------------------------------------
- New hair styles, expressions, or skin tones — those are the fixed
  17-layer base rig (already fully authored, procedurally in the Art
  Bible's own page), not an ongoing content pipeline. Ask if you want
  starting canvases for those too.
- A layered PSD/Aseprite (.aseprite) source file with all guides on
  locked layers already inside one project file — the per-slot PNGs here
  cover the same need (flatten guide-then-draw) without the risk of a
  hand-built binary layered file opening wrong in your specific tool.
  Say the word if you want me to take a run at a real Aseprite/PSD source
  instead, once you know which app you're standardizing on.
