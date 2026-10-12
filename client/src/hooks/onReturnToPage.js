/**
 * Calls back when the person comes back to this page: its tab is shown again, or its window gets the focus again
 * (once, when both happen together). Used where something may have been changed in another tab meanwhile – e.g. the
 * patient's details opened from a prescription – so the page can read it again without losing what is typed.
 * Returns a function that stops listening.
 * doc, win, now: the browser's own unless given (tests).
 */
export function onReturnToPage(callback, { doc = document, win = window, now = Date.now, quietMs = 1000 } = {}) {
  let last = -Infinity;
  const back = () => {
    if (doc.visibilityState === 'hidden') return;
    const t = now();
    if (t - last < quietMs) return;
    last = t;
    callback();
  };
  doc.addEventListener('visibilitychange', back);
  win.addEventListener('focus', back);
  return () => {
    doc.removeEventListener('visibilitychange', back);
    win.removeEventListener('focus', back);
  };
}
