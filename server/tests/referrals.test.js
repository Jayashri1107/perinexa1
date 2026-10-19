// Referrals from other doctors (docs/REFERRALS_PLAN.md): the referral desk logs a referral, books her, links her record;
// her first visit is found by itself; her Yes or No; the consultant note started from that visit (never its private
// note), signed by a doctor, released as a PDF and marked sent by the desk; the promises and their clocks; who may do
// what; the weekly review; the quarterly summary; and an audit log with ids only. Also the review's fixes: when she
// counts as seen, closing and cancelling, the clocks fixed once anything happened, the due times stored, booking
// again, the reply, linking, and what the desk and the summary show. All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ClinicalDocument } from '../src/models/ClinicalDocument.js';
import { Referral } from '../src/models/Referral.js';
import { StoredFile } from '../src/models/StoredFile.js';
import { promisesFor } from '../src/referrals/clocks.js';
import { waitingOf } from '../src/referrals/referralService.js';
import { referralSettingsFor } from '../src/referrals/settings.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-19T04:30:00Z'); // Monday 19 Oct 2026, 10:00 in the hospital (India)
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ROLES = {
  desk: 'referral_desk',
  drA: 'doctor',
  drB: 'doctor',
  rmo: 'rmo',
  nurse: 'nurse',
  reception: 'receptionist',
  lab: 'lab',
  pharmacist: 'pharmacist',
  admin: 'admin',
};
const WEEKDAYS = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '13:00' }, { from: '17:00', to: '20:00' }] }));
const PDF = Buffer.from('%PDF-1.4\n% fake sample consultant note\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').toString('base64');
const FOLIC = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days' };
// What the audit log may say about a referral (utils/auditDetails.js)
const AUDIT_KEYS = ['patientId', 'mrn', 'referralId', 'what', 'kind', 'answer', 'promise', 'fileId', 'referringDoctorId', 'quarter', 'fields'];

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
  app = createApp({ apiRateLimitMax: 10_000 }); // the clock is frozen: the per-minute limit would never reset
  hospital = await createTenant('Referral Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}`, professional: { qualification: 'MBBS, MS (OBGY)', registrationNumber: 'SAMPLE-123', council: 'Sample Council' } });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
  const timings = await (await as('drA')).put(`/api/appointments/timings/${id('drA')}`).send({ week: WEEKDAYS, leave: [] });
  expect(timings.status, JSON.stringify(timings.body)).toBe(200);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const id = (who) => people[who]._id.toString();
const later = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {}; // hours later: log in again
};
const api = (path = '') => `/api/referrals${path}`;
const get = async (who, r) => (await as(who)).get(api(`/${r.id}`));
const promise = (r, key) => r.promises.find((p) => p.key === key);

async function referringDoctor(name = 'Dr Sample Referrer', who = 'desk') {
  const res = await (await as(who)).post('/api/referring-doctors').send({ name, clinic: 'Sample Clinic', area: 'Sample Nagar', phone: '+91 00000 11111' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.doctor;
}
const logReferral = async (who, body) =>
  (await as(who)).post(api()).send({ clientRequestId: randomUUID(), via: 'whatsapp', urgency: 'routine', centre: 'sutgirni', reasons: ['new_pregnancy'], ...body });
async function register(who, overrides = {}) {
  const res = await (await as(who)).post('/api/patients').send(samplePatient({ careType: 'antenatal', assignedDoctor: id('drA'), ...overrides }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
/** A stay in hospital, written straight into the database (the inpatient pages are tested elsewhere). */
const stay = (p, extra = {}) =>
  Admission.create({ tenantId: hospital._id, patientId: p.id, careType: 'antenatal', admittedAt: new Date(), admittedBy: people.rmo._id, admittedByName: 'Sample rmo', clientRequestId: randomUUID(), ...extra });
/** Her discharge card of a stay, confirmed by Dr A. */
const dischargeCard = (p, s, dischargedAt) =>
  ClinicalDocument.create({
    tenantId: hospital._id,
    patientId: p.id,
    admissionId: s._id,
    kind: 'discharge',
    status: 'signed',
    content: { dischargedAt },
    createdBy: people.drA._id,
    createdByName: 'Sample drA',
    signed: { by: people.drA._id, byName: 'Sample drA', role: 'doctor', at: dischargedAt },
    clientRequestId: randomUUID(),
  });
const summaryOf = async (who, doctor) => (await as(who)).get(`/api/referring-doctors/${doctor.id}/summary?quarter=2026-Q4`);
/** A visit by a doctor: started, then its parts saved. */
async function visit(p, who = 'drA', { vitals, details, items } = {}) {
  const s = await as(who);
  const created = await s.post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const v = created.body.visit;
  const url = `/api/patients/${p.id}/visits/${v.id}`;
  if (vitals) expect((await s.patch(url).send({ vitals: { rev: 0, ...vitals } })).status).toBe(200);
  if (details) expect((await s.patch(url).send({ details: { rev: 0, ...details } })).status).toBe(200);
  if (items) expect((await s.put(`${url}/prescription`).send({ rev: 0, items })).status).toBe(200);
  return v;
}

describe('a referral from logging to the consultant note', () => {
  it('the desk logs her as a guest, books her, links her record; her first visit starts the note; with her Yes the note goes out on time', async () => {
    const settings = await (await as('admin')).put('/api/tenant/settings/referrals').send({ deskNumber: '+91 00000 22222', consultantLines: [{ userId: id('drA'), phone: '+91 00000 66666', note: '' }] });
    expect(settings.status, JSON.stringify(settings.body)).toBe(200);
    const doctor = await referringDoctor();
    let desk = await as('desk');

    // The forms' lists
    const forms = (await desk.get(api('/settings-view'))).body;
    expect(forms.centres.map((c) => c.key)).toEqual(['sutgirni', 'adalat']);
    expect(forms.deskNumber).toBe('+91 00000 22222');
    expect(forms.consultantLines).toEqual([{ userId: id('drA'), name: 'Sample drA', phone: '+91 00000 66666', note: '' }]);
    expect(forms.reasons.find((r) => r.key === 'vaginal_bleeding')).toMatchObject({ group: 'urgent' });
    expect(forms.doctors.map((d) => d.name)).toEqual(['Sample drA', 'Sample drB']);

    // Logged before she is registered: her name, phone and age as the doctor sent them
    const guest = { name: 'Referred Mother', phone: '+91 00000 33333', ageYears: 27 };
    expect((await logReferral('desk', { referringDoctorId: doctor.id, guest, reasons: [], otherReason: '' })).status).toBe(400); // no reason
    expect((await logReferral('desk', { referringDoctorId: doctor.id, guest, centre: 'nowhere' })).status).toBe(400);
    expect((await logReferral('desk', { referringDoctorId: doctor.id, guest, question: 'Is it a boy' })).status).toBe(400); // the baby's sex
    const created = await logReferral('desk', { referringDoctorId: doctor.id, guest, question: 'Please book antenatal care', sent: { bp: '110/70', hb: '10.5' } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    let r = created.body.referral;
    expect(r).toMatchObject({ number: 'REF-000001', status: 'open', centreName: 'Sutgirni Chowk', patient: null, guest, appointment: null, replyText: null });
    expect(promise(r, 'reply')).toMatchObject({ state: 'waiting', due: '2026-10-19T06:30:00.000Z' }); // 12:00, two working hours
    expect(promise(r, 'seen')).toMatchObject({ state: 'waiting', due: '2026-10-21T04:30:00.000Z' }); // routine: 48 hours
    expect(r.waiting).toEqual({ reply: true, note: false, release: false, send: false });
    expect(r.access).toMatchObject({ canEdit: true, canBook: true, canLink: true, canWriteNote: false, canSignNote: false, canReview: false });
    // The reply is not marked sent before she is booked
    const notBooked = await desk.post(api(`/${r.id}/messages`)).send({ what: 'reply' });
    expect(notBooked.status).toBe(400);
    expect(notBooked.body.error.code).toBe('NOT_BOOKED');

    // A change needs the version seen
    expect((await desk.put(api(`/${r.id}`)).send({ rev: 5, question: 'Changed' })).status).toBe(409);
    r = (await desk.put(api(`/${r.id}`)).send({ rev: r.rev, urgency: 'routine', sent: { lmpEdd: 'LMP 1 Sep 2026' } })).body.referral;
    expect(r.sent).toMatchObject({ bp: '110/70', hb: '10.5', lmpEdd: 'LMP 1 Sep 2026' });

    // The doctor's note, attached before she is registered
    const attached = await desk.post(api(`/${r.id}/attachments`)).send({ fileName: 'doctor note.pdf', mediaType: 'application/pdf', data: PDF });
    expect(attached.status, JSON.stringify(attached.body)).toBe(201);
    r = attached.body.referral;
    expect(r.attachments).toEqual([expect.objectContaining({ fileName: 'doctor note.pdf', mediaType: 'application/pdf', byName: 'Sample desk' })]);
    expect((await StoredFile.findOne({ tenantId: hospital._id, _id: r.attachments[0].id }).lean()).patientId).toBeNull();

    // Booked with Dr A: the consultant, and the reply is ready
    const booked = await desk.post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-20', start: '10:30' });
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);
    r = booked.body.referral;
    expect(r.appointment).toMatchObject({ date: '2026-10-20', start: '10:30', doctorName: 'Sample drA', status: 'booked' });
    expect(r.consultant).toEqual({ id: id('drA'), name: 'Sample drA', directLine: '+91 00000 66666' });
    expect(r.replyText).toContain('Dear Dr Sample Referrer,');
    expect(r.replyText).toContain('Referred (27 years)');
    expect(r.replyText).toContain('Tue 20 Oct 2026 at 10:30 AM with Sample drA, Sutgirni Chowk');
    expect(r.replyText).toContain('REF-000001');
    expect(r.replyText).toContain('+91 00000 22222');
    for (const clinical of ['antenatal', '110/70', '10.5', 'LMP']) expect(r.replyText).not.toContain(clinical);
    // The reply is ready to send (it is `reply`; `send` is only for released notes and discharge cards)
    expect(r.waiting).toMatchObject({ reply: true, send: false });
    expect((await desk.post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-20', start: '11:00' })).body.error.code).toBe('HAS_APPOINTMENT');

    // The desk sends it from its own WhatsApp and marks it sent: promise 1 kept
    r = (await desk.post(api(`/${r.id}/messages`)).send({ what: 'reply' })).body.referral;
    expect(promise(r, 'reply')).toMatchObject({ state: 'met', doneAt: NOW.toISOString() });
    expect(r.messages).toEqual([{ what: 'reply', releaseFileId: null, byName: 'Sample desk', at: NOW.toISOString() }]);

    // She is registered by the desk and linked: her booking and the attached file join her record
    const p = await register('desk', { fullName: 'Referred Mother', ageYears: 27, phone: '+91 00000 33333' });
    r = (await desk.post(api(`/${r.id}/link`)).send({ patientId: p.id })).body.referral;
    expect(r.patient).toMatchObject({ id: p.id, fullName: 'Referred Mother', mrn: p.mrn, ageYears: 27 });
    expect(r.guest).toBeNull();
    expect(String((await Appointment.findOne({ tenantId: hospital._id, _id: r.appointment.id }).lean()).patientId)).toBe(p.id);
    expect(String((await StoredFile.findOne({ tenantId: hospital._id, _id: r.attachments[0].id }).lean()).patientId)).toBe(p.id);

    // Next morning she arrives and Dr A sees her: her first visit is found by itself
    later('2026-10-20T05:10:00Z'); // Tuesday 10:40
    desk = await as('desk');
    await (await as('reception')).post('/api/arrivals').send({ patientId: p.id, doctorId: id('drA') });
    const v = await visit(p, 'drA', {
      vitals: { bpSystolic: 110, bpDiastolic: 70, weightKg: 58 },
      details: { complaints: 'Mild nausea', examination: 'Well, no pallor', diagnosis: 'Early pregnancy, doing well', advice: 'Rest well', privateNote: 'Private words not to share', nextVisitOn: '2026-11-17' },
      items: [FOLIC],
    });
    r = (await get('desk', r)).body.referral;
    expect(r.firstSeen).toEqual({ at: '2026-10-20T05:10:00.000Z', onAdmission: false });
    expect(promise(r, 'seen').state).toBe('met');
    expect(promise(r, 'note')).toMatchObject({ state: 'waiting', due: '2026-10-21T05:10:00.000Z' });
    expect(r.waiting).toMatchObject({ note: true });
    // The desk never gets what was written at the visit
    for (const words of ['Mild nausea', 'Private words', 'Early pregnancy', 'Folic']) expect(JSON.stringify(r)).not.toContain(words);
    expect((await (await as('drA')).get(api('/worklist'))).body).toMatchObject({ notesToWrite: 1, toRelease: 0, replies: 0, toSend: 0 });

    // Her Yes, asked at her first visit
    r = (await desk.post(api(`/${r.id}/sharing`)).send({ answer: 'yes' })).body.referral;
    expect(r.sharing).toMatchObject({ answer: 'yes', byName: 'Sample desk' });

    // The RMO starts the note from her first visit – never its private note
    const rmo = await as('rmo');
    const started = await rmo.post(api(`/${r.id}/note/from-visit`)).send({});
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.left).toEqual([]);
    expect(started.body.filled).toEqual(expect.arrayContaining(['questionRestated', 'findings', 'diagnosis', 'plan', 'nextAtAnandi']));
    r = started.body.referral;
    expect(r.note).toMatchObject({ status: 'draft', fromVisitId: v.id, diagnosis: 'Early pregnancy, doing well', questionRestated: 'Please book antenatal care', nextAtAnandi: '17 Nov 2026' });
    expect(r.note.findings).toContain('Complaints: Mild nausea');
    expect(r.note.findings).toContain('BP 110/70 mmHg');
    expect(r.note.plan).toContain('Advice: Rest well');
    expect(r.note.plan).toContain('Folic acid 5 mg');
    expect(JSON.stringify(r)).not.toContain('Private words');

    // Signed by a doctor only, and only with "returns to you for" filled in
    const drA = await as('drA');
    const early = await drA.post(api(`/${r.id}/note/sign`)).send({ rev: r.note.rev });
    expect(early.status).toBe(400);
    expect(early.body.error.fields).toHaveProperty('returnsToYouFor');
    expect((await rmo.put(api(`/${r.id}/note`)).send({ rev: r.note.rev, needFromYou: 'A boy or girl' })).status).toBe(400); // the baby's sex
    r = (await rmo.put(api(`/${r.id}/note`)).send({ rev: r.note.rev, returnsToYouFor: 'Routine antenatal care till 28 weeks', needFromYou: 'Repeat Hb in 4 weeks' })).body.referral;
    expect((await rmo.post(api(`/${r.id}/note/sign`)).send({ rev: r.note.rev })).status).toBe(403); // an RMO writes it, a doctor signs it
    expect((await desk.put(api(`/${r.id}/note`)).send({ rev: r.note.rev, plan: 'x' })).status).toBe(403);
    expect((await (await as('drB')).post(api(`/${r.id}/note/sign`)).send({ rev: r.note.rev })).status).toBe(403); // not her doctor
    const signed = await drA.post(api(`/${r.id}/note/sign`)).send({ rev: r.note.rev });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    r = signed.body.referral;
    expect(r.note).toMatchObject({ status: 'signed', signed: { byName: 'Sample drA', qualification: 'MBBS, MS (OBGY)', registrationNumber: 'SAMPLE-123' } });
    // Signed: no more changes, only a correction or addition below it
    expect(r.access).toMatchObject({ canWriteNote: false, canSignNote: false, canAddToNote: true });
    expect((await drA.put(api(`/${r.id}/note`)).send({ rev: r.note.rev, plan: 'Changed' })).body.error.code).toBe('SIGNED');
    expect((await (await as('drA')).get(api('/worklist'))).body).toMatchObject({ notesToWrite: 0, toRelease: 1 });

    // The desk sees that it is signed, not what it says
    const deskView = (await get('desk', r)).body.referral;
    expect(deskView.note).toMatchObject({ status: 'signed', findings: null, diagnosis: null, plan: null, returnsToYouFor: null, fromVisitId: null });
    expect(deskView.access).toMatchObject({ canWriteNote: false, canSignNote: false, canAddToNote: false, canRelease: false, canMarkSent: true });

    // Released as a PDF by her doctor (the desk cannot), then sent by the desk
    expect((await desk.post(api(`/${r.id}/messages`)).send({ what: 'note' })).body.error.code).toBe('NOT_RELEASED');
    const release = (who) => as(who).then((s) => s.post(api(`/${r.id}/releases`)).send({ kind: 'note', fileName: 'Consultant note.pdf', mediaType: 'application/pdf', data: PDF }));
    expect((await release('desk')).status).toBe(403);
    expect((await (await as('drA')).post(api(`/${r.id}/releases`)).send({ kind: 'note', fileName: 'x.png', mediaType: 'image/png', data: PDF })).status).toBe(400); // a PDF only
    const first = (await release('drA')).body.referral;
    const second = await release('drA');
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    r = second.body.referral;
    expect(r.releases.map((x) => [x.kind, x.superseded])).toEqual([
      ['note', true],
      ['note', false],
    ]);
    const old = first.releases[0].id;
    const current = r.releases[1].id;
    expect((await desk.post(api(`/${r.id}/messages`)).send({ what: 'note', releaseFileId: old })).body.error.code).toBe('SUPERSEDED');
    const opened = await desk.get(api(`/${r.id}/releases/${current}`)).buffer(true);
    expect(opened.status).toBe(200);
    expect(opened.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(opened.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await (await as('nurse')).get(api(`/${r.id}/releases/${current}`))).status).toBe(403);
    expect((await (await as('drA')).get(api('/worklist'))).body.toRelease).toBe(0);
    expect((await desk.get(api('/worklist'))).body).toMatchObject({ replies: 0, late: 0, toSend: 1, notesToWrite: 0 });
    r = (await desk.post(api(`/${r.id}/messages`)).send({ what: 'note', releaseFileId: current })).body.referral;

    // Every promise kept; nothing waiting
    expect(Object.fromEntries(r.promises.map((x) => [x.key, x.state]))).toEqual({ reply: 'met', seen: 'met', note: 'met', discharge: 'not_needed' });
    expect(r.next).toBeNull();
    expect(r.waiting).toEqual({ reply: false, note: false, release: false, send: false });
    expect(r.messages.map((m) => [m.what, m.releaseFileId])).toEqual([
      ['reply', null],
      ['note', current],
    ]);
    expect((await desk.get(api('/worklist'))).body).toMatchObject({ replies: 0, late: 0, toSend: 0 });

    // Closed with a reason
    r = (await desk.post(api(`/${r.id}/close`)).send({ reason: 'Seen and the note sent' })).body.referral;
    expect(r).toMatchObject({ status: 'closed', closed: { byName: 'Sample desk', reason: 'Seen and the note sent' } });
    expect((await desk.get(api())).body.referrals).toEqual([]);
    expect((await desk.get(api('?list=closed'))).body.referrals.map((x) => x.number)).toEqual(['REF-000001']);
    expect((await (await as('drA')).get(api(`?patientId=${p.id}&list=all`))).body.referrals.map((x) => x.number)).toEqual(['REF-000001']);

    // The audit log: ids and plain words only – never a name, a phone number or what was written
    const entries = await AuditLog.find({ action: /^REFERR/ }).lean();
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'REFERRING_DOCTOR_ADDED',
        'REFERRAL_CREATED',
        'REFERRAL_UPDATED',
        'REFERRAL_ATTACHMENT_ADDED',
        'REFERRAL_BOOKED',
        'REFERRAL_MESSAGE_SENT',
        'REFERRAL_LINKED',
        'REFERRAL_VIEWED',
        'REFERRAL_SHARING_ANSWERED',
        'REFERRAL_NOTE_SAVED',
        'REFERRAL_NOTE_SIGNED',
        'REFERRAL_PDF_RELEASED',
        'REFERRAL_PDF_OPENED',
        'REFERRAL_CLOSED',
      ]),
    );
    for (const e of entries) for (const key of Object.keys(e.details ?? {})) expect(AUDIT_KEYS, `${e.action}: ${key}`).toContain(key);
    const details = JSON.stringify(entries.map((e) => e.details));
    for (const words of ['Referred Mother', '00000 33333', 'Sample Referrer', 'Please book', 'Mild nausea', 'Routine antenatal', 'Seen and the note sent']) expect(details).not.toContain(words);
    expect(entries.find((e) => e.action === 'REFERRAL_SHARING_ANSWERED').details).toEqual({ referralId: r.id, patientId: p.id, mrn: p.mrn, answer: 'yes' });
  });

  it("her No: the note is written and signed, but never released or sent – and it is never a missed promise", async () => {
    const doctor = await referringDoctor();
    const p = await register('reception', { fullName: 'Declining Mother' });
    const desk = await as('desk');
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id })).body.referral;
    await visit(p, 'drA', { details: { complaints: 'Back pain', diagnosis: 'Normal pregnancy' } });
    r = (await desk.post(api(`/${r.id}/sharing`)).send({ answer: 'no' })).body.referral;
    const drA = await as('drA');
    r = (await drA.put(api(`/${r.id}/note`)).send({ rev: 0, findings: 'Back pain, examination normal', diagnosis: 'Normal pregnancy', plan: 'Rest', returnsToYouFor: 'Routine care' })).body.referral;
    r = (await drA.post(api(`/${r.id}/note/sign`)).send({ rev: r.note.rev })).body.referral;
    expect(r.note.status).toBe('signed');
    expect(promise(r, 'note')).toMatchObject({ state: 'no_consent' });
    expect(r.access.canRelease).toBe(false);
    expect(r.waiting).toMatchObject({ note: false, release: false });
    expect((await drA.post(api(`/${r.id}/releases`)).send({ kind: 'note', fileName: 'note.pdf', mediaType: 'application/pdf', data: PDF })).body.error.code).toBe('NO_CONSENT');
    expect((await desk.post(api(`/${r.id}/messages`)).send({ what: 'note' })).body.error.code).toBe('NO_CONSENT');
    // Not answered yet: the note is not sent either
    const other = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id })).body.referral;
    expect((await desk.post(api(`/${other.id}/messages`)).send({ what: 'note' })).body.error.code).toBe('NO_CONSENT');

    later('2026-10-22T06:00:00Z'); // three days on
    r = (await get('desk', r)).body.referral;
    expect(promise(r, 'note').state).toBe('no_consent');
    // The reply was never marked sent: that is the miss on the review – the note is not
    const review = (await (await as('drA')).get(api('/review?week=2026-10-19'))).body.items;
    expect(review.filter((i) => i.referral.id === r.id).map((i) => [i.promise, i.state])).toEqual([['reply', 'late']]);
  });
});

describe('who may do what', () => {
  it('nurses, reception, the lab, the pharmacist and the hospital admin have nothing in Referrals', async () => {
    const doctor = await referringDoctor();
    const r = (await logReferral('desk', { referringDoctorId: doctor.id, guest: { name: 'Guest Mother', phone: '+91 00000 44444' } })).body.referral;
    for (const who of ['nurse', 'reception', 'lab', 'pharmacist', 'admin']) {
      const s = await as(who);
      expect((await s.get(api())).status, who).toBe(403);
      expect((await s.get(api(`/${r.id}`))).status, who).toBe(403);
      expect((await s.get(api('/settings-view'))).status, who).toBe(403);
      expect((await logReferral(who, { referringDoctorId: doctor.id, guest: { name: 'Guest Mother' } })).status, who).toBe(403);
      expect((await s.get('/api/referring-doctors')).status, who).toBe(403);
      expect((await s.post('/api/referring-doctors').send({ name: 'Dr Sample Other' })).status, who).toBe(403);
    }
    // Before she is linked any doctor or RMO may open it
    for (const who of ['desk', 'drA', 'drB', 'rmo']) expect((await get(who, r)).status, who).toBe(200);
  });

  it("another doctor cannot open a referral of a sensitive record of someone else's patient", async () => {
    const doctor = await referringDoctor();
    const p = await register('drA', { careType: 'infertility', fullName: 'Private Mother', medical: { allergies: 'None known', bloodGroup: 'A+' } });
    expect(p.sensitive).toBe(true);
    const created = await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id, reasons: ['infertility'] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const r = created.body.referral;
    expect((await get('drB', r)).status).toBe(403);
    for (const who of ['drA', 'rmo', 'desk']) expect((await get(who, r)).status, who).toBe(200);
    expect((await (await as('drB')).get(api('?list=all'))).body.referrals.map((x) => x.id)).not.toContain(r.id);
    expect((await (await as('drA')).get(api('?list=all'))).body.referrals.map((x) => x.id)).toContain(r.id);
    expect((await logReferral('drB', { referringDoctorId: doctor.id, patientId: p.id, reasons: ['infertility'] })).status).toBe(403);
    // A referral not yet linked cannot be linked to her record by that doctor either
    const loose = (await logReferral('drB', { referringDoctorId: doctor.id, guest: { name: 'Private Mother' }, reasons: ['infertility'] })).body.referral;
    expect((await (await as('drB')).post(api(`/${loose.id}/link`)).send({ patientId: p.id })).status).toBe(403);
    expect((await (await as('desk')).post(api(`/${loose.id}/link`)).send({ patientId: p.id })).status).toBe(200);
    expect((await get('drB', loose)).status).toBe(403);
    // The quarterly summary: counted, but for that doctor only the number and the date – no reason, answer or clock
    const theirs = (await summaryOf('drB', doctor)).body;
    expect(theirs.counts.received).toBe(2);
    expect(theirs.referrals).toHaveLength(2);
    for (const row of theirs.referrals) expect(Object.keys(row).sort()).toEqual(['hidden', 'number', 'receivedAt']);
    expect(theirs.referrals.every((row) => row.hidden === true)).toBe(true);
    expect(theirs.referrals.map((row) => row.number).sort()).toEqual([r.number, loose.number].sort());
    expect(JSON.stringify(theirs.referrals)).not.toMatch(/infertility/i);
    const hers = (await summaryOf('drA', doctor)).body.referrals;
    expect(hers.find((row) => row.number === r.number)).toMatchObject({ hidden: false, reasonLabels: [expect.stringMatching(/infertility/i)] });
  });
});

describe('the weekly review', () => {
  it('lists a late reply; doctors and RMOs write what went wrong and what changed', async () => {
    const doctor = await referringDoctor();
    const r0 = (await logReferral('desk', { referringDoctorId: doctor.id, guest: { name: 'Waiting Mother', phone: '+91 00000 55555' } })).body.referral;
    later('2026-10-19T06:15:00Z'); // 11:45 – a quarter of an hour left
    expect(promise((await get('desk', r0)).body.referral, 'reply').state).toBe('soon');
    later('2026-10-19T08:00:00Z'); // 13:30
    let r = (await get('desk', r0)).body.referral;
    expect(promise(r, 'reply').state).toBe('late');
    expect(r.next).toMatchObject({ key: 'reply', state: 'late' });
    expect((await (await as('desk')).get(api('/worklist'))).body).toEqual({ replies: 1, late: 1, toSend: 0, notesToWrite: 0, toRelease: 0 });
    expect((await (await as('drA')).get(api('/worklist'))).body).toEqual({ replies: 0, late: 0, toSend: 0, notesToWrite: 0, toRelease: 0 });
    expect((await (await as('desk')).get(api('?list=late'))).body.referrals.map((x) => x.id)).toEqual([r.id]);

    const week = (await (await as('desk')).get(api('/review?week=2026-10-21'))).body;
    expect(week.week).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(week.items.map((i) => [i.referral.number, i.promise, i.state])).toEqual([[r.number, 'reply', 'late']]);
    expect((await (await as('desk')).get(api('/review?week=2026-10-12'))).body.items).toEqual([]);

    // The desk reads the review; the consultants write it, about a promise that was missed
    expect((await (await as('desk')).post(api(`/${r.id}/reviews`)).send({ promise: 'reply', wentWrong: 'The phone was off' })).status).toBe(403);
    expect((await (await as('drA')).post(api(`/${r.id}/reviews`)).send({ promise: 'seen', wentWrong: 'Not missed', changed: 'Nothing' })).body.error.code).toBe('NOT_MISSED');
    // Both halves are written: what went wrong and what changed
    expect((await (await as('drA')).post(api(`/${r.id}/reviews`)).send({ promise: 'reply', wentWrong: 'The desk phone was off' })).status).toBe(400);
    const blank = await (await as('drA')).post(api(`/${r.id}/reviews`)).send({ promise: 'reply', wentWrong: 'The desk phone was off', changed: 'x' });
    expect(blank.status).toBe(400);
    expect(blank.body.error.fields).toHaveProperty('changed');
    const added = await (await as('drA')).post(api(`/${r.id}/reviews`)).send({ promise: 'reply', wentWrong: 'The desk phone was off', changed: 'A second phone at the desk' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const item = (await (await as('rmo')).get(api('/review?week=2026-10-19'))).body.items[0];
    expect(item.reviews).toEqual([expect.objectContaining({ promise: 'reply', wentWrong: 'The desk phone was off', changed: 'A second phone at the desk', byName: 'Sample drA' })]);
    expect(item.canReview).toBe(true);

    // Booked and replied late: met late – still a miss on the review
    r = (await (await as('desk')).post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-20', start: '10:30' })).body.referral;
    r = (await (await as('desk')).post(api(`/${r.id}/messages`)).send({ what: 'reply' })).body.referral;
    expect(promise(r, 'reply').state).toBe('met_late');
    expect((await (await as('desk')).get(api('/review?week=2026-10-19'))).body.items.map((i) => [i.promise, i.state])).toEqual([['reply', 'met_late']]);
    const audit = await AuditLog.findOne({ action: 'REFERRAL_REVIEW_ADDED' }).lean();
    expect(audit.details).toEqual({ referralId: r.id, promise: 'reply' });
  });
});

describe('referring doctors and their quarterly summary', () => {
  it('the desk, doctors and RMOs keep the list; a doctor is made inactive, never deleted', async () => {
    const a = await referringDoctor('Dr Sample One');
    expect(a).toMatchObject({ name: 'Dr Sample One', clinic: 'Sample Clinic', isActive: true, referrals: 0, partner: { joined: false } });
    const b = (await (await as('rmo')).post('/api/referring-doctors').send({ name: 'Dr Sample Two', area: 'Other Area', partner: { joined: true, quarterlySummary: true } })).body.doctor;
    expect(b.partner).toEqual({ joined: true, caseOfMonth: false, cme: false, quarterlySummary: true });
    expect((await (await as('desk')).post('/api/referring-doctors').send({ name: 'D' })).status).toBe(400);
    expect((await (await as('desk')).post('/api/referring-doctors').send({ name: 'Dr Sample Three', phone: 'call me' })).status).toBe(400);
    expect((await (await as('drA')).get('/api/referring-doctors?search=other')).body.doctors.map((d) => d.name)).toEqual(['Dr Sample Two']);
    await logReferral('desk', { referringDoctorId: a.id, guest: { name: 'Some Mother' } });
    const changed = await (await as('desk')).put(`/api/referring-doctors/${a.id}`).send({ isActive: false });
    expect(changed.body.doctor).toMatchObject({ isActive: false, referrals: 1 });
    expect((await (await as('desk')).get('/api/referring-doctors?active=true')).body.doctors.map((d) => d.name)).toEqual(['Dr Sample Two']);
    expect((await (await as('desk')).get('/api/referring-doctors')).body.doctors.map((d) => d.name)).toEqual(['Dr Sample Two', 'Dr Sample One']);
    // An inactive doctor takes no new referral
    expect((await logReferral('desk', { referringDoctorId: a.id, guest: { name: 'Some Mother' } })).status).toBe(400);
    const entry = await AuditLog.findOne({ action: 'REFERRING_DOCTOR_UPDATED' }).lean();
    expect(entry.details).toEqual({ referringDoctorId: a.id, fields: ['isActive'] });
  });

  it('shows her name and the outcome only when she said Yes', async () => {
    const doctor = await referringDoctor();
    const drA = await as('drA');
    for (const [name, answer, diagnosis, otherReason] of [
      ['Agreeing Mother', 'yes', 'Anaemia in pregnancy', 'Sample shared reason'],
      ['Quiet Mother', 'no', 'Thyroid disorder in pregnancy', 'Sample private reason'],
    ]) {
      const p = await register('reception', { fullName: name });
      const r0 = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id, reasons: ['anaemia_not_responding'], otherReason })).body.referral;
      await visit(p);
      await (await as('desk')).post(api(`/${r0.id}/sharing`)).send({ answer });
      let r = (await drA.put(api(`/${r0.id}/note`)).send({ rev: 0, findings: 'Pale', diagnosis, plan: 'Iron', returnsToYouFor: 'Repeat prescriptions' })).body.referral;
      r = (await drA.post(api(`/${r0.id}/note/sign`)).send({ rev: r.note.rev })).body.referral;
      expect(r.note.status).toBe('signed');
    }
    const res = await (await as('desk')).get(`/api/referring-doctors/${doctor.id}/summary?quarter=2026-Q4`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.quarter).toEqual({ key: '2026-Q4', from: '2026-10-01', to: '2026-12-31' });
    expect(res.body.counts).toMatchObject({ received: 2, seen: 2, notesSent: 0, returned: 2 });
    const yes = res.body.referrals.find((x) => x.sharing === 'yes');
    const no = res.body.referrals.find((x) => x.sharing === null);
    expect(yes).toMatchObject({ hidden: false, patient: { fullName: 'Agreeing Mother', ageYears: 30 }, outcome: 'Anaemia in pregnancy', returnsToYouFor: 'Repeat prescriptions' });
    expect(yes.reasonLabels).toEqual(['Hb 7–9 g/dL not responding to oral iron', 'Sample shared reason']);
    expect(yes.promises.map((x) => x.key)).toEqual(['reply', 'seen', 'note', 'discharge']);
    // Without her Yes: the reasons from the list, the reply and seen promises – not her answer, not the note or
    // discharge promises (whether she stayed in hospital), not the free-text reason
    expect(no).toMatchObject({ hidden: false, patient: null, outcome: null, returnsToYouFor: null, sharing: null, reasonLabels: ['Hb 7–9 g/dL not responding to oral iron'] });
    expect(no.promises.map((x) => x.key)).toEqual(['reply', 'seen']);
    for (const words of ['Quiet Mother', 'Thyroid', 'Sample private reason', '"no"']) expect(JSON.stringify(res.body)).not.toContain(words);
    expect((await (await as('desk')).get(`/api/referring-doctors/${doctor.id}/summary?quarter=2026-Q3`)).body.counts.received).toBe(0);
    const entry = await AuditLog.findOne({ action: 'REFERRAL_SUMMARY_VIEWED' }).lean();
    expect(entry.details).toEqual({ referringDoctorId: doctor.id, quarter: '2026-Q4' });
  });
});

describe('when she counts as seen', () => {
  it('a visit earlier the same day counts (she walked in with the letter); then nothing is left to book', async () => {
    const doctor = await referringDoctor();
    const p = await register('reception', { fullName: 'Walk-in Mother' });
    later('2026-10-19T05:00:00Z'); // 10:30: Dr A sees her
    await visit(p);
    later('2026-10-19T06:30:00Z'); // 12:00: the desk logs the referral she brought
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id, via: 'walk_in' })).body.referral;
    expect(r.firstSeen).toEqual({ at: '2026-10-19T05:00:00.000Z', onAdmission: false });
    expect(promise(r, 'seen')).toMatchObject({ state: 'met', doneAt: '2026-10-19T05:00:00.000Z' });
    expect(promise(r, 'note')).toMatchObject({ state: 'waiting', due: '2026-10-20T05:00:00.000Z' });
    expect(r.waiting).toMatchObject({ note: true });
    // Seen already: no booking (her next visits are booked on the Appointments page)
    expect(r.access.canBook).toBe(false);
    expect((await (await as('desk')).post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-20', start: '10:30' })).body.error.code).toBe('ALREADY_SEEN');
    // A visit of the day before does not count
    later('2026-10-20T06:30:00Z');
    const next = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id })).body.referral;
    expect(next.firstSeen).toBeNull();
  });

  it('the stay she was already in counts (admitted at 22:00, the unit line logged at 22:30); the desk sees only when she was discharged', async () => {
    const doctor = await referringDoctor();
    const p = await register('reception', { fullName: 'Admitted Mother' });
    later('2026-10-19T16:30:00Z'); // 22:00
    const s = await stay(p, { admittedAt: new Date('2026-10-19T16:30:00Z') });
    later('2026-10-19T17:00:00Z'); // 22:30
    let r = (await logReferral('rmo', { referringDoctorId: doctor.id, patientId: p.id, urgency: 'urgent', via: 'call' })).body.referral;
    expect(r.firstSeen).toEqual({ at: '2026-10-19T16:30:00.000Z', onAdmission: true });
    expect(promise(r, 'seen').state).toBe('met');
    expect(promise(r, 'discharge').state).toBe('not_started'); // still in hospital
    // No first visit to start the note from
    expect((await (await as('rmo')).post(api(`/${r.id}/note/from-visit`)).send({})).body.error.code).toBe('NO_VISIT');

    // Discharged the next day with a confirmed card: the discharge clock starts
    later('2026-10-20T06:30:00Z');
    const out = new Date('2026-10-20T06:00:00Z');
    await Admission.updateOne({ tenantId: hospital._id, _id: s._id }, { $set: { status: 'discharged', dischargedAt: out, dischargedByName: 'Sample drA' } });
    const card = await dischargeCard(p, s, out);
    r = (await get('drA', r)).body.referral;
    expect(r.discharge).toEqual({ dischargedAt: out.toISOString(), admissionId: String(s._id), documentId: String(card._id) });
    expect(promise(r, 'discharge')).toMatchObject({ state: 'waiting', due: '2026-10-21T06:00:00.000Z' });
    // The desk: when (for the clock), never which stay or which card
    expect((await get('desk', r)).body.referral.discharge).toEqual({ dischargedAt: out.toISOString() });
  });

  it('a closed referral finds nothing later: a visit after closing is not its first visit', async () => {
    const doctor = await referringDoctor();
    const p = await register('reception', { fullName: 'Elsewhere Mother' });
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id })).body.referral;
    r = (await (await as('desk')).post(api(`/${r.id}/close`)).send({ reason: 'She went to another hospital' })).body.referral;
    later('2026-11-20T05:00:00Z'); // a month on, a visit for something else
    await visit(p);
    r = (await get('drA', r)).body.referral;
    expect(r.firstSeen).toBeNull();
    expect(promise(r, 'note').state).toBe('not_needed');
    expect(r.waiting).toEqual({ reply: false, note: false, release: false, send: false });
    expect((await (await as('drA')).get(api('/worklist'))).body.notesToWrite).toBe(0);
  });
});

describe('closing and cancelling', () => {
  it('once closed, the work on a promise counts only while its clock runs; the reply no longer counts', () => {
    const settings = referralSettingsFor({});
    const now = new Date('2026-10-20T08:00:00Z');
    const r = {
      status: 'closed',
      closed: { at: new Date('2026-10-20T06:00:00Z') },
      urgency: 'routine',
      receivedAt: new Date('2026-10-19T04:30:00Z'),
      patientId: 'sample-patient',
      firstSeen: { at: new Date('2026-10-20T05:00:00Z') },
      discharge: null,
      sharing: { answer: 'yes' },
      note: { status: 'draft' },
      messages: [],
      releases: [],
    };
    const waiting = (x) => waitingOf(x, promisesFor(x, now, settings));
    // Seen, then closed an hour later: the note is still owed (its clock runs); the reply is no longer asked for
    expect(waiting(r)).toEqual({ reply: false, note: true, release: false, send: false });
    // Closed before she was seen: no note is waited for
    expect(waiting({ ...r, firstSeen: null })).toMatchObject({ note: false });
    // The note sent: nothing left
    const sent = { ...r, note: { status: 'signed' }, releases: [{ kind: 'note', fileId: 'f1' }], messages: [{ what: 'note', releaseFileId: 'f1', at: new Date('2026-10-20T07:00:00Z') }] };
    expect(waiting(sent)).toEqual({ reply: false, note: false, release: false, send: false });
    // Signed and released, not yet sent: the desk still has it to send
    expect(waiting({ ...sent, messages: [] })).toMatchObject({ send: true });
    // Her No: no clock runs for the note, so a closed referral asks nothing more of it
    expect(waiting({ ...r, sharing: { answer: 'no' } })).toMatchObject({ note: false });
  });

  it('cancel is only for a referral logged by mistake, before anything happened; after that it is closed', async () => {
    const doctor = await referringDoctor();
    const desk = await as('desk');
    const guest = { name: 'Mistake Mother', phone: '+91 00000 14141' };
    const mistake = (await logReferral('desk', { referringDoctorId: doctor.id, guest })).body.referral;
    const cancelled = await desk.post(api(`/${mistake.id}/cancel`)).send({ reason: 'Logged twice by mistake' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.referral.promises).toEqual([]);
    // A message was sent about it: never cancelled
    const messaged = (await logReferral('desk', { referringDoctorId: doctor.id, guest })).body.referral;
    await desk.post(api(`/${messaged.id}/messages`)).send({ what: 'other' });
    const refused = await desk.post(api(`/${messaged.id}/cancel`)).send({ reason: 'Not needed any more' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('NOT_CANCELLABLE');
    // A promise is late: the same – it is closed, and the miss stays on the weekly review
    const late = (await logReferral('desk', { referringDoctorId: doctor.id, guest })).body.referral;
    later('2026-10-19T08:00:00Z'); // 13:30: its reply is late
    expect((await (await as('desk')).post(api(`/${late.id}/cancel`)).send({ reason: 'Not needed any more' })).body.error.code).toBe('NOT_CANCELLABLE');
    const closed = await (await as('desk')).post(api(`/${late.id}/close`)).send({ reason: 'She went elsewhere' });
    expect(closed.status).toBe(200);
    expect(promise(closed.body.referral, 'reply').state).toBe('late');
    const review = (await (await as('drA')).get(api('/review?week=2026-10-19'))).body.items;
    expect(review.filter((i) => i.referral.id === late.id).map((i) => [i.promise, i.state])).toEqual([['reply', 'late']]);
  });
});

describe('the clocks once something happened', () => {
  it('the time it came and its urgency: corrected before anything happened, then fixed; the due times do not follow later settings', async () => {
    const doctor = await referringDoctor();
    const desk = await as('desk');
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, guest: { name: 'Clock Mother', phone: '+91 00000 12121' } })).body.referral;
    expect(promise(r, 'reply').due).toBe('2026-10-19T06:30:00.000Z'); // 12:00
    // The admin changes the working hours afterwards: the clocks of this referral stay as they were worked out
    const changed = await (await as('admin')).put('/api/tenant/settings/referrals').send({ workingHours: { days: [1, 2, 3, 4, 5, 6], from: '11:00', to: '20:00' } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    r = (await get('desk', r)).body.referral;
    expect(promise(r, 'reply').due).toBe('2026-10-19T06:30:00.000Z');
    // Corrected before anything happened: worked out again (with the settings of now – the day starts at 11:00)
    const corrected = await desk.put(api(`/${r.id}`)).send({ rev: r.rev, receivedAt: '2026-10-19T03:30:00.000Z', urgency: 'urgent' }); // 09:00
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    r = corrected.body.referral;
    expect(promise(r, 'reply').due).toBe('2026-10-19T07:30:00.000Z'); // 13:00
    expect(promise(r, 'seen')).toMatchObject({ label: 'Seen the same day', due: '2026-10-19T18:29:59.000Z' });
    expect((await Referral.findOne({ tenantId: hospital._id, _id: r.id }).lean()).dues).toEqual({ reply: new Date('2026-10-19T07:30:00Z'), seen: new Date('2026-10-19T18:29:59Z') });

    // The reply sent: the time and the urgency are fixed – the other details can still be corrected
    r = (await desk.post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-19', start: '11:00' })).body.referral;
    r = (await desk.post(api(`/${r.id}/messages`)).send({ what: 'reply' })).body.referral;
    for (const change of [{ urgency: 'routine' }, { receivedAt: '2026-10-19T04:00:00.000Z' }]) {
      const res = await desk.put(api(`/${r.id}`)).send({ rev: r.rev, ...change });
      expect(res.status, JSON.stringify(change)).toBe(409);
      expect(res.body.error.code).toBe('FROZEN');
    }
    expect((await desk.put(api(`/${r.id}`)).send({ rev: r.rev, question: 'Please see her today' })).status).toBe(200);

    // A promise late: the same (moving the time on would turn the late reply into one on time)
    const other = (await logReferral('desk', { referringDoctorId: doctor.id, guest: { name: 'Late Mother', phone: '+91 00000 13131' } })).body.referral;
    later('2026-10-19T09:00:00Z'); // 14:30: its reply (due 13:00) is late
    const frozen = await (await as('desk')).put(api(`/${other.id}`)).send({ rev: other.rev, receivedAt: '2026-10-19T08:30:00.000Z' });
    expect(frozen.status).toBe(409);
    expect(frozen.body.error.code).toBe('FROZEN');
  });
});

describe('booking and the reply', () => {
  it('the doctor booked is the consultant; a booking she missed is not quoted and can be made again', async () => {
    expect((await (await as('drB')).put(`/api/appointments/timings/${id('drB')}`).send({ week: WEEKDAYS, leave: [] })).status).toBe(200);
    const doctor = await referringDoctor();
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, guest: { name: 'Missed Mother', phone: '+91 00000 16161' }, consultantId: id('drA') })).body.referral;
    expect(r.consultant.id).toBe(id('drA'));
    // Booked with Dr B: Dr B is her consultant, and the reply names Dr B with the time
    r = (await (await as('desk')).post(api(`/${r.id}/book`)).send({ doctorId: id('drB'), date: '2026-10-20', start: '10:30' })).body.referral;
    expect(r.consultant.id).toBe(id('drB'));
    expect(r.replyText).toContain('Tue 20 Oct 2026 at 10:30 AM with Sample drB, Sutgirni Chowk');

    // She did not come: the reply would quote a day that passed – nothing to send until she is booked again
    later('2026-10-21T04:30:00Z');
    r = (await get('desk', r)).body.referral;
    expect(r.appointment.status).toBe('no_show');
    expect(r.replyText).toBeNull();
    expect(r.access.canBook).toBe(true);
    const noReply = await (await as('desk')).post(api(`/${r.id}/messages`)).send({ what: 'reply' });
    expect(noReply.status).toBe(400);
    expect(noReply.body.error.code).toBe('NOT_BOOKED');
    const again = await (await as('desk')).post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-22', start: '10:30' });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.referral.consultant.id).toBe(id('drA'));
    expect(again.body.referral.replyText).toContain('with Sample drA');
  });

  it('a booking she came to blocks a new one, even after its day', async () => {
    const doctor = await referringDoctor();
    const p = await register('reception', { fullName: 'Arrived Mother' });
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id })).body.referral;
    r = (await (await as('desk')).post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-19', start: '10:30' })).body.referral;
    expect((await (await as('reception')).post('/api/arrivals').send({ patientId: p.id, doctorId: id('drA') })).status).toBeLessThan(300);
    later('2026-10-21T04:30:00Z');
    r = (await get('desk', r)).body.referral;
    expect(r.appointment.status).toBe('arrived');
    expect(r.access.canBook).toBe(false);
    expect((await (await as('desk')).post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-22', start: '10:30' })).body.error.code).toBe('HAS_APPOINTMENT');
  });

  it('the reply is marked sent only when it says by whom: seen without a booking, her consultant is chosen first', async () => {
    const doctor = await referringDoctor();
    const p = await register('reception', { fullName: 'Unbooked Mother' });
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id, via: 'walk_in' })).body.referral;
    await visit(p);
    r = (await get('desk', r)).body.referral;
    expect(r.firstSeen).not.toBeNull();
    expect(r.replyText).toBeNull();
    const refused = await (await as('desk')).post(api(`/${r.id}/messages`)).send({ what: 'reply' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('NO_CONSULTANT');
    r = (await (await as('desk')).put(api(`/${r.id}`)).send({ rev: r.rev, consultantId: id('drA') })).body.referral;
    expect(r.replyText).toContain('Her consultant: Sample drA.');
    r = (await (await as('desk')).post(api(`/${r.id}/messages`)).send({ what: 'reply' })).body.referral;
    expect(promise(r, 'reply').state).toBe('met');
  });
});

describe('linking her record', () => {
  it('the desk links only the record of the woman the doctor named; her doctor or an RMO may link anyway', async () => {
    const doctor = await referringDoctor();
    const desk = await as('desk');
    const guest = { name: 'Named Mother', phone: '+91 00000 15151' };
    const r1 = (await logReferral('desk', { referringDoctorId: doctor.id, guest })).body.referral;
    const other = await register('reception', { fullName: 'Different Woman', phone: '+91 00000 99999' });
    const refused = await desk.post(api(`/${r1.id}/link`)).send({ patientId: other.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('LINK_MISMATCH');
    expect((await get('desk', r1)).body.referral.patient).toBeNull();
    expect((await (await as('drA')).post(api(`/${r1.id}/link`)).send({ patientId: other.id })).status).toBe(200);
    // The same phone written another way, or the same name (case, spaces and dots aside), is enough
    const r2 = (await logReferral('desk', { referringDoctorId: doctor.id, guest })).body.referral;
    const samePhone = await register('reception', { fullName: 'Namita Mother', phone: '0000015151' });
    expect((await desk.post(api(`/${r2.id}/link`)).send({ patientId: samePhone.id })).status).toBe(200);
    const r3 = (await logReferral('desk', { referringDoctorId: doctor.id, guest })).body.referral;
    const sameName = await register('reception', { fullName: 'NAMED. MOTHER', phone: '+91 00000 98989' });
    expect((await desk.post(api(`/${r3.id}/link`)).send({ patientId: sameName.id })).status).toBe(200);
  });

  it('a booking linked to her record on the Appointments page brings the referral and its files to her record at once', async () => {
    const doctor = await referringDoctor();
    const desk = await as('desk');
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, guest: { name: 'Booked Mother', phone: '+91 00000 17171' } })).body.referral;
    expect((await desk.post(api(`/${r.id}/attachments`)).send({ fileName: 'letter.pdf', mediaType: 'application/pdf', data: PDF })).status).toBe(201);
    r = (await desk.post(api(`/${r.id}/book`)).send({ doctorId: id('drA'), date: '2026-10-20', start: '10:30' })).body.referral;
    const p = await register('reception', { fullName: 'Booked Mother', phone: '+91 00000 17171' });
    const linked = await (await as('reception')).post(`/api/appointments/${r.appointment.id}/link`).send({ patientId: p.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    // Before anyone opens the desk list or the referral: it is on her record's Referrals tab
    const stored = await Referral.findOne({ tenantId: hospital._id, _id: r.id }).lean();
    expect(String(stored.patientId)).toBe(p.id);
    expect(stored.guest).toBeNull();
    expect(String((await StoredFile.findOne({ tenantId: hospital._id, _id: r.attachments[0].id }).lean()).patientId)).toBe(p.id);
    expect((await (await as('drA')).get(api(`?patientId=${p.id}&list=all`))).body.referrals.map((x) => x.id)).toEqual([r.id]);
  });
});

describe('the released PDFs and the signed note', () => {
  it('the desk saves a released PDF only after her Yes; her doctor adds a correction below the signed note', async () => {
    const doctor = await referringDoctor();
    const p = await register('reception', { fullName: 'Asked Mother' });
    let r = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id })).body.referral;
    await visit(p);
    const drA = await as('drA');
    r = (await drA.put(api(`/${r.id}/note`)).send({ rev: 0, findings: 'Well', diagnosis: 'Normal pregnancy', plan: 'Routine care', returnsToYouFor: 'Routine antenatal care' })).body.referral;
    r = (await drA.post(api(`/${r.id}/note/sign`)).send({ rev: r.note.rev })).body.referral;
    expect(r.access.canAddToNote).toBe(true);
    const released = await drA.post(api(`/${r.id}/releases`)).send({ kind: 'note', fileName: 'note.pdf', mediaType: 'application/pdf', data: PDF });
    expect(released.status, JSON.stringify(released.body)).toBe(201);
    const file = released.body.referral.releases[0].id;
    const desk = await as('desk');
    // Not asked yet: her doctor opens it, the desk does not
    expect((await desk.get(api(`/${r.id}/releases/${file}`))).status).toBe(403);
    expect((await drA.get(api(`/${r.id}/releases/${file}`)).buffer(true)).status).toBe(200);
    await desk.post(api(`/${r.id}/sharing`)).send({ answer: 'yes' });
    expect((await desk.get(api(`/${r.id}/releases/${file}`)).buffer(true)).status).toBe(200);
    // A correction below the signed note
    const added = await drA.post(api(`/${r.id}/note/additions`)).send({ text: 'Hb to be repeated in 2 weeks' });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.referral.note.additions).toEqual([expect.objectContaining({ text: 'Hb to be repeated in 2 weeks', byName: 'Sample drA' })]);
  });
});

describe('an old open referral', () => {
  it('a discharge summary due months after the referral is on Today and in the weekly review', async () => {
    const doctor = await referringDoctor();
    const p = await register('reception', { fullName: 'Antenatal Mother' });
    const r = (await logReferral('desk', { referringDoctorId: doctor.id, patientId: p.id })).body.referral;
    await (await as('desk')).post(api(`/${r.id}/sharing`)).send({ answer: 'yes' });
    // It came 160 days ago (written straight into the database: the website takes at most 7 days back)
    const received = new Date(NOW.getTime() - 160 * DAY);
    await Referral.updateOne({ tenantId: hospital._id, _id: r.id }, { $set: { receivedAt: received, dues: { reply: new Date(received.getTime() + 2 * HOUR), seen: new Date(received.getTime() + 48 * HOUR) } } });
    // Her delivery stay: admitted Thursday, discharged Saturday 09:00 with a confirmed card – the summary was due Sunday
    const out = new Date('2026-10-17T03:30:00Z');
    const s = await stay(p, { admittedAt: new Date('2026-10-15T04:30:00Z'), status: 'discharged', dischargedAt: out, dischargedByName: 'Sample drA' });
    await dischargeCard(p, s, out);
    expect((await (await as('drA')).get(api('/worklist'))).body).toMatchObject({ notesToWrite: 1, toRelease: 1 });
    expect((await (await as('desk')).get(api('/worklist'))).body).toMatchObject({ replies: 1, late: 1 });
    const review = (await (await as('drA')).get(api('/review?week=2026-10-12'))).body.items;
    expect(review.filter((i) => i.referral.id === r.id).map((i) => [i.promise, i.state])).toEqual([
      ['note', 'late'],
      ['discharge', 'late'],
    ]);
  });
});
