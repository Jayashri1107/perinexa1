import { describe, expect, it } from 'vitest';
import { onReturnToPage } from './onReturnToPage.js';

// Coming back to a page (its tab is shown again, or its window gets the focus again) – without a browser: the page
// and the window are plain event targets here.
function fakeBrowser() {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const win = new EventTarget();
  let time = 0;
  return {
    doc,
    win,
    now: () => time,
    wait: (ms) => (time += ms),
    hide: () => {
      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    show: () => {
      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    focus: () => win.dispatchEvent(new Event('focus')),
  };
}

describe('onReturnToPage', () => {
  it('calls back when the tab is shown again – not when it is hidden', () => {
    const b = fakeBrowser();
    let calls = 0;
    onReturnToPage(() => (calls += 1), b);
    b.hide();
    expect(calls).toBe(0);
    b.wait(60_000);
    b.show();
    expect(calls).toBe(1);
  });

  it('calls back once when the tab is shown and the window gets the focus at the same moment', () => {
    const b = fakeBrowser();
    let calls = 0;
    onReturnToPage(() => (calls += 1), b);
    b.hide();
    b.wait(5000);
    b.show();
    b.focus();
    expect(calls).toBe(1);
    // …and again the next time (another window was in front, so only the focus changes)
    b.wait(5000);
    b.focus();
    expect(calls).toBe(2);
  });

  it('stops listening when told to', () => {
    const b = fakeBrowser();
    let calls = 0;
    const stop = onReturnToPage(() => (calls += 1), b);
    stop();
    b.show();
    b.focus();
    expect(calls).toBe(0);
  });
});
