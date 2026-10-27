// This pregnancy's details (docs/HISTORY_SHEET_LAYOUT.md section 1, the owner's go-ahead of 27 Oct 2026): recorded at
// the visit with PATCH /api/patients/:id – planned, conception, folic acid, medicines and symptoms so far. Merged one
// field at a time, a clinical detail (reception neither sees nor changes them), and the two texts refuse words about
// the baby's sex. All fake sample data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { CONCEPTION, FOLIC_ACID, PLANNED } from '../src/patients/historyFields.js';
import * as website from '../../client/src/pages/patients/historyFormat.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

let sessions;
let id;
beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  const app = createApp();
  const hospital = await createTenant('Pregnancy Hospital');
  sessions = {};
  for (const [key, role] of Object.entries({ rmo: 'rmo', reception: 'receptionist' })) {
    const u = await createUser({ name: `Sample ${key}` });
    await addMember(u, hospital, role);
    sessions[key] = await loginAs(u, { app });
  }
  const res = await sessions.rmo.post('/api/patients').send(samplePatient({ fullName: 'Pregnancy Sample', careType: 'antenatal', pregnancy: { lmp: '2026-08-01' } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  id = res.body.patient.id;
});

const pregnancyOf = async (s = sessions.rmo) => (await s.get(`/api/patients/${id}`)).body.patient.pregnancy;

describe("this pregnancy's details", () => {
  it('keeps the same lists as the website', () => {
    expect(Object.keys(website.PLANNED_LABELS)).toEqual(PLANNED);
    expect(Object.keys(website.CONCEPTION_LABELS)).toEqual(CONCEPTION);
    expect(Object.keys(website.FOLIC_ACID_LABELS)).toEqual(FOLIC_ACID);
    expect(website.pregnancyDetailLines({ planned: 'yes', conception: 'iui', symptoms: ' ' })).toEqual([
      ['Planned', 'Planned'],
      ['Conception', 'IUI'],
    ]);
  });

  it('are saved at the visit one field at a time, without touching the LMP', async () => {
    const first = await sessions.rmo.patch(`/api/patients/${id}`).send({ pregnancy: { planned: 'yes', conception: 'ovulation_induction', folicAcid: 'before' } });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await sessions.rmo.patch(`/api/patients/${id}`).send({ pregnancy: { medicinesTaken: 'Folic acid 5 mg daily', symptoms: 'Nausea in the mornings' } });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const p = await pregnancyOf();
    expect(p).toMatchObject({ planned: 'yes', conception: 'ovulation_induction', folicAcid: 'before', medicinesTaken: 'Folic acid 5 mg daily', symptoms: 'Nausea in the mornings' });
    expect(String(p.lmp).slice(0, 10)).toBe('2026-08-01');
    // Back to "not recorded"
    expect((await sessions.rmo.patch(`/api/patients/${id}`).send({ pregnancy: { planned: '' } })).status).toBe(200);
    expect((await pregnancyOf()).planned).toBe('');
  });

  it('refuses a choice not on the list, and reception changing them', async () => {
    const bad = await sessions.rmo.patch(`/api/patients/${id}`).send({ pregnancy: { conception: 'surrogacy' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields['pregnancy.conception']).toBeTruthy();
    expect((await sessions.reception.patch(`/api/patients/${id}`).send({ pregnancy: { planned: 'yes' } })).status).toBe(403);
  });

  it("refuses words about the baby's sex in the medicines and symptoms", async () => {
    for (const key of ['medicinesTaken', 'symptoms']) {
      const res = await sessions.rmo.patch(`/api/patients/${id}`).send({ pregnancy: { [key]: 'Wants to know if it is a boy' } });
      expect(res.status, key).toBe(400);
      expect(res.body.error.fields[`pregnancy.${key}`], key).toBeTruthy();
    }
    const p = await pregnancyOf();
    expect(p.medicinesTaken ?? '').toBe('');
    expect(p.symptoms ?? '').toBe('');
  });
});
