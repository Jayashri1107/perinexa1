// Clinical Requirements Group C (PX-X-13): alerts that follow the patient – DRAFT list. Shown with her medical details
// on her record and, through the band, on her stay and her operation; added and ended (never deleted) by her doctor,
// RMOs and nurses. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { ALERT_KINDS, ALERT_SOURCE } from '../src/clinical/patientAlerts.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PatientAlert } from '../src/models/PatientAlert.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', admin: 'admin' };
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
  hospital = await createTenant('Alerts Hospital');
  other = await createTenant('Other Alerts Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.otherDr = await createUser({ name: 'Sample other doctor' });
  await addMember(people.otherDr, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function patient(over = {}) {
  return (await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Alert Mother', assignedDoctor: people.drA._id.toString(), ...over }))).body.patient;
}
const add = async (who, p, body) => (await as(who)).post('/api/patient-alerts').send({ patientId: p.id, ...body });

describe('alerts that follow the patient (DRAFT)', () => {
  it('the list is marked DRAFT and every kind has words', () => {
    expect(ALERT_SOURCE).toMatch(/^DRAFT/);
    for (const k of Object.values(ALERT_KINDS)) expect(k.label.length).toBeGreaterThan(3);
  });

  it('a nurse adds an alert; it shows on her record and in the band, with the allergy and blood group', async () => {
    const p = await patient();
    const r = await add('nurse', p, { kind: 'difficult_airway', note: 'Short neck, Mallampati 4' });
    expect(r.status).toBe(201);
    expect(r.body.alert).toMatchObject({ kind: 'difficult_airway', label: 'Difficult airway', byName: 'Sample nurse', ended: null });

    const rec = await (await as('drA')).get(`/api/patients/${p.id}`);
    expect(rec.body.patient.alerts).toEqual([expect.objectContaining({ label: 'Difficult airway', note: 'Short neck, Mallampati 4' })]);

    const band = await (await as('rmo')).get(`/api/patient-alerts/band?patientId=${p.id}`);
    expect(band.status).toBe(200);
    expect(band.body.patient).toMatchObject({ id: p.id, careType: p.careType, medical: expect.objectContaining({ bloodGroup: expect.any(String) }) });
    expect(band.body.alerts).toHaveLength(1);
    expect(band.body.access.write).toBe(true);

    const log = await AuditLog.find({ action: { $in: ['PATIENT_ALERT_ADDED', 'PATIENT_ALERTS_VIEWED'] } }).lean();
    expect(log.map((l) => l.action).sort()).toEqual(['PATIENT_ALERTS_VIEWED', 'PATIENT_ALERT_ADDED']);
    expect(JSON.stringify(log)).not.toContain('Mallampati');
  });

  it('a kind that needs words needs a note; the same kind twice is refused until ended', async () => {
    const p = await patient();
    const r = await add('drA', p, { kind: 'infection_precautions' });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.note).toMatch(/precaution/);
    expect((await add('drA', p, { kind: 'fall_risk' })).status).toBe(201);
    expect((await add('drA', p, { kind: 'fall_risk' })).status).toBe(409);
  });

  it('ending one keeps it with who and why; it leaves the band', async () => {
    const p = await patient();
    const a = (await add('drA', p, { kind: 'declines_blood', note: 'Accepts albumin' })).body.alert;
    expect((await (await as('nurse')).post(`/api/patient-alerts/${a.id}/end`).send({ reason: 'x' })).status).toBe(400);
    const e = await (await as('nurse')).post(`/api/patient-alerts/${a.id}/end`).send({ reason: 'She changed her decision, consent signed' });
    expect(e.status).toBe(200);
    expect(e.body.alert.ended).toMatchObject({ byName: 'Sample nurse', reason: 'She changed her decision, consent signed' });
    expect((await (await as('nurse')).post(`/api/patient-alerts/${a.id}/end`).send({ reason: 'Again please' })).status).toBe(409);
    expect((await (await as('drA')).get(`/api/patient-alerts/band?patientId=${p.id}`)).body.alerts).toEqual([]);
    const all = (await (await as('drA')).get(`/api/patient-alerts?patientId=${p.id}`)).body;
    expect(all.alerts).toHaveLength(1);
    expect(all.rules.source).toMatch(/^DRAFT/);
    expect(await PatientAlert.countDocuments({ tenantId: hospital._id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_ALERT_ENDED' })).toBe(1);
  });

  it('reception and the admin do not see or add them; another hospital cannot find the patient', async () => {
    const p = await patient();
    await add('drA', p, { kind: 'fall_risk' });
    expect((await (await as('reception')).get(`/api/patient-alerts/band?patientId=${p.id}`)).status).toBe(403);
    expect((await add('reception', p, { kind: 'fall_risk' })).status).toBe(403);
    expect((await (await as('admin')).get(`/api/patient-alerts?patientId=${p.id}`)).status).toBe(403);
    expect((await (await as('reception')).get(`/api/patients/${p.id}`)).body.patient.alerts).toBeUndefined();
    expect((await (await as('otherDr')).get(`/api/patient-alerts/band?patientId=${p.id}`)).status).toBe(404);
  });

  it('the fetal-sex protection applies to the note', async () => {
    const p = await patient();
    const r = await add('drA', p, { kind: 'other', note: 'Baby is a boy' });
    expect(r.status).toBe(400);
  });

  it('works out a MEOWS trigger and an open PPH chart on her current stay; they cannot be ended by hand', async () => {
    const p = await patient({ careType: 'postnatal' });
    const a = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-11-10T01:00:00.000Z', ward: 'Postnatal ward', bed: '3', reason: 'After delivery' })).body.admission;
    const band = async () => (await (await as('nurse')).get(`/api/patient-alerts/band?patientId=${p.id}`)).body.alerts;
    expect(await band()).toEqual([]);
    const m = await (await as('nurse')).post('/api/meows').send({ clientRequestId: randomUUID(), patientId: p.id, admissionId: a.id, at: '2026-11-10T05:30:00.000Z', rr: 32, spo2: 98, temp: 36.8, sbp: 118, dbp: 76, hr: 84, avpu: 'A', escalatedTo: 'Dr Sample' });
    expect(m.body.entry.level).toBe('trigger');
    await (await as('nurse')).post('/api/pph').send({ clientRequestId: randomUUID(), patientId: p.id, admissionId: a.id, recognisedAt: '2026-11-10T04:00:00.000Z', causes: ['tone'] });
    expect((await band()).map((x) => [x.label, x.auto])).toEqual([['MEOWS trigger', true], ['PPH chart open', true]]);
    expect((await (await as('drA')).get(`/api/patients/${p.id}`)).body.patient.alerts.map((x) => x.kind)).toEqual(['meows_trigger', 'pph_open']);
    // a normal set afterwards: the trigger goes
    await (await as('nurse')).post('/api/meows').send({ clientRequestId: randomUUID(), patientId: p.id, admissionId: a.id, at: '2026-11-10T05:50:00.000Z', rr: 16, spo2: 98, temp: 36.8, sbp: 118, dbp: 76, hr: 84, avpu: 'A' });
    expect((await band()).map((x) => x.kind)).toEqual(['pph_open']);
  });
});
