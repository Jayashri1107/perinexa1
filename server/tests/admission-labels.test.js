// Colour labels for billing type and admission type (owner, 9 Nov 2026 – docs/ADMISSION_COLOURS_PLAN.md): asked at
// every admission; the billing type goes only to doctors and RMOs on the inpatient lists, never to nurses; changing
// the admission type is audited; old records are moved to the new types.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { migrateAdmissionLabels } from '../src/inpatient/admissionLabels.js';
import { Admission } from '../src/models/Admission.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-09T06:00:00Z');
const ROLES = { admin: 'admin', drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };
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
  app = createApp();
  hospital = await createTenant('Label Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function register(fullName, overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName, ageYears: 27, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-11-20' }, medical: { allergies: 'None known' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
async function bedsOf(names) {
  const res = await (await as('admin')).post('/api/beds/setup').send({ ward: 'General ward', names });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.beds;
}
const admitAtBed = async (bed, p, body) => (await as('reception')).post(`/api/beds/${bed.id}/admit`).send({ clientRequestId: randomUUID(), patientId: p.id, reasonCode: 'labour', ...body });

describe('asked at every admission', () => {
  it('the bed board needs Insurance, Cash or Package and ANC, PNC, Delivered or Other; a baby is Other when not chosen', async () => {
    const [b1, b2] = await bedsOf(['L1', 'L2']);
    const p = await register('Label Mother');
    const none = await admitAtBed(b1, p, {});
    expect(none.status).toBe(400);
    expect(none.body.error.fields.billingType).toMatch(/Insurance, Cash or Package/);
    expect((await admitAtBed(b1, p, { billingType: 'self' })).body.error.fields.billingType).toBeTruthy(); // the old types are gone
    const noType = await admitAtBed(b1, p, { billingType: 'insurance' });
    expect(noType.status).toBe(400);
    expect(noType.body.error.fields.stayType).toMatch(/ANC, PNC, Delivered or Other/);
    expect((await admitAtBed(b1, p, { billingType: 'insurance', stayType: 'anc' })).status).toBe(201);
    const stay = await Admission.findOne({ tenantId: hospital._id, patientId: p.id }).lean();
    expect(stay).toMatchObject({ billingType: 'insurance', stayType: 'anc' });

    const baby = await register('Label Baby', { careType: 'newborn', pregnancy: undefined, newborn: { birthAt: '2026-11-08T10:00:00.000Z' } });
    expect((await admitAtBed(b2, baby, { billingType: 'package' })).status).toBe(201);
    expect(await Admission.findOne({ tenantId: hospital._id, patientId: baby.id }).lean()).toMatchObject({ billingType: 'package', stayType: 'other' });
  });

  it('the ward admission (typed ward) asks the same', async () => {
    const p = await register('Ward Label Mother');
    const s = await as('rmo');
    const res = await s.post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'Labour ward', reason: 'In labour' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.billingType).toBeTruthy();
    const ok = await s.post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'Labour ward', reason: 'In labour', billingType: 'cash', stayType: 'anc' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});

describe('who sees the billing type', () => {
  it('doctors and RMOs get it on the inpatient list and the stay; nurses never do, nor who pays on the record', async () => {
    const [b1] = await bedsOf(['L1']);
    const p = await register('Seen Mother', { payer: { type: 'insurance', name: 'Sample Insurer', number: 'SMP-1' } });
    const admitted = await admitAtBed(b1, p, { billingType: 'insurance', stayType: 'anc', department: 'Obstetrics & Gynaecology' });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    for (const who of ['drA', 'rmo']) {
      const row = (await (await as(who)).get('/api/inpatients')).body.admitted.find((s) => s.patient.id === p.id);
      expect(row).toMatchObject({ billingType: 'insurance', stayType: 'anc', department: 'Obstetrics & Gynaecology' });
    }
    const nurseRow = (await (await as('nurse')).get('/api/inpatients')).body.admitted.find((s) => s.patient.id === p.id);
    expect(nurseRow).toMatchObject({ stayType: 'anc', department: 'Obstetrics & Gynaecology' });
    expect(nurseRow).not.toHaveProperty('billingType');
    const id = admitted.body.admission.id;
    expect((await (await as('drA')).get(`/api/patients/${p.id}/admissions/${id}`)).body.admission.billingType).toBe('insurance');
    expect((await (await as('nurse')).get(`/api/patients/${p.id}/admissions/${id}`)).body.admission).not.toHaveProperty('billingType');
    expect((await (await as('nurse')).get(`/api/patients/${p.id}`)).body.patient).not.toHaveProperty('payer');
  });
});

describe('changing the admission type', () => {
  it('is kept on the stay and audited, e.g. ANC → Delivered', async () => {
    const [b1] = await bedsOf(['L1']);
    const p = await register('Change Mother');
    const id = (await admitAtBed(b1, p, { billingType: 'cash', stayType: 'anc' })).body.admission.id;
    const s = await as('drA');
    expect((await s.patch(`/api/patients/${p.id}/admissions/${id}`).send({ stayType: 'antenatal' })).status).toBe(400);
    const res = await s.patch(`/api/patients/${p.id}/admissions/${id}`).send({ stayType: 'delivered' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.admission.stayType).toBe('delivered');
    const stay = await Admission.findOne({ tenantId: hospital._id, _id: id }).lean();
    expect(stay.stayTypeChanges).toMatchObject([{ from: 'anc', to: 'delivered', byName: 'Sample drA' }]);
    const log = await AuditLog.findOne({ tenantId: hospital._id, action: 'ADMISSION_STAY_TYPE_CHANGED' }).lean();
    expect(log.details).toMatchObject({ admissionId: id, from: 'anc', to: 'delivered' });
  });
});

describe('old records', () => {
  it('self → cash; insurance, scheme, employer → insurance; old stays get an admission type from the record', async () => {
    const [b1] = await bedsOf(['L1']);
    const a = await register('Old Self');
    const b = await register('Old Scheme');
    const c = await register('Old Postnatal', { careType: 'postnatal', pregnancy: undefined });
    await Patient.collection.updateOne({ _id: new mongoose.Types.ObjectId(a.id) }, { $set: { 'payer.type': 'self' } });
    await Patient.collection.updateOne({ _id: new mongoose.Types.ObjectId(b.id) }, { $set: { 'payer.type': 'govt_scheme', 'payer.name': 'Sample scheme' } });
    const id = (await admitAtBed(b1, c, { billingType: 'cash', stayType: 'pnc' })).body.admission.id;
    await Admission.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $unset: { stayType: 1, billingType: 1 } });
    expect(await migrateAdmissionLabels(hospital._id)).toBeGreaterThan(0);
    expect((await Patient.findOne({ tenantId: hospital._id, _id: a.id }).lean()).payer.type).toBe('cash');
    expect((await Patient.findOne({ tenantId: hospital._id, _id: b.id }).lean()).payer).toMatchObject({ type: 'insurance', name: 'Sample scheme' });
    expect((await Admission.findOne({ tenantId: hospital._id, _id: id }).lean()).stayType).toBe('pnc');
    expect(await migrateAdmissionLabels(hospital._id)).toBe(0); // once
  });
});
