// A dashboard number that counts up once when it first appears (owner, 9 Oct 2026) – 0 → 42 in about half a second.
// Later changes (the page refreshing its numbers) show at once, without replaying. Anything that is not a plain whole
// number (₹ amounts, "3 of 10") is shown as it is. Off when the device asks for reduced motion.
import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 600;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function CountUp({ value }) {
  const isCount = typeof value === 'number' && Number.isInteger(value) && value > 0;
  const played = useRef(false);
  const [shown, setShown] = useState(isCount && !reduced() ? 0 : value);

  useEffect(() => {
    if (!isCount || played.current || reduced()) {
      setShown(value);
      return undefined;
    }
    played.current = true;
    let frame;
    let done = false;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
      else done = true;
    };
    frame = requestAnimationFrame(step);
    // a page in a background tab gets no animation frames: the real number shows anyway, a moment later
    const fallback = setTimeout(() => {
      done = true;
      setShown(value);
    }, DURATION_MS + 150);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      // stopped before the end (React's development double start, or the number changed): it may play again
      if (!done) played.current = false;
    };
  }, [value, isCount]);

  return <>{shown}</>;
}
