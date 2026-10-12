// Feature 7: the care-plan service (plans on the server) and the template approval changes, tested directly
// against the test database (the API routes are tested in careplans.test.js). Fake data only.
// Time is pinned: 28 Sep 2026 in India; the fake patient's EDD is 1 Mar 2027 (18 w 0 d today).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANTENATAL_DRAFT } from '../src/careplans/antenatalDraft.js';
import { itemsHash } from '../src/careplans/hashes.js';
import {
  SyncConflict,
  addCustomItem,
  applyItemAction,
  applyTemplate,
  changeBookingDate,
  closeCarePlan,
  decideEdd,
  getCarePlan,
  planCtx,
  previewTemplate,
  reopenCarePlan,
  syncPlan,
  templateOptions,
  trimAutoLog,
} from '../src/careplans/plansService.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const d = (s) => new Date(`${s}T00:00:00Z`);
const EDD = '2027-03-01';
let seq = 0;

let hospital;
let other;
let drA;
let drB;
let rmo;
let nurse;
let reception;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  hospital = await createTenant();
  other = await createTenant();
  [drA, drB, rmo, nurse, reception] = await Promise.all(['Dr A', 'Dr B', 'RMO', 'Nurse', 'Reception'].map((name) => createUser({ name })));
  await addMember(drA, hospital, 'doctor');
  await addMember(drB, hospital, 'doctor');
  await addMember(rmo, hospital, 'rmo');
  await addMember(nurse, hospital, 'nurse');
  await addMember(reception, hospital, 'receptionist');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

// A request as the app would build it (for access checks and audit entries).
const ctxFor = (user, role, tenant = hospital, now = new Date()) =>
  planCtx({ tenantId: tenant._id, user, membership: { roles: [role] }, now, ip: '127.0.0.1', get: () => 'vitest' });

async function newPatient(overrides = {}) {
  seq += 1;
  return Patient.create({
    tenantId: hospital._id,
    mrn: `P-${String(seq).padStart(6, '0')}`,
    careType: 'antenatal',
    fullName: 'Sample Mother',
    ageYears: 28,
    ageRecordedOn: NOW,
    pregnancy: { scanEdd: d(EDD) },
    obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
    medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
    assignedDoctor: drA._id,
    createdBy: drA._id,
    ...overrides,
  });
}
const itemByKey = (view, key) => view.items.find((i) => i.key === key);
const planOf = (p) => CarePlan.findOne({ tenantId: hospital._id, patientId: p._id, current: true });
const patchPatient = async (p, change) => {
  const fresh = await Patient.findOne({ _id: p._id, tenantId: hospital._id });
  Object.assign(fresh, change);
  await fresh.save();
  return fresh;
};
const carePlanAudits = () => AuditLog.find({ action: /^CARE_PLAN_/ }).lean();

describe('building a plan', () => {
  it('builds one Draft plan from the standard template, audits only ids, and writes nothing when nothing changed', async () => {
    const p = await newPatient();
    const { plan: view } = await getCarePlan(ctxFor(drA, 'doctor'), p._id);
    expect(view.items).toHaveLength(ANTENATAL_DRAFT.items.length);
    expect(view.template.label).toBe('Draft – not approved for clinical use');
    expect(view.gestationToday).toEqual({ weeks: 18, days: 0 });
    expect(view.bookedOn.toISOString()).toBe('2026-09-28T00:00:00.000Z'); // the build date
    expect(view.canEdit).toBe(true);
    expect(itemByKey(view, 'scan_anomaly').status).toBe('due');
    expect(view).not.toHaveProperty('basis');

    const created = await AuditLog.find({ action: 'CARE_PLAN_CREATED' }).lean();
    expect(created).toHaveLength(1);
    expect(Object.keys(created[0].details).sort()).toEqual(['mrn', 'patientId', 'planId']);

    const before = await planOf(p);
    await syncPlan(ctxFor(drA, 'doctor'), p._id);
    const after = await planOf(p);
    expect(after.__v).toBe(before.__v);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('builds no plan without dates or for other care, and one plan for two requests at once', async () => {
    const gyn = await newPatient({ careType: 'gynaecology', pregnancy: {} });
    expect((await getCarePlan(ctxFor(drA, 'doctor'), gyn._id)).reason).toBe('not_started');
    const noDates = await newPatient({ pregnancy: {} });
    expect((await getCarePlan(ctxFor(drA, 'doctor'), noDates._id)).reason).toBe('no_dates');

    const p = await newPatient();
    await Promise.all([syncPlan(ctxFor(drA, 'doctor'), p._id), syncPlan(ctxFor(rmo, 'rmo'), p._id)]);
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p._id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CREATED' })).toBe(1);
  });
});

describe('access', () => {
  it('lets nurses and other doctors view but not change, and keeps reception out', async () => {
    const p = await newPatient();
    const view = (await getCarePlan(ctxFor(nurse, 'nurse'), p._id)).plan;
    expect(view.readOnly).toBe(true);
    const item = itemByKey(view, 'scan_anomaly');
    const done = { action: 'done', rev: item.rev, on: d('2026-09-28'), elsewhere: false, result: '', note: '' };
    await expect(applyItemAction(ctxFor(nurse, 'nurse'), p._id, item.id, done)).rejects.toMatchObject({ status: 403, message: "Only the patient's doctor or an RMO can change the care plan." });
    await expect(applyItemAction(ctxFor(drB, 'doctor'), p._id, item.id, done)).rejects.toMatchObject({
      status: 403,
      message: "This is another doctor's patient: you can view the care plan but not change it.",
    });
    await expect(getCarePlan(ctxFor(reception, 'receptionist'), p._id)).rejects.toMatchObject({ status: 403, message: "Your role doesn't include care plans." });

    const sensitive = await newPatient({ sensitive: true });
    await expect(getCarePlan(ctxFor(nurse, 'nurse'), sensitive._id)).rejects.toMatchObject({ status: 403, message: expect.stringContaining('sensitive record') });
    // Another hospital's patient: not found.
    await expect(getCarePlan(ctxFor(drA, 'doctor', other), p._id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses another patient's plan id with 404", async () => {
    const a = await newPatient();
    const b = await newPatient({ sensitive: true });
    await syncPlan(ctxFor(drA, 'doctor'), b._id);
    const bPlan = await planOf(b);
    await expect(getCarePlan(ctxFor(nurse, 'nurse'), a._id, { planId: bPlan._id })).rejects.toMatchObject({ status: 404 });
    await expect(reopenCarePlan(ctxFor(drA, 'doctor'), a._id, { planId: bPlan._id })).rejects.toMatchObject({ status: 404 });
  });
});

describe('item actions', () => {
  it('marks done, treats an identical repeat as no change, and refuses a stale revision', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    const item = itemByKey((await getCarePlan(ctx, p._id)).plan, 'lab_cbc');
    const done = { action: 'done', rev: item.rev, on: d('2026-09-28'), elsewhere: false, result: 'Hb 11.2 g/dL', note: '' };
    const res = await applyItemAction(ctx, p._id, item.id, done);
    expect(res.changed).toBe(true);
    const after = itemByKey(res.plan, 'lab_cbc');
    expect(after).toMatchObject({ status: 'done', rev: item.rev + 1 });
    expect(after.done).toMatchObject({ result: 'Hb 11.2 g/dL', byName: 'Dr A' });
    expect(after.done).not.toHaveProperty('by');
    expect(res.summary.counts.done).toBe(1);

    // The same again with the OLD rev: nothing to do, no second audit entry.
    expect((await applyItemAction(ctx, p._id, item.id, done)).changed).toBe(false);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(1);
    // A different change based on the old rev: refused, naming who changed it.
    await expect(applyItemAction(ctx, p._id, item.id, { action: 'note', rev: item.rev, text: 'Fasting sample' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/^Dr A changed this item at \d\d:\d\d\./),
    });
    const entry = await AuditLog.findOne({ action: 'CARE_PLAN_CHANGED' }).lean();
    expect(entry.details).toEqual({ patientId: String(p._id), mrn: p.mrn, planId: res.plan.id, change: 'item_done', itemId: item.id });
  });

  it('checks dates and kinds against the plan', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    const view = (await getCarePlan(ctx, p._id)).plan;
    const visit = itemByKey(view, 'visit_booking');
    await expect(applyItemAction(ctx, p._id, visit.id, { action: 'done', rev: 0, on: d('2026-09-29'), elsewhere: false, result: '', note: '' })).rejects.toMatchObject({
      status: 400,
      fields: { on: "The date can't be in the future." },
    });
    await expect(applyItemAction(ctx, p._id, visit.id, { action: 'done', rev: 0, on: d('2026-09-28'), elsewhere: false, result: 'fine', note: '' })).rejects.toMatchObject({
      fields: { result: 'Results are recorded for lab tests and scans only.' },
    });
    const anomaly = itemByKey(view, 'scan_anomaly');
    await expect(applyItemAction(ctx, p._id, anomaly.id, { action: 'move', rev: 0, dueFrom: d('2026-10-20'), dueBy: null, reason: '' })).rejects.toMatchObject({
      fields: { reason: 'This date is outside the guideline window (18 w 0 d – 20 w 6 d). Please give a reason.' },
    });
    await expect(applyItemAction(ctx, p._id, anomaly.id, { action: 'move', rev: 0, dueFrom: d('2026-09-01'), dueBy: d('2026-09-20'), reason: 'Scan booked' })).rejects.toMatchObject({
      fields: { dueBy: 'Choose a date from today onwards.' },
    });
    const moved = await applyItemAction(ctx, p._id, anomaly.id, { action: 'move', rev: 0, dueFrom: d('2026-10-20'), dueBy: null, reason: 'Scan machine booked' });
    expect(itemByKey(moved.plan, 'scan_anomaly')).toMatchObject({ dateSource: 'manual', flags: ['outside_window'] });
    await expect(applyItemAction(ctx, p._id, 'aaaaaaaaaaaaaaaaaaaaaaaa', { action: 'keep', rev: 0 })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an item the automatic sync changed after it was opened', async () => {
    const p = await newPatient({ medical: { allergies: 'None known', bloodGroup: '', conditionsReviewed: true } });
    const ctx = ctxFor(drA, 'doctor');
    const antiD = itemByKey((await getCarePlan(ctx, p._id)).plan, 'anti_d');
    expect(antiD.status).toBe('check_needed');
    await patchPatient(p, { medical: { allergies: 'None known', bloodGroup: 'O-', conditionsReviewed: true } });
    await expect(applyItemAction(ctx, p._id, antiD.id, { action: 'note', rev: antiD.rev, text: 'Discussed' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('updated automatically at'),
    });
    const plan = await planOf(p);
    expect(plan.log.some((l) => l.action === 'items_apply' && l.auto)).toBe(true);
  });

  it('adds a custom item once per client request id', async () => {
    const p = await newPatient();
    const ctx = ctxFor(rmo, 'rmo');
    const body = { clientRequestId: '6f1c2c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f', kind: 'investigation', name: 'Thyroid review', patientText: '', note: '', reason: '', timing: { type: 'weeks', fromWeek: 24, toWeek: 26 } };
    const first = await addCustomItem(ctx, p._id, body);
    const again = await addCustomItem(ctx, p._id, body);
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.body.itemId).toBe(first.body.itemId);
    const view = first.body.plan.items.find((i) => i.id === first.body.itemId);
    expect(view).toMatchObject({ origin: 'custom', status: 'upcoming', rev: 0, added: { byName: 'RMO' } });
    await expect(addCustomItem(ctx, p._id, { ...body, clientRequestId: '7f1c2c1e-2b1a-4c1d-9f1e-1a2b3c4d5e6f', timing: { type: 'weeks', fromWeek: 44, toWeek: 44 } })).rejects.toMatchObject({
      fields: { 'timing.toWeek': 'The window must end between today and 43 weeks.' },
    });
  });
});

describe('patient changes reach the plan', () => {
  it('re-dates for a small EDD change and holds a large one until the doctor decides', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    await getCarePlan(ctx, p._id);
    await patchPatient(p, { pregnancy: { scanEdd: d('2027-02-23') } });
    let plan = (await getCarePlan(ctx, p._id)).plan;
    expect(plan.edd.toISOString()).toBe('2027-02-23T00:00:00.000Z');
    expect(plan.recentChanges[0].text).toMatch(/^Due dates moved: EDD changed from 1 Mar 2027 to 23 Feb 2027 \(scan EDD\)\./);

    await patchPatient(p, { pregnancy: { scanEdd: d('2027-09-20') } });
    plan = (await getCarePlan(ctx, p._id)).plan;
    expect(plan.eddReview.toEdd.toISOString()).toBe('2027-09-20T00:00:00.000Z');
    expect(itemByKey(plan, 'scan_anomaly').status).toBe('on_hold');
    await expect(decideEdd(ctx, p._id, { decision: 'same_pregnancy', toEdd: d('2027-09-21') })).rejects.toMatchObject({ status: 409 });

    // New pregnancy, then the way back from a mistaken choice.
    const oldId = plan.id;
    const res = await decideEdd(ctx, p._id, { decision: 'new_pregnancy', toEdd: d('2027-09-20') });
    expect(res.plan.replacesPlanId).toBe(oldId);
    expect(res.plan.edd.toISOString()).toBe('2027-09-20T00:00:00.000Z');
    await closeCarePlan(ctx, p._id, { reason: 'other', note: 'Chosen by mistake' });
    expect((await getCarePlan(ctx, p._id)).plan).toBeNull(); // not built again for this pregnancy
    const reopened = await reopenCarePlan(ctx, p._id, { planId: oldId });
    expect(reopened.plan.eddReview).not.toBeNull();
    const same = await decideEdd(ctx, p._id, { decision: 'same_pregnancy', toEdd: d('2027-09-20') });
    expect(same.plan).toMatchObject({ id: oldId, eddReview: null });

    // Only plan_changed entries for all of that; nothing medical.
    const changes = (await carePlanAudits()).filter((a) => a.action === 'CARE_PLAN_CHANGED');
    expect(changes.map((a) => a.details.change)).toEqual(['plan_changed', 'plan_changed', 'plan_changed', 'plan_changed']);
    expect(JSON.stringify(await carePlanAudits())).not.toMatch(/new_pregnancy|replacesPlanId|2027|Chosen by mistake/);
  });

  it('pauses when the type of care changes, still allows item changes, and resumes', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    const view = (await getCarePlan(ctx, p._id)).plan;
    await patchPatient(p, { careType: 'postnatal' });
    const paused = (await getCarePlan(ctx, p._id)).plan;
    expect(paused).toMatchObject({ status: 'paused', pausedReason: 'care_type_changed', canEdit: true, canChangePlan: false });
    const cbc = itemByKey(paused, 'lab_cbc');
    expect(cbc.status).toBe('inactive');
    await applyItemAction(ctx, p._id, cbc.id, { action: 'done', rev: cbc.rev, on: d('2026-09-28'), elsewhere: false, result: '', note: '' });
    await expect(changeBookingDate(ctx, p._id, { bookedOn: d('2026-09-01'), previousBookedOn: d(view.bookedOn.toISOString().slice(0, 10)) })).rejects.toMatchObject({
      status: 409,
      code: 'PLAN_PAUSED',
    });
    await patchPatient(p, { careType: 'antenatal' });
    const back = (await getCarePlan(ctx, p._id)).plan;
    expect(back).toMatchObject({ status: 'active', id: view.id });
    expect(itemByKey(back, 'lab_cbc').status).toBe('done');
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CREATED' })).toBe(1);
  });

  it('closes a paused plan automatically for a new pregnancy, without an audit entry', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    const first = (await getCarePlan(ctx, p._id)).plan;
    await patchPatient(p, { careType: 'postnatal' });
    await syncPlan(ctx, p._id);
    await patchPatient(p, { careType: 'antenatal', pregnancy: { scanEdd: d('2027-09-20') } });
    const { plan, earlierPlans } = await getCarePlan(ctx, p._id);
    expect(plan.replacesPlanId).toBe(first.id);
    expect(earlierPlans).toEqual([expect.objectContaining({ id: first.id, status: 'closed', closedReason: 'new_pregnancy' })]);
    expect(await AuditLog.countDocuments({ action: { $in: ['CARE_PLAN_CREATED', 'CARE_PLAN_CHANGED'] } })).toBe(1);
  });

  it('reads the patient again when a newer sync already ran, and never works the plan out from older facts', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    await syncPlan(ctx, p._id);
    // A plan synced with a version of the patient that can never be read: the sync gives up (409), untouched.
    await CarePlan.updateOne({ tenantId: hospital._id, patientId: p._id }, { $set: { 'basis.patientVersion': 99 } });
    await patchPatient(p, { pregnancy: { scanEdd: d('2027-09-20') } });
    await expect(syncPlan(ctx, p._id)).rejects.toBeInstanceOf(SyncConflict);
    const plan = await planOf(p);
    expect(plan.eddReview).toBeNull();
    expect(plan.log).toHaveLength(1);
  });

  it('keeps the results of a newer sync when an item action first read an older patient', async () => {
    const p = await newPatient(); // B+: the Rh items do not apply
    const ctx = ctxFor(drA, 'doctor');
    await getCarePlan(ctx, p._id);
    const outOfDate = await Patient.findOne({ _id: p._id, tenantId: hospital._id });
    await patchPatient(p, { medical: { allergies: 'None known', ...outOfDate.toObject().medical, bloodGroup: 'O-' } });
    const view = (await getCarePlan(ctx, p._id)).plan; // synced: the Rh items apply (risk brought up to date too)
    const stored = await planOf(p);
    const rh = (plan) => ['anti_d', 'lab_ict28'].map((k) => plan.items.find((i) => i.key === k)).map((i) => ({ applies: i.auto.applies, rev: i.rev, revByName: i.revByName }));
    expect(rh(stored).map((r) => r.applies)).toEqual(['yes', 'yes']);

    // The action's own patient read is current; the sync inside it reads the older patient (as if it had
    // read just before the newer sync saved the plan).
    const real = Patient.findOne.bind(Patient);
    let calls = 0;
    const spy = vi.spyOn(Patient, 'findOne').mockImplementation((...args) => {
      calls += 1;
      return calls === 2 ? Promise.resolve(outOfDate) : real(...args);
    });
    try {
      const cbc = itemByKey(view, 'lab_cbc');
      expect((await applyItemAction(ctx, p._id, cbc.id, { action: 'note', rev: cbc.rev, text: 'Fasting sample' })).changed).toBe(true);
    } finally {
      spy.mockRestore();
    }
    const after = await planOf(p);
    expect(rh(after)).toEqual(rh(stored)); // still apply, no rev raised, not in the acting person's name
    expect(after.log).toHaveLength(stored.log.length); // no automatic entry either
    expect(after.items.find((i) => i.key === 'lab_cbc').note).toMatchObject({ text: 'Fasting sample' });
  });
});

describe('closing and booking date', () => {
  it('makes a closed plan read-only and refuses to reopen over a current plan', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    const view = (await getCarePlan(ctx, p._id)).plan;
    const res = await closeCarePlan(ctx, p._id, { reason: 'delivered', note: '' });
    expect(res.plan).toBeNull();
    expect(res.summary).toMatchObject({ exists: false, earlierCount: 1 });
    const item = itemByKey(view, 'lab_cbc');
    await expect(applyItemAction(ctx, p._id, item.id, { action: 'keep', rev: 0 })).rejects.toMatchObject({ status: 409, code: 'PLAN_CLOSED' });
    const earlier = (await getCarePlan(ctx, p._id, { planId: view.id })).plan;
    expect(earlier).toMatchObject({ status: 'closed', readOnly: true, canReopen: true });
    expect(itemByKey(earlier, 'lab_cbc').status).toBe('inactive');

    const q = await newPatient();
    await syncPlan(ctx, q._id);
    const qOld = await planOf(q);
    await closeCarePlan(ctx, q._id, { reason: 'transferred_out', note: '' });
    await patchPatient(q, { pregnancy: { scanEdd: d('2027-12-01') } }); // a later pregnancy gets a new plan
    await syncPlan(ctx, q._id);
    await expect(reopenCarePlan(ctx, q._id, { planId: qOld._id })).rejects.toMatchObject({ status: 409, message: 'This patient already has a current care plan.' });
  });

  it('changes the booking date within 4 w 0 d and today', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    await getCarePlan(ctx, p._id);
    await expect(changeBookingDate(ctx, p._id, { bookedOn: d('2026-06-01'), previousBookedOn: d('2026-09-28') })).rejects.toMatchObject({
      fields: { bookedOn: 'The booking date must be between 4 w 0 d (22 Jun 2026) and today.' },
    });
    await expect(changeBookingDate(ctx, p._id, { bookedOn: d('2026-07-20'), previousBookedOn: d('2026-09-01') })).rejects.toMatchObject({ status: 409 });
    const res = await changeBookingDate(ctx, p._id, { bookedOn: d('2026-07-20'), previousBookedOn: d('2026-09-28') });
    expect(res.plan).toMatchObject({ bookedAt: { weeks: 8, days: 0 }, bookedOnSetByName: 'Dr A' });
    expect(itemByKey(res.plan, 'scan_nt').status).toBe('overdue'); // window closed after booking, not done
    expect((await changeBookingDate(ctx, p._id, { bookedOn: d('2026-07-20'), previousBookedOn: d('2026-09-28') })).changed).toBe(false);
  });
});

describe('protocols', () => {
  it('previews and applies a switch with the same result, and refuses a stale review', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    const view = (await getCarePlan(ctx, p._id)).plan;
    const cbc = itemByKey(view, 'lab_cbc');
    await applyItemAction(ctx, p._id, cbc.id, { action: 'done', rev: cbc.rev, on: d('2026-09-28'), elsewhere: false, result: '', note: '' });
    const std = await CarePlanTemplate.findOne({ tenantId: hospital._id, kind: 'standard' });
    const mine = await CarePlanTemplate.create({
      tenantId: hospital._id,
      careType: 'antenatal',
      kind: 'personal',
      owner: drA._id,
      ownerName: 'Dr A',
      name: 'Dr A protocol',
      items: [...std.items.filter((i) => i.key !== 'lab_cbc' && i.key !== 'adv_diet').map((i) => i.toObject()), { key: 'lab_vitd', kind: 'investigation', name: 'Vitamin D', atBooking: true }],
    });
    const options = await templateOptions(ctx, p._id);
    expect(options.templates.map((t) => t.name)).toEqual(['Dr A protocol', std.name]);
    expect(options.templates[1].inUse).toBe(true);

    const preview = await previewTemplate(ctx, p._id, mine._id);
    expect(preview.added.map((a) => a.key)).toEqual(['lab_vitd']);
    expect(preview.kept.map((k) => k.itemId)).toEqual([cbc.id]); // done: kept as not in the template
    expect(preview.dropped).toHaveLength(1); // untouched advice item
    await expect(applyTemplate(ctx, p._id, { templateId: String(mine._id), fromItemsHash: preview.from.itemsHash, toItemsHash: itemsHash(std.items) })).rejects.toMatchObject({ status: 409 });
    const res = await applyTemplate(ctx, p._id, { templateId: String(mine._id), fromItemsHash: preview.from.itemsHash, toItemsHash: preview.to.itemsHash });
    expect(res.plan.template).toMatchObject({ name: 'Dr A protocol', label: 'Draft – not approved for clinical use' });
    expect(res.plan.items.map((i) => i.key).sort()).toEqual([...preview.added.map((a) => a.key), ...ANTENATAL_DRAFT.items.map((i) => i.key).filter((k) => k !== 'adv_diet')].sort());
    expect(itemByKey(res.plan, 'lab_cbc')).toMatchObject({ status: 'done', notInTemplate: { templateName: 'Dr A protocol' } });

    // Another doctor's protocol: not allowed.
    const theirs = await CarePlanTemplate.create({ tenantId: hospital._id, careType: 'antenatal', kind: 'personal', owner: drB._id, ownerName: 'Dr B', name: 'Dr B protocol', items: mine.items.map((i) => i.toObject()) });
    await expect(previewTemplate(ctx, p._id, theirs._id)).rejects.toMatchObject({ status: 403 });
  });
});

describe('template approvals', () => {
  it('approves only the reviewed version: a change saved in between gives 409', async () => {
    const s = await loginAs(drA);
    const std = await CarePlanTemplate.findOne({ tenantId: hospital._id, kind: 'standard' });
    // Someone saves an edit just after the approve request read the template (version 1).
    const updateOne = CarePlanTemplate.updateOne.bind(CarePlanTemplate);
    const spy = vi.spyOn(CarePlanTemplate, 'updateOne').mockImplementation(async (filter, update, ...rest) => {
      if (update?.$set?.status === 'approved') await updateOne({ _id: std._id, tenantId: hospital._id }, { $inc: { version: 1 } });
      return updateOne(filter, update, ...rest);
    });
    try {
      const res = await s.post(`/api/care-plans/templates/${std._id}/approve`).send({ confirm: true, version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/now version 2/);
    } finally {
      spy.mockRestore();
    }
    const after = await CarePlanTemplate.findOne({ _id: std._id, tenantId: hospital._id });
    expect(after).toMatchObject({ status: 'draft', approvals: [] });
  });

  it('records approvals, so plans are approved by content, and backfills older approvals', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    await getCarePlan(ctx, p._id);
    const s = await loginAs(drA);
    const std = await CarePlanTemplate.findOne({ tenantId: hospital._id, kind: 'standard' });
    expect((await s.post(`/api/care-plans/templates/${std._id}/approve`).send({ confirm: true, version: std.version })).status).toBe(200);
    const approved = await CarePlanTemplate.findOne({ _id: std._id, tenantId: hospital._id });
    expect(approved.approvals).toHaveLength(1);
    expect(approved.approvals[0]).toMatchObject({ version: std.version, itemsHash: itemsHash(std.items), byName: 'Dr A' });
    expect((await getCarePlan(ctx, p._id)).plan.template).toMatchObject({ approved: true, label: null, approvedVersion: std.version });

    // A template approved before approvals were recorded: an edit keeps that approval.
    await CarePlanTemplate.updateOne({ _id: std._id, tenantId: hospital._id }, { $set: { approvals: [] } });
    const body = { version: approved.version, name: approved.name, description: approved.description, sources: approved.sources, items: approved.items.map((i) => i.toObject()), riskRules: approved.riskRules.map((r) => ({ ...r.toObject(), label: `${r.label} (edited)` })) };
    expect((await s.put(`/api/care-plans/templates/${std._id}`).send(body)).status).toBe(200);
    const edited = await CarePlanTemplate.findOne({ _id: std._id, tenantId: hospital._id });
    expect(edited).toMatchObject({ status: 'draft' });
    expect(edited.approvals).toHaveLength(1);
    const t = (await getCarePlan(ctx, p._id)).plan.template;
    // Items unchanged: the content stays approved. The Doppler (high-risk only) depends on the edited rules.
    expect(t).toMatchObject({ approvedVersion: std.version, updateAvailable: false, approved: false, draftReason: 'risk_rules' });
  });

  it('refuses template loops, self-references and words about the baby\'s sex', async () => {
    const s = await loginAs(drA);
    const mine = (await s.post('/api/care-plans/templates').send({ careType: 'antenatal', name: 'My protocol' })).body.template;
    const item = (key, after) => ({ key, kind: 'visit', name: `Visit ${key}`, after: { key: after, weeks: 2 } });
    const loop = await s.put(`/api/care-plans/templates/${mine.id}`).send({ version: mine.version, name: 'My protocol', items: [item('a', 'b'), item('b', 'a')] });
    expect(loop.status).toBe(400);
    expect(loop.body.error.fields['items.0.after.key']).toBe('Item "a" is timed after itself (through "b").');
    const self = await s.put(`/api/care-plans/templates/${mine.id}`).send({ version: mine.version, name: 'My protocol', items: [item('a', 'a')] });
    expect(self.body.error.fields['items.0.after.key']).toBe('Item "a" is timed after itself.');
    const sex = await s.put(`/api/care-plans/templates/${mine.id}`).send({ version: mine.version, name: 'My protocol', items: [{ key: 'x', kind: 'advice', name: 'Ladki ya ladka', atBooking: true }] });
    expect(sex.status).toBe(400);
    expect(sex.body.error.fields['items.0.name']).toMatch(/PCPNDT/);
    const stale = await s.put(`/api/care-plans/templates/${mine.id}`).send({ name: 'My protocol', version: 7, items: [] });
    expect(stale.status).toBe(409);
  });
});

describe('plan log', () => {
  it('keeps the newest 100 automatic entries and every entry made by a person', () => {
    const plan = new CarePlan({ log: [] });
    for (let i = 0; i < 150; i += 1) {
      plan.log.push({ at: NOW, byName: 'Automatic', action: 'items_apply', text: `auto ${i}`, auto: true });
      if (i % 10 === 0) plan.log.push({ at: NOW, byName: 'Dr A', action: 'booking_date', text: `person ${i}`, auto: false });
    }
    trimAutoLog(plan);
    expect(plan.log.filter((l) => l.auto)).toHaveLength(100);
    expect(plan.log.filter((l) => l.auto)[0].text).toBe('auto 50');
    expect(plan.log.filter((l) => !l.auto)).toHaveLength(15);
  });

  it('gives up with a 409 SyncConflict type, never a server error', () => {
    expect(new SyncConflict()).toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('gives up after 3 tries with a 409, and a read still answers with the plan worked out in memory', async () => {
    const p = await newPatient();
    const ctx = ctxFor(drA, 'doctor');
    const first = await getCarePlan(ctx, p._id); // builds the plan (B+: the Rh items do not apply)
    await Patient.updateOne({ _id: p._id, tenantId: hospital._id }, { $set: { 'medical.bloodGroup': 'O-' } }); // same __v: the sync must write
    const stored = await planOf(p);
    const clash = Object.assign(new Error('No matching document found'), { name: 'VersionError' });
    const save = vi.spyOn(CarePlan.prototype, 'save').mockRejectedValue(clash);
    try {
      await expect(syncPlan(ctx, p._id)).rejects.toBeInstanceOf(SyncConflict);
      expect(save).toHaveBeenCalledTimes(3);
      const read = await getCarePlan(ctx, p._id); // the read does not fail
      expect(itemByKey(first.plan, 'anti_d').applies).toBe('no');
      expect(itemByKey(read.plan, 'anti_d').applies).toBe('yes'); // worked out in memory with O-
    } finally {
      save.mockRestore();
    }
    const after = await planOf(p);
    expect(after.__v).toBe(stored.__v); // nothing was saved
    expect(after.basis.patientVersion).toBe(stored.basis.patientVersion);
    expect(JSON.stringify(after.toObject().items)).toBe(JSON.stringify(stored.toObject().items));
  });
});
