// Feature 9: printing a patient's care plan (patient copy or staff copy). The printout itself is made in the
// browser; the server checks who may print and records the printout in the audit log (ids only). Fake data only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ITEM_TRANSLATIONS } from '../../client/src/pages/careplans/itemTranslations.js';
import { createApp } from '../src/app.js';
import { ANTENATAL_DRAFT } from '../src/careplans/antenatalDraft.js';
import { GYNAECOLOGY_DRAFT, INFERTILITY_DRAFT, NEWBORN_DRAFT, POSTNATAL_DRAFT } from '../src/careplans/otherDrafts.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // 11:30 in India
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };

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
  hospital = await createTenant('Print Hospital');
  other = await createTenant('Other Print Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
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

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));

async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Print Mother',
      ageYears: 28,
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: '2027-03-01' },
      obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
      ...overrides,
    }),
  );
  expect(res.status).toBe(201);
  return res.body.patient;
}

async function planId(who, p) {
  const res = await (await as(who)).get(`/api/patients/${p.id}/care-plan`);
  expect(res.status).toBe(200);
  return res.body.plan.id;
}

const print = async (who, p, body) => (await as(who)).post(`/api/patients/${p.id}/care-plan/printed`).send(body);
const printedEntries = () => AuditLog.find({ action: 'CARE_PLAN_PRINTED' }).sort({ createdAt: 1 });

describe('printing the care plan', () => {
  it('records a patient copy with ids only, for the current plan', async () => {
    const p = await register();
    const id = await planId('rmo', p);
    const res = await print('rmo', p, { copy: 'patient' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ printed: true });
    const [entry] = await printedEntries();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, planId: id, copy: 'patient', access: 'full' });
    expect(String(entry.tenantId)).toBe(String(hospital._id));
    expect(String(entry.actor)).toBe(String(people.rmo._id));
    // what readers of the audit log get
    expect(safeAuditDetails('CARE_PLAN_PRINTED', { ...entry.details, advice: 'x' })).toEqual(entry.details);
  });

  it('lets everyone who can see the plan print it, and nobody else', async () => {
    const p = await register();
    const id = await planId('drA', p);
    for (const who of ['drA', 'rmo', 'nurse', 'drB']) {
      const res = await print(who, p, { copy: 'staff', planId: id });
      expect(res.status, who).toBe(200);
    }
    expect((await printedEntries()).map((e) => e.details.access)).toEqual(['full', 'full', 'clinical', 'read_only']);
    for (const who of ['reception', 'lab', 'admin']) {
      const res = await print(who, p, { copy: 'patient' });
      expect(res.status, who).toBe(403);
    }
    expect((await (await as('outsider')).post(`/api/patients/${p.id}/care-plan/printed`).send({ copy: 'patient' })).status).toBe(404);
    expect(await printedEntries()).toHaveLength(4);
  });

  it('keeps sensitive records to the treating doctor and RMOs', async () => {
    const p = await register();
    expect((await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    expect((await print('nurse', p, { copy: 'patient' })).status).toBe(403);
    expect((await print('drB', p, { copy: 'patient' })).status).toBe(403);
    expect((await print('drA', p, { copy: 'patient' })).status).toBe(200);
  });

  it('accepts only the kind of copy – what was printed and the advice stay in the browser', async () => {
    const p = await register();
    expect((await print('rmo', p, { copy: 'everything' })).status).toBe(400);
    expect((await print('rmo', p, {})).status).toBe(400);
    expect((await print('rmo', p, { copy: 'patient', advice: 'Rest well' })).status).toBe(400);
    expect((await print('rmo', p, { copy: 'patient', planId: 'nope' })).status).toBe(400);
    expect(await printedEntries()).toHaveLength(0);
  });

  it("refuses another patient's plan, and a patient without a plan", async () => {
    const p = await register();
    const q = await register({ fullName: 'Second Mother' });
    const otherPlan = await planId('rmo', q);
    expect((await print('rmo', p, { copy: 'staff', planId: otherPlan })).status).toBe(404);
    const gyn = (await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Gyn Patient' }))).body.patient;
    expect((await print('rmo', gyn, { copy: 'staff' })).status).toBe(404);
    expect(await printedEntries()).toHaveLength(0);
  });
});

describe('the patient copy in English with Marathi or Hindi (5 Oct 2026)', () => {
  it('records the second language of a patient copy (ids and the language code only); the staff copy is English only', async () => {
    const p = await register();
    const id = await planId('rmo', p);
    expect((await print('rmo', p, { copy: 'patient', language: 'mr' })).status).toBe(200);
    expect((await print('nurse', p, { copy: 'patient', language: 'hi', planId: id })).status).toBe(200);
    expect((await print('drA', p, { copy: 'patient', language: 'en' })).status).toBe(200);
    expect((await print('drA', p, { copy: 'staff', language: 'en' })).status).toBe(200);
    const entries = await printedEntries();
    expect(entries.map((e) => [e.details.copy, e.details.language ?? null, e.details.access])).toEqual([
      ['patient', 'mr', 'full'],
      ['patient', 'hi', 'clinical'],
      ['patient', null, 'full'], // English only: recorded as before
      ['staff', null, 'full'],
    ]);
    expect(entries[0].details).toEqual({ patientId: p.id, mrn: p.mrn, planId: id, copy: 'patient', language: 'mr', access: 'full' });
    // what readers of the audit log get: the language code is kept
    expect(safeAuditDetails('CARE_PLAN_PRINTED', entries[0].details)).toEqual(entries[0].details);
  });

  it('refuses a staff copy in another language, an unknown language, and keeps the rules on who may print', async () => {
    const p = await register();
    const staff = await print('rmo', p, { copy: 'staff', language: 'mr' });
    expect(staff.status).toBe(400);
    expect(staff.body.error.fields.language).toBe('The staff copy is printed in English only.');
    for (const language of ['gu', 'MR', 'marathi', '', 1, null]) expect((await print('rmo', p, { copy: 'patient', language })).status, String(language)).toBe(400);
    for (const who of ['reception', 'lab', 'admin']) expect((await print(who, p, { copy: 'patient', language: 'mr' })).status, who).toBe(403);
    expect((await (await as('outsider')).post(`/api/patients/${p.id}/care-plan/printed`).send({ copy: 'patient', language: 'hi' })).status).toBe(404);
    expect(await printedEntries()).toHaveLength(0);
  });

  it('every built-in care-plan item has its Marathi and Hindi wording, written for its exact built-in English', () => {
    const builtIn = [ANTENATAL_DRAFT, POSTNATAL_DRAFT, NEWBORN_DRAFT, GYNAECOLOGY_DRAFT, INFERTILITY_DRAFT].flatMap((t) => t.items);
    const keys = builtIn.map((it) => it.key);
    // one line per built-in item, and no line for an item that is not built in
    expect(Object.keys(ITEM_TRANSLATIONS).sort()).toEqual([...keys].sort());
    for (const it of builtIn) {
      expect(it.patientText, it.key).toBeTruthy();
      // the translation is used only while the plan's wording is word for word this English
      expect(ITEM_TRANSLATIONS[it.key].en, it.key).toBe(it.patientText);
    }
    // the portal finds a built-in item by its English wording: every wording is different
    expect(new Set(builtIn.map((it) => it.patientText)).size).toBe(builtIn.length);
  });
});
