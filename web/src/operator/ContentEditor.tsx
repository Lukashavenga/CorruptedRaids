import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api.js";

/**
 * Editing content from anywhere.
 *
 * A JSON editor, deliberately, rather than a hosted copy of the admin panel's
 * sliders and drag handles. Those are worth having and they are a lot of
 * screens; this exists because the alternative today is "you cannot change a
 * raid unless you are at that computer", and a text box that saves reliably
 * beats a beautiful form that does not exist. The local panel keeps its
 * tuners, and they now write to the same store.
 *
 * VALIDATED ON THE FAR SIDE. The operator function runs the engine's OWN
 * validators - the same functions the disk loader uses - before it writes, so
 * a malformed dungeon is refused while its author is still looking at it
 * rather than taking the game down at the next boot. Nothing here needs to
 * know the shape of a gear definition, which is why it can edit shapes that
 * did not exist when it was written.
 *
 * EVERY SAVE IS REVERSIBLE. content_files has a trigger that files the
 * previous contents into content_history, so the version list below is not a
 * feature this screen implements - it is a property of the store. That is the
 * lesson from losing mask work twice: recovery has to be structural, not a
 * thing somebody remembered to build.
 */
export function ContentEditor(): JSX.Element {
  const [files, setFiles] = useState<{ path: string; updated_at: string; updated_by: string | null }[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [versions, setVersions] = useState<{ id: number; replaced_at: string; replaced_by: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refreshList = useCallback(() => {
    api
      .contentList()
      .then((r) => setFiles(r.files))
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(refreshList, [refreshList]);

  const open = useCallback((p: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    Promise.all([api.contentGet(p), api.contentHistory(p)])
      .then(([file, hist]) => {
        const pretty = JSON.stringify(file.file.data, null, 2);
        setPath(p);
        setText(pretty);
        setOriginal(pretty);
        setVersions(hist.versions);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }, []);

  const save = useCallback(() => {
    if (!path) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Caught here as well as on the server because a missing comma should
      // not cost a round trip to say so.
      setError(`Not valid JSON: ${(e as Error).message}`);
      return;
    }
    setBusy(true);
    setError(null);
    api
      .contentPut(path, parsed)
      .then((r) => {
        setNote(r.message ?? "Saved.");
        setOriginal(JSON.stringify(parsed, null, 2));
        refreshList();
        return api.contentHistory(path).then((h) => setVersions(h.versions));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }, [path, text, refreshList]);

  const restore = useCallback(
    (id: number) => {
      setBusy(true);
      api
        .contentRestore(id)
        .then((r) => {
          setNote(r.message ?? "Restored.");
          if (path) open(path);
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setBusy(false));
    },
    [path, open],
  );

  const dirty = text !== original;

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const out = new Map<string, string[]>();
    for (const f of files) {
      if (needle && !f.path.toLowerCase().includes(needle)) continue;
      const folder = f.path.includes("/") ? f.path.split("/")[0]! : "root";
      const list = out.get(folder) ?? [];
      list.push(f.path);
      out.set(folder, list);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [files, filter]);

  return (
    <section className="panel content-editor">
      <header className="panel-head">
        <h2>Content</h2>
        <span className="points">{files.length} files</span>
      </header>

      <p className="hint">
        Saved straight to Supabase and validated by the engine before it lands. The game picks
        changes up when the server restarts.
      </p>

      {error && <p className="bug-error">{error}</p>}
      {note && <p className="hint">{note}</p>}

      <div className="ce-layout">
        <div className="ce-list">
          <input
            type="search"
            className="bestiary-search"
            placeholder="Filter files"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter content files"
          />
          {grouped.map(([folder, paths]) => (
            <div key={folder} className="ce-group">
              <h3 className="sub-heading">{folder}</h3>
              <ul>
                {paths.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className={p === path ? "is-current" : ""}
                      onClick={() => open(p)}
                      disabled={busy}
                    >
                      {p.includes("/") ? p.slice(p.indexOf("/") + 1) : p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="ce-edit">
          {!path && <p className="hint">Pick a file.</p>}
          {path && (
            <>
              <div className="ce-head">
                <strong>{path}</strong>
                <span>
                  <button type="button" onClick={save} disabled={busy || !dirty} className="bug-send">
                    {busy ? "Saving..." : dirty ? "Save" : "Saved"}
                  </button>
                </span>
              </div>

              <textarea
                className="ce-text"
                value={text}
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
              />

              {versions.length > 0 && (
                <div className="ce-history">
                  <h3 className="sub-heading">Earlier versions</h3>
                  <ul>
                    {versions.map((v) => (
                      <li key={v.id}>
                        <span>
                          {new Date(v.replaced_at).toLocaleString()}
                          {v.replaced_by ? ` by ${v.replaced_by}` : ""}
                        </span>
                        <button type="button" onClick={() => restore(v.id)} disabled={busy}>
                          restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
