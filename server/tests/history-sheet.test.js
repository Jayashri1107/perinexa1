// The history-taking sheet (docs/HISTORY_SHEET_LAYOUT.md, owner 27 Oct 2026): saved by a doctor or RMO on registration
// and in Edit details, a clinical detail (reception does not see it), refused on a baby's record, checked for words
// about a baby's sex on a pregnancy record, and audited as one field. All fake sample data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as fields from '../src/patients/historyFields.js';
import { AuditLog } from '../src/models/AuditLog.js';
import * as website from '../../client/src/pages/patients/historyFormat.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

let hospital;
let sessions;
beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  const app = createApp();
  hospital = await createTenant('History Hospital');
  sessions = {};
  for (const [key, role] of Object.entries({ rmo: 'rmo', reception: 'receptionist' })) {
    const u = await createUser({ name: `Sample ${key}` });
    await addMember(u, hospital, role);
    sessions[key] = await loginAs(u, { app });
  }
});

const SHEET = {
  complaint: '28 years, pain in the lower abdomen for 3 days',
  cycle: 'regular',
  marriedSinceYears: 4,
  consanguinity: 'no',
  previousDeliveries: 'One full-term normal delivery in 2023, 2.9 kg, alive and well',
  otherHistory: 'Appendix operation in 2015',
  menarcheAge: 13,
  flow: 'normal',
  family: ['diabetes'],
  familyWho: 'Mother',
  pregnancies: [{ year: 2023, outcome: 'live_birth', weeks: 39, mode: 'normal', weightGrams: 2900, aliveNow: 'yes' }],
  td: 'done',
};

describe('the history-taking sheet', () => {
  it('keeps the same lists as the website', () => {
    for (const k of ['CYCLE_KINDS', 'YES_NO', 'FLOW', 'PERIOD_PAIN', 'PREGNANCY_OUTCOMES', 'BIRTH_MODES', 'IMMUNISATION_STATUS', 'FAMILY_HISTORY', 'DIETS', 'HABIT']) {
      expect(Object.keys(website.HISTORY_LABELS[k]), k).toEqual(fields[k]);
    }
    expect(fields.historyEmpty(null)).toBe(true);
    expect(fields.historyEmpty({ complaint: '  ' })).toBe(true);
    expect(fields.historyEmpty({ cycle: 'regular' })).toBe(false);
  });

  it('is saved by an RMO, merged in Edit details, hidden from reception, and audited as one field', async () => {
    const res = await sessions.rmo.post('/api/patients').send(samplePatient({ fullName: 'History Sample', careType: 'gynaecology', history: SHEET }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.patient.id;
    const seen = (await sessions.rmo.get(`/api/patients/${id}`)).body.patient;
    expect(seen.history).toMatchObject({ complaint: SHEET.complaint, cycle: 'regular', marriedSinceYears: 4, family: ['diabetes'] });
    expect(seen.history.pregnancies[0]).toMatchObject({ year: 2023, outcome: 'live_birth', weightGrams: 2900 });

    const edit = await sessions.rmo.patch(`/api/patients/${id}`).send({ history: { ...SHEET, cycle: 'irregular', otherHistory: 'No operations' } });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await sessions.rmo.get(`/api/patients/${id}`)).body.patient.history).toMatchObject({ cycle: 'irregular', otherHistory: 'No operations', complaint: SHEET.complaint });
    const entry = await AuditLog.findOne({ action: 'PATIENT_UPDATED' }).lean();
    expect(entry.details.fields).toEqual(['history']);

    expect((await sessions.reception.get(`/api/patients/${id}`)).body.patient.history).toBeUndefined();
    expect((await sessions.reception.patch(`/api/patients/${id}`).send({ history: { complaint: 'x' } })).status).toBe(403);
  });

  it("refuses numbers out of range, a baby's record, and words about a baby's sex on a pregnancy record", async () => {
    const bad = await sessions.rmo.post('/api/patients').send(samplePatient({ fullName: 'Range Sample', careType: 'gynaecology', history: { marriedSinceYears: 99 } }));
    expect(bad.status).toBe(400);
    const baby = await sessions.rmo.post('/api/patients').send(samplePatient({ fullName: 'B/o Sample', careType: 'newborn', history: { complaint: 'x' } }));
    expect(baby.status).toBe(400);
    const sex = await sessions.rmo.post('/api/patients').send(samplePatient({ fullName: 'Word Sample', careType: 'antenatal', history: { previousDeliveries: 'It is a boy' } }));
    expect(sex.status).toBe(400);
    expect(sex.body.error.fields['history.previousDeliveries']).toBeTruthy();
    const row = await sessions.rmo.post('/api/patients').send(samplePatient({ fullName: 'Row Sample', careType: 'antenatal', history: { pregnancies: [{ year: 2022, problems: 'female baby' }] } }));
    expect(row.status).toBe(400);
  });
});
