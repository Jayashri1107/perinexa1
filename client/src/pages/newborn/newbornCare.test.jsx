// Clinical Requirements Group B, items 12 and 13: a baby's care at birth, examinations, bilirubin chart (readings only)
// and NICU admissions (Build 13 – NEO-F-03, its register NEO-L-05 and the unit board). Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import * as F03 from '../../../../server/src/clinical/nicuAdmission.js';
import { BIRTH_CHECKS, EXAM_ITEMS } from './newbornCareRules.js';
import { MATERNAL_FIELDS } from './nicuFields.js';

// The lists as the server sends them (rules.f03)
const f03 = {
  levels: F03.LEVELS,
  bedKinds: F03.BED_KINDS,
  serology: F03.SEROLOGY,
  serologyTests: { vdrl: 'VDRL', hbsag: 'HBsAg', hiv: 'Lab test (confidential)', gbs: 'GBS', rubella: 'Rubella' },
  rubella: F03.RUBELLA,
  antenatalProblems: F03.ANTENATAL_PROBLEMS,
  steroids: F03.STEROIDS,
  labourOnset: F03.LABOUR_ONSET,
  liquor: F03.LIQUOR,
  deliveryMode: F03.DELIVERY_MODE,
  resuscitation: F03.RESUSCITATION_F03,
  cordClamp: F03.CORD_CLAMP,
  growthCharts: F03.GROWTH_CHARTS,
  gaMethods: F03.GA_METHODS,
  symmetry: F03.SYMMETRY,
  spo2Support: F03.SPO2_SUPPORT,
  respiratorySupport: F03.RESPIRATORY_SUPPORT,
  examSystems: F03.EXAM_SYSTEMS,
  maturity: F03.MATURITY,
  size: F03.SIZE,
  reasons: F03.ADMISSION_REASONS,
  sepsisPathway: F03.SEPSIS_PATHWAY,
  thermal: F03.THERMAL,
  feeds: F03.FEEDS,
  feedRoute: F03.FEED_ROUTE,
  lines: F03.LINES,
  investigations: F03.INVESTIGATIONS,
  outcomes: F03.OUTCOMES_F03,
  morbidities: F03.MORBIDITIES,
  gatedRespiratory: F03.GATED_RESPIRATORY,
  gatedLines: F03.GATED_LINES,
  maxProblems: F03.MAX_PROBLEMS,
  formCode: F03.NICU_FORM_CODE,
  footer: F03.NICU_FORM_FOOTER,
};
const rules = { outcomes: { discharged: 'Discharged home', referred: 'Referred to a higher centre', lama: 'Left against medical advice', died: 'Died', ...F03.OUTCOMES_F03 }, f03 };
const legacy = { id: 'n1', format: 'draft', serial: 4, registerLabel: 'No. 4', unit: 'sncu', unitName: 'SNCU', source: 'inborn', sourceWords: 'Born here (inborn)', admittedAt: '2026-11-09T07:00:00Z', ageHours: 1, reasons: ['lbw'], reasonNote: '', temperatureC: 35.9, cold: true, outcome: null, stayDays: null, cancelled: null };
const f03Admission = {
  ...legacy,
  id: 'n2',
  format: 'f03',
  registerLabel: 'GARKHEDA-2026-0007',
  unit: 'garkheda',
  unitName: 'Garkheda',
  unitLevel: 'level_IIIA',
  source: 'inborn_lr_ot',
  sourceWords: 'Inborn – labour room or theatre',
  inborn: true,
  motherMrn: 'P-000101',
  bed: { id: 'b1', name: 'NICU · B1', type: 'incubator' },
  allergyAlert: 'Penicillin (sample)',
  reasonPrimary: 'prematurity',
  weightGrams: 1100,
  gestationWeeks: 30,
  gestationDays: 0,
  temperatureC: 35.9,
  byName: 'Sample nurse',
  admittingDoctor: { id: 'u1', name: 'Dr Sample' },
  consultant: null,
  maternal: { gravida: 2, para: 1, apgar1: 5, apgar5: 7, resuscitation: ['ppv'], cordClamping: 'delayed', serology: { hiv: 'N', hbsag: 'N' }, unknown: [] },
  maternalFrom: { apgar1: 'delivery', resuscitation: 'birth' },
  assessment: { growthChart: 'fenton', exam: { hips: { status: 'abnormal', note: 'Clicky hip (sample)' } } },
  plan: { problems: ['Prematurity 30 weeks (sample)'], workingDiagnosis: 'RDS (sample)' },
  followOn: null,
  signed: null,
  computed: { maturityClass: 'preterm', sizeClass: null, ropEligible: true, ropFirstExamDue: '2026-12-20T00:00:00.000Z', cranialUsg: [{ key: 'day3', label: 'Day 3', on: '2026-11-23T00:00:00.000Z' }], hearingAabrBeforeDischarge: false, lengthOfStayDays: 0 },
  banners: [
    { key: 'hypothermia', tone: 'high', text: 'Temperature 35.9 °C at admission – below 36.0 °C. Start the hypothermia pathway (NEO-SOP-04).' },
    { key: 'rop', tone: 'due', text: 'ROP screening: first eye examination due', on: '2026-12-20T00:00:00.000Z' },
  ],
  flags: { hypothermia: true, incomplete: false, counselOverdue: false },
};
const care = {
  birthAt: '2026-11-09T06:00:00Z',
  baby: { id: 'p1', fullName: 'Baby Sample', mrn: 'P-000009', birthAt: '2026-11-09T06:00:00Z' },
  birth: [],
  exams: [{ id: 'e1', examinedAt: '2026-11-10T04:00:00Z', weightGrams: 2050, findings: { hips: 'abnormal' }, notes: { hips: 'Clicky left hip (sample)' }, ready: {}, summary: '', byName: 'Dr Sample', cancelled: null }],
  bilirubin: [
    { id: 'b1', at: '2026-11-10T00:00:00Z', hours: 18, mgdl: 8.5, method: 'skin', byName: 'Sample nurse', cancelled: null },
    { id: 'b2', at: '2026-11-10T12:00:00Z', hours: 30, mgdl: 10.2, method: 'serum', byName: 'Sample nurse', cancelled: null },
  ],
  nicu: [f03Admission, { ...legacy, outcome: { result: 'discharged', at: '2026-11-08T07:00:00Z' }, stayDays: 2 }],
  access: { write: true, outcome: true, sign: true },
  rules,
};
const reg = (n, extra) => ({ ...n, baby: { id: 'p1', fullName: 'Baby Sample', mrn: 'P-000009' }, register: { serial: n.registerLabel, babyUhid: 'P-000009', motherUhid: 'P-000101', inbornOutborn: 'inborn', ga: '30+0', weightG: 1100, ventilated: 'Yes', surfactant: 'Yes', tpn: '', morbidities: 'none', losDays: null, weightAtDischarge: null, mmRef: '', ...extra } });
const register = {
  month: '2026-11',
  unit: null,
  units: [{ key: 'garkheda', name: 'Garkheda' }],
  gaps: [{ unit: 'garkheda', year: 2026, last: 7, missing: [] }],
  rows: [reg(f03Admission)],
  totals: { admissions: 1, inborn: 1, outborn: 0, cold: 1, tempInRange: 0, stillAdmitted: 1, outcomes: { discharged_home: 0 }, survivalUnder1500: { n: 1, N: 2 }, survivalByWeight: { w1: { n: 0, N: 1 }, w2: { n: 1, N: 1 }, w3: { n: 0, N: 0 }, w4: { n: 0, N: 0 } } },
  weightBands: F03.WEIGHT_BANDS.map((b) => ({ key: b.key, label: b.label })),
  rules,
};
const board = {
  levels: F03.LEVELS,
  bedKinds: F03.BED_KINDS,
  units: [{ key: 'waluj', name: 'Waluj', level: 'level_II', capacity: 2, free: 0, intensiveBabies: 2, nurses: { nurses: 0, at: '2026-11-10T05:00:00Z', byName: 'Sample nurse' }, ratio: 'worse', counts: { incomplete: 1, counselOverdue: 1 }, beds: [{ id: 'b1', name: 'B1', kind: 'incubator', level: 'intensive', occupied: true }], admissions: [{ id: 'n2', bedId: 'b1', baby: { id: 'p1', fullName: 'Baby Sample', mrn: 'P-000009' }, banners: [{ key: 'counsel', tone: 'high', text: 'Parents not counselled yet – more than 1 hour since admission.' }] }] }],
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: (path) => ({ data: path === '/newborn-care/register' ? register : path === '/newborn-care/board' ? board : path ? care : null, error: null, loading: false, reload: () => {} }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useParams: () => ({ id: 'p1' }) }));
vi.mock('../analytics/analyticsFormat.js', async (orig) => ({ ...(await orig()), thisMonth: () => '2026-11' }));
const { NewbornCareTab, BiliChart } = await import('./NewbornCareTab.jsx');
const { NicuRegisterPage } = await import('./NicuRegisterPage.jsx');
const { NicuBoardPage } = await import('./NicuBoardPage.jsx');
const { NicuF03Print } = await import('./NicuF03Print.jsx');
const html = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'");
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('newborn care', () => {
  it('the record at birth offers every first step; the examination shows what is not normal', () => {
    const out = text(<NewbornCareTab />);
    for (const c of BIRTH_CHECKS) expect(out).toContain(c.label);
    expect(out).toContain('1 not normal');
    expect(out).toContain(`${EXAM_ITEMS.find((i) => i.key === 'hips').label}: Clicky left hip (sample)`);
    expect(out).toContain('the treatment lines come from the hospital');
    expect(out).not.toMatch(/!/);
  });
  it('a NEO-F-03 admission: allergy band, the red hypothermia banner, ROP due on the banner, the parts, sign and print', () => {
    const page = html(<NewbornCareTab />);
    const out = text(<NewbornCareTab />);
    expect(out).toContain('GARKHEDA-2026-0007 · Garkheda');
    expect(out).toContain('Allergy alert: Penicillin (sample)');
    expect(page).toMatch(/nicu-banner nicu-banner-high[^>]*>.*?Start the hypothermia pathway \(NEO-SOP-04\)/);
    expect(out).toMatch(/ROP screening: first eye examination due 20 Dec 2026/);
    for (const t of ['§1 Maternal and perinatal history', '§2 Admission assessment', '§3 Problem list and plan', 'Sign the admission', 'Record how it ended', 'Print as the manual’s page', 'Not signed yet']) expect(out).toContain(t);
    expect(out).toContain('From the delivery note'); // Apgar came from the note (PX-X-14)
    expect(out).toContain('Lab test (confidential)'); // HIV keeps its neutral name
    expect(out).not.toMatch(/\bHIV\b/);
    // a DRAFT admission of 6 Nov is still shown as it was
    expect(out).toContain('Cold at admission – 35.9 °C');
    expect(out).toContain('Recorded before the NEO-F-03 form');
    expect(out).not.toMatch(/!/);
  });
  it('the bilirubin chart plots the readings against hours of age, with no treatment line', () => {
    const svg = html(<BiliChart readings={care.bilirubin} />);
    expect(svg).toContain('8.5 mg/dL at 18 hours, 10.2 mg/dL at 30 hours');
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(svg).not.toMatch(/phototherapy/i);
  });
  it('the register (NEO-L-05): serials, the no-gaps check, CSV export, survival n/N', () => {
    const out = text(<NicuRegisterPage />);
    expect(out).toMatch(/GARKHEDA-2026-0007 Baby Sample P-000009 · mother P-000101/);
    expect(out).toContain('No gaps: every number of the year up to GARKHEDA-2026-0007 is in the register.');
    expect(out).toContain('Export CSV');
    expect(out).toContain('Survival under 1500 g 1/2');
    expect(out).toContain('1000–1499 g: 1/1');
    expect(out).toContain('Admitted now');
  });
  it('the unit board: the nurse:baby warning, full beds, flags', () => {
    const out = text(<NicuBoardPage />);
    expect(out).toContain('Waluj · Level II');
    expect(out).toContain('0 of 2 beds free');
    expect(out).toContain('Worse than 1 nurse to 2 babies in intensive beds');
    expect(out).toContain('1 admission record not complete within 1 hour');
    expect(out).toContain('Parents not counselled yet');
  });
});

describe('AT7: the print follows NEO-F-03', () => {
  it('header, allergy band, §1 in two columns, §2 in three, §3 in two, sign-offs; every field; HIV under the neutral name', () => {
    const page = html(<NicuF03Print admission={f03Admission} baby={care.baby} rules={f03} />);
    const out = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const order = ['NICU admission', 'Allergy alert: Penicillin (sample)', '§1 Maternal and perinatal history', '§2 Admission assessment', '§3 Problem list and plan', 'Admitting doctor', 'Parents counselled by', 'Consultant review'];
    let at = -1;
    for (const t of order) {
      const i = out.indexOf(t, at + 1);
      expect(i, t).toBeGreaterThan(at);
      at = i;
    }
    expect(page.match(/class="nicu-cols-2"/g)).toHaveLength(2); // §1 and §3
    expect(page).toContain('class="nicu-cols-3"'); // §2
    for (const f of MATERNAL_FIELDS.filter((x) => !x.test)) expect(out).toContain(f.label);
    expect(out).toContain('Lab test (confidential)');
    expect(out).not.toMatch(/\bHIV\b/);
    expect(out).toMatch(/Baby UHID P-000009 .*Mother UHID P-000101 .*Register no\. GARKHEDA-2026-0007/);
    expect(out).toContain('First examination due 20 Dec 2026');
    expect(out).toContain('Hips Not normal Clicky hip (sample)');
    expect(f03.footer).toBe('NEO-F-03 · v1.0');
  });
});
