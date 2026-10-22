// Feature 6: automatic risk level with reasons; doctor override with reason.
// Includes tests for every issue confirmed by the independent code review.
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ANTENATAL_DRAFT, RISK_RULES_VERSION } from '../src/careplans/antenatalDraft.js';
import { RISK_ENGINE_VERSION, assessRisk, evaluateRule, nextAgeChange, overrideNeedsReview, patientFacts } from '../src/careplans/risk.js';
import { applyRisk, ensureStandardTemplates, resetRiskRefreshTimer, riskTemplateFor } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const DAY = 24 * 3600 * 1000;
const lmp = (weeksAgo = 10) => new Date(Date.now() - weeksAgo * 7 * DAY).toISOString().slice(0, 10);
const TEMPLATE = { riskRules: ANTENATAL_DRAFT.riskRules, name: 'Draft', version: 1, status: 'draft' };

// A patient with everything the draft rules need, and nothing risky.
function lowRisk(over = {}) {
  const { medical = {}, obstetric = {}, ...rest } = over;
  return {
    careType: 'antenatal',
    ageYears: 28,
    createdAt: new Date(),
    ...rest,
    medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 58, conditions: [], conditionsReviewed: true, ...medical },
    obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 0, pastComplications: [], complicationsReviewed: true, ...obstetric },
  };
}
const keys = (r) => r.reasons.map((x) => x.key);

describe('risk engine (no database)', () => {
  it('is low only when every rule could be checked and none applies', () => {
    const r = assessRisk(lowRisk(), TEMPLATE);
    expect(r).toMatchObject({ computedLevel: 'low', reasons: [], missing: [], mayBeHigher: false });
  });

  it('is "incomplete" – never "low" – when information is missing', () => {
    const r = assessRisk(lowRisk({ medical: { allergies: 'None known', bloodGroup: '', heightCm: null } }), TEMPLATE);
    expect(r.computedLevel).toBe('incomplete');
    expect(r.missing.sort()).toEqual(['Blood group', 'Height']); // BMI only adds what is actually missing
  });

  it('does not treat "nothing ticked" as "no conditions" – staff must confirm none known', () => {
    const r = assessRisk(lowRisk({ medical: { allergies: 'None known', conditionsReviewed: false }, obstetric: { complicationsReviewed: false } }), TEMPLATE);
    expect(r.computedLevel).toBe('incomplete');
    expect(r.missing).toEqual(['Problems in previous pregnancies (tick any, or confirm none)', 'Pre-existing conditions (tick any, or confirm none known)']);
  });

  it('a first pregnancy (G1) has no previous-pregnancy problems to confirm', () => {
    const r = assessRisk(lowRisk({ obstetric: { gravida: 1, para: 0, living: 0, complicationsReviewed: false } }), TEMPLATE);
    expect(r.computedLevel).toBe('low');
  });

  it('is only a first pregnancy when there were no earlier deliveries, abortions or caesareans', () => {
    // G1 with a previous caesarean is inconsistent – so previous-pregnancy problems must still be answered
    const r = assessRisk(lowRisk({ obstetric: { gravida: 1, para: 0, living: 0, previousCaesareans: 1, complicationsReviewed: false } }), TEMPLATE);
    expect(r.computedLevel).toBe('high');
    expect(r.missing).toContain('Problems in previous pregnancies (tick any, or confirm none)');
    // and it only applies to a current pregnancy
    expect(patientFacts({ ...lowRisk({ obstetric: { gravida: 1, para: 0, living: 0, complicationsReviewed: false } }), careType: 'postnatal' }).complicationsKnown).toBe(false);
  });

  it('previous surgery on the uterus is a (high-risk) condition, not a previous-pregnancy problem', () => {
    const r = assessRisk(lowRisk({ obstetric: { gravida: 1, para: 0, living: 0 }, medical: { allergies: 'None known', conditions: ['uterine_surgery'] } }), TEMPLATE);
    expect(r.computedLevel).toBe('high');
    expect(keys(r)).toEqual(['cond_uterine_surgery']);
  });

  it('is incomplete when the template has no risk rules', () => {
    expect(assessRisk(lowRisk(), { riskRules: [] }).computedLevel).toBe('incomplete');
  });

  it('lists every reason, high before moderate', () => {
    const r = assessRisk(
      lowRisk({ ageYears: 37, medical: { allergies: 'None known', bloodGroup: 'O-', conditions: ['asthma', 'hypertension'] }, obstetric: { gravida: 3, para: 1, abortions: 1, previousCaesareans: 1 } }),
      TEMPLATE,
    );
    expect(r.computedLevel).toBe('high');
    expect(keys(r)).toEqual(['age_over_35', 'previous_caesarean', 'rh_negative', 'cond_hypertension', 'cond_asthma']);
    expect(r.reasons[0].detail).toBe('Age 37 years (rule: over 35)');
  });

  it('research-based cut-offs: under 20, grand multipara from 4, miscarriages 2 → moderate, 3 → high', () => {
    expect(keys(assessRisk(lowRisk({ ageYears: 19 }), TEMPLATE))).toEqual(['age_under_20']);
    expect(keys(assessRisk(lowRisk({ obstetric: { gravida: 5, para: 4, living: 4 } }), TEMPLATE))).toEqual(['grand_multipara']);
    const two = assessRisk(lowRisk({ obstetric: { gravida: 3, para: 1, abortions: 2 } }), TEMPLATE);
    expect(two).toMatchObject({ computedLevel: 'moderate' });
    expect(keys(two)).toEqual(['abortions_2']);
    expect(keys(assessRisk(lowRisk({ obstetric: { gravida: 4, para: 1, abortions: 3 } }), TEMPLATE))).toEqual(['abortions_3_plus']);
  });

  it('uses previous-pregnancy problems and the new conditions', () => {
    const r = assessRisk(lowRisk({ obstetric: { pastComplications: ['pre_eclampsia', 'big_baby'] }, medical: { allergies: 'None known', conditions: ['renal_disease'] } }), TEMPLATE);
    expect(keys(r)).toEqual(['hist_pre_eclampsia', 'cond_renal', 'hist_big_baby']);
  });

  it('is moderate when only moderate rules apply (e.g. BMI 30+), high for BMI 35+', () => {
    const r = assessRisk(lowRisk({ medical: { allergies: 'None known', heightCm: 150, weightKg: 70 } }), TEMPLATE); // BMI 31.1
    expect(r.computedLevel).toBe('moderate');
    expect(r.reasons).toEqual([expect.objectContaining({ key: 'bmi_30_plus', detail: 'BMI 31.1 kg/m² (rule: at least 30)' })]);
    expect(assessRisk(lowRisk({ medical: { allergies: 'None known', heightCm: 150, weightKg: 80 } }), TEMPLATE).computedLevel).toBe('high'); // 35.6
  });

  it('flags "may be higher" when the result is moderate but a high rule could not be checked', () => {
    const r = assessRisk(lowRisk({ medical: { allergies: 'None known', heightCm: 150, weightKg: 70, bloodGroup: '' } }), TEMPLATE);
    expect(r).toMatchObject({ computedLevel: 'moderate', mayBeHigher: true });
    expect(r.missing).toContain('Blood group');
  });

  it('notes that free-text "other conditions" are not checked', () => {
    expect(assessRisk(lowRisk({ medical: { allergies: 'None known', otherConditions: 'Sickle cell trait' } }), TEMPLATE).freeTextNotChecked).toBe(true);
  });

  it('checks thresholds exactly at the boundary', () => {
    const rule = (op, value) => ({ factor: 'age', op, value, level: 'high' });
    const facts = patientFacts({ ageYears: 35, createdAt: new Date() });
    expect(evaluateRule(rule('gt', 35), facts).status).toBe('not_met');
    expect(evaluateRule(rule('gte', 35), facts).status).toBe('met');
    expect(evaluateRule(rule('lt', 35), facts).status).toBe('not_met');
    expect(evaluateRule(rule('lte', 35), facts).status).toBe('met');
    expect(evaluateRule(rule('eq', 35), facts).status).toBe('met');
  });

  it('uses the current age and knows when it next changes', () => {
    const recorded = new Date(Date.now() - 400 * DAY);
    const p = lowRisk({ ageYears: 35, createdAt: recorded, ageRecordedOn: recorded });
    expect(keys(assessRisk(p, TEMPLATE))).toContain('age_over_35'); // now 36
    const next = nextAgeChange(p);
    expect(next > new Date()).toBe(true);
    expect(Math.round((next - recorded) / DAY)).toBe(731); // two years after recording
  });

  it('findings ticked for this pregnancy and measured readings raise the level, each with its reason', () => {
    const at = new Date();
    const day = new Date('2026-09-12T00:00:00Z');
    const p = lowRisk({
      pregnancy: {
        findings: [{ key: 'multiple', byName: 'Dr Rao', at }, { key: 'gdm', byName: 'Dr Rao', at, endedAt: at, endedByName: 'Dr Rao' }],
        readings: { lowestHb: { value: 6.9, on: day, source: 'lab' }, latestBp: { systolic: 138, diastolic: 92, on: day } },
      },
    });
    const r = assessRisk(p, TEMPLATE);
    expect(r).toMatchObject({ computedLevel: 'high', missing: [], notMeasured: [] });
    expect(keys(r)).toEqual(['preg_multiple', 'hb_under_7', 'bp_diastolic_90', 'hb_under_11']); // the unticked GDM does not count
    expect(r.reasons.map((x) => x.detail).slice(1)).toEqual([
      'Lowest Hb 6.9 g/dL on 12 Sep 2026 (lab result) (rule: under 7)',
      'BP 138/92 mmHg on 12 Sep 2026 (rule: at least 90)',
      'Lowest Hb 6.9 g/dL on 12 Sep 2026 (lab result) (rule: under 11)',
    ]);
    expect(r.reasons[0].detail).toMatch(/^Recorded by Dr Rao on \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    // moderate anaemia only: moderate
    const moderate = assessRisk(lowRisk({ pregnancy: { readings: { lowestHb: { value: 9.8, on: day, source: 'visit' }, latestBp: { systolic: 120, diastolic: 80, on: day } } } }), TEMPLATE);
    expect(moderate).toMatchObject({ computedLevel: 'moderate', mayBeHigher: false });
    expect(keys(moderate)).toEqual(['hb_under_11']);
  });

  it('a reading not measured yet is listed as such – it never makes the result "incomplete" or "may be higher"', () => {
    const none = assessRisk(lowRisk(), TEMPLATE);
    expect(none).toMatchObject({ computedLevel: 'low', missing: [], notMeasured: ['Haemoglobin (Hb)', 'Blood pressure'], mayBeHigher: false });
    const day = new Date('2026-09-12T00:00:00Z');
    const bpOnly = assessRisk(lowRisk({ pregnancy: { readings: { lowestHb: null, latestBp: { systolic: 118, diastolic: 76, on: day } } } }), TEMPLATE);
    expect(bpOnly).toMatchObject({ computedLevel: 'low', notMeasured: ['Haemoglobin (Hb)'] });
    // a moderate result with no Hb measured: not "may be higher" (that is for missing registration details)
    const moderate = assessRisk(lowRisk({ medical: { allergies: 'None known', heightCm: 150, weightKg: 70 } }), TEMPLATE);
    expect(moderate).toMatchObject({ computedLevel: 'moderate', mayBeHigher: false, notMeasured: ['Haemoglobin (Hb)', 'Blood pressure'] });
    // missing registration details still make it incomplete, as before
    expect(assessRisk(lowRisk({ medical: { allergies: 'None known', bloodGroup: '' } }), TEMPLATE)).toMatchObject({ computedLevel: 'incomplete', missing: ['Blood group'] });
    // rule results one by one
    const facts = patientFacts(lowRisk());
    expect(evaluateRule({ factor: 'lowestHb', op: 'lt', value: 7, level: 'high' }, facts)).toEqual({ status: 'not_measured', detail: '' });
    expect(evaluateRule({ factor: 'finding', finding: 'gdm', level: 'high' }, facts)).toEqual({ status: 'not_met', detail: '' });
    expect(evaluateRule({ factor: 'finding', finding: null, level: 'high' }, facts).status).toBe('not_met');
  });

  it('a reading or a finding the rules have no rule for is named ("doctor to assess") – never left looking as if it had been counted', () => {
    const at = new Date();
    const day = new Date('2026-09-12T00:00:00Z');
    const p = lowRisk({
      pregnancy: {
        findings: [{ key: 'multiple', byName: 'Dr Rao', at }],
        readings: { lowestHb: { value: 6.5, on: day, source: 'visit' }, latestBp: { systolic: 160, diastolic: 110, on: day } },
      },
    });
    // rules approved before findings and readings could be checked: none of them looks at this pregnancy
    const older = { ...TEMPLATE, riskRules: TEMPLATE.riskRules.filter((r) => !['finding', 'lowestHb', 'bpSystolic', 'bpDiastolic'].includes(r.factor)) };
    const r = assessRisk(p, older);
    expect(r).toMatchObject({ computedLevel: 'low', reasons: [], notMeasured: [], findingsNotChecked: ['multiple'], readingsNotChecked: ['lowestHb', 'latestBp'] });
    // with the current built-in rules everything is counted
    expect(assessRisk(p, TEMPLATE)).toMatchObject({ computedLevel: 'high', findingsNotChecked: [], readingsNotChecked: [] });
    // a rule on one of the two blood-pressure numbers is enough for the blood pressure to count as checked
    const bpRule = { ...older, riskRules: [...older.riskRules, { key: 'bp', label: 'Upper number 150 or more', factor: 'bpSystolic', op: 'gte', value: 150, level: 'high' }] };
    expect(assessRisk(p, bpRule)).toMatchObject({ computedLevel: 'high', readingsNotChecked: ['lowestHb'] });
    // nothing measured: nothing to name (and no rule needs it, so it is not "not measured yet" either)
    expect(assessRisk(lowRisk(), older)).toMatchObject({ computedLevel: 'low', notMeasured: [], readingsNotChecked: [] });
    expect(assessRisk(lowRisk({ pregnancy: { readings: { lowestHb: null, latestBp: { systolic: 118, diastolic: 76, on: day } } } }), older).readingsNotChecked).toEqual(['latestBp']);
  });

  it('an override needs review when the level changes or a NEW reason appears at the same level', () => {
    const base = { computedLevel: 'high', reasons: [{ key: 'rh_negative' }], override: { level: 'moderate', computedLevelAtOverride: 'high', reasonKeysAtOverride: ['rh_negative'] } };
    expect(overrideNeedsReview(base)).toBe(false);
    expect(overrideNeedsReview({ ...base, reasons: [{ key: 'rh_negative' }, { key: 'cond_heart' }] })).toBe(true);
    expect(overrideNeedsReview({ ...base, computedLevel: 'moderate' })).toBe(true);
    expect(overrideNeedsReview({ ...base, override: null })).toBe(false);
  });
});

describe('risk level in the app', () => {
  let app; // a fresh app per test, so the many test logins don't hit the login rate limit
  let hospital;
  const s = {};
  const people = {};

  beforeAll(connectTestDb);
  beforeEach(async () => {
    await resetTestDb();
    resetRiskRefreshTimer();
    app = createApp();
    hospital = await createTenant('Risk Hospital');
    for (const [key, roles] of Object.entries({ drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' })) {
      people[key] = await createUser({ name: key });
      await addMember(people[key], hospital, roles);
      s[key] = await loginAs(people[key], { app });
    }
  });
  afterAll(disconnectTestDb);

  const register = (who, extra = {}) => {
    const { medical = {}, obstetric = {}, ...rest } = extra;
    return s[who].post('/api/patients').send(
      samplePatient({
        careType: 'antenatal',
        ageYears: 28,
        pregnancy: { lmp: lmp() },
        assignedDoctor: people.drA._id.toString(),
        ...rest,
        obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, ...obstetric },
        medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 58, conditions: [], conditionsReviewed: true, ...medical },
      }),
    );
  };
  const view = async (who, id) => (await s[who].get(`/api/patients/${id}`)).body.patient;
  const standard = () => CarePlanTemplate.findOne({ tenantId: hospital._id, careType: 'antenatal', kind: 'standard' });

  it('is worked out at registration with reasons, using the (draft) hospital template', async () => {
    const res = await register('drA', { ageYears: 36, medical: { allergies: 'None known', bloodGroup: 'O-' } });
    expect(res.status).toBe(201);
    const p = await view('drA', res.body.patient.id);
    expect(p.risk).toMatchObject({ level: 'high', computedLevel: 'high', templateApproved: false, rulesChecked: ANTENATAL_DRAFT.riskRules.length });
    expect(keys(p.risk)).toEqual(['age_over_35', 'rh_negative']);
  });

  it('audit entries hold no medical details (hospital admins can read the audit log)', async () => {
    const p = (await register('drA', { ageYears: 36 })).body.patient;
    await s.drA.patch(`/api/patients/${p.id}`).send({ ageYears: 25 }); // automatic level changes high → low
    await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'moderate', reason: 'Private clinical reason text' });
    await s.drA.delete(`/api/patients/${p.id}/risk-override`);
    // An automatic change is not logged on its own – even the fact that it changed would be medical information.
    expect(await AuditLog.countDocuments({ action: 'PATIENT_RISK_CHANGED' })).toBe(0);
    for (const action of ['RISK_OVERRIDDEN', 'RISK_OVERRIDE_REMOVED']) {
      const entries = await AuditLog.find({ action });
      expect(entries.length).toBe(1);
      expect(Object.keys(entries[0].details).sort()).toEqual(['mrn', 'patientId']);
    }
    const log = await s.admin.get('/api/tenant/audit-logs');
    expect(JSON.stringify(log.body.entries)).not.toMatch(/Private clinical reason|high|moderate/);
  });

  it('older audit entries that still hold risk details are shown without them', async () => {
    const base = { tenantId: hospital._id, actor: people.drA._id, actorEmail: people.drA.email };
    await AuditLog.create([
      { ...base, action: 'PATIENT_RISK_CHANGED', details: { patientId: 'p1', mrn: 'MRN-1', why: 're-check', from: 'low', to: 'high', reasons: ['cond_hiv'] } },
      { ...base, action: 'RISK_OVERRIDDEN', details: { patientId: 'p1', mrn: 'MRN-1', level: 'moderate', computed: 'high', reason: 'Private clinical reason text' } },
    ]);
    const log = await s.admin.get('/api/tenant/audit-logs?category=patients');
    expect(log.status).toBe(200);
    const details = log.body.entries.map((e) => e.details);
    expect(details).toEqual(expect.arrayContaining([{ patientId: 'p1', mrn: 'MRN-1', why: 're-check' }, { patientId: 'p1', mrn: 'MRN-1' }]));
    expect(JSON.stringify(log.body.entries)).not.toMatch(/Private clinical reason|high|moderate|cond_hiv/);
  });

  it('is re-checked when details change', async () => {
    const p = (await register('drA')).body.patient;
    expect((await view('drA', p.id)).risk.level).toBe('low');
    await s.drA.patch(`/api/patients/${p.id}`).send({ medical: { allergies: 'None known', conditions: ['diabetes'] } });
    const after = await view('drA', p.id);
    expect(after.risk.level).toBe('high');
    expect(keys(after.risk)).toEqual(['cond_diabetes']);
  });

  it('keeps the age increasing when the form re-sends the same age on every save', async () => {
    const p = (await register('drA', { ageYears: 35 })).body.patient;
    const id = (await Patient.findOne({ tenantId: hospital._id, mrn: p.mrn }))._id;
    const old = new Date(Date.now() - 300 * DAY);
    await Patient.collection.updateOne({ _id: id }, { $set: { ageRecordedOn: old } });
    await s.drA.patch(`/api/patients/${p.id}`).send({ ageYears: 35, medical: { allergies: 'None known', weightKg: 59 } }); // what the form sends
    expect((await Patient.findOne({ _id: id, tenantId: hospital._id })).ageRecordedOn.getTime()).toBe(old.getTime());
    // 100 more days pass: the age goes up, and the scheduled re-check date has been reached
    await Patient.collection.updateOne({ _id: id }, { $set: { ageRecordedOn: new Date(Date.now() - 400 * DAY), 'risk.recheckAt': new Date(Date.now() - DAY) } });
    const after = await view('drA', p.id);
    expect(after.currentAge).toBe(36);
    expect(keys(after.risk)).toContain('age_over_35');
    // a genuinely different age is saved
    await s.drA.patch(`/api/patients/${p.id}`).send({ ageYears: 30 });
    expect((await view('drA', p.id)).currentAge).toBe(30);
  });

  it('reception registrations are "incomplete" until a clinician adds the medical details', async () => {
    const p = (await s.reception.post('/api/patients').send(samplePatient({ careType: 'antenatal' }))).body.patient;
    const asDoctor = await view('drA', p.id);
    expect(asDoctor.risk.level).toBe('incomplete');
    expect(asDoctor.risk.missing.length).toBeGreaterThan(0);
  });

  it('is visible to clinicians but not to reception or lab – also not in the list', async () => {
    const p = (await register('drA')).body.patient;
    expect((await view('nurse', p.id)).risk).toBeDefined();
    for (const who of ['reception', 'lab']) {
      expect((await view(who, p.id)).risk).toBeUndefined();
      const list = await s[who].get('/api/patients?doctor=all');
      expect(list.body.patients.every((x) => x.risk === undefined)).toBe(true);
    }
  });

  it('only applies to antenatal patients', async () => {
    const p = (await s.drA.post('/api/patients').send(samplePatient({ careType: 'gynaecology' }))).body.patient;
    expect((await view('drA', p.id)).risk.level).toBeNull();
  });

  it('checks the pregnancy counts: Gravida includes this pregnancy, and a first pregnancy has no previous problems', async () => {
    const tooFew = await register('drA', { obstetric: { gravida: 1, para: 1, living: 1 } });
    expect(tooFew.status).toBe(400);
    expect(tooFew.body.error.fields['obstetric.gravida']).toMatch(/at least Para \+ Abortions \+ 1/);
    const firstWithProblems = await register('drA', { obstetric: { gravida: 1, pastComplications: ['preterm_birth'] } });
    expect(firstWithProblems.status).toBe(400);
    expect(firstWithProblems.body.error.fields['obstetric.pastComplications']).toBeDefined();
    // the old place for uterine surgery is no longer accepted – it is a condition now
    expect((await register('drA', { obstetric: { gravida: 2, para: 1, living: 1, pastComplications: ['uterine_surgery'], complicationsReviewed: false } })).status).toBe(400);

    const p = (await register('drA', { obstetric: { gravida: 2, para: 1, living: 1, pastComplications: ['preterm_birth'] } })).body.patient;
    const res = await s.drA.patch(`/api/patients/${p.id}`).send({ obstetric: { gravida: 1, para: 0, living: 0 } }); // the problems ticked earlier would remain
    expect(res.status).toBe(400);
    expect(res.body.error.fields['obstetric.pastComplications']).toBeDefined();
    const fixed = await s.drA.patch(`/api/patients/${p.id}`).send({ obstetric: { gravida: 1, para: 0, living: 0, pastComplications: [] } });
    expect(fixed.status).toBe(200);
    expect((await view('drA', p.id)).risk.level).toBe('low'); // first pregnancy: nothing more to confirm
  });

  describe('risk filter in the patient list', () => {
    it('works for clinicians, together with search', async () => {
      await register('drA', { fullName: 'Risky One', ageYears: 40 });
      await register('drA', { fullName: 'Risky Two', ageYears: 41 });
      await register('drA', { fullName: 'Calm' });
      expect((await s.drA.get('/api/patients?risk=high&doctor=all')).body.patients.map((p) => p.fullName).sort()).toEqual(['Risky One', 'Risky Two']);
      expect((await s.drA.get('/api/patients?risk=high&doctor=all&search=two')).body.patients.map((p) => p.fullName)).toEqual(['Risky Two']);
      expect((await s.drA.get('/api/patients?risk=low&doctor=all')).body.patients.map((p) => p.fullName)).toEqual(['Calm']);
    });

    it('is combined with the care-type filter (never replaces it)', async () => {
      await register('drA', { fullName: 'Risky', ageYears: 40 });
      expect((await s.drA.get('/api/patients?risk=high&doctor=all&careType=gynaecology')).body.total).toBe(0);
      expect((await s.drA.get('/api/patients?risk=high&doctor=all&careType=antenatal')).body.total).toBe(1);
    });

    it("a doctor's \"to review\" list covers their own and unassigned patients, not other doctors'", async () => {
      const body = { level: 'moderate', reason: 'Clinical judgement for testing' };
      const own = (await register('drA', { fullName: 'Own' })).body.patient;
      const free = (await register('drA', { fullName: 'Unassigned', assignedDoctor: null })).body.patient;
      const other = (await register('drB', { fullName: 'Of drB', assignedDoctor: people.drB._id.toString() })).body.patient;
      for (const [who, p] of [['drA', own], ['drA', free], ['drB', other]]) {
        expect((await s[who].put(`/api/patients/${p.id}/risk-override`).send(body)).status).toBe(200);
        expect((await s[who].patch(`/api/patients/${p.id}`).send({ medical: { allergies: 'None known', conditions: ['heart_disease'] } })).status).toBe(200);
      }
      const names = async (who, doctor) => (await s[who].get(`/api/patients?risk=review&doctor=${doctor}`)).body.patients.map((p) => p.fullName).sort();
      expect(await names('drA', 'mine_or_unassigned')).toEqual(['Own', 'Unassigned']);
      expect(await names('drA', 'me')).toEqual(['Own']);
      expect(await names('drB', 'mine_or_unassigned')).toEqual(['Of DrB', 'Unassigned']); // names start every word with a capital (21 Oct 2026)
    });

    it('cannot be used by reception, lab or admin-only accounts to find out who is high risk', async () => {
      await register('drA', { fullName: 'Risky', ageYears: 40 });
      for (const who of ['reception', 'lab']) expect((await s[who].get('/api/patients?risk=high')).status).toBe(403);
      expect((await s.admin.get('/api/patients?risk=high')).status).toBe(403);
    });

    it("does not reveal the risk of sensitive records to nurses or other doctors", async () => {
      const p = (await register('drA', { fullName: 'Sensitive Risky', ageYears: 40 })).body.patient;
      await s.drA.patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true });
      expect((await s.nurse.get('/api/patients?risk=high')).body.total).toBe(0);
      expect((await s.drB.get('/api/patients?risk=high&doctor=all')).body.total).toBe(0);
      expect((await s.drA.get('/api/patients?risk=high&doctor=all')).body.total).toBe(1);
      expect((await s.rmo.get('/api/patients?risk=high&doctor=all')).body.total).toBe(1);
    });
  });

  describe('doctor override', () => {
    it("the patient's doctor can override with a reason; the reason stays on the record (history)", async () => {
      const p = (await register('drA')).body.patient;
      expect((await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'high', reason: 'short' })).status).toBe(400);
      expect((await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'incomplete', reason: 'Not a valid level to set' })).status).toBe(400);
      const res = await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'high', reason: 'Twin pregnancy seen on scan' });
      expect(res.status).toBe(200);
      expect(res.body.patient.risk).toMatchObject({ level: 'high', computedLevel: 'low', overrideNeedsReview: false, override: { level: 'high', byName: 'drA', computedLevelAtOverride: 'low' } });
      await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'moderate', reason: 'Reviewed again after scan' });
      const hist = (await view('drA', p.id)).riskOverrideHistory;
      expect(hist.map((h) => [h.level, h.endedBecause])).toEqual([
        ['high', 'replaced'],
        ['moderate', null],
      ]);
      expect((await view('reception', p.id)).riskOverrideHistory).toBeUndefined();
    });

    it('keeps the override when details change, and flags it for review', async () => {
      const p = (await register('drA')).body.patient;
      await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'moderate', reason: 'Clinical judgement for testing' });
      await s.drA.patch(`/api/patients/${p.id}`).send({ medical: { allergies: 'None known', conditions: ['heart_disease'] } });
      const after = await view('drA', p.id);
      expect(after.risk).toMatchObject({ level: 'moderate', computedLevel: 'high', overrideNeedsReview: true });
      expect((await s.drA.get('/api/patients?risk=review&doctor=all')).body.total).toBe(1);
    });

    it('flags a new reason at the same level for review', async () => {
      const p = (await register('drA', { medical: { allergies: 'None known', bloodGroup: 'O-' } })).body.patient; // high: Rh negative
      await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'moderate', reason: 'Rh negative, ICT negative, anti-D planned' });
      await s.drA.patch(`/api/patients/${p.id}`).send({ medical: { allergies: 'None known', conditions: ['heart_disease'] } }); // still high, new reason
      expect((await view('drA', p.id)).risk).toMatchObject({ computedLevel: 'high', overrideNeedsReview: true });
    });

    it('survives changing the type of care away and back (e.g. by reception)', async () => {
      const p = (await register('drA')).body.patient;
      await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'high', reason: 'Twin pregnancy seen on scan' });
      await s.reception.patch(`/api/patients/${p.id}`).send({ careType: 'gynaecology' });
      expect((await view('drA', p.id)).risk.level).toBeNull();
      await s.reception.patch(`/api/patients/${p.id}`).send({ careType: 'antenatal' });
      expect((await view('drA', p.id)).risk).toMatchObject({ level: 'high', override: { reason: 'Twin pregnancy seen on scan' } });
    });

    it('can be removed, going back to the automatic level', async () => {
      const p = (await register('drA')).body.patient;
      await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'high', reason: 'Clinical judgement for testing' });
      const res = await s.drA.delete(`/api/patients/${p.id}/risk-override`);
      expect(res.body.patient.risk).toMatchObject({ level: 'low', override: null });
      expect(res.body.patient.riskOverrideHistory[0].endedBecause).toBe('removed');
    });

    it('other doctors, RMOs, nurses and reception cannot set or remove an override; any doctor may for unassigned patients', async () => {
      const p = (await register('drA')).body.patient;
      const body = { level: 'high', reason: 'Trying to override this' };
      await s.drA.put(`/api/patients/${p.id}/risk-override`).send(body);
      for (const who of ['drB', 'rmo', 'nurse', 'reception']) {
        expect((await s[who].put(`/api/patients/${p.id}/risk-override`).send(body)).status).toBe(403);
        expect((await s[who].delete(`/api/patients/${p.id}/risk-override`)).status).toBe(403);
      }
      expect((await view('drA', p.id)).risk.override.level).toBe('high');
      const unassigned = (await register('drA', { assignedDoctor: null })).body.patient;
      expect((await s.drB.put(`/api/patients/${unassigned.id}/risk-override`).send(body)).status).toBe(200);
      const gyn = (await s.drA.post('/api/patients').send(samplePatient({ careType: 'gynaecology' }))).body.patient;
      expect((await s.drA.put(`/api/patients/${gyn.id}/risk-override`).send(body)).status).toBe(400);
    });

    it('override rights in detail: unassigned patients, after assignment, removing, non-antenatal, incomplete results', async () => {
      const body = { level: 'high', reason: 'Trying to override this' };
      const p = (await register('drA')).body.patient;
      expect((await view('drA', p.id)).access.canOverrideRisk).toBe(true);
      for (const who of ['drB', 'rmo', 'nurse']) expect((await view(who, p.id)).access.canOverrideRisk).toBe(false);
      for (const who of ['lab', 'admin']) {
        expect((await s[who].put(`/api/patients/${p.id}/risk-override`).send(body)).status).toBe(403);
        expect((await s[who].delete(`/api/patients/${p.id}/risk-override`)).status).toBe(403);
      }

      const free = (await register('drA', { assignedDoctor: null })).body.patient;
      for (const who of ['rmo', 'nurse', 'reception', 'lab', 'admin']) {
        expect((await s[who].put(`/api/patients/${free.id}/risk-override`).send(body)).status).toBe(403);
        expect((await s[who].delete(`/api/patients/${free.id}/risk-override`)).status).toBe(403);
      }
      expect((await view('drB', free.id)).access.canOverrideRisk).toBe(true);
      expect((await s.drB.put(`/api/patients/${free.id}/risk-override`).send(body)).status).toBe(200);
      expect((await s.drB.delete(`/api/patients/${free.id}/risk-override`)).status).toBe(200);
      expect((await s.drB.put(`/api/patients/${free.id}/risk-override`).send(body)).status).toBe(200);
      // once assigned to drA, drB can no longer change it
      expect((await s.drA.patch(`/api/patients/${free.id}/doctor`).send({ doctorId: people.drA._id.toString() })).status).toBe(200);
      expect((await view('drB', free.id)).access.canOverrideRisk).toBe(false);
      expect((await s.drB.put(`/api/patients/${free.id}/risk-override`).send(body)).status).toBe(403);
      expect((await s.drB.delete(`/api/patients/${free.id}/risk-override`)).status).toBe(403);
      expect((await s.drA.delete(`/api/patients/${free.id}/risk-override`)).status).toBe(200);

      const gyn = (await s.drA.post('/api/patients').send(samplePatient({ careType: 'gynaecology' }))).body.patient;
      expect((await s.drA.delete(`/api/patients/${gyn.id}/risk-override`)).status).toBe(400);

      // an incomplete result can be overridden (the doctor knows more), but "incomplete" can't be chosen
      const partial = (await register('drA', { medical: { allergies: 'None known', bloodGroup: '' } })).body.patient;
      expect((await view('drA', partial.id)).risk.level).toBe('incomplete');
      const res = await s.drA.put(`/api/patients/${partial.id}/risk-override`).send({ level: 'low', reason: 'Blood group seen on old report: B+' });
      expect(res.status).toBe(200);
      expect(res.body.patient.risk).toMatchObject({ level: 'low', computedLevel: 'incomplete', override: { computedLevelAtOverride: 'incomplete' } });
    });

    it('a save based on an out-of-date copy is refused instead of wiping an override made at the same moment', async () => {
      const p = (await register('drA')).body.patient;
      const id = (await Patient.findOne({ tenantId: hospital._id, mrn: p.mrn }))._id;
      const stale = await Patient.findOne({ _id: id, tenantId: hospital._id }); // e.g. a re-check that started earlier
      await s.drA.put(`/api/patients/${p.id}/risk-override`).send({ level: 'high', reason: 'Twin pregnancy seen on scan' });
      applyRisk(stale, await riskTemplateFor(stale));
      await expect(stale.save()).rejects.toThrow(mongoose.Error.VersionError);
      expect((await Patient.findOne({ _id: id, tenantId: hospital._id })).risk.override.level).toBe('high');
    });
  });

  describe('when the rules change', () => {
    const getStandard = async () => {
      const list = await s.drA.get('/api/care-plans/templates');
      // The antenatal one: every type of care has a standard template (pregnancy-loss care's sorts first)
      const std = list.body.templates.find((t) => t.kind === 'standard' && t.careType === 'antenatal');
      return (await s.drA.get(`/api/care-plans/templates/${std.id}`)).body.template;
    };

    it('editing or approving the template recalculates its patients (and keeps overrides)', async () => {
      const p = (await register('drA', { ageYears: 33 })).body.patient;
      const q = (await register('drA', { ageYears: 33, fullName: 'With override' })).body.patient;
      await s.drA.put(`/api/patients/${q.id}/risk-override`).send({ level: 'moderate', reason: 'Testing that overrides are kept' });
      const t = await getStandard();
      const riskRules = t.riskRules.map((r) => (r.key === 'age_over_35' ? { ...r, value: 30 } : r));
      const put = await s.drA.put(`/api/care-plans/templates/${t.id}`).send({ version: t.version, name: t.name, description: t.description, sources: t.sources, items: t.items, riskRules });
      expect(put.status).toBe(200);
      expect(put.body.recalculated).toMatchObject({ checked: 2, skipped: 0 });

      const after = await view('drA', p.id);
      expect(after.risk).toMatchObject({ level: 'high', templateVersion: t.version + 1, templateApproved: false });
      expect(after.risk.reasons[0].detail).toBe('Age 33 years (rule: over 30)');
      expect((await view('drA', q.id)).risk).toMatchObject({ level: 'moderate', computedLevel: 'high', overrideNeedsReview: true });

      const approved = await s.drA.post(`/api/care-plans/templates/${t.id}/approve`).send({ confirm: true, version: t.version + 1 });
      expect(approved.body.recalculated).toMatchObject({ checked: 2, skipped: 0 });
      expect((await view('drA', p.id)).risk.templateApproved).toBe(true);
    });

    it('re-checks on view when the rules changed without a recalculation', async () => {
      const p = (await register('drA', { ageYears: 33 })).body.patient;
      const std = await standard();
      const rules = std.toObject().riskRules.map((r) => (r.key === 'age_over_35' ? { ...r, value: 30 } : r));
      await CarePlanTemplate.collection.updateOne({ _id: std._id }, { $set: { riskRules: rules, version: std.version + 5 } });
      expect((await view('drA', p.id)).risk).toMatchObject({ level: 'high', templateVersion: std.version + 5 });
    });

    it('re-checks on view when only the approval changed', async () => {
      const p = (await register('drA')).body.patient;
      expect((await view('drA', p.id)).risk.templateApproved).toBe(false);
      const std = await standard();
      await CarePlanTemplate.collection.updateOne({ _id: std._id }, { $set: { status: 'approved', approvedVersion: std.version, approvedByName: 'drA' } });
      expect((await view('drA', p.id)).risk.templateApproved).toBe(true);
    });

    it('records worked out by an older version of the risk engine are recalculated', async () => {
      const p = (await register('drA', { ageYears: 40 })).body.patient;
      const id = (await Patient.findOne({ tenantId: hospital._id, mrn: p.mrn }))._id;
      await Patient.collection.updateOne({ _id: id }, { $set: { 'risk.engineVersion': RISK_ENGINE_VERSION - 1, 'risk.level': 'low', 'risk.computedLevel': 'low', 'risk.reasons': [] } });
      expect((await s.drA.get('/api/patients?risk=high&doctor=all')).body.total).toBe(1); // brought up to date before listing
      expect((await Patient.findOne({ _id: id, tenantId: hospital._id })).risk).toMatchObject({ level: 'high', engineVersion: RISK_ENGINE_VERSION });
    });

    it('a doctor can only approve the version they reviewed', async () => {
      const t = await getStandard();
      const riskRules = t.riskRules.map((r) => (r.key === 'age_over_35' ? { ...r, value: 34 } : r));
      await s.drB.put(`/api/care-plans/templates/${t.id}`).send({ version: t.version, name: t.name, description: t.description, sources: t.sources, items: t.items, riskRules });
      const res = await s.drA.post(`/api/care-plans/templates/${t.id}/approve`).send({ confirm: true, version: t.version });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect((await standard()).status).toBe('draft');
      expect((await s.drA.post(`/api/care-plans/templates/${t.id}/approve`).send({ confirm: true, version: t.version + 1 })).status).toBe(200);
      expect((await s.drA.post(`/api/care-plans/templates/${t.id}/approve`).send({ confirm: true })).status).toBe(400); // version is required
    });

    it('a pending built-in rules upgrade does not make a save fail', async () => {
      const p = (await register('drA')).body.patient;
      const std = await standard();
      await CarePlanTemplate.collection.updateOne({ _id: std._id }, { $set: { riskRules: [], builtInRulesVersion: RISK_RULES_VERSION - 1 } });
      const res = await s.drA.patch(`/api/patients/${p.id}`).send({ medical: { allergies: 'None known', weightKg: 60 } });
      expect(res.status).toBe(200);
      expect(res.body.patient.risk).toMatchObject({ level: 'low', templateVersion: std.version + 1, rulesChecked: ANTENATAL_DRAFT.riskRules.length });
    });

    it('checking the built-in templates does not touch them when nothing needs changing', async () => {
      await ensureStandardTemplates(hospital._id);
      const before = await standard();
      await new Promise((r) => setTimeout(r, 20));
      await ensureStandardTemplates(hospital._id);
      const after = await standard();
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(after.version).toBe(before.version);
    });

    it('the list and counts bring due patients up to date (age changes) without anyone opening them', async () => {
      const p = (await register('drA', { ageYears: 35 })).body.patient;
      expect((await s.drA.get('/api/patients?risk=high&doctor=all')).body.total).toBe(0);
      const old = new Date(Date.now() - 400 * DAY);
      await Patient.collection.updateOne({ mrn: p.mrn, tenantId: hospital._id }, { $set: { ageRecordedOn: old, 'risk.recheckAt': new Date(Date.now() - DAY) } });
      resetRiskRefreshTimer();
      expect((await s.drA.get('/api/patients?risk=high&doctor=all')).body.total).toBe(1);
    });

    it('validates risk rules (including previous-pregnancy problems)', async () => {
      const t = await getStandard();
      const res = await s.drA.put(`/api/care-plans/templates/${t.id}`).send({
        version: t.version,
        name: t.name,
        items: t.items,
        riskRules: [
          { key: 'a', label: 'No comparison', factor: 'age', value: 30, level: 'high' },
          { key: 'b', label: 'No condition', factor: 'condition', level: 'high' },
          { key: 'c', label: 'No complication', factor: 'pastComplication', level: 'high' },
          { key: 'c', label: 'Duplicate', factor: 'rhNegative', level: 'extreme' },
        ],
      });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.fields).sort()).toEqual(['riskRules.0.op', 'riskRules.1.condition', 'riskRules.2.complication', 'riskRules.3.level']);
    });

    it('personal protocols have no risk rules (risk always comes from the hospital standard)', async () => {
      const t = await getStandard();
      const mine = (await s.drA.post('/api/care-plans/templates').send({ copyFrom: t.id })).body.template;
      expect(mine.riskRules ?? []).toEqual([]);
      const put = await s.drA.put(`/api/care-plans/templates/${mine.id}`).send({ version: mine.version, name: mine.name, items: mine.items, riskRules: t.riskRules });
      expect(put.status).toBe(200);
      expect(put.body.template.riskRules ?? []).toEqual([]);
      expect(put.body.recalculated).toEqual({ checked: 0, changed: 0, skipped: 0 });
    });

    it('templates from before risk rules get the draft rules (re-approval needed); personal ones are left alone', async () => {
      await s.drA.get('/api/care-plans/templates');
      const std = await standard();
      const mine = (await s.drA.post('/api/care-plans/templates').send({ copyFrom: std._id.toString() })).body.template;
      await CarePlanTemplate.collection.updateMany({ tenantId: hospital._id }, { $unset: { riskRules: '', builtInRulesVersion: '' }, $set: { status: 'approved', version: 3 } });
      const t = await getStandard();
      expect(t).toMatchObject({ status: 'draft', version: 4, updatedByName: 'Built-in draft risk rules added', builtInRulesVersion: RISK_RULES_VERSION });
      expect(t.riskRules.length).toBe(ANTENATAL_DRAFT.riskRules.length);
      const personal = (await s.drA.get(`/api/care-plans/templates/${mine.id}`)).body.template;
      expect(personal).toMatchObject({ status: 'approved', version: 3 });
    });

    it('unapproved templates with older built-in rules get the newer draft rules; approved or doctor-edited ones do not', async () => {
      await ensureStandardTemplates(hospital._id);
      const std = await standard();
      await CarePlanTemplate.collection.updateOne({ _id: std._id }, { $set: { riskRules: [], builtInRulesVersion: 1 } });
      await ensureStandardTemplates(hospital._id);
      expect((await standard()).riskRules.length).toBe(ANTENATAL_DRAFT.riskRules.length);

      await CarePlanTemplate.collection.updateOne({ _id: std._id }, { $set: { riskRules: [], builtInRulesVersion: 1, status: 'approved' } });
      await ensureStandardTemplates(hospital._id);
      expect((await standard()).riskRules.length).toBe(0); // approved by a doctor: not changed silently

      await CarePlanTemplate.collection.updateOne({ _id: std._id }, { $set: { riskRules: [], builtInRulesVersion: null, status: 'draft', updatedByName: 'Dr A' } });
      await ensureStandardTemplates(hospital._id);
      expect((await standard()).riskRules.length).toBe(0); // a doctor's own rules: not replaced
    });

    it('never creates two standard templates, even when requests arrive together', async () => {
      await Promise.all(Array.from({ length: 6 }, () => ensureStandardTemplates(hospital._id)));
      expect(await CarePlanTemplate.countDocuments({ tenantId: hospital._id, careType: 'antenatal', kind: 'standard' })).toBe(1);
    });
  });
});
