// Smart features, step 1: red-flag alerts and today's worklist. Fake data only. Time is pinned: 28 Sep 2026,
// 11:30 in India; the sample patient's scan EDD is 1 Mar 2027, so she is 18 w 0 d today.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { BUILT_IN_RED_FLAG_RULES, RED_FLAG_FACTORS, checkCondition, conditionText, evaluateRedFlags, redFlagFacts } from '../src/redflags/redFlags.js';
import * as website from '../../client/src/pages/redflags/redFlagFormat.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const TODAY = new Date('2026-09-28T00:00:00Z');
const EDD = new Date('2027-03-01T00:00:00Z'); // 18 w 0 d on TODAY
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };

// ---------- The rules engine (no database) ----------

const visitAt = (weeksFromToday, vitals = {}, details = {}) => ({
  visitOn: new Date(TODAY.getTime() + weeksFromToday * 7 * 86_400_000),
  vitals,
  details,
});
const flagsFor = (visit, extra = {}) =>
  evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ visit, edd: EDD, today: visit?.visitOn ?? TODAY, ...extra })).map((f) => f.key);

describe('red-flag rules', () => {
  it('raise severe-range BP as urgent, and 140/90 as watch', () => {
    expect(flagsFor(visitAt(0, { bpSystolic: 162, bpDiastolic: 100 }))).toEqual(['bp_severe_sys']); // one line: not also "raised"
    expect(flagsFor(visitAt(0, { bpSystolic: 170, bpDiastolic: 112 }))).toEqual(['bp_severe_sys']); // systolic and diastolic: one flag
    expect(flagsFor(visitAt(0, { bpSystolic: 144, bpDiastolic: 86 }))).toEqual(['htn_sys']);
    expect(flagsFor(visitAt(0, { bpSystolic: 120, bpDiastolic: 80 }))).toEqual([]);
  });

  it('possible pre-eclampsia needs raised BP AND protein, after 20 weeks only', () => {
    // 18 weeks: only the raised BP
    expect(flagsFor(visitAt(0, { bpSystolic: 146, bpDiastolic: 94, urineAlbumin: '2+' }))).toEqual(['htn_sys']);
    // 24 weeks
    const flags = flagsFor(visitAt(6, { bpSystolic: 146, bpDiastolic: 94, urineAlbumin: '2+' }));
    expect(flags).toEqual(['pe_sys']); // one pre-eclampsia line, and not also "raised BP"
    expect(flagsFor(visitAt(6, { bpSystolic: 146, bpDiastolic: 94, urineAlbumin: 'trace' }))).toEqual(['htn_sys']);
    const one = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ visit: visitAt(6, { bpSystolic: 146, bpDiastolic: 94, urineAlbumin: '2+' }), edd: EDD, today: visitAt(6).visitOn }));
    expect(one.map((f) => f.detail)).toEqual(['BP 146/94 mmHg, Urine albumin 2+']);
  });

  it('a value that was not recorded never raises a flag', () => {
    expect(flagsFor(visitAt(6, { bpSystolic: 146 }))).toEqual(['htn_sys']); // no albumin recorded: no pre-eclampsia flag
    expect(flagsFor(visitAt(6, {}, { fetalMovements: '' }))).toEqual([]);
    expect(checkCondition({ factor: 'hb', op: 'lt', value: 7 }, redFlagFacts({ visit: visitAt(0), edd: EDD, today: TODAY }))).toBe(null);
  });

  it('anaemia bands: severe (urgent), moderate and mild (watch)', () => {
    expect(flagsFor(visitAt(0, { hb: 6.5 }))).toEqual(['hb_severe']);
    expect(flagsFor(visitAt(0, { hb: 8.9 }))).toEqual(['hb_moderate']);
    expect(flagsFor(visitAt(0, { hb: 10.4 }))).toEqual(['hb_mild']);
    expect(flagsFor(visitAt(0, { hb: 11.2 }))).toEqual([]);
  });

  it('reduced fetal movements from 28 weeks; fetal heart rate outside 110–160', () => {
    expect(flagsFor(visitAt(0, {}, { fetalMovements: 'reduced' }))).toEqual([]); // 18 weeks
    expect(flagsFor(visitAt(11, {}, { fetalMovements: 'reduced' }))).toEqual(['fm_reduced']); // 29 weeks
    expect(flagsFor(visitAt(11, {}, { fetalHeartRate: 100 }))).toEqual(['fhr_low']);
    expect(flagsFor(visitAt(11, {}, { fetalHeartRate: 172 }))).toEqual(['fhr_high']);
  });

  it('fundal height 3 cm away from the weeks, and not head-down from 36 weeks', () => {
    expect(flagsFor(visitAt(12, {}, { fundalHeightCm: 25 }))).toEqual(['fundal_gap']); // 30 weeks, 25 cm
    expect(flagsFor(visitAt(12, {}, { fundalHeightCm: 29 }))).toEqual([]);
    expect(flagsFor(visitAt(18, {}, { presentation: 'breech' }))).toEqual(['malpresentation']);
    expect(flagsFor(visitAt(14, {}, { presentation: 'breech' }))).toEqual([]);
  });

  it('weight gain per week against the previous weighed visit (at least a week apart)', () => {
    const previousWeighed = visitAt(8, { weightKg: 60 });
    expect(flagsFor(visitAt(10, { weightKg: 63 }), { previousWeighed })).toEqual(['weight_gain']); // 1.5 kg/week
    expect(flagsFor(visitAt(10, { weightKg: 61 }), { previousWeighed })).toEqual([]);
    expect(flagsFor(visitAt(8, { weightKg: 63 }), { previousWeighed: visitAt(8, { weightKg: 60 }) })).toEqual([]); // same day
  });

  it('41 weeks or more is checked on today, even without a visit', () => {
    const today = new Date(EDD.getTime() + 8 * 86_400_000); // 41 w 1 d
    expect(evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ visit: null, edd: EDD, today })).map((f) => f.key)).toEqual(['postdates']);
  });

  it('flags say what was recorded; conditions read as words', () => {
    const [f] = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ visit: visitAt(0, { hb: 6.5 }), edd: EDD, today: TODAY }));
    expect(f).toMatchObject({ level: 'urgent', label: 'Severe anaemia', detail: 'Hb 6.5 g/dL' });
    expect(conditionText({ factor: 'bpSystolic', op: 'gte', value: 160 })).toBe('BP systolic at least 160 mmHg');
    expect(conditionText({ factor: 'urineAlbumin', grade: '1+' })).toBe('Urine albumin 1+ or more');
    expect(conditionText({ factor: 'fetalMovements', choices: ['reduced', 'absent'] })).toBe('Fetal movements: reduced or absent');
  });

  it('the website knows the same checks and words', () => {
    expect(website.RED_FLAG_FACTORS).toEqual(RED_FLAG_FACTORS);
    for (const r of BUILT_IN_RED_FLAG_RULES) for (const c of r.conditions) expect(website.conditionText(c)).toBe(conditionText(c));
    expect(website.ruleChecksText(BUILT_IN_RED_FLAG_RULES.find((r) => r.key === 'pe_sys'))).toBe('BP systolic at least 140 mmHg and Urine albumin 1+ or more, from 20 weeks');
    expect(website.flagCountText([{ level: 'urgent' }, { level: 'watch' }, { level: 'watch' }])).toBe('1 urgent, 2 to watch');
  });
});

// ---------- Through the app ----------

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
  hospital = await createTenant('Red Flag Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));

async function register(overrides = {}, who = 'drA') {
  const res = await (await as(who)).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Flag Mother',
      ageYears: 28,
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: '2027-03-01' },
      obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
      ...overrides,
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const url = (p, path = '') => `/api/patients/${p.id}/visits${path}`;
async function visitWith(p, vitals, body = {}, who = 'drA') {
  const res = await (await as(who)).post(url(p)).send({ clientRequestId: randomUUID(), ...body });
  expect(res.status).toBe(201);
  const saved = await (await as(who)).patch(url(p, `/${res.body.visit.id}`)).send({ vitals: { rev: 0, ...vitals } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return saved.body;
}

describe('red flags in the app', () => {
  it('the visit page shows the flags of that visit, from the draft rules', async () => {
    const p = await register();
    const page = await visitWith(p, { bpSystolic: 164, bpDiastolic: 98, hb: 8.2 });
    expect(page.redFlags.flags.map((f) => f.key)).toEqual(['bp_severe_sys', 'hb_moderate']);
    expect(page.redFlags.rules).toMatchObject({ status: 'draft', version: 1 });
  });

  it('the patient record shows the latest visit\'s flags to clinical staff only', async () => {
    const p = await register();
    await visitWith(p, { hb: 6.8 }, { visitOn: '2026-09-20' });
    const nurse = await (await as('nurse')).get(`/api/patients/${p.id}`);
    expect(nurse.body.patient.redFlags.flags.map((f) => f.key)).toEqual(['hb_severe']);
    expect(nurse.body.patient.redFlags.visitOn).toBe('2026-09-20T00:00:00.000Z');
    // A newer visit with a normal Hb: the flag goes
    await visitWith(p, { hb: 11.5 });
    expect((await (await as('drA')).get(`/api/patients/${p.id}`)).body.patient.redFlags.flags).toEqual([]);
    // Reception never gets medical details
    expect((await (await as('reception')).get(`/api/patients/${p.id}`)).body.patient.redFlags).toBeUndefined();
  });

  it('a visit marked entered in error no longer counts', async () => {
    const p = await register();
    const page = await visitWith(p, { hb: 6.8 });
    await (await as('drA')).post(url(p, `/${page.visit.id}/cancel`)).send({ reason: 'Wrong patient chosen' });
    expect((await (await as('drA')).get(`/api/patients/${p.id}`)).body.patient.redFlags.flags).toEqual([]);
  });
});

describe('red-flag rules page', () => {
  it('doctors edit (a new draft version) and approve; nurses only view', async () => {
    const got = await (await as('nurse')).get('/api/red-flag-rules');
    expect(got.status).toBe(200);
    expect(got.body.ruleSet).toMatchObject({ status: 'draft', version: 1, canEdit: false });
    expect(got.body.ruleSet.rules.length).toBe(BUILT_IN_RED_FLAG_RULES.length);
    expect((await (await as('reception')).get('/api/red-flag-rules')).status).toBe(403);

    const rules = [{ key: 'hb_low', label: 'Low Hb', level: 'urgent', message: 'Check', conditions: [{ factor: 'hb', op: 'lt', value: 8 }], fromWeek: null, toWeek: null, source: '' }];
    expect((await (await as('nurse')).put('/api/red-flag-rules').send({ version: 1, rules })).status).toBe(403);
    const saved = await (await as('drA')).put('/api/red-flag-rules').send({ version: 1, rules });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.ruleSet).toMatchObject({ status: 'draft', version: 2, builtInVersion: null, updatedByName: 'Sample drA' });

    // Saving an old version is refused
    expect((await (await as('drB')).put('/api/red-flag-rules').send({ version: 1, rules })).status).toBe(409);
    expect((await (await as('drA')).post('/api/red-flag-rules/approve').send({ confirm: true, version: 1 })).status).toBe(409);
    const approved = await (await as('drB')).post('/api/red-flag-rules/approve').send({ confirm: true, version: 2 });
    expect(approved.body.ruleSet).toMatchObject({ status: 'approved', approvedByName: 'Sample drB' });

    // The flags now follow the doctor's rules
    const p = await register();
    const page = await visitWith(p, { hb: 7.5 });
    expect(page.redFlags.flags.map((f) => f.key)).toEqual(['hb_low']);
    expect(page.redFlags.rules).toMatchObject({ status: 'approved', approvedByName: 'Sample drB' });

    const actions = (await AuditLog.find({ tenantId: hospital._id, action: /^RED_FLAG_RULES/ }).lean()).map((e) => e.action).sort();
    expect(actions).toEqual(['RED_FLAG_RULES_APPROVED', 'RED_FLAG_RULES_UPDATED']);
  });

  it('checks each rule', async () => {
    const bad = [{ key: 'Bad Key', label: '', level: 'high', conditions: [{ factor: 'hb' }], fromWeek: 30, toWeek: 20 }];
    const res = await (await as('drA')).put('/api/red-flag-rules').send({ version: 1, rules: bad });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['rules.0.key', 'rules.0.label', 'rules.0.level', 'rules.0.conditions.0.op', 'rules.0.conditions.0.value']));
    const weeks = [{ key: 'ok', label: 'Weeks', level: 'watch', conditions: [{ factor: 'hb', op: 'lt', value: 9 }], fromWeek: 30, toWeek: 20 }];
    const res2 = await (await as('drA')).put('/api/red-flag-rules').send({ version: 1, rules: weeks });
    expect(res2.body.error.fields).toEqual({ 'rules.0.toWeek': '"To" week must not be before "from" week' });
    const twice = [weeks[0], weeks[0]].map((r) => ({ ...r, toWeek: 40 }));
    expect((await (await as('drA')).put('/api/red-flag-rules').send({ version: 1, rules: twice })).body.error.fields).toEqual({ 'rules.1.key': 'This code is already used by rule 1' });
  });
});

describe('the worklist', () => {
  it('lists red flags, care-plan work and today\'s visits for the doctor\'s own patients', async () => {
    const mine = await register({ fullName: 'Own Mother' });
    const theirs = await register({ fullName: 'Other Mother', assignedDoctor: people.drB._id.toString() });
    await visitWith(mine, { bpSystolic: 170, bpDiastolic: 112 });
    await visitWith(theirs, { hb: 6.1 }, {}, 'drB');

    const res = await (await as('drA')).get('/api/worklist');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('mine');
    expect(res.body.redFlags.map((r) => r.patient.fullName)).toEqual(['Own Mother']);
    expect(res.body.redFlags[0].flags[0]).toMatchObject({ level: 'urgent', label: 'Severe-range blood pressure' });
    expect(res.body.seenToday.map((v) => [v.patient.fullName, v.vitalsSaved, v.flagged])).toEqual([['Own Mother', true, true]]);
    // At 18 weeks the booking items are due: the care-plan list has her
    expect(res.body.carePlan.map((r) => r.patient.fullName)).toContain('Own Mother');
    expect(res.body.rules.status).toBe('draft');

    const all = await (await as('drA')).get('/api/worklist?scope=all');
    expect(all.body.redFlags.map((r) => r.patient.fullName)).toEqual(['Own Mother', 'Other Mother']);

    // Nurses see everyone; reception has no worklist
    expect((await (await as('nurse')).get('/api/worklist')).body.redFlags).toHaveLength(2);
    expect((await (await as('reception')).get('/api/worklist')).status).toBe(403);

    // Audited with counts only
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'WORKLIST_VIEWED', 'details.scope': 'mine' }).lean();
    expect(entry.details).toEqual({ scope: 'mine', redFlags: 1, carePlan: expect.any(Number), seenToday: 1, vaccinations: 0 });
  });

  it('leaves out sensitive records of other doctors', async () => {
    const theirs = await register({ fullName: 'Private Mother', assignedDoctor: people.drB._id.toString() });
    await (await as('drB')).patch(`/api/patients/${theirs.id}/sensitive`).send({ sensitive: true });
    await visitWith(theirs, { hb: 6.1 }, {}, 'drB');
    const res = await (await as('drA')).get('/api/worklist?scope=all');
    expect(res.body.redFlags.map((r) => r.patient.fullName)).not.toContain('Private Mother');
    expect(res.body.carePlan.map((r) => r.patient.fullName)).not.toContain('Private Mother');
  });
});
