// Smart features, step 2: the hospital's medicine safety list – pregnancy, breastfeeding and newborn entries and the
// usual maximum doses (the dose check without AI). Fake data only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { BUILT_IN_MED_SAFETY, BUILT_IN_MED_SAFETY_VERSION, BUILT_IN_SINCE, DOSE_UNITS, MAX_MED_SAFETY_ENTRIES, MED_SAFETY_KINDS } from '../src/medsafety/medicineSafety.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { MedicineSafetyList } from '../src/models/MedicineSafetyList.js';
import { DOSE_UNITS as CLIENT_DOSE_UNITS } from '../../client/src/pages/medsafety/doseCheck.js';
import { KIND_LABELS, medicineWarnings } from '../../client/src/pages/medsafety/medSafety.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  app = createApp();
  hospital = await createTenant('Medicine Safety Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries({ drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' })) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));

describe('the built-in draft list', () => {
  it('finds the common problem medicines as doctors write them', () => {
    const check = (drug, weeks) => medicineWarnings({ rows: [{ drug }], list: BUILT_IN_MED_SAFETY, weeks, pregnant: true }).map((w) => `${w.level}:${w.key}`);
    expect(check('Tab. Telma 40', 12)).toEqual(['avoid:arbs']);
    expect(check('Tab Warfarin 5 mg', 12)).toEqual(['avoid:warfarin']);
    expect(check('Tab. Combiflam', 24)).toEqual(['avoid:nsaids_late']);
    expect(check('Tab. Combiflam', 12)).toEqual(['caution:nsaids_early']);
    expect(check('Tab. Carbimazole 10', 10)).toEqual(['caution:antithyroid_t1']);
    expect(check('Tab. Carbimazole 10', 20)).toEqual([]);
    expect(check('Tab. Nitrofurantoin 100', 30)).toEqual([]);
    expect(check('Tab. Nitrofurantoin 100', 37)).toEqual(['caution:nitrofurantoin_term']);
    // The medicines of normal antenatal care give no warning on their own
    for (const ok of ['Tab. Folic acid 5 mg', 'Tab. Ferrous ascorbate 100', 'Tab. Calcium 500 + Vit D3', 'Tab. Ecosprin 75', 'Tab. Paracetamol 500', 'Inj. Td 0.5 ml', 'Tab. Labetalol 100', 'Tab. Nifedipine 10', 'Tab. Methyldopa 250', 'Tab. Doxinate']) {
      expect(check(ok, 24), ok).toEqual([]);
    }
    // Iron and calcium on two lines: space them out
    const both = medicineWarnings({ rows: [{ drug: 'Tab. Ferrous ascorbate 100' }, { drug: 'Tab. Shelcal 500' }], list: BUILT_IN_MED_SAFETY, weeks: 24, pregnant: true });
    expect(both.map((w) => w.key)).toEqual(['iron_calcium']);
  });
});

describe('/api/medicine-safety', () => {
  it('starts as the built-in draft; nurses read it, reception cannot', async () => {
    const res = await (await as('nurse')).get('/api/medicine-safety');
    expect(res.status).toBe(200);
    expect(res.body.list).toMatchObject({ status: 'draft', version: 1, canEdit: false });
    expect(res.body.list.entries.length).toBe(BUILT_IN_MED_SAFETY.length);
    expect((await (await as('reception')).get('/api/medicine-safety')).status).toBe(403);
  });

  it('a doctor saves the built-in list back unchanged, then another approves it', async () => {
    const saved = await (await as('drA')).put('/api/medicine-safety').send({ version: 1, entries: BUILT_IN_MED_SAFETY });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.list).toMatchObject({ version: 2, status: 'draft', builtInVersion: null });
    expect((await (await as('drB')).post('/api/medicine-safety/approve').send({ confirm: true, version: 1 })).status).toBe(409);
    const approved = await (await as('drB')).post('/api/medicine-safety/approve').send({ confirm: true, version: 2 });
    expect(approved.body.list).toMatchObject({ status: 'approved', approvedByName: 'Sample drB' });
    const actions = (await AuditLog.find({ tenantId: hospital._id, action: /^MEDICINE_SAFETY/ }).lean()).map((e) => e.action).sort();
    expect(actions).toEqual(['MEDICINE_SAFETY_APPROVED', 'MEDICINE_SAFETY_UPDATED']);
  });

  it('keeps names in lower case and checks each entry', async () => {
    const entry = { key: 'new_one', kind: 'medicine', label: 'New', terms: ['  NewDrug '], level: 'caution', message: '', source: '' };
    const ok = await (await as('drA')).put('/api/medicine-safety').send({ version: 1, entries: [entry] });
    expect(ok.body.list.entries[0].terms).toEqual(['newdrug']);
    const bad = await (await as('drA')).put('/api/medicine-safety').send({ version: 2, entries: [{ ...entry, kind: 'combination', terms: [], level: 'never' }] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['entries.0.terms', 'entries.0.level']));
    expect((await (await as('nurse')).put('/api/medicine-safety').send({ version: 2, entries: [entry] })).status).toBe(403);
  });
});

// ---------- Dose limits, breastfeeding and newborn entries (4 Oct 2026) ----------

const line = (drug, strength, dose, frequency, form = 'tab') => ({ drug, form, strength, dose, frequency });
const found = (ws) => ws.map((w) => `${w.level}:${w.key}`);

describe('the built-in draft list: its shape', () => {
  it('has one code per entry, a source for each, and the server and the website agree on the types and units', () => {
    expect(new Set(BUILT_IN_MED_SAFETY.map((e) => e.key)).size).toBe(BUILT_IN_MED_SAFETY.length);
    expect(BUILT_IN_MED_SAFETY.length).toBeLessThanOrEqual(MAX_MED_SAFETY_ENTRIES);
    expect(Object.keys(KIND_LABELS)).toEqual(MED_SAFETY_KINDS);
    expect(CLIENT_DOSE_UNITS).toEqual(DOSE_UNITS);
    for (const e of BUILT_IN_MED_SAFETY) {
      expect(e.source.length, e.key).toBeGreaterThan(3);
      expect(MED_SAFETY_KINDS, e.key).toContain(e.kind);
      if (e.kind === 'dose') {
        expect(DOSE_UNITS, e.key).toContain(e.doseUnit);
        expect(e.maxSingle ?? e.maxDaily, e.key).toBeGreaterThan(0);
        if (e.maxSingle != null && e.maxDaily != null) expect(e.maxDaily, e.key).toBeGreaterThanOrEqual(e.maxSingle);
        expect(e.level, e.key).toBe('caution');
      } else {
        expect(e.message.length, e.key).toBeGreaterThan(10);
        expect([e.doseUnit, e.maxSingle, e.maxDaily, e.perKg], e.key).toEqual(['', null, null, false]);
      }
      // An age in days: a newborn entry, or a baby's per-kg dose limit (the lower doses of the first week of life)
      if (e.kind !== 'newborn' && !(e.kind === 'dose' && e.perKg)) expect(e.maxAgeDays, e.key).toBeNull();
      if (e.kind !== 'medicine') expect([e.fromWeek, e.toWeek], e.key).toEqual([null, null]);
    }
    // Every kind is there; the new kinds are the ones added in version 3
    const kinds = Object.fromEntries(MED_SAFETY_KINDS.map((k) => [k, BUILT_IN_MED_SAFETY.filter((e) => e.kind === k).length]));
    for (const k of MED_SAFETY_KINDS) expect(kinds[k], k).toBeGreaterThan(3);
    expect(BUILT_IN_MED_SAFETY.filter((e) => BUILT_IN_SINCE[e.key] === 3).every((e) => ['breastfeeding', 'newborn', 'dose'].includes(e.kind))).toBe(true);
    expect(BUILT_IN_MED_SAFETY.filter((e) => !BUILT_IN_SINCE[e.key]).every((e) => ['medicine', 'combination'].includes(e.kind))).toBe(true);
  });
});

describe('the dose check without AI (built-in limits)', () => {
  const adult = (...rows) => medicineWarnings({ rows, list: BUILT_IN_MED_SAFETY });

  it('warns above the usual maximum of a dose or of a day, and not at the maximum itself', () => {
    expect(adult(line('Paracetamol', '500 mg', '2', '1-1-1-1'))).toEqual([]); // 1 g a dose, 4 g a day: the maximum, not above it
    const over = adult(line('Paracetamol', '650 mg', '2', '1-1-1-1'));
    expect(found(over)).toEqual(['dose:dose:dose_paracetamol']);
    expect(over[0].title).toBe('Paracetamol: above the usual maximum of 1 g a dose and 4 g a day');
    expect(over[0].message).toMatch(/^As written: 1\.3 g a dose, 5\.2 g a day\. Usual maximum: 1 g a dose, 4 g a day\./);
    expect(adult(line('Tab. Voveran', '50 mg', '1', '1-1-1-1'))[0].title).toBe('Diclofenac: above the usual maximum of 150 mg a day');
    expect(adult(line('Metformin', '1 g', '1', '1-1-1'))[0].title).toBe('Metformin: above the usual maximum of 2 g a day');
    expect(adult(line('Inj. Carboprost', '250 mcg', '2', 'stat', 'inj'))[0].title).toBe('Carboprost: above the usual maximum of 250 mcg a dose');
    expect(adult(line('Methergine', '0.125 mg', '1', '1-1-1'))).toEqual([]); // 125 mcg a dose, 375 mcg a day
    expect(adult(line('Tranexamic acid', '500 mg', '2', '1-1-1'))).toEqual([]);
    expect(adult(line('Labetalol', '200 mg', '1', '1-1-1'))).toEqual([]);
  });

  it('works with liquids, a dose typed as an amount, and a strength written in the name', () => {
    expect(found(adult(line('Syp. Calpol', '250 mg/5 ml', '25 ml', '1-1-1', 'syrup')))).toEqual(['dose:dose:dose_paracetamol']); // 1.25 g a dose
    expect(found(adult(line('Paracetamol', '', '1500 mg', 'sos')))).toEqual(['dose:dose:dose_paracetamol']);
    expect(adult(line('Paracetamol', '', '1500 mg', 'sos'))[0].message).toMatch(/at least 1\.5 g a day/);
    expect(found(adult(line('Dolo 650 mg', '', '2', '1-1-1')))).toEqual(['dose:dose:dose_paracetamol']);
    expect(adult(line('Inj. Betnesol', '4 mg/ml', '3 ml', 'stat', 'inj'))).toEqual([]); // 12 mg
    expect(found(adult(line('Inj. Betnesol', '4 mg/ml', '4 ml', 'stat', 'inj')))).toEqual(['dose:dose:dose_betamethasone']);
  });

  it('adds up the same medicine written on two lines', () => {
    const two = adult(line('Dolo 650', '650 mg', '1', '1-1-1'), line('Crocin', '650 mg', '1', '1-1-1-1'));
    expect(found(two)).toEqual(['dose:dose:dose_paracetamol']);
    expect(two[0].medicines).toEqual(['Dolo 650', 'Crocin']);
    expect(two[0].title).toBe('Paracetamol: above the usual maximum of 4 g a day');
  });

  it('stays silent when it cannot work the dose out', () => {
    for (const row of [
      line('Paracetamol', '500', '4', '1-1-1-1'), // no unit
      line('Paracetamol', '500 mg', '2-4', '1-1-1-1'), // a range
      line('Paracetamol', '500 mg', 'as needed', '1-1-1-1'), // words
      line('Ibuprofen + Paracetamol', '400 mg + 325 mg', '4', '1-1-1-1'), // combined
      line('Tramadol and paracetamol', '325 mg', '4', '1-1-1-1'), // combined: whose strength?
      line('Paracetamol', '500 mg', '4', '1-1-1-1', 'cream'), // not taken by the piece
      line('Paracetamol drops', '100 mg/ml', '30 drops', '1-1-1-1', 'drops'), // drops
      line('Paracetamol', '10 ml', '40', '1-1-1-1', 'syrup'), // a volume, not a strength
      line('Somethingelse', '5000 mg', '4', '1-1-1-1'), // not on the list
    ]) {
      expect(adult(row), JSON.stringify(row)).toEqual([]);
    }
  });

  it('never asks for a reason, and comes after the other warnings', () => {
    const ws = medicineWarnings({ rows: [line('Tab. Brufen', '400 mg', '2', '1-1-1-1'), line('Tab. Telma', '40 mg', '1', '1-0-0')], list: BUILT_IN_MED_SAFETY, weeks: 24, pregnant: true });
    expect(found(ws)).toEqual(['avoid:arbs', 'avoid:nsaids_late', 'dose:dose:dose_ibuprofen']);
  });

  it('babies: per kg, only with a recorded weight; the adult limits never apply to a baby', () => {
    const baby = (weight, ...rows) => medicineWarnings({ rows, list: BUILT_IN_MED_SAFETY, baby: { ageDays: 40, weight } });
    const syrup = line('Syp. Paracetamol', '120 mg/5 ml', '2.5 ml', '1-1-1-1', 'syrup'); // 60 mg a dose
    expect(baby({ kg: 4, from: 'visit' }, syrup)).toEqual([]); // 15 mg/kg a dose, 60 mg/kg a day
    const over = baby({ kg: 3, from: 'visit' }, syrup); // 20 mg/kg a dose, 80 mg/kg a day
    expect(found(over)).toEqual(['dose:dose:dosekg_paracetamol']);
    expect(over[0].title).toBe('Paracetamol (baby): above the usual maximum of 60 mg/kg a day');
    expect(over[0].message).toMatch(/As written: 20 mg\/kg a dose, 80 mg\/kg a day for a weight of 3 kg \(recorded at this visit\)\. Usual maximum: 20 mg\/kg a dose, 60 mg\/kg a day\./);
    expect(baby({ kg: 3, from: 'birth' }, syrup)[0].message).toMatch(/the birth weight – record today’s weight/);
    expect(baby(null, syrup)).toEqual([]); // no weight: nothing to check against
    expect(baby(null, line('Paracetamol', '500 mg', '4', '1-1-1-1'))).toEqual([]); // 2 g a dose: no adult limit for a baby
    expect(found(baby({ kg: 3, from: 'visit' }, line('Inj. Gentamicin', '', '30 mg', '1-0-0', 'inj')))).toEqual(['dose:dose:dosekg_gentamicin']); // 10 mg/kg
    // …and an adult never gets a per-kg entry
    expect(adult(line('Inj. Gentamicin', '', '240 mg', '1-0-0', 'inj'))).toEqual([]);
  });

  it('babies in the first week of life are checked against the lower first-week doses', () => {
    const baby = (ageDays, ...rows) => found(medicineWarnings({ rows, list: BUILT_IN_MED_SAFETY, baby: { ageDays, weight: { kg: 3, from: 'visit' } } }));
    // Gentamicin 22 mg once a day for 3 kg = 7.3 mg/kg: about 1.5 times the first-week dose, fine after the first week
    const genta = line('Inj. Gentamicin', '', '22 mg', '1-0-0', 'inj');
    expect(baby(3, genta)).toEqual(['dose:dose:dosekg_gentamicin_week1']);
    expect(baby(7, genta)).toEqual(['dose:dose:dosekg_gentamicin_week1']);
    expect(baby(8, genta)).toEqual([]);
    expect(baby(3, line('Inj. Gentamicin', '', '15 mg', '1-0-0', 'inj'))).toEqual([]); // 5 mg/kg
    // Far above every limit: one warning, from the entry for this age
    expect(baby(3, line('Inj. Gentamicin', '', '40 mg', '1-0-0', 'inj'))).toEqual(['dose:dose:dosekg_gentamicin_week1']);
    expect(baby(20, line('Inj. Gentamicin', '', '40 mg', '1-0-0', 'inj'))).toEqual(['dose:dose:dosekg_gentamicin']);
    // Ampicillin and cefotaxime 50 mg/kg three times a day = 150 mg/kg a day: above the first week's 100, fine later
    for (const drug of ['Inj. Ampicillin', 'Inj. Cefotaxime']) {
      const key = `dosekg_${drug.slice(5).toLowerCase()}`;
      expect(baby(3, line(drug, '', '150 mg', '1-1-1', 'inj')), drug).toEqual([`dose:dose:${key}_week1`]);
      expect(baby(3, line(drug, '', '150 mg', '1-0-1', 'inj')), drug).toEqual([]); // every 12 hours
      expect(baby(15, line(drug, '', '150 mg', '1-1-1', 'inj')), drug).toEqual([]);
      expect(baby(15, line(drug, '', '150 mg', '1-1-1-1', 'inj')), drug).toEqual([]); // 200 mg/kg a day: the maximum itself
    }
    // Date of birth not recorded: the first-week limit is used, and the warning says to check the age
    const unsure = medicineWarnings({ rows: [genta], list: BUILT_IN_MED_SAFETY, baby: { ageDays: null, weight: { kg: 3, from: 'birth' } } });
    expect(unsure.map((w) => [w.key, w.unsureAge])).toEqual([['dose:dosekg_gentamicin_week1', true]]);
    // Each first-week entry sits beside a general one for the same names, with a lower or equal limit
    for (const e of BUILT_IN_MED_SAFETY.filter((x) => x.kind === 'dose' && x.maxAgeDays != null)) {
      const general = BUILT_IN_MED_SAFETY.find((x) => x.kind === 'dose' && x.perKg && x.maxAgeDays == null && x.terms.join() === e.terms.join());
      expect(general, e.key).toBeTruthy();
      expect(e.perKg, e.key).toBe(true);
      expect(e.maxAgeDays, e.key).toBe(7);
      expect(e.maxDaily, e.key).toBeLessThanOrEqual(general.maxDaily);
      expect(e.maxSingle, e.key).toBeLessThanOrEqual(general.maxSingle);
    }
  });

  it('phenobarbitone for a baby: the limit is the loading dose, so a maintenance line written like a loading dose is caught', () => {
    const baby = (...rows) => found(medicineWarnings({ rows, list: BUILT_IN_MED_SAFETY, baby: { ageDays: 10, weight: { kg: 3, from: 'visit' } } }));
    expect(baby(line('Inj. Phenobarbitone', '', '60 mg', 'stat', 'inj'))).toEqual([]); // 20 mg/kg once: the loading dose
    expect(baby(line('Inj. Phenobarbitone', '', '60 mg', '1-0-1', 'inj'))).toEqual(['dose:dose:dosekg_phenobarbitone']); // 40 mg/kg a day
    expect(baby(line('Syp. Gardenal', '20 mg/5 ml', '1.25 ml', '1-0-1', 'syrup'))).toEqual([]); // 3.3 mg/kg a day
  });

  it('ibuprofen: the BNF’s largest single dose is 600 mg', () => {
    expect(found(adult(line('Tab. Brufen', '400 mg', '2', '1-0-1')))).toEqual(['dose:dose:dose_ibuprofen']); // 800 mg a dose
    expect(adult(line('Tab. Brufen', '600 mg', '1', '1-1-1-1'))).toEqual([]); // 600 mg a dose, 2.4 g a day
  });
});

describe('breastfeeding and newborn entries (built-in)', () => {
  const rows = (...drugs) => drugs.map((drug) => ({ drug }));

  it('breastfeeding: for a postnatal patient who is breastfeeding, or – worded "if" – when it is not recorded', () => {
    const yes = medicineWarnings({ rows: rows('Tab. Codeine 30', 'Tab. Cabgolin 0.5'), list: BUILT_IN_MED_SAFETY, breastfeeding: 'yes' });
    expect(found(yes)).toEqual(['avoid:bf_codeine', 'avoid:bf_lactation_suppressants']);
    expect(yes[0]).toMatchObject({ title: 'Codeine – breastfeeding', unsureBreastfeeding: false });
    const unknown = medicineWarnings({ rows: rows('Tab. Codeine 30'), list: BUILT_IN_MED_SAFETY, breastfeeding: 'unknown' });
    expect(unknown[0]).toMatchObject({ level: 'avoid', title: 'Codeine – if she is breastfeeding', unsureBreastfeeding: true });
    expect(medicineWarnings({ rows: rows('Tab. Codeine 30'), list: BUILT_IN_MED_SAFETY, breastfeeding: null })).toEqual([]);
    // The usual medicines after delivery give no warning
    for (const ok of ['Tab. Paracetamol 500', 'Tab. Ibuprofen 400', 'Tab. Ferrous ascorbate 100', 'Tab. Calcium 500', 'Cap. Amoxicillin 500', 'Tab. Labetalol 100', 'Tab. Nifedipine 10', 'Tab. Enalapril 5', 'Tab. Cefixime 200']) {
      expect(medicineWarnings({ rows: rows(ok), list: BUILT_IN_MED_SAFETY, breastfeeding: 'yes' }), ok).toEqual([]);
    }
    // Pregnancy entries are not for her: an ARB is not flagged after delivery
    expect(medicineWarnings({ rows: rows('Tab. Telma 40'), list: BUILT_IN_MED_SAFETY, breastfeeding: 'yes' })).toEqual([]);
  });

  it('newborn: by the baby’s age on the day of the visit', () => {
    const at = (ageDays, drug) => found(medicineWarnings({ rows: rows(drug), list: BUILT_IN_MED_SAFETY, baby: { ageDays, weight: null } }));
    expect(at(5, 'Inj. Ceftriaxone 250 mg')).toEqual(['caution:nb_ceftriaxone']);
    expect(at(28, 'Inj. Ceftriaxone 250 mg')).toEqual(['caution:nb_ceftriaxone']);
    expect(at(29, 'Inj. Ceftriaxone 250 mg')).toEqual([]);
    expect(at(30, 'Syp. Septran')).toEqual(['avoid:nb_sulfonamides']);
    expect(at(50, 'Syp. Septran')).toEqual([]);
    expect(at(200, 'Tab. Aspirin 75')).toEqual(['avoid:nb_aspirin']); // any age in newborn care
    const unsure = medicineWarnings({ rows: rows('Inj. Ceftriaxone 250 mg'), list: BUILT_IN_MED_SAFETY, baby: { ageDays: null, weight: null } });
    expect(unsure[0]).toMatchObject({ key: 'nb_ceftriaxone', unsureAge: true });
    for (const ok of ['Paracetamol drops', 'Vitamin D3 drops', 'Syp. Amoxicillin', 'Inj. Vitamin K1', 'Inj. Cefotaxime', 'ORS', 'Zinc syrup']) expect(at(5, ok), ok).toEqual([]);
  });

  it('each group only for its own patients', () => {
    const drugs = rows('Tab. Codeine 30', 'Inj. Ceftriaxone 1 g', 'Tab. Telma 40');
    expect(found(medicineWarnings({ rows: drugs, list: BUILT_IN_MED_SAFETY, weeks: 30, pregnant: true }))).toEqual(['avoid:arbs', 'caution:opioids']);
    expect(found(medicineWarnings({ rows: drugs, list: BUILT_IN_MED_SAFETY, breastfeeding: 'yes' }))).toEqual(['avoid:bf_codeine']);
    expect(found(medicineWarnings({ rows: drugs, list: BUILT_IN_MED_SAFETY, baby: { ageDays: 3, weight: null } }))).toEqual(['avoid:nb_opioids', 'caution:nb_ceftriaxone']);
    expect(medicineWarnings({ rows: drugs, list: BUILT_IN_MED_SAFETY })).toEqual([]); // a gynaecology patient
  });
});

describe('/api/medicine-safety: the new kinds of entry', () => {
  const dose = { key: 'dose_new', kind: 'dose', label: 'New medicine', terms: ['newdrug'], level: 'avoid', doseUnit: 'mg', maxSingle: 10, maxDaily: 30, perKg: false, fromWeek: 12, maxAgeDays: 20, message: '', source: 'Label' };

  it('a doctor saves a dose limit, a breastfeeding entry and a newborn entry; fields of other kinds are dropped', async () => {
    const entries = [
      dose,
      { key: 'bf_new', kind: 'breastfeeding', label: 'New', terms: ['newdrug'], level: 'avoid', fromWeek: 10, maxSingle: 5, doseUnit: 'mg', message: 'Avoid.', source: 'LactMed' },
      { key: 'nb_new', kind: 'newborn', label: 'New', terms: ['newdrug'], level: 'caution', maxAgeDays: '28', otherTerms: ['x-ray'], message: 'Careful.', source: 'BNF for Children' },
    ];
    const res = await (await as('drA')).put('/api/medicine-safety').send({ version: 1, entries });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [d, bf, nb] = res.body.list.entries;
    // A dose limit is always a caution (it never asks for a reason) and has no weeks or age
    expect(d).toMatchObject({ kind: 'dose', level: 'caution', doseUnit: 'mg', maxSingle: 10, maxDaily: 30, perKg: false, fromWeek: null, maxAgeDays: null });
    expect(bf).toMatchObject({ kind: 'breastfeeding', level: 'avoid', fromWeek: null, doseUnit: '', maxSingle: null });
    expect(nb).toMatchObject({ kind: 'newborn', level: 'caution', maxAgeDays: 28, otherTerms: [] });
    expect(res.body.list).toMatchObject({ status: 'draft', builtInVersion: null, version: 2 });
    // The website's check reads what the server stored
    expect(found(medicineWarnings({ rows: [line('Newdrug', '10 mg', '2', '1-1-1')], list: res.body.list.entries }))).toEqual(['dose:dose:dose_new']);
    expect((await (await as('nurse')).put('/api/medicine-safety').send({ version: 2, entries })).status).toBe(403);
    expect((await (await as('rmo')).put('/api/medicine-safety').send({ version: 2, entries })).status).toBe(403);
  });

  it('checks a dose limit: a unit, at least one maximum, and the day not below the dose', async () => {
    const save = async (changes) => (await as('drA')).put('/api/medicine-safety').send({ version: 1, entries: [{ ...dose, ...changes }] });
    expect((await save({ doseUnit: '' })).body.error.fields).toMatchObject({ 'entries.0.doseUnit': 'Choose the unit' });
    expect((await save({ doseUnit: 'spoons' })).status).toBe(400);
    expect((await save({ maxSingle: '', maxDaily: '' })).body.error.fields).toMatchObject({ 'entries.0.maxDaily': 'Enter the maximum for one dose, for a day, or both' });
    expect((await save({ maxSingle: 40, maxDaily: 30 })).body.error.fields).toMatchObject({ 'entries.0.maxDaily': 'The maximum for a day must not be below the maximum for one dose' });
    expect((await save({ maxSingle: -1 })).status).toBe(400);
    expect((await save({ maxSingle: 'ten' })).status).toBe(400);
    expect((await save({ perKg: 'yes' })).status).toBe(400);
    const age = await (await as('drA')).put('/api/medicine-safety').send({ version: 1, entries: [{ key: 'nb', kind: 'newborn', label: 'N', terms: ['newdrug'], level: 'avoid', maxAgeDays: 400 }] });
    expect(age.body.error.fields).toMatchObject({ 'entries.0.maxAgeDays': 'The age can be at most 365 days' });
    const ok = await save({ maxSingle: '', maxDaily: '7.5', perKg: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // A baby's per-kg limit keeps its age (the first days of life); an adult limit never has one (the test above)
    expect(ok.body.list.entries[0]).toMatchObject({ maxSingle: null, maxDaily: 7.5, perKg: true, maxAgeDays: 20 });
    const anyAge = await (await as('drA')).put('/api/medicine-safety').send({ version: 2, entries: [{ ...dose, perKg: true, maxAgeDays: '' }] });
    expect(anyAge.body.list.entries[0]).toMatchObject({ perKg: true, maxAgeDays: null });
    const tooOld = await (await as('drA')).put('/api/medicine-safety').send({ version: 3, entries: [{ ...dose, perKg: true, maxAgeDays: 400 }] });
    expect(tooOld.body.error.fields).toMatchObject({ 'entries.0.maxAgeDays': 'The age can be at most 365 days' });
  });

  it('a list as long as the limit allows can be saved; one entry more, or far too much data, is refused in plain words', async () => {
    // Ordinary entries with names, advice and a source – as the built-in ones (about 450 bytes each)
    const many = (n) =>
      Array.from({ length: n }, (_, i) => ({
        key: `own_${i}`,
        kind: 'breastfeeding',
        label: `Sample medicine ${i} and its group`,
        terms: ['samplegeneric', 'samplebrand', `samplename${i}`, 'anothername', 'onemorename'],
        level: 'caution',
        message: 'Passes into milk in small amounts. Use the lowest dose for the shortest time, and watch the baby for drowsiness and poor feeding. '.repeat(2).trim(),
        source: 'LactMed (US National Library of Medicine); BNF (breast-feeding)',
      }));
    const full = many(MAX_MED_SAFETY_ENTRIES);
    expect(Buffer.byteLength(JSON.stringify({ version: 1, entries: full }))).toBeGreaterThan(100 * 1024); // more than the general request limit
    const saved = await (await as('drA')).put('/api/medicine-safety').send({ version: 1, entries: full });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    expect(saved.body.list.entries).toHaveLength(MAX_MED_SAFETY_ENTRIES);
    const over = await (await as('drA')).put('/api/medicine-safety').send({ version: 2, entries: many(MAX_MED_SAFETY_ENTRIES + 1) });
    expect(over.status).toBe(400);
    expect(over.body.error.fields.entries).toBe(`At most ${MAX_MED_SAFETY_ENTRIES} entries`);
    // Far more than any list: refused before it is read, with a clear message (not "something went wrong")
    const huge = await (await as('drA')).put('/api/medicine-safety').send({ version: 2, entries: [], padding: 'x'.repeat(3 * 1024 * 1024) });
    expect(huge.status).toBe(413);
    expect(huge.body.error).toEqual({ message: 'This is too large to send in one go. Please make it smaller and try again.', code: 'TOO_LARGE' });
    // Other addresses keep the general limit, with the same plain answer
    const elsewhere = await (await as('drA')).post('/api/pharmacy-stock/check').send({ medicines: [{ drug: 'x'.repeat(150 * 1024) }] });
    expect(elsewhere.status).toBe(413);
    expect((await (await as('drA')).get('/api/medicine-safety')).body.list.entries).toHaveLength(MAX_MED_SAFETY_ENTRIES);
  });
});

describe('a new built-in version (dose limits, breastfeeding, newborn)', () => {
  const OLD = BUILT_IN_MED_SAFETY.filter((e) => !BUILT_IN_SINCE[e.key]); // the list as it was in version 2
  const NEW = BUILT_IN_MED_SAFETY.length - OLD.length;
  const filter = () => ({ tenantId: hospital._id, set: 'standard' });
  // The hospital's list as an older version of the app left it.
  const asBefore = async (status, extra = {}) => {
    await (await as('drA')).get('/api/medicine-safety');
    await MedicineSafetyList.collection.updateOne(filter(), { $set: { entries: OLD, builtInVersion: 2, status, ...extra }, $unset: { builtInSeenVersion: '' } });
  };

  it('a list no doctor approved or changed gets the new entries by itself', async () => {
    await asBefore('draft');
    const res = await (await as('drA')).get('/api/medicine-safety');
    expect(res.body.list).toMatchObject({ status: 'draft', builtInVersion: BUILT_IN_MED_SAFETY_VERSION, version: 2, newBuiltIn: 0 });
    expect(res.body.list.entries).toHaveLength(BUILT_IN_MED_SAFETY.length);
  });

  it('an approved list is never changed by itself: a doctor is offered the new entries and adds them as a draft', async () => {
    await asBefore('approved', { approvedByName: 'Sample drA', approvedAt: new Date() });
    const before = await (await as('drA')).get('/api/medicine-safety');
    expect(before.body.list).toMatchObject({ status: 'approved', builtInVersion: 2, version: 1, newBuiltIn: NEW });
    expect(before.body.list.entries).toHaveLength(OLD.length);
    // Old entries read with the new fields empty, and still warn as before
    expect(before.body.list.entries[0]).toMatchObject({ maxAgeDays: null, doseUnit: '', maxSingle: null, maxDaily: null, perKg: false });
    expect(found(medicineWarnings({ rows: [{ drug: 'Tab. Telma 40' }], list: before.body.list.entries, weeks: 12, pregnant: true }))).toEqual(['avoid:arbs']);
    // Only those who can add them are told
    expect((await (await as('nurse')).get('/api/medicine-safety')).body.list.newBuiltIn).toBe(0);
    expect((await (await as('rmo')).get('/api/medicine-safety')).body.list.newBuiltIn).toBe(0);

    for (const who of ['nurse', 'rmo']) expect((await (await as(who)).post('/api/medicine-safety/add-built-in').send({ version: 1 })).status, who).toBe(403);
    expect((await (await as('reception')).post('/api/medicine-safety/add-built-in').send({ version: 1 })).status).toBe(403);
    expect((await (await as('drA')).post('/api/medicine-safety/add-built-in').send({ version: 7 })).status).toBe(409);
    expect((await (await as('drA')).post('/api/medicine-safety/add-built-in').send({})).status).toBe(400);
    expect((await (await as('drA')).post('/api/medicine-safety/add-built-in').send({ version: 1, entries: [] })).status).toBe(400);
    expect((await MedicineSafetyList.findOne(filter()).lean()).entries).toHaveLength(OLD.length); // nothing changed yet

    const added = await (await as('drA')).post('/api/medicine-safety/add-built-in').send({ version: 1 });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.added).toBe(NEW);
    expect(added.body.list).toMatchObject({ status: 'draft', version: 2, builtInVersion: null, approvedByName: null, updatedByName: 'Sample drA', newBuiltIn: 0 });
    expect(added.body.list.entries.map((e) => e.key)).toEqual(BUILT_IN_MED_SAFETY.map((e) => e.key));
    const log = await AuditLog.find({ tenantId: hospital._id, action: 'MEDICINE_SAFETY_UPDATED' }).lean();
    expect(log.map((e) => e.details)).toEqual([{ version: 2, entries: BUILT_IN_MED_SAFETY.length, added: NEW }]);

    // Nothing more to add; another doctor approves the new draft as usual
    expect((await (await as('drA')).post('/api/medicine-safety/add-built-in').send({ version: 2 })).status).toBe(400);
    const approved = await (await as('drB')).post('/api/medicine-safety/approve').send({ confirm: true, version: 2 });
    expect(approved.body.list).toMatchObject({ status: 'approved', approvedByName: 'Sample drB', newBuiltIn: 0 });
  });

  it('a list a doctor changed keeps its own entries; entries the doctor removes afterwards are not offered again', async () => {
    await asBefore('draft', { builtInVersion: null, updatedByName: 'Sample drB' }); // changed by a doctor before this version
    const own = await (await as('drA')).get('/api/medicine-safety');
    expect(own.body.list.entries).toHaveLength(OLD.length);
    expect(own.body.list.newBuiltIn).toBe(NEW);
    const added = await (await as('drA')).post('/api/medicine-safety/add-built-in').send({ version: own.body.list.version });
    const fewer = added.body.list.entries.filter((e) => e.kind !== 'newborn');
    const saved = await (await as('drA')).put('/api/medicine-safety').send({ version: added.body.list.version, entries: fewer });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.list.newBuiltIn).toBe(0);
    expect((await (await as('drA')).get('/api/medicine-safety')).body.list.entries).toHaveLength(fewer.length);
  });

  it('a new hospital starts with the whole draft; one hospital’s list is never another’s', async () => {
    const other = await createTenant('Other Safety Hospital');
    people.otherDr = await createUser({ name: 'Sample otherDr' });
    await addMember(people.otherDr, other, 'doctor');
    await (await as('drA')).put('/api/medicine-safety').send({ version: 1, entries: [{ key: 'only', kind: 'breastfeeding', label: 'Only', terms: ['newdrug'], level: 'caution' }] });
    const theirs = await (await as('otherDr')).get('/api/medicine-safety');
    expect(theirs.body.list).toMatchObject({ status: 'draft', version: 1, builtInVersion: BUILT_IN_MED_SAFETY_VERSION, newBuiltIn: 0 });
    expect(theirs.body.list.entries).toHaveLength(BUILT_IN_MED_SAFETY.length);
    expect((await (await as('drA')).get('/api/medicine-safety')).body.list.entries).toHaveLength(1);
  });
});
