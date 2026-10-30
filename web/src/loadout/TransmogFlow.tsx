import { useState } from "react";
import type { GearDefinition, GearSlot } from "../../../src/engine/types.js";
import type { PlacementFile } from "../../../src/character/layers.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import type { ContentCatalog } from "../hooks/useContentCatalog.js";
import { CharacterSprite } from "../components/CharacterSprite.js";
import { spriteForInstance, spriteForLook } from "../sprites.js";
import { ItemIcon } from "./ItemIcon.js";
import { text, format } from "../../../src/text/index.js";

export interface TransmogTarget {
  instanceId: string;
  gearId: string;
  look?: string;
  /** Priced by the engine (CharacterView), so this never re-derives the rule. */
  transmogCost: number;
}

export interface TransmogFlowProps {
  character: CharacterView;
  catalog: ContentCatalog;
  placements: PlacementFile;
  /** The item KEEPING its stats - worn or carried. */
  target: TransmogTarget;
  targetDef: GearDefinition;
  busy: boolean;
  onConfirm: (targetInstanceId: string, lookInstanceId: string) => void;
  onCancel: () => void;
}

/**
 * Bag items that could lend `targetDef` their look, mirroring what
 * `transmogGear` in the engine accepts. The engine stays the authority; this
 * only keeps the list from offering a tap that is certain to be refused.
 */
export function transmogDonors(
  character: CharacterView,
  catalog: ContentCatalog,
  target: TransmogTarget,
  targetDef: GearDefinition,
): { item: CharacterView["inventory"][number]; def: GearDefinition }[] {
  const body = character.appearance.bodyType;
  return character.inventory
    .map((item) => ({ item, def: catalog.gearById.get(item.gearId) }))
    .filter((row): row is { item: CharacterView["inventory"][number]; def: GearDefinition } => {
      const def = row.def;
      if (!def || row.item.instanceId === target.instanceId) return false;
      if (def.slot !== targetDef.slot) return false;
      // Another copy of the item itself: its drawing is what Restore gives for free.
      if (def.id === target.gearId) return false;
      if (target.look === def.id) return false;
      return !def.bodyTypes || def.bodyTypes.includes(body);
    });
}

/**
 * Transmog, as two steps in one sticky strip: pick the item whose look you
 * want, then see it ON the character with the price and the loss spelled out.
 *
 * One component for both ways in - an item in the bag and the item in a
 * socket - so the two cannot drift. The preview is the character exactly as
 * worn with the target's slot swapped (and the target put on, if it is a bag
 * item), built from `spriteForInstance` like the doll and both overlays.
 *
 * The confirm button carries the price, the way the recycle button carries
 * the payout: the number IS the warning, and on a phone the line under it may
 * be all a thumb has time to read.
 */
export function TransmogFlow({
  character,
  catalog,
  placements,
  target,
  targetDef,
  busy,
  onConfirm,
  onCancel,
}: TransmogFlowProps): JSX.Element {
  const [lookId, setLookId] = useState<string | null>(null);
  const bodyType = character.appearance.bodyType;
  const donors = transmogDonors(character, catalog, target, targetDef);
  const chosen = lookId ? donors.find((row) => row.item.instanceId === lookId) ?? null : null;
  const cost = target.transmogCost;
  const short = character.gold < cost;

  const previewLayers = (): Partial<Record<GearSlot, string>> => {
    const out: Partial<Record<GearSlot, string>> = {};
    for (const [slot, worn] of Object.entries(character.equipment)) {
      const sprite = spriteForInstance(worn ?? undefined, catalog.gearById, bodyType);
      if (worn && sprite) out[slot as GearSlot] = sprite;
    }
    if (chosen) {
      const sprite = spriteForLook(targetDef, chosen.def, bodyType);
      if (sprite) out[targetDef.slot] = sprite;
    }
    return out;
  };

  const costLine = (
    <span className={`bag-sub transmog-cost ${short ? "is-short" : ""}`}>
      {short
        ? format(text.shop.transmogShort, { cost, gold: character.gold })
        : format(text.shop.transmogCost, { cost, gold: character.gold })}
    </span>
  );

  if (!chosen) {
    return (
      <div className="inv-detail is-transmog-bar">
        <span className="inv-detail-info">
          <span className="slot-name">{format(text.shop.transmogHeading, { name: targetDef.name })}</span>
          {costLine}
          <span className="bag-sub">{donors.length === 0 ? text.shop.transmogNone : text.shop.transmogPick}</span>
          {donors.length > 0 && (
            <ul className="transmog-options">
              {donors.map(({ item, def }) => (
                <li key={item.instanceId}>
                  <button
                    type="button"
                    className={`inv-cell is-filled rarity-${def.rarity}`}
                    onClick={() => setLookId(item.instanceId)}
                    title={def.name}
                    aria-label={def.name}
                  >
                    <ItemIcon def={def} slot={def.slot} bodyType={bodyType} size={38} alt={def.name} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
        <div className="inv-detail-actions">
          <button type="button" className="ghost small" onClick={onCancel}>
            {text.loadout.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inv-detail is-transmog-bar">
      <div className="transmog-preview" aria-hidden="true">
        <CharacterSprite
          bodyType={bodyType}
          skinTone={character.appearance.skinTone}
          hair={character.appearance.hair ?? null}
          layers={previewLayers()}
          hiddenSlots={character.hiddenSlots.filter((s) => s !== targetDef.slot)}
          placements={placements}
          size={128}
        />
      </div>
      <span className="inv-detail-info">
        <span className="slot-name">{targetDef.name}</span>
        <span className="bag-sub">{format(text.shop.transmogLooksLike, { name: chosen.def.name })}</span>
        {costLine}
        <span className="bag-sub transmog-warn">
          {format(text.shop.transmogWarn, { name: chosen.def.name, target: targetDef.name })}
        </span>
      </span>
      <div className="inv-detail-actions">
        <button
          type="button"
          className="small"
          disabled={busy || short}
          onClick={() => onConfirm(target.instanceId, chosen.item.instanceId)}
        >
          {format(text.shop.transmogConfirm, { gold: cost })}
        </button>
        <button type="button" className="ghost small" onClick={() => setLookId(null)}>
          {text.shop.transmogBack}
        </button>
      </div>
    </div>
  );
}
