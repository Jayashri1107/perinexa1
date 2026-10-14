// Registration fields other hospitals' software asks for (owner, 14 Oct 2026): the address's PIN code, city and state,
// who referred her, and who pays (with the card or policy number). All optional. Reception enters and sees them;
// billing sees only who pays; lab staff see none. FAKE SAMPLE DATA ONLY.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const ROLES = { reception: 'receptionist', drA: 'doctor', lab: 'lab', billing: 'billing' };
let app;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  app = createApp();
  const hospital = await createTenant('Registration Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const PAYER = { type: 'govt_scheme', name: 'Sample scheme', number: 'SMP-0001' };

describe('PIN code, city, state, referred by and who pays', () => {
  it('reception registers and changes them; billing sees who pays only; lab sees none', async () => {
    const res = await (await as('reception')).post('/api/patients').send(samplePatient({ pinCode: '411001', city: 'Pune', state: 'Maharashtra', referredBy: 'Sample Clinic', payer: PAYER }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.patient).toMatchObject({ pinCode: '411001', city: 'Pune', state: 'Maharashtra', referredBy: 'Sample Clinic', payer: PAYER });
    const id = res.body.patient.id;

    const changed = await (await as('reception')).patch(`/api/patients/${id}`).send({ payer: { type: 'self', name: '', number: '' }, pinCode: '411002' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.patient).toMatchObject({ pinCode: '411002', payer: { type: 'self' } });

    const billing = (await (await as('billing')).get(`/api/patients/${id}`)).body.patient;
    expect(billing.payer).toMatchObject({ type: 'self' });
    expect(billing.pinCode).toBeUndefined();
    expect(billing.referredBy).toBeUndefined();
    const lab = (await (await as('lab')).get(`/api/patients/${id}`)).body.patient;
    expect(lab.payer).toBeUndefined();
    expect(lab.city).toBeUndefined();
  });

  it('refuses a PIN code that is not 6 digits, and a card number without who pays', async () => {
    const pin = await (await as('reception')).post('/api/patients').send(samplePatient({ pinCode: '41100' }));
    expect(pin.status).toBe(400);
    expect(pin.body.error.fields.pinCode).toMatch(/6 digits/);
    const payer = await (await as('reception')).post('/api/patients').send(samplePatient({ payer: { type: '', name: '', number: 'X1' } }));
    expect(payer.status).toBe(400);
    expect(payer.body.error.fields['payer.type']).toMatch(/who pays/);
  });

  it('a record registered before keeps working (the fields are empty)', async () => {
    const res = await (await as('reception')).post('/api/patients').send(samplePatient());
    expect(res.status).toBe(201);
    expect(res.body.patient).toMatchObject({ pinCode: '', city: '', state: '', referredBy: '', payer: { type: '', name: '', number: '' } });
  });
});
