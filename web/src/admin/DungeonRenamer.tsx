import { useEffect, useState } from "react";
import type { DungeonDefinition } from "../../../src/engine/types.js";
import { adminFetch } from "../adminKey.js";

/**
 * Naming the places.
 *
 * A dungeon has two names and only one of them is a name in any sense a player
 * would recognise:
 *
 *   `name`  is what appears on stream. Change it freely, whenever you like.
 *   `id`    is the key the files and the code use. Nobody sees it.
 *
 * They are edited together here because keeping them roughly in step makes the
 * content directory readable, but they are saved by two different routes and
 * the difference matters. Rewriting `name` is a content write and cannot break
 * anything. Changing `id` renames a file and re-keys the registry, and a couple
 * of scripts still name dungeons by id, so it warns rather than doing it
 * quietly.
 */
export function DungeonRenamer({
  dungeons,
  onSaved,
}: {
  dungeons: DungeonDefinition[];
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; id: string }>>({});
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  // Reset whenever the server's copy changes, so a save that renamed something
  // does not leave this editing an id that no longer exists.
  useEffect(() => {
    const next: Record<string, { name: string; id: string }> = {};
    for (const d of dungeons) next[d.id] = { name: d.name, id: d.id };
    setDrafts(next);
  }, [dungeons]);

  const save = async (original: DungeonDefinition) => {
    const draft = drafts[original.id];
    if (!draft) return;
    const nameChanged = draft.name.trim() !== original.name;
    const idChanged = draft.id.trim() !== original.id;
    if (!nameChanged && !idChanged) return;

    setBusy(original.id);
    setStatus("");
    try {
      // Name first, against the id the file still has. Doing it the other way
      // round would write to a path the rename is about to move.
      if (nameChanged) {
        const res = await adminFetch("/content/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "dungeon",
            id: original.id,
            data: { ...original, name: draft.name.trim() },
          }),
        });
        const body = await res.json();
        if (!body.ok) throw new Error(body.message);
      }
      if (idChanged) {
        const res = await adminFetch("/content/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "dungeon", id: original.id, newId: draft.id.trim() }),
        });
        const body = await res.json();
        if (!body.ok) throw new Error(body.message);
      }
      setStatus(
        idChanged
          ? `Renamed to "${draft.name.trim()}" (${draft.id.trim()}). Any script naming the old id needs updating.`
          : `Renamed to "${draft.name.trim()}".`,
      );
      onSaved();
    } catch (err) {
      setStatus(`Rejected: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const set = (id: string, patch: Partial<{ name: string; id: string }>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));

  return (
    <div className="dungeon-renamer">
      <p className="renamer-note">
        <strong>Name</strong> is what players see on stream - change it freely.{" "}
        <strong>Id</strong> is internal; it keys the file and the registry, and a
        few scripts still name dungeons by it.
      </p>

      <ul className="renamer-list">
        {dungeons.map((d) => {
          const draft = drafts[d.id] ?? { name: d.name, id: d.id };
          const dirty = draft.name.trim() !== d.name || draft.id.trim() !== d.id;
          const idChanging = draft.id.trim() !== d.id;
          return (
            <li key={d.id} className="renamer-row">
              <div className="renamer-fields">
                <label>
                  <span>Name</span>
                  <input
                    value={draft.name}
                    onChange={(e) => set(d.id, { name: e.target.value })}
                    placeholder={d.name}
                  />
                </label>
                <label>
                  <span>Id</span>
                  <input
                    className="renamer-id"
                    value={draft.id}
                    onChange={(e) => set(d.id, { id: e.target.value })}
                    placeholder={d.id}
                    spellCheck={false}
                  />
                </label>
              </div>
              <div className="renamer-actions">
                {idChanging && <span className="renamer-warn">renames the file</span>}
                <button
                  type="button"
                  disabled={!dirty || busy !== null}
                  onClick={() => void save(d)}
                >
                  {busy === d.id ? "Saving…" : "Save"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {status && <p className="renamer-status">{status}</p>}
    </div>
  );
}
