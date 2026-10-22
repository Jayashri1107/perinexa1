// The lab report on the lab's own letterhead paper (22 Oct 2026): the report only – no letterhead, hospital name or
// footer – one test per sheet, each with the patient block, the four columns of a lab report, the sample barcode and
// the signature. DRAFT ranges stay marked; a confidential test is left out unless chosen, then neutral. Made-up data.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: null, loading: false, error: null }) }));
const { LabReportSheets, readLabPaper } = await import('./LabPrints.jsx');

const v = (key, name, value, unit, range, section = '', flag = '') => ({ key, name, value, unit, range, section, flag });
const order = {
  id: 'o1',
  sampleNo: 'S-000123',
  status: 'reported',
  source: 'doctor',
  patient: { fullName: 'Test Patient One', mrn: 'P-000001', age: 30, sex: 'female', careType: 'gynaecology' },
  ordered: { at: '2026-10-22T05:44:00Z', byName: 'Dr Sample Doctor' },
  collected: { at: '2026-10-22T05:44:00Z' },
  reported: { at: '2026-10-22T06:17:00Z' },
  tests: [
    { key: 'cbc', name: 'Complete blood count (CBC)', values: [v('hb', 'Haemoglobin', '12.1', 'g/dL', '11.0–16.0', 'Red cells'), v('mcv', 'MCV', '77.0', 'fL', '80.0–100.0', 'Red cells', 'low')] },
    { key: 'tsh', name: 'Thyroid stimulating hormone (TSH)', values: [v('tsh', 'TSH', '2.4', 'µIU/mL', '0.4–4.0')] },
    { key: 'hiv', name: 'HIV 1 & 2 antibodies', values: [v('hiv', 'Result', 'Non-reactive', '', '')] },
  ],
};
const catalogue = { tests: [{ key: 'cbc', sample: 'EDTA whole blood', report: { template: 'table' } }, { key: 'tsh', sample: 'Serum', status: 'draft', report: { template: 'table' } }, { key: 'hiv', sample: 'Serum', report: { template: 'table' } }] };
const signer = { name: 'Dr Sample Pathologist', qualification: 'MD (Pathology)', regNo: 'SAMPLE-0000' };
const text = (html) => html.replace(/&#x27;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = (props = {}) => renderToStaticMarkup(<LabReportSheets order={order} catalogue={catalogue} withConfidential={false} signer={signer} {...props} />);

describe('the lab report on the lab’s letterhead paper', () => {
  it('one sheet per test, each with the patient block, the four columns, the barcode and the signer', () => {
    const html = render();
    expect(html.match(/class="lab-sheet"/g)).toHaveLength(2); // HIV left out: 2 sheets
    expect(html.match(/class="lab-sheet-head"/g)).toHaveLength(2);
    const shown = text(html);
    expect(shown).toMatch(/Test Name Obtained Value Unit Bio\. Ref\. Interval/);
    expect(shown).toMatch(/Patient name Test Patient One/);
    expect(shown).toMatch(/Sample type EDTA whole blood/);
    expect(shown).toContain('Dr Sample Pathologist');
    expect(html.match(/aria-label="Barcode S-000123"/g)).toHaveLength(2);
  });

  it('prints the report only: no letterhead, hospital name, footer or page chrome', () => {
    const html = render();
    expect(html).not.toMatch(/class="lh|Laboratory report|pdoc-foot|End of report|printed /);
  });

  it('keeps DRAFT ranges marked, leaves the confidential test out unless chosen and then neutral', () => {
    const shown = text(render());
    expect(shown).toMatch(/0\.4–4\.0 \(DRAFT\)/);
    expect(shown).toMatch(/not yet approved/);
    expect(shown).toMatch(/One confidential test is not on this printout/);
    const withIt = text(render({ withConfidential: true }));
    expect(withIt).toContain('Lab test (confidential)');
    expect(withIt).not.toMatch(/HIV/);
  });

  it('can put all tests on one sheet', () => {
    expect(render({ together: true }).match(/class="lab-sheet"/g)).toHaveLength(1);
  });

  it('remembers the paper; the lab’s letterhead paper is the default', () => {
    expect(readLabPaper()).toEqual({ kind: 'letterhead', top: 45, bottom: 30 });
  });
});
