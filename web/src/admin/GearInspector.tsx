import { useEffect, useMemo, useState } from "react";
import type { BodyType, GearDefinition, GearStat, Rarity } from "../../../src/engine/types.js";
import { ALLOCATABLE_STATS, GEAR_STAT_KEYS, RARITIES } from "../../../src/engine/types.js";
import { DEFAULT_BALANCE } from "../../../src/engine/balance.js";
import { explainStat, powerScore, RARITY_POWER_BAND } from "../../../src/engine/statGuide.js";
import { spriteForGear } from "../sprites.js";
import { adminFetch } from "../adminKey.js";

// Negative on purpose. Gear may TAKE a stat as well as give one — a
// greatsword that costs you Speed, a focus that costs you Health — and a
// trade-off is what makes gear a choice rather than "wear the bigger number".
// Ranges are scaled to the stat model: a level-1 opens at 9-14 health.
const RANGE: Record<GearStat, { min: number; max: number; step: number }> = {
  hp: { min: -12, max: 30, step: 1 },
  atk: { min: -6, max: 12, step: 1 },
  skill: { min: -6, max: 12, step: 1 },
  spd: { min: -4, max: 6, step: 1 },
};

export interface GearInspectorProps {
  gear: GearDefinition[];
  /** Slot being placed — "hair" has no gear item behind it. */
  slot: string;
  /** Sprite selected in the placement picker. */
  spriteId: string;
  bodyType: BodyType;
  onSaved: () => void;
  setStatus: (message: string) => void;
}

/**
 * The gear item that uses the sprite currently being placed.
 *
 * Sits beside the placement stage so positioning a helmet and deciding what
 * that helmet IS happen in one place. The link is the sprite: gear names the
 * file it draws with, so selecting art in the picker is the same act as
 * selecting the item — no second dropdown to keep in sync with the first.
 *
 * A sprite with no item behind it (hair, or art nothing references yet) says so
 * rather than rendering an empty form.
 */
export function GearInspector({
  gear,
  slot,
  spriteId,
  bodyType,
  onSaved,
  setStatus,
}: GearInspectorProps): JSX.Element {
  const [draft, setDraft] = useState<GearDefinition | null>(null);
  const [openStat, setOpenStat] = useState<GearStat | null>(null);

  /** Every item drawing with this sprite — usually one, occasionally none. */
  const matches = useMemo(
    () =>
      gear.filter(
        (g) => g.sprite === spriteId || g.spriteByBody?.male === spriteId || g.spriteByBody?.female === spriteId,
      ),
    [gear, spriteId],
  );
  const selected = matches[0];

  useEffect(() => {
    setDraft(selected ? structuredClone(selected) : null);
    setOpenStat(null);
  }, [selected]);

  if (slot === "hair") {
    return <p className="admin-hint">Hair is appearance, not gear - nothing to configure.</p>;
  }
  if (!draft) {
    return <p className="admin-hint">No gear item uses this sprite yet.</p>;
  }

  const patch = (next: Partial<GearDefinition>) => setDraft({ ...draft, ...next });
  const setStat = (key: GearStat, value: number) => {
    const mods = { ...draft.statMods };
    if (value === 0) delete mods[key];
    else mods[key] = value;
    patch({ statMods: mods });
  };

  const bodies: BodyType[] = draft.bodyTypes ?? ["male", "female"];
  const toggleBody = (body: BodyType) => {
    const next = bodies.includes(body) ? bodies.filter((b) => b !== body) : [...bodies, body];
    // An item wearable by nobody is a disabled item, and there is a switch for
    // that already.
    if (next.length === 0) return;
    patch({ bodyTypes: next.length === 2 ? undefined : next });
  };

  /**
   * Worn gear is cut to fit, so one item can have two drawings — a male cut and
   * a female cut — while remaining ONE item with one name, one stat line and
   * one JSON file. The sprite picker therefore shows two entries that both open
   * this panel, which reads as two items that are mysteriously linked unless
   * the panel says otherwise.
   */
  const cuts = draft.spriteByBody;
  const whichCut = cuts
    ? cuts.male === spriteId
      ? "male"
      : cuts.female === spriteId
        ? "female"
        : null
    : null;

  /**
   * Art that exists for a body which cannot equip the item.
   *
   * A real inconsistency rather than a style note: the drawing is authored,
   * placed, and shipped, and no character can ever display it. Easy to create
   * by accident from this very panel — restrict the body types while looking at
   * the cut you are NOT excluding, and the other one is silently orphaned.
   */
  const orphanedCuts = cuts
    ? (["male", "female"] as BodyType[]).filter((b) => cuts[b] && !bodies.includes(b))
    : [];

  const score = powerScore(draft.statMods, DEFAULT_BALANCE);
  const band = RARITY_POWER_BAND[draft.rarity] ?? [0, 999];
  const offBand = score < band[0] ? "under" : score > band[1] ? "over" : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(selected);

  const save = async () => {
    const res = await adminFetch("/content/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "gear", id: draft.id, data: draft }),
    });
    const body = await res.json();
    setStatus(body.ok ? `Saved ${draft.name}.` : `Rejected: ${body.message}`);
    if (body.ok) onSaved();
  };

  return (
    <div className="gear-inspector">
      <h2 className="gear-title">{draft.name}</h2>
      <p className="admin-hint">
        {draft.slot} · {spriteForGear(draft, bodyType) ?? spriteId}
      </p>

      {whichCut && (
        <p className="gear-shared">
          Viewing the <strong>{whichCut}</strong> cut. This is ONE item with two drawings - name,
          stats, rarity and body types are shared between them, and editing either changes both.
          Only the <em>placement</em> is per-cut.
        </p>
      )}

      {orphanedCuts.length > 0 && (
        <p className="admin-warn">
          There is {orphanedCuts.join(" and ")} art for this item, but {orphanedCuts.join(" and ")} characters
          cannot equip it - that drawing will never appear in game.
        </p>
      )}

      <label className="admin-check">
        <input
          type="checkbox"
          checked={draft.enabled !== false}
          onChange={(e) => patch({ enabled: e.target.checked ? undefined : false })}
        />
        Enabled
      </label>

      <div className="gear-bodies">
        {(["male", "female"] as BodyType[]).map((b) => (
          <label key={b} className="admin-check">
            <input type="checkbox" checked={bodies.includes(b)} onChange={() => toggleBody(b)} />
            {b}
          </label>
        ))}
      </div>

      <label>
        Name
        <input type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
      </label>

      <label>
        Description
        <textarea rows={2} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
      </label>

      <label>
        Rarity
        <select value={draft.rarity} onChange={(e) => patch({ rarity: e.target.value as Rarity })}>
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      {/* Attribute requirements. A slider per attribute, because the decision is
          "how committed must a wearer be" rather than a number to type. */}
      <h3 className="sub-heading">Requires</h3>
      <p className="admin-hint">
        Points the wearer must have SPENT. Gear cannot lift you into more gear - only your own
        allocation counts. At 2 points a level, 40 here is a level-20 specialist or a level-40
        generalist.
      </p>
      {ALLOCATABLE_STATS.map((stat) => {
        const value = draft.requires?.[stat] ?? 0;
        return (
          <label key={stat}>
            {stat} {value}
            <input
              type="range"
              min={0}
              max={200}
              step={2}
              value={value}
              onChange={(e) => {
                const next = { ...draft.requires };
                if (Number(e.target.value) === 0) delete next[stat];
                else next[stat] = Number(e.target.value);
                patch({ requires: next });
              }}
            />
          </label>
        );
      })}

      <div className={`gear-score ${offBand ? "is-off" : ""}`}>
        power {score}
        <span className="tuner-pct">
          {" "}
          / {draft.rarity} expects {band[0]}–{band[1]}
        </span>
      </div>

      {GEAR_STAT_KEYS.map((key) => {
        const value = draft.statMods[key] ?? 0;
        const info = explainStat(key, value || RANGE[key].step * 10, DEFAULT_BALANCE);
        return (
          <div key={key} className="gear-stat">
            <label onClick={() => setOpenStat(openStat === key ? null : key)}>
              {key} +{value}
              <span className={`gear-scaling scaling-${info.scaling}`}>{info.scaling}</span>
              <input
                type="range"
                min={RANGE[key].min}
                max={RANGE[key].max}
                step={RANGE[key].step}
                value={value}
                onChange={(e) => setStat(key, Number(e.target.value))}
                onFocus={() => setOpenStat(key)}
              />
            </label>
            {openStat === key && (
              <div className="gear-explain">
                <p className="gear-marginal">{info.marginal}</p>
                <p className="admin-hint">{info.matters}</p>
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className={dirty ? "admin-danger" : "admin-revert"} onClick={save} disabled={!dirty}>
        {dirty ? "Save item to JSON" : "No changes"}
      </button>
    </div>
  );
}
