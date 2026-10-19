// The order's steps (owner, 19 Oct 2026 – docs/LAB_DASHBOARD_PLAN.md): which show, and which are done.
import { describe, expect, it } from 'vitest';
import { orderSteps } from './OrderTracker.jsx';

const at = (h) => ({ byName: 'Sample lab', at: `2026-10-19T0${h}:00:00Z` });
const words = (o) => orderSteps(o).map((s) => `${s.word}${s.stamp ? ' ✓' : ''}`);

describe('the order tracker', () => {
  it('a doctor\'s order without the check: entered and reported together, then the doctor sees it', () => {
    expect(words({ status: 'reported', source: 'doctor', ordered: at(1), collected: at(2), received: at(2), reported: at(3) })).toEqual([
      'Registered ✓',
      'Sample taken ✓',
      'Received in lab ✓',
      'Results entered ✓',
      'Reported ✓',
      'Seen by doctor',
    ]);
  });
  it('a walk-in with the check: a Checked step, no doctor\'s review', () => {
    expect(words({ status: 'entered', source: 'walk_in', ordered: at(1), collected: at(2), received: at(2), entered: at(3) })).toEqual([
      'Registered ✓',
      'Sample taken ✓',
      'Received in lab ✓',
      'Results entered ✓',
      'Checked',
      'Reported',
    ]);
  });
});
