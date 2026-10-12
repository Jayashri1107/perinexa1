// The Abortion type of care (pregnancy loss outside the MTP Act: miscarriage, ectopic and molar pregnancy, the
// work-up for recurrent loss). Registration, checks, access, no delivery note, the calendar, AI and reminders.
// (Findings, the care plan and the red flags: pregnancy-loss-care.test.js.) Fake data only. Time is pinned:
// 1 Oct 2026, 11:30 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as clientLists from '../../client/src/pages/patients/abortionFormat.js';
import { createApp } from '../src/app.js';
import { patientFacts } from '../src/ai/brief.js';
import { checkSuggestions, fieldList } from '../src/ai/understand.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { Patient } from '../src/models/Patient.js';
import * as serverLists from '../src/patients/abortionRules.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z'); // hospital today: 1 Oct 2026
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };
let app;
let hospital;
let people;
let sessions;
let sent;
let answer;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Pregnancy Loss Hospital');
  people = {};
  sessions = {};
  sent = [];
  answer = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const register = async (fields, who = 'drA') => {
  const res = await (await as(who)).post('/api/patients').send(samplePatient({ assignedDoctor: people.drA._id.toString(), ...fields }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
};
const edit = async (p, body, who = 'drA') => (await as(who)).patch(`/api/patients/${p.id}`).send(body);
const MISSED = { lossType: 'missed', lmp: '2026-08-02', presentedOn: '2026-10-01', management: { method: 'medical', on: '2026-10-01', outcome: 'in_progress' } };
const lossPatient = async (abortion = MISSED) => {
  const p = await register({ careType: 'abortion', fullName: 'Loss Sample', medical: { allergies: 'None known', bloodGroup: 'O-' } });
  const res = await edit(p, { abortion });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.patient;
};
const day = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : v)?.slice(0, 10) ?? v;
const fieldsOf = (res) => res.body.error?.fields ?? {};

function fakeOpenAI() {
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ model: 'gpt-test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer), refusal: null } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

describe('the lists', () => {
  it('the website and the server use the same lists (no induced value, no fetal-sex field)', () => {
    for (const name of [
      'LOSS_TYPES', 'LOSS_TYPE_KEYS', 'RETIRED_LOSS_TYPES', 'STORED_LOSS_TYPE_KEYS', 'LOSS_LABELS', 'THREATENED_HINT', 'RETIRED_LOSS_MESSAGE',
      'MANAGEMENT', 'MANAGEMENT_FOR', 'SURGICAL_METHODS', 'OUTCOMES', 'RETIRED_OUTCOMES', 'OUTCOME_LABELS', 'RETIRED_OUTCOME_MESSAGE',
      'ECTOPIC_SITES', 'MOLE_KINDS', 'HISTOLOGY', 'ANTI_D', 'NOT_PREGNANT_NOW', 'MAX_WEEKS', 'HINT_FROM_WEEKS',
    ]) {
      expect([name, clientLists[name]]).toEqual([name, serverLists[name]]);
    }
    expect(clientLists.gaText('2026-08-02', '2026-10-01')).toBe(serverLists.gaText('2026-08-02', '2026-10-01'));
    // A threatened miscarriage stays under Antenatal (owner, 3 Oct 2026): no longer a type of loss, nor "pregnancy continuing"
    expect(serverLists.LOSS_TYPE_KEYS).toEqual(['inevitable', 'incomplete', 'complete', 'missed', 'septic', 'ectopic', 'molar', 'recurrent']);
    expect(Object.keys(serverLists.MANAGEMENT_FOR)).toEqual(serverLists.LOSS_TYPE_KEYS);
    expect(Object.keys(serverLists.OUTCOMES)).not.toContain('continuing');
    expect(serverLists.STORED_LOSS_TYPE_KEYS).toEqual([...serverLists.LOSS_TYPE_KEYS, 'threatened']); // old records only
    expect(serverLists.LOSS_LABELS.threatened).toBe('Threatened miscarriage (now recorded under Antenatal)');
    expect(serverLists.THREATENED_HINT).toBe('A threatened miscarriage is a continuing pregnancy – register or keep her under Pregnancy (antenatal).');
    const all = JSON.stringify(Object.fromEntries(Object.entries(serverLists).filter(([, v]) => typeof v !== 'function')));
    expect(all).not.toMatch(/MTP|terminat|induced|\bsex\b|gender/i);
    for (const [type, methods] of Object.entries(serverLists.MANAGEMENT_FOR)) {
      expect(serverLists.LOSS_TYPE_KEYS).toContain(type);
      for (const m of methods) expect(serverLists.MANAGEMENT[m], `${type} ${m}`).toBeTruthy();
    }
  });
});

describe('registering a pregnancy loss', () => {
  it('in two steps: weeks worked out from the LMP, not sensitive, no risk level, no EDD', async () => {
    const p = await register({ careType: 'abortion', fullName: 'Loss Sample', medical: { allergies: 'None known' } });
    expect(p).toMatchObject({ careType: 'abortion', sensitive: false, abortion: null, gestationalAge: null });
    expect(p.risk.level).toBe(null);
    const res = await edit(p, { abortion: MISSED });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const a = res.body.patient.abortion;
    expect(a).toMatchObject({ lossType: 'missed', weeks: 8, days: 4, management: { method: 'medical', outcome: 'in_progress' }, ectopicSite: null, moleKind: null });
    expect(day(a.lmp)).toBe('2026-08-02');
    expect(day(a.presentedOn)).toBe('2026-10-01');
    const stored = await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean();
    expect(stored.pregnancy).toMatchObject({ lmp: null, edd: null, effectiveEdd: null });
    expect(stored.risk.level).toBe(null);
  });

  it('a doctor can send it with the registration (date seen: today); other types of care keep no section', async () => {
    const p = await register({ careType: 'abortion', fullName: 'One Step', abortion: { lossType: 'ectopic', ectopicSite: 'tube', weeks: 6, days: 2, moleKind: 'partial' } });
    expect(p.abortion).toMatchObject({ lossType: 'ectopic', ectopicSite: 'tube', weeks: 6, days: 2, moleKind: null });
    expect(day(p.abortion.presentedOn)).toBe('2026-10-01');
    const gyn = await register({ careType: 'gynaecology', fullName: 'Gynae Sample' });
    const baby = await register({ careType: 'newborn', fullName: 'Baby of Sample', ageYears: undefined, newborn: { birthAt: '2026-09-30T04:00:00.000Z' } });
    for (const x of [gyn, baby]) expect((await Patient.findOne({ _id: x.id, tenantId: hospital._id }).lean()).abortion).toBe(null);
  });

  it('refuses what does not fit, with the reason on the field', async () => {
    const p = await register({ careType: 'abortion', fullName: 'Checks Sample' });
    const cases = [
      [{ lmp: '2026-08-02' }, 'abortion.lossType', /type of loss/],
      [{ lossType: 'molar', management: { method: 'methotrexate' } }, 'abortion.management.method', /does not fit/],
      [{ lossType: 'complete', management: { method: 'expectant' } }, 'abortion.management.method', /does not fit/],
      [{ lossType: 'missed', weeks: 28 }, 'abortion.weeks', /below 28/],
      [{ lossType: 'missed', lmp: '2026-03-12', presentedOn: '2026-10-01' }, 'abortion.lmp', /still birth – record it as a delivery/],
      [{ lossType: 'missed', lmp: '2026-09-20', presentedOn: '2026-09-10' }, 'abortion.lmp', /after the date seen/],
      [{ lossType: 'missed', presentedOn: '2026-10-05' }, 'abortion.presentedOn', /future/],
      [{ lossType: 'missed', management: { method: 'expectant', outcome: 'continuing' } }, 'abortion.management.outcome', /no longer used here – a continuing pregnancy is recorded under Pregnancy \(antenatal\)/],
      [{ lossType: 'threatened', management: { method: 'expectant' } }, 'abortion.lossType', /^Threatened miscarriage is now recorded under Pregnancy \(antenatal\)\. Choose another type of loss, or change the type of care to Pregnancy \(antenatal\)\.$/],
      [{ lossType: 'missed', note: 'Scan shows a male baby' }, 'abortion.note', /PCPNDT/],
      [{ lossType: 'molar', histology: { status: 'received', result: 'partial mole, 69,XXY' } }, 'abortion.histology.result', /PCPNDT/],
    ];
    for (const [abortion, field, message] of cases) {
      const res = await edit(p, { abortion });
      expect(res.status, JSON.stringify(abortion)).toBe(400);
      expect(fieldsOf(res)[field], `${JSON.stringify(abortion)} → ${JSON.stringify(fieldsOf(res))}`).toMatch(message);
    }
    expect((await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean()).abortion).toBe(null);
  });

  it('pregnancy-loss details only for the Abortion type of care; no field for the baby’s sex', async () => {
    const created = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', abortion: { lossType: 'missed' } }));
    expect(created.status).toBe(400);
    expect(fieldsOf(created)['abortion.lossType']).toMatch(/only for the Abortion type of care/);
    const gyn = await register({ careType: 'gynaecology', fullName: 'Gynae Sample' });
    const res = await edit(gyn, { abortion: { lossType: 'missed' } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/only for the Abortion type of care/);

    const p = await lossPatient({ ...MISSED, fetalSex: 'male', babySex: 'female' });
    const stored = await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean();
    expect(JSON.stringify(stored.abortion)).not.toMatch(/fetalSex|babySex|female|male/);
  });

  it('a type of loss that is not a current pregnancy (recurrent loss) keeps no LMP, weeks, anti-D or date of management', async () => {
    const p = await lossPatient({ lossType: 'recurrent', lmp: '2026-08-02', weeks: 3, antiD: { status: 'given', on: '2026-09-30' }, management: { method: 'workup', on: '2026-09-30' } });
    expect(p.abortion).toMatchObject({ lossType: 'recurrent', lmp: null, weeks: null, days: null, antiD: { status: null, on: null }, management: { method: 'workup', on: null } });
  });

  it('an empty date seen keeps the stored one; the section is replaced as a whole', async () => {
    const p = await lossPatient({ ...MISSED, presentedOn: '2026-09-28', ectopicSite: 'tube' });
    expect(day(p.abortion.presentedOn)).toBe('2026-09-28');
    const res = await edit(p, { abortion: { lossType: 'missed', lmp: '2026-08-02', presentedOn: '' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(day(res.body.patient.abortion.presentedOn)).toBe('2026-09-28');
    expect(res.body.patient.abortion.management.method).toBe(null); // not sent this time: replaced
    expect(res.body.patient.abortion).toMatchObject({ weeks: 8, days: 1 });
  });

  it('an LMP checked against the date seen still saves months later', async () => {
    const p = await lossPatient({ ...MISSED, lmp: '2026-07-23' }); // 10 weeks before the date seen
    vi.setSystemTime(new Date('2027-04-01T06:00:00Z'));
    app = createApp();
    sessions = {};
    const res = await edit(p, { abortion: { ...MISSED, lmp: '2026-07-23' }, medical: { allergies: 'Penicillin – rash' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('months later, an emptied date seen keeps the stored one – the LMP is checked against it, not today', async () => {
    const p = await lossPatient({ ...MISSED, lmp: '2026-07-23' }); // seen 1 Oct 2026, 10 weeks
    vi.setSystemTime(new Date('2027-04-01T06:00:00Z'));
    app = createApp();
    sessions = {};
    const res = await edit(p, { abortion: { ...MISSED, lmp: '2026-07-23', presentedOn: '' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(day(res.body.patient.abortion.presentedOn)).toBe('2026-10-01');
    expect(res.body.patient.abortion).toMatchObject({ weeks: 10, days: 0 });
  });

  it('the audit log names only what changed: an unchanged section re-sent adds nothing (weeks are worked out)', async () => {
    const p = await lossPatient(); // LMP 2 Aug 2026: 8 w 4 d
    const latest = async () => (await AuditLog.find({ action: 'PATIENT_UPDATED', 'details.patientId': p.id }).sort({ _id: -1 }).limit(1).lean())[0];
    const same = await edit(p, { abortion: MISSED, medical: { allergies: 'Penicillin – rash' } });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect((await latest()).details.fields).toEqual(['medical.allergies']);
    const moved = await edit(p, { abortion: { ...MISSED, lmp: '2026-07-25' } });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const fields = (await latest()).details.fields;
    expect(fields).toEqual(expect.arrayContaining(['abortion.lmp', 'abortion.weeks']));
    expect(fields).not.toContain('medical.allergies');
    expect(JSON.stringify((await latest()).details)).not.toMatch(/2026-07-25|Penicillin/); // names only, never values
  });

  it('the list filter finds abortion patients', async () => {
    const p = await lossPatient();
    await register({ careType: 'gynaecology', fullName: 'Gynae Sample' });
    const res = await (await as('drA')).get('/api/patients?careType=abortion');
    expect(res.status).toBe(200);
    expect(res.body.patients.map((x) => x.id)).toEqual([p.id]);
    // Only the type of loss is loaded for the list ("Abortion · missed"), not the dates or the note
    expect(res.body.patients[0].abortion).toEqual({ lossType: 'missed' });
    const byDue = await (await as('drA')).get('/api/patients?careType=abortion&sort=pregnancy.effectiveEdd');
    expect(byDue.status, JSON.stringify(byDue.body)).toBe(200);
    expect(byDue.body.patients[0].abortion).toEqual({ lossType: 'missed' });
  });
});

describe('a threatened miscarriage saved before 3 Oct 2026 (now recorded under Antenatal)', () => {
  // Stored as it was then: the type of loss and "pregnancy continuing" are no longer chosen, but are kept and shown
  const OLD = { lossType: 'threatened', management: { method: 'medicines', on: null, outcome: 'continuing' }, antiD: { status: 'not_needed', on: null } };
  const oldRecord = async () => {
    const p = await lossPatient();
    const stored = await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean();
    await Patient.collection.updateOne({ _id: stored._id }, { $set: { 'abortion.lossType': OLD.lossType, 'abortion.management': OLD.management, 'abortion.antiD': OLD.antiD } });
    return p;
  };
  const storedLoss = async (p) => (await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean()).abortion;
  const RETIRED = 'Threatened miscarriage is now recorded under Pregnancy (antenatal). Choose another type of loss, or change the type of care to Pregnancy (antenatal).';

  it('still opens, lists and loads; other details save without touching it', async () => {
    const p = await oldRecord();
    const one = await (await as('drA')).get(`/api/patients/${p.id}`);
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.patient.abortion).toMatchObject({ lossType: 'threatened', management: { method: 'medicines', outcome: 'continuing' } });
    const list = await (await as('drA')).get('/api/patients?careType=abortion');
    expect(list.body.patients[0].abortion).toEqual({ lossType: 'threatened' });
    // A save without the section (allergies, notes; reception's contact details) works and leaves it as it was
    expect((await edit(p, { medical: { allergies: 'Penicillin – rash' }, notes: 'Sample note' })).status).toBe(200);
    expect((await edit(p, { phone: '98765 43210' }, 'reception')).status).toBe(200);
    expect(await storedLoss(p)).toMatchObject({ lossType: 'threatened', management: { method: 'medicines', outcome: 'continuing' } });
  });

  it('saved with the same type of loss: refused with a clear message, nothing changed', async () => {
    const p = await oldRecord();
    const res = await edit(p, { abortion: { ...OLD, lmp: '2026-08-02', presentedOn: '2026-10-01', note: 'Bleeding settled' } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(RETIRED);
    expect(fieldsOf(res)['abortion.lossType']).toBe(RETIRED);
    expect(fieldsOf(res)['abortion.management.method']).toBeUndefined(); // the type of loss is the one thing to fix
    expect(fieldsOf(res)['abortion.management.outcome']).toMatch(/no longer used here/);
    expect(await storedLoss(p)).toMatchObject({ lossType: 'threatened', note: '' });
    // Registering one now is refused the same way
    const created = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'abortion', abortion: { lossType: 'threatened' } }));
    expect(created.status).toBe(400);
    expect(fieldsOf(created)['abortion.lossType']).toBe(RETIRED);
  });

  it('another type of loss can be chosen, or the type of care changed to antenatal (the old section is kept, not deleted)', async () => {
    const p = await oldRecord();
    const other = await edit(p, { abortion: { lossType: 'incomplete', lmp: '2026-08-02', management: { method: 'medicines', outcome: 'in_progress' } } });
    expect(other.status).toBe(400);
    expect(fieldsOf(other)['abortion.management.method']).toMatch(/does not fit/); // "Medicines" was only for a threatened miscarriage
    const fixed = await edit(p, { abortion: { lossType: 'incomplete', lmp: '2026-08-02', management: { method: 'expectant', outcome: 'in_progress' } } });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body.patient.abortion).toMatchObject({ lossType: 'incomplete', management: { method: 'expectant', outcome: 'in_progress' } });

    const q = await oldRecord();
    const ante = await edit(q, { careType: 'antenatal', pregnancy: { lmp: '2026-08-02' } });
    expect(ante.status, JSON.stringify(ante.body)).toBe(200);
    expect(ante.body.patient.careType).toBe('antenatal');
    expect(await storedLoss(q)).toMatchObject({ lossType: 'threatened' });
  });

  it('the AI and the brief are told it in plain words; the AI can never suggest it', async () => {
    const p = await oldRecord();
    fakeOpenAI();
    answer = { points: [{ text: 'Pregnancy loss.', important: true }], missing: [] };
    const res = await (await as('drA')).post(`/api/patients/${p.id}/ai/summary`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const text = sent.at(-1).body.messages[1].content;
    expect(text).toContain('Pregnancy loss: threatened miscarriage (now recorded under antenatal)');
    expect(text).toContain('outcome: pregnancy continuing (now recorded under antenatal)');
    expect(patientFacts({ careType: 'abortion', abortion: { lossType: 'threatened' } })).toBe('pregnancy loss (abortion care), threatened miscarriage (now recorded under antenatal)');
    const today = new Date('2026-10-01T00:00:00Z');
    expect(checkSuggestions([{ part: 0, field: 'abortion.lossType', value: 'threatened' }], { form: 'patient', parts: ['threatened miscarriage'], today, careType: 'abortion' })).toEqual([]);
  });
});

describe('the baby’s sex is never written in a pregnancy record (PCPNDT)', () => {
  it('notes, allergies and other conditions of antenatal and abortion records; "male factor" still saves for infertility', async () => {
    const created = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', notes: 'It is a girl' }));
    expect(created.status).toBe(400);
    expect(fieldsOf(created).notes).toMatch(/PCPNDT/);
    const loss = await lossPatient();
    for (const body of [{ notes: 'it is a girl' }, { medical: { allergies: 'None known', otherConditions: 'sex of baby told' } }]) {
      const res = await edit(loss, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(Object.values(fieldsOf(res)).join()).toMatch(/PCPNDT/);
    }
    const ivf = await register({ careType: 'infertility', fullName: 'Fertility Sample', notes: "Husband's semen analysis – male factor", medical: { allergies: 'None known' } });
    expect(ivf.notes).toMatch(/male factor/);
    expect((await edit(ivf, { notes: 'Male factor; plan IUI' })).status).toBe(200);
    // Changed to antenatal (a pregnancy after treatment): her stored notes are not checked again, new text is
    expect((await edit(ivf, { careType: 'antenatal' })).status).toBe(200);
    expect((await edit(ivf, { notes: 'Male factor; now pregnant, it is a boy' })).status).toBe(400);
  });
});

describe('pregnancy dates are checked only when they change', () => {
  it('an old LMP stored on the record no longer stops other saves; a new old LMP is refused', async () => {
    const ante = await register({ careType: 'antenatal', fullName: 'Old Dates', pregnancy: { lmp: '2026-05-01' }, medical: { allergies: 'None known' } });
    await Patient.updateOne({ _id: ante.id, tenantId: hospital._id }, { $set: { 'pregnancy.lmp': new Date('2025-10-01T00:00:00Z') } }); // 52 weeks ago
    const same = await edit(ante, { pregnancy: { lmp: '2025-10-01', scanEdd: '' }, medical: { allergies: 'Penicillin – rash' } });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    const changed = await edit(ante, { careType: 'abortion', medical: { allergies: 'Penicillin – rash, sulfa' } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(day((await Patient.findOne({ _id: ante.id, tenantId: hospital._id }).lean()).pregnancy.lmp)).toBe('2025-10-01'); // kept

    const other = await register({ careType: 'antenatal', fullName: 'New Old Dates', pregnancy: { lmp: '2026-05-01' } });
    const res = await edit(other, { pregnancy: { lmp: '2025-10-01' } });
    expect(res.status).toBe(400);
    expect(fieldsOf(res)['pregnancy.lmp']).toMatch(/more than 45 weeks/);

    const post = await register({ careType: 'postnatal', fullName: 'Postnatal Old', medical: { allergies: 'None known' } });
    await Patient.updateOne({ _id: post.id, tenantId: hospital._id }, { $set: { 'pregnancy.lmp': new Date('2025-09-01T00:00:00Z') } });
    expect((await edit(post, { medical: { allergies: 'None known', bloodGroup: 'B+' } })).status).toBe(200);
  });

  it('a record that becomes antenatal has its stored LMP checked again: a stale one is refused', async () => {
    const p = await lossPatient();
    await Patient.updateOne({ _id: p.id, tenantId: hospital._id }, { $set: { 'pregnancy.lmp': new Date('2025-10-16T00:00:00Z') } }); // 50 weeks ago
    const res = await edit(p, { careType: 'antenatal' });
    expect(res.status).toBe(400);
    expect(fieldsOf(res)['pregnancy.lmp']).toBe('LMP is more than 45 weeks ago – please check the date');
    expect((await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean()).careType).toBe('abortion');
    const fresh = await edit(p, { careType: 'antenatal', pregnancy: { lmp: '2026-09-01' } });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);
  });
});

describe('changing an antenatal patient to Abortion', () => {
  it('pauses her antenatal plan, clears the risk level and keeps the pregnancy dates; her pregnancy-loss plan starts by itself', async () => {
    const p = await register({
      careType: 'antenatal',
      fullName: 'Changed Sample',
      pregnancy: { lmp: '2026-08-02' },
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 1, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 158, weightKg: 60, conditionsReviewed: true },
    });
    expect(p.risk.level).toBeTruthy();
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id, status: 'active' })).toBe(1);
    const res = await edit(p, { careType: 'abortion', abortion: { lossType: 'missed', lmp: '2026-08-02' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.patient.risk.level).toBe(null);
    expect(res.body.patient.gestationalAge).toBe(null);
    const plan = await CarePlan.findOne({ tenantId: hospital._id, patientId: p.id, careType: 'antenatal' }).lean();
    expect(plan).toMatchObject({ careType: 'antenatal', status: 'paused', pausedReason: 'care_type_changed' });
    expect(day((await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean()).pregnancy.lmp)).toBe('2026-08-02');
    // The plan for the loss, counted from the date seen (today), is the one shown; the antenatal plan is kept under Earlier plans
    const view = (await (await as('drA')).get(`/api/patients/${p.id}/care-plan`)).body;
    expect(view.plan).toMatchObject({ careType: 'abortion', status: 'active' });
    expect(day(view.plan.startOn)).toBe('2026-10-01');
    expect(view.earlierPlans.map((e) => [e.careType, e.status])).toEqual([['antenatal', 'paused']]);
  });

  it('a new Abortion record gets its care plan by itself once the type of loss is entered; it cannot be started by hand', async () => {
    const before = await register({ careType: 'abortion', fullName: 'No Details Sample', medical: { allergies: 'None known' } });
    expect((await (await as('drA')).get(`/api/patients/${before.id}/care-plan`)).body).toMatchObject({ plan: null, reason: 'no_loss_details' });
    const p = await lossPatient();
    const view = (await (await as('drA')).get(`/api/patients/${p.id}/care-plan`)).body;
    expect(view).toMatchObject({ plan: { careType: 'abortion', status: 'active', startWord: 'loss' }, reason: null });
    const res = await (await as('drA')).post(`/api/patients/${p.id}/care-plan/start`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('This plan starts by itself from the pregnancy dates, the delivery, the birth or the date a pregnancy loss was seen.');
    expect((await (await as('drA')).get(`/api/patients/${p.id}`)).body.patient.carePlanSummary).toMatchObject({ exists: true, careType: 'abortion' });
  });
});

describe('who sees and changes the details', () => {
  it('nurses and RMOs see them; reception and lab see only the type of care; reception cannot change them; other hospitals get 404', async () => {
    const p = await lossPatient();
    for (const who of ['nurse', 'rmo']) {
      const res = await (await as(who)).get(`/api/patients/${p.id}`);
      expect(res.body.patient.abortion.lossType, who).toBe('missed');
    }
    for (const who of ['reception', 'lab']) {
      const res = await (await as(who)).get(`/api/patients/${p.id}`);
      expect(res.status, who).toBe(200);
      expect(res.body.patient.careType).toBe('abortion');
      expect(res.body.patient.abortion, who).toBeUndefined();
    }
    const list = await (await as('reception')).get('/api/patients?careType=abortion');
    expect(list.body.patients[0].careType).toBe('abortion');
    expect(list.body.patients[0].abortion).toBeUndefined();
    const refused = await edit(p, { abortion: { lossType: 'complete' } }, 'reception');
    expect(refused.status).toBe(403);
    expect((await edit(p, { abortion: { lossType: 'complete' } }, 'nurse')).status).toBe(403);

    const elsewhere = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Sample outsider' });
    await addMember(outsider, elsewhere, 'doctor');
    const o = await loginAs(outsider, { app });
    expect((await o.get(`/api/patients/${p.id}`)).status).toBe(404);
    expect((await o.patch(`/api/patients/${p.id}`).send({ abortion: { lossType: 'complete' } })).status).toBe(404);
  });
});

describe('a stay in hospital', () => {
  const base = (p) => `/api/patients/${p.id}/admissions`;
  const admit = async (p) => (await as('rmo')).post(base(p)).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-01T02:00:00.000Z', reason: 'Bleeding PV' });
  const newDoc = async (p, a, kind) => (await as('rmo')).post(`${base(p)}/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind });

  it('no delivery note for abortion care (an operation note instead); an earlier delivery draft opens but cannot be saved or confirmed', async () => {
    const p = await register({ careType: 'antenatal', fullName: 'Stay Sample', pregnancy: { lmp: '2026-07-01' }, medical: { allergies: 'None known' } });
    const a = (await admit(p)).body.admission;
    const draft = (await newDoc(p, a, 'delivery')).body.document;
    expect(draft.kind).toBe('delivery');
    expect((await edit(p, { careType: 'abortion', abortion: { lossType: 'incomplete', lmp: '2026-07-01' } })).status).toBe(200);

    const refused = await newDoc(p, a, 'delivery');
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.kind).toBe('A delivery note is not used for the Abortion type of care – use an operation note.');
    const open = await (await as('rmo')).get(`${base(p)}/${a.id}/documents/${draft.id}`);
    expect(open.status).toBe(200);
    const save = await (await as('rmo')).put(`${base(p)}/${a.id}/documents/${draft.id}`).send({ rev: draft.rev, content: { deliveredAt: '2026-10-01T04:00:00.000Z', mode: 'normal' } });
    expect(save.status).toBe(400);
    const sign = await (await as('drA')).post(`${base(p)}/${a.id}/documents/${draft.id}/sign`).send({ rev: draft.rev });
    expect(sign.status).toBe(400);

    const op = await newDoc(p, a, 'operation');
    expect(op.status, JSON.stringify(op.body)).toBe(201);
    const saved = await (await as('rmo')).put(`${base(p)}/${a.id}/documents/${op.body.document.id}`).send({ rev: 0, content: { performedAt: '2026-10-01T05:00:00.000Z', procedure: 'Suction evacuation' } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  });
});

describe('the calendar, AI and reminders', () => {
  it('no LMP or EDD dates on the calendar, even with old pregnancy dates stored', async () => {
    const p = await lossPatient();
    await Patient.updateOne({ _id: p.id, tenantId: hospital._id }, { $set: { 'pregnancy.lmp': new Date('2026-08-02T00:00:00Z'), 'pregnancy.effectiveEdd': new Date('2027-05-09T00:00:00Z') } });
    for (const date of ['2026-08-02', '2027-05-09']) {
      const res = await (await as('drA')).get(`/api/calendar?view=month&date=${date}&types=edd,lmp&scope=all`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.events.filter((e) => e.patientId === p.id)).toEqual([]);
    }
  });

  it('the AI is told the pregnancy loss, never an EDD or weeks today; a weeks search leaves abortion patients out', async () => {
    const p = await lossPatient();
    await Patient.updateOne({ _id: p.id, tenantId: hospital._id }, { $set: { 'pregnancy.effectiveEdd': new Date('2027-03-01T00:00:00Z') } });
    fakeOpenAI();
    answer = { points: [{ text: 'Missed miscarriage at 8 weeks.', important: true }], missing: [] };
    const res = await (await as('drA')).post(`/api/patients/${p.id}/ai/summary`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const text = sent[0].body.messages[1].content; // the record (the instructions are the same for every patient)
    expect(text).toContain('Type of care: abortion (pregnancy loss)');
    expect(text).toContain('Pregnancy loss: missed miscarriage, 8w 4d at presentation');
    expect(text).not.toMatch(/EDD|weeks today/);

    const none = { careTypes: [], weeksFrom: null, weeksTo: null, eddFrom: null, eddTo: null, riskLevels: [], redFlags: null, carePlan: [], carePlanItem: null, conditions: [], pastComplications: [], rhNegative: null, previousCaesareansAtLeast: null, ageFrom: null, ageTo: null, seenFrom: null, seenTo: null, notSeenForDays: null, mine: false };
    answer = { ...none, understood: 'Patients from 10 weeks.', unsupported: '', weeksFrom: 10 };
    const ask = await (await as('nurse')).post('/api/ai/ask').send({ question: 'over 10 weeks' });
    expect(ask.status, JSON.stringify(ask.body)).toBe(200);
    expect(ask.body.results).toEqual([]);
    answer = { ...none, understood: 'Abortion patients.', unsupported: '', careTypes: ['abortion'] };
    const all = await (await as('nurse')).post('/api/ai/ask').send({ question: 'abortion patients' });
    expect(all.body.results.map((r) => [r.id, r.edd, r.gestationalAge])).toEqual([[p.id, null, null]]);
  });

  it('the AI is also told the site, the kind of mole, histology, anti-D and the typed note (her name taken out)', async () => {
    fakeOpenAI();
    answer = { points: [{ text: 'Pregnancy loss.', important: true }], missing: [] };
    const ectopic = await lossPatient({
      lossType: 'ectopic',
      ectopicSite: 'scar',
      presentedOn: '2026-10-01',
      management: { method: 'laparoscopy', on: '2026-10-01', outcome: 'complete' },
      antiD: { status: 'given', on: '2026-10-01' },
      note: 'Loss Sample seen with pain',
    });
    expect((await (await as('drA')).post(`/api/patients/${ectopic.id}/ai/summary`)).status).toBe(200);
    const ectopicText = sent.at(-1).body.messages[1].content;
    expect(ectopicText).toContain('site: caesarean scar');
    expect(ectopicText).toContain('anti-D: given on 2026-10-01');
    expect(ectopicText).toContain('Pregnancy loss note (typed): [patient] [patient] seen with pain');
    expect(ectopicText).not.toMatch(/Loss Sample|EDD|weeks today/);
    const molar = await lossPatient({
      lossType: 'molar',
      moleKind: 'partial',
      presentedOn: '2026-10-01',
      management: { method: 'suction_evacuation', on: '2026-10-01' },
      histology: { status: 'received', result: 'partial mole' },
    });
    expect((await (await as('drA')).post(`/api/patients/${molar.id}/ai/summary`)).status).toBe(200);
    const molarText = sent.at(-1).body.messages[1].content;
    expect(molarText).toContain('Pregnancy loss: molar pregnancy, partial mole,');
    expect(molarText).toContain('histology: result received (partial mole)');
    expect(molarText).not.toMatch(/anti-D: |Pregnancy loss note/);
  });

  it('voice entry suggestions: pregnancy dates only for antenatal, pregnancy-loss fields only for abortion care', () => {
    const today = new Date('2026-10-01T00:00:00Z');
    const raw = [
      { part: 0, field: 'pregnancy.lmp', value: '2026-08-02' },
      { part: 0, field: 'abortion.lmp', value: '2026-08-02' },
      { part: 1, field: 'abortion.lossType', value: 'missed' },
      { part: 1, field: 'abortion.weeks', value: '8' },
    ];
    const parts = ['LMP 2 August', 'missed at 8 weeks'];
    const loss = checkSuggestions(raw, { form: 'patient', parts, today, careType: 'abortion' });
    expect(loss.map((s) => s.field)).toEqual(['abortion.lmp', 'abortion.lossType']); // weeks: from the LMP
    expect(loss[1].label).toBe('Type of loss: missed');
    const ante = checkSuggestions(raw, { form: 'patient', parts, today, careType: 'antenatal' });
    expect(ante.map((s) => s.field)).toEqual(['pregnancy.lmp']);
    expect(checkSuggestions([{ part: 0, field: 'abortion.lossType', value: 'induced' }], { form: 'patient', parts, today, careType: 'abortion' })).toEqual([]);
    // Anti-D: the section's own answers (so the website fills the Anti-D field), only in abortion care
    const antiD = [{ part: 1, field: 'abortion.antiD', value: 'given' }, { part: 1, field: 'abortion.antiD', value: 'maybe' }];
    expect(checkSuggestions(antiD, { form: 'patient', parts, today, careType: 'abortion' }).map((s) => [s.field, s.value, s.label])).toEqual([['abortion.antiD', 'given', 'Anti-D: given']]);
    expect(checkSuggestions(antiD, { form: 'patient', parts, today, careType: 'antenatal' })).toEqual([]);
    expect(fieldList('patient', 'antenatal')).not.toContain('abortion.');
    expect(fieldList('patient', 'abortion')).not.toContain('pregnancy.');
  });

  it('the reminder never names the pregnancy loss', async () => {
    const p = await lossPatient();
    const res = await (await as('drA')).get(`/api/patients/${p.id}/reminder`);
    expect(res.status).toBe(200);
    // Her care plan's tests are in it (5 Oct 2026: staff prepare the reminder themselves), in her words only
    expect(res.body.plan.due.map((i) => [i.name, i.patientText])).toContainEqual(['Blood test for haemoglobin', 'Blood test for haemoglobin']);
    // (her name and the hospital's name are made up here: left out of the check)
    const words = JSON.stringify({ ...res.body, patient: { ...res.body.patient, fullName: undefined, careType: undefined }, hospital: undefined });
    expect(words).not.toMatch(/abortion|miscarriage|loss|pregnan/i);
  });
});
