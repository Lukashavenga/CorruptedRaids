import { useEffect, useMemo, useState } from "react";
import type { DungeonDefinition, EnemyUnit, PartyBand, Role, StatKey } from "../../../src/engine/types.js";
import { PARTY_BANDS, ROLES } from "../../../src/engine/types.js";
import { BAND_SAMPLE_PARTY, BAND_THRESHOLDS } from "../../../src/engine/squad.js";
import { BACKGROUNDS, ENEMY_SPRITES, FOREGROUNDS } from "./encounterArt.js";
import { enemySpriteUrl } from "../sprites.js";
import { SpriteEraser } from "./SpriteEraser.js";
import { FormationField } from "./FormationEditor.js";
import { BalancePanel, useDraftDifficulty } from "./DraftDifficulty.js";
import { StrengthBadge, StrengthPicker } from "./Strength.js";
import { DEFAULT_TARGET_WIN, SCALE_MIN, TARGET_TOLERANCE } from "../../../src/engine/bandSearch.js";
import type { BandSolution } from "../../../src/engine/bandSolver.js";
import { RoleIcon } from "../components/RoleIcon.js";
import "./encounter.css";
import { deleteContent, solveLevel, writeContent } from "./backend.js";

/**
 * What the pressure dial can say, and why it is not what it used to say.
 *
 * It ran 0.5 to 16. Measured on monks at Level 3 against twelve viewers, one
 * action a turn each: 1.0x wins 57%, 1.1x wins 44%, 1.25x wins 26%, 1.5x wins
 * 10%, 2.0x wins 1%, and everything above that is 0%. So roughly nine tenths
 * of that slider's travel gave the same answer - everybody dies - and the part
 * that tuned anything was a few pixels wide, which is how a dial ends up being
 * dragged to 2.8 by somebody reasonably assuming the middle meant "medium".
 *
 * 2.0 is the end of the scale because the measurement says there is nothing
 * past it. Steps of 0.05 because 0.1 is a 13-point swing in win rate here.
 *
 * CONTENT AUTHORED ABOVE IT IS SHOWN, NOT CLAMPED. poors' Level 1 sits at 2.8x
 * and a raid room at 5.3x. An `<input type="range">` renders an out-of-range
 * value pinned at its maximum and then writes that maximum back the first time
 * anybody touches it, so a slider that cannot draw a number would quietly
 * destroy it. The over-range case gets a readout and an explicit button
 * instead.
 */
const PRESSURE_MIN = 0.5;
const PRESSURE_MAX = 2;
/** Past here, measured, most parties lose outright. Worth saying out loud. */
const PRESSURE_CAUTION = 1.5;

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

/**
 * Where a win rate sits against THIS fight's target.
 *
 * Relative, where it used to be fixed at 45-70% for every dungeon. That made a
 * starter dungeon aiming at 85% read "Too easy" on every tab forever, and the
 * hardest place in the game read "Good challenge" while sitting a whole band
 * off what it was solved for - the screen argued with its own solver.
 */
function verdictOf(win: number, target: number): "good" | "easy" | "hard" {
  if (win > target + TARGET_TOLERANCE) return "easy";
  if (win < target - TARGET_TOLERANCE) return "hard";
  return "good";
}

const VERDICT_WORDS = { good: "On target", easy: "Too easy", hard: "Too hard" } as const;

/** A target, said the way a streamer would say it. */
function targetPhrase(t: number): string {
  if (t >= 0.85) return "A fresh chat wins nearly every night.";
  if (t >= 0.72) return "Usually won - somebody always goes down.";
  if (t >= 0.6) return "A real fight. Lost about one night in three.";
  if (t >= 0.5) return "A coin flip you usually take.";
  return "Mostly lost. Brutal on purpose.";
}

const GEAR_WORDS = { none: "no gear", typical: "some gear", best: "the best gear" } as const;

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
  /*
   * The level the solver is working on, or null.
   *
   * While set, the tabs stop re-measuring and the squad is locked. The solver
   * works from a snapshot of the draft and writes its answer back into the
   * draft when it finishes, so an edit made underneath it would be measured
   * against the wrong squad and then quietly kept beside a multiplier solved
   * for a different one.
   */
  const [solving, setSolving] = useState<PartyBand | null>(null);
  const [solveSteps, setSolveSteps] = useState(0);
  /** What the last solve said about each level - including WHY it stopped short. */
  const [solved, setSolved] = useState<Partial<Record<PartyBand, BandSolution>>>({});

  const difficulty = useDraftDifficulty(draft, { paused: solving !== null });
  const selected = useMemo(() => dungeons.find((d) => d.id === id), [dungeons, id]);

  useEffect(() => {
    if (selected) setDraft(structuredClone(selected));
    setSolved({});
  }, [selected]);
  useEffect(() => {
    if (!dungeons.some((d) => d.id === id)) setId(dungeons[0]?.id ?? "");
  }, [dungeons, id]);

  if (!draft) return <p className="admin-hint">No dungeons loaded.</p>;

  const patch = (next: Partial<DungeonDefinition>) => setDraft({ ...draft, ...next });
  const units: EnemyUnit[] = draft.formations?.[band] ?? [];
  const setUnits = (next: EnemyUnit[]) => {
    patch({ formations: { ...draft.formations, [band]: next } });
    // The last solve was for the old squad; its verdict no longer applies.
    setSolved((current) => {
      const { [band]: _stale, ...rest } = current;
      return rest;
    });
  };
  const patchUnit = (unitId: string, next: Partial<EnemyUnit>) =>
    setUnits(units.map((u) => (u.id === unitId ? { ...u, ...next } : u)));

  const reading = difficulty.readings[band];
  const sample = BAND_SAMPLE_PARTY[band];
  const levelNo = PARTY_BANDS.indexOf(band) + 1;
  const dirty = JSON.stringify(draft) !== JSON.stringify(selected);

  const write = async (data: DungeonDefinition, what: string) => {
    try {
      await writeContent("dungeon", data.id, data);
      setStatus(what);
      onSaved();
      return true;
    } catch (err) {
      setStatus(`Rejected: ${(err as Error).message}`);
      return false;
    }
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

  /** Sets every unit in this layout, which is what the one dial means. */
  const setPressure = (weight: number) => setUnits(units.map((u) => ({ ...u, weight })));

  // Content authored above the scale. Shown rather than clamped - see the note
  // on PRESSURE_MAX.
  const overPressured = pressure > PRESSURE_MAX + 0.001;
  const tempoIsSet = Math.abs(pressure - 1) > 0.001;

  const target = draft.targetWinRate ?? DEFAULT_TARGET_WIN;

  /** The multiplier a level runs at: the draft's own value, or what its reading used. */
  const scaleOf = (b: PartyBand): number | undefined => draft.bandStatScale?.[b] ?? difficulty.readings[b]?.scale;
  const setScale = (b: PartyBand, value: number) =>
    patch({ bandStatScale: { ...(draft.bandStatScale ?? {}), [b]: Number(value.toFixed(3)) } });

  /** The nearest level below that has a squad of its own - the one this level may not go under. */
  const levelBelow = (b: PartyBand): PartyBand | undefined => {
    for (let i = PARTY_BANDS.indexOf(b) - 1; i >= 0; i -= 1) {
      const below = PARTY_BANDS[i]!;
      if (draft.formations?.[below]?.length) return below;
    }
    return undefined;
  };

  /** Levels with a squad, in order - the ones there is anything to solve. */
  const solvable = PARTY_BANDS.filter((b) => (draft.formations?.[b]?.length ?? 0) > 0);

  /**
   * What a stuck solve means, in terms of what to change.
   *
   * The solver can only move the multiplier. When the multiplier cannot get
   * there, the fix is in the squad - and "floor" has two different causes that
   * want the same fix but deserve different explanations.
   */
  const boundText = (sol: BandSolution): string | null => {
    if (!sol.bound) return null;
    const n = PARTY_BANDS.indexOf(sol.band) + 1;
    if (sol.bound === "ceiling") {
      return `Still too easy at the strongest setting. Add a unit, or make one stronger.`;
    }
    const below = levelBelow(sol.band);
    if (below && sol.scale > SCALE_MIN + 1e-6) {
      const m = PARTY_BANDS.indexOf(below) + 1;
      return (
        `Too hard, and it can't be set easier than Level ${m} - a level set below the one beneath it gets ` +
        `easier as players get stronger. Remove a unit from Level ${n}, or make one weaker.`
      );
    }
    return `Too hard even at the weakest setting. Remove a unit, or make one weaker.`;
  };

  /**
   * Solve the given levels, in order, each floored on the one below.
   *
   * Works on a local copy of the draft and threads each answer into it before
   * solving the next level, because the next level's floor IS that answer -
   * reading it back out of React state would get the value from before this
   * render, one level behind.
   */
  const solveBands = async (bands: PartyBand[]) => {
    let working = draft;
    const results: BandSolution[] = [];
    try {
      for (const b of bands) {
        setSolving(b);
        setSolveSteps(0);
        const solution = await solveLevel(working, b, setSolveSteps);
        working = { ...working, bandStatScale: { ...(working.bandStatScale ?? {}), [b]: solution.scale } };
        setDraft((d) => (d ? { ...d, bandStatScale: { ...(d.bandStatScale ?? {}), [b]: solution.scale } } : d));
        difficulty.setReading(b, solution);
        setSolved((current) => ({ ...current, [b]: solution }));
        results.push(solution);
      }
      const stuck = results.filter((r) => r.bound).map((r) => `Level ${PARTY_BANDS.indexOf(r.band) + 1}`);
      const what = results.length === 1 ? `Level ${PARTY_BANDS.indexOf(results[0]!.band) + 1}` : `${results.length} levels`;
      setStatus(
        stuck.length === 0
          ? `Solved ${what} - on target. Save to keep it.`
          : `Solved ${what}. ${stuck.join(", ")} can't reach the target by strength alone - see the note under it.`,
      );
    } catch (err) {
      setStatus(`Solve stopped: ${(err as Error).message}`);
    } finally {
      setSolving(null);
    }
  };

  const scaleNow = scaleOf(band);
  const below = levelBelow(band);
  const belowScale = below ? scaleOf(below) : undefined;
  // A hand-nudged level under the one below: the difficulty curve then falls
  // across this whole level. Worth saying before it is saved.
  const falling = scaleNow !== undefined && belowScale !== undefined && scaleNow < belowScale - 1e-9;
  // Only while it still describes this level: a nudge or a squad edit since
  // the solve makes its verdict about a different fight.
  const note = solved[band] && solved[band]!.scale === scaleNow ? solved[band] : undefined;

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
          disabled={!dirty || solving !== null}
          onClick={() => void write(draft, `Saved ${draft.name}.`)}
        >
          {dirty ? "Save Dungeon" : "No changes"}
        </button>
      </header>

      <div className={`enc-body ${solving ? "is-locked" : ""}`}>
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
                  <small className={`role-${u.role ?? "none"}`}>
                    {u.role ? ROLE_LABEL[u.role] : "Plain"} <StrengthBadge value={u.strength} />
                  </small>
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
                  - measurably weaker - and every counted body in the game was
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
              <StrengthPicker
                value={units.find((u) => u.id === selectedUnit)?.strength}
                onChange={(next) => patchUnit(selectedUnit, { strength: next })}
              />
              <label>
                sprite size {(units.find((u) => u.id === selectedUnit)?.scale ?? 1).toFixed(2)}
                <small className="admin-hint"> - how big it is drawn. Looks only; Strength is what fights.</small>
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

          {/*
            Tempo was "Fight pressure", top level, beside the squad - which read
            as the main difficulty dial, and it is the one with the least
            usable range. It lives under Advanced now, and opens itself when a
            level has it set, so a 2.8x nobody remembers cannot hide in here.
          */}
          <details className="enc-advanced" open={tempoIsSet ? true : undefined}>
          <summary>Advanced: tempo{tempoIsSet ? ` (${pressure.toFixed(2)}x)` : ""}</summary>
          <h2 className="enc-h">
            Tempo
            <span
              className="enc-help"
              title="How often this squad takes a turn, against one turn for an ordinary fighter. It reaches further than any other lever, which is exactly why its useful range is narrow."
            >
              ?
            </span>
          </h2>
          {overPressured ? (
            <div className="enc-pressure-over">
              <strong>{pressure.toFixed(1)}x</strong>
              <p className="admin-warn">
                Set above this slider&apos;s range. Measured, a squad acting twice as often as
                everyone else wins essentially every fight, so the scale stops at {PRESSURE_MAX}x
                rather than pretending the rest of it tunes anything.
              </p>
              <button type="button" className="enc-pressure-fix" onClick={() => setPressure(PRESSURE_MAX)}>
                Bring into range ({PRESSURE_MAX.toFixed(1)}x)
              </button>
            </div>
          ) : (
            <>
              <div className="enc-pressure">
                <span>Calm</span>
                <strong>{pressure.toFixed(2)}x</strong>
                <span>Wipe</span>
              </div>
              <input
                type="range"
                min={PRESSURE_MIN}
                max={PRESSURE_MAX}
                step={0.05}
                value={pressure}
                disabled={units.length === 0}
                onChange={(e) => setPressure(Number(e.target.value))}
              />
              {pressure > PRESSURE_CAUTION && (
                <p className="admin-warn">Past {PRESSURE_CAUTION}x most parties lose this fight outright.</p>
              )}
              <p className="admin-hint">
                1.0x is one action a turn, the same as anybody else. Measured on monks at Level 3
                against twelve viewers: 1.0x wins 57%, 1.1x wins 44%, 1.25x wins 26%, 1.5x wins
                10%, 2.0x wins 1%. Use Strength and Solve first - this is the last tenth.
              </p>
            </>
          )}
          </details>
        </aside>

        {/* --- middle: what it looks like -------------------------------- */}
        <main className="enc-col enc-main">
          <div className="enc-title">
            <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            <p className="admin-hint">
              {draft.kind === "boss" ? "Boss fight" : "Dungeon"} · ID: <code>{draft.id}</code>
            </p>
          </div>

          {/*
            The one difficulty number an author sets. Everything below it is
            either the fight's shape (who is in it) or the solver's answer.
          */}
          <div className="enc-target">
            <label>
              <span className="enc-target-label">Target win rate</span>
              <input
                type="range"
                min={0.4}
                max={0.95}
                step={0.01}
                value={target}
                disabled={solving !== null}
                onChange={(e) => patch({ targetWinRate: Number(e.target.value) })}
              />
              <strong>{Math.round(target * 100)}%</strong>
            </label>
            <span className="enc-target-says">{targetPhrase(target)}</span>
            <button
              type="button"
              className="enc-solve"
              disabled={solving !== null || solvable.length === 0}
              onClick={() => void solveBands(solvable)}
              title="Set every level's strength so it lands on the target. Your squads are left exactly as drawn."
            >
              {solving ? `Solving level ${PARTY_BANDS.indexOf(solving) + 1}...` : "Solve all levels"}
            </button>
          </div>

          {/* Levels. Each carries its own verdict, because a level and how it
              plays are one thing - separating them is what made the old screen
              feel like two unrelated lists. */}
          <div className="enc-levelrow">
            <span className="enc-levellabel">Level</span>
            <div className="enc-levels">
            {PARTY_BANDS.map((b, i) => {
              const r = difficulty.readings[b];
              const n = (draft.formations?.[b] ?? []).length;
              const tone = !r ? "" : `is-${verdictOf(r.winRate, target)}`;
              return (
                <button
                  key={b}
                  type="button"
                  className={`${b === band ? "is-active" : ""} ${tone} ${n === 0 ? "is-empty" : ""}`}
                  onClick={() => setBand(b)}
                  title={`Party rating ${bandRange(b)} - ${n} units`}
                >
                  <span className="enc-level-n">{i + 1}</span>
                  <small>{n === 0 ? "no units" : `${n} ${n === 1 ? "unit" : "units"}`}</small>
                  <small className={difficulty.busy && solving !== b ? "is-stale" : ""}>
                    {solving === b ? "solving..." : r ? `${Math.round(r.winRate * 100)}%` : LEVEL_TONE[i]}
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
                One stat block for the whole squad - a unit&apos;s role bends it. Worth knowing:
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
          <h2 className="enc-h">Level {levelNo}</h2>
          <p className="admin-hint">
            Met by {sample.size} players rated {bandRange(band)} - level {sample.level}, {GEAR_WORDS[sample.gear]}.
          </p>

          <div
            className={`enc-verdict is-${reading ? verdictOf(reading.winRate, target) : "none"} ${
              difficulty.busy && solving !== band ? "is-stale" : ""
            }`}
          >
            <strong>{solving === band ? "..." : reading ? `${Math.round(reading.winRate * 100)}%` : "..."}</strong>
            <span>
              {solving === band
                ? "solving"
                : !reading
                  ? "measuring"
                  : `${VERDICT_WORDS[verdictOf(reading.winRate, target)]} - aiming for ${Math.round(target * 100)}%`}
            </span>
            {/* The target drawn on the bar, so the reading is a position rather
                than a number to interpret. */}
            <div className="diff-bar">
              <span className="diff-bar-fill" style={{ width: `${(reading?.winRate ?? 0) * 100}%` }} />
              <span
                className="diff-bar-target"
                style={{
                  left: `${Math.max(0, target - TARGET_TOLERANCE) * 100}%`,
                  width: `${(Math.min(1, target + TARGET_TOLERANCE) - Math.max(0, target - TARGET_TOLERANCE)) * 100}%`,
                }}
              />
            </div>
          </div>

          <h3 className="enc-sub">Level strength</h3>
          <div className="enc-strength">
            <button
              type="button"
              disabled={scaleNow === undefined || solving !== null}
              onClick={() => scaleNow !== undefined && setScale(band, scaleNow / 1.05)}
            >
              -5%
            </button>
            <strong>
              {scaleNow === undefined ? "..." : `x${scaleNow < 10 ? scaleNow.toFixed(2) : scaleNow.toFixed(1)}`}
            </strong>
            <button
              type="button"
              disabled={scaleNow === undefined || solving !== null}
              onClick={() => scaleNow !== undefined && setScale(band, scaleNow * 1.05)}
            >
              +5%
            </button>
          </div>
          <p className="admin-hint">
            Every enemy&apos;s health and attack at this level. Solve sets it; a 5% nudge can move the win
            rate twenty points, so nudge sparingly.
          </p>
          <button
            type="button"
            className="enc-solve"
            disabled={solving !== null || units.length === 0}
            title={units.length === 0 ? "This level has no units of its own to solve." : undefined}
            onClick={() => void solveBands([band])}
          >
            {solving === band ? `Solving... ${solveSteps} readings` : `Solve level ${levelNo}`}
          </button>
          {note && boundText(note) && <p className="enc-bound">{boundText(note)}</p>}
          {falling && below && (
            <p className="admin-warn">
              Set below Level {PARTY_BANDS.indexOf(below) + 1}. Across this level the fight would get easier as
              players get stronger. Solve puts it back.
            </p>
          )}

          <dl className="enc-facts">
            <dt>Enemies</dt>
            <dd>{units.length}</dd>
            <dt>Squad rating</dt>
            <dd>{reading?.enemyRating ? Math.round(reading.enemyRating).toLocaleString() : "..."}</dd>
            <dt>XP reward</dt>
            <dd>{draft.xpReward}</dd>
            {tempoIsSet && (
              <>
                <dt>Tempo</dt>
                <dd>{pressure.toFixed(2)}x</dd>
              </>
            )}
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
              if (!window.confirm(`Delete "${draft.name}" (${draft.id})?`)) return;
              try {
                let body = await deleteContent("dungeon", draft.id, false);
                if (!body.ok && body.references?.length) {
                  const where = body.references.map((r) => r.file).join(", ");
                  if (!window.confirm(`Still used by ${where}. Remove it from those too?`)) {
                    return setStatus("Delete cancelled - nothing changed.");
                  }
                  body = await deleteContent("dungeon", draft.id, true);
                }
                setStatus(body.ok ? `Deleted ${draft.id}.` : `Rejected: ${body.message}`);
                if (body.ok) onSaved();
              } catch (err) {
                // Hosted, this is the plain-words refusal; locally, a real
                // failure. Either way it is said, rather than swallowed as an
                // unhandled rejection the way the old call was.
                setStatus(`Not deleted: ${(err as Error).message}`);
              }
            }}
          >
            Delete dungeon
          </button>
        </aside>
      </div>
    </div>
  );
}
