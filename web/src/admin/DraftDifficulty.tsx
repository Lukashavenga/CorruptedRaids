import { useEffect, useState } from "react";
import type { FightDefinition, PartyBand } from "../../../src/engine/types.js";
import { PARTY_BANDS } from "../../../src/engine/types.js";
import type { BandReading } from "../../../src/engine/bandSolver.js";
import { getAdminKey } from "../adminKey.js";
import { measureLevel, needsAdminKey, readRatings } from "./backend.js";

/**
 * A level's reading - the engine's own type, not a copy of it.
 *
 * It used to be a separate interface here describing roughly what the server
 * sent back. Now the tab, the solver and the server all speak BandReading from
 * src/engine/bandSolver.ts, so a field added there cannot quietly go missing
 * on the way to the screen.
 */
export type Reading = BandReading;

/**
 * What each of the three layouts actually plays like.
 *
 * Three readings at once, not one, because the thing being authored is three
 * fights and the interesting failure is the one you are not looking at — a
 * squad tuned until "a crowd" reads Hard is routinely a wipe for four people
 * and a walkover for thirty.
 *
 * It measures the DRAFT over HTTP rather than an encounter id. The old meter
 * sent an id and the server looked it up on disk, so nothing you had not saved
 * could affect the number, and the reading on screen belonged to the values you
 * had just replaced. That is most of why the sliders felt inert.
 */
/**
 * Measures a draft encounter at every level, once.
 *
 * A hook rather than a component's private state because two surfaces need the
 * same answer — the level tabs show a verdict each, and the balance panel shows
 * the assumptions behind them. Measuring in both would double the server work
 * and let them disagree mid-drag, which is exactly the disconnect this screen
 * was suffering from.
 */
export function useDraftDifficulty(draft: FightDefinition | null, options: { paused?: boolean } = {}) {
  const [readings, setReadings] = useState<Partial<Record<PartyBand, Reading>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the party is assumed to be wearing. Not a detail — the same fight
  // reads 0% win against a naked party and 57% against a mixed bag of drops.
  // "band" is each level's own party, and it is the only setting the solver
  // aims at; the others are what-ifs.
  const [gear, setGear] = useState<"band" | "none" | "typical" | "best">("band");
  const paused = options.paused ?? false;

  // bandStatScale is in the key because it IS the difficulty: a Solve or a
  // strength nudge changes nothing else, and a key without it would leave
  // every tab showing the number from before the change.
  const key = JSON.stringify({
    stats: draft?.stats,
    formations: draft?.formations,
    bandStatScale: draft?.bandStatScale,
    gear,
  });

  useEffect(() => {
    // Paused while a Solve runs. Every level it finishes changes the draft,
    // and re-measuring all six after each one would be five wasted rounds of
    // requests racing the solver for the same tabs. It re-measures once when
    // the solve lets go.
    if (!draft || paused) return;

    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        // The admin key is a LOCAL requirement, asked about rather than
        // assumed. Hosted there is no game server and no key - the caller
        // already proved who they are with a Twitch sign-in the edge verified.
        if ((await needsAdminKey()) && !getAdminKey()) {
          if (!cancelled) {
            setError("Enter the admin key above to measure this draft.");
            setBusy(false);
          }
          return;
        }

        // Every level, including ones with no bodies of their own: those fight
        // the layout of the level below at their own multiplier, and the tab
        // should say what that plays like rather than going blank.
        const results = await Promise.all(
          PARTY_BANDS.map(
            async (band) => [band, await measureLevel(draft, band, gear === "band" ? undefined : gear)] as const,
          ),
        );
        if (!cancelled) {
          setReadings(Object.fromEntries(results) as Partial<Record<PartyBand, Reading>>);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, paused]);

  /** Show a reading the solver already took, without measuring it again. */
  const setReading = (band: PartyBand, reading: Reading) =>
    setReadings((current) => ({ ...current, [band]: reading }));

  return { readings, busy, error, gear, setGear, setReading };
}

interface Shape {
  label: string;
  size: number;
  rating: number;
  band: PartyBand;
}

/**
 * What real party shapes actually rate, and which level each one meets.
 *
 * The reference table for the whole difficulty model. Every question worth
 * asking about it — "what do thirty naked players get?", "does a small kitted
 * group outrank a big scruffy one?" — is answered by reading a row, rather than
 * by reasoning about a formula nobody can hold in their head.
 */
export function BalancePanel({
  gear,
  onGear,
  busy,
  error,
}: {
  gear: "band" | "none" | "typical" | "best";
  onGear: (g: "band" | "none" | "typical" | "best") => void;
  busy: boolean;
  error: string | null;
}): JSX.Element {
  const [shapes, setShapes] = useState<Shape[] | null>(null);

  // Null means "not loaded yet"; an empty array means "asked, and there is
  // nothing to show". They used to be the same value, so a failed request left
  // the table saying "measuring..." for as long as anyone cared to look at it -
  // which is what it did on every hosted page load, because /ratings is a game
  // server route and there is no game server up here.
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    readRatings()
      .then(setShapes)
      .catch((e: Error) => {
        setShapes([]);
        setFailed(e.message);
      });
  }, []);

  return (
    <div className="balance-panel">
      <div className="draft-diff-head">
        <h3 className="sub-heading">Who meets what</h3>
        {busy && <span className="diff-busy">measuring…</span>}
      </div>
      {error && <p className="admin-warn">{error}</p>}

      <table className="balance-table">
        <thead>
          <tr>
            <th>party</th>
            <th>size</th>
            <th>rating</th>
            <th>meets</th>
          </tr>
        </thead>
        <tbody>
          {(shapes ?? []).map((s) => (
            <tr key={s.label}>
              <td>{s.label}</td>
              <td>{s.size}</td>
              <td>{s.rating}</td>
              <td>LEVEL {PARTY_BANDS.indexOf(s.band) + 1}</td>
            </tr>
          ))}
          {!shapes && (
            <tr>
              <td colSpan={4} className="admin-hint">
                measuring…
              </td>
            </tr>
          )}
          {failed && (
            <tr>
              <td colSpan={4} className="admin-warn">
                {failed}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="admin-hint">
        Rating is the AVERAGE member, adjusted for composition - so turnout does not change which
        level a group meets, only how much of it they face. Gear moves it further than anything
        else you can set on an enemy.
      </p>

      <label>
        Measure levels against
        <select value={gear} onChange={(e) => onGear(e.target.value as typeof gear)}>
          <option value="band">Each level&apos;s own party (recommended)</option>
          <option value="none">Everyone with no gear</option>
          <option value="typical">Everyone mid-geared</option>
          <option value="best">Everyone fully geared</option>
        </select>
      </label>
      {gear !== "band" && (
        <p className="admin-hint">
          What-if view: the level tabs now show this party instead. Solve always aims at each level&apos;s
          own party, so a solved level can read off-target here and still be right.
        </p>
      )}
    </div>
  );
}
