import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];

// Logs out after `minutes` without mouse, keyboard or touch activity (the server ends the session too).
export function useIdleLogout(active, minutes, onIdle) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!active) return undefined;
    let timer;
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), minutes * 60 * 1000);
    };
    restart();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, restart, { passive: true }));
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, restart));
    };
  }, [active, minutes]);
}
