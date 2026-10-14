// The To do list shows the next 6 weeks; later items fold (owner, 14 Oct 2026). Fake sample data only.
import { describe, expect, it } from 'vitest';
import { splitSoon } from './carePlanFormat.js';

const item = (id, from) => ({ type: 'item', key: id, item: { id, name: id, due: { from } }, decision: false });

describe('splitSoon', () => {
  const plan = { today: '2026-10-14' };
  it('keeps what starts within 6 weeks, folds the rest, and drops a heading left empty', () => {
    const decision = { ...item('d', '2027-03-01'), decision: true };
    const rows = [
      { type: 'group', key: 'decision', label: 'Needs a decision' },
      decision,
      { type: 'group', key: 'by-date', label: 'By date' },
      item('a', '2026-10-01'),
      { type: 'today', key: 'today' },
      item('b', '2026-11-20'),
      item('c', '2026-11-30'),
      { type: 'group', key: 'x', label: 'Later heading' },
      item('e', '2027-01-10'),
    ];
    const { shown, later } = splitSoon(rows, plan);
    expect(shown.map((r) => r.key)).toEqual(['decision', 'd', 'by-date', 'a', 'today', 'b']);
    expect(later.map((r) => r.key)).toEqual(['c', 'e']);
  });

  it('changes nothing when everything is soon', () => {
    const rows = [item('a', '2026-10-20')];
    expect(splitSoon(rows, plan)).toEqual({ shown: rows, later: [] });
  });
});
