// Clinical Requirements Group A, item 7 (owner's decision 9): one formulary, verified once – a dose is worked out only
// from a row a doctor and the pharmacist have both confirmed; any change makes it unverified again; it starts empty.
// The doses below are FAKE test numbers, not clinical content. Fake data only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { FormularyItem } from '../src/models/FormularyItem.js';
import { doseFor } from '../src/routes/formulary.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const ROLES = { drA: 'doctor', drB: 'doctor', pharm: 'pharmacist', nurse: 'nurse', reception: 'receptionist', both: ['doctor', 'pharmacist'] };
let app;
let hospital;
let people;
let sessions;
const ROW = { name: 'Testmedicine', form: 'Injection', strength: '10 mg/mL', route: 'IV', population: 'neonatal', indication: 'Test only', doseBasis: 'per_kg', doseMg: 5, frequency: 'every 12 hours', maxSingleMg: 12, maxDailyMg: 24, source: 'Fake test row' };

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  app = createApp();
  hospital = await createTenant('Formulary Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));

describe('the formulary', () => {
  it('starts empty: Perinexa ships no doses', async () => {
    const list = await (await as('nurse')).get('/api/formulary');
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
    expect(await FormularyItem.countDocuments({ tenantId: hospital._id })).toBe(0);
  });

  it('an unverified row calculates nothing; with a doctor and the pharmacist it is verified and works the dose out', async () => {
    const added = await (await as('drA')).post('/api/formulary').send(ROW);
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const id = added.body.item.id;
    expect(added.body.item).toMatchObject({ verified: false, version: 1, confirmations: [] });
    const refused = await (await as('nurse')).post(`/api/formulary/${id}/dose`).send({ weightKg: 2 });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'NOT_VERIFIED']);

    const one = await (await as('drB')).post(`/api/formulary/${id}/confirm`).send({ version: 1 });
    expect(one.body.item).toMatchObject({ verified: false, confirmations: [{ role: 'doctor', byName: 'Sample drB' }] });
    expect((await (await as('drA')).post(`/api/formulary/${id}/confirm`).send({ version: 1 })).status).toBe(409); // a second doctor is not the pharmacist
    expect((await (await as('nurse')).post(`/api/formulary/${id}/dose`).send({ weightKg: 2 })).status).toBe(409);
    const two = await (await as('pharm')).post(`/api/formulary/${id}/confirm`).send({ version: 1 });
    expect(two.body.item.verified).toBe(true);

    const dose = await (await as('nurse')).post(`/api/formulary/${id}/dose`).send({ weightKg: 2 });
    expect(dose.body.dose).toEqual({ mg: 10, capped: false, frequency: 'every 12 hours', maxDailyMg: 24 });
    expect((await (await as('nurse')).post(`/api/formulary/${id}/dose`).send({ weightKg: 3 })).body.dose).toMatchObject({ mg: 12, capped: true });
  });

  it('a change makes a new version and clears both confirmations', async () => {
    const id = (await (await as('drA')).post('/api/formulary').send(ROW)).body.item.id;
    await (await as('drA')).post(`/api/formulary/${id}/confirm`).send({ version: 1 });
    await (await as('pharm')).post(`/api/formulary/${id}/confirm`).send({ version: 1 });
    expect((await (await as('drB')).put(`/api/formulary/${id}`).send({ ...ROW, version: 0 })).status).toBe(409);
    const changed = await (await as('pharm')).put(`/api/formulary/${id}`).send({ ...ROW, doseMg: 4, version: 1 });
    expect(changed.body.item).toMatchObject({ version: 2, verified: false, confirmations: [], doseMg: 4 });
    expect((await (await as('nurse')).post(`/api/formulary/${id}/dose`).send({ weightKg: 2 })).status).toBe(409);
  });

  it('one person with both roles never verifies a row alone; nurses and RMOs only read; reception has no formulary', async () => {
    const id = (await (await as('drA')).post('/api/formulary').send(ROW)).body.item.id;
    expect((await (await as('both')).post(`/api/formulary/${id}/confirm`).send({ version: 1 })).body.item.confirmations).toHaveLength(1);
    expect((await (await as('both')).post(`/api/formulary/${id}/confirm`).send({ version: 1 })).status).toBe(409);
    expect((await (await as('nurse')).post('/api/formulary').send(ROW)).status).toBe(403);
    expect((await (await as('nurse')).post(`/api/formulary/${id}/confirm`).send({ version: 1 })).status).toBe(403);
    expect((await (await as('reception')).get('/api/formulary')).status).toBe(403);
    expect((await (await as('drA')).post('/api/formulary').send({ ...ROW, source: '' })).body.error.fields.source).toMatch(/where it comes from/);
  });

  it('works a fixed dose out without the weight mattering, and caps at the maximum single dose', () => {
    expect(doseFor({ doseBasis: 'fixed', doseMg: 40, maxSingleMg: null, frequency: 'once daily', maxDailyMg: null }, 80)).toEqual({ mg: 40, capped: false, frequency: 'once daily', maxDailyMg: null });
    expect(doseFor({ doseBasis: 'per_kg', doseMg: 2.5, maxSingleMg: 5, frequency: '', maxDailyMg: null }, 3)).toMatchObject({ mg: 5, capped: true });
    expect(doseFor({ doseBasis: 'per_kg', doseMg: 0.333, maxSingleMg: null, frequency: '', maxDailyMg: null }, 1.5).mg).toBe(0.5);
  });
});
