// The lab module (Version 2): orders, the lab's worklist, results and report files, the doctor's review, and
// the care-plan items a reviewed result completes. All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };
const PDF = Buffer.from('%PDF-1.4\n% fake sample report\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').toString('base64');
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
  hospital = await createTenant('Lab Hospital');
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
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: 'Lab Mother', ageYears: 27, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, medical: { allergies: 'None known', bloodGroup: 'B+' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const order = async (who, p, body = {}) => (await as(who)).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'cbc' }, { key: 'hiv' }], ...body });
const lab = (path) => `/api/lab/orders/${path}`;
const cbcHiv = (hb = '9.5', hiv = 'Non-reactive') => [
  { key: 'cbc', values: [{ key: 'hb', value: hb }, { key: 'tlc', value: '8000' }, { key: 'platelets', value: '2.1' }] },
  { key: 'hiv', values: [{ key: 'hiv', value: hiv }] },
];
const results = async (who, o, body) => (await as(who)).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: cbcHiv(), ...body });

describe('ordering tests', () => {
  it('the doctor or an RMO orders; nurses, reception, the lab and another doctor cannot', async () => {
    const p = await register();
    for (const who of ['nurse', 'reception', 'lab', 'drB']) expect((await order(who, p)).status, who).toBe(403);
    const res = await order('rmo', p, { urgent: true, noteToLab: 'Fasting sample', tests: [{ key: 'cbc' }, { key: 'other', name: 'Serum vitamin D' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.order).toMatchObject({ status: 'ordered', urgent: true, noteToLab: 'Fasting sample', ordered: { byName: 'Sample rmo' } });
    expect(res.body.order.tests.map((t) => t.name)).toEqual(['Complete blood count (CBC)', 'Serum vitamin D']);
    expect((await order('drA', p, { tests: [{ key: 'cbc' }, { key: 'cbc' }] })).status).toBe(400);
    expect((await order('drA', p, { tests: [{ key: 'other' }] })).status).toBe(400);
    expect((await order('drA', p, { tests: [{ key: 'other', name: 'Test for the sex of the baby' }] })).status).toBe(400); // PCPNDT
    // The same request twice (a double click) makes one order
    const id = randomUUID();
    await order('drA', p, { clientRequestId: id });
    await order('drA', p, { clientRequestId: id });
    const list = await (await as('drA')).get(`/api/patients/${p.id}/lab-orders`);
    expect(list.body.orders).toHaveLength(2);
    expect(list.body.canOrder).toBe(true);
    expect((await (await as('lab')).get(`/api/patients/${p.id}/lab-orders`)).status).toBe(403);
  });
});

describe('the lab', () => {
  it('sees the worklist with the name and number only; collects; saves; reports; the doctor reviews; the care plan is ticked', async () => {
    const p = await register();
    const o = (await order('drA', p, { noteToLab: 'Booking tests' })).body.order;

    const wl = await (await as('lab')).get('/api/lab/worklist?list=collect');
    expect(wl.status).toBe(200);
    expect(wl.body.counts).toMatchObject({ collect: 1, report: 0 });
    expect(wl.body.orders[0].patient).toEqual({ id: p.id, fullName: 'Lab Mother', mrn: p.mrn, careType: 'antenatal', age: 27, assignedDoctorName: 'Sample drA' });
    expect(JSON.stringify(wl.body)).not.toMatch(/bloodGroup|allergies|pregnancy/);
    expect((await (await as('reception')).get('/api/lab/worklist')).status).toBe(403);
    // Doctors and nurses see the worklist too, counted over the patients they may see (this once failed with 500)
    const forDoctor = await (await as('drA')).get('/api/lab/worklist?list=collect');
    expect(forDoctor.status, JSON.stringify(forDoctor.body)).toBe(200);
    expect(forDoctor.body.counts).toMatchObject({ collect: 1, report: 0 });

    expect((await (await as('lab')).post(lab(`${o.id}/collect`)).send({ rev: 5 })).status).toBe(409);
    const collected = (await (await as('lab')).post(lab(`${o.id}/collect`)).send({ rev: o.rev })).body.order;
    expect(collected).toMatchObject({ status: 'collected', collected: { byName: 'Sample lab' } });

    // A first save (not all results yet), then the report: every result is needed
    const partial = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: collected.rev, tests: [cbcHiv()[0], { key: 'hiv', values: [] }] });
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(partial.body.order.status).toBe('collected');
    const notAll = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: partial.body.order.rev, tests: [cbcHiv()[0], { key: 'hiv', values: [] }], report: true });
    expect(notAll.status).toBe(400);
    expect(notAll.body.error.fields).toHaveProperty(['tests.1']);
    expect((await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: partial.body.order.rev, tests: [{ key: 'cbc', values: [{ key: 'hb', value: 'nine' }] }, cbcHiv()[1]] })).body.error.fields).toHaveProperty(['tests.0.hb']);
    const reported = (await results('lab', partial.body.order, { report: true, labNote: 'Sample slightly haemolysed' })).body.order;
    expect(reported).toMatchObject({ status: 'reported', abnormal: true, labNote: 'Sample slightly haemolysed', reported: { byName: 'Sample lab' } });
    // below 11; each value keeps the name, unit and range that applied to her
    expect(reported.tests[0].values[0]).toEqual({ key: 'hb', value: '9.5', flag: 'low', name: 'Haemoglobin', unit: 'g/dL', range: '11–16 g/dL (below 11 in pregnancy is anaemia)', section: 'Haemoglobin and red cells' });
    expect(reported.tests[1].values[0]).toEqual({ key: 'hiv', value: 'Non-reactive', flag: 'normal', name: 'HIV' });

    // The doctor's list of results to review; another doctor does not see this patient's
    const toReview = (await (await as('drA')).get('/api/lab/to-review')).body.orders;
    expect(toReview.map((x) => x.id)).toEqual([o.id]);
    expect((await (await as('drB')).get('/api/lab/to-review')).body.orders).toEqual([]);
    expect((await (await as('lab')).get('/api/lab/to-review')).body.orders).toBeNull();

    // Review: only the treating doctor; an abnormal result needs a comment
    expect((await (await as('rmo')).post(lab(`${o.id}/review`)).send({ rev: reported.rev })).status).toBe(403);
    expect((await (await as('drB')).post(lab(`${o.id}/review`)).send({ rev: reported.rev })).status).toBe(403);
    expect((await (await as('drA')).post(lab(`${o.id}/review`)).send({ rev: reported.rev })).body.error.fields).toHaveProperty('comment');
    const reviewed = await (await as('drA')).post(lab(`${o.id}/review`)).send({ rev: reported.rev, comment: 'Iron sucrose started' });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(reviewed.body.order).toMatchObject({ status: 'reviewed', reviewed: { byName: 'Sample drA', comment: 'Iron sucrose started' } });
    expect(reviewed.body.planChanged).toBe(true);

    // The care plan: the booking CBC and HIV tests are done (from the day of the sample); the 28-week Hb is not
    const plan = (await (await as('drA')).get(`/api/patients/${p.id}/care-plan`)).body.plan;
    const it = (key) => plan.items.find((i) => i.key === key);
    expect(it('lab_cbc')).toMatchObject({ status: 'done', done: { via: 'lab', labOrderId: o.id, result: 'Haemoglobin 9.5 g/dL (low), Total WBC count 8000 /µL, Platelets 2.1 lakh/µL' } });
    expect(it('lab_hiv').done).toMatchObject({ via: 'lab', result: 'HIV Non-reactive' });
    expect(it('lab_hb28').status).not.toBe('done');

    // The lab sees the review happened, not the doctor's comment
    const labView = (await (await as('lab')).get(lab(o.id))).body.order;
    expect(labView.reviewed).toEqual({ byName: 'Sample drA', at: expect.any(String) });
  });

  it('a change after the report needs a reason, keeps the earlier results, and goes back to the doctor', async () => {
    const p = await register();
    let o = (await order('drA', p)).body.order;
    o = (await results('lab', o, { report: true })).body.order;
    o = (await (await as('drA')).post(lab(`${o.id}/review`)).send({ rev: o.rev, comment: 'Seen' })).body.order;
    expect((await results('lab', o, { tests: cbcHiv('11.5') })).body.error.fields).toHaveProperty('reason');
    const amended = (await results('lab', o, { tests: cbcHiv('11.5'), reason: 'Typing error in Hb' })).body.order;
    expect(amended).toMatchObject({ status: 'reported', reviewed: null, abnormal: false });
    expect(amended.amendments).toEqual([{ byName: 'Sample lab', at: expect.any(String), reason: 'Typing error in Hb' }]); // lab: no earlier values
    const doctorView = (await (await as('drA')).get(lab(o.id))).body.order;
    expect(doctorView.amendments[0]).toMatchObject({ reason: 'Typing error in Hb', reviewedByName: 'Sample drA' });
    expect(doctorView.amendments[0].tests[0].values[0]).toMatchObject({ value: '9.5', flag: 'low' });
    expect((await (await as('drA')).get('/api/lab/to-review')).body.orders.map((x) => x.id)).toEqual([o.id]);
  });

  it('report files: PDF or photo only (checked from the file), opened by those who may see them, audited with ids only', async () => {
    const p = await register();
    const o = (await order('drA', p)).body.order;
    const send = (who, body) => as(who).then((s) => s.post(lab(`${o.id}/files`)).send({ fileName: 'report.pdf', mediaType: 'application/pdf', data: PDF, ...body }));
    expect((await send('nurse')).status).toBe(403);
    expect((await send('lab', { data: Buffer.from('<html>not a pdf</html>').toString('base64') })).status).toBe(400);
    expect((await send('lab', { mediaType: 'text/html' })).status).toBe(400);
    const up = await send('lab', { fileName: 'Lab report <1>.pdf' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const file = up.body.order.files[0];
    expect(file).toMatchObject({ fileName: 'Lab report _1_.pdf', mediaType: 'application/pdf', byName: 'Sample lab' });
    // With the file, the lab may report without typing every value
    const reported = await results('lab', up.body.order, { tests: [{ key: 'cbc', values: [] }, { key: 'hiv', values: [] }], report: true });
    expect(reported.status, JSON.stringify(reported.body)).toBe(200);

    const opened = await (await as('drA')).get(lab(`${o.id}/files/${file.id}`)).buffer(true);
    expect(opened.status).toBe(200);
    expect(opened.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(opened.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await (await as('drB')).get(lab(`${o.id}/files/${file.id}`))).status).toBe(200); // other doctors may view any record
    expect((await (await as('reception')).get(lab(`${o.id}/files/${file.id}`))).status).toBe(403);

    const entries = await AuditLog.find({ action: /^LAB_/ }).sort({ _id: 1 }).lean();
    expect(entries.map((e) => e.action)).toEqual(['LAB_ORDER_CREATED', 'LAB_REPORT_UPLOADED', 'LAB_RESULTS_REPORTED', 'LAB_REPORT_OPENED', 'LAB_REPORT_OPENED']);
    for (const e of entries) {
      expect(Object.keys(e.details).every((k) => ['patientId', 'mrn', 'orderId', 'fileId', 'tests'].includes(k))).toBe(true);
      expect(JSON.stringify(e.details)).not.toMatch(/CBC|report\.pdf|HIV/);
    }
    expect(safeAuditDetails('LAB_REPORT_OPENED', entries[3].details, { scope: 'platform' })).toEqual({});
    expect(String(entries[4].actor)).toBe(String(people.drB._id));
  });

  it('cancel with a reason (not after the report); PCPNDT words refused in results; a stale version is refused', async () => {
    const p = await register();
    const o = (await order('drA', p)).body.order;
    expect((await (await as('drA')).post(lab(`${o.id}/cancel`)).send({ rev: o.rev, reason: '' })).status).toBe(400);
    const c = await (await as('lab')).post(lab(`${o.id}/cancel`)).send({ rev: o.rev, reason: 'Sample not received' });
    expect(c.body.order).toMatchObject({ status: 'cancelled', cancelled: { byName: 'Sample lab', reason: 'Sample not received' } });
    expect((await results('lab', c.body.order, {})).status).toBe(409);

    const o2 = (await order('drA', p, { tests: [{ key: 'other', name: 'Ultrasound-free fetal DNA screen' }] })).body.order;
    const bad = await (await as('lab')).put(lab(`${o2.id}/results`)).send({ rev: o2.rev, tests: [{ key: 'other', values: [], text: 'Low risk. Fetus is a boy' }] });
    expect(bad.status).toBe(400);
    const ok = await (await as('lab')).put(lab(`${o2.id}/results`)).send({ rev: o2.rev, tests: [{ key: 'other', values: [], text: 'Low risk' }], report: true });
    expect(ok.status).toBe(200);
    expect((await (await as('lab')).put(lab(`${o2.id}/results`)).send({ rev: o2.rev, tests: [{ key: 'other', values: [], text: 'Low risk' }] })).status).toBe(409);
    expect((await (await as('drA')).post(lab(`${o2.id}/cancel`)).send({ rev: ok.body.order.rev, reason: 'Ordered by mistake' })).status).toBe(409);
  });

  it('the test list is for lab, doctors, RMOs and nurses', async () => {
    const res = await (await as('nurse')).get('/api/lab/tests');
    expect(res.status).toBe(200);
    expect(res.body.tests.find((t) => t.key === 'cbc').fields[0]).toMatchObject({ key: 'hb', unit: 'g/dL', low: 11 });
    expect((await (await as('reception')).get('/api/lab/tests')).status).toBe(403);
  });
});

describe('baby tests and packages', () => {
  const baby = () => register({ careType: 'newborn', fullName: 'Baby of Lab Mother', ageYears: undefined, pregnancy: undefined, newborn: { birthAt: '2026-09-26T04:00:00.000Z', birthWeightGrams: 2900, sex: 'female' } });

  it('the test list marks baby and adult tests; each built-in package holds tests of its own kind', async () => {
    const { body } = await (await as('nurse')).get('/api/lab/tests');
    const who = new Map(body.tests.map((t) => [t.key, t.who]));
    expect(who.get('cbc')).toBe('adult');
    expect(who.get('nb_bilirubin')).toBe('newborn');
    expect(body.tests.find((t) => t.key === 'nb_sugar').fields[0]).toMatchObject({ unit: 'mg/dL', low: 45 });
    const { body: lib } = await (await as('nurse')).get('/api/lab-packages');
    expect(lib.canEdit).toBe(false);
    expect(lib.packages.length).toBeGreaterThan(10);
    for (const p of lib.packages) {
      expect(p.tests.every((k) => who.get(k) === p.who), p.key).toBe(true);
      if (p.who === 'newborn') expect(p.fromDay).toBeGreaterThanOrEqual(0);
      else expect(p.fromDay).toBeNull();
      expect(p.status).toBe('draft');
    }
    expect(lib.packages[0].who).toBe('newborn'); // baby packages first
    expect(lib.packages.find((p) => p.key === 'nb_pkg_discharge').tests).toEqual(expect.arrayContaining(['nb_screening', 'nb_oae', 'nb_pulseox']));
    expect(lib.packages.find((p) => p.key === 'anc_pkg_booking').who).toBe('adult');
  });

  it('a baby is given baby tests (and packages); the mother only adult tests', async () => {
    const b = await baby();
    const ok = await order('drA', b, { tests: [{ key: 'nb_screening' }, { key: 'nb_oae' }], packages: ['nb_pkg_discharge'] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.order).toMatchObject({ packages: [{ key: 'nb_pkg_discharge', version: 1, approved: false }], tests: [{ key: 'nb_screening' }, { key: 'nb_oae' }] });
    expect(ok.body.order.packages[0].name).toMatch(/newborn screening/);
    const adultOnBaby = await order('drA', b, { tests: [{ key: 'cbc' }] });
    expect(adultOnBaby.status).toBe(400);
    expect(adultOnBaby.body.error.fields['tests.0.key']).toMatch(/mother's tests on her own record/);

    const mother = await register();
    const babyOnMother = await order('drA', mother, { tests: [{ key: 'nb_bilirubin' }] });
    expect(babyOnMother.status).toBe(400);
    const packageOnMother = await order('drA', mother, { tests: [{ key: 'cbc' }], packages: ['nb_pkg_jaundice'] });
    expect(packageOnMother.status).toBe(400); // a baby package
    const motherPackage = await order('drA', mother, { tests: [{ key: 'cbc' }, { key: 'urine' }], packages: ['anc_pkg_booking'] });
    expect(motherPackage.status).toBe(201);
  });

  it('the lab reports baby results with newborn flags', async () => {
    const b = await baby();
    const o = (await order('drA', b, { tests: [{ key: 'nb_sugar' }] })).body.order;
    const col = await (await as('lab')).post(lab(`${o.id}/collect`)).send({ rev: o.rev });
    expect(col.status, JSON.stringify(col.body)).toBe(200);
    const rep = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: col.body.order.rev, tests: [{ key: 'nb_sugar', values: [{ key: 'glucose', value: '38' }], text: '' }], report: true });
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    expect(rep.body.order.tests[0].values[0]).toMatchObject({ value: '38', flag: 'low' });
    expect(rep.body.order.abnormal).toBe(true);
  });
});

describe('the test package library', () => {
  const pkgs = async (who = 'drA') => (await (await as(who)).get('/api/lab-packages')).body.packages;

  it('doctors add, edit (a new draft), approve and stop using packages; others only read', async () => {
    const add = await (await as('drA')).post('/api/lab-packages').send({ who: 'newborn', name: 'Our jaundice check', fromDay: 2, toDay: 10, tests: ['nb_bilirubin', 'nb_bilirubin', 'nb_group_dct'] });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const p = add.body.package;
    expect(p).toMatchObject({ origin: 'hospital', status: 'draft', version: 1, tests: ['nb_bilirubin', 'nb_group_dct'] });
    expect((await (await as('nurse')).post('/api/lab-packages').send({ who: 'newborn', name: 'X', fromDay: 0, tests: ['nb_sugar'] })).status).toBe(403);

    const wrong = await (await as('drA')).put(`/api/lab-packages/${p.id}`).send({ who: 'newborn', name: 'Our jaundice check', fromDay: 5, toDay: 2, tests: ['cbc'], version: 1 });
    expect(wrong.status).toBe(400);
    expect(Object.keys(wrong.body.error.fields).sort()).toEqual(['tests', 'toDay']);

    const approved = await (await as('drA')).post(`/api/lab-packages/${p.id}/approve`).send({ confirm: true, version: 1 });
    expect(approved.body.package).toMatchObject({ status: 'approved', approvedVersion: 1 });
    const edited = await (await as('drA')).put(`/api/lab-packages/${p.id}`).send({ who: 'newborn', name: 'Our jaundice check', fromDay: 2, toDay: 14, tests: ['nb_bilirubin'], version: 1 });
    expect(edited.body.package).toMatchObject({ status: 'draft', version: 2, toDay: 14 });
    expect((await (await as('drA')).put(`/api/lab-packages/${p.id}`).send({ who: 'newborn', name: 'Old copy', fromDay: 2, tests: ['nb_bilirubin'], version: 1 })).status).toBe(409);

    const off = await (await as('drA')).patch(`/api/lab-packages/${p.id}/active`).send({ active: false });
    expect(off.body.package.isActive).toBe(false);
    const baby = await register({ careType: 'newborn', fullName: 'Baby Pkg', ageYears: undefined, pregnancy: undefined, newborn: { birthAt: '2026-09-26T04:00:00.000Z', birthWeightGrams: 2900, sex: 'male' } });
    const refused = await order('drA', baby, { tests: [{ key: 'nb_bilirubin' }], packages: [p.key] });
    expect(refused.status).toBe(400); // not in use any more
    expect((await AuditLog.find({ action: /^LAB_PACKAGE_/ }).sort({ _id: 1 })).map((e) => e.action)).toEqual(['LAB_PACKAGE_CREATED', 'LAB_PACKAGE_APPROVED', 'LAB_PACKAGE_UPDATED', 'LAB_PACKAGE_DEACTIVATED']);
  });

  it('a copy is a new draft of the hospital\'s own', async () => {
    const booking = (await pkgs()).find((p) => p.key === 'anc_pkg_booking');
    const copy = await (await as('drA')).post('/api/lab-packages').send({ copyFrom: booking.id });
    expect(copy.status).toBe(201);
    expect(copy.body.package).toMatchObject({ origin: 'hospital', who: 'adult', name: 'Copy of Antenatal booking tests', status: 'draft', tests: booking.tests });
    expect((await (await as('reception')).get('/api/lab-packages')).status).toBe(403);
  });
});
