import { useEffect, useState } from "react";
import { getAdminKey } from "../adminKey.js";
import { measureDifficulty, needsAdminKey } from "./backend.js";

export interface DifficultyReport {
  winRate: number;
  survivorRate: number;
  avgTicks: number;
  partySize: number;
  rating: string;
  stalemateRate: number;
}

export interface Composition {
  tanks: number;
  dps: number;
  healers: number;
  level: number;
}

/** Which fight to measure. Structured, because two backends spell it differently. */
export interface MeterTarget {
  dungeonId?: string;
  raidId?: string;
  roomId?: string;
}

/**
 * Live difficulty readout for whatever is being tuned.
 *
 * The number is a MEASURED win rate — a few dozen fights actually resolved
 * against the composition below (see src/engine/difficulty.ts), by the game
 * server locally and by the operator Edge Function when this page is hosted.
 * That is why the composition controls are part of this component rather than
 * a global setting: "how hard is this" has no answer without "for whom", and
 * the whole point of the role rework is that the answer changes enormously
 * with party makeup. A place is Fair for a balanced six and Brutal for six
 * damage dealers, and a tuning screen that hid that would be lying.
 */
export function DifficultyMeter({
  target,
  composition,
  onComposition,
}: {
  target: MeterTarget;
  composition: Composition;
  onComposition: (next: Composition) => void;
}): JSX.Element {
  const [report, setReport] = useState<DifficultyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify(target);

  useEffect(() => {
    if (!target.dungeonId && !target.raidId) return;

    let cancelled = false;
    setBusy(true);
    const { tanks, dps, healers, level } = composition;

    // Debounced: a slider drag fires a change per pixel, and each reading is a
    // few dozen simulated fights.
    const t = setTimeout(async () => {
      try {
        // Locally the key is real - /difficulty is gated by ADMIN_SECRET, and
        // firing without one earns a 401 and an alarming red message before the
        // operator has had a chance to type anything. Hosted there is no game
        // server to hold that secret, and the sign-in already happened.
        if ((await needsAdminKey()) && !getAdminKey()) {
          if (!cancelled) {
            setError("Enter the admin key above to measure difficulty.");
            setBusy(false);
          }
          return;
        }
        const data = await measureDifficulty({ ...target, composition: { tanks, dps, healers }, level, samples: 150 });
        if (cancelled) return;
        setReport(data as unknown as DifficultyReport);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, composition]);

  const field = (label: string, key: keyof Composition, max: number) => (
    <label className="diff-field">
      {label} {composition[key]}
      <input
        type="range"
        min={key === "level" ? 1 : 0}
        max={max}
        value={composition[key]}
        onChange={(e) => onComposition({ ...composition, [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="diff">
      <div className="diff-head">
        <span className={`diff-rating rating-${(report?.rating ?? "").toLowerCase()}`}>
          {error ? "-" : (report?.rating ?? "…")}
        </span>
        <span className="diff-win">
          {report && !error ? `${Math.round(report.winRate * 100)}% win` : error ?? ""}
        </span>
        {busy && <span className="diff-busy">measuring…</span>}
      </div>

      {report && !error && (
        <>
          {/* A win rate alone hides how a fight is won. Survivors is the number
              that separates "cleared it" from "cleared it and lost half the
              party", which is exactly what a tank or healer changes. */}
          <div className="diff-bar" title={`${Math.round(report.winRate * 100)}% of simulated fights won`}>
            <span className="diff-bar-fill" style={{ width: `${report.winRate * 100}%` }} />
          </div>
          <div className="diff-stats">
            <span>{Math.round(report.survivorRate * 100)}% survive</span>
            <span>{Math.round(report.avgTicks)} ticks</span>
            {report.stalemateRate > 0 && (
              <span className="diff-warn">{Math.round(report.stalemateRate * 100)}% stalemate</span>
            )}
          </div>
        </>
      )}

      <div className="diff-comp">
        {field("Tanks", "tanks", 10)}
        {field("DPS", "dps", 20)}
        {field("Healers", "healers", 10)}
        {field("Corruption", "level", 25)}
      </div>
    </div>
  );
}
