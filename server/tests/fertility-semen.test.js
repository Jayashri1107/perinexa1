// The semen analysis panel (fertility idea F2, the owner's go-ahead of 27 Oct 2026): the WHO 2021 lower reference
// limits as flags, the total worked out from volume and concentration, and the fertility history's choice a reported
// result suggests on the Treatment plan tab (set only by the doctor's click). Only the hospital's own orders are read.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { calculate } from '../src/lab/labCalcs.js';
import { flagFor, testByKey } from '../src/lab/labTests.js';
import { semenStatusFrom } from '../src/fertility/semenResult.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { calculate as websiteCalculate } from '../../client/src/pages/lab/labCalcs.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const vals = (o) => Object.entries(o).map(([key, value]) => ({ key, value: String(value) }));
const NORMAL = { volume: 2.5, count: 40, totalCount: 100, motility: 55, progressive: 40, vitality: 70, morphology: 6 };

describe('the semen analysis panel', () => {
  it('has the WHO 2021 lower reference limits and the post-wash count', () => {
    const t = testByKey.get('semen');
    const limits = Object.fromEntries(t.fields.filter((f) => f.low != null).map((f) => [f.key, f.low]));
    expect(limits).toEqual({ volume: 1.4, count: 16, totalCount: 39, motility: 42, progressive: 30, vitality: 54, morphology: 4 });
    expect(t.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['abstinence', 'postWashTmc']));
    const progressive = t.fields.find((f) => f.key === 'progressive');
    expect(flagFor(progressive, '29')).toBe('low');
    expect(flagFor(progressive, '30')).toBe('normal');
  });

  it('works the total out from volume × concentration, the same on the website', () => {
    expect(calculate('totalCount', { volume: 2.5, count: 20 })).toBe('50.0');
    expect(websiteCalculate('totalCount', { volume: 2.5, count: 20 })).toBe('50.0');
    expect(calculate('totalCount', { volume: 2.5 })).toBeNull();
  });

  it('suggests the history choice: normal, mild, severe, azoospermia – or nothing when too little is known', () => {
    expect(semenStatusFrom(vals(NORMAL))).toEqual({ status: 'normal', below: [] });
    expect(semenStatusFrom(vals({ ...NORMAL, progressive: 25 }))).toEqual({ status: 'mild_abnormal', below: ['progressive'] });
    expect(semenStatusFrom(vals({ ...NORMAL, count: 3, totalCount: 7.5 })).status).toBe('severe_abnormal');
    expect(semenStatusFrom(vals({ count: 0 }))).toEqual({ status: 'azoospermia', below: ['count'] });
    expect(semenStatusFrom(vals({ volume: 2 }))).toBeNull();
  });
});

describe('the semen result on the Treatment plan tab', () => {
  let sessions;
  let hospital;
  let other;
  let doctor;
  beforeAll(connectTestDb);
  afterAll(disconnectTestDb);
  beforeEach(async () => {
    await resetTestDb();
    const app = createApp();
    hospital = await createTenant('Semen Hospital');
    other = await createTenant('Other Hospital');
    doctor = await createUser({ name: 'Sample Doctor' });
    await addMember(doctor, hospital, 'doctor');
    sessions = { dr: await loginAs(doctor, { app }) };
  });

  const order = (tenantId, patientId, values, status = 'reported') =>
    LabOrder.create({
      tenantId,
      patientId,
      clientRequestId: randomUUID(),
      status,
      ordered: { by: doctor._id, byName: 'Sample Doctor', at: new Date() },
      reported: { by: doctor._id, byName: 'Sample Doctor', at: new Date() },
      tests: [{ key: 'semen', name: 'Semen analysis (partner)', values: vals(values) }],
    });

  it('shows the latest reported result and its suggestion; the doctor sets the history', async () => {
    const res = await sessions.dr.post('/api/patients').send(samplePatient({ fullName: 'Semen Sample', careType: 'infertility', assignedDoctor: doctor._id.toString() }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.patient.id;
    const url = `/api/patients/${id}/fertility-plan`;
    expect((await sessions.dr.get(url)).body.semen).toBeNull();

    await order(hospital._id, id, { ...NORMAL, motility: 30 }, 'ordered'); // not reported yet: not shown
    await order(other._id, id, NORMAL); // another hospital's: never read
    await order(hospital._id, id, { ...NORMAL, motility: 30 });
    const semen = (await sessions.dr.get(url)).body.semen;
    expect(semen).toMatchObject({ suggested: { status: 'mild_abnormal', below: ['motility'] }, recorded: '' });
    expect(semen.values.find((v) => v.key === 'motility').value).toBe('30');

    expect((await sessions.dr.patch(`/api/patients/${id}`).send({ fertility: { semen: semen.suggested.status } })).status).toBe(200);
    expect((await sessions.dr.get(url)).body.semen.recorded).toBe('mild_abnormal');
  });
});
