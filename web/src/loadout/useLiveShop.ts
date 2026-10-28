import { useEffect, useState } from "react";
import type { ShopView } from "../../../src/engine/types.js";
import { callCharacterFn } from "./supabase.js";

/** How often a loadout left open looks at the shelf again. */
const REFRESH_MS = 30_000;

/**
 * The shop as it is NOW, from the character function.
 *
 * The loadout's content is a bundle baked at deploy, which is right for gear
 * art and stats and wrong for a shelf the streamer restocks from the admin
 * panel: it would show last deploy's stock. The function answers from the
 * content store (and is the thing that checks and charges a purchase), so what
 * is shown and what is charged come from one place.
 *
 * Null until it answers, and again if it cannot be reached; the caller then
 * keeps the bundled shop. An old shelf is better than an empty one, and a
 * purchase is re-checked server-side either way.
 *
 * Re-read on a timer and when the tab comes back to the front, because a phone
 * loadout is left open for hours and the stream is where the restock happens.
 */
export function useLiveShop(): ShopView | null {
  const [shop, setShop] = useState<ShopView | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void callCharacterFn({ method: "GET" }, "?shop=1").then(({ status, body }) => {
        if (cancelled || status !== 200) return;
        const next = body.shop as ShopView | undefined;
        if (next && Array.isArray(next.gear) && Array.isArray(next.consumables)) setShop(next);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return shop;
}
