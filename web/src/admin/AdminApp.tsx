import { useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS,
  HAIR_Z,
  SLOT_Z,
  type MaskRect,
  type Placement,
  type PlacementFile,
} from "../../../src/character/layers.js";
import type { BodyType, GearSlot } from "../../../src/engine/types.js";
import { usePlacements } from "../hooks/usePlacements.js";
import { CharacterSprite } from "../components/CharacterSprite.js";
import { SLOT_FOLDER, bumpSpriteVersion, spriteUrl } from "../sprites.js";
import { SPRITE_INDEX } from "./spriteIndex.js";
import { useEraser } from "./useEraser.js";
import { DungeonTuner } from "./DungeonTuner.js";
import { DungeonRenamer } from "./DungeonRenamer.js";
import { RaidTuner } from "./RaidTuner.js";
import { GearTuner } from "./GearTuner.js";
import { GearInspector } from "./GearInspector.js";
import { useTuningContent } from "./useTuningContent.js";
import "./admin.css";
import { getAdminKey, setAdminKey } from "../adminKey.js";

const BODY_TYPES: BodyType[] = ["male", "female"];
const TONES = ["fair", "light", "tan", "brown", "dark"];

/** Slots this tool can position, plus hair, which is appearance rather than gear. */
const EDITABLE = ["hair", ...Object.keys(SLOT_FOLDER)] as const;
type Editable = (typeof EDITABLE)[number];

const FOLDER: Record<string, string> = { hair: "hair", ...(SLOT_FOLDER as Record<string, string>) };

/**
 * The sprite placement tool.
 *
 * The sliced art is a pile of isolated objects — a helmet on a transparent
 * field says nothing about where a head is — so somebody has to look at each
 * one on a body and say "there". This is that screen, and its output is
 * content/placements.json, which every other surface reads.
 *
 * It is direct manipulation on purpose: drag the item, nudge with arrows,
 * scale with a slider, against the real character at 1:1. Typing coordinates
 * into a form would be the same data and a far worse way to find it.
 *
 * NO AUTH — see the POST /placements handler in src/server/index.ts. This
 * writes a content file from an unauthenticated request and is for local use
 * only until auth lands.
 */
export function AdminApp(): JSX.Element {
  const { placements, save } = usePlacements();
  const [slot, setSlot] = useState<Editable>("head");
  const [spriteId, setSpriteId] = useState<string>(SPRITE_INDEX.head?.[0] ?? "");
  const [bodyType, setBodyType] = useState<BodyType>("male");
  const [skinTone, setSkinTone] = useState("fair");
  const [status, setStatus] = useState("");
  // Mirrored into React state so the field is controlled; sessionStorage is
  // the source of truth that adminFetch reads.
  const [adminKey, setAdminKeyState] = useState(getAdminKey);
  const [dirty, setDirty] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [bust, setBust] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  /**
   * A copied placement, for reusing one sprite's position on another.
   *
   * Most items in a slot sit in nearly the same place — twenty-four helmets all
   * belong on the same head — so placing each from scratch is repeating the
   * same work with small variations. Copy one good placement, paste it onto the
   * rest, then nudge.
   *
   * Deliberately NOT the system clipboard: this carries a structured placement,
   * and going through text would mean serialising and reparsing it for no gain.
   */
  const [clipboard, setClipboard] = useState<{ from: string; placement: Placement } | null>(null);
  /**
   * Hair shown alongside whatever is being placed, and whether to show it.
   *
   * Off by default because a bare head is the easier target for most items, but
   * essential for the two cases where hair is the thing you are placing
   * AGAINST: a face mask that has to sit over or under a fringe, and a head
   * sprite whose draw order decides whether a hood covers hair or tucks behind
   * it. A bald preview simply cannot answer either.
   */
  const [showHair, setShowHair] = useState(false);
  const [previewHair, setPreviewHair] = useState<string>(SPRITE_INDEX.hair?.[0] ?? "");
  /**
   * A full outfit to preview the edited item inside.
   *
   * Placing against a bare body is right for finding an item's own coordinates
   * and wrong for everything that follows from them — a pauldron that sits
   * perfectly on skin can still collide with every chest piece in the set. This
   * is the dressed character the item will actually be worn on.
   */
  const [showKit, setShowKit] = useState(false);
  const [kit, setKit] = useState<Partial<Record<GearSlot, string>>>({});
  const [tab, setTab] = useState<"placement" | "gear" | "dungeons" | "raids" | "names">("placement");
  const tuning = useTuningContent();
  /**
   * Which layer the mask tool is carving, or null when it is off.
   *
   * Two targets rather than one because they answer different questions: a body
   * mask makes a boot BECOME the foot, a hair mask lets a helm cover the skull
   * while the length still hangs out. They are stored on the same item and
   * drawn with the same drag, so only the destination differs.
   */
  const [maskTarget, setMaskTarget] = useState<"body" | "hair" | null>(null);
  const masking = maskTarget !== null;
  const maskKey = maskTarget === "hair" ? "hairMask" : "bodyMask";
  // The in-progress mask rectangle is held in a REF, mirrored into state only
  // for rendering. Reading it from state made the handlers depend on a render
  // happening between pointerdown and pointermove: press and drag inside one
  // frame and the move handler still saw null, so the rectangle was silently
  // dropped. A ref is always current.
  const draftRef = useRef<MaskRect | null>(null);
  const [draft, setDraft] = useState<MaskRect | null>(null);
  const setDraftBoth = (r: MaskRect | null) => {
    draftRef.current = r;
    setDraft(r);
  };
  const eraser = useEraser();

  const folder = FOLDER[slot] ?? "head";
  // What this sprite's slot would draw at without an override.
  const defaultZ = slot === "hair" ? HAIR_Z : (SLOT_Z[slot as GearSlot] ?? 0);
  const sprites = SPRITE_INDEX[folder] ?? [];

  // Keep the selected sprite valid when the slot changes.
  useEffect(() => {
    if (!sprites.includes(spriteId)) setSpriteId(sprites[0] ?? "");
  }, [slot, sprites, spriteId]);

  /**
   * Follow the sprite's own sex when it has one.
   *
   * Chest and leg art is cut per body and named for it ("male-t4"), so picking
   * the female cut while the preview body stayed male meant placing female art
   * on a male torso — coordinates tuned against the wrong shape, and no
   * indication anything was off.
   */
  useEffect(() => {
    const sexed = spriteId.startsWith("male-") ? "male" : spriteId.startsWith("female-") ? "female" : null;
    if (sexed && sexed !== bodyType) setBodyType(sexed);
  }, [spriteId, bodyType]);

  /**
   * Sprites in `folder` that suit `bodyType`.
   *
   * Chest and leg art is cut per body and named for it ("male-t4"), so an
   * unfiltered pick can dress a female body in a male torso. Everything else is
   * one drawing worn by anyone and passes straight through.
   */
  const wearable = (folder: string, body: BodyType): string[] =>
    (SPRITE_INDEX[folder] ?? []).filter(
      (id) => !/^(male|female)-/.test(id) || id.startsWith(`${body}-`),
    );

  const randomiseKit = () => {
    const next: Partial<Record<GearSlot, string>> = {};
    for (const [gearSlot, folderName] of Object.entries(SLOT_FOLDER) as [GearSlot, string][]) {
      const pool = wearable(folderName, bodyType);
      if (pool.length) next[gearSlot] = pool[Math.floor(Math.random() * pool.length)]!;
    }
    setKit(next);
    const hairPool = SPRITE_INDEX.hair ?? [];
    if (hairPool.length) setPreviewHair(hairPool[Math.floor(Math.random() * hairPool.length)]!);
    setShowKit(true);
  };

  /**
   * Drop kit pieces that belong to the other body.
   *
   * Switching body with a full kit on otherwise leaves a male cuirass on a
   * female torso — placed by coordinates tuned for a shape it is no longer on,
   * which is exactly the mistake the sexed-sprite rule above exists to prevent.
   */
  useEffect(() => {
    setKit((k) => {
      const kept = Object.fromEntries(
        Object.entries(k).filter(([, id]) => !/^(male|female)-/.test(id) || id.startsWith(`${bodyType}-`)),
      ) as Partial<Record<GearSlot, string>>;
      return Object.keys(kept).length === Object.keys(k).length ? k : kept;
    });
  }, [bodyType]);

  const current: Placement = useMemo(
    () => placements?.[slot]?.[spriteId]?.[bodyType] ?? { x: 0, y: 0, scale: 1, rotation: 0 },
    [placements, slot, spriteId, bodyType],
  );

  const update = (next: Partial<Placement>) => {
    if (!spriteId) return;
    const merged: PlacementFile = JSON.parse(JSON.stringify(placements ?? {}));
    const bucket = (merged[slot] ??= {});
    const entry = (bucket[spriteId] ??= {});
    entry[bodyType] = { ...current, ...next };
    setDirty(true);
    void save(merged);
  };

  // --- dragging ------------------------------------------------------------
  // The drag is tracked against the canvas element and divided by the display
  // scale, so a pixel of mouse movement is a pixel of CANVAS movement whatever
  // size the preview is being shown at.
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  /**
   * Take pointer capture, tolerating failure.
   *
   * setPointerCapture throws NotFoundError for an id the element does not own,
   * and an unguarded throw here abandons the rest of the handler — losing the
   * drag it was starting. Capture is an enhancement (it keeps the drag alive
   * when the cursor leaves the stage), never a prerequisite.
   */
  const capture = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* drag still works without it */
    }
  };

  /** Pointer position in CANVAS coordinates. */
  const toCanvas = (e: React.PointerEvent) => {
    const rect = stageRef.current!.getBoundingClientRect();
    const k = CANVAS / rect.width;
    return { x: Math.round((e.clientX - rect.left) * k), y: Math.round((e.clientY - rect.top) * k) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!spriteId) return;
    if (eraser.erasing) return;
    if (masking) {
      const p = toCanvas(e);
      capture(e);
      setDraftBoth({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    capture(e);
    drag.current = { x: e.clientX, y: e.clientY, ox: current.x, oy: current.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (masking) {
      const r = draftRef.current;
      if (!r || e.buttons !== 1) return;
      const p = toCanvas(e);
      setDraftBoth({ ...r, w: p.x - r.x, h: p.y - r.y });
      return;
    }
    const d = drag.current;
    if (!d || !stageRef.current) return;
    const shown = stageRef.current.getBoundingClientRect().width;
    const k = CANVAS / shown;
    update({
      x: Math.round(d.ox + (e.clientX - d.x) * k),
      y: Math.round(d.oy + (e.clientY - d.y) * k),
    });
  };

  const endDrag = () => {
    drag.current = null;
    const pending = draftRef.current;
    if (masking && pending) {
      // Normalise so a rectangle dragged up-and-left is still a rectangle.
      const rect: MaskRect = {
        x: Math.min(pending.x, pending.x + pending.w),
        y: Math.min(pending.y, pending.y + pending.h),
        w: Math.abs(pending.w),
        h: Math.abs(pending.h),
      };
      setDraftBoth(null);
      // Ignore a click that was not really a drag.
      if (rect.w > 3 && rect.h > 3) {
        update({ [maskKey]: [...(current[maskKey] ?? []), rect] });
      }
    }
  };

  // Arrow keys nudge by one canvas pixel, shift by ten — the last pixel of
  // alignment is much easier to find with a key than with a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const m = moves[e.key];
      if (!m || !spriteId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
      e.preventDefault();
      update({ x: current.x + m[0], y: current.y + m[1] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!dirty) return;
    setStatus("Saved.");
    const t = setTimeout(() => setStatus(""), 1200);
    return () => clearTimeout(t);
  }, [placements, dirty]);

  /**
   * What the stage draws.
   *
   * A bare body plus the one sprite being edited by default — a helmet is
   * easier to place against a bare head than against a full kit — with the kit
   * layered underneath when the dress-up preview is on. The edited sprite is
   * spread LAST either way, so it overrides whatever the kit chose for its slot
   * and stays the thing the drag handles are moving.
   *
   * Erasing clears everything: strokes are made against the sprite alone.
   */
  const layers: Partial<Record<GearSlot, string>> = eraser.erasing
    ? {}
    : {
        ...(showKit ? kit : {}),
        ...(slot === "hair" ? {} : { [slot as GearSlot]: spriteId }),
      };

  // While editing hair, the picked sprite IS the hair — the toggle only governs
  // hair shown as a backdrop to something else. An item that carries an extra
  // hair mask overrides the toggle: its cut is only meaningful against hair, so
  // hiding it would leave you dragging rectangles at nothing.
  const carvesHair = (current.hairMask?.length ?? 0) > 0;
  const hairOnStage = eraser.erasing
    ? null
    : slot === "hair"
      ? spriteId
      : showHair || carvesHair
        ? previewHair
        : null;

  const startErasing = async () => {
    await eraser.begin(spriteUrl(folder, spriteId));
    eraser.setErasing(true);
  };

  const finishErasing = async (keep: boolean) => {
    if (keep) {
      const ok = await eraser.commit(folder, spriteId);
      setStatus(ok ? "Sprite saved." : "Could not save sprite.");
      // Force every <img> of this sprite to refetch — the file changed under
      // a URL the browser has already cached.
      if (ok) setBust(bumpSpriteVersion());
    }
    eraser.discard();
    eraser.setErasing(false);
  };

  /**
   * Convert a pointer position on the stage into a pixel of the SPRITE.
   *
   * The stage is canvas space; the sprite sits inside it at a placement offset,
   * an angle and a scale, centred on (x, y). The layer is drawn with
   *
   *     translate(-50%, -50%) rotate(θ) scale(s)
   *
   * which CSS applies right-to-left, so a point p in the sprite's own pixels
   * lands at  centre + R(θ)·s·(p − natural/2).  Undoing exactly that chain — and
   * ALL of it — is what makes the brush land where the cursor is.
   *
   * The rotation term used to be missing, and that is the whole of "hard to
   * erase when an item has been rotated": the preview was drawn turned while the
   * cursor was unprojected as though it were upright, so every stroke landed at
   * the angle's mirror image and the only way to hit anything was to guess.
   * Scale and offset were already handled, which is why unrotated items were
   * fine and hid the bug.
   */
  const toSpritePixel = (e: React.PointerEvent, natural: { w: number; h: number }) => {
    const rect = stageRef.current!.getBoundingClientRect();
    const k = CANVAS / rect.width;
    const dx = (e.clientX - rect.left) * k - current.x;
    const dy = (e.clientY - rect.top) * k - current.y;
    const s = current.scale || 1;
    // R(-θ), so the cursor is measured in the sprite's own frame rather than
    // the stage's.
    const t = ((current.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    return {
      sx: (dx * cos + dy * sin) / s + natural.w / 2,
      sy: (-dx * sin + dy * cos) / s + natural.h / 2,
    };
  };

  return (
    <div className="admin">
      <header className="admin-bar">
        <h1>Corrupted Admin</h1>
        <nav className="admin-tabs">
          {(["placement", "gear", "dungeons", "raids", "names"] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? "is-active" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        {/* The operator key. Every write on this screen carries it now - see
            adminKey.ts - so this is where it gets entered, once per tab. */}
        <label className="admin-key">
          <span>Admin key</span>
          <input
            type="password"
            value={adminKey}
            placeholder={adminKey ? "" : "required to save"}
            onChange={(e) => {
              setAdminKeyState(e.target.value);
              setAdminKey(e.target.value);
            }}
          />
        </label>
        <span className="admin-status">{status}</span>
      </header>

      {tab === "gear" && (
        <GearTuner gear={tuning.gear} onSaved={tuning.reload} setStatus={setStatus} />
      )}

      {/* The fight: who stands where, at which band, and how hard they hit.
          This tab was called "Encounters" and edited a separate archetype file;
          a dungeon owns its own bodies now, so there is one editor and it is
          named for the thing it edits. */}
      {tab === "dungeons" && (
        <DungeonTuner dungeons={tuning.dungeons} onSaved={tuning.reload} setStatus={setStatus} />
      )}

      {tab === "raids" && (
        <RaidTuner raids={tuning.raids} onSaved={tuning.reload} setStatus={setStatus} />
      )}

      {/* Just the naming. Separate from the fight editor because renaming is
          a file operation with a blast radius, and everything else here is not. */}
      {tab === "names" && (
        <DungeonRenamer dungeons={tuning.dungeons} onSaved={tuning.reload} />
      )}

      {tab === "placement" && (
      <div className="admin-body">
        <aside className="admin-panel">
          <label>
            Slot
            <select value={slot} onChange={(e) => setSlot(e.target.value as Editable)}>
              {EDITABLE.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            Body
            <select value={bodyType} onChange={(e) => setBodyType(e.target.value as BodyType)}>
              {BODY_TYPES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>

          <label>
            Skin
            <select value={skinTone} onChange={(e) => setSkinTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label>
            Rotation {Math.round(current.rotation ?? 0)}&deg;
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={current.rotation ?? 0}
              onChange={(e) => update({ rotation: Number(e.target.value) })}
            />
          </label>

          <label>
            Scale {current.scale.toFixed(2)}
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.01}
              value={current.scale}
              onChange={(e) => update({ scale: Number(e.target.value) })}
            />
          </label>

          {/* Draw order. Shown as the slot's default until overridden, so it is
              obvious whether this sprite is following the rules or breaking
              them on purpose. */}
          <label>
            draw order {current.z ?? defaultZ}
            {current.z === undefined ? <span className="tuner-pct"> (slot default)</span> : null}
            <input
              type="range"
              min={-20}
              max={130}
              step={5}
              value={current.z ?? defaultZ}
              onChange={(e) => update({ z: Number(e.target.value) })}
            />
          </label>
          {current.z !== undefined && (
            <button type="button" className="admin-revert" onClick={() => update({ z: undefined })}>
              use slot default ({defaultZ})
            </button>
          )}

          <div className="admin-copy">
            <button
              type="button"
              onClick={() => setClipboard({ from: `${slot}/${spriteId}`, placement: current })}
              disabled={!spriteId}
            >
              Copy position
            </button>
            <button
              type="button"
              onClick={() => clipboard && update(clipboard.placement)}
              disabled={!clipboard || !spriteId}
            >
              Paste
            </button>
          </div>
          {clipboard && (
            <p className="admin-hint">
              Holding {clipboard.from} - x {clipboard.placement.x}, y {clipboard.placement.y},{" "}
              {clipboard.placement.scale.toFixed(2)}x
              {clipboard.placement.rotation ? `, ${Math.round(clipboard.placement.rotation)}°` : ""}
            </p>
          )}

          <div className="admin-coords">
            x {current.x} &middot; y {current.y}
            <button type="button" className="admin-reset" onClick={() => update({ rotation: 0 })}>
              reset angle
            </button>
          </div>

          <label className="admin-check">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            Guides
          </label>

          {/* Dress-up. Two independent switches rather than one "preview" mode:
              hair is what a face mask and a head sprite are judged against, and
              is wanted far more often than a whole outfit. */}
          <h3 className="sub-heading">Preview</h3>

          <label className="admin-check">
            <input type="checkbox" checked={showHair} onChange={(e) => setShowHair(e.target.checked)} />
            Show hair
          </label>

          {showHair && slot !== "hair" && (
            <>
              <label>
                Hair
                <select value={previewHair} onChange={(e) => setPreviewHair(e.target.value)}>
                  {(SPRITE_INDEX.hair ?? []).map((id: string) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              {slot === "head" && (
                <>
                  {/* Which of the two kinds of head item this is. Derived from
                      the art either way - this only says WHICH derivation. */}
                  <div className="admin-mode">
                    {(
                      [
                        ["hide", "No hair"],
                        ["skull", "Below the rim"],
                        ["outline", "Around it"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={(current.hairCoverage ?? "hide") === mode ? "is-active" : ""}
                        onClick={() => update({ hairCoverage: mode })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="admin-hint">
                    {(current.hairCoverage ?? "hide") === "hide"
                      ? "Hair is removed entirely. The safe answer for a closed helm - a hairstyle that survives one tends to read as a blob stuck to the head."
                      : (current.hairCoverage ?? "hide") === "skull"
                        ? "Only hair falling below this sprite's box shows - a hood or open helm with a ponytail out the back. Check it against a long style AND a short one."
                        : "Hair is hidden only where this sprite is actually drawn, so it surrounds it. For a circlet, headband or perched hat."}
                  </p>
                </>
              )}
              {slot === "head" && (
                <p className="admin-hint">
                  Either way the cut comes from the art, so there is nothing to place. Draw order
                  still decides whether this sits over hair ({">"} {HAIR_Z}) or tucks behind.
                </p>
              )}
            </>
          )}

          <label className="admin-check">
            <input type="checkbox" checked={showKit} onChange={(e) => setShowKit(e.target.checked)} />
            Wear a full kit
          </label>

          {showKit && (
            <>
              <div className="admin-copy">
                <button type="button" onClick={randomiseKit}>
                  Randomise
                </button>
                <button type="button" className="admin-revert" onClick={() => setKit({})}>
                  Strip
                </button>
              </div>
              {(Object.entries(SLOT_FOLDER) as [GearSlot, string][]).map(([gearSlot, folderName]) => (
                <label key={gearSlot}>
                  {gearSlot}
                  {gearSlot === slot && <span className="tuner-pct"> (editing)</span>}
                  <select
                    // The edited slot shows what the stage is ACTUALLY drawing
                    // — the sprite from the picker, which overrides the kit —
                    // rather than the kit's stale choice for that slot.
                    value={(gearSlot === slot ? spriteId : kit[gearSlot]) ?? ""}
                    disabled={gearSlot === slot}
                    onChange={(e) =>
                      setKit({ ...kit, [gearSlot]: e.target.value || undefined })
                    }
                  >
                    <option value="">none</option>
                    {wearable(folderName, bodyType).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p className="admin-hint">
                The slot you are editing is driven by the picker below, not by this list.
              </p>
            </>
          )}

          <p className="admin-hint">
            Drag on the character to move. Arrow keys nudge 1px, shift 10px. Saves as you go.
          </p>

          <div className="admin-mode">
            <button
              type="button"
              className={eraser.erasing ? "" : "is-active"}
              onClick={() => finishErasing(false)}
            >
              Place
            </button>
            <button
              type="button"
              className={eraser.erasing ? "is-active" : ""}
              onClick={() => {
                setMaskTarget(null);
                void startErasing();
              }}
              disabled={!spriteId}
            >
              Erase
            </button>
            <button
              type="button"
              className={maskTarget === "body" ? "is-active" : ""}
              onClick={() => {
                void finishErasing(false);
                setMaskTarget((m) => (m === "body" ? null : "body"));
              }}
              disabled={!spriteId}
            >
              Mask body
            </button>
            <button
              type="button"
              className={maskTarget === "hair" ? "is-active" : ""}
              onClick={() => {
                void finishErasing(false);
                setMaskTarget((m) => {
                  const next = m === "hair" ? null : "hair";
                  // Carving something invisible is not a thing anyone can aim
                  // at, so entering this mode turns hair on.
                  if (next === "hair") setShowHair(true);
                  return next;
                });
              }}
              disabled={!spriteId || slot === "hair"}
            >
              Mask hair
            </button>
          </div>

          {masking && (
            <>
              <p className="admin-hint">
                {maskTarget === "hair" ? (
                  <>
                    Extra removal only - the helm already cuts hair to its own outline. Use
                    this when a tight helm should also flatten a big hairstyle rather than let
                    it billow round the rim. One rectangle has to serve all forty styles, so
                    keep it small: a box tuned against a crop erases a ponytail.
                  </>
                ) : (
                  <>
                    Drag a rectangle over the body to hide it while this item is worn -
                    so a boot becomes the foot. Stored per item and per body.
                  </>
                )}
              </p>
              {maskTarget === "hair" && slot === "head" && (
                <p className="admin-hint">
                  One region here is also this helm saying it handles hair itself: in game it
                  will stop hiding hair outright and carve it instead.
                </p>
              )}
              <div className="admin-mask-list">
                {(current[maskKey] ?? []).map((m, i) => (
                  <button
                    key={`${m.x}-${m.y}-${i}`}
                    type="button"
                    onClick={() =>
                      update({ [maskKey]: (current[maskKey] ?? []).filter((_, j) => j !== i) })
                    }
                    title="Remove this region"
                  >
                    {m.w}&times;{m.h} at {m.x},{m.y} &times;
                  </button>
                ))}
                {(current[maskKey] ?? []).length === 0 && (
                  <span className="admin-hint">No regions hidden.</span>
                )}
              </div>
            </>
          )}

          {eraser.erasing && (
            <>
              <label>
                Brush {eraser.brush}px
                <input
                  type="range"
                  min={2}
                  max={40}
                  value={eraser.brush}
                  onChange={(e) => eraser.setBrush(Number(e.target.value))}
                />
              </label>
              <button type="button" className="admin-danger" onClick={() => finishErasing(true)}>
                Save {eraser.strokes} erase{eraser.strokes === 1 ? "" : "s"} to the PNG
              </button>
              <button
                type="button"
                className="admin-revert"
                onClick={async () => {
                  const ok = await eraser.revert(folder, spriteId);
                  setStatus(ok ? "Reverted to original." : "No backup for this sprite.");
                  if (ok) {
                    setBust(bumpSpriteVersion());
                    await eraser.begin(spriteUrl(folder, spriteId));
                  }
                }}
              >
                Revert this sprite
              </button>
              <p className="admin-hint">
                Overwrites art/sprites. Undo with <code>npm run slice</code> - the source
                sheets are never touched.
              </p>
            </>
          )}

          <div className="admin-picker">
            {sprites.map((id: string) => (
              <button
                key={id}
                type="button"
                className={id === spriteId ? "is-active" : ""}
                onClick={() => setSpriteId(id)}
                title={id}
              >
                <img src={spriteUrl(folder, id)} alt={id} />
              </button>
            ))}
          </div>
        </aside>

        <main className="admin-stage-wrap">
          <div
            className={`admin-stage ${showGrid ? "has-guides" : ""}`}
            ref={stageRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <CharacterSprite
              key={bust}
              bodyType={bodyType}
              skinTone={skinTone}
              hair={hairOnStage}
              layers={layers}
              placements={placements}
              size={CANVAS}
            />

            {/* The working canvas stands in for the sprite while erasing, at
                the same placement, so strokes are visible as they are made
                rather than only after a destructive save. */}
            {eraser.erasing && eraser.surface && (
              <div
                className="admin-erase-preview"
                style={{
                  left: `${current.x}px`,
                  top: `${current.y}px`,
                  transform: `translate(-50%, -50%) rotate(${current.rotation ?? 0}deg) scale(${current.scale})`,
                }}
                ref={(el) => {
                  if (el && eraser.surface && el.firstChild !== eraser.surface) {
                    el.replaceChildren(eraser.surface);
                  }
                }}
              />
            )}

            {/* The removed area, painted solid. Same placement transform as the
                working canvas so the two line up exactly. */}
            {eraser.erasing && eraser.removedSurface && (
              <div
                className="admin-erase-mask"
                style={{
                  left: `${current.x}px`,
                  top: `${current.y}px`,
                  transform: `translate(-50%, -50%) rotate(${current.rotation ?? 0}deg) scale(${current.scale})`,
                }}
                ref={(el) => {
                  if (el && eraser.removedSurface && el.firstChild !== eraser.removedSurface) {
                    el.replaceChildren(eraser.removedSurface);
                  }
                }}
              />
            )}

            {eraser.erasing && (
              <div
                className="admin-erase-layer"
                onPointerDown={(e) => {
                  capture(e);
                  const p = toSpritePixel(e, eraser.natural);
                  eraser.erase(p.sx, p.sy);
                }}
                onPointerMove={(e) => {
                  const rect = stageRef.current!.getBoundingClientRect();
                  setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                  if (e.buttons !== 1) return;
                  const p = toSpritePixel(e, eraser.natural);
                  eraser.erase(p.sx, p.sy);
                }}
                onPointerLeave={() => setCursor(null)}
              />
            )}

            {/* Brush cursor. Sized in STAGE px - brush is in sprite px, so it
                is multiplied by the placement scale and the stage zoom, or the
                ring would not match the pixels the stroke actually removes. */}
            {eraser.erasing && cursor && (
              <span
                className="admin-brush"
                style={{
                  left: `${cursor.x}px`,
                  top: `${cursor.y}px`,
                  width: `${eraser.brush * 2 * (current.scale || 1) * (stageRef.current ? stageRef.current.getBoundingClientRect().width / CANVAS : 1)}px`,
                  height: `${eraser.brush * 2 * (current.scale || 1) * (stageRef.current ? stageRef.current.getBoundingClientRect().width / CANVAS : 1)}px`,
                }}
                aria-hidden="true"
              />
            )}
            {/* Mask regions are drawn over the stage so they can be seen and
                removed; the character below already renders with them applied. */}
            {masking &&
              [...(current[maskKey] ?? []), ...(draft ? [draft] : [])].map((m, i) => (
                <span
                  key={i}
                  className={`admin-mask-rect ${maskTarget === "hair" ? "is-hair" : ""}`}
                  style={{
                    left: `${Math.min(m.x, m.x + m.w)}px`,
                    top: `${Math.min(m.y, m.y + m.h)}px`,
                    width: `${Math.abs(m.w)}px`,
                    height: `${Math.abs(m.h)}px`,
                  }}
                  aria-hidden="true"
                />
              ))}

          </div>
          <p className="admin-caption">
            {slot} / {spriteId} / {bodyType} - 1:1 at {CANVAS}px
          </p>
        </main>

        {/* Gear controls for whatever sprite is selected, so placement and
            authoring happen on one screen. The admin surface is not size
            constrained the way the overlay is, and moving between two tabs to
            adjust one item was the wrong trade. */}
        <aside className="admin-gear">
          <GearInspector
            gear={tuning.gear}
            slot={slot}
            spriteId={spriteId}
            bodyType={bodyType}
            onSaved={tuning.reload}
            setStatus={setStatus}
          />
        </aside>
      </div>
      )}
    </div>
  );
}
