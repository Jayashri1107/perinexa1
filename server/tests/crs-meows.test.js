// Clinical Requirements Group B, item 8 (PX-OBG-11): the MEOWS chart as the manual's page OBG-F-05 v1.0 gives it
// (docs/field_schemas/build8_meows.json): RED / AMBER bands, the chart header, escalation E1–E4 through the bell and
// the ward list, the late-entry badge (PX-X-04) and the three OBG-A-05 dashboard rows. The schema's five acceptance
// tests are the "acceptance" block (the fifth, the printout, is in client/src/pages/inpatient/meows.test.jsx).
// Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/inpatient/meowsRules.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { MEOWS_PARAMETERS, MEOWS_SOURCE, bandOf, meowsResult, nextDue, shockIndex, toCelsius } from '../src/clinical/meows.js';
import { first24hOnTime, meowsKpis } from '../src/clinical/meowsKpi.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { MeowsEntry } from '../src/models/MeowsEntry.js';
import { Notification } from '../src/models/Notification.js';
import { entryDelayMinutes, isLateEntry } from '../src/utils/lateEntry.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', admin: 'admin' };
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
  hospital = await createTenant('MEOWS Hospital');
  other = await createTenant('Other MEOWS Hospital');
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
/** Moves the clock (and logs everyone in again – a jump of hours would end the sessions for inactivity). */
const clock = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {};
};
async function admitted(careType = 'postnatal', admittedAt = '2026-11-10T01:00:00.000Z') {
  const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType, fullName: 'Meows Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
  const a = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'anc', admittedAt, ward: 'Postnatal ward', bed: '3', reason: 'After delivery' })).body.admission;
  return { p, a };
}
const record = async (who, p, a, over = {}) => (await as(who)).post('/api/meows').send({ clientRequestId: randomUUID(), patientId: p.id, admissionId: a.id, at: '2026-11-10T05:30:00.000Z', ...over });
const header = async (who, p, a, over = {}) => (await as(who)).put('/api/meows/chart').send({ patientId: p.id, admissionId: a.id, context: 'postnatal', contextDetail: 'Postnatal day 1', diagnosis: 'Normal delivery', frequencyMinutes: 240, ...over });
const chart = async (who, p, a) => (await as(who)).get(`/api/meows?patientId=${p.id}&admissionId=${a.id}`);
const NORMAL = { rr: 16, spo2: 98, temp: 36.8, sbp: 118, dbp: 76, hr: 84, avpu: 'A' };

describe('the MEOWS rules (OBG-F-05 v1.0)', () => {
  it('puts each reading in its band, with the edges where the page puts them', () => {
    expect([9, 10, 20, 21, 30, 31].map((v) => bandOf('rr', v))).toEqual(['red', 'normal', 'normal', 'amber', 'amber', 'red']);
    expect([91, 92, 94, 95].map((v) => bandOf('spo2', v))).toEqual(['red', 'amber', 'amber', 'normal']);
    expect([34.9, 35, 36, 36.1, 37.4, 37.5, 37.9, 38].map((v) => bandOf('tempC', v))).toEqual(['red', 'amber', 'amber', 'normal', 'normal', 'amber', 'amber', 'red']);
    expect([39, 40, 50, 51, 99, 100, 120, 121].map((v) => bandOf('hr', v))).toEqual(['red', 'amber', 'amber', 'normal', 'normal', 'amber', 'amber', 'red']);
    expect([89, 90, 100, 101, 149, 150, 159, 160].map((v) => bandOf('sbp', v))).toEqual(['red', 'amber', 'amber', 'normal', 'normal', 'amber', 'amber', 'red']);
    expect([89, 90, 109, 110].map((v) => bandOf('dbp', v))).toEqual(['normal', 'amber', 'amber', 'red']);
    expect([99, 100, 120, 121].map((v) => bandOf('urine4h', v))).toEqual(['red', 'amber', 'amber', 'normal']);
    expect([6, 7, 10].map((v) => bandOf('pain', v))).toEqual(['normal', 'amber', 'amber']);
    expect(['A', 'V', 'P', 'U', null].map((v) => bandOf('avpu', v))).toEqual(['normal', 'amber', 'red', 'red', null]);
    expect([bandOf('avpu', 'A', { confusion: true }), bandOf('avpu', null, { confusion: true }), bandOf('avpu', 'P', { confusion: true })]).toEqual(['amber', 'amber', 'red']);
    expect(['normal', 'heavy', 'offensive', 'heavy_and_offensive', 'na'].map((v) => bandOf('lochia', v))).toEqual(['normal', 'red', 'red', 'red', null]);
    expect(['firm', 'soft', 'rising', 'na'].map((v) => bandOf('fundus', v))).toEqual(['normal', 'red', 'red', null]);
    expect([bandOf('nurseConcern', true), bandOf('nurseConcern', false), bandOf('nurseConcern', null)]).toEqual(['red', 'normal', null]);
    expect(toCelsius(100.4)).toBe(38);
    expect(MEOWS_SOURCE).toMatch(/OBG-F-05 v1\.0/);
  });

  it('one red or two amber is E1; two red E2; shock index 0.9 or more E3; nurse concern alone is a trigger', () => {
    expect(meowsResult({ rr: 16, hr: 84 })).toMatchObject({ level: 'normal', escalation: [] });
    expect(meowsResult({ rr: 22, hr: 84 })).toMatchObject({ level: 'watch', ambers: 1 });
    expect(meowsResult({ rr: 22, hr: 105 })).toMatchObject({ level: 'trigger', escalation: ['E1'] });
    expect(meowsResult({ nurseConcern: true })).toMatchObject({ level: 'trigger', reds: 1, escalation: ['E1'] });
    expect(meowsResult({ spo2: 90, avpu: 'U' })).toMatchObject({ reds: 2, escalation: ['E1', 'E2'] });
    expect(meowsResult({ hr: 99, sbp: 110, dbp: 70 })).toMatchObject({ shockIndex: 0.9, shockIndexRed: true, escalation: ['E3'] });
    expect(shockIndex(84, null)).toBeNull();
    expect(meowsResult({ sbp: 160, dbp: 80 }).hypertensiveEmergency).toBe(true);
    expect(meowsResult({ sbp: 140, dbp: 110 }).hypertensiveEmergency).toBe(true);
    expect(meowsResult({ sbp: 159, dbp: 109 }).hypertensiveEmergency).toBe(false);
    expect(meowsResult({ rr: 16 }).missing).toEqual(['spo2', 'tempC', 'hr', 'sbp', 'dbp', 'avpu']);
  });

  it('the website colours the readings with the same table', () => {
    expect(website.MEOWS_PARAMETERS).toEqual(MEOWS_PARAMETERS);
    expect(website.CHOICE_ROWS).toBeDefined();
    for (const v of [{ rr: 22, hr: 105 }, { spo2: 93 }, { tempC: 35.5 }, { sbp: 155, dbp: 95 }, { avpu: 'V' }, { confusion: true, pain: 8 }, { lochia: 'heavy', fundus: 'soft', nurseConcern: true }, { hr: 125, sbp: 88 }, {}])
      expect(website.meowsResult(v), JSON.stringify(v)).toEqual(meowsResult(v));
    const t = new Date('2026-11-10T10:00:00Z');
    expect(website.nextDue({ frequency: 240, last: { at: t, level: 'normal' } }, new Date('2026-11-10T14:16:00Z'))).toEqual(nextDue({ frequency: 240, last: { at: t, level: 'normal' } }, new Date('2026-11-10T14:16:00Z')));
  });

  it('late entry: typed more than 60 minutes after the clinical time (PX-X-04, a helper any chart can use)', () => {
    expect(entryDelayMinutes('2026-11-10T02:10:00Z', '2026-11-10T03:40:00Z')).toBe(90);
    expect(isLateEntry('2026-11-10T02:10:00Z', '2026-11-10T03:10:00Z')).toBe(false); // exactly 60
    expect(isLateEntry('2026-11-10T02:10:00Z', '2026-11-10T03:10:01Z')).toBe(true);
    expect(isLateEntry(null, '2026-11-10T03:10:00Z')).toBe(false);
  });
});

describe('acceptance tests of build8_meows.json', () => {
  it('1. HR 125 + SBP 88 → shock index 1.42, red count 2, consultant task created, PPH suggested (E3)', async () => {
    const { p, a } = await admitted();
    await header('drA', p, a);
    const r = await record('nurse', p, a, { hr: 125, sbp: 88, dbp: 60, actionTaken: 'Called the resident, IV access' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.entry).toMatchObject({ shockIndex: 1.42, reds: 2, level: 'trigger', escalation: ['E1', 'E2', 'E3'], e2Reason: 'two_red' });
    expect(r.body.entry.tasks.map((t) => t.key)).toEqual(['resident_review', 'consultant_bedside', 'anaesthetist_informed']);
    expect(r.body.entry.tasks.find((t) => t.key === 'consultant_bedside')).toMatchObject({ rule: 'E2', label: 'Consultant at the bedside', doneAt: null });
    // The bell: her consultant and the RMOs, never the nurse who recorded it; no readings in the text
    const bell = await Notification.find({ tenantId: hospital._id, kind: 'meows' }).lean();
    expect(bell.map((n) => String(n.userId)).sort()).toEqual([String(people.drA._id), String(people.rmo._id)].sort());
    expect(bell[0].text).toMatch(/^MEOWS E2: Meows Mother, Postnatal ward bed 3 – consultant to the bedside/);
    expect(bell[0].text).not.toMatch(/125|88|1\.42/);
    expect(bell[0].link).toBe(`/patients/${p.id}/stays/${a.id}`);
    // The PPH suggestion is shown on a postnatal chart (client test: MeowsChart shows the link to the PPH chart)
    expect((await chart('nurse', p, a)).body.header.context).toBe('postnatal');
  });

  it('2. Temp 37.6 + pulse 105 → amber count 2 → E1; a resident task due in 30 min', async () => {
    const { p, a } = await admitted();
    const r = await record('nurse', p, a, { ...NORMAL, temp: 37.6, hr: 105, actionTaken: 'Resident called' });
    expect(r.body.entry).toMatchObject({ ambers: 2, reds: 0, level: 'trigger', escalation: ['E1'] });
    expect(r.body.entry.tasks).toEqual([expect.objectContaining({ key: 'resident_review', rule: 'E1', dueAt: '2026-11-10T06:00:00.000Z', doneAt: null })]);
    expect((await Notification.findOne({ tenantId: hospital._id, kind: 'meows', userId: people.rmo._id }).lean()).text).toMatch(/E1: .* resident to the bedside within 30 min/);
    // E1 also brings the next set forward: due 30 min after the trigger
    expect((await chart('nurse', p, a)).body.status).toMatchObject({ dueAt: '2026-11-10T06:00:00.000Z', overdue: false });
  });

  it('3. Frequency 240 min; last observations 10:00; at 14:16 the stay shows overdue', async () => {
    const { p, a } = await admitted();
    await header('drA', p, a, { frequencyMinutes: 240 });
    clock('2026-11-10T10:05:00Z');
    expect((await record('nurse', p, a, { ...NORMAL, at: '2026-11-10T10:00:00.000Z' })).status).toBe(201);
    clock('2026-11-10T14:15:00Z');
    expect((await chart('nurse', p, a)).body.status).toMatchObject({ dueAt: '2026-11-10T14:00:00.000Z', overdue: false });
    clock('2026-11-10T14:16:00Z');
    expect((await chart('nurse', p, a)).body.status).toMatchObject({ overdue: true });
    // On the ward's list (E4: the worklist flag for the ward nurse)
    const ward = await (await as('nurse')).get('/api/inpatients');
    expect(ward.body.admitted.find((s) => s.admissionId === a.id).meows).toMatchObject({ frequencyMinutes: 240, overdue: true, dueAt: '2026-11-10T14:00:00.000Z', openTasks: 0 });
  });

  it("4. Entry at 03:40 with clinical time 02:10 shows 'late entry' (screen and print use the same flag)", async () => {
    const { p, a } = await admitted();
    clock('2026-11-10T03:40:00Z');
    const late = await record('nurse', p, a, { ...NORMAL, at: '2026-11-10T02:10:00.000Z' });
    expect(late.body.entry).toMatchObject({ at: '2026-11-10T02:10:00.000Z', enteredAt: '2026-11-10T03:40:00.000Z', lateEntry: true });
    const onTime = await record('nurse', p, a, { ...NORMAL, at: '2026-11-10T03:00:00.000Z' });
    expect(onTime.body.entry.lateEntry).toBe(false);
    expect((await chart('nurse', p, a)).body.entries.map((e) => e.lateEntry)).toEqual([false, true]);
  });
});

describe('the MEOWS chart of a stay', () => {
  it('the header is a doctor’s order; blood loss is copied from the signed delivery note and can be corrected', async () => {
    const { p, a } = await admitted();
    expect((await header('nurse', p, a)).status).toBe(403);
    expect((await header('drA', p, a, { frequencyMinutes: 45 })).body.error.fields.frequencyMinutes).toBeTruthy();
    const h = await header('rmo', p, a, { frequencyMinutes: 60, bloodLossMl: 450, lmwhPrescribed: true });
    expect(h.status, JSON.stringify(h.body)).toBe(200);
    expect(h.body.header).toMatchObject({ context: 'postnatal', frequencyMinutes: 60, bloodLossMl: 450, bloodLossFrom: 'typed', lmwhPrescribed: true, byName: 'Sample rmo' });
    expect((await header('drA', p, a, { frequencyMinutes: 5 })).body.header.frequencyMinutes).toBe(5); // kept for the PPH chart
    const c = await chart('nurse', p, a);
    expect(c.body.access).toEqual({ write: true, order: false });
    expect(c.body.copied).toEqual({ bloodLossMl: null, deliveredAt: null, lmwh: null });
    expect(c.body.rules.frequencies).toEqual([15, 30, 60, 240, 480]);
  });

  it('records the new fields; a trigger needs the action taken; the audit log has the level and rules, never the readings', async () => {
    const { p, a } = await admitted();
    const full = { ...NORMAL, urine4h: 300, confusion: 'no', pain: 3, lochia: 'normal', fundus: 'firm', wound: 'normal', nurseConcern: 'no', doctorInformedAt: '' };
    const ok = await record('nurse', p, a, full);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.entry).toMatchObject({ level: 'normal', reds: 0, ambers: 0, byName: 'Sample nurse', values: { urine4h: 300, confusion: false, lochia: 'normal', nurseConcern: false }, shockIndex: 0.71 });
    const refused = await record('nurse', p, a, { ...NORMAL, nurseConcern: 'yes' });
    expect(refused.body.error.fields.actionTaken).toMatch(/tell the doctor now/);
    const t = await record('nurse', p, a, { ...NORMAL, sbp: 165, dbp: 112, actionTaken: 'Resident called', doctorInformedAt: '2026-11-10T05:35:00.000Z', escalatedTo: 'Dr Sample (on call)' });
    expect(t.body.entry).toMatchObject({ level: 'trigger', hypertensiveEmergency: true, reds: 2, bands: { sbp: 'red', dbp: 'red' }, doctorInformedAt: '2026-11-10T05:35:00.000Z' });
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'MEOWS_RECORDED', 'details.level': 'trigger' }).lean();
    expect(entry.details).toMatchObject({ patientId: p.id, level: 'trigger', escalation: 'E1,E2' });
    expect(Object.keys(entry.details).sort()).toEqual(['admissionId', 'entryId', 'escalation', 'level', 'mrn', 'patientId']); // never the readings
  });

  it('E2 when E1 stays open 60 minutes without improvement; one open task of each kind; tasks marked done', async () => {
    const { p, a } = await admitted();
    const first = (await record('nurse', p, a, { ...NORMAL, rr: 22, hr: 105, at: '2026-11-10T04:00:00.000Z', actionTaken: 'Resident called' })).body.entry;
    const again = (await record('nurse', p, a, { ...NORMAL, rr: 22, hr: 105, at: '2026-11-10T04:30:00.000Z', actionTaken: 'Repeated' })).body.entry;
    expect(again.escalation).toEqual(['E1']);
    expect(again.tasks).toEqual([]); // the resident task of 04:00 is still open
    const late = (await record('nurse', p, a, { ...NORMAL, rr: 22, hr: 105, at: '2026-11-10T05:00:00.000Z', actionTaken: 'Consultant called' })).body.entry;
    expect(late).toMatchObject({ escalation: ['E1', 'E2'], e2Reason: 'no_improvement' });
    expect(late.tasks.map((x) => x.key)).toEqual(['consultant_bedside', 'anaesthetist_informed']);
    // Done: the resident came at 04:20
    const done = await (await as('rmo')).post(`/api/meows/${first.id}/tasks/resident_review`).send({ at: '2026-11-10T04:20:00.000Z' });
    expect(done.body.entry.tasks[0]).toMatchObject({ doneAt: '2026-11-10T04:20:00.000Z', byName: 'Sample rmo' });
    expect((await (await as('rmo')).post(`/api/meows/${first.id}/tasks/resident_review`).send({})).status).toBe(409);
    expect((await (await as('nurse')).post(`/api/meows/${late.id}/tasks/anaesthetist_informed`).send({ at: '2026-11-10T04:00:00.000Z' })).body.error.fields.at).toMatch(/before the observations/);
    const ward = await (await as('nurse')).get('/api/inpatients');
    expect(ward.body.admitted.find((s) => s.admissionId === a.id).meows).toMatchObject({ openTasks: 2, lateTasks: 2, level: 'trigger' });
    // An improvement ends the run
    const better = (await record('nurse', p, a, { ...NORMAL, at: '2026-11-10T05:45:00.000Z' })).body.entry;
    expect(better.level).toBe('normal');
    expect((await chart('nurse', p, a)).body.status.e2Due).toBe(false);
  });

  it('E1 open 60 minutes with no newer set shows E2 due on the chart', async () => {
    const { p, a } = await admitted();
    await record('nurse', p, a, { ...NORMAL, rr: 22, hr: 105, at: '2026-11-10T04:30:00.000Z', actionTaken: 'Resident called' });
    expect((await chart('nurse', p, a)).body.status.e2Due).toBe(true); // now 06:00
  });

  it('pathway, antibiotic and antihypertensive times – once each – feed the OBG-A-05 rows', async () => {
    const { p, a } = await admitted();
    const sepsis = (await record('nurse', p, a, { ...NORMAL, temp: 38.4, hr: 125, at: '2026-11-10T03:00:00.000Z', actionTaken: 'Resident called' })).body.entry;
    expect((await (await as('nurse')).post(`/api/meows/${sepsis.id}/follow-up`).send({ antibioticAt: '2026-11-10T03:40:00.000Z' })).body.error.fields.antibioticAt).toMatch(/sepsis pathway first/);
    expect((await (await as('rmo')).post(`/api/meows/${sepsis.id}/follow-up`).send({ pathway: 'sepsis' })).body.entry.pathway).toMatchObject({ key: 'sepsis', code: 'OBG-ALG-07', byName: 'Sample rmo' });
    expect((await (await as('rmo')).post(`/api/meows/${sepsis.id}/follow-up`).send({ pathway: 'pph' })).status).toBe(409);
    expect((await (await as('nurse')).post(`/api/meows/${sepsis.id}/follow-up`).send({ antibioticAt: '2026-11-10T03:40:00.000Z' })).body.entry.antibioticAt).toMatchObject({ at: '2026-11-10T03:40:00.000Z', byName: 'Sample nurse' });
    expect((await (await as('nurse')).post(`/api/meows/${sepsis.id}/follow-up`).send({ antihypertensiveAt: '2026-11-10T03:40:00.000Z' })).body.error.fields.antihypertensiveAt).toMatch(/hypertensive emergency/);
    // Severe hypertension: a run of two flagged sets is one emergency, treated at 25 min
    const h1 = (await record('nurse', p, a, { ...NORMAL, sbp: 170, dbp: 100, at: '2026-11-10T04:00:00.000Z', actionTaken: 'Resident called' })).body.entry;
    const h2 = (await record('nurse', p, a, { ...NORMAL, sbp: 165, dbp: 100, at: '2026-11-10T04:15:00.000Z', actionTaken: 'Repeated' })).body.entry;
    await (await as('nurse')).post(`/api/meows/${h2.id}/follow-up`).send({ antihypertensiveAt: '2026-11-10T04:25:00.000Z' });
    expect(h1.hypertensiveEmergency).toBe(true);
    const k = await meowsKpis(hospital._id, { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') }, new Date('2026-11-12T00:00:00Z'));
    expect(k.meowsSepsisAbx1h).toEqual({ value: 100, numerator: 1, denominator: 1 });
    expect(k.meowsSevereHtn30).toEqual({ value: 100, numerator: 1, denominator: 1 });
    expect(k.meows4hFirst24h).toEqual({ value: null, numerator: 0, denominator: 0 }); // no postnatal chart header
    // The rows are on the obstetrics dashboard
    const dash = await (await as('drA')).get('/api/dashboards?department=obstetrics&month=2026-11');
    expect(dash.status).toBe(200);
    expect(dash.body.rows.find((r) => r.key === 'meowsSevereHtn30')).toMatchObject({ value: 100, numerator: 1, denominator: 1 });
    expect(dash.body.rows.map((r) => r.key)).toEqual(expect.arrayContaining(['meows4hFirst24h', 'meowsSepsisAbx1h', 'meowsSevereHtn30']));
  });

  it('MEOWS 4-hourly in the first 24 h postnatal: gaps longer than 4 h 15 min fail the stay', async () => {
    const from = new Date('2026-11-10T01:00:00Z');
    const every = (h) => Array.from({ length: Math.floor(24 / h) }, (_, i) => new Date(from.getTime() + (i + 1) * h * 3_600_000));
    expect(first24hOnTime(from, every(4), 240)).toBe(true);
    expect(first24hOnTime(from, every(4).filter((_, i) => i !== 2), 240)).toBe(false); // one set missed: an 8-h gap
    expect(first24hOnTime(from, every(4), 480)).toBe(true); // ordered 8-hourly: the indicator still asks 4-hourly
    expect(first24hOnTime(from, every(8), 480)).toBe(false);
    const { p, a } = await admitted();
    await header('drA', p, a, { frequencyMinutes: 240 });
    clock('2026-11-11T02:00:00Z');
    for (const h of [4, 8, 12, 16, 20]) expect((await record('nurse', p, a, { ...NORMAL, at: new Date(from.getTime() + h * 3_600_000).toISOString() })).status).toBe(201);
    const month = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') };
    expect((await meowsKpis(hospital._id, month, new Date('2026-11-10T20:00:00Z'))).meows4hFirst24h.denominator).toBe(0); // first 24 h not over yet
    expect((await meowsKpis(hospital._id, month, new Date('2026-11-12T00:00:00Z'))).meows4hFirst24h).toEqual({ value: 100, numerator: 1, denominator: 1 });
  });

  it('checks the readings and the time; a mistake is marked entered in error, never deleted', async () => {
    const { p, a } = await admitted();
    expect((await record('nurse', p, a, {})).body.error.fields.rr).toMatch(/at least one/);
    expect((await record('nurse', p, a, { sbp: 120 })).body.error.fields.sbp).toMatch(/both/);
    expect((await record('nurse', p, a, { temp: 37, tempUnit: 'F' })).body.error.fields.temp).toMatch(/°C/);
    expect((await record('nurse', p, a, { rr: 70 })).body.error.fields.rr).toMatch(/too high/);
    expect((await record('nurse', p, a, { pain: 11 })).body.error.fields.pain).toMatch(/too high/);
    expect((await record('nurse', p, a, { lochia: 'scanty' })).status).toBe(400);
    expect((await record('nurse', p, a, { ...NORMAL, at: '2026-11-10T07:00:00.000Z' })).body.error.fields.at).toMatch(/future/);
    expect((await record('nurse', p, a, { ...NORMAL, at: '2026-11-09T07:00:00.000Z' })).body.error.fields.at).toMatch(/before she was admitted/);
    const e = (await record('nurse', p, a, NORMAL)).body.entry;
    const c = await (await as('nurse')).post(`/api/meows/${e.id}/cancel`).send({ reason: 'Wrong patient' });
    expect(c.body.entry.cancelled).toMatchObject({ reason: 'Wrong patient', byName: 'Sample nurse' });
    expect(await MeowsEntry.countDocuments({ tenantId: hospital._id })).toBe(1);
    expect((await chart('drA', p, a)).body.latest).toBeNull();
    expect((await (await as('nurse')).post(`/api/meows/${e.id}/follow-up`).send({ pathway: 'sepsis' })).status).toBe(409);
  });

  it('reception and the admin have no chart; another hospital never finds the stay; not on a baby', async () => {
    const { p, a } = await admitted();
    for (const who of ['reception', 'admin']) expect((await chart(who, p, a)).status, who).toBe(403);
    expect((await chart('otherDr', p, a)).status).toBe(404);
    expect((await (await as('otherDr')).put('/api/meows/chart').send({ patientId: p.id, admissionId: a.id, context: 'postnatal', frequencyMinutes: 240 })).status).toBe(404);
    const e = (await record('nurse', p, a, { ...NORMAL, rr: 22, hr: 105, actionTaken: 'Resident called' })).body.entry;
    expect((await (await as('otherDr')).post(`/api/meows/${e.id}/tasks/resident_review`).send({})).status).toBe(404);
    const baby = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'newborn', fullName: 'Baby Meows', ageYears: undefined, assignedDoctor: people.drA._id.toString(), newborn: { birthAt: '2026-11-09T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female' } }))).body.patient;
    expect((await (await as('drA')).get(`/api/meows?patientId=${baby.id}&admissionId=${a.id}`)).status).toBe(400);
  });
});
