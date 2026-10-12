// ABDM linking, milestone M1 (docs/ABDM_PLAN.md) in practice mode: verify and link an existing ABHA, create one with
// Aadhaar and OTP (the Aadhaar number is never stored), the ABHA card, unlink, Scan & Share (practice and from ABDM with
// its signature checked), and who may do what.
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aadhaarDigits, abhaNumber, verhoeffValid } from '../src/abdm/abhaFormat.js';
import { setAbdmClientForTests } from '../src/abdm/abdmService.js';
import { practiceClient, resetPractice } from '../src/abdm/practiceClient.js';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Tenant } from '../src/models/Tenant.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-03T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharm: 'pharmacist', admin: 'admin' };
const AADHAAR = '234123412346'; // made up – passes the Verhoeff check

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
  setAbdmClientForTests(null);
  app = createApp();
  hospital = await createTenant('ABDM Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => {
  vi.useRealTimers();
  setAbdmClientForTests(null);
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const post = async (who, path, body) => (await as(who)).post(`/api/abdm${path}`).send(body);
async function register(name) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString() }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

describe('numbers', () => {
  it('checks Aadhaar and ABHA numbers', () => {
    expect(verhoeffValid(AADHAAR)).toBe(true);
    expect(verhoeffValid('234123412345')).toBe(false);
    expect(aadhaarDigits('2341 2341 2346')).toBe(AADHAAR);
    expect(aadhaarDigits('123412341234')).toBeNull(); // never starts with 0 or 1
    expect(abhaNumber('91111122223333')).toBe('91-1111-2222-3333');
  });
});

describe('verify and link an existing ABHA', () => {
  it('OTP to her mobile, her ABHA beside her record, linked with her agreement; shown partly hidden', async () => {
    const p = await register('Link Mother');
    for (const who of ['nurse', 'lab', 'pharm', 'admin']) expect((await post(who, '/verify/request', { patientId: p.id, hint: 'abha-number', value: '91-1111-2222-3333' })).status).toBe(403);
    const req = await post('reception', '/verify/request', { patientId: p.id, hint: 'abha-number', value: '91111122223333' });
    expect(req.body).toMatchObject({ sentTo: '******0001', practiceOtp: '123456' });
    expect((await post('reception', '/verify/confirm', { id: req.body.id, otp: '000000' })).status).toBe(400);
    const ok = await post('reception', '/verify/confirm', { id: req.body.id, otp: '123456' });
    expect(ok.body.accounts).toEqual([{ abhaNumber: '91-1111-2222-3333', abhaAddress: 'sample.abha.mother@sbx', name: 'Sample Abha Mother', gender: 'F', yearOfBirth: 1996, mobile: '******0001' }]);
    expect((await post('reception', '/verify/link', { id: req.body.id, abhaNumber: '91-1111-2222-3333' })).status).toBe(400); // her agreement
    const linked = await post('reception', '/verify/link', { id: req.body.id, abhaNumber: '91-1111-2222-3333', consent: true });
    expect(linked.body.abha).toMatchObject({ number: '91-1111-2222-3333', masked: '91-XXXX-XXXX-3333', method: 'verified', byName: 'Sample reception' });

    expect((await (await as('nurse')).get(`/api/patients/${p.id}`)).body.patient.abha).toMatchObject({ linked: true, masked: '91-XXXX-XXXX-3333' });
    expect(JSON.stringify((await (await as('nurse')).get(`/api/patients/${p.id}`)).body)).not.toContain('1111-2222');
    expect((await (await as('lab')).get(`/api/patients/${p.id}`)).body.patient.abha).toBeUndefined();
    expect((await (await as('drA')).get(`/api/abdm/patients/${p.id}`)).body.abha.number).toBe('91-1111-2222-3333');

    // The same ABHA on another record of this hospital: refused
    const q = await register('Other Mother');
    const again = await post('reception', '/verify/request', { patientId: q.id, hint: 'mobile', value: '9000000001' });
    await post('reception', '/verify/confirm', { id: again.body.id, otp: '123456' });
    expect((await post('reception', '/verify/link', { id: again.body.id, abhaNumber: '91-1111-2222-3333', consent: true })).body.error.code).toBe('ABHA_IN_USE');

    // Someone else can't continue her verification
    expect((await post('drA', '/verify/confirm', { id: req.body.id, otp: '123456' })).body.error.code).toBe('EXPIRED');
    expect((await post('drA', `/patients/${p.id}/unlink`, { reason: 'Wrong person' })).body.abha).toBeNull();
    expect((await AuditLog.find({ tenantId: hospital._id, action: { $regex: /^ABHA_/ } }).lean()).map((a) => a.action).sort()).toEqual(['ABHA_LINKED', 'ABHA_UNLINKED', 'ABHA_VERIFIED', 'ABHA_VERIFIED', 'ABHA_VIEWED']);
  });
});

describe('create a new ABHA at the desk', () => {
  it('with her agreement, Aadhaar and OTP; an ABHA address; the card; the Aadhaar number is never kept', async () => {
    const p = await register('New Abha Mother');
    expect((await post('reception', '/create/request', { patientId: p.id, aadhaar: AADHAAR })).status).toBe(400); // no agreement
    expect((await post('reception', '/create/request', { patientId: p.id, aadhaar: '12345', consent: true })).status).toBe(400);
    const r = await post('reception', '/create/request', { patientId: p.id, aadhaar: AADHAAR, consent: true });
    expect(r.body).toMatchObject({ sentTo: '******2346', practiceOtp: '123456' });
    const c = await post('reception', '/create/confirm', { id: r.body.id, otp: '123456', mobile: '98765 43210' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.profile).toMatchObject({ abhaNumber: expect.stringMatching(/^91-\d{4}-\d{4}-\d{4}$/), mobile: '******3210' });
    expect(c.body.suggestions.length).toBeGreaterThan(0);
    const a = await post('reception', '/create/address', { id: r.body.id, address: c.body.suggestions[0] });
    expect(a.body.profile.abhaAddress).toBe(c.body.suggestions[0]);
    const l = await post('reception', '/create/link', { id: r.body.id });
    expect(l.body.abha).toMatchObject({ method: 'created', address: c.body.suggestions[0] });
    const card = await (await as('reception')).get(`/api/abdm/card/${r.body.id}`);
    expect(card.body).toMatchObject({ contentType: 'image/svg+xml', base64: expect.any(String) });

    // The Aadhaar number is nowhere in the database
    let read = 0;
    for (const coll of await mongoose.connection.db.collections()) {
      const docs = await coll.find({}).toArray();
      read += docs.length;
      expect(JSON.stringify(docs).includes(AADHAAR), coll.collectionName).toBe(false);
    }
    expect(read).toBeGreaterThan(5); // it really looked
    expect(await AuditLog.countDocuments({ action: 'ABHA_CARD_PRINTED' })).toBe(1);
  });
});

describe('Scan & Share', () => {
  it('practice: a patient in the list with a token; linked to her record or put aside', async () => {
    const p = await register('Scanned Mother');
    const s1 = await post('reception', '/scan-share/practice', {});
    const s2 = await post('reception', '/scan-share/practice', {});
    expect([s1.body.share.token, s2.body.share.token]).toEqual([1, 2]);
    const list = (await (await as('reception')).get('/api/abdm/scan-share')).body.shares;
    expect(list.map((s) => [s.token, s.status, s.profile.name])).toEqual([
      [1, 'waiting', 'Sample Abha Mother'],
      [2, 'waiting', 'Sample Abha Mother'],
    ]);
    expect((await post('reception', `/scan-share/${s1.body.share.id}/link`, { patientId: p.id })).body.abha).toMatchObject({ method: 'scan_share' });
    expect((await post('reception', `/scan-share/${s2.body.share.id}/dismiss`, {})).body.share.status).toBe('dismissed');
    const after = (await (await as('reception')).get('/api/abdm/scan-share')).body.shares;
    expect(after[0]).toMatchObject({ status: 'linked', knownPatient: { id: p.id } });
  });

  it('from ABDM: only with ABDM’s signature, for the hospital with that HIP ID', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': 'IN2710000001' } });
    const acks = [];
    setAbdmClientForTests({
      ...practiceClient,
      mode: 'sandbox',
      async verifyShareRequest(auth) {
        if (auth !== 'Bearer signed-by-abdm') throw Object.assign(new Error('Not signed by ABDM.'), { status: 401, code: 'NOT_AUTHENTICATED' });
      },
      async acknowledgeShare(a) {
        acks.push(a);
      },
    });
    const { default: request } = await import('supertest');
    const body = { intent: 'PROFILE_SHARE', metaData: { hipId: 'IN2710000001', context: 'DESK1' }, profile: { patient: { abhaNumber: '91-4444-5555-6666', abhaAddress: 'second.sample@sbx', name: 'Second Sample Mother', gender: 'F', yearOfBirth: '1992', phoneNumber: '9000000002' } } };
    const bad = await request(app).post('/api/abdm/public/api/v3/hip/patient/share').set('Authorization', 'Bearer forged').send(body);
    expect(bad.status).not.toBe(202);
    const ok = await request(app).post('/api/abdm/public/api/v3/hip/patient/share').set('Authorization', 'Bearer signed-by-abdm').set('REQUEST-ID', 'req-1').send(body);
    expect(ok.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(acks).toEqual([expect.objectContaining({ requestId: 'req-1', hipId: 'IN2710000001', token: 1 })]);
    const unknown = await request(app).post('/api/abdm/public/api/v3/hip/patient/share').set('Authorization', 'Bearer signed-by-abdm').send({ ...body, metaData: { hipId: 'IN0000000000' } });
    expect(unknown.status).toBe(404);
    const list = (await (await as('reception')).get('/api/abdm/scan-share')).body.shares;
    expect(list).toEqual([expect.objectContaining({ token: 1, source: 'abdm', profile: expect.objectContaining({ name: 'Second Sample Mother', mobile: '******0002' }) })]);
  });
});

describe('settings', () => {
  it('the hospital admin sets the HFR / HIP ID and counter code; status says practice mode', async () => {
    expect((await (await as('reception')).put('/api/abdm/settings').send({ hipId: 'X' })).status).toBe(403);
    expect((await (await as('admin')).put('/api/abdm/settings').send({ hfrId: 'IN2710000001', hipId: 'IN2710000001', counterCode: 'DESK1' })).body.settings).toEqual({ hfrId: 'IN2710000001', hipId: 'IN2710000001', counterCode: 'DESK1' });
    const status = (await (await as('admin')).get('/api/abdm/status')).body;
    expect(status).toMatchObject({ mode: 'practice', canEdit: true, canLink: false });
    expect(status.checklist.length).toBeGreaterThan(5);
    expect((await (await as('nurse')).get('/api/abdm/status')).status).toBe(403);
  });
});
