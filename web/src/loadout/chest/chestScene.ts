import type { Rarity } from "../../../../src/engine/types.js";
import {
  ANTICIPATION_MS,
  BURST_MS,
  MAX_FRAME_MS,
  OPEN_MS,
  POP_MS,
  PROFILES,
  REDUCED_FADE_MS,
  REVEAL_AT,
  SETTLE_MS,
  rarityRgb,
  type RarityProfile,
} from "./chestTimeline.js";

/**
 * The chest, drawn from its parts.
 *
 * WHY A CANVAS AT THE ART'S OWN SIZE
 * ----------------------------------
 * The scene is drawn into a small canvas at the chest art's NATIVE resolution
 * (the parts are 150px, the canvas is `STAGE` px) and the page shows it scaled
 * up with `image-rendering: pixelated`. A rotation or a squash is then
 * re-pixelated at the art's own pixel size, so the motion is smooth and still
 * looks like the art - drawn at display size instead, the same rotation would
 * resample the sprite into blurry pixels half the size of its own.
 *
 * WHY THE CLOCK IS A SUM OF FRAME DELTAS
 * --------------------------------------
 * Every beat is a pure function of `clock`, which advances by the frame delta
 * clamped to MAX_FRAME_MS. There are no setTimeouts. A hidden OBS source or
 * phone tab stops requestAnimationFrame; a timer would carry on landing beats
 * into a scene nobody is drawing, and an unclamped delta would replay them all
 * on the first frame back. Here the animation just waits (AGENTS.md section 4,
 * the same lesson for the 3D arena).
 */

/** Canvas size in art pixels. Room around the 103px chest for sparks and rays. */
export const STAGE = 160;
/** Where the parts' (0,0) lands on the stage. */
const ORIGIN_X = 15;
const ORIGIN_Y = 10;

/** Part coordinates (the closed cell's own). */
const SEAM_Y = 80;
const BASE_X = 65;
const BASE_Y = 130;
/** The lid's top edge when closed, and when open. Its hinge is at the back. */
const LID_TOP = 44;
const OPEN_LID_TOP = 28;
/** The mouth: where light and sparks come from. */
const MOUTH_X = 65;
const MOUTH_Y = 62;

const PART_NAMES = ["body", "lid", "lid-open", "inside"] as const;
type PartName = (typeof PART_NAMES)[number];
type Parts = Record<PartName, HTMLImageElement>;

let partsPromise: Promise<Parts> | null = null;

/** The images are fetched once per page, however many chests open. */
function loadParts(): Promise<Parts> {
  partsPromise ??= Promise.all(
    PART_NAMES.map(
      (name) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`chest part ${name} failed to load`));
          img.src = `/art/ui/loot-chest-${name}.png`;
        }),
    ),
  ).then((imgs) => Object.fromEntries(PART_NAMES.map((n, i) => [n, imgs[i]!])) as Parts);
  // A failed load must be retryable, or one bad request on a bad connection
  // leaves the chest invisible until a reload.
  partsPromise.catch(() => {
    partsPromise = null;
  });
  return partsPromise;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInQuad = (t: number) => t * t;
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
/** 0 -> 1 across [a, b] of `t`. */
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

type Shape = "square" | "diamond" | "star";
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  shape: Shape;
  rgb: [number, number, number];
}

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  /** The soft light behind the canvas. Moved by transform and opacity only. */
  bloom: HTMLElement | null;
  /** 1 for real time, 0.25 for the lab's slow motion. */
  speed?: number;
  /** No shake, no particles, no swing: a cross-fade, then the reveal. */
  reducedMotion?: boolean;
  /** The pop begins: haptic and sound. */
  onPop?: () => void;
  /** The item should appear now. */
  onReveal?: () => void;
}

/**
 * Plays one chest opening on a canvas.
 *
 * Lifecycle: constructed, rocks until `release(rarity)` is called, pops once
 * the wind-up has also run its course, reveals at REVEAL_AT, then pulses until
 * `destroy()`. The release is how the network gets a say: the open is held
 * until the request returns, and the rarity colour is not known any sooner.
 */
export class ChestScene {
  private readonly ctx: CanvasRenderingContext2D | null;
  private parts: Parts | null = null;
  private tintedInside: HTMLCanvasElement | null = null;

  private raf = 0;
  private last: number | null = null;
  private clock = 0;
  /** Time since the pop began; null while still rocking. */
  private popClock: number | null = null;

  private released = false;
  private rarity: Rarity = "common";
  private profile: RarityProfile = PROFILES.common;
  private rgb: [number, number, number] = [255, 220, 140];
  private sparkRgb: [number, number, number][] = [];

  private sparks: Spark[] = [];
  private spawned = false;
  private revealed = false;
  private destroyed = false;
  private speed: number;
  private reduced: boolean;

  private readonly onVisibility = () => {
    // Forget the last timestamp so the first frame back has no delta to clamp.
    this.last = null;
  };

  constructor(private readonly opts: SceneOptions) {
    this.ctx = opts.canvas.getContext("2d");
    this.speed = opts.speed ?? 1;
    this.reduced = opts.reducedMotion ?? false;
    opts.canvas.width = STAGE;
    opts.canvas.height = STAGE;
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    void loadParts().then((parts) => {
      this.parts = parts;
      this.retint();
      this.draw();
    });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The request landed: the open may go ahead, tinted for what came out. */
  release(rarity: Rarity): void {
    if (this.released) return;
    this.released = true;
    this.rarity = rarity;
    this.profile = PROFILES[rarity];
    const style = getComputedStyle(this.opts.canvas);
    this.rgb = rarityRgb(rarity, style);
    // Sparks keep the chest's gold and lean toward the rarity colour. Fully
    // recoloured they stop looking like they came out of this chest.
    const mix = this.profile.tint;
    this.sparkRgb = GOLD.map((g): [number, number, number] => [
      Math.round(lerp(g[0], this.rgb[0], mix)),
      Math.round(lerp(g[1], this.rgb[1], mix)),
      Math.round(lerp(g[2], this.rgb[2], mix)),
    ]);
    this.retint();
    this.opts.bloom?.style.setProperty("--bloom-rgb", this.rgb.join(" "));
  }

  /**
   * Jumps to the settled-open state, firing whichever beats had not happened.
   * What a tap means: the player wants the item, not the ceremony.
   */
  finish(): void {
    if (this.destroyed) return;
    if (this.popClock === null) {
      this.popClock = 0;
      this.opts.onPop?.();
    }
    this.popClock = Math.max(this.popClock, OPEN_MS);
    this.sparks = [];
    this.spawned = true;
    this.emitReveal();
    this.draw();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private emitReveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.opts.onReveal?.();
  }

  /** Builds the interior light in the rarity's colour, once, not per frame. */
  private retint(): void {
    if (!this.parts) return;
    const c = document.createElement("canvas");
    c.width = c.height = 150;
    const g = c.getContext("2d");
    if (!g) return;
    g.drawImage(this.parts.inside, 0, 0);
    g.globalCompositeOperation = "source-atop";
    const [r, gr, b] = this.rgb;
    g.fillStyle = `rgba(${r},${gr},${b},${this.released ? this.profile.tint : 0})`;
    g.fillRect(0, 0, 150, 150);
    this.tintedInside = c;
  }

  private readonly frame = (now: number): void => {
    if (this.destroyed) return;
    const dt = this.last === null ? 0 : Math.min(now - this.last, MAX_FRAME_MS);
    this.last = now;
    this.step(dt * this.speed);
    this.draw();
    // A reduced-motion scene is still once the fade is done: no loop to burn.
    if (this.reduced && this.popClock !== null && this.popClock >= REDUCED_FADE_MS) return;
    this.raf = requestAnimationFrame(this.frame);
  };

  private step(dt: number): void {
    this.clock += dt;
    if (this.popClock === null) {
      const windUp = this.reduced ? 0 : ANTICIPATION_MS;
      if (!this.released || this.clock < windUp) return;
      this.popClock = 0;
      this.opts.onPop?.();
      if (this.reduced) this.emitReveal();
      return;
    }
    this.popClock += dt;
    if (this.reduced) return;

    const p = this.popClock;
    if (!this.spawned && p >= POP_MS * 0.6) this.spawn();
    if (!this.revealed && p >= OPEN_MS * REVEAL_AT) this.emitReveal();

    const s = dt / 1000;
    for (const k of this.sparks) {
      k.age += dt;
      k.vy += 170 * s;
      k.x += k.vx * s;
      k.y += k.vy * s;
    }
    this.sparks = this.sparks.filter((k) => k.age < k.life);
  }

  private spawn(): void {
    this.spawned = true;
    const n = this.profile.sparks;
    const palette = this.sparkRgb.length ? this.sparkRgb : GOLD;
    for (let i = 0; i < n; i++) {
      // A fan upward: sparks leave the mouth, they do not rain from the lid.
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.3;
      const speed = 45 + Math.random() * 85;
      // Roughly a third are the art's own four-point stars, the rest are chips.
      const r = Math.random();
      this.sparks.push({
        x: MOUTH_X + (Math.random() - 0.5) * 36,
        y: MOUTH_Y + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: (BURST_MS + 250 + Math.random() * 350) * this.profile.lifeScale,
        shape: r < 0.33 ? "star" : r < 0.66 ? "diamond" : "square",
        rgb: palette[i % palette.length]!,
      });
    }
  }

  /* ------------------------------------------------------------------ draw */

  private draw(): void {
    const ctx = this.ctx;
    const parts = this.parts;
    if (!ctx || !parts) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, STAGE, STAGE);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.translate(ORIGIN_X, ORIGIN_Y);

    if (this.reduced) {
      this.drawReduced(ctx, parts);
      return;
    }

    const pop = this.popClock;
    if (pop === null) this.drawWindUp(ctx, parts, this.clock);
    else this.drawOpen(ctx, parts, pop);

    this.drawBloom(pop);
  }

  /** Anticipation: rocks on its base, a few degrees, growing; the lid lags. */
  private drawWindUp(ctx: CanvasRenderingContext2D, parts: Parts, t: number): void {
    const grow = easeInQuad(clamp01(t / ANTICIPATION_MS));
    // Holds at full strength if the request is slow: it keeps straining.
    const amp = lerp(1.2, 5.5, grow);
    const phase = (t / ANTICIPATION_MS) * 3 * Math.PI * 2;
    const rock = Math.sin(phase);
    const angle = (rock * amp * Math.PI) / 180;
    // It lands on a corner at each extreme, and gives a little there.
    const landing = rock * rock * grow;
    const sy = 1 - 0.035 * landing;
    const sx = 1 + 0.018 * landing;
    // The lid rides the same rock a beat late, and lifts a pixel or two.
    const lidPhase = Math.sin(phase - 1.1);
    const lift = -Math.abs(lidPhase) * lerp(0.6, 2, grow);
    const lidTilt = (lidPhase * 0.8 * grow * Math.PI) / 180;

    ctx.save();
    this.toBase(ctx, angle, sx, sy);
    ctx.drawImage(parts.body, 0, 0);
    ctx.save();
    ctx.translate(0, Math.round(lift));
    ctx.translate(BASE_X, SEAM_Y);
    ctx.rotate(lidTilt);
    ctx.translate(-BASE_X, -SEAM_Y);
    ctx.drawImage(parts.lid, 0, 0);
    ctx.restore();
    ctx.restore();
  }

  private drawOpen(ctx: CanvasRenderingContext2D, parts: Parts, p: number): void {
    const popT = clamp01(p / POP_MS);

    // BODY: squashes down, then releases past rest and settles.
    const down = span(p, 0, POP_MS * 0.35);
    const up = span(p, POP_MS * 0.35, POP_MS);
    let sy = lerp(1, 0.9, easeOutQuad(down));
    if (down >= 1) sy = lerp(0.9, 1, easeOutBack(up));
    const sx = 1 + (1 - sy) * 0.4;

    // LID: one lid swinging away from the viewer. Foreshortened toward its
    // hinge at the back while it rises, and at the half-way point the open lid
    // takes over and grows back from nothing.
    const away = span(p, 0, POP_MS * 0.5);
    const back = span(p, POP_MS * 0.5, POP_MS);
    const closedScale = 1 - easeInQuad(away);
    const closedLift = easeOutQuad(away) * (LID_TOP - OPEN_LID_TOP);
    const openScale =
      p < POP_MS
        ? 0.92 * easeOutCubic(back)
        : this.openLidScale(p);

    // MOUTH: dark lining behind the lids, so there is no hole through the
    // chest while neither lid has any height.
    const mouth = easeOutQuad(popT);

    ctx.save();
    this.toBase(ctx, 0, sx, sy);

    ctx.drawImage(parts.body, 0, 0);

    if (mouth > 0) {
      ctx.fillStyle = "rgb(30,18,34)";
      const h = Math.round(36 * mouth);
      ctx.fillRect(22, SEAM_Y - h, 88, h);
    }

    if (closedScale > 0.02) {
      ctx.save();
      ctx.translate(0, -Math.round(closedLift));
      ctx.translate(0, LID_TOP);
      ctx.scale(1, closedScale);
      ctx.translate(0, -LID_TOP);
      ctx.drawImage(parts.lid, 0, 0);
      ctx.restore();
    }

    if (openScale > 0.02) {
      ctx.save();
      ctx.translate(0, OPEN_LID_TOP);
      ctx.scale(1, openScale);
      ctx.translate(0, -OPEN_LID_TOP);
      ctx.drawImage(parts["lid-open"], 0, 0);
      ctx.restore();
    }

    // LIGHT: fades in as the gap opens, then breathes while the reveal is up.
    const light = easeOutQuad(span(p, POP_MS * 0.3, POP_MS)) * this.pulse(p);
    if (light > 0.01) {
      ctx.globalAlpha = light;
      ctx.drawImage(this.tintedInside ?? parts.inside, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    this.drawRays(ctx, p);
    this.drawSparks(ctx);
  }

  /** A slow pulse that only begins once the settle is under way. */
  private pulse(p: number): number {
    const on = span(p, OPEN_MS - SETTLE_MS, OPEN_MS);
    return 1 - on * 0.12 * (1 + Math.sin(p / 220)) * 0.5;
  }

  /** A fan of light from the mouth, turning slowly, in the rarity's colour. */
  private drawRays(ctx: CanvasRenderingContext2D, p: number): void {
    const rise = span(p, POP_MS * 0.5, POP_MS + BURST_MS * 0.5);
    const fall = span(p, POP_MS + BURST_MS * 0.6, OPEN_MS);
    const a = this.profile.rays * 0.45 * easeOutQuad(rise) * (1 - fall);
    if (a < 0.01) return;
    const len = lerp(10, 62, easeOutCubic(rise));
    const spin = (p / 1000) * 0.5;
    const [r, g, b] = this.rgb;

    ctx.save();
    // Above the seam only: below it the rays would be light shining out of
    // the front of a closed box.
    ctx.beginPath();
    ctx.rect(-ORIGIN_X, -ORIGIN_Y, STAGE, SEAM_Y + ORIGIN_Y + 2);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    const RAYS = 9;
    for (let i = 0; i < RAYS; i++) {
      const ang = spin + (i / RAYS) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(MOUTH_X, MOUTH_Y);
      ctx.lineTo(MOUTH_X + Math.cos(ang - 0.07) * len, MOUTH_Y + Math.sin(ang - 0.07) * len);
      ctx.lineTo(MOUTH_X + Math.cos(ang + 0.07) * len, MOUTH_Y + Math.sin(ang + 0.07) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Pixel-snapped squares, diamonds and four-point stars. */
  private drawSparks(ctx: CanvasRenderingContext2D): void {
    for (const k of this.sparks) {
      const left = 1 - k.age / k.life;
      // Full for the first half of its life, then it goes out.
      ctx.globalAlpha = Math.min(1, left * 2);
      ctx.fillStyle = `rgb(${k.rgb[0]},${k.rgb[1]},${k.rgb[2]})`;
      const x = Math.round(k.x);
      const y = Math.round(k.y);
      if (k.shape === "square") {
        ctx.fillRect(x, y, 2, 2);
      } else if (k.shape === "diamond") {
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 3);
      } else {
        ctx.fillRect(x - 3, y, 7, 1);
        ctx.fillRect(x, y - 3, 1, 7);
        ctx.fillStyle = "rgb(255,246,214)";
        ctx.fillRect(x - 1, y - 1, 3, 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** The settle: climbs past 1 and comes back once. */
  private openLidScale(p: number): number {
    const burst = span(p, POP_MS, POP_MS + BURST_MS);
    const settle = span(p, OPEN_MS - SETTLE_MS, OPEN_MS);
    const base = lerp(0.92, 0.96, burst);
    // sin over [0, pi]: up and back, one bounce, landing on 1 exactly.
    return lerp(base, 1, easeOutQuad(settle)) + 0.07 * Math.sin(Math.PI * settle);
  }

  private drawBloom(pop: number | null): void {
    const el = this.opts.bloom;
    if (!el) return;
    let o = 0;
    let s = 0.2;
    if (pop !== null) {
      const rise = span(pop, POP_MS * 0.3, POP_MS + BURST_MS * 0.4);
      const fall = span(pop, POP_MS + BURST_MS, OPEN_MS);
      o = this.profile.bloom * (easeOutQuad(rise) * (1 - 0.7 * fall));
      s = lerp(0.2, 1.4, easeOutCubic(rise));
    }
    el.style.opacity = String(o);
    el.style.transform = `translate(-50%, -50%) scale(${s})`;
  }

  /** No motion: closed fades to open where it stands. */
  private drawReduced(ctx: CanvasRenderingContext2D, parts: Parts): void {
    const f = this.popClock === null ? 0 : clamp01(this.popClock / REDUCED_FADE_MS);
    if (f < 1) {
      ctx.globalAlpha = 1 - f;
      ctx.drawImage(parts.body, 0, 0);
      ctx.drawImage(parts.lid, 0, 0);
    }
    if (f > 0) {
      ctx.globalAlpha = f;
      ctx.drawImage(parts.body, 0, 0);
      ctx.fillStyle = "rgb(30,18,34)";
      ctx.fillRect(22, SEAM_Y - 36, 88, 36);
      ctx.drawImage(parts["lid-open"], 0, 0);
      ctx.drawImage(this.tintedInside ?? parts.inside, 0, 0);
    }
    ctx.globalAlpha = 1;
    const el = this.opts.bloom;
    if (el) {
      el.style.opacity = String(this.profile.bloom * 0.4 * f);
      el.style.transform = "translate(-50%, -50%) scale(1)";
    }
  }

  /** Rock pivot: the base of the chest, so it tips onto an edge. */
  private toBase(ctx: CanvasRenderingContext2D, angle: number, sx: number, sy: number): void {
    ctx.translate(BASE_X, BASE_Y);
    ctx.rotate(angle);
    ctx.scale(sx, sy);
    ctx.translate(-BASE_X, -BASE_Y);
  }
}

const GOLD: [number, number, number][] = [
  [255, 232, 160],
  [250, 200, 96],
  [240, 178, 74],
  [200, 140, 60],
];

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
