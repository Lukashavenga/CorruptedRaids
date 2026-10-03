import { useEffect, useRef } from "react";
import { backgroundUrl } from "../sprites.js";
import { STAGE_H, STAGE_W } from "../stage.js";
import { ArenaScene } from "./ArenaScene.js";
import type { ArenaProps } from "./types.js";
import "./arena3d.css";

/**
 * The 3D arena, as React sees it: a box the scene draws into, and the numbers
 * that rise off the bodies in it.
 *
 * React owns none of the motion. A render here happens when the GAME changes -
 * somebody joined, a blow was announced, a body went down - and each of those
 * is handed to the scene as a fact. What happens between two facts, sixty
 * times a second, is the scene's own loop and never touches React state.
 */
export function Arena3D({
  units,
  background,
  mood,
  fighting,
  action,
  floats,
  outcome,
  placements,
  scale,
}: ArenaProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ArenaScene | null>(null);
  /** Where each number was born. Fixed at birth: it rises from where the body WAS. */
  const anchors = useRef(new Map<number, { x: number; y: number } | null>());

  // Declared first so every effect below finds the scene already there -
  // effects run in the order they are written.
  useEffect(() => {
    if (!host.current) return;
    const created = new ArenaScene(host.current);
    scene.current = created;
    return () => {
      created.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    // Real pixels, not stage pixels. The stage is 450 wide and scaled up by a
    // whole number through a CSS transform; a canvas drawn at 450 and
    // stretched would be a 3D scene rendered small and then blurred large.
    scene.current?.setSize(STAGE_W, STAGE_H, scale * window.devicePixelRatio);
  }, [scale]);

  useEffect(() => {
    scene.current?.setBackdrop(background, background ? backgroundUrl(background) : null);
  }, [background]);

  useEffect(() => {
    scene.current?.setMood(mood);
  }, [mood]);

  useEffect(() => {
    scene.current?.setOutcome(outcome);
  }, [outcome]);

  // Every render, deliberately: `units` is rebuilt by App each time and the
  // scene's own diff is what decides whether anything moved. Guessing here
  // which renders matter is how a body ends up wearing last turn's helmet.
  useEffect(() => {
    scene.current?.sync(units, placements, fighting);
  });

  const seq = action?.seq;
  useEffect(() => {
    if (action) scene.current?.act(action);
    // Keyed on the sequence number alone: the same announcement must not be
    // played twice because something unrelated re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  // Anchoring happens during render because the number has to be drawn in the
  // same pass it first appears in - a frame spent at the origin is a frame of
  // "-12" in the top-left corner of the stream.
  const live = new Set(floats.map((f) => f.id));
  for (const id of anchors.current.keys()) if (!live.has(id)) anchors.current.delete(id);
  for (const f of floats) {
    if (!anchors.current.has(f.id)) anchors.current.set(f.id, scene.current?.project(f.combatantId) ?? null);
  }

  return (
    <>
      <div className="arena3d" ref={host} aria-hidden="true" />
      <div className="arena3d-floats" aria-hidden="true">
        {floats.map((f) => {
          const anchor = anchors.current.get(f.id);
          // Nobody to rise off: a party past the cap is in the fight and not
          // on the floor.
          if (!anchor) return null;
          return (
            <div
              key={f.id}
              className="arena3d-float-anchor"
              style={{ left: anchor.x * STAGE_W, top: anchor.y * STAGE_H }}
            >
              <span className={`combat-float is-${f.kind}`}>{f.text}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
