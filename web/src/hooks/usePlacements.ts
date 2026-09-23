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
/**
 * Where the admin screen reads and writes placements instead.
 *
 * Injected rather than imported because the overlay and the loadout use this
 * hook too, and the admin's source goes through the operator Edge Function -
 * pulling that (and the Supabase client behind it) into the overlay bundle to
 * serve a screen the overlay never shows would be weight for nothing.
 */
export interface PlacementSource {
  load: () => Promise<PlacementFile>;
  save: (next: PlacementFile) => Promise<void>;
}

export function usePlacements(source?: PlacementSource): {
  placements: PlacementFile;
  /** Why the file could not be read. While set, `save` refuses. */
  error: string | null;
  reload: () => void;
  /** Null when written; otherwise the reason it was not. */
  save: (next: PlacementFile) => Promise<string | null>;
} {
  const [placements, setPlacements] = useState<PlacementFile>({});
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether `placements` is the real file rather than the `{}` it starts as.
   *
   * Only an injected source gates on this. Every save writes the WHOLE file,
   * so saving before the read landed - or after it failed - writes one
   * sprite's position over everyone else's.
   */
  const loaded = useRef(!source);
  const sourceRef = useRef(source);
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

    /**
     * TWO SOURCES, and the order is the point.
     *
     * `/placements` is the game server's live copy — the file the admin screen
     * writes back to, so a rectangle you just dragged shows up on the overlay
     * without a rebuild. That endpoint only exists on localhost:8787.
     *
     * The hosted loadout is a static site with no game server behind it, so
     * there the request 404s. It used to stop there and fall back to `{}`,
     * which is a VALID placement file meaning "nothing positioned yet" — so
     * there was no error, no warning, just every piece of gear drawn at
     * DEFAULT_PLACEMENT, stacked at the origin, on every character on the
     * hosted site. scripts/publish-web.ts ships the file as a static asset for
     * exactly this case.
     *
     * Server first: locally the bundled copy is a build-time snapshot and the
     * server's is current, so preferring the snapshot would silently mask the
     * edit you just made.
     */
    const load = async (): Promise<PlacementFile> => {
      for (const url of ["/placements", "/placements.json"]) {
        try {
          const res = await fetch(url);
          if (res.ok) return (await res.json()) as PlacementFile;
        } catch {
          /* unreachable is the same as absent here; try the next source */
        }
      }
      return {};
    };

    const custom = sourceRef.current;
    if (custom) {
      void custom.load().then(
        (data) => {
          loaded.current = true;
          setError(null);
          if (at < savedAt.current) return;
          setPlacements(data ?? {});
        },
        (err: unknown) => setError((err as Error).message ?? String(err)),
      );
      return;
    }

    void load().then((data) => {
      if (at < savedAt.current) return;
      setPlacements(data ?? {});
    });
  }, []);

  useEffect(reload, [reload]);

  const save = useCallback(async (next: PlacementFile): Promise<string | null> => {
    if (!loaded.current) return "Placements have not loaded, so saving would overwrite them.";
    // Optimistic: the admin screen is a direct-manipulation surface, and
    // waiting for a round trip before showing the drag you just made would
    // make positioning feel broken.
    savedAt.current = Date.now();
    setPlacements(next);
    const custom = sourceRef.current;
    if (custom) {
      try {
        await custom.save(next);
        return null;
      } catch (err) {
        return (err as Error).message ?? String(err);
      }
    }
    try {
      const res = await adminFetch("/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      return res.ok ? null : `Rejected (${res.status})`;
    } catch (err) {
      return (err as Error).message ?? String(err);
    }
  }, []);

  return { placements, error, reload, save };
}
