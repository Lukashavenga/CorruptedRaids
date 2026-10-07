import { useEffect, useState } from "react";
import type { DungeonSnapshot } from "../../../src/state/DungeonController.js";
import type { DispatchResult } from "../../../src/engine/state/gameEngine.js";
import { loadLocalGame } from "../localGameLink.js";

export interface GameConnectionState {
  connected: boolean;
  snapshot: DungeonSnapshot | null;
  lastResult: DispatchResult | null;
  /** Bumps on every message so consumers (useCombatPlayback) can detect a fresh update even if its payload looks identical to the last one. */
  updateSeq: number;
}

/**
 * Subscribes to the server's SSE stream (GET /events — see src/server/
 * index.ts) and exposes the latest DungeonSnapshot. This is the overlay's
 * only source of truth; nothing else polls or holds its own copy of game
 * state. Reconnects automatically — EventSource does that natively on
 * error, this hook just surfaces `connected` for the UI to show it.
 */
export function useGameConnection(): GameConnectionState {
  const [state, setState] = useState<GameConnectionState>({
    connected: false,
    snapshot: null,
    lastResult: null,
    updateSeq: 0,
  });

  useEffect(() => {
    // A standalone build has no server to listen to; the game is in the page.
    // Same messages in the same order, so everything downstream of this hook
    // is unaware of the difference - see web/src/localGameLink.ts.
    if (loadLocalGame) {
      let stop: (() => void) | undefined;
      let cancelled = false;
      loadLocalGame().then(
        (game) => {
          if (cancelled) return;
          stop = game.subscribe(({ snapshot, result }) => {
            setState((s) => ({ connected: true, snapshot, lastResult: result, updateSeq: s.updateSeq + 1 }));
          });
        },
        // Content that fails validation lands here. The stage goes on saying
        // "disconnected", which is true, and the console says why.
        (err: unknown) => console.error("The standalone game could not start:", err),
      );
      return () => {
        cancelled = true;
        stop?.();
      };
    }

    const source = new EventSource("/events");

    source.addEventListener("open", () => {
      setState((s) => ({ ...s, connected: true }));
    });

    source.addEventListener("update", (e: MessageEvent) => {
      const { snapshot, result } = JSON.parse(e.data) as {
        snapshot: DungeonSnapshot;
        result: DispatchResult | null;
      };
      setState((s) => ({ connected: true, snapshot, lastResult: result, updateSeq: s.updateSeq + 1 }));
    });

    source.onerror = () => {
      setState((s) => ({ ...s, connected: false }));
    };

    return () => source.close();
  }, []);

  return state;
}
