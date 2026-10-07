import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DoorKind,
  EnemyUnit,
  FightDefinition,
  PartyBand,
  PathDirection,
  RaidBuff,
  RaidDefinition,
  RaidRoom,
  RaidStep,
  Role,
  StatKey,
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
import { deleteContent, writeContent } from "./backend.js";
import { StrengthBadge, StrengthPicker } from "./Strength.js";

/** What a role is called on the authoring screens. Matches DungeonTuner. */
const ROLE_LABEL: Record<Role, string> = {
  tank: "Frontliner",
  dps: "Ranged",
  healer: "Support",
};

/**
 * A buff room is a SHRINE here, and a boon is what it gives.
 *
 * It was labelled "Boon", which made one word mean two things - the room on
 * the path and the bonus the raid defines - on a screen that listed the first
 * and had nowhere to see the second. New buff rooms were already named
 * "New Shrine"; the label now agrees with them.
 */
const KIND_LABEL: Record<DoorKind, string> = {
  fight: "Fight",
  buff: "Shrine",
  clear: "Empty",
};

/** A boon's stats, in the order and the words the loadout uses. */
const BOON_STATS: { key: StatKey; label: string }[] = [
  { key: "hp", label: "Health" },
  { key: "atk", label: "Attack" },
  { key: "spd", label: "Speed" },
  { key: "skill", label: "Skill" },
  { key: "crit", label: "Crit %" },
];

/** What a boon does, in a line: "+1 Attack, +5% Crit". */
function boonSummary(boon: RaidBuff): string {
  const parts = BOON_STATS.flatMap(({ key, label }) => {
    const value = boon.statMods?.[key];
    if (!value) return [];
    const sign = value > 0 ? "+" : "";
    // Crit is stored as a fraction and read as a percentage everywhere a
    // player sees it.
    return key === "crit" ? [`${sign}${Math.round(value * 100)}% Crit`] : [`${sign}${value} ${label}`];
  });
  return parts.length > 0 ? parts.join(", ") : "does nothing yet";
}

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

/**
 * The line a new room is revealed with until its author writes a better one.
 *
 * Not empty, because the loader refuses an empty one - so "+ Empty" made a
 * room that could be added, edited and then not saved, with the refusal
 * arriving a screen away from the field that caused it.
 */
const STARTER_LINE: Record<DoorKind, string> = {
  fight: "Something is waiting here.",
  buff: "A shrine, still lit.",
  clear: "Nothing here but the way on.",
};

/**
 * A raid to start from: one passage, one round, and a boss room with nobody
 * in it yet.
 *
 * The smallest thing the loader will accept, because a raid has to be SAVED to
 * exist in the picker at all and a draft that cannot be saved cannot be
 * started. It is created switched off, and cannot be switched on until the
 * boss has a body - an active raid with an empty boss room is a night that
 * ends in a fight against nobody.
 *
 * Boons are copied from the raid on screen, as a set to start editing from
 * rather than an empty list: a raid with none cannot have a shrine at all.
 */
function blankRaid(id: string, name: string, from: RaidDefinition | null): RaidDefinition {
  return {
    id,
    name,
    enabled: false,
    recommendedLevel: from?.recommendedLevel ?? 6,
    joinWindowMs: from?.joinWindowMs ?? 30000,
    path: [{ left: "first-passage", up: "first-passage", right: "first-passage" }],
    buffs: structuredClone(from?.buffs ?? []),
    rooms: [{ id: "first-passage", name: "First Passage", description: STARTER_LINE.clear, kind: "clear" }],
    boss: {
      id: "the-boss",
      name: "The Boss",
      description: "It has been waiting.",
      kind: "fight",
      fight: { ...blankFight(), kind: "boss" },
      hpMultiplier: 5,
      atkMultiplier: 1,
    },
    completionXp: from?.completionXp ?? 320,
    completionGold: from?.completionGold ?? [60, 120],
  };
}

/** A boon to start from. Gives nothing until its author says what. */
function blankBoon(existing: RaidBuff[]): RaidBuff {
  let id = "new-boon";
  let n = 2;
  while (existing.some((b) => b.id === id)) id = `new-boon-${n++}`;
  return { id, name: "New Boon", description: "Something in here is on your side.", statMods: {} };
}

/** Has the boss room got anybody in it, at any level? */
function bossIsStaffed(raid: RaidDefinition): boolean {
  return Object.values(raid.boss.fight.formations ?? {}).some((units) => (units?.length ?? 0) > 0);
}

/** A name as an id, or "" when nothing in it can be one. */
function slugOrEmpty(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function slug(name: string): string {
  return slugOrEmpty(name) || `room-${Date.now().toString(36)}`;
}

/**
 * An id, typed freely and applied when the field is left.
 *
 * It used to be slugged on every keystroke, which strips a trailing hyphen -
 * so the hyphen in "toll-gate" vanished as it was typed and a two-word id
 * could only be entered by going back and inserting it - and emptying the
 * field to retype it produced "room-" plus a timestamp. Nothing about an id
 * needs to be true until the author has finished typing it.
 */
function IdField({
  value,
  taken,
  onCommit,
}: {
  value: string;
  taken: (id: string) => boolean;
  onCommit: (id: string) => void;
}): JSX.Element {
  const [typed, setTyped] = useState(value);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    setTyped(value);
    setRefused(null);
  }, [value]);

  const commit = () => {
    const clean = slugOrEmpty(typed);
    if (!clean || clean === value) {
      setTyped(value);
      return;
    }
    if (taken(clean)) {
      setTyped(value);
      setRefused(`"${clean}" is already used in this raid.`);
      return;
    }
    onCommit(clean);
  };

  return (
    <label className="raid-field" title="What the saved file calls this room. Doors on the path follow a rename.">
      id
      <input
        value={typed}
        spellCheck={false}
        onChange={(e) => {
          setTyped(e.target.value);
          setRefused(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {refused && <small className="admin-warn">{refused}</small>}
    </label>
  );
}

/**
 * Everything that would make the server refuse this raid, in the author's
 * words.
 *
 * Each line mirrors one `fail` in validateRaidDefinition and nothing else: it
 * exists so the refusal is on screen BEFORE Save and names a round and a door,
 * where the loader's own message says `path[0].up points at "first-passage"`
 * and arrives in the status bar a screen away from the dropdown that caused
 * it. The server is still the judge; this only stops the author finding out by
 * being turned down.
 */
function raidProblems(raid: RaidDefinition): string[] {
  const out: string[] = [];
  if (!raid.name) out.push("The raid needs a name.");
  if (raid.rooms.length === 0) out.push("Add at least one room - the doors have nothing to open onto.");
  if (raid.path.length === 0) out.push("Add at least one round to the path.");

  const boonIds = raid.buffs.map((b) => b.id);
  for (const b of raid.buffs) {
    if (!b.name) out.push("A boon has no name.");
    if (!b.description) out.push(`Boon "${b.name || b.id}" needs a line of description.`);
  }

  const roomIds = new Set(raid.rooms.map((r) => r.id));
  for (const r of [...raid.rooms, raid.boss]) {
    if (!r.name) out.push(`A room (${r.id}) has no name.`);
    if (!r.description) out.push(`"${r.name || r.id}" needs a revealed line.`);
  }
  for (const r of raid.rooms) {
    if (r.kind !== "buff") continue;
    if (r.buffId !== undefined && !boonIds.includes(r.buffId)) {
      out.push(`Shrine "${r.name}" gives a boon that no longer exists - pick another.`);
    }
    if (r.buffId === undefined && boonIds.length === 0) {
      out.push(`Shrine "${r.name}" has nothing to give - this raid has no boons yet.`);
    }
  }
  if (roomIds.has(raid.boss.id)) out.push(`The boss room shares its id ("${raid.boss.id}") with another room.`);

  raid.path.forEach((step, i) => {
    for (const dir of PATH_DIRECTIONS) {
      if (!roomIds.has(step[dir])) {
        out.push(`Round ${i + 1}, ${DIRECTION_LABEL[dir]}: this door leads to a room that no longer exists - pick one.`);
      }
    }
  });
  return out;
}

/**
 * Author a raid: its rooms, its boons, and the path that strings them together.
 *
 * Three lists and they are all one raid. ROOMS are the places a door can open
 * onto - an empty passage, a shrine, a fight. BOONS are what a shrine gives:
 * a bonus the whole party keeps for the rest of the run. THE PATH says which
 * room is behind Left, Ahead and Right in each round, and the boss comes after
 * the last one.
 *
 * This comment described weights and rolled doors for a while after the path
 * became authored (AGENTS.md 2.5), and so did the screen: boons could be
 * handed out but not seen or edited, and a room renamed here kept its old id
 * on the path, which the server then refused to save.
 */
export function RaidTuner({ raids, onSaved, setStatus }: RaidTunerProps): JSX.Element {
  const [id, setId] = useState(raids[0]?.id ?? "");
  const [draft, setDraft] = useState<RaidDefinition | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  /** The boon being edited. A boon and a room are never both selected. */
  const [boonId, setBoonId] = useState<string | null>(null);
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
  /**
   * A raid just created, whose id is selected before the reload that lists it
   * has landed. Without this the effect below sees an id it does not know and
   * snaps the picker back to the first raid - so "New" appeared to do nothing.
   */
  const pendingId = useRef<string | null>(null);
  useEffect(() => {
    if (raids.some((r) => r.id === id)) {
      if (pendingId.current === id) pendingId.current = null;
      return;
    }
    if (pendingId.current === id) return;
    setId(raids[0]?.id ?? "");
  }, [raids, id]);
  // Selecting a raid should not leave a room id from the previous one selected.
  useEffect(() => {
    setRoomId(null);
    setBoonId(null);
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
  const boon: RaidBuff | undefined = draft?.buffs.find((b) => b.id === boonId);

  const selectRoom = (next: string | null) => {
    setRoomId(next);
    setBoonId(null);
    setSelectedUnit(null);
  };
  const selectBoon = (next: string | null) => {
    setBoonId(next);
    setRoomId(null);
    setSelectedUnit(null);
  };

  // Measured live against the DRAFT, so the reading belongs to the numbers on
  // screen rather than to whatever was last written to disk.
  const difficulty = useDraftDifficulty(room?.fight ?? null);

  /** An id no raid has yet, from a name. */
  const freeId = (name: string): string => {
    const base = slug(name);
    let next = base;
    let n = 2;
    while (raids.some((r) => r.id === next)) next = `${base}-${n++}`;
    return next;
  };

  /**
   * Create a raid and select it. Written straight away rather than held as an
   * unsaved draft: the picker lists what is SAVED, so a raid that exists only
   * in this component could not be switched back to after looking at another.
   */
  const create = async (fresh: RaidDefinition, what: string) => {
    try {
      await writeContent("raid", fresh.id, fresh);
      setStatus(what);
      pendingId.current = fresh.id;
      onSaved();
      setId(fresh.id);
    } catch (err) {
      setStatus(`Rejected: ${(err as Error).message}`);
    }
  };

  const newRaid = () => {
    const name = window.prompt("Name the new raid");
    if (!name?.trim()) return;
    const fresh = blankRaid(freeId(name), name.trim(), draft);
    void create(fresh, `Created ${fresh.name}. It is inactive until you switch it on.`);
  };

  if (!draft) {
    return (
      <p className="admin-hint">
        No raids yet.{" "}
        <button type="button" onClick={newRaid}>
          + New raid
        </button>
      </p>
    );
  }

  const duplicateRaid = () => {
    const name = `${draft.name} copy`;
    // A copy starts inactive whatever the original was: it is the same night
    // twice until somebody changes it, and the redeem would roll both.
    const fresh: RaidDefinition = { ...structuredClone(draft), id: freeId(name), name, enabled: false };
    void create(fresh, `Created ${fresh.name}, inactive.`);
  };

  const deleteRaid = async () => {
    if (!window.confirm(`Delete "${draft.name}" (${draft.id})? This cannot be undone.`)) return;
    try {
      const body = await deleteContent("raid", draft.id, false);
      setStatus(body.ok ? `Deleted ${draft.name}.` : `Rejected: ${body.message}`);
      if (body.ok) onSaved();
    } catch (err) {
      setStatus(`Not deleted: ${(err as Error).message} Switch it to inactive instead.`);
    }
  };

  const active = draft.enabled !== false;
  const staffed = bossIsStaffed(draft);
  const activeCount = raids.filter((r) => r.enabled !== false).length;

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
      description: STARTER_LINE[kind],
      kind,
      ...(kind === "fight" ? { fight: blankFight() } : {}),
    };
    // A shrine in a raid with no boons is refused on save, so the first one
    // arrives with a boon to give rather than as a room that cannot be kept.
    const buffs = kind === "buff" && draft.buffs.length === 0 ? [blankBoon(draft.buffs)] : draft.buffs;
    patch({ rooms: [...draft.rooms, next], buffs });
    selectRoom(next.id);
    setBand("weak");
  };

  // --- boons ---------------------------------------------------------------
  const addBoon = () => {
    const next = blankBoon(draft.buffs);
    patch({ buffs: [...draft.buffs, next] });
    selectBoon(next.id);
  };

  const patchBoon = (next: Partial<RaidBuff>) =>
    patch({ buffs: draft.buffs.map((b) => (b.id === boonId ? { ...b, ...next } : b)) });

  /** Zero is "does not touch this stat", and is stored as the key's absence. */
  const setBoonStat = (key: StatKey, value: number) => {
    if (!boon) return;
    const statMods = { ...boon.statMods };
    if (value) statMods[key] = value;
    else delete statMods[key];
    patchBoon({ statMods });
  };

  const removeBoon = (target: RaidBuff) => {
    // A shrine still naming it would make the raid unloadable, so those fall
    // back to giving whichever boon is next - the same repair removeRoom makes
    // to the path.
    patch({
      buffs: draft.buffs.filter((b) => b.id !== target.id),
      rooms: draft.rooms.map((r) => {
        if (r.buffId !== target.id) return r;
        const { buffId: _gone, ...rest } = r;
        return rest;
      }),
    });
    if (boonId === target.id) setBoonId(null);
  };

  /** Shrines that give this boon by name. */
  const shrinesGiving = (target: RaidBuff) => draft.rooms.filter((r) => r.kind === "buff" && r.buffId === target.id);

  const duplicateRoom = (source: RaidRoom) => {
    let base = `${source.id}-copy`;
    let n = 1;
    while (draft.rooms.some((r) => r.id === base) || base === draft.boss.id) base = `${source.id}-copy-${n++}`;
    const copy: RaidRoom = structuredClone({ ...source, id: base, name: `${source.name} (copy)` });
    patch({ rooms: [...draft.rooms, copy] });
    selectRoom(copy.id);
  };

  /**
   * Rename a room's id, and every door that leads to it.
   *
   * Editable, and shown, because the id is generated from the room's name at
   * the moment it is created — so a room named after the fact keeps an id like
   * "new-room" forever otherwise.
   *
   * THE PATH HAS TO FOLLOW. This only renamed the room, on the reasoning that
   * "a door stores an id only for the length of a live run" - true when doors
   * were rolled, and false since the path was authored, because the path is a
   * list of room ids. A renamed room left its doors pointing at the old id;
   * the server refused the raid ('path[0].up points at "first-passage", which
   * is not one of its rooms') and the screen gave no sign of why, because a
   * dropdown whose value matches no option draws its first option instead.
   */
  const renameId = (clean: string) => {
    const from = roomId;
    patch({
      rooms: draft.rooms.map((r) => (r.id === from ? { ...r, id: clean } : r)),
      path: draft.path.map(
        (step) =>
          Object.fromEntries(PATH_DIRECTIONS.map((d) => [d, step[d] === from ? clean : step[d]])) as RaidStep,
      ),
    });
    setRoomId(clean);
  };

  /** Is this id spoken for by something other than the room being renamed? */
  const idTaken = (clean: string) =>
    roomId === BOSS
      ? draft.rooms.some((r) => r.id === clean)
      : draft.rooms.some((r) => r.id === clean && r.id !== roomId) || clean === draft.boss.id;

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

  const problems = raidProblems(draft);
  /**
   * Rounds whose shrine gives "whichever boon is next". Each can be taken once
   * a run, so a party that picks the shrine every round needs this many boons.
   */
  const openShrineRounds = draft.path.filter((step) =>
    PATH_DIRECTIONS.some((d) => {
      const r = draft.rooms.find((x) => x.id === step[d]);
      return r?.kind === "buff" && r.buffId === undefined;
    }),
  ).length;

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
                {r.enabled === false ? "○ " : "● "}
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={newRaid} title="Start a new raid">
          + New
        </button>
        <button type="button" onClick={duplicateRaid} title="Copy this raid as a starting point">
          Duplicate
        </button>
        {/* Active is the one switch that decides whether chat can land on this
            raid. It cannot be turned on over an empty boss room - see blankRaid. */}
        <label
          className={`raid-active ${active ? "is-on" : ""}`}
          title={
            staffed || active
              ? "Active raids can be rolled by a redeem. Inactive ones can only be opened by you."
              : "Put at least one unit in the boss room first."
          }
        >
          <input
            type="checkbox"
            checked={active}
            disabled={!active && !staffed}
            onChange={(e) => patch({ enabled: e.target.checked ? undefined : false })}
          />
          {active ? "Active" : "Inactive"}
        </label>
        {/* No slider: the number of rounds IS the length of the path, and two
            numbers that have to agree are one number too many. */}
        <span className="enc-rounds">
          {draft.path.length} {draft.path.length === 1 ? "round" : "rounds"}, then the boss
        </span>
        <span className="enc-bar-spacer" />
        <button type="button" className="raid-delete" onClick={() => void deleteRaid()}>
          Delete
        </button>
        <button
          type="button"
          className="enc-save"
          onClick={save}
          disabled={!dirty || problems.length > 0}
          title={problems[0] ?? ""}
        >
          {problems.length > 0 ? "Cannot save yet" : dirty ? "Save Raid" : "No changes"}
        </button>
      </header>

      {/* The raid itself, as opposed to its rooms. It had no fields at all
          before - a raid's name could only be changed by editing the file. */}
      <div className="raid-meta">
        <label className="raid-field">
          Raid name
          <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className="raid-field raid-field-narrow">
          Suggested level
          <input
            type="number"
            min={1}
            value={draft.recommendedLevel}
            onChange={(e) => patch({ recommendedLevel: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label className="raid-field raid-field-narrow">
          Join window (s)
          <input
            type="number"
            min={5}
            value={Math.round(draft.joinWindowMs / 1000)}
            onChange={(e) => patch({ joinWindowMs: Math.max(5, Number(e.target.value) || 5) * 1000 })}
          />
        </label>
        <span className="raid-meta-note">
          {activeCount === 0
            ? "No raid is active - a raid redeem will refund."
            : `${activeCount} of ${raids.length} active. A redeem rolls one of those.`}
          {!staffed && " This raid's boss room is empty."}
        </span>
      </div>

      {/* The order to build one in. The three columns are three lists that
          only make a raid together, and nothing on the screen said so. */}
      <ol className="raid-guide">
        <li>
          <strong>Rooms</strong> - make the places a door can open onto: an empty passage, a shrine
          that gives a boon, or a fight.
        </li>
        <li>
          <strong>The path</strong> - for each round, choose which room is behind Left, Ahead and
          Right. Chat picks one door a round and sees only that room.
        </li>
        <li>
          <strong>The boss</strong> - put at least one unit in the boss room, then switch the raid
          to Active.
        </li>
      </ol>

      {problems.length > 0 && (
        <ul className="raid-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

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
                onClick={() => selectRoom(r.id)}
              >
                <span className="raid-room-name">
                  {r.name}
                  <small>
                    {KIND_LABEL[r.kind]}
                    {r.kind === "buff" &&
                      ` - gives ${draft.buffs.find((b) => b.id === r.buffId)?.name ?? "the next boon"}`}
                  </small>
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
                {/* The last room cannot go: a raid with none is refused, and
                    the path would have nowhere left to point. */}
                <button
                  type="button"
                  className="enc-squad-x"
                  title={draft.rooms.length === 1 ? "A raid needs at least one room" : "Delete"}
                  disabled={draft.rooms.length === 1}
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
              onClick={() => selectRoom(BOSS)}
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

          {/* --- boons ---------------------------------------------------- */}
          <h2 className="enc-h">Boons</h2>
          <div className="enc-row">
            <strong>What a shrine gives</strong>
            <span className="enc-count">{draft.buffs.length}</span>
          </div>
          <p className="admin-hint">
            A bonus the whole party keeps for the rest of the raid. Each can be taken once a run.
          </p>
          <ul className="raid-rooms">
            {draft.buffs.map((b) => (
              <li
                key={b.id}
                className={`kind-buff ${b.id === boonId ? "is-selected" : ""}`}
                onClick={() => selectBoon(b.id)}
              >
                <span className="raid-room-name">
                  {b.name}
                  <small>{boonSummary(b)}</small>
                </span>
                <button
                  type="button"
                  className="enc-squad-x"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBoon(b);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
            {draft.buffs.length === 0 && <li className="admin-hint">No boons, so no shrines.</li>}
          </ul>
          <button type="button" className="enc-add raid-add-boon" onClick={addBoon}>
            + Boon
          </button>
          {openShrineRounds > draft.buffs.length && (
            <p className="admin-hint">
              {openShrineRounds} rounds offer a shrine that gives the next boon, and there are{" "}
              {draft.buffs.length}. A party that takes every one finds the last empty.
            </p>
          )}
        </aside>

        {/* --- main: the selected room ------------------------------------ */}
        <main className="enc-col enc-main">
          {!room && !boon && (
            <p className="admin-hint">
              Pick a room or a boon on the left to edit it, or add one. A room is a place with a name
              and a line - that is what the overlay reveals when a door opens onto it.
            </p>
          )}

          {boon && (
            <>
              <div className="enc-title">
                <input
                  className="raid-room-title"
                  value={boon.name}
                  onChange={(e) => patchBoon({ name: e.target.value })}
                  placeholder="Boon name"
                />
              </div>
              <p className="admin-hint">
                A boon. The party gets it by opening a door onto a shrine, and it stays on every
                member until the raid ends - through the boss.
              </p>

              <label className="raid-field">
                Description
                <input
                  value={boon.description}
                  onChange={(e) => patchBoon({ description: e.target.value })}
                  placeholder="One line, shown with the name when it is found."
                />
              </label>

              <div className="raid-boon-stats">
                {BOON_STATS.map(({ key, label }) => (
                  <label key={key} className="raid-field">
                    {label}
                    <input
                      type="number"
                      step={1}
                      // Crit is a fraction in the file and a percentage on
                      // every screen a person reads.
                      value={key === "crit" ? Math.round((boon.statMods?.crit ?? 0) * 100) : (boon.statMods?.[key] ?? 0)}
                      onChange={(e) => {
                        const n = Number(e.target.value) || 0;
                        setBoonStat(key, key === "crit" ? n / 100 : n);
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="admin-hint">
                Added to each party member, and boons stack. Keep them small: a new character has
                about ten health, so +1 is a real bonus and +6 is a large one. Leave a stat at 0 to
                not touch it.
              </p>

              <p className="admin-hint">
                {shrinesGiving(boon).length > 0
                  ? `Given by: ${shrinesGiving(boon)
                      .map((r) => r.name)
                      .join(", ")}.`
                  : draft.rooms.some((r) => r.kind === "buff" && r.buffId === undefined)
                    ? "No shrine names this one, but a shrine set to give the next boon can still hand it out."
                    : "No shrine gives this yet. Add a shrine, or pick this boon on one."}
              </p>
            </>
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
                <IdField
                  value={room.id}
                  taken={idTaken}
                  onCommit={(clean) => (roomId === BOSS ? patchRoom({ id: clean }) : renameId(clean))}
                />
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
                    Boon it gives
                    <select
                      value={room.buffId ?? ""}
                      onChange={(e) => patchRoom({ buffId: e.target.value || undefined })}
                    >
                      {/* Empty means "any the party has not claimed yet",
                          which is what keeps one shrine useful for a whole run
                          instead of being spent after a single visit. */}
                      <option value="">the next boon the party has not taken</option>
                      {/* A boon deleted out from under this shrine. Listed so
                          the dropdown shows what is stored instead of quietly
                          drawing a different choice. */}
                      {room.buffId !== undefined && !draft.buffs.some((b) => b.id === room.buffId) && (
                        <option value={room.buffId}>missing boon - pick another</option>
                      )}
                      {draft.buffs.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({boonSummary(b)})
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
                    ? room.buffId === undefined
                      ? "A shrine gives the party a boon and moves on - no fight. This one gives whichever boon they have not taken yet, top of the Boons list first, so it is worth visiting more than once."
                      : "A shrine gives the party a boon and moves on - no fight. This one always gives the boon picked above."
                    : "An empty room is a free passage. Nothing to lay out."}
                </p>
              )}
              {/* From the shrine to the thing it gives. Only when it names one:
                  a shrine giving "the next boon" has no single boon to open. */}
              {room.kind === "buff" && draft.buffs.some((b) => b.id === room.buffId) && (
                <button type="button" className="raid-linkbtn" onClick={() => selectBoon(room.buffId ?? null)}>
                  Edit this boon
                </button>
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
            Which room is behind each door, round by round. Chat votes for a door without seeing
            what is behind it.
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
                  <button
                    type="button"
                    onClick={() => removeStep(i)}
                    disabled={draft.path.length === 1}
                    title={draft.path.length === 1 ? "A raid needs at least one round" : "Remove round"}
                  >
                    ×
                  </button>
                </div>
                {PATH_DIRECTIONS.map((dir) => {
                  const target = draft.rooms.find((r) => r.id === step[dir]);
                  return (
                    <label
                      key={dir}
                      className={`raid-door-pick ${target ? `kind-${target.kind}` : "is-missing"}`}
                    >
                      <span>{DIRECTION_LABEL[dir]}</span>
                      <select value={step[dir]} onChange={(e) => setDoor(i, dir, e.target.value)}>
                        {/* A door whose room is gone. Without an option of its
                            own the browser draws the first room in the list,
                            which is how a broken path looked like a whole one. */}
                        {!target && <option value={step[dir]}>no room - pick one</option>}
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
