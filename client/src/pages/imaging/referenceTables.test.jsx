import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { bandAt, bandOf, cprOf, dopplerRows } from './referenceTables.js';
import { parseRows } from './ReferenceTablesPage.jsx';
import { DopplerMarks } from './ReferenceMarks.jsx';

// Sonography stage 2: reading the approved tables. The numbers are made up for the tests – never clinical values.
const TABLE = { name: 'Sample index', unit: '', source: 'Sample chart 2020', rows: [{ week: 30, p5: 1.0, p50: 1.2, p95: 1.4 }, { week: 32, p5: 0.8, p50: 1.0, p95: 1.2 }] };

describe('the reference tables', () => {
  it('reads a week straight between two rows; nothing outside the table', () => {
    expect(bandAt(TABLE, 31)).toEqual({ p5: 0.9, p50: expect.closeTo(1.1, 6), p95: expect.closeTo(1.3, 6) });
    expect(bandAt(TABLE, 29)).toBeNull();
    expect(bandOf(TABLE, 31, 1.35)).toBe('above');
    expect(bandOf(TABLE, 31, 0.85)).toBe('below');
    expect(bandOf(TABLE, 31, 1.1)).toBe('within');
    expect(bandOf(null, 31, 1.1)).toBeNull();
  });
  it('the CPR is MCA PI ÷ UA PI; a Doppler value with no approved table is not judged', () => {
    expect(cprOf({ mcaPi: 1.6, uaPi: 1.2 })).toBe(1.33);
    expect(cprOf({ mcaPi: 1.6 })).toBeNull();
    const rows = dopplerRows({ uaPi: 1.5, mcaPi: 1.6 }, 31, { uaPi: TABLE });
    expect(rows.map((r) => [r.key, r.band, r.noTable])).toEqual([
      ['uaPi', 'above', false],
      ['mcaPi', null, true],
      ['cpr', null, true],
    ]);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DopplerMarks values={{ uaPi: 1.5 }} on="2026-11-10" eddByDates="2027-01-05" references={{ uaPi: TABLE }} />
      </MemoryRouter>,
    );
    expect(html).toContain('Sample chart 2020');
  });
  it('a pasted table: one week per line, four numbers', () => {
    expect(parseRows('30, 1.0, 1.2, 1.4\n31\t0.9\t1.1\t1.3\n\nx')).toEqual({ rows: [{ week: 30, p5: 1, p50: 1.2, p95: 1.4 }, { week: 31, p5: 0.9, p50: 1.1, p95: 1.3 }], bad: [4] });
  });
});
