import { useCallback, useEffect, useState } from "react";
import { BUILD_LABEL, LOGO_SRC } from "../build.js";
import { readSession, signIn, signOut, type SessionState } from "../loadout/identity.js";
import * as api from "./api.js";
import { ContentEditor } from "./ContentEditor.js";
import type { RosterEntry } from "./api.js";

/**
 * The hosted operator console.
 *
 * WHAT IT IS NOT: the admin panel. That one edits gear, dungeons, raids and
 * sprite placement, and every one of those writes a file in the repo through
 * the game server - so it only works on the machine the game is running on
 * and is deliberately not published (scripts/publish-web.ts). This is the half
 * that CAN live on a static host, because characters live in Supabase.
 *
 * THE GATE IS THE FUNCTION, NOT THIS FILE. The console asks `whoami` and draws
 * a refusal if the answer is no, which is a courtesy so an ordinary viewer who
 * finds the URL sees something sensible. It is not protection: anyone can edit
 * a static page's JavaScript. Every action re-derives the caller from their
 * verified token on the far side and refuses on its own, so deleting the check
 * below would change nothing about what a stranger can actually do.
 */
export function OperatorApp(): JSX.Element {
  const [session, setSession] = useState<SessionState | null>(null);
  const [operator, setOperator] = useState<boolean | null>(null);
  const [rows, setRows] = useState<RosterEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"roster" | "content">("roster");

  /*
   * The gear catalogue, for choosing what a chest contains.
   *
   * grant_chest takes a gearId - a chest is a WRAPPED ITEM, not a random
   * roll deferred to opening time, because the roll already happened when the
   * fight resolved and the chest is only the telling. The first version of
   * this button sent no gearId at all and the engine answered `No such gear
   * "undefined"`, which is exactly the right complaint.
   *
   * Read from the published content bundle rather than an endpoint: this page
   * is static-hosted and has no game server to ask, the same constraint that
   * check-hosted exists to enforce.
   */
  const [gear, setGear] = useState<{ id: string; name: string; rarity: string }[]>([]);
  const [rarity, setRarity] = useState("common");

  useEffect(() => {
    fetch("/loadout-content.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = (data?.gear ?? []) as { id: string; name: string; rarity: string; enabled?: boolean }[];
        setGear(list.filter((g) => g.enabled !== false).map((g) => ({ id: g.id, name: g.name, rarity: g.rarity })));
      })
      .catch(() => setGear([]));
  }, []);

  /** One of the chosen rarity, at random - the same spread `npm run chests` uses. */
  const pickGearId = useCallback((): string | null => {
    const pool = gear.filter((g) => g.rarity === rarity);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)]!.id;
  }, [gear, rarity]);

  useEffect(() => {
    void readSession().then(setSession);
  }, []);

  useEffect(() => {
    if (!session?.viewer) return;
    void api
      .whoami()
      .then((r) => setOperator(r.operator))
      .catch((e) => {
        setOperator(false);
        setError((e as Error).message);
      });
  }, [session]);

  const load = useCallback(() => {
    setBusy(true);
    api
      .roster()
      .then((r) => {
        setRows(r.characters);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (operator) load();
  }, [operator, load]);

  const run = useCallback(
    async (target: string, cmd: Record<string, unknown>, what: string) => {
      setBusy(true);
      setNote(null);
      try {
        const res = await api.command(target, cmd);
        setNote(res.message ?? `${what} done.`);
        setError(null);
        load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (!session) return <main className="loadout is-centered">Loading...</main>;

  if (!session.viewer) {
    return (
      <main className="loadout is-centered">
        <div className="signin">
          <img className="signin-logo" src={LOGO_SRC} alt="" />
          <h1>Operator</h1>
          <p className="signin-lead">Sign in to continue.</p>
          <button type="button" className="signin-button" onClick={() => void signIn()}>
            Sign in with Twitch
          </button>
        </div>
      </main>
    );
  }

  if (operator === null) return <main className="loadout is-centered">Checking...</main>;

  if (!operator) {
    return (
      <main className="loadout is-centered">
        <div className="signin">
          <img className="signin-logo" src={LOGO_SRC} alt="" />
          <h1>Not an operator</h1>
          <p className="signin-lead">
            This account does not have operator access. Signed in as {session.viewer.displayName}.
          </p>
          <button type="button" className="signin-button" onClick={() => void signOut().then(() => location.reload())}>
            Sign out
          </button>
        </div>
      </main>
    );
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => `${r.name} ${r.id}`.toLowerCase().includes(needle)) : rows;

  return (
    <main className="loadout operator">
      <header className="topbar">
        <img className="brand-logo" src={LOGO_SRC} alt="" />
        <h1 className="visually-hidden">Operator</h1>
        <span className="op-who">{session.viewer.displayName}</span>
        <button type="button" className="bug-open" onClick={() => void signOut().then(() => location.reload())}>
          Sign out
        </button>
      </header>

      <nav className="site-nav" aria-label="Operator">
        {(["roster", "content"] as const).map((t) => (
          <button key={t} type="button" className={`nav-item ${tab === t ? "is-current" : ""}`} onClick={() => setTab(t)}>
            {t === "roster" ? "Roster" : "Content"}
          </button>
        ))}
      </nav>

      {tab === "content" && <ContentEditor />}

      {tab === "roster" && (
      <section className="panel">
        <header className="panel-head">
          <h2>Roster</h2>
          <span className="points">{rows.length} characters</span>
        </header>

        <input
          type="search"
          className="bestiary-search"
          placeholder="Search by name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search the roster"
        />

        <label className="op-rarity">
          Chest contains{" "}
          <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
            {["common", "uncommon", "rare", "epic", "legendary"].map((r) => {
              const n = gear.filter((g) => g.rarity === r).length;
              return (
                <option key={r} value={r} disabled={n === 0}>
                  {r} ({n})
                </option>
              );
            })}
          </select>{" "}
          <span className="hint-inline">a random one, as `npm run chests` does</span>
        </label>

        {error && <p className="bug-error">{error}</p>}
        {note && <p className="hint">{note}</p>}
        {busy && <p className="hint">Working...</p>}

        <table className="op-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Lvl</th>
              <th>Role</th>
              <th>Gold</th>
              <th>Chests</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.inRun ? "is-inrun" : ""}>
                <td>
                  {r.name}
                  {/* Mid-run edits are refused by the function, because the game
                      server holds the roster in memory and would overwrite them
                      on its next save. Saying so here beats a 409 later. */}
                  {r.inRun && <span className="op-tag">in run</span>}
                </td>
                <td>{r.level}</td>
                <td>{r.role}</td>
                <td>{r.gold}</td>
                <td>{r.chests}</td>
                <td className="op-actions">
                  <button
                    type="button"
                    disabled={busy || r.inRun || gear.length === 0}
                    onClick={() => {
                      const gearId = pickGearId();
                      if (!gearId) {
                        setError(`No ${rarity} gear in the bundle to put in a chest.`);
                        return;
                      }
                      void run(r.id, { type: "grant_chest", gearId, from: "Operator" }, "Chest granted");
                    }}
                  >
                    + chest
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {shown.length === 0 && <p className="hint">Nothing matches that.</p>}
      </section>
      )}

      <footer className="build-bar">
        <span className="build-id">{BUILD_LABEL}</span>
      </footer>
    </main>
  );
}
