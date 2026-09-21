/**
 * The game's sound cues.
 *
 * The files live in `content/` alongside the dungeons and gear they belong to,
 * and are IMPORTED rather than copied into `web/public/`. Vite hashes and emits
 * an imported asset, so there is exactly one copy of each track in the repo,
 * the build fails loudly if one is renamed, and a track nothing imports never
 * ships. A `public/` copy would be a second source of truth that drifts the
 * first time someone re-exports a track.
 *
 * WHICH TRACK, AND WHY THE SHORT ONE
 * ----------------------------------
 * `content/` carries three lengths of the dungeon-start sting. The SHORT one is
 * used: it plays under a state transition the overlay animates in well under a
 * second, and a five-second stinger over a half-second transition is still
 * playing while the party is already fighting. The long version is kept for a
 * pre-roll or a stream-starting card, which is a different job.
 *
 * AUTOPLAY
 * --------
 * Browsers refuse audio until the page has been interacted with, and `play()`
 * REJECTS rather than throwing synchronously. Every call swallows that: the
 * overlay runs unattended in an OBS browser source where the policy does not
 * apply, and on the loadout a missed sound must never become an unhandled
 * rejection in a viewer's console — the chest still opens either way.
 */
import bossFound from "../../content/boss_found.mp3";
import chestOpen from "../../content/open_chest.mp3";
import dungeonStart from "../../content/dungeon_start_short.mp3";
import raidStart from "../../content/raid_start.mp3";
import roomDiscover from "../../content/room_discover.mp3";

export type Cue = "dungeonStart" | "raidStart" | "roomDiscover" | "bossFound" | "chestOpen";

const SOURCES: Record<Cue, string> = {
  dungeonStart,
  raidStart,
  roomDiscover,
  bossFound,
  chestOpen,
};

/**
 * Per-cue level, because these were not mastered together.
 *
 * The two stings that mark a run beginning are the loudest thing the game does
 * and sit under a title card; the room and boss cues fire repeatedly during a
 * run and are punctuation, not announcements. Mixing them at the same gain
 * makes the frequent ones tiring — which is how a streamer ends up muting the
 * browser source, taking the good cues with them.
 */
const VOLUME: Record<Cue, number> = {
  dungeonStart: 0.7,
  raidStart: 0.7,
  roomDiscover: 0.45,
  bossFound: 0.6,
  chestOpen: 0.55,
};

const cache = new Map<Cue, HTMLAudioElement>();

function element(cue: Cue): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  let el = cache.get(cue);
  if (!el) {
    el = new Audio(SOURCES[cue]);
    el.preload = "auto";
    el.volume = VOLUME[cue];
    cache.set(cue, el);
  }
  return el;
}

let muted = false;

/** Silence every cue. The overlay exposes this; the loadout does not yet. */
export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

/**
 * Play a cue, from the start, without waiting for it.
 *
 * Rewinding rather than cloning per call is deliberate: these cues mark
 * transitions that cannot overlap with themselves — you do not discover the
 * same room twice — and a clone-per-play leaks elements on a surface that runs
 * for an entire stream.
 */
export function play(cue: Cue): void {
  if (muted) return;
  const el = element(cue);
  if (!el) return;
  try {
    el.currentTime = 0;
  } catch {
    /* not seekable yet; it will simply start where it is */
  }
  void el.play().catch(() => {
    /* autoplay refused, or the source failed to load — see the header */
  });
}

/**
 * Warm the decoder for cues about to be needed.
 *
 * Called once the overlay is up. Without it the FIRST dungeon start of a
 * stream plays late, because the fetch and decode happen after the transition
 * has already begun — and the first one is the one an audience notices.
 */
export function preload(...cues: Cue[]): void {
  for (const cue of cues) element(cue)?.load();
}
