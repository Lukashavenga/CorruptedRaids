import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterView } from "../../../src/engine/state/gameEngine.js";
import type { ContentCatalog } from "../hooks/useContentCatalog.js";
import { ItemIcon } from "./ItemIcon.js";
import { haptic } from "./haptics.js";
import { text, format } from "../../../src/text/index.js";

/**
 * Frame timings.
 *
 * The shake is the ANTICIPATION. At the original 60ms a frame it read as a
 * buzz rather than as a chest straining to open — the six frames blurred into
 * one wobbling shape. 85ms is about the floor where each rock still registers
 * as its own movement, and two passes rather than three because you felt
 * yourself waiting through the last one.
 *
 * The pop is 660ms but NOT evenly divided — see `chest-open` in motion.css.
 * Six frames at a metronomic rate is the recipe for reading as stop-motion,
 * which is exactly what it did; the frames now accelerate through the burst.
 */
const SHAKE_FRAME_MS = 85;
const SHAKE_LOOPS = 2;
const FRAMES = 6;

const SHAKE_MS = SHAKE_FRAME_MS * FRAMES * SHAKE_LOOPS;
const OPEN_MS = 660;
/**
 * How far into the pop the item appears.
 *
 * 0.62 rather than the midpoint: the accelerated timing puts the burst around
 * here, and the name should land ON the burst rather than after it has faded.
 */
const REVEAL_AT = 0.62;

type Phase = "idle" | "shaking" | "opening" | "revealed";

interface Reveal {
  gearId: string;
  from?: string;
}

export interface ChestShelfProps {
  character: CharacterView;
  catalog: ContentCatalog;
  /** Dispatches `open_chest` and resolves with what was inside. */
  onOpen: (chestId: string) => Promise<{ gearId: string } | null>;
  busy: boolean;
}

/**
 * The bag's shelf of unopened drops, and the modal that opens them.
 *
 * WHY THIS SCREEN AND NOT THE OVERLAY
 * -----------------------------------
 * A run resolves in about a fifth of a second and the loot line scrolls past
 * on stream while sixteen other people are also being named. The drop is real
 * but the MOMENT is not anybody's — least of all the person who got it, who
 * by the time they open their bag just finds the item sitting there. Moving
 * the reveal here gives it to the one surface that belongs to them.
 *
 * WHY A MODAL AND NOT THE TILE
 * ----------------------------
 * The first version animated the 96px tile in place, inside the bag panel.
 * That failed the way small in-place animations usually fail: the shelf can be
 * anywhere in a scrolling column, so on a phone the whole sequence could play
 * off screen while the reader was looking at their stats.
 *
 * OPEN ALL IS ONE ANIMATION, NOT N
 * --------------------------------
 * A player who has not opened their bag for a week has a shelf of them, and
 * sitting through the same 1.6s ten times is a chore rather than ten moments.
 * So it plays the sequence once and reveals everything together. A single open
 * keeps the large one-item card; a bulk open swaps to a list, because ten
 * names at that size would not fit a phone.
 *
 * EVERYTHING IS SKIPPABLE
 * -----------------------
 * A tap at any point jumps straight to the reveal. The animation is a gift,
 * and a gift you cannot decline is a toll — the second time somebody opens
 * twelve chests they want the items, not the ceremony.
 */
export function ChestShelf({ character, catalog, onOpen, busy }: ChestShelfProps): JSX.Element | null {
  const t = text.loadout.chest;
  const [phase, setPhase] = useState<Phase>("idle");
  const [revealed, setRevealed] = useState<Reveal[]>([]);
  const timers = useRef<number[]>([]);
  /**
   * Results that have arrived but are not on screen yet.
   *
   * Held in a ref rather than state so a skip can show whatever has landed so
   * far without waiting on the timers that would have shown it.
   */
  const pending = useRef<Reveal[]>([]);
  const inFlight = useRef<Promise<unknown> | null>(null);

  const clearTimers = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };
  // Every timeout below outlives the component if the player switches tab
  // mid-open, and a setState after unmount is a warning plus a leak.
  useEffect(() => clearTimers, []);

  const after = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const begin = useCallback((work: Promise<Reveal[]>) => {
    pending.current = [];
    setRevealed([]);
    setPhase("shaking");
    haptic("chestShake");

    // Out now, shown later: the reveal is paced by the animation and never by
    // the network, so a slow connection makes the chest take a moment longer
    // rather than popping open onto a spinner.
    const job = work.then((items) => {
      pending.current = items;
      return items;
    });
    inFlight.current = job;

    after(SHAKE_MS, () => {
      setPhase("opening");
      haptic("chestOpen");
      void job.then(() => {
        after(Math.round(OPEN_MS * REVEAL_AT), () => {
          setRevealed(pending.current);
          setPhase("revealed");
        });
      });
    });
  }, []);

  const openOne = useCallback(
    (chestId: string, from?: string) => {
      if (phase !== "idle" || busy) return;
      begin(onOpen(chestId).then((r) => (r ? [{ gearId: r.gearId, from }] : [])));
    },
    [begin, busy, onOpen, phase],
  );

  const openAll = useCallback(() => {
    if (phase !== "idle" || busy) return;
    const all = character.chests ?? [];
    begin(
      (async () => {
        const out: Reveal[] = [];
        // SEQUENTIAL, not Promise.all. Every command re-reads the character
        // afterwards (see useCharacter), so firing ten at once is ten
        // overlapping reads racing to be the last one to set state — the same
        // reason LoadoutApp.recycle dispatches in order.
        for (const chest of all) {
          const r = await onOpen(chest.id);
          if (r) out.push({ gearId: r.gearId, from: chest.from });
        }
        return out;
      })(),
    );
  }, [begin, busy, character.chests, onOpen, phase]);

  /** Jumps to the reveal, showing whatever has come back so far. */
  const skip = useCallback(() => {
    clearTimers();
    // The animation stops now, which is what the tap asked for. The items
    // land the moment the request resolves — already done in the common case.
    setPhase((p) => (p === "revealed" ? p : "opening"));
    void inFlight.current?.then(() => {
      setRevealed(pending.current);
      setPhase("revealed");
    });
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setRevealed([]);
    pending.current = [];
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "revealed") dismiss();
      else skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dismiss, skip]);

  const chests = character.chests ?? [];
  const opening = phase !== "idle";

  // The shelf disappears when nothing is waiting, rather than sitting there as
  // an empty row: on a phone an empty container costs a screenful of the one
  // panel people scroll most.
  if (chests.length === 0 && !opening) return null;

  const defs = revealed.map((r) => ({ reveal: r, def: catalog.gearById.get(r.gearId) }));
  const single = defs.length === 1 ? defs[0]! : null;

  return (
    <>
      <section className="chest-shelf">
        <header className="chest-shelf-head">
          <h3>{t.heading}</h3>
          <div className="chest-head-right">
            <span className="chest-count">{format(t.countLabel, { count: chests.length })}</span>
            {chests.length > 1 && (
              <button type="button" className="chest-open-all" onClick={openAll} disabled={busy || opening}>
                {t.openAll}
              </button>
            )}
          </div>
        </header>

        <ul className="chest-row">
          {chests.map((chest) => (
            <li key={chest.id}>
              <button
                type="button"
                className="chest"
                onClick={() => openOne(chest.id, chest.from)}
                disabled={busy || opening}
                title={chest.from ? format(t.from, { place: chest.from }) : t.tap}
              >
                <span className="chest-sprite" aria-hidden="true" />
                <span className="sr-only">{chest.from ? format(t.from, { place: chest.from }) : t.tap}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {opening && (
        <div
          className="chest-modal"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          onClick={phase === "revealed" ? dismiss : skip}
        >
          <div className="chest-modal-inner">
            {/* The glow is a SEPARATE, continuously animated element behind
                the sprite. Six frames can only ever step; light blooming
                smoothly underneath them is what stops the whole thing reading
                as stop-motion. */}
            <span className={`chest-bloom is-${phase}`} aria-hidden="true" />
            <span className={`chest-sprite is-${phase}`} aria-hidden="true" />

            {phase === "revealed" && (
              <div className={`chest-reveal-item${defs.length > 1 ? " is-many" : ""}`}>
                {single ? (
                  single.def ? (
                    <>
                      <ItemIcon
                        def={single.def}
                        slot={single.def.slot}
                        bodyType={character.appearance.bodyType}
                        size={64}
                      />
                      <strong className={`rarity-${single.def.rarity}`}>{single.def.name}</strong>
                      <span className="chest-reveal-rarity">{text.gear.rarity[single.def.rarity]}</span>
                      {single.reveal.from && (
                        <span className="chest-reveal-from">{format(t.from, { place: single.reveal.from })}</span>
                      )}
                    </>
                  ) : (
                    // The command answered but the catalogue cannot name it —
                    // a pruned id, or a bundle that has not loaded.
                    <strong>{t.openedUnknown}</strong>
                  )
                ) : (
                  <>
                    <strong>{format(t.openedCount, { count: defs.length })}</strong>
                    <ul className="chest-haul">
                      {defs.map(({ reveal, def }, i) => (
                        <li key={`${reveal.gearId}-${i}`}>
                          <ItemIcon
                            def={def}
                            slot={def?.slot ?? "head"}
                            bodyType={character.appearance.bodyType}
                            size={26}
                          />
                          <span className={def ? `rarity-${def.rarity}` : ""}>{def?.name ?? t.openedUnknown}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <span className="chest-dismiss">{t.dismiss}</span>
              </div>
            )}

            {phase !== "revealed" && <span className="chest-skip">{t.skip}</span>}
          </div>
        </div>
      )}
    </>
  );
}
