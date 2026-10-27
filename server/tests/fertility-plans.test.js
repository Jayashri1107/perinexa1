// Fertility treatment plans (docs/FERTILITY_PLAN.md – approved library): the fertility history on an infertility record,
// the protocol suggestions read from it, building a plan from the chosen protocols, editing it, a doctor confirming
// it, ending it with an outcome, who may do what, and an audit log with ids only. All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import * as fields from '../src/fertility/fertilityFields.js';
import { COUNTER_FOR_PROTOCOL, LADDER_STEPS, PROCEDURES, SWITCH_TARGETS, counterFor, stepOf } from '../src/fertility/ladder.js';
import { BODIES, GROUPS, PROTOCOLS, SECTION_KEYS, composePlan, protocolByKey } from '../src/fertility/protocols.js';
import { fertilityFacts, suggestProtocols } from '../src/fertility/suggest.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Patient } from '../src/models/Patient.js';
import * as website from '../../client/src/pages/patients/fertilityFormat.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const fits = (s) => Object.fromEntries(s.options.filter((o) => o.fit !== 'other').map((o) => [o.key, o.fit]));
const woman = (fertility, extra = {}) => ({ careType: 'infertility', ageYears: 29, ageRecordedOn: new Date(), medical: { heightCm: 160, weightKg: 58 }, obstetric: {}, fertility, ...extra });

describe('the protocol library', () => {
  it('has one entry per situation, every section named, its sources known, and no exclamation marks', () => {
    expect(PROTOCOLS.length).toBe(21);
    for (const p of PROTOCOLS) {
      expect(p.key && p.name && p.short && p.summary && p.whenToUse).toBeTruthy();
      expect(Object.keys(GROUPS)).toContain(p.group);
      expect(p.bodies.length).toBeGreaterThan(0);
      for (const b of p.bodies) expect(BODIES[b], `${p.key}: ${b}`).toBeDefined();
      expect(p.sections.aim?.length).toBeGreaterThan(0);
      for (const k of Object.keys(p.sections)) expect(SECTION_KEYS).toContain(k);
    }
    expect(JSON.stringify(PROTOCOLS)).not.toMatch(/!/);
    // The words for the baby's sex never appear as a choice: there is nothing to select by sex anywhere in the library
    expect(JSON.stringify(PROTOCOLS)).not.toMatch(/\b(boy|girl|son|daughter)\b/i);
  });

  it('builds one editable plan from one or several protocols, with the general advice once and the sources', () => {
    const one = composePlan(['unexplained']);
    expect(one.title).toBe(protocolByKey.get('unexplained').name);
    expect(one.sections.map((s) => s.key)).toEqual(['aim', 'cautions', 'investigations', 'treatment', 'medicines', 'monitoring', 'review', 'counselling', 'general']);
    expect(one.sections.find((s) => s.key === 'treatment').text).toMatch(/^• Step 1/);
    const two = composePlan(['oi_letrozole', 'male_mild']);
    expect(two.title).toContain(' + ');
    const treatment = two.sections.find((s) => s.key === 'treatment').text;
    expect(treatment).toContain('Letrozole induction\n• ');
    expect(treatment).toContain('Mild male factor\n• ');
    expect(two.sections.filter((s) => s.key === 'general')).toHaveLength(1);
    expect(two.sources.map((s) => s.key)).toEqual(['oi_letrozole', 'male_mild']);
    // The preconception protocol IS the general advice, so it is not added twice
    expect(composePlan(['preconception']).sections.some((s) => s.key === 'general')).toBe(false);
    expect(composePlan(['nope'])).toMatchObject({ title: '', sections: [], sources: [] });
  });

  it('has a ladder – follicular study, IUI, IVF – and the other procedures, each naming a protocol', () => {
    expect(LADDER_STEPS.map((s) => [s.key, s.counter])).toEqual([
      ['follicular_study', 'oiCycles'],
      ['iui', 'iuiCycles'],
      ['ivf', 'ivfCycles'],
    ]);
    expect(PROCEDURES.map((p) => p.key)).toEqual(['los', 'tubal', 'uterine', 'endometriosis', 'varicocele', 'sperm_retrieval', 'donor', 'preservation']);
    for (const t of SWITCH_TARGETS) for (const k of t.protocols) expect(protocolByKey.has(k), `${t.key}: ${k}`).toBe(true);
    for (const k of Object.keys(COUNTER_FOR_PROTOCOL)) expect(protocolByKey.has(k), k).toBe(true);
    expect(stepOf(['oi_letrozole', 'preconception'])).toBe('follicular_study');
    expect(stepOf(['iui', 'male_mild'])).toBe('iui');
    expect(stepOf(['oi_letrozole', 'ivf'])).toBe('ivf');
    expect(stepOf(['tubal'])).toBeNull();
    expect(counterFor(['iui'])).toBe('iuiCycles');
    expect(counterFor(['uterine'])).toBeNull();
  });

  it('keeps the same lists as the website', () => {
    const choices = Object.fromEntries(website.FERTILITY_CHOICES.map((c) => [c.key, Object.keys(c.labels)]));
    expect(choices).toEqual({
      type: fields.FERTILITY_TYPES,
      cycle: fields.CYCLE_PATTERNS,
      ovulation: fields.OVULATION_STATUS,
      tubes: fields.TUBAL_STATUS,
      uterus: fields.UTERINE_FINDINGS,
      endometriosis: fields.ENDOMETRIOSIS_STATUS,
      semen: fields.SEMEN_STATUS,
    });
    expect(Object.keys(website.DIAGNOSIS_LABELS)).toEqual(fields.FERTILITY_DIAGNOSES);
    expect(website.FERTILITY_NUMBER_FIELDS.map((n) => [n.key, n.min, n.max])).toEqual(Object.entries(fields.FERTILITY_NUMBERS).map(([k, r]) => [k, r.min, r.max]));
    expect(website.FERTILITY_TEXT_FIELDS.map((t) => [t.key, t.max])).toEqual(Object.entries(fields.FERTILITY_TEXTS).map(([k, t]) => [k, t.max]));
    expect(website.COMPLETED_KINDS).toEqual(['pregnant', 'next_step']);
  });
});

describe('the suggestions', () => {
  it('ask for the evaluation while ovulation, tubes and semen are unknown, and list what is missing', () => {
    const s = suggestProtocols(woman(null));
    expect(fits(s)).toEqual({ evaluation: 'recommended' });
    expect(s.facts.recorded).toBe(false);
    expect(s.facts.missing.map((m) => m.key)).toEqual(['duration', 'ovulation', 'tubes', 'semen']);
    const partly = suggestProtocols(woman({ durationMonths: 14, ovulation: 'confirmed', tubes: 'not_tested', semen: 'not_tested' }));
    expect(fits(partly).evaluation).toBe('recommended');
    expect(partly.options[0].reasons[0]).toContain('Still to be tested');
    // Less than a year of trying, nothing abnormal: preconception care first
    const early = suggestProtocols(woman({ durationMonths: 6, cycle: 'regular', ovulation: 'confirmed', tubes: 'patent_both', semen: 'normal' }));
    expect(fits(early).preconception).toBe('recommended');
  });

  it('PCOS with anovulation: letrozole first, gonadotrophins after six cycles, IVF when the tubes or the semen rule induction out', () => {
    const pcos = { durationMonths: 18, cycle: 'irregular', ovulation: 'anovulation', tubes: 'patent_both', semen: 'normal', diagnoses: ['pcos'] };
    expect(fits(suggestProtocols(woman(pcos)))).toEqual({ oi_letrozole: 'recommended' });
    const heavy = suggestProtocols(woman(pcos, { medical: { heightCm: 160, weightKg: 85 } }));
    expect(heavy.options[0].cautions.join(' ')).toContain('BMI 33.2');
    const six = fits(suggestProtocols(woman({ ...pcos, oiCycles: 6 })));
    expect(six).toMatchObject({ oi_gonadotrophins: 'recommended', los: 'consider', ivf: 'consider' });
    expect(six.oi_letrozole).toBeUndefined();
    expect(fits(suggestProtocols(woman({ ...pcos, tubes: 'both_blocked' })))).toMatchObject({ ivf: 'recommended' });
    expect(fits(suggestProtocols(woman({ ...pcos, semen: 'azoospermia' })))).toMatchObject({ ivf: 'recommended', male_severe: 'recommended', donor: 'consider', oi_letrozole: 'consider' });
    // Low FSH and LH: not letrozole; raised prolactin: cabergoline; amenorrhoea with high FSH before 40: ovarian insufficiency
    expect(fits(suggestProtocols(woman({ cycle: 'amenorrhoea', diagnoses: ['hypogonadotropic'], tubes: 'patent_both', semen: 'normal' })))).toEqual({ oi_group1: 'recommended' });
    expect(fits(suggestProtocols(woman({ cycle: 'irregular', prolactin: 60, tubes: 'patent_both', semen: 'normal' }))).hyperprolactinaemia).toBe('recommended');
    expect(fits(suggestProtocols(woman({ cycle: 'amenorrhoea', fsh: 42, tubes: 'patent_both', semen: 'normal' })))).toMatchObject({ poi: 'recommended', donor: 'consider' });
  });

  it('tubal, male, endometriosis and uterine findings each bring their protocol', () => {
    const base = { durationMonths: 24, cycle: 'regular', ovulation: 'confirmed', semen: 'normal' };
    expect(fits(suggestProtocols(woman({ ...base, tubes: 'hydrosalpinx' })))).toEqual({ tubal: 'recommended', ivf: 'recommended' });
    expect(fits(suggestProtocols(woman({ ...base, tubes: 'both_blocked' })))).toEqual({ tubal: 'recommended', ivf: 'consider' }); // she is 29
    expect(fits(suggestProtocols(woman({ ...base, tubes: 'both_blocked' }, { ageYears: 37 })))).toMatchObject({ ivf: 'recommended', tubal: 'consider' });
    expect(fits(suggestProtocols(woman({ ...base, tubes: 'patent_both', semen: 'mild_abnormal' })))).toEqual({ male_mild: 'recommended', iui: 'consider' });
    expect(fits(suggestProtocols(woman({ ...base, tubes: 'patent_both', semen: 'severe_abnormal' })))).toEqual({ male_severe: 'recommended', ivf: 'recommended' });
    expect(fits(suggestProtocols(woman({ ...base, tubes: 'patent_both', endometriosis: 'minimal_mild' })))).toEqual({ endometriosis: 'recommended' });
    expect(fits(suggestProtocols(woman({ ...base, tubes: 'patent_both', endometriosis: 'moderate_severe' })))).toEqual({ endometriosis: 'recommended', ivf: 'recommended' });
    expect(fits(suggestProtocols(woman({ ...base, tubes: 'patent_both', uterus: 'septum' })))).toMatchObject({ uterine: 'recommended' });
    expect(suggestProtocols(woman({ ...base, tubes: 'patent_both', uterus: 'septum' })).options[0].reasons[0]).toContain('no resection');
  });

  it('unexplained infertility is stepped by prognosis, and age or low reserve shortens every step', () => {
    const un = { durationMonths: 18, type: 'primary', cycle: 'regular', ovulation: 'confirmed', tubes: 'patent_both', semen: 'normal', endometriosis: 'none' };
    expect(fits(suggestProtocols(woman(un)))).toEqual({ unexplained: 'recommended', iui: 'consider' });
    expect(fits(suggestProtocols(woman(un, { ageYears: 36 })))).toMatchObject({ unexplained: 'recommended', iui: 'recommended', dor: 'consider' });
    expect(fits(suggestProtocols(woman({ ...un, iuiCycles: 3 })))).toMatchObject({ ivf: 'recommended' });
    const forty = suggestProtocols(woman(un, { ageYears: 41 }));
    expect(fits(forty)).toMatchObject({ dor: 'recommended', ivf: 'recommended' });
    const low = suggestProtocols(woman({ ...un, amh: 0.6, afc: 4 }));
    expect(fits(low).dor).toBe('recommended');
    expect(low.options.find((o) => o.key === 'dor').reasons[0]).toContain('AMH 0.6');
    // The ART Act's ages are a caution, never a silent refusal
    const older = suggestProtocols(woman(un, { ageYears: 52 }));
    expect(older.options.find((o) => o.key === 'ivf').cautions.join(' ')).toContain('upper age of 50');
    // Three losses: the recurrent-loss work-up
    expect(fits(suggestProtocols(woman(un, { obstetric: { gravida: 3, para: 0, abortions: 3 } }))).rpl).toBe('recommended');
    expect(fertilityFacts(woman(un)).bmi).toBe(22.7);
  });
});

const NOW = new Date('2026-10-20T06:00:00Z');
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
  app = createApp();
  hospital = await createTenant('Fertility Hospital');
  other = await createTenant('Other Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.drOther = await createUser({ name: 'Sample other' });
  await addMember(people.drOther, other, 'doctor');
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'infertility', fullName: 'Sample Couple', ageYears: 31, assignedDoctor: people.drA._id.toString(), medical: { allergies: 'None known', heightCm: 160, weightKg: 62 }, ...overrides }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const PCOS = { type: 'primary', durationMonths: 20, cycle: 'irregular', ovulation: 'anovulation', tubes: 'patent_both', uterus: 'normal', endometriosis: 'none', semen: 'normal', diagnoses: ['pcos'], amh: 6.2, afc: 24 };
const history = async (who, p, fertility = PCOS) => (await as(who)).patch(`/api/patients/${p.id}`).send({ fertility });
const url = (p, path = '') => `/api/patients/${p.id}/fertility-plan${path}`;
const build = async (who, p, protocolKeys = ['oi_letrozole'], extra = {}) => (await as(who)).post(url(p)).send({ clientRequestId: randomUUID(), protocolKeys, ...extra });

describe('the fertility history on the record', () => {
  it('is written by her doctor or an RMO on an infertility record only, seen with the medical details, and audited as one field', async () => {
    const p = await register();
    expect(p.fertility).toBeNull();
    expect(p.access).toMatchObject({ canViewFertilityPlan: true, canEditFertilityPlan: true });
    const res = await history('drA', p);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.patient.fertility).toMatchObject({ type: 'primary', durationMonths: 20, diagnoses: ['pcos'], amh: 6.2 });
    // Out of range or not on the list: refused with the field named
    expect((await history('drA', p, { amh: 80 })).body.error.fields).toHaveProperty('fertility.amh');
    expect((await history('drA', p, { tubes: 'open' })).body.error.fields).toHaveProperty('fertility.tubes');
    expect((await history('drA', p, { oiCycles: 2.5 })).body.error.fields).toHaveProperty('fertility.oiCycles');
    expect((await history('drA', p, { fetalSex: 'x' })).status).toBe(400);
    // Field by field: a later save of one fact keeps the rest
    expect((await history('rmo', p, { oiCycles: 3 })).body.patient.fertility).toMatchObject({ oiCycles: 3, diagnoses: ['pcos'], tubes: 'patent_both' });
    // Only on an infertility record
    const g = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', ageYears: 30, medical: { allergies: 'None known' } }))).body.patient;
    expect((await history('drA', g)).status).toBe(400);
    expect((await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', ageYears: 30, fertility: PCOS }))).status).toBe(400);
    // Who sees it: her doctor and RMOs (the record is sensitive); reception and nurses never
    const rmoView = (await (await as('rmo')).get(`/api/patients/${p.id}`)).body.patient;
    expect(rmoView.fertility.diagnoses).toEqual(['pcos']);
    for (const who of ['reception', 'nurse', 'drB']) {
      const view = (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;
      expect(view.fertility, who).toBeUndefined();
      expect(view.access.canViewFertilityPlan, who).toBe(false);
    }
    // The audit log names the section, never which fact
    const entries = await AuditLog.find({ action: 'PATIENT_UPDATED' }).lean();
    const changed = entries.flatMap((e) => e.details.fields);
    expect(changed).toContain('fertility');
    expect(changed.some((f) => f.startsWith('fertility.'))).toBe(false);
  });
});

describe('a treatment plan', () => {
  it('is suggested from the record, built from the chosen protocols, edited with versions kept, confirmed by a doctor and ended with an outcome', async () => {
    const p = await register();
    const dr = await as('drA');
    // Nothing recorded yet: the evaluation is suggested and the record says what is missing
    let res = await dr.get(url(p));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: null, earlier: [], access: { canCreate: true, canSuggest: true, canActivate: false, canEdit: false } });
    expect(res.body.facts.missing.map((m) => m.key)).toEqual(['duration', 'ovulation', 'tubes', 'semen']);
    res = await dr.get(url(p, '/suggestions'));
    expect(res.status).toBe(200);
    expect(res.body.options[0]).toMatchObject({ key: 'evaluation', fit: 'recommended' });
    expect(res.body.library).toHaveLength(21);
    // Approved by the owner on 27 Oct 2026: no DRAFT banner, the doctor-to-confirm note stays
    expect(res.body.libraryNote).toMatch(/^Protocol library approved/);
    expect(res.body.libraryNote).not.toMatch(/DRAFT/);
    expect(res.body.libraryNote).toMatch(/doctor to confirm/);
    // With her history: letrozole first
    await history('drA', p);
    res = await dr.get(url(p, '/suggestions'));
    expect(res.body.options[0]).toMatchObject({ key: 'oi_letrozole', fit: 'recommended' });
    expect(res.body.options[0].reasons[0]).toContain('PCOS with anovulation');
    expect(res.body.facts.missing).toEqual([]);

    // Build a draft from two protocols
    expect((await build('drA', p, ['nope'])).status).toBe(400);
    expect((await build('drA', p, [])).status).toBe(400);
    res = await build('drA', p, ['oi_letrozole', 'preconception']);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    let plan = res.body.plan;
    expect(plan).toMatchObject({ status: 'draft', protocolKeys: ['oi_letrozole', 'preconception'], rev: 0, libraryVersion: '2026-10-27' });
    expect(plan.startOn).toBe('2026-10-20T00:00:00.000Z');
    expect(plan.sections.map((s) => s.key)).toContain('medicines');
    expect(plan.sections.find((s) => s.key === 'medicines').text).toContain('Letrozole 2.5 mg');
    expect(plan.sources).toHaveLength(2);
    expect(plan.suggested).toEqual(expect.arrayContaining([{ key: 'oi_letrozole', fit: 'recommended' }]));
    expect(plan.created).toEqual({ byName: 'Sample drA', at: NOW.toISOString() });
    expect(res.body.access).toMatchObject({ canEdit: true, canActivate: true });
    // One plan at a time; the same request twice answers with the same plan
    expect((await build('drA', p)).status).toBe(409);
    const again = await dr.post(url(p)).send({ clientRequestId: randomUUID(), protocolKeys: ['ivf'] });
    expect(again.body.error.code).toBe('PLAN_EXISTS');
    res = await dr.get(url(p));
    expect(res.body.plan.id).toBe(plan.id);
    expect(res.body.access).toMatchObject({ canCreate: false, canEdit: true, canActivate: true });

    // An RMO edits the text; the previous version is kept; a stale version is refused
    const rmo = await as('rmo');
    const sections = plan.sections.map((s) => (s.key === 'medicines' ? { ...s, text: '• Letrozole 2.5 mg daily, day 3 to 7 (our clinic).' } : s));
    res = await rmo.put(url(p, `/${plan.id}`)).send({ rev: plan.rev, title: 'Letrozole – cycle 1 of 6', startOn: '2026-10-22', reviewOn: '2026-11-20', sections });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    plan = res.body.plan;
    expect(plan).toMatchObject({ rev: 1, title: 'Letrozole – cycle 1 of 6', reviewOn: '2026-11-20T00:00:00.000Z' });
    expect(plan.sections.find((s) => s.key === 'medicines').text).toBe('• Letrozole 2.5 mg daily, day 3 to 7 (our clinic).');
    expect(plan.versions).toHaveLength(1);
    expect(plan.versions[0].sections.find((s) => s.key === 'medicines').text).toContain('Letrozole 2.5 mg daily for 5 days');
    expect(plan.lastEdited.byName).toBe('Sample rmo');
    res = await rmo.put(url(p, `/${plan.id}`)).send({ rev: 0, title: 'Stale', startOn: null, reviewOn: null, sections });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await rmo.put(url(p, `/${plan.id}`)).send({ rev: plan.rev, title: '', startOn: null, reviewOn: null, sections })).status).toBe(400);
    expect((await rmo.put(url(p, `/${plan.id}`)).send({ rev: plan.rev, title: 'x', startOn: null, reviewOn: null, sections: [{ key: 'aim', title: 'Aim', text: 'x', extra: 1 }] })).status).toBe(400);

    // Only a doctor confirms; a draft cannot be "completed"
    res = await rmo.post(url(p, `/${plan.id}/status`)).send({ rev: plan.rev, status: 'active' });
    expect(res.status).toBe(403);
    expect((await dr.post(url(p, `/${plan.id}/status`)).send({ rev: plan.rev, status: 'completed', outcome: { kind: 'pregnant' } })).status).toBe(400);
    res = await dr.post(url(p, `/${plan.id}/status`)).send({ rev: plan.rev, status: 'active' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    plan = res.body.plan;
    expect(plan.status).toBe('active');
    expect(plan.activated.byName).toBe('Sample drA');
    expect(res.body.access.canActivate).toBe(false);
    expect((await dr.post(url(p, `/${plan.id}/status`)).send({ rev: plan.rev, status: 'active' })).status).toBe(400); // already

    // Ended as planned: pregnant. Then the record has no current plan and one earlier plan.
    expect((await rmo.post(url(p, `/${plan.id}/status`)).send({ rev: plan.rev, status: 'completed', outcome: { kind: 'no_response' } })).status).toBe(400);
    res = await rmo.post(url(p, `/${plan.id}/status`)).send({ rev: plan.rev, status: 'completed', outcome: { kind: 'pregnant', note: 'Cycle 2' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.plan).toMatchObject({ status: 'completed', outcome: { kind: 'pregnant', note: 'Cycle 2', byName: 'Sample rmo' } });
    expect((await rmo.put(url(p, `/${plan.id}`)).send({ rev: res.body.plan.rev, title: 'Late', startOn: null, reviewOn: null, sections })).body.error.code).toBe('PLAN_CLOSED');
    res = await dr.get(url(p));
    expect(res.body.plan).toBeNull();
    expect(res.body.earlier.map((e) => [e.id, e.status])).toEqual([[plan.id, 'completed']]);
    expect(res.body.access.canCreate).toBe(true);

    // A second plan, stopped by the couple's choice (a reason is needed); a draft can be discarded without one
    res = await build('rmo', p, ['oi_gonadotrophins']);
    expect(res.status).toBe(201);
    const second = res.body.plan;
    expect((await rmo.post(url(p, `/${second.id}/status`)).send({ rev: 0, status: 'stopped', outcome: { kind: 'patient_choice', note: 'no' } })).body.error.fields).toHaveProperty('outcome.note');
    expect((await rmo.post(url(p, `/${second.id}/status`)).send({ rev: 0, status: 'stopped' })).status).toBe(400);
    res = await rmo.post(url(p, `/${second.id}/status`)).send({ rev: 0, status: 'stopped', outcome: { kind: 'discarded' } });
    expect(res.status).toBe(200);
    expect(res.body.plan.status).toBe('stopped');
    res = await build('drA', p, ['iui']);
    res = await dr.post(url(p, `/${res.body.plan.id}/status`)).send({ rev: 0, status: 'stopped', outcome: { kind: 'patient_choice', note: 'The couple want to wait a year.' } });
    expect(res.status).toBe(200);
    res = await dr.get(url(p));
    expect(res.body.earlier).toHaveLength(3);

    // The audit log: ids and the status only – never a protocol name or any text
    const entries = await AuditLog.find({ action: /^FERTILITY_PLAN_/ }).lean();
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['FERTILITY_PLAN_VIEWED', 'FERTILITY_PLAN_CREATED', 'FERTILITY_PLAN_EDITED', 'FERTILITY_PLAN_STATUS_CHANGED']));
    for (const e of entries) {
      for (const k of Object.keys(e.details)) expect(['patientId', 'mrn', 'planId', 'protocols', 'status', 'fromPlanId']).toContain(k);
      expect(JSON.stringify(e.details)).not.toMatch(/letrozole|iui|gonadotrophin/i);
    }
  });

  it('switches up the ladder: the old plan is closed as moved on, the cycles done go to her record, and the next plan says where it came from', async () => {
    const p = await register();
    await history('drA', p);
    const dr = await as('drA');
    // Start directly with a step of the ladder (no protocol keys needed)
    let res = await dr.post(url(p)).send({ clientRequestId: randomUUID(), target: 'follicular_study' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    let plan = res.body.plan;
    expect(plan).toMatchObject({ protocolKeys: ['follicular_study'], step: 'follicular_study', switchedFrom: null });
    expect((await dr.post(url(p)).send({ clientRequestId: randomUUID(), target: 'iui', protocolKeys: ['ivf'] })).status).toBe(400); // one or the other
    expect((await dr.post(url(p)).send({ clientRequestId: randomUUID() })).status).toBe(400);
    res = await dr.post(url(p, `/${plan.id}/status`)).send({ rev: plan.rev, status: 'active' });
    plan = res.body.plan;

    // Switch to IUI after four cycles (a stale version is refused; another plan in progress is not made)
    expect((await dr.post(url(p)).send({ clientRequestId: randomUUID(), target: 'iui', switchFrom: { planId: plan.id, rev: 0, cyclesDone: 4 } })).status).toBe(409);
    res = await dr.post(url(p)).send({ clientRequestId: randomUUID(), target: 'iui', switchFrom: { planId: plan.id, rev: plan.rev, cyclesDone: 4, note: 'Ovulated every cycle, no pregnancy.' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const iui = res.body.plan;
    expect(iui).toMatchObject({ status: 'draft', protocolKeys: ['iui'], step: 'iui', switchedFrom: { planId: plan.id, title: plan.title } });
    expect(iui.sections[0].key).toBe('aim');
    expect(iui.sections[0].text).toMatch(/^• Switched from “Follicular study with timed intercourse \(natural or stimulated cycle\)” on 20 Oct 2026: Ovulated every cycle, no pregnancy\./);
    expect(res.body.closed).toMatchObject({ id: plan.id, status: 'completed', outcome: { kind: 'next_step', note: 'Switched to “Intrauterine insemination with ovarian stimulation” – Ovulated every cycle, no pregnancy.' } });
    expect(res.body.cyclesRecorded).toEqual({ counter: 'oiCycles', total: 4 });
    const record = (await dr.get(`/api/patients/${p.id}`)).body.patient;
    expect(record.fertility.oiCycles).toBe(4);
    res = await dr.get(url(p));
    expect(res.body.plan.id).toBe(iui.id);
    expect(res.body.earlier.map((e) => [e.id, e.status, e.outcome.kind])).toEqual([[plan.id, 'completed', 'next_step']]);
    expect(res.body.ladder.steps.map((s) => s.key)).toEqual(['follicular_study', 'iui', 'ivf']);
    expect(res.body.ladder.procedures.length).toBe(8);

    // A draft that is switched away from is discarded, not completed; IUI cycles go to the IUI counter; after three
    // IUI cycles the suggestions move to IVF
    res = await dr.post(url(p)).send({ clientRequestId: randomUUID(), target: 'ivf', switchFrom: { planId: iui.id, rev: iui.rev, cyclesDone: 3 } });
    expect(res.status).toBe(201);
    expect(res.body.closed).toMatchObject({ status: 'stopped', outcome: { kind: 'discarded' } });
    expect(res.body.cyclesRecorded).toEqual({ counter: 'iuiCycles', total: 3 });
    expect(res.body.plan.step).toBe('ivf');
    const sugg = await dr.get(url(p, '/suggestions'));
    expect(sugg.body.options.find((o) => o.key === 'ivf').fit).toBe('recommended');
    // A procedure: no cycle counter, the old plan closed all the same
    const ivf = res.body.plan;
    res = await dr.post(url(p)).send({ clientRequestId: randomUUID(), target: 'uterine', switchFrom: { planId: ivf.id, rev: ivf.rev, cyclesDone: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.plan.step).toBeNull();
    expect(res.body.cyclesRecorded).toEqual({ counter: 'ivfCycles', total: 1 }); // the IVF plan's cycle
    const uterine = res.body.plan;
    res = await dr.post(url(p)).send({ clientRequestId: randomUUID(), target: 'donor', switchFrom: { planId: uterine.id, rev: uterine.rev, cyclesDone: 2 } });
    expect(res.body.cyclesRecorded).toBeNull(); // a procedure has no cycles to count
    // Switching from a finished plan is refused
    expect((await dr.post(url(p)).send({ clientRequestId: randomUUID(), target: 'iui', switchFrom: { planId: plan.id, rev: plan.rev + 1, cyclesDone: 0 } })).body.error.code).toBe('PLAN_CLOSED');
    // The audit log: the switch is a status change and a creation, ids only
    const entries = await AuditLog.find({ action: /^FERTILITY_PLAN_/ }).lean();
    for (const e of entries) for (const k of Object.keys(e.details)) expect(['patientId', 'mrn', 'planId', 'protocols', 'status', 'fromPlanId']).toContain(k);
  });

  it('is seen and changed only by those with her medical details, on her own hospital’s record', async () => {
    const p = await register();
    await history('drA', p);
    await build('drA', p);
    // The record is sensitive (infertility): another doctor, a nurse and reception are refused; an RMO is not
    for (const who of ['drB', 'nurse', 'reception']) {
      expect((await (await as(who)).get(url(p))).status, who).toBe(403);
      expect((await (await as(who)).get(url(p, '/suggestions'))).status, who).toBe(403);
      expect((await build(who, p)).status, who).toBe(403);
    }
    expect((await (await as('rmo')).get(url(p))).status).toBe(200);
    // Not sensitive: a nurse reads, but cannot ask for suggestions or change anything
    await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: false });
    const nurse = await as('nurse');
    const seen = await nurse.get(url(p));
    expect(seen.status).toBe(200);
    expect(seen.body.plan.status).toBe('draft');
    expect(seen.body.access).toMatchObject({ canEdit: false, canCreate: false, canActivate: false, canSuggest: false });
    expect((await nurse.get(url(p, '/suggestions'))).status).toBe(403);
    expect((await nurse.put(url(p, `/${seen.body.plan.id}`)).send({ rev: 0, title: 'x', startOn: null, reviewOn: null, sections: seen.body.plan.sections })).status).toBe(403);
    // Another hospital: not found, even with the id
    expect((await (await as('drOther')).get(url(p))).status).toBe(404);
    // A plan on a gynaecology record is refused; a closed record takes no new plan
    const g = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', ageYears: 30, medical: { allergies: 'None known' } }))).body.patient;
    expect((await (await as('drA')).get(url(g))).status).toBe(403);
    expect((await build('drA', g)).status).toBe(403);
    const q = await register({ fullName: 'Sample Closed' });
    await Patient.updateOne({ _id: q.id, tenantId: hospital._id }, { death: { on: new Date('2026-10-01T00:00:00Z'), byName: 'Sample drA', at: NOW } });
    const closed = await build('drA', q);
    expect(closed.status).toBeGreaterThanOrEqual(400);
    expect(closed.body.error.code).toBeDefined();
  });
});
