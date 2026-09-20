import { useCallback, useEffect, useRef, useState } from "react";
import type { PlacementFile } from "../../../src/character/layers.js";
import { adminFetch } from "../adminKey.js";

/**
 * Loads content/placements.json from the server.
 *
 * Every surface that draws a character needs this, and it is the same data for
 * all of them, so it is fetched once per screen rather than threaded through
 * props from wherever a character happens to be rendered.
 *
 * Starts as `{}` rather than null: an empty placement file is a valid state
 * (nothing positioned yet) and every lookup already falls back to
 * DEFAULT_PLACEMENT, so callers never need a loading branch. The character just
 * draws with its gear stacked at the origin for one frame.
 */
export function usePlacements(): {
  placements: PlacementFile;
  reload: () => void;
  save: (next: PlacementFile) => Promise<boolean>;
} {
  const [placements, setPlacements] = useState<PlacementFile>({});
  /**
   * When the newest local edit was made.
   *
   * A fetch in flight when you save is carrying a copy of the file from BEFORE
   * that save, and applying it afterwards silently reverts the edit — the
   * rectangle you just dragged is still on screen, but the next write is built
   * from the reverted state and drops it. Stamping each save and ignoring any
   * response older than the last one closes that window; a reload asked for
   * after the save still lands, because its stamp is newer.
   */
  const savedAt = useRef(0);

  const reload = useCallback(() => {
    const at = Date.now();
    fetch("/placements")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (at < savedAt.current) return;
        setPlacements(data ?? {});
      })
      .catch(() => {
        if (at < savedAt.current) return;
        setPlacements({});
      });
  }, []);

  useEffect(reload, [reload]);

  const save = useCallback(async (next: PlacementFile) => {
    // Optimistic: the admin screen is a direct-manipulation surface, and
    // waiting for a round trip before showing the drag you just made would
    // make positioning feel broken.
    savedAt.current = Date.now();
    setPlacements(next);
    try {
      const res = await adminFetch("/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return { placements, reload, save };
}
