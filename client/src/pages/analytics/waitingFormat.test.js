import { describe, expect, it } from 'vitest';
import { barScale, barWidths, hasTimes, slowestKey, stageGroups, timeCell } from './waitingFormat.js';

// The look of Analytics → Waiting times (23 Nov 2026): the groups of "Each stage", the bars and the slowest row.
// Fake numbers only.

const cell = (key, median, p90) => ({ key, n: 20, median, p90, tooFew: false });
const few = (key) => ({ key, n: null, median: null, p90: null, tooFew: true });
const none = (key) => ({ key, n: 0, median: null, p90: null, tooFew: false });

describe('Waiting times: groups, bars and the slowest row', () => {
  it('puts the stages in three groups, in the order they were sent', () => {
    const stages = ['registration', 'toRmo', 'withDoctor', 'pharmacy', 'whole', 'wholeWithSale', 'labSample', 'labReport'].map((k) => cell(k, 5, 9));
    const groups = stageGroups(stages);
    expect(groups.map((g) => g.key)).toEqual(['parts', 'whole', 'lab']);
    expect(groups[0].rows.map((s) => s.key)).toEqual(['registration', 'toRmo', 'withDoctor', 'pharmacy']);
    expect(groups[1].rows.map((s) => s.key)).toEqual(['whole', 'wholeWithSale']);
    expect(groups[2].rows.map((s) => s.key)).toEqual(['labSample', 'labReport']);
    expect(groups.map((g) => g.bars)).toEqual([true, false, false]);
  });

  it('keeps a stage it does not know (in the first group) and leaves out an empty group', () => {
    const groups = stageGroups([cell('toRmo', 5, 9), cell('aNewStage', 3, 4)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((s) => s.key)).toEqual(['toRmo', 'aNewStage']);
    expect(stageGroups(undefined)).toEqual([]);
  });

  it('scales the bars to the longest slow time, not counting rows below the minimum', () => {
    expect(barScale([cell('a', 10, 40), cell('b', 20, 60), few('c'), none('d')])).toBe(60);
    expect(barScale([{ key: 'h', n: 5, median: 12, tooFew: false }])).toBe(12); // a row sent without a slow time
    expect(barScale([])).toBe(0);
    expect(barScale(undefined)).toBe(0);
  });

  it('gives the usual and slow widths of a row, and none where there is nothing to draw', () => {
    expect(barWidths(cell('a', 15, 30), 60)).toEqual({ usual: 25, slow: 50 });
    expect(barWidths(cell('b', 20, 60), 60)).toEqual({ usual: 33.3, slow: 100 });
    expect(barWidths(cell('c', 90, 120), 60)).toEqual({ usual: 100, slow: 100 }); // never wider than the track
    expect(barWidths(few('d'), 60)).toBeNull();
    expect(barWidths(none('e'), 60)).toBeNull();
    expect(barWidths(cell('f', 15, 30), 0)).toBeNull();
    expect(barWidths(null, 60)).toBeNull();
  });

  it('marks the slowest row only with two or more known rows and no tie', () => {
    expect(slowestKey([cell(9, 52, 96), cell(10, 71, 128), cell(11, 94, 163), few(18)])).toBe(11);
    expect(slowestKey([cell(1, 80, 100), cell(2, 80, 120)])).toBeNull(); // a tie: no row is singled out
    expect(slowestKey([cell(1, 80, 100), few(2), none(3)])).toBeNull(); // one known row: nothing to compare
    expect(slowestKey([])).toBeNull();
  });

  it('knows a period with nothing measured from one with rows below the minimum', () => {
    expect(hasTimes([none('a'), none('b')])).toBe(false);
    expect(hasTimes([])).toBe(false);
    expect(hasTimes(undefined)).toBe(false);
    expect(hasTimes([none('a'), few('b')])).toBe(true);
    expect(hasTimes([cell('a', 5, 9)])).toBe(true);
    expect(timeCell(few('b'), 'median')).toBe('Too few visits to show');
  });
});
