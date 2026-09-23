import { useCallback, useEffect, useState } from "react";
import { readContent } from "./backend.js";
import type {
  DungeonDefinition,
  GearDefinition,
  RaidDefinition,
} from "../../../src/engine/types.js";

/**
 * Dungeons, raids and gear as the server currently has them loaded.
 *
 * Separate from useContentCatalog because the tuning screens need something
 * that one does not: a `reload`. Saving a tuned fight rewrites its JSON and the
 * server re-reads its registry, so the screen has to re-fetch to see the values
 * it just wrote — otherwise the sliders and the difficulty readout drift apart,
 * one showing the draft and the other the saved content.
 */
export function useTuningContent(): {
  raids: RaidDefinition[];
  gear: GearDefinition[];
  dungeons: DungeonDefinition[];
  reload: () => void;
} {
  const [raids, setRaids] = useState<RaidDefinition[]>([]);
  const [gear, setGear] = useState<GearDefinition[]>([]);
  const [dungeons, setDungeons] = useState<DungeonDefinition[]>([]);

  // Through the backend switch, so the same screens work served by the game
  // server and served as a static page. See web/src/admin/backend.ts.
  const reload = useCallback(() => {
    readContent()
      .then((data) => {
        setRaids(data.raids as RaidDefinition[]);
        setGear(data.gear as GearDefinition[]);
        setDungeons(data.dungeons as DungeonDefinition[]);
      })
      .catch(() => {
        setRaids([]);
        setGear([]);
        setDungeons([]);
      });
  }, []);

  useEffect(reload, [reload]);

  return { raids, gear, dungeons, reload };
}
