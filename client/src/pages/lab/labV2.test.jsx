// Lab version 2 (docs/LAB_V2_PLAN.md) on the website: the Levey-Jennings chart, earlier results (trends) and a scan's
// status, rendered to HTML. Made-up values only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STATUS } from '../imaging/ImagingPages.jsx';
import { LeveyJennings } from './LabQcPage.jsx';
import { PreviousResults, homeWord } from './LabWalkIn.jsx';

const text = (html) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Lab version 2 screens', () => {
  it('the Levey-Jennings chart: the mean and ±1–3 SD lines, one point per run marked by its status', () => {
    const runs = [
      { id: 'a', value: 12.1, z: 0.33, status: 'accepted', rules: [], run: { at: '2026-10-15T05:00:00Z' } },
      { id: 'b', value: 12.7, z: 2.33, status: 'warning', rules: ['One run beyond 2 SD (warning)'], run: { at: '2026-10-16T05:00:00Z' } },
      { id: 'c', value: 13.2, z: 4, status: 'rejected', rules: ['One run beyond 3 SD'], run: { at: '2026-10-17T05:00:00Z' } },
    ];
    const html = renderToStaticMarkup(<LeveyJennings lot={{ lotNo: 'QC-001', mean: 12, sd: 0.3 }} runs={runs} />);
    expect(html).toContain('aria-label="Levey-Jennings chart of lot QC-001"');
    expect(html.match(/class="lj-point is-/g)).toHaveLength(3);
    expect(html).toContain('is-rejected');
    for (const w of ['Mean', '+2 SD', '-3 SD']) expect(text(html)).toContain(w);
  });

  it("her earlier results show newest first with their dates", () => {
    const order = { tests: [{ key: 'hb', name: 'Haemoglobin (Hb)' }] };
    const catalogue = { tests: [{ key: 'hb', fields: [{ key: 'hb', name: 'Haemoglobin', unit: 'g/dL' }] }] };
    const previous = { hb: { hb: [{ value: '9.5', flag: 'low', at: '2026-10-10T05:00:00Z' }, { value: '11.2', flag: 'normal', at: '2026-09-01T05:00:00Z' }] } };
    const t = text(renderToStaticMarkup(<PreviousResults order={order} catalogue={catalogue} previous={previous} />));
    expect(t).toContain('Her earlier results');
    expect(t).toContain('Haemoglobin (g/dL)');
    expect(t.indexOf('9.5')).toBeLessThan(t.indexOf('11.2'));
    expect(renderToStaticMarkup(<PreviousResults order={order} catalogue={catalogue} previous={{}} />)).toBe('');
  });

  it('words for a home collection and a scan', () => {
    expect(homeWord('on_the_way')).toBe('On the way');
    expect(homeWord('failed')).toBe('Could not collect');
    expect(STATUS.done.word).toBe('Done – to report');
  });
});
