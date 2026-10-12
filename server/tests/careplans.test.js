// Feature 7 (2/3): patients' care plans through the API – tests 15–30 of the Feature 7 specification (§14.2).
// Fake data only. Time is pinned (Date only, so database and HTTP timers keep working): 28 Sep 2026, 11:30 in
// India. The sample patient's scan EDD is 1 Mar 2027, so she is 18 w 0 d today (day 0 = 25 May 2026).
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { syncPlan } from '../src/careplans/plansService.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { Patient } from '../src/models/Patient.js';
import { PCPNDT_MESSAGE } from '../src/utils/pcpndt.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // 11:30 in India
const EDD = '2027-03-01';
const DRAFT_LABEL = 'Draft – not approved for clinical use';
const iso = (v) => (v == null ? null : new Date(v).toISOString().slice(0, 10));
const isMidnight = (v) => v instanceof Date && v.toISOString().endsWith('T00:00:00.000Z');

const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };
const NAMES = { drA: 'Dr A', drB: 'Dr B', rmo: 'RMO Sample', nurse: 'Nurse Sample', reception: 'Reception Sample', lab: 'Lab Sample', admin: 'Admin Sample' };

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
  app = createApp(); // a new app per test: its rate limiter starts from zero
  hospital = await createTenant('Care Plan Hospital');
  other = await createTenant('Other Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: NAMES[key] });
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

// ---------- Helpers ----------

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));

// A fake antenatal patient, assigned to Dr A, with complete low-risk details.
const antenatal = (overrides = {}) =>
  samplePatient({
    careType: 'antenatal',
    fullName: 'Sample Mother',
    ageYears: 28,
    assignedDoctor: people.drA._id.toString(),
    pregnancy: { scanEdd: EDD },
    obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
    medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
    ...overrides,
  });

async function register(who = 'drA', overrides = {}) {
  const res = await (await as(who)).post('/api/patients').send(antenatal(overrides));
  expect(res.status).toBe(201);
  return res.body.patient;
}

// A patient saved straight into the database (as if registered before Feature 7): no plan yet.
let seq = 0;
async function insertPatient(overrides = {}) {
  seq += 1;
  const p = await Patient.create({
    tenantId: hospital._id,
    mrn: `P-9${String(seq).padStart(5, '0')}`,
    careType: 'antenatal',
    fullName: 'Legacy Mother',
    ageYears: 28,
    ageRecordedOn: NOW,
    pregnancy: { scanEdd: new Date(`${EDD}T00:00:00Z`) },
    obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
    medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
    assignedDoctor: people.drA._id,
    createdBy: people.drA._id,
    ...overrides,
  });
  return { id: String(p._id), mrn: p.mrn };
}

const url = (p, path = '') => `/api/patients/${p.id}/care-plan${path}`;
const getPlan = async (who, p, query = '') => (await as(who)).get(url(p) + query);
async function planOf(who, p) {
  const res = await getPlan(who, p);
  expect(res.status).toBe(200);
  return res.body.plan;
}
const item = (plan, key) => plan.items.find((i) => i.key === key);
const act = async (who, p, it, body) => (await as(who)).patch(url(p, `/items/${it.id}`)).send({ rev: it.rev, ...body });
const send = async (who, method, p, path, body) => (await as(who))[method](url(p, path)).send(body);
const done = (on = '2026-09-28', extra = {}) => ({ action: 'done', on, ...extra });

async function patchPatient(who, p, body) {
  const res = await (await as(who)).patch(`/api/patients/${p.id}`).send(body);
  expect(res.status).toBe(200);
  return res.body.patient;
}
const viewPatient = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;

const storedPlans = (p) => CarePlan.find({ tenantId: hospital._id, patientId: p.id }).sort({ _id: 1 });
const currentStored = (p) => CarePlan.findOne({ tenantId: hospital._id, patientId: p.id, current: true });
const storedItem = async (p, key) => (await currentStored(p)).items.find((i) => i.key === key);
const standard = (tenant = hospital) => CarePlanTemplate.findOne({ tenantId: tenant._id, careType: 'antenatal', kind: 'standard' });
const approve = async (who, t) => (await as(who)).post(`/api/care-plans/templates/${t._id}/approve`).send({ confirm: true, version: t.version });
const templateBody = (t, change = {}) => ({
  version: t.version, // the version the person edited
  name: t.name,
  description: t.description,
  sources: t.sources,
  items: t.items.map((i) => i.toObject()),
  riskRules: t.riskRules.map((r) => r.toObject()),
  ...change,
});
const carePlanAudits = (action) => AuditLog.find(action ? { action } : { action: /^CARE_PLAN_/ }).sort({ _id: 1 }).lean(); // in the order written (natural order is not guaranteed)

// PlanView is whitelisted by hand (§10.2): no staff ids, no basis, no revByName, nothing internal.
// `auto`, the template id and plan ids are sent on purpose, so they are not listed here.
const HIDDEN_KEYS = /"(by|visitId|revByName|revAt|basis|patientVersion|engineVersion|tenantId|createdBy|chosenBy|bookedOnSetBy|staffBasis|clientRequestId|_id|__v)":/;
function expectNothingHidden(body) {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(HIDDEN_KEYS);
  for (const u of Object.values(people)) expect(json).not.toContain(String(u._id));
}

// ---------- 15. Smoke ----------

describe('15. smoke', () => {
  it('GET /api/patients/:id/care-plan answers 200 (the nested router reads the patient id)', async () => {
    const p = await register('rmo');
    const res = await getPlan('rmo', p);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reason: null, earlierPlans: [] });
    expect(res.body.plan).toMatchObject({ status: 'active', canEdit: true });
    expect((await (await as('rmo')).get('/api/patients/not-an-id/care-plan')).status).toBe(400);
  });
});

// ---------- 16. Creation ----------

describe('16. creation', () => {
  it('builds a Draft plan with 50 items when an RMO registers an antenatal patient with an LMP (audit: ids only)', async () => {
    const p = await register('rmo', { pregnancy: { lmp: '2026-05-25' }, assignedDoctor: null }); // 18 w 0 d today
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(1); // built by the registration
    const plan = await planOf('rmo', p);
    expect(plan.items).toHaveLength(50); // 44 routine items and 6 for findings in this pregnancy (not applicable until ticked)
    expect(plan).toMatchObject({ eddSource: 'lmp', gestationToday: { weeks: 18, days: 0 } });
    expect(iso(plan.bookedOn)).toBe('2026-09-28'); // the build date
    expect(plan.template).toMatchObject({ label: DRAFT_LABEL, approved: false, draftReason: 'content' });
    const created = await carePlanAudits('CARE_PLAN_CREATED');
    expect(created).toHaveLength(1);
    expect(Object.keys(created[0].details).sort()).toEqual(['mrn', 'patientId', 'planId']);
    expect(created[0].details).toEqual({ patientId: p.id, mrn: p.mrn, planId: plan.id });
    expect(String(created[0].actor)).toBe(String(people.rmo._id));
  });

  it('builds no plan for a reception registration without dates; the PATCH that adds an LMP builds it', async () => {
    const res = await (await as('reception')).post('/api/patients').send(samplePatient({ careType: 'antenatal', ageYears: 28 }));
    expect(res.status).toBe(201);
    const p = res.body.patient;
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(0);
    await patchPatient('drA', p, { pregnancy: { lmp: '2026-05-25', scanEdd: '' } });
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(1); // no GET needed
    const [created] = await carePlanAudits('CARE_PLAN_CREATED');
    expect(String(created.actor)).toBe(String(people.drA._id));
  });

  it('builds none for gynaecology', async () => {
    const res = await (await as('rmo')).post('/api/patients').send(samplePatient());
    const p = res.body.patient;
    const view = await getPlan('rmo', p);
    expect(view.body).toMatchObject({ plan: null, reason: 'not_started', earlierPlans: [] });
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(0);
    expect((await viewPatient('rmo', p)).carePlanSummary).toMatchObject({ exists: false, reason: 'not_started' });
  });

  it('builds the plan on first view for a patient saved before care plans existed', async () => {
    const p = await insertPatient();
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(0);
    const patient = await viewPatient('drA', p);
    expect(patient.carePlanSummary).toMatchObject({ exists: true, status: 'active', template: { label: DRAFT_LABEL } });
    expect(patient.access).toMatchObject({ canViewCarePlan: true, canEditCarePlan: true });
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(1);
    expect((await planOf('drA', p)).id).toBe(patient.carePlanSummary.planId);
  });

  it('builds exactly one plan for two first views at the same moment', async () => {
    const p = await insertPatient();
    await Promise.all([as('drA'), as('rmo')]);
    const [a, b] = await Promise.all([getPlan('drA', p), getPlan('rmo', p)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.plan.id).toBe(b.body.plan.id);
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CREATED' })).toBe(1);
  });

  it('does not build a new plan after a doctor closed the plan for this pregnancy, or closed it while on hold', async () => {
    const p = await register();
    await planOf('drA', p);
    expect((await send('drA', 'post', p, '/close', { reason: 'delivered' })).status).toBe(200);
    expect((await getPlan('drA', p)).body.plan).toBeNull();
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-03-05' } }); // same pregnancy (4 days)
    expect((await getPlan('drA', p)).body.plan).toBeNull();
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(1);

    const q = await register('drA', { pregnancy: { scanEdd: '2026-12-01' } });
    await patchPatient('drA', q, { pregnancy: { scanEdd: '2027-06-19' } }); // 200 days: on hold
    expect((await planOf('drA', q)).eddReview).toMatchObject({ toEdd: '2027-06-19T00:00:00.000Z' });
    expect((await send('drA', 'post', q, '/close', { reason: 'transferred_out' })).status).toBe(200);
    const again = await getPlan('drA', q);
    expect(again.body).toMatchObject({ plan: null, reason: null });
    expect(again.body.earlierPlans).toHaveLength(1);
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: q.id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CREATED' })).toBe(2);
  });
});

// ---------- 17. Approval ----------

describe('17. approval', () => {
  it('shows the Draft label; approving the unchanged template approves the plan without rebuilding it', async () => {
    const p = await register();
    const before = await planOf('drA', p);
    expect(before.template).toMatchObject({ label: DRAFT_LABEL, draftReason: 'content', approved: false, approvedVersion: null });
    expect((await viewPatient('drA', p)).carePlanSummary.template).toMatchObject({ label: DRAFT_LABEL, approved: false });

    expect((await approve('drA', await standard())).status).toBe(200);
    const after = await planOf('drA', p);
    expect(after.id).toBe(before.id);
    expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(after.template).toMatchObject({ label: null, draftReason: null, approved: true, approvedVersion: 1, approvedByName: 'Dr A', updateAvailable: false });
    expect((await viewPatient('drA', p)).carePlanSummary.template).toMatchObject({ label: null, approved: true, approvedVersion: 1 });
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(1);
  });

  it('keeps an approval from before Feature 7 when only the risk rules are edited (label: risk rules); approving again clears it', async () => {
    const p = await register();
    expect((await approve('drA', await standard())).status).toBe(200);
    // As if approved before approvals were recorded.
    const std = await standard();
    await CarePlanTemplate.updateOne({ _id: std._id, tenantId: hospital._id }, { $set: { approvals: [] } });
    resetApprovalBackfill();

    const legacy = await standard();
    const rules = legacy.riskRules.map((r) => ({ ...r.toObject(), label: `${r.label} (reworded)` }));
    const put = await (await as('drA')).put(`/api/care-plans/templates/${legacy._id}`).send(templateBody(legacy, { riskRules: rules }));
    expect(put.status).toBe(200);
    const edited = await standard();
    expect(edited).toMatchObject({ status: 'draft', version: 2 });
    expect(edited.approvals).toHaveLength(1); // the old approval was written down before the edit
    expect(edited.approvals[0]).toMatchObject({ version: 1 });

    const plan = await planOf('drA', p);
    expect(plan.template).toMatchObject({ approvedVersion: 1, updateAvailable: false, approved: false, draftReason: 'risk_rules', label: DRAFT_LABEL });
    expect(item(plan, 'scan_doppler').riskBased).toBe(true);
    // A doctor's risk override means the edited rules don't decide anything for this patient: no Draft label.
    await (await as('drA')).put(`/api/patients/${p.id}/risk-override`).send({ level: 'high', reason: 'Doctor judges this sample pregnancy high risk' });
    expect((await planOf('drA', p)).template).toMatchObject({ approved: true, label: null });
    await (await as('drA')).delete(`/api/patients/${p.id}/risk-override`);
    expect((await planOf('drA', p)).template).toMatchObject({ draftReason: 'risk_rules' });

    expect((await approve('drA', edited)).status).toBe(200);
    expect((await planOf('drA', p)).template).toMatchObject({ approved: true, label: null, draftReason: null });
  });

  it('offers an approved update; the preview lists the changes; applying it keeps staff data; a stale review gives 409', async () => {
    const p = await register();
    expect((await approve('drA', await standard())).status).toBe(200);
    let plan = await planOf('drA', p);
    expect((await act('drA', p, item(plan, 'lab_cbc'), done('2026-09-28', { result: 'Hb 11.2 g/dL' }))).status).toBe(200);

    const v1 = await standard();
    const items = v1.items.map((i) => i.toObject()).map((i) => (i.key === 'lab_tsh' ? { ...i, name: 'Thyroid test (TSH and free T4)' } : i));
    items.push({ key: 'lab_vitd', kind: 'investigation', name: 'Vitamin D level', atBooking: true });
    expect((await (await as('drA')).put(`/api/care-plans/templates/${v1._id}`).send(templateBody(v1, { items, version: 1 }))).status).toBe(200);
    expect((await approve('drA', await standard())).status).toBe(200);

    plan = await planOf('drA', p);
    expect(plan.template).toMatchObject({
      version: 1,
      approved: true,
      approvedVersion: 1,
      currentVersion: 2,
      updateAvailable: true,
      updateApproved: true,
      newerApprovedVersion: 2,
      newerApprovedByName: 'Dr A',
      newerApprovedAt: expect.any(String),
    });
    expect((await viewPatient('drA', p)).carePlanSummary.template).toMatchObject({ newerApprovedVersion: 2, approvedVersion: 1 });

    const preview = await (await as('drA')).get(url(p, `/template-preview?templateId=${v1._id}`));
    expect(preview.status).toBe(200);
    expect(preview.body.to).toMatchObject({ id: String(v1._id), version: 2, contentApproved: true });
    expect(preview.body.added).toEqual([expect.objectContaining({ key: 'lab_vitd', kind: 'investigation', timingText: 'At first visit' })]);
    expect(preview.body.changed).toEqual([expect.objectContaining({ itemId: item(plan, 'lab_tsh').id, fields: ['name'], keepsDoctorDate: false })]);
    expect(preview.body).toMatchObject({ kept: [], dropped: [], unchanged: 49, customKept: 0 });
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(1); // the preview is not audited

    const stale = await send('drA', 'put', p, '/template', { templateId: String(v1._id), fromItemsHash: preview.body.from.itemsHash, toItemsHash: 'a'.repeat(64) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toBe('The template or the plan changed since you reviewed the changes. Please review them again.');

    const body = { templateId: String(v1._id), fromItemsHash: preview.body.from.itemsHash, toItemsHash: preview.body.to.itemsHash };
    const applied = await send('drA', 'put', p, '/template', body);
    expect(applied.status).toBe(200);
    expect(applied.body.changed).toBe(true);
    expect(applied.body.plan.template).toMatchObject({ version: 2, approved: true, approvedVersion: 2, updateAvailable: false });
    expect(item(applied.body.plan, 'lab_cbc')).toMatchObject({ status: 'done', done: { result: 'Hb 11.2 g/dL' } });
    expect(item(applied.body.plan, 'lab_tsh').name).toBe('Thyroid test (TSH and free T4)');
    expect(item(applied.body.plan, 'lab_vitd')).toMatchObject({ status: 'due', addedOn: '2026-09-28T00:00:00.000Z' });
    expect(applied.body.plan.log[0]).toMatchObject({ action: 'template_updated', byName: 'Dr A', auto: false });
    expect((await send('drA', 'put', p, '/template', body)).body.changed).toBe(false); // already applied
  });

  it('refuses to approve when the template was saved between reading and approving', async () => {
    const std = await standard();
    const realUpdateOne = CarePlanTemplate.updateOne.bind(CarePlanTemplate);
    vi.spyOn(CarePlanTemplate, 'updateOne').mockImplementation(async (filter, update, ...rest) => {
      if (update?.$set?.status === 'approved') {
        // A doctor's edit (PUT) is saved at this moment: a new draft version.
        const t = await CarePlanTemplate.findOne({ _id: std._id, tenantId: hospital._id });
        t.name = `${t.name} (edited)`;
        t.version += 1;
        t.status = 'draft';
        await t.save();
      }
      return realUpdateOne(filter, update, ...rest);
    });
    const res = await approve('drA', std);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/now version 2/);
    expect(await standard()).toMatchObject({ status: 'draft', version: 2, approvals: [] });
  });

  it('refuses a template save based on an older version (and one that does not say which version it edited)', async () => {
    const opened = await standard(); // two doctors open version 1
    const put = async (body) => (await as('drA')).put(`/api/care-plans/templates/${opened._id}`).send(body);
    const first = await put(templateBody(opened, { name: 'Standard antenatal care (edited first)' }));
    expect(first.status).toBe(200);
    expect(first.body.template.version).toBe(2);

    const stale = await put(templateBody(opened, { name: 'Standard antenatal care (edited from the old page)' }));
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toBe('This template was changed (now version 2) after you opened it. Please reload it and make your changes again.');
    expect(await standard()).toMatchObject({ version: 2, name: 'Standard antenatal care (edited first)' });
    expect(await AuditLog.countDocuments({ action: 'TEMPLATE_UPDATED' })).toBe(1);

    const { version: _v, ...noVersion } = templateBody(await standard());
    const missing = await put(noVersion);
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.version).toBe('The template version you edited is missing – please reload the page');
  });
});

// ---------- 18. Access ----------

describe('18. access', () => {
  it("lets the RMO, the patient's own doctor and any doctor of an unassigned patient change the plan", async () => {
    const mine = await register('drA');
    const unassigned = await register('drA', { assignedDoctor: null });
    for (const [who, p] of [
      ['rmo', mine],
      ['drA', mine],
      ['drB', unassigned],
    ]) {
      const plan = await planOf(who, p);
      expect(plan).toMatchObject({ canEdit: true, canChangePlan: true, canClose: true, readOnly: false });
      const res = await act(who, p, item(plan, 'adv_diet'), { action: 'note', text: `Discussed at the desk (${who})` });
      expect(res.status).toBe(200);
      expect(item(res.body.plan, 'adv_diet').note).toMatchObject({ byName: NAMES[who] });
    }
  });

  it("lets another doctor view read-only (not change), and not see a sensitive record's plan", async () => {
    const p = await register('drA');
    const plan = await planOf('drB', p);
    expect(plan).toMatchObject({ canEdit: false, canChangePlan: false, canClose: false, readOnly: true });
    const change = await act('drB', p, item(plan, 'lab_cbc'), done());
    expect(change.status).toBe(403);
    expect(change.body.error.message).toBe("This is another doctor's patient: you can view the care plan but not change it.");
    expect((await send('drB', 'post', p, '/close', { reason: 'delivered' })).status).toBe(403);
    expect((await (await as('drB')).get(url(p, '/template-options'))).status).toBe(403);

    expect((await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    const hidden = await getPlan('drB', p);
    expect(hidden.status).toBe(403);
    expect(hidden.body.error.message).toBe('This is a sensitive record: care plans are only visible to the treating doctor and RMOs.');
    expect((await viewPatient('drB', p)).carePlanSummary).toBeUndefined();
    expect((await getPlan('rmo', p)).status).toBe(200); // RMOs see sensitive records
  });

  it('lets a nurse view read-only (results and notes too), but not a sensitive record, and not change anything', async () => {
    const p = await register('drA');
    let plan = await planOf('drA', p);
    await act('drA', p, item(plan, 'lab_cbc'), done('2026-09-28', { result: 'Hb 11.2 g/dL', note: 'Fasting sample' }));
    plan = await planOf('nurse', p);
    expect(plan).toMatchObject({ readOnly: true, canEdit: false, canClose: false });
    expect(item(plan, 'lab_cbc').done).toMatchObject({ result: 'Hb 11.2 g/dL', note: 'Fasting sample' });
    const change = await act('nurse', p, item(plan, 'lab_urine'), done());
    expect(change.status).toBe(403);
    expect(change.body.error.message).toBe("Only the patient's doctor or an RMO can change the care plan.");
    expect((await viewPatient('nurse', p)).carePlanSummary).toMatchObject({ exists: true });

    const sensitive = await register('drA', { careType: 'antenatal' });
    await (await as('drA')).patch(`/api/patients/${sensitive.id}/sensitive`).send({ sensitive: true });
    expect((await getPlan('nurse', sensitive)).status).toBe(403);
  });

  it('keeps reception, lab and admin-only staff out', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    for (const who of ['reception', 'lab']) {
      const res = await getPlan(who, p);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe("Your role doesn't include care plans.");
      expect((await act(who, p, item(plan, 'lab_cbc'), done())).status).toBe(403);
    }
    const admin = await getPlan('admin', p);
    expect(admin.status).toBe(403);
    expect(admin.body.error.message).toBe("Your role in this hospital doesn't include access to patient records.");
  });

  it("answers 404 for another hospital's patient, another patient's item, and another hospital's template", async () => {
    const p = await register('drA');
    const q = await register('drA');
    const plan = await planOf('drA', p);
    const qPlan = await planOf('drA', q);
    expect((await getPlan('outsider', p)).status).toBe(404);

    const wrongItem = await act('drA', p, item(qPlan, 'lab_cbc'), done());
    expect(wrongItem.status).toBe(404);
    expect(wrongItem.body.error.message).toBe('Item not found.');
    expect((await act('drA', p, { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', rev: 0 }, { action: 'keep' })).status).toBe(404);

    await ensureStandardTemplates(other._id);
    const theirs = await standard(other);
    expect((await (await as('drA')).get(url(p, `/template-preview?templateId=${theirs._id}`))).status).toBe(404);
    const put = await send('drA', 'put', p, '/template', { templateId: String(theirs._id), fromItemsHash: 'a'.repeat(64), toItemsHash: 'b'.repeat(64) });
    expect(put.status).toBe(404);
    expect(plan.template.id).not.toBe(String(theirs._id));
  });

  it("answers 404 for another patient's plan id (viewing an earlier plan, or reopening)", async () => {
    const a = await register('drA');
    const b = await register('drA');
    await (await as('drA')).patch(`/api/patients/${b.id}/sensitive`).send({ sensitive: true });
    const bPlan = await planOf('drA', b);
    const peek = await getPlan('nurse', a, `?planId=${bPlan.id}`);
    expect(peek.status).toBe(404);
    expect(JSON.stringify(peek.body)).not.toMatch(/lab_cbc|Complete blood count/);
    await planOf('drA', a);
    await send('drA', 'post', a, '/close', { reason: 'delivered' });
    expect((await send('drA', 'post', a, '/reopen', { planId: bPlan.id })).status).toBe(404);
  });

  it('leaves carePlanSummary out for reception and lab, and includes it for clinical viewers', async () => {
    const p = await register('drA');
    for (const who of ['reception', 'lab']) {
      const patient = await viewPatient(who, p);
      expect(patient).not.toHaveProperty('carePlanSummary');
      expect(patient.access).toMatchObject({ canViewCarePlan: false, canEditCarePlan: false });
    }
    for (const who of ['nurse', 'rmo', 'drB']) expect((await viewPatient(who, p)).carePlanSummary).toMatchObject({ exists: true });
    expect((await viewPatient('drB', p)).access).toMatchObject({ canViewCarePlan: true, canEditCarePlan: false });
  });

  it("offers and allows only the protocols this person may use (403 another doctor's, 400 empty or not antenatal)", async () => {
    const p = await register('drA');
    const unassigned = await register('drA', { assignedDoctor: null });
    const std = await standard();
    const create = async (who, body) => {
      const res = await (await as(who)).post('/api/care-plans/templates').send(body);
      expect(res.status).toBe(201);
      return res.body.template;
    };
    const aProto = await create('drA', { copyFrom: String(std._id), name: 'Dr A protocol' });
    const bProto = await create('drB', { copyFrom: String(std._id), name: 'Dr B protocol' });
    const aEmpty = await create('drA', { careType: 'antenatal', name: 'Dr A empty' });
    const aGyn = await create('drA', { careType: 'gynaecology', name: 'Dr A gynaecology' });
    const names = async (who, q) => (await (await as(who)).get(url(q, '/template-options'))).body.templates.map((t) => t.name);

    // Order: the assigned doctor's, the hospital standard, the acting doctor's own. Other doctors', empty and
    // non-antenatal protocols are left out.
    expect(await names('drA', p)).toEqual(['Dr A protocol', std.name]);
    expect(await names('rmo', p)).toEqual(['Dr A protocol', std.name]);
    expect(await names('drB', unassigned)).toEqual([std.name, 'Dr B protocol']);

    const NOT_YOURS = "You can use the hospital standard, your own protocols or the assigned doctor's protocols.";
    const preview = async (who, q, t) => (await as(who)).get(url(q, `/template-preview?templateId=${t.id}`));
    for (const [who, q] of [
      ['drA', p],
      ['rmo', p],
      ['drA', unassigned],
    ]) {
      const res = await preview(who, q, bProto);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe(NOT_YOURS);
    }
    const put = await send('drA', 'put', p, '/template', { templateId: bProto.id, fromItemsHash: 'a'.repeat(64), toItemsHash: 'b'.repeat(64) });
    expect(put.status).toBe(403);
    expect(put.body.error.message).toBe(NOT_YOURS);

    // Empty or not for antenatal care (protocols the caller may otherwise use).
    const empty = await preview('drA', p, aEmpty);
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toBe('This protocol has no items.');
    const gyn = await preview('drA', p, aGyn);
    expect(gyn.status).toBe(400);
    expect(gyn.body.error.message).toBe('This protocol is not for antenatal care.');

    // The RMO may use the assigned doctor's protocol.
    expect((await preview('rmo', p, aProto)).status).toBe(200);
  });

  it('keeps a converted infertility patient sensitive and books her on the day the plan is built', async () => {
    vi.setSystemTime(new Date('2026-09-07T06:00:00Z')); // registered for infertility care on 7 Sep 2026
    const p = await register('drA', { careType: 'infertility', pregnancy: undefined });
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(0);
    vi.setSystemTime(NOW);
    sessions.drA = null; // log in again (the session would have timed out)
    await patchPatient('drA', p, { careType: 'antenatal', pregnancy: { lmp: '2026-08-17' } }); // LMP 3 weeks before registration
    const plan = await planOf('drA', p);
    expect(iso(plan.bookedOn)).toBe('2026-09-28'); // the build date, not the registration date
    expect(plan.bookedAt).toEqual({ weeks: 6, days: 0 });
    const nurse = await getPlan('nurse', p);
    expect(nurse.status).toBe(403);
    expect(nurse.body.error.message).toBe('This is a sensitive record: care plans are only visible to the treating doctor and RMOs.');
    expect((await getPlan('drB', p)).status).toBe(403);
  });

  it('changes who may see the plan when the doctor is reassigned, but not the plan', async () => {
    const p = await register('drA');
    await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true });
    expect((await getPlan('drB', p)).status).toBe(403);
    const before = await currentStored(p);
    expect((await (await as('rmo')).patch(`/api/patients/${p.id}/doctor`).send({ doctorId: people.drB._id.toString() })).status).toBe(200);
    expect(await planOf('drB', p)).toMatchObject({ id: String(before._id), canEdit: true });
    expect((await getPlan('drA', p)).status).toBe(403);
    const after = await currentStored(p);
    expect(JSON.stringify(after.toObject().items)).toBe(JSON.stringify(before.toObject().items));
    expect(JSON.stringify(after.toObject().log)).toBe(JSON.stringify(before.toObject().log));
    expect(await storedPlans(p)).toHaveLength(1);
  });
});

// ---------- 19. Each action ----------

describe('19. each action', () => {
  it('does every item action and the plan-level changes (happy paths), including Undo', async () => {
    const p = await register('drA');
    let plan = await planOf('drA', p);

    // Done (with a result, done elsewhere), then Undo (reopen with the reason 'Undo').
    let res = await act('drA', p, item(plan, 'lab_cbc'), done('2026-09-27', { result: 'Hb 11.2 g/dL', elsewhere: true }));
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expectNothingHidden(res.body); // checked while each staff record is live (several are undone below)
    expect(item(res.body.plan, 'lab_cbc')).toMatchObject({
      status: 'done',
      rev: 1,
      done: { on: '2026-09-27T00:00:00.000Z', gaOn: { weeks: 17, days: 6 }, result: 'Hb 11.2 g/dL', elsewhere: true, via: 'manual', byName: 'Dr A' },
    });
    expect(res.body.summary).toMatchObject({ exists: true, counts: { done: 1, total: 50 } });
    res = await act('drA', p, item(res.body.plan, 'lab_cbc'), { action: 'reopen', reason: 'Undo' });
    const reopened = item(res.body.plan, 'lab_cbc');
    expect(reopened).toMatchObject({ status: 'due', done: null, rev: 2 });
    expect(reopened.history.at(-1)).toMatchObject({ action: 'reopen', reason: 'Undo', byName: 'Dr A', from: { state: 'done', done: { result: 'Hb 11.2 g/dL' } } });
    expect(JSON.stringify(reopened.history)).not.toMatch(/"by"|visitId/);

    // Not needed.
    res = await act('drA', p, item(res.body.plan, 'med_folic'), { action: 'not_needed', reasonCode: 'covered', reason: '' });
    expect(item(res.body.plan, 'med_folic')).toMatchObject({ status: 'not_needed', notNeeded: { reasonCode: 'covered', byName: 'Dr A' } });
    expectNothingHidden(res.body);

    // Move (outside the window, with a reason), then reset the date. The doctor's reason is their decision:
    // the item is marked "Outside guideline window" but is not counted as needing a decision again.
    const decisionsBefore = res.body.summary.counts.needsDecision;
    res = await act('drA', p, item(res.body.plan, 'scan_anomaly'), { action: 'move', dueFrom: '2026-10-20', reason: 'Scan machine booked' });
    expect(res.body.summary.counts.needsDecision).toBe(decisionsBefore);
    expect(item(res.body.plan, 'scan_anomaly')).toMatchObject({
      dateSource: 'manual',
      flags: ['outside_window'],
      due: { from: '2026-10-20T00:00:00.000Z', to: '2026-10-26T00:00:00.000Z' },
      manualDate: { reason: 'Scan machine booked', byName: 'Dr A' },
    });
    expectNothingHidden(res.body);
    res = await act('drA', p, item(res.body.plan, 'scan_anomaly'), { action: 'reset_date' });
    expect(item(res.body.plan, 'scan_anomaly')).toMatchObject({ dateSource: 'window', manualDate: null, flags: [], status: 'due' });

    // Include anyway (low risk: the Doppler does not apply), then remove the inclusion.
    expect(item(res.body.plan, 'scan_doppler')).toMatchObject({ status: 'not_applicable', why: 'only_high_risk' });
    res = await act('drA', p, item(res.body.plan, 'scan_doppler'), { action: 'include', reason: "Doctor's decision" });
    expect(item(res.body.plan, 'scan_doppler')).toMatchObject({ status: 'upcoming', forceInclude: { reason: "Doctor's decision", byName: 'Dr A' } });
    expectNothingHidden(res.body);
    res = await act('drA', p, item(res.body.plan, 'scan_doppler'), { action: 'remove_include' });
    expect(item(res.body.plan, 'scan_doppler')).toMatchObject({ status: 'not_applicable', forceInclude: null });

    // Note, and an empty note removes it.
    res = await act('drA', p, item(res.body.plan, 'vacc_flu'), { action: 'note', text: 'Flu season from October' });
    expect(item(res.body.plan, 'vacc_flu').note).toMatchObject({ text: 'Flu season from October', byName: 'Dr A' });
    expectNothingHidden(res.body);
    res = await act('drA', p, item(res.body.plan, 'vacc_flu'), { action: 'note', text: '' });
    expect(item(res.body.plan, 'vacc_flu').note).toBeNull();

    // A custom item.
    const custom = await send('drA', 'post', p, '/items', {
      clientRequestId: '0b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f',
      kind: 'investigation',
      name: 'Thyroid review',
      reason: 'Family history',
      timing: { type: 'weeks', fromWeek: 24, toWeek: 26 },
    });
    expect(custom.status).toBe(201);
    const added = custom.body.plan.items.find((i) => i.id === custom.body.itemId);
    expect(added).toMatchObject({ origin: 'custom', status: 'upcoming', rev: 0, addedOn: '2026-09-28T00:00:00.000Z', added: { byName: 'Dr A', reason: 'Family history' } });
    expect(custom.body.summary).toMatchObject({ exists: true });
    expectNothingHidden(custom.body);
    const dated = await send('drA', 'post', p, '/items', {
      clientRequestId: '1b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f',
      kind: 'advice',
      name: 'Travel advice',
      timing: { type: 'date', dueFrom: '2026-10-05' },
    });
    expect(dated.body.plan.items.find((i) => i.id === dated.body.itemId)).toMatchObject({ dateSource: 'fixed', due: { from: '2026-10-05T00:00:00.000Z', to: '2026-10-11T00:00:00.000Z' } });

    // The booking date.
    const booking = await send('drA', 'patch', p, '', { bookedOn: '2026-09-01', previousBookedOn: '2026-09-28' });
    expect(booking.status).toBe(200);
    expect(booking.body.plan).toMatchObject({ bookedOn: '2026-09-01T00:00:00.000Z', bookedAt: { weeks: 14, days: 1 }, bookedOnSetByName: 'Dr A' });
    expect(booking.body.plan.log[0]).toMatchObject({ action: 'booking_date', auto: false });
    expectNothingHidden(booking.body);
    expect((await send('drA', 'patch', p, '', { bookedOn: '2026-09-01', previousBookedOn: '2026-09-28' })).body.changed).toBe(false);
    expect((await send('drA', 'patch', p, '', { bookedOn: '2026-08-01', previousBookedOn: '2026-09-28' })).status).toBe(409); // someone changed it meanwhile
    expectNothingHidden((await getPlan('drA', p)).body); // history snapshots, the log and earlier plans
    expectNothingHidden((await getPlan('nurse', p)).body); // the read-only view
  });

  it('refuses invalid values with the exact messages', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    const expectField = async (res, field, message) => {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      if (message) expect(res.body.error.fields[field]).toBe(message);
      else expect(res.body.error.fields).toHaveProperty([field]);
    };
    const cbc = item(plan, 'lab_cbc');
    await expectField(await act('drA', p, cbc, done('2026-09-29')), 'on', "The date can't be in the future.");
    await expectField(await act('drA', p, cbc, done('2025-01-01')), 'on', 'This date is more than a year before this pregnancy – please check it.');
    await expectField(await act('drA', p, item(plan, 'visit_booking'), done('2026-09-28', { result: 'Fine' })), 'result', 'Results are recorded for lab tests and scans only.');
    await expectField(await act('drA', p, cbc, { action: 'not_needed', reasonCode: 'other', reason: 'no' }), 'reason', 'Please say why (at least 5 characters).');
    const anomaly = item(plan, 'scan_anomaly');
    await expectField(
      await act('drA', p, anomaly, { action: 'move', dueFrom: '2026-10-20' }),
      'reason',
      'This date is outside the guideline window (18 w 0 d – 20 w 6 d). Please give a reason.',
    );
    await expectField(await act('drA', p, anomaly, { action: 'move', dueFrom: '2026-09-01', dueBy: '2026-09-20', reason: 'Scan booked' }), 'dueBy', 'Choose a date from today onwards.');
    await expectField(
      await act('drA', p, item(plan, 'scan_growth32'), { action: 'move', dueFrom: '2027-03-15', dueBy: '2027-03-25', reason: 'After the due date' }),
      'dueBy',
      'Choose a date before 43 weeks.',
    );
    await expectField(await act('drA', p, anomaly, { action: 'move', dueFrom: '2026-10-01', dueBy: '2026-09-30', reason: 'Scan booked' }), 'dueBy', "'Due by' must be on or after 'Due from'.");
    await expectField(await act('drA', p, item(plan, 'scan_doppler'), { action: 'include' }), 'reason', 'Please say why (at least 5 characters).');
    await expectField(await act('drA', p, item(plan, 'scan_doppler'), { action: 'include', reason: 'ok' }), 'reason', 'Please say why (at least 5 characters).');
    const lateCustom = await send('drA', 'post', p, '/items', {
      clientRequestId: '2b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f',
      kind: 'scan',
      name: 'Extra scan',
      timing: { type: 'weeks', fromWeek: 44, toWeek: 44 },
    });
    await expectField(lateCustom, 'timing.toWeek', 'The window must end between today and 43 weeks.');
    // Unknown fields are refused everywhere (there is no fetal-sex field).
    const extra = await act('drA', p, cbc, done('2026-09-28', { fetalSex: 'x' }));
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('VALIDATION');
    const customExtra = await send('drA', 'post', p, '/items', {
      clientRequestId: '3b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f',
      kind: 'scan',
      name: 'Extra scan',
      fetalSex: 'x',
      timing: { type: 'weeks', fromWeek: 24, toWeek: 26 },
    });
    expect(customExtra.status).toBe(400);
    expect((await send('drA', 'post', p, '/close', { reason: 'delivered', fetalSex: 'x' })).status).toBe(400);
    expect((await send('drA', 'post', p, '/close', { reason: 'new_pregnancy' })).status).toBe(400); // only through the EDD decision
    await expectField(await send('drA', 'post', p, '/close', { reason: 'other' }), 'note', 'Please say why (at least 5 characters).');

    // The booking date: from 4 w 0 d (22 Jun 2026) up to today.
    const bookingMessage = 'The booking date must be between 4 w 0 d (22 Jun 2026) and today.';
    await expectField(await send('drA', 'patch', p, '', { bookedOn: '2026-06-21', previousBookedOn: '2026-09-28' }), 'bookedOn', bookingMessage); // 3 w 6 d
    await expectField(await send('drA', 'patch', p, '', { bookedOn: '2026-09-29', previousBookedOn: '2026-09-28' }), 'bookedOn', bookingMessage); // tomorrow
    // Move: not before the start of this pregnancy, and a window of at most 12 weeks.
    await expectField(
      await act('drA', p, anomaly, { action: 'move', dueFrom: '2026-05-20', dueBy: '2026-10-05', reason: 'Scan booked' }),
      'dueFrom',
      'Choose a date from the start of this pregnancy (25 May 2026) onwards.',
    );
    await expectField(
      await act('drA', p, anomaly, { action: 'move', dueFrom: '2026-10-01', dueBy: '2026-12-24', reason: 'Scan booked' }), // 85 days
      'dueBy',
      'The due window can be at most 12 weeks long.',
    );
    // A custom item with dates follows the Move rules, under the timing.* field names.
    const pastCustom = await send('drA', 'post', p, '/items', {
      clientRequestId: '8b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f',
      kind: 'advice',
      name: 'Travel advice',
      timing: { type: 'date', dueFrom: '2026-09-01', dueBy: '2026-09-20' },
    });
    await expectField(pastCustom, 'timing.dueBy', 'Choose a date from today onwards.');
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(0);
  });

  it('refuses actions that do not fit the item state (409, plain words)', async () => {
    const p = await register('drA');
    let plan = await planOf('drA', p);
    plan = (await act('drA', p, item(plan, 'lab_cbc'), done('2026-09-28'))).body.plan;
    const cbc = item(plan, 'lab_cbc');
    const again = await act('drA', p, cbc, done('2026-09-27'));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'CONFLICT', message: 'This item is already marked done.' });
    expect((await act('drA', p, cbc, { action: 'not_needed', reasonCode: 'declined' })).body.error.message).toBe('This item is already marked done.');
    expect((await act('drA', p, cbc, { action: 'move', dueFrom: '2026-10-01' })).body.error.message).toBe('This item is already marked done.');
    expect((await act('drA', p, item(plan, 'lab_urine'), { action: 'include', reason: "Doctor's decision" })).body.error.message).toBe('This item already applies to this patient.');
    plan = (await act('drA', p, item(plan, 'med_folic'), { action: 'not_needed', reasonCode: 'covered' })).body.plan;
    const folic = await act('drA', p, item(plan, 'med_folic'), { action: 'not_needed', reasonCode: 'declined' });
    expect(folic.status).toBe(409);
    expect(folic.body.error.message).toBe('This item is already marked not needed. Reopen it to change the reason.');
  });
});

// ---------- 20. Order, conflicts and repeats ----------

describe('20. order, conflicts and repeats', () => {
  it('treats an identical repeat with an old rev as no change, and refuses a different change on a stale rev', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    const cbc = item(plan, 'lab_cbc');
    const body = done('2026-09-28', { result: 'Hb 11.2 g/dL' });
    expect((await act('drA', p, cbc, body)).status).toBe(200);
    const repeat = await act('drA', p, cbc, body); // the old rev (0)
    expect(repeat.status).toBe(200);
    expect(repeat.body.changed).toBe(false);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(1);

    const stale = await act('rmo', p, cbc, { action: 'note', text: 'Fasting sample' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'CONFLICT', message: 'Dr A changed this item at 11:30. The latest plan is shown – check it and try again.' });
    expect((await storedItem(p, 'lab_cbc')).note).toBeNull();
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(1);
  });

  it('refuses an item the automatic sync changed after it was opened (blood group corrected)', async () => {
    const p = await register('drA', { medical: { allergies: 'None known', bloodGroup: 'O-', heightCm: 160, weightKg: 60, conditionsReviewed: true } });
    const antiD = item(await planOf('drA', p), 'anti_d');
    expect(antiD.applies).toBe('yes');
    await patchPatient('drA', p, { medical: { allergies: 'None known', bloodGroup: 'O+' } });
    const res = await act('drA', p, antiD, { action: 'note', text: 'Discussed' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(
      "This item was updated automatically at 11:30 (the patient's details changed). The latest plan is shown – check it and try again.",
    );
    expect((await storedItem(p, 'anti_d')).note).toBeNull();
  });

  it('saves changes to two different items made from the same (older) plan, even at the same moment', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    await as('rmo');
    const [a, b] = await Promise.all([act('drA', p, item(plan, 'lab_cbc'), done()), act('rmo', p, item(plan, 'lab_urine'), done())]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const after = await planOf('drA', p);
    expect([item(after, 'lab_cbc').status, item(after, 'lab_urine').status]).toEqual(['done', 'done']);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(2);
  });

  it('adds a custom item only once for the same clientRequestId', async () => {
    const p = await register('drA');
    await planOf('drA', p);
    const body = { clientRequestId: '4b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f', kind: 'investigation', name: 'Thyroid review', timing: { type: 'weeks', fromWeek: 24, toWeek: 26 } };
    const first = await send('drA', 'post', p, '/items', body);
    const second = await send('drA', 'post', p, '/items', body);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body.itemId).toBe(first.body.itemId);
    expect((await currentStored(p)).items.filter((i) => i.origin === 'custom')).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(1);
  });
});

// ---------- 21. Patient changes reach the plan ----------

describe('21. patient changes reach the plan', () => {
  it('re-times the plan for a scan EDD 6 days earlier (log entry; moved items get Check date; done items unchanged)', async () => {
    const p = await register('drA');
    let plan = await planOf('drA', p);
    plan = (await act('drA', p, item(plan, 'lab_cbc'), done('2026-09-28'))).body.plan;
    plan = (await act('drA', p, item(plan, 'scan_anomaly'), { action: 'move', dueFrom: '2026-10-12', reason: 'Scan machine booked' })).body.plan;
    const growthBefore = item(plan, 'scan_growth32').due.from;

    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-02-23' } });
    plan = await planOf('drA', p);
    expect(plan.edd).toBe('2027-02-23T00:00:00.000Z');
    expect(plan.recentChanges[0]).toMatchObject({ action: 'edd_redated' });
    expect(plan.recentChanges[0].text).toBe('Due dates moved: EDD changed from 1 Mar 2027 to 23 Feb 2027 (scan EDD). 1 moved item needs a date check.');
    expect(iso(item(plan, 'scan_growth32').due.from)).toBe(iso(new Date(new Date(growthBefore).getTime() - 6 * 86_400_000)));
    expect(item(plan, 'scan_anomaly')).toMatchObject({ flags: ['check_date', 'outside_window'], due: { from: '2026-10-12T00:00:00.000Z' } });
    expect(item(plan, 'lab_cbc')).toMatchObject({ status: 'done', done: { on: '2026-09-28T00:00:00.000Z' } });

    // Keep as planned: the date check goes away (the date is still outside the guideline window).
    const kept = await act('drA', p, item(plan, 'scan_anomaly'), { action: 'keep' });
    expect(item(kept.body.plan, 'scan_anomaly').flags).toEqual(['outside_window']);
    expect(item(kept.body.plan, 'scan_anomaly').history.at(-1)).toMatchObject({ action: 'keep', reason: 'Kept as planned' });
  });

  it('holds the plan for an EDD change of 200 days; same or new pregnancy; and the way back from a mistaken choice', async () => {
    const p = await register('drA', { pregnancy: { scanEdd: '2026-12-01' } });
    const first = await planOf('drA', p);
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-06-19' } });
    let plan = await planOf('drA', p);
    expect(plan.eddReview).toEqual({ fromEdd: '2026-12-01T00:00:00.000Z', toEdd: '2027-06-19T00:00:00.000Z' });
    expect(item(plan, 'visit_36').status).toBe('on_hold');
    expect(plan.counts.onHold).toBeGreaterThan(0);
    expect(plan.counts.overdue + plan.counts.due).toBe(0);
    expect((await viewPatient('drA', p)).carePlanSummary).toMatchObject({
      eddReview: true,
      eddChange: { fromEdd: '2026-12-01T00:00:00.000Z', toEdd: '2027-06-19T00:00:00.000Z' },
    });

    const wrong = await send('drA', 'post', p, '/edd-decision', { decision: 'same_pregnancy', toEdd: '2027-06-20' });
    expect(wrong.status).toBe(409);

    // New pregnancy: the old plan is closed (read-only) and a new one is built.
    const fresh = await send('drA', 'post', p, '/edd-decision', { decision: 'new_pregnancy', toEdd: '2027-06-19' });
    expect(fresh.status).toBe(200);
    expect(fresh.body.plan).toMatchObject({ replacesPlanId: first.id, edd: '2027-06-19T00:00:00.000Z', eddReview: null, status: 'active' });
    const old = await CarePlan.findOne({ _id: first.id, tenantId: hospital._id });
    expect(old).toMatchObject({ current: false, status: 'closed', closed: { reason: 'new_pregnancy', auto: false, byName: 'Dr A' } });
    expect(old.eddReview).not.toBeNull();
    const view = await getPlan('drA', p);
    expect(view.body.earlierPlans).toEqual([expect.objectContaining({ id: first.id, status: 'closed', closedReason: 'new_pregnancy' })]);

    // The way back: close the new plan, reopen the old one (on hold again), then Same pregnancy.
    expect((await send('drA', 'post', p, '/close', { reason: 'other', note: 'Chosen by mistake' })).status).toBe(200);
    expect((await getPlan('drA', p)).body.plan).toBeNull();
    expectNothingHidden((await getPlan('drA', p, `?planId=${first.id}`)).body); // `closed` on a closed plan
    const reopened = await send('drA', 'post', p, '/reopen', { planId: first.id });
    expect(reopened.status).toBe(200);
    expect(reopened.body.plan).toMatchObject({ id: first.id, status: 'active', eddReview: { toEdd: '2027-06-19T00:00:00.000Z' } });
    const same = await send('drA', 'post', p, '/edd-decision', { decision: 'same_pregnancy', toEdd: '2027-06-19' });
    expect(same.status).toBe(200);
    expect(same.body.plan).toMatchObject({ id: first.id, eddReview: null, edd: '2027-06-19T00:00:00.000Z' });
    expect(same.body.plan.log[0]).toMatchObject({ action: 'edd_same_pregnancy', auto: false });
    plan = await planOf('drA', p);
    expect(plan.id).toBe(first.id);
  });

  it('follows the blood group: O− brings the Rh items in; corrected to O+ they no longer apply (moved: check; done: stays done)', async () => {
    const p = await register('drA');
    let plan = await planOf('drA', p);
    expect(item(plan, 'anti_d')).toMatchObject({ status: 'not_applicable', why: 'only_rh_negative' });

    await patchPatient('drA', p, { medical: { allergies: 'None known', bloodGroup: 'O-' } });
    expect((await storedItem(p, 'anti_d')).auto.applies).toBe('yes'); // no GET needed
    plan = await planOf('drA', p);
    expect(item(plan, 'anti_d').status).toBe('upcoming');
    expect(item(plan, 'lab_ict1').status).toBe('due');
    expect(plan.recentChanges.map((c) => c.action)).toContain('items_apply');

    plan = (await act('drA', p, item(plan, 'lab_ict1'), done('2026-09-28', { result: 'Negative' }))).body.plan;
    plan = (await act('drA', p, item(plan, 'lab_ict28'), { action: 'move', dueFrom: '2026-12-08', dueBy: '2026-12-13' })).body.plan;
    plan = (await act('drA', p, item(plan, 'anti_d'), { action: 'note', text: 'Stock checked' })).body.plan;

    await patchPatient('drA', p, { medical: { allergies: 'None known', bloodGroup: 'O+' } });
    plan = await planOf('drA', p);
    expect(item(plan, 'anti_d')).toMatchObject({ status: 'not_applicable', note: { text: 'Stock checked' } }); // notes kept
    expect(item(plan, 'lab_ict28')).toMatchObject({ status: 'check_needed', why: 'no_longer_indicated', flags: expect.arrayContaining(['no_longer_indicated']) });
    expect(item(plan, 'lab_ict1')).toMatchObject({ status: 'done', applies: 'no' });
    expect(plan.recentChanges.map((c) => c.action)).toContain('items_no_longer_apply');
  });

  it("follows the doctor's risk override (PUT and DELETE) without a GET", async () => {
    const p = await register('drA');
    expect((await storedItem(p, 'scan_doppler')).auto.applies).toBe('no');
    const put = await (await as('drA')).put(`/api/patients/${p.id}/risk-override`).send({ level: 'high', reason: 'Doctor judges this sample pregnancy high risk' });
    expect(put.status).toBe(200);
    expect((await storedItem(p, 'scan_doppler')).auto.applies).toBe('yes');
    expect((await (await as('drA')).delete(`/api/patients/${p.id}/risk-override`)).status).toBe(200);
    expect((await storedItem(p, 'scan_doppler')).auto.applies).toBe('no');
  });

  it('brings in the high-risk items when a PATCH of the age crosses 35, without a GET', async () => {
    const p = await register('drA', { ageYears: 35 });
    expect((await storedItem(p, 'scan_doppler')).auto.applies).toBe('no');
    await patchPatient('drA', p, { ageYears: 36 });
    expect((await storedItem(p, 'scan_doppler')).auto.applies).toBe('yes');
  });

  it('pauses when reception changes the type of care (items still allowed; protocol changes 409), and resumes when changed back', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    const changed = await patchPatient('reception', p, { careType: 'postnatal' });
    expect(changed).not.toHaveProperty('carePlanSummary');
    expect(changed).not.toHaveProperty('pregnancy');
    expect(await currentStored(p)).toMatchObject({ status: 'paused', pausedReason: 'care_type_changed' });

    const paused = await planOf('drA', p); // pausing changed every item's status (and rev)
    expect(paused).toMatchObject({ status: 'paused', canEdit: true, canChangePlan: false, canClose: true, pausedAt: expect.any(String) });
    expect((await viewPatient('drA', p)).carePlanSummary).toMatchObject({ status: 'paused', pausedAt: paused.pausedAt });
    expect((await act('drA', p, item(paused, 'lab_cbc'), done())).status).toBe(200);
    const std = await standard();
    const put = await send('drA', 'put', p, '/template', { templateId: String(std._id), fromItemsHash: 'a'.repeat(64), toItemsHash: 'b'.repeat(64) });
    expect(put.status).toBe(409);
    expect(put.body.error).toMatchObject({
      code: 'PLAN_PAUSED',
      message: 'This care plan is paused (the type of care is not antenatal). Only items can be updated, or the plan closed.',
    });
    expect((await (await as('drA')).get(url(p, '/template-options'))).body.error.code).toBe('PLAN_PAUSED');
    // Every other plan-level change is refused too.
    const planLevel = [
      await send('drA', 'post', p, '/items', { clientRequestId: '9b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f', kind: 'advice', name: 'Extra advice', timing: { type: 'weeks', fromWeek: 24, toWeek: 26 } }),
      await send('drA', 'patch', p, '', { bookedOn: '2026-09-01', previousBookedOn: '2026-09-28' }),
      await send('drA', 'post', p, '/edd-decision', { decision: 'same_pregnancy', toEdd: EDD }),
    ];
    for (const res of planLevel) expect([res.status, res.body.error?.code]).toEqual([409, 'PLAN_PAUSED']);

    await patchPatient('reception', p, { careType: 'antenatal' });
    const back = await currentStored(p);
    expect(back).toMatchObject({ status: 'active', pausedReason: null });
    expect((await viewPatient('drA', p)).carePlanSummary).toMatchObject({ status: 'active', pausedAt: null });
    expect(String(back._id)).toBe(plan.id);
    expect(item(await planOf('drA', p), 'lab_cbc').status).toBe('done');
  });

  it('lets a doctor close a paused plan (for example after the delivery)', async () => {
    const p = await register('drA');
    await planOf('drA', p);
    await patchPatient('reception', p, { careType: 'postnatal' });
    const closed = await send('drA', 'post', p, '/close', { reason: 'delivered' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ plan: null, changed: true });
    expect(await CarePlan.findOne({ tenantId: hospital._id, patientId: p.id })).toMatchObject({
      current: false,
      status: 'closed',
      pausedReason: null,
      closed: { reason: 'delivered', auto: false, byName: 'Dr A' },
    });
  });

  it('shows the post-dates warning from EDD + 21 days (43 w 0 d)', async () => {
    const p = await register('drA'); // EDD 1 Mar 2027
    vi.setSystemTime(new Date('2027-03-21T06:00:00Z'));
    sessions.drA = null; // log in again after the jump in time
    expect((await planOf('drA', p)).postDates).toBe(false);
    vi.setSystemTime(new Date('2027-03-22T06:00:00Z'));
    sessions.drA = null;
    expect(await planOf('drA', p)).toMatchObject({ postDates: true, gestationToday: { weeks: 43, days: 0 } });
    expect((await viewPatient('drA', p)).carePlanSummary.postDates).toBe(true);
  });
});

// ---------- 22. Stale sync ----------

describe('22. stale sync', () => {
  it('changes nothing when the sync reads an out-of-date patient after a newer EDD sync', async () => {
    const p = await register('drA');
    await planOf('drA', p);
    const outOfDate = await Patient.findOne({ _id: p.id, tenantId: hospital._id }); // before the EDD change
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-08-01' } }); // 153 days: on hold
    const before = (await currentStored(p)).toObject();
    expect(before.eddReview).not.toBeNull();

    vi.spyOn(Patient, 'findOne').mockResolvedValueOnce(outOfDate);
    await syncPlan({ req: null, tenantId: hospital._id, now: new Date() }, p.id);
    vi.restoreAllMocks();

    const after = (await currentStored(p)).toObject();
    expect(after.__v).toBe(before.__v);
    expect(after.eddReview).toEqual(before.eddReview);
    expect(after.basis).toEqual(before.basis);
    expect(after.log).toEqual(before.log);
  });
});

// ---------- 23. Self-healing ----------

describe('23. self-healing', () => {
  it('works the plan out again on the next GET after a change saved behind the app (same version)', async () => {
    const p = await register('drA');
    await planOf('drA', p);
    const { __v } = await Patient.findOne({ _id: p.id, tenantId: hospital._id });
    await Patient.updateOne({ _id: p.id, tenantId: hospital._id }, { $set: { 'medical.bloodGroup': 'O-' } });
    expect((await Patient.findOne({ _id: p.id, tenantId: hospital._id })).__v).toBe(__v);
    expect((await storedItem(p, 'anti_d')).auto.applies).toBe('no');
    const plan = await planOf('drA', p);
    expect(item(plan, 'anti_d')).toMatchObject({ applies: 'yes', status: 'upcoming' });
    expect((await storedItem(p, 'anti_d')).auto.applies).toBe('yes');
  });

  it('follows a template change and approval that change risk levels, on the next read', async () => {
    const p = await register('drA'); // 28 years old: low risk
    expect((await storedItem(p, 'scan_doppler')).auto.applies).toBe('no');
    const std = await standard();
    const rules = std.riskRules.map((r) => (r.key === 'age_over_35' ? { ...r.toObject(), value: 25 } : r.toObject()));
    const put = await (await as('drA')).put(`/api/care-plans/templates/${std._id}`).send(templateBody(std, { riskRules: rules }));
    expect(put.status).toBe(200);
    expect(put.body.recalculated.changed).toBeGreaterThan(0);
    expect((await approve('drA', await standard())).status).toBe(200);
    expect((await storedItem(p, 'scan_doppler')).auto.applies).toBe('no'); // not yet: plans follow on their next read
    const plan = await planOf('drA', p);
    expect(item(plan, 'scan_doppler')).toMatchObject({ applies: 'yes', status: 'upcoming' });
    expect(plan.template).toMatchObject({ approved: true, label: null });
  });
});

// ---------- 24. Close and reopen ----------

describe('24. close and reopen', () => {
  it('makes a closed plan read-only (409 PLAN_CLOSED), reopens it, and refuses to reopen over a current plan', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    const closed = await send('drA', 'post', p, '/close', { reason: 'delivered', note: 'Normal delivery' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ plan: null, changed: true, summary: { exists: false, earlierCount: 1, lastClosed: { reason: 'delivered', at: expect.any(String) } } });

    const refusals = [
      await act('drA', p, item(plan, 'lab_cbc'), done()),
      await send('drA', 'patch', p, '', { bookedOn: '2026-09-01', previousBookedOn: '2026-09-28' }),
      await send('drA', 'post', p, '/items', { clientRequestId: '5b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f', kind: 'advice', name: 'Extra advice', timing: { type: 'weeks', fromWeek: 24, toWeek: 26 } }),
      await send('drA', 'post', p, '/close', { reason: 'delivered' }),
    ];
    for (const res of refusals) {
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'PLAN_CLOSED', message: 'This care plan is closed. Reopen it to make changes.' });
    }

    const view = await getPlan('drA', p);
    expect(view.body.plan).toBeNull();
    expect(view.body.earlierPlans).toEqual([expect.objectContaining({ id: plan.id, status: 'closed', closedReason: 'delivered', edd: '2027-03-01T00:00:00.000Z' })]);
    const earlier = (await getPlan('drA', p, `?planId=${plan.id}`)).body.plan;
    expect(earlier).toMatchObject({ status: 'closed', readOnly: true, canEdit: false, canReopen: true, closed: { reason: 'delivered', note: 'Normal delivery', byName: 'Dr A' } });
    expect(item(earlier, 'lab_cbc').status).toBe('inactive');

    const reopened = await send('drA', 'post', p, '/reopen', { planId: plan.id });
    expect(reopened.status).toBe(200);
    expect(reopened.body.plan).toMatchObject({ id: plan.id, status: 'active', closed: null, canEdit: true });
    expect(reopened.body.plan.log[0]).toMatchObject({ action: 'reopened', auto: false });

    // Closed again; a later pregnancy gets its own plan; the old one can't be reopened over it.
    await send('drA', 'post', p, '/close', { reason: 'delivered' });
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-08-01' } });
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id, current: true })).toBe(1);
    const over = await send('drA', 'post', p, '/reopen', { planId: plan.id });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toBe('This patient already has a current care plan.');
  });
});

// ---------- 25. Audit privacy ----------

describe('25. audit privacy', () => {
  it('writes ids only, never medical details, and nothing for automatic changes', async () => {
    const p = await register('drA', { medical: { allergies: 'None known', bloodGroup: 'O-', heightCm: 160, weightKg: 60, conditionsReviewed: true } });
    let plan = await planOf('drA', p);
    plan = (await act('drA', p, item(plan, 'lab_hiv'), done('2026-09-27', { result: 'Non-reactive FAKE-RESULT', note: 'FAKE-NOTE-A' }))).body.plan;
    plan = (await act('drA', p, item(plan, 'med_folic'), { action: 'not_needed', reasonCode: 'other', reason: 'FAKE-REASON-B already taking' })).body.plan;
    plan = (await act('drA', p, item(plan, 'anti_d'), { action: 'move', dueFrom: '2026-12-10', reason: 'FAKE-REASON-C stock' })).body.plan;
    plan = (await act('drA', p, item(plan, 'lab_ict1'), { action: 'note', text: 'FAKE-NOTE-D' })).body.plan;
    const custom = await send('drA', 'post', p, '/items', {
      clientRequestId: '6b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f',
      kind: 'investigation',
      name: 'FAKE-ITEM-E review',
      reason: 'FAKE-REASON-F',
      note: 'FAKE-NOTE-G',
      timing: { type: 'weeks', fromWeek: 24, toWeek: 26 },
    });
    expect(custom.status).toBe(201);
    plan = (await send('drA', 'patch', p, '', { bookedOn: '2026-09-01', previousBookedOn: '2026-09-28' })).body.plan;
    plan = (await act('drA', p, item(plan, 'lab_hiv'), { action: 'reopen', reason: 'FAKE-REASON-I undo' })).body.plan;
    expect(item(plan, 'lab_hiv').status).not.toBe('done');

    // Include anyway, and remove the inclusion: on a second, low-risk patient (the Doppler scan applies to
    // the first one, who is Rh negative and so high risk).
    const q = await register('drA');
    const qPlan = (await act('drA', q, item(await planOf('drA', q), 'scan_doppler'), { action: 'include', reason: 'FAKE-REASON-J' })).body.plan;
    expect(item(qPlan, 'scan_doppler').forceInclude).toMatchObject({ reason: 'FAKE-REASON-J' });
    expect((await act('drA', q, item(qPlan, 'scan_doppler'), { action: 'remove_include' })).status).toBe(200);

    // The protocol is updated (approved, edited, approved again) and the plan is updated to it.
    const std = await standard();
    expect((await approve('drA', std)).status).toBe(200);
    const v1 = await standard();
    const items = v1.items.map((i) => i.toObject()).map((i) => (i.key === 'lab_tsh' ? { ...i, name: 'Thyroid test (TSH and free T4)' } : i));
    expect((await (await as('drA')).put(`/api/care-plans/templates/${v1._id}`).send(templateBody(v1, { items }))).status).toBe(200);
    expect((await approve('drA', await standard())).status).toBe(200);
    const preview = await (await as('drA')).get(url(p, `/template-preview?templateId=${std._id}`));
    expect(preview.status).toBe(200);
    const updated = await send('drA', 'put', p, '/template', { templateId: String(std._id), fromItemsHash: preview.body.from.itemsHash, toItemsHash: preview.body.to.itemsHash });
    expect(updated.body.changed).toBe(true);

    // Automatic changes write no entry: re-dating ...
    const counted = () => AuditLog.countDocuments({ action: { $in: ['CARE_PLAN_CREATED', 'CARE_PLAN_CHANGED'] } });
    let before = await counted();
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-02-23' } }); // re-dated
    expect(await counted()).toBe(before);
    // ... (a person keeps the moved date after the re-dating, then goes back to the guideline date) ...
    plan = await planOf('drA', p);
    expect(item(plan, 'anti_d').flags).toContain('check_date');
    plan = (await act('drA', p, item(plan, 'anti_d'), { action: 'keep' })).body.plan;
    plan = (await act('drA', p, item(plan, 'anti_d'), { action: 'reset_date' })).body.plan;
    expect(item(plan, 'anti_d').manualDate).toBeNull();
    // ... pause, automatic replacement, hold.
    before = await counted();
    await patchPatient('reception', p, { careType: 'postnatal' }); // paused
    await patchPatient('drA', p, { careType: 'antenatal', pregnancy: { scanEdd: '2027-08-01' } }); // replaced automatically
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-03-01' } }); // on hold
    expect(await counted()).toBe(before);
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(2);
    const onHold = await currentStored(p);
    expect(onHold.eddReview).not.toBeNull();

    // Decisions by people: one 'plan_changed' each. Viewing an earlier plan is audited with its id.
    const decided = await send('drA', 'post', p, '/edd-decision', { decision: 'new_pregnancy', toEdd: '2027-03-01' });
    expect(decided.status).toBe(200);
    const newest = decided.body.plan.id;
    expect((await send('drA', 'post', p, '/close', { reason: 'other', note: 'FAKE-NOTE-H chosen by mistake' })).status).toBe(200);
    expect((await getPlan('drA', p, `?planId=${onHold._id}`)).status).toBe(200);
    expect((await send('drA', 'post', p, '/reopen', { planId: newest })).status).toBe(200);
    await getPlan('nurse', p);

    const entries = await carePlanAudits();
    const allowed = new Set(['patientId', 'mrn', 'planId', 'itemId', 'change', 'access']);
    const changeWords = new Set(['item_done', 'item_reopened', 'item_not_needed', 'item_moved', 'item_date_reset', 'item_included', 'item_include_removed', 'item_kept', 'item_note', 'item_added', 'plan_changed']);
    expect(entries.length).toBeGreaterThan(8);
    for (const e of entries) {
      for (const k of Object.keys(e.details)) expect(allowed.has(k)).toBe(true);
      if (e.action === 'CARE_PLAN_CHANGED') expect(changeWords.has(e.details.change)).toBe(true);
      const details = JSON.stringify(e.details);
      for (const secret of [String(std._id), std.name]) expect(details).not.toContain(secret); // no template id or name
    }
    expect(entries.filter((e) => e.action === 'CARE_PLAN_CREATED')).toHaveLength(2); // p and q
    const changes = entries.filter((e) => e.action === 'CARE_PLAN_CHANGED').map((e) => e.details.change);
    expect(changes).toEqual([
      'item_done',
      'item_not_needed',
      'item_moved',
      'item_note',
      'item_added',
      'plan_changed', // booking date
      'item_reopened',
      'item_included',
      'item_include_removed',
      'plan_changed', // protocol update
      'item_kept',
      'item_date_reset',
      'plan_changed', // EDD decision
      'plan_changed', // close
      'plan_changed', // reopen
    ]);
    expect(new Set(changes)).toEqual(changeWords); // every change word was written
    expect(entries.some((e) => e.action === 'CARE_PLAN_VIEWED' && e.details.planId === String(onHold._id))).toBe(true);

    // Older entries with extra details are trimmed by every audit reader as well (defence in depth).
    await AuditLog.create({
      action: 'CARE_PLAN_CHANGED',
      tenantId: hospital._id,
      details: { patientId: p.id, mrn: p.mrn, planId: plan.id, change: 'plan_changed', itemKey: 'anti_d', reason: 'FAKE-LEGACY-REASON' },
    });
    await AuditLog.create({ action: 'RISK_OVERRIDDEN', tenantId: hospital._id, details: { patientId: p.id, mrn: p.mrn, why: 'override', reason: 'FAKE-RISK-REASON' } });

    const log = await (await as('admin')).get('/api/tenant/audit-logs?limit=100');
    expect(log.status).toBe(200);
    const json = JSON.stringify(log.body);
    expect(json).toMatch(/CARE_PLAN_CHANGED/);
    for (const secret of [
      'anti_d',
      'lab_hiv',
      'med_folic',
      'Anti-D',
      'HIV',
      'Folic',
      'FAKE-',
      'replacesPlanId',
      'new_pregnancy',
      'plan_closed',
      'delivered',
      '2027-',
      '2026-12',
      '2026-09-27',
      '2026-09-01',
      'itemKey',
      'reason',
      'result',
    ]) {
      expect(json).not.toContain(secret);
    }
    // Template entries name their template on purpose; care-plan entries never do.
    const carePlanJson = JSON.stringify(log.body.entries.filter((e) => e.action.startsWith('CARE_PLAN_')));
    for (const secret of [String(std._id), std.name, 'Thyroid']) expect(carePlanJson).not.toContain(secret);

    // The super admin's overview shows the newest entries: trimmed the same way.
    const root = await createSuperAdmin({ name: 'Root Admin' });
    const stats = await (await loginAs(root, { app })).agent.get('/api/platform/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.recentActivity.map((e) => e.action)).toEqual(expect.arrayContaining(['CARE_PLAN_CHANGED', 'RISK_OVERRIDDEN']));
    const statsJson = JSON.stringify(stats.body);
    for (const secret of ['anti_d', 'FAKE-', 'itemKey', 'reason']) expect(statsJson).not.toContain(secret);
  });
});

// ---------- 26. PCPNDT ----------

describe('26. PCPNDT', () => {
  it("refuses words about the baby's sex in plan text, template text and voice words", async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    for (const result of ["It's a boy", '46,XY']) {
      const res = await act('drA', p, item(plan, 'scan_anomaly'), done('2026-09-28', { result }));
      expect(res.status).toBe(400);
      expect(res.body.error.fields.result).toBe(PCPNDT_MESSAGE);
    }
    expect((await act('drA', p, item(plan, 'lab_cbc'), done('2026-09-28', { result: 'beta hCG 1200' }))).status).toBe(200);
    const custom = await send('drA', 'post', p, '/items', { clientRequestId: '7b6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f', kind: 'advice', name: 'Ladki counselling', timing: { type: 'weeks', fromWeek: 24, toWeek: 26 } });
    expect(custom.body.error.fields.name).toBe(PCPNDT_MESSAGE);
    expect((await send('drA', 'post', p, '/close', { reason: 'other', note: 'Delivered a girl' })).body.error.fields.note).toBe(PCPNDT_MESSAGE);

    const mine = (await (await as('drA')).post('/api/care-plans/templates').send({ careType: 'antenatal', name: 'My protocol' })).body.template;
    const tpl = await (await as('drA')).put(`/api/care-plans/templates/${mine.id}`).send({ version: mine.version, name: 'My protocol', items: [{ key: 'x', kind: 'advice', name: 'Ladki ya ladka', atBooking: true }] });
    expect(tpl.status).toBe(400);
    expect(tpl.body.error.fields['items.0.name']).toBe(PCPNDT_MESSAGE);

    // The name given when a protocol is created is copied into plans too (with or without copied items).
    const std = await standard();
    for (const body of [
      { careType: 'antenatal', name: 'Ladki protocol' },
      { copyFrom: String(std._id), name: '46,XY plan' },
    ]) {
      const bad = await (await as('drA')).post('/api/care-plans/templates').send(body);
      expect(bad.status).toBe(400);
      expect(bad.body.error.fields.name).toBe(PCPNDT_MESSAGE);
    }
    expect((await (await as('drA')).post('/api/care-plans/templates').send({ careType: 'antenatal', fetalSex: 'x' })).status).toBe(400); // unknown field
    expect(await CarePlanTemplate.countDocuments({ tenantId: hospital._id, kind: 'personal' })).toBe(1);

    const word = await (await as('drA')).put('/api/me/dictation-words').send({ phrase: 'ladka', meaning: 'ignore' });
    expect(word.status).toBe(400);
  });
});

// ---------- 27. Template loops ----------

describe('27. template save', () => {
  it("refuses an 'after' loop and an item timed after itself", async () => {
    const mine = (await (await as('drA')).post('/api/care-plans/templates').send({ careType: 'antenatal', name: 'My protocol' })).body.template;
    const after = (key, anchor) => ({ key, kind: 'visit', name: `Visit ${key}`, after: { key: anchor, weeks: 2 } });
    const loop = await (await as('drA')).put(`/api/care-plans/templates/${mine.id}`).send({ version: mine.version, name: 'My protocol', items: [after('a', 'b'), after('b', 'a')] });
    expect(loop.status).toBe(400);
    expect(loop.body.error.fields['items.0.after.key']).toBe('Item "a" is timed after itself (through "b").');
    const self = await (await as('drA')).put(`/api/care-plans/templates/${mine.id}`).send({ version: mine.version, name: 'My protocol', items: [after('a', 'a')] });
    expect(self.status).toBe(400);
    expect(self.body.error.fields['items.0.after.key']).toBe('Item "a" is timed after itself.');
  });
});

// ---------- 28. Tenancy ----------

describe('28. tenancy', () => {
  it('refuses any care-plan query without a hospital, and every query the routes make carries one', async () => {
    await expect(CarePlan.find({ status: 'active' }).exec()).rejects.toThrow(/without a tenantId/);
    await expect(CarePlan.findOne({}).exec()).rejects.toThrow(/without a tenantId/);
    await expect(CarePlan.countDocuments({}).exec()).rejects.toThrow(/without a tenantId/);
    await expect(CarePlan.updateOne({}, { $set: { status: 'closed' } }).exec()).rejects.toThrow(/without a tenantId/);
    await expect(CarePlan.aggregate([{ $match: { status: 'active' } }]).exec()).rejects.toThrow(/without a leading tenantId/);

    const filters = [];
    const exec = mongoose.Query.prototype.exec;
    vi.spyOn(mongoose.Query.prototype, 'exec').mockImplementation(function (...args) {
      if (this.model?.modelName === 'CarePlan') filters.push(this.getFilter());
      return exec.apply(this, args);
    });
    const p = await register('drA');
    const plan = await planOf('drA', p);
    await act('drA', p, item(plan, 'lab_cbc'), done());
    await send('drA', 'post', p, '/close', { reason: 'delivered' });
    await send('drA', 'post', p, '/reopen', { planId: plan.id });
    await viewPatient('nurse', p);
    vi.restoreAllMocks();
    expect(filters.length).toBeGreaterThan(5);
    for (const f of filters) expect(String(f.tenantId)).toBe(String(hospital._id));
  });
});

// ---------- 29. Log limits ----------

describe('29. plan log limits', () => {
  it('keeps the newest 100 automatic entries and every entry made by a person', async () => {
    const p = await register('drA');
    await planOf('drA', p);
    await send('drA', 'patch', p, '', { bookedOn: '2026-09-01', previousBookedOn: '2026-09-28' });
    const entries = [];
    for (let i = 0; i < 150; i += 1) {
      entries.push({ at: NOW, by: null, byName: 'Automatic', action: 'items_apply', text: `Automatic change ${i}`, auto: true });
      if (i % 10 === 0) entries.push({ at: NOW, by: people.drA._id, byName: 'Dr A', action: 'booking_date', text: `Change by a person ${i}`, auto: false });
    }
    await CarePlan.updateOne({ tenantId: hospital._id, patientId: p.id, current: true }, { $push: { log: { $each: entries } } });

    await patchPatient('drA', p, { medical: { allergies: 'None known', bloodGroup: 'O-' } }); // an automatic change: the sync saves and trims
    const log = (await currentStored(p)).log;
    const auto = log.filter((l) => l.auto);
    expect(auto).toHaveLength(100);
    expect(auto.at(-1).text).toMatch(/now appl/); // the newest (from this sync) is kept
    expect(auto.some((l) => l.action === 'created')).toBe(false); // the oldest went first
    expect(log.filter((l) => !l.auto)).toHaveLength(16); // 15 + the booking date change: none trimmed

    const view = await planOf('drA', p);
    expect(view.log).toHaveLength(50);
    expect(view.log[0].text).toMatch(/now appl/); // newest first
  });
});

// ---------- 30. Regression ----------

describe('30. regression', () => {
  it("uses the hospital's date: an LMP of today is accepted at 00:30 in India, and the plan's today changes at midnight there", async () => {
    vi.setSystemTime(new Date('2026-10-12T19:00:00Z')); // 13 Oct 2026, 00:30 in India
    const p = await register('drA', { pregnancy: { lmp: '2026-10-13' } });
    const plan = await planOf('drA', p);
    expect(plan).toMatchObject({ today: '2026-10-13T00:00:00.000Z', bookedOn: '2026-10-13T00:00:00.000Z', gestationToday: { weeks: 0, days: 0 } });

    // A day later: log in again (the session would have timed out).
    vi.setSystemTime(new Date('2026-10-13T18:29:00Z')); // 23:59 in India
    sessions.drA = null;
    expect((await planOf('drA', p)).today).toBe('2026-10-13T00:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-13T18:31:00Z')); // 00:01 on 14 Oct in India
    sessions.drA = null;
    expect((await planOf('drA', p)).today).toBe('2026-10-14T00:00:00.000Z');
  });

});

// ---------- 31. Failure and retry paths ----------

describe('31. failure and retry paths', () => {
  const versionError = (doc) => new mongoose.Error.VersionError(doc, doc.__v ?? 0, []);
  const unavailable = () => new Error('plan store unavailable');
  // Care-plan saves fail the first `times` times (with err(doc)), then save for real.
  function failPlanSaves(times, err = versionError) {
    const realSave = CarePlan.prototype.save;
    let calls = 0;
    return vi.spyOn(CarePlan.prototype, 'save').mockImplementation(function (...args) {
      calls += 1;
      return calls <= times ? Promise.reject(err(this)) : realSave.apply(this, args);
    });
  }
  // The first care-plan save runs other(doc) before it saves (for real): another request that gets in first.
  function beforeFirstSave(other, { onlyNew = false } = {}) {
    const realSave = CarePlan.prototype.save;
    let done = false;
    return vi.spyOn(CarePlan.prototype, 'save').mockImplementation(async function (...args) {
      if (!done && (!onlyNew || this.isNew)) {
        done = true;
        await other();
      }
      return realSave.apply(this, args);
    });
  }
  const quietErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});
  const daysBefore = (v, n) => iso(new Date(new Date(v).getTime() - n * 86_400_000));

  it('never fails a patient registration or change because of the plan; the next read heals the plan', async () => {
    const logged = quietErrors();
    let saves = failPlanSaves(Infinity, unavailable);
    const p = await register('drA'); // the helper asserts 201
    expect(await Patient.countDocuments({ _id: p.id, tenantId: hospital._id })).toBe(1);
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CREATED' })).toBe(0);
    expect(logged).toHaveBeenCalledWith('Care plan sync failed', 'plan store unavailable');
    saves.mockRestore();
    const plan = await planOf('drA', p); // built on the next read
    expect(plan.edd).toBe('2027-03-01T00:00:00.000Z');

    saves = failPlanSaves(Infinity, unavailable);
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-02-23' } }); // the helper asserts 200
    const put = await (await as('drA')).put(`/api/patients/${p.id}/risk-override`).send({ level: 'high', reason: 'Doctor judges this sample pregnancy high risk' });
    expect(put.status).toBe(200);
    expect((await (await as('drA')).delete(`/api/patients/${p.id}/risk-override`)).status).toBe(200);
    saves.mockRestore();
    expect(iso((await Patient.findOne({ _id: p.id, tenantId: hospital._id })).pregnancy.scanEdd)).toBe('2027-02-23'); // the patient change is saved
    expect(iso((await currentStored(p)).basis.edd)).toBe(EDD); // the plan was not

    const healed = await planOf('drA', p);
    expect(healed.edd).toBe('2027-02-23T00:00:00.000Z');
    expect(healed.recentChanges[0]).toMatchObject({ action: 'edd_redated' });
    expect(iso((await currentStored(p)).basis.edd)).toBe('2027-02-23');
  });

  it('tries the sync 3 times; after that a read answers with the plan worked out in memory, and a change gets 409', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    // A change saved behind the app (same version), so the next sync has to save.
    await Patient.updateOne({ _id: p.id, tenantId: hospital._id }, { $set: { 'medical.bloodGroup': 'O-' } });
    let saves = failPlanSaves(2);
    expect((await getPlan('drA', p)).status).toBe(200);
    expect(saves).toHaveBeenCalledTimes(3); // two clashes, then saved
    saves.mockRestore();
    expect((await storedItem(p, 'anti_d')).auto.applies).toBe('yes');
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(0);

    // Every save clashes from now on: the EDD change reaches the patient, but not the stored plan.
    const logged = quietErrors();
    saves = failPlanSaves(Infinity);
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-02-23' } });
    expect(logged).toHaveBeenCalledWith('Care plan sync failed', 'This care plan was being updated at the same moment. Please try again.');
    const stored = await currentStored(p);
    expect(iso(stored.basis.edd)).toBe(EDD);
    saves.mockClear();

    const read = await getPlan('drA', p);
    expect(read.status).toBe(200);
    expect(saves).toHaveBeenCalledTimes(3);
    // Worked out in memory the way the sync would: the dates moved, and the log says so.
    expect(read.body.plan.edd).toBe('2027-02-23T00:00:00.000Z');
    expect(read.body.plan.recentChanges.map((c) => c.action)).toContain('edd_redated'); // (and the Doppler scan: the risk went up with O-)
    expect(iso(item(read.body.plan, 'scan_growth32').due.from)).toBe(daysBefore(item(plan, 'scan_growth32').due.from, 6));
    expect(item(read.body.plan, 'anti_d').applies).toBe('yes');
    expect((await viewPatient('drA', p)).carePlanSummary).toMatchObject({ exists: true });

    const change = await act('drA', p, item(read.body.plan, 'lab_cbc'), done());
    expect(change.status).toBe(409);
    expect(change.body.error).toEqual({ code: 'CONFLICT', message: 'This care plan was being updated at the same moment. Please try again.' });
    saves.mockRestore();
    const after = await currentStored(p);
    expect(after.__v).toBe(stored.__v); // nothing was saved
    expect(JSON.stringify(after.toObject().items)).toBe(JSON.stringify(stored.toObject().items));
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(0);
    expect((await planOf('drA', p)).edd).toBe('2027-02-23T00:00:00.000Z'); // healed on the next read
  });

  it('works a change out again when another save got in first (two items at the same moment)', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    await as('rmo');
    let rmo;
    const saves = beforeFirstSave(async () => {
      rmo = await act('rmo', p, item(plan, 'lab_urine'), done()); // saved first
    });
    const res = await act('drA', p, item(plan, 'lab_cbc'), done()); // its first save clashes for real
    expect([rmo.status, res.status]).toEqual([200, 200]);
    expect(saves).toHaveBeenCalledTimes(3); // the RMO's save, Dr A's clash, Dr A's second try
    saves.mockRestore();
    const after = await planOf('drA', p);
    expect([item(after, 'lab_cbc').status, item(after, 'lab_urine').status]).toEqual(['done', 'done']);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(2);
  });

  it('adds a custom item once when the same request arrives twice at the same moment', async () => {
    const p = await register('drA');
    await planOf('drA', p);
    const body = { clientRequestId: 'ab6f7c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f', kind: 'advice', name: 'Extra advice', timing: { type: 'weeks', fromWeek: 24, toWeek: 26 } };
    let first;
    const saves = beforeFirstSave(async () => {
      first = await send('drA', 'post', p, '/items', body);
    });
    const second = await send('drA', 'post', p, '/items', body);
    saves.mockRestore();
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body.itemId).toBe(first.body.itemId);
    expect((await currentStored(p)).items.filter((i) => i.origin === 'custom')).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(1);
  });

  it('answers 409 (never 500) when every save of a change clashes, and saves nothing', async () => {
    const p = await register('drA');
    const plan = await planOf('drA', p);
    const before = await currentStored(p);
    const saves = failPlanSaves(Infinity);
    const res = await act('drA', p, item(plan, 'lab_cbc'), done());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(saves).toHaveBeenCalledTimes(3);
    saves.mockRestore();
    expect((await currentStored(p)).__v).toBe(before.__v);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(0);
  });

  it('links the new plan to the old one when another request builds it first (EDD decision: new pregnancy)', async () => {
    const p = await register('drA', { pregnancy: { scanEdd: '2026-12-01' } });
    const first = await planOf('drA', p);
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-06-19' } }); // on hold
    await as('rmo');
    // Just before the new plan is saved, the RMO opens the plan: that read builds the new plan first.
    const saves = beforeFirstSave(() => getPlan('rmo', p), { onlyNew: true });
    const res = await send('drA', 'post', p, '/edd-decision', { decision: 'new_pregnancy', toEdd: '2027-06-19' });
    saves.mockRestore();
    expect(res.status).toBe(200);
    const plans = await storedPlans(p);
    expect(plans).toHaveLength(2);
    const current = plans.filter((pl) => pl.current);
    expect(current).toHaveLength(1);
    expect(String(current[0].replacesPlanId)).toBe(first.id);
    expect(res.body.plan).toMatchObject({ id: String(current[0]._id), replacesPlanId: first.id, edd: '2027-06-19T00:00:00.000Z' });
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(1);
  });

  it('audits an EDD decision even when building the new plan fails (the next read builds it)', async () => {
    const p = await register('drA', { pregnancy: { scanEdd: '2026-12-01' } });
    const first = await planOf('drA', p);
    await patchPatient('drA', p, { pregnancy: { scanEdd: '2027-06-19' } }); // on hold
    quietErrors();
    const realSave = CarePlan.prototype.save;
    let calls = 0;
    vi.spyOn(CarePlan.prototype, 'save').mockImplementation(function (...args) {
      calls += 1;
      return calls === 2 ? Promise.reject(unavailable()) : realSave.apply(this, args); // the close saves; the new plan doesn't
    });
    const res = await send('drA', 'post', p, '/edd-decision', { decision: 'new_pregnancy', toEdd: '2027-06-19' });
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    const entries = await carePlanAudits('CARE_PLAN_CHANGED');
    expect(entries.map((e) => e.details)).toEqual([{ patientId: p.id, mrn: p.mrn, planId: first.id, change: 'plan_changed' }]);
    expect(await CarePlan.findOne({ _id: first.id, tenantId: hospital._id })).toMatchObject({ current: false, status: 'closed' });
    expect(await planOf('drA', p)).toMatchObject({ status: 'active', edd: '2027-06-19T00:00:00.000Z' });
  });
});
