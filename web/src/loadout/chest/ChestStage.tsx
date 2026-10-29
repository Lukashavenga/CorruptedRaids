import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Rarity } from "../../../../src/engine/types.js";
import { ChestScene } from "./chestScene.js";

export interface ChestStageHandle {
  /** The request landed: open, tinted for this rarity. */
  release(rarity: Rarity): void;
  /** Jump to the settled-open chest, firing whatever beats had not happened. */
  finish(): void;
}

export interface ChestStageProps {
  /** The pop begins. */
  onPop?: () => void;
  /** The item should appear. */
  onReveal?: () => void;
  /** 1 is real time; the chest lab uses 0.25. */
  speed?: number;
  /** Overrides the OS setting. Left unset, `prefers-reduced-motion` decides. */
  reducedMotion?: boolean;
}

/**
 * One chest opening: a canvas, and the soft light behind it.
 *
 * Mount it to start the wind-up, call `release` when the request lands, and
 * unmount it to stop. Nothing in here re-renders while it plays - the scene
 * owns the canvas and the bloom's style directly, so a mid-range phone is
 * running one small canvas draw per frame and no React.
 *
 * The scene is built once per mount. `speed` and `reducedMotion` are read at
 * that moment; change them by remounting (the lab does, with a key).
 */
export const ChestStage = forwardRef<ChestStageHandle, ChestStageProps>(function ChestStage(
  { onPop, onReveal, speed, reducedMotion },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bloomRef = useRef<HTMLSpanElement>(null);
  const scene = useRef<ChestScene | null>(null);
  // The scene outlives renders and must call the latest handlers, not the
  // ones from the render it was built in.
  const handlers = useRef({ onPop, onReveal });
  handlers.current = { onPop, onReveal };
  /*
   * The rarity, once released, kept HERE as well as on the scene.
   *
   * A scene can be rebuilt after `release` was called - StrictMode builds,
   * destroys and rebuilds every new mount in development, and a change of
   * speed or motion setting rebuilds it too. Held only on the scene, the
   * release went to the one that was thrown away and the chest rocked
   * forever: the chest lab, which releases on the same tick it mounts, did
   * exactly that. Every scene this builds is handed it.
   */
  const released = useRef<Rarity | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = new ChestScene({
      canvas,
      bloom: bloomRef.current,
      speed,
      reducedMotion: reduced,
      onPop: () => handlers.current.onPop?.(),
      onReveal: () => handlers.current.onReveal?.(),
    });
    scene.current = s;
    if (released.current) s.release(released.current);
    return () => {
      s.destroy();
      scene.current = null;
    };
  }, [speed, reducedMotion]);

  useImperativeHandle(
    ref,
    () => ({
      release: (rarity) => {
        released.current = rarity;
        scene.current?.release(rarity);
      },
      finish: () => scene.current?.finish(),
    }),
    [],
  );

  return (
    <span className="chest-stage" aria-hidden="true">
      <span className="chest-bloom" ref={bloomRef} />
      <canvas className="chest-canvas" ref={canvasRef} />
    </span>
  );
});
