// Clinical Requirements Group C (PX-X-06): the second-person check. A second member of staff types their own email and
// password: someone else, active, a member of this hospital with an allowed role; the same 3-tries lock as sign-in;
// the password is never stored or audited. Used for theatre counts, the identity band, high-alert medicines and an
// amount discarded. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { FormularyItem } from '../src/models/FormularyItem.js';
import { NursingEntry } from '../src/models/NursingEntry.js';
import { PASSWORD, addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', nurse: 'nurse', nurse2: 'nurse', reception: 'receptionist' };
let app;
let hospital;
let other;
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
  hospital = await createTenant('Witness Hospital');
  other = await createTenant('Other Witness Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.elsewhere = await createUser({ name: 'Sample elsewhere nurse' });
  await addMember(people.elsewhere, other, 'nurse');
  people.inactive = await createUser({ name: 'Sample former nurse', isActive: false });
  await addMember(people.inactive, hospital, 'nurse');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function stay() {
  const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: 'Witness Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
  const a = (await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'anc', admittedAt: '2026-11-10T01:00:00.000Z', ward: 'Ward', bed: '2', reason: 'After delivery' })).body.admission;
  return { p, a };
}
const give = async ({ p, a }, medicine, extra = {}) => (await as('nurse')).post(`/api/patients/${p.id}/admissions/${a.id}/nursing`).send({ clientRequestId: randomUUID(), kind: 'medicine', at: '2026-11-10T05:00:00.000Z', medicine, ...extra });
const witness = (who, password = PASSWORD) => ({ email: people[who].email, password });

describe('the second-person check', () => {
  it('an ordinary medicine needs no second person; a high-alert one does – and it must be someone else, here, active, allowed', async () => {
    const s = await stay();
    expect((await give(s, { drug: 'Paracetamol', dose: '500 mg', route: 'oral' })).status).toBe(201);
    const none = await give(s, { drug: 'Magnesium sulphate', dose: 'sample', route: 'IV' }, { highAlert: true });
    expect(none.body.error.fields['witness.email']).toMatch(/second person/);
    expect((await give(s, { drug: 'Magnesium sulphate', dose: 'sample', route: 'IV' }, { highAlert: true, witness: witness('nurse') })).body.error.fields['witness.email']).toBe('The second person must be someone else.');
    expect((await give(s, { drug: 'Magnesium sulphate', dose: 'sample', route: 'IV' }, { highAlert: true, witness: witness('elsewhere') })).body.error.fields['witness.email']).toMatch(/of this hospital/);
    expect((await give(s, { drug: 'Magnesium sulphate', dose: 'sample', route: 'IV' }, { highAlert: true, witness: witness('reception') })).body.error.fields['witness.email']).toMatch(/doctor, rmo, nurse/);
    expect((await give(s, { drug: 'Magnesium sulphate', dose: 'sample', route: 'IV' }, { highAlert: true, witness: witness('inactive') })).body.error.fields['witness.password']).toMatch(/not right/);
    const ok = await give(s, { drug: 'Magnesium sulphate', dose: 'sample', route: 'IV' }, { highAlert: true, witness: witness('nurse2') });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const entry = ok.body.nursing.find((e) => e.medicine?.drug === 'Magnesium sulphate');
    expect(entry).toMatchObject({ highAlert: true, witness: { byName: 'Sample nurse2', role: 'Nurse' } });
  });

  it('a medicine listed as high-alert in the formulary needs the second person even when not ticked; an amount discarded too', async () => {
    const s = await stay();
    await FormularyItem.create({ tenantId: hospital._id, name: 'Oxytocin', population: 'obstetric', doseBasis: 'fixed', doseMg: 1, source: 'Fake test row', highAlert: true, updatedByName: 'Sample' });
    expect((await give(s, { drug: 'oxytocin', dose: 'sample', route: 'IV' })).body.error.fields['witness.email']).toMatch(/second person/);
    expect((await give(s, { drug: 'Morphine', dose: 'sample', route: 'IV' }, { discarded: '2 mg (sample)' })).body.error.fields['witness.email']).toMatch(/second person/);
    const ok = await give(s, { drug: 'Morphine', dose: 'sample', route: 'IV' }, { discarded: '2 mg (sample)', witness: witness('drA') });
    expect(ok.body.nursing.find((e) => e.discarded)).toMatchObject({ discarded: '2 mg (sample)', witness: { byName: 'Sample drA', role: 'Doctor' } });
    expect((await AuditLog.findOne({ tenantId: hospital._id, action: 'WITNESS_CONFIRMED' }).lean()).details).toEqual({ purpose: 'medicine_discarded' });
  });

  it('three wrong passwords lock the second person’s email for 2 minutes, as at sign-in; the password is never stored or audited', async () => {
    const s = await stay();
    for (let i = 0; i < 2; i += 1) expect((await give(s, { drug: 'Insulin', dose: 'sample', route: 'SC' }, { highAlert: true, witness: witness('nurse2', 'wrong-password-1') })).status).toBe(400);
    const locked = await give(s, { drug: 'Insulin', dose: 'sample', route: 'SC' }, { highAlert: true, witness: witness('nurse2', 'wrong-password-1') });
    expect(locked.status).toBe(429);
    expect((await give(s, { drug: 'Insulin', dose: 'sample', route: 'SC' }, { highAlert: true, witness: witness('nurse2') })).status).toBe(429); // still locked
    const audited = await AuditLog.find({ action: { $in: ['WITNESS_FAILED', 'WITNESS_CONFIRMED'] } }).lean();
    expect(audited.filter((x) => x.action === 'WITNESS_FAILED')).toHaveLength(3);
    expect(JSON.stringify(audited)).not.toMatch(/wrong-password|SamplePassw0rd/);
    expect(JSON.stringify(await NursingEntry.find({ tenantId: hospital._id }).lean())).not.toMatch(/wrong-password|SamplePassw0rd/);
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 60 * 1000));
    sessions = {};
    expect((await give(s, { drug: 'Insulin', dose: 'sample', route: 'SC' }, { highAlert: true, witness: witness('nurse2') })).status).toBe(201);
  });
});
