// Counselling numbers (fertility idea F3): every figure names its source, and her age picks a published IVF band only.
import { describe, expect, it } from 'vitest';
import { COUNSELLING_ROWS, IVF_BANDS, IVF_SOURCE, ivfBandOf } from './CounsellingNumbers.jsx';

describe('counselling numbers', () => {
  it('give a source for every figure', () => {
    for (const r of COUNSELLING_ROWS) expect(r.source, r.step).toMatch(/protocol library/);
    expect(IVF_SOURCE).toMatch(/HFEA/);
    expect(IVF_BANDS.map((b) => b.band)).toEqual(['18–34', '43–44']);
  });

  it('pick her IVF band only where a figure is published', () => {
    expect(ivfBandOf(30)).toBe('18–34');
    expect(ivfBandOf(43)).toBe('43–44');
    expect(ivfBandOf(38)).toBe('');
    expect(ivfBandOf(null)).toBe('');
  });
});
