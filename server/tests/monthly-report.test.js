// The monthly report (HMIS order) and the 12-month trend: Analytics → Monthly report, doctors only. Moved here
// from Registers on 2 Oct 2026, without the MTP and Form F rows; pregnancy scans come from the care plan. All fake
// sample data.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { NO_ACCESS_MESSAGE } from '../src/analytics/roles.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', admin: 'admin', reception: 'receptionist', drAdmin: ['doctor', 'admin'] };
const FOR_DOCTORS = 'The monthly report is for doctors.';
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
  hospital = await createTenant('Report Hospital');
  other = await createTenant('Other Report Hospital');
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
async function register(who = 'drA', overrides = {}) {
  const res = await (await as(who)).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: 'Report Mother', ageYears: 26, pregnancy: { scanEdd: '2027-03-01' }, medical: { allergies: 'None known' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const report = async (who, month = '2026-10') => (await as(who)).get(`/api/analytics/report/monthly?month=${month}`);
const rows = (body) => body.sections.flatMap((s) => s.rows);
const valueOf = (body, key) => rows(body).find((r) => r.key === key)?.value;

describe('who may open the monthly report', () => {
  it('doctors only: hospital admins get "for doctors"; RMOs, nurses and reception get the Analytics refusal; not logged in 401', async () => {
    for (const who of ['drA', 'drAdmin']) expect((await report(who)).status, who).toBe(200);
    const admin = await report('admin');
    expect(admin.status).toBe(403);
    expect(admin.body.error.message).toBe(FOR_DOCTORS);
    for (const who of ['rmo', 'nurse', 'reception']) {
      const res = await report(who);
      expect(res.status, who).toBe(403);
      expect(res.body.error.message, who).toBe(NO_ACCESS_MESSAGE);
    }
    expect((await request(app).get('/api/analytics/report/monthly?month=2026-10')).status).toBe(401);
    expect((await request(app).get('/api/analytics/report/trend?month=2026-10')).status).toBe(401);

    expect((await (await as('drB')).get('/api/analytics/report/trend?month=2026-10')).status).toBe(200);
    const trend = await (await as('admin')).get('/api/analytics/report/trend?month=2026-10');
    expect(trend.status).toBe(403);
    expect(trend.body.error.message).toBe(FOR_DOCTORS);
    expect((await (await as('nurse')).get('/api/analytics/report/trend?month=2026-10')).status).toBe(403);
  });

  it('a month that does not exist is refused; no month means this month', async () => {
    for (const m of ['2026-13', '2026-00', '2026-1', 'October']) expect((await report('drA', m)).status, m).toBe(400);
    const res = await (await as('drA')).get('/api/analytics/report/monthly');
    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2026-10');
  });

  it('the old Registers address is gone', async () => {
    expect((await (await as('drA')).get('/api/registers/reports/monthly?month=2026-10')).status).toBe(404);
  });
});

describe('the monthly report', () => {
  it('counts the month: registrations, visits with Hb and BP, lab results, deliveries and births, admissions – no names, no MTP or Form F', async () => {
    const p = await register('drA', { fullName: 'Report Mother', pregnancy: { scanEdd: '2027-04-20' } }); // 11 weeks: first trimester
    // A visit with Hb 9.5 and BP 150/96
    const v = (await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() })).body.visit;
    const vit = await (await as('drA')).patch(`/api/patients/${p.id}/visits/${v.id}`).send({ vitals: { rev: 0, hb: 9.5, bpSystolic: 150, bpDiastolic: 96 } });
    expect(vit.status, JSON.stringify(vit.body)).toBe(200);
    // HIV reactive, reported
    let o = (await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'hiv' }] })).body.order;
    o = (await (await as('drA')).put(`/api/lab/orders/${o.id}/results`).send({ rev: o.rev, tests: [{ key: 'hiv', values: [{ key: 'hiv', value: 'Reactive' }] }], report: true })).body.order;
    expect(o.status).toBe('reported');
    // A caesarean delivery: a live baby of 2300 g
    const m = await register('drA', { fullName: 'Delivered Mother', pregnancy: { scanEdd: '2026-10-05' } });
    const a = (await (await as('drA')).post(`/api/patients/${m.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-09-30T20:00:00.000Z', reason: 'In labour' })).body.admission;
    const d = (await (await as('drA')).post(`/api/patients/${m.id}/admissions/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
    const saved = (
      await (await as('drA'))
        .put(`/api/patients/${m.id}/admissions/${a.id}/documents/${d.id}`)
        .send({ rev: 0, content: { deliveredAt: '2026-10-01T02:00:00.000Z', mode: 'lscs', indication: 'Fetal distress', gestationWeeks: 36, babies: [{ outcome: 'live', sex: 'female', weightGrams: 2300 }] } })
    ).body.document;
    expect((await (await as('drA')).post(`/api/patients/${m.id}/admissions/${a.id}/documents/${d.id}/sign`).send({ rev: saved.rev })).status).toBe(200);
    // Another hospital's patient is never counted
    const otherSession = await loginAs(people.otherDr, { app });
    expect((await otherSession.post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Other Mother', pregnancy: { scanEdd: '2027-03-01' } }))).status).toBe(201);

    const res = await report('drB');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const value = (key) => valueOf(res.body, key);
    expect([value('registered'), value('registered_antenatal'), value('anc_registered'), value('anc_first_trimester')]).toEqual([2, 2, 2, 1]);
    expect([value('visits'), value('visits_new'), value('anc_visits')]).toEqual([1, 1, 1]);
    expect([value('hb_tested'), value('hb_below11'), value('hb_below7'), value('high_bp')]).toEqual([1, 1, 0, 1]);
    expect([value('hiv_tested'), value('hiv_positive')]).toEqual([1, 1]);
    expect([value('deliveries'), value('del_caesarean'), value('del_preterm'), value('live_births'), value('live_female'), value('lbw'), value('still_births')]).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect([value('admissions'), value('lab_tests'), value('lab_abnormal')]).toEqual([1, 1, 1]);
    expect(JSON.stringify(res.body)).not.toMatch(/Report Mother|Delivered Mother|Other Mother/);
    // No MTP section, no MTP or Form F row, nothing that says so
    expect(res.body.sections.map((s) => s.key)).not.toContain('mtp');
    expect(rows(res.body).filter((r) => /^mtp|^form_f/.test(r.key))).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/MTP|Form F|terminat/i);
    expect(res.body.sections.find((s) => s.key === 'diagnostics').title).toBe('Scans and lab');
    expect(res.body.notes).toEqual([
      'Pregnancy scans count only scans ticked as done here in the care plan.',
      'Pregnancy loss is counted by the date seen.',
      'Stillbirths come from confirmed delivery notes; deaths from the deaths a doctor recorded on the records, by the day of death.',
      'The definitions of a newborn and a maternal death are a DRAFT for a doctor to check. Source: WHO definitions (ICD-11): newborn death in the first 28 days of life; maternal death during pregnancy or within 42 days of its end, not from an accident or an incidental cause.',
    ]);
    expect(valueOf((await report('drB', '2026-09')).body, 'registered')).toBe(0);

    const trend = (await (await as('drA')).get('/api/analytics/report/trend?month=2026-10')).body;
    expect(trend.months).toHaveLength(12);
    expect(trend.months.at(-1)).toBe('2026-10');
    expect(trend.series.find((x) => x.key === 'deliveries').values.at(-1)).toBe(1);
    expect(trend.series.find((x) => x.key === 'registered').values.at(-1)).toBe(2);
  });

  it('pregnancy scans: scan items of antenatal care plans ticked as done here in the month (not elsewhere, not last month, not another hospital)', async () => {
    const item = (kind, on, elsewhere = false, state = 'done') => ({ _id: new mongoose.Types.ObjectId(), key: `k_${randomUUID().slice(0, 8)}`, kind, state, done: on ? { on: new Date(on), elsewhere } : null });
    const plan = (tenantId, careType, items) => ({ _id: new mongoose.Types.ObjectId(), tenantId, careType, items });
    await CarePlan.collection.insertMany([
      plan(hospital._id, 'antenatal', [
        item('scan', '2026-10-01'), // counts
        item('scan', '2026-10-01', true), // done elsewhere
        item('scan', '2026-09-30'), // last month
        item('investigation', '2026-10-01'), // not a scan
        item('scan', null, false, 'open'),
      ]),
      plan(hospital._id, 'antenatal', [item('scan', '2026-10-15')]), // counts
      plan(hospital._id, 'gynaecology', [item('scan', '2026-10-01')]), // not a pregnancy plan
      plan(other._id, 'antenatal', [item('scan', '2026-10-01')]), // another hospital
    ]);
    const res = await report('drA');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const scans = rows(res.body).find((r) => r.key === 'scans_done');
    expect(scans).toMatchObject({ label: 'Pregnancy scans done here (marked done in the care plan)', value: 2 });
    expect(valueOf((await report('drA', '2026-09')).body, 'scans_done')).toBe(1);
  });

  it('pregnancy loss (Abortion type of care): by the date seen, each type in its row; never a row for induced termination', async () => {
    const at = (iso) => new Date(`${iso}T00:00:00Z`);
    let n = 0;
    const loss = (abortion, extra = {}) => {
      n += 1;
      return {
        _id: new mongoose.Types.ObjectId(),
        tenantId: hospital._id,
        mrn: `P-L${n}`,
        careType: 'abortion',
        fullName: `Loss Sample ${n}`,
        createdBy: people.drA._id,
        createdAt: at('2026-10-02'),
        abortion,
        ...extra,
      };
    };
    const seen = (lossType, presentedOn = '2026-10-03', management = null) => ({ lossType, presentedOn: at(presentedOn), management: management ?? { method: null, on: null, outcome: null } });
    await Patient.collection.insertMany([
      loss(seen('missed')),
      loss(seen('incomplete', '2026-10-20', { method: 'surgical_evacuation', on: at('2026-10-21'), outcome: 'complete' })),
      loss(seen('septic')),
      loss(seen('ectopic', '2026-10-05', { method: 'laparoscopy', on: at('2026-10-05'), outcome: 'complete' })),
      loss(seen('molar')),
      loss(seen('threatened')), // saved before 3 Oct 2026: now recorded under Antenatal – counted only as to tidy
      loss(seen('recurrent')),
      // Registered last month, seen for the loss this month: counted this month
      loss(seen('complete', '2026-10-01'), { createdAt: at('2026-09-10') }),
      // Seen last month, operated on this month: only the operation counts this month
      loss(seen('missed', '2026-09-28', { method: 'surgical_evacuation', on: at('2026-10-02'), outcome: 'complete' })),
      loss(null), // no details yet
      loss({ lossType: null, presentedOn: at('2026-08-01') }), // no type of loss yet (an older month)
      loss(seen('missed'), { tenantId: other._id }), // another hospital
      loss(seen('missed'), { careType: 'antenatal' }), // changed back to antenatal: not counted
    ]);
    const res = await report('drA');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const keys = res.body.sections.map((s) => s.key);
    expect(keys.indexOf('loss')).toBe(keys.indexOf('deliveries') + 1);
    expect(res.body.sections.find((s) => s.key === 'loss').title).toBe('Pregnancy loss (Abortion type of care)');
    const v = (k) => valueOf(res.body, k);
    expect([v('loss_total'), v('loss_miscarriage'), v('loss_ectopic'), v('loss_molar')]).toEqual([6, 4, 1, 1]);
    expect(v('loss_recurrent')).toBe(1);
    expect(res.body.sections.find((s) => s.key === 'loss').rows.map((r) => r.key)).not.toContain('loss_threatened');
    expect(v('loss_surgical')).toBe(3);
    expect(v('loss_to_tidy')).toBe(3); // two with no type of loss, one old threatened miscarriage
    expect(v('registered_abortion')).toBe(10); // records made this month (this hospital, Abortion now)
    expect(JSON.stringify(res.body)).not.toMatch(/MTP|terminat|induced/i);
    const sept = (await report('drA', '2026-09')).body;
    expect([valueOf(sept, 'loss_total'), valueOf(sept, 'loss_surgical'), valueOf(sept, 'loss_to_tidy')]).toEqual([1, 0, 3]);
  });

  it('a registered abortion patient counts under registrations', async () => {
    await register('drA', { careType: 'abortion', fullName: 'Loss Registered', pregnancy: undefined });
    expect(valueOf((await report('drA')).body, 'registered_abortion')).toBe(1);
  });

  it('opening the report records the month only – no patient ids; the trend is not recorded', async () => {
    await register();
    expect((await report('drA')).status).toBe(200);
    expect((await (await as('drA')).get('/api/analytics/report/trend?month=2026-10')).status).toBe(200);
    const entries = await AuditLog.find({ action: 'REPORT_VIEWED' }).lean();
    expect(entries).toHaveLength(1);
    expect(String(entries[0].tenantId)).toBe(String(hospital._id));
    expect(entries[0].details).toEqual({ report: 'monthly', month: '2026-10' });
    expect(entries[0].target).toBeNull();
    // A refused request records nothing
    await report('admin');
    expect(await AuditLog.countDocuments({ action: 'REPORT_VIEWED' })).toBe(1);
  });
});
