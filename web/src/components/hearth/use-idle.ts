import { useEffect, useRef, useState } from 'react';

/**
 * Tracks whether the wall has been untouched for `timeoutMs`. Used for the
 * always-on idle treatment: after inactivity the surface dims (a cheap CSS
 * screen-burn measure — not a screensaver engine). Any pointer/touch/key wakes
 * it. Listeners are passive and torn down on unmount, so it adds no ongoing
 * cost beyond a single timer.
 */
export function useIdle(timeoutMs = 180_000): boolean {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reset = () => {
      setIdle(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setIdle(true), timeoutMs);
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    reset();
    return () => {
      for (const e of events) window.removeEventListener(e, reset);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [timeoutMs]);

  return idle;
}
