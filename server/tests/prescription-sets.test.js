// The hospital's ready-made prescription sets (Feature 8b): built-in drafts, editing, approval and sets not in
// use. Fake data only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PrescriptionSet } from '../src/models/PrescriptionSet.js';
import { mentionsFetalSex } from '../src/utils/pcpndt.js';
import { BUILT_IN_SETS, BUILT_IN_SETS_VERSION } from '../src/visits/builtInSets.js';
import { ensurePrescriptionSets } from '../src/visits/prescriptionSets.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };
const URL = '/api/prescription-sets';

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
  app = createApp();
  hospital = await createTenant('Sets Hospital');
  other = await createTenant('Other Sets Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Dr Outside' });
  await addMember(people.outsider, other, 'doctor');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const list = async (who = 'drA') => (await as(who)).get(URL);
async function setByKey(key, who = 'drA') {
  const res = await list(who);
  expect(res.status).toBe(200);
  const s = res.body.sets.find((x) => x.key === key);
  const full = await (await as(who)).get(`${URL}/${s.id}`);
  expect(full.status).toBe(200);
  return full.body.set;
}
const itemBody = ({ id: _id, ...it }) => it;
const bodyOf = (s, changes = {}) => ({
  version: s.version,
  name: s.name,
  about: s.about,
  careTypes: s.careTypes,
  items: s.items.map(itemBody),
  notes: s.notes,
  investigations: s.investigations,
  advice: s.advice,
  ...changes,
});
const put = async (who, s, body) => (await as(who)).put(`${URL}/${s.id}`).send(body);
const approve = async (who, s, body = { confirm: true, version: s.version }) => (await as(who)).post(`${URL}/${s.id}/approve`).send(body);
const FOLIC = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days' };

describe('the built-in sets', () => {
  it('are complete drafts that never mention the baby’s sex', () => {
    expect(BUILT_IN_SETS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(BUILT_IN_SETS.map((s) => s.key)).size).toBe(BUILT_IN_SETS.length);
    for (const s of BUILT_IN_SETS) {
      expect(s.items.length || s.investigations || s.advice, s.key).toBeTruthy();
      expect(s.about, s.key).toBeTruthy(); // a note for the reviewing doctor: the source and what to check
      const texts = [s.name, s.about, s.notes, s.investigations, s.advice, ...s.items.flatMap((it) => [it.drug, it.strength, it.dose, it.frequencyText, it.instructions])];
      for (const t of texts) expect(mentionsFetalSex(t), `${s.key}: ${t}`).toBe(false);
    }
  });

  it('are copied into each hospital once, as drafts, with their medicines', async () => {
    const res = await list('rmo');
    expect(res.status).toBe(200);
    expect(res.body.canEdit).toBe(false);
    expect(res.body.sets).toHaveLength(BUILT_IN_SETS.length);
    expect(res.body.sets.every((s) => s.status === 'draft' && s.version === 1 && s.origin === 'built_in' && s.isActive)).toBe(true);
    expect(res.body.sets.map((s) => s.key)).toEqual([...BUILT_IN_SETS].sort((a, b) => a.order - b.order).map((s) => s.key));
    const anaemia = res.body.sets.find((s) => s.key === 'anc_anaemia');
    expect(anaemia).toMatchObject({ careTypes: ['antenatal'], investigations: expect.stringContaining('haemoglobin') });
    expect(anaemia.items[0]).toMatchObject({ drug: 'Iron + folic acid (IFA)', dose: '1', frequency: '1-0-1', durationValue: 3, durationUnit: 'months' });
    expect(anaemia.items[0].id).toMatch(/^[a-f0-9]{24}$/);
    await ensurePrescriptionSets(hospital._id);
    expect(await PrescriptionSet.countDocuments({ tenantId: hospital._id })).toBe(BUILT_IN_SETS.length);
    expect(await PrescriptionSet.countDocuments({ tenantId: other._id })).toBe(0);
  });

  it('each passes the same checks as a set a doctor writes', async () => {
    const drA = await as('drA');
    for (const s of BUILT_IN_SETS) {
      const { key: _k, order: _o, ...content } = s;
      const res = await drA.post(URL).send(content);
      expect(res.status, `${s.key}: ${JSON.stringify(res.body)}`).toBe(201);
    }
  });

  it('refresh an unedited draft when the built-in content changes, but never an edited or approved set', async () => {
    await ensurePrescriptionSets(hospital._id);
    const stale = { name: 'Old name', builtInVersion: BUILT_IN_SETS_VERSION - 1 };
    await PrescriptionSet.updateOne({ tenantId: hospital._id, key: 'anc_nausea' }, { $set: stale });
    await PrescriptionSet.updateOne({ tenantId: hospital._id, key: 'anc_uti' }, { $set: { ...stale, builtInVersion: null } });
    await PrescriptionSet.updateOne({ tenantId: hospital._id, key: 'gyn_thrush' }, { $set: { ...stale, status: 'approved' } });
    await ensurePrescriptionSets(hospital._id);
    const [nausea, uti, thrush] = await Promise.all(['anc_nausea', 'anc_uti', 'gyn_thrush'].map((key) => PrescriptionSet.findOne({ tenantId: hospital._id, key })));
    expect(nausea.name).toBe(BUILT_IN_SETS.find((s) => s.key === 'anc_nausea').name);
    expect(nausea).toMatchObject({ version: 2, builtInVersion: BUILT_IN_SETS_VERSION, updatedByName: 'Built-in draft updated' });
    expect(uti.name).toBe('Old name');
    expect(thrush.name).toBe('Old name');
    expect(await AuditLog.countDocuments({ action: 'PRESCRIPTION_SET_UPDATED', actorEmail: 'system (built-in sets)' })).toBe(1);
  });
});

describe('who can use the library', () => {
  it('doctors and RMOs read it; other roles and other hospitals do not', async () => {
    for (const who of ['drA', 'rmo']) expect((await list(who)).status, who).toBe(200);
    for (const who of ['nurse', 'reception', 'lab', 'admin']) expect((await list(who)).status, who).toBe(403);
    const s = await setByKey('gyn_pcos');
    expect((await (await as('outsider')).get(`${URL}/${s.id}`)).status).toBe(404);
  });

  it('only doctors add, change, approve or retire sets', async () => {
    const s = await setByKey('gyn_pcos');
    expect(s).toMatchObject({ canEdit: true, canApprove: true });
    expect((await setByKey('gyn_pcos', 'rmo')).canEdit).toBe(false);
    const rmo = await as('rmo');
    expect((await put('rmo', s, bodyOf(s))).status).toBe(403);
    expect((await approve('rmo', s)).status).toBe(403);
    expect((await rmo.post(URL).send({ name: 'Mine', items: [FOLIC] })).status).toBe(403);
    expect((await rmo.post(URL).send({ copyFrom: s.id })).status).toBe(403);
    expect((await rmo.patch(`${URL}/${s.id}/active`).send({ active: false })).status).toBe(403);
  });
});

describe('a doctor’s own set', () => {
  it('is saved as a draft, with the medicines as written', async () => {
    const res = await (await as('drA')).post(URL).send({ name: 'Iron and calcium', careTypes: ['postnatal', 'antenatal', 'antenatal'], items: [FOLIC], advice: 'Rest well' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.set).toMatchObject({ name: 'Iron and calcium', origin: 'hospital', status: 'draft', version: 1, careTypes: ['antenatal', 'postnatal'], createdByName: 'Sample drA' });
    expect(res.body.set.items[0]).toMatchObject({ ...FOLIC, frequencyText: '', route: '', instructions: '' });
    const entry = await AuditLog.findOne({ action: 'PRESCRIPTION_SET_CREATED' });
    expect(entry.details).toMatchObject({ setId: res.body.set.id, name: 'Iron and calcium', version: 1, copiedFrom: null });
  });

  it('needs a name and something in it, checks every medicine, and refuses words about the baby’s sex', async () => {
    const drA = await as('drA');
    const empty = await drA.post(URL).send({ name: 'Nothing', items: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields.items).toMatch(/at least one medicine/);
    expect((await drA.post(URL).send({ name: '', items: [FOLIC] })).body.error.fields.name).toMatch(/name/);
    const bad = await drA.post(URL).send({ name: 'Bad', items: [{ ...FOLIC, frequency: 'custom', durationValue: null }] });
    expect(bad.body.error.fields).toMatchObject({ 'items.0.frequencyText': 'Write how often', 'items.0.durationValue': 'Enter how many' });
    const sex = await drA.post(URL).send({ name: 'For a baby girl', items: [FOLIC] });
    expect(sex.status).toBe(400);
    expect(sex.body.error.fields.name).toMatch(/PCPNDT/);
    expect((await drA.post(URL).send({ name: 'X', items: [FOLIC], fetalSex: 'x' })).status).toBe(400); // unknown fields
    expect((await drA.post(URL).send({ name: 'X', items: Array.from({ length: 21 }, () => FOLIC) })).status).toBe(400);
  });

  it('can be a copy of another set, as a new draft', async () => {
    const pcos = await setByKey('gyn_pcos');
    const res = await (await as('drB')).post(URL).send({ copyFrom: pcos.id });
    expect(res.status).toBe(201);
    expect(res.body.set).toMatchObject({ name: `Copy of ${pcos.name}`, origin: 'hospital', status: 'draft', careTypes: pcos.careTypes, investigations: pcos.investigations });
    expect(res.body.set.items.map(itemBody)).toEqual(pcos.items.map(itemBody));
    expect(res.body.set.items[0].id).not.toBe(pcos.items[0].id);
    expect((await (await as('drB')).post(URL).send({ copyFrom: '0123456789abcdef01234567' })).status).toBe(404);
  });
});

describe('editing and approval', () => {
  it('a change makes a new draft version; a save from an older version is refused', async () => {
    const s = await setByKey('anc_second_third');
    const res = await put('drB', s, bodyOf(s, { notes: 'Iron after lunch, calcium morning and night.' }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.set).toMatchObject({ version: 2, status: 'draft', updatedByName: 'Sample drB', notes: 'Iron after lunch, calcium morning and night.' });
    expect((await PrescriptionSet.findOne({ _id: s.id, tenantId: hospital._id })).builtInVersion).toBeNull();
    const stale = await put('drA', s, bodyOf(s)); // still version 1
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/now version 2/);
  });

  it('needs the confirmation and the version checked, and becomes a draft again when changed', async () => {
    const s = await setByKey('anc_anaemia');
    expect((await approve('drA', s, { version: s.version })).status).toBe(400);
    expect((await approve('drA', s, { confirm: true, version: s.version + 1 })).status).toBe(409);
    const ok = await approve('drA', s);
    expect(ok.status).toBe(200);
    expect(ok.body.set).toMatchObject({ status: 'approved', approvedByName: 'Sample drA', approvedVersion: 1 });
    expect((await approve('drA', s)).status).toBe(200); // the same approval again changes nothing
    expect(await AuditLog.countDocuments({ action: 'PRESCRIPTION_SET_APPROVED' })).toBe(1);
    const changed = await put('drB', s, bodyOf(s, { advice: 'Eat green leafy vegetables every day.' }));
    expect(changed.body.set).toMatchObject({ status: 'draft', version: 2, approvedVersion: 1 });
  });

  it('a set not in use is kept, listed last and can be used again', async () => {
    const s = await setByKey('anc_first_trimester');
    const off = await (await as('drA')).patch(`${URL}/${s.id}/active`).send({ active: false });
    expect(off.body.set.isActive).toBe(false);
    const sets = (await list()).body.sets;
    expect(sets.at(-1).key).toBe('anc_first_trimester');
    expect(await AuditLog.countDocuments({ action: 'PRESCRIPTION_SET_DEACTIVATED' })).toBe(1);
    const on = await (await as('drA')).patch(`${URL}/${s.id}/active`).send({ active: true });
    expect(on.body.set.isActive).toBe(true);
    expect((await list()).body.sets[0].key).toBe('anc_first_trimester');
  });
});
