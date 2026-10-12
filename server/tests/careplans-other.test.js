// Care plans for the other types of care (Version 2): postnatal from the delivery, newborn from the birth, and
// gynaecology / infertility started by a doctor or RMO.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z'); // hospital today: 1 Oct 2026
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };
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
  hospital = await createTenant('Other Plans Hospital');
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
const register = async (fields) => {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ assignedDoctor: people.drA._id.toString(), ...fields }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
};
const plan = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}/care-plan`)).body;
const item = (view, key) => view.plan.items.find((i) => i.key === key);
const day = (iso) => String(iso).slice(0, 10);

describe('care plans for the other types of care', () => {
  it('every type of care has a draft standard template; antenatal templates stay within 44 weeks', async () => {
    const std = await CarePlanTemplate.find({ tenantId: hospital._id, kind: 'standard' }).lean();
    expect(std.map((t) => t.careType).sort()).toEqual(['abortion', 'antenatal', 'gynaecology', 'infertility', 'newborn', 'postnatal']);
    expect(std.every((t) => t.status === 'draft')).toBe(true);
    const ante = std.find((t) => t.careType === 'antenatal');
    const body = (await (await as('drA')).get(`/api/care-plans/templates/${ante._id}`)).body.template;
    const items = body.items.map((it, i) => (i === 1 ? { ...it, fromWeek: 50, toWeek: 52 } : it));
    const res = await (await as('drA')).put(`/api/care-plans/templates/${ante._id}`).send({ version: body.version, name: body.name, description: body.description, sources: body.sources, items: items.map(({ key, kind, name, patientText, atBooking, fromWeek, toWeek, after, appliesWhen, source }) => ({ key, kind, name, patientText, atBooking, fromWeek, toWeek, after, appliesWhen, source })) });
    expect(res.status).toBe(400);
    expect(Object.values(res.body.error.fields).join()).toMatch(/at most 44/);
  });

  it('a newborn’s plan starts by itself from the birth: the vaccines at 6 weeks fall 6 weeks after birth', async () => {
    const baby = await register({ careType: 'newborn', fullName: 'Baby of Sample', ageYears: undefined, newborn: { birthAt: '2026-09-20T04:00:00.000Z', birthWeightGrams: 3000, sex: 'female' } });
    const view = await plan('nurse', baby);
    expect(view.plan).toMatchObject({ careType: 'newborn' });
    expect(day(item(view, 'nb_vacc_6w').window.from)).toBe('2026-11-01'); // 20 Sep + 42 days
    expect(day(item(view, 'nb_vacc_birth').window.from)).toBe('2026-09-20');
    // An item added by the doctor may be timed beyond 43 weeks (a baby's plan runs for years)
    const added = await (await as('drA')).post(`/api/patients/${baby.id}/care-plan/items`).send({
      clientRequestId: randomUUID(), kind: 'visit', name: 'Growth review at 15 months', reason: 'Sample reason for the item', timing: { type: 'weeks', fromWeek: 60, toWeek: 66 },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(view.plan.postDates).toBe(false);
  });

  it('a plan a doctor closed is not built again by itself (it can be reopened); a corrected birth day does not bring it back', async () => {
    const baby = await register({ careType: 'newborn', fullName: 'Baby of Sample', ageYears: undefined, newborn: { birthAt: '2026-10-01T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female' } });
    const first = (await plan('drA', baby)).plan;
    expect(first).toMatchObject({ careType: 'newborn', status: 'active' });
    expect((await (await as('drA')).post(`/api/patients/${baby.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    // Opening the record or the Care plan tab again builds nothing new
    expect((await (await as('nurse')).get(`/api/patients/${baby.id}`)).body.patient.carePlanSummary).toMatchObject({ exists: false, earlierCount: 1, lastClosed: { reason: 'care_elsewhere' } });
    const closed = await plan('drA', baby);
    expect(closed.plan).toBeNull();
    expect(closed.earlierPlans.map((e) => [e.id, e.status])).toEqual([[first.id, 'closed']]);
    // The day of birth corrected by a day: still the same baby's closed plan
    expect((await (await as('drA')).patch(`/api/patients/${baby.id}`).send({ newborn: { birthAt: '2026-09-30T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female' } })).status).toBe(200);
    expect((await plan('drA', baby)).plan).toBeNull();
    expect(await plan('drA', baby)).toMatchObject({ plan: null, reason: null });
    // The way back: Reopen
    const reopened = await (await as('drA')).post(`/api/patients/${baby.id}/care-plan/reopen`).send({ planId: first.id });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body.plan).toMatchObject({ id: first.id, status: 'active' });
  });

  it('postnatal: no plan until the delivery is recorded; then counted from the delivery, with the caesarean wound check', async () => {
    const p = await register({ careType: 'antenatal', fullName: 'Postnatal Mother', pregnancy: { scanEdd: '2026-10-05' }, medical: { allergies: 'None known', bloodGroup: 'O+' } });
    expect((await plan('drA', p)).plan.careType).toBe('antenatal');
    // Delivered (confirmed delivery note) on 28 Sep by caesarean
    const a = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-09-27T02:00:00.000Z', reason: 'In labour' })).body.admission;
    const d = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
    const saved = (await (await as('rmo')).put(`/api/patients/${p.id}/admissions/${a.id}/documents/${d.id}`).send({ rev: 0, content: { deliveredAt: '2026-09-28T05:00:00.000Z', mode: 'lscs', indication: 'Fetal distress', babies: [{ outcome: 'live', sex: 'male', weightGrams: 3100 }] } })).body.document;
    expect((await (await as('drA')).post(`/api/patients/${p.id}/admissions/${a.id}/documents/${d.id}/sign`).send({ rev: saved.rev })).status).toBe(200);

    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ careType: 'postnatal' })).status).toBe(200);
    const view = await plan('drA', p);
    expect(view.plan.careType).toBe('postnatal');
    expect(day(item(view, 'pnc_wk6').window.from)).toBe('2026-11-09'); // 28 Sep + 42 days
    expect(item(view, 'pnc_cs_wound').applies).not.toBe('no'); // a caesarean delivery
    expect(item(view, 'pnc_antid').applies).toBe('no'); // O positive
    expect(view.earlierPlans.map((e) => [e.careType, e.status])).toEqual([['antenatal', 'paused']]);
  });

  it('a closed postnatal plan stays closed for a mother whose antenatal plan is paused, and can be reopened', async () => {
    const p = await register({ careType: 'antenatal', fullName: 'Postnatal Mother', pregnancy: { scanEdd: '2026-10-05' }, medical: { allergies: 'None known', bloodGroup: 'O+' } });
    const antenatal = (await plan('drA', p)).plan;
    expect(antenatal.careType).toBe('antenatal');
    // Delivered on 28 Sep (a delivery at another hospital, entered by the doctor): the postnatal plan starts by itself
    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ careType: 'postnatal' })).status).toBe(200);
    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-09-28', mode: 'normal' } })).status).toBe(200);
    const postnatal = (await plan('drA', p)).plan;
    expect(postnatal).toMatchObject({ careType: 'postnatal', status: 'active' });

    expect((await (await as('drA')).post(`/api/patients/${p.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    // No current plan now: NOT the paused antenatal plan in its place, and no new postnatal plan built by itself
    const closed = await plan('drA', p);
    expect(closed).toMatchObject({ plan: null, reason: null });
    expect(closed.earlierPlans.map((e) => [e.careType, e.status]).sort()).toEqual([['antenatal', 'paused'], ['postnatal', 'closed']]);
    expect((await (await as('nurse')).get(`/api/patients/${p.id}`)).body.patient.carePlanSummary).toMatchObject({ exists: false, earlierCount: 1, lastClosed: { reason: 'care_elsewhere' } });
    // A second Close has nothing to close – it must never close the antenatal plan instead
    expect((await (await as('drA')).post(`/api/patients/${p.id}/care-plan/close`).send({ reason: 'transferred_out' })).status).toBe(409);
    expect((await plan('drA', p)).earlierPlans.find((e) => e.careType === 'antenatal').status).toBe('paused');
    // The closed plan, opened from Earlier plans, offers Reopen – and Reopen works
    const earlier = (await (await as('drA')).get(`/api/patients/${p.id}/care-plan?planId=${postnatal.id}`)).body.plan;
    expect(earlier).toMatchObject({ id: postnatal.id, canReopen: true });
    const reopened = await (await as('drA')).post(`/api/patients/${p.id}/care-plan/reopen`).send({ planId: postnatal.id });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body.plan).toMatchObject({ id: postnatal.id, careType: 'postnatal', status: 'active' });
    expect((await plan('drA', p)).plan).toMatchObject({ id: postnatal.id, careType: 'postnatal', status: 'active' });
  });

  it('a closed gynaecology plan can be reopened although a paused antenatal plan from before is still there', async () => {
    const p = await register({ careType: 'antenatal', fullName: 'Gynae After Pregnancy', pregnancy: { scanEdd: '2026-12-01' }, medical: { allergies: 'None known' } });
    expect((await plan('drA', p)).plan.careType).toBe('antenatal');
    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ careType: 'gynaecology' })).status).toBe(200);
    const started = await (await as('drA')).post(`/api/patients/${p.id}/care-plan/start`);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect((await (await as('drA')).post(`/api/patients/${p.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    const reopened = await (await as('drA')).post(`/api/patients/${p.id}/care-plan/reopen`).send({ planId: started.body.plan.id });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body.plan).toMatchObject({ id: started.body.plan.id, careType: 'gynaecology', status: 'active' });
  });

  it('gynaecology: a doctor or RMO starts the plan (counted from today); nurses can’t; once only', async () => {
    const p = await register({ careType: 'gynaecology', fullName: 'Gynae Patient', medical: { allergies: 'None known' } });
    expect(await plan('drA', p)).toMatchObject({ plan: null, reason: 'not_started' });
    expect((await (await as('nurse')).post(`/api/patients/${p.id}/care-plan/start`)).status).toBe(403);
    const res = await (await as('rmo')).post(`/api/patients/${p.id}/care-plan/start`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.plan.careType).toBe('gynaecology');
    expect(day(res.body.plan.items.find((i) => i.key === 'gyn_first').window.from)).toBe('2026-10-01');
    expect(day(res.body.plan.items.find((i) => i.key === 'gyn_annual').window.from)).toBe('2027-09-30'); // 52 weeks after 1 Oct 2026
    expect((await (await as('drA')).post(`/api/patients/${p.id}/care-plan/start`)).status).toBe(409);
    const antenatal = await register({ careType: 'antenatal', fullName: 'Pregnant', pregnancy: { scanEdd: '2027-01-01' } });
    expect((await (await as('drA')).post(`/api/patients/${antenatal.id}/care-plan/start`)).status).toBe(400);
    const mother = await register({ careType: 'postnatal', fullName: 'Delivered Elsewhere', medical: { allergies: 'None known' } });
    expect(await plan('drA', mother)).toMatchObject({ plan: null, reason: 'no_delivery' });
    // Abortion (pregnancy loss): the plan starts by itself from the date seen, once the type of loss is entered
    // (pregnancy-loss-care.test.js) – never by hand
    const loss = await register({ careType: 'abortion', fullName: 'Loss Sample', medical: { allergies: 'None known' } });
    expect(await plan('drA', loss)).toMatchObject({ plan: null, reason: 'no_loss_details' });
    expect((await (await as('rmo')).post(`/api/patients/${loss.id}/care-plan/start`)).status).toBe(400);
  });
});

describe('a delivery at another hospital', () => {
  it('a doctor enters the date and mode; the postnatal plan starts from it; nurses and future dates are refused', async () => {
    const p = await register({ careType: 'postnatal', fullName: 'Delivered Elsewhere', medical: { allergies: 'None known' } });
    expect((await (await as('nurse')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-09-25', mode: 'normal' } })).status).toBe(403);
    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-10-05', mode: 'normal' } })).status).toBe(400);
    const res = await (await as('drA')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-09-25', mode: 'lscs' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.patient.lastDelivery).toMatchObject({ mode: 'lscs', documentId: null });
    const view = await plan('drA', p);
    expect(view.plan).toMatchObject({ careType: 'postnatal', startWord: 'delivery' });
    expect(day(item(view, 'pnc_wk6').window.from)).toBe('2026-11-06'); // 25 Sep + 42 days
    expect(item(view, 'pnc_cs_wound').applies).not.toBe('no');
    const other = await register({ careType: 'gynaecology', fullName: 'Not Postnatal', medical: { allergies: 'None known' } });
    expect((await (await as('drA')).patch(`/api/patients/${other.id}`).send({ delivery: { on: '2026-09-25', mode: 'normal' } })).status).toBe(400);
  });
});

describe('postnatal checks after findings in the pregnancy', () => {
  const standard = () => CarePlanTemplate.findOne({ tenantId: hospital._id, careType: 'postnatal', kind: 'standard' });
  const condition = (t, key) => t.items.find((i) => i.key === key)?.appliesWhen;
  // The postnatal template as hospitals had it before: the two checks only for the conditions she had before pregnancy.
  async function asBefore(set = {}) {
    const t = await standard();
    await CarePlanTemplate.collection.updateOne({ _id: t._id, 'items.key': 'pnc_bp' }, { $set: { 'items.$.appliesWhen': 'hypertension' } });
    await CarePlanTemplate.collection.updateOne({ _id: t._id, 'items.key': 'pnc_sugar' }, { $set: { 'items.$.appliesWhen': 'diabetes', builtInAdditions: [], ...set } });
    resetApprovalBackfill();
    return standard();
  }

  it('GDM and high blood pressure ticked in the pregnancy switch on the sugar test and the BP check after delivery', async () => {
    const p = await register({ careType: 'antenatal', fullName: 'Findings Mother', pregnancy: { scanEdd: '2026-10-05' }, medical: { allergies: 'None known', bloodGroup: 'O+', conditionsReviewed: true } });
    for (const key of ['gdm', 'hypertension']) expect((await (await as('drA')).post(`/api/patients/${p.id}/pregnancy-findings`).send({ key, present: true })).status).toBe(200);
    // delivered elsewhere on 25 Sep; her care is postnatal now
    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ careType: 'postnatal' })).status).toBe(200);
    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-09-25', mode: 'normal' } })).status).toBe(200);
    const view = await plan('drA', p);
    expect(view.plan.careType).toBe('postnatal');
    expect(item(view, 'pnc_sugar')).toMatchObject({ applies: 'yes', appliesWhen: 'diabetes_any' });
    expect(item(view, 'pnc_bp')).toMatchObject({ applies: 'yes', appliesWhen: 'hypertension_any' });
    expect(view.plan.findingsWithoutItems).toEqual([]);

    // a mother without those findings: neither applies, and the reason says for whom they are
    const other = await register({ careType: 'postnatal', fullName: 'No Findings Mother', medical: { allergies: 'None known', conditionsReviewed: true } });
    expect((await (await as('drA')).patch(`/api/patients/${other.id}`).send({ delivery: { on: '2026-09-25', mode: 'normal' } })).status).toBe(200);
    const none = await plan('drA', other);
    expect(item(none, 'pnc_sugar')).toMatchObject({ status: 'not_applicable', why: 'only_diabetes_any' });
    expect(item(none, 'pnc_bp')).toMatchObject({ status: 'not_applicable', why: 'only_hypertension_any' });
  });

  it('a new hospital starts with them; an untouched older draft gets the change by itself, once, audited', async () => {
    const fresh = await standard();
    expect([condition(fresh, 'pnc_bp'), condition(fresh, 'pnc_sugar'), fresh.builtInAdditions]).toEqual(['hypertension_any', 'diabetes_any', ['postnatal_after_findings']]);
    expect((await (await as('drA')).get(`/api/care-plans/templates/${fresh._id}`)).body.template.builtInUpdates).toBeNull();

    const before = await asBefore();
    await ensureStandardTemplates(hospital._id);
    const t = await standard();
    expect(t).toMatchObject({ status: 'draft', version: before.version + 1, updatedByName: 'Built-in items updated', builtInAdditions: ['postnatal_after_findings'] });
    expect([condition(t, 'pnc_bp'), condition(t, 'pnc_sugar')]).toEqual(['hypertension_any', 'diabetes_any']);
    expect(t.items.map((i) => i.key)).toEqual(before.items.map((i) => i.key)); // nothing added or removed
    expect(await AuditLog.findOne({ action: 'TEMPLATE_UPDATED' })).toMatchObject({ actorEmail: 'system (built-in rules)', details: { version: t.version, note: 'Built-in items updated' } });
    resetApprovalBackfill();
    await ensureStandardTemplates(hospital._id);
    expect((await standard()).version).toBe(t.version);
    expect(await AuditLog.countDocuments({ action: 'TEMPLATE_UPDATED' })).toBe(1);
  });

  it('an approved template, or one a doctor edited, is not changed by itself: its page offers the change and a doctor accepts it', async () => {
    const before = await asBefore({ status: 'approved', approvedVersion: 1, approvedByName: 'Sample drA', approvedAt: NOW, approvals: [] });
    for (let i = 0; i < 2; i += 1) {
      resetApprovalBackfill();
      await ensureStandardTemplates(hospital._id);
    }
    let t = await standard();
    expect(t).toMatchObject({ status: 'approved', version: before.version, builtInAdditions: [] });
    expect([condition(t, 'pnc_bp'), condition(t, 'pnc_sugar')]).toEqual(['hypertension', 'diabetes']);
    expect(await AuditLog.countDocuments({ action: 'TEMPLATE_UPDATED' })).toBe(0);

    const url = `/api/care-plans/templates/${t._id}`;
    const offered = (await (await as('drA')).get(url)).body.template;
    expect(offered.builtInUpdates).toEqual({
      items: [],
      riskRules: [],
      changes: [
        { name: 'BP check within the first week (hypertension)', from: 'hypertension', to: 'hypertension_any' },
        { name: 'Blood sugar review (diabetes)', from: 'diabetes', to: 'diabetes_any' },
      ],
    });
    expect((await (await as('rmo')).post(`${url}/built-in`).send({ version: offered.version })).status).toBe(403);
    const added = await (await as('drA')).post(`${url}/built-in`).send({ version: offered.version });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body).toMatchObject({ added: { items: 0, riskRules: 0, changes: 2 }, template: { status: 'draft', version: offered.version + 1, updatedByName: 'Sample drA', builtInUpdates: null } });
    t = await standard();
    expect([condition(t, 'pnc_bp'), condition(t, 'pnc_sugar')]).toEqual(['hypertension_any', 'diabetes_any']);
    expect(t.approvals).toHaveLength(1); // the earlier approval stays on record

    // Never approved, but a doctor changed an item: left alone too. What the doctor already changed is not offered.
    const edited = await asBefore({ status: 'draft', approvedVersion: null, approvals: [], updatedByName: 'Built-in items added' });
    await CarePlanTemplate.collection.updateOne({ _id: edited._id, 'items.key': 'pnc_bp' }, { $set: { 'items.$.appliesWhen': 'always' } });
    for (let i = 0; i < 2; i += 1) {
      resetApprovalBackfill();
      await ensureStandardTemplates(hospital._id);
    }
    t = await standard();
    expect([condition(t, 'pnc_bp'), condition(t, 'pnc_sugar'), t.version]).toEqual(['always', 'diabetes', edited.version]);
    expect((await (await as('drA')).get(url)).body.template.builtInUpdates.changes).toEqual([{ name: 'Blood sugar review (diabetes)', from: 'diabetes', to: 'diabetes_any' }]);
  });
});

describe('newborn tests in the newborn care plan', () => {
  const NB_TESTS = ['nb_lab_screening', 'nb_cchd', 'nb_hearing'];
  const standard = () => CarePlanTemplate.findOne({ tenantId: hospital._id, careType: 'newborn', kind: 'standard' });

  it('a new hospital starts with them, and they are not added twice', async () => {
    const t = await standard();
    expect(NB_TESTS.every((k) => t.items.some((i) => i.key === k && i.kind === 'investigation'))).toBe(true);
    expect(t.builtInAdditions).toEqual(['newborn_tests']);
    resetApprovalBackfill();
    await ensureStandardTemplates(hospital._id);
    expect((await standard()).version).toBe(t.version);
  });

  it('an existing template gets them once, as a new draft version; removed by a doctor, they stay removed', async () => {
    // As a hospital whose newborn template was approved before these items existed
    await CarePlanTemplate.updateOne(
      { _id: (await standard())._id, tenantId: hospital._id },
      { $pull: { items: { key: { $in: NB_TESTS } } }, $set: { builtInAdditions: [], status: 'approved', version: 3 } },
    );
    resetApprovalBackfill();
    await ensureStandardTemplates(hospital._id);
    const t = await standard();
    expect(NB_TESTS.every((k) => t.items.some((i) => i.key === k))).toBe(true);
    expect(t).toMatchObject({ status: 'draft', version: 4, builtInAdditions: ['newborn_tests'], updatedByName: 'Built-in items added' });

    await CarePlanTemplate.updateOne({ _id: t._id, tenantId: hospital._id }, { $pull: { items: { key: 'nb_hearing' } } });
    resetApprovalBackfill();
    await ensureStandardTemplates(hospital._id);
    expect((await standard()).items.some((i) => i.key === 'nb_hearing')).toBe(false);
  });
});
