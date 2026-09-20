/**
 * Haptic feedback for the loadout, as a small vocabulary rather than raw
 * `navigator.vibrate` calls scattered through components.
 *
 * WHAT ACTUALLY WORKS, AND WHERE
 * ------------------------------
 * `navigator.vibrate` is Android Chrome and Firefox. **iOS Safari does not
 * support it at all** and there is no polyfill worth the name — the tricks
 * that claim to be one either need a native wrapper or abuse an audio API in
 * a way Apple breaks every other release. So on an iPhone every call here is
 * a no-op, and that is a floor, not a bug to route around.
 *
 * It matters because it decides what haptics may be USED for. Nothing on this
 * screen may depend on feeling a buzz to be understood: every pattern below
 * accompanies something that is already visible and already audible-by-motion.
 * Haptics are the third channel, never the only one.
 *
 * WHY A VOCABULARY
 * ----------------
 * A number in milliseconds at a call site tells you nothing about whether it
 * matches the tap next to it. Named patterns mean the whole screen shares one
 * feel, and re-timing "every confirmation" is one edit here rather than a grep
 * for integers.
 *
 * The patterns are deliberately SHORT. A phone in a pocket during a stream is
 * not a game controller; anything past about 40ms on a tap reads as a fault
 * rather than as feedback, and a long pattern on a UI control is the single
 * fastest way to get someone to turn haptics off for good.
 */

/** Named feels, longest to shortest. Arrays alternate buzz/pause, in ms. */
const PATTERNS = {
  /** A control was pressed. The lightest thing the hardware can do. */
  tap: 8,
  /** Something was equipped, spent or confirmed — a real state change. */
  commit: [14, 30, 14],
  /** A control refused: not enough gold, gate not met, nothing to spend. */
  refuse: [26, 40, 26],
  /** The chest rattling. Three knocks under the six shake frames. */
  chestShake: [10, 70, 10, 70, 14],
  /** The lid going. One thump with a tail, timed to the burst frames. */
  chestOpen: [18, 40, 34],
  /** A level's worth of points arrived. */
  levelUp: [12, 50, 12, 50, 28],
} as const;

export type Haptic = keyof typeof PATTERNS;

const STORAGE_KEY = "cr.haptics";

/** Reads the stored preference. Default ON — it is feedback, not a surprise. */
export function hapticsEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // Private mode, or site data blocked. Defaulting to ON here is safe: if
    // storage throws, `vibrate` is still gated on support and on the reduced
    // motion check below.
    return true;
  }
}

export function setHapticsEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* nothing to do — the preference simply will not survive a reload */
  }
}

/** True where the platform can actually do this, so UI can say so honestly. */
export function hapticsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/**
 * Fires a named pattern, if the platform can and the player wants it.
 *
 * `prefers-reduced-motion` suppresses haptics as well as animation. That is a
 * deliberate reading rather than a literal one — the setting is worded about
 * motion, but people who set it include those for whom sudden physical
 * feedback is the problem, and nothing here is load-bearing enough to be
 * worth guessing wrong about.
 */
export function haptic(name: Haptic): void {
  if (!hapticsSupported() || !hapticsEnabled()) return;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate(PATTERNS[name] as number | number[]);
  } catch {
    /* vibrate throws on some embedded webviews; a missing buzz is not worth an error */
  }
}
