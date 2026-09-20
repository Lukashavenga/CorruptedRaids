import { useEffect, useState } from "react";

/**
 * Whole seconds remaining until `deadline` (epoch ms), or null when there
 * is no deadline. Ticks locally rather than having the server push a
 * message every second — the server sends the deadline once when the join
 * window opens and the overlay counts itself down from there.
 */
export function useCountdown(deadline: number | null): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(null);
      return;
    }
    const compute = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    compute();
    const id = window.setInterval(compute, 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  return secondsLeft;
}
