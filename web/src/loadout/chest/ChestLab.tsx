import { useEffect, useRef, useState } from "react";
import type { Rarity } from "../../../../src/engine/types.js";
import { ChestStage, type ChestStageHandle } from "./ChestStage.js";
import { OPEN_MS, REVEAL_AT, SHAKE_MS } from "./chestTimeline.js";
import "../motion.css";

/**
 * A review bench for the chest opening: `loadout.html?chestLab`.
 *
 * DEV ONLY. main.tsx imports this behind the query string, so it is its own
 * chunk and nothing in the normal loadout flow reaches it. Its labels are not
 * player-facing copy and are not in src/text/en.ts for that reason.
 *
 * One chest per rarity, each with Play and Play at 1/4 speed, and a switch for
 * reduced motion that overrides the OS setting so the cross-fade path can be
 * checked without changing system preferences. A play is a remount (the stage
 * reads speed and reduced motion when it is built), and the "request" lands
 * immediately - the scene still holds the wind-up for its full length.
 */

const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

interface Run {
  /** Bumped per play; it is the key that remounts the stage. */
  id: number;
  speed: number;
}

export function ChestLab(): JSX.Element {
  const [reduced, setReduced] = useState(false);
  return (
    <main style={{ padding: 24, color: "#e8e0d0", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.1rem" }}>Chest lab</h1>
      <p style={{ opacity: 0.7, maxWidth: 640 }}>
        Wind-up {SHAKE_MS}ms, then the open takes {OPEN_MS}ms and the item appears at{" "}
        {Math.round(OPEN_MS * REVEAL_AT)}ms into it. Timings are in chest/chestTimeline.ts.
      </p>
      <label style={{ display: "block", margin: "12px 0" }}>
        <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Reduced motion
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        {RARITIES.map((r) => (
          <LabChest key={r} rarity={r} reduced={reduced} />
        ))}
      </div>
    </main>
  );
}

function LabChest({ rarity, reduced }: { rarity: Rarity; reduced: boolean }): JSX.Element {
  const [run, setRun] = useState<Run | null>(null);
  const [revealed, setRevealed] = useState(false);
  const stage = useRef<ChestStageHandle>(null);

  const play = (speed: number) => {
    setRevealed(false);
    setRun((prev) => ({ id: (prev?.id ?? 0) + 1, speed }));
  };

  // The stage mounts, then the "request" lands.
  useEffect(() => {
    if (run) stage.current?.release(rarity);
  }, [run, rarity, reduced]);

  return (
    <section style={{ width: 320 }}>
      <h2 style={{ fontSize: "0.9rem", textTransform: "capitalize" }}>{rarity}</h2>
      <div style={{ position: "relative", ["--chest-size" as string]: "320px" }}>
        {run ? (
          <ChestStage
            key={`${run.id}-${reduced}`}
            ref={stage}
            speed={run.speed}
            reducedMotion={reduced}
            onReveal={() => setRevealed(true)}
          />
        ) : (
          <span className="chest-stage" style={{ ["--chest-size" as string]: "320px" }}>
            <span className="chest-sprite" style={{ ["--chest-size" as string]: "320px" }} />
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={() => play(1)}>
          Play
        </button>
        <button type="button" onClick={() => play(0.25)}>
          Play at ¼ speed
        </button>
        <span style={{ opacity: 0.7 }}>{revealed ? "revealed" : run ? "playing" : ""}</span>
      </div>
    </section>
  );
}
