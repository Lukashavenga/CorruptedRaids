import { useEffect, useRef, useState } from "react";

/**
 * `value`, but allowed to change at most once every `dwellMs`.
 *
 * The first change after a quiet spell goes through at once, so nothing feels
 * late; changes that follow it inside the window are held and the LATEST of
 * them lands when the window closes. Nothing is dropped, only batched.
 *
 * It exists for the party roster (issue #36). Ordering chips by who was hit
 * last is the point, but a big fight lands a party hit every few hundred
 * milliseconds and a grid that rearranges that often cannot be read from
 * across a room - a name has moved before anyone has found it. Holding each
 * arrangement for a moment trades a little immediacy for a grid that settles.
 */
export function useSettled<T>(value: T, dwellMs: number): T {
  const [settled, setSettled] = useState(value);
  const lastCommit = useRef(0);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (Object.is(value, settled)) return;
    const wait = lastCommit.current + dwellMs - Date.now();
    if (wait <= 0) {
      lastCommit.current = Date.now();
      setSettled(value);
      return;
    }
    // Re-armed on every change inside the window, but always aimed at the
    // window's END rather than pushed back by each new value - a steady stream
    // of hits must still produce a new arrangement every `dwellMs`.
    const id = window.setTimeout(() => {
      lastCommit.current = Date.now();
      setSettled(latest.current);
    }, wait);
    return () => window.clearTimeout(id);
  }, [value, settled, dwellMs]);

  return settled;
}
