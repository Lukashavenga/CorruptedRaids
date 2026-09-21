import { useRef, useState } from "react";
import type { EnemyUnit, PartyBand, Role } from "../../../src/engine/types.js";
import { PARTY_BANDS, ROLES } from "../../../src/engine/types.js";
import { BAND_SAMPLE_PARTY, BAND_THRESHOLDS } from "../../../src/engine/squad.js";
import { backgroundUrl, enemySpriteUrl } from "../sprites.js";
import { RoleIcon } from "../components/RoleIcon.js";

/**
 * Levels are numbered, not named.
 *
 * The player sees "POORS - LEVEL 2" when the fight loads, so the admin should
 * say the same word. Names like "Fresh meat" read well in a tooltip and are
 * useless the moment there are five of them; a number extends without anyone
 * having to invent an adjective for tier four.
 */
export function levelLabel(band: PartyBand): string {
  return `LEVEL ${PARTY_BANDS.indexOf(band) + 1}`;
}

/** The party rating this level is for, and the kind of group that rates it. */
function bandRange(band: PartyBand): string {
  const sample = BAND_SAMPLE_PARTY[band];
  const from = BAND_THRESHOLDS[band];
  const next = PARTY_BANDS[PARTY_BANDS.indexOf(band) + 1];
  const to = next ? BAND_THRESHOLDS[next] : null;
  const range = to === null ? `${from}+` : `${from}–${to}`;
  const kit = sample.gear === "none" ? "no gear" : sample.gear === "best" ? "fully geared" : "mid gear";
  return `rating ${range} · ${kit}`;
}

/** Difficulty targets, as the win rate the party should end up with. */
const TARGETS: { label: string; win: number }[] = [
  { label: "Comfortable", win: 0.85 },
  { label: "Tense", win: 0.65 },
  { label: "Hard", win: 0.5 },
  { label: "Punishing", win: 0.3 },
];

export interface FormationFieldProps {
  units: EnemyUnit[];
  onUnits: (units: EnemyUnit[]) => void;
  background?: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Alignment guides over the scene. */
  grid?: boolean;
}

/**
 * The battlefield: drag units into place against the scene they fight in.
 *
 * Only the field now. Level tabs, the squad list and the pressure dial moved
 * out to the surrounding screen, because a control and the number it moves
 * belong next to each other and this component was hosting three unrelated
 * conversations at once.
 *
 * The whole stage is drawn for context but only the ENEMY HALF is the
 * coordinate space — x/y are fractions of that, which is how the overlay reads
 * them. Laying out against the full width instead put a unit dragged to x=0.2
 * inside the party's own ranks on stream, half a stage from where it was put.
 */
export function FormationField({
  units,
  onUnits,
  background,
  selected,
  onSelect,
  grid = false,
}: FormationFieldProps): JSX.Element {
  const fieldRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<string | null>(null);

  const toField = (e: React.PointerEvent) => {
    const r = fieldRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const patch = (id: string, next: Partial<EnemyUnit>) =>
    onUnits(units.map((u) => (u.id === id ? { ...u, ...next } : u)));

  return (
    <div
      className={`formation-stage ${grid ? "has-grid" : ""}`}
      style={background ? { backgroundImage: `url(${backgroundUrl(background)})` } : undefined}
    >
      {/* Where the party will stand. Drawn as a marker rather than as
          characters because who joins is not known until the night - but a
          layout made without it is made blind, since "which side faces the
          party" is the whole question when placing a frontliner. */}
      <span className="formation-party" aria-hidden="true">
        party
      </span>
      <div
        className="formation-field"
        ref={fieldRef}
        onPointerMove={(e) => {
          if (!dragging.current || e.buttons !== 1) return;
          patch(dragging.current, toField(e));
        }}
        onPointerUp={() => (dragging.current = null)}
        onPointerLeave={() => (dragging.current = null)}
        onPointerDown={(e) => {
          if (e.target === fieldRef.current) onSelect(null);
        }}
      >
        {units.map((u, i) => (
          <button
            key={u.id}
            type="button"
            className={`formation-unit role-${u.role} ${u.id === selected ? "is-selected" : ""}`}
            style={{
              left: `${u.x * 100}%`,
              top: `${u.y * 100}%`,
              // y is the FEET, so a unit placed lower stands nearer the front —
              // the same convention the overlay draws with.
              transform: `translate(-50%, -100%) scale(${u.scale ?? 1})`,
              zIndex: Math.round(u.y * 100),
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              try {
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              } catch {
                /* drag works without capture */
              }
              dragging.current = u.id;
              onSelect(u.id);
            }}
            title={`${u.name ?? u.sprite} - drag to move`}
          >
            <img src={enemySpriteUrl(u.sprite)} alt="" draggable={false} />
            <span className="formation-unit-n">{i + 1}</span>
          </button>
        ))}

        {units.length === 0 && (
          <p className="formation-empty">Add a unit on the left, then drag it into place.</p>
        )}
      </div>
    </div>
  );
}
