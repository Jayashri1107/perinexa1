// Delivery and newborn outcomes as fixed fields (5 Oct 2026): per baby on the delivery note the kind of stillbirth,
// breastfeeding within the hour and NICU or SNCU admission; for the mother a "postpartum haemorrhage" answer – only
// SUGGESTED from the blood loss, always decided by the doctor; on a baby's record the NICU or SNCU stay and
// breastfeeding at discharge; and the monthly report's rows for stillbirths, newborn deaths and maternal deaths.
// Every field is optional with a "not recorded" state. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import * as website from '../../client/src/pages/inpatient/deliveryOutcomes.js';
import { BREASTFED_WITHIN_HOUR, PPH_ML_CAESAREAN, PPH_ML_VAGINAL, PPH_SOURCE, STILLBIRTH_TYPES, contentSchema, missingToSign, pphSuggested, pphThresholdMl } from '../src/inpatient/docSchemas.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ClinicalDocument } from '../src/models/ClinicalDocument.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-09T06:00:00Z'); // Friday 9 Oct 2026, 11:30 in the hospital (India)
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
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Outcome Hospital');
  other = await createTenant('Other Outcome Hospital');
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
const id = (who) => people[who]._id.toString();
async function registered(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: 'Outcome Mother', ageYears: 27, assignedDoctor: id('drA'), pregnancy: { scanEdd: '2026-10-12' }, medical: { allergies: 'None known' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const baby = (overrides = {}) =>
  registered({ careType: 'newborn', fullName: 'Baby Outcome', ageYears: undefined, pregnancy: undefined, medical: undefined, newborn: { birthAt: '2026-10-01T03:00:00.000Z', birthWeightGrams: 2900, sex: 'female' }, ...overrides });
const base = (p) => `/api/patients/${p.id}/admissions`;
const admit = async (p, admittedAt = '2026-10-08T02:00:00.000Z') =>
  (await (await as('rmo')).post(base(p)).send({ clientRequestId: randomUUID(), admittedAt, ward: 'Labour ward', bed: '2', reason: 'In labour' })).body.admission;
const newNote = async (p, a) => (await (await as('rmo')).post(`${base(p)}/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
const save = async (p, a, d, content) => (await as('rmo')).put(`${base(p)}/${a.id}/documents/${d.id}`).send({ rev: d.rev, content });
const sign = async (p, a, d) => (await as('drA')).post(`${base(p)}/${a.id}/documents/${d.id}/sign`).send({ rev: d.rev });
const patch = async (who, p, body) => (await as(who)).patch(`/api/patients/${p.id}`).send(body);
const view = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;
/** A delivery note written by the RMO and confirmed by Dr A. */
async function delivered(p, content, admittedAt) {
  const a = await admit(p, admittedAt);
  const d = await newNote(p, a);
  const saved = await save(p, a, d, content);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const signed = await sign(p, a, saved.body.document);
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return signed.body.document;
}

describe('postpartum haemorrhage: suggested from the blood loss, never decided by the app', () => {
  it('suggests it from 500 ml after a vaginal birth and from 1000 ml after a caesarean (WHO – a draft for the owner to check); nothing for "other"', () => {
    expect([PPH_ML_VAGINAL, PPH_ML_CAESAREAN]).toEqual([500, 1000]);
    expect(PPH_SOURCE).toMatch(/^WHO/);
    // "Other" may have been an operation (not known to be a vaginal birth): no suggestion, the doctor decides
    expect([pphThresholdMl('normal'), pphThresholdMl('vacuum'), pphThresholdMl('forceps'), pphThresholdMl('other'), pphThresholdMl('lscs'), pphThresholdMl('')]).toEqual([500, 500, 500, null, 1000, null]);
    expect(pphSuggested('other', 2000)).toBeNull();
    // The website suggests with the same numbers, source and rule, and offers the same answers
    expect([website.PPH_ML_VAGINAL, website.PPH_ML_CAESAREAN, website.PPH_SOURCE]).toEqual([PPH_ML_VAGINAL, PPH_ML_CAESAREAN, PPH_SOURCE]);
    for (const mode of ['normal', 'vacuum', 'forceps', 'lscs', 'other', '']) {
      expect(website.pphThresholdMl(mode), mode).toBe(pphThresholdMl(mode));
      for (const loss of [499, 500, 999, 1000, '', null]) expect(website.pphSuggested(mode, loss), `${mode} ${loss}`).toBe(pphSuggested(mode, loss));
    }
    expect([website.STILLBIRTH_TYPES, website.BREASTFED_WITHIN_HOUR]).toEqual([STILLBIRTH_TYPES, BREASTFED_WITHIN_HOUR]);
    expect(Object.keys(website.STILLBIRTH_TYPE_LABELS)).toEqual(STILLBIRTH_TYPES);
    expect(Object.keys(website.BREASTFED_LABELS)).toEqual(BREASTFED_WITHIN_HOUR);
    expect([pphSuggested('normal', 499), pphSuggested('normal', 500), pphSuggested('vacuum', 650)]).toEqual([false, true, true]);
    expect([pphSuggested('lscs', 999), pphSuggested('lscs', 1000), pphSuggested('lscs', '1200')]).toEqual([false, true, true]);
    // Nothing can be said without the mode or the blood loss
    expect([pphSuggested('', 800), pphSuggested('normal', null), pphSuggested('normal', ''), pphSuggested('normal', 'a lot')]).toEqual([null, null, null, null]);
  });

  it('the answer is the doctor\'s: a large blood loss signs without it, and nothing is ticked by itself', async () => {
    const p = await registered();
    const doc = await delivered(p, { deliveredAt: '2026-10-08T05:30:00.000Z', mode: 'normal', bloodLossMl: 900, babies: [{ outcome: 'live', sex: 'female', weightGrams: 3000 }] });
    expect(doc.content.pph).toBe('');
    expect(missingToSign('delivery', { ...doc.content, pph: '' })).toEqual({});
  });
});

describe('the delivery note', () => {
  it('keeps, per baby, the kind of stillbirth, breastfeeding within the hour and NICU or SNCU admission – and drops what does not fit the outcome', async () => {
    const p = await registered();
    const a = await admit(p);
    const d = await newNote(p, a);
    expect(d.content).toMatchObject({ pph: '', babies: [] });
    const content = {
      deliveredAt: '2026-10-08T05:30:00.000Z',
      mode: 'normal',
      bloodLossMl: 650,
      pph: 'yes',
      babies: [
        { outcome: 'live', sex: 'female', weightGrams: 2400, apgar1: 6, apgar5: 8, breastfedWithinHour: 'no', nicu: 'yes', stillbirthType: 'fresh' },
        { outcome: 'stillbirth', sex: 'male', weightGrams: 1900, stillbirthType: 'macerated', breastfedWithinHour: 'no', nicu: 'yes' },
        { outcome: '', breastfedWithinHour: 'not_applicable', nicu: 'no' },
      ],
    };
    const saved = await save(p, a, d, content);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const stored = (await ClinicalDocument.findOne({ _id: d.id, tenantId: hospital._id }).lean()).content;
    expect(stored.pph).toBe('yes');
    expect(stored.babies.map((b) => [b.outcome, b.stillbirthType, b.breastfedWithinHour, b.nicu, b.apgar1, b.apgar5])).toEqual([
      ['live', '', 'no', 'yes', 6, 8], // a live birth has no kind of stillbirth
      ['stillbirth', 'macerated', '', '', null, null], // a stillbirth has no breastfeeding or NICU answer
      ['', '', 'not_applicable', 'no', null, null], // the outcome not chosen yet: kept as typed
    ]);
    // Values that are not on the lists are refused, with the field named
    const bad = await save(p, a, saved.body.document, { ...content, pph: 'maybe' });
    expect([bad.status, Object.keys(bad.body.error.fields)]).toEqual([400, ['content.pph']]);
    const badBaby = await save(p, a, saved.body.document, { ...content, babies: [{ outcome: 'stillbirth', stillbirthType: 'old' }] });
    expect([badBaby.status, Object.keys(badBaby.body.error.fields)]).toEqual([400, ['content.babies.0.stillbirthType']]);
    // A stillbirth signs without its kind (optional: "not recorded")
    const plain = await save(p, a, saved.body.document, { ...content, babies: [{ outcome: 'stillbirth' }] });
    expect(plain.status).toBe(200);
    expect((await sign(p, a, plain.body.document)).status).toBe(200);
  });

  it('a delivery note from before these fields reads as "not recorded"', () => {
    const old = contentSchema('delivery', { pcpndt: false }).parse({ deliveredAt: '2026-09-01T05:30:00.000Z', mode: 'lscs', bloodLossMl: 700, babies: [{ outcome: 'live', sex: 'male', apgar1: 8, apgar5: 9 }] });
    expect(old.pph).toBe('');
    expect(old.babies[0]).toMatchObject({ outcome: 'live', stillbirthType: '', breastfedWithinHour: '', nicu: '' });
  });
});

describe("a baby's care after birth (NICU or SNCU stay, feeding at discharge)", () => {
  it('recorded by the doctor or an RMO on a baby’s record only; nurses and reception cannot change it, and reception does not see it', async () => {
    const b = await baby();
    expect((await view('drA', b)).newbornCare).toEqual({ nicu: { admitted: '', from: null, to: null }, feedingAtDischarge: '' }); // not recorded
    const care = { nicu: { admitted: 'yes', from: '2026-10-01', to: '2026-10-05' }, feedingAtDischarge: 'exclusive' };
    for (const who of ['nurse', 'reception']) expect((await patch(who, b, { newbornCare: care })).status, who).toBe(403);
    expect((await patch('drB', b, { newbornCare: care })).status).toBe(403); // another doctor's patient
    expect((await (await as('otherDr')).patch(`/api/patients/${b.id}`).send({ newbornCare: care })).status).toBe(404);
    const res = await patch('drA', b, { newbornCare: care });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await view('drA', b)).newbornCare).toEqual({ nicu: { admitted: 'yes', from: '2026-10-01T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' }, feedingAtDischarge: 'exclusive' });
    expect(await view('nurse', b)).toHaveProperty('newbornCare');
    expect(await view('reception', b)).not.toHaveProperty('newbornCare');
    // The audit entry names the section that changed – never its parts (NICU dates would say the baby was in the
    // NICU) nor what they say
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'PATIENT_UPDATED', 'details.patientId': b.id }).sort({ _id: -1 }).lean();
    expect(entry.details.fields).toEqual(['newbornCare']);
    expect(JSON.stringify(entry.details)).not.toMatch(/exclusive|2026-10-05|nicu/i);

    // A part sent alone leaves the rest as it was; an RMO may change it
    expect((await patch('rmo', b, { newbornCare: { feedingAtDischarge: 'partial' } })).status).toBe(200);
    expect((await view('drA', b)).newbornCare).toMatchObject({ nicu: { admitted: 'yes', from: '2026-10-01T00:00:00.000Z' }, feedingAtDischarge: 'partial' });
    // "Not admitted": the dates of a stay go
    expect((await patch('drA', b, { newbornCare: { nicu: { admitted: 'no', from: '2026-10-01', to: null } } })).status).toBe(200);
    expect((await view('drA', b)).newbornCare.nicu).toEqual({ admitted: 'no', from: null, to: null });
  });

  it('checks the dates of the stay: not before the birth, not in the future, not the wrong way round', async () => {
    const b = await baby();
    const fields = async (nicu) => (await patch('drA', b, { newbornCare: { nicu: { admitted: 'yes', ...nicu } } })).body.error?.fields;
    expect(await fields({ from: '2026-09-30' })).toEqual({ 'newbornCare.nicu.from': 'The date cannot be before the day of birth.' });
    expect(await fields({ from: '2026-10-10' })).toEqual({ 'newbornCare.nicu.from': 'The date cannot be in the future.' });
    expect(await fields({ from: '2026-10-04', to: '2026-10-02' })).toEqual({ 'newbornCare.nicu.to': 'The discharge from the unit cannot be before the admission to it.' });
    expect(await fields({ to: '2026-10-02' })).toEqual({ 'newbornCare.nicu.from': 'Enter the day the baby was admitted to the unit.' });
    expect(Object.keys((await patch('drA', b, { newbornCare: { nicu: { admitted: 'maybe' } } })).body.error.fields)).toEqual(['newbornCare.nicu.admitted']);
    expect(Object.keys((await patch('drA', b, { newbornCare: { feedingAtDischarge: 'some' } })).body.error.fields)).toEqual(['newbornCare.feedingAtDischarge']);
    // Still in the unit: no discharge date yet
    expect((await patch('drA', b, { newbornCare: { nicu: { admitted: 'yes', from: '2026-10-02' } } })).status).toBe(200);
  });

  it("is only for a baby's record", async () => {
    const p = await registered({ careType: 'postnatal', pregnancy: undefined });
    const res = await patch('drA', p, { newbornCare: { feedingAtDischarge: 'exclusive' } });
    expect([res.status, res.body.error.message]).toEqual([400, "NICU or SNCU admission and feeding at discharge are recorded only on a baby's record."]);
    expect(await view('drA', p)).not.toHaveProperty('newbornCare');
  });

  it('a record from before these fields reads as "not recorded", and can be saved', async () => {
    const b = await baby();
    await Patient.collection.updateOne({ _id: (await Patient.findOne({ tenantId: hospital._id, mrn: b.mrn }))._id }, { $unset: { newbornCare: '' } });
    expect((await view('drA', b)).newbornCare).toEqual({ nicu: { admitted: '', from: null, to: null }, feedingAtDischarge: '' });
    expect((await patch('drA', b, { fullName: 'Baby Outcome Renamed' })).status).toBe(200);
    expect((await patch('drA', b, { newbornCare: { feedingAtDischarge: 'none' } })).status).toBe(200);
  });
});

describe('the monthly report', () => {
  const report = async (month = '2026-10') => (await (await as('drA')).get(`/api/analytics/report/monthly?month=${month}`)).body;
  const valueOf = (body, key) => body.sections.flatMap((s) => s.rows).find((r) => r.key === key)?.value;
  const close = async (p, body) => expect((await (await as('drA')).put(`/api/patients/${p.id}/death`).send({ confirmed: true, ...body })).status).toBe(200);

  it('takes stillbirths (fresh or macerated) from the delivery notes, and newborn and maternal deaths from the deaths recorded on the records', async () => {
    // Two deliveries in October: a live baby and a fresh stillbirth (twins), and a macerated stillbirth; one older
    // note with a stillbirth whose kind is not recorded
    const m1 = await registered({ fullName: 'Mother One' });
    const m2 = await registered({ fullName: 'Mother Two' });
    const m3 = await registered({ fullName: 'Mother Three' });
    await delivered(m1, { deliveredAt: '2026-10-02T05:30:00.000Z', mode: 'normal', babies: [{ outcome: 'live', sex: 'female', breastfedWithinHour: 'yes', nicu: 'no' }, { outcome: 'stillbirth', stillbirthType: 'fresh' }] }, '2026-10-02T02:00:00.000Z');
    await delivered(m2, { deliveredAt: '2026-10-03T05:30:00.000Z', mode: 'lscs', indication: 'Sample indication', babies: [{ outcome: 'stillbirth', stillbirthType: 'macerated' }] }, '2026-10-03T02:00:00.000Z');
    await delivered(m3, { deliveredAt: '2026-10-04T05:30:00.000Z', mode: 'normal', babies: [{ outcome: 'stillbirth' }] }, '2026-10-04T02:00:00.000Z');

    // Deaths recorded in October: babies dying on day 0, day 2 (here) and at 30 days; maternal deaths; another death;
    // and one in September (not counted in October)
    const day0 = await baby({ fullName: 'Baby Day Zero', newborn: { birthAt: '2026-10-06T04:00:00.000Z', sex: 'male' } });
    const day2 = await baby({ fullName: 'Baby Day Two', newborn: { birthAt: '2026-10-02T04:00:00.000Z', sex: 'female' } });
    const older = await baby({ fullName: 'Baby Older', newborn: { birthAt: '2026-09-01T04:00:00.000Z', sex: 'female' } });
    const september = await baby({ fullName: 'Baby September', newborn: { birthAt: '2026-09-20T04:00:00.000Z', sex: 'male' } });
    await close(day0, { on: '2026-10-06', place: 'here' });
    await close(day2, { on: '2026-10-04', place: 'here' });
    await close(older, { on: '2026-10-01', place: 'elsewhere' });
    await close(september, { on: '2026-09-25', place: 'elsewhere' });
    await close(m1, { on: '2026-10-03', timing: 'delivery' });
    await close(await registered({ fullName: 'Mother Four' }), { on: '2026-10-05', timing: 'pregnancy' });
    await close(await registered({ fullName: 'Woman Other', careType: 'gynaecology', pregnancy: undefined }), { on: '2026-10-07', timing: 'other' });

    const body = await report();
    const values = (keys) => keys.map((k) => valueOf(body, k));
    expect(values(['live_births', 'still_births', 'still_fresh', 'still_macerated', 'still_kind_not_recorded'])).toEqual([1, 3, 1, 1, 1]);
    expect(values(['newborn_deaths', 'newborn_deaths_early', 'newborn_deaths_day0', 'newborn_deaths_here', 'baby_deaths_later', 'baby_deaths_age_unknown'])).toEqual([2, 2, 1, 2, 1, 0]);
    expect(values(['maternal_deaths', 'maternal_pregnancy', 'maternal_delivery', 'maternal_postpartum', 'other_deaths'])).toEqual([2, 1, 1, 0, 1]);
    expect(body.sections.at(-1)).toMatchObject({ key: 'deaths', title: 'Deaths (recorded on the records by a doctor)' });
    expect(body.notes).toContain('Stillbirths come from confirmed delivery notes; deaths from the deaths a doctor recorded on the records, by the day of death.');
    expect(valueOf(await report('2026-09'), 'newborn_deaths')).toBe(1);

    // A death recorded in error and undone is not counted any more
    expect((await (await as('drA')).post(`/api/patients/${day0.id}/death/undo`).send({ reason: 'Recorded on the wrong baby' })).status).toBe(200);
    expect(valueOf(await report(), 'newborn_deaths')).toBe(1);
  });
});
