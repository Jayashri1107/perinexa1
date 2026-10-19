// Lab report templates (docs/LAB_TEMPLATES_PLAN.md): full value sets with calculated values, each test's template,
// method and notes, sensitivity tables and paragraphs, ranges for men, and who signs the report. All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { calculate } from '../src/lab/labCalcs.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-19T06:00:00Z');
const ROLES = { drA: 'doctor', lab: 'lab', lab2: 'lab', nurse: 'nurse' };
// The smallest PNG (1 × 1 pixel), as a signature picture
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
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
  hospital = await createTenant('Template Hospital');
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
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', fullName: 'Template Patient', ageYears: 32, assignedDoctor: people.drA._id.toString(), ...overrides }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const order = async (p, tests) => {
  const res = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: tests.map((key) => ({ key })) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.order;
};
const results = async (o, tests, extra = {}, who = 'lab') => (await as(who)).put(`/api/lab/orders/${o.id}/results`).send({ rev: o.rev, tests, ...extra });
const vals = (pairs) => Object.entries(pairs).map(([key, value]) => ({ key, value }));
const byKey = (test) => Object.fromEntries(test.values.map((v) => [v.key, v]));

describe('calculated values', () => {
  it('the formulas', () => {
    expect(calculate('mcv', { pcv: 36, rbc: 4 })).toBe('90.0');
    expect(calculate('mch', { hb: 12, rbc: 4 })).toBe('30.0');
    expect(calculate('mchc', { hb: 12, pcv: 36 })).toBe('33.3');
    expect(calculate('indirectBilirubin', { bilirubin: 1.0, directBilirubin: 0.3 })).toBe('0.70');
    expect(calculate('agRatio', { albumin: 4, totalProtein: 7 })).toBe('1.33');
    expect(calculate('ldl', { totalChol: 200, hdl: 50, tg: 150 })).toBe('120');
    expect(calculate('ldl', { totalChol: 200, hdl: 50, tg: 450 })).toBeNull(); // Friedewald not valid
    expect(calculate('mcv', { pcv: 36 })).toBeNull();
    expect(calculate('nothing', {})).toBeNull();
  });

  it('a full CBC: indices worked out when left empty, a typed one kept; sections and the test order kept', async () => {
    const p = await register();
    const o = await order(p, ['cbc']);
    const res = await results(o, [{ key: 'cbc', values: vals({ platelets: '2.5', hb: '12', rbc: '4', pcv: '36', mch: '29.5', tlc: '7000', neutrophils: '60' }) }], { report: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const t = res.body.order.tests[0];
    const v = byKey(t);
    expect(v.mcv).toMatchObject({ value: '90.0', calculated: true, flag: 'normal', section: 'Red cell indices', unit: 'fL' });
    expect(v.mchc).toMatchObject({ value: '33.3', calculated: true });
    expect(v.mch).toMatchObject({ value: '29.5' });
    expect(v.mch.calculated).toBeUndefined(); // typed (the analyser's own value)
    expect(v.hb.section).toBe('Haemoglobin and red cells');
    expect(t.values.map((x) => x.key)).toEqual(['hb', 'rbc', 'pcv', 'mcv', 'mch', 'mchc', 'tlc', 'neutrophils', 'platelets']);
    expect(t.method).toMatch(/Automated cell counter/);
    expect(t.notes).toMatch(/below 11 g\/dL in pregnancy/);
  });

  it('LFT and lipid profile: globulin, A/G ratio, indirect bilirubin, LDL (not with high triglycerides)', async () => {
    const p = await register();
    const o = await order(p, ['lft', 'lipid']);
    const res = await results(o, [
      { key: 'lft', values: vals({ bilirubin: '1.0', directBilirubin: '0.3', totalProtein: '7.0', albumin: '4.0' }) },
      { key: 'lipid', values: vals({ totalChol: '220', hdl: '45', tg: '420' }) },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const lft = byKey(res.body.order.tests[0]);
    expect(lft.indirectBilirubin).toMatchObject({ value: '0.70', calculated: true });
    expect(lft.globulin).toMatchObject({ value: '3.0', calculated: true });
    expect(lft.agRatio).toMatchObject({ value: '1.33', calculated: true });
    const lipid = byKey(res.body.order.tests[1]);
    expect(lipid.ldl).toBeUndefined();
    expect(lipid.vldl).toBeUndefined();
    expect(lipid.cholHdlRatio).toMatchObject({ value: '4.9', flag: 'high', calculated: true });
    // A report needs a typed value: a worked-out one alone is not a result
    const o2 = await order(p, ['lft']);
    const none = await results(o2, [{ key: 'lft', values: [] }], { report: true });
    expect(none.status).toBe(400);
  });
});

describe('templates: cultures and paragraphs', () => {
  it('a culture keeps the antibiotics given a result; the test list says each test\'s template', async () => {
    const list = (await (await as('lab')).get('/api/lab/tests')).body.tests;
    const t = (k) => list.find((x) => x.key === k);
    expect(t('urineCulture').report).toMatchObject({ template: 'culture', ownPage: true });
    expect(t('urineCulture').antibiotics).toContain('Nitrofurantoin');
    expect(t('hiv').report.template).toBe('serology');
    expect(t('histopath').report.template).toBe('narrative');
    expect(t('cbc').report.template).toBe('table');

    const p = await register();
    const o = await order(p, ['urineCulture']);
    const res = await results(o, [{ key: 'urineCulture', values: vals({ growth: 'Growth', organism: 'E. coli', colonyCount: 'More than 1,00,000 CFU/mL' }), antibiotics: [{ name: 'Nitrofurantoin', result: 'S', zone: '20 mm' }, { name: 'Ciprofloxacin', result: 'R' }, { name: 'Cefixime', result: '' }] }], { report: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.order.tests[0].antibiotics).toEqual([{ name: 'Nitrofurantoin', result: 'S', zone: '20 mm' }, { name: 'Ciprofloxacin', result: 'R', zone: '' }]);
    expect(res.body.order.abnormal).toBe(true); // growth
  });

  it('histopathology takes paragraphs; other words at most 100 characters; no words about the sex of a fetus', async () => {
    const p = await register();
    const o = await order(p, ['histopath', 'urine']);
    const long = 'Sections show endometrium in the secretory phase. '.repeat(20);
    const tooLong = await results(o, [{ key: 'histopath', values: vals({ microscopy: long }) }, { key: 'urine', values: vals({ casts: 'x'.repeat(101) }) }]);
    expect(Object.keys(tooLong.body.error.fields)).toEqual(['tests.1.casts']);
    const pcpndt = await results(o, [{ key: 'histopath', values: vals({ gross: 'Products of conception, male fetus' }) }, { key: 'urine', values: [] }]);
    expect(pcpndt.body.error.fields).toHaveProperty(['tests.0.gross']);
    const ok = await results(o, [{ key: 'histopath', values: vals({ specimen: 'Endometrial curettings', microscopy: long, diagnosis: 'Secretory endometrium' }) }, { key: 'urine', values: vals({ colour: 'Pale yellow', ph: '6.0', albumin: 'Nil' }) }], { report: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(byKey(ok.body.order.tests[0]).microscopy.value).toBe(long.trim());
    expect(byKey(ok.body.order.tests[1]).ph).toMatchObject({ section: 'Physical', flag: 'normal' });
  });
});

describe('ranges for men; the hospital\'s template settings', () => {
  it('a man the lab registers gets the men\'s range; women keep theirs', async () => {
    const res = await (await as('lab')).post('/api/patients').send(samplePatient({ fullName: 'Walk In Man', ageYears: 40, phone: '98765 44444' }));
    const man = res.body.patient;
    const walk = await (await as('lab')).post('/api/lab/walk-in').send({ clientRequestId: randomUUID(), patientId: man.id, tests: [{ key: 'hb' }, { key: 'rft' }], prescription: 'Self – check-up', sex: 'male' });
    expect(walk.status, JSON.stringify(walk.body)).toBe(201);
    const o = walk.body.order;
    const view = (await (await as('lab')).get(`/api/lab/orders/${o.id}`)).body;
    expect(view.order.patient.sex).toBe('male');
    const rep = await results(o, [{ key: 'hb', values: vals({ hb: '12.5' }) }, { key: 'rft', values: vals({ creatinine: '1.2' }) }]);
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    expect(rep.body.order.tests[0].values[0]).toMatchObject({ flag: 'low', range: '13–17 g/dL (men)' });
    expect(byKey(rep.body.order.tests[1]).creatinine).toMatchObject({ flag: 'normal', range: '0.7–1.3 mg/dL (men)' });

    const woman = await register();
    const o2 = await order(woman, ['hb']);
    expect((await results(o2, [{ key: 'hb', values: vals({ hb: '12.5' }) }])).body.order.tests[0].values[0]).toMatchObject({ flag: 'normal', range: '11–16 g/dL (below 11 in pregnancy is anaemia)' });
  });

  it('the method and notes are clinical (a new DRAFT); the template and the antibiotic panel are not; the men\'s range can be removed', async () => {
    const put = (body) => as('lab').then((s) => s.put('/api/lab-setup/tests/urineCulture').send({ department: 'microbiology', tatHours: 72, urgentTatHours: 72, outsideLab: '', active: true, fieldRanges: {}, ...body }));
    const layout = await put({ version: 1, report: { template: 'culture', method: 'Semi-quantitative culture; sensitivity by disc diffusion (CLSI)', notes: 'More than 1,00,000 CFU/mL of one organism is significant bacteriuria. The treating doctor chooses the antibiotic, taking pregnancy into account.', ownPage: false }, antibiotics: ['Nitrofurantoin', 'Fosfomycin'] });
    expect(layout.status, JSON.stringify(layout.body)).toBe(200);
    const after = layout.body.tests.find((t) => t.key === 'urineCulture');
    expect(after).toMatchObject({ version: 1, antibiotics: ['Nitrofurantoin', 'Fosfomycin'], report: { ownPage: false } });
    const worded = await put({ version: 1, report: { template: 'culture', method: 'Our method', notes: '', ownPage: false } });
    expect(worded.body.tests.find((t) => t.key === 'urineCulture')).toMatchObject({ version: 2, status: 'draft', report: { method: 'Our method', notes: '' } });

    const noMen = await (await as('lab')).put('/api/lab-setup/tests/hb').send({ department: 'haematology', tatHours: 24, urgentTatHours: 4, outsideLab: '', active: true, fieldRanges: { hb: { bands: [] } }, version: 1 });
    expect(noMen.body.tests.find((t) => t.key === 'hb').fields[0].bands).toEqual([]); // the men's range removed for this test
    const cbc = noMen.body.tests.find((t) => t.key === 'cbc');
    expect(cbc.fields.find((f) => f.key === 'hb').bands).toEqual([expect.objectContaining({ sex: 'male', low: 13, high: 17 })]);
  });
});

describe('who signs the report', () => {
  it('a doctor adds signers; the picture prints only on a report its signer checked; else the default signer\'s name', async () => {
    const signer = { name: 'Dr Sample Pathologist', title: 'Consultant pathologist', qualification: 'MD (Pathology)', regNo: 'MMC 00000', userId: people.lab2._id.toString(), signature: PNG, isDefault: false };
    expect((await (await as('lab')).post('/api/lab-setup/signatories').send(signer)).status).toBe(403);
    expect((await (await as('drA')).post('/api/lab-setup/signatories').send({ ...signer, signature: 'data:image/png;base64,PGh0bWw+' })).body.error.fields).toHaveProperty('signature');
    expect((await (await as('drA')).post('/api/lab-setup/signatories').send({ ...signer, userId: people.nurse._id.toString() })).body.error.fields).toHaveProperty('userId');
    const added = await (await as('drA')).post('/api/lab-setup/signatories').send(signer);
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const def = await (await as('drA')).post('/api/lab-setup/signatories').send({ name: 'Dr Sample Incharge', qualification: 'MD (Pathology)', regNo: 'MMC 11111', isDefault: true });
    expect(def.body.signatories.map((s) => [s.name, s.isDefault])).toEqual([['Dr Sample Pathologist', false], ['Dr Sample Incharge', true]]);

    await (await as('drA')).put('/api/lab-setup/settings').send({ verify: true, verifierIds: [] });
    const p = await register();
    let o = await order(p, ['hb']);
    o = (await results(o, [{ key: 'hb', values: vals({ hb: '12' }) }], { report: true })).body.order;
    expect((await (await as('lab')).get(`/api/lab/orders/${o.id}`)).body.signer).toBeNull(); // not reported yet
    await (await as('lab2')).post(`/api/lab/orders/${o.id}/verify`).send({ rev: o.rev });
    const checked = (await (await as('lab')).get(`/api/lab/orders/${o.id}`)).body.signer;
    expect(checked).toMatchObject({ name: 'Dr Sample Pathologist', qualification: 'MD (Pathology)', regNo: 'MMC 00000', signature: PNG, signed: true });

    await (await as('drA')).put('/api/lab-setup/settings').send({ verify: false, verifierIds: [] });
    let o2 = await order(p, ['hb']);
    o2 = (await results(o2, [{ key: 'hb', values: vals({ hb: '12' }) }], { report: true })).body.order;
    expect((await (await as('lab')).get(`/api/lab/orders/${o2.id}`)).body.signer).toEqual({ name: 'Dr Sample Incharge', title: '', qualification: 'MD (Pathology)', regNo: 'MMC 11111', signature: '', signed: false });
    const entries = await AuditLog.find({ action: 'LAB_SETTINGS_CHANGED' }).lean();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(entries.map((e) => e.details))).not.toMatch(/base64|Pathologist/);
  });
});
