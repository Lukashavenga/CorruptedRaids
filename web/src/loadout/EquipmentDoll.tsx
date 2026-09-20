import { useEffect, useMemo, useRef, useState } from "react";
import { CharacterSprite } from "../components/CharacterSprite.js";
import { SlotIcon, slotTileUrl } from "./SlotIcon.js";
import { ItemIcon } from "./ItemIcon.js";
import { STAT_KEYS, type GearDefinition, type GearSlot } from "../../../src/engine/types.js";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import type { PlacementFile } from "../../../src/character/layers.js";
import { spriteForGear } from "../sprites.js";
import type { ContentCatalog } from "../hooks/useContentCatalog.js";
import { text, format } from "../../../src/text/index.js";

export interface EquipmentDollProps {
  character: CharacterView;
  catalog: ContentCatalog;
  onUnequip: (slot: GearSlot) => void;
  onEquip: (instanceId: string) => void;
  busy: boolean;
  placements: PlacementFile;
  /** Slots equipped but hidden from view — see the show/hide toggles. */
  hiddenSlots: readonly GearSlot[];
  onToggleHidden: (slot: GearSlot) => void;
}

/**
 * Anatomical placement, not GEAR_SLOTS order: what you wear and hold on the
 * left, what hangs off you on the right. Adding a slot means choosing a side
 * here, not appending to a list.
 */
const LEFT_SLOTS: GearSlot[] = ["head", "face", "mainHand", "offHand"];
const RIGHT_SLOTS: GearSlot[] = ["back", "top", "bottom"];

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
 * The paper doll: seven equipment sockets arranged around the character.
 *
 * A SOCKET IS A WAY IN, not just a readout. Clicking one opens the list of
 * things that fit it — everything in the bag for that slot, plus whatever is
 * in it now. Before, a socket's only behaviour was to unequip what was already
 * there, which meant the only route to putting gear ON was the bag: find the
 * item among everything you own, select it, read the strip that appears below.
 * "What can go in my off hand?" is the question a player actually has, and the
 * off-hand socket is where they ask it.
 *
 * The figure is composited from flat layers (CharacterSprite), so every slot
 * — back included — can show its own art once that art exists. Gear layers
 * are not drawn yet; a missing layer is skipped, leaving the bare body.
 */
export function EquipmentDoll({
  character,
  catalog,
  onUnequip,
  onEquip,
  busy,
  placements,
  hiddenSlots,
  onToggleHidden,
}: EquipmentDollProps): JSX.Element {
  const [picking, setPicking] = useState<GearSlot | null>(null);

  /*
   * Bring the list to the player.
   *
   * The card is taller than a phone screen, so a list rendered under it opens
   * where nobody can see it — the socket is tapped, something appears below
   * the fold, and the tap reads as having done nothing. That is the same fault
   * the bag's detail strip had, and the same fix: the panel says where it is.
   */
  const pickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (picking) pickerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picking]);

  /**
   * Sprite ids per slot. Resolved here rather than inside CharacterSprite
   * because picking the art needs the gear catalogue AND the body type (worn
   * gear is cut to fit), and the sprite component should stay a renderer.
   */
  const layers = useMemo(() => {
    const out: Partial<Record<GearSlot, string>> = {};
    for (const [slot, item] of Object.entries(character.equipment)) {
      if (!item) continue;
      const sprite = spriteForGear(catalog.gearById.get(item.gearId), character.appearance.bodyType);
      if (sprite) out[slot as GearSlot] = sprite;
    }
    return out;
  }, [character.equipment, catalog.gearById, character.appearance.bodyType]);

  const hair = character.appearance.hair ?? null;

  /** What is in the bag for the slot being picked for, in catalogue order. */
  const candidates = useMemo(() => {
    if (!picking) return [];
    return character.inventory
      .map((item) => ({ item, def: catalog.gearById.get(item.gearId) }))
      .filter((row): row is { item: (typeof character.inventory)[number]; def: GearDefinition } =>
        row.def !== undefined && row.def.slot === picking,
      );
  }, [picking, character.inventory, catalog.gearById]);

  /**
   * Why an item cannot be worn, or null.
   *
   * Mirrors gearUsableBy in the engine, which remains the authority and
   * refuses the equip regardless of what this shows. Gates read POINTS SPENT,
   * not the stat's displayed value — see AGENTS.md §10.
   */
  const lockReason = (def: GearDefinition): string | null => {
    const missing = Object.entries(def.requires ?? {}).filter(
      ([stat, need]) => (character.allocated[stat as keyof typeof character.allocated] ?? 0) < (need as number),
    );
    if (missing.length === 0) return null;
    // text.stat, not the raw key: the engine's shorthand is hp/atk/armour and
    // a player has never seen those words (AGENTS.md §8).
    return missing
      .map(([stat, need]) =>
        format(text.gear.needsStat, { amount: need as number, stat: text.stat[stat as keyof typeof text.stat] ?? stat }),
      )
      .join(", ");
  };

  const socket = (slot: GearSlot) => {
    const item = character.equipment[slot];
    const def = item ? catalog.gearById.get(item.gearId) : undefined;
    const label = text.gear.slot[slot];
    const tile = slotTileUrl(slot);

    return (
      <div key={slot} className={`socket socket-${slot}`}>
        {/* The label rides ABOVE the box, as the mock has it. A column of
            sockets is read top to bottom, so the name arriving before the
            picture is the order the eye is already moving in. */}
        <span className="socket-label">{label}</span>
        <span className="socket-frame">
          <button
            type="button"
            className={`socket-box ${def ? `is-filled rarity-${def.rarity}` : "is-empty"} ${
              picking === slot ? "is-picking" : ""
            }`}
            disabled={busy}
            onClick={() => setPicking(picking === slot ? null : slot)}
            aria-expanded={picking === slot}
            title={def ? def.name : `${label} — ${text.gear.empty}`}
            aria-label={def ? `${label}: ${def.name}` : `${label}: ${text.gear.empty}`}
          >
            {def ? (
              <ItemIcon def={def} slot={slot} bodyType={character.appearance.bodyType} size={40} alt={def.name} />
            ) : tile ? (
              /* The tile IS the socket — cell frame and mark in one drawing —
                 so it fills the box rather than sitting inside it. */
              <img className="socket-tile" src={tile} alt="" draggable={false} />
            ) : (
              <SlotIcon slot={slot} />
            )}
          </button>

          {def && (
            /* Show/hide is cosmetic only — the item stays equipped and its stats
               still count. Players want the numbers from a helmet without losing
               the face they picked, so this is a view toggle, not an unequip.
               An EYE rather than a dot: a filled circle and a hollow circle are
               the same shape twice and say nothing about what they do, and at
               15px neither was reliably hittable. */
            <button
              type="button"
              className={`socket-eye ${hiddenSlots.includes(slot) ? "is-hidden" : ""}`}
              onClick={() => onToggleHidden(slot)}
              title={hiddenSlots.includes(slot) ? text.loadout.showGear : text.loadout.hideGear}
              aria-label={`${def.name}: ${hiddenSlots.includes(slot) ? text.loadout.showGear : text.loadout.hideGear}`}
              aria-pressed={hiddenSlots.includes(slot)}
            >
              <EyeMark closed={hiddenSlots.includes(slot)} />
            </button>
          )}
        </span>
      </div>
    );
  };

  const xpPct = character.xpToNext > 0 ? Math.min(100, (character.xp / character.xpToNext) * 100) : 0;
  const worn = picking ? character.equipment[picking] : null;
  const wornDef = worn ? catalog.gearById.get(worn.gearId) : undefined;

  return (
    <div className="doll-panel">
      {/* Who this is, above the figure — the mock's arrangement, and the right
          one: you read the name, then look at the character it belongs to. */}
      <header className="doll-head">
        <h2 className="doll-name">{character.name}</h2>
        <p className="doll-meta">
          {format(text.character.levelLabel, { level: character.level })} · {text.role[character.role]} ·{" "}
          <strong title="Gear, spent points and role as one number. This is what decides which fight you get.">
            {format(text.character.corruptionLabel, { amount: character.corruption })}
          </strong>
        </p>
      </header>

      {/* The niche is the stage, not a band under it.
          It was a strip below the figure, which left the character standing on
          a picture of a floor with nothing above it — the torch lit no one and
          the wall was somewhere else. As the stage's own background the figure
          is IN the alcove: the torch is beside it, the gold at its feet. */}
      <div className="doll-stage">
        <div className="doll-col doll-left">{LEFT_SLOTS.map(socket)}</div>

        <div className="doll-center">
          <CharacterSprite
            bodyType={character.appearance.bodyType}
            skinTone={character.appearance.skinTone}
            hair={hair}
            layers={layers}
            hiddenSlots={hiddenSlots}
            placements={placements}
            fluid
            className="doll-rig"
          />
        </div>

        <div className="doll-col doll-right">{RIGHT_SLOTS.map(socket)}</div>
      </div>

      {/*
        What fits the slot you just clicked.
        Rendered under the stage rather than floating over it: a popover
        anchored to a socket has to dodge the panel edge on one side and the
        character on the other, and on a phone there is nowhere for it to go
        that is not on top of the thing it describes.
      */}
      {picking && (
        <div className="slot-picker" ref={pickerRef}>
          <header className="slot-picker-head">
            <h3>{format(text.loadout.fitsSlot, { slot: text.gear.slot[picking] })}</h3>
            <button type="button" className="ghost small" onClick={() => setPicking(null)}>
              {text.loadout.close}
            </button>
          </header>

          {wornDef && (
            <div className={`slot-row is-worn rarity-${wornDef.rarity}`}>
              <ItemIcon def={wornDef} slot={picking} bodyType={character.appearance.bodyType} size={34} />
              <span className="bag-info">
                <span className="slot-name">{wornDef.name}</span>
                <span className="slot-mods">{statLine(wornDef)}</span>
              </span>
              <div className="slot-row-actions">
                {/* The same toggle as the dot on the socket, spelled out. The
                    dot is discoverable once you know what it is; this is where
                    you find out. */}
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy}
                  onClick={() => onToggleHidden(picking)}
                  aria-pressed={hiddenSlots.includes(picking)}
                >
                  <EyeMark closed={hiddenSlots.includes(picking)} />
                  {hiddenSlots.includes(picking) ? text.loadout.showGear : text.loadout.hideGear}
                </button>
                <button type="button" className="ghost small" disabled={busy} onClick={() => onUnequip(picking)}>
                  {text.gear.unequip}
                </button>
              </div>
            </div>
          )}

          {candidates.length === 0 ? (
            <p className="hint">{text.loadout.nothingFits}</p>
          ) : (
            <ul className="slot-list">
              {candidates.map(({ item, def }) => {
                const locked = lockReason(def);
                return (
                  <li key={item.instanceId} className={`slot-row rarity-${def.rarity}`}>
                    <ItemIcon def={def} slot={def.slot} bodyType={character.appearance.bodyType} size={34} />
                    <span className="bag-info">
                      <span className="slot-name">{def.name}</span>
                      <span className="slot-mods">{statLine(def)}</span>
                    </span>
                    <button
                      type="button"
                      className="small"
                      disabled={busy || locked !== null}
                      title={locked ?? undefined}
                      onClick={() => {
                        onEquip(item.instanceId);
                        setPicking(null);
                      }}
                    >
                      {locked ?? text.gear.equip}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="doll-xp">
        <div
          className="xp-bar"
          aria-label={format(text.character.xpLabel, { current: character.xp, toNext: character.xpToNext })}
        >
          <div className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
        </div>
        <span>{format(text.character.xpLabel, { current: character.xp, toNext: character.xpToNext })}</span>
      </div>
    </div>
  );
}

/**
 * An eye, open or struck through.
 *
 * Drawn rather than sliced: the chrome sheet has no icon for "look at this",
 * and a filled dot next to a hollow dot — which is what this was — is the same
 * shape twice. Flat bronze, hard edges, no gradient, so it belongs beside the
 * drawn marks it sits on.
 */
function EyeMark({ closed }: { closed: boolean }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square">
        <path d="M2.5 12C5 7.5 8.4 5.2 12 5.2S19 7.5 21.5 12C19 16.5 15.6 18.8 12 18.8S5 16.5 2.5 12Z" />
        <circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none" />
        {closed && <path d="M4 20 L20 4" />}
      </g>
    </svg>
  );
}
