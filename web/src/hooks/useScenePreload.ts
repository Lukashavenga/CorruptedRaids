import { useEffect } from "react";
import type { ContentCatalog } from "./useContentCatalog.js";
import { backgroundUrl, foregroundUrl } from "../sprites.js";

/**
 * Pulls every scene into the browser cache as soon as the catalogue is known.
 *
 * WHY: the backdrop is only referenced once a run names one, so its request
 * fires when the overlay first draws that run. Measured on a real stream-shaped
 * sequence — open, join, start inside a second — the image had not arrived by
 * the time combat was drawing, and the opening beats of the fight played out
 * against black. The stage looked broken at exactly the moment an audience was
 * being asked to look at it.
 *
 * WHY IT IS CHEAP ENOUGH TO DO EAGERLY: after scripts/squeeze-art.py the whole
 * scene set is a few hundred KB rather than 15 MB, so warming all of them the
 * moment the overlay loads costs less than one backdrop used to. This hook and
 * that script are one change; doing this before the squeeze would have traded
 * a black stage for a slow boot.
 *
 * `Image` rather than `<link rel="preload">` because the overlay is an OBS
 * browser source that never navigates — there is no document head worth
 * managing, and a decoded image in the cache is exactly what is wanted.
 */
export function useScenePreload(catalog: ContentCatalog): void {
  useEffect(() => {
    if (catalog.fightsById.size === 0) return;

    const urls = new Set<string>();
    for (const entry of catalog.fightsById.values()) {
      if (entry.background) urls.add(backgroundUrl(entry.background));
      if (entry.foreground) urls.add(foregroundUrl(entry.foreground));
    }

    // Held in a local array so they are not collected before they finish.
    const images = [...urls].map((url) => {
      const img = new Image();
      // The scenes are decoration for a fight that has not started; nothing
      // waits on them, so they should not compete with the run's own requests.
      img.decoding = "async";
      img.src = url;
      return img;
    });

    return () => {
      // Dropping src lets the browser abandon anything still in flight if the
      // overlay is torn down mid-load.
      for (const img of images) img.src = "";
    };
  }, [catalog.fightsById]);
}
