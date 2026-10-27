// The history-taking sheet (docs/HISTORY_SHEET_LAYOUT.md, owner 27 Oct 2026): saved by a doctor or RMO on registration
// and in Edit details, a clinical detail (reception does not see it), refused on a baby's record, checked for words
// about a baby's sex on a pregnancy record, and audited as one field. All fake sample data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as fields from '../src/patients/historyFields.js';
import { HISTORY_TEXTS, SEX_CHECKED_TEXTS } from '../src/patients/historyFields.js';
import { mentionsFetalSex } from '../src/utils/pcpndt.js';
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
    // The website checks the same texts for words about a baby's sex before saving (all but Previous deliveries)
    expect(website.SEX_CHECKED_TEXTS).toEqual(fields.SEX_CHECKED_TEXTS);
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

  it("refuses numbers out of range and a baby's record", async () => {
    const bad = await sessions.rmo.post('/api/patients').send(samplePatient({ fullName: 'Range Sample', careType: 'gynaecology', history: { marriedSinceYears: 99 } }));
    expect(bad.status).toBe(400);
    const baby = await sessions.rmo.post('/api/patients').send(samplePatient({ fullName: 'B/o Sample', careType: 'newborn', history: { complaint: 'x' } }));
    expect(baby.status).toBe(400);
  });
});

// Words about a child's sex (PCPNDT Act) – the owner's decision 4 of 27 Oct 2026, reviewed by the developer with the
// owner: allowed ONLY where a child already born is described (Previous deliveries, the table of previous pregnancies).
// Everything else on a pregnancy record keeps the refusal.
describe("words about a child's sex on the history-taking sheet", () => {
  const BORN = 'One full-term normal delivery in 2023, male child, 2.9 kg, alive and well';
  const register = (careType, history, extra = {}) => sessions.rmo.post('/api/patients').send(samplePatient({ fullName: `Sex Words ${Math.random().toString(36).slice(2, 7)}`, careType, history, ...extra }));

  it('the words this check looks for really are refused elsewhere (the exception is not a gap in the word list)', async () => {
    expect(mentionsFetalSex(BORN)).toBe(true);
    expect(mentionsFetalSex('female baby, jaundice treated')).toBe(true);
  });

  it('allows them in Previous deliveries and the rows of previous pregnancies, on registration and in Edit details', async () => {
    for (const careType of ['antenatal', 'abortion', 'gynaecology']) {
      const res = await register(careType, { previousDeliveries: BORN, pregnancies: [{ year: 2023, outcome: 'live_birth', place: 'Sample Hospital', problems: 'female baby, jaundice treated' }] });
      expect(res.status, `${careType}: ${JSON.stringify(res.body)}`).toBe(201);
      const id = res.body.patient.id;
      expect((await sessions.rmo.get(`/api/patients/${id}`)).body.patient.history.previousDeliveries).toBe(BORN);
      const edit = await sessions.rmo.patch(`/api/patients/${id}`).send({ history: { previousDeliveries: `${BORN}; second a girl in 2025` } });
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    }
  });

  it("keeps refusing them in every other text of the sheet on a pregnancy record – on registration and in Edit details", async () => {
    expect(SEX_CHECKED_TEXTS).not.toContain('previousDeliveries');
    expect(SEX_CHECKED_TEXTS.length).toBe(Object.keys(HISTORY_TEXTS).length - 1);
    const ok = (await register('antenatal', { complaint: 'Pain' })).body.patient.id;
    for (const key of SEX_CHECKED_TEXTS) {
      const res = await register('antenatal', { [key]: 'Wants to know if it is a boy' });
      expect(res.status, key).toBe(400);
      expect(res.body.error.fields[`history.${key}`], key).toBeTruthy();
      const edit = await sessions.rmo.patch(`/api/patients/${ok}`).send({ history: { [key]: 'Wants to know if it is a boy' } });
      expect(edit.status, `edit ${key}`).toBe(400);
    }
    // The abortion type of care too
    expect((await register('abortion', { otherHistory: 'the baby was a girl' })).status).toBe(400);
  });

  it("keeps refusing them in the record's own notes and medical text, even next to an allowed Previous deliveries", async () => {
    const res = await register('antenatal', { previousDeliveries: BORN }, { notes: 'scan shows a boy' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.notes).toBeTruthy();
    expect(res.body.error.fields['history.previousDeliveries']).toBeUndefined();
    const allergy = await register('antenatal', { previousDeliveries: BORN }, { medical: { allergies: 'male baby' } });
    expect(allergy.status).toBe(400);
  });
});
