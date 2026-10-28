import { useEffect, useRef, useState } from "react";
import type { BodyType, GearDefinition } from "../../../src/engine/types.js";
import {
  clampFraming,
  ICON_ZOOM_MAX,
  ICON_ZOOM_MIN,
  type IconFraming,
  type PlacementFile,
} from "../../../src/character/layers.js";
import { ItemIcon } from "../loadout/ItemIcon.js";
import { publicUrl } from "../localGameLink.js";
import { spriteForGear } from "../sprites.js";

const ICON_CELL_ART = publicUrl("/art/ui/cell.png");
const NONE: IconFraming = { zoom: 1, x: 0, y: 0 };
const BIG = 200;
/** The sizes the loadout actually draws thumbnails at. */
const REAL_SIZES = [34, 38, 40];

export interface IconFramerProps {
  def: GearDefinition;
  bodyType: BodyType;
  placements: PlacementFile;
  /** Writes the whole placements file; resolves to null or the reason it failed. */
  save: (next: PlacementFile) => Promise<string | null>;
  setStatus: (message: string) => void;
}

/**
 * Frame one item's loadout thumbnail: zoom slider, drag to pan, previews at the
 * real sizes. The result is `icon` beside the sprite's body placements in
 * placements.json, so it reaches the hosted loadout without a deploy.
 *
 * Drag moves the art with the pointer (a pixel of drag is a pixel of art), which
 * is the direct-manipulation rule the placement screen follows too.
 */
export function IconFramer({ def, bodyType, placements, save, setStatus }: IconFramerProps): JSX.Element | null {
  const sprite = spriteForGear(def, bodyType);
  const stored = sprite ? placements?.[def.slot]?.[sprite]?.icon : undefined;
  const [framing, setFraming] = useState<IconFraming>(stored ? clampFraming(stored) : NONE);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // A different item (or a reload of the file) restarts from what is saved.
  const storedKey = JSON.stringify(stored ?? null);
  useEffect(() => {
    setFraming(stored ? clampFraming(stored) : NONE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, sprite, storedKey]);

  if (!sprite) return null;

  const isNone = framing.zoom === 1 && framing.x === 0 && framing.y === 0;
  const dirty = JSON.stringify(framing) !== JSON.stringify(stored ? clampFraming(stored) : NONE);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: framing.x, y: framing.y };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // The art is drawn at BIG px, so a fraction of the box is a fraction of BIG.
    setFraming((f) => clampFraming({ ...f, x: d.x + (e.clientX - d.px) / BIG, y: d.y + (e.clientY - d.py) / BIG }));
  };
  const onUp = () => {
    drag.current = null;
  };

  const commit = async () => {
    const next: PlacementFile = JSON.parse(JSON.stringify(placements ?? {}));
    const bucket = (next[def.slot] ??= {});
    const entry = (bucket[sprite] ??= {});
    // Default framing is removed rather than stored, so unframed items stay
    // exactly as they were in the file.
    if (isNone) delete entry.icon;
    else entry.icon = { zoom: round(framing.zoom), x: round(framing.x), y: round(framing.y) };
    const failure = await save(next);
    setStatus(failure ? `NOT SAVED. ${failure}` : `Saved thumbnail framing for ${def.name}.`);
  };

  return (
    <div className="icon-framer">
      <h3 className="sub-heading">Thumbnail framing</h3>
      <p className="admin-hint">
        Shows the original art, not the erased copy. Drag to pan, slide to zoom. Saved with placements.
      </p>

      <div
        className="icon-framer-stage"
        style={{ width: BIG, height: BIG, touchAction: "none", cursor: "grab" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <ItemIcon def={def} slot={def.slot} bodyType={bodyType} size={BIG} framing={framing} />
      </div>

      <label>
        zoom {framing.zoom.toFixed(2)}
        <input
          type="range"
          min={ICON_ZOOM_MIN}
          max={ICON_ZOOM_MAX}
          step={0.05}
          value={framing.zoom}
          onChange={(e) => setFraming((f) => clampFraming({ ...f, zoom: Number(e.target.value) }))}
        />
      </label>

      <div className="icon-framer-sizes">
        {REAL_SIZES.map((s) => (
          <figure key={s}>
            <div
              className="icon-framer-cell"
              style={{ width: s + 12, height: s + 12, backgroundImage: `url(${ICON_CELL_ART})` }}
            >
              <ItemIcon def={def} slot={def.slot} bodyType={bodyType} size={s} framing={framing} />
            </div>
            <figcaption>{s}px</figcaption>
          </figure>
        ))}
      </div>

      <div className="icon-framer-actions">
        <button type="button" className="admin-revert" onClick={() => setFraming(NONE)} disabled={isNone}>
          Reset
        </button>
        <button type="button" className={dirty ? "admin-danger" : "admin-revert"} onClick={commit} disabled={!dirty}>
          {dirty ? "Save framing" : "No changes"}
        </button>
      </div>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

