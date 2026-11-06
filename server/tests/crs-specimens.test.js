// Clinical Requirements Group A, item 3 (PX-OT-04, register OBG-L-05): specimens sent for histopathology – logged
// when sent, the report entered with its file, reviewed by a doctor or RMO, cancelled (never deleted), and the overdue
// list at 21 days. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Specimen } from '../src/models/Specimen.js';
import { OVERDUE_DAYS, overdue } from '../src/routes/specimens.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', admin: 'admin', lab: 'lab' };
const PDF = { fileName: 'hpe report.pdf', mediaType: 'application/pdf', data: Buffer.from('%PDF-1.4 sample report').toString('base64') };
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
  hospital = await createTenant('Specimen Hospital');
  other = await createTenant('Other Specimen Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.otherDr = await createUser({ name: 'Sample other doctor' });
  await addMember(people.otherDr, other, 'doctor');
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function registered(over = {}) {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Specimen Patient', assignedDoctor: people.drA._id.toString(), ...over }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const sample = (p, over = {}) => ({ clientRequestId: randomUUID(), patientId: p.id, kind: 'histopathology', specimen: 'Uterus with cervix', procedure: 'Total abdominal hysterectomy', collectedAt: '2026-11-09T05:00:00.000Z', sentAt: '2026-11-09T09:00:00.000Z', lab: 'Sample Pathology Lab', ...over });
const log = async (p, over, who = 'rmo') => (await as(who)).post('/api/specimens').send(sample(p, over));

describe('the specimen register', () => {
  it('logs a specimen with a per-hospital serial number, enters its report with the file, and a doctor reviews it', async () => {
    const p = await registered();
    const first = await log(p);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.specimen).toMatchObject({ serial: 1, status: 'sent', days: 0, overdue: false, patient: { fullName: 'Specimen Patient' }, createdByName: 'Sample rmo' });
    expect((await log(p, {}, 'nurse')).body.specimen.serial).toBe(2);
    const id = first.body.specimen.id;

    const reported = await (await as('nurse')).post(`/api/specimens/${id}/report`).send({ receivedAt: '2026-11-10T04:00:00.000Z', summary: 'Leiomyoma. No malignancy.', file: PDF });
    expect(reported.status, JSON.stringify(reported.body)).toBe(200);
    expect(reported.body.specimen).toMatchObject({ status: 'reported', report: { summary: 'Leiomyoma. No malignancy.', byName: 'Sample nurse', file: { fileName: 'hpe report.pdf', mediaType: 'application/pdf' } } });
    const file = await (await as('drA')).get(`/api/specimens/${id}/file`);
    expect([file.status, file.headers['content-type']]).toEqual([200, 'application/pdf']);

    expect((await (await as('nurse')).post(`/api/specimens/${id}/review`).send({ note: 'Seen' })).status).toBe(403); // doctors and RMOs review
    const reviewed = await (await as('drA')).post(`/api/specimens/${id}/review`).send({ note: 'Told her in OPD.', informedAt: '2026-11-10T05:30:00.000Z' });
    expect(reviewed.body.specimen).toMatchObject({ status: 'reviewed', review: { note: 'Told her in OPD.', byName: 'Sample drA' } });
    expect((await (await as('drA')).post(`/api/specimens/${id}/report`).send({ receivedAt: '2026-11-10T04:00:00.000Z', summary: 'Again' })).status).toBe(409);

    const actions = (await AuditLog.find({ tenantId: hospital._id, action: /^SPECIMEN/ }).lean()).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['SPECIMEN_LOGGED', 'SPECIMEN_REPORTED', 'SPECIMEN_REPORT_OPENED', 'SPECIMEN_REVIEWED']));
    expect(JSON.stringify(await AuditLog.find({ action: /^SPECIMEN/ }).lean())).not.toMatch(/Leiomyoma|Uterus/); // ids only
  });

  it('is overdue after 21 days without a report; the overdue list shows only those', async () => {
    expect(OVERDUE_DAYS).toBe(21);
    expect(overdue({ status: 'sent', sentAt: '2026-10-19T06:00:00Z' }, NOW)).toEqual({ days: 22, overdue: true });
    expect(overdue({ status: 'sent', sentAt: '2026-10-20T06:00:00Z' }, NOW)).toEqual({ days: 21, overdue: false });
    expect(overdue({ status: 'reported', sentAt: '2026-09-01T06:00:00Z' }, NOW).overdue).toBe(false);
    const p = await registered();
    await log(p, { collectedAt: '2026-10-10T05:00:00.000Z', sentAt: '2026-10-10T06:00:00.000Z', specimen: 'Endometrial curettings' });
    await log(p);
    const list = await (await as('rmo')).get('/api/specimens?show=overdue');
    expect(list.body.specimens.map((s) => [s.specimen, s.days, s.overdue])).toEqual([['Endometrial curettings', 31, true]]);
    expect((await (await as('rmo')).get('/api/specimens?show=open')).body.specimens).toHaveLength(2);
    expect((await (await as('rmo')).get(`/api/specimens?show=all&patientId=${p.id}`)).body.specimens).toHaveLength(2);
  });

  it('checks the times, and a mistake is cancelled with a reason, never deleted', async () => {
    const p = await registered();
    expect((await log(p, { sentAt: '2026-11-09T04:00:00.000Z' })).body.error.fields.sentAt).toMatch(/after it was collected/);
    expect((await log(p, { sentAt: '2026-11-12T04:00:00.000Z' })).body.error.fields.sentAt).toMatch(/future/);
    const s = (await log(p)).body.specimen;
    expect((await (await as('rmo')).post(`/api/specimens/${s.id}/cancel`).send({ reason: '' })).status).toBe(400);
    const cancelled = await (await as('rmo')).post(`/api/specimens/${s.id}/cancel`).send({ reason: 'Logged on the wrong record' });
    expect(cancelled.body.specimen).toMatchObject({ status: 'cancelled', cancelled: { reason: 'Logged on the wrong record' } });
    expect(await Specimen.countDocuments({ tenantId: hospital._id })).toBe(1);
  });

  it('only doctors, RMOs and nurses; a sensitive record only for those who see it in full; never another hospital', async () => {
    const p = await registered();
    const s = (await log(p)).body.specimen;
    for (const who of ['reception', 'admin', 'lab']) expect((await (await as(who)).get('/api/specimens')).status, who).toBe(403);
    expect((await (await as('otherDr')).get(`/api/specimens/${s.id}`)).status).toBe(404);
    expect((await (await as('otherDr')).get('/api/specimens?show=all')).body.specimens).toEqual([]);

    const secret = await registered({ fullName: 'Sensitive Patient', careType: 'infertility' }); // sensitive by itself
    await log(secret, {}, 'drA');
    const names = async (who) => (await (await as(who)).get('/api/specimens?show=all')).body.specimens.map((x) => x.patient.fullName);
    expect(await names('drA')).toContain('Sensitive Patient');
    expect(await names('nurse')).not.toContain('Sensitive Patient');
    expect(await names('drB')).not.toContain('Sensitive Patient');
    expect((await log(secret, {}, 'nurse')).status).toBe(403);
  });
});
