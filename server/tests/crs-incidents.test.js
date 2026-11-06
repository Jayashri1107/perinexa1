// Clinical Requirements Group A, item 6 (PX-X-10): incident reporting – report, the quality lead's review, actions,
// closure – kept out of the patient's record and its copy; the automatic incident for a category 1 caesarean over
// 30 minutes (PX-OBG-14). Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/incidents/incidentFormat.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { INCIDENT_KINDS, SEVERITIES } from '../src/incidents/incidentKinds.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Incident } from '../src/models/Incident.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', lead: 'quality', admin: 'admin', reception: 'receptionist' };
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
  hospital = await createTenant('Incident Hospital');
  other = await createTenant('Other Incident Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.otherLead = await createUser({ name: 'Sample other lead' });
  await addMember(people.otherLead, other, 'quality');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const report = async (who, over = {}) => (await as(who)).post('/api/incidents').send({ clientRequestId: randomUUID(), occurredAt: '2026-11-10T03:00:00.000Z', place: 'Labour ward', kind: 'medication', severity: 'mild', description: 'Oxytocin infusion started at twice the written rate; stopped after 10 minutes.', immediateAction: 'Infusion stopped, doctor told.', ...over });
async function registered() {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Sample Mother', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-11-12' } }));
  return res.body.patient;
}

describe('incident reporting', () => {
  it('anyone reports; the reporter sees their own; the lead reviews, adds actions, marks them done and closes', async () => {
    const r = await report('nurse');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.incident).toMatchObject({ serial: 1, status: 'reported', reported: { byName: 'Sample nurse', mine: true } });
    expect((await report('reception', { kind: 'fall', severity: 'none', description: 'Visitor slipped at the entrance.' })).body.incident.serial).toBe(2);
    const id = r.body.incident.id;

    const mine = await (await as('nurse')).get('/api/incidents?show=all');
    expect(mine.body.incidents.map((i) => i.serial)).toEqual([1]); // only her own
    expect((await (await as('reception')).get(`/api/incidents/${id}`)).status).toBe(404);
    expect((await (await as('nurse')).post(`/api/incidents/${id}/review`).send({ findings: 'x', severity: 'mild' })).status).toBe(403);

    const lead = await as('lead');
    expect((await lead.post(`/api/incidents/${id}/close`).send({ summary: 'Done' })).body.error.fields.summary).toMatch(/Review/);
    const reviewed = await lead.post(`/api/incidents/${id}/review`).send({ findings: 'Pump set in mL/h instead of drops.', causes: 'Two kinds of pump on the ward.', severity: 'moderate' });
    expect(reviewed.body.incident).toMatchObject({ status: 'reviewed', severity: 'moderate', reportedSeverity: 'mild' });
    const withAction = await lead.post(`/api/incidents/${id}/actions`).send({ text: 'One pump type on the labour ward', owner: 'Nursing superintendent', dueOn: '2026-12-01' });
    const actionId = withAction.body.incident.actions[0].id;
    expect((await lead.post(`/api/incidents/${id}/close`).send({ summary: 'Done' })).body.error.fields.summary).toMatch(/Every action/);
    await lead.post(`/api/incidents/${id}/actions/${actionId}/done`).send({ note: 'Old pumps removed' });
    const closed = await lead.post(`/api/incidents/${id}/close`).send({ summary: 'Pumps standardised.' });
    expect(closed.body.incident).toMatchObject({ status: 'closed', closure: { summary: 'Pumps standardised.', byName: 'Sample lead' } });
    expect((await (await as('nurse')).get(`/api/incidents/${id}`)).body.incident).toMatchObject({ status: 'closed', actionsOpen: 0 });
    expect((await (await as('nurse')).get(`/api/incidents/${id}`)).body.incident.review).toBeUndefined(); // the review is the lead's

    const audited = await AuditLog.find({ tenantId: hospital._id, action: /^INCIDENT/ }).lean();
    expect(audited.map((e) => e.action)).toEqual(expect.arrayContaining(['INCIDENT_REPORTED', 'INCIDENT_REVIEWED', 'INCIDENT_ACTION_ADDED', 'INCIDENT_ACTION_DONE', 'INCIDENT_CLOSED']));
    expect(JSON.stringify(audited)).not.toMatch(/Oxytocin|pump/i);
  });

  it('may name a patient by her number: the lead sees her, the admin and the reporter do not, and her record and its copy never show it', async () => {
    const p = await registered();
    expect((await report('nurse', { patientNo: 'P-999999' })).body.error.fields.patientNo).toMatch(/No patient/);
    const r = await report('nurse', { patientNo: p.mrn });
    expect(r.body.incident.patient).toBeUndefined();
    expect((await (await as('lead')).get(`/api/incidents/${r.body.incident.id}`)).body.incident.patient).toEqual({ id: p.id, fullName: 'Sample Mother', mrn: p.mrn });
    const admin = (await (await as('admin')).get('/api/incidents?show=all')).body.incidents[0];
    expect(admin.patient).toBeUndefined();
    expect(admin.description).toMatch(/Oxytocin/);
    const record = await (await as('drA')).get(`/api/patients/${p.id}`);
    const words = JSON.stringify(record.body);
    expect(words).not.toMatch(/incident/i);
    expect(words).not.toMatch(/Oxytocin/);
    const copy = await (await as('drA')).get(`/api/patients/${p.id}/record-copy`);
    expect(copy.status).toBe(200);
    expect(JSON.stringify(copy.body)).not.toMatch(/Oxytocin|incident/i);
    expect((await (await as('lead')).get(`/api/patients/${p.id}`)).status).toBe(403); // the lead never opens the record
  });

  it('a category 1 caesarean confirmed more than 30 minutes after the decision is reported by itself, once', async () => {
    const p = await registered();
    const base = `/api/patients/${p.id}/admissions`;
    const a = (await (await as('rmo')).post(base).send({ clientRequestId: randomUUID(), admittedAt: '2026-11-08T02:00:00.000Z', ward: 'Labour ward', bed: '1', reason: 'In labour' })).body.admission;
    const d = (await (await as('rmo')).post(`${base}/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
    const content = { deliveredAt: '2026-11-08T05:30:00.000Z', mode: 'lscs', indication: 'Cord prolapse', csCategory: '1', decisionAt: '2026-11-08T04:50:00.000Z', gestationWeeks: 39, labourOnset: 'spontaneous', parity: 'nullipara', presentation: 'cephalic', bloodLossMl: 800, babies: [{ outcome: 'live', sex: 'male', weightGrams: 3200 }] };
    const saved = (await (await as('rmo')).put(`${base}/${a.id}/documents/${d.id}`).send({ rev: d.rev, content })).body.document;
    expect((await (await as('drA')).post(`${base}/${a.id}/documents/${d.id}/sign`).send({ rev: saved.rev })).status).toBe(200);
    const list = (await (await as('lead')).get('/api/incidents?show=open')).body.incidents;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'caesarean_delay', automatic: true, reported: { byName: 'Perinexa (delivery note)' }, patient: { mrn: p.mrn } });
    expect(list[0].description).toMatch(/40 minutes/);
    expect(list[0].description).not.toMatch(/Sample Mother/);
    expect(await Incident.countDocuments({ tenantId: hospital._id })).toBe(1);
  });

  it('another hospital never sees them; the website offers the same kinds and degrees of harm', async () => {
    await report('nurse');
    expect((await (await as('otherLead')).get('/api/incidents?show=all')).body.incidents).toEqual([]);
    expect(website.INCIDENT_KINDS).toEqual(INCIDENT_KINDS);
    expect(website.SEVERITIES).toEqual(SEVERITIES);
    expect((await report('nurse', { occurredAt: '2026-11-11T03:00:00.000Z' })).body.error.fields.occurredAt).toMatch(/future/);
  });
});
