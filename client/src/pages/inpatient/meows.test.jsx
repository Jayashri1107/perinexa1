// Clinical Requirements Group B, item 8 (OBG-F-05 v1.0): the MEOWS chart shows each red or amber reading with its word
// and icon (never colour alone), the late-entry badge, the escalation and the PPH suggestion; the printout is OBG-F-05
// – A4 landscape, 12 sets per sheet, the RED / AMBER limits, totals, action and signature rows and the footer.
// Acceptance tests 1 (PPH suggested), 4 (late entry on screen and print) and 5 (the 24-h sheet) of build8_meows.json.
// Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const BANDS = { rr: 'normal', spo2: 'normal', tempC: 'normal', sbp: 'red', dbp: 'normal', hr: 'red', avpu: 'normal', urine4h: null, pain: null, lochia: 'normal', fundus: 'normal', nurseConcern: null };
const entry = (over = {}) => ({
  id: 'm1',
  at: '2026-11-10T02:10:00Z',
  enteredAt: '2026-11-10T03:40:00Z',
  lateEntry: true,
  values: { rr: 18, spo2: 97, tempC: 36.8, sbp: 88, dbp: 60, hr: 125, avpu: 'A', urine4h: null, confusion: null, pain: null, lochia: 'normal', fundus: 'firm', wound: null, nurseConcern: null },
  bands: BANDS,
  reds: 2,
  ambers: 0,
  level: 'trigger',
  shockIndex: 1.42,
  hypertensiveEmergency: false,
  escalation: ['E1', 'E2', 'E3'],
  e2Reason: 'two_red',
  tasks: [{ key: 'consultant_bedside', rule: 'E2', label: 'Consultant at the bedside', dueAt: '2026-11-10T02:40:00Z', doneAt: null, byName: null }],
  actionTaken: 'IV access, resident called',
  doctorInformedAt: null,
  escalatedTo: '',
  note: '',
  pathway: null,
  antibioticAt: null,
  antihypertensiveAt: null,
  byName: 'Sample nurse',
  cancelled: null,
  ...over,
});
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: () => ({
    data: {
      header: { context: 'postnatal', contextDetail: 'Postnatal day 0', diagnosis: 'Normal delivery', frequencyMinutes: 240, bloodLossMl: 450, bloodLossFrom: 'delivery_note', lmwhPrescribed: false },
      copied: { bloodLossMl: 450, deliveredAt: '2026-11-10T01:00:00Z', lmwh: null },
      status: { dueAt: '2026-11-10T02:40:00Z', overdue: true, e2Due: false, frequencyOrdered: true },
      entries: [entry()],
      latest: entry(),
      access: { write: true, order: true },
    },
    error: null,
    reload: () => {},
  }),
}));
const { MeowsChart, MeowsPrint, PRINT_COLUMNS, Reading, meowsFooter, suggestPph } = await import('./MeowsChart.jsx');
const html = (el) => renderToStaticMarkup(el);
const text = (m) => m.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-10T03:45:00Z')); // the clock of the fake chart: 95 minutes after its trigger
const PATIENT = { id: 'p1', careType: 'postnatal', fullName: 'Sample Mother', mrn: 'PX-0001' };

describe('the MEOWS chart', () => {
  it('red and amber readings carry their word; normal ones are plain; old "yellow" sets show as amber', () => {
    expect(text(html(<Reading value={88} band="red" />))).toBe('88 · Red');
    expect(html(<Reading value={88} band="red" />)).toContain('pill-high');
    expect(text(html(<Reading value={22} band="amber" />))).toBe('22 · Amber');
    expect(text(html(<Reading value={22} band="yellow" />))).toBe('22 · Amber');
    expect(html(<Reading value={84} band="normal" />)).not.toContain('pill');
  });

  it('shows the header, overdue, the shock-index banner with the PPH chart, the open task and the late-entry badge', () => {
    const out = text(html(<MeowsChart patient={PATIENT} admissionId="a1" />));
    expect(out).toContain('MEOWS chart (OBG-F-05)');
    expect(out).toContain('Postnatal (Postnatal day 0) · Normal delivery · observations every 4 hours · blood loss at delivery 450 mL (delivery note)');
    expect(out).toContain('Overdue – observations were due');
    expect(out).toContain('Shock index ≥ 0.9 (1.42)');
    expect(out).toContain('Consider the PPH chart (below)');
    expect(html(<MeowsChart patient={PATIENT} admissionId="a1" />)).toContain('href="#pph-title"');
    expect(out).toContain('Consultant at the bedside · overdue since');
    expect(out).toContain('Suggested pathways (choose one); offer HDU transfer');
    expect(out).toContain('Sepsis six (OBG-ALG-07)');
    expect(out).toContain('Late entry'); // acceptance test 4, on screen
    expect(out).toContain('125 · Red');
    expect(out).toContain('2 red, 0 amber · E1, E2, E3');
    expect(out).toContain('OBG-F-05 v1.0');
    expect(out).not.toMatch(/DRAFT|yellow|!/);
  });

  it('suggests the PPH chart on E3 only after birth (postnatal, within 24 h of birth when known)', () => {
    const e3 = entry();
    const header = { context: 'postnatal' };
    expect(suggestPph(e3, { header, copied: { deliveredAt: '2026-11-10T01:00:00Z' } })).toBe(true);
    expect(suggestPph({ ...e3, at: '2026-11-11T02:00:00Z' }, { header, copied: { deliveredAt: '2026-11-10T01:00:00Z' } })).toBe(false);
    expect(suggestPph(e3, { header: { context: 'antenatal' } })).toBe(false);
    expect(suggestPph(e3, { header: null, careType: 'postnatal' })).toBe(true);
    expect(suggestPph({ ...e3, escalation: ['E1'] }, { header })).toBe(false);
  });

  it('is not shown on a baby’s record', () => {
    expect(html(<MeowsChart patient={{ id: 'b1', careType: 'newborn' }} admissionId="a1" />)).toBe('');
  });
});

describe('the printout (OBG-F-05, acceptance test 5)', () => {
  // A 24-h sheet: observations every 2 hours = 12 sets; one more set makes a second sheet
  const sets = Array.from({ length: 13 }, (_, i) =>
    entry({ id: `m${i}`, at: new Date(Date.UTC(2026, 10, 10, 2 + 2 * i)).toISOString(), lateEntry: i === 0, escalation: [], level: 'normal', reds: 0, ambers: 0, shockIndex: 0.7, values: { ...entry().values, hr: 84, sbp: 120 }, bands: { ...BANDS, hr: 'normal', sbp: 'normal' }, tasks: [], actionTaken: '' }),
  ).reverse(); // newest first, as the API sends them
  const header = { context: 'postnatal', contextDetail: 'Postnatal day 1', diagnosis: 'Normal delivery', frequencyMinutes: 240, bloodLossMl: 450, lmwhPrescribed: true };
  const markup = html(<MeowsPrint patient={PATIENT} header={header} entries={sets} />);

  it('12 observation columns per sheet, oldest first, with the RED and AMBER limits of each row', () => {
    const sheets = markup.split('<section class="mw-sheet">').slice(1);
    expect(sheets).toHaveLength(2);
    expect(PRINT_COLUMNS).toBe(12);
    for (const s of sheets) expect(s.match(/<thead><tr>(.*?)<\/tr><\/thead>/)[1].match(/<th /g)).toHaveLength(3 + 12);
    expect(text(sheets[0])).toContain('sheet 1 of 2');
    expect(text(sheets[0])).toContain('Context: Postnatal (Postnatal day 1) · Diagnosis / procedure: Normal delivery · Observations every: 4 hours · Blood loss at delivery: 450 mL · LMWH: prescribed');
    const firstHead = text(sheets[0].match(/<thead>(.*?)<\/thead>/)[1]);
    expect(firstHead).toMatch(/^Parameter RED AMBER .*Late entry/); // acceptance test 4, on paper
    expect(text(sheets[1].match(/<thead>(.*?)<\/thead>/)[1])).not.toContain('Late entry');
    const out = text(markup);
    for (const row of ['Respiratory rate (/min) <10 or >30 21–30', 'SpO2 (%) <92 92–94', 'Temperature (°C) <35 or ≥38 35–36 or 37.5–37.9', 'Pulse (/min) <40 or >120 40–50 or 100–120', 'Systolic BP (mmHg) <90 or ≥160 90–100 or 150–159', 'Diastolic BP (mmHg) ≥110 90–109', 'Urine in 4 h (mL) <100 100–120', 'Pain score (/10) ≥7', 'Consciousness (AVPU) / new confusion P or U V or new confusion', 'Lochia / PV loss Heavy or offensive', 'Fundus Soft or rising', 'Nurse concern Yes', 'Shock index (pulse ÷ systolic) ≥0.9'])
      expect(out, row).toContain(row);
    expect(out).toContain('Totals Red · amber 0 red · 0 amber');
    expect(out).toContain('Action E1–E3');
    expect(out).toContain('Signature Recorded by Sample nurse');
    expect(out).not.toMatch(/yellow|!/);
  });

  it('the footer of every page: OBG-F-05 · v1.0 · effective date', () => {
    expect(meowsFooter({ code: 'OBG-F-05', version: '1.0', effectiveFrom: '2026-11-06T00:00:00Z' })).toMatch(/^OBG-F-05 · v1\.0 · effective \S+/);
    expect(meowsFooter(null)).toBe('OBG-F-05 · v1.0 · effective date not in the document register');
  });
});
