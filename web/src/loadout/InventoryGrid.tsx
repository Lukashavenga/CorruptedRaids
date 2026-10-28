import { useState } from "react";
import { STAT_KEYS } from "../../../src/engine/types.js";
import type { GearDefinition, GearSlot } from "../../../src/engine/types.js";
import type { PlacementFile } from "../../../src/character/layers.js";
import { CharacterSprite } from "../components/CharacterSprite.js";
import { spriteForGear, spriteForInstance } from "../sprites.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import type { ContentCatalog } from "../hooks/useContentCatalog.js";
import { ItemIcon } from "./ItemIcon.js";
import { text, format } from "../../../src/text/index.js";

export interface InventoryGridProps {
  character: CharacterView;
  catalog: ContentCatalog;
  onEquip: (instanceId: string) => void;
  /** Consumables are carried too, so this panel owns using them. */
  onUse: (consumableId: string) => void;
  onRecycle: (instanceIds: string[]) => void;
  /** Gives `targetInstanceId` the look of `lookInstanceId`; the latter is destroyed. */
  onTransmog: (targetInstanceId: string, lookInstanceId: string) => void;
  onRevertTransmog: (instanceId: string) => void;
  /** For the transmog preview on the character. */
  placements: PlacementFile;
  busy: boolean;
}

/**
 * Cells per row, and the fewest rows drawn.
 *
 * The bag reads as a container rather than as a list that happens to be short,
 * and it grows a whole ROW at a time — a grid with a ragged last row looks
 * broken rather than partly full.
 *
 * These are a DRAWING decision, not a carry limit. The engine has no inventory
 * cap at all; a real one belongs there, as a command that can refuse a pickup.
 */
const CELLS_PER_ROW = 8;
const MIN_ROWS = 2;

function statLine(def: GearDefinition): string {
  return STAT_KEYS.filter((key) => (def.statMods[key] ?? 0) !== 0)
    .map((key) => {
      const value = def.statMods[key]!;
      const shown = key === "crit" ? `${Math.round(value * 100)}%` : `${value}`;
      return `${value > 0 ? "+" : ""}${shown} ${text.stat[key]}`;
    })
    .join(", ");
}

/**
 * The bag as a grid of sockets, in one of two modes.
 *
 * INSPECT is the default: one cell at a time, with a detail strip that sticks
 * to the bottom of the viewport while the grid is on screen. It used to be a
 * plain block under the grid, which on a phone put it below the fold — you
 * tapped an item, something appeared where you could not see it, and nothing
 * seemed to happen.
 *
 * RECYCLE is the other, behind the button in the panel header. Clearing out
 * twenty pieces of junk one confirm at a time is the single most tedious thing
 * on this page, and a modifier-click cannot be the answer because half the
 * players are on a phone. So it is a mode: tap to mark, one action at the end.
 *
 * Rarity shows as the cell's frame colour, never on the item glyph itself:
 * the Art Bible's "rarity lives in the UI, not the sprite" rule, which is
 * what lets one piece of item art serve every tier.
 */
export function InventoryGrid({
  character,
  catalog,
  onEquip,
  onRecycle,
  onUse,
  onTransmog,
  onRevertTransmog,
  placements,
  busy,
}: InventoryGridProps): JSX.Element {
  // Icons draw the item's worn sprite, and worn gear is cut to fit a body.
  const bodyType = character.appearance.bodyType;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recycling, setRecycling] = useState(false);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  // Transmog is a two-step flow from the detail strip: the item keeping its
  // stats (`transmogging`), then the item whose look is wanted (`lookId`).
  const [transmogging, setTransmogging] = useState<string | null>(null);
  const [lookId, setLookId] = useState<string | null>(null);

  const items = character.inventory
    .map((item) => ({ item, def: catalog.gearById.get(item.gearId) }))
    .filter((row): row is { item: (typeof character.inventory)[number]; def: GearDefinition } => row.def !== undefined);

  const selected = items.find((row) => row.item.instanceId === selectedId) ?? null;
  const cells = Math.max(MIN_ROWS, Math.ceil(items.length / CELLS_PER_ROW)) * CELLS_PER_ROW;
  const emptyCells = Math.max(0, cells - items.length);

  // Locked when the wearer has not spent enough on what the item asks for.
  // Mirrors gearUsableBy in the engine, which remains the authority and refuses
  // the equip regardless of what this shows.
  const missing: [string, number][] = selected
    ? (Object.entries(selected.def.requires ?? {}).filter(
        ([stat, need]) => (character.allocated[stat as keyof typeof character.allocated] ?? 0) < (need as number),
      ) as [string, number][])
    : [];
  const locked = missing.length > 0;
  const lockReason = missing
    .map(([stat, need]) =>
      format(text.gear.needsStat, { amount: need, stat: text.stat[stat as keyof typeof text.stat] ?? stat }),
    )
    .join(", ");

  const leaveTransmog = () => {
    setTransmogging(null);
    setLookId(null);
  };

  const tmTarget = transmogging ? items.find((row) => row.item.instanceId === transmogging) ?? null : null;
  // Only carried items in the same slot can be consumed for their look.
  const tmCandidates = tmTarget
    ? items.filter((row) => row.item.instanceId !== transmogging && row.def.slot === tmTarget.def.slot)
    : [];
  const tmLook = lookId ? tmCandidates.find((row) => row.item.instanceId === lookId) ?? null : null;
  const tmCost = tmTarget?.item.transmogCost ?? 0;

  // The preview is the character as worn, with the target's slot drawn as the
  // look. Built from the same helper as the doll so the two cannot disagree.
  const previewLayers = (): Partial<Record<GearSlot, string>> => {
    const out: Partial<Record<GearSlot, string>> = {};
    for (const [slot, worn] of Object.entries(character.equipment)) {
      const sprite = spriteForInstance(worn ?? undefined, catalog.gearById, bodyType);
      if (worn && sprite) out[slot as GearSlot] = sprite;
    }
    if (tmTarget && tmLook) {
      const sprite = spriteForGear(tmLook.def, bodyType);
      if (sprite) out[tmTarget.def.slot] = sprite;
    }
    return out;
  };

  const markedPayout = items
    .filter((row) => marked.has(row.item.instanceId))
    .reduce((sum, row) => sum + row.item.recycleValue, 0);

  const leaveRecycling = () => {
    setRecycling(false);
    setMarked(new Set());
  };

  const toggleMark = (instanceId: string) => {
    setMarked((current) => {
      const next = new Set(current);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  };

  return (
    <section className="panel" data-section="inventory">
      <header className="panel-head">
        <h2>{text.loadout.inventoryHeading}</h2>
        <span className="panel-head-tools">
          <span className="bag-count">{format(text.loadout.bagCount, { count: items.length })}</span>
          {/*
            A picture of gold, and the word.

            This was three arrows in a loop, which is the universal symbol for
            "recycling" in the sense of kerbside bins and says nothing about
            what the button does here - turn junk into coins. The sheet already
            draws a pile of gold, and a label removes the guesswork entirely: an
            icon-only control in a corner is a thing you have to click to find
            out about.
          */}
          <button
            type="button"
            className={`scrap-button ${recycling ? "is-on" : ""}`}
            onClick={() => (recycling ? leaveRecycling() : (setSelectedId(null), leaveTransmog(), setRecycling(true)))}
            aria-pressed={recycling}
            title={recycling ? text.shop.recycleDone : text.shop.recycleManyHint}
          >
            <img className="scrap-mark" src="/art/ui/prop-coins.png" alt="" aria-hidden="true" draggable={false} />
            <span>{recycling ? text.shop.recycleDone : text.shop.recycleMany}</span>
          </button>
        </span>
      </header>

      <ul className={`inv-grid ${recycling ? "is-recycling" : ""}`}>
        {items.map(({ item, def }) => {
          const isMarked = marked.has(item.instanceId);
          return (
            <li key={item.instanceId}>
              <button
                type="button"
                className={`inv-cell is-filled rarity-${def.rarity} ${
                  recycling ? (isMarked ? "is-marked" : "") : selectedId === item.instanceId ? "is-selected" : ""
                }`}
                onClick={() =>
                  recycling
                    ? toggleMark(item.instanceId)
                    : setSelectedId(selectedId === item.instanceId ? null : item.instanceId)
                }
                title={recycling ? format(text.shop.scrapCell, { name: def.name, gold: item.recycleValue }) : def.name}
                aria-label={def.name}
                aria-pressed={recycling ? isMarked : selectedId === item.instanceId}
              >
                <ItemIcon
                  def={def}
                  look={item.look ? catalog.gearById.get(item.look) : undefined}
                  slot={def.slot}
                  bodyType={bodyType}
                  size={38}
                  alt={def.name}
                />
                {recycling && isMarked && (
                  <span className="inv-tick" aria-hidden="true">
                    ✕
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {Array.from({ length: emptyCells }, (_, i) => (
          <li key={`empty-${i}`}>
            <span className="inv-cell is-empty" aria-hidden="true" />
          </li>
        ))}
      </ul>

      {items.length === 0 && <p className="hint">{text.loadout.inventoryEmpty}</p>}

      {/* The recycle bar. Sticky for the same reason the detail strip is: on a
          phone the grid is taller than the screen, so a confirm rendered under
          it is a confirm nobody sees. */}
      {recycling && (
        <div className="inv-detail is-recycle-bar">
          <span className="inv-detail-info">
            <span className="slot-name">
              {marked.size === 0
                ? text.shop.recycleNone
                : format(text.shop.recycleCount, { count: marked.size, gold: markedPayout })}
            </span>
            <span className="bag-sub">{text.shop.recycleHint}</span>
          </span>
          <div className="inv-detail-actions">
            <button
              type="button"
              className="small"
              disabled={busy || marked.size === 0}
              onClick={() => {
                onRecycle([...marked]);
                leaveRecycling();
              }}
            >
              {text.shop.recycle}
            </button>
            <button type="button" className="ghost small" onClick={leaveRecycling}>
              {text.loadout.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Transmog. Sticky like the other bars: on a phone a confirm under the
          grid is a confirm nobody sees. The preview is the whole point, so it
          sits beside the words rather than behind a tap. */}
      {!recycling && tmTarget && (
        <div className="inv-detail is-transmog-bar">
          {tmLook ? (
            <>
              <CharacterSprite
                bodyType={bodyType}
                skinTone={character.appearance.skinTone}
                hair={character.appearance.hair ?? null}
                layers={previewLayers()}
                hiddenSlots={character.hiddenSlots}
                placements={placements}
                size={128}
              />
              <span className="inv-detail-info">
                <span className="slot-name">
                  {tmTarget.def.name} · {format(text.shop.transmogLooksLike, { name: tmLook.def.name })}
                </span>
                <span className="bag-sub">
                  {format(text.shop.transmogWarn, { name: tmLook.def.name, target: tmTarget.def.name })}
                </span>
              </span>
              <div className="inv-detail-actions">
                <button
                  type="button"
                  className="small"
                  disabled={busy || character.gold < tmCost}
                  onClick={() => {
                    onTransmog(tmTarget.item.instanceId, tmLook.item.instanceId);
                    leaveTransmog();
                    setSelectedId(null);
                  }}
                >
                  {format(text.shop.transmogConfirm, { gold: tmCost })}
                </button>
                <button type="button" className="ghost small" onClick={() => setLookId(null)}>
                  {text.loadout.cancel}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="inv-detail-info">
                <span className="slot-name">{tmCandidates.length === 0 ? text.shop.transmogNone : text.shop.transmogPick}</span>
                <ul className="transmog-options">
                  {tmCandidates.map(({ item, def }) => (
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
              </span>
              <div className="inv-detail-actions">
                <button type="button" className="ghost small" onClick={leaveTransmog}>
                  {text.loadout.cancel}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!recycling && !tmTarget && selected && (
        <div className={`inv-detail rarity-${selected.def.rarity}`}>
          <ItemIcon
            def={selected.def}
            look={selected.item.look ? catalog.gearById.get(selected.item.look) : undefined}
            slot={selected.def.slot}
            bodyType={bodyType}
            size={40}
          />
          <div className="inv-detail-info">
            <span className="slot-name">{selected.def.name}</span>
            <span className="bag-sub">
              {text.gear.slot[selected.def.slot]} · {text.gear.rarity[selected.def.rarity]}
              {/* Guarded although the type says it is always there: the hosted
                  loadout and its Edge Function deploy separately, and one
                  built before `source` existed sends none. */}
              {selected.item.source && ` · ${text.gear.source[selected.item.source]}`}
            </span>
            <span className="slot-mods">{statLine(selected.def)}</span>
            {selected.item.look && catalog.gearById.get(selected.item.look) && (
              <span className="bag-sub">
                {format(text.shop.transmogLooksLike, { name: catalog.gearById.get(selected.item.look)!.name })}
              </span>
            )}
          </div>
          <div className="inv-detail-actions">
            <button
              type="button"
              className="small"
              disabled={busy || locked}
              onClick={() => onEquip(selected.item.instanceId)}
              title={locked ? lockReason : undefined}
            >
              {locked ? lockReason : text.gear.equip}
            </button>
            <button
              type="button"
              className="ghost small"
              disabled={busy}
              onClick={() => setTransmogging(selected.item.instanceId)}
              title={format(text.shop.transmogConfirm, { gold: selected.item.transmogCost })}
            >
              {text.shop.transmog}
            </button>
            {selected.item.look && (
              <button
                type="button"
                className="ghost small"
                disabled={busy}
                onClick={() => onRevertTransmog(selected.item.instanceId)}
              >
                {text.shop.transmogRevert}
              </button>
            )}
            {/* The payout is on the button because recycling destroys the
                item - the number is the warning. */}
            <button
              type="button"
              className="ghost small"
              disabled={busy}
              onClick={() => {
                onRecycle([selected.item.instanceId]);
                setSelectedId(null);
              }}
            >
              {format(text.shop.recycleFor, { gold: selected.item.recycleValue })}
            </button>
          </div>
        </div>
      )}

      {/* Consumables live here too.
          They used to be a separate "Pockets" panel, which asked a player to
          keep two bags in their head and to guess which one a thing was in.
          They stack by id rather than existing as individual instances, so
          they get their own strip rather than cells in the grid - but they are
          in the one place you look for what you are carrying. */}
      {character.consumables.length > 0 && (
        <div className="inv-consumables">
          <h3>{text.shop.consumablesHeading}</h3>
          <ul>
            {character.consumables.map(({ id, count }) => {
              const def = catalog.consumablesById.get(id);
              if (!def) return null;
              return (
                <li key={id} className={`rarity-${def.rarity}`}>
                  <span className="slot-name">
                    {def.name} <span className="owned">{format(text.shop.owned, { count })}</span>
                  </span>
                  <button type="button" className="small" disabled={busy} onClick={() => onUse(id)}>
                    {text.shop.use}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
