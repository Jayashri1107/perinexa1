// Care plans (5 Oct 2026): a doctor's default protocol, a new approved template version for all its plans at once,
// editing an item a doctor added, and "used by N current plans". Fake data only. Time is pinned (Date only): 28 Sep
// 2026, 11:30 in India; the sample patients' scan EDD is 1 Mar 2027 (18 w 0 d today).
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { Membership } from '../src/models/Membership.js';
import { Patient } from '../src/models/Patient.js';
import { PCPNDT_MESSAGE } from '../src/utils/pcpndt.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // 11:30 in India
const EDD = '2027-03-01';

const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', admin: 'admin' };
const NAMES = { drA: 'Dr A', drB: 'Dr B', rmo: 'RMO Sample', nurse: 'Nurse Sample', reception: 'Reception Sample', admin: 'Admin Sample' };

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
  hospital = await createTenant('Protocol Hospital');
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
const T = '/api/care-plans/templates';

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

const url = (p, path = '') => `/api/patients/${p.id}/care-plan${path}`;
async function planOf(who, p) {
  const res = await (await as(who)).get(url(p));
  expect(res.status).toBe(200);
  return res.body.plan;
}
const item = (plan, key) => plan.items.find((i) => i.key === key);
const act = async (who, p, it, body) => (await as(who)).patch(url(p, `/items/${it.id}`)).send({ rev: it.rev, ...body });

const standard = (tenant = hospital) => CarePlanTemplate.findOne({ tenantId: tenant._id, careType: 'antenatal', kind: 'standard' });
const stored = (id) => CarePlanTemplate.findOne({ tenantId: hospital._id, _id: id });
const approve = async (who, t) => (await as(who)).post(`${T}/${t._id ?? t.id}/approve`).send({ confirm: true, version: t.version });
const page = async (who, id) => (await as(who)).get(`${T}/${id}`);
const templateBody = (t, change = {}) => ({
  version: t.version,
  name: t.name,
  description: t.description,
  sources: t.sources,
  items: t.items.map((i) => (typeof i.toObject === 'function' ? i.toObject() : i)),
  ...(t.riskRules ? { riskRules: t.riskRules.map((r) => (typeof r.toObject === 'function' ? r.toObject() : r)) } : {}),
  ...change,
});

// Dr A's own protocol copied from the standard template, renamed, with one item more (approved unless told not to).
async function protocolOf(who = 'drA', { name = 'Dr A antenatal protocol', approved = true, extra = true } = {}) {
  const std = await standard();
  const created = await (await as(who)).post(T).send({ copyFrom: String(std._id), name });
  expect(created.status).toBe(201);
  let t = await stored(created.body.template.id);
  if (extra) {
    const items = [...t.items.map((i) => i.toObject()), { key: 'lab_vitd', kind: 'investigation', name: 'Vitamin D level', atBooking: true }];
    expect((await (await as(who)).put(`${T}/${t._id}`).send(templateBody(t, { items }))).status).toBe(200);
    t = await stored(t._id);
  }
  if (approved) {
    expect((await approve(who, t)).status).toBe(200);
    t = await stored(t._id);
  }
  return t;
}
const makeDefault = async (who, t) => (await as(who)).put(`${T}/${t._id}/default`).send({ version: t.version });

// A new approved version of the standard template: the TSH test renamed and one new item.
async function newStandardVersion(who = 'drA') {
  const v = await standard();
  const items = v.items.map((i) => i.toObject()).map((i) => (i.key === 'lab_tsh' ? { ...i, name: 'Thyroid test (TSH and free T4)' } : i));
  items.push({ key: 'lab_vitd', kind: 'investigation', name: 'Vitamin D level', atBooking: true });
  expect((await (await as(who)).put(`${T}/${v._id}`).send(templateBody(v, { items }))).status).toBe(200);
  const next = await standard();
  expect((await approve(who, next)).status).toBe(200);
  return standard();
}

// ---------- (a) A doctor's default protocol ----------

describe("a doctor's default protocol", () => {
  it('new plans of her patients start from it; other doctors\' and unassigned patients from the standard; existing plans never change', async () => {
    const before = await register('drA'); // built before the default was chosen
    const mine = await protocolOf('drA');
    const res = await makeDefault('drA', mine);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: true, template: { ownerDefault: true, defaultState: 'in_use', canSetDefault: true } });

    const p = await register('rmo'); // assigned to Dr A, registered by the RMO
    const plan = await planOf('drA', p);
    // Its content is approved; the high-risk items still follow the hospital's risk rules, a draft here
    expect(plan.template).toMatchObject({ id: String(mine._id), name: 'Dr A antenatal protocol', kind: 'personal', ownerName: 'Dr A', approvedVersion: mine.version, draftReason: 'risk_rules' });
    expect(item(plan, 'lab_vitd')).toBeTruthy();
    expect(plan.log.at(-1)).toMatchObject({ action: 'created', auto: true, text: 'Plan built from “Dr A antenatal protocol” version 2 – the default protocol of Dr A' });

    const theirs = await register('drB', { assignedDoctor: people.drB._id.toString() });
    expect((await planOf('drB', theirs)).template.kind).toBe('standard');
    const nobody = await register('drA', { assignedDoctor: null });
    expect((await planOf('drA', nobody)).template.kind).toBe('standard');
    const old = await planOf('drA', before);
    expect(old.template.kind).toBe('standard');
    expect(item(old, 'lab_vitd')).toBeUndefined();

    // Removing the default changes no plan either; new plans start from the standard again
    const removed = await (await as('drA')).delete(`${T}/${mine._id}/default`);
    expect(removed.status).toBe(200);
    expect(removed.body.template).toMatchObject({ ownerDefault: false, defaultState: null });
    expect((await planOf('drA', p)).template.id).toBe(String(mine._id));
    expect((await planOf('drA', await register('drA'))).template.kind).toBe('standard');
    expect((await (await as('drA')).delete(`${T}/${mine._id}/default`)).body.changed).toBe(false);
  });

  it('a draft protocol cannot be a default; a default edited into a draft is kept but not used (new plans: standard), and the page says why', async () => {
    const draft = await protocolOf('drA', { approved: false });
    const refused = await makeDefault('drA', draft);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toBe('A draft protocol cannot be your default. Approve it first.');

    const mine = await protocolOf('drA', { name: 'Dr A second protocol' });
    expect((await makeDefault('drA', mine)).status).toBe(200);
    // Edited: a draft again
    const items = mine.items.map((i) => i.toObject()).filter((i) => i.key !== 'visit_41');
    expect((await (await as('drA')).put(`${T}/${mine._id}`).send(templateBody(mine, { items }))).status).toBe(200);
    const shown = (await page('drA', mine._id)).body.template;
    expect(shown).toMatchObject({ status: 'draft', ownerDefault: true, defaultState: 'draft' });
    const listed = (await (await as('drA')).get(T)).body.templates.find((t) => t.id === String(mine._id));
    expect(listed).toMatchObject({ ownerDefault: true, defaultState: 'draft' });
    expect((await planOf('drA', await register('drA'))).template.kind).toBe('standard');
    // Approved again: in use again
    expect((await approve('drA', await stored(mine._id))).status).toBe(200);
    expect((await page('drA', mine._id)).body.template.defaultState).toBe('in_use');
    expect((await planOf('drA', await register('drA'))).template.id).toBe(String(mine._id));
  });

  it('is not used once its doctor no longer works here as a doctor', async () => {
    const mine = await protocolOf('drA');
    expect((await makeDefault('drA', mine)).status).toBe(200);
    // Registered for Dr A without pregnancy dates (no plan yet); Dr A then leaves; the RMO adds the dates
    const res = await (await as('reception')).post('/api/patients').send(samplePatient({ careType: 'antenatal', ageYears: 28, assignedDoctor: people.drA._id.toString() }));
    expect(res.status).toBe(201);
    const p = res.body.patient;
    await Membership.updateOne({ tenantId: hospital._id, userId: people.drA._id }, { $set: { isActive: false } });
    expect((await page('drB', mine._id)).body.template.defaultState).toBe('owner_inactive');
    expect((await (await as('rmo')).patch(`/api/patients/${p.id}`).send({ pregnancy: { lmp: '2026-05-25', scanEdd: '' } })).status).toBe(200);
    expect((await planOf('rmo', p)).template.kind).toBe('standard');
  });

  it('one default per doctor and type of care: choosing another replaces it (audited with ids and the protocol name only)', async () => {
    const first = await protocolOf('drA', { name: 'Dr A first protocol' });
    const second = await protocolOf('drA', { name: 'Dr A second protocol' });
    expect((await makeDefault('drA', first)).status).toBe(200);
    expect((await makeDefault('drA', first)).body.changed).toBe(false); // the same again: nothing to do
    expect((await makeDefault('drA', second)).status).toBe(200);
    expect(await CarePlanTemplate.countDocuments({ tenantId: hospital._id, owner: people.drA._id, ownerDefault: true })).toBe(1);
    expect((await stored(second._id)).ownerDefault).toBe(true);
    // Choosing a default is not a change of the protocol: its version and "last changed" stay
    expect((await stored(second._id)).version).toBe(second.version);
    expect((await stored(second._id)).updatedAt.getTime()).toBe(second.updatedAt.getTime());

    const audits = await AuditLog.find({ action: { $in: ['TEMPLATE_DEFAULT_SET', 'TEMPLATE_DEFAULT_REMOVED'] } }).sort({ _id: 1 }).lean();
    expect(audits.map((a) => a.action)).toEqual(['TEMPLATE_DEFAULT_SET', 'TEMPLATE_DEFAULT_SET']);
    expect(audits[1].details).toEqual({ templateId: String(second._id), name: 'Dr A second protocol', version: second.version, careType: 'antenatal', replacedTemplateId: String(first._id) });
    await (await as('drA')).delete(`${T}/${second._id}/default`);
    expect(await AuditLog.countDocuments({ action: 'TEMPLATE_DEFAULT_REMOVED' })).toBe(1);
  });

  it('a default that cannot be set at the last moment (edited into a draft in another tab) leaves the earlier default as it was', async () => {
    const first = await protocolOf('drA', { name: 'Dr A first protocol' });
    const second = await protocolOf('drA', { name: 'Dr A second protocol' });
    expect((await makeDefault('drA', first)).status).toBe(200);
    const real = CarePlanTemplate.updateOne.bind(CarePlanTemplate);
    let edited = false;
    vi.spyOn(CarePlanTemplate, 'updateOne').mockImplementation(async (filter, update, options) => {
      if (!edited && String(filter._id) === String(second._id) && filter.status === 'approved') {
        edited = true; // the same doctor saves an edit of the second protocol at this moment: a new draft version
        await CarePlanTemplate.collection.updateOne({ _id: second._id }, { $set: { status: 'draft' }, $inc: { version: 1 } });
      }
      return real(filter, update, options);
    });
    const res = await makeDefault('drA', second);
    vi.restoreAllMocks();
    expect(edited).toBe(true);
    expect(res.status).toBe(409);
    expect([(await stored(first._id)).ownerDefault, (await stored(second._id)).ownerDefault]).toEqual([true, false]);
    // Nothing changed, so nothing new in the audit log; new plans of her patients still start from the first
    expect(await AuditLog.countDocuments({ action: { $in: ['TEMPLATE_DEFAULT_SET', 'TEMPLATE_DEFAULT_REMOVED'] } })).toBe(1);
    expect((await planOf('drA', await register('drA'))).template.id).toBe(String(first._id));
  });

  it('only the doctor who owns the protocol; never the standard template; another hospital gets 404; an older version 409', async () => {
    const mine = await protocolOf('drA');
    for (const who of ['drB', 'rmo', 'nurse']) {
      const res = await makeDefault(who, mine);
      expect(res.status, who).toBe(403);
      expect((await (await as(who)).delete(`${T}/${mine._id}/default`)).status, who).toBe(403);
    }
    expect((await page('drB', mine._id)).body.template.canSetDefault).toBe(false);
    expect((await (await as('reception')).put(`${T}/${mine._id}/default`).send({ version: mine.version })).status).toBe(403);
    const std = await standard();
    expect((await makeDefault('drA', std)).status).toBe(400);
    expect((await (await as('outsider')).put(`${T}/${mine._id}/default`).send({ version: mine.version })).status).toBe(404);
    const stale = await (await as('drA')).put(`${T}/${mine._id}/default`).send({ version: mine.version - 1 });
    expect(stale.status).toBe(409);
    expect((await (await as('drA')).put(`${T}/${mine._id}/default`).send({ version: mine.version, ownerDefault: true })).status).toBe(400); // strict
    expect(await CarePlanTemplate.countDocuments({ tenantId: hospital._id, ownerDefault: true })).toBe(0);
  });

  it('the protocol choice on a plan marks the assigned doctor\'s default', async () => {
    const mine = await protocolOf('drA');
    await makeDefault('drA', mine);
    const p = await register('drA', { assignedDoctor: null });
    const options = await (await as('drA')).get(url(p, '/template-options'));
    expect(options.body.templates.find((t) => t.id === String(mine._id))).toMatchObject({ ownerDefault: true, defaultState: 'in_use', owner: String(people.drA._id) });
    expect(options.body.templates.find((t) => t.kind === 'standard')).toMatchObject({ ownerDefault: false, defaultState: null });
    // Edited into a draft: still her default, but not in use – the choice says so
    const items = mine.items.map((i) => i.toObject()).filter((i) => i.key !== 'visit_41');
    expect((await (await as('drA')).put(`${T}/${mine._id}`).send(templateBody(mine, { items }))).status).toBe(200);
    const after = await (await as('drA')).get(url(p, '/template-options'));
    expect(after.body.templates.find((t) => t.id === String(mine._id))).toMatchObject({ ownerDefault: true, defaultState: 'draft' });
  });
});

// ---------- (b) A new approved version for all plans ----------

describe('a new approved template version for all its plans', () => {
  it('previews counts, then moves every plan this doctor may change, keeping what staff recorded; audited per plan as a single update', async () => {
    await approve('drA', await standard());
    const a1 = await register('drA');
    const a2 = await register('drA', { assignedDoctor: null });
    const b1 = await register('drB', { assignedDoctor: people.drB._id.toString() });
    const closed = await register('drA');
    let plan = await planOf('drA', a1);
    expect((await act('drA', a1, item(plan, 'lab_cbc'), { action: 'done', on: '2026-09-28', result: 'Hb 11.2 g/dL' })).status).toBe(200);
    plan = await planOf('drA', a1);
    expect((await act('drA', a1, item(plan, 'lab_tsh'), { action: 'move', dueFrom: '2026-10-05', dueBy: '2026-10-11', reason: 'Report awaited from outside lab' })).status).toBe(200);
    expect((await (await as('drA')).post(url(closed, '/close')).send({ reason: 'transferred_out' })).status).toBe(200);

    const decisions = async () => new Map((await (await as('drA')).get('/api/worklist?scope=all')).body.carePlan.map((r) => [r.patient.id, r.counts.needsDecision]));
    const decisionsBefore = await decisions();
    const v2 = await newStandardVersion();
    const shown = (await page('drA', v2._id)).body.template;
    expect(shown).toMatchObject({ usedBy: 3, olderVersion: 3, canUpdatePlans: true });
    expect((await page('drB', v2._id)).body.template.canUpdatePlans).toBe(true); // any doctor may change the standard template
    expect((await page('rmo', v2._id)).body.template.canUpdatePlans).toBe(false);

    const preview = await (await as('drA')).get(`${T}/${v2._id}/plans-update`);
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      template: { id: String(v2._id), name: v2.name, careType: 'antenatal', version: v2.version, itemsHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      plans: { behind: 3, toUpdate: 2, later: 0, otherDoctors: 1, notUsable: 0, paused: 0, fromVersions: [{ version: 1, plans: 2 }] },
      items: { added: 2, changed: 2, removed: 0, kept: 0, needsDecision: 0, plansWithPossibleDuplicates: 2 }, // the vitamin D test beside the booking tests: each plan is told to check it
    });
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(3); // done, moved, closed: the preview is not audited
    const auditsBefore = await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' });

    expect(v2.version).toBe(2);
    const done = await (await as('drA')).post(`${T}/${v2._id}/plans-update`).send({ version: v2.version, itemsHash: preview.body.template.itemsHash });
    expect(done.status).toBe(200);
    expect(done.body.result).toEqual({ updated: 2, withPossibleDuplicates: 2, alreadyUpdated: 0, notUpdated: 0, failed: 0, otherDoctors: 1, notUsable: 0, paused: 0, remaining: 0 });
    expect(done.body.template).toMatchObject({ usedBy: 3, olderVersion: 1 });

    const moved = await planOf('drA', a1);
    expect(moved.template).toMatchObject({ version: 2, approved: true, updateAvailable: false });
    expect(item(moved, 'lab_cbc')).toMatchObject({ status: 'done', done: { result: 'Hb 11.2 g/dL' } });
    expect(item(moved, 'lab_tsh')).toMatchObject({ name: 'Thyroid test (TSH and free T4)', manualDate: { reason: 'Report awaited from outside lab' } });
    expect(moved.log[0]).toMatchObject({
      action: 'template_updated',
      byName: 'Dr A',
      auto: false,
      text: `Updated to “${v2.name}” version 2 – with every plan of this protocol. 1 added item may repeat another: marked “May repeat” to check.`,
    });
    // The pair the preview only counted is on each plan: the added test is marked with the one it may repeat, and is
    // counted as needing a decision (Today's "Care plan to act on" lists the patient) – still due, never held back
    const vitd = item(moved, 'lab_vitd');
    expect(vitd).toMatchObject({ flags: ['possible_duplicate'], possibleDuplicate: { withItemId: expect.any(String), withName: expect.any(String) } });
    expect(['due', 'upcoming', 'overdue']).toContain(vitd.status);
    const partner = moved.items.find((i) => i.id === vitd.possibleDuplicate.withItemId);
    expect(partner).toMatchObject({ kind: 'investigation', name: vitd.possibleDuplicate.withName });
    const decisionsAfter = await decisions();
    for (const p of [a1, a2]) expect(decisionsAfter.get(p.id), p.id).toBe((decisionsBefore.get(p.id) ?? 0) + 1);
    // Kept as planned: the mark is answered (in the item's history); on the other plan, the test it may repeat is marked not needed
    const kept = await act('drA', a1, vitd, { action: 'keep' });
    expect(kept.status).toBe(200);
    expect(item(kept.body.plan, 'lab_vitd')).toMatchObject({ flags: [], possibleDuplicate: null });
    expect(item(kept.body.plan, 'lab_vitd').history.at(-1)).toMatchObject({ action: 'keep', byName: 'Dr A', from: { possibleDuplicate: { withName: partner.name } } });
    const other = await planOf('drA', a2);
    const otherPartner = other.items.find((i) => i.id === item(other, 'lab_vitd').possibleDuplicate.withItemId);
    const answered = await act('drA', a2, otherPartner, { action: 'not_needed', reasonCode: 'covered', reason: '' });
    expect(answered.status).toBe(200);
    expect(item(answered.body.plan, 'lab_vitd').flags).toEqual([]);
    expect((await decisions()).get(a2.id) ?? 0).toBe(decisionsBefore.get(a2.id) ?? 0);
    expect((await planOf('drA', a2)).template.version).toBe(2);
    expect((await planOf('drB', b1)).template.version).toBe(1); // another doctor's patient: her own doctor updates it
    const closedPlan = await CarePlan.findOne({ tenantId: hospital._id, patientId: closed.id });
    expect(closedPlan).toMatchObject({ current: false, source: { version: 1 } });

    // One entry per plan moved, exactly as a single update: ids only, never the template
    const audits = await AuditLog.find({ action: 'CARE_PLAN_CHANGED' }).sort({ _id: 1 }).lean();
    const [added, answeredAfter] = [audits.slice(auditsBefore, auditsBefore + 2), audits.slice(auditsBefore + 2)];
    expect(added).toHaveLength(2);
    expect(answeredAfter.map((a) => a.details.change)).toEqual(['item_kept', 'item_not_needed']); // the two answers above
    for (const a of added) {
      expect(Object.keys(a.details).sort()).toEqual(['change', 'mrn', 'patientId', 'planId']);
      expect(a.details.change).toBe('plan_changed');
      expect(JSON.stringify(a.details)).not.toMatch(/Standard|antenatal|template|version/i);
    }
    expect(added.map((a) => a.details.patientId).sort()).toEqual([a1.id, a2.id].sort());

    // Dr B then moves her own patient's plan
    const previewB = await (await as('drB')).get(`${T}/${v2._id}/plans-update`);
    expect(previewB.body.plans).toMatchObject({ behind: 3 - 2, toUpdate: 1, otherDoctors: 0 });
    const doneB = await (await as('drB')).post(`${T}/${v2._id}/plans-update`).send({ version: 2, itemsHash: previewB.body.template.itemsHash });
    expect(doneB.body.result).toMatchObject({ updated: 1, otherDoctors: 0 });
    expect(doneB.body.template.olderVersion).toBe(0);
    // Nothing left: a second run does nothing
    const again = await (await as('drB')).post(`${T}/${v2._id}/plans-update`).send({ version: 2, itemsHash: previewB.body.template.itemsHash });
    expect(again.body.result).toEqual({ updated: 0, withPossibleDuplicates: 0, alreadyUpdated: 0, notUpdated: 0, failed: 0, otherDoctors: 0, notUsable: 0, paused: 0, remaining: 0 });
  });

  it('only an approved version; a version changed since the preview is refused; who may do it; another hospital 404', async () => {
    await approve('drA', await standard());
    await register('drA');
    const v2 = await newStandardVersion();
    for (const who of ['rmo', 'nurse']) {
      expect((await (await as(who)).get(`${T}/${v2._id}/plans-update`)).status, who).toBe(403);
      expect((await (await as(who)).post(`${T}/${v2._id}/plans-update`).send({ version: 2, itemsHash: 'a'.repeat(64) })).status, who).toBe(403);
    }
    expect((await (await as('reception')).get(`${T}/${v2._id}/plans-update`)).status).toBe(403);
    expect((await (await as('outsider')).get(`${T}/${v2._id}/plans-update`)).status).toBe(404);
    const preview = (await (await as('drA')).get(`${T}/${v2._id}/plans-update`)).body;
    const stale = await (await as('drA')).post(`${T}/${v2._id}/plans-update`).send({ version: 2, itemsHash: 'a'.repeat(64) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toBe('This template was changed (now version 2) after you opened it. Please review the plans to update again.');
    expect((await (await as('drA')).post(`${T}/${v2._id}/plans-update`).send({ version: 2, itemsHash: preview.template.itemsHash, extra: 1 })).status).toBe(400);

    // Edited again: a draft – nothing can be applied to all plans until it is approved
    const v3 = await standard();
    const items = v3.items.map((i) => i.toObject()).filter((i) => i.key !== 'lab_vitd');
    expect((await (await as('drA')).put(`${T}/${v3._id}`).send(templateBody(v3, { items }))).status).toBe(200);
    const draft = await (await as('drA')).get(`${T}/${v2._id}/plans-update`);
    expect(draft.status).toBe(409);
    expect(draft.body.error.message).toBe('Only an approved version can be applied to all plans. Approve this version first.');
    expect((await page('drA', v2._id)).body.template.canUpdatePlans).toBe(false);
    expect((await (await as('drA')).post(`${T}/${v2._id}/plans-update`).send({ version: 3, itemsHash: preview.template.itemsHash })).status).toBe(409);
    expect((await CarePlan.findOne({ tenantId: hospital._id, current: true })).source.version).toBe(1);
  });

  it("a doctor's protocol: its own doctor only; a paused plan and a closed record are left as they are", async () => {
    const mine = await protocolOf('drA');
    await makeDefault('drA', mine);
    const p1 = await register('drA');
    const p2 = await register('drA');
    const dead = await register('drA');
    await Patient.updateOne({ tenantId: hospital._id, _id: dead.id }, { $set: { death: { on: new Date('2026-09-27T00:00:00Z'), byName: 'Dr A', at: NOW } } });
    await CarePlan.updateOne({ tenantId: hospital._id, patientId: p2.id, current: true }, { $set: { status: 'paused', pausedReason: 'no_edd' } });

    const items = mine.items.map((i) => i.toObject()).map((i) => (i.key === 'lab_vitd' ? { ...i, name: 'Vitamin D (25-OH) level' } : i));
    expect((await (await as('drA')).put(`${T}/${mine._id}`).send(templateBody(mine, { items }))).status).toBe(200);
    expect((await approve('drA', await stored(mine._id))).status).toBe(200);
    const v = await stored(mine._id);

    expect((await (await as('drB')).get(`${T}/${v._id}/plans-update`)).status).toBe(403);
    expect((await page('drB', v._id)).body.template.canUpdatePlans).toBe(false);
    // The paused plan is a current plan (counted, as in the preview); the closed record is not
    expect((await page('drA', v._id)).body.template).toMatchObject({ usedBy: 2, olderVersion: 2 });
    expect((await (await as('drA')).get(T)).body.templates.find((x) => x.id === String(v._id)).usedBy).toBe(2);

    const preview = (await (await as('drA')).get(`${T}/${v._id}/plans-update`)).body;
    expect(preview.plans).toMatchObject({ behind: 2, toUpdate: 1, paused: 1, otherDoctors: 0, notUsable: 0 });
    expect(preview.items).toMatchObject({ added: 0, changed: 1 });
    const done = (await (await as('drA')).post(`${T}/${v._id}/plans-update`).send({ version: v.version, itemsHash: preview.template.itemsHash })).body.result;
    expect(done).toMatchObject({ updated: 1, paused: 1 });
    const plans = await CarePlan.find({ tenantId: hospital._id, patientId: { $in: [p1.id, p2.id, dead.id] } }).lean();
    const version = (id) => plans.find((p) => String(p.patientId) === id).source.version;
    expect([version(p1.id), version(p2.id), version(dead.id)]).toEqual([v.version, mine.version, mine.version]);
  });
});

describe("a new approved version: who may move a protocol's plans, and the plans that cannot be moved", () => {
  // Dr A's default protocol, two of her patients' plans built from it, then a new approved version of it
  async function protocolWithPlans() {
    const mine = await protocolOf('drA');
    await makeDefault('drA', mine);
    const [p1, p2] = [await register('drA'), await register('drA')];
    const items = mine.items.map((i) => i.toObject()).map((i) => (i.key === 'lab_vitd' ? { ...i, name: 'Vitamin D (25-OH) level' } : i));
    expect((await (await as('drA')).put(`${T}/${mine._id}`).send(templateBody(mine, { items }))).status).toBe(200);
    expect((await approve('drA', await stored(mine._id))).status).toBe(200);
    return { v: await stored(mine._id), p1, p2 };
  }

  it('its doctor only while they work here as a doctor: an owner now an RMO (or a nurse) can neither preview nor update', async () => {
    const { v } = await protocolWithPlans();
    expect((await page('drA', v._id)).body.template).toMatchObject({ mayUpdatePlans: true, canUpdatePlans: true });
    for (const roles of [['rmo'], ['nurse']]) {
      await Membership.updateOne({ tenantId: hospital._id, userId: people.drA._id }, { $set: { roles } });
      expect((await (await as('drA')).get(`${T}/${v._id}/plans-update`)).status, roles[0]).toBe(403);
      expect((await (await as('drA')).post(`${T}/${v._id}/plans-update`).send({ version: v.version, itemsHash: 'a'.repeat(64) })).status, roles[0]).toBe(403);
      expect((await page('drA', v._id)).body.template, roles[0]).toMatchObject({ mayUpdatePlans: false, canUpdatePlans: false });
    }
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, current: true, 'source.version': v.version })).toBe(0);
  });

  it("a plan whose patient now has another doctor is counted apart: that doctor cannot use the protocol, but can switch the plan", async () => {
    const { v, p1, p2 } = await protocolWithPlans();
    await Patient.updateOne({ tenantId: hospital._id, _id: p2.id }, { $set: { assignedDoctor: people.drB._id } });

    const preview = (await (await as('drA')).get(`${T}/${v._id}/plans-update`)).body;
    expect(preview.plans).toMatchObject({ behind: 2, toUpdate: 1, otherDoctors: 0, notUsable: 1, paused: 0 });
    const done = (await (await as('drA')).post(`${T}/${v._id}/plans-update`).send({ version: v.version, itemsHash: preview.template.itemsHash })).body.result;
    expect(done).toMatchObject({ updated: 1, otherDoctors: 0, notUsable: 1 });
    expect((await planOf('drA', p1)).template.version).toBe(v.version);

    // Indeed: her new doctor (and an RMO) may not use Dr A's protocol on her plan – they switch it instead
    for (const who of ['drB', 'rmo']) {
      expect((await (await as(who)).get(url(p2, '/template-preview')).query({ templateId: String(v._id) })).status, who).toBe(403);
    }
    const std = await standard();
    const switchPreview = await (await as('drB')).get(url(p2, '/template-preview')).query({ templateId: String(std._id) });
    expect(switchPreview.status).toBe(200);
  });

  it('a plan that cannot be moved (it would have too many items) is counted as not updated, apart from plans changed meanwhile', async () => {
    const { v, p1, p2 } = await protocolWithPlans();
    // p2's plan already has 400 items (the most a plan can have): adding the protocol's new item would go over
    const plan = await CarePlan.findOne({ tenantId: hospital._id, patientId: p2.id, current: true });
    const extra = Array.from({ length: 400 - (plan.items.length - 1) }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      key: `custom_${String(i).padStart(8, '0')}`,
      origin: 'custom',
      kind: 'advice',
      name: `Sample advice ${i + 1}`,
      patientText: '',
      timing: { atBooking: false, fromWeek: 30, toWeek: 32, after: { key: null, weeks: null }, date: null, dateBy: null },
      state: 'open',
      rev: 0,
      history: [],
      addedOn: new Date('2026-09-28T00:00:00Z'),
      added: { reason: '', by: people.drA._id, byName: 'Dr A', at: NOW },
      auto: { applies: 'yes', flags: [], phase: 'open' },
    }));
    // Only the protocol's lab_vitd item is renamed in the new version; drop it from p2's plan so the move adds it back
    await CarePlan.collection.updateOne({ _id: plan._id }, { $pull: { items: { key: 'lab_vitd' } } });
    await CarePlan.collection.updateOne({ _id: plan._id }, { $push: { items: { $each: extra } } });
    expect((await CarePlan.findOne({ tenantId: hospital._id, _id: plan._id }).lean()).items).toHaveLength(400);

    const preview = (await (await as('drA')).get(`${T}/${v._id}/plans-update`)).body;
    expect(preview.plans.toUpdate).toBe(2);
    const done = (await (await as('drA')).post(`${T}/${v._id}/plans-update`).send({ version: v.version, itemsHash: preview.template.itemsHash })).body.result;
    expect(done).toMatchObject({ updated: 1, notUpdated: 0, failed: 1 });
    expect((await CarePlan.findOne({ tenantId: hospital._id, _id: plan._id }).lean()).source.version).not.toBe(v.version);
    expect((await planOf('drA', p1)).template.version).toBe(v.version);
  });
});

// ---------- (c) Editing an item a doctor added ----------

describe('editing an item a doctor added', () => {
  const custom = { kind: 'investigation', name: 'Thyroid revew', patientText: '', note: '', timing: { type: 'weeks', fromWeek: 20, toWeek: 22 } };
  async function withCustom(p) {
    const res = await (await as('drA')).post(url(p, '/items')).send({ clientRequestId: crypto.randomUUID(), ...custom });
    expect(res.status).toBe(201);
    return res.body.plan.items.find((i) => i.id === res.body.itemId);
  }
  const edit = (changes = {}) => ({ action: 'edit', name: 'Thyroid review', patientText: 'Thyroid blood test', note: 'Ask about tiredness', timing: { type: 'weeks', fromWeek: 22, toWeek: 24 }, ...changes });

  it('changes the name, wording for the patient, due window and note – in the item history, the plan history and the audit log (ids only)', async () => {
    const p = await register('drA');
    const it0 = await withCustom(p);
    const res = await act('drA', p, it0, edit());
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    const it1 = res.body.plan.items.find((i) => i.id === it0.id);
    expect(it1).toMatchObject({ name: 'Thyroid review', patientText: 'Thyroid blood test', timing: { fromWeek: 22, toWeek: 24 }, note: { text: 'Ask about tiredness', byName: 'Dr A' }, rev: it0.rev + 1 });
    expect(it1.due).toEqual({ from: '2026-10-26T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }); // 22 w 0 d – 24 w 6 d
    expect(it1.history.at(-1)).toMatchObject({
      action: 'edit',
      byName: 'Dr A',
      from: { name: 'Thyroid revew', patientText: '', timing: { fromWeek: 20, toWeek: 22 }, note: '' },
      to: { name: 'Thyroid review', patientText: 'Thyroid blood test', timing: { fromWeek: 22, toWeek: 24 }, note: 'Ask about tiredness' },
    });
    expect(res.body.plan.log[0]).toMatchObject({
      action: 'item_edited',
      byName: 'Dr A',
      auto: false,
      text: 'Item “Thyroid review” (was “Thyroid revew”) changed: name, wording for the patient, due window, note.',
    });
    const audit = await AuditLog.findOne({ action: 'CARE_PLAN_CHANGED', 'details.change': 'item_edited' }).lean();
    expect(audit.details).toEqual({ patientId: p.id, mrn: p.mrn, planId: res.body.plan.id, change: 'item_edited', itemId: it0.id });
    expect(JSON.stringify(audit)).not.toMatch(/Thyroid|tiredness/);

    // The same edit again: nothing to do (also with the old version number); one field: only it
    expect((await act('drA', p, it0, edit())).body.changed).toBe(false);
    const res2 = await act('drA', p, it1, edit({ note: '' }));
    const it2 = res2.body.plan.items.find((i) => i.id === it0.id);
    expect(it2.note).toBeNull();
    expect(it2.history.at(-1)).toMatchObject({ from: { note: 'Ask about tiredness' }, to: { note: '' } });
    expect(res2.body.plan.log[0].text).toBe('Item “Thyroid review” changed: note.');
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED', 'details.change': 'item_edited' })).toBe(2);
  });

  it('fixed dates; a new due window replaces a date moved earlier; an unchanged past window is not checked again', async () => {
    const p = await register('drA');
    let it = await withCustom(p);
    let res = await act('drA', p, it, { action: 'move', dueFrom: '2026-10-12', dueBy: '2026-10-18', reason: '' });
    it = res.body.plan.items.find((i) => i.id === it.id);
    expect(it.manualDate).toBeTruthy();
    res = await act('drA', p, it, edit({ timing: { type: 'date', dueFrom: '2026-11-02', dueBy: null } }));
    expect(res.status).toBe(200);
    it = res.body.plan.items.find((i) => i.id === it.id);
    expect(it.manualDate).toBeNull();
    expect(it.timing).toMatchObject({ fromWeek: null, toWeek: null, date: '2026-11-02T00:00:00.000Z', dateBy: '2026-11-08T00:00:00.000Z' });
    expect(it.due).toEqual({ from: '2026-11-02T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' });
    expect(it.history.at(-1).from.manualDate).toEqual({ dueFrom: '2026-10-12T00:00:00.000Z', dueBy: '2026-10-18T00:00:00.000Z' });
    // Weeks out of range, or dates in the past: the same rules as adding an item
    const bad = await act('drA', p, it, edit({ timing: { type: 'weeks', fromWeek: 10, toWeek: 12 } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields['timing.toWeek']).toBe('The window must end between today and 43 weeks.');
    const past = await act('drA', p, it, edit({ timing: { type: 'date', dueFrom: '2026-09-01', dueBy: '2026-09-07' } }));
    expect(past.status).toBe(400);
    expect(past.body.error.fields['timing.dueBy']).toBe('Choose a date from today onwards.');

    // Weeks later the window has passed: the name can still be corrected
    vi.setSystemTime(new Date('2026-12-01T06:00:00Z'));
    sessions.drA = null; // log in again after the jump in time
    const now = (await planOf('drA', p)).items.find((i) => i.id === it.id);
    const rename = await act('drA', p, now, edit({ name: 'Thyroid review (TSH)', timing: { type: 'date', dueFrom: '2026-11-02', dueBy: '2026-11-08' } }));
    expect(rename.status).toBe(200);
    expect(rename.body.plan.items.find((i) => i.id === it.id).name).toBe('Thyroid review (TSH)');
  });

  it('refuses an item of the protocol, a done or not-needed item, a stale version, fetal-sex words, a paused plan', async () => {
    const p = await register('drA');
    const it = await withCustom(p);
    let plan = await planOf('drA', p);
    const fromTemplate = await act('drA', p, item(plan, 'lab_cbc'), edit());
    expect(fromTemplate.status).toBe(400);
    expect(fromTemplate.body.error.message).toBe('Only items added for this patient can be edited. For an item of the protocol, move its date, add a note or mark it not needed.');

    const pc = await act('drA', p, it, edit({ name: 'Scan to see if boy or girl' }));
    expect(pc.status).toBe(400);
    expect(pc.body.error.fields.name).toBe(PCPNDT_MESSAGE);
    expect((await act('drA', p, it, edit({ timing: { type: 'weeks', fromWeek: 24, toWeek: 22 } }))).status).toBe(400);

    const doneRes = await act('drA', p, it, { action: 'done', on: '2026-09-28' });
    const doneItem = doneRes.body.plan.items.find((i) => i.id === it.id);
    const refused = await act('drA', p, doneItem, edit());
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe('This item is marked done, so it cannot be edited. If it was marked done by mistake, reopen it first.');
    expect((await act('drA', p, it, edit())).status).toBe(409); // an older version of the item

    const reopened = (await act('drA', p, doneItem, { action: 'reopen', reason: '' })).body.plan.items.find((i) => i.id === it.id);
    const nn = (await act('drA', p, reopened, { action: 'not_needed', reasonCode: 'declined', reason: '' })).body.plan.items.find((i) => i.id === it.id);
    expect((await act('drA', p, nn, edit())).status).toBe(409);

    // A paused plan (the type of care changed): no edits, as no new items
    const p2 = await register('drA');
    const second = await withCustom(p2);
    expect((await (await as('reception')).patch(`/api/patients/${p2.id}`).send({ careType: 'gynaecology' })).status).toBe(200);
    const paused = await act('drA', p2, second, edit());
    expect(paused.status).toBe(409);
    expect(paused.body.error.code).toBe('PLAN_PAUSED');
    plan = await CarePlan.findOne({ tenantId: hospital._id, patientId: p2.id });
    expect(plan.items.find((i) => String(i._id) === second.id).name).toBe('Thyroid revew');
  });

  it('only those who may change the plan; another hospital gets 404', async () => {
    const p = await register('drA');
    const it = await withCustom(p);
    for (const who of ['drB', 'nurse']) expect((await act(who, p, it, edit())).status, who).toBe(403);
    expect((await act('reception', p, it, edit())).status).toBe(403);
    expect((await act('outsider', p, it, edit())).status).toBe(404);
    const byRmo = await act('rmo', p, it, edit());
    expect(byRmo.status).toBe(200);
    expect(byRmo.body.plan.items.find((i) => i.id === it.id).history.at(-1).byName).toBe('RMO Sample');
  });
});

// ---------- (d) Used by N current plans ----------

describe('"used by N current plans"', () => {
  it('counts the active plans of records in use – not closed plans, a closed record or a duplicate – and only counts', async () => {
    const mine = await protocolOf('drA');
    await makeDefault('drA', mine);
    const [p1, p2, p3, p4] = [await register('drA'), await register('drA'), await register('drA'), await register('drA')];
    await register('drB', { assignedDoctor: people.drB._id.toString() }); // standard
    expect((await (await as('drA')).post(url(p2, '/close')).send({ reason: 'transferred_out' })).status).toBe(200);
    await Patient.updateOne({ tenantId: hospital._id, _id: p3.id }, { $set: { death: { on: new Date('2026-09-27T00:00:00Z'), byName: 'Dr A', at: NOW } } });
    await Patient.updateOne({ tenantId: hospital._id, _id: p4.id }, { $set: { duplicateOf: { patient: p1.id, mrn: p1.mrn, byName: 'Dr A', at: NOW } } });

    const list = (await (await as('nurse')).get(T)).body.templates;
    expect(list.find((t) => t.id === String(mine._id))).toMatchObject({ usedBy: 1, ownerDefault: true, defaultState: 'in_use' });
    expect(list.find((t) => t.kind === 'standard' && t.careType === 'antenatal').usedBy).toBe(1);
    expect(list.find((t) => t.kind === 'standard' && t.careType === 'postnatal').usedBy).toBe(0);
    expect((await page('nurse', mine._id)).body.template).toMatchObject({ usedBy: 1, olderVersion: 0, canUpdatePlans: false, canSetDefault: false });
    expect(JSON.stringify(list)).not.toMatch(/Sample Mother|P-0/);
  });
});
