import { useEffect, useState } from "react";
import { adminFetch, getAdminKey } from "../adminKey.js";

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

/**
 * Live difficulty readout for whatever is being tuned.
 *
 * The number is a MEASURED win rate — the server simulates a few hundred
 * fights against the composition below (see src/engine/difficulty.ts). That is
 * why the composition controls are part of this component rather than a global
 * setting: "how hard is this" has no answer without "for whom", and the whole
 * point of the role rework is that the answer changes enormously with party
 * makeup. Marketgate is Fair for a balanced six and Brutal for six damage
 * dealers, and a tuning screen that hid that would be lying.
 */
export function DifficultyMeter({
  query,
  composition,
  onComposition,
}: {
  /** Query string identifying the fight: `dungeonId=…`, `raidId=…` or `encounters=…`. */
  query: string;
  composition: Composition;
  onComposition: (next: Composition) => void;
}): JSX.Element {
  const [report, setReport] = useState<DifficultyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) return;

    // No key, no request. /difficulty is gated now, so firing without one
    // earns a 401 and an alarming red message before the operator has had a
    // chance to type anything. Saying what is missing beats reporting that
    // the server refused a header nobody had entered yet.
    if (!getAdminKey()) {
      setError("Enter the admin key above to measure difficulty.");
      setBusy(false);
      return;
    }

    let cancelled = false;
    setBusy(true);
    const { tanks, dps, healers, level } = composition;
    const url = `/difficulty?${query}&tanks=${tanks}&dps=${dps}&healers=${healers}&level=${level}&samples=150`;

    // Debounced: a slider drag fires a change per pixel, and each reading is a
    // few hundred simulated fights on the server.
    const t = setTimeout(() => {
      adminFetch(url)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (data && typeof data.winRate === "number") {
            setReport(data);
            setError(null);
          } else {
            setError(data?.message ?? "could not measure");
          }
        })
        .catch((e) => !cancelled && setError((e as Error).message))
        .finally(() => !cancelled && setBusy(false));
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, composition]);

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
