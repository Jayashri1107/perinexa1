// The five parts added to the copy of the whole record on 7 Nov 2026: scan reports, referrals from other doctors,
// specimens and histopathology, scores (EPDS and VTE risk) and a baby's screening and follow-up. What each holds,
// what each leaves out, and that the audit entry stays ids only. Fake sample data only.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ImagingOrder } from '../src/models/ImagingOrder.js';
import { NewbornFollowUp } from '../src/models/NewbornFollowUp.js';
import { User } from '../src/models/User.js';
import { followUpForCopy, imagingForCopy, referralForCopy, scoreForCopy, specimenForCopy } from '../src/patients/recordCopyView.js';
import { reasonByKey } from '../src/referrals/reasons.js';
import { COPY_LIMITS } from '../src/routes/recordCopy.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-07T06:00:00Z'); // 11:30 in India
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', desk: 'referral_desk' };
const SIGNATURE = { qualification: 'MBBS, MS (OBGY)', registrationNumber: 'MMC-12345', council: 'Maharashtra Medical Council' };
const PDF = Buffer.from('%PDF-1.4\n% fake sample file\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').toString('base64');
const DAY = 24 * 60 * 60 * 1000;

let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp({ apiRateLimitMax: 100000 });
  hospital = await createTenant('Copy Parts Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const copyOf = async (who, p) => ok(await (await as(who)).get(`/api/patients/${p.id}/record-copy`)).copy;

async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({
      careType: 'postnatal',
      fullName: 'Parts Mother',
      ageYears: 29,
      phone: '+91 98765 00011',
      assignedDoctor: people.drA._id.toString(),
      ...overrides,
    }),
  );
  return ok(res, 201).patient;
}

describe('scan reports in the copy', () => {
  it('a signed report whole with its measurements, signer and change after signing; an unsigned scan listed; a cancelled one with who and when only', async () => {
    const p = await register({ careType: 'antenatal', pregnancy: { scanEdd: '2027-03-01' } });
    await User.updateOne({ _id: people.drA._id }, { $set: { professional: SIGNATURE } });
    const stamp = { by: people.drA._id, byName: 'Sample drA', at: new Date(NOW.getTime() - 3 * DAY) };
    const base = { tenantId: hospital._id, patientId: p.id, ordered: stamp };
    const signed = await ImagingOrder.create({
      ...base,
      study: 'usg_growth',
      clientRequestId: randomUUID(),
      indication: 'Growth check',
      status: 'signed',
      done: stamp,
      signed: stamp,
      report: { values: { bpd: 78, efw: 1850, placenta: 'Posterior' }, findings: 'Single live fetus', impression: 'Growth on the 40th centile', machine: { machine: 'Sample USG', studyAt: stamp.at, rows: [] } },
      amendments: [{ ...stamp, reason: 'EFW corrected', report: { values: { efw: 1800 }, findings: 'Single live fetus', impression: 'OLD-IMPRESSION' } }],
      images: [
        { fileId: new mongoose.Types.ObjectId(), fileName: 'img1.jpg', inPrint: true },
        { fileId: new mongoose.Types.ObjectId(), fileName: 'img2.jpg', inPrint: false },
        { fileId: new mongoose.Types.ObjectId(), fileName: 'img3.jpg', inPrint: true, removed: { ...stamp, reason: 'blurred' } },
      ],
    });
    const pending = await ImagingOrder.create({ ...base, study: 'usg_anomaly', clientRequestId: randomUUID(), status: 'done', done: stamp, report: { values: { bpd: 50 }, findings: 'UNSIGNED-FINDINGS', impression: '' } });
    const cancelled = await ImagingOrder.create({ ...base, study: 'usg_nt', clientRequestId: randomUUID(), indication: 'CANCELLED-INDICATION', status: 'cancelled', cancelled: { ...stamp, reason: 'SCAN-CANCEL-REASON' } });

    const copy = await copyOf('drA', p);
    expect(copy.imaging.map((s) => s.id)).toEqual([String(signed._id), String(pending._id), String(cancelled._id)]);
    const [whole, listed, gone] = copy.imaging;
    expect(whole).toMatchObject({
      status: 'signed',
      studyName: 'USG – growth and well-being (third trimester)',
      indication: 'Growth check',
      report: {
        values: [
          { name: 'BPD', unit: 'mm', value: '78' },
          { name: 'Estimated fetal weight', unit: 'g', value: '1850' },
          { name: 'Placenta', unit: '', value: 'Posterior' },
        ],
        findings: 'Single live fetus',
        impression: 'Growth on the 40th centile',
      },
      fromMachine: { machine: 'Sample USG' },
      pictures: 1, // only the ones that print (not taken off, ticked for print)
      signed: { byName: 'Sample drA', ...SIGNATURE },
      amendments: [{ byName: 'Sample drA', reason: 'EFW corrected', report: { values: [{ name: 'Estimated fetal weight', unit: 'g', value: '1800' }], impression: 'OLD-IMPRESSION' } }],
    });
    expect(listed).toMatchObject({ status: 'done', studyName: 'USG – anomaly scan (18–22 weeks)' });
    expect(listed).not.toHaveProperty('report');
    expect(gone).toEqual({ id: String(cancelled._id), status: 'cancelled', at: gone.at, cancelled: { byName: 'Sample drA', at: stamp.at.toISOString() } });
    const all = JSON.stringify(copy.imaging);
    for (const never of ['UNSIGNED-FINDINGS', 'CANCELLED-INDICATION', 'SCAN-CANCEL-REASON', 'img1.jpg', String(people.drA._id)]) expect(all, never).not.toContain(never);

    const before = COPY_LIMITS.imaging;
    COPY_LIMITS.imaging = 2;
    try {
      const short = await copyOf('drA', p);
      expect(short.cut).toEqual(['imaging']);
      expect(short.imaging.map((s) => s.id)).toEqual([String(pending._id), String(cancelled._id)]); // the newest, oldest first
    } finally {
      COPY_LIMITS.imaging = before;
    }
  });
});

describe('referrals in the copy', () => {
  it('the doctor and clinic, reasons, question, what was sent, the signed note, her answers, messages and files by name; a draft note and a cancelled referral only listed', async () => {
    const p = await register({ careType: 'antenatal', pregnancy: { scanEdd: '2027-03-01' } });
    const other = await register({ fullName: 'Parts Other', phone: '+91 98765 00019' });
    await User.updateOne({ _id: people.drA._id }, { $set: { professional: SIGNATURE } });
    const desk = await as('desk');
    const drA = await as('drA');
    const doctor = ok(await desk.post('/api/referring-doctors').send({ name: 'Dr Sample Referrer', clinic: 'Sample Clinic', area: 'Sample Nagar', phone: '+91 00000 11111' }), 201).doctor;
    const log = async (patient, body) =>
      ok(await desk.post('/api/referrals').send({ clientRequestId: randomUUID(), via: 'whatsapp', urgency: 'routine', centre: 'sutgirni', reasons: ['new_pregnancy'], referringDoctorId: doctor.id, patientId: patient.id, ...body }), 201).referral;
    const ref = (r, path = '') => `/api/referrals/${r.id}${path}`;

    let r = await log(p, { otherReason: 'Previous caesarean', question: 'Please take over her antenatal care', sent: { hb: '10.5', medicines: 'Folic acid' }, consultantId: String(people.drA._id) });
    r = ok(await desk.post(ref(r, '/attachments')).send({ fileName: 'referral letter.pdf', mediaType: 'application/pdf', data: PDF }), 201).referral;
    r = ok(await desk.post(ref(r, '/sharing')).send({ answer: 'yes' })).referral;
    const words = { questionRestated: 'Booking for antenatal care', findings: 'Well, BP 110/70 mmHg', diagnosis: 'G2P1, previous caesarean', plan: 'Booking tests', needFromYou: 'Repeat Hb in 4 weeks', returnsToYouFor: 'Routine checks till 28 weeks' };
    r = ok(await drA.put(ref(r, '/note')).send({ rev: 0, ...words })).referral;
    r = ok(await drA.post(ref(r, '/note/sign')).send({ rev: r.note.rev })).referral;
    r = ok(await drA.post(ref(r, '/releases')).send({ kind: 'note', fileName: 'Consultant note.pdf', mediaType: 'application/pdf', data: PDF }), 201).referral;
    r = ok(await desk.post(ref(r, '/messages')).send({ what: 'note' })).referral;
    let draft = await log(p, { reasons: [], otherReason: 'Anaemia', question: 'Second opinion on anaemia' });
    draft = ok(await drA.put(ref(draft, '/note')).send({ rev: 0, findings: 'DRAFT-NOTE-TEXT' })).referral;
    const mistaken = await log(p, { question: 'CANCELLED-QUESTION-TEXT' });
    ok(await desk.post(ref(mistaken, '/cancel')).send({ reason: 'REF-CANCEL-REASON wrong patient' }));
    await log(other, { question: 'OTHER-PATIENT-REFERRAL' });

    const copy = await copyOf('drA', p);
    expect(copy.referrals.map((x) => [x.id, x.status])).toEqual([
      [r.id, 'open'],
      [draft.id, 'open'],
      [mistaken.id, 'cancelled'],
    ]);
    const [whole, open, cancelled] = copy.referrals;
    const at = NOW.toISOString();
    expect(whole).toMatchObject({
      referringDoctor: { name: 'Dr Sample Referrer', clinic: 'Sample Clinic' },
      consultantName: 'Sample drA',
      centreName: 'Sutgirni Chowk',
      reasons: [reasonByKey.get('new_pregnancy').label],
      question: 'Please take over her antenatal care',
      sent: { hb: '10.5', medicines: 'Folic acid' },
      note: { status: 'signed', ...words, signed: { byName: 'Sample drA', at, ...SIGNATURE } },
      sharing: [{ answer: 'yes', byName: 'Sample desk', at }],
      messages: [{ what: 'note', fileName: r.releases[0].fileName, byName: 'Sample desk', at }],
      attachments: [{ fileName: 'referral letter.pdf', byName: 'Sample desk', at }],
    });
    expect(open.note).toEqual({ status: 'draft', saved: { byName: 'Sample drA', at } });
    expect(cancelled).toEqual({ id: mistaken.id, number: mistaken.number, receivedAt: at, status: 'cancelled', cancelled: { byName: 'Sample desk', at } });
    const all = JSON.stringify(copy.referrals);
    for (const never of ['DRAFT-NOTE-TEXT', 'CANCELLED-QUESTION-TEXT', 'REF-CANCEL-REASON', 'OTHER-PATIENT-REFERRAL', '+91 00000 11111', doctor.id, r.attachments[0].id, String(people.desk._id)]) {
      expect(all, never).not.toContain(never);
    }
    expect((await copyOf('rmo', p)).referrals).toEqual(copy.referrals);
  });
});

describe('specimens in the copy', () => {
  it('what was sent, the report, the review and when she was told; overdue days; a cancelled specimen without its content', async () => {
    const p = await register({ careType: 'gynaecology' });
    const drA = await as('drA');
    const log = async (body) =>
      ok(
        await drA.post('/api/specimens').send({
          clientRequestId: randomUUID(),
          patientId: p.id,
          kind: 'histopathology',
          specimen: 'Uterus with cervix',
          procedure: 'Abdominal hysterectomy',
          collectedAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
          sentAt: new Date(NOW.getTime() - 2 * DAY + 3600000).toISOString(),
          lab: 'Sample Pathology Lab',
          ...body,
        }),
        201,
      ).specimen;
    const done = await log({});
    ok(await drA.post(`/api/specimens/${done.id}/report`).send({ receivedAt: new Date(NOW.getTime() - DAY).toISOString(), summary: 'Leiomyoma, no malignancy', file: { fileName: 'HPE-report.pdf', mediaType: 'application/pdf', data: PDF } }));
    ok(await drA.post(`/api/specimens/${done.id}/review`).send({ note: 'Discussed', informedAt: NOW.toISOString() }));
    const late = await log({ specimen: 'Endometrial biopsy', collectedAt: new Date(NOW.getTime() - 30 * DAY).toISOString(), sentAt: new Date(NOW.getTime() - 30 * DAY).toISOString() });
    const wrong = await log({ specimen: 'CANCELLED-SPECIMEN-TEXT' });
    ok(await drA.post(`/api/specimens/${wrong.id}/cancel`).send({ reason: 'SPECIMEN-CANCEL-REASON' }));

    const copy = await copyOf('drA', p);
    expect(copy.specimens.map((s) => s.id)).toEqual([late.id, done.id, wrong.id]); // by the day it was sent
    const [overdue, reviewed, cancelled] = copy.specimens;
    expect(overdue).toMatchObject({ status: 'sent', specimen: 'Endometrial biopsy', overdueDays: 30, report: null, review: null });
    expect(reviewed).toMatchObject({
      status: 'reviewed',
      kind: 'histopathology',
      specimen: 'Uterus with cervix',
      procedure: 'Abdominal hysterectomy',
      lab: 'Sample Pathology Lab',
      overdueDays: null,
      report: { summary: 'Leiomyoma, no malignancy', byName: 'Sample drA', file: true },
      review: { note: 'Discussed', informedAt: NOW.toISOString(), byName: 'Sample drA' },
    });
    expect(cancelled).toEqual({ id: wrong.id, serial: wrong.serial, sentAt: cancelled.sentAt, status: 'cancelled', cancelled: { byName: 'Sample drA', at: NOW.toISOString() } });
    const all = JSON.stringify(copy.specimens);
    for (const never of ['CANCELLED-SPECIMEN-TEXT', 'SPECIMEN-CANCEL-REASON', 'HPE-report.pdf']) expect(all, never).not.toContain(never);
  });
});

describe('scores in the copy', () => {
  it('the EPDS answers and the VTE factors in words with the total, band and advice; one entered in error with who and when only', async () => {
    const p = await register();
    const nurse = await as('nurse');
    const add = async (body) => ok(await nurse.post('/api/clinical-scores').send({ clientRequestId: randomUUID(), patientId: p.id, on: '2026-11-06', phase: 'postnatal', ...body }), 201).score;
    const epds = await add({ kind: 'epds', epdsScores: [2, 1, 1, 1, 1, 1, 1, 1, 2, 1] });
    const vte = await add({ kind: 'vte', vteFactors: ['age_over_35'], note: 'Sample note' });
    const wrong = await add({ kind: 'epds', epdsScores: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], note: 'WRONG-SCORE-NOTE' });
    ok(await nurse.post(`/api/clinical-scores/${wrong.id}/cancel`).send({ reason: 'SCORE-ERROR-REASON' }));

    const copy = await copyOf('drA', p);
    const byId = new Map(copy.scores.map((s) => [s.id, s]));
    expect(byId.get(epds.id)).toMatchObject({ kind: 'epds', epdsScores: [2, 1, 1, 1, 1, 1, 1, 1, 2, 1], total: 12, band: 'possible', selfHarm: true, byName: 'Sample nurse' });
    expect(byId.get(vte.id)).toMatchObject({ kind: 'vte', total: vte.total, band: vte.band, note: 'Sample note' });
    expect(byId.get(vte.id).vteFactors.every((f) => !/^[a-z_0-9]+$/.test(f))).toBe(true); // in words, not keys
    expect(byId.get(wrong.id)).toEqual({ id: wrong.id, kind: 'epds', on: '2026-11-06T00:00:00.000Z', enteredInError: { byName: 'Sample nurse', at: NOW.toISOString() } });
    const all = JSON.stringify(copy.scores);
    for (const never of ['WRONG-SCORE-NOTE', 'SCORE-ERROR-REASON']) expect(all, never).not.toContain(never);
  });
});

describe("a baby's screening and follow-up in the copy", () => {
  it('the schedule with what was done; only on a baby’s copy', async () => {
    const mother = await register();
    const baby = await register({ careType: 'newborn', fullName: 'Baby of Parts Mother', ageYears: undefined, newborn: { birthAt: new Date(NOW.getTime() - 40 * DAY).toISOString(), birthWeightGrams: 1400, mother: mother.id } });
    await NewbornFollowUp.create({
      tenantId: hospital._id,
      patientId: baby.id,
      gestationWeeks: 30,
      gestationDays: 2,
      highRisk: true,
      highRiskReasons: ['preterm', 'low_birth_weight'],
      records: [{ kind: 'screen', key: 'hearing', status: 'done', on: new Date(NOW.getTime() - 30 * DAY), result: 'pass', note: 'Both ears', byName: 'Sample nurse', at: NOW }],
    });
    const copy = await copyOf('drA', baby);
    expect(copy.followUp).toMatchObject({ started: true, gestationWeeks: 30, gestationDays: 2, highRisk: true, highRiskReasons: ['preterm', 'low_birth_weight'], needsRop: true });
    const hearing = copy.followUp.screens.find((x) => x.key === 'hearing');
    expect(hearing).toMatchObject({ state: 'done', record: { status: 'done', result: 'pass', note: 'Both ears', byName: 'Sample nurse' } });
    expect(copy.followUp.screens.find((x) => x.key === 'rop')).toMatchObject({ state: 'overdue', record: null });
    expect(copy.followUp.visits.length).toBeGreaterThan(0);
    expect((await copyOf('drA', mother)).followUp).toBeNull();
    // The audit entry stays ids only
    const entries = await AuditLog.find({ action: 'PATIENT_RECORD_COPIED' });
    for (const e of entries) expect(Object.keys(e.details).sort()).toEqual(['access', 'mrn', 'patientId']);
  });
});

describe('the views of the five parts (no database)', () => {
  it('drop what a copy never holds', () => {
    expect(imagingForCopy({ _id: 'o1', status: 'cancelled', study: 'usg_nt', indication: 'X', createdAt: 'a', cancelled: { by: 'u1', byName: 'Dr', at: 'b', reason: 'R' } })).toEqual({ id: 'o1', status: 'cancelled', at: 'a', cancelled: { byName: 'Dr', at: 'b' } });
    const open = imagingForCopy({ _id: 'o2', status: 'ordered', study: 'usg_nt', indication: 'SECRET', report: { findings: 'SECRET' }, ordered: { by: 'u1', byName: 'Dr', at: 'a' } });
    expect(JSON.stringify(open)).not.toMatch(/SECRET|u1/);
    expect(specimenForCopy({ _id: 's1', serial: 4, sentAt: 'a', status: 'cancelled', specimen: 'SECRET', cancelled: { by: 'u1', byName: 'Dr', at: 'b', reason: 'SECRET' } })).toEqual({ id: 's1', serial: 4, sentAt: 'a', status: 'cancelled', cancelled: { byName: 'Dr', at: 'b' } });
    const report = specimenForCopy({ _id: 's2', serial: 5, status: 'reported', report: { summary: 'S', file: { fileId: 'f1', fileName: 'SECRET.pdf' }, by: 'u1', byName: 'Dr', at: 'c' }, createdBy: 'u1', clientRequestId: 'SECRET' });
    expect(JSON.stringify(report)).not.toMatch(/SECRET|u1|f1/);
    expect(report.report.file).toBe(true);
    expect(scoreForCopy({ _id: 'c1', kind: 'vte', on: 'a', cancelled: { by: 'u1', byName: 'N', at: 'b', reason: 'SECRET' }, total: 9, note: 'SECRET' })).toEqual({ id: 'c1', kind: 'vte', on: 'a', enteredInError: { byName: 'N', at: 'b' } });
    expect(JSON.stringify(scoreForCopy({ _id: 'c2', kind: 'epds', on: 'a', epdsScores: [0], total: 0, band: 'unlikely', by: 'u1', byName: 'N', clientRequestId: 'SECRET' }))).not.toMatch(/SECRET|u1/);
    expect(followUpForCopy(null, { screens: [], visits: [], rop: false })).toMatchObject({ started: false, highRisk: false, screens: [], visits: [] });
    expect(referralForCopy({ id: 'r1', number: 'REF-000001', receivedAt: 'a', status: 'cancelled', cancelled: { byName: 'D', at: 'k', reason: 'SECRET' } })).toEqual({ id: 'r1', number: 'REF-000001', receivedAt: 'a', status: 'cancelled', cancelled: { byName: 'D', at: 'k' } });
  });
});
