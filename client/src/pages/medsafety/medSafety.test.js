import { describe, expect, it } from 'vitest';
import { allergyNames, babyAgeText, babyOnVisit, breastfeedingOnVisit, entryAgeText, entryWeeksText, medicineWarnings, needsReason, notCovered, pregnancyOnVisit, termMatches } from './medSafety.js';

// A small list in the shape the server sends (the real one is the hospital's, from GET /medicine-safety).
const LIST = [
  { key: 'arbs', kind: 'medicine', label: 'Angiotensin receptor blockers', terms: ['losartan', 'telma'], otherTerms: [], level: 'avoid', fromWeek: null, toWeek: null, message: 'Stop.' },
  { key: 'nsaids_late', kind: 'medicine', label: 'NSAIDs from 20 weeks', terms: ['ibuprofen', 'brufen'], otherTerms: [], level: 'avoid', fromWeek: 20, toWeek: null, message: 'Use paracetamol.' },
  { key: 'nsaids_early', kind: 'medicine', label: 'NSAIDs before 20 weeks', terms: ['ibuprofen', 'brufen'], otherTerms: [], level: 'caution', fromWeek: null, toWeek: 19, message: 'Lowest dose.' },
  { key: 'iron_calcium', kind: 'combination', label: 'Iron and calcium together', terms: ['iron', 'ferrous'], otherTerms: ['calcium', 'shelcal'], level: 'caution', fromWeek: null, toWeek: null, message: '2 hours apart.' },
];
const rows = (...drugs) => drugs.map((drug) => ({ drug }));
const keys = (ws) => ws.map((w) => `${w.level}:${w.key.split(':')[0]}`);

describe('termMatches', () => {
  it('matches at the start of a word, any case', () => {
    expect(termMatches('Tab. Losartan 50 mg', 'losartan')).toBe(true);
    expect(termMatches('TELMA-H', 'telma')).toBe(true);
    expect(termMatches('Metelmaxin', 'telma')).toBe(false);
  });
  it('short names and names of several words must be whole', () => {
    expect(termMatches('Iron sucrose', 'iron')).toBe(true);
    expect(termMatches('Ironic acid', 'iron')).toBe(false);
    expect(termMatches('Vitamin A 50000 IU', 'vitamin a')).toBe(true);
    expect(termMatches('Vitamin AD3', 'vitamin a')).toBe(false);
  });
});

describe('medicineWarnings', () => {
  it('warns for pregnancy only when the patient is pregnant', () => {
    expect(keys(medicineWarnings({ rows: rows('Losartan 50'), list: LIST, weeks: 12, pregnant: true }))).toEqual(['avoid:arbs']);
    expect(medicineWarnings({ rows: rows('Losartan 50'), list: LIST, weeks: null, pregnant: false })).toEqual([]);
  });

  it('follows the weeks: NSAIDs caution before 20 weeks, avoid from 20', () => {
    expect(keys(medicineWarnings({ rows: rows('Brufen 400'), list: LIST, weeks: 12, pregnant: true }))).toEqual(['caution:nsaids_early']);
    expect(keys(medicineWarnings({ rows: rows('Brufen 400'), list: LIST, weeks: 24, pregnant: true }))).toEqual(['avoid:nsaids_late']);
    // Weeks unknown: both shown, marked to check
    const unsure = medicineWarnings({ rows: rows('Brufen 400'), list: LIST, weeks: null, pregnant: true });
    expect(unsure.map((w) => w.unsureWeeks)).toEqual([true, true]);
  });

  it('combinations need both medicines on different lines', () => {
    const both = medicineWarnings({ rows: rows('Ferrous ascorbate 100', 'Shelcal 500'), list: LIST, weeks: 24, pregnant: true });
    expect(both).toEqual([expect.objectContaining({ key: 'iron_calcium', medicines: ['Ferrous ascorbate 100', 'Shelcal 500'] })]);
    expect(medicineWarnings({ rows: rows('Ferrous ascorbate 100'), list: LIST, weeks: 24, pregnant: true })).toEqual([]);
  });

  it('checks allergies for every patient: by group and by name', () => {
    const byGroup = medicineWarnings({ rows: rows('Amoxicillin 500'), list: LIST, allergies: 'Penicillin – rash' });
    expect(byGroup).toEqual([expect.objectContaining({ level: 'allergy', message: expect.stringMatching(/penicillin group/) })]);
    const byName = medicineWarnings({ rows: rows('Metronidazole 400'), list: LIST, allergies: 'metronidazole' });
    expect(keys(byName)).toEqual(['allergy:allergy']);
    expect(medicineWarnings({ rows: rows('Amoxicillin 500'), list: LIST, allergies: 'NKDA' })).toEqual([]);
    expect(medicineWarnings({ rows: rows('Paracetamol 500'), list: LIST, allergies: 'Sulfa drugs' })).toEqual([]);
  });

  it('puts allergies first, then Avoid, then Caution', () => {
    const ws = medicineWarnings({ rows: rows('Iron 100', 'Calcium 500', 'Losartan 25', 'Amoxicillin'), list: LIST, weeks: 10, pregnant: true, allergies: 'penicillin' });
    expect(ws.map((w) => w.level)).toEqual(['allergy', 'avoid', 'caution']);
  });

  it('ignores empty lines', () => {
    expect(medicineWarnings({ rows: rows('', '  '), list: LIST, weeks: 10, pregnant: true, allergies: 'penicillin' })).toEqual([]);
  });
});

describe('helpers', () => {
  it('reads allergy notes', () => {
    expect(allergyNames('No known drug allergies').groups).toEqual([]);
    expect(allergyNames('Sulpha and NSAIDs').groups.map((g) => g.name)).toEqual(['sulfa', 'NSAID']);
  });
  it('says when an entry applies', () => {
    expect(entryWeeksText({ fromWeek: 20, toWeek: null })).toBe('from 20 weeks');
    expect(entryWeeksText({ fromWeek: null, toWeek: 15 })).toBe('up to 15 weeks');
    expect(entryWeeksText({ fromWeek: null, toWeek: null })).toBe('whole pregnancy');
  });
});

describe('pregnancyOnVisit (pregnancy warnings)', () => {
  const on = '2026-10-01T00:00:00.000Z';
  it('antenatal: weeks from the EDD in use', () => {
    expect(pregnancyOnVisit({ careType: 'antenatal', pregnancy: { effectiveEdd: '2027-03-01T00:00:00.000Z' } }, on)).toEqual({ pregnant: true, weeks: 18 });
  });
  it('abortion care: never a continuing pregnancy (a threatened miscarriage stays under Antenatal), old records included', () => {
    const loss = (lossType) => ({ careType: 'abortion', pregnancy: { effectiveEdd: '2027-03-01T00:00:00.000Z' }, abortion: { lossType, lmp: '2026-08-02T00:00:00.000Z' } });
    // 'threatened': only on a record saved before 3 Oct 2026
    for (const t of ['threatened', 'missed', 'incomplete', 'ectopic', 'molar', 'recurrent', null]) expect(pregnancyOnVisit(loss(t), on), t).toEqual({ pregnant: false, weeks: null });
    expect(pregnancyOnVisit({ careType: 'abortion' }, on)).toEqual({ pregnant: false, weeks: null }); // details not seen
    expect(pregnancyOnVisit({ careType: 'gynaecology' }, on)).toEqual({ pregnant: false, weeks: null });
  });
  it('no pregnancy warning for misoprostol in abortion care, even on an old threatened-miscarriage record; antenatal gets it', () => {
    const list = [{ key: 'miso', kind: 'medicine', label: 'Misoprostol', terms: ['misoprostol'], otherTerms: [], level: 'avoid', fromWeek: null, toWeek: null, message: 'Causes uterine contractions.' }];
    const rows = [{ drug: 'Misoprostol 200 mcg' }];
    const missed = pregnancyOnVisit({ careType: 'abortion', abortion: { lossType: 'missed', lmp: '2026-08-02' } }, on);
    const threatened = pregnancyOnVisit({ careType: 'abortion', abortion: { lossType: 'threatened', lmp: '2026-08-02' } }, on);
    const antenatal = pregnancyOnVisit({ careType: 'antenatal', pregnancy: { effectiveEdd: '2027-05-09T00:00:00.000Z' } }, on);
    expect(medicineWarnings({ rows, list, allergies: 'None known', ...missed })).toEqual([]);
    expect(medicineWarnings({ rows, list, allergies: 'None known', ...threatened })).toEqual([]);
    expect(medicineWarnings({ rows, list, allergies: 'None known', ...antenatal }).length).toBe(1);
  });
});

// ---------- Breastfeeding and newborn entries, and who they apply to ----------

const MORE = [
  ...LIST,
  { key: 'bf_codeine', kind: 'breastfeeding', label: 'Codeine', terms: ['codeine'], otherTerms: [], level: 'avoid', message: 'Use paracetamol.' },
  { key: 'bf_doxy', kind: 'breastfeeding', label: 'Tetracyclines', terms: ['doxycycline'], otherTerms: [], level: 'caution', message: 'Short courses only.' },
  { key: 'nb_ceftriaxone', kind: 'newborn', label: 'Ceftriaxone in the first 28 days', terms: ['ceftriaxone'], otherTerms: [], level: 'caution', maxAgeDays: 28, message: 'Not in a jaundiced baby.' },
  { key: 'nb_aspirin', kind: 'newborn', label: 'Aspirin', terms: ['aspirin'], otherTerms: [], level: 'avoid', maxAgeDays: null, message: 'Reye’s syndrome.' },
  { key: 'dose_ibuprofen', kind: 'dose', label: 'Ibuprofen', terms: ['ibuprofen', 'brufen'], otherTerms: [], level: 'caution', doseUnit: 'mg', maxSingle: 800, maxDaily: 2400, perKg: false, message: '' },
];

describe('who the entries apply to', () => {
  it('breastfeeding: postnatal patients, unless recorded as not breastfeeding', () => {
    expect(breastfeedingOnVisit({ careType: 'postnatal', postnatal: { breastfeeding: 'yes' } })).toBe('yes');
    expect(breastfeedingOnVisit({ careType: 'postnatal', postnatal: { breastfeeding: '' } })).toBe('unknown');
    expect(breastfeedingOnVisit({ careType: 'postnatal' })).toBe('unknown');
    expect(breastfeedingOnVisit({ careType: 'postnatal', postnatal: { breastfeeding: 'no' } })).toBeNull();
    expect(breastfeedingOnVisit({ careType: 'gynaecology', postnatal: { breastfeeding: 'yes' } })).toBeNull();
    expect(breastfeedingOnVisit(null)).toBeNull();
  });

  it('a baby: age in whole days on the visit’s date, and the weight to check doses against', () => {
    const baby = { careType: 'newborn', newborn: { birthAt: '2026-10-01T03:45:00.000Z', birthWeightGrams: 3100 } };
    expect(babyOnVisit(baby, { visitOn: '2026-10-01T00:00:00.000Z', vitals: { weightKg: null } })).toMatchObject({ ageDays: 0, weight: { kg: 3.1, from: 'birth' } });
    expect(babyOnVisit(baby, { visitOn: '2026-10-11T00:00:00.000Z', vitals: { weightKg: 3.4 } })).toMatchObject({ ageDays: 9, weight: { kg: 3.4, from: 'visit' } });
    expect(babyOnVisit({ careType: 'newborn', newborn: {} }, { visitOn: '2026-10-11T00:00:00.000Z', vitals: {} })).toEqual({ ageDays: null, calendarDays: null, weight: null });
    expect(babyOnVisit({ careType: 'postnatal', newborn: { birthAt: '2026-10-01T03:45:00.000Z' } }, { visitOn: '2026-10-11T00:00:00.000Z' })).toBeNull();
  });

  it('a baby’s age in words counts the days from the date of birth, as the patient’s header does', () => {
    // Born at 10:00 on 3 Oct (this computer's clock, as dates of birth are shown), seen on 4 Oct: 1 day old – not 0.
    const born = (h, m = 0) => ({ careType: 'newborn', newborn: { birthAt: new Date(2026, 9, 3, h, m).toISOString() } });
    const on = (day) => ({ visitOn: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z` });
    for (const hour of [0, 4, 10, 23]) {
      expect(babyOnVisit(born(hour), on(3)).calendarDays, `${hour}:00, the day of birth`).toBe(0);
      expect(babyOnVisit(born(hour), on(4)).calendarDays, `${hour}:00, the next day`).toBe(1);
      expect(babyOnVisit(born(hour), on(13)).calendarDays, `${hour}:00, ten days later`).toBe(10);
      // The age the entries are checked against is never more than that (it errs towards a warning)
      const b = babyOnVisit(born(hour), on(13));
      expect(b.ageDays, `${hour}:00`).toBeLessThanOrEqual(b.calendarDays);
    }
  });

  it('says what the hospital’s list cannot check for this patient', () => {
    const OLD = LIST; // a list from before breastfeeding, newborn and dose entries: pregnancy entries only
    expect(notCovered(OLD, { pregnant: true })).toEqual({ entries: null, doses: 'dose limits' });
    expect(notCovered(OLD, { breastfeeding: 'unknown' })).toEqual({ entries: 'entries for breastfeeding', doses: 'dose limits' });
    expect(notCovered(OLD, { baby: { ageDays: 5, weight: null } })).toEqual({ entries: 'entries for newborn babies', doses: 'dose limits for babies' });
    expect(notCovered(OLD, {})).toEqual({ entries: null, doses: 'dose limits' }); // a gynaecology patient: only the doses apply
    expect(notCovered([], { pregnant: true })).toEqual({ entries: 'entries for pregnancy', doses: 'dose limits' });
    // The full list covers everyone – but a baby's doses need a per-kg limit, an adult's a limit that is not per kg
    expect(notCovered(MORE, { breastfeeding: 'yes' })).toEqual({ entries: null, doses: null });
    expect(notCovered(MORE, { baby: { ageDays: 5, weight: null } })).toEqual({ entries: null, doses: 'dose limits for babies' });
    const perKg = { key: 'kg', kind: 'dose', terms: ['gentamicin'], doseUnit: 'mg', maxSingle: 7.5, maxDaily: 7.5, perKg: true };
    expect(notCovered([...MORE, perKg], { baby: { ageDays: 5, weight: null } })).toEqual({ entries: null, doses: null });
    expect(notCovered([perKg], {})).toEqual({ entries: null, doses: 'dose limits' });
  });

  it('pregnancy entries only in pregnancy, breastfeeding entries only while breastfeeding, newborn entries only for a baby', () => {
    const drugs = rows('Losartan 50', 'Codeine 30', 'Ceftriaxone 250', 'Aspirin 75');
    expect(keys(medicineWarnings({ rows: drugs, list: MORE, weeks: 12, pregnant: true }))).toEqual(['avoid:arbs']);
    expect(keys(medicineWarnings({ rows: drugs, list: MORE, breastfeeding: 'yes' }))).toEqual(['avoid:bf_codeine']);
    expect(keys(medicineWarnings({ rows: drugs, list: MORE, baby: { ageDays: 10, weight: null } }))).toEqual(['avoid:nb_aspirin', 'caution:nb_ceftriaxone']);
    expect(keys(medicineWarnings({ rows: drugs, list: MORE, baby: { ageDays: 60, weight: null } }))).toEqual(['avoid:nb_aspirin']);
    expect(medicineWarnings({ rows: drugs, list: MORE })).toEqual([]);
  });

  it('breastfeeding not recorded: the same warnings, worded "if she is breastfeeding"', () => {
    const [w] = medicineWarnings({ rows: rows('Doxycycline 100'), list: MORE, breastfeeding: 'unknown' });
    expect(w).toMatchObject({ key: 'bf_doxy', level: 'caution', title: 'Tetracyclines – if she is breastfeeding', unsureBreastfeeding: true });
    const [sure] = medicineWarnings({ rows: rows('Doxycycline 100'), list: MORE, breastfeeding: 'yes' });
    expect(sure).toMatchObject({ title: 'Tetracyclines – breastfeeding', unsureBreastfeeding: false });
  });

  it('a baby whose age is not known: age-limited entries are shown, marked to check', () => {
    const ws = medicineWarnings({ rows: rows('Ceftriaxone 250', 'Aspirin 75'), list: MORE, baby: { ageDays: null, weight: null } });
    expect(ws.map((w) => [w.key, w.unsureAge])).toEqual([['nb_aspirin', false], ['nb_ceftriaxone', true]]);
  });

  it('dose warnings come last and never need a reason; Avoid and Allergy do', () => {
    const ws = medicineWarnings({
      rows: [{ drug: 'Brufen', form: 'tab', strength: '400 mg', dose: '2', frequency: '1-1-1-1' }, { drug: 'Losartan 50' }, { drug: 'Iron 100' }, { drug: 'Calcium 500' }],
      list: MORE,
      weeks: 30,
      pregnant: true,
      allergies: 'ibuprofen',
    });
    expect(ws.map((w) => w.level)).toEqual(['allergy', 'avoid', 'avoid', 'caution', 'dose']);
    expect(ws.map(needsReason)).toEqual([true, true, true, false, false]);
    expect(ws.at(-1)).toMatchObject({ key: 'dose:dose_ibuprofen', title: 'Ibuprofen: above the usual maximum of 2.4 g a day' });
  });

  it('says up to what age a newborn entry applies', () => {
    expect(entryAgeText({ maxAgeDays: null })).toBe('any age in newborn care');
    expect(entryAgeText({ maxAgeDays: 28 })).toBe('up to 28 days old');
    expect(entryAgeText({ maxAgeDays: 42 })).toBe('under 6 weeks old');
    expect(entryAgeText({ maxAgeDays: 90 })).toBe('under 3 months old');
    expect(entryAgeText({ maxAgeDays: 365 })).toBe('under 1 year old');
    expect(entryAgeText({ maxAgeDays: 10 })).toBe('up to 10 days old');
    expect([0, 1, 9, 59, 60, 61, 200].map(babyAgeText)).toEqual(['born on the day of the visit', '1 day old', '9 days old', '59 days old', '60 days old', '2 months old', '6 months old']);
  });
});
