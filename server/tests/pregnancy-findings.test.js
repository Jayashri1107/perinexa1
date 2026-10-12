// Findings in this pregnancy (GDM, high blood pressure, twins, low-lying placenta, bleeding) and the readings of
// this pregnancy (lowest haemoglobin, latest blood pressure): who may tick a finding, what the risk level and the
// care plan do with them, the audit entries, and the built-in DRAFT rules and items. Fake data only.
// Time is pinned: 28 Sep 2026, 11:30 in India; the sample patient's scan EDD is 1 Mar 2027 (18 w 0 d today), so
// this pregnancy counts from 11 May 2026.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ANTENATAL_DRAFT, FINDING_ITEM_KEYS, FINDING_RULE_KEYS, RISK_RULES_VERSION } from '../src/careplans/antenatalDraft.js';
import { rulesHash } from '../src/careplans/hashes.js';
import { readingsOf } from '../src/careplans/readings.js';
import { ensureStandardTemplates, refreshPatientRiskSafely, resetApprovalBackfill, resetRiskRefreshTimer } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { Patient } from '../src/models/Patient.js';
import { Visit } from '../src/models/Visit.js';
import { PREGNANCY_FINDINGS, currentFindings, pregnancySince, setFinding } from '../src/patients/pregnancyFindings.js';
import { mentionsFetalSex } from '../src/utils/pcpndt.js';
import { RISK_ENGINE_VERSION, RISK_FACTORS } from '../src/careplans/risk.js';
import { APPLIES_WHEN } from '../src/models/CarePlanTemplate.js';
import { APPLIES_LABELS } from '../../client/src/pages/careplans/templateFormat.js';
import { WHY_TEXT } from '../../client/src/pages/patients/carePlanFormat.js';
import { PREGNANCY_FINDING_LABELS } from '../../client/src/pages/patients/patientFormat.js';
import { NUMBER_FACTORS, RISK_FACTOR_LABELS } from '../../client/src/pages/patients/riskFormat.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const EDD = '2027-03-01';
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharmacist: 'pharmacist', admin: 'admin' };
const d = (s) => new Date(`${s}T00:00:00Z`);

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
  resetRiskRefreshTimer();
  app = createApp();
  hospital = await createTenant('Findings Hospital');
  other = await createTenant('Other Findings Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Dr Outside' });
  await addMember(people.outsider, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
// A later day: everyone logs in again (a login does not last that long).
const laterOn = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {};
};

// A fake antenatal patient of Dr A with complete details and nothing risky.
async function register(overrides = {}, who = 'drA') {
  const res = await (await as(who)).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Finding Mother',
      ageYears: 28,
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: EDD },
      obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
      ...overrides,
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const view = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;
const edit = async (who, p, body) => (await as(who)).patch(`/api/patients/${p.id}`).send(body);
const tick = async (who, p, key, present = true, extra = {}) => (await as(who)).post(`/api/patients/${p.id}/pregnancy-findings`).send({ key, present, ...extra });
const keys = (risk) => risk.reasons.map((r) => r.key);
const current = (patient) => patient.pregnancy.findings.filter((f) => f.current).map((f) => f.key);

const visitUrl = (p, path = '') => `/api/patients/${p.id}/visits${path}`;
async function newVisit(who, p) {
  const res = await (await as(who)).post(visitUrl(p)).send({ clientRequestId: randomUUID() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.visit;
}
const saveVitals = async (who, p, v, vitals) => (await as(who)).patch(visitUrl(p, `/${v.id}`)).send({ vitals: { rev: v.vitals.rev, ...vitals } });
const plan = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}/care-plan`)).body.plan;
const planItem = (pl, key) => pl.items.find((i) => i.key === key);

// A haemoglobin from the lab: ordered, collected, reported – and reviewed by the doctor only when asked.
const HB = (value) => [{ key: 'hb', values: [{ key: 'hb', value }] }];
async function reportHb(p, value) {
  const ordered = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'hb' }] });
  expect(ordered.status, JSON.stringify(ordered.body)).toBe(201);
  const collected = (await (await as('lab')).post(`/api/lab/orders/${ordered.body.order.id}/collect`).send({ rev: ordered.body.order.rev })).body.order;
  const reported = await (await as('lab')).put(`/api/lab/orders/${collected.id}/results`).send({ rev: collected.rev, tests: HB(value), report: true });
  expect(reported.status, JSON.stringify(reported.body)).toBe(200);
  return reported.body.order;
}
const review = async (who, o, comment = 'Seen and treated') => (await as(who)).post(`/api/lab/orders/${o.id}/review`).send({ rev: o.rev, comment });

const standard = () => CarePlanTemplate.findOne({ tenantId: hospital._id, careType: 'antenatal', kind: 'standard' });

// ---------- Pure helpers ----------

describe('findings and readings (no database)', () => {
  const who = { by: null, byName: 'Dr Rao', at: NOW };
  const record = (pregnancy = {}) => ({ careType: 'antenatal', pregnancy: { scanEdd: d(EDD), lmp: null, findings: [], ...pregnancy } });

  it('this pregnancy counts from two weeks before its day 0; without dates, the last 42 weeks; never after today', () => {
    expect(pregnancySince(record(), NOW).toISOString().slice(0, 10)).toBe('2026-05-11');
    expect(pregnancySince(record({ scanEdd: null, lmp: d('2026-05-25') }), NOW).toISOString().slice(0, 10)).toBe('2026-05-11');
    expect(pregnancySince(record({ scanEdd: null }), NOW).toISOString().slice(0, 10)).toBe('2025-12-08'); // 294 days before today
    expect(pregnancySince(record({ scanEdd: d('2027-08-01') }), NOW).toISOString().slice(0, 10)).toBe('2026-09-28'); // dates far ahead: today
    // a record read with only the stored EDD (lists) gives the same day
    expect(pregnancySince({ pregnancy: { effectiveEdd: d(EDD) } }, NOW).toISOString().slice(0, 10)).toBe('2026-05-11');
  });

  it('ticking keeps who and when; ticking twice or unticking an unticked finding changes nothing; unticking ends the entry', () => {
    const p = record();
    expect(setFinding(p, 'gdm', true, who)).toBe(true);
    expect(setFinding(p, 'gdm', true, { ...who, byName: 'Dr Second' })).toBe(false);
    expect(setFinding(p, 'bleeding', false, who)).toBe(false);
    expect(p.pregnancy.findings).toEqual([{ key: 'gdm', by: null, byName: 'Dr Rao', at: NOW, via: 'record', visitId: null, endedAt: null, endedByName: null }]);
    expect(currentFindings(p, NOW)).toEqual(['gdm']);
    const later = new Date('2026-10-05T06:00:00Z');
    expect(setFinding(p, 'gdm', false, { by: null, byName: 'RMO Sample', at: later })).toBe(true);
    expect(p.pregnancy.findings[0]).toMatchObject({ key: 'gdm', byName: 'Dr Rao', endedAt: later, endedByName: 'RMO Sample' });
    expect(currentFindings(p, later)).toEqual([]);
    // ticked again: a new entry, the ended one stays
    expect(setFinding(p, 'gdm', true, { ...who, at: later })).toBe(true);
    expect(p.pregnancy.findings).toHaveLength(2);
    expect(currentFindings(p, later)).toEqual(['gdm']);
  });

  it('readings: the lowest Hb of visits and reviewed lab results, the latest BP; nothing from before this pregnancy', () => {
    const since = d('2026-05-11');
    const visit = (on, vitals, createdAt = `${on}T05:00:00Z`) => ({ visitOn: d(on), createdAt: new Date(createdAt), vitals });
    const labHb = (status, value, at, extra = {}) => ({ status, tests: [{ key: 'cbc', values: [{ key: 'hb', value }, { key: 'tlc', value: '8000' }] }], collected: { at: new Date(at) }, ...extra });
    const visits = [
      visit('2026-06-01', { hb: 10.2, bpSystolic: 150, bpDiastolic: 96 }),
      visit('2026-08-01', { hb: 9.1, bpSystolic: 118, bpDiastolic: 76 }),
      visit('2026-08-01', { bpSystolic: 122, bpDiastolic: 80 }, '2026-08-01T09:00:00Z'), // later the same day
      visit('2026-09-01', { hb: 11.4 }), // no BP at the latest visit: the latest BP is still the one recorded before
      visit('2026-04-01', { hb: 6.1, bpSystolic: 170, bpDiastolic: 110 }), // an earlier pregnancy on the same record
    ];
    expect(readingsOf(visits, [], since)).toEqual({ lowestHb: { value: 9.1, on: d('2026-08-01'), source: 'visit' }, latestBp: { systolic: 122, diastolic: 80, on: d('2026-08-01') } });
    // lab results: only when reviewed; a value that is not a plausible g/dL is left out; the comma is read as a point
    const orders = [labHb('reported', '6.0', '2026-07-01T05:00:00Z'), labHb('reviewed', '8,4', '2026-07-10T05:00:00Z'), labHb('reviewed', '84', '2026-07-12T05:00:00Z'), labHb('reviewed', '5.0', '2026-03-01T05:00:00Z')];
    expect(readingsOf(visits, orders, since).lowestHb).toEqual({ value: 8.4, on: d('2026-07-10'), source: 'lab' });
    // changed after its review: counts as it was reviewed, until the change is reviewed
    const amended = labHb('reported', '10.9', '2026-07-10T05:00:00Z', { amendments: [{ reviewedAt: new Date('2026-07-11T05:00:00Z'), tests: [{ key: 'cbc', values: [{ key: 'hb', value: '7.9' }] }] }] });
    expect(readingsOf([], [amended], since).lowestHb).toEqual({ value: 7.9, on: d('2026-07-10'), source: 'lab' });
    expect(readingsOf([], [{ ...amended, amendments: [{ reviewedAt: null, tests: amended.amendments[0].tests }] }], since)).toBeNull();
    expect(readingsOf([], [], since)).toBeNull();
  });

  it('the website has words for every finding, every rule factor and every "for which patients" choice of the server', () => {
    expect(Object.keys(PREGNANCY_FINDING_LABELS)).toEqual(PREGNANCY_FINDINGS);
    expect(Object.keys(RISK_FACTOR_LABELS).sort()).toEqual(Object.keys(RISK_FACTORS).sort());
    expect([...NUMBER_FACTORS].sort()).toEqual(Object.keys(RISK_FACTORS).filter((k) => RISK_FACTORS[k].type === 'number').sort());
    expect(Object.keys(APPLIES_LABELS).sort()).toEqual([...APPLIES_WHEN].sort());
    for (const c of APPLIES_WHEN.filter((x) => x !== 'always')) expect([c, typeof WHY_TEXT[`only_${c}`]]).toEqual([c, 'string']);
  });

  it('the built-in DRAFT rules for findings and readings: every one has a source and is left for the doctor to confirm', () => {
    expect(RISK_RULES_VERSION).toBe(5);
    expect(RISK_ENGINE_VERSION).toBe(4);
    const rules = ANTENATAL_DRAFT.riskRules.filter((r) => FINDING_RULE_KEYS.includes(r.key));
    expect(rules.map((r) => r.key)).toEqual(FINDING_RULE_KEYS);
    for (const r of rules) {
      expect(r.source, r.key).toMatch(/PMSMA|MoHFW|WHO/);
      expect(r.source, r.key).toMatch(/doctor to confirm/);
      expect(mentionsFetalSex(`${r.label} ${r.source}`), r.key).toBe(false);
    }
    // one rule per finding, and the measured rules of the brief: Hb under 7 = high
    expect(rules.filter((r) => r.factor === 'finding').map((r) => r.finding).sort()).toEqual([...PREGNANCY_FINDINGS].sort());
    expect(rules.find((r) => r.key === 'hb_under_7')).toMatchObject({ factor: 'lowestHb', op: 'lt', value: 7, level: 'high' });
    expect(rules.find((r) => r.key === 'hb_under_11')).toMatchObject({ factor: 'lowestHb', op: 'lt', value: 11, level: 'moderate' });
    expect(rules.find((r) => r.key === 'bp_systolic_140')).toMatchObject({ factor: 'bpSystolic', op: 'gte', value: 140, level: 'high' });
    expect(rules.find((r) => r.key === 'bp_diastolic_90')).toMatchObject({ factor: 'bpDiastolic', op: 'gte', value: 90, level: 'high' });
    const items = ANTENATAL_DRAFT.items.filter((i) => FINDING_ITEM_KEYS.includes(i.key));
    expect(items).toHaveLength(FINDING_ITEM_KEYS.length);
    for (const i of items) {
      expect(i.source, i.key).toMatch(/doctor to confirm/);
      expect(i.source.length, i.key).toBeLessThanOrEqual(400);
      expect(['gdm', 'multiple_pregnancy', 'placenta_praevia'], i.key).toContain(i.appliesWhen);
      expect(mentionsFetalSex(`${i.name} ${i.patientText} ${i.source}`), i.key).toBe(false);
      // The patient's wording goes on her printout, the patient portal and reminder messages (often a shared
      // phone): it says which scan and when – never the finding that switched the item on.
      expect(i.patientText, i.key).not.toMatch(/sugar|diabet|gdm|twin|babies|placenta|pressure|bleed|risk/i);
    }
    // The twin scans are the schedule for separate placentas only, and say so by name; one more item tells the
    // doctor that a shared placenta or triplets need more scans.
    for (const key of ['scan_twins_24', 'scan_twins_28', 'scan_twins_32']) expect(items.find((i) => i.key === key).name, key).toMatch(/twins, separate placentas/);
    expect(items.find((i) => i.key === 'adv_twins_placentas')).toMatchObject({ kind: 'advice', appliesWhen: 'multiple_pregnancy' });
    expect(items.find((i) => i.key === 'adv_twins_placentas').source).toMatch(/Monochorionic twins: a scan every 2 weeks from 16 weeks/);
    // WHO's lower cut-off for the second trimester is named with the flat "under 11" rule
    expect(rules.find((r) => r.key === 'hb_under_11').source).toMatch(/WHO 2024: < 11 in the first and third trimesters, < 10.5 in the second/);
    for (const r of rules) expect(r.source.length, r.key).toBeLessThanOrEqual(400);
  });
});

// ---------- Ticking and unticking ----------

describe('findings in this pregnancy on the record', () => {
  it('ticked on the edit form: saved with who and when, the risk level rises with the reason; unticked ones are ended, not deleted', async () => {
    const p = await register();
    const before = await view('drA', p);
    expect(before.pregnancy.findings).toEqual([]);
    expect(before.risk).toMatchObject({ level: 'low', reasons: [] });

    const saved = await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: ['multiple', 'gdm'] } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.patient.pregnancy.findings).toEqual([
      { key: 'gdm', byName: 'Sample drA', at: NOW.toISOString(), via: 'record', endedAt: null, endedByName: null, current: true },
      { key: 'multiple', byName: 'Sample drA', at: NOW.toISOString(), via: 'record', endedAt: null, endedByName: null, current: true },
    ]);
    expect(saved.body.patient.risk).toMatchObject({ level: 'high', computedLevel: 'high', findingsNotChecked: [] });
    expect(keys(saved.body.patient.risk)).toEqual(['preg_gdm', 'preg_multiple']);
    expect(saved.body.patient.risk.reasons[0]).toMatchObject({ label: 'Gestational diabetes (GDM) in this pregnancy', level: 'high', detail: 'Recorded by Sample drA on 28 Sep 2026' });

    // the same list again a day later (the form always sends it): nothing changes, not even who and when
    laterOn('2026-09-29T06:00:00Z');
    const again = await edit('rmo', p, { pregnancy: { scanEdd: EDD, findings: ['gdm', 'multiple'] } });
    expect(again.body.patient.pregnancy.findings.map((f) => [f.key, f.byName, f.at])).toEqual([
      ['gdm', 'Sample drA', NOW.toISOString()],
      ['multiple', 'Sample drA', NOW.toISOString()],
    ]);

    // an RMO unticks twins: the entry stays, ended with who and when; the reason goes
    const unticked = await edit('rmo', p, { pregnancy: { scanEdd: EDD, findings: ['gdm'] } });
    expect(unticked.status).toBe(200);
    expect(unticked.body.patient.pregnancy.findings[1]).toEqual({ key: 'multiple', byName: 'Sample drA', at: NOW.toISOString(), via: 'record', endedAt: '2026-09-29T06:00:00.000Z', endedByName: 'Sample rmo', current: false });
    expect(current(unticked.body.patient)).toEqual(['gdm']);
    expect(keys(unticked.body.patient.risk)).toEqual(['preg_gdm']);

    // the pregnancy section saved without the list leaves the findings alone
    expect(current((await edit('drA', p, { pregnancy: { scanEdd: EDD } })).body.patient)).toEqual(['gdm']);
    // everything unticked: low again
    const none = await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: [] } });
    expect(current(none.body.patient)).toEqual([]);
    expect(none.body.patient.risk).toMatchObject({ level: 'low', reasons: [] });
    // no staff id and no visit id ever leaves the server with a finding
    expect(JSON.stringify(none.body.patient.pregnancy.findings)).not.toMatch(/"by"|visitId/);
    const stored = await Patient.findOne({ _id: p.id, tenantId: hospital._id });
    expect(stored.pregnancy.findings).toHaveLength(2);
    expect(String(stored.pregnancy.findings[0].by)).toBe(String(people.drA._id));
  });

  it('an edit form opened before a colleague ticked a finding does not untick it when it is saved', async () => {
    const p = await register();
    await tick('drA', p, 'gdm');
    // Dr A's form was opened now: it shows GDM. Meanwhile the RMO confirms high blood pressure at a visit.
    const seen = ['gdm'];
    await tick('rmo', p, 'hypertension');
    // Dr A ticks twins and saves the older form (its list has no "hypertension")
    const saved = await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: ['gdm', 'multiple'], findingsSeen: seen } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(current(saved.body.patient)).toEqual(['gdm', 'hypertension', 'multiple']);
    // unticking on the form what the form showed still works; what it never showed is left alone
    const unticked = await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: ['multiple'], findingsSeen: ['gdm', 'multiple'] } });
    expect(current(unticked.body.patient)).toEqual(['hypertension', 'multiple']);
    // a form saved without any change to its findings changes nothing (and writes no "findings" in the audit log)
    const before = await AuditLog.countDocuments({ action: 'PATIENT_UPDATED' });
    const same = await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: [], findingsSeen: [] } });
    expect(current(same.body.patient)).toEqual(['hypertension', 'multiple']);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_UPDATED' })).toBe(before);
    expect((await edit('drA', p, { pregnancy: { scanEdd: EDD, findingsSeen: ['fetal_sex'] } })).status).toBe(400);
  });

  it('each of the five findings raises the level by its own DRAFT rule; a doctor can tick them when registering', async () => {
    const p = await register({ pregnancy: { scanEdd: EDD, findings: ['bleeding'] } });
    expect(current(p)).toEqual(['bleeding']);
    expect(keys(p.risk)).toEqual(['preg_bleeding']);
    const RULE = { gdm: 'preg_gdm', hypertension: 'preg_hypertension', multiple: 'preg_multiple', placenta_praevia: 'preg_placenta_praevia', bleeding: 'preg_bleeding' };
    for (const key of PREGNANCY_FINDINGS) {
      const res = await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: [key] } });
      expect([key, keys(res.body.patient.risk), res.body.patient.risk.level]).toEqual([key, [RULE[key]], 'high']);
    }
    // reception registers identity only: a finding it sends is not kept
    const byReception = await register({ pregnancy: { scanEdd: EDD, findings: ['gdm'] } }, 'reception');
    expect((await view('drA', byReception)).pregnancy.findings).toEqual([]);
  });

  it('who may tick: the treating or an unassigned doctor and RMOs – not another doctor, a nurse, reception, the lab, the pharmacist or the admin', async () => {
    const p = await register();
    for (const who of ['drB', 'nurse', 'reception', 'lab', 'pharmacist', 'admin']) {
      const res = await tick(who, p, 'gdm');
      expect([who, res.status, res.body.error.code]).toEqual([who, 403, 'FORBIDDEN']);
    }
    expect((await tick('drB', p, 'gdm')).body.error.message).toMatch(/another doctor's patient/);
    // the edit form's way is closed to them too
    for (const who of ['drB', 'nurse', 'reception']) expect([who, (await edit(who, p, { pregnancy: { scanEdd: EDD, findings: ['gdm'] } })).status]).toEqual([who, 403]);
    expect((await view('drA', p)).pregnancy.findings).toEqual([]);

    const byDoctor = await tick('drA', p, 'gdm');
    expect(byDoctor.status).toBe(200);
    expect(byDoctor.body).toMatchObject({ changed: true });
    expect(current(byDoctor.body.patient)).toEqual(['gdm']);
    const byRmo = await tick('rmo', p, 'placenta_praevia');
    expect(byRmo.status).toBe(200);
    expect(current(byRmo.body.patient)).toEqual(['gdm', 'placenta_praevia']);
    expect(byRmo.body.patient.pregnancy.findings[1]).toMatchObject({ key: 'placenta_praevia', byName: 'Sample rmo', via: 'record' });

    // an unassigned patient: any doctor
    const free = await register({ assignedDoctor: null, fullName: 'Unassigned Mother' });
    expect((await tick('drB', free, 'bleeding')).status).toBe(200);
    // a sensitive record: the treating doctor and RMOs still may; another doctor may not even see the findings
    await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true });
    expect((await tick('drB', p, 'bleeding')).status).toBe(403);
    expect((await view('drB', p)).pregnancy).toBeUndefined();
    expect((await tick('rmo', p, 'bleeding')).status).toBe(200);
  });

  it("a patient of another hospital is simply not found", async () => {
    const p = await register();
    const outsider = await loginAs(people.outsider, { app });
    const res = await outsider.post(`/api/patients/${p.id}/pregnancy-findings`).send({ key: 'gdm', present: true });
    expect(res.status).toBe(404);
    expect((await outsider.patch(`/api/patients/${p.id}`).send({ pregnancy: { scanEdd: EDD, findings: ['gdm'] } })).status).toBe(404);
    expect((await view('drA', p)).pregnancy.findings).toEqual([]);
  });

  it('only for antenatal care; an unknown finding or field is refused; ticking twice changes nothing', async () => {
    const p = await register();
    expect((await tick('drA', p, 'fetal_sex')).status).toBe(400);
    expect((await tick('drA', p, 'gdm', true, { fetalSex: 'x' })).status).toBe(400);
    expect((await (await as('drA')).post(`/api/patients/${p.id}/pregnancy-findings`).send({ key: 'gdm' })).status).toBe(400);
    expect((await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: ['unknown'] } })).status).toBe(400);
    expect((await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: 'gdm' } })).status).toBe(400);

    expect((await tick('drA', p, 'gdm')).body.changed).toBe(true);
    expect((await tick('rmo', p, 'gdm')).body.changed).toBe(false); // already ticked: Dr A's entry stays
    expect((await tick('rmo', p, 'bleeding', false)).body.changed).toBe(false);
    expect((await view('drA', p)).pregnancy.findings.map((f) => [f.key, f.byName])).toEqual([['gdm', 'Sample drA']]);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_UPDATED' })).toBe(1); // only the tick that changed something

    const gyn = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', medical: { allergies: 'None known' } }))).body.patient;
    const refused = await tick('drA', gyn, 'gdm');
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/only be recorded for antenatal care/);
    expect((await edit('drA', gyn, { pregnancy: { findings: ['gdm'] } })).status).toBe(400);
    // a record that leaves antenatal care keeps its findings on the record, without a risk level
    const left = await edit('drA', p, { careType: 'gynaecology' });
    expect(left.body.patient.risk.level).toBeNull();
    expect(left.body.patient.pregnancy.findings).toHaveLength(1);
  });

  it('audit: the changed field by name only – never which finding – and no entry for the change of risk level', async () => {
    const p = await register();
    await edit('drA', p, { pregnancy: { scanEdd: EDD, findings: ['gdm', 'multiple'] }, medical: { allergies: 'None known', weightKg: 61 } });
    await tick('rmo', p, 'bleeding');
    await tick('rmo', p, 'gdm', false);
    const entries = await AuditLog.find({ action: 'PATIENT_UPDATED' }).sort({ createdAt: 1, _id: 1 });
    expect(entries.map((e) => e.details)).toEqual([
      { patientId: p.id, mrn: p.mrn, fields: ['medical.weightKg', 'pregnancy.findings'] },
      { patientId: p.id, mrn: p.mrn, fields: ['pregnancy.findings'] },
      { patientId: p.id, mrn: p.mrn, fields: ['pregnancy.findings'] },
    ]);
    expect(String(entries[1].actor)).toBe(String(people.rmo._id));
    expect(await AuditLog.countDocuments({ action: 'PATIENT_RISK_CHANGED' })).toBe(0);
    // the hospital admin reads the audit log: nothing in it says which finding, or the level
    const log = await (await as('admin')).get('/api/tenant/audit-logs');
    expect(log.status).toBe(200);
    expect(JSON.stringify(log.body.entries)).not.toMatch(/gdm|multiple|bleeding|placenta|hypertension|"high"|"low"/);
  });

  it('those who may not see medical details never get the findings or the readings', async () => {
    const p = await register();
    await tick('drA', p, 'gdm');
    const v = await newVisit('nurse', p);
    expect((await saveVitals('nurse', p, v, { hb: 6.5, bpSystolic: 150, bpDiastolic: 96 })).status).toBe(200);
    for (const who of ['reception', 'lab', 'pharmacist']) {
      const seen = await view(who, p);
      expect([who, seen.pregnancy, seen.risk]).toEqual([who, undefined, undefined]);
      const list = await (await as(who)).get('/api/patients?doctor=all');
      expect(JSON.stringify(list.body)).not.toMatch(/findings|readings|lowestHb|gdm/);
    }
    expect((await (await as('admin')).get(`/api/patients/${p.id}`)).status).toBe(403);
    // nurses see them (medical details), but cannot change them
    const nurse = await view('nurse', p);
    expect(current(nurse)).toEqual(['gdm']);
    expect(nurse.pregnancy.readings).toMatchObject({ lowestHb: { value: 6.5, source: 'visit' }, latestBp: { systolic: 150, diastolic: 96 } });
  });

  it('findings of an earlier pregnancy on the same record no longer count for the next one', async () => {
    const p = await register();
    await tick('drA', p, 'gdm');
    expect(keys((await view('drA', p)).risk)).toEqual(['preg_gdm']);
    // more than a year later the same record is used for her next pregnancy (new LMP)
    laterOn('2027-11-01T06:00:00Z');
    const next = await edit('drA', p, { careType: 'antenatal', pregnancy: { lmp: '2027-09-06', scanEdd: '' } });
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect(next.body.patient.pregnancy.findings).toEqual([expect.objectContaining({ key: 'gdm', current: false, endedAt: null })]);
    expect(keys(next.body.patient.risk)).not.toContain('preg_gdm');
    // found again in this pregnancy: a new entry
    const again = await tick('drA', p, 'gdm');
    expect(again.body.patient.pregnancy.findings.map((f) => [f.key, f.current])).toEqual([
      ['gdm', false],
      ['gdm', true],
    ]);
    expect(keys(again.body.patient.risk)).toContain('preg_gdm');
  });

  it('a record from before this feature (no findings, no readings stored) keeps working', async () => {
    const p = await register();
    await Patient.collection.updateOne({ _id: (await Patient.findOne({ tenantId: hospital._id, mrn: p.mrn }))._id }, { $unset: { 'pregnancy.findings': '', 'pregnancy.readings': '', 'risk.notMeasured': '' } });
    const seen = await view('drA', p);
    expect(seen.pregnancy.findings).toEqual([]);
    expect(seen.risk.level).toBe('low');
    expect((await tick('drA', p, 'multiple')).status).toBe(200);
  });
});

// ---------- Readings ----------

describe('readings of this pregnancy and the risk level', () => {
  it('before anything is measured the level is not called incomplete: the readings not measured yet are listed', async () => {
    const p = await register();
    expect((await view('drA', p)).risk).toMatchObject({ level: 'low', missing: [], notMeasured: ['Haemoglobin (Hb)', 'Blood pressure'], mayBeHigher: false });
    const v = await newVisit('nurse', p);
    const saved = await saveVitals('nurse', p, v, { bpSystolic: 110, bpDiastolic: 70 });
    expect(saved.body.riskChanged).toBe(false);
    expect(saved.body.recordChanged).toBe(true); // the level is the same, the record is not: the latest BP is on it now
    expect((await view('drA', p)).risk).toMatchObject({ level: 'low', notMeasured: ['Haemoglobin (Hb)'] });
    // the same values saved again change nothing on her record: it is not read again
    const again = await saveVitals('nurse', p, { ...v, vitals: { rev: 1 } }, { bpSystolic: 110, bpDiastolic: 70 });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect([again.body.riskChanged, again.body.recordChanged]).toEqual([false, false]);
  });

  it('if the level cannot be worked out again after a reading, the record is marked as due and the next read brings it up to date', async () => {
    const p = await register();
    const id = (await Patient.findOne({ tenantId: hospital._id, mrn: p.mrn }))._id;
    // the visit's Hb is saved; the risk refresh that follows it fails (a database hiccup)
    await Visit.create({ tenantId: hospital._id, patientId: id, visitOn: d('2026-09-28'), careType: 'antenatal', clientRequestId: randomUUID(), createdBy: people.nurse._id, createdByName: 'Sample nurse', vitals: { hb: 6.2 } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi.spyOn(Patient.prototype, 'save').mockRejectedValueOnce(new Error('database hiccup'));
    expect(await refreshPatientRiskSafely({ tenantId: hospital._id, now: NOW }, id)).toMatchObject({ changed: false, saved: false });
    save.mockRestore();
    const stored = await Patient.findOne({ _id: id, tenantId: hospital._id });
    expect(stored.risk.level).toBe('low'); // still the old level …
    expect(stored.risk.recheckAt.getTime()).toBe(NOW.getTime()); // … but marked as due
    // the next read of her record works it out again
    const seen = await view('drA', p);
    expect(seen.risk).toMatchObject({ level: 'high' });
    expect(keys(seen.risk)).toContain('hb_under_7');
    expect(seen.pregnancy.readings.lowestHb).toMatchObject({ value: 6.2, source: 'visit' });
  });

  it("a visit's vital signs: Hb under 7 is high (under 11 moderate), with the value, the day and where it comes from", async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    const saved = await saveVitals('nurse', p, v, { hb: 6.5, bpSystolic: 110, bpDiastolic: 70 });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.riskChanged).toBe(true);
    const after = await view('drA', p);
    expect(after.risk).toMatchObject({ level: 'high', computedLevel: 'high', notMeasured: [], readingsNotChecked: [] });
    expect(after.risk.reasons).toEqual([
      expect.objectContaining({ key: 'hb_under_7', level: 'high', detail: 'Lowest Hb 6.5 g/dL on 28 Sep 2026 (visit) (rule: under 7)' }),
      expect.objectContaining({ key: 'hb_under_11', level: 'moderate' }),
    ]);
    expect(after.pregnancy.readings).toEqual({ lowestHb: { value: 6.5, on: '2026-09-28T00:00:00.000Z', source: 'visit' }, latestBp: { systolic: 110, diastolic: 70, on: '2026-09-28T00:00:00.000Z' } });
    // a later, better Hb does not lower it: the rule is on the LOWEST Hb of this pregnancy
    laterOn('2026-10-20T06:00:00Z');
    const v2 = await newVisit('nurse', p);
    await saveVitals('nurse', p, v2, { hb: 10.4, bpSystolic: 112, bpDiastolic: 72 });
    expect(keys((await view('drA', p)).risk)).toEqual(['hb_under_7', 'hb_under_11']);
    // the first visit was entered in error: its Hb no longer counts
    const cancelled = await (await as('drA')).post(visitUrl(p, `/${v.id}/cancel`)).send({ reason: 'Wrong patient' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.riskChanged).toBe(true);
    const now = await view('drA', p);
    expect(now.risk).toMatchObject({ level: 'moderate' });
    expect(now.risk.reasons).toEqual([expect.objectContaining({ key: 'hb_under_11', detail: 'Lowest Hb 10.4 g/dL on 20 Oct 2026 (visit) (rule: under 11)' })]);
    // exactly 7 and exactly 11 are not "under"
    await saveVitals('nurse', p, { ...v2, vitals: { rev: 1 } }, { hb: 11, bpSystolic: 112, bpDiastolic: 72 });
    expect((await view('drA', p)).risk).toMatchObject({ level: 'low', reasons: [] });
  });

  it('the latest blood pressure: 140/90 or higher is high until a later reading is normal', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    await saveVitals('nurse', p, v, { bpSystolic: 150, bpDiastolic: 84 });
    let risk = (await view('drA', p)).risk;
    expect(risk.level).toBe('high');
    expect(risk.reasons).toEqual([expect.objectContaining({ key: 'bp_systolic_140', detail: 'BP 150/84 mmHg on 28 Sep 2026 (rule: at least 140)' })]);
    // exactly 140/90 counts ("at least")
    await saveVitals('nurse', p, { ...v, vitals: { rev: 1 } }, { bpSystolic: 140, bpDiastolic: 90 });
    expect(keys((await view('drA', p)).risk)).toEqual(['bp_systolic_140', 'bp_diastolic_90']);
    laterOn('2026-10-05T06:00:00Z');
    const v2 = await newVisit('nurse', p);
    const normal = await saveVitals('nurse', p, v2, { bpSystolic: 124, bpDiastolic: 80 });
    expect(normal.body.riskChanged).toBe(true);
    risk = (await view('drA', p)).risk;
    expect(risk).toMatchObject({ level: 'low', reasons: [] });
  });

  it('a lab haemoglobin counts only once a doctor has reviewed it; changed after the review, it counts as reviewed until the change is reviewed', async () => {
    const p = await register();
    const reported = await reportHb(p, '6.4');
    expect((await view('drA', p)).risk).toMatchObject({ level: 'low', notMeasured: ['Haemoglobin (Hb)', 'Blood pressure'] }); // reported, not reviewed

    const reviewed = await review('drA', reported, 'Admitted, transfusion arranged');
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(reviewed.body.riskChanged).toBe(true);
    let after = await view('drA', p);
    expect(after.risk.level).toBe('high');
    expect(after.risk.reasons[0]).toMatchObject({ key: 'hb_under_7', detail: 'Lowest Hb 6.4 g/dL on 28 Sep 2026 (lab result) (rule: under 7)' });

    // the lab corrects the value: until the doctor reviews the change, the reviewed value keeps counting
    const amended = await (await as('lab')).put(`/api/lab/orders/${reported.id}/results`).send({ rev: reviewed.body.order.rev, tests: HB('10.4'), reason: 'Typing mistake corrected' });
    expect(amended.status, JSON.stringify(amended.body)).toBe(200);
    expect(amended.body.order.status).toBe('reported');
    expect(amended.body).not.toHaveProperty('riskChanged'); // the lab learns nothing about the risk level
    expect(keys((await view('drA', p)).risk)).toEqual(['hb_under_7', 'hb_under_11']);
    const second = await review('drA', amended.body.order, 'Corrected value seen');
    expect(second.body.riskChanged).toBe(true);
    after = await view('drA', p);
    expect(after.risk).toMatchObject({ level: 'moderate' });
    expect(keys(after.risk)).toEqual(['hb_under_11']);
    // the review is audited as before (ids only); the level's change is not audited
    const audits = await AuditLog.find({ action: 'LAB_RESULTS_REVIEWED' });
    expect(audits).toHaveLength(2);
    expect(Object.keys(audits[0].details).sort()).toEqual(['mrn', 'orderId', 'patientId']);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_RISK_CHANGED' })).toBe(0);
  });

  it("a doctor's override keeps winning: the level stays, and the override is flagged for review", async () => {
    const p = await register();
    const set = await (await as('drA')).put(`/api/patients/${p.id}/risk-override`).send({ level: 'low', reason: 'Seen today, all normal so far' });
    expect(set.status).toBe(200);
    const v = await newVisit('nurse', p);
    const saved = await saveVitals('nurse', p, v, { hb: 6.2, bpSystolic: 152, bpDiastolic: 98 });
    expect(saved.body.riskChanged).toBe(false); // the level shown is still the doctor's
    expect(saved.body.recordChanged).toBe(true); // but her record changed (reasons, readings, "override needs review"): the page reads it again
    await tick('rmo', p, 'multiple');
    const after = await view('drA', p);
    expect(after.risk).toMatchObject({ level: 'low', computedLevel: 'high', overrideNeedsReview: true, override: { level: 'low', byName: 'Sample drA', reason: 'Seen today, all normal so far' } });
    expect(keys(after.risk)).toEqual(expect.arrayContaining(['hb_under_7', 'bp_systolic_140', 'bp_diastolic_90', 'preg_multiple']));
    // and the care plan follows the doctor's level: the high-risk scan does not switch on
    expect(planItem(await plan('drA', p), 'scan_doppler')).toMatchObject({ status: 'not_applicable', why: 'only_high_risk' });
  });

  it('records worked out before this feature get their readings when the levels are brought up to date', async () => {
    const p = await register();
    const id = (await Patient.findOne({ tenantId: hospital._id, mrn: p.mrn }))._id;
    // a visit with a low Hb saved before the rules on readings existed (straight into the database)
    await Visit.create({ tenantId: hospital._id, patientId: id, visitOn: d('2026-09-20'), careType: 'antenatal', clientRequestId: randomUUID(), createdBy: people.nurse._id, createdByName: 'Sample nurse', vitals: { hb: 6.8 } });
    await Patient.collection.updateOne({ _id: id }, { $set: { 'risk.engineVersion': RISK_ENGINE_VERSION - 1 }, $unset: { 'pregnancy.readings': '' } });
    resetRiskRefreshTimer();
    expect((await (await as('drA')).get('/api/patients?risk=high&doctor=all')).body.total).toBe(1); // the list refreshes due patients first
    const stored = await Patient.findOne({ _id: id, tenantId: hospital._id });
    expect(stored.risk).toMatchObject({ level: 'high', engineVersion: RISK_ENGINE_VERSION });
    expect(stored.pregnancy.readings.lowestHb).toMatchObject({ value: 6.8, source: 'visit' });
  });
});

// ---------- The care plan ----------

describe('care-plan items for findings', () => {
  it('switch on by themselves when the finding is ticked – with the high-risk items – and off again when it is unticked', async () => {
    const p = await register();
    let pl = await plan('drA', p);
    expect(planItem(pl, 'scan_growth_gdm')).toMatchObject({ status: 'not_applicable', why: 'only_gdm', appliesWhen: 'gdm' });
    expect(planItem(pl, 'scan_twins_24')).toMatchObject({ status: 'not_applicable', why: 'only_multiple_pregnancy' });
    expect(planItem(pl, 'scan_placenta_32')).toMatchObject({ status: 'not_applicable', why: 'only_placenta_praevia' });
    expect(planItem(pl, 'scan_doppler')).toMatchObject({ status: 'not_applicable', why: 'only_high_risk' });

    await tick('drA', p, 'gdm');
    pl = await plan('drA', p);
    expect(planItem(pl, 'scan_growth_gdm')).toMatchObject({ status: 'upcoming', applies: 'yes', why: null });
    expect(planItem(pl, 'scan_growth_gdm').due.from).toBe('2026-12-07T00:00:00.000Z'); // 28 w 0 d
    expect(planItem(pl, 'scan_doppler')).toMatchObject({ status: 'upcoming', applies: 'yes' }); // she is high risk now
    expect(planItem(pl, 'scan_twins_24').status).toBe('not_applicable');
    expect(pl.recentChanges.map((c) => c.action)).toContain('items_apply');
    // the plan is a draft: the new items come from the DRAFT template
    expect(pl.template).toMatchObject({ approved: false, label: 'Draft – not approved for clinical use' });

    await tick('rmo', p, 'multiple');
    await tick('rmo', p, 'placenta_praevia');
    pl = await plan('nurse', p);
    for (const key of ['scan_twins_24', 'scan_twins_28', 'scan_twins_32', 'scan_placenta_32']) expect([key, planItem(pl, key).applies]).toEqual([key, 'yes']);

    for (const key of ['gdm', 'multiple', 'placenta_praevia']) await tick('drA', p, key, false);
    pl = await plan('drA', p);
    for (const key of [...FINDING_ITEM_KEYS, 'scan_doppler']) expect([key, planItem(pl, key).status]).toEqual([key, 'not_applicable']);
  });

  it("a finding ticked after an item's weeks have passed: the item is for the doctor to decide – it is not overdue at once", async () => {
    const p = await register(); // booked at 18 weeks
    laterOn('2027-01-11T06:00:00Z'); // 33 w 0 d
    await tick('drA', p, 'gdm');
    await tick('drA', p, 'placenta_praevia');
    const pl = await plan('drA', p);
    // the GDM growth scan was for 28–30 weeks: it could never have been done in time
    expect(planItem(pl, 'scan_growth_gdm')).toMatchObject({ status: 'decide', applies: 'yes', lateStart: 'decide', lateFrom: 'finding' });
    // the placenta scan is for 32–33 weeks: still in time, due now
    expect(planItem(pl, 'scan_placenta_32')).toMatchObject({ status: 'due', applies: 'yes', lateStart: null });
    expect(pl.items.filter((i) => FINDING_ITEM_KEYS.includes(i.key) && i.status === 'overdue')).toEqual([]);
  });

  it('a plan built before the template had items for a finding: the tick switches nothing on, and the plan says so until it is updated', async () => {
    // A hospital that approved its template before this feature: no item for a finding in the template or the plan
    const before = await CarePlanTemplate.findOne({ tenantId: hospital._id, careType: 'antenatal', kind: 'standard' });
    await CarePlanTemplate.collection.updateOne(
      { _id: before._id },
      {
        $set: { riskRules: before.toObject().riskRules.filter((r) => !FINDING_RULE_KEYS.includes(r.key)), builtInRulesVersion: 4, builtInAdditions: [], status: 'approved', approvedVersion: 1, approvedByName: 'Sample drA', approvedAt: NOW, approvals: [] },
        $pull: { items: { key: { $in: FINDING_ITEM_KEYS } } },
      },
    );
    resetApprovalBackfill();
    const p = await register();
    await tick('drA', p, 'multiple');
    let pl = await plan('drA', p);
    expect(planItem(pl, 'scan_twins_24')).toBeUndefined();
    expect(pl.findingsWithoutItems).toEqual([]); // the template has no item for it either: there is nothing to update to

    // A doctor adds the built-in items to the template. Her plan keeps the version it was built from …
    const url = `/api/care-plans/templates/${before._id}`;
    const offered = (await (await as('drA')).get(url)).body.template;
    expect((await (await as('drA')).post(`${url}/built-in`).send({ version: offered.version })).status).toBe(200);
    pl = await plan('nurse', p);
    expect(planItem(pl, 'scan_twins_24')).toBeUndefined();
    // … and says so: "Twins or more" is ticked, the template has items for it now, the plan has none
    expect(pl.findingsWithoutItems).toEqual(['multiple']);
    expect(pl.template).toMatchObject({ updateAvailable: true, updateApproved: false });
    expect((await view('drA', p)).carePlanSummary.findingsWithoutItems).toEqual(['multiple']);
    // those who see no medical details get no summary at all
    expect((await view('reception', p)).carePlanSummary).toBeUndefined();

    // Updated (reviewed first): the items are in her plan and apply; the notice goes
    const preview = await (await as('drA')).get(`/api/patients/${p.id}/care-plan/template-preview?templateId=${before._id}`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.added.map((a) => a.key)).toEqual(expect.arrayContaining(['scan_twins_24', 'scan_twins_28', 'scan_twins_32', 'adv_twins_placentas']));
    const applied = await (await as('drA')).put(`/api/patients/${p.id}/care-plan/template`).send({ templateId: String(before._id), fromItemsHash: preview.body.from.itemsHash, toItemsHash: preview.body.to.itemsHash });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(planItem(applied.body.plan, 'scan_twins_24')).toMatchObject({ applies: 'yes', status: 'upcoming' });
    expect(applied.body.plan.findingsWithoutItems).toEqual([]);
    expect(applied.body.summary.findingsWithoutItems).toEqual([]);
  });

  it('a doctor can make any template item depend on a finding (or on "any diabetes")', async () => {
    const p = await register({ medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditions: ['diabetes'] } });
    const t = (await (await as('drA')).get(`/api/care-plans/templates/${(await standard())._id}`)).body.template;
    const items = [
      ...t.items,
      { key: 'adv_bleeding', kind: 'advice', name: 'Advice after bleeding', patientText: 'Rest and come at once if it bleeds again', fromWeek: 12, toWeek: 40, appliesWhen: 'bleeding', source: 'Hospital practice' },
      { key: 'lab_sugar_any', kind: 'investigation', name: 'Sugar profile', patientText: 'Blood sugar tests', fromWeek: 12, toWeek: 40, appliesWhen: 'diabetes_any', source: 'Hospital practice' },
    ];
    const put = await (await as('drA')).put(`/api/care-plans/templates/${t.id}`).send({ version: t.version, name: t.name, description: t.description, sources: t.sources, items, riskRules: t.riskRules });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await (await as('drA')).put(`/api/care-plans/templates/${t.id}`).send({ version: put.body.template.version, name: t.name, items: [{ ...items[0], appliesWhen: 'fetal_sex' }] })).status).toBe(400);
    // her plan takes the new items when moved to the new version
    const options = await (await as('drA')).get(`/api/patients/${p.id}/care-plan/template-preview?templateId=${t.id}`);
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    const applied = await (await as('drA')).put(`/api/patients/${p.id}/care-plan/template`).send({ templateId: t.id, fromItemsHash: options.body.from.itemsHash, toItemsHash: options.body.to.itemsHash });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(planItem(applied.body.plan, 'lab_sugar_any')).toMatchObject({ applies: 'yes' }); // pre-existing diabetes
    expect(planItem(applied.body.plan, 'adv_bleeding')).toMatchObject({ status: 'not_applicable', why: 'only_bleeding' });
    await tick('drA', p, 'bleeding');
    expect(planItem(await plan('drA', p), 'adv_bleeding')).toMatchObject({ applies: 'yes', status: 'due' });
  });
});

// ---------- The visit page's offer ----------

describe('the visit page offers "high blood pressure in this pregnancy"', () => {
  it('after BP 140/90 or higher, to the doctor or RMO only; one click adds it with the visit; nothing is ticked by itself', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    const byNurse = await saveVitals('nurse', p, v, { bpSystolic: 150, bpDiastolic: 96 });
    expect(byNurse.status, JSON.stringify(byNurse.body)).toBe(200);
    expect(byNurse.body.findingOffers).toEqual([]); // a nurse cannot add it
    expect((await view('drA', p)).pregnancy.findings).toEqual([]); // and nothing was ticked by the software
    for (const who of ['drA', 'rmo']) {
      const page = await (await as(who)).get(visitUrl(p, `/${v.id}`));
      expect([who, page.body.findingOffers]).toEqual([who, [{ key: 'hypertension', bp: '150/96', beforeWeek20: true }]]); // 18 weeks
    }
    expect((await (await as('drB')).get(visitUrl(p, `/${v.id}`))).body.findingOffers).toEqual([]); // read-only doctor

    const added = await tick('rmo', p, 'hypertension', true, { visitId: v.id });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.patient.pregnancy.findings).toEqual([expect.objectContaining({ key: 'hypertension', byName: 'Sample rmo', via: 'visit', current: true })]);
    expect(keys(added.body.patient.risk)).toEqual(expect.arrayContaining(['preg_hypertension', 'bp_systolic_140', 'bp_diastolic_90']));
    expect((await (await as('drA')).get(visitUrl(p, `/${v.id}`))).body.findingOffers).toEqual([]); // already on the record
    const stored = await Patient.findOne({ _id: p.id, tenantId: hospital._id });
    expect(String(stored.pregnancy.findings[0].visitId)).toBe(v.id);
    // the finding stays when a later BP is normal (the doctor unticks it if it was a one-off)
    laterOn('2026-10-05T06:00:00Z');
    const v2 = await newVisit('nurse', p);
    await saveVitals('nurse', p, v2, { bpSystolic: 120, bpDiastolic: 78 });
    const later = await view('drA', p);
    expect(later.risk.level).toBe('high');
    expect(keys(later.risk)).toEqual(['preg_hypertension']);
  });

  it('not for a normal BP, not when chronic high blood pressure is already recorded, and never with a visit of another patient', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    await saveVitals('nurse', p, v, { bpSystolic: 138, bpDiastolic: 88 });
    expect((await (await as('drA')).get(visitUrl(p, `/${v.id}`))).body.findingOffers).toEqual([]);
    // only the lower number raised: offered; from 20 weeks no "before 20 weeks" note
    laterOn('2026-10-19T06:00:00Z'); // 21 w 0 d
    const v2 = await newVisit('nurse', p);
    await saveVitals('nurse', p, v2, { bpSystolic: 136, bpDiastolic: 92 });
    expect((await (await as('drA')).get(visitUrl(p, `/${v2.id}`))).body.findingOffers).toEqual([{ key: 'hypertension', bp: '136/92', beforeWeek20: false }]);
    // marked entered in error: no offer
    await (await as('drA')).post(visitUrl(p, `/${v2.id}/cancel`)).send({ reason: 'Wrong patient' });
    expect((await (await as('drA')).get(visitUrl(p, `/${v2.id}`))).body.findingOffers).toEqual([]);

    const chronic = await register({ fullName: 'Chronic Mother', medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditions: ['hypertension'] } });
    const cv = await newVisit('nurse', chronic);
    await saveVitals('nurse', chronic, cv, { bpSystolic: 160, bpDiastolic: 100 });
    expect((await (await as('drA')).get(visitUrl(chronic, `/${cv.id}`))).body.findingOffers).toEqual([]);

    const wrongVisit = await tick('drA', p, 'hypertension', true, { visitId: cv.id });
    expect(wrongVisit.status).toBe(404);
    expect((await view('drA', p)).pregnancy.findings).toEqual([]);
  });

  it('"Add to her record" is held to the offer: a visit marked entered in error, a corrected reading or another finding is refused', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    await saveVitals('nurse', p, v, { bpSystolic: 150, bpDiastolic: 96 });
    // no other finding can be recorded as "confirmed at this visit" …
    const other = await tick('drA', p, 'gdm', true, { visitId: v.id });
    expect([other.status, other.body.error.code]).toEqual([409, 'NOT_SUGGESTED']);
    // … and a finding is never removed "from a visit"
    await tick('drA', p, 'bleeding');
    expect((await tick('drA', p, 'bleeding', false, { visitId: v.id })).status).toBe(400);
    expect(current(await view('drA', p))).toEqual(['bleeding']);

    // the nurse corrects the reading to a normal one while the offer is still on the doctor's screen
    await saveVitals('nurse', p, { ...v, vitals: { rev: 1 } }, { bpSystolic: 128, bpDiastolic: 82 });
    const corrected = await tick('drA', p, 'hypertension', true, { visitId: v.id });
    expect([corrected.status, corrected.body.error.code]).toEqual([409, 'NOT_SUGGESTED']);
    expect(corrected.body.error.message).toMatch(/no longer suggest/);

    // raised again; then a colleague marks the visit "entered in error" (typed on the wrong patient)
    await saveVitals('nurse', p, { ...v, vitals: { rev: 2 } }, { bpSystolic: 150, bpDiastolic: 96 });
    expect((await (await as('drA')).get(visitUrl(p, `/${v.id}`))).body.findingOffers).toHaveLength(1);
    expect((await (await as('drA')).post(visitUrl(p, `/${v.id}/cancel`)).send({ reason: 'Wrong patient' })).status).toBe(200);
    const stale = await tick('rmo', p, 'hypertension', true, { visitId: v.id });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'VISIT_CANCELLED']);
    expect(stale.body.error.message).toMatch(/entered in error/);
    const after = await view('drA', p);
    expect(current(after)).toEqual(['bleeding']); // nothing was ticked on the strength of that visit
    expect(keys(after.risk)).toEqual(['preg_bleeding']);
    // ticked on the record itself (Edit details), it is still possible – as "recorded", not "confirmed at a visit"
    const byHand = await tick('drA', p, 'hypertension');
    expect(byHand.body.patient.pregnancy.findings.find((f) => f.key === 'hypertension')).toMatchObject({ via: 'record', current: true });
  });
});

// ---------- Built-in rules and items: who gets them, and how ----------

describe('built-in DRAFT rules and items for findings', () => {
  // The standard template as a hospital had it before this feature: the earlier built-in rules and items.
  async function asBefore(set = {}) {
    const std = await standard();
    await CarePlanTemplate.collection.updateOne(
      { _id: std._id },
      {
        $set: { riskRules: std.toObject().riskRules.filter((r) => !FINDING_RULE_KEYS.includes(r.key)), builtInRulesVersion: 4, builtInAdditions: [], ...set },
        $pull: { items: { key: { $in: FINDING_ITEM_KEYS } } },
      },
    );
    resetApprovalBackfill();
    return standard();
  }
  const ruleKeys = (t) => t.riskRules.map((r) => r.key);
  const itemKeys = (t) => t.items.map((i) => i.key);

  it('a new hospital starts with them, as an unapproved draft', async () => {
    const t = await standard();
    expect(t).toMatchObject({ status: 'draft', version: 1, builtInRulesVersion: RISK_RULES_VERSION });
    expect(ruleKeys(t)).toEqual(expect.arrayContaining(FINDING_RULE_KEYS));
    expect(itemKeys(t)).toEqual(expect.arrayContaining(FINDING_ITEM_KEYS));
    expect([...t.builtInAdditions].sort()).toEqual(['pregnancy_findings_items', 'pregnancy_findings_rules']);
    const seen = (await (await as('drA')).get(`/api/care-plans/templates/${t._id}`)).body.template;
    expect(seen.builtInUpdates).toBeNull();
    expect(seen.riskRules.find((r) => r.key === 'preg_gdm')).toMatchObject({ factor: 'finding', finding: 'gdm', level: 'high' });
  });

  it('an untouched built-in draft gets the new rules and items by itself: one new version, audited, patients worked out again', async () => {
    const p = await register();
    await tick('drA', p, 'multiple');
    const before = await asBefore();
    expect(ruleKeys(before)).not.toContain('preg_multiple');
    await ensureStandardTemplates(hospital._id);
    const t = await standard();
    expect(t).toMatchObject({ status: 'draft', version: before.version + 1, builtInRulesVersion: RISK_RULES_VERSION, updatedByName: 'Built-in draft risk rules and items updated' });
    expect(ruleKeys(t)).toEqual(ANTENATAL_DRAFT.riskRules.map((r) => r.key));
    expect(itemKeys(t)).toEqual(expect.arrayContaining(FINDING_ITEM_KEYS));
    expect([...t.builtInAdditions].sort()).toEqual(['pregnancy_findings_items', 'pregnancy_findings_rules']);
    const audit = await AuditLog.findOne({ action: 'TEMPLATE_UPDATED' });
    expect(audit).toMatchObject({ actorEmail: 'system (built-in rules)', details: { version: t.version, note: 'Built-in draft risk rules and items updated' } });
    expect((await Patient.findOne({ _id: p.id, tenantId: hospital._id })).risk).toMatchObject({ level: 'high', templateVersion: t.version });
    // a second check changes nothing
    await ensureStandardTemplates(hospital._id);
    expect((await standard()).version).toBe(t.version);
  });

  it('an APPROVED template is never changed by the upgrade – not its rules, not its items, not its approval', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    await saveVitals('nurse', p, v, { hb: 6.5 });
    const before = await asBefore({ status: 'approved', approvedVersion: 1, approvedByName: 'Sample drA', approvedAt: NOW, approvals: [] });
    const approvedHash = rulesHash(before.riskRules);
    for (let i = 0; i < 2; i += 1) await ensureStandardTemplates(hospital._id);
    const t = await standard();
    expect(t).toMatchObject({ status: 'approved', version: before.version, builtInRulesVersion: 4 });
    expect(ruleKeys(t)).toEqual(ruleKeys(before));
    expect(itemKeys(t)).toEqual(itemKeys(before));
    expect(t.builtInAdditions).toEqual([]);
    // the fingerprint of the approved rules is the one written down with the approval (the new, empty field does not change it)
    expect(rulesHash(t.riskRules)).toBe(approvedHash);
    expect(t.approvals.map((a) => a.rulesHash)).toEqual([approvedHash]);
    expect(await AuditLog.countDocuments({ action: 'TEMPLATE_UPDATED' })).toBe(0);
    // so her low Hb does not change the level here until a doctor adds the rules
    resetRiskRefreshTimer();
    const seen = await view('drA', p);
    // … and the record says so: the Hb is on her record, but these rules have no rule that looks at it
    expect(seen.risk).toMatchObject({ level: 'low', templateApproved: true, notMeasured: [], findingsNotChecked: [], readingsNotChecked: ['lowestHb'] });
    expect(seen.pregnancy.readings.lowestHb).toMatchObject({ value: 6.5 });
    // the same for a blood pressure
    await saveVitals('nurse', p, { ...v, vitals: { rev: 1 } }, { hb: 6.5, bpSystolic: 160, bpDiastolic: 110 });
    expect((await view('drA', p)).risk).toMatchObject({ level: 'low', reasons: [], readingsNotChecked: ['lowestHb', 'latestBp'] });
    // a finding ticked here is not counted either – and the record says so, instead of looking as if it had been
    const ticked = await tick('drA', p, 'multiple');
    expect(ticked.body.patient.risk).toMatchObject({ level: 'low', reasons: [], findingsNotChecked: ['multiple'], readingsNotChecked: ['lowestHb', 'latestBp'] });
  });

  it('a template a doctor approved and then edited keeps the rules the doctor approved: nothing is replaced or added by itself', async () => {
    const before = await asBefore({ status: 'approved', approvedVersion: 1, approvedByName: 'Sample drA', approvedAt: NOW, approvals: [] });
    const approvedHash = rulesHash(before.riskRules);
    const url = `/api/care-plans/templates/${before._id}`;
    const full = (await (await as('drA')).get(url)).body.template;
    // After this release the doctor changes one schedule item; the rules are sent back exactly as they are
    const items = full.items.map((i) => (i.key === 'visit_16' ? { ...i, name: 'Antenatal visit (16 weeks) – our way' } : i));
    const put = await (await as('drA')).put(url).send({ version: full.version, name: full.name, description: full.description, sources: full.sources, items, riskRules: full.riskRules });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.template).toMatchObject({ status: 'draft', version: full.version + 1, builtInRulesVersion: 4 });

    // The template is a draft now – but its rules were reviewed by a doctor: every later check leaves them alone
    for (let i = 0; i < 2; i += 1) {
      resetApprovalBackfill();
      await ensureStandardTemplates(hospital._id);
    }
    const t = await standard();
    expect(t).toMatchObject({ status: 'draft', version: full.version + 1, builtInRulesVersion: 4, updatedByName: 'Sample drA' });
    expect(rulesHash(t.riskRules)).toBe(approvedHash);
    expect(ruleKeys(t)).toEqual(ruleKeys(before));
    expect(itemKeys(t)).not.toContain('scan_growth_gdm');
    expect(t.builtInAdditions).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'TEMPLATE_UPDATED', actorEmail: 'system (built-in rules)' })).toBe(0);
    // approving it again approves exactly the rules that were approved before
    const seen = (await (await as('drA')).get(url)).body.template;
    expect(seen.version).toBe(full.version + 1);
    // … and the new built-in content is still on offer, for a doctor to add
    expect(seen.builtInUpdates.riskRules).toHaveLength(FINDING_RULE_KEYS.length);
    expect(seen.builtInUpdates.items).toHaveLength(FINDING_ITEM_KEYS.length);
  });

  it('a draft whose items a doctor edited gets the newer built-in rules by itself, but never the items – however often it is checked', async () => {
    // Never approved; a doctor changed one item; the rules are still the built-in ones of the earlier version
    const before = await asBefore({ updatedByName: 'Sample drA' });
    await CarePlanTemplate.collection.updateOne({ _id: before._id, 'items.key': 'visit_16' }, { $set: { 'items.$.name': 'Antenatal visit (16 weeks) – our way' } });
    for (let i = 0; i < 3; i += 1) {
      resetApprovalBackfill();
      await ensureStandardTemplates(hospital._id);
    }
    // (The first check upgrades the rules and writes "Built-in …" as the last change. Whether the items are still
    // the untouched built-in ones is judged by their content, so the later checks do not mistake them for untouched.)
    const t = await standard();
    expect(t).toMatchObject({ status: 'draft', version: before.version + 1, builtInRulesVersion: RISK_RULES_VERSION, updatedByName: 'Built-in draft risk rules updated' });
    expect(ruleKeys(t)).toEqual(ANTENATAL_DRAFT.riskRules.map((r) => r.key));
    expect(itemKeys(t)).toEqual(itemKeys(before));
    expect(t.items.find((i) => i.key === 'visit_16').name).toBe('Antenatal visit (16 weeks) – our way');
    expect(t.builtInAdditions).toEqual(['pregnancy_findings_rules']);
    expect(await AuditLog.countDocuments({ action: 'TEMPLATE_UPDATED' })).toBe(1);
    // the items are offered on the template's page instead
    const seen = (await (await as('drA')).get(`/api/care-plans/templates/${t._id}`)).body.template;
    expect(seen.version).toBe(before.version + 1);
    expect(seen.builtInUpdates).toMatchObject({ riskRules: [], changes: [] });
    expect(seen.builtInUpdates.items).toHaveLength(FINDING_ITEM_KEYS.length);
  });

  it('a draft a doctor only renamed (items and rules still the built-in ones, never approved) is still the built-in draft: it gets both', async () => {
    const before = await asBefore({ updatedByName: 'Sample drA', name: 'Our antenatal schedule' });
    await ensureStandardTemplates(hospital._id);
    const t = await standard();
    expect(t).toMatchObject({ version: before.version + 1, name: 'Our antenatal schedule', updatedByName: 'Built-in draft risk rules and items updated' });
    expect(itemKeys(t)).toEqual(expect.arrayContaining(FINDING_ITEM_KEYS));
  });

  it('a doctor adds them to an approved template from its page: a new draft version, audited; others cannot', async () => {
    const p = await register();
    await tick('drA', p, 'gdm');
    const before = await asBefore({ status: 'approved', approvedVersion: 1, approvedByName: 'Sample drA', approvedAt: NOW, approvals: [] });
    const url = `/api/care-plans/templates/${before._id}`;
    const offered = (await (await as('drA')).get(url)).body.template;
    expect(offered.status).toBe('approved');
    expect(offered.builtInUpdates.riskRules).toHaveLength(FINDING_RULE_KEYS.length);
    expect(offered.builtInUpdates.items).toHaveLength(FINDING_ITEM_KEYS.length);
    expect(offered.builtInUpdates.riskRules).toContain('Gestational diabetes (GDM) in this pregnancy');

    for (const who of ['rmo', 'nurse']) expect([who, (await (await as(who)).post(`${url}/built-in`).send({ version: offered.version })).status]).toEqual([who, 403]);
    expect((await (await as('reception')).post(`${url}/built-in`).send({ version: offered.version })).status).toBe(403);
    expect((await (await loginAs(people.outsider, { app })).post(`${url}/built-in`).send({ version: offered.version })).status).toBe(404);
    expect((await (await as('drA')).post(`${url}/built-in`).send({ version: offered.version + 3 })).status).toBe(409);
    expect((await (await as('drA')).post(`${url}/built-in`).send({ version: offered.version, extra: 1 })).status).toBe(400);
    expect((await standard()).status).toBe('approved');

    const added = await (await as('drB')).post(`${url}/built-in`).send({ version: offered.version });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body).toMatchObject({ added: { items: FINDING_ITEM_KEYS.length, riskRules: FINDING_RULE_KEYS.length, changes: 0 }, recalculated: { checked: 1 } });
    // the rules the template had are not touched (so it does not become "built-in version 5" either)
    expect(added.body.template).toMatchObject({ status: 'draft', version: offered.version + 1, updatedByName: 'Sample drB', builtInUpdates: null, builtInRulesVersion: 4 });
    const t = await standard();
    expect(ruleKeys(t)).toEqual([...ruleKeys(before), ...FINDING_RULE_KEYS]);
    expect(itemKeys(t)).toEqual(expect.arrayContaining(FINDING_ITEM_KEYS));
    expect(t.approvals).toHaveLength(1); // the earlier approval stays on record
    const audit = await AuditLog.findOne({ action: 'TEMPLATE_UPDATED' });
    expect(String(audit.actor)).toBe(String(people.drB._id));
    expect((await view('drA', p)).risk).toMatchObject({ level: 'high', templateApproved: false });
    // nothing more to add
    const again = await (await as('drA')).post(`${url}/built-in`).send({ version: t.version });
    expect([again.status, again.body.error.code]).toEqual([409, 'NOTHING_TO_ADD']);
    // removed by a doctor afterwards, they are not offered again
    const full = (await (await as('drA')).get(url)).body.template;
    const put = await (await as('drA')).put(url).send({ version: full.version, name: full.name, items: full.items, riskRules: full.riskRules.filter((r) => r.key !== 'hb_under_11') });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await (await as('drA')).get(url)).body.template.builtInUpdates).toBeNull();
  });

  it('"Add as a new draft" adds exactly what the offer lists: rules approved from an older built-in version stay word for word', async () => {
    // Approved when the built-in rules were version 3: one rule still has the wording and level of that time
    const before = await asBefore({ status: 'approved', approvedVersion: 1, approvedByName: 'Sample drA', approvedAt: NOW, approvals: [], builtInRulesVersion: 3 });
    await CarePlanTemplate.collection.updateOne({ _id: before._id, 'riskRules.key': 'cond_anaemia' }, { $set: { 'riskRules.$.source': 'Wording of the older built-in rules', 'riskRules.$.level': 'high' } });
    resetApprovalBackfill();
    const approved = (await standard()).toObject().riskRules;
    const url = `/api/care-plans/templates/${before._id}`;
    const offered = (await (await as('drA')).get(url)).body.template;
    expect(offered.status).toBe('approved');
    // the offer lists the nine new rules and the new items – and nothing about the rules it already has
    expect(offered.builtInUpdates.riskRules).toEqual(ANTENATAL_DRAFT.riskRules.filter((r) => FINDING_RULE_KEYS.includes(r.key)).map((r) => r.label));
    expect(offered.builtInUpdates.changes).toEqual([]);
    const added = await (await as('drA')).post(`${url}/built-in`).send({ version: offered.version });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const t = await standard();
    const now = t.toObject().riskRules;
    expect(now.slice(0, approved.length)).toEqual(approved); // every approved rule exactly as it was
    expect(now.find((r) => r.key === 'cond_anaemia')).toMatchObject({ source: 'Wording of the older built-in rules', level: 'high' });
    expect(now.slice(approved.length).map((r) => r.key)).toEqual(FINDING_RULE_KEYS);
    expect(t.builtInRulesVersion).toBe(3);
    // and later checks do not "upgrade" them either
    resetApprovalBackfill();
    await ensureStandardTemplates(hospital._id);
    expect((await standard()).toObject().riskRules).toEqual(now);
  });

  it("rules a doctor has edited are kept: nothing is added by itself, and adding from the page puts the new rules after the doctor's own", async () => {
    const before = await asBefore({ builtInRulesVersion: null, updatedByName: 'Sample drA' });
    const own = before.toObject().riskRules.map((r) => (r.key === 'age_over_35' ? { ...r, value: 38 } : r));
    await CarePlanTemplate.collection.updateOne({ _id: before._id }, { $set: { riskRules: own } });
    await ensureStandardTemplates(hospital._id);
    let t = await standard();
    expect(t.version).toBe(before.version);
    expect(ruleKeys(t)).not.toContain('preg_gdm');
    expect(itemKeys(t)).not.toContain('scan_growth_gdm'); // a doctor changed this template: its items are not touched either
    const url = `/api/care-plans/templates/${t._id}`;
    const added = await (await as('drA')).post(`${url}/built-in`).send({ version: t.version });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    t = await standard();
    expect(t.riskRules.find((r) => r.key === 'age_over_35').value).toBe(38); // the doctor's own cut-off stays
    expect(ruleKeys(t).slice(-FINDING_RULE_KEYS.length)).toEqual(FINDING_RULE_KEYS);
    expect(t.builtInRulesVersion).toBeNull();
    expect(itemKeys(t)).toEqual(expect.arrayContaining(FINDING_ITEM_KEYS));
  });

  it('personal protocols and other types of care get no offer; a rule on a finding must name the finding', async () => {
    const t = await standard();
    const mine = (await (await as('drA')).post('/api/care-plans/templates').send({ copyFrom: String(t._id) })).body.template;
    expect((await (await as('drA')).get(`/api/care-plans/templates/${mine.id}`)).body.template.builtInUpdates).toBeNull();
    expect((await (await as('drA')).post(`/api/care-plans/templates/${mine.id}/built-in`).send({ version: mine.version })).status).toBe(400);

    const full = (await (await as('drA')).get(`/api/care-plans/templates/${t._id}`)).body.template;
    const send = (riskRules) => as('drA').then((s) => s.put(`/api/care-plans/templates/${full.id}`).send({ version: full.version, name: full.name, items: full.items, riskRules }));
    const bad = await send([
      { key: 'a', label: 'No finding chosen', factor: 'finding', level: 'high' },
      { key: 'b', label: 'Unknown finding', factor: 'finding', finding: 'fetal_sex', level: 'high' },
      { key: 'c', label: 'Hb without a value', factor: 'lowestHb', op: 'lt', level: 'high' },
    ]);
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['riskRules.0.finding', 'riskRules.1.finding', 'riskRules.2.value']);
    const good = await send([
      { key: 'twins', label: 'Twins', factor: 'finding', finding: 'multiple', op: 'lt', value: 3, condition: 'diabetes', level: 'moderate' },
      { key: 'hb9', label: 'Hb under 9', factor: 'lowestHb', op: 'lt', value: 9, finding: 'gdm', level: 'high' },
    ]);
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    // only the fields that matter for each kind of rule are kept
    expect(good.body.template.riskRules).toEqual([
      expect.objectContaining({ key: 'twins', factor: 'finding', finding: 'multiple', op: null, value: null, condition: null, level: 'moderate' }),
      expect.objectContaining({ key: 'hb9', factor: 'lowestHb', op: 'lt', value: 9, finding: null }),
    ]);
  });
});
