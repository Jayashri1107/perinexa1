// Clinical Requirements Group A, item 4 (PX-NEO-13, PX-NEO-15, part of PX-NEO-14 and PX-COM-02): the newborn screening
// log with due dates (ROP per NNF / RBSK), the high-risk follow-up clinic at corrected age, the defaulter list, and
// the newborn follow-up coordinator, who never opens the medical record. Fake data only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { needsRop, schedule } from '../src/clinical/newbornSchedule.js';
import { TENANT_ROLES } from '../src/models/Membership.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', nurse: 'nurse', coord: 'followup_coordinator', reception: 'receptionist', admin: 'admin' };
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
  hospital = await createTenant('Newborn Hospital');
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
async function baby(birthAt, birthWeightGrams, fullName = 'Baby Sample') {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'newborn', fullName, ageYears: undefined, assignedDoctor: people.drA._id.toString(), newborn: { birthAt, birthWeightGrams, sex: 'female' } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const day = (d) => new Date(d).toISOString().slice(0, 10);

describe('the schedule (DRAFT – NNF / RBSK)', () => {
  it('every baby: pulse oximetry on days 1–2, metabolic screen on days 1–3, hearing by day 30', () => {
    const s = schedule({ birthAt: '2026-11-01T04:00:00Z', gestationWeeks: 39, birthWeightGrams: 3100 });
    expect(s.screens.map((x) => [x.key, day(x.dueFrom), day(x.dueBy)])).toEqual([
      ['cchd', '2026-11-02', '2026-11-03'],
      ['metabolic', '2026-11-02', '2026-11-04'],
      ['hearing', '2026-11-01', '2026-12-01'],
    ]);
    expect(s.visits).toEqual([]); // the follow-up clinic is for high-risk babies
  });

  it('ROP for babies born before 34 weeks or under 1750 g – by day 30, and by day 21 before 28 weeks or under 1200 g', () => {
    expect([needsRop({ gestationWeeks: 33 }), needsRop({ gestationWeeks: 34, birthWeightGrams: 1749 }), needsRop({ gestationWeeks: 36, birthWeightGrams: 2000 }), needsRop({})]).toEqual([true, true, false, null]);
    const rop = (o) => schedule({ birthAt: '2026-11-01T04:00:00Z', ...o }).screens.find((x) => x.key === 'rop');
    expect([day(rop({ gestationWeeks: 32, birthWeightGrams: 1500 }).dueFrom), day(rop({ gestationWeeks: 32, birthWeightGrams: 1500 }).dueBy)]).toEqual(['2026-11-21', '2026-12-01']);
    expect([day(rop({ gestationWeeks: 27, birthWeightGrams: 900 }).dueFrom), day(rop({ gestationWeeks: 27, birthWeightGrams: 900 }).dueBy)]).toEqual(['2026-11-15', '2026-11-22']);
    expect(rop({ gestationWeeks: 38, birthWeightGrams: 3000 })).toBeUndefined();
  });

  it('follow-up visits at term-equivalent age, then 3 to 18 months of corrected age', () => {
    // Born at 30+0 weeks on 1 Nov 2026: 40 weeks on 10 Jan 2027
    const s = schedule({ birthAt: '2026-11-01T04:00:00Z', gestationWeeks: 30, gestationDays: 0, birthWeightGrams: 1300, highRisk: true });
    expect(s.visits.map((v) => [v.key, day(v.dueOn)])).toEqual([
      ['term', '2027-01-10'],
      ['m3', '2027-04-10'],
      ['m6', '2027-07-10'],
      ['m9', '2027-10-10'],
      ['m12', '2028-01-10'],
      ['m18', '2028-07-10'],
    ]);
    // A term baby: corrected age is her age
    expect(day(schedule({ birthAt: '2026-11-01T04:00:00Z', gestationWeeks: 41, birthWeightGrams: 3000, highRisk: true }).visits[1].dueOn)).toBe('2027-02-01');
  });
});

describe('the screening log', () => {
  it('lists every recent baby with what is due; a missed screen makes her a defaulter until it is recorded', async () => {
    const b = await baby('2026-11-01T04:00:00.000Z', 3100);
    const list = await (await as('nurse')).get('/api/newborn-follow-up?show=defaulters');
    expect(list.status).toBe(200);
    const row = list.body.babies.find((x) => x.patientId === b.id);
    expect(row.screens.map((x) => [x.key, x.state])).toEqual([
      ['cchd', 'overdue'],
      ['metabolic', 'overdue'],
      ['hearing', 'due'],
    ]);
    const nurse = await as('nurse');
    expect((await nurse.post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'screen', key: 'cchd', status: 'done', on: '2026-11-02' })).body.error.fields.result).toBe('Choose the result');
    expect((await nurse.post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'screen', key: 'cchd', status: 'done', on: '2026-11-02', result: 'pass' })).status).toBe(201);
    expect((await nurse.post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'screen', key: 'cchd', status: 'done', on: '2026-11-02', result: 'pass' })).status).toBe(409);
    expect((await nurse.post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'screen', key: 'metabolic', status: 'not_needed', on: '2026-11-03' })).body.error.fields.note).toMatch(/why/);
    const done = await nurse.post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'screen', key: 'metabolic', status: 'done', on: '2026-11-03', result: 'normal', note: 'Sent with the state sample' });
    expect(done.body.baby).toMatchObject({ defaulter: false, due: true });
    expect(done.body.baby.screens[1].record).toMatchObject({ status: 'done', result: 'normal', note: 'Sent with the state sample', byName: 'Sample nurse' });
    expect((await nurse.post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'screen', key: 'rop', status: 'done', on: '2026-11-03', result: 'no_rop' })).body.error.fields.key).toMatch(/not on her schedule/);
  });

  it('a high-risk preterm baby gets ROP and the clinic; a visit not attended 14 days after its date is a defaulter', async () => {
    vi.setSystemTime(new Date('2027-01-30T06:00:00Z'));
    sessions = {};
    const b = await baby('2026-11-01T04:00:00.000Z', 1300, 'Baby Preterm');
    const dr = await as('drA');
    expect((await dr.put(`/api/newborn-follow-up/patients/${b.id}`).send({ gestationWeeks: 30, gestationDays: 0, highRisk: true, highRiskReasons: [] })).body.error.fields.highRiskReasons).toMatch(/why/);
    const set = await dr.put(`/api/newborn-follow-up/patients/${b.id}`).send({ gestationWeeks: 30, gestationDays: 0, highRisk: true, highRiskReasons: ['preterm', 'nicu_stay'] });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.baby.needsRop).toBe(true);
    expect(set.body.baby.visits[0]).toMatchObject({ key: 'term', state: 'defaulter' }); // 10 Jan + 14 days < 30 Jan
    const coord = await as('coord');
    const attended = await coord.post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'visit', key: 'term', status: 'attended', on: '2027-01-28' });
    expect(attended.status, JSON.stringify(attended.body)).toBe(201);
    expect(attended.body.baby.visits[0]).toMatchObject({ state: 'attended', record: { status: 'attended', byName: 'Sample coord' } });
  });

  it('the coordinator sees names, numbers and dates – never results, notes or the medical record – and records only visits', async () => {
    const b = await baby('2026-11-01T04:00:00.000Z', 3100);
    await (await as('nurse')).post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'screen', key: 'cchd', status: 'done', on: '2026-11-02', result: 'refer', note: 'Repeat in 1 hour' });
    const coord = await as('coord');
    const log = await coord.get(`/api/newborn-follow-up/patients/${b.id}`);
    expect(log.status).toBe(200);
    expect(log.body.baby.screens[0].record).toEqual({ status: 'done', on: '2026-11-02T00:00:00.000Z', byName: 'Sample nurse', at: NOW.toISOString() });
    expect(JSON.stringify(log.body)).not.toMatch(/refer|Repeat|gestationWeeks|birthWeightGrams/);
    expect((await coord.post(`/api/newborn-follow-up/patients/${b.id}/records`).send({ kind: 'screen', key: 'hearing', status: 'done', on: '2026-11-05', result: 'pass' })).status).toBe(403);
    expect((await coord.put(`/api/newborn-follow-up/patients/${b.id}`).send({ gestationWeeks: 39, highRisk: false })).status).toBe(403);
    expect((await coord.get(`/api/patients/${b.id}`)).status).toBe(403); // never the medical record
    expect((await coord.get('/api/patients')).status).toBe(403);
    for (const who of ['reception', 'admin']) expect((await (await as(who)).get('/api/newborn-follow-up')).status, who).toBe(403);
    expect(TENANT_ROLES).toContain('followup_coordinator');
  });
});
