// Cycle (follicular study) sheets under a fertility treatment plan (docs/FERTILITY_PLAN.md section 7): started under a
// confirmed plan, the scan days with their cycle day, the state from what is filled in, a completed cycle counted once
// on her record, cancellation, the printed report recorded, who may do what, and an audit log with ids only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import * as fields from '../src/fertility/cycleFields.js';
import { AuditLog } from '../src/models/AuditLog.js';
import * as website from '../../client/src/pages/patients/fertilityCycleFormat.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

describe('the cycle sheet lists and state', () => {
  it('keeps the same lists as the website, with words in English, Marathi and Hindi', () => {
    expect(Object.keys(website.PROTOCOL_KIND_WORDS)).toEqual(fields.PROTOCOL_KINDS);
    expect(Object.keys(website.PATTERN_WORDS)).toEqual(fields.ENDOMETRIUM_PATTERNS);
    expect(Object.keys(website.TIMING_WORDS)).toEqual(fields.TIMING_KINDS);
    expect(Object.keys(website.CANCEL_REASON_LABELS)).toEqual(fields.CANCEL_REASONS);
    expect(Object.keys(website.TEST_RESULT_WORDS)).toEqual(fields.TEST_RESULTS);
    expect(Object.keys(website.CLINICAL_LABELS)).toEqual(fields.CLINICAL_RESULTS);
    expect(Object.keys(website.CYCLE_STATUS_LOOK)).toEqual(fields.CYCLE_STATUSES);
    for (const words of [...Object.values(website.PROTOCOL_KIND_WORDS), ...Object.values(website.TEST_RESULT_WORDS), ...Object.values(website.REPORT_WORDS)]) {
      expect(words.en && words.mr && words.hi, JSON.stringify(words)).toBeTruthy();
    }
  });

  it('works the state out from what is filled in', () => {
    expect(fields.statusOf({})).toBe('monitoring');
    expect(fields.statusOf({ trigger: { at: new Date() } })).toBe('after_trigger');
    expect(fields.statusOf({ timing: { on: new Date() } })).toBe('after_trigger');
    expect(fields.statusOf({ trigger: { at: new Date() }, outcome: { test: 'negative' } })).toBe('completed');
    expect(fields.statusOf({ outcome: { test: 'not_done' } })).toBe('completed');
    expect(fields.statusOf({ outcome: { clinical: 'yes' } })).toBe('completed');
    expect(fields.statusOf({ outcome: { clinical: 'pending' } })).toBe('monitoring');
    expect(fields.statusOf({ cancelled: { reason: 'no_response' }, outcome: { test: 'negative' } })).toBe('cancelled');
  });
});

const NOW = new Date('2026-10-20T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };
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
  app = createApp();
  hospital = await createTenant('Cycle Hospital');
  other = await createTenant('Other Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.drOther = await createUser({ name: 'Sample other' });
  await addMember(people.drOther, other, 'doctor');
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const PCOS = { type: 'primary', durationMonths: 20, cycle: 'irregular', ovulation: 'anovulation', tubes: 'patent_both', semen: 'normal', diagnoses: ['pcos'] };
async function patientWithPlan({ confirm = true } = {}) {
  const dr = await as('drA');
  const res = await dr.post('/api/patients').send(samplePatient({ careType: 'infertility', fullName: 'Sample Couple', ageYears: 30, assignedDoctor: people.drA._id.toString(), medical: { allergies: 'None known' } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const p = res.body.patient;
  await dr.patch(`/api/patients/${p.id}`).send({ fertility: PCOS });
  let plan = (await dr.post(`/api/patients/${p.id}/fertility-plan`).send({ clientRequestId: randomUUID(), target: 'follicular_study' })).body.plan;
  if (confirm) plan = (await dr.post(`/api/patients/${p.id}/fertility-plan/${plan.id}/status`).send({ rev: plan.rev, status: 'active' })).body.plan;
  return { p, plan };
}
const base = (p) => `/api/patients/${p.id}/fertility-plan`;
const start = async (who, p, plan, body = {}) => (await as(who)).post(`${base(p)}/${plan.id}/cycles`).send({ clientRequestId: randomUUID(), day1: '2026-10-02', protocol: { kind: 'letrozole', drug: 'Letrozole', dose: '2.5 mg', days: 'day 3 to 7' }, ...body });
const sheet = (cycle, changes = {}) => ({
  rev: cycle.rev,
  day1: '2026-10-02',
  protocol: cycle.protocol,
  entries: cycle.entries.map((e) => ({ on: String(e.on).slice(0, 10), right: e.right, left: e.left, endometriumMm: e.endometriumMm, pattern: e.pattern, e2: e.e2, lh: e.lh, p4: e.p4, given: e.given, note: e.note })),
  trigger: { drug: cycle.trigger.drug, dose: cycle.trigger.dose, at: cycle.trigger.at ? String(cycle.trigger.at).slice(0, 10) : null },
  timing: { kind: cycle.timing.kind, on: cycle.timing.on ? String(cycle.timing.on).slice(0, 10) : null, postWashMillions: cycle.timing.postWashMillions, note: cycle.timing.note },
  luteal: cycle.luteal,
  cancelled: cycle.cancelled ? { reason: cycle.cancelled.reason, note: cycle.cancelled.note } : null,
  outcome: { test: cycle.outcome.test, testOn: cycle.outcome.testOn ? String(cycle.outcome.testOn).slice(0, 10) : null, betaHcg: cycle.outcome.betaHcg, betaHcgOn: null, clinical: cycle.outcome.clinical, scanOn: null, note: cycle.outcome.note },
  ...changes,
});

describe('a cycle sheet', () => {
  it('is started under a confirmed plan, filled scan by scan, moves on with the trigger and IUI, and a completed cycle is counted once on her record', async () => {
    const { p, plan } = await patientWithPlan();
    const dr = await as('drA');
    const rmo = await as('rmo');
    let res = await start('drA', p, plan);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    let cycle = res.body.cycle;
    expect(cycle).toMatchObject({ number: 1, step: 'follicular_study', status: 'monitoring', counted: false, protocol: { kind: 'letrozole', dose: '2.5 mg' }, entries: [], rev: 0 });
    expect(cycle.day1).toBe('2026-10-02T00:00:00.000Z');
    expect(res.body.plan).toMatchObject({ id: plan.id, status: 'active', step: 'follicular_study' });
    // One open cycle at a time; a future day 1 is refused; the same request twice gives the same cycle
    expect((await start('drA', p, plan)).body.error.code).toBe('CYCLE_OPEN');
    const tab = await dr.get(base(p));
    expect(tab.body.cycles.map((c) => c.id)).toEqual([cycle.id]);
    expect(tab.body.access.canStartCycle).toBe(false);

    // Scan days: the RMO enters them; the cycle day is worked out from day 1; the sizes must be sizes
    res = await rmo.put(`${base(p)}/cycles/${cycle.id}`).send(
      sheet(cycle, {
        entries: [
          { on: '2026-10-11', right: [12, 10], left: [9], endometriumMm: 6.5, pattern: 'trilaminar', e2: null, lh: null, p4: null, given: 'Letrozole finished', note: '' },
          { on: '2026-10-13', right: ['16', 11], left: [9.5], endometriumMm: 8, pattern: 'trilaminar', e2: null, lh: null, p4: null, given: '', note: 'Lead follicle on the right' },
        ],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    cycle = res.body.cycle;
    expect(cycle.status).toBe('monitoring');
    expect(cycle.entries.map((e) => [e.day, e.right, e.left, e.byName])).toEqual([
      [10, [12, 10], [9], 'Sample rmo'],
      [12, [16, 11], [9.5], 'Sample rmo'],
    ]);
    expect(cycle.rev).toBe(1);
    expect((await rmo.put(`${base(p)}/cycles/${cycle.id}`).send(sheet(cycle, { entries: [{ on: '2026-10-01', right: [], left: [], endometriumMm: null, pattern: '', e2: null, lh: null, p4: null, given: '', note: '' }] }))).body.error.fields).toHaveProperty('entries.0.on');
    expect((await rmo.put(`${base(p)}/cycles/${cycle.id}`).send(sheet(cycle, { entries: [{ on: '2026-10-11', right: [99], left: [], endometriumMm: null, pattern: '', e2: null, lh: null, p4: null, given: '', note: '' }] }))).status).toBe(400);
    expect((await rmo.put(`${base(p)}/cycles/${cycle.id}`).send(sheet(cycle, { rev: 0 }))).body.error.code).toBe('CONFLICT');

    // The trigger and the IUI: the state moves on; an unchanged scan day keeps who entered it, a changed one is restamped
    const entries = sheet(cycle).entries;
    entries[1].note = 'Lead follicle 18 mm on the right at the next look';
    res = await dr.put(`${base(p)}/cycles/${cycle.id}`).send(
      sheet(cycle, { entries, trigger: { drug: 'hCG', dose: '10,000 IU', at: '2026-10-14' }, timing: { kind: 'iui', on: '2026-10-16', postWashMillions: 12.5, note: '' }, luteal: 'Progesterone 200 mg vaginally' }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    cycle = res.body.cycle;
    expect(cycle.status).toBe('after_trigger');
    expect(cycle.trigger).toMatchObject({ drug: 'hCG', day: 13 });
    expect(cycle.timing).toMatchObject({ kind: 'iui', day: 15, postWashMillions: 12.5 });
    expect(cycle.entries.map((e) => e.byName)).toEqual(['Sample rmo', 'Sample drA']);
    expect((await dr.put(`${base(p)}/cycles/${cycle.id}`).send(sheet(cycle, { timing: { kind: 'iui', on: null, postWashMillions: null, note: '' } }))).body.error.fields).toHaveProperty('timing.on');

    // The outcome completes the cycle and counts it once on her record; the plan's counter is ovulation induction cycles
    expect((await dr.put(`${base(p)}/cycles/${cycle.id}`).send(sheet(cycle, { outcome: { ...sheet(cycle).outcome, test: 'negative' } }))).body.error.fields).toHaveProperty('outcome.testOn');
    res = await dr.put(`${base(p)}/cycles/${cycle.id}`).send(sheet(cycle, { outcome: { ...sheet(cycle).outcome, test: 'negative', testOn: '2026-10-30' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    cycle = res.body.cycle;
    expect(cycle).toMatchObject({ status: 'completed', counted: true });
    expect(res.body.counted).toEqual({ counter: 'oiCycles', total: 1 });
    expect((await dr.get(`/api/patients/${p.id}`)).body.patient.fertility.oiCycles).toBe(1);
    // Edited again after completion: not counted twice
    res = await dr.put(`${base(p)}/cycles/${cycle.id}`).send(sheet(cycle, { outcome: { ...sheet(cycle).outcome, note: 'Period came on day 29' } }));
    expect(res.body.counted).toBeNull();
    expect((await dr.get(`/api/patients/${p.id}`)).body.patient.fertility.oiCycles).toBe(1);
    // The next cycle can start, numbered 2; a cancelled cycle is not counted
    expect((await dr.get(base(p))).body.access.canStartCycle).toBe(true);
    res = await start('rmo', p, plan, { day1: '2026-10-19' });
    expect(res.status).toBe(201);
    let second = res.body.cycle;
    expect(second.number).toBe(2);
    res = await rmo.put(`${base(p)}/cycles/${second.id}`).send({ ...sheet(second), day1: '2026-10-19', cancelled: { reason: 'too_many_follicles', note: 'Three follicles over 14 mm on day 12' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    second = res.body.cycle;
    expect(second).toMatchObject({ status: 'cancelled', counted: false, cancelled: { reason: 'too_many_follicles', byName: 'Sample rmo' } });
    expect((await dr.get(`/api/patients/${p.id}`)).body.patient.fertility.oiCycles).toBe(1);
    // Switching the plan afterwards adds only the extra cycles the doctor types
    res = await dr.post(base(p)).send({ clientRequestId: randomUUID(), target: 'iui', switchFrom: { planId: plan.id, rev: plan.rev, cyclesDone: 0 } });
    expect(res.status).toBe(201);
    expect(res.body.cyclesRecorded).toBeNull();
    expect((await dr.get(`/api/patients/${p.id}`)).body.patient.fertility.oiCycles).toBe(1);

    // Printing the report is recorded with the language; the audit log holds ids only
    expect((await rmo.post(`${base(p)}/cycles/${cycle.id}/printed`).send({ language: 'mr' })).status).toBe(200);
    expect((await rmo.post(`${base(p)}/cycles/${cycle.id}/printed`).send({ language: 'xx' })).status).toBe(400);
    const entries2 = await AuditLog.find({ action: /^FERTILITY_CYCLE_/ }).lean();
    expect(entries2.map((e) => e.details.change ?? e.details.language)).toEqual(expect.arrayContaining(['started', 'edited', 'completed', 'cancelled', 'mr']));
    for (const e of entries2) for (const k of Object.keys(e.details)) expect(['patientId', 'mrn', 'planId', 'cycleId', 'change', 'language']).toContain(k);
    expect(JSON.stringify(entries2.map((e) => e.details))).not.toMatch(/letrozole|follicle|hCG/i);
  });

  it('needs a confirmed plan, and is seen and changed only by those with her medical details', async () => {
    const { p, plan } = await patientWithPlan({ confirm: false });
    expect((await start('drA', p, plan)).body.error.code).toBe('PLAN_NOT_ACTIVE');
    const dr = await as('drA');
    const active = (await dr.post(`${base(p)}/${plan.id}/status`).send({ rev: plan.rev, status: 'active' })).body.plan;
    const cycle = (await start('drA', p, active)).body.cycle;
    // The record is sensitive: another doctor, a nurse and reception are refused
    for (const who of ['drB', 'nurse', 'reception']) {
      expect((await (await as(who)).get(`${base(p)}/cycles/${cycle.id}`)).status, who).toBe(403);
      expect((await start(who, p, active)).status, who).toBe(403);
    }
    // Not sensitive: a nurse reads the sheet and may record the report as printed, but changes nothing
    await dr.patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: false });
    const nurse = await as('nurse');
    const seen = await nurse.get(`${base(p)}/cycles/${cycle.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.access.canEdit).toBe(false);
    expect((await nurse.put(`${base(p)}/cycles/${cycle.id}`).send(sheet(cycle))).status).toBe(403);
    expect((await nurse.post(`${base(p)}/cycles/${cycle.id}/printed`).send({ language: 'en' })).status).toBe(200);
    // Another hospital: not found
    expect((await (await as('drOther')).get(`${base(p)}/cycles/${cycle.id}`)).status).toBe(404);
    // A finished plan takes no new cycle
    const closed = await dr.post(`${base(p)}/${active.id}/status`).send({ rev: active.rev, status: 'stopped', outcome: { kind: 'patient_choice', note: 'The couple want a break.' } });
    expect(closed.status).toBe(200);
    expect((await start('drA', p, active, { clientRequestId: randomUUID() })).body.error.code).toBe('PLAN_NOT_ACTIVE');
  });
});
