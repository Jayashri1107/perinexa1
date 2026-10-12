// The calendar through the API: GET /api/calendar (booked visits, care-plan visits, EDD and LMP by day, week
// and month) – who sees what, the dates, the counts and the limits. Fake data only.
// Time is pinned (Date only): 12 Oct 2026, 11:30 in India, unless a case says otherwise. The cases share one
// set of patients and run in order; the cases that change data come after the ones that read it.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { refreshStalePlans, resetStalePlansTimer, setStalePlanOptionsForTests } from '../src/careplans/plansService.js';
import { ensureStandardTemplates, refreshDueRisks, resetApprovalBackfill, resetRiskRefreshTimer } from '../src/careplans/templatesService.js';
import { planEvents } from '../src/calendar/calendarEvents.js';
import { latestVisitsPipeline, planVisitsPipeline, setCalendarLimitsForTests } from '../src/calendar/calendarLoad.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { Patient } from '../src/models/Patient.js';
import { Visit } from '../src/models/Visit.js';
import { patientAccess, pregnancyVisibleFilter } from '../src/utils/patientAccess.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, samplePatient } from './helpers.js';

const NOW = '2026-10-12T06:00:00Z'; // 11:30 in India
const D = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (v) => (v == null ? null : new Date(v).toISOString().slice(0, 10));
const CALENDAR_MESSAGE = "Your role in this hospital doesn't include the calendar.";

const ROLES = {
  drA: 'doctor',
  drB: 'doctor',
  rmo: 'rmo',
  reception: 'receptionist',
  nurse: 'nurse',
  lab: 'lab',
  admin: 'admin',
  nurseReception: ['nurse', 'receptionist'],
  doctorReception: ['doctor', 'receptionist'],
};

let app;
let hospital;
let other;
let people;
let sessions;
const P = {}; // patient ids (strings)
const V = {}; // visit ids (strings)

// ---------- Helpers ----------

async function setTime(instant) {
  vi.setSystemTime(new Date(instant));
  app = createApp();
  sessions = {};
}
const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const cal = async (who, query = '') => (await as(who)).get(`/api/calendar${query ? `?${query}` : ''}`);
async function calOk(who, query) {
  const res = await cal(who, query);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
const eventsOf = (body, pid) => body.events.filter((e) => e.patientId === pid);
const ids = (body) => body.events.map((e) => e.id).sort();
const day = (body, date) => body.days.find((d) => d.date === date);

const antenatal = (overrides = {}) =>
  samplePatient({
    careType: 'antenatal',
    ageYears: 28,
    obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
    medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
    ...overrides,
  });

async function register(who, body) {
  const res = await (await as(who)).post('/api/patients').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient.id;
}

async function insertVisit(patientId, { visitOn, next = null, note = '', status = 'active', by = people.drA }) {
  const v = await Visit.create({
    tenantId: hospital._id,
    patientId,
    visitOn: D(visitOn),
    careType: 'antenatal',
    status,
    ...(status === 'cancelled' ? { cancelled: { reason: 'Entered in error', byName: 'Dr A', at: new Date() } } : {}),
    clientRequestId: randomUUID(),
    details: { nextVisitOn: next ? D(next) : null, nextVisitNote: note },
    createdBy: by._id,
    createdByName: by.name,
  });
  return String(v._id);
}

// Each insert one second apart, so "inserted later" is also "created later".
let tick = 0;
async function insertVisitLater(patientId, fields) {
  tick += 1;
  vi.setSystemTime(new Date(new Date(NOW).getTime() + tick * 1000));
  const id = await insertVisit(patientId, fields);
  vi.setSystemTime(new Date(NOW));
  return id;
}

const tabPlan = async (who, pid) => {
  const res = await (await as(who)).get(`/api/patients/${pid}/care-plan`);
  expect(res.status).toBe(200);
  return res.body.plan;
};

function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

// ---------- Fixtures ----------

beforeAll(async () => {
  await connectTestDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  resetApprovalBackfill();
  resetRiskRefreshTimer();
  resetStalePlansTimer();
  hospital = await createTenant('Calendar Test Hospital');
  other = await createTenant('Calendar Other Hospital');
  people = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Calendar ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.drZ = await createUser({ name: 'Calendar drZ' });
  await addMember(people.drZ, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
  await ensureStandardTemplates(other._id);

  // P5: unassigned, registered on 1 Sep 2026 (booking 1 Sep); a custom visit weeks 22–38 added an hour later.
  await setTime('2026-09-01T06:00:00Z');
  P.p5 = await register('drA', antenatal({ fullName: 'Calendar Test Five', pregnancy: { lmp: '2026-04-06' } }));
  await setTime('2026-09-01T07:00:00Z');
  const added = await (await as('drA'))
    .post(`/api/patients/${P.p5}/care-plan/items`)
    .send({ clientRequestId: randomUUID(), kind: 'visit', name: 'Extra review visit', timing: { type: 'weeks', fromWeek: 22, toWeek: 38 } });
  expect(added.status, JSON.stringify(added.body)).toBe(201);
  await setTime('2026-09-28T06:00:00Z');
  V.v6 = await insertVisit(P.p5, { visitOn: '2026-09-28', next: '2026-10-12' });

  await setTime(NOW);
  const A = people.drA._id.toString();
  const B = people.drB._id.toString();
  P.p1 = await register('drA', antenatal({ fullName: 'Calendar Test One', assignedDoctor: A, pregnancy: { lmp: '2026-01-05' } }));
  P.p2 = await register('drA', antenatal({ fullName: 'Calendar Test Two', assignedDoctor: A, pregnancy: { lmp: '2026-10-05' } }));
  P.p3 = await register('drB', antenatal({ fullName: 'Calendar Test Three', assignedDoctor: B, pregnancy: { lmp: '2026-03-01', scanEdd: '2026-12-10' } }));
  P.p4 = await register('drB', antenatal({ fullName: 'Calendar Test Four', assignedDoctor: B, pregnancy: { lmp: '2026-01-07' } }));
  expect((await (await as('drB')).patch(`/api/patients/${P.p4}/sensitive`).send({ sensitive: true })).status).toBe(200);
  P.p6 = await register('drA', antenatal({ fullName: 'Calendar Test Six', assignedDoctor: A, pregnancy: { lmp: '2026-04-06' } }));
  P.p7 = await register('drA', samplePatient({ fullName: 'Calendar Test Seven', assignedDoctor: A }));
  P.p8 = await register('drZ', antenatal({ fullName: 'Calendar Test Eight', assignedDoctor: people.drZ._id.toString(), pregnancy: { lmp: '2026-01-05' } }));

  V.p4 = await insertVisitLater(P.p4, { visitOn: '2026-09-30', next: '2026-10-15', note: 'bring scan report', by: people.drB });
  V.v1 = await insertVisitLater(P.p7, { visitOn: '2026-09-01', next: '2026-10-14' });
  V.v2 = await insertVisitLater(P.p7, { visitOn: '2026-09-20', next: '2026-10-20', note: 'fasting sample' });
  V.v3 = await insertVisitLater(P.p7, { visitOn: '2026-09-25', next: '2026-10-15', status: 'cancelled' });
  V.v4 = await insertVisitLater(P.p2, { visitOn: '2026-10-01', next: '2026-10-16' });
  V.v5 = await insertVisitLater(P.p2, { visitOn: '2026-10-01', next: '2026-10-17', note: 'with reports' });
});

afterAll(async () => {
  setCalendarLimitsForTests({});
  setStalePlanOptionsForTests({});
  vi.useRealTimers();
  await disconnectTestDb();
});

beforeEach(async () => {
  resetRiskRefreshTimer();
  resetStalePlansTimer();
  setCalendarLimitsForTests({});
  setStalePlanOptionsForTests({});
  await setTime(NOW);
});

// ---------- Reading ----------

describe('calendar', () => {
  it('1. LMP and EDD of my patients', async () => {
    const week = await calOk('drA', 'view=week&date=2026-10-12&types=edd,lmp');
    expect(week).toMatchObject({ view: 'week', from: '2026-10-12', to: '2026-10-18', today: '2026-10-12', scope: 'mine', types: ['edd', 'lmp'], canChooseScope: true });
    expect(week.events).toEqual([{ id: `edd:${P.p1}`, type: 'edd', date: '2026-10-12', patientId: P.p1, eddSource: 'lmp' }]);
    expect(week.patients[P.p1]).toMatchObject({ mrn: expect.any(String), fullName: 'Calendar Test One', level: 'clinical', careType: 'antenatal', doctorName: 'Calendar drA', gaToday: { weeks: 40, days: 0 } });

    const earlier = await calOk('drA', 'view=week&date=2026-10-05&types=edd,lmp');
    expect(earlier.events).toEqual([{ id: `lmp:${P.p2}`, type: 'lmp', date: '2026-10-05', patientId: P.p2, edd: '2027-07-12', eddSource: 'lmp' }]);
    expect(earlier.patients[P.p2].gaToday).toEqual({ weeks: 1, days: 0 });

    const defaults = await calOk('drA');
    expect(defaults).toMatchObject({ view: 'week', date: '2026-10-12', from: '2026-10-12', to: '2026-10-18', types: ['booked', 'plan', 'edd', 'lmp'], scope: 'mine' });
  });

  it('2. the scan EDD wins over the LMP EDD', async () => {
    const month = await calOk('rmo', 'view=month&date=2026-12-01&types=edd');
    expect(month.events).toEqual([]);
    expect(month.patients).toEqual({});
    expect(month.days).toHaveLength(35);
    expect(day(month, '2026-12-10').edd).toBe(1);
    expect(day(month, '2026-12-06').edd).toBe(0);
    expect(Object.keys(day(month, '2026-12-10'))).toEqual(['date', 'edd']);
  });

  it("3. another doctor's sensitive record never shows, on any path", async () => {
    for (const types of ['edd', 'plan', 'booked']) {
      const week = await calOk('drA', `view=week&date=2026-10-12&types=${types}&scope=all`);
      expect(eventsOf(week, P.p4), types).toEqual([]);
      expect(week.patients[P.p4]).toBeUndefined();
      const rmo = await calOk('rmo', `view=week&date=2026-10-12&types=${types}`);
      expect(eventsOf(rmo, P.p4).length, types).toBeGreaterThan(0);
    }
    const monthA = await calOk('drA', 'view=month&date=2026-10-01&types=edd,plan,booked&scope=all');
    const monthR = await calOk('rmo', 'view=month&date=2026-10-01&types=edd,plan,booked');
    // P4's EDD (14 Oct) and booking (15 Oct) are counted for the RMO only.
    expect(day(monthR, '2026-10-14').edd - day(monthA, '2026-10-14').edd).toBe(1);
    expect(day(monthR, '2026-10-15').booked - day(monthA, '2026-10-15').booked).toBe(1);
    const rmoWeek = await calOk('rmo', 'view=week&date=2026-10-12&types=plan');
    const p4Plans = eventsOf(rmoWeek, P.p4);
    for (const e of p4Plans) expect(day(monthR, e.date).plan + day(monthR, e.date).attended - day(monthA, e.date).plan - day(monthA, e.date).attended).toBeGreaterThanOrEqual(1);

    const lmpA = await calOk('drA', 'view=week&date=2026-01-05&types=lmp&scope=all');
    expect(ids(lmpA)).toEqual([`lmp:${P.p1}`]);
    const lmpR = await calOk('rmo', 'view=week&date=2026-01-05&types=lmp');
    expect(ids(lmpR)).toEqual([`lmp:${P.p1}`, `lmp:${P.p4}`].sort());

    // A doctor who is also a receptionist: P4 at reception level – the booked visit only.
    const dr = await calOk('doctorReception', 'view=week&date=2026-10-12&scope=all');
    expect(eventsOf(dr, P.p4)).toEqual([{ id: `booked:${P.p4}`, type: 'booked', date: '2026-10-15', patientId: P.p4, state: 'booked' }]);
    expect(dr.patients[P.p4]).toEqual({ id: P.p4, mrn: expect.any(String), fullName: 'Calendar Test Four', phone: expect.any(String), doctorName: 'Calendar drB', level: 'reception' });
    const drLmp = await calOk('doctorReception', 'view=week&date=2026-01-05&types=lmp&scope=all');
    expect(eventsOf(drLmp, P.p4)).toEqual([]);
  });

  it('4. "My patients" are the patients assigned to me', async () => {
    const mine = await calOk('drA', 'view=week&date=2026-10-12');
    const shown = new Set(mine.events.map((e) => e.patientId));
    for (const p of [P.p3, P.p4, P.p5]) expect(shown.has(p)).toBe(false);
    expect(shown.has(P.p1)).toBe(true);
    const b = await calOk('drB', 'view=week&date=2026-10-12');
    expect(eventsOf(b, P.p4).length).toBeGreaterThan(0);
    expect(b.patients[P.p4].level).toBe('clinical');
    expect(new Set(b.events.map((e) => e.patientId))).toEqual(new Set([P.p3, P.p4]));
  });

  it('9. the role gate', async () => {
    for (const who of ['nurse', 'lab', 'admin']) {
      const res = await cal(who, 'view=week');
      expect(res.status, who).toBe(403);
      expect(res.body.error.message).toBe(CALENDAR_MESSAGE);
    }
    expect((await request(app).get('/api/calendar')).status).toBe(401);
    // Another hospital's id in the header: refused (the existing tenant check answers 409 "hospital changed").
    const a = await as('drA');
    const foreign = await a.agent.get('/api/calendar').set('X-Tenant-Id', String(other._id));
    expect(foreign.status).toBe(409);
    expect(foreign.body.events).toBeUndefined();
    expect((await a.agent.get('/api/calendar')).status).toBe(409);
  });

  it('10. each hospital sees only its own patients', async () => {
    const z = await calOk('drZ', 'view=week&date=2026-10-12&types=edd');
    expect(ids(z)).toEqual([`edd:${P.p8}`]);
    const rmo = await calOk('rmo', 'view=week&date=2026-10-12&types=edd');
    expect(eventsOf(rmo, P.p8)).toEqual([]);
    expect(rmo.patients[P.p8]).toBeUndefined();
  });

  it('11. checks what is asked', async () => {
    for (const q of ['view=year', 'date=2026-13-01', 'types=lmp,lmp', 'types=', 'foo=1', 'types=lmp&types=edd', 'date=2040-01-01', 'scope=some']) {
      expect((await cal('drA', q)).status, q).toBe(400);
    }
    expect((await cal('drA', 'date=2036-10-01')).status).toBe(200);
    expect((await cal('rmo', 'scope=mine')).status).toBe(400);
  });

  it('12. clinical answers never carry staff ids, the sensitive mark, risk or plan basis', async () => {
    for (const view of ['day', 'week', 'month']) {
      const body = await calOk('rmo', `view=${view}&date=2026-10-12`);
      const keys = keysDeep(body);
      for (const k of ['basis', 'assignedDoctor', 'sensitive', 'risk']) expect(keys.has(k), `${view} ${k}`).toBe(false);
    }
  });

  it('13. nothing is written to the audit log', async () => {
    const who = ['drA', 'rmo', 'reception', 'doctorReception'];
    for (const w of who) await as(w); // logging in is audited; the calendar is not
    const before = await AuditLog.countDocuments();
    await Patient.updateOne({ _id: P.p2, tenantId: hospital._id }, { $inc: { __v: 1 } }); // one plan to re-sync
    for (const w of who) {
      for (const view of ['day', 'week', 'month']) await calOk(w, `view=${view}&date=2026-10-12${w === 'drA' || w === 'doctorReception' ? '&scope=all' : ''}`);
    }
    expect(await AuditLog.countDocuments()).toBe(before);
  });

  it('14. per-day limits and the row limit', async () => {
    const full = await calOk('rmo', 'view=week&date=2026-10-12');
    setCalendarLimitsForTests({ perDay: 1 });
    const cut = await calOk('rmo', 'view=week&date=2026-10-12');
    const total = (d) => ['booked', 'plan', 'attended', 'edd', 'lmp'].reduce((n, k) => n + (d[k] ?? 0), 0);
    let checked = 0;
    for (const d of cut.days) {
      const onDay = cut.events.filter((e) => e.date === d.date).length;
      const n = total(d);
      expect(onDay).toBe(Math.min(1, n));
      expect(d.more).toBe(n - onDay);
      const { more: _m1, ...a } = d;
      const { more: _m2, ...b } = day(full, d.date);
      expect(a).toEqual(b);
      if (n > 1) checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    expect(Object.keys(cut.patients).sort()).toEqual([...new Set(cut.events.map((e) => e.patientId))].sort());
    expect(full.countsIncomplete).toBe(false);

    setCalendarLimitsForTests({ rows: 2 });
    expect((await calOk('rmo', 'view=week&date=2026-10-12')).countsIncomplete).toBe(true);
    expect((await calOk('rmo', 'view=month&date=2026-10-12')).countsIncomplete).toBe(true);
  });

  it('17. the pregnancy filter agrees with the need-to-know rules', async () => {
    const me = people.drA._id;
    const patients = await Patient.find({ tenantId: hospital._id, _id: { $in: [P.p1, P.p5, P.p3, P.p4] } }).lean();
    expect(patients).toHaveLength(4);
    const roleSets = [['doctor'], ['rmo'], ['nurse'], ['receptionist'], ['lab'], ['doctor', 'receptionist'], ['nurse', 'receptionist']];
    for (const roles of roleSets) {
      const filter = pregnancyVisibleFilter(roles, me);
      const allowed = patients.filter((p) => patientAccess({ user: { _id: me }, membership: { roles } }, p).view.has('pregnancy')).map((p) => String(p._id)).sort();
      if (filter === null) {
        expect(allowed, roles.join('+')).toEqual([]);
        continue;
      }
      expect(allowed.length, roles.join('+')).toBeGreaterThan(0);
      const found = await Patient.find({ tenantId: hospital._id, $and: [{ _id: { $in: patients.map((p) => p._id) } }, filter] }, { _id: 1 }).lean();
      expect(found.map((p) => String(p._id)).sort(), roles.join('+')).toEqual(allowed);
    }
  });

  // ---------- Care-plan visits and booked visits ----------

  it('5. care-plan visits match the Care plan tab', async () => {
    const day12 = await calOk('drA', 'view=day&date=2026-10-12&types=plan&scope=all');
    const p6 = eventsOf(day12, P.p6);
    expect(p6).toHaveLength(1);
    expect(p6[0]).toMatchObject({ type: 'plan', date: '2026-10-12', status: 'due', due: { from: '2026-10-12', to: '2026-10-25' }, ga: { weeks: 27, days: 0 }, doneOn: null, doneElsewhere: false });
    expect(p6[0].name).toMatch(/^Booking visit/);
    expect(eventsOf(day12, P.p5)).toEqual([]);

    const week19 = await calOk('drA', 'view=week&date=2026-10-19&types=plan&scope=all');
    for (const pid of [P.p5, P.p6]) {
      const v28 = eventsOf(week19, pid).filter((e) => e.name === 'Antenatal visit (28–30 weeks)');
      expect(v28).toMatchObject([{ date: '2026-10-19', status: 'upcoming', due: { from: '2026-10-19', to: '2026-11-08' } }]);
    }
    expect(eventsOf(week19, P.p6).find((e) => e.date === '2026-10-20')).toBeUndefined();

    const week21 = await calOk('drA', 'view=week&date=2026-09-21&types=plan&scope=all');
    expect(eventsOf(week21, P.p5)).toMatchObject([{ date: '2026-09-21', status: 'overdue', name: 'Antenatal visit (24–26 weeks)' }]);

    // Every event equals the tab's item, and every tab visit placed in the range is an event.
    const SHOWN = ['due', 'upcoming', 'overdue', 'missed', 'done'];
    const weeks = ['2026-08-31', '2026-09-07', '2026-09-21', '2026-10-12', '2026-10-19', '2026-11-09'];
    for (const pid of [P.p5, P.p6]) {
      const plan = await tabPlan('drA', pid);
      for (const w of weeks) {
        const body = await calOk('drA', `view=week&date=${w}&types=plan&scope=all`);
        const events = eventsOf(body, pid);
        for (const e of events) {
          const it = plan.items.find((i) => i.id === e.itemId);
          expect(it, `${w} ${e.name}`).toBeDefined();
          expect({ name: e.name, status: e.status, due: e.due }).toEqual({ name: it.name, status: it.status, due: { from: iso(it.due.from), to: iso(it.due.to) } });
        }
        const expected = plan.items.filter((i) => {
          if (i.kind !== 'visit' || !SHOWN.includes(i.status)) return false;
          const placed = i.status === 'done' ? iso(i.done?.on) : iso(i.due?.from);
          return placed && placed >= body.from && placed <= body.to;
        });
        expect(events.map((e) => e.itemId).sort(), `${w}`).toEqual(expected.map((i) => i.id).sort());
      }
    }

    // A long window shows on its opening day only; its status there is the tab's, even months later.
    const week7 = await calOk('drA', 'view=week&date=2026-09-07&types=plan&scope=all');
    const extra = eventsOf(week7, P.p5).filter((e) => e.name === 'Extra review visit');
    const tab5 = await tabPlan('drA', P.p5);
    const extraTab = tab5.items.find((i) => i.name === 'Extra review visit');
    expect(extra).toMatchObject([{ date: iso(extraTab.due.from), due: { from: iso(extraTab.due.from), to: iso(extraTab.due.to) } }]);
    for (const w of ['2026-10-12', '2026-10-19']) {
      expect(eventsOf(await calOk('drA', `view=week&date=${w}&types=plan&scope=all`), P.p5).some((e) => e.name === 'Extra review visit')).toBe(false);
    }

    // Moving P6's 28-week visit to 2–8 Nov moves the entry.
    const tab6 = await tabPlan('drA', P.p6);
    const v28 = tab6.items.find((i) => i.key === 'visit_28');
    const moved = await (await as('drA'))
      .patch(`/api/patients/${P.p6}/care-plan/items/${v28.id}`)
      .send({ action: 'move', rev: v28.rev, dueFrom: '2026-11-02', dueBy: '2026-11-08', reason: 'Calendar test move' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const nov = await calOk('drA', 'view=week&date=2026-11-02&types=plan&scope=all');
    expect(eventsOf(nov, P.p6).filter((e) => e.itemId === v28.id)).toMatchObject([{ date: '2026-11-02', due: { from: '2026-11-02', to: '2026-11-08' } }]);
    expect(eventsOf(await calOk('drA', 'view=week&date=2026-10-19&types=plan&scope=all'), P.p6).some((e) => e.itemId === v28.id)).toBe(false);

    // Attended at a visit on 12 Oct: listed once, as done that day.
    const booking = tab6.items.find((i) => i.key === 'visit_booking');
    const created = await (await as('drA')).post(`/api/patients/${P.p6}/visits`).send({ clientRequestId: randomUUID() });
    expect(created.status).toBe(201);
    V.p6 = created.body.visit.id;
    const saved = await (await as('drA')).patch(`/api/patients/${P.p6}/visits/${V.p6}`).send({ doneItems: [{ id: booking.id, rev: booking.rev }] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const after = await calOk('drA', 'view=day&date=2026-10-12&types=plan&scope=all');
    expect(eventsOf(after, P.p6)).toMatchObject([{ itemId: booking.id, status: 'done', doneOn: '2026-10-12', doneElsewhere: false, date: '2026-10-12' }]);
    expect(day(after, '2026-10-12').attended).toBe(1);

    // The real aggregate fed to the builder: items not done have no done date and are never treated as done.
    const range = [D('2026-08-31'), D('2026-10-11')];
    const plans = await CarePlan.aggregate(planVisitsPipeline({ tenantId: hospital._id, range: [D('2026-08-31'), D('2026-10-12')], patientIds: [P.p5, P.p6].map((id) => new mongoose.Types.ObjectId(id)) }));
    expect(plans.map((p) => String(p.patientId)).sort()).toEqual([P.p5, P.p6].sort());
    for (const plan of plans) {
      expect(plan.basis).toEqual({ edd: expect.any(Date) });
      for (const it of plan.items) {
        expect(it.kind).toBe('visit');
        if (it.state !== 'done') expect(it.done?.on ?? null).toBeNull();
      }
      const events = planEvents(plan, D('2026-10-12'), range, 'clinical');
      for (const e of events) {
        const it = plan.items.find((i) => String(i._id) === e.itemId);
        expect(e.status === 'done').toBe(it.state === 'done');
      }
    }
    const p6Plan = plans.find((p) => String(p.patientId) === P.p6);
    expect(planEvents(p6Plan, D('2026-10-12'), [D('2026-10-12'), D('2026-10-12')], 'clinical')).toMatchObject([{ status: 'done', doneOn: '2026-10-12' }]);

    // Later: 19 Oct (the 24-week visit is missed) and 15 Dec (the long window is still due, as on the tab).
    await setTime('2026-10-19T06:00:00Z');
    const missed = await calOk('drA', 'view=week&date=2026-09-21&types=plan&scope=all');
    expect(eventsOf(missed, P.p5)).toMatchObject([{ date: '2026-09-21', status: 'missed' }]);
    await setTime('2026-12-15T06:00:00Z');
    const late = await calOk('drA', 'view=week&date=2026-09-07&types=plan&scope=all');
    const lateTab = (await tabPlan('drA', P.p5)).items.find((i) => i.name === 'Extra review visit');
    expect(lateTab.status).toBe('due');
    expect(eventsOf(late, P.p5).filter((e) => e.name === 'Extra review visit')).toMatchObject([{ status: lateTab.status }]);
  });

  it('6. booked visits: the booking of the latest visit that was not cancelled', async () => {
    const week = (d) => calOk('drA', `view=week&date=${d}&types=booked&scope=all`);
    const oct12 = await week('2026-10-12');
    const oct19 = await week('2026-10-19');
    expect(eventsOf(oct12, P.p7)).toEqual([]);
    expect(eventsOf(oct19, P.p7)).toEqual([
      { id: `booked:${P.p7}:${V.v2}`, type: 'booked', date: '2026-10-20', patientId: P.p7, visitId: V.v2, visitOn: '2026-09-20', state: 'booked', note: 'fasting sample', ga: null },
    ]);
    expect(eventsOf(oct12, P.p2)).toMatchObject([{ id: `booked:${P.p2}:${V.v5}`, date: '2026-10-17', note: 'with reports', ga: { weeks: 1, days: 5 } }]);
    expect(eventsOf(oct12, P.p5)).toMatchObject([{ date: '2026-10-12', state: 'today', visitId: V.v6 }]);
    expect(eventsOf(oct12, P.p4)).toEqual([]); // B's sensitive record, for Dr A

    await setTime('2026-10-21T06:00:00Z');
    expect(eventsOf(await week('2026-10-19'), P.p7)).toMatchObject([{ date: '2026-10-20', state: 'no_visit' }]);

    await setTime(NOW);
    await Visit.updateOne({ _id: V.v2, tenantId: hospital._id }, { $set: { status: 'cancelled', cancelled: { reason: 'Entered in error', byName: 'Dr A', at: new Date() } } });
    const again = await week('2026-10-12');
    expect(eventsOf(again, P.p7)).toMatchObject([{ id: `booked:${P.p7}:${V.v1}`, date: '2026-10-14' }]);
    expect(again.events.some((e) => e.date === '2026-10-15' && e.patientId === P.p7)).toBe(false);
    expect(eventsOf(await week('2026-10-19'), P.p7)).toEqual([]);

    // She came on the booked day (a later visit with no next date): the booking stays, marked arrived.
    V.p2late = await insertVisitLater(P.p2, { visitOn: '2026-10-17' });
    const arrived = eventsOf(await week('2026-10-12'), P.p2);
    expect(arrived).toMatchObject([{ id: `booked:${P.p2}:${V.v5}`, date: '2026-10-17', state: 'arrived', arrivedAt: expect.any(String) }]);
    expect((await calOk('reception', 'view=week&date=2026-10-12')).events.filter((e) => e.patientId === P.p2 && e.type === 'booked')).toMatchObject([{ state: 'arrived' }]);
  });

  it('6b. the latest-visit check takes its order from the visit index, not from sorting in memory', async () => {
    const pids = [P.p2, P.p7].map((id) => new mongoose.Types.ObjectId(id));
    const pipeline = latestVisitsPipeline({ tenantId: hospital._id, patientIds: pids });
    // Same visit on the same day: the one entered later wins (V4/V5), and cancelled visits never count.
    const latest = await Visit.aggregate(pipeline);
    expect(Object.fromEntries(latest.map((l) => [String(l._id), String(l.visitId)]))).toEqual({ [P.p2]: V.p2late, [P.p7]: V.v1 });

    const explain = await Visit.aggregate(pipeline).explain('queryPlanner');
    // Only the chosen plans (winningPlan), wherever the server version puts them; rejected plans may sort.
    const winning = [];
    (function find(node) {
      if (Array.isArray(node)) node.forEach(find);
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) (k === 'winningPlan' ? winning.push(v) : find(v));
      }
    })(explain);
    const stages = [];
    const keyPatterns = [];
    (function walk(node) {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        if (typeof node.stage === 'string') stages.push(node.stage);
        if (node.keyPattern) keyPatterns.push(Object.keys(node.keyPattern).join(','));
        Object.values(node).forEach(walk);
      }
    })(winning);
    const shown = JSON.stringify(winning);
    expect(winning.length, shown).toBeGreaterThan(0);
    expect(stages.filter((st) => /SORT/i.test(st) && !/SORT_KEY_GENERATOR/i.test(st)), shown).toEqual([]);
    expect(keyPatterns, shown).toContain('tenantId,patientId,visitOn,createdAt');
  });

  it('7. "today" is the hospital\'s date', async () => {
    await setTime('2026-10-11T18:29:00Z'); // 23:59 on 11 Oct in India
    const before = await calOk('rmo');
    expect(before).toMatchObject({ today: '2026-10-11', from: '2026-10-05', to: '2026-10-11' });
    expect(eventsOf(await calOk('rmo', 'view=week&date=2026-09-21&types=plan'), P.p5)).toMatchObject([{ date: '2026-09-21', status: 'due' }]);
    expect(eventsOf(await calOk('rmo', 'view=week&date=2026-10-12&types=booked'), P.p5)).toMatchObject([{ visitId: V.v6, state: 'booked' }]);

    await setTime('2026-10-11T18:31:00Z'); // 00:01 on 12 Oct in India
    const after = await calOk('rmo');
    expect(after).toMatchObject({ today: '2026-10-12', from: '2026-10-12', to: '2026-10-18' });
    expect(eventsOf(await calOk('rmo', 'view=week&date=2026-09-21&types=plan'), P.p5)).toMatchObject([{ date: '2026-09-21', status: 'overdue' }]);
    expect(eventsOf(await calOk('rmo', 'view=week&date=2026-10-12&types=booked'), P.p5)).toMatchObject([{ visitId: V.v6, state: 'today' }]);
  });

  it('8. reception sees names, numbers, phones and visit dates only', async () => {
    expect((await cal('reception', 'types=edd')).status).toBe(403);
    expect((await cal('reception', 'types=lmp')).body.error.message).toBe("Your role doesn't include pregnancy dates.");
    expect((await cal('reception', 'scope=mine')).status).toBe(400);

    const FORBIDDEN_KEYS = ['lmp', 'edd', 'eddSource', 'ga', 'gaToday', 'careType', 'name', 'itemId', 'status', 'doneOn', 'doneElsewhere', 'visitId', 'visitOn', 'note', 'risk', 'sensitive', 'assignedDoctor', 'basis', 'attended'];
    const FORBIDDEN_TEXT = ['Booking visit', 'Antenatal visit', 'Extra review visit', 'weeks', 'Post-dates', 'with reports', 'bring scan report', 'fasting sample'];
    const PREGNANCY_DATES = ['2026-01-05', '2026-10-05', '2027-07-12', '2026-12-10', '2027-01-11'];
    const plans = await CarePlan.find({ tenantId: hospital._id }).lean();
    const sourceIds = [...plans.flatMap((p) => p.items.map((i) => String(i._id))), ...(await Visit.find({ tenantId: hospital._id }).lean()).map((v) => String(v._id))];
    expect(sourceIds.length).toBeGreaterThan(20);

    const queries = ['view=week&date=2026-10-12', 'view=week&date=2026-10-19', 'view=week&date=2026-09-07', 'view=month&date=2026-10-01', 'view=day&date=2026-10-12'];
    for (const q of queries) {
      const body = await calOk('reception', q);
      expect(body.types).toEqual(['booked', 'plan']);
      expect(body.canChooseScope).toBe(false);
      expect(body.scope).toBe('all');
      const keys = keysDeep(body);
      for (const k of FORBIDDEN_KEYS) expect(keys.has(k), `${q}: ${k}`).toBe(false);
      const text = JSON.stringify(body);
      for (const t of FORBIDDEN_TEXT) expect(text.includes(t), `${q}: ${t}`).toBe(false);
      // The month's day list itself holds every date of the month, so dates are checked on events and patients.
      const shown = JSON.stringify({ events: body.events, patients: body.patients });
      for (const t of PREGNANCY_DATES) expect(shown.includes(t), `${q}: ${t}`).toBe(false);
      for (const e of body.events) {
        expect(['booked', 'plan']).toContain(e.type);
        for (const id of sourceIds) expect(e.id.includes(id)).toBe(false);
        const bookedKeys = e.state === 'arrived' ? ['arrivedAt', 'date', 'id', 'patientId', 'state', 'type'] : ['date', 'id', 'patientId', 'state', 'type'];
        expect(Object.keys(e).sort()).toEqual(e.type === 'plan' ? ['date', 'due', 'id', 'patientId', 'type'] : bookedKeys);
        if (e.type === 'plan') expect(Object.keys(e.due)).toEqual(['from']);
      }
      for (const p of Object.values(body.patients)) expect(Object.keys(p).sort()).toEqual(['doctorName', 'fullName', 'id', 'level', 'mrn', 'phone']);
      for (const d of body.days) expect(Object.keys(d).every((k) => ['date', 'booked', 'plan', 'more'].includes(k))).toBe(true);
      expect(eventsOf(body, P.p4).every((e) => e.type === 'booked')).toBe(true);

      const nr = await calOk('nurseReception', q);
      expect(nr).toEqual(body);
    }

    const w12 = await calOk('reception', 'view=week&date=2026-10-12');
    expect(eventsOf(w12, P.p4)).toEqual([{ id: `booked:${P.p4}`, type: 'booked', date: '2026-10-15', patientId: P.p4, state: 'booked' }]);
    const w19 = await calOk('reception', 'view=week&date=2026-10-19');
    expect(eventsOf(w19, P.p5)).toEqual([{ id: `plan:${P.p5}:2026-10-19`, type: 'plan', date: '2026-10-19', patientId: P.p5, due: { from: '2026-10-19' } }]);

    // Month counts: the reception rules applied to what the RMO sees, plus a few worked out by hand.
    const month = await calOk('reception', 'view=month&date=2026-10-01');
    expect(month.days).toHaveLength(35);
    const expected = new Map(month.days.map((d) => [d.date, { date: d.date, booked: 0, plan: 0 }]));
    for (const w of ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']) {
      const body = await calOk('rmo', `view=week&date=${w}&types=booked,plan`);
      for (const e of body.events) {
        const row = expected.get(e.date);
        if (e.type === 'booked') row.booked += 1;
        else if (['due', 'upcoming', 'overdue'].includes(e.status) && e.patientId !== P.p4) row.plan += 1;
      }
    }
    expect(month.days).toEqual([...expected.values()]);
    expect(day(month, '2026-10-12')).toEqual({ date: '2026-10-12', booked: 1, plan: 3 }); // P5's booking; booking visits of P1, P2, P3
    expect(day(month, '2026-10-14').booked).toBe(1); // P7 (her 20 Oct visit was cancelled)
    expect(day(month, '2026-10-15').booked).toBe(1); // P4 (booked visits of sensitive records do show)
    expect(day(month, '2026-10-17').booked).toBe(1); // P2 came on her booked day: the booking stays, marked arrived
    const sep = await calOk('reception', 'view=week&date=2026-09-21');
    expect(day(sep, '2026-09-21')).toEqual({ date: '2026-09-21', booked: 0, plan: 1, more: 0 }); // P5's 24-week visit, overdue
  });

  it('15. month counts for my patients', async () => {
    const month = await calOk('drA', 'view=month&date=2026-10-01&types=edd,lmp,booked');
    expect(month.days).toHaveLength(35);
    expect(month.events).toEqual([]);
    const nonZero = month.days.flatMap((d) => ['booked', 'edd', 'lmp'].filter((k) => d[k] > 0).map((k) => `${d.date} ${k} ${d[k]}`));
    // 17 Oct: P2's booking, kept as "arrived" after her visit that day (test 6)
    expect(nonZero.sort()).toEqual(['2026-10-05 lmp 1', '2026-10-12 edd 1', '2026-10-14 booked 1', '2026-10-17 booked 1']);
    expect(Object.keys(month.days[0])).toEqual(['date', 'booked', 'edd', 'lmp']);
  });

  // ---------- Cases that change data ----------

  it('16. plans behind their patient are brought up to date; missing plans are not built', async () => {
    // (a) An EDD change saved without the automatic sync.
    await Patient.updateOne({ _id: P.p6, tenantId: hospital._id }, { $set: { 'pregnancy.scanEdd': D('2027-01-18'), 'pregnancy.effectiveEdd': D('2027-01-18') }, $inc: { __v: 1 } });
    const body = await calOk('drA', 'view=week&date=2026-11-16&types=plan&scope=all');
    const tab = await tabPlan('drA', P.p6);
    const v32 = tab.items.find((i) => i.key === 'visit_32');
    expect(iso(v32.due.from)).toBe('2026-11-16');
    expect(eventsOf(body, P.p6).filter((e) => e.itemId === v32.id)).toMatchObject([{ date: '2026-11-16', due: { from: '2026-11-16', to: iso(v32.due.to) }, status: v32.status }]);

    // (b) A patient saved without a plan: no plan is built by the calendar.
    const auditBefore = await AuditLog.countDocuments({ action: 'CARE_PLAN_CREATED' });
    const p9 = await Patient.create({
      tenantId: hospital._id,
      mrn: 'P-CAL009',
      careType: 'antenatal',
      fullName: 'Calendar Test Nine',
      ageYears: 29,
      ageRecordedOn: new Date(),
      phone: '+91 00000 00009',
      pregnancy: { lmp: D('2026-01-05') },
      createdBy: people.rmo._id,
    });
    P.p9 = String(p9._id);
    const week = await calOk('rmo', 'view=week&date=2026-10-12');
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p9._id })).toBe(0);
    expect(eventsOf(week, P.p9).map((e) => e.type)).toEqual(['edd']);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CREATED' })).toBe(auditBefore);
    await tabPlan('rmo', P.p9); // opening the record builds it, as before
    resetStalePlansTimer();
    const withPlan = await calOk('rmo', 'view=week&date=2026-10-12&types=plan');
    expect(eventsOf(withPlan, P.p9).length).toBeGreaterThan(0);

    // (c) The time budget: one plan per run at least, the rest on the next requests.
    await refreshStalePlans(hospital._id, new Date(), {});
    resetStalePlansTimer();
    for (const pid of [P.p2, P.p5, P.p6]) await Patient.updateOne({ _id: pid, tenantId: hospital._id }, { $inc: { __v: 1 } });
    const now = new Date();
    expect(await refreshStalePlans(hospital._id, now, { budgetMs: 0 })).toEqual({ synced: 1, pending: 2 });
    expect(await refreshStalePlans(hospital._id, now, { budgetMs: 0 })).toEqual({ synced: 1, pending: 1 });
    expect(await refreshStalePlans(hospital._id, now, { budgetMs: 0 })).toEqual({ synced: 1, pending: 0 });
    expect(await refreshStalePlans(hospital._id, now, { budgetMs: 0 })).toEqual({ synced: 0, pending: 0 });

    resetStalePlansTimer();
    await refreshDueRisks(hospital._id, new Date()); // done now, so the calendar's own call is skipped
    for (const pid of [P.p2, P.p5]) await Patient.updateOne({ _id: pid, tenantId: hospital._id }, { $inc: { __v: 1 } });
    setStalePlanOptionsForTests({ budgetMs: 0 });
    expect((await calOk('rmo', 'view=day&types=plan')).plansPending).toBe(1);
    expect((await calOk('rmo', 'view=day&types=booked')).plansPending).toBe(0);
  });

  it('18. a care type other than antenatal: no LMP and no plan visits; booked visits stay', async () => {
    await insertVisitLater(P.p2, { visitOn: '2026-10-18', next: '2026-10-25' });
    const res = await (await as('drA')).patch(`/api/patients/${P.p2}`).send({ careType: 'postnatal' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(eventsOf(await calOk('drA', 'view=week&date=2026-10-05&types=lmp'), P.p2)).toEqual([]);
    expect(eventsOf(await calOk('drA', 'view=week&date=2026-10-12&types=plan'), P.p2)).toEqual([]);
    const booked = await calOk('drA', 'view=week&date=2026-10-19&types=booked');
    expect(eventsOf(booked, P.p2)).toMatchObject([{ type: 'booked', date: '2026-10-25', ga: null }]);
    expect(booked.patients[P.p2].careType).toBe('postnatal');
    expect(booked.patients[P.p2].gaToday).toBeNull();
  });

  it('19. a plan closed for this pregnancy: no LMP or EDD, no plan visits, and no new plan', async () => {
    const before = await calOk('drA', 'view=month&date=2026-10-01&types=edd');
    expect(day(before, '2026-10-12').edd).toBe(1);
    const res = await (await as('drA')).post(`/api/patients/${P.p1}/care-plan/close`).send({ reason: 'pregnancy_ended' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(eventsOf(await calOk('drA', 'view=week&date=2026-10-12&types=edd'), P.p1)).toEqual([]);
    expect(day(await calOk('drA', 'view=month&date=2026-10-01&types=edd'), '2026-10-12').edd).toBe(0);
    expect(eventsOf(await calOk('drA', 'view=week&date=2026-10-12&types=plan'), P.p1)).toEqual([]);
    expect(eventsOf(await calOk('rmo', 'view=week&date=2026-01-05&types=lmp'), P.p1)).toEqual([]);
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: P.p1, current: true })).toBe(0);
  });

  it('20. a plan on hold (EDD moved by more than 8 weeks): no open plan visits at any level', async () => {
    const res = await (await as('drA')).patch(`/api/patients/${P.p6}`).send({ pregnancy: { lmp: '2026-04-06', scanEdd: '2027-04-01' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const plan = await CarePlan.findOne({ tenantId: hospital._id, patientId: P.p6, current: true }).lean();
    expect(plan.eddReview).not.toBeNull();
    for (const w of ['2026-10-12', '2026-10-19', '2026-11-02', '2026-11-16', '2026-12-28', '2027-03-01']) {
      const rmo = await calOk('rmo', `view=week&date=${w}&types=plan`);
      // Only the visit she already attended (12 Oct) stays, as attended.
      expect(eventsOf(rmo, P.p6).every((e) => e.status === 'done' && e.date === '2026-10-12'), w).toBe(true);
      expect(eventsOf(await calOk('reception', `view=week&date=${w}`), P.p6).filter((e) => e.type === 'plan'), w).toEqual([]);
    }
  });
});
