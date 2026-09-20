import { useEffect, useMemo, useState } from "react";
import type { BodyType, GearDefinition, GearStat, Rarity } from "../../../src/engine/types.js";
import { ALLOCATABLE_STATS, GEAR_STAT_KEYS, RARITIES } from "../../../src/engine/types.js";
import { DEFAULT_BALANCE } from "../../../src/engine/balance.js";
import { explainStat, powerScore, RARITY_POWER_BAND } from "../../../src/engine/statGuide.js";
import { SLOT_FOLDER, spriteForGear, spriteUrl } from "../sprites.js";
import { adminFetch } from "../adminKey.js";

/**
 * Sensible drag ranges per gear stat.
 *
 * Only four, because gear may only grant what a player can also allocate (see
 * GEAR_STAT_KEYS). Speed and crit are engine stats — speed decides initiative
 * and separates the roles, crit lets an encounter spike — but neither is an
 * item roll, and the schema rejects them.
 */
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

export interface GearTunerProps {
  gear: GearDefinition[];
  onSaved: () => void;
  setStatus: (message: string) => void;
}

/**
 * Author one gear item: whether it exists, who can wear it, what it is called,
 * and what it does.
 *
 * The stat sliders carry a live explanation of what each point is actually
 * worth, computed from the balance config rather than written down (see
 * src/engine/statGuide.ts). That is here because the numbers are genuinely not
 * comparable to each other — ten armour is not ten HP is not ten skill — and an
 * editor that showed six identical sliders would invite exactly the mistake it
 * should prevent.
 */
export function GearTuner({ gear, onSaved, setStatus }: GearTunerProps): JSX.Element {
  const [slot, setSlot] = useState<string>("top");
  const [id, setId] = useState("");
  const [draft, setDraft] = useState<GearDefinition | null>(null);
  const [openStat, setOpenStat] = useState<GearStat | null>("hp");

  const inSlot = useMemo(() => gear.filter((g) => g.slot === slot), [gear, slot]);
  const selected = useMemo(() => gear.find((g) => g.id === id), [gear, id]);

  useEffect(() => {
    if (!inSlot.some((g) => g.id === id)) setId(inSlot[0]?.id ?? "");
  }, [inSlot, id]);

  useEffect(() => {
    if (selected) setDraft(structuredClone(selected));
  }, [selected]);

  if (!draft) return <p className="admin-hint">No gear in this slot.</p>;

  const patch = (next: Partial<GearDefinition>) => setDraft({ ...draft, ...next });
  const setStat = (key: GearStat, value: number) => {
    const mods = { ...draft.statMods };
    // Zero means "this item does not touch that stat", so it is removed rather
    // than stored — otherwise every item accumulates six explicit zeroes.
    if (value === 0) delete mods[key];
    else mods[key] = value;
    patch({ statMods: mods });
  };

  const bodies: BodyType[] = draft.bodyTypes ?? ["male", "female"];
  const toggleBody = (body: BodyType) => {
    const next = bodies.includes(body) ? bodies.filter((b) => b !== body) : [...bodies, body];
    // Never let it reach zero: an item wearable by nobody is indistinguishable
    // from a disabled one, and there is already a switch for that.
    if (next.length === 0) return;
    patch({ bodyTypes: next.length === 2 ? undefined : next });
  };

  const score = powerScore(draft.statMods, DEFAULT_BALANCE);
  const band = RARITY_POWER_BAND[draft.rarity] ?? [0, 999];
  const offBand = score < band[0] ? "under" : score > band[1] ? "over" : null;

  const folder = SLOT_FOLDER[draft.slot];
  const sprite = spriteForGear(draft, bodies[0] ?? "male");

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

  const dirty = JSON.stringify(draft) !== JSON.stringify(selected);

  return (
    <div className="tuner">
      <div className="tuner-controls">
        <label>
          Slot
          <select value={slot} onChange={(e) => setSlot(e.target.value)}>
            {[...new Set(gear.map((g) => g.slot))].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          Item
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {inSlot.map((g) => (
              <option key={g.id} value={g.id}>
                {g.enabled === false ? "○ " : ""}
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-check">
          <input
            type="checkbox"
            checked={draft.enabled !== false}
            onChange={(e) => patch({ enabled: e.target.checked ? undefined : false })}
          />
          Enabled
        </label>
        <p className="admin-hint">
          Disabled items stay in shop and loot files but stop dropping, selling and being equipped.
        </p>

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
          <textarea
            rows={2}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
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

        <h3 className="sub-heading">Requires</h3>
        <p className="admin-hint">
          Points the wearer must have SPENT. Gear cannot lift you into more gear — only your own
          allocation counts. At 2 points a level, 40 here is a level-20 specialist.
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

        <button type="button" className={dirty ? "admin-danger" : "admin-revert"} onClick={save} disabled={!dirty}>
          {dirty ? "Save to JSON" : "No changes"}
        </button>
      </div>

      <div className="tuner-readout">
        <div className="gear-head">
          {folder && sprite && <img className="gear-preview" src={spriteUrl(folder, sprite)} alt="" />}
          <div>
            <div className={`gear-score ${offBand ? "is-off" : ""}`}>
              power {score}
              <span className="tuner-pct">
                {" "}
                / {draft.rarity} expects {band[0]}–{band[1]}
              </span>
            </div>
            {offBand && (
              <p className="admin-warn">
                This item is {offBand}-powered for its rarity. Rough guide only — real value depends on who wears it.
              </p>
            )}
          </div>
        </div>

        <h3 className="sub-heading">Stats — click one to see what it is worth</h3>
        {GEAR_STAT_KEYS.map((key) => {
          const value = draft.statMods[key] ?? 0;
          const info = explainStat(key, value || RANGE[key].step * 10, DEFAULT_BALANCE);
          return (
            <div key={key} className="gear-stat">
              <label onClick={() => setOpenStat(key)}>
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
                  <p>{info.what}</p>
                  <p className="gear-marginal">{info.marginal}</p>
                  <p className="admin-hint">{info.matters}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
