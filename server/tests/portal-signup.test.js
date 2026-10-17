// The patient portal: patients' own accounts (docs/PATIENT_ACCOUNTS_PLAN.md, owner 16 Oct 2026) – sign up, reception
// approves (linking her record) or rejects, sign in with email and password or mobile and OTP – and her own records.
// Sign-up never makes a patient; refusals say nothing about who is registered; nothing on the "never shown" list
// leaves. No SMS provider in the tests: practice mode (the OTP comes back in the answer).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bill } from '../src/models/Bill.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { Patient } from '../src/models/Patient.js';
import { PatientAccount } from '../src/models/PatientAccount.js';
import { PrescriptionDesign } from '../src/models/PrescriptionDesign.js';
import { Visit } from '../src/models/Visit.js';
import { TEST_SENDER, setTestSender, testSent } from '../src/reminders/sender.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-16T06:00:00Z');
const ROLES = { drA: 'doctor', reception: 'receptionist', lab: 'lab', admin: 'admin' };
const SIGNUP = { fullName: 'Sample Mother', ageYears: 29, mobile: '98765 43210', address: '12 Sample Road, Pune', careType: 'gynaecology', email: 'Sample.Mother@example.com', password: 'Sample1234', consent: true };
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
  setTestSender(null);
  app = createApp();
  hospital = await createTenant('Signup Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => {
  vi.useRealTimers();
  setTestSender(null);
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const settings = async (body) => (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: true, ...body });
async function signupOn() {
  const res = await settings({ portalSignup: true });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.settings.signupKey;
}
const signUp = (key, body = {}) => request(app).post(`/api/portal/h/${key}/signup`).send({ ...SIGNUP, ...body });
const passwordSignIn = (agent, key, email = 'sample.mother@example.com', password = SIGNUP.password) => agent.post(`/api/portal/h/${key}/login`).send({ email, password });
async function register(overrides = {}) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Sample Mother', phone: '98765 43210', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, ...overrides }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const waiting = async () => (await (await as('reception')).get('/api/patient-accounts')).body.accounts;
const waitingId = async () => (await waiting())[0].id;
const approve = async (id, patientId, who = 'reception') => (await as(who)).post(`/api/patient-accounts/${id}/approve`).send({ patientId });

describe('the hospital portal address and the sign-in page list', () => {
  it('exist only while the admin has sign-up and the portal switched on; the list names hospitals only', async () => {
    expect((await settings({ portalEnabled: false, portalSignup: true })).body.settings).toMatchObject({ portalSignup: false, signupKey: null });
    const other = await createTenant('Other Hospital');
    expect((await request(app).get('/api/portal/h')).body.hospitals).toEqual([]);
    const key = await signupOn();
    expect(key).toMatch(/^[A-Z2-9]{8}$/);
    expect((await request(app).get('/api/portal/h')).body).toEqual({ hospitals: [{ key, name: 'Signup Hospital' }], otp: 'practice' });
    expect(JSON.stringify((await request(app).get('/api/portal/h')).body)).not.toContain(String(other._id));
    expect((await request(app).get(`/api/portal/h/${key.toLowerCase()}`)).body).toMatchObject({ hospital: { name: 'Signup Hospital' }, otp: 'practice' });
    await settings({ portalSignup: false });
    expect((await request(app).get(`/api/portal/h/${key}`)).status).toBe(404);
    expect((await signUp(key)).status).toBe(404);
  });
});

describe('signing up', () => {
  it('makes a pending account, no patient; the same answer when the mobile or email is already signed up', async () => {
    const key = await signupOn();
    expect((await signUp(key, { consent: false })).status).toBe(400);
    expect((await signUp(key, { password: 'short' })).body.error.fields.password).toBeTruthy();
    expect((await signUp(key, { mobile: '12345' })).body.error.fields.mobile).toBeTruthy();
    const res = await signUp(key);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(await Patient.countDocuments({ tenantId: hospital._id })).toBe(0);
    const account = await PatientAccount.findOne({ tenantId: hospital._id }).lean();
    expect(account).toMatchObject({ status: 'pending', email: 'sample.mother@example.com', mobile: '9876543210', patientId: null });
    expect(account.passwordHash).not.toContain('Sample1234');
    // again, with the same mobile or the same email: the same answer, nothing new
    expect((await signUp(key, { email: 'other@example.com' })).body).toEqual({ ok: true });
    expect((await signUp(key, { mobile: '9123456789' })).body).toEqual({ ok: true });
    expect(await PatientAccount.countDocuments({ tenantId: hospital._id })).toBe(1);
    // reception sees it, never the password
    const list = await waiting();
    expect(list).toEqual([expect.objectContaining({ fullName: 'Sample Mother', ageYears: 29, mobile: '9876543210', status: 'pending' })]);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|\$2/);
    // the lab may not see sign-ups
    expect((await (await as('lab')).get('/api/patient-accounts')).status).toBe(403);
  });
});

describe('signing up without an email (owner, 16 Oct 2026: email optional)', () => {
  it('needs no password; she signs in with mobile and OTP only, and has no password to change', async () => {
    const key = await signupOn();
    const p = await register();
    // an email needs a password; no email, no password
    expect((await signUp(key, { password: undefined })).body.error.fields.password).toBeTruthy();
    expect((await signUp(key, { email: '', password: undefined })).status).toBe(201);
    expect((await signUp(key, { email: 'not-an-email', mobile: '9111111111' })).body.error.fields.email).toBeTruthy();
    const account = await PatientAccount.findOne({ tenantId: hospital._id }).lean();
    expect(account).toMatchObject({ email: null, passwordHash: null, mobile: '9876543210' });
    // a second one without email, another mobile: allowed (no email to clash)
    expect((await request(app).post(`/api/portal/h/${key}/signup`).send({ fullName: 'Other Sample', ageYears: 40, mobile: '9222222222', address: '3 Sample Lane', careType: 'gynaecology', consent: true })).status).toBe(201);
    expect(await PatientAccount.countDocuments({ tenantId: hospital._id })).toBe(2);
    expect((await waiting()).every((x) => x.email === null)).toBe(true);

    await approve((await waiting()).find((x) => x.mobile === '9876543210').id, p.id);
    // no email: password sign-in never works (an empty email is refused like any wrong one)
    expect((await passwordSignIn(request.agent(app), key, '', 'Sample1234')).status).toBe(401);
    const agent = request.agent(app);
    const sent = await agent.post(`/api/portal/h/${key}/otp`).send({ mobile: '9876543210' });
    expect((await agent.post(`/api/portal/h/${key}/otp/verify`).send({ mobile: '9876543210', otp: sent.body.practiceOtp })).status).toBe(200);
    expect((await agent.get('/api/portal/me')).body.canChangePassword).toBe(false);
    expect((await agent.post('/api/portal/account/password').send({ password: 'NewSample99' })).body.error.code).toBe('NO_EMAIL');
  });
});

describe('her own registration details (owner, 16 Oct 2026)', () => {
  it('asks her address and what she comes for; a pregnancy needs the first day of her last period', async () => {
    const key = await signupOn();
    expect((await signUp(key, { address: '' })).body.error.fields.address).toBeTruthy();
    expect((await signUp(key, { careType: 'newborn' })).body.error.fields.careType).toBeTruthy();
    expect((await signUp(key, { careType: 'antenatal' })).body.error.fields.lmp).toBeTruthy();
    expect((await signUp(key, { careType: 'antenatal', lmp: '2026-11-01' })).body.error.fields.lmp).toBeTruthy(); // in the future
    expect((await signUp(key, { careType: 'antenatal', lmp: '2025-06-01' })).body.error.fields.lmp).toBeTruthy(); // too long ago
    expect((await signUp(key, { careType: 'antenatal', lmp: '2026-08-12' })).status).toBe(201);
    expect((await waiting())[0]).toMatchObject({ address: '12 Sample Road, Pune', careType: 'antenatal', lmpSaid: '2026-08-12' });
  });

  it('one click registers a new patient from her details; her LMP is a note for the doctor, not the pregnancy dates', async () => {
    const key = await signupOn();
    await signUp(key, { careType: 'antenatal', lmp: '2026-08-12' });
    const id = await waitingId();
    const res = await (await as('reception')).post(`/api/patient-accounts/${id}/approve-new`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.account).toMatchObject({ status: 'approved', patient: { mrn: 'P-000001', fullName: 'Sample Mother' } });
    const p = await Patient.findOne({ tenantId: hospital._id }).lean();
    expect(p).toMatchObject({ fullName: 'Sample Mother', ageYears: 29, phone: '9876543210', address: '12 Sample Road, Pune', careType: 'antenatal' });
    expect(p.pregnancy?.lmp ?? null).toBeNull(); // the doctor enters the dates
    expect(p.notes).toContain('to confirm');
    expect(p.notes).toContain('12 Aug 2026');
    expect((await AuditLog.find({ action: { $in: ['PATIENT_CREATED', 'PORTAL_SIGNUP_APPROVED'] } }).lean()).map((e) => e.action).sort()).toEqual(['PATIENT_CREATED', 'PORTAL_SIGNUP_APPROVED']);
    // she can sign in at once
    expect((await passwordSignIn(request.agent(app), key)).status).toBe(200);
    // already handled; the lab may not approve
    expect((await (await as('reception')).post(`/api/patient-accounts/${id}/approve-new`)).body.error.code).toBe('HANDLED');
    await signUp(key, { email: 'two@example.com', mobile: '9333333333' });
    expect((await (await as('lab')).post(`/api/patient-accounts/${await waitingId()}/approve-new`)).status).toBe(403);
  });
});

describe('signing in', () => {
  it('a pending account is told to wait – only after the right password; a wrong one says nothing more', async () => {
    const key = await signupOn();
    await signUp(key);
    const agent = request.agent(app);
    const wrong = await passwordSignIn(agent, key, 'sample.mother@example.com', 'Wrong1234');
    expect(wrong.status).toBe(401);
    const unknown = await passwordSignIn(agent, key, 'nobody@example.com');
    expect(unknown.body.error).toEqual(wrong.body.error);
    const pending = await passwordSignIn(agent, key);
    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe('ACCOUNT_PENDING');
    expect((await agent.get('/api/portal/me')).status).toBe(401);
  });

  it('after approval: email and password, or mobile and OTP, open her record; 5 wrong tries lock it', async () => {
    const key = await signupOn();
    const p = await register();
    await signUp(key);
    const id = await waitingId();
    // records that may be hers: the same mobile and name
    const matches = (await (await as('reception')).get(`/api/patient-accounts/${id}/matches`)).body.matches;
    expect(matches).toEqual([expect.objectContaining({ id: p.id, matchedOn: expect.arrayContaining(['phone', 'name']) })]);
    const ok = await approve(id, p.id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.account).toMatchObject({ status: 'approved', patient: { id: p.id, mrn: p.mrn } });
    expect((await approve(id, p.id)).body.error.code).toBe('HANDLED');

    const a = request.agent(app);
    expect((await passwordSignIn(a, key, 'SAMPLE.MOTHER@example.com')).status).toBe(200);
    const me = await a.get('/api/portal/me');
    expect(me.body).toMatchObject({ patient: { fullName: 'Sample Mother' }, canChangePassword: true });

    // mobile and OTP (practice mode: the OTP comes back); an unknown number gets the same answer, without an OTP
    const b = request.agent(app);
    const none = await b.post(`/api/portal/h/${key}/otp`).send({ mobile: '9000000009' });
    expect(none.body).toEqual({ sentTo: '******0009', minutes: 10 });
    const sent = await b.post(`/api/portal/h/${key}/otp`).send({ mobile: '+91 98765 43210' });
    expect(sent.body.practiceOtp).toMatch(/^\d{6}$/);
    const wrongOtp = sent.body.practiceOtp === '000000' ? '111111' : '000000';
    expect((await b.post(`/api/portal/h/${key}/otp/verify`).send({ mobile: '9876543210', otp: wrongOtp })).status).toBe(401);
    expect((await b.post(`/api/portal/h/${key}/otp/verify`).send({ mobile: '9876543210', otp: sent.body.practiceOtp })).status).toBe(200);
    expect((await b.get('/api/portal/me')).status).toBe(200);
    // the OTP is used up
    expect((await request(app).post(`/api/portal/h/${key}/otp/verify`).send({ mobile: '9876543210', otp: sent.body.practiceOtp })).status).toBe(401);

    // a new password, from her page
    expect((await b.post('/api/portal/account/password').send({ password: 'short' })).status).toBe(400);
    expect((await b.post('/api/portal/account/password').send({ password: 'NewSample99' })).status).toBe(200);
    expect((await passwordSignIn(request.agent(app), key)).status).toBe(401);
    expect((await passwordSignIn(request.agent(app), key, undefined, 'NewSample99')).status).toBe(200);

    // 5 wrong passwords lock it for 30 minutes, even for the right one
    for (let i = 0; i < 5; i += 1) await passwordSignIn(request.agent(app), key, undefined, 'Wrong1234');
    expect((await passwordSignIn(request.agent(app), key, undefined, 'NewSample99')).body.error.code).toBe('PORTAL_LOCKED');
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));
    expect((await passwordSignIn(request.agent(app), key, undefined, 'NewSample99')).status).toBe(200);

    const methods = (await AuditLog.find({ action: 'PORTAL_LOGIN_SUCCESS' }).sort({ _id: 1 }).lean()).map((e) => e.details.method);
    expect(methods).toEqual(['password', 'otp', 'password', 'password']);
    const approved = await AuditLog.findOne({ action: 'PORTAL_SIGNUP_APPROVED' }).lean();
    expect(approved.details).toMatchObject({ patientId: p.id, mrn: p.mrn });
  });

  it('sends the OTP by SMS when a provider is set up (never in the answer)', async () => {
    setTestSender(TEST_SENDER);
    const key = await signupOn();
    const p = await register();
    await signUp(key);
    await approve(await waitingId(), p.id);
    const before = testSent().length;
    const sent = await request(app).post(`/api/portal/h/${key}/otp`).send({ mobile: '9876543210' });
    expect(sent.body.practiceOtp).toBeUndefined();
    expect(testSent().length).toBe(before + 1);
    const sms = testSent().at(-1);
    expect(sms).toMatchObject({ channel: 'sms', to: '+919876543210' });
    const otp = sms.text.match(/^(\d{6}) /)[1];
    expect((await request(app).post(`/api/portal/h/${key}/otp/verify`).send({ mobile: '9876543210', otp })).status).toBe(200);
  });

  it('rejected: told to call the hospital; withdrawing portal access closes an approved account', async () => {
    const key = await signupOn();
    await signUp(key);
    const id = await waitingId();
    expect((await (await as('reception')).post(`/api/patient-accounts/${id}/reject`).send({ reason: 'x' })).status).toBe(400);
    expect((await (await as('reception')).post(`/api/patient-accounts/${id}/reject`).send({ reason: 'Could not confirm who she is' })).status).toBe(200);
    const rejected = await passwordSignIn(request.agent(app), key);
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('ACCOUNT_REJECTED');
    expect(rejected.body.error.message).not.toContain('Could not confirm'); // the reason stays with the hospital

    // she signs up again (a rejected account does not block it), is approved, then her access is withdrawn
    const p = await register();
    expect((await signUp(key)).status).toBe(201);
    await approve(await waitingId(), p.id);
    const agent = request.agent(app);
    expect((await passwordSignIn(agent, key)).status).toBe(200);
    // one approved account per record
    await signUp(key, { email: 'second@example.com', mobile: '9111111111' });
    expect((await approve(await waitingId(), p.id)).body.error.code).toBe('ACCOUNT_EXISTS');
    await (await as('reception')).delete(`/api/patients/${p.id}/portal-access`);
    expect((await agent.get('/api/portal/me')).status).toBe(401);
    expect((await passwordSignIn(request.agent(app), key)).body.error.code).toBe('ACCOUNT_REJECTED');
  });

  it('limits OTPs per computer', async () => {
    app = createApp({ portalOtpRateLimitMax: 2 });
    sessions = {};
    const key = await signupOn();
    for (const status of [200, 200, 429]) expect((await request(app).post(`/api/portal/h/${key}/otp`).send({ mobile: '9876543210' })).status).toBe(status);
  });
});

describe('her records in the portal', () => {
  async function signedInPatient() {
    const key = await signupOn();
    const p = await register();
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { 'medical.allergies': 'Penicillin' } });
    await signUp(key);
    await approve(await waitingId(), p.id);
    const agent = request.agent(app);
    const res = await passwordSignIn(agent, key);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { agent, p };
  }
  const by = () => ({ by: people.drA._id, byName: 'Sample drA', at: NOW });
  const visit = (p, fields) =>
    Visit.create({ tenantId: hospital._id, patientId: p.id, visitOn: new Date('2026-10-10T00:00:00Z'), careType: 'antenatal', clientRequestId: randomUUID(), createdBy: people.drA._id, createdByName: 'Sample drA', ...fields });

  it('prescriptions and visits: signed only, as the paper copy shows them – never the private note or HIV', async () => {
    const { agent, p } = await signedInPatient();
    const sig = { by: people.drA._id, byName: 'Sample drA', role: 'doctor', at: NOW, revs: {} };
    await visit(p, {
      signed: sig,
      details: { ...by(), complaints: 'Sample headache', examination: 'Sample exam', diagnosis: 'Sample diagnosis', advice: 'Sample rest', privateNote: 'Sample private note' },
      prescription: { ...by(), items: [{ drug: 'Sample Iron', frequency: '1-0-0' }], notes: 'After food', warningReasons: [] },
    });
    await visit(p, { details: { ...by(), advice: 'Sample unsigned advice' } }); // not signed
    await visit(p, { signed: sig, details: { ...by(), advice: 'Sample retro negative' } }); // mentions HIV
    await visit(p, { signed: sig, status: 'cancelled', details: { ...by(), advice: 'Sample cancelled visit' } });
    // Her doctor's design hides the diagnosis: online = paper
    await PrescriptionDesign.create({ tenantId: hospital._id, userId: people.drA._id, show: { diagnosis: false } });

    const rx = await agent.get('/api/portal/records/prescriptions');
    expect(rx.status, JSON.stringify(rx.body)).toBe(200);
    expect(rx.body.visits).toHaveLength(1);
    expect(rx.body.visits[0]).toMatchObject({ doctor: { name: 'Sample drA' }, items: [expect.objectContaining({ drug: 'Sample Iron' })], notes: 'After food', details: { complaints: 'Sample headache', examination: 'Sample exam', advice: 'Sample rest' } });
    expect(rx.body.patient).toMatchObject({ fullName: 'Sample Mother', medical: { allergies: 'Penicillin' } });
    const visits = await agent.get('/api/portal/records/visits');
    expect(visits.body.visits).toHaveLength(1);
    const text = JSON.stringify([rx.body, visits.body]);
    for (const secret of ['Sample diagnosis', 'Sample private note', 'Sample unsigned advice', 'retro negative', 'Sample cancelled visit', 'warningReasons', 'aiCheck']) expect(text).not.toContain(secret);
    // A record marked sensitive shows nothing
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { sensitive: true } });
    expect((await agent.get('/api/portal/records/visits')).body.visits).toEqual([]);
    const kinds = (await AuditLog.find({ action: 'PORTAL_RECORDS_VIEWED' }).sort({ _id: 1 }).lean()).map((e) => e.details.kind);
    expect(kinds).toEqual(['prescriptions', 'visits', 'visits']);
  });

  it('lab reports: reviewed only, HIV tests left out; bills: neutral names, no cancelled bills', async () => {
    const { agent, p } = await signedInPatient();
    const order = (status, tests) => LabOrder.create({ tenantId: hospital._id, patientId: p.id, clientRequestId: randomUUID(), status, ordered: by(), reported: by(), tests });
    await order('reviewed', [
      { key: 'hb', name: 'Haemoglobin (Hb)', values: [{ key: 'hb', value: '10.2', flag: 'low' }] },
      { key: 'hiv', name: 'HIV 1 and 2', values: [{ key: 'hiv', value: 'Non-reactive' }] },
    ]);
    await order('reported', [{ key: 'hb', name: 'Haemoglobin (Hb)', values: [{ key: 'hb', value: '9.9' }] }]); // not reviewed yet
    const lab = await agent.get('/api/portal/records/lab');
    expect(lab.status, JSON.stringify(lab.body)).toBe(200);
    expect(lab.body.reports).toHaveLength(1);
    expect(lab.body.reports[0].tests).toEqual([{ name: 'Haemoglobin (Hb)', values: [{ name: 'Haemoglobin', value: '10.2', unit: 'g/dL', range: expect.stringContaining('11–16'), flag: 'low' }], text: '' }]);
    expect(JSON.stringify(lab.body)).not.toMatch(/HIV|9\.9/);

    const line = (name, paise) => ({ name, group: 'lab', qty: 1, ratePaise: paise, amountPaise: paise, source: 'manual', added: by() });
    await Bill.create({ tenantId: hospital._id, number: 'B-000001', patientId: p.id, kind: 'opd', on: new Date('2026-10-10T00:00:00Z'), lines: [line('Haemoglobin', 15000), line('HIV test', 30000)], payments: [{ receipt: 'R-000001', kind: 'payment', mode: 'cash', amountPaise: 15000, ...by() }] });
    await Bill.create({ tenantId: hospital._id, number: 'B-000002', patientId: p.id, kind: 'opd', on: new Date('2026-10-11T00:00:00Z'), status: 'cancelled', lines: [line('Sample cancelled line', 100)] });
    const bills = await agent.get('/api/portal/records/bills');
    expect(bills.body.bills).toHaveLength(1);
    expect(bills.body.bills[0]).toMatchObject({ number: 'B-000001', totals: { total: 45000, paid: 15000, balance: 30000 }, lines: [{ name: 'Haemoglobin' }, { name: 'Lab test (confidential)' }] });
    expect(JSON.stringify(bills.body)).not.toMatch(/HIV|Sample cancelled line|Sample drA/);
  });

  it('her Home page summary, her appointments with their states, and her profile to read (17 Oct 2026)', async () => {
    const { agent, p } = await signedInPatient();
    const sig = { by: people.drA._id, byName: 'Sample drA', role: 'doctor', at: NOW, revs: {} };
    await visit(p, { signed: sig, details: { ...by(), advice: 'Sample rest' }, prescription: { ...by(), items: [{ drug: 'Sample Iron', frequency: '1-0-0' }], warningReasons: [] } });
    await visit(p, { signed: sig, details: { ...by(), advice: 'Sample walk' } }); // a visit without medicines
    await LabOrder.create({ tenantId: hospital._id, patientId: p.id, clientRequestId: randomUUID(), status: 'reviewed', ordered: by(), reported: by(), tests: [{ key: 'hb', name: 'Haemoglobin (Hb)', values: [{ key: 'hb', value: '11.2' }] }] });
    const line = (name, paise) => ({ name, group: 'lab', qty: 1, ratePaise: paise, amountPaise: paise, source: 'manual', added: by() });
    await Bill.create({ tenantId: hospital._id, number: 'B-000001', patientId: p.id, kind: 'opd', on: new Date('2026-10-10T00:00:00Z'), lines: [line('Haemoglobin', 15000)], payments: [{ receipt: 'R-000001', kind: 'payment', mode: 'cash', amountPaise: 5000, ...by() }] });
    const appt = (on, start, extra = {}) =>
      Appointment.create({ tenantId: hospital._id, patientId: p.id, doctorId: people.drA._id, on: new Date(`${on}T00:00:00Z`), kind: 'slot', start, source: 'booked', created: by(), ...extra });
    await appt('2026-10-20', '10:00', { source: 'portal' });
    await appt('2026-10-05', '10:00'); // past, she did not come
    await appt('2026-10-06', '11:00', { status: 'cancelled' });

    const summary = await agent.get('/api/portal/records/summary');
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    expect(summary.body).toEqual({ appointment: { date: '2026-10-20', start: '10:00', doctorName: 'Sample drA' }, prescriptions: 1, visits: 2, lab: 1, bills: 1, toPayPaise: 10000 });

    const list = (await agent.get('/api/portal/records/appointments')).body.appointments;
    expect(list).toEqual([
      { date: '2026-10-20', start: '10:00', doctorName: 'Sample drA', status: 'upcoming', online: true },
      { date: '2026-10-06', start: '11:00', doctorName: 'Sample drA', status: 'cancelled', online: false },
      { date: '2026-10-05', start: '10:00', doctorName: 'Sample drA', status: 'missed', online: false },
    ]);

    const profile = (await agent.get('/api/portal/records/profile')).body;
    expect(profile).toMatchObject({ fullName: 'Sample Mother', mrn: expect.stringMatching(/^P-/), email: 'sample.mother@example.com' });
    expect(JSON.stringify(profile)).not.toMatch(/Penicillin|allerg/i); // her details only, nothing clinical
    const kinds = (await AuditLog.find({ action: 'PORTAL_RECORDS_VIEWED' }).sort({ _id: 1 }).lean()).map((e) => e.details.kind);
    expect(kinds).toEqual(['summary', 'appointments', 'profile']);
    // A record marked sensitive: no counts of her records
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { sensitive: true } });
    expect((await agent.get('/api/portal/records/summary')).body).toMatchObject({ prescriptions: 0, visits: 0, lab: 0 });
  });

  it('needs her portal session', async () => {
    for (const kind of ['prescriptions', 'visits', 'lab', 'bills', 'summary', 'appointments', 'profile']) expect((await request(app).get(`/api/portal/records/${kind}`)).status).toBe(401);
  });
});
