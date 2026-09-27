/**
 * The search for a level's multiplier, as a state machine with no simulator in it.
 *
 * WHY A STATE MACHINE AND NOT A LOOP. The obvious solver is a loop that calls
 * the simulator until it converges, and it was measured at up to 2.5s for one
 * level of `lady-of-knight` - forty bodies, eleven readings of sixty fights
 * each. The hosted admin panel runs the simulator inside a Supabase Edge
 * Function, which has a hard budget of 2s of CPU per request. A loop that
 * cannot be interrupted is a loop that gets killed half way through the
 * dungeons that most need solving.
 *
 * So the search holds its whole position in a plain object. Whoever is
 * driving it asks where to measure next, measures, reports back, and can stop
 * after any reading, send the object somewhere else, and carry on. The game
 * server drives it to the end in one go; the Edge Function runs it until it
 * has used ~800ms and returns the state for the browser to send back.
 *
 * NOTHING HERE MEASURES ANYTHING, and that is deliberate. It is pure arithmetic
 * over win rates it is handed, so there is exactly one copy of the search
 * whether the readings come from a Node process, an Edge Function or a test.
 */

/** Win rate the solver aims for when a fight has not chosen one. */
export const DEFAULT_TARGET_WIN = 0.7;

/**
 * Inside this of the target counts as on target.
 *
 * Sampling noise, not slack: at 60 fights a level that truly wins 70% reads
 * anywhere from about 62% to 78%, so a hard line at 70% would call a perfectly
 * tuned level wrong about half the time.
 *
 * Lives here rather than beside the solver because the admin panel needs it to
 * colour a tab, and importing it from bandSolver.ts would pull the entire
 * combat simulator into the browser bundle behind one number.
 */
export const TARGET_TOLERANCE = 0.08;

/** The lowest and highest a level may be scaled to. Wide on purpose. */
export const SCALE_MIN = 0.05;
export const SCALE_MAX = 200;

export interface SearchState {
  target: number;
  floor: number;
  ceiling: number;
  tolerance: number;
  /**
   * lo      - measuring the bottom of the bracket, moving down if needed
   * hi      - measuring the top of the bracket, moving up if needed
   * bisect  - bracketed; narrowing
   * done    - finished; `pending` is null
   */
  phase: "lo" | "hi" | "bisect" | "done";
  lo: number;
  hi: number;
  /** Whether `hi` already has a reading, from the bracket moving down onto it. */
  hiKnown: boolean;
  /** The reading closest to target so far - the answer, once done. */
  best: { scale: number; winRate: number } | null;
  bound: "floor" | "ceiling" | null;
  evaluations: number;
  /** Where the next reading must be taken. Null when finished. */
  pending: number | null;
}

/**
 * Narrow until the bracket is 3% wide. Finer than the sampling noise at 60
 * fights, so further steps would be measuring which dice happened to roll.
 */
const PRECISION = 1.03;
/** A backstop. A well-behaved search finishes in about eight. */
const MAX_EVALUATIONS = 24;

/**
 * Where to begin, and the bracket around it.
 *
 * FROM THE LEVEL'S CURRENT MULTIPLIER, halved and doubled. The common case in
 * the panel is re-solving after a small edit - one unit added, one made an
 * elite - and the answer is then close to where it already was, so starting
 * there brackets it in two readings instead of searching 0.05 to 200 from
 * scratch.
 */
export function startSearch(options: {
  start: number;
  target: number;
  floor: number;
  ceiling: number;
  tolerance: number;
}): SearchState {
  const floor = options.floor;
  const ceiling = Math.max(floor, options.ceiling);
  const start = Math.min(ceiling, Math.max(floor, options.start));
  const lo = Math.max(floor, start / 2);
  return {
    target: options.target,
    floor,
    ceiling,
    tolerance: options.tolerance,
    phase: "lo",
    lo,
    hi: Math.min(ceiling, start * 2),
    hiKnown: false,
    best: null,
    bound: null,
    evaluations: 0,
    pending: lo,
  };
}

function closer(best: SearchState["best"], scale: number, winRate: number, target: number): SearchState["best"] {
  if (!best || Math.abs(winRate - target) < Math.abs(best.winRate - target)) return { scale, winRate };
  return best;
}

function finish(state: SearchState, best: SearchState["best"], bound: SearchState["bound"]): SearchState {
  return { ...state, phase: "done", best, bound, pending: null };
}

/** The midpoint in log space, or done when the bracket is already narrow enough. */
function narrow(state: SearchState): SearchState {
  if (state.hi / state.lo <= PRECISION || state.evaluations >= MAX_EVALUATIONS) {
    return finish(state, state.best, null);
  }
  return { ...state, phase: "bisect", pending: Math.sqrt(state.lo * state.hi) };
}

/**
 * Report the win rate measured at `state.pending`, get the next state back.
 *
 * MORE MULTIPLIER MEANS TOUGHER BODIES AND A LOWER WIN RATE. Everything below
 * leans on that being monotonic, which it is for a fixed seed: the same parties
 * fight every candidate, so a higher multiplier cannot make them win more.
 */
export function advanceSearch(state: SearchState, winRate: number): SearchState {
  if (state.phase === "done" || state.pending === null) return state;
  const scale = state.pending;
  const next: SearchState = {
    ...state,
    evaluations: state.evaluations + 1,
    best: closer(state.best, scale, winRate, state.target),
  };
  const { target, tolerance } = state;

  if (state.phase === "lo") {
    if (winRate > target) {
      // The bottom is easy enough, so the answer is above it. Measure the top,
      // unless moving down already measured it.
      return next.hiKnown ? narrow(next) : { ...next, phase: "hi", pending: next.hi };
    }
    if (scale <= next.floor) {
      // Too hard even at the lowest multiplier allowed. Nothing lower is
      // permitted, so the fight itself has to change - say so.
      return finish(next, { scale, winRate }, winRate < target - tolerance ? "floor" : null);
    }
    // Still too hard: the answer is lower. This reading becomes the top of the
    // bracket, which is why the top is then known and not re-measured.
    const lo = Math.max(next.floor, scale / 4);
    return { ...next, hi: scale, hiKnown: true, lo, pending: lo };
  }

  if (state.phase === "hi") {
    if (winRate < target) return narrow({ ...next, hiKnown: true });
    if (scale >= next.ceiling) {
      // The party walks it even at the highest multiplier allowed.
      return finish(next, { scale, winRate }, winRate > target + tolerance ? "ceiling" : null);
    }
    const hi = Math.min(next.ceiling, scale * 4);
    return { ...next, lo: scale, hi, pending: hi };
  }

  // bisect
  return narrow(winRate > target ? { ...next, lo: scale } : { ...next, hi: scale });
}
