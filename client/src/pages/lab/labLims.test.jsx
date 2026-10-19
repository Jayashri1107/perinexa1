// The full lab system (docs/LAB_LIMS_PLAN.md) on the website: the barcode, the labels, the printed report, the
// register file, the order page's new parts and the lists copied from the server. The website has no browser test
// setup, so screens are rendered to HTML (react-dom/server) from fake answers. Made-up names and numbers only.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PATTERNS, code128Bars, code128Values } from '../../components/print/barcode.js';
import { DEPARTMENTS, REJECT_REASONS, duration, registerCsv, sampleLabels, shownName, valueWords } from './labFormat.js';

const answers = {};
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path.split('?')[0]] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));

const { LabReportDocument } = await import('./LabPrints.jsx');
const { LabOrderPage } = await import('./LabOrderPage.jsx');
const { LabTestsPage } = await import('./LabTestsPage.jsx');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => words(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const server = (file) => readFileSync(new URL(`../../../../server/src/${file}`, import.meta.url), 'utf8');

const catalogue = {
  tests: [
    { key: 'cbc', name: 'Complete blood count (CBC)', sample: 'Blood (EDTA)', department: 'haematology', status: 'draft', fields: [{ key: 'hb', name: 'Haemoglobin', type: 'number', unit: 'g/dL', low: 11, high: 16, range: '11–16 g/dL' }] },
    { key: 'hiv', name: 'HIV 1 and 2', sample: 'Blood (plain)', department: 'serology', status: 'approved', fields: [{ key: 'hiv', name: 'HIV', type: 'choice', options: ['Non-reactive', 'Reactive'], abnormal: ['Reactive'] }] },
    { key: 'tsh', name: 'TSH (thyroid)', sample: 'Blood (plain)', department: 'immunoassay', status: 'approved', fields: [{ key: 'tsh', name: 'TSH', type: 'number', unit: 'µIU/mL', low: 0.4, high: 4, range: '0.4–4.0 µIU/mL' }] },
  ],
};
const stamp = (byName, at = '2026-10-01T06:00:00Z') => ({ byName, at });
const order = (extra = {}) => ({
  id: 'o1',
  patientId: 'p1',
  status: 'reported',
  urgent: false,
  sampleNo: '261001-0001',
  dueAt: '2026-10-02T06:00:00Z',
  late: false,
  tests: [
    { key: 'cbc', name: 'Complete blood count (CBC)', department: 'haematology', text: '', outside: null, values: [{ key: 'hb', value: '9.5', flag: 'low', name: 'Haemoglobin', unit: 'g/dL', range: '10.5–14 g/dL (pregnant)' }] },
    { key: 'hiv', name: 'HIV 1 and 2', department: 'serology', text: '', outside: null, values: [{ key: 'hiv', value: 'Non-reactive', flag: 'normal', name: 'HIV' }] },
    { key: 'tsh', name: 'TSH (thyroid)', department: 'immunoassay', text: '', outside: { labName: 'Sample Town Lab (practice)', ref: '', sent: stamp('Sample lab'), received: stamp('Sample lab') }, values: [{ key: 'tsh', value: '2.1', flag: 'normal' }] },
  ],
  noteToLab: '',
  packages: [],
  labNote: '',
  ordered: stamp('Dr Sample'),
  collected: stamp('Sample lab'),
  entered: stamp('Sample lab'),
  verified: stamp('Sample checker'),
  reported: stamp('Sample checker', '2026-10-01T09:30:00Z'),
  lastSaved: null,
  reviewed: null,
  cancelled: null,
  rejections: [],
  sentBack: [],
  amendments: [],
  files: [],
  abnormal: true,
  rev: 3,
  access: { canCollect: false, canLabel: false, canReject: false, canReport: true, canVerify: false, canSendOutside: false, canReceiveOutside: false, canPrint: true, canReview: false, canCancel: false },
  patient: { id: 'p1', fullName: 'Sample Mother', mrn: 'P-000099', careType: 'antenatal', age: 27 },
  ...extra,
});

describe('the barcode (Code 128, set B)', () => {
  it('has the 107 standard symbols, each 11 modules wide (the stop 13), all different', () => {
    expect(PATTERNS).toHaveLength(107);
    PATTERNS.forEach((p, i) => expect(p.split('').reduce((a, b) => a + Number(b), 0), String(i)).toBe(i === 106 ? 13 : 11));
    expect(new Set(PATTERNS).size).toBe(107);
  });

  it('adds the start symbol and the check symbol; the bars end with the stop symbol', () => {
    // "Wikipedia": start B (104), then the characters, check = weighted sum mod 103 = 88
    expect(code128Values('Wikipedia')).toEqual([104, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88]);
    const { bars, width } = code128Bars('261001-0001-1');
    expect(width).toBe(10 + 11 * (1 + 13 + 1) + 13 + 10);
    expect(bars[0]).toEqual({ x: 10, w: 2 }); // start B begins with a bar 2 modules wide
    expect(() => code128Values('é')).toThrow();
  });
});

describe('labels, the report and the register', () => {
  it('one label per container, the confidential test by its neutral name', () => {
    expect(sampleLabels(order(), catalogue)).toEqual([
      { code: '261001-0001-1', sample: 'Blood (EDTA)', tests: ['Complete blood count (CBC)'] },
      { code: '261001-0001-2', sample: 'Blood (plain)', tests: ['Lab test (confidential)', 'TSH (thyroid)'] },
    ]);
    expect(shownName({ key: 'hiv', name: 'HIV 1 and 2' })).toBe('Lab test (confidential)');
  });

  it('the printed report: by department, the range used, DRAFT, who checked it; the confidential test only when included', () => {
    const html = text(renderToStaticMarkup(<LabReportDocument order={order()} catalogue={catalogue} letterhead={{ name: 'Sample Maternity Home' }} withConfidential={false} />));
    expect(html).toContain('Laboratory report');
    expect(html).toContain('Sample Maternity Home');
    expect(html).toContain('261001-0001');
    expect(html).toContain('Haematology');
    expect(html).toContain('10.5–14 g/dL (pregnant) (DRAFT)');
    expect(html).toContain('Low');
    expect(html).toContain('Usual ranges marked DRAFT are not yet approved');
    expect(html).toContain('Done at Sample Town Lab (practice)');
    expect(html).toContain('Checked and reported by Sample checker');
    expect(html).toContain('One confidential test is not on this printout');
    expect(html).not.toMatch(/HIV|Non-reactive|Lab test \(confidential\)/);
    const withIt = text(renderToStaticMarkup(<LabReportDocument order={order()} catalogue={catalogue} letterhead={null} withConfidential />));
    expect(withIt).toContain('Lab test (confidential)');
    expect(withIt).toContain('Non-reactive');
    expect(withIt).not.toMatch(/HIV/);
  });

  it('the register as a CSV file', () => {
    const csv = registerCsv([{ ...order(), tests: order().tests.map((t) => ({ ...t, name: shownName(t) })) }]);
    const [head, row] = csv.split('\r\n');
    expect(head).toMatch(/^Sample number,Ordered,Patient,Patient number,Tests/);
    expect(row).toContain('261001-0001');
    expect(row).toContain('Lab test (confidential)');
    expect(row).toContain('Sample Town Lab (practice)');
    expect(row).toContain('3 h 30 min');
    expect(duration('2026-10-01T06:00:00Z', '2026-10-04T08:00:00Z')).toBe('3 days 2 h');
    expect(valueWords({ key: 'tsh', value: '2' }, catalogue.tests[2])).toEqual({ name: 'TSH', unit: 'µIU/mL', range: '0.4–4.0 µIU/mL' });
  });
});

describe('screens', () => {
  const page = (o) => {
    answers[`/lab/orders/${o.id}`] = { order: o, catalogue, verify: true };
    return text(
      renderToStaticMarkup(
        <MemoryRouter initialEntries={[`/lab/orders/${o.id}`]}>
          <Routes>
            <Route path="/lab/orders/:orderId" element={<LabOrderPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
  };

  it('an order shows its sample number, who entered and checked it, and Print the report', () => {
    const html = page(order());
    expect(html).toContain('Sample number 261001-0001');
    // Who entered and who checked: on the order's steps (owner, 19 Oct 2026)
    expect(html).toMatch(/Results entered – done [^·]+· Sample lab/);
    expect(html).toMatch(/Checked – done [^·]+· Sample checker/);
    expect(html).toContain('Print the report');
    expect(html).toContain('10.5–14 g/dL (pregnant)');
    expect(html).toContain('Done at Sample Town Lab (practice)');
  });

  it('a rejected sample shows New sample needed; results to check show the check card', () => {
    const rejected = page(order({ status: 'ordered', collected: null, reported: null, entered: null, verified: null, rejections: [{ byName: 'Sample lab', at: '2026-10-01T07:00:00Z', reason: 'clotted', reasonText: 'Clotted', note: '' }], access: { ...order().access, canLabel: true, canCollect: true, canPrint: false } }));
    expect(rejected).toContain('New sample needed');
    expect(rejected).toContain('Sample rejected – Clotted');
    expect(rejected).toContain('Print labels');
    const toCheck = page(order({ status: 'entered', verified: null, reported: null, access: { ...order().access, canVerify: true, canPrint: false } }));
    expect(toCheck).toContain('Check the results');
    expect(toCheck).toContain('Approve and report');
  });

  it('the test list groups tests by department and marks DRAFT ranges', () => {
    answers['/lab-setup/tests'] = { tests: catalogue.tests.map((t) => ({ ...t, who: 'adult', active: true, custom: false, tatHours: 24, urgentTatHours: 4, outsideLab: '', pricePaise: 25000 })), canEdit: true, canApprove: false };
    const html = text(renderToStaticMarkup(<MemoryRouter><LabTestsPage /></MemoryRouter>));
    expect(html).toContain('Haematology');
    expect(html).toContain('DRAFT');
    expect(html).toContain('Approved');
    expect(html).toContain('₹250');
    expect(html).toContain('Add a test');
  });
});

describe('lists copied from the server', () => {
  it('departments and rejection reasons are the same as server/src/lab/labSetup.js', () => {
    const src = server('lab/labSetup.js');
    const block = (name) => src.slice(src.indexOf(`export const ${name} = {`), src.indexOf('};', src.indexOf(`export const ${name} = {`)));
    const keys = (name) => [...block(name).matchAll(/^\s+(\w+): '([^']+)'/gm)].map((m) => [m[1], m[2]]);
    expect(Object.entries(DEPARTMENTS)).toEqual(keys('DEPARTMENTS'));
    expect(Object.entries(REJECT_REASONS)).toEqual(keys('REJECT_REASONS'));
  });
});
