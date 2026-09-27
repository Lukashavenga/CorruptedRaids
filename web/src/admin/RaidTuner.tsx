import { useEffect, useMemo, useState } from "react";
import type {
  DoorKind,
  EnemyUnit,
  FightDefinition,
  PartyBand,
  PathDirection,
  RaidDefinition,
  RaidRoom,
  RaidStep,
  Role,
} from "../../../src/engine/types.js";
import { DOOR_KINDS, PARTY_BANDS, PATH_DIRECTIONS, ROLES } from "../../../src/engine/types.js";
import { BAND_SAMPLE_PARTY } from "../../../src/engine/squad.js";
import { BACKGROUNDS, ENEMY_SPRITES } from "./encounterArt.js";
import { enemySpriteUrl } from "../sprites.js";
import { FormationField } from "./FormationEditor.js";
import { DifficultyMeter, type Composition } from "./DifficultyMeter.js";
import { useDraftDifficulty } from "./DraftDifficulty.js";
import { RoleIcon } from "../components/RoleIcon.js";
import "./encounter.css";
import { writeContent } from "./backend.js";
import { StrengthBadge, StrengthPicker } from "./Strength.js";

/** What a role is called on the authoring screens. Matches DungeonTuner. */
const ROLE_LABEL: Record<Role, string> = {
  tank: "Frontliner",
  dps: "Ranged",
  healer: "Support",
};

const KIND_LABEL: Record<DoorKind, string> = {
  fight: "Fight",
  buff: "Boon",
  clear: "Empty",
};

/** What the overlay calls each door, so the editor says the same words. */
const DIRECTION_LABEL: Record<PathDirection, string> = {
  left: "Left",
  up: "Ahead",
  right: "Right",
};

/** A new room's fight, so a fight room is never authored without one. */
function blankFight(): FightDefinition {
  return {
    kind: "mob",
    stats: { hp: 13, atk: 2, spd: 3, skill: 1, crit: 0.05 },
    loot: [],
    goldReward: [8, 20],
    xpReward: 38,
    formations: { weak: [] },
  };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `room-${Date.now().toString(36)}`
  );
}

/**
 * Author a raid's rooms.
 *
 * A raid used to be three weights and a nameless pool of fights: you could say
 * "fights are 50% likely" but not which fight, and a fight had no name, no
 * description and no scene. There was nothing to add, nothing to name, and
 * nothing for the overlay to reveal when a door opened. A room is the unit an
 * author actually thinks in — a place, what waits there, and how often the
 * party finds it — so it is the unit this screen edits.
 *
 * The path is still drawn per round rather than scripted. That is what makes
 * the choice a choice: two runs of the same raid differ, and an author tunes
 * the odds of meeting a room rather than writing round three. Weight 0 is the
 * way to park a room without deleting the work.
 */
export function RaidTuner({ raids, onSaved, setStatus }: RaidTunerProps): JSX.Element {
  const [id, setId] = useState(raids[0]?.id ?? "");
  const [draft, setDraft] = useState<RaidDefinition | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [band, setBand] = useState<PartyBand>("weak");
  const [group, setGroup] = useState<string>(Object.keys(ENEMY_SPRITES)[0] ?? "");
  const [adding, setAdding] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [grid, setGrid] = useState(false);
  const [comp, setComp] = useState<Composition>({ tanks: 2, dps: 8, healers: 2, level: 6 });

  const selected = useMemo(() => raids.find((r) => r.id === id), [raids, id]);

  useEffect(() => {
    if (selected) setDraft(structuredClone(selected));
  }, [selected]);
  useEffect(() => {
    if (!raids.some((r) => r.id === id)) setId(raids[0]?.id ?? "");
  }, [raids, id]);
  // Selecting a raid should not leave a room id from the previous one selected.
  useEffect(() => {
    setRoomId(null);
    setSelectedUnit(null);
  }, [id]);

  // The boss is edited through the same panel as any other room — it is one,
  // with two extra multipliers — so it gets a synthetic id in the list.
  /**
   * Stands in for the boss in the room list's selection state.
   *
   * "#" cannot appear in a room id — `slug()` strips it — so this can never
   * collide with a real one. It was a control character, which worked and was
   * a landmine waiting for whoever next opened the file in an editor.
   */
  const BOSS = "#boss";
  const room: RaidRoom | undefined =
    draft && roomId === BOSS
      ? draft.boss
      : (draft?.rooms.find((r) => r.id === roomId) ?? undefined);

  // Measured live against the DRAFT, so the reading belongs to the numbers on
  // screen rather than to whatever was last written to disk.
  const difficulty = useDraftDifficulty(room?.fight ?? null);

  if (!draft) return <p className="admin-hint">No raids loaded. Add one to content/raids/.</p>;

  const patch = (next: Partial<RaidDefinition>) => setDraft({ ...draft, ...next });

  const patchRoom = (next: Partial<RaidRoom>) => {
    if (roomId === BOSS) {
      patch({ boss: { ...draft.boss, ...next, fight: next.fight ?? draft.boss.fight } });
      return;
    }
    patch({ rooms: draft.rooms.map((r) => (r.id === roomId ? { ...r, ...next } : r)) });
  };

  /**
   * How many doors on the path lead to this room.
   *
   * This is what replaced the odds column. With the path authored there are no
   * odds — there is only "how often does the party meet this", which is a
   * count, and "never", which is the thing an author most needs to see.
   */
  const doorsTo = (roomId: string) =>
    draft.path.reduce(
      (n, step) => n + PATH_DIRECTIONS.filter((d) => step[d] === roomId).length,
      0,
    );

  const addRoom = (kind: DoorKind) => {
    const name = kind === "fight" ? "New Room" : kind === "buff" ? "New Shrine" : "New Passage";
    let base = slug(name);
    let n = 1;
    while (draft.rooms.some((r) => r.id === base) || base === draft.boss.id) base = `${slug(name)}-${n++}`;
    const next: RaidRoom = {
      id: base,
      name,
      description: "",
      kind,
      ...(kind === "fight" ? { fight: blankFight() } : {}),
    };
    patch({ rooms: [...draft.rooms, next] });
    setRoomId(next.id);
    setBand("weak");
  };

  const duplicateRoom = (source: RaidRoom) => {
    let base = `${source.id}-copy`;
    let n = 1;
    while (draft.rooms.some((r) => r.id === base)) base = `${source.id}-copy-${n++}`;
    const copy: RaidRoom = structuredClone({ ...source, id: base, name: `${source.name} (copy)` });
    patch({ rooms: [...draft.rooms, copy] });
    setRoomId(copy.id);
  };

  /**
   * Rename a room's id, keeping it unique.
   *
   * Editable, and shown, because the id is generated from the room's name at
   * the moment it is created — so a room named after the fact keeps an id like
   * "new-room" forever otherwise. It is also what the file is read and diffed
   * by, so an author who cares about their content wants to set it. A rename
   * is safe: a door stores an id only for the length of a live run, and a room
   * cannot be renamed mid-run from here.
   */
  const renameId = (next: string) => {
    // Slugged on the way in: an id ends up in a filename-shaped position and
    // in every door that points at this room, so it is not a free-text field
    // even though it is typed like one.
    const clean = slug(next);
    if (draft.rooms.some((r) => r.id === clean && r.id !== roomId) || clean === draft.boss.id) return;
    patch({ rooms: draft.rooms.map((r) => (r.id === roomId ? { ...r, id: clean } : r)) });
    setRoomId(clean);
  };

  const removeRoom = (target: RaidRoom) => {
    // Deleting a room the path still points at would make the raid unloadable,
    // so the doors that led there fall back to another room. Silently dropping
    // the step would change how long the raid is, which is worse.
    const fallback = draft.rooms.find((r) => r.id !== target.id)?.id;
    const rooms = draft.rooms.filter((r) => r.id !== target.id);
    const path = fallback
      ? draft.path.map((step) =>
          Object.fromEntries(
            PATH_DIRECTIONS.map((d) => [d, step[d] === target.id ? fallback : step[d]]),
          ) as RaidStep,
        )
      : [];
    patch({ rooms, path });
    if (roomId === target.id) setRoomId(null);
  };

  // --- the path ------------------------------------------------------------
  const setDoor = (index: number, direction: PathDirection, target: string) =>
    patch({
      path: draft.path.map((step, i) => (i === index ? { ...step, [direction]: target } : step)),
    });

  const addStep = () => {
    const first = draft.rooms[0]?.id;
    if (!first) return;
    // A new round copies the last one rather than starting blank: an author
    // adding round five is nearly always editing round four's shape, and an
    // empty step cannot be represented anyway — every door needs a room.
    const last = draft.path[draft.path.length - 1];
    patch({
      path: [...draft.path, last ? { ...last } : ({ left: first, up: first, right: first } as RaidStep)],
    });
  };

  const removeStep = (index: number) => patch({ path: draft.path.filter((_, i) => i !== index) });

  const moveStep = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= draft.path.length) return;
    const next = [...draft.path];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    patch({ path: next });
  };

  // --- the selected room's squad, at the selected level ---------------------
  const units: EnemyUnit[] = room?.fight?.formations?.[band] ?? [];
  const setUnits = (next: EnemyUnit[]) => {
    if (!room?.fight) return;
    patchRoom({
      fight: { ...room.fight, formations: { ...room.fight.formations, [band]: next } },
    });
  };
  const patchUnit = (unitId: string, next: Partial<EnemyUnit>) =>
    setUnits(units.map((u) => (u.id === unitId ? { ...u, ...next } : u)));
  const addUnit = (sprite: string, name: string) => {
    const unitId = `u${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    setUnits([...units, { id: unitId, sprite, name, role: "dps", x: 0.5, y: 0.78 }]);
    setSelectedUnit(unitId);
    setAdding(false);
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(selected);

  const save = async () => {
    try {
      await writeContent("raid", draft.id, draft);
      setStatus(`Saved ${draft.name}.`);
      onSaved();
    } catch (err) {
      setStatus(`Rejected: ${(err as Error).message}`);
    }
  };

  /** Rooms nothing on the path points at — authored work nobody will see. */
  const stranded = draft.rooms.filter((r) => doorsTo(r.id) === 0);

  return (
    <div className="enc">
      {/* --- top bar ------------------------------------------------------ */}
      <header className="enc-bar">
        <span className="enc-crumb">Raids</span>
        <label className="enc-picker">
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {raids.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {/* No slider: the number of rounds IS the length of the path, and two
            numbers that have to agree are one number too many. */}
        <span className="enc-rounds">
          {draft.path.length} {draft.path.length === 1 ? "round" : "rounds"}, then the boss
        </span>
        <span className="enc-bar-spacer" />
        <button type="button" className="enc-save" onClick={save} disabled={!dirty}>
          {dirty ? "Save to JSON" : "No changes"}
        </button>
      </header>

      <div className="enc-body">
        {/* --- left: the rooms themselves --------------------------------- */}
        <aside className="enc-col enc-left">
          <h2 className="enc-h">Rooms</h2>
          <div className="enc-row">
            <strong>Behind the doors</strong>
            <span className="enc-count">{draft.rooms.length}</span>
          </div>

          <div className="raid-addrow">
            {DOOR_KINDS.map((k) => (
              <button key={k} type="button" className="enc-add" onClick={() => addRoom(k)}>
                + {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <ul className="raid-rooms">
            {draft.rooms.map((r) => (
              <li
                key={r.id}
                className={`kind-${r.kind} ${r.id === roomId ? "is-selected" : ""} ${doorsTo(r.id) === 0 ? "is-parked" : ""}`}
                onClick={() => {
                  setRoomId(r.id);
                  setSelectedUnit(null);
                }}
              >
                <span className="raid-room-name">
                  {r.name}
                  <small>{KIND_LABEL[r.kind]}</small>
                </span>
                {/* How many doors lead here. "0" is the useful one: a room
                    nothing points at is work the party will never see. */}
                <span className="raid-room-odds" title="Doors on the path leading here">
                  {doorsTo(r.id) === 0 ? "-" : `x${doorsTo(r.id)}`}
                </span>
                <button
                  type="button"
                  className="enc-squad-x"
                  title="Duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateRoom(r);
                  }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="enc-squad-x"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRoom(r);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
            {draft.rooms.length === 0 && (
              <li className="admin-warn">No rooms - every door would open onto nothing.</li>
            )}
            {/* The boss sits at the end of the list because that is where the
                party meets it. It is never drawn, so it shows no odds. */}
            <li
              className={`kind-fight is-boss ${roomId === BOSS ? "is-selected" : ""}`}
              onClick={() => {
                setRoomId(BOSS);
                setSelectedUnit(null);
              }}
            >
              <span className="raid-room-name">
                {draft.boss.name}
                <small>Boss · always last</small>
              </span>
            </li>
          </ul>

          {stranded.length > 0 && (
            <p className="admin-hint">
              Off the path, so never seen: {stranded.map((r) => r.name).join(", ")}.
            </p>
          )}
          {draft.rooms.length === 0 && (
            <p className="admin-warn">Add a room before building the path.</p>
          )}
        </aside>

        {/* --- main: the selected room ------------------------------------ */}
        <main className="enc-col enc-main">
          {!room && (
            <p className="admin-hint">
              Pick a room to edit it, or add one. Each room is a place with a name and a line - that
              is what the overlay reveals when a door opens onto it.
            </p>
          )}

          {room && (
            <>
              <div className="enc-title">
                <input
                  className="raid-room-title"
                  value={room.name}
                  onChange={(e) => patchRoom({ name: e.target.value })}
                  placeholder="Room name"
                />
              </div>

              <div className="raid-fieldrow">
                <label className="raid-field">
                  id
                  <input
                    value={room.id}
                    onChange={(e) => (roomId === BOSS ? patchRoom({ id: slug(e.target.value) }) : renameId(e.target.value))}
                    spellCheck={false}
                  />
                </label>
              </div>

              <label className="raid-field">
                Revealed line
                <input
                  value={room.description}
                  onChange={(e) => patchRoom({ description: e.target.value })}
                  placeholder="What the party sees when the door opens."
                />
              </label>

              <div className="raid-fieldrow">
                <label className="raid-field">
                  Scene
                  <select
                    value={room.background ?? ""}
                    onChange={(e) => patchRoom({ background: e.target.value || undefined })}
                  >
                    <option value="">none</option>
                    {BACKGROUNDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>

                {room.kind === "buff" && (
                  <label className="raid-field">
                    Boon
                    <select
                      value={room.buffId ?? ""}
                      onChange={(e) => patchRoom({ buffId: e.target.value || undefined })}
                    >
                      {/* Empty means "any the party has not claimed yet",
                          which is what keeps one shrine useful for a whole run
                          instead of being spent after a single visit. */}
                      <option value="">any unclaimed</option>
                      {draft.buffs.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {roomId === BOSS && (
                <div className="raid-fieldrow">
                  <label className="raid-field">
                    hp ×{draft.boss.hpMultiplier.toFixed(1)}
                    <input
                      type="range"
                      min={0.5}
                      max={12}
                      step={0.5}
                      value={draft.boss.hpMultiplier}
                      onChange={(e) =>
                        patch({ boss: { ...draft.boss, hpMultiplier: Number(e.target.value) } })
                      }
                    />
                  </label>
                  <label className="raid-field">
                    damage ×{draft.boss.atkMultiplier.toFixed(1)}
                    <input
                      type="range"
                      min={0.3}
                      max={4}
                      step={0.1}
                      value={draft.boss.atkMultiplier}
                      onChange={(e) =>
                        patch({ boss: { ...draft.boss, atkMultiplier: Number(e.target.value) } })
                      }
                    />
                  </label>
                </div>
              )}

              {!room.fight && (
                <p className="admin-hint">
                  {room.kind === "buff"
                    ? "A boon room hands out a buff and moves on - there is nothing to lay out."
                    : "An empty room is a free passage. Nothing to lay out."}
                </p>
              )}

              {room.fight && (
                <>
                  {/* Levels, each carrying its own verdict - the same grammar
                      as the Dungeons tab, because it is the same question. */}
                  <div className="enc-levelrow">
                    <span className="enc-levellabel">Level</span>
                    <div className="enc-levels">
                      {PARTY_BANDS.map((b, i) => {
                        const r = difficulty.readings[b];
                        const n = (room.fight?.formations?.[b] ?? []).length;
                        const tone = !r
                          ? ""
                          : r.winRate > 0.7
                            ? "is-easy"
                            : r.winRate < 0.45
                              ? "is-hard"
                              : "is-good";
                        return (
                          <button
                            key={b}
                            type="button"
                            className={`${b === band ? "is-active" : ""} ${tone} ${n === 0 ? "is-empty" : ""}`}
                            onClick={() => setBand(b)}
                            title={`${n} units`}
                          >
                            <span className="enc-level-n">{i + 1}</span>
                            <small>{BAND_SAMPLE_PARTY[b].size}p</small>
                            <small className={difficulty.busy ? "is-stale" : ""}>
                              {r ? `${Math.round(r.winRate * 100)}%` : "-"}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                    <div className="enc-views">
                      <button
                        type="button"
                        className={grid ? "is-active" : ""}
                        onClick={() => setGrid((g) => !g)}
                      >
                        grid
                      </button>
                    </div>
                  </div>

                  <FormationField
                    grid={grid}
                    units={units}
                    onUnits={setUnits}
                    background={room.background}
                    selected={selectedUnit}
                    onSelect={setSelectedUnit}
                  />
                  <p className="enc-tip">
                    Drag units to reposition. This is the layout the reveal shows and the fight
                    uses - they are the same bodies.
                  </p>
                </>
              )}
            </>
          )}
        </main>

        {/* --- right: what is standing in it ------------------------------ */}
        <aside className="enc-col enc-right">
          {room?.fight && (
            <>
              <h2 className="enc-h">Squad</h2>
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
                          <img src={enemySpriteUrl(`${group}/${sid}`)} alt={sid} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                    {/* "Plain" is a real choice, not an absence - a body with
                        no role gets no role scaling, no skill floor and no
                        threat multiplier, and is measurably weaker. */}
                    <button
                      type="button"
                      className={
                        units.find((u) => u.id === selectedUnit)?.role === undefined ? "is-active" : ""
                      }
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
                  {/*
                    The fix for the raid's bosses. Their top-level units were a
                    king-boss sprite drawn at 1.7x with no strength at all, so
                    each "boss" fought like one farmhand. Size is how big it is
                    drawn; Strength is what it is worth in the fight.
                  */}
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
            </>
          )}

          {roomId === BOSS && (
            <>
              <h2 className="enc-h">Boss reading</h2>
              {/* The boss is measured through the saved content, multipliers
                  included - they are what make it a boss, and the draft meter
                  above measures the fight without them. */}
              <DifficultyMeter target={{ raidId: draft.id }} composition={comp} onComposition={setComp} />
            </>
          )}

          <h2 className="enc-h">The path</h2>
          <p className="admin-hint">
            Every door, every round. Chat still cannot see behind one until it opens.
          </p>

          <ol className="raid-steps">
            {draft.path.map((step, i) => (
              <li key={i}>
                <div className="raid-step-head">
                  <span className="raid-step-n">Round {i + 1}</span>
                  <span className="enc-bar-spacer" />
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} title="Move up">
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(i, 1)}
                    disabled={i === draft.path.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => removeStep(i)} title="Remove round">
                    ×
                  </button>
                </div>
                {PATH_DIRECTIONS.map((dir) => {
                  const target = draft.rooms.find((r) => r.id === step[dir]);
                  return (
                    <label key={dir} className={`raid-door-pick kind-${target?.kind ?? "clear"}`}>
                      <span>{DIRECTION_LABEL[dir]}</span>
                      <select value={step[dir]} onChange={(e) => setDoor(i, dir, e.target.value)}>
                        {draft.rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {KIND_LABEL[r.kind]}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </li>
            ))}
            <li className="raid-path-boss">
              {draft.boss.name} · hp ×{draft.boss.hpMultiplier.toFixed(1)}, atk ×
              {draft.boss.atkMultiplier.toFixed(1)}
            </li>
          </ol>

          <button
            type="button"
            className="enc-add"
            onClick={addStep}
            disabled={draft.rooms.length === 0}
          >
            + Round
          </button>
        </aside>
      </div>
    </div>
  );
}

export interface RaidTunerProps {
  raids: RaidDefinition[];
  onSaved: () => void;
  setStatus: (message: string) => void;
}
