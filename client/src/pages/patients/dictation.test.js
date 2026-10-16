// Voice entry: picking patient details out of what was said (all fake sample data).
import { describe, expect, it } from 'vitest';
import {
  answerToResult,
  combineDictated,
  dictatedFields,
  dictatedPieces,
  extractPatientDetails,
  isInfoPath,
  keepForLater,
  mergeDictated,
  newFillMemory,
  noteHandEdit,
  noteTick,
  planFill,
  questionsToShow,
  splitFound,
  withoutDictated,
} from './dictation.js';

const now = new Date(2026, 8, 28, 13, 0); // 28 Sep 2026, 13:00
const read = (text, careType = 'antenatal', at = now) => extractPatientDetails(text, { careType, now: at });

describe('a pregnant patient, said detail by detail', () => {
  it('fills every detail that was said', () => {
    const { values } = read(
      'Name Asha Sample, age 28, phone 98765 43210, address 12 MG Road, Pune. LMP 12 July 2026. G2 P1 L1 A0, one previous caesarean. ' +
        'Blood group O positive. Height 158 cm, weight 60 kg. No known medical conditions. Allergic to penicillin.',
    );
    expect(values).toMatchObject({
      fullName: 'Asha Sample',
      ageYears: '28',
      phone: '98765 43210',
      address: '12 MG Road, Pune',
      pregnancy: { lmp: '2026-07-12' },
      obstetric: { gravida: '2', para: '1', living: '1', abortions: '0', previousCaesareans: '1' },
      medical: { bloodGroup: 'O+', heightCm: '158', weightKg: '60', conditionsReviewed: true, allergies: 'Penicillin' },
    });
    expect(values.medical.conditions).toBeUndefined();
  });

  it('works without punctuation or capitals (as speech often comes out)', () => {
    const { values } = read('name asha sample age 28 phone 9876543210 lmp 12th july 2026 g2 p1 l1 a0 blood group o positive allergic to penicillin');
    expect(values).toMatchObject({
      fullName: 'Asha Sample',
      ageYears: '28',
      phone: '98765 43210',
      pregnancy: { lmp: '2026-07-12' },
      obstetric: { gravida: '2', para: '1', living: '1', abortions: '0' },
      medical: { bloodGroup: 'O+', allergies: 'Penicillin' },
    });
  });

  it('understands numbers said as words', () => {
    const { values } = read('Asha Sample, twenty eight years old, gravida two para one living one abortion zero, blood group B negative');
    expect(values).toMatchObject({ fullName: 'Asha Sample', ageYears: '28', obstetric: { gravida: '2', para: '1', living: '1', abortions: '0' }, medical: { bloodGroup: 'B-' } });
  });

  it('understands a more natural sentence', () => {
    const { values } = read(
      'Asha Sample is a 28 year old primigravida with LMP of twelfth July. She is diabetic and hypothyroid on thyroxine. No allergies. Height 5 feet 2 inches, weight 64 kg.',
    );
    expect(values).toMatchObject({
      fullName: 'Asha Sample',
      ageYears: '28',
      pregnancy: { lmp: '2026-07-12' },
      obstetric: { gravida: '1', para: '0', living: '0', abortions: '0', previousCaesareans: '0' },
      medical: { conditions: ['diabetes', 'thyroid'], allergies: 'None known', heightCm: '157.5', weightKg: '64' },
    });
  });

  it('reads a dating-scan EDD only when "scan" is said', () => {
    expect(read('LMP 12 July 2026, EDD by scan 20 April 2027').values.pregnancy).toEqual({ lmp: '2026-07-12', scanEdd: '2027-04-20' });
    expect(read('USG EDD 20/04/2027').values.pregnancy).toEqual({ scanEdd: '2027-04-20' });
    const plain = read('LMP 12 July 2026, EDD 18 April 2027');
    expect(plain.values.pregnancy).toEqual({ lmp: '2026-07-12' });
    expect(plain.questions).toMatchObject([{ key: 'edd', remember: true, data: { date: '2027-04-18' } }]);
  });

  it('does not use an LMP in the future', () => {
    const r = read('LMP 12 December 2026');
    expect(r.values.pregnancy).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/in the future/);
    expect(read('LMP 12 December').values.pregnancy.lmp).toBe('2025-12-12'); // no year: the last 12 December
  });

  it('never records the baby’s sex during pregnancy (PCPNDT)', () => {
    const r = read('Asha Sample, 28 years, the baby is a boy');
    expect(r.values.newborn).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/male/);
  });
});

describe('conditions', () => {
  it('leaves out what was said with "no" and ticks the rest', () => {
    expect(read('No diabetes or hypertension. Known case of asthma.').values.medical.conditions).toEqual(['asthma']);
    expect(read('no history of diabetes, has asthma').values.medical.conditions).toEqual(['asthma']);
  });

  it('a "no" covers a list, not the next finding said on its own', () => {
    expect(read('No history of diabetes, hypertension or asthma').values.medical).toBeUndefined();
    const r = read('Sunita Sample 25 yrs G2P1L1A0 LMP 01/08/2026 previous LSCS 1 no DM no HTN thyroid on eltroxin allergy nil');
    expect(r.values.medical).toEqual({ conditions: ['thyroid'], allergies: 'None known' });
    expect(read('non-diabetic, known asthmatic').values.medical.conditions).toEqual(['asthma']);
  });

  it('reads test results said after the tests', () => {
    expect(read('HIV, HBsAg and VDRL negative').values.medical).toBeUndefined();
    // a positive result is confirmed first, even when typed (plan 2.6)
    const positive = read('HBsAg positive, HIV negative');
    expect(positive.values.medical).toBeUndefined();
    expect(positive.questions).toMatchObject([{ group: 'confirm', options: [{ value: 'condition:hepatitis_b', label: 'Yes, reactive' }, { value: 'ignore' }, { value: 'ignore' }] }]);
    const unclear = read('HIV test done');
    expect(unclear.values.medical).toBeUndefined();
    expect(unclear.questions).toMatchObject([{ heard: 'HIV', remember: false, options: [{ value: 'condition:hiv' }, { value: 'ignore' }] }]);
  });

  it('does not take "hepatitis B negative" as a blood group', () => {
    expect(read('Hepatitis B negative, blood group B positive').values.medical).toEqual({ bloodGroup: 'B+' });
    expect(read('hepatitis B negative').values.medical).toBeUndefined();
  });

  it("does not tick family members' illnesses", () => {
    const r = read('Family history of diabetes. Mother has hypertension.');
    expect(r.values.medical).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/family members/i);
  });

  it('writes gestational diabetes in the notes, not as diabetes', () => {
    const r = read('gestational diabetes in this pregnancy');
    expect(r.values.medical).toBeUndefined();
    expect(r.values.notes).toBe('Gestational diabetes (this pregnancy)');
  });
});

describe('previous pregnancies', () => {
  it('ticks problems said about previous pregnancies', () => {
    expect(read('G3 P2 L2 A0. History of PPH in last delivery and a previous preterm birth.').values.obstetric.pastComplications).toEqual(['preterm_birth', 'pph']);
    expect(read('G2 P1 L1 A0, no problems in previous pregnancies').values.obstetric.complicationsReviewed).toBe(true);
  });

  it('counts previous caesareans', () => {
    expect(read('Meena Sample, 31 years, G3 P2 L2 A1, 2 previous caesareans', 'postnatal').values.obstetric).toEqual({
      gravida: '3',
      para: '2',
      living: '2',
      abortions: '1',
      previousCaesareans: '2',
    });
    expect(read('G2 P1 L1 A0 previous LSCS').values.obstetric.previousCaesareans).toBe('1');
    expect(read('G2P1L1A0, no previous caesarean').values.obstetric.previousCaesareans).toBe('0');
  });
});

describe('age, name and phone', () => {
  it('takes the name said first without "name", straight before the age (16 Oct 2026)', () => {
    const { values } = read('Asha Patil age 28 phone 98765 43210', 'antenatal');
    expect(values).toMatchObject({ fullName: 'Asha Patil', ageYears: '28', phone: '98765 43210' });
  });
  it('does not take years of marriage as the age', () => {
    const { values } = read('Priya Sample, 32 years, married for 6 years, G1 P0 L0 A1', 'infertility');
    expect(values.ageYears).toBe('32');
    expect(values.fullName).toBe('Priya Sample');
  });

  it('understands a free-flowing description', () => {
    const { values } = read(
      "okay so the patient is Rekha Sample she's 30 years old her phone number is 99887 76655 and her last period was on the 5th of August " +
        'this is her third pregnancy she has two kids both normal deliveries no abortions blood group is AB positive',
    );
    expect(values).toMatchObject({
      fullName: 'Rekha Sample',
      ageYears: '30',
      phone: '99887 76655',
      pregnancy: { lmp: '2026-08-05' },
      obstetric: { gravida: '3', living: '2', abortions: '0' },
      medical: { bloodGroup: 'AB+' },
    });
  });

  it('does not take a sentence start as a name', () => {
    expect(read('She is 28 years old').values.fullName).toBeUndefined();
    expect(read('Pregnant lady 28 years').values.fullName).toBeUndefined();
    expect(read('Mrs Asha Sample, 28 years').values.fullName).toBe('Asha Sample');
  });

  it('reads phone numbers in the ways they are said', () => {
    expect(read('mobile number +91 98765 43210').values.phone).toBe('+91 98765 43210');
    expect(read('phone nine eight seven six five four three two one zero').values.phone).toBe('98765 43210');
    expect(read('contact double 9 8 7 6 5 4 3 2 1').values.phone).toBe('99876 54321');
    expect(read('Asha Sample 28 years 98765 43210').values.phone).toBe('98765 43210');
    expect(read('age 28 phone 98765 43210 28 years').values.phone).toBe('98765 43210');
  });
});

describe('a newborn', () => {
  it('fills the birth details and suggests the mother', () => {
    const r = read('Baby of Asha Sample, born today at 9:15 am, birth weight 3.1 kg, baby girl, blood group B positive', 'newborn');
    expect(r.values).toMatchObject({
      fullName: 'Baby of Asha Sample',
      motherName: 'Asha Sample',
      newborn: { birthAt: '2026-09-28T09:15', birthWeightGrams: '3100', sex: 'female' },
      medical: { bloodGroup: 'B+' },
    });
    expect(r.values.ageYears).toBeUndefined();
  });

  it('takes the most recent time when am/pm is not said', () => {
    const early = new Date(2026, 8, 28, 8, 0);
    expect(read('born at 9:15', 'newborn', early).values.newborn.birthAt).toBe('2026-09-27T21:15');
    expect(read('born at 9:15', 'newborn').values.newborn.birthAt).toBe('2026-09-28T09:15');
    expect(read('born yesterday at 11 pm, 2 kg 800 grams, male baby', 'newborn').values.newborn).toEqual({ birthAt: '2026-09-27T23:00', birthWeightGrams: '2800', sex: 'male' });
  });

  it('does not move a time said for "today" to yesterday', () => {
    const r = read('baby boy born at 2:30 pm today weighing 2900 grams mother Meera Twostep Sample', 'newborn');
    expect(r.values.newborn).toEqual({ birthWeightGrams: '2900', sex: 'male' });
    expect(r.notes.join(' ')).toMatch(/in the future/);
    expect(r.values.fullName).toBe('Baby of Meera Twostep Sample');
  });
});

describe('putting dictated values into the form', () => {
  const blank = { fullName: '', newborn: {}, pregnancy: { lmp: '' }, obstetric: { pastComplications: [], complicationsReviewed: false }, medical: { conditions: ['asthma'], conditionsReviewed: false } };

  it('adds ticks and only ticks "none" when nothing else is ticked', () => {
    const r = read('Asha Sample, diabetic, no problems in previous pregnancies, no known conditions');
    const v = mergeDictated(blank, r.values, r.paths);
    expect(v.fullName).toBe('Asha Sample');
    expect(v.medical.conditions).toEqual(['asthma', 'diabetes']);
    expect(v.obstetric.complicationsReviewed).toBe(true);
    const none = read('no known conditions');
    expect(mergeDictated(blank, none.values, none.paths).medical.conditionsReviewed).toBe(false); // asthma is still ticked
  });

  it('marks each filled field', () => {
    const r = read('Asha Sample, LMP 12 July 2026, diabetic and asthmatic');
    expect(dictatedFields(r.values, r.paths)).toEqual(['fullName', 'pregnancy.lmp', 'medical.conditions.diabetes', 'medical.conditions.asthma']);
  });
});

describe('a new reading never undoes the person\'s own work', () => {
  const form = () => ({
    fullName: '',
    ageYears: '',
    newborn: {},
    pregnancy: { lmp: '' },
    obstetric: { gravida: '', pastComplications: [], complicationsReviewed: false },
    medical: { conditions: [], conditionsReviewed: false, otherConditions: '', bloodGroup: '' },
    notes: '',
  });

  it('never overwrites a field changed by hand (skip)', () => {
    const r = read('Asha Sample, age 28, G2 P1 L1 A0');
    const v = mergeDictated({ ...form(), ageYears: '29' }, r.values, r.paths, { skip: ['ageYears'] });
    expect(v.ageYears).toBe('29');
    expect(v.fullName).toBe('Asha Sample');
    expect(v.obstetric.gravida).toBe('2');
    expect(dictatedFields(r.values, r.paths, { skip: ['ageYears'] })).not.toContain('ageYears');
    // "No known conditions" taken off by hand is not ticked again
    const none = read('no known conditions');
    expect(mergeDictated(form(), none.values, none.paths, { skip: ['medical.conditionsReviewed'] }).medical.conditionsReviewed).toBe(false);
    expect(mergeDictated(form(), none.values, none.paths).medical.conditionsReviewed).toBe(true);
  });

  it('never ticks again what the person unticked (unticked)', () => {
    const r = read('Asha Sample, diabetic and asthmatic');
    const v = mergeDictated(form(), r.values, r.paths, { unticked: ['medical.conditions.asthma'] });
    expect(v.medical.conditions).toEqual(['diabetes']);
    expect(dictatedFields(r.values, r.paths, { unticked: ['medical.conditions.asthma'] })).toEqual(['fullName', 'medical.conditions.diabetes']);
    // only asthma was said, and it was unticked: nothing changes (not even "No known conditions")
    const only = read('asthmatic');
    const kept = mergeDictated({ ...form(), medical: { ...form().medical, conditionsReviewed: true } }, only.values, only.paths, { unticked: ['medical.conditions.asthma'] });
    expect(kept.medical).toMatchObject({ conditions: [], conditionsReviewed: true });
  });

  it('adds only the pieces of notes and other conditions not already added by voice (added)', () => {
    const r = read('Asha Sample, twins, fibroid uterus', 'gynaecology');
    const pieces = dictatedPieces(r.values, r.paths);
    expect(pieces.length).toBeGreaterThan(0);
    const first = mergeDictated(form(), r.values, r.paths);
    // the person deleted what voice added, and typed their own note: reading the same text again adds nothing back
    const edited = { ...first, notes: 'Seen with husband', medical: { ...first.medical, otherConditions: '' } };
    const again = mergeDictated(edited, r.values, r.paths, { skip: ['notes', 'medical.otherConditions'], added: pieces });
    expect(again.notes).toBe('Seen with husband');
    expect(again.medical.otherConditions).toBe('');
    // something new said is still added, after the person's own words
    const more = read('Asha Sample, twins, fibroid uterus, k/c/o migraine', 'gynaecology');
    const added = mergeDictated(edited, more.values, more.paths, { skip: ['notes', 'medical.otherConditions'], added: pieces });
    expect(added.medical.otherConditions).toMatch(/migraine/i);
    expect(added.medical.otherConditions).not.toMatch(/fibroid/i);
  });

  it('takes out what an earlier reading filled and the new reading no longer gives (Undo)', () => {
    const r = read('Asha Sample, age 28, diabetic, twins');
    const filled = mergeDictated({ ...form(), ageYears: '' }, r.values, r.paths);
    const out = withoutDictated(filled, ['ageYears', 'medical.conditions.diabetes'], { ageYears: '' }, dictatedPieces(r.values, r.paths));
    expect(out.ageYears).toBe('');
    expect(out.medical.conditions).toEqual([]);
    expect(out.notes).toBe('');
    expect(out.fullName).toBe('Asha Sample');
    expect(withoutDictated(filled, [], {}, [])).toBe(filled);
  });
});

describe('Undo on a correction (words kept as heard, this form only)', () => {
  const voice = (text, keep) => extractPatientDetails(text, { careType: 'antenatal', now: new Date(2026, 8, 28, 11, 30), voice: true, keep });

  it('keeps the word as heard: the correction and what it filled go', () => {
    const said = 'G2 P1 L1 A0 previous sizerian, prebious LSCS, age tirty';
    const r = voice(said);
    expect(r.corrections.map((c) => c.heard)).toEqual(expect.arrayContaining(['sizerian', 'prebious', 'tirty']));
    expect(r.values.obstetric.previousCaesareans).toBeDefined();
    expect(r.values.ageYears).toBe('30');
    const kept = voice(said, ['sizerian', 'prebious', 'tirty']);
    expect(kept.corrections).toEqual([]);
    expect(kept.values.ageYears).toBeUndefined();
    expect(kept.values.obstetric.previousCaesareans).toBeUndefined();
    expect(kept.questions.filter((q) => /sizerian|prebious|tirty/i.test(q.heard))).toEqual([]); // not asked about again
  });

  it('never gets round the safety rules: an undone "none reactive" goes to the results card', () => {
    const r = voice('HIV none reactive', ['none reactive']);
    expect(r.corrections).toEqual([]);
    expect(r.questions.map((q) => q.group)).toEqual(['confirm']);
    expect(JSON.stringify(r.values)).not.toMatch(/hiv/i);
  });

  it('offers no Undo on part of a number: it could only leave part of it', () => {
    for (const [text, heard] of [
      ['age twenty sewen', 'sewen'],
      ['age fourty fife', 'fife'],
      ['naam Sunaina Mishra pachees saal ki hai', 'pachees saal ki hai'],
    ]) {
      const c = voice(text).corrections.find((x) => x.heard === heard);
      expect(c, text).toMatchObject({ undo: false });
    }
    // a word correction keeps its Undo
    expect(voice('previous sizerian').corrections.find((c) => c.heard === 'sizerian').undo).toBeUndefined();
  });

  it('a name ends at a word kept as heard', () => {
    const said = 'name Sunita Devi grabida 2 para 1';
    expect(voice(said).values.fullName).toBe('Sunita Devi');
    expect(voice(said, ['grabida']).values.fullName).toBe('Sunita Devi');
    expect(voice('name Priya Sharma hight 150 cm', ['hight']).values.fullName).toBe('Priya Sharma');
  });

  it('asks about a number cut short by a word kept as heard, never fills it', () => {
    const value = (r, path) => r.questions.some((q) => q.options.some((o) => o.value === path));
    const both = voice('age twenty tree, weight sixty tree kg', ['tree']);
    expect(both.values.ageYears).toBeUndefined();
    expect(both.values.medical?.weightKg).toBeUndefined();
    expect(value(both, 'value:ageYears=20') && value(both, 'value:medical.weightKg=60')).toBe(true);
    const height = voice('height one sixty won cm', ['won']);
    expect(height.values.medical?.heightCm).toBeUndefined();
    expect(value(height, 'value:medical.heightCm=160')).toBe(true);
    expect(voice('weight sixty fife kg', ['fife']).values.medical?.weightKg).toBeUndefined();
    // nothing kept: the whole number, no question
    const whole = voice('age twenty tree');
    expect(whole.values.ageYears).toBe('23');
    expect(whole.questions).toEqual([]);
  });
});

// A form filled from voice again and again, the way PatientForm does it (fake data)
function voiceForm({ part = 'all', dictated = null } = {}) {
  const blank = () => ({
    fullName: '',
    ageYears: '',
    newborn: {},
    pregnancy: { lmp: '', scanEdd: '' },
    obstetric: { gravida: '', para: '', living: '', abortions: '', previousCaesareans: '', pastComplications: [], complicationsReviewed: false },
    medical: { conditions: [], conditionsReviewed: false, otherConditions: '', bloodGroup: '', heightCm: '', weightKg: '' },
    notes: '',
  });
  const memory = newFillMemory(dictated);
  const form = {
    v: dictated ? mergeDictated(blank(), dictated.values, dictated.paths) : blank(),
    fromVoice: new Set(dictated ? dictatedFields(dictated.values, dictated.paths) : []),
    later: null,
    summary: null,
  };
  const fill = (result, reading) => {
    const clinicalPaths = result.paths.filter((p) => !isInfoPath(p));
    const usable = result.paths.filter((p) => part === 'all' || (part === 'info') === isInfoPath(p));
    const plan = planFill(memory, result, { reading, usable, v: form.v, fromVoice: form.fromVoice });
    const here = result.found.filter((f) => part === 'all' || (part === 'info') === (f.part === 'info'));
    form.summary = reading ? splitFound(here, result.values, plan.keep, form.v) : { filled: here, notChanged: [] };
    form.v = plan.values(form.v);
    form.fromVoice = plan.marks(form.fromVoice);
    const waiting = part === 'info' && clinicalPaths.length ? { values: result.values, paths: clinicalPaths, found: result.found.filter((f) => f.part === 'clinical') } : null;
    if (part === 'info' && (reading || waiting)) form.later = keepForLater(memory, waiting, reading);
  };
  const at = new Date(2026, 8, 28, 11, 30);
  return {
    form,
    read: (text, keep = []) => fill(extractPatientDetails(text, { careType: 'antenatal', now: at, voice: true, keep }), true),
    answer: (question, value) => fill(answerToResult(question, value, 'antenatal'), false),
    question: (text, rx) => extractPatientDetails(text, { careType: 'antenatal', now: at, voice: true }).questions.find((q) => rx.test(q.prompt)),
    type: (section, key, value) => {
      noteHandEdit(memory, [key ? `${section}.${key}` : section]);
      form.fromVoice.delete(key ? `${section}.${key}` : section);
      form.v = key ? { ...form.v, [section]: { ...form.v[section], [key]: value } } : { ...form.v, [section]: value };
    },
    toggle: (c) => {
      const path = `medical.conditions.${c}`;
      const on = form.v.medical.conditions.includes(c);
      noteTick(memory, path, on);
      noteHandEdit(memory, [path, 'medical.conditionsReviewed']);
      form.fromVoice.delete(path);
      form.v = { ...form.v, medical: { ...form.v.medical, conditions: on ? form.v.medical.conditions.filter((x) => x !== c) : [...form.v.medical.conditions, c] } };
    },
  };
}
const lines = (list) => list.map((f) => `${f.label}: ${f.text}`);

describe('filling the form again (plan 1.7)', () => {
  it('keeps a hand edit over new readings, and says what was not changed', () => {
    const f = voiceForm();
    f.read('Asha Sample age 29, she has asthma and anaemia, LMP 5 March 2026');
    f.type('ageYears', null, '30');
    f.type('pregnancy', 'lmp', '2026-03-06');
    f.toggle('asthma');
    f.read('Asha Sample age 29, she has asthma and anaemia, LMP 5 March 2026, weight 60 kg');
    expect(f.form.v).toMatchObject({ ageYears: '30', pregnancy: { lmp: '2026-03-06' }, medical: { conditions: ['anaemia'], weightKg: '60' } });
    expect([...f.form.fromVoice].sort()).toEqual(['fullName', 'medical.conditions.anaemia', 'medical.weightKg']);
    expect(lines(f.form.summary.notChanged)).toEqual(['Age: 29', 'LMP: 5 Mar 2026', 'Existing conditions: Asthma']);
    expect(lines(f.form.summary.filled)).toEqual(['Full name: Asha Sample', 'Weight: 60 kg', 'Existing conditions: Anaemia']);
    // a third reading with a newer age: still the hand-typed one
    f.read('Asha Sample age 31');
    expect(f.form.v.ageYears).toBe('30');
    expect(lines(f.form.summary.notChanged)).toEqual(['Age: 31']);
    // ticked again by hand: voice may keep it
    f.toggle('asthma');
    f.read('she has asthma');
    expect(f.form.v.medical.conditions).toContain('asthma');
  });

  it('Undo takes out only what voice filled: hand edits and answers stay', () => {
    const f = voiceForm();
    f.read('Asha Sample, G2 P1 L1 A0 previous sizerian, age thirty to');
    expect(f.form.v.obstetric.previousCaesareans).toBe('1');
    f.type('obstetric', 'gravida', '3');
    f.answer(f.question('Asha Sample, age thirty to', /^Age 30 or 32/), 'value:ageYears=32');
    f.read('Asha Sample, G2 P1 L1 A0 previous sizerian, age thirty to', ['sizerian']);
    expect(f.form.v).toMatchObject({ fullName: 'Asha Sample', ageYears: '32', obstetric: { gravida: '3', para: '1', previousCaesareans: '' } });
    expect(f.form.fromVoice.has('obstetric.previousCaesareans')).toBe(false);
  });

  it('never takes off ticks or notes that were in the form before (said on page 1)', () => {
    const one = voiceForm({ part: 'info' });
    one.read('Asha Sample, hypothyroid, twin pregnancy, asthma');
    const two = voiceForm({ part: 'clinical', dictated: one.form.later });
    expect(two.form.v).toMatchObject({ medical: { conditions: ['thyroid', 'asthma'] }, notes: 'Twin pregnancy' });
    two.read('hypo tyroid, azthma, twin pregnancy, epilepsy, Hb 10.5');
    expect(two.form.v.medical.conditions).toEqual(['thyroid', 'asthma', 'epilepsy']);
    // Undo on "hypo tyroid": page 1 said hypothyroid, so the tick stays
    two.read('hypo tyroid, azthma, twin pregnancy, epilepsy, Hb 10.5', ['hypo tyroid']);
    expect(two.form.v.medical.conditions).toEqual(['thyroid', 'asthma', 'epilepsy']);
    // words taken out of the box: page 1's note stays and keeps its mark; a tick only page 2 gave comes off
    two.read('azthma, Hb 10.5');
    expect(two.form.v.notes).toBe('Twin pregnancy');
    expect(two.form.fromVoice.has('notes')).toBe(true);
    expect(two.form.v.medical.conditions).toEqual(['thyroid', 'asthma']);
  });

  it('keeps answers about clinical details for the next page when the text is read again (page 1)', () => {
    const f = voiceForm({ part: 'info' });
    const said = 'Asha Sample age 28, HIV reactive, asthmatic';
    f.read(said);
    f.answer(f.question(said, /^HIV/), 'condition:hiv');
    f.read(`${said}, LMP 5 July 2026`);
    expect(f.form.later.values.medical.conditions).toEqual(expect.arrayContaining(['hiv', 'asthma']));
    expect(f.form.later.values.pregnancy.lmp).toBe('2026-07-05');
    // a reading that no longer gives asthma drops it; the answer stays
    f.read('Asha Sample age 28, HIV reactive');
    expect(f.form.later.values.medical.conditions).toEqual(['hiv']);
  });

  it('does not mark notes changed by hand "From voice" unless voice adds to them', () => {
    const current = { notes: 'Twins, DCDA', medical: {} };
    const r = read('Asha Sample, twin pregnancy');
    const keep = { skip: ['notes'], added: ['notes|twin pregnancy'], current };
    expect(dictatedFields(r.values, ['notes'], keep)).toEqual([]);
    const more = { ...r.values, notes: 'Twin pregnancy; CPD' };
    expect(dictatedFields(more, ['notes'], keep)).toEqual(['notes']);
    // not changed by hand: keeps its mark
    expect(dictatedFields(r.values, ['notes'], { current: { notes: 'Twin pregnancy', medical: {} } })).toEqual(['notes']);
  });
});

describe('what the summary says was filled (splitFound)', () => {
  const r = read('Asha Sample age 29, asthmatic and anaemic, LMP 5 March 2026, G2 P1 L1 A0, twin pregnancy');
  const current = { ageYears: '', pregnancy: { lmp: '' }, obstetric: {}, medical: { conditions: [] }, notes: '' };

  it('lists a value changed by hand as not changed, unless it is the same', () => {
    const a = splitFound(r.found, r.values, { skip: ['ageYears'] }, { ...current, ageYears: '30' });
    expect(lines(a.notChanged)).toEqual(['Age: 29']);
    expect(lines(a.filled)).not.toContain('Age: 29');
    const b = splitFound(r.found, r.values, { skip: ['ageYears'] }, { ...current, ageYears: '29' });
    expect(b.notChanged).toEqual([]);
    expect(lines(b.filled)).not.toContain('Age: 29');
    const lmp = splitFound(r.found, r.values, { skip: ['pregnancy.lmp'] }, { ...current, pregnancy: { lmp: '2026-03-06' } });
    expect(lines(lmp.notChanged)).toEqual(['LMP: 5 Mar 2026']);
  });

  it('splits ticks, the obstetric history and notes', () => {
    const a = splitFound(r.found, r.values, { unticked: ['medical.conditions.asthma'], skip: ['obstetric.gravida'], added: ['notes|twin pregnancy'] }, {
      ...current,
      obstetric: { gravida: '3' },
      notes: 'Seen with husband',
    });
    expect(lines(a.filled)).toEqual(['Full name: Asha Sample', 'Age: 29', 'LMP: 5 Mar 2026', 'Obstetric history: P1 L1 A0', 'Existing conditions: Anaemia']);
    expect(lines(a.notChanged)).toEqual(['Obstetric history: G2', 'Existing conditions: Asthma', 'Notes: Twin pregnancy']);
    // nothing left alone: the same list
    expect(splitFound(r.found, r.values, {}, current)).toEqual({ filled: r.found, notChanged: [] });
  });
});

describe('questions in order, at most 5 at a time (plan 1.7)', () => {
  it('results card, then safety checks, then "Did you mean …?"', () => {
    const r = extractPatientDetails('HIV reactive, HBsAg positive, VDRL reactive, wait 25, age ninety, height 5 2', { careType: 'antenatal', now, voice: true });
    expect(r.questions.map((q) => q.group)).toEqual(['confirm', 'confirm', 'confirm', 'safety', 'safety', 'other']);
    const { shown, more } = questionsToShow(r.questions);
    expect(shown.map((q) => q.prompt).join(' | ')).toMatch(/Age 90 or 19.*Height 5 feet 2 inches/);
    expect(more).toBe(1);
    expect(r.questions[5].prompt).toMatch(/Did you mean “weight”/);
    expect(questionsToShow(r.questions, true)).toEqual({ shown: r.questions, more: 0 });
  });
});

describe('words and short forms used in Indian OBGY practice', () => {
  it('reads a case-sheet style dictation', () => {
    const r = read(
      'Mrs Sunita Sample 28/F, G2P1L1A0, prev LSCS for CPD 3 years back, LMP 5/7/26, k/c/o hypothyroidism on Thyronorm 50 mcg, GDM on MNT, ' +
        'no h/o HTN/DM/asthma, HBsAg -ve, HIV NR, VDRL NR, blood group B +ve, wt 68 kg, allergic to sulpha, twins DCDA',
    );
    expect(r.values).toMatchObject({
      fullName: 'Sunita Sample',
      ageYears: '28',
      pregnancy: { lmp: '2026-07-05' },
      obstetric: { gravida: '2', para: '1', living: '1', abortions: '0', previousCaesareans: '1' },
      medical: { conditions: ['thyroid'], bloodGroup: 'B+', weightKg: '68', allergies: 'Sulpha' },
      notes:
        'Previous LSCS for CPD 3 years back; CPD (cephalopelvic disproportion); Gestational diabetes (this pregnancy); ' +
        'HBsAg negative, HIV non-reactive, VDRL non-reactive; Twin pregnancy',
    });
    expect(r.questions).toEqual([]);
  });

  it('writes conditions without a tick box in "Other conditions"', () => {
    const r = read('Lata Sample 45 yrs, P2L2, tubectomy done, fibroid uterus, k/c/o DM on metformin and HTN on amlodipine, PCOD', 'gynaecology');
    expect(r.values.obstetric).toEqual({ para: '2', living: '2' });
    expect(r.values.medical.conditions).toEqual(['diabetes', 'hypertension']);
    expect(r.values.medical.otherConditions).toBe('Previous sterilisation; Fibroid uterus; PCOS');
    expect(r.questions).toEqual([]); // the metformin and amlodipine are explained by DM and HTN
  });

  it('asks what a medicine is for when the reason was not said', () => {
    const q = read('on metformin').questions[0];
    expect(q.options.map((o) => o.value)).toEqual(['condition:diabetes', 'other:PCOS', 'note:Gestational diabetes on metformin (this pregnancy)', 'ignore']);
    expect(read('PIH on labetalol').values.notes).toBe('Gestational hypertension / PIH (this pregnancy)');
    expect(read('PIH on labetalol').questions).toEqual([]);
  });

  it('tells a previous pregnancy from this one', () => {
    expect(read('IUGR in previous pregnancy').values.obstetric.pastComplications).toEqual(['low_birth_weight_baby']);
    expect(read('previous LSCS, now with IUGR').values.notes).toBe('Fetal growth restriction (this pregnancy)');
    expect(read('h/o PPH').values.obstetric.pastComplications).toEqual(['pph']);
    expect(read('PPH').values.obstetric.pastComplications).toEqual(['pph']); // can't be this pregnancy yet
    const postnatal = read('delivered yesterday, PPH', 'postnatal');
    expect(postnatal.questions[0].options.map((o) => o.value)).toEqual(['past:pph', 'note:PPH (this delivery)', 'ignore']);
    expect(postnatal.questions[0].remember).toBe(false);
  });

  it('reads Indian test-result shorthand', () => {
    expect(read('HIV NR, VDRL non reactive, HBsAg negative').values.medical).toBeUndefined();
    expect(read('RVD positive').questions).toMatchObject([{ group: 'confirm', options: [{ value: 'condition:hiv' }, { value: 'ignore' }, { value: 'ignore' }] }]);
    expect(read('ICT negative').values.notes).toBe('ICT negative');
  });

  it('understands a little Hinglish', () => {
    const { values } = read('Pooja Sample, 24 saal, pehli pregnancy, sugar nahi hai, thyroid ki goli le rahi hai');
    expect(values).toMatchObject({ fullName: 'Pooja Sample', ageYears: '24', obstetric: { gravida: '1' }, medical: { conditions: ['thyroid'] } });
  });

  it('reads B/O and BW for a newborn', () => {
    const r = read('B/O Kavita Sample, male child, born at 10:40 am today by LSCS, BW 2.8 kg, APGAR 8/9, cried immediately', 'newborn');
    expect(r.values).toMatchObject({ fullName: 'Baby of Kavita Sample', newborn: { birthAt: '2026-09-28T10:40', birthWeightGrams: '2800', sex: 'male' } });
    expect(r.unused.map((u) => u.text)).toEqual(['cried immediately']);
  });

  it("does not tick a husband's illness, but records male-factor infertility", () => {
    expect(read('husband is diabetic').values.medical).toBeUndefined();
    expect(read('husband semen analysis shows oligospermia', 'infertility').values.medical.otherConditions).toBe('Male factor infertility');
  });
});

describe('questions, and each doctor’s own words', () => {
  it('asks about a short form it does not know, so the doctor can teach it', () => {
    const q = read('known XYZ').questions[0];
    expect(q).toMatchObject({ heard: 'XYZ', key: 'xyz', remember: true, teach: true });
  });

  it('suggests the word that was probably meant', () => {
    const q = read('k/c/o diabeties').questions[0];
    expect(q).toMatchObject({ heard: 'diabeties', key: 'diabeties', remember: true, prompt: 'Did you mean “diabetes”?' });
    expect(q.options.map((o) => o.value)).toEqual(['condition:diabetes', 'ignore']);
    // A problem that could be this pregnancy or a previous one: the answer is not remembered as the word's meaning
    expect(read('eclamsia in last pregnancy').questions[0]).toMatchObject({ remember: false, options: [{ value: 'past:pre_eclampsia' }, { value: 'ignore' }] });
  });

  it("uses the doctor's own words", () => {
    const words = [
      { phrase: 'asma', meaning: 'condition:asthma' },
      { phrase: 'xyz', meaning: 'ignore' },
      { phrase: 'b rh', meaning: 'bloodgroup' },
      { phrase: 'edd', meaning: 'scanedd' },
      { phrase: 'height n.n', meaning: 'height-ftin' },
    ];
    const r = extractPatientDetails('asma since childhood, known XYZ, B positive, EDD 20 April 2027, height 5.2', { careType: 'antenatal', now, words });
    expect(r.values).toMatchObject({ pregnancy: { scanEdd: '2027-04-20' }, medical: { conditions: ['asthma'], bloodGroup: 'B+', heightCm: '157.5' } });
    expect(r.questions).toEqual([]);
    expect(r.found.find((f) => f.label === 'Existing conditions').text).toBe('Asthma (your word)');
    // … but not when it was said with "no"
    expect(extractPatientDetails('no asma', { careType: 'antenatal', now, words }).values.medical).toBeUndefined();
  });

  it('asks about "B positive" said without "blood group", and about a height like 5.2', () => {
    const r = read('B positive, height 5.2');
    expect(r.questions.map((q) => q.key)).toEqual(['b rh', 'height n.n']);
    expect(r.values.medical).toBeUndefined();
  });

  it('turns an answer into form values', () => {
    const q = read('height 5.2').questions[0];
    expect(answerToResult(q, 'height-ftin', 'antenatal')).toMatchObject({ values: { medical: { heightCm: '157.5' } }, paths: ['medical.heightCm'] });
    expect(answerToResult(null, 'note:Complains of white discharge', 'gynaecology')).toMatchObject({ values: { notes: 'Complains of white discharge' }, paths: ['notes'] });
    expect(answerToResult(null, 'ignore', 'antenatal').paths).toEqual([]);
  });

  it('lists what it did not understand – but never offers the baby’s sex for the notes in a pregnancy', () => {
    const r = read('Asha Sample, 28 years, complains of white discharge, baby is a boy, mild pallor noted');
    // why she came goes to the notes (owner, 14 Oct 2026); the baby's sex never does
    expect(r.values.notes).toBe('Reason for visit: white discharge');
    expect(r.unused).toMatchObject([
      { text: 'baby is a boy', canNote: false, sex: true },
      { text: 'mild pallor noted', canNote: true },
    ]);
  });

  it('combines what was said with the answers given', () => {
    const said = read('diabetic, LMP 12 July 2026');
    const answer = answerToResult(null, 'condition:asthma', 'antenatal');
    const both = combineDictated(said, answer);
    expect(both.values.medical.conditions).toEqual(['diabetes', 'asthma']);
    expect(both.paths).toEqual(['pregnancy.lmp', 'medical.conditions']);
  });
});

describe('negative screening results: only a result said with its test', () => {
  const voiced = (text) => extractPatientDetails(text, { careType: 'antenatal', now, words: [], voice: true });
  it('a test not done, pending, sent, awaited, doubtful or the husband’s is never noted as negative', () => {
    for (const read2 of [read, voiced]) {
      for (const [text, notes] of [
        ['HIV test not done VDRL negative', 'VDRL negative'],
        ['HIV indeterminate VDRL negative', 'VDRL negative'],
        ['HIV report awaited HBsAg negative', 'HBsAg negative'],
        ['HIV sent VDRL negative', 'VDRL negative'],
        ['HIV to be done HBsAg non-reactive', 'HBsAg non-reactive'],
        ['HIV, HBsAg pending, VDRL negative', 'VDRL negative'],
        ['HIV of husband pending VDRL negative', undefined],
        ['HBsAg negative in previous pregnancy now reactive', undefined],
        ['HIV negative earlier now reactive', undefined],
        ['HIV non-reactive no reactive', undefined],
        ['HIV negative no positive', undefined],
      ]) {
        expect(read2(text).values.notes, text).toBe(notes);
      }
    }
  });

  it('a reactive result said after the negative one is asked in the confirmation card', () => {
    for (const [text, test] of [
      ['HIV non-reactive no reactive', 'HIV'],
      ['HIV negative no positive', 'HIV'],
      ['HIV negative earlier now reactive', 'HIV'],
      ['HBsAg negative in previous pregnancy now reactive', 'HBsAg'],
    ]) {
      const q = voiced(text).questions.find((x) => x.group === 'confirm');
      expect(q?.prompt, text).toBe(`${test}: reactive (positive) or non-reactive (negative)?`);
    }
  });

  it('still notes the results said together or with joining words', () => {
    expect(read('HIV, HBsAg and VDRL negative').values.notes).toBe('HIV negative, HBsAg negative, VDRL negative');
    expect(read('HIV 1 and 2 non reactive').values.notes).toBe('HIV non-reactive');
    expect(read('HIV 1 and 2 non reactive').unused).toEqual([]);
    expect(voiced('Hiv non-reactive hbs AG non-reactive vdrl non-reactive').values.notes).toBe('HIV non-reactive, HBsAg non-reactive, VDRL non-reactive');
    const r = voiced('HIV non reactive HBsAg reactive');
    expect(r.values.notes).toBe('HIV non-reactive');
    expect(r.questions.find((q) => q.group === 'confirm').prompt).toBe('HBsAg reactive (positive) – is that right?');
  });
});

describe('an abortion said with how long ago', () => {
  it('is a note, never the count', () => {
    for (const [text, note] of [
      ['previous abortion 2 years back', 'Previous abortion 2 years back'],
      ['previous miscarriage 3 years back', 'Previous miscarriage 3 years back'],
      ['previous MTP 3 years back', 'Previous MTP 3 years back'],
      ['previous abortion 3 years ago', 'Previous abortion 3 years ago'],
    ]) {
      const r = read(text);
      expect(r.values.obstetric?.abortions, text).toBeUndefined();
      expect(r.values.notes, text).toBe(note);
      expect(r.unused, text).toEqual([]);
    }
  });

  it('keeps the count said in the formula or before the word', () => {
    expect(read('G3P1A1 previous abortion 2 years back').values).toMatchObject({ obstetric: { abortions: '1' }, notes: 'Previous abortion 2 years back' });
    expect(read('G3 P1 L1 A1 previous miscarriage 2 years back').values).toMatchObject({ obstetric: { abortions: '1' }, notes: 'Previous miscarriage 2 years back' });
    for (const text of ['1 abortion 2 years back', 'one abortion 2 years back']) {
      expect(read(text).values, text).toEqual({ obstetric: { abortions: '1' }, notes: '1 abortion 2 years back' });
    }
    for (const [text, n] of [['abortions 2', '2'], ['2 abortions', '2'], ['miscarriage - 1', '1'], ['no abortions', '0']]) {
      expect(read(text).values.obstetric.abortions, text).toBe(n);
    }
  });

  it('"no previous LSCS … years back" is not a previous caesarean note', () => {
    const r = read('no previous LSCS 3 years back normal delivery');
    expect(r.values.obstetric.previousCaesareans).toBe('0');
    expect(r.values.notes).toBeUndefined();
  });
});
