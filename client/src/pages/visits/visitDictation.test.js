// Voice entry for a visit: what the visit reader fills, asks and leaves out, and how a new reading fills the form
// again without undoing the doctor's own work (fake sample data only).
import { describe, expect, it } from 'vitest';
import { hearingPhrases } from '../patients/obgyTerms.js';
import {
  PREGNANCY_CHECK_PATHS,
  VISIT_VOICE_PATHS,
  extractVisitDetails,
  newVisitFillMemory,
  noteVisitHandEdit,
  planVisitFill,
  visitAnswer,
  visitHearing,
} from './visitDictation.js';

const VISIT_ON = '2026-09-29T00:00:00.000Z'; // a Tuesday
const read = (text, more = {}) => extractVisitDetails(text, { careType: 'antenatal', visitOn: VISIT_ON, ...more });

describe('vital signs', () => {
  it('fills each vital sign said with its name', () => {
    const r = read('Weight sixty two kg. BP one twenty by eighty. Pulse eighty eight. Temperature ninety eight point six. SpO2 ninety nine percent. Hb ten point eight. Urine albumin nil, sugar nil.');
    expect(r.values.vitals).toEqual({ weightKg: '62', bpSystolic: '120', bpDiastolic: '80', pulse: '88', temperatureF: '98.6', spo2: '99', hb: '10.8', urineAlbumin: 'nil', urineSugar: 'nil' });
    expect(r.found.map((f) => `${f.label}: ${f.text}`)).toContain('Blood pressure: 120/80 mmHg');
    expect(r.questions).toEqual([]);
    expect(r.unused).toEqual([]);
  });

  it('hears Indian English words and numbers', () => {
    expect(read('wait 58 kilo, BP hundred and ten upon seventy').values.vitals).toEqual({ weightKg: '58', bpSystolic: '110', bpDiastolic: '70' });
    const r = read('BP one tirty by eighty, H B 9 point 8 grams');
    expect(r.values.vitals).toEqual({ bpSystolic: '130', bpDiastolic: '80', hb: '9.8' });
    // A number's correction has no Undo: the number is changed in the form itself
    expect(r.corrections).toContainEqual(expect.objectContaining({ heard: 'tirty', to: 'thirty', undo: false }));
  });

  it('keeps a word as heard after Undo', () => {
    expect(read('wait 58 kilo').corrections).toHaveLength(1);
    expect(read('wait 58 kilo', { keep: ['wait 58 kilo'] }).corrections).toEqual([]);
  });

  it('takes a correction said while speaking, and asks when a detail was said with two values', () => {
    const r = read('BP 110/70, BP 130/90. Pulse 88 sorry 92.');
    expect(r.values.vitals).toEqual({ pulse: '92' });
    expect(r.notes).toContain('Corrected while speaking: pulse 88/min → 92/min.');
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]).toMatchObject({ prompt: 'Blood pressure: 110/70 mmHg or 130/90 mmHg?', paths: ['vitals.bpSystolic', 'vitals.bpDiastolic'], group: 'other', remember: false });
    expect(r.questions[0].options.map((o) => o.label)).toEqual(['110/70 mmHg', '130/90 mmHg', 'Leave blank']);
  });

  it('asks before writing a temperature said in °C as °F, and leaves out a value that does not look right', () => {
    const r = read('temp 37.8, pulse 400');
    expect(r.questions.map((q) => q.prompt)).toEqual(['Temperature 37.8 °C is 100 °F. Use 100 °F?']);
    expect(r.values.vitals).toEqual({});
    expect(r.notes).toContain("The pulse heard (400/min) doesn't look right, so it was not used.");
  });
});

describe('the pregnancy check', () => {
  it('is read in antenatal visits', () => {
    const r = read('FH twenty eight centimetres, FHS one forty four per minute, cephalic, FM present, no pedal oedema.');
    expect(r.values.details).toEqual({ fundalHeightCm: '28', fetalHeartRate: '144', presentation: 'cephalic', fetalMovements: 'present', oedema: 'none' });
  });

  it('asks about what was said in weeks or without a grade', () => {
    const r = read('fundal height 30 weeks. pedal oedema present. FM.');
    expect(r.questions.map((q) => q.prompt)).toEqual(['Fundal height 30 weeks: write 30 cm?', 'Fetal movements: present, reduced or absent?', 'Oedema: how much?']);
    expect(r.paths).toEqual([]);
  });

  it('is not read in other visits, where the form does not show it', () => {
    const r = read('BP 120/80. Examination FHS 140, cephalic.', { careType: 'gynaecology' });
    expect(r.paths.filter((p) => PREGNANCY_CHECK_PATHS.includes(p))).toEqual([]);
    expect(r.values.vitals).toEqual({ bpSystolic: '120', bpDiastolic: '80' });
  });
});

describe('the doctor’s notes and the next visit', () => {
  it('puts what is said under a heading in its place, a line each', () => {
    const r = read(
      'c/o pain abdomen since 2 days. On examination pallor present, PA soft. Diagnosis mild anaemia. Advised CBC, urine routine and rest. Advice iron rich diet. Next visit after 2 weeks with reports.',
    );
    expect(r.values.details).toEqual({
      complaints: 'Pain abdomen since 2 days',
      examination: 'Pallor present, PA soft',
      diagnosis: 'Mild anaemia',
      investigations: 'CBC, urine routine',
      advice: 'Rest\nIron rich diet',
      nextVisitOn: '2026-10-13',
      nextVisitNote: 'With reports',
    });
    expect(r.found.find((f) => f.label === 'Advice for the patient').text).toBe('Rest; Iron rich diet');
  });

  it('reads the next visit the ways it is said', () => {
    const next = (t) => read(t).values.details.nextVisitOn;
    expect(next('Review after 10 days.')).toBe('2026-10-09');
    expect(next('Follow up after 1 month.')).toBe('2026-10-29');
    expect(next('Next visit next Monday.')).toBe('2026-10-05');
    expect(next('Review on 15th October.')).toBe('2026-10-15');
    expect(next('Come back after a fortnight.')).toBe('2026-10-13');
  });

  it('takes "review" or "come back" as the next visit only with a date, SOS or what to bring', () => {
    expect(read('Private note review scan. Review SOS.').values.details).toEqual({ privateNote: 'Review scan', nextVisitNote: 'SOS' });
    expect(read('Advised rest, come back if bleeding. Come back next Monday with the scan.').values.details).toEqual({
      advice: 'Rest, come back if bleeding',
      nextVisitOn: '2026-10-05',
      nextVisitNote: 'With the scan',
    });
  });

  it('does not use a next visit that is not after this one', () => {
    const r = read('Next visit on 1st September.');
    expect(r.values.details.nextVisitOn).toBeUndefined();
    expect(r.notes).toContain('The next visit heard (1 Sep 2026) is not after this visit, so it was not used.');
  });

  it('writes "No complaints", and keeps a private note apart', () => {
    const r = read('No complaints. Private note husband worried about cost.');
    expect(r.values.details).toEqual({ complaints: 'No complaints', privateNote: 'Husband worried about cost' });
    expect(r.found.find((f) => f.label === 'Private note').part).toBe('private');
  });

  it('lists what it did not understand, with where it was said', () => {
    const r = read('Patient came with her husband. Pallor present.');
    expect(r.unused).toEqual([{ text: 'Patient came with her husband', note: 'Patient came with her husband', canNote: true, start: 0 }]);
    expect(r.values.details.examination).toBe('Pallor present');
  });
});

describe('the baby’s sex (PCPNDT)', () => {
  it('is never written for a patient who is not a newborn', () => {
    for (const careType of ['antenatal', 'gynaecology']) {
      const r = read('Complaints mild backache. Diagnosis it is a baby boy. Advice rest.', { careType });
      expect(JSON.stringify(r.values)).not.toMatch(/boy/i);
      expect(r.unused.filter((u) => u.sex)).toHaveLength(1);
      expect(r.values.details).toMatchObject({ complaints: 'Mild backache', advice: 'Rest' });
    }
  });

  it('may be written for a newborn', () => {
    expect(read('Weight 3.1 kg. Examination healthy baby boy.', { careType: 'newborn' }).values).toEqual({ vitals: { weightKg: '3.1' }, details: { examination: 'Healthy baby boy' } });
  });
});

describe('answers', () => {
  it('fill the chosen value, or add a part not understood to a note', () => {
    expect(visitAnswer(null, 'set:vitals.bpSystolic=110&vitals.bpDiastolic=70')).toMatchObject({ paths: ['vitals.bpSystolic', 'vitals.bpDiastolic'], values: { vitals: { bpSystolic: '110', bpDiastolic: '70' } } });
    expect(visitAnswer(null, 'note:examination:Patient came with her husband').values.details).toEqual({ examination: 'Patient came with her husband' });
    expect(visitAnswer(null, 'note:fundalHeightCm:28').paths).toEqual([]); // only a note takes words
    expect(visitAnswer(null, 'ignore').paths).toEqual([]);
  });
});

describe('filling the form again', () => {
  const EMPTY = { vitals: { weightKg: '', bpSystolic: '', bpDiastolic: '', pulse: '' }, details: { complaints: '', investigations: '', advice: '' } };
  const ALL = ['vitals.weightKg', 'vitals.bpSystolic', 'vitals.bpDiastolic', 'vitals.pulse', 'details.complaints', 'details.investigations', 'details.advice'];
  // One form: its values, its "From voice" marks and what it remembers between fills
  const newForm = (form = EMPTY) => {
    const memory = newVisitFillMemory();
    const state = { form, marks: new Set() };
    const fill = (result, { reading = true, usable = ALL } = {}) => {
      const plan = planVisitFill(memory, result, { reading, usable, form: state.form, fromVoice: state.marks });
      state.form = plan.form;
      state.marks = plan.marks;
      return plan;
    };
    const byHand = (path, value) => {
      const [part, key] = path.split('.');
      state.form = { ...state.form, [part]: { ...state.form[part], [key]: value } };
      noteVisitHandEdit(memory, [path]);
      state.marks.delete(path);
    };
    return { state, fill, byHand };
  };

  it('does not add what is already written, as whole words', () => {
    const { state, fill } = newForm({ ...EMPTY, details: { ...EMPTY.details, advice: 'Rest on the left side', investigations: 'Interest in CBC' } });
    fill(read('Advised rest and CBC. Advised iron rich diet.'));
    expect(state.form.details).toEqual({ complaints: '', investigations: 'Interest in CBC', advice: 'Rest on the left side\nIron rich diet' });
    fill(read('Advice interest free'));
    expect(state.form.details.advice).toBe('Rest on the left side\nInterest free');
    fill(read('Pulse 80')); // no longer said: what was written before stays, without the "From voice" mark
    expect(state.form.details).toEqual({ complaints: '', investigations: 'Interest in CBC', advice: 'Rest on the left side' });
    expect([...state.marks]).toEqual(['vitals.pulse']);
  });

  it('adds notes to what is written, each line once, and marks what voice filled', () => {
    const { state, fill } = newForm({ ...EMPTY, details: { ...EMPTY.details, complaints: 'Backache for a week' } });
    fill(read('Pulse 88. Complaints headache.'));
    fill(read('Pulse 88. Complaints headache.')); // the same text read again
    expect(state.form.details.complaints).toBe('Backache for a week\nHeadache');
    expect([...state.marks]).toEqual(['vitals.pulse', 'details.complaints']);
    fill(read('Pulse 88. Complaints headache. Complaints vomiting.')); // more said
    expect(state.form.details.complaints).toBe('Backache for a week\nHeadache\nVomiting');
  });

  it('never changes what was changed by hand, and says what was not used', () => {
    const { state, fill, byHand } = newForm();
    fill(read('Pulse 88. Complaints mild backache. Complaints headache.'));
    byHand('vitals.pulse', '90');
    byHand('details.complaints', 'Headache'); // "Mild backache" taken out
    const plan = fill(read('Pulse 88. Complaints mild backache. Complaints headache. Weight 60 kg.'));
    expect(state.form.vitals).toMatchObject({ pulse: '90', weightKg: '60' });
    expect(state.form.details.complaints).toBe('Headache');
    expect(plan.notChanged.map((f) => `${f.label}: ${f.text}`)).toEqual(['Pulse: 88/min', 'Complaints: Mild backache']);
    expect(plan.here.map((f) => `${f.label}: ${f.text}`)).toEqual(['Weight: 60 kg', 'Complaints: Headache']);
    expect(state.marks.has('vitals.pulse')).toBe(false);
  });

  it('takes out what a new reading no longer gives, but never what was there before', () => {
    const { state, fill } = newForm({ ...EMPTY, vitals: { ...EMPTY.vitals, weightKg: '59' } });
    fill(read('Weight 60 kg. Advised rest.'));
    expect(state.form).toMatchObject({ vitals: { weightKg: '60' }, details: { advice: 'Rest' } });
    fill(read('Advised plenty of fluids.')); // the weight taken out of the text, the advice changed
    expect(state.form).toMatchObject({ vitals: { weightKg: '59' }, details: { advice: 'Plenty of fluids' } });
    expect(state.marks.has('vitals.weightKg')).toBe(false);
    fill(read('temp 37.8')); // only a question now: nothing left from voice
    expect(state.form.details.advice).toBe('');
    expect([...state.marks]).toEqual([]);
  });

  it('knows every field it can fill', () => {
    const r = read(
      'Weight 60 kg, BP 120/80, pulse 88, temperature 98.6, SpO2 99, Hb 11, urine albumin nil, sugar nil, fundal height 28, FHR 140, cephalic, FM present, no oedema. ' +
        'Complaints backache. On examination PA soft. Diagnosis anaemia. Advised CBC and rest. Private note review scan. Next visit after 2 weeks with reports.',
    );
    expect([...r.paths].sort()).toEqual([...VISIT_VOICE_PATHS].sort());
  });

  it('uses an answer even over a change by hand', () => {
    const { state, fill, byHand } = newForm();
    byHand('vitals.pulse', '90');
    fill(visitAnswer(null, 'set:vitals.pulse=92'), { reading: false });
    expect(state.form.vitals.pulse).toBe('92');
    expect(state.marks.has('vitals.pulse')).toBe(true);
    fill(visitAnswer(null, 'note:complaints:Came with her husband'), { reading: false });
    expect(state.form.details.complaints).toBe('Came with her husband');
  });

  it('fills only what the person may enter', () => {
    const { state, fill } = newForm();
    const plan = fill(read('Weight 61 kg. Diagnosis anaemia.'), { usable: ['vitals.weightKg'] });
    expect(state.form).toEqual({ ...EMPTY, vitals: { ...EMPTY.vitals, weightKg: '61' } });
    expect(plan.here.map((f) => f.label)).toEqual(['Weight']);
  });
});

describe('the words Chrome is told to expect', () => {
  it('puts the visit’s words first, then all of registration’s, each once', () => {
    const anc = visitHearing('antenatal');
    expect(anc[0]).toEqual({ text: 'fundal height', boost: 2 });
    expect(anc.length).toBeLessThanOrEqual(300); // the usual advice for Chrome
    expect(new Set(anc.map((p) => p.text.toLowerCase())).size).toBe(anc.length);
    const words = new Set(anc.map((p) => p.text.toLowerCase()));
    expect(hearingPhrases('antenatal').filter((p) => !words.has(p.text.toLowerCase()))).toEqual([]); // e.g. the Hindi words
    expect(visitHearing('newborn').some((p) => p.text === 'fundal height')).toBe(false);
  });
});
