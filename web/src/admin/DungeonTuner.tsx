import { useEffect, useMemo, useState } from "react";
import type { DungeonDefinition, EnemyUnit, PartyBand, Role, StatKey } from "../../../src/engine/types.js";
import { PARTY_BANDS, ROLES } from "../../../src/engine/types.js";
import { BAND_SAMPLE_PARTY, BAND_THRESHOLDS } from "../../../src/engine/squad.js";
import { BACKGROUNDS, ENEMY_SPRITES, FOREGROUNDS } from "./encounterArt.js";
import { enemySpriteUrl } from "../sprites.js";
import { SpriteEraser } from "./SpriteEraser.js";
import { FormationField } from "./FormationEditor.js";
import { BalancePanel, useDraftDifficulty } from "./DraftDifficulty.js";
import { RoleIcon } from "../components/RoleIcon.js";
import "./encounter.css";
import { adminFetch } from "../adminKey.js";

/**
 * Which stats get a slider, and the range each is worth dragging over.
 *
 * Tucked behind Settings because, measured, five of the six cannot change a
 * fight's outcome — pushed to maximum one at a time they moved a 100% win to
 * at best 95%. Squad size, roles and pressure decide fights; these decide how
 * long one takes.
 */
// Ranges scaled with the stat model. Armour is gone — Skill carries the
// mitigation curve now — and every number came down by roughly a quarter when
// a level-1 character stopped opening with 70 health.
const STAT_RANGE: Record<StatKey, { min: number; max: number; step: number }> = {
  hp: { min: 1, max: 150, step: 1 },
  atk: { min: 0, max: 20, step: 1 },
  spd: { min: 1, max: 12, step: 1 },
  skill: { min: 0, max: 25, step: 1 },
  crit: { min: 0, max: 0.6, step: 0.01 },
};
const STAT_ORDER: StatKey[] = ["hp", "atk", "spd", "skill", "crit"];

/**
 * What a role is called on this screen.
 *
 * The engine's three roles, named for what they DO in a fight rather than for
 * the MMO archetype — an author placing an enemy line thinks "who stands at the
 * front", not "which of these is the tank".
 */
const ROLE_LABEL: Record<Role, string> = {
  tank: "Frontliner",
  dps: "Ranged",
  healer: "Support",
};

/** A level's shorthand, so the tabs read as difficulty rather than as numbers. */
const LEVEL_TONE = ["Easy", "Normal", "Normal+", "Hard", "Hard+", "Boss"];

/** Compact thresholds for the tab: "1.2k–2k" beats "1200–2000" at this size. */
function short(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n);
}
function bandRange(band: PartyBand): string {
  const from = BAND_THRESHOLDS[band];
  const next = PARTY_BANDS[PARTY_BANDS.indexOf(band) + 1];
  return next ? `${short(from)}–${short(BAND_THRESHOLDS[next])}` : `${short(from)}+`;
}

export interface DungeonTunerProps {
  dungeons: DungeonDefinition[];
  onSaved: () => void;
  setStatus: (message: string) => void;
}

/**
 * Author one dungeon: who is in it, where they stand, and how hard it hits.
 *
 * Three columns, and the split is deliberate. The left is WHAT the fight is
 * made of, the middle is what it LOOKS like, the right is what it PLAYS like.
 * The screen this replaced interleaved all three, so a control and the number
 * it moved were routinely in different halves of the page and the connection
 * between them was invisible.
 */
export function DungeonTuner({ dungeons, onSaved, setStatus }: DungeonTunerProps): JSX.Element {
  const [id, setId] = useState(dungeons[0]?.id ?? "");
  const [draft, setDraft] = useState<DungeonDefinition | null>(null);
  const [band, setBand] = useState<PartyBand>("weak");
  const [view, setView] = useState<"preview" | "balance" | "settings">("preview");
  const [group, setGroup] = useState<string>(Object.keys(ENEMY_SPRITES)[0] ?? "");
  const [adding, setAdding] = useState(false);
  const [editingArt, setEditingArt] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [artVersion, setArtVersion] = useState(0);
  // Alignment guides over the field. Off by default; the scene is the thing.
  const [grid, setGrid] = useState(false);

  const difficulty = useDraftDifficulty(draft);
  const selected = useMemo(() => dungeons.find((d) => d.id === id), [dungeons, id]);

  useEffect(() => {
    if (selected) setDraft(structuredClone(selected));
  }, [selected]);
  useEffect(() => {
    if (!dungeons.some((d) => d.id === id)) setId(dungeons[0]?.id ?? "");
  }, [dungeons, id]);

  if (!draft) return <p className="admin-hint">No dungeons loaded.</p>;

  const patch = (next: Partial<DungeonDefinition>) => setDraft({ ...draft, ...next });
  const units: EnemyUnit[] = draft.formations?.[band] ?? [];
  const setUnits = (next: EnemyUnit[]) =>
    patch({ formations: { ...draft.formations, [band]: next } });
  const patchUnit = (unitId: string, next: Partial<EnemyUnit>) =>
    setUnits(units.map((u) => (u.id === unitId ? { ...u, ...next } : u)));

  const reading = difficulty.readings[band];
  const sample = BAND_SAMPLE_PARTY[band];
  const levelNo = PARTY_BANDS.indexOf(band) + 1;
  const dirty = JSON.stringify(draft) !== JSON.stringify(selected);

  const write = async (data: DungeonDefinition, what: string) => {
    const res = await adminFetch("/content/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "dungeon", id: data.id, data }),
    });
    const body = await res.json();
    setStatus(body.ok ? what : `Rejected: ${body.message}`);
    if (body.ok) onSaved();
    return body.ok as boolean;
  };

  const addUnit = (sprite: string, name: string) => {
    const unitId = `u${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    setUnits([...units, { id: unitId, sprite, name, role: "dps", x: 0.5, y: 0.78 }]);
    setSelectedUnit(unitId);
    setAdding(false);
  };

  const pressure = units.length
    ? units.reduce((sum, u) => sum + (u.weight ?? 1), 0) / units.length
    : 1;

  return (
    <div className="enc">
      {/* --- top bar ------------------------------------------------------ */}
      <header className="enc-bar">
        <span className="enc-crumb">Dungeons</span>
        <label className="enc-picker">
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {dungeons.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.id}
              </option>
            ))}
          </select>
        </label>
        <span className="enc-bar-spacer" />
        <span className={`enc-savestate ${dirty ? "is-dirty" : ""}`}>
          <span className="enc-dot" />
          {dirty ? "Unsaved changes" : "Saved"}
        </span>
        <button
          type="button"
          onClick={() => {
            const fresh = {
              ...structuredClone(draft),
              id: `enc-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
              name: `${draft.name} copy`,
            };
            void write(fresh, `Created ${fresh.id}.`).then((ok) => ok && setId(fresh.id));
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="enc-save"
          disabled={!dirty}
          onClick={() => void write(draft, `Saved ${draft.name}.`)}
        >
          {dirty ? "Save Dungeon" : "No changes"}
        </button>
      </header>

      <div className="enc-body">
        {/* --- left: what the fight is made of --------------------------- */}
        <aside className="enc-col enc-left">
          <h2 className="enc-h">Fight setup</h2>

          <div className="enc-row">
            <strong>Enemy Squad</strong>
            <span className="enc-count">{units.length} units</span>
          </div>

          <button type="button" className="enc-add" onClick={() => setAdding((v) => !v)}>
            + Add Unit
          </button>

          {adding && (
            <div className="enc-addpanel">
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                {Object.keys(ENEMY_SPRITES).map((g) => (
                  <option key={g} value={g}>
                    {g} ({ENEMY_SPRITES[g]?.length ?? 0})
                  </option>
                ))}
              </select>
              <div className="enemy-picker">
                {(ENEMY_SPRITES[group] ?? []).map((sid) => (
                  <div key={sid} className="enemy-pick">
                    <button type="button" onClick={() => addUnit(`${group}/${sid}`, sid)} title={sid}>
                      <img key={artVersion} src={enemySpriteUrl(`${group}/${sid}`)} alt={sid} />
                    </button>
                    <button
                      type="button"
                      className="enemy-pick-edit"
                      onClick={() => setEditingArt(`${group}/${sid}`)}
                      title={`Edit ${sid} pixels`}
                    >
                      edit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h3 className="enc-sub">Current squad</h3>
          <ul className="enc-squad">
            {units.map((u, i) => (
              <li
                key={u.id}
                className={u.id === selectedUnit ? "is-selected" : ""}
                onClick={() => setSelectedUnit(u.id)}
              >
                <span className="enc-squad-n">{i + 1}</span>
                <img src={enemySpriteUrl(u.sprite)} alt="" />
                <span className="enc-squad-name">
                  <input
                    value={u.name ?? u.sprite.split("/")[1] ?? ""}
                    onChange={(e) => patchUnit(u.id, { name: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <small className={`role-${u.role ?? "none"}`}>{u.role ? ROLE_LABEL[u.role] : "Plain"}</small>
                </span>
                <button
                  type="button"
                  className="enc-squad-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    setUnits(units.filter((x) => x.id !== u.id));
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
            {units.length === 0 && <li className="admin-hint">No units at this level yet.</li>}
          </ul>

          {selectedUnit && units.some((u) => u.id === selectedUnit) && (
            <div className="enc-unitedit">
              <div className="formation-roles">
                {/*
                  "Plain" is a real choice, not an absence. A body with no role
                  gets no role scaling, no skill floor and no threat multiplier
                  — measurably weaker — and every counted body in the game was
                  one before fights owned their own units. Making it selectable
                  is what lets an author see that, and change it deliberately.
                */}
                <button
                  type="button"
                  className={units.find((u) => u.id === selectedUnit)?.role === undefined ? "is-active" : ""}
                  onClick={() => patchUnit(selectedUnit, { role: undefined })}
                >
                  Plain
                </button>
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={units.find((u) => u.id === selectedUnit)?.role === r ? "is-active" : ""}
                    onClick={() => patchUnit(selectedUnit, { role: r })}
                  >
                    <RoleIcon role={r} size={14} /> {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
              <label>
                size {(units.find((u) => u.id === selectedUnit)?.scale ?? 1).toFixed(2)}
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={units.find((u) => u.id === selectedUnit)?.scale ?? 1}
                  onChange={(e) => patchUnit(selectedUnit, { scale: Number(e.target.value) })}
                />
              </label>
            </div>
          )}

          <h2 className="enc-h">Scene</h2>
          <label>
            Background
            <select
              value={draft.background ?? ""}
              onChange={(e) => patch({ background: e.target.value || undefined })}
            >
              <option value="">none</option>
              {BACKGROUNDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label>
            Foreground
            <select
              value={draft.foreground ?? ""}
              onChange={(e) => patch({ foreground: e.target.value || undefined })}
            >
              <option value="">none</option>
              {FOREGROUNDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <h2 className="enc-h">
            Fight pressure
            <span className="enc-help" title="How often this squad acts, against one action for an ordinary fighter. The only lever that reaches far enough to decide a fight.">
              ?
            </span>
          </h2>
          <div className="enc-pressure">
            <span>Calm</span>
            <strong>{pressure.toFixed(1)}x</strong>
            <span>Brutal</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={16}
            step={0.1}
            value={pressure}
            disabled={units.length === 0}
            onChange={(e) => setUnits(units.map((u) => ({ ...u, weight: Number(e.target.value) })))}
          />
          <p className="admin-hint">Higher pressure makes this squad act more frequently.</p>
        </aside>

        {/* --- middle: what it looks like -------------------------------- */}
        <main className="enc-col enc-main">
          <div className="enc-title">
            <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            <p className="admin-hint">
              {draft.kind === "boss" ? "Boss fight" : "Dungeon"} · ID: <code>{draft.id}</code>
            </p>
          </div>

          {/* Levels. Each carries its own verdict, because a level and how it
              plays are one thing — separating them is what made the old screen
              feel like two unrelated lists. */}
          <div className="enc-levelrow">
            <span className="enc-levellabel">Level</span>
            <div className="enc-levels">
            {PARTY_BANDS.map((b, i) => {
              const r = difficulty.readings[b];
              const n = (draft.formations?.[b] ?? []).length;
              const tone = !r ? "" : r.winRate > 0.7 ? "is-easy" : r.winRate < 0.45 ? "is-hard" : "is-good";
              return (
                <button
                  key={b}
                  type="button"
                  className={`${b === band ? "is-active" : ""} ${tone} ${n === 0 ? "is-empty" : ""}`}
                  onClick={() => setBand(b)}
                  title={`Party rating ${bandRange(b)} — ${n} units`}
                >
                  <span className="enc-level-n">{i + 1}</span>
                  <small>{bandRange(b)}</small>
                  <small className={difficulty.busy ? "is-stale" : ""}>
                    {r ? `${Math.round(r.winRate * 100)}%` : LEVEL_TONE[i]}
                  </small>
                </button>
              );
            })}
            </div>
            <div className="enc-views">
              {(["preview", "balance", "settings"] as const).map((v) => (
                <button key={v} type="button" className={view === v ? "is-active" : ""} onClick={() => setView(v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {view === "preview" && (
            <>
              <div className="enc-toolbar">
                <button
                  type="button"
                  className={grid ? "is-active" : ""}
                  onClick={() => setGrid((g) => !g)}
                >
                  Grid
                </button>
                <span className="enc-bar-spacer" />
                <button
                  type="button"
                  onClick={() =>
                    setUnits(
                      // Spread evenly along the back, which is where a squad
                      // that has been dragged into a corner needs to start from.
                      units.map((u, i) => ({
                        ...u,
                        x: units.length === 1 ? 0.5 : 0.12 + (i / Math.max(1, units.length - 1)) * 0.76,
                        y: 0.78,
                      })),
                    )
                  }
                  disabled={units.length === 0}
                >
                  Reset positions
                </button>
              </div>
              <FormationField
                grid={grid}
                units={units}
                onUnits={setUnits}
                background={draft.background}
                selected={selectedUnit}
                onSelect={setSelectedUnit}
              />
              <p className="enc-tip">Drag units to reposition. Select a unit to edit its properties.</p>
            </>
          )}

          {view === "balance" && (
            <BalancePanel
              gear={difficulty.gear}
              onGear={difficulty.setGear}
              busy={difficulty.busy}
              error={difficulty.error}
            />
          )}

          {view === "settings" && (
            <div className="enc-settings">
              <p className="admin-hint">
                One stat block for the whole squad — a unit&apos;s role bends it. Worth knowing:
                hp, armour, spd, skill and crit change how LONG a fight runs far more than who
                wins it. Squad size, roles and pressure decide the outcome.
              </p>
              {STAT_ORDER.map((key) => (
                <label key={key}>
                  {key} {key === "crit" ? `${Math.round(draft.stats[key] * 100)}%` : Math.round(draft.stats[key])}
                  <input
                    type="range"
                    min={STAT_RANGE[key].min}
                    max={STAT_RANGE[key].max}
                    step={STAT_RANGE[key].step}
                    value={draft.stats[key]}
                    onChange={(e) => setDraft({ ...draft, stats: { ...draft.stats, [key]: Number(e.target.value) } })}
                  />
                </label>
              ))}
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={draft.kind === "boss"}
                  onChange={(e) => patch({ kind: e.target.checked ? "boss" : "mob" })}
                />
                Boss
              </label>
              <label>
                xp reward {draft.xpReward}
                <input
                  type="range"
                  min={0}
                  max={400}
                  value={draft.xpReward}
                  onChange={(e) => patch({ xpReward: Number(e.target.value) })}
                />
              </label>
            </div>
          )}

          {editingArt && (
            <SpriteEraser
              folder={`enemies/${editingArt.split("/")[0]}`}
              id={editingArt.split("/")[1] ?? ""}
              onClose={() => setEditingArt(null)}
              setStatus={setStatus}
              onChanged={() => setArtVersion((n) => n + 1)}
            />
          )}
        </main>

        {/* --- right: what it plays like --------------------------------- */}
        <aside className="enc-col enc-right">
          <h2 className="enc-h">Fight info</h2>
          <dl className="enc-facts">
            <dt>Level</dt>
            <dd>{levelNo}</dd>
            <dt>Total units</dt>
            <dd>{units.length}</dd>
            <dt>Fight rating</dt>
            <dd>{reading?.enemyRating?.toLocaleString() ?? "…"}</dd>
            <dt>XP reward</dt>
            <dd>{draft.xpReward}</dd>
            <dt>Win rate (expected)</dt>
            <dd>{reading ? `${Math.round(reading.winRate * 100)}%` : "…"}</dd>
          </dl>

          <h2 className="enc-h">Balance overview</h2>
          <dl className="enc-facts">
            <dt>Expected party</dt>
            <dd>{sample.size} players</dd>
            <dt>Party rating</dt>
            <dd>{bandRange(band)}</dd>
          </dl>

          <div className={`enc-verdict ${difficulty.busy ? "is-stale" : ""}`}>
            <strong>{reading ? `${Math.round(reading.winRate * 100)}%` : "…"}</strong>
            <span>
              {!reading
                ? "measuring"
                : reading.winRate > 0.7
                  ? "Too easy"
                  : reading.winRate < 0.45
                    ? "Too hard"
                    : "Good challenge"}
            </span>
            {/* The target band drawn on the bar, so the reading is a position
                rather than a number to interpret. */}
            <div className="diff-bar">
              <span className="diff-bar-fill" style={{ width: `${(reading?.winRate ?? 0) * 100}%` }} />
              <span className="diff-bar-target" />
            </div>
          </div>

          <dl className="enc-facts">
            <dt>Pressure</dt>
            <dd>{pressure.toFixed(1)}x</dd>
          </dl>

          <h2 className="enc-h">Actions</h2>
          <button
            type="button"
            onClick={() => {
              const blob = JSON.stringify(draft, null, 2);
              void navigator.clipboard?.writeText(blob);
              setStatus(`Copied ${draft.id} to the clipboard.`);
            }}
          >
            Copy dungeon JSON
          </button>
          <button
            type="button"
            className="admin-danger"
            onClick={async () => {
              const attempt = (force: boolean) =>
                adminFetch("/content/delete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ kind: "dungeon", id: draft.id, force }),
                }).then((r) => r.json());
              if (!window.confirm(`Delete "${draft.name}" (${draft.id})?`)) return;
              let body = await attempt(false);
              if (!body.ok && body.references?.length) {
                const where = body.references.map((r: { file: string }) => r.file).join(", ");
                if (!window.confirm(`Still used by ${where}. Remove it from those too?`)) {
                  return setStatus("Delete cancelled — nothing changed.");
                }
                body = await attempt(true);
              }
              setStatus(body.ok ? `Deleted ${draft.id}.` : `Rejected: ${body.message}`);
              if (body.ok) onSaved();
            }}
          >
            Delete dungeon
          </button>
        </aside>
      </div>
    </div>
  );
}
