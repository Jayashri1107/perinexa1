// The copy of a patient's whole record on paper (rendered to HTML, no browser): its headings, what each part
// shows, what is only listed, and the footer of every page. Fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { formatDateTime } from '../../components/ui.jsx';
import { RecordCopyDocument, copyRequestFor } from './RecordCopy.jsx';
import { SAMPLE_BABY_COPY, SAMPLE_COPY } from './testdata/recordCopySample.js';

const LETTERHEAD = { name: 'Sample Maternity Hospital', address: '1 Sample Street, Pune', phone: '020 0000 0000', email: 'frontdesk@sample-hospital.example' };
const PRINTED_AT = new Date('2026-10-05T06:05:00.000Z');
const html = (copy) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <RecordCopyDocument copy={copy} letterhead={LETTERHEAD} printedAt={PRINTED_AT} printedByName="Dr. Meera Sample" />
    </MemoryRouter>,
  )
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const headings = (markup) => [...markup.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1]);

describe('the copy of the whole record on paper', () => {
  const out = html(SAMPLE_COPY);
  const words = text(out);

  it('has every part under its own heading, in the order of the record', () => {
    expect(headings(out)).toEqual([
      'Identity and contact',
      'Medical background',
      'Obstetric history',
      'Pregnancy',
      'Emergency treatment notes',
      'Visits',
      'Care plans',
      'Lab orders and results',
      'Scans and procedures done',
      'Stays in hospital',
      'Consent forms and information given',
      'Appointments',
      'Not in this copy',
    ]);
    expect(words).toContain('Copy of the whole record');
    expect(words).toContain(`Everything recorded for this patient at Sample Maternity Hospital up to ${formatDateTime(SAMPLE_COPY.madeAt)}, oldest first.`);
    expect(words).toContain('End of the copy of record P-000007.');
  });

  it('the footer of every page: the hospital, the patient number, when and by whom, confidential – never her name', () => {
    const foot = /<tfoot>(.*?)<\/tfoot>/s.exec(out)[1];
    expect(text(foot)).toBe(`Sample Maternity Hospital · Patient no. P-000007 · Copy of the record – confidential Printed ${formatDateTime(PRINTED_AT)} by Dr. Meera Sample`);
    expect(foot).not.toContain('Asha');
    expect(out).not.toContain('<thead><tr><td><p class="pdoc-draft">'); // a complete copy has no warning band
  });

  it('shows her details, the risk level with its reasons and that its rules are a draft', () => {
    expect(words).toContain('Name Asha Sample');
    expect(words).toContain('ABHA 91-XXXX-XXXX-1234 (partly hidden)');
    expect(words).toContain('Allergies Penicillin');
    expect(words).toContain('Baby registered here P-000003 – each baby has a record of its own.');
    expect(words).toContain('Risk level and its reasons Level High risk – set by Dr. Meera Sample on 22 Sep 2026: Previous caesarean and GDM together');
    expect(words).toContain('DRAFT rules that no doctor has approved yet');
  });

  it('shows each visit with its content; a visit entered in error only as a line', () => {
    expect(words).toContain('21 Sep 2026 · Antenatal visit · Signed by Dr. Meera Sample (doctor)');
    expect(words).toContain('Diagnosis G2P1 at 16 weeks, GDM');
    expect(words).toContain('1. TAB. FOLIC ACID 5 mg');
    expect(words).toContain('Corrections and additions Weight re-checked: 64.5 kg (Nurse Sample,');
    expect(words).toContain('5 Oct 2026 · Entered in error This visit was marked as entered in error by Dr. Meera Sample');
    expect(words).toContain('5 Oct 2026 · Antenatal visit · Not signed Nothing was written at this visit.');
  });

  it('shows the care plan with its items and its Draft label, lab results, the stay with its signed documents and the nursing chart', () => {
    expect(words).toContain('Antenatal care plan · In use');
    expect(words).toContain('Draft – not approved for clinical use.');
    expect(words).toContain('Anomaly scan');
    expect(words).toContain('Result: Haemoglobin 9.8 g/dL (Low)');
    expect(words).toContain('Complete blood count (CBC) Haemoglobin 9.8 g/dL (Low), Total WBC count 8000 /µL');
    expect(words).toContain('Lab orders and results Low, High and Abnormal only draw attention. Perinexa suggests them from a DRAFT list of usual adult values');
    expect(words).toContain('Doctor’s review');
    expect(words).toContain('Admission note ·');
    expect(words).toContain('Provisional diagnosis Hyperemesis');
    expect(words).toContain('Round note · Draft A draft started');
    expect(words).toContain('Operation note · Entered in error');
    expect(words).toContain('Discharge card ·');
    expect(words).toContain('Medicines on discharge 1. TAB. DOXYLAMINE + PYRIDOXINE');
    expect(words).toContain('Nursing chart');
    expect(words).toContain('Inj Ondansetron · 4 mg · IV – Slowly');
    expect(words).toContain('Consent form Consent for an operation or procedure Signed 25 Sep 2026');
    expect(words).toContain('19 Oct 2026 Time to be given Follow-up Dr. Meera Sample Booked');
    expect(words).toContain('The doctor’s private notes of a visit. They are never printed.');
  });

  it('follows the brand rules for words: no exclamation marks; no e-mail address of anyone but the letterhead', () => {
    expect(words).not.toMatch(/!/);
    expect(words.match(/\S+@\S+/g)).toEqual(['frontdesk@sample-hospital.example']);
  });
});

describe('a short record and a record too long for one copy', () => {
  it("a baby's copy: birth details, the mother by number, and \"None recorded\" under every empty part", () => {
    const out = html(SAMPLE_BABY_COPY);
    const words = text(out);
    expect(headings(out)).toEqual([
      'Identity and contact',
      'Birth details',
      'Medical background',
      'Visits',
      'Care plans',
      'Lab orders and results',
      'Scans and procedures done',
      'Stays in hospital',
      'Consent forms and information given',
      'Appointments',
      'Not in this copy',
    ]);
    expect(words).toContain('Mother Patient no. P-000007 – her record is separate; not in this copy.');
    expect(words).toContain('Made for the patient (the parents of a baby), or for a doctor the patient is referred to.');
    expect(words.match(/None recorded\./g)).toHaveLength(7);
    expect(words).not.toContain('only draw attention'); // no lab results, no note about their marks
    expect(words).toContain('Copy of the whole record Name Baby of Asha Sample Patient no. P-000003 Copy made');
  });

  it('a copy that is not complete says so at the top of every page', () => {
    const out = html({ ...SAMPLE_COPY, cut: ['visits'] });
    const band = /<thead>(.*?)<\/thead>/s.exec(out)[1];
    expect(text(band)).toBe('This copy is not complete: the record has more visits than one copy can hold, and only the newest are here. Ask the person who looks after Perinexa for the rest.');
  });
});

describe('opening the copy', () => {
  it('the copy is asked for once per opening (each request is an audit entry), and never kept for another patient', () => {
    const ask = vi.fn((id) => `answer for ${id}`);
    const first = copyRequestFor(null, 'p1', ask);
    expect(first).toEqual({ patientId: 'p1', answer: 'answer for p1' });
    expect(copyRequestFor(first, 'p1', ask)).toBe(first); // React runs the effect a second time: no second request
    expect(ask).toHaveBeenCalledTimes(1);
    expect(copyRequestFor(first, 'p2', ask)).toEqual({ patientId: 'p2', answer: 'answer for p2' });
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
