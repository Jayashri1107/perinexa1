// The copy of a patient's whole record in words: what each part says, what is listed without its content, and the
// page footer. Fake sample data only. (Times are written in this computer's time, so the tests ask formatDateTime
// for the words of a time instead of spelling them out.)
import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime } from '../../components/ui.jsx';
import { NOT_CHECKED_YET } from './riskFormat.js';
import {
  COPY_CONFIDENTIAL,
  COPY_TITLE,
  appointmentRows,
  birthRows,
  deathRows,
  consentRows,
  copyAge,
  copyFileName,
  copyFooter,
  cutWarning,
  dayOf,
  deliveryRows,
  documentBlock,
  identityRows,
  labBlock,
  labFlagNote,
  lossRows,
  medicalRows,
  notInCopy,
  noteBlock,
  nursingRows,
  obstetricRows,
  planBlock,
  pregnancyRows,
  riskRows,
  stayBlock,
  visitBlock,
  workRows,
} from './recordCopyFormat.js';
import { SAMPLE_BABY_COPY, SAMPLE_COPY } from './testdata/recordCopySample.js';

const row = (rows, label) => rows.find(([l]) => l === label)?.[1];
const withPatient = (extra) => ({ ...SAMPLE_COPY, patient: { ...SAMPLE_COPY.patient, ...extra } });

describe('the footer and the file name: the patient number, never her name', () => {
  it('names the hospital, the patient number, when it was printed and by whom, and says "confidential"', () => {
    const printedAt = new Date('2026-10-05T06:05:00.000Z');
    const [left, right] = copyFooter({ hospital: 'Sample Hospital', mrn: 'P-000007', printedAt, printedByName: 'Dr. Meera Sample' });
    expect(left).toBe('Sample Hospital · Patient no. P-000007 · Copy of the record – confidential');
    expect(right).toBe(`Printed ${formatDateTime(printedAt)} by Dr. Meera Sample`);
    expect(COPY_CONFIDENTIAL).toBe('Copy of the record – confidential');
    expect(`${left} ${right}`).not.toContain('Asha');
  });

  it('the PDF is named by patient number and day', () => {
    expect(copyFileName(SAMPLE_COPY)).toBe('Record copy P-000007 5 Oct 2026.pdf');
    expect(copyFileName(SAMPLE_COPY)).not.toContain('Asha');
  });

  it('the age on the day of the copy: years, or days for a baby', () => {
    expect(copyAge(SAMPLE_COPY)).toBe('28 yrs');
    expect(copyAge(SAMPLE_BABY_COPY)).toBe('12 days old');
  });
});

describe('her own details', () => {
  it('identity and contact, with the ABHA partly hidden, her reminder choice and her earlier record by number', () => {
    const rows = identityRows(SAMPLE_COPY);
    expect(rows.map(([l]) => l)).toEqual(['Name', 'Patient no.', 'Age', 'Type of care', 'Phone', 'Address', 'Doctor', 'Registered', 'ABHA', 'Automatic reminders', 'Earlier record']);
    expect(row(rows, 'Type of care')).toBe('Pregnancy (antenatal)');
    expect(row(rows, 'Registered')).toBe(`${formatDateTime('2026-08-01T05:00:00.000Z')} by Reception Sample`);
    expect(row(rows, 'ABHA')).toBe('91-XXXX-XXXX-1234 (partly hidden)');
    expect(row(rows, 'Automatic reminders')).toBe('Agreed – WhatsApp, Marathi (recorded 1 Aug 2026 by Reception Sample)');
    expect(row(rows, 'Earlier record')).toBe('P-000002 – kept separately; not in this copy.');
  });

  it('says "Not recorded" for a missing phone or address, "Not assigned" without a doctor, and names the main record of a duplicate', () => {
    const rows = identityRows(
      withPatient({ phone: '', address: '', assignedDoctorName: null, abha: null, reminders: { consent: false }, earlierRecordMrns: [], duplicateOf: { mrn: 'P-000001', byName: 'RMO Sample', at: '2026-10-01T05:00:00.000Z', reason: 'Registered twice' } }),
    );
    expect(row(rows, 'Phone')).toBe('Not recorded');
    expect(row(rows, 'Address')).toBe('Not recorded');
    expect(row(rows, 'Doctor')).toBe('Not assigned');
    expect(row(rows, 'ABHA')).toBeUndefined();
    expect(row(rows, 'Automatic reminders')).toBe('Not agreed');
    expect(row(rows, 'This record')).toBe('Marked as a duplicate of P-000001 by RMO Sample on 1 Oct 2026: Registered twice. The main record is P-000001; this copy has only what is on this record.');
  });

  it('medical background and obstetric history as on her page; her babies by patient number only', () => {
    const medical = medicalRows(SAMPLE_COPY);
    expect(medical).toEqual([
      ['Blood group', 'B+'],
      ['Height', '160 cm'],
      ['Weight', '64 kg'],
      ['BMI', 25],
      ['Conditions', 'Thyroid disease, Migraine'],
      ['Allergies', 'Penicillin'],
      ['Notes on the record', 'Anxious about injections'],
    ]);
    expect(row(medicalRows(withPatient({ medical: { conditions: [], conditionsReviewed: false, allergies: '' }, notes: '' })), 'Conditions')).toBe('Not recorded');
    expect(row(medicalRows(withPatient({ medical: { conditions: [], conditionsReviewed: true, allergies: ' ' }, notes: '' })), 'Allergies')).toBe('Not recorded');

    const obstetric = obstetricRows(SAMPLE_COPY);
    expect(row(obstetric, 'Summary')).toBe('G2 P1 L1 A0 · 1 previous caesarean');
    expect(row(obstetric, 'Problems in previous pregnancies')).toBe('Heavy bleeding after delivery (PPH)');
    expect(row(obstetric, 'Baby registered here')).toBe('P-000003 – each baby has a record of its own.');
    expect(obstetricRows(SAMPLE_BABY_COPY)).toEqual([]);
  });

  it('the pregnancy: dates, findings with who ticked them, earlier entries and the readings', () => {
    const rows = pregnancyRows(SAMPLE_COPY);
    expect(row(rows, 'Weeks on the day of this copy')).toBe('18 w 5 d');
    expect(row(rows, 'EDD')).toBe('3 Mar 2027 (from scan)');
    expect(row(rows, 'LMP')).toBe('25 May 2026');
    expect(row(rows, 'EDD from LMP')).toBe('1 Mar 2027');
    expect(row(rows, 'Findings in this pregnancy')).toBe('Gestational diabetes (GDM) – Dr. Meera Sample, 20 Sep 2026');
    expect(row(rows, 'Earlier entries of findings')).toBe('Bleeding in this pregnancy – recorded by Dr. Meera Sample on 10 Aug 2026, removed by RMO Sample on 20 Aug 2026');
    expect(row(rows, 'Lowest Hb')).toBe('9.8 g/dL · 12 Sep 2026 (lab result)');
    expect(row(rows, 'Latest BP')).toBe('118/76 · 21 Sep 2026');
    expect(pregnancyRows(SAMPLE_BABY_COPY)).toEqual([]);
  });

  it('the risk level with its reasons, the doctor’s own level, and that the rules are a draft', () => {
    const rows = riskRows(SAMPLE_COPY);
    expect(row(rows, 'Level')).toBe('High risk – set by Dr. Meera Sample on 22 Sep 2026: Previous caesarean and GDM together');
    expect(row(rows, 'Automatic result')).toBe('Moderate risk');
    expect(row(rows, 'Reasons')).toBe('Thyroid disease\nGestational diabetes (GDM) (High risk)');
    expect(row(rows, 'Rules used')).toBe('“Standard antenatal care” version 3 – DRAFT rules that no doctor has approved yet. A reminder only; the treating doctor decides.');
    expect(row(rows, 'Earlier levels set by a doctor')).toBe('Moderate risk – set by Dr. Meera Sample on 1 Sep 2026: Watching the blood pressure (replaced by Dr. Meera Sample on 22 Sep 2026)');

    const plain = riskRows(withPatient({ risk: { ...SAMPLE_COPY.patient.risk, level: 'low', computedLevel: 'low', reasons: [], override: null, templateApproved: true, freeTextNotChecked: false }, riskOverrideHistory: [] }));
    expect(plain).toEqual([
      ['Level', 'Low risk'],
      ['Reasons', 'No risk factor found in the recorded information.'],
      ['Rules used', '“Standard antenatal care” version 3, approved by a doctor.'],
      ['What the automatic check does not see', NOT_CHECKED_YET],
    ]);
    expect(riskRows(SAMPLE_BABY_COPY)).toEqual([]);
  });

  it('says what the level did not count, as the risk card does: "Doctor to assess", not measured yet, an override to review', () => {
    const risk = { ...SAMPLE_COPY.patient.risk, level: 'low', computedLevel: 'low', reasons: [], override: null, templateApproved: true, freeTextNotChecked: false };
    // A finding ticked that the rules have no rule for, and nothing else applies: the cross-reference has its row
    const twins = riskRows(withPatient({ risk: { ...risk, findingsNotChecked: ['multiple'] }, riskOverrideHistory: [] }));
    expect(row(twins, 'Reasons')).toBe('No risk rule applies – but not everything recorded was counted. See “Doctor to assess” below.');
    expect(row(twins, 'Doctor to assess')).toBe("Twins or more – ticked for this pregnancy, but the hospital's risk rules have no rule for it, so the level does not count it.");
    expect(twins.map(([l]) => l).indexOf('Doctor to assess')).toBeGreaterThan(twins.map(([l]) => l).indexOf('Reasons'));
    // With reasons, a reading no rule checks is still said
    const bp = riskRows(withPatient({ risk: { ...SAMPLE_COPY.patient.risk, readingsNotChecked: ['latestBp'], freeTextNotChecked: false } }));
    expect(row(bp, 'Doctor to assess')).toBe("Latest BP 118/76 – recorded in this pregnancy, but the hospital's risk rules have no rule for it, so the level does not count it.");
    // Conditions typed as free text, and a reading nobody measured yet
    const typed = riskRows(withPatient({ risk: { ...risk, freeTextNotChecked: true, notMeasured: ['Haemoglobin (Hb)'] }, riskOverrideHistory: [] }));
    expect(row(typed, 'Doctor to assess')).toBe('“Migraine” – typed as free text, not checked automatically.');
    expect(row(typed, 'Not measured yet in this pregnancy')).toBe('Haemoglobin (Hb). The rules on it are checked once a value is recorded at a visit (haemoglobin: also when a doctor reviews a lab result).');
    expect(row(riskRows(withPatient({ risk: { ...risk, freeTextNotChecked: true }, medical: { ...SAMPLE_COPY.patient.medical, otherConditions: '' } })), 'Doctor to assess')).toBeUndefined();
    // An override whose automatic result has changed since
    const review = riskRows(withPatient({ risk: { ...SAMPLE_COPY.patient.risk, computedLevel: 'high', overrideNeedsReview: true } }));
    expect(row(review, 'To be reviewed')).toBe('The automatic result has changed since this override (was Moderate risk, now High risk). A doctor has not reviewed the override since.');
    expect(row(riskRows(SAMPLE_COPY), 'To be reviewed')).toBeUndefined();
    for (const [, text] of [...twins, ...bp, ...typed, ...review]) expect(String(text)).not.toMatch(/!/);
  });

  it('pregnancy loss and the time after delivery, only on a record that has them', () => {
    expect(lossRows(SAMPLE_COPY)).toEqual([]);
    const loss = lossRows(
      withPatient({
        careType: 'abortion',
        abortion: { lossType: 'missed', lmp: '2026-07-20T00:00:00.000Z', presentedOn: '2026-10-01T00:00:00.000Z', weeks: 10, days: 3, ectopicSite: null, moleKind: null, management: { method: 'medical', on: '2026-10-02T00:00:00.000Z', outcome: 'complete' }, histology: { status: null, result: '' }, antiD: { status: 'not_needed', on: null }, note: 'Follow-up in two weeks' },
      }),
    );
    expect(row(loss, 'Type of loss')).toMatch(/missed/i);
    expect(row(loss, 'Weeks at presentation')).toBe('10 w 3 d');
    expect(row(loss, 'Management')).toBe('Medical management · 2 Oct 2026');
    expect(row(loss, 'Outcome')).toBe('Treatment complete');
    expect(row(loss, 'Anti-D')).toBe('Not needed');
    expect(row(loss, 'Note')).toBe('Follow-up in two weeks');
    expect(row(loss, 'Findings')).toBeUndefined(); // none recorded
    // The findings of the loss, each with who recorded it and the hospital's day; the earlier entries below
    const finding = (key, value, extra = {}) => ({ key, value, byName: 'Dr Sample', at: '2026-10-01T19:30:00.000Z', on: '2026-10-02T00:00:00.000Z', via: 'record', endedAt: null, endedOn: null, endedByName: null, current: true, ...extra });
    const withFindings = lossRows(
      withPatient({
        careType: 'abortion',
        abortion: {
          lossType: 'missed', presentedOn: '2026-10-01T00:00:00.000Z', management: {}, histology: {}, antiD: {}, note: '',
          findings: [
            finding('bleeding', 'heavy', { current: false, endedAt: '2026-10-03T06:00:00.000Z', endedOn: '2026-10-03T00:00:00.000Z', endedByName: 'Dr Second' }),
            finding('os', 'closed'),
            finding('crlMm', 7.5, { via: 'visit' }),
            finding('bleeding', 'light', { byName: 'Dr Second', at: '2026-10-03T06:00:00.000Z', on: '2026-10-03T00:00:00.000Z' }),
          ],
        },
      }),
    );
    expect(row(withFindings, 'Findings')).toBe('Cervical os: Closed – Dr Sample, 2 Oct 2026\nBleeding: Light – Dr Second, 3 Oct 2026\nCrown–rump length: 7.5 mm – Dr Sample, 2 Oct 2026 (at a visit)');
    expect(row(withFindings, 'Earlier entries of findings')).toBe('Bleeding: Heavy – recorded by Dr Sample on 2 Oct 2026, changed by Dr Second on 3 Oct 2026');

    expect(deliveryRows(SAMPLE_COPY)).toEqual([]);
    expect(deliveryRows(withPatient({ careType: 'postnatal', lastDelivery: { at: '2026-09-20T00:00:00.000Z', mode: 'lscs' }, postnatal: { breastfeeding: 'yes' } }))).toEqual([
      ['Delivered', '20 Sep 2026 – Caesarean section (LSCS)'],
      ['Breastfeeding', 'Yes'],
    ]);
    expect(deliveryRows(withPatient({ careType: 'postnatal', lastDelivery: null, postnatal: { breastfeeding: '' } }))).toEqual([['Breastfeeding', 'Not recorded']]);
    // From the delivery note a doctor confirmed: the time of the birth (a day typed on the record has none)
    const noted = { at: '2026-10-04T20:30:00.000Z', mode: 'normal', timeKnown: true };
    expect(row(deliveryRows(withPatient({ careType: 'postnatal', lastDelivery: noted })), 'Delivered')).toBe(`${formatDateTime(noted.at)} – Normal vaginal delivery`);
  });

  it("a baby: the birth details, and the mother by her patient number only", () => {
    expect(birthRows(SAMPLE_COPY)).toEqual([]);
    expect(birthRows(SAMPLE_BABY_COPY)).toEqual([
      ['Born', formatDateTime('2026-09-23T03:30:00.000Z')],
      ['Birth weight', '3050 g'],
      ['Sex', 'Female'],
      ['Mother', 'Patient no. P-000007 – her record is separate; not in this copy.'],
      // The care after birth (5 Oct 2026): "Not recorded" when nothing was recorded (also older copies' data)
      ['NICU or SNCU', 'Not recorded'],
      ['Feeding at discharge', 'Not recorded'],
    ]);
    expect(row(birthRows({ ...SAMPLE_BABY_COPY, patient: { ...SAMPLE_BABY_COPY.patient, motherMrn: null } }), 'Mother')).toBe('Not linked to a mother’s record');
    const cared = { ...SAMPLE_BABY_COPY, patient: { ...SAMPLE_BABY_COPY.patient, newbornCare: { nicu: { admitted: 'yes', from: '2026-09-24T00:00:00.000Z', to: '2026-09-27T00:00:00.000Z' }, feedingAtDischarge: 'exclusive' } } };
    expect(row(birthRows(cared), 'NICU or SNCU')).toBe('Yes – from 24 Sep 2026 to 27 Sep 2026');
    expect(row(birthRows(cared), 'Feeding at discharge')).toBe('Breast milk only (exclusive)');
    expect(medicalRows(SAMPLE_BABY_COPY)).toEqual([['Blood group', 'O+']]);
  });
});

describe('a death recorded on the record', () => {
  it('the day, the age and place (a baby) or when it was, who recorded it; a death undone is listed without its date or reason', () => {
    const closedBaby = {
      ...SAMPLE_BABY_COPY,
      patient: {
        ...SAMPLE_BABY_COPY.patient,
        death: { on: '2026-09-25T00:00:00.000Z', place: 'here', timing: null, ageDays: 2, byName: 'Dr. Sample', at: '2026-09-25T06:00:00.000Z' },
        deathsUndone: [{ byName: 'Dr. Sample', at: '2026-09-24T06:00:00.000Z', undoneByName: 'Dr. Other', undoneAt: '2026-09-24T08:00:00.000Z' }],
      },
    };
    const rows = deathRows(closedBaby);
    expect(rows.map(([label]) => label)).toEqual(['Died on', 'Age at death', 'Place', 'Recorded', 'This record', 'Recorded in error and undone']);
    expect(row(rows, 'Died on')).toBe('25 Sep 2026');
    expect(row(rows, 'Age at death')).toBe('2 days');
    expect(row(rows, 'Place')).toBe('This hospital');
    expect(row(rows, 'Recorded in error and undone')).toMatch(/^A death was recorded by Dr\. Sample on \d+ Sep 2026 and undone as recorded in error by Dr\. Other on \d+ Sep 2026\.$/);
    expect(copyAge(closedBaby)).toBe('Died aged 2 days');
    const mother = { ...SAMPLE_COPY, patient: { ...SAMPLE_COPY.patient, death: { on: '2026-09-25T00:00:00.000Z', place: null, timing: 'postpartum', ageDays: null, byName: 'Dr. Sample', at: '2026-09-25T06:00:00.000Z' } } };
    expect(row(deathRows(mother), 'When')).toBe('From 24 hours up to 42 days after delivery (or after the pregnancy ended)');
    expect(deathRows(SAMPLE_COPY)).toEqual([]); // nothing on a record with no death
  });
});

describe('visits', () => {
  it('a signed visit: vital signs, notes, the pregnancy check, medicines, who wrote what and the corrections', () => {
    const v = visitBlock(SAMPLE_COPY.visits[0]);
    expect(v.title).toBe('21 Sep 2026 · Antenatal visit');
    expect(v.status).toBe(`Signed by Dr. Meera Sample (doctor) on ${formatDateTime('2026-09-21T06:30:00.000Z')}`);
    expect(v.error).toBeNull();
    expect(v.rows).toEqual([
      ['Vital signs', 'BP 118/76 mmHg · Pulse 82/min · Weight 64 kg · Hb 10.4 g/dL · Urine albumin nil'],
      ['Complaints', 'Mild nausea'],
      ['Pregnancy check', 'Fundal height 16 cm · FHR 144/min · Fetal movements present · Oedema none'],
      ['Examination', 'Abdomen soft'],
      ['Diagnosis', 'G2P1 at 16 weeks, GDM'],
      ['Tests advised', 'Repeat OGTT'],
      ['Advice', 'Diet as advised'],
      ['Next visit', '19 Oct 2026 – with reports'],
      ['Medicines', '1. TAB. FOLIC ACID 5 mg – 1 tab · 1-0-0 (morning) · after food · for 30 days (with water)'],
      ['Instructions with the medicines', 'Take iron and calcium 2 hours apart'],
      ['Written by', 'vital signs – Nurse Sample · notes – Dr. Meera Sample · prescription – Dr. Meera Sample'],
    ]);
    expect(v.additions).toEqual([{ key: 'x1', text: 'Weight re-checked: 64.5 kg', by: `Nurse Sample, ${formatDateTime('2026-09-21T07:00:00.000Z')}` }]);
  });

  it('a visit entered in error is listed as such, without content; a visit just started says "Not signed"', () => {
    const wrong = visitBlock(SAMPLE_COPY.visits[1]);
    expect(wrong).toEqual({
      key: 'v2',
      title: '5 Oct 2026',
      status: 'Entered in error',
      error: `This visit was marked as entered in error by Dr. Meera Sample on ${formatDateTime('2026-10-05T05:00:00.000Z')}. Its content is not part of the record and is not copied.`,
      rows: [],
      additions: [],
    });
    const open = visitBlock(SAMPLE_COPY.visits[2]);
    expect(open).toMatchObject({ status: 'Not signed', rows: [], additions: [] });
  });
});

describe('lab orders', () => {
  it('a reviewed order: each result with its unit and flag, the review, the change after the report, the files only counted', () => {
    const o = labBlock(SAMPLE_COPY.labOrders[0], SAMPLE_COPY.catalogue);
    expect(o.title).toBe(`Ordered ${formatDateTime('2026-09-12T05:00:00.000Z')} by Dr. Meera Sample`);
    expect(o.status).toBe('Reviewed · urgent');
    expect(o.rows).toEqual([
      ['Test packages', 'Booking tests'],
      ['Note to the lab', 'Fasting not needed'],
      ['Complete blood count (CBC)', 'Haemoglobin 9.8 g/dL (Low), Total WBC count 8000 /µL'],
      ['Serum vitamin D', '18 ng/mL'],
      ['Lab remark', 'Sample slightly haemolysed'],
      ['Sample taken', `${formatDateTime('2026-09-12T05:20:00.000Z')} by Lab Sample`],
      ['Reported', `${formatDateTime('2026-09-12T09:00:00.000Z')} by Lab Sample`],
      ['Doctor’s review', `${formatDateTime('2026-09-13T06:00:00.000Z')} by Dr. Meera Sample: Iron started`],
      ['Changed after the report', `${formatDateTime('2026-09-12T10:00:00.000Z')} by Lab Sample: Typing mistake corrected. Before the change: Complete blood count (CBC) – Haemoglobin 9.5 g/dL (Low).`],
      ['Report files', '1 attached in Perinexa – not in this copy.'],
    ]);
  });

  it('a cancelled order has no tests; an order not reported yet has the names of its tests only', () => {
    const cancelled = labBlock(SAMPLE_COPY.labOrders[1], SAMPLE_COPY.catalogue);
    expect(cancelled).toMatchObject({ status: 'Cancelled', rows: [] });
    expect(cancelled.error).toBe(`This order was cancelled by Lab Sample on ${formatDateTime('2026-09-20T06:00:00.000Z')} and not carried out. Its tests are not copied.`);
    const open = labBlock(SAMPLE_COPY.labOrders[2], SAMPLE_COPY.catalogue);
    expect(open.status).toBe('Sample taken');
    expect(open.rows).toEqual([
      ['Tests', 'TSH (thyroid)'],
      ['Sample taken', `${formatDateTime('2026-10-05T04:30:00.000Z')} by Nurse Sample`],
      ['Reported', 'The lab has not reported the results yet.'],
    ]);
    const unreviewed = labBlock({ ...SAMPLE_COPY.labOrders[0], status: 'reported', reviewed: null, amendments: [], files: 0 }, SAMPLE_COPY.catalogue);
    expect(row(unreviewed.rows, 'Doctor’s review')).toBe('Not reviewed by a doctor yet.');
  });

  it('results reported without "sample collected" first: the sample time is said to be not recorded, never the report’s time', () => {
    const o = labBlock({ ...SAMPLE_COPY.labOrders[0], collected: null }, SAMPLE_COPY.catalogue);
    expect(row(o.rows, 'Sample taken')).toBe('Not recorded – the results were entered without it.');
    // an order not reported yet with no sample taken has no such line
    const waiting = labBlock({ ...SAMPLE_COPY.labOrders[2], collected: null }, SAMPLE_COPY.catalogue);
    expect(row(waiting.rows, 'Sample taken')).toBeUndefined();
  });

  it('a result marked Low, High or Abnormal brings a note that the marks come from a DRAFT list; none without one', () => {
    expect(labFlagNote(SAMPLE_COPY)).toBe(
      'Low, High and Abnormal only draw attention. Perinexa suggests them from a DRAFT list of usual adult values, and the lab may change them; the lab’s own report and the treating doctor decide.',
    );
    const unflag = (tests) => tests.map((t) => ({ ...t, values: t.values.map((v) => ({ ...v, flag: v.flag === 'normal' ? 'normal' : '' })) }));
    const plain = SAMPLE_COPY.labOrders.map((o) => (o.tests ? { ...o, tests: unflag(o.tests), amendments: (o.amendments ?? []).map((m) => ({ ...m, tests: unflag(m.tests) })) } : o));
    expect(labFlagNote({ ...SAMPLE_COPY, labOrders: plain })).toBeNull();
    // only an amended (earlier) result flagged still brings the note
    const earlierOnly = plain.map((o, i) => (i === 0 ? { ...o, amendments: SAMPLE_COPY.labOrders[0].amendments } : o));
    expect(labFlagNote({ ...SAMPLE_COPY, labOrders: earlierOnly })).not.toBeNull();
    // a flag on a value saved but not reported is not a result (the server never sends one; nothing is said)
    expect(labFlagNote({ ...SAMPLE_COPY, labOrders: [{ ...SAMPLE_COPY.labOrders[0], status: 'collected', amendments: [] }] })).toBeNull();
    expect(labFlagNote({ ...SAMPLE_COPY, labOrders: [] })).toBeNull();
  });

  it("a baby's flagged result names the DRAFT newborn values and their source, never adult values", () => {
    const flagged = { ...SAMPLE_COPY.labOrders[0], tests: [{ key: 'nb_sugar', name: 'Blood sugar (baby)', values: [{ key: 'glucose', value: '38', flag: 'low' }], text: '' }], amendments: [] };
    const note = labFlagNote({ ...SAMPLE_BABY_COPY, labOrders: [flagged] });
    expect(note).toBe(
      'Low, High and Abnormal only draw attention. Perinexa suggests them from a DRAFT list of newborn values taken from published guidance (NNF India, AAP), not reviewed by a paediatrician, and the lab may change them. Many newborn values depend on the baby’s age in hours. The lab’s own report and the treating doctor decide.',
    );
    expect(note).not.toMatch(/adult/);
    expect(labFlagNote({ ...SAMPLE_BABY_COPY, labOrders: [] })).toBeNull();
  });
});

describe('stays, scans, notes', () => {
  it('a stay with its documents: signed ones with content, a draft and one entered in error only listed', () => {
    const s = SAMPLE_COPY.stays[0];
    expect(stayBlock(s)).toEqual({
      key: 's1',
      title: `Admitted ${formatDateTime('2026-09-25T02:00:00.000Z')} · discharged ${formatDateTime('2026-09-27T05:00:00.000Z')}`,
      rows: [
        ['Ward and bed', 'Ward 2 · Bed 7'],
        ['Reason for admission', 'Observation for vomiting'],
        ['Admitted by', 'RMO Sample'],
        ['Discharge confirmed by', 'Dr. Meera Sample'],
      ],
    });
    expect(stayBlock({ ...s, dischargedAt: null, dischargedByName: null }).title).toBe(`Admitted ${formatDateTime('2026-09-25T02:00:00.000Z')} · in hospital on the day of this copy`);

    const [admission, round, operation, discharge] = s.documents.map(documentBlock);
    expect(admission).toEqual({ key: 'd1', title: `Admission note · ${formatDateTime('2026-09-25T02:10:00.000Z')}`, status: `Signed by RMO Sample (RMO) on ${formatDateTime('2026-09-25T02:30:00.000Z')}`, error: null, signedContent: true });
    expect(round).toEqual({ key: 'd2', title: 'Round note', status: 'Draft', error: `A draft started ${formatDateTime('2026-09-26T03:00:00.000Z')} by RMO Sample, not signed yet. It is not part of the record until then and is not copied.`, signedContent: false });
    expect(operation).toMatchObject({ title: 'Operation note', status: 'Entered in error', signedContent: false });
    expect(operation.error).toBe(`This operation note was marked as entered in error by Dr. Meera Sample on ${formatDateTime('2026-09-26T05:00:00.000Z')}. Its content is not part of the record and is not copied.`);
    expect(discharge.status).toBe(`Confirmed by Dr. Meera Sample (doctor) on ${formatDateTime('2026-09-27T05:10:00.000Z')} · written by RMO Sample`);
    expect(documentBlock({ id: 'd9', kind: 'delivery', status: 'draft', at: '2026-09-26T03:00:00.000Z', createdByName: null }).error).toMatch(/not confirmed by a doctor yet/);
  });

  it('the nursing chart and the scans and procedures: an entry in error has no content', () => {
    expect(nursingRows(SAMPLE_COPY.stays[0].nursing).map((r) => r.cells)).toEqual([
      [formatDateTime('2026-09-25T03:00:00.000Z'), 'Vital signs', 'BP 110/70 · Pulse 96 · SpO2 98%', 'Nurse Sample'],
      [formatDateTime('2026-09-25T03:30:00.000Z'), 'Medicine given', 'Inj Ondansetron · 4 mg · IV – Slowly', 'Nurse Sample'],
      [formatDateTime('2026-09-25T04:00:00.000Z'), 'Note', 'Entered in error (marked by Nurse Sample) – not copied', ''],
    ]);
    expect(workRows(SAMPLE_COPY.workDone).map((r) => r.cells)).toEqual([
      ['21 Sep 2026', 'Scan', 'Ultrasound – obstetric', 'Dr. Meera Sample'],
      ['22 Sep 2026', 'Procedure', 'Entered in error (marked by Nurse Sample) – not copied', ''],
    ]);
  });

  it('an emergency treatment note: who, when, why and what was given', () => {
    expect(noteBlock(SAMPLE_COPY.emergencyNotes[0])).toEqual({
      key: 'n1',
      title: `${formatDateTime('2026-09-15T07:00:00.000Z')} by Dr. Other Sample`,
      rows: [
        ['Reason', 'Fainted in the OPD'],
        ['Treatment given', 'IV fluids given'],
      ],
    });
  });
});

describe('care plans, consent forms, appointments', () => {
  it('a care plan from content no doctor approved says so; a closed plan says when and why', () => {
    const b = planBlock(SAMPLE_COPY.carePlans[0]);
    expect(b.title).toBe('Antenatal care plan');
    expect(b.status).toBe('In use');
    expect(b.draft).toBe('Draft – not approved for clinical use. Based on “Standard antenatal care” version 3, which no doctor has approved yet. Use it only as a reminder; the treating doctor decides.');
    expect(b.rows).toEqual([
      ['Counted from', 'EDD 3 Mar 2027 (from scan)'],
      ['Booked', '1 Aug 2026 at 9 w 3 d'],
      ['Plan used', 'Standard antenatal care – version 3 · Draft'],
      ['Statuses as of', '5 Oct 2026'],
    ]);
    const closed = planBlock({
      ...SAMPLE_COPY.carePlans[0],
      status: 'closed',
      template: { ...SAMPLE_COPY.carePlans[0].template, approved: true, approvedVersion: 3, label: null },
      closed: { reason: 'delivered', note: 'Delivered at term', auto: false, byName: 'Dr. Meera Sample', at: '2027-03-01T05:00:00.000Z' },
    });
    expect(closed.status).toBe('Closed');
    expect(closed.draft).toBeNull();
    expect(row(closed.rows, 'Closed')).toBe('1 Mar 2027 by Dr. Meera Sample – Delivered: Delivered at term');
    expect(row(closed.rows, 'Plan used')).toBe('Standard antenatal care – version 3 · Approved · v3');
  });

  it('consent forms and information given: titles and dates only', () => {
    expect(consentRows(SAMPLE_COPY.consents).map((r) => r.cells)).toEqual([
      ['25 Sep 2026', 'Consent form', 'Consent for an operation or procedure', 'Signed 25 Sep 2026'],
      ['13 Sep 2026', 'Information given', 'Information: anaemia in pregnancy', 'Signed copy not recorded'],
    ]);
  });

  it('appointments, oldest first (as the server sends them): the day, the time or token, the doctor and what became of it', () => {
    expect(appointmentRows(SAMPLE_COPY.appointments).map((r) => r.cells)).toEqual([
      ['21 Sep 2026', '10:30 AM', 'Follow-up', 'Dr. Meera Sample', 'Checkup done'],
      ['25 Sep 2026', 'Token 4', 'Other', 'Dr. Meera Sample', 'Cancelled'],
      ['19 Oct 2026', 'Time to be given', 'Follow-up', 'Dr. Meera Sample', 'Booked'],
    ]);
  });
});

describe('what the copy says about itself', () => {
  it('lists what a copy never holds – for a mother her babies, for a baby the mother, and another record of the same person', () => {
    const lines = notInCopy(SAMPLE_COPY);
    expect(lines[0]).toBe('The doctor’s private notes of a visit. They are never printed.');
    expect(lines).toContain('Bills, payments and pharmacy invoices, and the reminder messages that were sent.');
    expect(lines).toContain('The record of her baby. The baby has a record of its own, named here by its patient number only.');
    expect(lines.at(-1)).toMatch(/^Another record of the same person in this hospital\./);
    const baby = notInCopy(SAMPLE_BABY_COPY);
    expect(baby).toContain('The mother’s record. It is a separate record, named here by its patient number only.');
    expect(baby.some((l) => l.startsWith('Another record'))).toBe(false);
    for (const line of [...lines, ...baby]) expect(line).not.toMatch(/!/);
  });

  it('speaks of babies or a mother only when the record has them (a copy after a pregnancy loss, a baby not linked to a mother)', () => {
    const loss = notInCopy(withPatient({ careType: 'abortion', babyMrns: [], earlierRecordMrns: [] }));
    expect(loss.some((l) => /bab(y|ies)/i.test(l))).toBe(false);
    expect(notInCopy(withPatient({ careType: 'infertility', babyMrns: [] })).some((l) => /bab(y|ies)/i.test(l))).toBe(false);
    expect(notInCopy(withPatient({ babyMrns: ['P-000003', 'P-000004'] }))).toContain('The records of her babies. Each baby has a record of its own, named here by its patient number only.');
    expect(notInCopy({ ...SAMPLE_BABY_COPY, patient: { ...SAMPLE_BABY_COPY.patient, motherMrn: null } }).some((l) => /mother/i.test(l))).toBe(false);
  });

  it('warns when a part of the record was too long for one copy; says nothing when the copy is complete', () => {
    expect(cutWarning(SAMPLE_COPY)).toBeNull();
    expect(cutWarning({ ...SAMPLE_COPY, cut: ['visits', 'nursing'] })).toBe(
      'This copy is not complete: the record has more visits, nursing chart entries than one copy can hold, and only the newest are here. Ask the person who looks after Perinexa for the rest.',
    );
  });
});

describe('moments are written on the day they happened in the hospital, not the UTC day', () => {
  const before = process.env.TZ;
  afterEach(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });

  it('a delivery at 02:00, a consent form printed at 01:00 and changes made after midnight in India', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(dayOf('2026-10-04T20:30:00.000Z')).toBe('5 Oct 2026');
    const delivered = deliveryRows(withPatient({ careType: 'postnatal', lastDelivery: { at: '2026-10-04T20:30:00.000Z', mode: 'normal', timeKnown: true } }));
    expect(row(delivered, 'Delivered')).toBe('5 Oct 2026, 02:00 – Normal vaginal delivery');
    // a day typed on the record (midnight UTC) stays that day, without a time
    expect(row(deliveryRows(withPatient({ careType: 'postnatal', lastDelivery: { at: '2026-10-04T00:00:00.000Z', mode: 'normal', timeKnown: false } })), 'Delivered')).toBe('4 Oct 2026 – Normal vaginal delivery');
    expect(consentRows([{ id: 'k9', kind: 'consent', title: 'Emergency consent', printedAt: '2026-10-04T19:30:00.000Z', signedOn: '2026-10-05T00:00:00.000Z' }])[0].cells).toEqual(['5 Oct 2026', 'Consent form', 'Emergency consent', 'Signed 5 Oct 2026']);
    const late = '2026-09-21T19:00:00.000Z'; // 00:30 on 22 Sep in India
    const p = SAMPLE_COPY.patient;
    const copy = withPatient({
      pregnancy: { ...p.pregnancy, findings: [{ ...p.pregnancy.findings[0], at: late }, { ...p.pregnancy.findings[1], at: late, endedAt: late }] },
      risk: { ...p.risk, override: { ...p.risk.override, at: late } },
      riskOverrideHistory: [{ ...p.riskOverrideHistory[0], at: late, endedAt: late }],
      reminders: { ...p.reminders, at: late },
      duplicateOf: { mrn: 'P-000001', byName: 'RMO Sample', at: late, reason: '' },
    });
    expect(row(pregnancyRows(copy), 'Findings in this pregnancy')).toBe('Gestational diabetes (GDM) – Dr. Meera Sample, 22 Sep 2026');
    expect(row(pregnancyRows(copy), 'Earlier entries of findings')).toBe('Bleeding in this pregnancy – recorded by Dr. Meera Sample on 22 Sep 2026, removed by RMO Sample on 22 Sep 2026');
    expect(row(riskRows(copy), 'Level')).toMatch(/ on 22 Sep 2026: /);
    expect(row(riskRows(copy), 'Earlier levels set by a doctor')).toMatch(/ on 22 Sep 2026: .* on 22 Sep 2026\)$/);
    expect(row(identityRows(copy), 'Automatic reminders')).toMatch(/recorded 22 Sep 2026 /);
    expect(row(identityRows(copy), 'This record')).toMatch(/ on 22 Sep 2026\./);
    const closed = planBlock({ ...SAMPLE_COPY.carePlans[0], status: 'closed', closed: { reason: 'delivered', note: '', byName: 'Dr. Meera Sample', at: late } });
    expect(row(closed.rows, 'Closed')).toBe('22 Sep 2026 by Dr. Meera Sample – Delivered');
  });

  it('the printed title is the name of the menu item', () => {
    expect(COPY_TITLE).toBe('Copy of the whole record');
  });
});
