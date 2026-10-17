// Pregnancy-loss care, part 2 (5 Oct 2026): the DRAFT prescription sets for care of a loss already diagnosed, the
// DRAFT "Recurrent pregnancy loss work-up" test package, the tests added to the lab list (antiphospholipid and
// thyroid antibodies, serum bile acids), and beta hCG typed as a number the way lab reports print it. Fake data only.
// Time is pinned: 5 Oct 2026, 11:30 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/lab/labFormat.js';
import { medicineWarnings, pregnancyOnVisit } from '../../client/src/pages/medsafety/medSafety.js';
import { createApp } from '../src/app.js';
import { ensurePriceList } from '../src/billing/billingService.js';
import { BUILT_IN_PRICES } from '../src/billing/builtInPrices.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { BUILT_IN_PACKAGES, BUILT_IN_PACKAGES_VERSION } from '../src/lab/builtInPackages.js';
import { AMBIGUOUS_NUMBER, LAB_GROUPS, LAB_TESTS, flagFor, groupsDigits, labNumber, testByKey } from '../src/lab/labTests.js';
import { BUILT_IN_MED_SAFETY } from '../src/medsafety/medicineSafety.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { LabPackage } from '../src/models/LabPackage.js';
import { PrescriptionSet } from '../src/models/PrescriptionSet.js';
import { PriceItem } from '../src/models/PriceItem.js';
import { mentionsFetalSex } from '../src/utils/pcpndt.js';
import { BUILT_IN_SETS, BUILT_IN_SETS_VERSION, DIAGNOSED_ONLY, LOSS_SET_KEYS } from '../src/visits/builtInSets.js';
import { ensurePrescriptionSets } from '../src/visits/prescriptionSets.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-05T06:00:00Z'); // hospital today: 5 Oct 2026
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };
const LOSS_SETS = BUILT_IN_SETS.filter((s) => LOSS_SET_KEYS.includes(s.key));
const setOf = (key) => BUILT_IN_SETS.find((s) => s.key === key);
const NEW_TESTS = ['antiTpo', 'lupusAnticoagulant', 'acl', 'b2gpi', 'bileAcids'];
const RECURRENT = 'loss_pkg_recurrent';
const ANTIBIOTICS = /cillin|amoxi|cef|ceph|doxy|cycline|metronidazole|tinidazole|ornidazole|azithro|erythro|clinda|floxacin|gentamicin|cotrimoxazole|nitrofurantoin/i;
// The words a patient reads: the medicine lines as printed, the general instructions, the tests and the advice
const patientWords = (s) => [s.notes, s.investigations, s.advice, ...s.items.flatMap((it) => [it.frequencyText, it.instructions])];

// ---------- The built-in content (no database) ----------

describe('the DRAFT prescription sets for pregnancy-loss care', () => {
  it('four sets for a loss already diagnosed, for the Abortion type of care only, each naming its source and saying the doses are to be checked', () => {
    expect(LOSS_SETS.map((s) => s.key)).toEqual(['loss_complete', 'loss_missed_medical', 'loss_incomplete_medical', 'loss_after_evacuation']);
    for (const s of LOSS_SETS) {
      expect(s.careTypes, s.key).toEqual(['abortion']);
      expect(s.about, s.key).toMatch(/NICE NG126/);
      expect(s.about, s.key).toContain('Every medicine and dose is for the doctor to check (paracetamol 1 g is for an adult over 50 kg).');
      expect(s.about.length, s.key).toBeLessThanOrEqual(1000);
      const texts = [s.name, s.about, ...patientWords(s), ...s.items.flatMap((it) => [it.drug, it.strength, it.dose])];
      for (const t of texts) expect(mentionsFetalSex(t), `${s.key}: ${t}`).toBe(false);
    }
    // Nothing about ending a pregnancy, MTP or Form F (the owner removed them)
    expect(JSON.stringify(LOSS_SETS)).not.toMatch(/MTP|terminat|induced|medical abortion|Form F/i);
    // Adding sets changes none of the earlier ones: no version raised, so no hospital's draft is refreshed
    expect(BUILT_IN_SETS_VERSION).toBe(1);
  });

  it('the misoprostol sets: marked for a miscarriage already diagnosed, with the regimens of NICE NG126 and FIGO 2017', () => {
    const missed = setOf('loss_missed_medical');
    const incomplete = setOf('loss_incomplete_medical');
    for (const s of [missed, incomplete]) {
      expect(s.about.startsWith(DIAGNOSED_ONLY), s.key).toBe(true);
      expect(DIAGNOSED_ONLY).toBe('FOR A MISCARRIAGE ALREADY DIAGNOSED – NOT FOR ENDING A CONTINUING PREGNANCY.');
      expect(s.name, s.key).toMatch(/\(diagnosed\) – medical management with misoprostol$/);
      expect(s.about, s.key).toMatch(/FIGO 2017/);
    }
    // Missed: 800 mcg (4 × 200 mcg) vaginally, one dose – a second after 3 hours only on the doctor's word (FIGO)
    expect(missed.items[0]).toMatchObject({ drug: 'Misoprostol', form: 'tab', strength: '200 mcg', dose: '4', route: 'vaginal', frequency: 'custom', durationValue: null, durationUnit: '' });
    expect(missed.about).toMatch(/mifepristone 200 mg/);
    // Incomplete: 600 mcg (3 × 200 mcg) by mouth, once – no mifepristone
    expect(incomplete.items[0]).toMatchObject({ drug: 'Misoprostol', strength: '200 mcg', dose: '3', route: 'oral', frequency: 'custom', frequencyText: 'Once only' });
    expect(incomplete.about).toMatch(/without mifepristone/);
    // Pain relief with both (NICE NG126: pain relief and anti-emetics as needed)
    for (const s of [missed, incomplete]) expect(s.items.map((it) => it.drug), s.key).toEqual(['Misoprostol', 'Ibuprofen', 'Paracetamol']);
  });

  it('after a complete miscarriage and after evacuation: pain relief, iron and advice – no antibiotic course, and the reason given', () => {
    for (const key of ['loss_complete', 'loss_after_evacuation']) {
      const s = setOf(key);
      expect(s.items.map((it) => it.drug), key).toEqual(['Paracetamol', 'Iron + folic acid (IFA)']);
      expect(s.advice, key).toMatch(/contraception/);
    }
    const evacuation = setOf('loss_after_evacuation');
    for (const s of LOSS_SETS) expect(s.items.some((it) => ANTIBIOTICS.test(it.drug)), s.key).toBe(false);
    expect(evacuation.about).toMatch(/No antibiotic: NICE NG126 has no recommendation for antibiotics after surgical management/);
    expect(evacuation.about).toMatch(/AIMS trial \(Lancet 2019\)/);
  });

  it('left out on purpose: methotrexate for an ectopic (said in the notes) and a threatened miscarriage (it stays under antenatal care)', () => {
    expect(BUILT_IN_SETS.some((s) => s.items.some((it) => /methotrexate|folitrax/i.test(it.drug)))).toBe(false);
    for (const key of ['loss_complete', 'loss_missed_medical', 'loss_incomplete_medical']) {
      expect(setOf(key).about, key).toContain('Methotrexate for an ectopic pregnancy has no set, on purpose: it is a specialist protocol with strict criteria (RCOG Green-top Guideline 21).');
    }
    expect(JSON.stringify(BUILT_IN_SETS)).not.toMatch(/threatened/i);
  });

  it('the words a patient reads never name the loss (they are printed on her copy)', () => {
    for (const s of LOSS_SETS) {
      for (const t of patientWords(s)) expect(t, `${s.key}: ${t}`).not.toMatch(/abortion|miscarriage|ectopic|molar|\bloss\b|termination/i);
    }
  });

  it('agree with the medicine-safety list: no warning in pregnancy-loss care; misoprostol is "avoid" in a continuing pregnancy', () => {
    const list = BUILT_IN_MED_SAFETY;
    const loss = { careType: 'abortion', abortion: { lossType: 'missed' }, medical: { allergies: 'None known' } };
    const antenatal = { careType: 'antenatal', pregnancy: { effectiveEdd: '2027-05-01' }, medical: { allergies: 'None known' } };
    expect(pregnancyOnVisit(loss, '2026-10-05')).toEqual({ pregnant: false, weeks: null });
    for (const s of LOSS_SETS) {
      const warnings = medicineWarnings({ rows: s.items, list, ...pregnancyOnVisit(loss, '2026-10-05'), allergies: 'None known' });
      expect(warnings, s.key).toEqual([]); // nothing to avoid, no caution, every dose within the usual maximum
    }
    const onAntenatal = medicineWarnings({ rows: setOf('loss_missed_medical').items, list, ...pregnancyOnVisit(antenatal, '2026-10-05'), allergies: 'None known' });
    const miso = onAntenatal.find((w) => w.key === 'misoprostol');
    expect(miso).toMatchObject({ level: 'avoid', medicines: ['Misoprostol'] });
    expect(miso.message).toBe('Causes uterine contractions. Only under protocol – management of miscarriage, induction of labour or bleeding after delivery.');
  });
});

describe('the lab tests added for the work-up, bile acids and beta hCG', () => {
  it('the new tests are adult tests with their samples, in their groups, ticking no care-plan item; the price list has each at ₹0', () => {
    expect(LAB_GROUPS.antibodies).toBe('Antibodies');
    for (const key of NEW_TESTS) {
      const t = testByKey.get(key);
      expect(t, key).toMatchObject({ who: 'adult', planKeys: [] });
      expect(t.sample, key).toBeTruthy();
      expect(BUILT_IN_PRICES.find((p) => p.key === `lab:${key}`), key).toMatchObject({ name: t.name, group: 'lab' });
    }
    expect(['antiTpo', 'lupusAnticoagulant', 'acl', 'b2gpi'].map((k) => testByKey.get(k).group)).toEqual(['antibodies', 'antibodies', 'antibodies', 'antibodies']);
    expect(testByKey.get('bileAcids')).toMatchObject({ name: 'Serum bile acids (total)', group: 'chemistry' });
    expect(testByKey.get('lupusAnticoagulant').sample).toMatch(/before any heparin/);
    expect(testByKey.get('acl').fields.map((f) => [f.key, f.unit])).toEqual([['aclIgg', 'GPL U/mL'], ['aclIgm', 'MPL U/mL']]);
    expect(testByKey.get('b2gpi').fields.map((f) => f.key)).toEqual(['b2gpiIgg', 'b2gpiIgm']);
    // Beta hCG is a number with its unit; a reviewed result ticks the follow-up tests one at a time
    expect(testByKey.get('bhcg')).toMatchObject({ planSeries: true });
    expect(testByKey.get('bhcg').fields).toEqual([expect.objectContaining({ key: 'bhcg', type: 'number', unit: 'mIU/mL', low: null, high: null })]);
    expect(new Set(LAB_TESTS.map((t) => t.key)).size).toBe(LAB_TESTS.length);
    for (const t of LAB_TESTS.filter((x) => x.who === 'adult')) {
      for (const text of [t.name, t.sample, ...t.fields.map((f) => `${f.name} ${f.range ?? ''}`)]) expect(mentionsFetalSex(text), `${t.key}: ${text}`).toBe(false);
    }
  });

  it('flags: a number with no usual range is not flagged (never "Normal"); bile acids from 19 µmol/L are high; a positive lupus anticoagulant is abnormal', () => {
    const field = (test, key) => testByKey.get(test).fields.find((f) => f.key === key);
    for (const fn of [flagFor, website.flagFor]) {
      expect(fn(field('bhcg', 'bhcg'), '85000')).toBe('');
      expect(fn(field('acl', 'aclIgg'), '62')).toBe('');
      expect(fn(field('hormones', 'lh'), '6')).toBe('');
      expect(fn(field('bileAcids', 'bileAcids'), '19')).toBe('high');
      expect(fn(field('bileAcids', 'bileAcids'), '12')).toBe('normal');
      expect(fn(field('lupusAnticoagulant', 'la'), 'Positive')).toBe('abnormal');
      expect(fn(field('lupusAnticoagulant', 'la'), 'Indeterminate')).toBe('abnormal');
      expect(fn(field('lupusAnticoagulant', 'la'), 'Negative')).toBe('normal');
      expect(fn(field('cbc', 'tlc'), '12,000.5')).toBe('high'); // grouping commas are read
      expect(fn(field('cbc', 'hb'), '12,5')).toBe('normal'); // a decimal comma, as before
      expect(fn(field('cbc', 'tlc'), '1,500')).toBe(''); // asked about, so not flagged
    }
  });

  it('a typed number: grouping commas are taken out, a decimal comma is read, "1,500" is asked about – the website reads it the same way', () => {
    const cases = {
      1500: { value: '1500' },
      '12.5': { value: '12.5' },
      '-2': { value: '-2' },
      '12,5': { value: '12.5' },
      '12,55': { value: '12.55' },
      '1,23,456': { value: '123456' },
      '12,34,567.5': { value: '1234567.5' },
      '1,234,567': { value: '1234567' },
      '1,500.25': { value: '1500.25' },
      '1,500': { error: AMBIGUOUS_NUMBER },
      '85,000': { error: AMBIGUOUS_NUMBER },
      '0,125': { error: AMBIGUOUS_NUMBER },
      '1,5000': { error: 'Enter a number.' },
      '12,34,5': { error: 'Enter a number.' },
      '<2': { error: 'Enter a number.' },
      nine: { error: 'Enter a number.' },
      '12.': { error: 'Enter a number.' },
    };
    for (const [typed, expected] of Object.entries(cases)) {
      expect(labNumber(typed), typed).toEqual(expected);
      expect(website.labNumber(typed), `website: ${typed}`).toEqual(expected);
    }
    expect(website.AMBIGUOUS_NUMBER).toBe(AMBIGUOUS_NUMBER);
  });

  it('a number grouped with commas only in a field that can hold one: platelets typed "1,40,000" in lakh/µL are refused with the unit, never stored as 140000', () => {
    const field = (test, key) => testByKey.get(test).fields.find((f) => f.key === key);
    const platelets = field('cbc', 'platelets');
    const tooLarge = 'This is far too large for lakh/µL – check the unit (1.5–4.5 lakh/µL).';
    for (const fn of [labNumber, website.labNumber]) {
      expect(fn('1,40,000', platelets)).toEqual({ error: tooLarge });
      expect(fn('1.4', platelets)).toEqual({ value: '1.4' });
      expect(fn('1,23,456', field('bhcg', 'bhcg'))).toEqual({ value: '123456' }); // no usual range: may be large
      expect(fn('12,000.5', field('cbc', 'tlc'))).toEqual({ value: '12000.5' }); // a white cell count per µL
      expect(fn('1,25,000', field('hb', 'hb'))).toEqual({ error: 'This is far too large for g/dL – check the unit (11–16 g/dL (below 11 in pregnancy is anaemia)).' });
      expect(fn('12,5', field('hb', 'hb'))).toEqual({ value: '12.5' }); // a decimal comma, as before
    }
    // Every number field of the list: the server and the website agree
    for (const t of LAB_TESTS) for (const f of t.fields.filter((x) => x.type === 'number')) expect(website.groupsDigits(f), `${t.key}.${f.key}`).toBe(groupsDigits(f));
    expect(groupsDigits(platelets)).toBe(false);
    for (const fn of [flagFor, website.flagFor]) expect(fn(platelets, '1,40,000')).toBe(''); // refused, so never "High"
  });
});

describe('the DRAFT "Recurrent pregnancy loss work-up" test package', () => {
  const pkg = BUILT_IN_PACKAGES.find((p) => p.key === RECURRENT);

  it('holds the tests of ESHRE 2022 / RCOG GTG 17 and says what is left out: the karyotype on the doctor’s decision, the scan, thrombophilia', () => {
    expect(pkg).toMatchObject({ who: 'adult', name: 'Recurrent pregnancy loss work-up', fromDay: null, toDay: null });
    expect(pkg.tests).toEqual(['lupusAnticoagulant', 'acl', 'b2gpi', 'tsh', 'antiTpo', 'hba1c']);
    expect(pkg.tests.every((k) => testByKey.get(k)?.who === 'adult')).toBe(true);
    expect(pkg.forWhom).toMatch(/Two or more pregnancy losses \(ESHRE 2022\)/);
    expect(pkg.about).toMatch(/ESHRE Recurrent pregnancy loss, 2022; RCOG Green-top Guideline 17, 2023/);
    expect(pkg.about).toMatch(/parental karyotype of both partners, only on the doctor's decision/);
    expect(pkg.about).toMatch(/pelvic ultrasound .* a scan, not a lab test/);
    expect(pkg.about).toMatch(/inherited thrombophilia \(not advised routinely\)/);
    expect(pkg.about).toMatch(/at least 12 weeks later/);
    expect(pkg.about.length).toBeLessThanOrEqual(1000);
    expect(mentionsFetalSex(pkg.about) || mentionsFetalSex(pkg.forWhom) || mentionsFetalSex(pkg.name)).toBe(false);
    // The earlier packages are unchanged: no version raised, nothing of theirs refreshed
    expect(BUILT_IN_PACKAGES_VERSION).toBe(1);
    expect(BUILT_IN_PACKAGES.filter((p) => p.key !== RECURRENT).every((p) => p.about === '')).toBe(true);
  });
});

// ---------- Through the app ----------

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
  hospital = await createTenant('Loss Sets Hospital');
  other = await createTenant('Other Loss Sets Hospital');
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
const at = (iso) => {
  vi.setSystemTime(new Date(iso));
  app = createApp();
  sessions = {};
};
const MISSED = { lossType: 'missed', lmp: '2026-08-02', presentedOn: '2026-10-05', management: { method: 'medical', on: '2026-10-05', outcome: 'in_progress' } };
async function lossPatient(abortion = MISSED, fields = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'abortion', fullName: 'Loss Set Sample', assignedDoctor: people.drA._id.toString(), medical: { allergies: 'None known', bloodGroup: 'B+' }, ...fields }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const saved = await (await as('drA')).patch(`/api/patients/${res.body.patient.id}`).send({ abortion });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return saved.body.patient;
}
const SETS = '/api/prescription-sets';
async function setByKey(key, who = 'drA') {
  const res = await (await as(who)).get(SETS);
  expect(res.status).toBe(200);
  return res.body.sets.find((s) => s.key === key);
}
const itemBody = ({ id: _id, ...it }) => it;
const lab = (path) => `/api/lab/orders/${path}`;

describe('the sets in a hospital', () => {
  it('every hospital gets them as drafts, offered for pregnancy-loss care; doctors and RMOs read them, others cannot', async () => {
    const res = await (await as('rmo')).get(SETS);
    expect(res.status).toBe(200);
    const loss = res.body.sets.filter((s) => LOSS_SET_KEYS.includes(s.key));
    expect(loss.map((s) => s.key)).toEqual(LOSS_SET_KEYS);
    for (const s of loss) expect(s, s.key).toMatchObject({ origin: 'built_in', status: 'draft', version: 1, isActive: true, careTypes: ['abortion'] });
    const missed = loss.find((s) => s.key === 'loss_missed_medical');
    expect(missed.items[0]).toMatchObject({ drug: 'Misoprostol', strength: '200 mcg', dose: '4', route: 'vaginal', frequencyText: 'One dose; a second after 3 hours only if told' });
    for (const who of ['nurse', 'reception', 'lab', 'admin']) expect((await (await as(who)).get(SETS)).status, who).toBe(403);
    expect((await (await as('outsider')).get(`${SETS}/${missed.id}`)).status).toBe(404);
    // The other hospital has its own copy, never this one
    const theirs = await PrescriptionSet.findOne({ tenantId: other._id, key: 'loss_missed_medical' }).lean();
    expect(String(theirs._id)).not.toBe(missed.id);
  });

  it('a hospital whose sets were approved or edited before gets the new ones as drafts – its own are left exactly as they were', async () => {
    await ensurePrescriptionSets(hospital._id);
    // As a hospital looked before this change: no pregnancy-loss sets; one set approved, one edited by a doctor
    await PrescriptionSet.deleteMany({ tenantId: hospital._id, key: { $in: LOSS_SET_KEYS } });
    await PrescriptionSet.updateOne({ tenantId: hospital._id, key: 'anc_anaemia' }, { $set: { status: 'approved', approvedByName: 'Sample drA', approvedVersion: 1 } });
    await PrescriptionSet.updateOne({ tenantId: hospital._id, key: 'gyn_pcos' }, { $set: { name: 'Our PCOS set', version: 2, builtInVersion: null } });
    const before = await PrescriptionSet.find({ tenantId: hospital._id }).sort({ key: 1 }).lean();
    const sets = (await (await as('drA')).get(SETS)).body.sets;
    expect(sets.filter((s) => LOSS_SET_KEYS.includes(s.key)).map((s) => s.status)).toEqual(['draft', 'draft', 'draft', 'draft']);
    const after = await PrescriptionSet.find({ tenantId: hospital._id, key: { $nin: LOSS_SET_KEYS } }).sort({ key: 1 }).lean();
    expect(after).toEqual(before);
    expect(sets.find((s) => s.key === 'anc_anaemia').status).toBe('approved');
    expect(sets.find((s) => s.key === 'gyn_pcos').name).toBe('Our PCOS set');
    expect(await AuditLog.countDocuments({ action: 'PRESCRIPTION_SET_UPDATED' })).toBe(0);
  });

  it('a doctor copies and approves a pregnancy-loss set like any other; an RMO cannot; the audit has ids and the set name only', async () => {
    const s = await setByKey('loss_incomplete_medical');
    expect((await (await as('rmo')).post(`${SETS}/${s.id}/approve`).send({ confirm: true, version: s.version })).status).toBe(403);
    expect((await (await as('outsider')).post(`${SETS}/${s.id}/approve`).send({ confirm: true, version: s.version })).status).toBe(404);
    const approved = await (await as('drA')).post(`${SETS}/${s.id}/approve`).send({ confirm: true, version: s.version });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.set).toMatchObject({ status: 'approved', approvedByName: 'Sample drA', approvedVersion: 1 });
    const entry = await AuditLog.findOne({ action: 'PRESCRIPTION_SET_APPROVED' }).lean();
    expect(entry.details).toEqual({ setId: s.id, name: s.name, version: 1 });

    const copy = await (await as('drB')).post(SETS).send({ copyFrom: (await setByKey('loss_missed_medical')).id });
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body.set).toMatchObject({ origin: 'hospital', status: 'draft', careTypes: ['abortion'], name: 'Copy of Missed miscarriage (diagnosed) – medical management with misoprostol' });
    expect(copy.body.set.about.startsWith(DIAGNOSED_ONLY)).toBe(true);
    // Saved again unchanged by a doctor: every text passes the checks a doctor's own set has
    const full = (await (await as('drA')).get(`${SETS}/${copy.body.set.id}`)).body.set;
    const saved = await (await as('drA')).put(`${SETS}/${full.id}`).send({ version: full.version, name: full.name, about: full.about, careTypes: full.careTypes, items: full.items.map(itemBody), notes: full.notes, investigations: full.investigations, advice: full.advice });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  });

  it('on a pregnancy-loss visit the set is added and saved as the website does: the medicines, the instructions, the tests and the advice', async () => {
    const p = await lossPatient();
    const s = await setByKey('loss_missed_medical', 'rmo');
    const created = await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const v = created.body.visit;
    const rx = await (await as('drA')).put(`/api/patients/${p.id}/visits/${v.id}/prescription`).send({ rev: 0, items: s.items.map(itemBody), notes: s.notes });
    expect(rx.status, JSON.stringify(rx.body)).toBe(200);
    const details = await (await as('drA')).patch(`/api/patients/${p.id}/visits/${v.id}`).send({ details: { rev: 0, investigations: s.investigations, advice: s.advice } });
    expect(details.status, JSON.stringify(details.body)).toBe(200);
    const visit = (await (await as('drA')).get(`/api/patients/${p.id}/visits/${v.id}`)).body.visit;
    expect(visit.prescription.items.map((it) => [it.drug, it.dose, it.route])).toEqual([['Misoprostol', '4', 'vaginal'], ['Ibuprofen', '1', ''], ['Paracetamol', '2', '']]);
    expect(visit.details.advice).toBe(s.advice);
  });
});

describe('the work-up package and the new tests in use', () => {
  it('every hospital gets the package as a draft (nurses read it; reception does not; another hospital gets 404); an earlier hospital gets it too', async () => {
    const list = (await (await as('nurse')).get('/api/lab-packages')).body.packages;
    const pkg = list.find((x) => x.key === RECURRENT);
    expect(pkg).toMatchObject({ origin: 'built_in', who: 'adult', status: 'draft', version: 1, tests: ['lupusAnticoagulant', 'acl', 'b2gpi', 'tsh', 'antiTpo', 'hba1c'] });
    expect(pkg.about).toMatch(/a scan, not a lab test/);
    expect((await (await as('reception')).get('/api/lab-packages')).status).toBe(403);
    expect((await (await as('outsider')).get(`/api/lab-packages/${pkg.id}`)).status).toBe(404);
    // A hospital from before this change: an approved package of its own stays approved, the new one arrives as a draft
    await LabPackage.deleteOne({ tenantId: hospital._id, key: RECURRENT });
    await LabPackage.updateOne({ tenantId: hospital._id, key: 'anc_pkg_booking' }, { $set: { status: 'approved', approvedVersion: 1 } });
    const again = (await (await as('drA')).get('/api/lab-packages')).body.packages;
    expect(again.find((x) => x.key === RECURRENT)).toMatchObject({ status: 'draft', version: 1 });
    expect(again.find((x) => x.key === 'anc_pkg_booking')).toMatchObject({ status: 'approved', version: 1 });
    expect(await AuditLog.countDocuments({ action: 'LAB_PACKAGE_UPDATED' })).toBe(0);
  });

  it('a doctor orders it for a pregnancy-loss patient; the lab enters the results; a positive antibody needs the doctor’s comment; each test is on her bill', async () => {
    const p = await lossPatient({ lossType: 'recurrent', presentedOn: '2026-10-05', management: { method: 'workup' } });
    const tests = ['lupusAnticoagulant', 'acl', 'b2gpi', 'tsh', 'antiTpo', 'hba1c'].map((key) => ({ key }));
    expect((await (await as('nurse')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests, packages: [RECURRENT] })).status).toBe(403);
    const ordered = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests, packages: [RECURRENT] });
    expect(ordered.status, JSON.stringify(ordered.body)).toBe(201);
    const o = ordered.body.order;
    expect(o.packages).toEqual([{ key: RECURRENT, name: 'Recurrent pregnancy loss work-up', version: 1, approved: false }]);
    expect(o.tests.map((t) => t.name)).toEqual([
      'Lupus anticoagulant (LA)',
      'Anticardiolipin antibodies (IgG and IgM)',
      'Anti-beta-2-glycoprotein I antibodies (IgG and IgM)',
      'TSH (thyroid)',
      'Anti-TPO antibodies (thyroid)',
      'HbA1c',
    ]);
    const created = await AuditLog.findOne({ action: 'LAB_ORDER_CREATED' }).lean();
    expect(created.details).toEqual({ patientId: p.id, orderId: o.id, mrn: p.mrn, tests: 6 });

    const results = [
      { key: 'lupusAnticoagulant', values: [{ key: 'la', value: 'Positive' }] },
      { key: 'acl', values: [{ key: 'aclIgg', value: '62' }, { key: 'aclIgm', value: '8.5' }] },
      { key: 'b2gpi', values: [{ key: 'b2gpiIgg', value: '4' }, { key: 'b2gpiIgm', value: '3' }] },
      { key: 'tsh', values: [{ key: 'tsh', value: '2.1' }] },
      { key: 'antiTpo', values: [{ key: 'antiTpo', value: '12' }] },
      { key: 'hba1c', values: [{ key: 'hba1c', value: '5.2' }] },
    ];
    const reported = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: results, report: true });
    expect(reported.status, JSON.stringify(reported.body)).toBe(200);
    expect(reported.body.order.abnormal).toBe(true);
    // Lab staff get the tests, never the package's name (it says why she is tested); her doctor and nurses get it
    expect(reported.body.order.packages).toEqual([]);
    expect((await (await as('lab')).get(lab(o.id))).body.order.packages).toEqual([]);
    const done = (await (await as('lab')).get('/api/lab/worklist?list=done')).body;
    expect(done.orders.map((x) => x.id)).toContain(o.id);
    expect(JSON.stringify(done)).not.toMatch(/Recurrent pregnancy loss/);
    expect((await (await as('nurse')).get(lab(o.id))).body.order.packages.map((x) => x.name)).toEqual(['Recurrent pregnancy loss work-up']);
    expect(reported.body.order.tests[0].values[0]).toMatchObject({ key: 'la', value: 'Positive', flag: 'abnormal' });
    expect(reported.body.order.tests[1].values[0]).toMatchObject({ key: 'aclIgg', value: '62', flag: '' }); // the lab flags it from its own report
    const noComment = await (await as('drA')).post(lab(`${o.id}/review`)).send({ rev: reported.body.order.rev });
    expect(noComment.body.error.fields).toHaveProperty('comment');
    const reviewed = await (await as('drA')).post(lab(`${o.id}/review`)).send({ rev: reported.body.order.rev, comment: 'Repeat the antibodies after 12 weeks' });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    // The work-up item of her care plan is ticked by the doctor (it also needs the scan of the uterus)
    expect(reviewed.body.planChanged).toBe(false);

    // Each test is a line of her bill, from the price list (₹0 until the admin sets a price)
    const [first] = (await (await as('reception')).get(`/api/billing/patient/${p.id}`)).body.bills;
    const bill = (await (await as('reception')).get(`/api/billing/bills/${first.id}`)).body.bill;
    expect(bill.lines.map((l) => l.name)).toEqual(o.tests.map((t) => t.name));
  });

  it('an earlier hospital’s price list gets the new tests at ₹0 by itself; prices it set are kept', async () => {
    await ensurePriceList(hospital._id);
    await PriceItem.deleteMany({ tenantId: hospital._id, key: { $in: NEW_TESTS.map((k) => `lab:${k}`) } });
    await PriceItem.updateOne({ tenantId: hospital._id, key: 'lab:tsh' }, { $set: { pricePaise: 35000 } });
    await ensurePriceList(hospital._id);
    const items = await PriceItem.find({ tenantId: hospital._id, key: { $in: [...NEW_TESTS, 'tsh'].map((k) => `lab:${k}`) } }).lean();
    expect(Object.fromEntries(items.map((i) => [i.key, i.pricePaise]))).toEqual({ 'lab:antiTpo': 0, 'lab:lupusAnticoagulant': 0, 'lab:acl': 0, 'lab:b2gpi': 0, 'lab:bileAcids': 0, 'lab:tsh': 35000 });
  });

  it('serum bile acids for an antenatal patient: 19 µmol/L or more is flagged high', async () => {
    const res = await (await as('drA')).post('/api/patients').send(
      samplePatient({ careType: 'antenatal', fullName: 'Bile Sample', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-12-20' }, medical: { allergies: 'None known', bloodGroup: 'A+' } }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const o = (await (await as('drA')).post(`/api/patients/${res.body.patient.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'bileAcids' }] })).body.order;
    const reported = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: [{ key: 'bileAcids', values: [{ key: 'bileAcids', value: '24' }] }], report: true });
    expect(reported.status, JSON.stringify(reported.body)).toBe(200);
    expect(reported.body.order).toMatchObject({ abnormal: true, tests: [{ key: 'bileAcids', values: [{ key: 'bileAcids', value: '24', flag: 'high' }] }] });
  });
});

describe('beta hCG typed as the report prints it', () => {
  const MOLAR = { lossType: 'molar', lmp: '2026-07-27', presentedOn: '2026-10-05', moleKind: 'awaiting', management: { method: 'suction_evacuation', on: '2026-10-05', outcome: 'in_progress' } };
  const plan = async (p) => (await (await as('drA')).get(`/api/patients/${p.id}/care-plan`)).body.plan;

  it('"1,23,456" is stored as 123456 and not flagged; "85,000" is asked about; the reviewed result ticks the follow-up test that is due', async () => {
    const p = await lossPatient(MOLAR);
    at('2026-10-20T06:00:00Z'); // the 2-week test is due
    const o = (await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'bhcg' }] })).body.order;
    const send = async (value, rev) => (await as('lab')).put(lab(`${o.id}/results`)).send({ rev, tests: [{ key: 'bhcg', values: [{ key: 'bhcg', value }] }], report: true });
    const ambiguous = await send('85,000', o.rev);
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error.fields).toEqual({ 'tests.0.bhcg': AMBIGUOUS_NUMBER });
    const reported = await send('1,23,456', o.rev);
    expect(reported.status, JSON.stringify(reported.body)).toBe(200);
    expect(reported.body.order).toMatchObject({ abnormal: false, tests: [{ key: 'bhcg', values: [{ key: 'bhcg', value: '123456', flag: '' }] }] });
    // Not flagged, so no comment is needed: the doctor judges the value by the weeks
    const reviewed = await (await as('drA')).post(lab(`${o.id}/review`)).send({ rev: reported.body.order.rev });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(reviewed.body.planChanged).toBe(true);
    const items = (await plan(p)).items;
    expect(items.find((i) => i.key === 'loss_molar_hcg_2w')).toMatchObject({ status: 'done', done: { via: 'lab', result: 'Beta hCG 123456 mIU/mL' } });
    expect(items.find((i) => i.key === 'loss_molar_hcg_4w').status).toBe('upcoming');
  });

  it('the lab may still flag it, and a doctor or RMO entering a result from an outside report uses the same rule', async () => {
    const p = await lossPatient({ lossType: 'ectopic', lmp: '2026-08-24', presentedOn: '2026-10-05', ectopicSite: 'tube', management: { method: 'expectant' } });
    const o = (await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'bhcg' }] })).body.order;
    const byRmo = await (await as('rmo')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: [{ key: 'bhcg', values: [{ key: 'bhcg', value: '1,500.5', flag: 'high' }] }], report: true });
    expect(byRmo.status, JSON.stringify(byRmo.body)).toBe(200);
    expect(byRmo.body.order).toMatchObject({ abnormal: true, tests: [{ values: [{ value: '1500.5', flag: 'high' }] }] });
    // Nobody outside her hospital reaches the order
    expect((await (await as('outsider')).get(lab(o.id))).status).toBe(404);
  });
});
