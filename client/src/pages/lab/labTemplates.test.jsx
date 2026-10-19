// Lab report templates on the website (docs/LAB_TEMPLATES_PLAN.md): the worked-out values (the same as the server's),
// the result form's parts, and the printed report by template with method, notes, signer, "End of report". Rendered
// to HTML (react-dom/server) from fake answers. Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as server from '../../../../server/src/lab/labCalcs.js';
import { CALCS, CALC_WORDS, calculate } from './labCalcs.js';
import { antibioticRows, bySection, formFromOrder, testsFromForm } from './labFormat.js';
import { calcHint, previewCalc } from './LabTemplateParts.jsx';

vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: null, loading: false, error: null, reload: () => {} }) }));
const { LabReportDocument } = await import('./LabPrints.jsx');

const text = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const stamp = (byName) => ({ byName, at: '2026-10-19T06:00:00Z' });

const num = (key, name, unit, low, high, extra = {}) => ({ key, name, type: 'number', unit, low, high, range: `${low}–${high} ${unit}`, ...extra });
const catalogue = {
  tests: [
    {
      key: 'cbc',
      name: 'Complete blood count (CBC)',
      sample: 'Blood (EDTA)',
      department: 'haematology',
      status: 'draft',
      report: { template: 'table', method: 'Automated cell counter', notes: 'A smear is checked when flagged.' },
      fields: [num('hb', 'Haemoglobin', 'g/dL', 11, 16, { section: 'Haemoglobin and red cells' }), num('rbc', 'Total RBC count', 'million/µL', 3.8, 4.8, { section: 'Haemoglobin and red cells' }), num('pcv', 'PCV', '%', 36, 46, { section: 'Haemoglobin and red cells' }), num('mcv', 'MCV', 'fL', 83, 101, { section: 'Red cell indices', calc: 'mcv' })],
    },
    { key: 'hiv', name: 'HIV 1 and 2', department: 'serology', status: 'approved', report: { template: 'serology', method: 'Rapid card test', notes: '' }, fields: [{ key: 'hiv', name: 'HIV', type: 'choice', options: ['Non-reactive', 'Reactive'], abnormal: ['Reactive'] }] },
    { key: 'urineCulture', name: 'Urine culture and sensitivity', department: 'microbiology', status: 'approved', report: { template: 'culture', method: 'Disc diffusion (CLSI)', notes: '', ownPage: true }, antibiotics: ['Nitrofurantoin', 'Ciprofloxacin', 'Fosfomycin'], fields: [{ key: 'growth', name: 'Growth', type: 'choice', options: ['No growth', 'Growth'], abnormal: ['Growth'] }, { key: 'organism', name: 'Organism isolated', type: 'text' }] },
    { key: 'histopath', name: 'Histopathology (tissue biopsy)', department: 'cytology', status: 'approved', report: { template: 'narrative', method: 'H and E stain', notes: '', ownPage: true }, fields: [{ key: 'specimen', name: 'Specimen', type: 'text', long: true }, { key: 'diagnosis', name: 'Diagnosis', type: 'text', long: true }] },
  ],
};
const order = {
  id: 'o1',
  status: 'reported',
  sampleNo: '261019-0001',
  source: 'doctor',
  tests: [
    { key: 'cbc', name: 'Complete blood count (CBC)', department: 'haematology', method: 'Automated cell counter', notes: 'A smear is checked when flagged.', values: [{ key: 'hb', value: '9.5', flag: 'low', section: 'Haemoglobin and red cells', range: '11–16 g/dL' }, { key: 'mcv', value: '72.0', flag: 'low', section: 'Red cell indices', calculated: true }] },
    { key: 'hiv', name: 'HIV 1 and 2', department: 'serology', values: [{ key: 'hiv', value: 'Non-reactive', flag: 'normal' }] },
    { key: 'urineCulture', name: 'Urine culture and sensitivity', department: 'microbiology', values: [{ key: 'growth', value: 'Growth', flag: 'abnormal' }, { key: 'organism', value: 'E. coli', flag: '' }], antibiotics: [{ name: 'Nitrofurantoin', result: 'S', zone: '20 mm' }, { name: 'Ciprofloxacin', result: 'R', zone: '' }] },
    { key: 'histopath', name: 'Histopathology (tissue biopsy)', department: 'cytology', values: [{ key: 'specimen', value: 'Endometrial curettings', flag: '' }, { key: 'diagnosis', value: 'Secretory endometrium', flag: '' }] },
  ],
  labNote: '',
  ordered: stamp('Dr Sample'),
  collected: stamp('Sample lab'),
  entered: stamp('Sample lab'),
  verified: stamp('Sample checker'),
  reported: stamp('Sample checker'),
  reviewed: null,
  patient: { fullName: 'Sample Mother', mrn: 'P-000099', careType: 'gynaecology', age: 32 },
};
const signer = { name: 'Dr Sample Pathologist', title: 'Consultant pathologist', qualification: 'MD (Pathology)', regNo: 'MMC 00000', signature: 'data:image/png;base64,iVBORw0KGgo=', signed: true };

describe('worked-out values', () => {
  it('the website formulas are the server\'s', () => {
    expect(Object.keys(CALCS)).toEqual(Object.keys(server.CALCS));
    expect(CALC_WORDS).toEqual(server.CALC_WORDS);
    const inputs = { pcv: 36, rbc: 4, hb: 12, bilirubin: 1.1, directBilirubin: 0.3, totalProtein: 7.2, albumin: 4.1, totalChol: 210, hdl: 48, tg: 160 };
    for (const name of Object.keys(CALCS)) expect(calculate(name, inputs), name).toBe(server.calculate(name, inputs));
  });

  it('the result form shows what a value comes to; a worked-out value is sent only once typed over', () => {
    const def = catalogue.tests[0];
    const entry = { values: { pcv: { value: '36' }, rbc: { value: '4' } } };
    expect(previewCalc(def.fields[3], def, entry)).toBe('90.0');
    expect(calcHint(def.fields[3], def, entry)).toBe('Worked out if left empty (PCV ÷ RBC × 10): 90.0');
    const form = formFromOrder(order);
    expect(form[0].values.mcv).toMatchObject({ value: '72.0', calculated: true });
    expect(testsFromForm(order, form, catalogue)[0].values.map((v) => v.key)).toEqual(['hb']);
    form[0].values.mcv = { value: '75', flag: 'low', calculated: false };
    expect(testsFromForm(order, form, catalogue)[0].values.map((v) => v.key)).toEqual(['hb', 'mcv']);
    // The sensitivity table: the panel, then any other antibiotic entered; only those with a result are sent
    const rows = antibioticRows(['Nitrofurantoin', 'Fosfomycin'], [{ name: 'Nitrofurantoin', result: 'S', zone: '' }, { name: 'Linezolid', result: 'R', zone: '' }]);
    expect(rows.map((r) => [r.name, r.result])).toEqual([['Nitrofurantoin', 'S'], ['Fosfomycin', ''], ['Linezolid', 'R']]);
    form[2].antibiotics = rows;
    expect(testsFromForm(order, form, catalogue)[2].antibiotics).toEqual([{ name: 'Nitrofurantoin', result: 'S', zone: '' }, { name: 'Linezolid', result: 'R', zone: '' }]);
    expect(bySection(order.tests[0].values).map(([s, l]) => [s, l.length])).toEqual([['Haemoglobin and red cells', 1], ['Red cell indices', 1]]);
  });
});

describe('the printed report by template', () => {
  const html = (props = {}) => renderToStaticMarkup(<LabReportDocument order={order} catalogue={catalogue} letterhead={{ name: 'Sample Maternity Home' }} withConfidential signer={signer} {...props} />);

  it('a table with sections, worked-out values, the method and the DRAFT note', () => {
    const t = text(html());
    expect(t).toContain('Haemoglobin and red cells');
    expect(t).toContain('Red cell indices');
    expect(t).toContain('worked out');
    expect(t).toContain('Method: Automated cell counter');
    expect(t).toContain('Note (DRAFT): A smear is checked when flagged.');
    expect(t).toContain('Age / sex 32 years / Female');
  });

  it('serology with method; a culture with its sensitivity table; histopathology as paragraphs', () => {
    const t = text(html());
    expect(t).toContain('Lab test (confidential) Non-reactive');
    expect(t).toContain('Rapid card test');
    expect(t).not.toMatch(/HIV/);
    expect(t).toContain('Nitrofurantoin Sensitive 20 mm');
    expect(t).toContain('Ciprofloxacin Resistant');
    expect(t).toContain('S = Sensitive, I = Intermediate, R = Resistant.');
    expect(t).toContain('Specimen Endometrial curettings');
    expect(t).toContain('Diagnosis Secretory endometrium');
    // Cultures and histopathology start a new page; the first test never does
    expect((html().match(/lab-report-own-page/g) ?? []).length).toBe(2);
    expect((html({ eachOnOwnPage: true }).match(/lab-report-own-page/g) ?? []).length).toBe(3);
  });

  it('the signer with qualification, registration number and signature; End of report', () => {
    const page = html();
    const t = text(page);
    expect(t).toContain('Dr Sample Pathologist MD (Pathology) Consultant pathologist Reg. No. MMC 00000');
    expect(page).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(t).toContain('End of report');
    const unsigned = renderToStaticMarkup(<LabReportDocument order={order} catalogue={catalogue} letterhead={null} withConfidential={false} signer={{ ...signer, signature: '', signed: false }} />);
    expect(unsigned).not.toContain('<img');
    expect(text(unsigned)).toContain('Dr Sample Pathologist');
    expect(text(unsigned)).toContain('One confidential test is not on this printout');
  });
});
