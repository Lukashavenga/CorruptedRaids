import type { Rarity } from "../../../../src/engine/types.js";

/**
 * The chest-opening timeline, and the ONE place its numbers live.
 *
 * ChestShelf sequences the reveal off `SHAKE_MS`, `OPEN_MS` and `REVEAL_AT`,
 * and the renderer in chestScene.ts draws off the same constants, so retiming a
 * beat here moves the picture and the reveal together. It used to be two
 * systems - these numbers in TSX and a CSS keyframe that had to be edited to
 * match - and the CSS one was only ever kept honest by a comment saying
 * "change them together".
 *
 * Times are in milliseconds and are a STARTING POINT: tune by eye in the chest
 * lab (`loadout.html?chestLab`), which plays any rarity at full or quarter speed.
 */

/** The chest rocks, growing stronger. It holds here until the request lands. */
export const ANTICIPATION_MS = 550;
/** Body squashes and releases; the lid swings away and the open lid takes over. */
export const POP_MS = 300;
/** Rays, sparks and bloom. */
export const BURST_MS = 400;
/** The lid overshoots and bounces back once; rays fade; the glow starts to pulse. */
export const SETTLE_MS = 300;

/** What ChestShelf calls the wind-up. */
export const SHAKE_MS = ANTICIPATION_MS;
/** From the pop to the end of the settle. */
export const OPEN_MS = POP_MS + BURST_MS + SETTLE_MS;
/**
 * How far into the open the item appears, as a fraction of OPEN_MS.
 *
 * 120ms after the lid has finished opening: the burst has just left the mouth
 * and the item rises out of it, rather than appearing before there is a mouth.
 */
export const REVEAL_AT = (POP_MS + 120) / OPEN_MS;

/** How long the reduced-motion cross-fade from closed to open takes. */
export const REDUCED_FADE_MS = 160;

/**
 * Longest a single frame may advance the clock.
 *
 * The clock is the sum of frame deltas, each clamped to this. A tab that was
 * hidden delivers its first frame back with a delta of seconds, and an
 * unclamped clock would answer by jumping to the end - or, worse, by firing
 * every beat that fell due while nobody was looking. Clamped, the animation
 * simply waits where it was, which is what AGENTS.md section 4 does for the 3D
 * arena for the same reason.
 */
export const MAX_FRAME_MS = 50;

/** How much of each rarity's burst to throw. */
export interface RarityProfile {
  /** Sparks leaving the mouth. */
  sparks: number;
  /** Multiplies how long each spark and the rays last - a longer burst. */
  lifeScale: number;
  /** 0-1, how bright the rays are. */
  rays: number;
  /** 0-1, how strongly the tint replaces the art's own gold. */
  tint: number;
  /** 0-1, the bloom behind it all. */
  bloom: number;
}

/**
 * Common stays modest and legendary is the show. If every rarity were loud the
 * loudness would stop telling you anything, which is the same reasoning as the
 * legendary-only text glow in motion.css.
 */
export const PROFILES: Record<Rarity, RarityProfile> = {
  common: { sparks: 12, lifeScale: 0.85, rays: 0.35, tint: 0.55, bloom: 0.45 },
  uncommon: { sparks: 14, lifeScale: 0.95, rays: 0.5, tint: 0.65, bloom: 0.6 },
  rare: { sparks: 17, lifeScale: 1.0, rays: 0.65, tint: 0.7, bloom: 0.75 },
  epic: { sparks: 20, lifeScale: 1.15, rays: 0.8, tint: 0.75, bloom: 0.9 },
  legendary: { sparks: 24, lifeScale: 1.5, rays: 1, tint: 0.6, bloom: 1 },
};

/**
 * Fallbacks for the `--rarity-*` variables, used where one is not defined
 * (rare and common are lightened from the variable, as in the reveal text,
 * because the raw value is tuned as a border and vanishes as light).
 */
export const RARITY_FALLBACK: Record<Rarity, string> = {
  common: "#9aa8b4",
  uncommon: "#5ca75d",
  rare: "#6f9ee0",
  epic: "#c87cc8",
  legendary: "#e2b570",
};

/** Beats that are lightened regardless of the variable, as the reveal text is. */
const LIGHTENED: ReadonlySet<Rarity> = new Set<Rarity>(["common", "rare", "epic"]);

/** The colour a rarity lights the chest with, as [r, g, b]. */
export function rarityRgb(rarity: Rarity, style?: CSSStyleDeclaration): [number, number, number] {
  const raw = LIGHTENED.has(rarity) ? "" : (style?.getPropertyValue(`--rarity-${rarity}`).trim() ?? "");
  return parseHex(raw) ?? parseHex(RARITY_FALLBACK[rarity]) ?? [255, 220, 140];
}

function parseHex(value: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The best rarity in a haul - what a bulk open is tinted by. */
const ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
export function bestRarity(rarities: readonly Rarity[]): Rarity {
  let best = 0;
  for (const r of rarities) best = Math.max(best, ORDER.indexOf(r));
  return ORDER[best] ?? "common";
}
