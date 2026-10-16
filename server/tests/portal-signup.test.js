// The patient portal: sign-up and sign-in with ABHA, and her own records (docs/PATIENT_SIGNUP_PLAN.md, 16 Oct 2026).
// Sign-up never makes a patient (reception confirms her); refusals give one answer; nothing on the "never shown"
// list leaves the server. ABDM in practice mode (OTP 123456).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPractice } from '../src/abdm/practiceClient.js';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bill } from '../src/models/Bill.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { Patient } from '../src/models/Patient.js';
import { PrescriptionDesign } from '../src/models/PrescriptionDesign.js';
import { ScanShare } from '../src/models/ScanShare.js';
import { Visit } from '../src/models/Visit.js';
import { resetSignupSteps } from '../src/routes/portalSignup.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-16T06:00:00Z');
const ABHA = '91-1111-2222-3333'; // a practice ABHA: Sample Abha Mother, mobile 9000000001
const ROLES = { drA: 'doctor', reception: 'receptionist', admin: 'admin' };
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
  resetPractice();
  resetSignupSteps();
  app = createApp();
  hospital = await createTenant('Signup Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const settings = async (body) => (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: true, ...body });
async function signupOn() {
  const res = await settings({ portalSignup: true });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.settings.signupKey;
}
const otp = (agent, key, purpose, value = ABHA, hint = 'abha-number') => agent.post(`/api/portal/h/${key}/otp`).send({ purpose, hint, value });
async function signUp(key, abha = ABHA) {
  const agent = request.agent(app);
  const o = await otp(agent, key, 'signup', abha);
  expect(o.status, JSON.stringify(o.body)).toBe(200);
  const v = await agent.post(`/api/portal/h/${key}/signup/verify`).send({ id: o.body.id, otp: '123456' });
  expect(v.status, JSON.stringify(v.body)).toBe(200);
  return agent.post(`/api/portal/h/${key}/signup`).send({ id: o.body.id, abhaNumber: abha, consent: true });
}
async function abhaSignIn(key, abha = ABHA) {
  const agent = request.agent(app);
  const o = await otp(agent, key, 'signin', abha);
  const res = await agent.post(`/api/portal/h/${key}/signin/verify`).send({ id: o.body.id, otp: '123456' });
  return { agent, res };
}
async function register(overrides = {}) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Sample Abha Mother', phone: '9000000001', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, ...overrides }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const deskList = async () => (await (await as('reception')).get('/api/abdm/scan-share')).body.shares;

describe('the hospital portal address', () => {
  it('exists only while the admin has sign-up and the portal switched on', async () => {
    expect((await settings({ portalEnabled: false, portalSignup: true })).body.settings).toMatchObject({ portalSignup: false, signupKey: null });
    const key = await signupOn();
    expect(key).toMatch(/^[A-Z2-9]{8}$/);
    // Staff see it too (for the poster)
    expect((await (await as('reception')).get('/api/reminders/settings')).body.settings.signupKey).toBe(key);
    const page = await request(app).get(`/api/portal/h/${key.toLowerCase()}`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ hospital: { name: 'Signup Hospital' }, practice: true });
    expect((await request(app).get('/api/portal/h/AAAABBBB')).status).toBe(404);
    // Off: the address stops working; on again: a new one
    await settings({ portalSignup: false });
    expect((await request(app).get(`/api/portal/h/${key}`)).status).toBe(404);
    const again = await signupOn();
    expect(again).not.toBe(key);
  });
});

describe('signing up with ABHA', () => {
  it('waits at the desk for 7 days and makes no patient until reception confirms her', async () => {
    const key = await signupOn();
    const agent = request.agent(app);
    const o = await otp(agent, key, 'signup');
    expect(o.body).toMatchObject({ sentTo: '******0001', practiceOtp: '123456' });
    expect((await agent.post(`/api/portal/h/${key}/signup/verify`).send({ id: o.body.id, otp: '000000' })).status).toBe(400);
    const v = await agent.post(`/api/portal/h/${key}/signup/verify`).send({ id: o.body.id, otp: '123456' });
    expect(v.body.accounts).toEqual([{ abhaNumber: ABHA, name: 'Sample Abha Mother', yearOfBirth: 1996, gender: 'F' }]);
    expect((await agent.post(`/api/portal/h/${key}/signup`).send({ id: o.body.id, abhaNumber: ABHA, consent: false })).status).toBe(400);
    const done = await agent.post(`/api/portal/h/${key}/signup`).send({ id: o.body.id, abhaNumber: ABHA, consent: true });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    // The step is used up
    expect((await agent.post(`/api/portal/h/${key}/signup`).send({ id: o.body.id, abhaNumber: ABHA, consent: true })).body.error.code).toBe('EXPIRED');

    expect(await Patient.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect(await deskList()).toEqual([expect.objectContaining({ source: 'portal', status: 'waiting', profile: expect.objectContaining({ name: 'Sample Abha Mother' }) })]);
    // The audit log has ids only
    const entry = await AuditLog.findOne({ action: 'PORTAL_SIGNUP_RECEIVED' }).lean();
    expect(String(entry.tenantId)).toBe(String(hospital._id));
    expect(JSON.stringify(entry)).not.toMatch(/Sample Abha Mother|1111-2222/);

    vi.setSystemTime(new Date('2026-10-22T06:00:00Z')); // day 7: still there
    sessions = {}; // (staff sessions end after 30 minutes)
    expect(await deskList()).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-23T06:00:00Z')); // day 8: off the list (kept in the database)
    sessions = {};
    expect(await deskList()).toHaveLength(0);
    expect(await ScanShare.countDocuments({ tenantId: hospital._id })).toBe(1);
  });

  it('gives the same answer when she is already waiting or registered, and makes nothing new', async () => {
    const key = await signupOn();
    expect((await signUp(key)).status).toBe(201);
    expect((await signUp(key)).status).toBe(201);
    expect(await ScanShare.countDocuments({ tenantId: hospital._id })).toBe(1);
    await ScanShare.deleteMany({ tenantId: hospital._id });
    const p = await register();
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { abha: { number: ABHA, method: 'verified' } } });
    const res = await signUp(key);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, signupDays: 7 });
    expect(await ScanShare.countDocuments({ tenantId: hospital._id })).toBe(0);
  });

  it('reception registers her from the desk list, and then she signs in with her ABHA', async () => {
    const key = await signupOn();
    await signUp(key);
    // Not yet confirmed: the same refusal as for any ABHA not registered here
    const before = await abhaSignIn(key);
    expect(before.res.status).toBe(401);
    expect(before.res.body.error.code).toBe('PORTAL_LOGIN_FAILED');

    const [share] = await deskList();
    const p = await register();
    const link = await (await as('reception')).post(`/api/abdm/scan-share/${share.id}/link`).send({ patientId: p.id });
    expect(link.status, JSON.stringify(link.body)).toBe(200);

    const { agent, res } = await abhaSignIn(key);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const me = await agent.get('/api/portal/me');
    expect(me.status).toBe(200);
    expect(me.body.patient).toEqual({ fullName: 'Sample Abha Mother' });
    // The staff panel shows no "code" for an ABHA sign-in; withdrawing access ends her session
    expect((await (await as('reception')).get(`/api/patients/${p.id}/portal-access`)).body.active).toBeNull();
    await (await as('reception')).delete(`/api/patients/${p.id}/portal-access`);
    expect((await agent.get('/api/portal/me')).status).toBe(401);
    const login = await AuditLog.findOne({ action: 'PORTAL_LOGIN_SUCCESS' }).lean();
    expect(login.details).toMatchObject({ method: 'abha', patientId: p.id });
  });

  it('limits OTPs per computer', async () => {
    app = createApp({ portalOtpRateLimitMax: 2 });
    sessions = {};
    const key = await signupOn();
    const agent = request.agent(app);
    expect((await otp(agent, key, 'signup')).status).toBe(200);
    expect((await otp(agent, key, 'signup')).status).toBe(200);
    expect((await otp(agent, key, 'signup')).status).toBe(429);
  });
});

describe('her records in the portal', () => {
  async function signedInPatient() {
    const key = await signupOn();
    const p = await register();
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { abha: { number: ABHA, method: 'verified' }, 'medical.allergies': 'Penicillin' } });
    const { agent, res } = await abhaSignIn(key);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { agent, p };
  }
  const by = () => ({ by: people.drA._id, byName: 'Sample drA', at: NOW });
  const visit = (p, fields) =>
    Visit.create({ tenantId: hospital._id, patientId: p.id, visitOn: new Date('2026-10-10T00:00:00Z'), careType: 'antenatal', clientRequestId: randomUUID(), createdBy: people.drA._id, createdByName: 'Sample drA', ...fields });
  const signed = { by: people?.drA?._id, byName: 'Sample drA', role: 'doctor', at: NOW, revs: {} };

  it('prescriptions and visits: signed only, as the paper copy shows them – never the private note or HIV', async () => {
    const { agent, p } = await signedInPatient();
    const sig = { ...signed, by: people.drA._id };
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
    expect(rx.body.patient).toMatchObject({ fullName: 'Sample Abha Mother', medical: { allergies: 'Penicillin' } });
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

  it('needs her portal session', async () => {
    for (const kind of ['prescriptions', 'visits', 'lab', 'bills']) expect((await request(app).get(`/api/portal/records/${kind}`)).status).toBe(401);
  });
});
