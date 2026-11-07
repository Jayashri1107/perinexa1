// The five parts added to the copy of the whole record on 7 Nov 2026 – scan reports, referrals, specimens, scores and
// a baby's screening and follow-up – on paper (rendered to HTML, no browser) and as rows. Fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RecordCopyDocument } from './RecordCopy.jsx';
import { followUpRows, followUpTable, imagingBlock, notInCopy, referralBlock, scoreBlock, specimenBlock } from './recordCopyFormat.js';
import { SAMPLE_BABY_COPY, SAMPLE_COPY } from './testdata/recordCopySample.js';

const AT = '2026-11-05T05:30:00.000Z';
const LETTERHEAD = { name: 'Sample Maternity Hospital' };
const html = (copy) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <RecordCopyDocument copy={copy} letterhead={LETTERHEAD} printedAt={new Date(AT)} printedByName="Dr. Meera Sample" />
    </MemoryRouter>,
  )
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const headings = (markup) => [...markup.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1]);
const rowsOf = (b) => Object.fromEntries(b.rows);

const SIGNED_SCAN = {
  id: 'i1',
  status: 'signed',
  studyName: 'USG – growth and well-being (third trimester)',
  modality: 'usg',
  urgent: false,
  at: AT,
  ordered: { byName: 'Dr Sample', at: AT },
  indication: 'Growth check',
  done: { byName: 'Sono Sample', at: AT },
  report: { values: [{ name: 'BPD', unit: 'mm', value: '78' }, { name: 'Placenta', unit: '', value: 'Posterior' }], findings: 'Single live fetus', impression: 'Growth normal' },
  fromMachine: { machine: 'Sample USG', studyAt: AT },
  pictures: 2,
  signed: { byName: 'Dr Sample', at: AT, qualification: 'MS (OBGY)', registrationNumber: 'MMC-1', council: '' },
  amendments: [{ byName: 'Dr Sample', at: AT, reason: 'BPD corrected', report: { values: [{ name: 'BPD', unit: 'mm', value: '76' }], findings: '', impression: '' } }],
};
const REFERRAL = {
  id: 'r1',
  number: 'REF-000001',
  receivedAt: AT,
  status: 'closed',
  via: 'whatsapp',
  urgency: 'routine',
  centreName: 'Sutgirni Chowk',
  referringDoctor: { name: 'Dr Sample Referrer', clinic: 'Sample Clinic' },
  consultantName: 'Dr Sample',
  reasons: ['New pregnancy'],
  otherReason: '',
  question: 'Please take over her care',
  sent: { hb: '10.5' },
  note: { status: 'signed', findings: 'Well', diagnosis: 'G2P1', signed: { byName: 'Dr Sample', at: AT, qualification: 'MS', registrationNumber: '', council: '' }, additions: [] },
  sharing: [{ answer: 'yes', byName: 'Desk Sample', at: AT }],
  messages: [{ what: 'note', fileName: 'Consultant note.pdf', byName: 'Desk Sample', at: AT }],
  attachments: [{ fileName: 'letter.pdf', byName: 'Desk Sample', at: AT }],
  releases: [],
  created: { byName: 'Desk Sample', at: AT },
  closed: { byName: 'Desk Sample', at: AT, reason: 'Seen' },
};
const SPECIMEN = {
  id: 's1',
  serial: 3,
  sentAt: AT,
  status: 'reviewed',
  kind: 'histopathology',
  specimen: 'Uterus with cervix',
  procedure: 'Abdominal hysterectomy',
  collectedAt: AT,
  lab: 'Sample Lab',
  labReference: 'H-22',
  overdueDays: null,
  loggedByName: 'Nurse Sample',
  report: { receivedAt: AT, summary: 'Leiomyoma', byName: 'Dr Sample', at: AT, file: true },
  review: { note: 'Discussed', informedAt: AT, byName: 'Dr Sample', at: AT },
};
const EPDS = { id: 'c1', kind: 'epds', on: '2026-11-06T00:00:00.000Z', phase: 'postnatal', epdsScores: [2, 1, 1, 1, 1, 1, 1, 1, 2, 1], selfHarm: true, total: 12, band: 'possible', advice: ['Repeat in 2 to 4 weeks'], source: 'Cox 1987', note: '', byName: 'Nurse Sample', at: AT };
const VTE = { id: 'c2', kind: 'vte', on: '2026-11-06T00:00:00.000Z', phase: 'postnatal', vteFactors: ['Age over 35'], antenatalLmwh: false, total: 1, band: 'low', advice: ['Early mobilisation'], source: 'RCOG 37a', note: '', byName: 'Nurse Sample', at: AT };
const FOLLOW_UP = {
  started: true,
  gestationWeeks: 30,
  gestationDays: 2,
  highRisk: true,
  highRiskReasons: ['preterm'],
  needsRop: true,
  screens: [
    { key: 'hearing', label: 'Hearing screen (OAE or AABR)', state: 'done', dueFrom: AT, dueBy: AT, record: { status: 'done', on: AT, result: 'pass', note: 'Both ears', byName: 'Nurse Sample', at: AT } },
    { key: 'rop', label: 'Retinopathy of prematurity – first eye examination', state: 'overdue', dueFrom: AT, dueBy: AT, record: null },
  ],
  visits: [{ key: 'm3', label: '3 months corrected age', state: 'upcoming', dueOn: AT, record: null }],
  updatedByName: 'Dr Sample',
};

describe('the five parts on paper', () => {
  it("a woman's copy shows her scans, specimens, scores and referrals in their parts", () => {
    const copy = { ...SAMPLE_COPY, imaging: [SIGNED_SCAN], specimens: [SPECIMEN], scores: [EPDS, VTE], referrals: [REFERRAL] };
    const words = text(html(copy));
    expect(words).toContain('USG – growth and well-being (third trimester)');
    expect(words).toContain('BPD 78 mm');
    expect(words).toContain('Signature Dr Sample, MS (OBGY) – Reg. No. MMC-1');
    expect(words).toContain('The sex of the fetus is not disclosed (PC-PNDT Act)');
    expect(words).toContain('Specimen no. 3');
    expect(words).toContain('What the report says Leiomyoma');
    expect(words).toContain('Total 12 of 30 · Possible depression · question 10 (thoughts of self-harm) scored');
    expect(words).toContain('Risk factors Age over 35');
    expect(words).toContain('REF-000001');
    expect(words).toContain('Consultant note · Signed by Dr Sample, MS');
    expect(words).not.toMatch(/!/);
  });

  it("a baby's copy has Screening and follow-up, and no empty woman's parts", () => {
    const out = html({ ...SAMPLE_BABY_COPY, followUp: FOLLOW_UP, imaging: [], specimens: [], scores: [], referrals: [] });
    expect(headings(out)).toContain('Screening and follow-up');
    for (const h of ['Scan reports', 'Specimens and histopathology', 'Scores (EPDS and VTE risk)', 'Referrals from other doctors']) expect(headings(out)).not.toContain(h);
    const words = text(out);
    expect(words).toContain('Weeks of pregnancy at birth 30 w 2 d');
    expect(words).toContain('High-risk follow-up Yes – Born preterm');
    expect(words).toContain('Hearing screen (OAE or AABR)');
    expect(words).toContain('Pass');
    expect(words).toContain('Overdue');
  });
});

describe('the five parts as rows', () => {
  it('a scan: a signed report with its change after signing; one not signed yet listed only; a cancelled one only as cancelled', () => {
    const b = imagingBlock(SIGNED_SCAN);
    expect(rowsOf(b)).toMatchObject({ 'Asked for': 'Growth check', BPD: '78 mm', Placenta: 'Posterior', Impression: 'Growth normal', Pictures: '2 printed with the report (not in this copy)' });
    expect(b.amendments[0].title).toMatch(/BPD corrected/);
    expect(Object.fromEntries(b.amendments[0].rows)).toEqual({ BPD: '76 mm' });
    const open = imagingBlock({ id: 'i2', status: 'done', studyName: 'USG – NT scan', at: AT, ordered: { byName: 'Dr Sample', at: AT }, done: { byName: 'Sono', at: AT } });
    expect(open.status).toBe('Done – report not signed yet');
    expect(rowsOf(open).Report).toMatch(/Not signed yet/);
    const gone = imagingBlock({ id: 'i3', status: 'cancelled', at: AT, cancelled: { byName: 'Dr Sample', at: AT } });
    expect(gone).toMatchObject({ status: 'Cancelled', rows: [] });
    expect(gone.error).toMatch(/not copied/);
  });

  it('a specimen: overdue days in its status; a cancelled one without content', () => {
    expect(specimenBlock({ ...SPECIMEN, status: 'sent', report: null, review: null, overdueDays: 25 }).status).toBe('Waiting for the report · overdue, 25 days since it was sent');
    expect(rowsOf(specimenBlock(SPECIMEN))).toMatchObject({ Examination: 'Histopathology', Laboratory: 'Sample Lab, ref. H-22', 'Report file': 'Attached in Perinexa (not in this copy)' });
    expect(specimenBlock({ id: 's2', serial: 4, sentAt: AT, status: 'cancelled', cancelled: { byName: 'Dr', at: AT } })).toMatchObject({ status: 'Cancelled', rows: [] });
  });

  it('a score: the answers, never the questions; one entered in error without content', () => {
    expect(rowsOf(scoreBlock(EPDS))['Scores of the ten answers']).toBe('1: 2 · 2: 1 · 3: 1 · 4: 1 · 5: 1 · 6: 1 · 7: 1 · 8: 1 · 9: 2 · 10: 1');
    expect(scoreBlock(VTE).status).toBe('Total 1 · Lower risk');
    expect(scoreBlock({ id: 'c3', kind: 'epds', on: AT, enteredInError: { byName: 'N', at: AT } })).toMatchObject({ status: 'Entered in error', rows: [] });
  });

  it('a referral cancelled as logged by mistake has only its sentence', () => {
    const b = referralBlock({ id: 'r2', number: 'REF-000002', receivedAt: AT, status: 'cancelled', cancelled: { byName: 'Desk', at: AT } }, 'Sample');
    expect(b).toMatchObject({ status: 'Cancelled', rows: [], note: null, messages: [], files: [] });
    expect(referralBlock(REFERRAL, 'Sample').files.map((f) => f.cells[2])).toEqual(['letter.pdf']);
  });

  it("the baby's log: not started yet is said; each screen and visit with its state", () => {
    expect(Object.fromEntries(followUpRows({ ...FOLLOW_UP, started: false, gestationWeeks: null })).Log).toMatch(/Not started yet/);
    expect(followUpTable(FOLLOW_UP).map((r) => r.cells[2])).toEqual(['Done', 'Overdue', 'Later']);
    expect(followUpRows(null)).toEqual([]);
  });

  it('“Not in this copy” names the EPDS questions, scan pictures and the referral desk’s records only when they apply', () => {
    const plain = notInCopy(SAMPLE_COPY);
    expect(plain.some((l) => l.includes('EPDS'))).toBe(true);
    expect(plain.some((l) => l.startsWith('The scan pictures'))).toBe(false);
    expect(plain.some((l) => l.includes('referral desk'))).toBe(false);
    const full = notInCopy({ ...SAMPLE_COPY, imaging: [SIGNED_SCAN], referrals: [REFERRAL] });
    expect(full.some((l) => l.startsWith('The scan pictures'))).toBe(true);
    expect(full.some((l) => l.includes('referral desk'))).toBe(true);
  });
});
