// Sonography stage 2 (owner's approval, 12 Nov 2026 – docs/USG_APPS_REVIEW.md U1, U3, U5): the reference tables the// doctors copy in and approve, sent with a scan only when approved; the fetal Doppler template. The table numbers here// are made up for the tests – never clinical values. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';

import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T05:30:00Z');
// drA: her doctor (orders, sees the signed report); sono: sonography staff; sonoDr: a doctor who scans and signs
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', sono: 'sonographer', sonoDr: ['doctor', 'sonographer'], nurse: 'nurse' };
let app;
let hospital;
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
  hospital = await createTenant('Scan Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function mother(doctor = 'drA') {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Scan Mother', assignedDoctor: people[doctor]._id.toString(), pregnancy: { scanEdd: '2027-01-05' } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
// Ordered, done, reported with these values and signed by her doctor
async function signedScan(p, study, values) {
  let s = (await (await as('drA')).post(`/api/patients/${p.id}/imaging`).send({ clientRequestId: randomUUID(), study, indication: 'Sample indication' })).body.study;
  s = (await (await as('sono')).post(`/api/imaging/${s.id}/done`).send({ rev: s.rev })).body.study;
  const saved = await (await as('sono')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, values, findings: 'Sample findings.', impression: 'Sample impression.' });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const signed = await (await as('sonoDr')).post(`/api/imaging/${s.id}/sign`).send({ rev: saved.body.study.rev });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return signed.body.study;
}

const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const refs = async (method, path, body, who = 'drA') => (await as(who))[method](`/api/usg-references${path}`).send(body);
// Made-up numbers for the tests only
const ROWS = [
  { week: 30, p5: 1.0, p50: 1.2, p95: 1.4 },
  { week: 32, p5: 0.9, p50: 1.1, p95: 1.3 },
];

describe('the reference tables', () => {
  it('none built in; a doctor copies one in as a DRAFT and a doctor approves it; others read, never write', async () => {
    const list = ok(await refs('get', '', undefined, 'sono')).references;
    expect(list.map((r) => r.key)).toEqual(['bpd', 'hc', 'ac', 'fl', 'efw', 'uaPi', 'mcaPi', 'utaPi', 'cpr', 'dvPi']);
    expect(list.every((r) => r.version === 0 && r.rows.length === 0)).toBe(true);
    expect((await refs('put', '/uaPi', { source: 'Sample chart 2020', rows: ROWS, version: 0 }, 'sono')).status).toBe(403);
    expect((await refs('get', '', undefined, 'nurse')).status).toBe(403);
    // No source; the 5th above the 50th; a week twice
    expect((await refs('put', '/uaPi', { source: '', rows: ROWS, version: 0 })).status).toBe(400);
    expect((await refs('put', '/uaPi', { source: 'Sample chart 2020', rows: [{ week: 30, p5: 2, p50: 1, p95: 3 }], version: 0 })).status).toBe(400);
    expect((await refs('put', '/uaPi', { source: 'Sample chart 2020', rows: [ROWS[0], ROWS[0]], version: 0 })).status).toBe(400);
    const draft = ok(await refs('put', '/uaPi', { source: 'Sample chart 2020', rows: ROWS, version: 0 })).reference;
    expect(draft).toMatchObject({ status: 'draft', version: 1, inUse: null });
    expect((await refs('post', '/uaPi/approve', { version: 1 }, 'rmo')).status).toBe(403);
    const ok1 = ok(await refs('post', '/uaPi/approve', { version: 1 }, 'drB')).reference;
    expect(ok1).toMatchObject({ status: 'approved', approved: { byName: 'Sample drB', version: 1 }, inUse: { version: 1 } });
    // A change is a new DRAFT; the approved version stays in use
    const v2 = ok(await refs('put', '/uaPi', { source: 'Sample chart 2021', rows: ROWS, version: 1 })).reference;
    expect(v2).toMatchObject({ status: 'draft', version: 2, inUse: { version: 1, source: 'Sample chart 2020' } });
    expect((await refs('put', '/uaPi', { source: 'x chart', rows: ROWS, version: 1 })).status).toBe(409); // stale
    expect(await AuditLog.countDocuments({ action: { $in: ['USG_REFERENCE_CHANGED', 'USG_REFERENCE_APPROVED'] } })).toBe(3);
  });

  it('a scan carries the approved tables only, to clinical users; the Doppler template takes the indices as numbers', async () => {
    ok(await refs('put', '/uaPi', { source: 'Sample chart 2020', rows: ROWS, version: 0 }));
    ok(await refs('put', '/mcaPi', { source: 'Sample chart 2020', rows: ROWS, version: 0 }));
    ok(await refs('post', '/uaPi/approve', { version: 1 }));
    const p = await mother();
    const s = await signedScan(p, 'usg_doppler', { uaPi: 1.5, mcaPi: 1.6, uaEdf: 'Present' });
    const page = ok(await (await as('drA')).get(`/api/imaging/${s.id}`));
    expect(Object.keys(page.references)).toEqual(['uaPi']); // MCA's table is still a DRAFT
    expect(page.references.uaPi).toMatchObject({ source: 'Sample chart 2020', rows: ROWS });
    expect(page.study.report.values).toMatchObject({ uaPi: 1.5, mcaPi: 1.6 });
  });
});
