/**
 * The content a study measures: the store the game plays, unless told otherwise.
 *
 * `simulate:progression`, `report:threat` and `report:balance` all opened
 * `content/` on disk, and the hosted panel edits the store. By 2026-10-31 that
 * meant a survivor loot chance of 0.375 in the reports against 0.886 on stream,
 * win targets up to 20 points out, and a shop "topping out at 260g" with
 * legendaries on the shelf at 6,200g. The reports printed all of it confidently,
 * and AGENTS.md §10 recorded findings about a game nobody was playing.
 *
 * `npm run simulate` and `check:formations` stay on the disk on purpose: they
 * can fail the build, so they have to be offline and deterministic. These
 * studies assert nothing and exist to describe the real game, so they read it.
 *
 * It always says which copy it used, and a store that is configured but
 * unreadable stops the study rather than falling back: a silent fallback is the
 * exact failure this replaces.
 *
 *   --disk    measure content/ as committed, e.g. to try an edit before saving
 */
import { join } from "node:path";
import { ContentRegistry } from "../src/engine/content/loader.js";
import { loadContentFromSupabase } from "../src/server/contentStore.js";

export async function loadStudyContent(root: string): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  if (!process.argv.includes("--disk")) {
    const live = await loadContentFromSupabase(content);
    if (live.loaded) {
      console.log(`CONTENT: the live store, ${live.count} files. What the game plays. (--disk measures content/ instead)`);
      return content;
    }
    console.log("CONTENT: content/ on disk, because SUPABASE_URL and SUPABASE_SERVICE_KEY are not set. THIS MAY NOT BE WHAT THE GAME PLAYS.");
  } else {
    console.log("CONTENT: content/ on disk (--disk). THIS MAY NOT BE WHAT THE GAME PLAYS.");
  }
  const dir = join(root, "content");
  content.loadGearDir(join(dir, "gear"));
  content.loadDungeonsDir(join(dir, "dungeons"));
  content.loadConsumablesDir(join(dir, "consumables"));
  content.loadBalance(join(dir, "balance.json"));
  content.loadShop(join(dir, "shop.json"));
  return content;
}
