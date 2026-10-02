import { useCallback, useEffect, useState } from "react";
import { text } from "../../../src/text/index.js";
import type { GameCommand } from "../../../src/engine/commands/types.js";
import type { StateId } from "../../../src/state/dungeonStates.config.js";
import { adminFetch } from "../adminKey.js";

export interface SimControlsProps {
  state: StateId;
  partySize: number;
  /** Everything openable, so this offers a choice rather than a hardcoded id. */
  dungeons: { id: string; name: string; recommendedLevel: number }[];
  raids: { id: string; name: string; recommendedLevel: number; enabled?: boolean }[];
  /** True while a raid is offering doors — enables the path buttons. */
  choosing: boolean;
}

/**
 * The streamer-facing testing strip: open a run, fill it with fake viewers,
 * start the fight.
 *
 * This is NOT part of the spectator overlay — it dispatches exactly the same
 * `GameCommand`s a Twitch redemption layer will (§5.2), so nothing here is
 * a special path that has to be torn out later. It's hidden from the OBS
 * source by appending `?sim=0` to the browser-source URL.
 */
export function SimControls({
  state,
  partySize,
  dungeons,
  raids,
  choosing,
}: SimControlsProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dungeonId, setDungeonId] = useState("");
  const [raidId, setRaidId] = useState("");

  /**
   * How the working surface is lit.
   *
   * The overlay is transparent because OBS composites it over a scene, but a
   * transparent page in a normal browser is whatever the browser paints —
   * white — and light UI over white is unreadable. "dark" is the default for
   * working; "checker" shows exactly which pixels are actually transparent, and
   * "clear" is what OBS really gets. None of this exists when `?sim=0`.
   */
  const [backdrop, setBackdrop] = useState<"dark" | "checker" | "clear">("dark");

  useEffect(() => {
    if (dungeons.some((d) => d.id === dungeonId)) return;
    // Default to the gentlest, which is where a test run usually wants to start.
    const easiest = [...dungeons].sort((a, b) => a.recommendedLevel - b.recommendedLevel)[0];
    setDungeonId(easiest?.id ?? "");
  }, [dungeons, dungeonId]);

  useEffect(() => {
    if (!raids.some((r) => r.id === raidId)) setRaidId(raids[0]?.id ?? "");
  }, [raids, raidId]);

  // Applied to the document, not the stage: the stage must stay transparent so
  // what is being previewed is genuinely what OBS will composite.
  useEffect(() => {
    document.body.dataset.simBackdrop = backdrop;
    return () => {
      delete document.body.dataset.simBackdrop;
    };
  }, [backdrop]);

  const send = useCallback(async (command: GameCommand) => {
    setBusy(true);
    try {
      const res = await adminFetch("/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const body = (await res.json()) as { ok: boolean; message: string };
      setMessage(body.message);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="sim-controls">
      <div className="sim-row">
        <span className="sim-title">{text.sim.title}</span>
        <select
          value={dungeonId}
          disabled={busy || state !== "idle"}
          onChange={(e) => setDungeonId(e.target.value)}
        >
          {/* Ordered by difficulty rather than by file: a list of places to
              raid reads as a progression, not as a directory listing. */}
          {[...dungeons]
            .sort((a, b) => a.recommendedLevel - b.recommendedLevel)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
        <button
          disabled={busy || state !== "idle" || !dungeonId}
          onClick={() => send({ type: "open_dungeon", dungeonId })}
        >
          {text.sim.openDungeon}
        </button>
        <button disabled={busy || state !== "gathering"} onClick={() => send({ type: "sim_join", count: 5, dress: true })}>
          {text.sim.joinFive}
        </button>
        <button disabled={busy || state !== "gathering"} onClick={() => send({ type: "sim_join", count: 25, dress: true })}>
          {text.sim.joinCrowd}
        </button>
        <button
          className="primary"
          disabled={busy || state !== "gathering" || partySize === 0}
          onClick={() => send({ type: "start_dungeon" })}
        >
          {text.sim.startDungeon}
        </button>
        <button disabled={busy} onClick={() => send({ type: "reset_dungeon" })}>
          {text.sim.reset}
        </button>
      </div>

      {/* Raid strip. The path buttons stand in for a chat vote: whatever
          decides the direction later reduces to this same choose_path command,
          which is the point of routing it through the command seam at all. */}
      <div className="sim-row">
        <span className="sim-title">{text.sim.raidTitle}</span>
        <select value={raidId} disabled={busy || state !== "idle"} onChange={(e) => setRaidId(e.target.value)}>
          {raids.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.recommendedLevel}){r.enabled === false ? " - inactive" : ""}
            </option>
          ))}
        </select>
        <button
          disabled={busy || state !== "idle" || !raidId}
          onClick={() => send({ type: "open_raid", raidId })}
        >
          {text.sim.openRaid}
        </button>
        {(["left", "up", "right"] as const).map((direction) => (
          <button
            key={direction}
            disabled={busy || !choosing}
            onClick={() => send({ type: "choose_path", direction })}
          >
            {text.raid.door[direction]}
          </button>
        ))}
      </div>
      <div className="sim-row">
        <span className="sim-title">{text.sim.backdrop}</span>
        {(["dark", "checker", "clear"] as const).map((mode) => (
          <button
            key={mode}
            className={backdrop === mode ? "primary" : ""}
            onClick={() => setBackdrop(mode)}
          >
            {text.sim.backdropMode[mode]}
          </button>
        ))}
      </div>

      <div className="sim-hint">{message ?? text.sim.hint}</div>
    </div>
  );
}
