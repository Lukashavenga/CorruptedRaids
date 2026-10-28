import { useEffect, useMemo, useState } from "react";
import { LOOT_CHANCE_KEYS, lootChanceProblem, type LootChances } from "../../../src/engine/content/schemas.js";
import type { LootReading } from "../../../src/engine/lootMeasure.js";
import { en } from "../../../src/text/en.js";
import { format } from "../../../src/text/format.js";
import { measureLoot, NeedsLocalPanel, readLootChances, writeLootChances } from "./backend.js";

/**
 * The drop-rate dial.
 *
 * One multiplier scales the three loot chances together, because that is how
 * they are meant to move (AGENTS.md section 4): the order survived > died in a
 * win > lost has to hold, and scaling keeps it. The three can also be set one
 * by one under Advanced, and then the screen is only as safe as the check on
 * them - which is the same function the server and the Edge Function run, so a
 * set this refuses is a set they would refuse.
 *
 * The numbers beside the dial are MEASURED by the game server (lootMeasure.ts),
 * not computed from the chances: how many items a chance of 0.375 produces
 * depends on boss fights, who survives and the tables.
 */
const t = en.lootAdmin;
const FIELD_LABEL: Record<(typeof LOOT_CHANCE_KEYS)[number], string> = {
  survivorLootChance: t.survivor,
  casualtyLootChance: t.casualty,
  defeatLootChance: t.defeat,
};

const round = (n: number) => Number(n.toFixed(4));

function problemText(chances: LootChances): string | null {
  const problem = lootChanceProblem(chances);
  if (!problem) return null;
  return problem.code === "range"
    ? format(t.refusedRange, { field: FIELD_LABEL[problem.key] })
    : t.refusedOrder;
}

export function LootTuner({ setStatus }: { setStatus: (message: string) => void }): JSX.Element {
  const [live, setLive] = useState<LootChances | null>(null);
  const [chances, setChances] = useState<LootChances | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [liveReading, setLiveReading] = useState<LootReading | null>(null);
  const [reading, setReading] = useState<LootReading | null>(null);
  const [measureNote, setMeasureNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    readLootChances()
      .then((c) => {
        setLive(c);
        setChances(c);
      })
      .catch((err: Error) => setStatus(`Not loaded: ${err.message}`));
  }, [setStatus]);

  const problem = useMemo(() => (chances ? problemText(chances) : null), [chances]);

  // The saved setting, once, to compare the draft against.
  useEffect(() => {
    if (!live) return;
    measureLoot(live)
      .then(setLiveReading)
      .catch((err: Error) => setMeasureNote(err instanceof NeedsLocalPanel ? t.hostedMeasure : err.message));
  }, [live]);

  // The draft, after the dial stops moving. A refused set is never measured.
  useEffect(() => {
    if (!chances || problem) return;
    setReading(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      measureLoot(chances)
        .then((r) => !cancelled && setReading(r))
        .catch((err: Error) => !cancelled && setMeasureNote(err instanceof NeedsLocalPanel ? t.hostedMeasure : err.message));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chances, problem]);

  if (!live || !chances) return <div className="loot-tuner">{t.measuring}</div>;

  const scale = (m: number) => {
    setMultiplier(m);
    setChances(
      Object.fromEntries(LOOT_CHANCE_KEYS.map((k) => [k, round(live[k] * m)])) as LootChances,
    );
  };
  const setOne = (key: (typeof LOOT_CHANCE_KEYS)[number], value: number) => {
    const next = { ...chances, [key]: value };
    setChances(next);
    setMultiplier(live.survivorLootChance > 0 ? round(next.survivorLootChance / live.survivorLootChance) : 1);
  };

  const unchanged = LOOT_CHANCE_KEYS.every((k) => chances[k] === live[k]);

  const save = async () => {
    setBusy(true);
    try {
      await writeLootChances(chances);
      setLive(chances);
      setMultiplier(1);
      setStatus(t.savedStatus);
    } catch (err) {
      setStatus(format(t.refusedGeneric, { reason: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const night = (r: LootReading | null) => (r ? r.perViewerPerNight.toFixed(1) : "…");

  return (
    <div className="loot-tuner">
      <h2>{t.title}</h2>
      <p>{t.intro}</p>

      <label className="loot-dial">
        <span>{t.multiplier}</span>
        <input
          type="range"
          min={0}
          max={4}
          step={0.05}
          value={Math.min(4, multiplier)}
          onChange={(e) => scale(Number(e.target.value))}
        />
        <input
          type="number"
          min={0}
          step={0.05}
          value={multiplier}
          onChange={(e) => scale(Number(e.target.value))}
        />
        <small>{t.multiplierHint}</small>
      </label>

      <h3>{t.resulting}</h3>
      <ul className="loot-chances">
        {LOOT_CHANCE_KEYS.map((k) => (
          <li key={k}>
            {FIELD_LABEL[k]}: <b>{chances[k]}</b>
          </li>
        ))}
      </ul>

      <details>
        <summary>{t.advanced}</summary>
        <p>{t.advancedHint}</p>
        {LOOT_CHANCE_KEYS.map((k) => (
          <label key={k} className="loot-field">
            <span>{FIELD_LABEL[k]}</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.005}
              value={chances[k]}
              onChange={(e) => setOne(k, Number(e.target.value))}
            />
          </label>
        ))}
      </details>

      {problem && <p className="loot-problem">{problem}</p>}

      <h3>{t.measureTitle}</h3>
      <p>{t.measureNote}</p>
      {measureNote ? (
        <p>{measureNote}</p>
      ) : problem ? null : (
        <ul className="loot-reading">
          <li>{reading ? format(t.perRun, { n: reading.perViewerPerRun.toFixed(2) }) : t.measuring}</li>
          <li>{format(t.perNight, { n: night(reading), runs: reading?.runsPerNight ?? "…" })}</li>
          <li>{format(t.saved, { n: night(liveReading) })}</li>
          {reading && (
            <li>
              {reading.dungeons.map((d) => `${d.name} ${d.perViewerPerRun.toFixed(2)}`).join(" · ")}
            </li>
          )}
        </ul>
      )}

      <button type="button" disabled={busy || !!problem || unchanged} onClick={() => void save()}>
        {busy ? t.saving : t.save}
      </button>
      {problem && <small className="loot-problem">{format(t.cannotSave, { reason: problem })}</small>}
      {!problem && unchanged && <small>{t.unchanged}</small>}
    </div>
  );
}
