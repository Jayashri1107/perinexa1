// Build 13 – the NICU admission (NEO-F-03), the unit set-up (NEO-A-01), the register (NEO-L-05) and the NEO-A-05
// dashboard rows, as docs/field_schemas/build13_nicu_admission.json describes them. The seven acceptance tests of the
// schema are named "AT1" … "AT7" (AT7, the printout, is also checked on the website: newbornCare.test.jsx).
// Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { FORM_SCREENS } from '../src/clinical/formRegister.js';
import { maturityClass, ropEligible, ropFirstExamDue, sizeClass, cranialUsgDue, NICU_FORM_FOOTER } from '../src/clinical/nicuAdmission.js';
import { EXAM_SYSTEMS } from '../src/clinical/nicuAdmission.js';
import { BIRTH_CHECKS } from '../src/clinical/newbornCare.js';
import { runNicuAutomations } from '../src/clinical/nicuData.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bed } from '../src/models/Bed.js';
import { NicuAdmission } from '../src/models/NewbornCare.js';
import { Notification } from '../src/models/Notification.js';
import { Patient } from '../src/models/Patient.js';
import { PASSWORD, addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-20T06:00:00Z');
const MIN = 60 * 1000;
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', admin: 'admin', drAdmin: ['doctor', 'admin'], reception: 'receptionist' };
let app;
let hospital;
let people;
let sessions;
let beds;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Nicu Sample Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
  // The manual's three units, typed by the hospital admin (names are settings, never code)
  beds = {};
  const made = [];
  for (const [unit, n] of [['garkheda', 6], ['waluj', 2], ['adalat_road', 2]]) {
    beds[unit] = [];
    for (let i = 1; i <= n; i += 1) {
      const b = await Bed.create({ tenantId: hospital._id, ward: `NICU ${unit}`, name: `B${i}` });
      beds[unit].push(String(b._id));
      made.push({ bedId: String(b._id), nicu: { unit, level: unit === 'garkheda' && i <= 4 ? 'intensive' : unit === 'garkheda' ? 'step_down' : 'intensive', kind: 'incubator' } });
    }
  }
  const put = await (await as('admin')).put('/api/newborn-care/settings').send({
    units: [
      { key: 'garkheda', name: 'Garkheda', level: 'level_IIIA' },
      { key: 'adalat_road', name: 'Adalat Road', level: 'level_II' },
      { key: 'waluj', name: 'Waluj', level: 'level_II' },
    ],
    beds: made,
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const iso = (d) => new Date(d).toISOString();
const ago = (min) => iso(NOW.getTime() - min * MIN);
async function makeBaby({ birthAt = ago(120), weight = 2100, mother = null, name = 'Baby Nicu', doctor = 'drA' } = {}) {
  const r = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'newborn', fullName: name, ageYears: undefined, assignedDoctor: people[doctor]._id.toString(), newborn: { birthAt, birthWeightGrams: weight, sex: 'female', ...(mother ? { mother } : {}) } }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.patient;
}
const admitBody = (baby, over = {}) => ({ clientRequestId: randomUUID(), billingType: 'cash', patientId: baby.id, unit: 'garkheda', source: 'transfer_other', transferFromName: 'Sample District Hospital', admittedAt: ago(30), bedId: beds.garkheda[0], admittingDoctorId: people.drA._id.toString(), weightGrams: 2100, gestationWeeks: 35, gestationDays: 2, temperatureC: 36.8, reasonPrimary: 'observation_at_risk', ...over });
const admit = async (who, baby, over) => (await as(who)).post('/api/newborn-care/nicu').send(admitBody(baby, over));
const complete = () => ({ respiratorySupport: 'none', exam: Object.fromEntries(Object.keys(EXAM_SYSTEMS).map((k) => [k, { status: 'normal', note: '' }])) });

describe('the computed values (schema "computed")', () => {
  it('maturity, size from a typed centile, ROP (later of 30 days and 31 weeks PMA), cranial ultrasound', () => {
    expect([maturityClass(37), maturityClass(34), maturityClass(33), maturityClass(28), maturityClass(27)]).toEqual(['term', 'late_preterm', 'preterm', 'preterm', 'extreme_preterm']);
    expect([sizeClass(9.9), sizeClass(10), sizeClass(90), sizeClass(90.1), sizeClass(null)]).toEqual(['sga', 'aga', 'aga', 'lga', null]);
    expect([ropEligible({ gaWeeks: 35, weightGrams: 1999 }), ropEligible({ gaWeeks: 33, weightGrams: 2500 }), ropEligible({ gaWeeks: 36, weightGrams: 2500, unstableCourse: true }), ropEligible({ gaWeeks: 36, weightGrams: 2500 })]).toEqual([true, true, true, false]);
    // born 20 Nov 2026 (India time): 30 weeks → day 30 is later; 26 weeks → 31 weeks PMA (day 35) is later
    expect(iso(ropFirstExamDue('2026-11-20T04:00:00Z', 30, 0))).toBe('2026-12-20T00:00:00.000Z');
    expect(iso(ropFirstExamDue('2026-11-20T04:00:00Z', 26, 0))).toBe('2026-12-25T00:00:00.000Z');
    expect(cranialUsgDue('2026-11-20T04:00:00Z', 30, 0, 1100).map((x) => [x.key, iso(x.on).slice(0, 10)])).toEqual([['day3', '2026-11-23'], ['day7', '2026-11-27'], ['day28', '2026-12-18'], ['pma36', '2027-01-01']]);
    expect(cranialUsgDue('2026-11-20T04:00:00Z', 34, 0, 1900)).toEqual([]);
  });
});

describe('Build 13 acceptance tests', () => {
  it('AT1: an inborn admission from a delivery record pre-fills the mother’s history, Apgar, resuscitation and cord data', async () => {
    const mother = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Nicu Mother', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-12-20' }, obstetric: { gravida: 2, para: 1, living: 1, abortions: 0 }, medical: { bloodGroup: 'B+', allergies: 'Penicillin (sample)', conditions: ['diabetes'], conditionsReviewed: true } }))).body.patient;
    const base = `/api/patients/${mother.id}/admissions`;
    const stay = (await (await as('rmo')).post(base).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'anc', admittedAt: ago(600), ward: 'Labour', bed: '1', reason: 'In labour' })).body.admission;
    const d = (await (await as('rmo')).post(`${base}/${stay.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
    const content = { gestationWeeks: 34, labourOnset: 'spontaneous', parity: 'multipara', previousCaesarean: 'no', presentation: 'cephalic', bloodLossMl: 300, deliveredAt: ago(180), mode: 'normal', babies: [{ outcome: 'live', sex: 'female', weightGrams: 2100, apgar1: 5, apgar5: 7, breastfedWithinHour: 'no', nicu: 'yes' }] };
    const s = await (await as('rmo')).put(`${base}/${stay.id}/documents/${d.id}`).send({ rev: d.rev, content });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    const signed = await (await as('drA')).post(`${base}/${stay.id}/documents/${d.id}/sign`).send({ rev: s.body.document.rev });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    const made = await (await as('rmo')).post('/api/delivery-babies').send({ documentId: d.id, index: 0 });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const baby = { id: made.body.baby.id };
    const checks = Object.fromEntries(BIRTH_CHECKS.map((c) => [c.key, 'yes']));
    const birth = await (await as('nurse')).post('/api/newborn-care/birth').send({ patientId: baby.id, criedAtBirth: 'no', resuscitation: 'bagMask', cordClamping: 'delayed', checks, temperatureC: 36.4, witness: { email: people.drA.email, password: PASSWORD } });
    expect(birth.status, JSON.stringify(birth.body)).toBe(201);

    // The form's options already know the mother and the gestation from the note
    const opts = (await (await as('nurse')).get(`/api/newborn-care/nicu/options?patientId=${baby.id}`)).body;
    expect(opts.prefill).toMatchObject({ motherId: mother.id, gestationWeeks: 34, weightGrams: 2100, allergyAlert: 'Penicillin (sample)' });
    expect(opts.units.find((u) => u.key === 'garkheda').sources).toMatchObject({ inborn_lr_ot: expect.any(String), transfer_waluj: 'Transfer – Waluj', transfer_adalat_road: 'Transfer – Adalat Road' });

    const a = await admit('nurse', baby, { source: 'inborn_lr_ot', transferFromName: '', admittedAt: ago(150), gestationWeeks: 34, gestationDays: 0, temperatureC: 36.6, reasonPrimary: 'prematurity' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const m = a.body.admission.maternal;
    expect(m).toMatchObject({ gravida: 2, para: 1, living: 1, abortions: 0, bloodGroup: 'B+', antenatalProblems: ['gdm_dm'], booked: null, deliveryMode: 'svd', labourOnset: 'spontaneous', presentation: 'Cephalic', apgar1: 5, apgar5: 7, resuscitation: ['ppv'], cordClamping: 'delayed', drTempC: 36.4, skinToSkin: 'yes', vitKGiven: 'yes', bandsVerified: 'yes' });
    expect(m.motherAge).toBe(30);
    expect(a.body.admission.maternalFrom).toMatchObject({ gravida: 'mother', bloodGroup: 'mother', apgar1: 'delivery', deliveryMode: 'delivery', resuscitation: 'birth', cordClamping: 'birth' });
    expect(a.body.admission).toMatchObject({ allergyAlert: 'Penicillin (sample)', motherMrn: mother.mrn, inborn: true, registerLabel: 'GARKHEDA-2026-0001', bed: { name: 'NICU garkheda · B1', type: 'incubator' } });
    // Editable: a value changed by hand no longer says it came from the note
    const edit = await (await as('nurse')).put(`/api/newborn-care/nicu/${a.body.admission.id}`).send({ maternal: { ...m, apgar1: 6, cordPh: 7.21 } });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.admission.maternal).toMatchObject({ apgar1: 6, apgar5: 7, cordPh: 7.21 });
    expect(edit.body.admission.maternalFrom.apgar1).toBeUndefined();
    expect(edit.body.admission.maternalFrom.apgar5).toBe('delivery');
    const entry = await AuditLog.findOne({ action: 'NICU_ADMITTED' }).lean();
    expect(entry.details).toMatchObject({ motherId: mother.id, prefilledFrom: expect.arrayContaining(['mother', 'delivery', 'birth']) });
    expect(JSON.stringify(entry.details)).not.toMatch(/Penicillin|B\+/); // ids only
  });

  it('AT2: a temperature of 35.9 °C gives the red banner and the hypothermia prompt', async () => {
    const a = await admit('nurse', await makeBaby(), { temperatureC: 35.9 });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.warnings).toContainEqual(expect.objectContaining({ key: 'hypothermia', tone: 'high', text: expect.stringMatching(/35\.9 °C.*hypothermia pathway \(NEO-SOP-04\)/) }));
    const b = await admit('nurse', await makeBaby({ name: 'Baby Warm' }), { temperatureC: 36.0, bedId: beds.garkheda[1] });
    expect(b.body.admission.banners.map((x) => x.key)).not.toContain('hypothermia');
    // Glucose under 45 → the hypoglycaemia prompt
    const g = await (await as('nurse')).put(`/api/newborn-care/nicu/${b.body.admission.id}`).send({ assessment: { ...complete(), glucose: 40 } });
    expect(g.body.admission.banners).toContainEqual(expect.objectContaining({ key: 'hypoglycaemia', text: expect.stringMatching(/NEO-SOP-08/) }));
  });

  it('AT3: a 30-week 1100 g baby – ROP due computed and on the banner; the screening event is in her log', async () => {
    const baby = await makeBaby({ birthAt: '2026-11-19T22:00:00.000Z', weight: 1100 });
    const a = await admit('nurse', baby, { gestationWeeks: 30, gestationDays: 0, weightGrams: 1100, reasonPrimary: 'prematurity' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    // born 20 Nov (India time): later of 20 Nov + 30 days (20 Dec) and 31 weeks PMA (27 Nov)
    expect(a.body.admission.computed).toMatchObject({ ropEligible: true, maturityClass: 'preterm', defaultChart: 'fenton' });
    expect(iso(a.body.admission.computed.ropFirstExamDue)).toBe('2026-12-20T00:00:00.000Z');
    expect(a.body.admission.banners).toContainEqual(expect.objectContaining({ key: 'rop', on: '2026-12-20T00:00:00.000Z' }));
    expect(a.body.admission.computed.cranialUsg.map((x) => x.key)).toEqual(['day3', 'day7', 'day28', 'pma36']);
    const log = (await (await as('nurse')).get(`/api/newborn-follow-up/patients/${baby.id}`)).body.baby;
    expect(log.screens.find((x) => x.key === 'rop')).toMatchObject({ dueBy: '2026-12-20T00:00:00.000Z', state: 'upcoming' });
    expect(log).toMatchObject({ gestationWeeks: 30, needsRop: true });
    // Entered in error: the screen made by the admission goes too
    await (await as('nurse')).post(`/api/newborn-care/nicu/${a.body.admission.id}/cancel`).send({ reason: 'Wrong baby (sample)' });
    const after = (await (await as('nurse')).get(`/api/newborn-follow-up/patients/${baby.id}`)).body.baby;
    expect(after.screens.find((x) => x.key === 'rop')?.dueBy).not.toBe('2026-12-20T00:00:00.000Z');
  });

  it('AT4: a 29-week baby transferred in to Waluj (level II) – the capability warning; level IIIA screens are hidden there', async () => {
    const a = await admit('nurse', await makeBaby({ weight: 1300 }), { unit: 'waluj', bedId: beds.waluj[0], gestationWeeks: 29, weightGrams: 1300, reasonPrimary: 'prematurity' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.warnings).toContainEqual(expect.objectContaining({ key: 'capability', text: expect.stringMatching(/Outside this unit's capability \(NEO-A-01\).*Garkheda/) }));
    const id = a.body.admission.id;
    const vent = await (await as('drA')).put(`/api/newborn-care/nicu/${id}`).send({ assessment: { ...complete(), respiratorySupport: 'ventilator' } });
    expect(vent.status).toBe(400);
    expect(vent.body.error.fields['assessment.respiratorySupport']).toMatch(/PX-X-01/);
    const line = await (await as('drA')).put(`/api/newborn-care/nicu/${id}`).send({ plan: { lines: ['piv', 'uvc'] } });
    expect(line.body.error.fields['plan.lines']).toMatch(/UVC/);
    // A baby born at Waluj itself is not a transfer in: no warning
    const own = await admit('nurse', await makeBaby({ name: 'Baby Own', weight: 1300 }), { unit: 'waluj', bedId: beds.waluj[1], source: 'inborn_lr_ot', motherId: undefined, gestationWeeks: 29, weightGrams: 1300 });
    expect(own.status).toBe(400); // an inborn baby needs the mother's record
    expect(own.body.error.fields.motherId).toMatch(/mother/);
    // At Garkheda (level IIIA) ventilation and a UVC are offered
    const g = await admit('nurse', await makeBaby({ name: 'Baby Garkheda', weight: 1300 }), { gestationWeeks: 29, weightGrams: 1300 });
    expect(g.body.admission.banners.map((x) => x.key)).not.toContain('capability');
    const ok = await (await as('drA')).put(`/api/newborn-care/nicu/${g.body.admission.id}`).send({ assessment: { ...complete(), respiratorySupport: 'ventilator' }, plan: { lines: ['uvc'], workingDiagnosis: 'RDS (sample)' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('AT5: counselling blank at 61 minutes → a task for the admitting doctor; the dashboard numerator is right for the month', async () => {
    const late = await admit('nurse', await makeBaby({ birthAt: ago(300) }), { admittedAt: ago(61) });
    const inTime = await admit('nurse', await makeBaby({ name: 'Baby Told', birthAt: ago(300) }), { admittedAt: ago(180), bedId: beds.garkheda[1] });
    expect((await (await as('nurse')).put(`/api/newborn-care/nicu/${inTime.body.admission.id}`).send({ followOn: { counselledAt: ago(135), bothParents: 'yes' } })).status).toBe(200);
    expect(late.body.admission.banners.map((x) => x.key)).toContain('counsel');
    // the board (or the 5-minute round) tells the admitting doctor – once
    const board = (await (await as('nurse')).get('/api/newborn-care/board')).body;
    const g = board.units.find((u) => u.key === 'garkheda');
    expect(g.counts.counselOverdue).toBe(1);
    await runNicuAutomations(hospital._id, new Date());
    const tasks = await Notification.find({ tenantId: hospital._id, userId: people.drA._id, kind: 'nicu' }).lean();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].link).toBe(`/patients/${(await NicuAdmission.findOne({ _id: late.body.admission.id, tenantId: hospital._id }).lean()).patientId}/newborn-care`);
    expect(tasks[0].text).toMatch(/counsel the parents/);
    const dash = (await (await as('drA')).get('/api/dashboards?department=newborn&month=2026-11')).body;
    const row = (k) => dash.rows.find((r) => r.key === k);
    expect(row('nicuCounselled1h')).toMatchObject({ numerator: 1, denominator: 2, value: 50, target: 95, status: 'missed' });
    expect(row('nicuCounselOverdue').value).toBe(1);
    expect(row('nicuTempInRange')).toMatchObject({ numerator: 2, denominator: 2 });
    expect(dash.definitions.map((d) => d.key)).toContain('nicuRopOnTime');
  });

  it('AT6: the NEO-L-05 export lists every admission of the month with serials and no gaps; survival under 1500 g shows n/N', async () => {
    const ids = [];
    for (const [i, w] of [[0, 1200], [1, 1400], [2, 2600]]) {
      const r = await admit('nurse', await makeBaby({ name: `Baby Reg ${i}`, weight: w, birthAt: ago(4000) }), { bedId: beds.garkheda[i], weightGrams: w, gestationWeeks: 31, admittedAt: ago(3900 - i * 10), reasonPrimary: 'prematurity' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      ids.push(r.body.admission.id);
    }
    const waluj = await admit('nurse', await makeBaby({ name: 'Baby Waluj', birthAt: ago(4000) }), { unit: 'waluj', bedId: beds.waluj[0], admittedAt: ago(3000) });
    expect(waluj.body.admission.registerLabel).toBe('WALUJ-2026-0001');
    // the second admission was entered in error: it keeps its number
    await (await as('nurse')).post(`/api/newborn-care/nicu/${ids[1]}/cancel`).send({ reason: 'Typed on the wrong baby (sample)' });
    const out = (k, result, details = {}) => as('drA').then((s) => s.post(`/api/newborn-care/nicu/${k}/outcome`).send({ result, at: ago(100), details }));
    expect((await out(ids[0], 'discharged_home', { weightAtDischargeG: 1750, morbidities: ['none'] })).status).toBe(200);
    const fourth = await admit('nurse', await makeBaby({ name: 'Baby Reg 3', weight: 900, birthAt: ago(4000) }), { bedId: beds.garkheda[3], weightGrams: 900, gestationWeeks: 28, admittedAt: ago(3800), floorDecision: { decision: 'admit_here', consultantId: people.drB._id.toString(), note: '' } });
    expect(fourth.status, JSON.stringify(fourth.body)).toBe(201);
    expect((await out(fourth.body.admission.id, 'died', { deathCauseIcd10: 'P22.0', mmReviewRef: 'NEO-A-06/2026/01' })).status).toBe(200);
    // the register number can never be changed
    await expect(NicuAdmission.updateOne({ _id: ids[0], tenantId: hospital._id }, { $set: { registerNo: 9 } })).rejects.toThrow(/cannot be changed/);

    const reg = (await (await as('drA')).get('/api/newborn-care/register?month=2026-11')).body;
    expect(reg.rows.map((r) => r.register.serial)).toEqual(['GARKHEDA-2026-0001', 'GARKHEDA-2026-0002', 'GARKHEDA-2026-0003', 'GARKHEDA-2026-0004', 'WALUJ-2026-0001']);
    expect(reg.gaps.every((g) => g.missing.length === 0)).toBe(true);
    expect(reg.rows[1].register.outcome).toBe('entered_in_error');
    expect(reg.totals.survivalUnder1500).toEqual({ n: 1, N: 2 });
    expect(reg.totals.survivalByWeight).toMatchObject({ w1: { n: 0, N: 1 }, w2: { n: 1, N: 1 } });
    const csv = await (await as('drA')).get('/api/newborn-care/register.csv?month=2026-11&unit=garkheda');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('serial,admitted_at,baby_uhid,mother_uhid,inborn_outborn,ga,weight_g,admission_reason_primary,ventilated,surfactant,tpn,morbidities,outcome,discharged_at,los_days,weight_at_discharge,mm_ref');
    expect(lines).toHaveLength(5);
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['GARKHEDA-2026-0001', 'GARKHEDA-2026-0002', 'GARKHEDA-2026-0003', 'GARKHEDA-2026-0004']);
    expect(lines[4]).toMatch(/,outborn,28\+2,900,observation_at_risk,/);
    expect(lines[4]).toMatch(/died,.*NEO-A-06\/2026\/01$/);
    expect(csv.text).not.toMatch(/Baby Reg/); // numbers, not names
    expect(await AuditLog.countDocuments({ action: 'NICU_REGISTER_EXPORTED' })).toBe(1);
    const dash = (await (await as('drA')).get('/api/dashboards?department=newborn&month=2026-11')).body;
    expect(dash.rows.find((r) => r.key === 'nicuSurvivalUnder1500')).toMatchObject({ numerator: 1, denominator: 2 });
    expect(dash.rows.find((r) => r.key === 'nicuWeight_w2').value).toBe(1); // 1200 g (1400 g was entered in error)
  });

  it('AT7: the print follows NEO-F-03 – the form is in the document register and the footer is fixed', () => {
    expect(FORM_SCREENS.nicu_admission).toEqual({ label: 'NICU admission', code: 'NEO-F-03' });
    expect(FORM_SCREENS.nicu_register.code).toBe('NEO-L-05');
    expect(NICU_FORM_FOOTER).toBe('NEO-F-03 · v1.0');
  });
});

describe('the unit (NEO-A-01): full unit, floor, nurse:baby ratio, settings', () => {
  it('N4: a full unit is blocked with the transfer pathway; the hospital admin allows one more admission, used once', async () => {
    await admit('nurse', await makeBaby({ name: 'Baby W1' }), { unit: 'waluj', bedId: beds.waluj[0] });
    const second = await admit('nurse', await makeBaby({ name: 'Baby W2' }), { unit: 'waluj', bedId: beds.waluj[0] });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('BED_OCCUPIED');
    await admit('nurse', await makeBaby({ name: 'Baby W3' }), { unit: 'waluj', bedId: beds.waluj[1] });
    const full = await admit('drA', await makeBaby({ name: 'Baby W4' }), { unit: 'waluj', bedId: beds.waluj[1] });
    expect(full.status).toBe(409);
    expect(full.body.error).toMatchObject({ code: 'UNIT_FULL', message: expect.stringMatching(/^Unit full – transfer pathway \(NEO-F-18\)/) });
    // the hospital admin (in admin work, no patient records) allows one more; a nurse cannot
    expect((await (await as('nurse')).post('/api/newborn-care/settings/override').send({ unit: 'waluj', reason: 'Twin of a baby in the unit (sample)' })).status).toBe(403);
    const allowed = await (await as('admin')).post('/api/newborn-care/settings/override').send({ unit: 'waluj', reason: 'Twin of a baby in the unit (sample)' });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect(allowed.body.overrides[0]).toMatchObject({ unit: 'waluj', byName: 'Sample admin', open: true });
    const over = await admit('drA', await makeBaby({ name: 'Baby W5' }), { unit: 'waluj', bedId: beds.waluj[1] });
    expect(over.status, JSON.stringify(over.body)).toBe(201);
    expect(over.body.admission.fullOverride).toMatchObject({ byName: 'Sample admin', reason: 'Twin of a baby in the unit (sample)' });
    expect((await admit('drA', await makeBaby({ name: 'Baby W6' }), { unit: 'waluj', bedId: beds.waluj[1] })).body.error.code).toBe('UNIT_FULL');
  });

  it('the admission floor: below 28 weeks or 1000 g the transfer is suggested, not blocked – the consultant decides', async () => {
    const baby = await makeBaby({ weight: 950 });
    const no = await admit('nurse', baby, { weightGrams: 950, gestationWeeks: 27 });
    expect(no.body.error.fields.floorDecision).toMatch(/consultant's decision/);
    const yes = await admit('nurse', baby, { weightGrams: 950, gestationWeeks: 27, floorDecision: { decision: 'admit_here', consultantId: people.drB._id.toString(), note: 'Stable, parents agree (sample)' } });
    expect(yes.status, JSON.stringify(yes.body)).toBe(201);
    expect(yes.body.admission.banners).toContainEqual(expect.objectContaining({ key: 'floor', text: expect.stringMatching(/transfer pathway \(NEO-F-18\) suggested.*Sample drB.*admit here/) }));
  });

  it('the nurse:baby ratio warning on the board; the bed board counts the babies', async () => {
    for (const i of [0, 1, 2]) await admit('nurse', await makeBaby({ name: `Baby R${i}` }), { bedId: beds.garkheda[i] });
    let g = (await (await as('nurse')).get('/api/newborn-care/board')).body.units.find((u) => u.key === 'garkheda');
    expect(g).toMatchObject({ capacity: 6, free: 3, intensiveBabies: 3, ratio: 'unknown', level: 'level_IIIA' });
    expect((await (await as('nurse')).post('/api/newborn-care/roster').send({ unit: 'garkheda', nurses: 1 })).status).toBe(201);
    g = (await (await as('nurse')).get('/api/newborn-care/board')).body.units.find((u) => u.key === 'garkheda');
    expect(g.ratio).toBe('worse');
    await (await as('nurse')).post('/api/newborn-care/roster').send({ unit: 'garkheda', nurses: 2 });
    g = (await (await as('nurse')).get('/api/newborn-care/board')).body.units.find((u) => u.key === 'garkheda');
    expect(g.ratio).toBe(null);
    expect(g.beds.filter((b) => b.occupied)).toHaveLength(3);
    expect(g.admissions.find((x) => x.baby.fullName === 'Baby R0')).toMatchObject({ registerLabel: expect.stringMatching(/^GARKHEDA-2026-/), flags: expect.objectContaining({ incomplete: false }) });
    expect((await (await as('reception')).get('/api/newborn-care/board')).status).toBe(403);
  });

  it('settings: only the hospital admin changes them; a unit with admissions stays (not in use instead)', async () => {
    expect((await (await as('nurse')).put('/api/newborn-care/settings').send({ units: [{ key: 'x1', name: 'X', level: 'level_II' }] })).status).toBe(403);
    expect((await (await as('nurse')).get('/api/newborn-care/settings')).body.units.map((u) => u.key)).toEqual(['garkheda', 'adalat_road', 'waluj']);
    await admit('nurse', await makeBaby(), { unit: 'waluj', bedId: beds.waluj[0] });
    const r = await (await as('admin')).put('/api/newborn-care/settings').send({ units: [{ key: 'garkheda', name: 'Garkheda', level: 'level_IIIA' }] });
    expect(r.body.error.fields.units).toMatch(/Waluj has admissions/);
    const moved = await (await as('admin')).put('/api/newborn-care/settings').send({ beds: [{ bedId: beds.waluj[0], nicu: null }] });
    expect(moved.body.error.fields['beds.0.nicu.unit']).toMatch(/A baby is in B1/);
    expect(await AuditLog.countDocuments({ action: 'NICU_SETTINGS_CHANGED' })).toBe(1);
  });
});

describe('the form: sign, lock, outcome, old records', () => {
  it('the admitting doctor signs once complete; §1–§3 are locked after, counselling stays open; N6 incomplete flag', async () => {
    const a = (await admit('nurse', await makeBaby(), { admittedAt: ago(70) })).body.admission;
    expect(a.flags.incomplete).toBe(true);
    expect((await (await as('nurse')).post(`/api/newborn-care/nicu/${a.id}/sign`)).status).toBe(403);
    const miss = await (await as('drA')).post(`/api/newborn-care/nicu/${a.id}/sign`);
    expect(miss.status).toBe(400);
    expect(miss.body.error.fields).toMatchObject({ 'assessment.exam.hips': expect.any(String), 'plan.workingDiagnosis': expect.any(String) });
    expect((await (await as('nurse')).put(`/api/newborn-care/nicu/${a.id}`).send({ assessment: { ...complete(), weightCentile: 8, growthChart: 'fenton' }, plan: { problems: ['Observation after transfer (sample)'], icd10: 'p07.3', sepsisRisk: 'no' } })).status).toBe(200);
    const s = await (await as('drA')).post(`/api/newborn-care/nicu/${a.id}/sign`);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.admission).toMatchObject({ signed: { byName: 'Sample drA', role: 'doctor' }, computed: { sizeClass: 'sga' }, plan: { icd10: 'P07.3' } });
    expect(s.body.admission.flags.incomplete).toBe(false);
    expect((await (await as('nurse')).put(`/api/newborn-care/nicu/${a.id}`).send({ temperatureC: 37 })).status).toBe(409);
    const told = await (await as('nurse')).put(`/api/newborn-care/nicu/${a.id}`).send({ followOn: { counselledAt: ago(5), counselledById: people.drA._id.toString(), consentSigned: 'yes' } });
    expect(told.status, JSON.stringify(told.body)).toBe(200);
    expect(told.body.admission.followOn).toMatchObject({ counselledByName: 'Sample drA', consentSigned: 'yes' });
    // the outcome with its NEO-L-05 details; a transfer needs where to
    expect((await (await as('drA')).post(`/api/newborn-care/nicu/${a.id}/outcome`).send({ result: 'transferred', at: ago(1) })).body.error.fields['details.transferTo']).toMatch(/where/);
    const o = await (await as('drA')).post(`/api/newborn-care/nicu/${a.id}/outcome`).send({ result: 'transferred', at: ago(1), details: { transferTo: 'Sample higher centre', transferDecisionAt: ago(60), transferDepartedAt: ago(5) } });
    expect(o.body.admission.outcome).toMatchObject({ result: 'transferred', details: { transferTo: 'Sample higher centre' } });
    const dash = (await (await as('drA')).get('/api/dashboards?department=newborn&month=2026-11')).body;
    expect(dash.rows.find((r) => r.key === 'nicuTransfer2h')).toMatchObject({ numerator: 1, denominator: 1 });
    expect(dash.rows.find((r) => r.key === 'nicuComplete1h')).toMatchObject({ numerator: 0, denominator: 1 });
  });

  it('a DRAFT admission of 6 Nov 2026 is still read as it was', async () => {
    const baby = await makeBaby();
    await NicuAdmission.create({ tenantId: hospital._id, patientId: baby.id, serial: 41, unit: 'sncu', source: 'inborn', admittedAt: ago(500), reasons: ['lbw'], weightGrams: 2100, temperatureC: 35.9, by: people.nurse._id, byName: 'Sample nurse', clientRequestId: randomUUID() });
    const care = (await (await as('drA')).get(`/api/newborn-care?patientId=${baby.id}`)).body;
    expect(care.nicu[0]).toMatchObject({ format: 'draft', registerLabel: 'No. 41', unitName: 'SNCU', sourceWords: 'Born here (inborn)', reasons: ['lbw'], cold: true });
    const reg = (await (await as('drA')).get('/api/newborn-care/register?month=2026-11')).body;
    expect(reg.rows[0].register).toMatchObject({ serial: 'No. 41', inbornOutborn: 'inborn', admissionReasonPrimary: 'lbw' });
    expect((await (await as('drA')).put(`/api/newborn-care/nicu/${care.nicu[0].id}`).send({ temperatureC: 36 })).status).toBe(409);
    // its outcome uses the new list
    expect((await (await as('drA')).post(`/api/newborn-care/nicu/${care.nicu[0].id}/outcome`).send({ result: 'discharged_home', at: ago(10) })).status).toBe(200);
  });
});

describe('reception admits at the desk (header only, 9 Nov 2026)', () => {
  it('reception admits with unit, bed, where from and the admitting doctor; sees where the baby is, never the form', async () => {
    const baby = await makeBaby({ name: 'Baby Desk' });
    const desk = await as('reception');
    const opts = await desk.get(`/api/newborn-care/nicu/options?patientId=${baby.id}`);
    expect(opts.status, JSON.stringify(opts.body)).toBe(200);
    expect(opts.body).toMatchObject({ access: { desk: true }, prefill: { fields: [], gestationWeeks: null, weightGrams: null, allergyAlert: '' } });
    const body = { clientRequestId: randomUUID(), billingType: 'cash', patientId: baby.id, unit: 'garkheda', source: 'transfer_other', transferFromName: 'Sample District Hospital', admittedAt: ago(10), bedId: beds.garkheda[0] };
    expect((await desk.post('/api/newborn-care/nicu').send({ ...body, weightGrams: 2100 })).status).toBe(400); // no clinical field at the desk
    expect((await desk.post('/api/newborn-care/nicu').send(body)).body.error.fields.admittingDoctorId).toMatch(/admitting doctor/);
    const a = await desk.post('/api/newborn-care/nicu').send({ ...body, admittingDoctorId: people.drA._id.toString() });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.admission).toMatchObject({ registerLabel: 'GARKHEDA-2026-0001', unitName: 'Garkheda', bed: 'NICU garkheda · B1', state: 'in', atDesk: true, assessmentNeeded: true, admittingDoctor: 'Sample drA' });
    expect(JSON.stringify(a.body)).not.toMatch(/maternal|temperature|banners|reasonPrimary/);
    // the admitting doctor and the nurses are told
    const told = await Notification.find({ tenantId: hospital._id, kind: 'nicu' }).lean();
    expect(told.map((x) => String(x.userId)).sort()).toEqual([String(people.drA._id), String(people.nurse._id)].sort());
    expect(told[0].text).toMatch(/Baby Desk .* admitted at the desk to Garkheda, B1 – the admission assessment is needed/);
    // the desk view: where, not how
    const view = (await desk.get(`/api/newborn-care/nicu/desk?patientId=${baby.id}`)).body;
    expect(view).toMatchObject({ access: { admit: false }, admissions: [{ state: 'in', atDesk: true }] });
    expect(JSON.stringify(view)).not.toMatch(/maternal|temperature|outcome|died/);
    // everything else stays clinical
    expect((await desk.get(`/api/newborn-care?patientId=${baby.id}`)).status).toBe(403);
    expect((await desk.put(`/api/newborn-care/nicu/${a.body.admission.id}`).send({ temperatureC: 36.8 })).status).toBe(403);
    expect((await desk.get('/api/newborn-care/register?month=2026-11')).status).toBe(403);
    expect((await desk.get('/api/newborn-care/board')).status).toBe(403);
    // the nurse sees "admitted at the desk", enters the first findings, and the banner goes
    const care = (await (await as('nurse')).get(`/api/newborn-care?patientId=${baby.id}`)).body.nicu[0];
    expect(care.banners[0]).toMatchObject({ key: 'pending', text: expect.stringMatching(/Admitted at the desk by Sample reception/) });
    expect(care.atDesk).toMatchObject({ byName: 'Sample reception' });
    const done = await (await as('nurse')).put(`/api/newborn-care/nicu/${care.id}`).send({ weightGrams: 2100, gestationWeeks: 35, temperatureC: 36.8, reasonPrimary: 'observation_at_risk' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.admission.banners.map((x) => x.key)).not.toContain('pending');
    expect((await desk.get(`/api/newborn-care/nicu/desk?patientId=${baby.id}`)).body.admissions[0].assessmentNeeded).toBe(false);
  });

  it('the clinical team fills §1 in from the linked records later – only empty fields, never what was typed', async () => {
    const baby = await makeBaby({ name: 'Baby Fill' });
    const checks = Object.fromEntries(BIRTH_CHECKS.map((c) => [c.key, c.key === 'idBand' ? 'no' : 'yes']));
    expect((await (await as('nurse')).post('/api/newborn-care/birth').send({ patientId: baby.id, criedAtBirth: 'no', resuscitation: 'bagMask', cordClamping: 'delayed', checks, temperatureC: 36.2, note: 'Band put on in the ward (sample)' })).status).toBe(201);
    const a = (await (await as('reception')).post('/api/newborn-care/nicu').send({ clientRequestId: randomUUID(), billingType: 'cash', patientId: baby.id, unit: 'garkheda', source: 'transfer_other', transferFromName: 'Sample clinic', admittedAt: ago(10), bedId: beds.garkheda[1], admittingDoctorId: people.drA._id.toString() })).body.admission;
    const nurse = await as('nurse');
    const m = (await nurse.get(`/api/newborn-care?patientId=${baby.id}`)).body.nicu[0];
    expect(m.maternal).toBe(null);
    await nurse.put(`/api/newborn-care/nicu/${a.id}`).send({ maternal: { cordClamping: 'early' } });
    const p = await nurse.post(`/api/newborn-care/nicu/${a.id}/prefill`);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.admission.maternal).toMatchObject({ resuscitation: ['ppv'], drTempC: 36.2, cordClamping: 'early' }); // typed value kept
    expect(p.body.admission.maternalFrom).toMatchObject({ resuscitation: 'birth' });
    expect(p.body.admission.weightGrams).toBe(2100); // the birth weight on her record
    expect((await (await as('reception')).post(`/api/newborn-care/nicu/${a.id}/prefill`)).status).toBe(403);
  });
});

describe('a new baby registered as B/O <mother> and admitted in one step (9 Nov 2026)', () => {
  const nicuPart = (over = {}) => ({ clientRequestId: randomUUID(), billingType: 'insurance', unit: 'garkheda', source: 'transfer_other', transferFromName: 'Sample Rural Hospital', admittedAt: ago(20), bedId: beds.garkheda[0], admittingDoctorId: people.drA._id.toString(), birthAt: ago(300), ...over });
  it('reception registers B/O <mother> and admits; the checks run before any record is made; possible duplicates are shown', async () => {
    const desk = await as('reception');
    expect((await desk.get('/api/newborn-care/nicu/new-baby/options')).body.units.map((u) => u.key)).toEqual(['garkheda', 'adalat_road', 'waluj']);
    expect((await desk.post('/api/newborn-care/nicu/new-baby').send(nicuPart())).body.error.fields.motherName).toMatch(/mother's name/);
    // a full unit: refused before the baby's record is made
    await admit('nurse', await makeBaby({ name: 'Baby W1' }), { unit: 'waluj', bedId: beds.waluj[0] });
    await admit('nurse', await makeBaby({ name: 'Baby W2' }), { unit: 'waluj', bedId: beds.waluj[1] });
    const full = await desk.post('/api/newborn-care/nicu/new-baby').send(nicuPart({ motherName: 'sample outborn mother', unit: 'waluj', bedId: beds.waluj[0] }));
    expect(full.body.error.code).toBe('UNIT_FULL');
    expect(await Patient.countDocuments({ tenantId: hospital._id, fullName: /^B\/O/ })).toBe(0);
    const r = await desk.post('/api/newborn-care/nicu/new-baby').send(nicuPart({ motherName: 'sample outborn mother', phone: '+91 00000 00001', sex: 'male', birthWeightGrams: 1800 }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ baby: { fullName: 'B/O Sample Outborn Mother', mrn: expect.stringMatching(/^P-/) }, admission: { registerLabel: 'GARKHEDA-2026-0001', state: 'in', atDesk: true, assessmentNeeded: true } });
    const baby = await Patient.findOne({ _id: r.body.baby.id, tenantId: hospital._id }).lean();
    expect(baby).toMatchObject({ careType: 'newborn', newborn: expect.objectContaining({ birthWeightGrams: 1800, sex: 'male', mother: null }) });
    expect(String(baby.assignedDoctor)).toBe(String(people.drA._id));
    // the same mother again: "may already be registered", then anyway
    const again = await desk.post('/api/newborn-care/nicu/new-baby').send(nicuPart({ motherName: 'Sample Outborn Mother', phone: '+91 00000 00001', bedId: beds.garkheda[1] }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('POSSIBLE_MATCHES');
    expect((await desk.post('/api/newborn-care/nicu/new-baby').send(nicuPart({ motherName: 'Sample Outborn Mother', phone: '+91 00000 00001', bedId: beds.garkheda[1], registerAnyway: true }))).status).toBe(201);
    // nurses do not register patients
    expect((await (await as('nurse')).post('/api/newborn-care/nicu/new-baby').send(nicuPart({ motherName: 'X Y', bedId: beds.garkheda[2] }))).status).toBe(403);
  });

  it('a mother registered here: the baby is B/O her name and linked to her record', async () => {
    const mother = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: 'Linked Sample Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const r = await (await as('rmo')).post('/api/newborn-care/nicu/new-baby').send(nicuPart({ motherId: mother.id, source: 'postnatal_ward', transferFromName: '' }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.baby.fullName).toBe('B/O Linked Sample Mother');
    const baby = await Patient.findOne({ _id: r.body.baby.id, tenantId: hospital._id }).lean();
    expect(String(baby.newborn.mother)).toBe(mother.id);
  });
});
