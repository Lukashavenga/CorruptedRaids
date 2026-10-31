import { useCallback, useEffect, useState } from "react";
import type { Role } from "../../../src/engine/types.js";
import { text, format } from "../../../src/text/index.js";
import { RoleIcon } from "../components/RoleIcon.js";
import { callCharacterFn } from "./supabase.js";

interface Standing {
  rank: number;
  name: string;
  level: number;
  role: Role;
  corruption: number;
  gold: number;
  /** Runs survived since today's reset; absent from a function deployed before it. */
  survivedToday?: number;
}

interface Dungeoneer {
  name: string;
  survived: number;
}

/**
 * The standings.
 *
 * Ranked by Corruption rather than by level or gold, because Corruption is
 * already the game's own answer to "how strong is this person" — it is what
 * scales a dungeon's band, and it folds level, spent points and worn gear into
 * one figure. Level alone would put a naked level 40 above a geared level 30
 * who beats them; gold ranks whoever spends the least.
 *
 * "Today" is the one win-like number, and it is real: runs SURVIVED since
 * the 11:00 Amsterdam reset, the tally that crowns the Dungeoneer of the day
 * on stream. Its holder heads the board, because the overlay only shows the
 * crown to whoever is watching the right run at the right moment.
 */
export function LeaderboardScreen({ viewerName }: { viewerName: string }): JSX.Element {
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [dungeoneer, setDungeoneer] = useState<Dungeoneer | null>(null);
  const t = text.loadout.leaderboard;

  const load = useCallback(async () => {
    // From the Edge Function, not the game server: this screen is opened from
    // a phone, and the game server is on the streamer's PC.
    const { status, body } = await callCharacterFn({ method: "GET" }, "?board=1");
    if (status !== 200) {
      setFailed(true);
      return;
    }
    setStandings((body.standings as Standing[]) ?? []);
    setTotal((body.rosterSize as number) ?? 0);
    setDungeoneer((body.dungeoneer as Dungeoneer | null) ?? null);
    setFailed(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>{t.title}</h2>
        <p className="screen-lead">{t.subtitle}</p>
        <button type="button" className="screen-action" onClick={() => void load()}>
          {t.refresh}
        </button>
      </header>

      {failed && <p className="screen-empty">{t.failed}</p>}
      {!failed && standings === null && <p className="screen-empty">{t.loading}</p>}
      {!failed && standings?.length === 0 && <p className="screen-empty">{t.empty}</p>}

      {standings && standings.length > 0 && (
        <>
          <div className={`board-dungeoneer${dungeoneer ? "" : " is-empty"}`}>
            <svg className="board-crown" width="27" height="18" viewBox="0 0 9 6" aria-hidden="true">
              <path d="M0 0h1v1h1v1h1V1h1V0h1v1h1v1h1V1h1V0h1v6H0z" />
            </svg>
            <div>
              <p className="board-dungeoneer-label">{t.dungeoneerTitle}</p>
              {dungeoneer ? (
                <p className="board-dungeoneer-name">
                  {dungeoneer.name}
                  {dungeoneer.name === viewerName && <em className="board-you">{t.you}</em>}
                  <span className="board-dungeoneer-count">
                    {format(t.dungeoneerSurvived, { n: dungeoneer.survived })}
                  </span>
                </p>
              ) : (
                <p className="board-dungeoneer-name">{t.dungeoneerNone}</p>
              )}
            </div>
          </div>
          <table className="board">
            <thead>
              <tr>
                <th className="board-rank">{t.rank}</th>
                <th>{t.name}</th>
                <th className="board-num">{t.level}</th>
                <th className="board-num">{t.corruption}</th>
                <th className="board-num">{t.gold}</th>
                <th className="board-num" title={t.todayHint}>{t.today}</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => (
                // Matched on NAME, not id: the endpoint deliberately sends no
                // viewer ids — a leaderboard is a display surface, not a
                // directory of the chat.
                <tr key={`${row.rank}-${row.name}`} className={row.name === viewerName ? "is-you" : ""}>
                  <td className="board-rank">{row.rank}</td>
                  <td className="board-name">
                    <RoleIcon role={row.role} size={16} />
                    <span>{row.name}</span>
                    {row.name === viewerName && <em className="board-you">{t.you}</em>}
                  </td>
                  <td className="board-num">{row.level}</td>
                  <td className="board-num board-corruption">{row.corruption}</td>
                  <td className="board-num">{row.gold}</td>
                  <td className="board-num">{row.survivedToday ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="screen-foot">{format(t.counted, { shown: standings.length, total })}</p>
        </>
      )}
    </section>
  );
}
