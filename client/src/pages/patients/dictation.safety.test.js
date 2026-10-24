// Voice entry: safety of what is read from dictation (plan 4.3, all fake sample data). Each case gives the right
// value, or leaves it empty with a question or a note – never a wrong value filled in silently.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerToResult, checkRanges, extractPatientDetails, meaningLabel, withoutFetalSex } from './dictation.js';
import { applySelfCorrections, findProtectedSpans } from './indianEnglish.js';
import { hearingPhrases } from './obgyTerms.js';
import { createVoiceSession } from './voiceSession.js';
import { mentionsFetalSex } from '../../pcpndtWords.js';

const now = new Date(2026, 8, 28, 11, 30); // 28 Sep 2026, 11:30
const voice = (text, careType = 'antenatal', words = []) => extractPatientDetails(text, { careType, now, words, voice: true });
const ticks = (r) => [...(r.values.medical?.conditions ?? []), ...(r.values.obstetric?.pastComplications ?? [])];
const asked = (r, rx) => r.questions.find((q) => rx.test(`${q.prompt} | ${q.heard} | ${q.options.map((o) => o.label).join(' | ')}`));
const told = (r, rx) => r.notes.some((n) => rx.test(n));
const typed = (text, careType = 'antenatal') => extractPatientDetails(text, { careType, now });

describe('results are confirmed, never ticked silently', () => {
  it('asks about a reactive or positive result, with no "Remember"', () => {
    for (const text of ['HIV reactive', 'VDRL positive', 'HBsAg positive', 'known case of HIV']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      const q = r.questions[0];
      expect(q, text).toMatchObject({ group: 'confirm', remember: false, key: null });
      expect(q.options.map((o) => o.label)).toEqual(['Yes, reactive', 'No, non-reactive', 'Leave blank']);
    }
    expect(answerToResult(voice('HIV reactive').questions[0], 'condition:hiv', 'antenatal').values.medical.conditions).toEqual(['hiv']);
  });

  it('typed text is confirmed too: a reactive result in a long referral line is never ticked', () => {
    const text = 'referred from PHC Demo Nagar by Dr Sample, G3 P2 L2, 26 weeks, LMP 25th March 2026, Australia antigen reactive';
    for (const r of [typed(text), voice(text)]) {
      expect(ticks(r)).toEqual([]);
      expect(asked(r, /Australia antigen reactive \(positive\) – is that right/)).toMatchObject({ group: 'confirm', remember: false });
      expect(r.values.obstetric).toMatchObject({ gravida: '3', para: '2', living: '2' });
    }
    for (const text of ['VDRL positive', 'HIV reactive', 'anti HCV positive']) expect(ticks(typed(text)), text).toEqual([]);
    expect(typed('HIV, VDRL, HBsAg non reactive').questions).toEqual([]);
  });

  it('never ticks "none reactive" or "nan reactive": after a test name it is non-reactive (plan 2.3 step 5)', () => {
    for (const text of ['HIV none reactive', 'VDRL nan reactive', 'VDRL none reactive, HIV nan reactive, HBsAg known reactive']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
    }
    for (const text of ['HIV none reactive', 'VDRL nan reactive', 'HIV, VDRL, HBsAg none reactive', 'hepatitis C none reactive']) {
      const r = voice(text);
      expect(r.questions, text).toEqual([]);
      expect(r.corrections, text).toContainEqual(expect.objectContaining({ to: 'non-reactive', rule: 'result' }));
    }
    expect(asked(voice('HBsAg known reactive'), /HBsAg/)).toMatchObject({ group: 'confirm' });
  });

  it('asks a doubtful result both ways, showing every word heard (never "is that right?")', () => {
    for (const text of ['HBsAg known reactive', 'HIV on reactive', 'HIV non positive', 'HIV none positive', 'RPR nan positive']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      const q = r.questions.find((x) => x.group === 'confirm');
      expect(q, text).toMatchObject({ heard: text, remember: false, prompt: expect.stringMatching(/: reactive \(positive\) or non-reactive \(negative\)\?$/) });
      expect(q.options.map((o) => o.label)).toEqual(['Reactive', 'Non-reactive', 'Leave blank']);
    }
    const all = voice('VDRL none reactive, HIV nan reactive, HBsAg known reactive');
    expect(all.questions.map((q) => q.heard)).toEqual(['HBsAg known reactive']);
    expect(all.questions.some((q) => /is that right/.test(q.prompt))).toBe(false);
    expect(voice('RVD none reactive', 'antenatal', [{ phrase: 'rvd', meaning: 'condition:hiv' }]).questions[0].heard).toBe('RVD none reactive');
    // typed text asks too, and "non reactive" is still non-reactive
    expect(ticks(typed('HIV none reactive'))).toEqual([]);
    expect(asked(typed('HIV non positive'), /Positive or negative/)).toBeTruthy();
    expect(voice('HIV non reactive').questions).toEqual([]);
    expect(voice('HIV reactive').questions[0].options.map((o) => o.label)).toEqual(['Yes, reactive', 'No, non-reactive', 'Leave blank']);
  });

  it('hepatitis C is a result too, also when it is the doctor\'s own word', () => {
    for (const text of ['hepatitis C positive', 'anti HCV reactive', 'hepatitis C known reactive', 'hepatitis C none positive']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(r.questions[0], text).toMatchObject({ group: 'confirm', remember: false });
    }
    expect(voice('hepatitis C negative').questions).toEqual([]);
    expect(ticks(voice('HCB reactive', 'antenatal', [{ phrase: 'hcb', meaning: 'condition:liver_disease' }]))).toEqual([]);
    expect(asked(voice('HCB reactive', 'antenatal', [{ phrase: 'hcb', meaning: 'condition:liver_disease' }]), /HCB/)).toMatchObject({ group: 'confirm' });
    expect(ticks(voice('fatty liva', 'antenatal', [{ phrase: 'fatty liva', meaning: 'condition:liver_disease' }]))).toEqual(['liver_disease']);
  });

  it('no question in the confirmation card offers "Remember"', () => {
    for (const text of ['B positive', 'A negative', 'VDRL positive, B positive', 'Rh negative', 'HIV reactive', 'blood group B positive no sorry B negative']) {
      const card = voice(text).questions.filter((q) => q.group === 'confirm');
      expect(card.length, text).toBeGreaterThan(0);
      for (const q of card) expect(q.remember, `${text}: ${q.prompt}`).toBe(false);
    }
    // a saved "not a blood group" does not hide it from the card
    expect(asked(voice('B positive', 'antenatal', [{ phrase: 'b rh', meaning: 'ignore' }]), /Blood group B\+/)).toMatchObject({ group: 'confirm' });
  });

  it('a doctor\'s own "known → ignore" cannot stop the "known reactive" question', () => {
    const r = voice('HBsAg known reactive', 'antenatal', [{ phrase: 'known', meaning: 'ignore' }]);
    expect(asked(r, /HBsAg/)).toBeTruthy();
    // … and a learned word for a test is still confirmed
    expect(ticks(voice('RVD positive', 'antenatal', [{ phrase: 'rvd', meaning: 'condition:hiv' }]))).toEqual([]);
  });

  it('a finding said in a list of tests takes the list\'s result: a negative screen never ticks it', () => {
    for (const text of [
      'HIV syphilis HBsAg negative',
      'syphilis, HIV, HBsAg all negative',
      'syphilis HIV HBsAg non reactive',
      'syphilis and HIV negative',
      'syphilis test VDRL negative',
      'syphilis, VDRL negative',
      'syphilis VDRL negative',
      'syphilis RPR negative',
      'syphilis screening VDRL non reactive',
      'screened for syphilis VDRL negative',
      'tested for syphilis VDRL non-reactive',
      'tuberculosis and HIV negative',
      'TB, HIV negative',
      'TB HIV negative',
      'liver disease HCV negative',
      'jaundice HBsAg negative',
      'thyroid HIV negative',
    ]) {
      for (const r of [voice(text), typed(text)]) expect(ticks(r), text).toEqual([]);
    }
    // after a treatment word, a test's result is that test's
    expect(ticks(voice('history of syphilis treated, VDRL non reactive now'))).toEqual(['syphilis']);
    expect(ticks(voice('TB treated, HIV negative'))).toEqual(['tuberculosis']);
    expect(voice('anti D given at 28 weeks ICT negative').values.notes).toBe('Anti-D given at 28 weeks; ICT negative');
  });

  it('keeps the result words of the last unfinished phrase at Stop, and still asks', () => {
    vi.useFakeTimers();
    const made = [];
    class FakeRecognition {
      constructor() {
        made.push(this);
      }
      start() {}
      stop() {
        this.onend?.({});
      }
      abort() {}
    }
    Object.defineProperty(FakeRecognition.prototype, 'processLocally', {
      get() {
        return Boolean(this.local);
      },
      set(v) {
        this.local = v;
      },
    });
    let ended = null;
    const session = createVoiceSession({
      Recognition: FakeRecognition,
      lang: 'en-IN',
      phrases: [],
      onState: () => {},
      onText: () => {},
      onEnd: (e) => {
        ended = e;
      },
      isHidden: () => false,
      visibility: new EventTarget(),
      nav: { userAgentData: { brands: [{ brand: 'Google Chrome', version: '150' }] } },
      log: { info() {}, warn() {}, log() {}, error() {} },
    });
    session.start('');
    made[0].onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Asha Sample age 28' }, length: 1 }, { isFinal: false, 0: { transcript: 'HIV reactive' }, length: 1 }] });
    session.stop();
    vi.runAllTimers();
    vi.useRealTimers();
    expect(ended.text).toMatch(/HIV reactive/);
    const r = voice(ended.text);
    expect(ticks(r)).toEqual([]);
    expect(asked(r, /HIV reactive/)).toMatchObject({ group: 'confirm' });
  });
});

describe('the blood group heard by voice', () => {
  // Owner's decision (2026-09-30): said plainly and once, it is filled in (marked "From voice"); otherwise asked
  it('said plainly: filled in', () => {
    expect(voice('blood group B negative').values.medical.bloodGroup).toBe('B-');
    expect(voice('blood group B positive').questions).toEqual([]);
  });

  it('unclear ("oh", letters, two groups said): shown in the card instead of filling it', () => {
    const r = voice('blood group oh negative');
    expect(r.values.medical).toBeUndefined();
    const q = asked(r, /Blood group O-/);
    expect(q).toMatchObject({ group: 'confirm', remember: false });
    expect(answerToResult(q, q.options[0].value, 'antenatal').values.medical.bloodGroup).toBe('O-');
    expect(voice('blood group O positive husband blood group B negative').values.medical).toBeUndefined();
  });

  it('typed text (not voice) is filled as before', () => {
    expect(extractPatientDetails('blood group B negative', { careType: 'antenatal', now }).values.medical.bloodGroup).toBe('B-');
  });

  it('reads letters said one by one, longest short form first', () => {
    const r = voice('l s c s b positive');
    expect(r.values.medical?.bloodGroup).toBeUndefined();
    expect(asked(r, /B\+/)).toBeTruthy();
    expect(asked(r, /LSCSB/)).toBeUndefined();
  });
});

describe('numbers that were read wrongly before', () => {
  it('height "one fifty two" is 152, never 100', () => {
    for (const text of ['height one fifty two', 'height 1 52', 'one fifty two cm', 'height one fifty two cm']) {
      const r = voice(text);
      expect(r.values.medical?.heightCm, text).toBe('152');
      expect(r.corrections, text).toContainEqual(expect.objectContaining({ to: '152', rule: 'height' }));
    }
    // only a first digit of 1 and the rest 20–99: anything else is still asked, never 100
    const r = voice('height 1 5');
    expect(r.values.medical?.heightCm).not.toBe('100');
  });

  it('height "5 2" is never 52', () => {
    const r = voice('height 5 2');
    expect(r.values.medical?.heightCm).toBeUndefined();
    expect(asked(r, /5 feet 2 inches/)).toBeTruthy();
  });

  it('asks about an age of 90 in pregnancy care (19?)', () => {
    const r = voice('Asha Sample ninety years G1 P0');
    expect(r.values.ageYears).toBeUndefined();
    const q = asked(r, /Age 90 or 19/);
    expect(q).toMatchObject({ part: 'info', remember: false });
    expect(answerToResult(q, 'value:ageYears=19', 'antenatal').values.ageYears).toBe('19');
    expect(voice('Lata Sample 60 years', 'gynaecology').values.ageYears).toBe('60'); // not asked outside pregnancy care
  });

  it('never fills a phone number with a digit missing', () => {
    // A digit said as another word ("tree", "jero", "oh", "to", "nought", "sero", "won") is read in a phone number
    // (plan 2.4), so these are whole
    for (const text of [
      'name moumita ghosh age 24 phone no nine eight seven six five four tree two one zero address salt lake sector 2 kolkata',
      'patient name sunita devi age 28 phone nine eight seven six five four three two one jero lives in kothrud pune',
      'name priya sharma aged 31 mobile number nine eight seven six five four three two one oh address gandhi nagar nagpur',
      'name moumita ghosh age 24 phone no nine eight seven six five four three to one zero address salt lake sector 2 kolkata',
      'name moumita ghosh age 24 phone no nine eight seven six five four three two one nought address salt lake sector 2 kolkata',
      'patient name sunita devi age 28 phone nine eight seven six five four tree too one jero lives in kothrud pune',
      'patient name sunita devi age 28 phone nine eight seven six five four three two one sero lives in kothrud pune',
      'name priya sharma aged 31 mobile number nine eight seven six five four three two won zero address gandhi nagar nagpur',
      'name lakshmi narayanan age tirty phone nine eight seven six five four tree two one jero address anna nagar chennai LMP 1st August',
    ]) {
      expect(voice(text, 'gynaecology').values.phone, text).toBe('98765 43210');
    }
    const partial = [
      'name sunita devi age 28 phone nine eight seven six five four tree two one',
      'name sunita devi age 28 phone 98765 432',
      'name sunita devi age 28 mobile 98765 432 10 weeks pregnant',
      'name sunita devi age 28 phone 98765 4321 2nd pregnancy',
      'name sunita devi age 28 phone nine eight seven six five four three two one two weeks',
    ];
    for (const text of partial) {
      const r = voice(text, 'gynaecology');
      expect(r.values.phone, text).toBeUndefined();
      expect(told(r, /Phone heard with only \d digits/), text).toBe(true);
    }
  });

  it('reads the ways a phone number is said', () => {
    expect(voice('mobile (987) 654-3210').values.phone).toBe('98765 43210');
    expect(voice('phone nine eight seven six five, four three two one zero').values.phone).toBe('98765 43210');
    expect(voice('phone 0 98765 43210').values.phone).toBe('98765 43210');
    expect(voice('whatsapp 98765 43210').values.phone).toBe('98765 43210');
    expect(voice('landline 020 2345 6789').values.phone).toBe('02023456789');
    expect(voice('phone 98765 432, 28 years').values.phone).toBeUndefined(); // the comma does not join the age
    expect(voice('Asha Sample 98765 4321 2 weeks pregnant').values.phone).toBeUndefined(); // no phone word: the 2 of "2 weeks" is not a digit
    expect(voice('phone 98765 43210 10 weeks').values.phone).toBe('98765 43210');
    expect(voice('phone 98 76 54 32 10').values.phone).toBe('98765 43210');
  });

  it('reads a birth weight said in thousands, kilos and points', () => {
    const grams = (text) => voice(`baby of Asha Sample born today at 8:20 am ${text}`, 'newborn').values.newborn?.birthWeightGrams;
    expect(grams('birth weight two thousand eight hundred grams')).toBe('2800');
    expect(grams('birth weight 2 kilo 800')).toBe('2800');
    expect(grams('weight three point two kg')).toBe('3200');
    expect(grams('birth weight two decimal eight kg')).toBe('2800');
    expect(grams('birth weight twenty eight hundred grams')).toBe('2800');
  });

  it('"twenty tree" is read as 23 without asking (plan 2.3 step 7), never 20', () => {
    for (const care of ['antenatal', 'gynaecology']) {
      for (const [text, age] of [['age twenty tree', 23], ['age 20 tree', 23], ['age thirty fife years', 35], ['age twenty van', 21], ['age tirty two', 32]]) {
        const r = voice(text, care);
        expect(r.values.ageYears, `${care}: ${text}`).toBe(String(age));
        expect(r.corrections.length, `${care}: ${text}`).toBeGreaterThan(0);
      }
    }
    // also when the number word is matched by sound first ("twenti" → twenty)
    for (const [text, age] of [['age twenti tree', 23], ['age twentee tree years', 23], ['age twenti van', 21]]) {
      expect(voice(text).values.ageYears, text).toBe(String(age));
    }
    expect(voice('LMP twenti tree June').values.pregnancy.lmp).toBe('2026-06-23');
    expect(voice('age 20').values.ageYears).toBe('20');
    expect(voice('age 20, LMP 5th July').values.ageYears).toBe('20');
    // "tree" that is not a number stays as said
    expect(voice('address 12 Palm Tree Colony').corrections).toEqual([]);
  });
});

describe('a round ten and then a word that sounds like a digit (a number split by a pause)', () => {
  it('asks instead of filling the tens alone', () => {
    for (const [text, path, prompt, other] of [
      ['age thirty to', 'ageYears', /^Age 30 or 32\?$/, '32'],
      ['age thirty to years', 'ageYears', /^Age 30 or 32\?$/, '32'],
      ['age thirty ate', 'ageYears', /^Age 30 or 38\?$/, '38'],
      ['age 30 2', 'ageYears', /^Age 30 or 32\?$/, '32'],
      ['Asha Sample age thirty for, LMP 5 July 2026', 'ageYears', /^Age 30 or 34\?$/, '34'],
      ['weight fifty ate kg', 'medical.weightKg', /^Weight 50 or 58 kg\?$/, '58'],
      ['height one fifty fore', 'medical.heightCm', /^Height 150 or 154 cm\?$/, '154'],
    ]) {
      const r = voice(text);
      const [a, b] = path.split('.');
      expect(b ? r.values[a]?.[b] : r.values[a], text).toBeUndefined();
      const q = r.questions.find((x) => prompt.test(x.prompt));
      expect(q, text).toMatchObject({ group: 'safety', remember: false, key: null });
      expect(q.options.map((o) => o.value), text).toContain(`value:${path}=${other}`);
      expect(q.options.map((o) => o.value), text).toContain('ignore');
    }
  });

  it('leaves ranges, doses and "for …" alone, and a number said whole', () => {
    for (const [text, path, want] of [
      ['age 30 for ANC booking', 'ageYears', '30'],
      ['age thirty two', 'ageYears', '32'],
      ['age twenty tree', 'ageYears', '23'],
      ['weight 60 for 2 months', 'medical.weightKg', '60'],
    ]) {
      const r = voice(text);
      const [a, b] = path.split('.');
      expect(b ? r.values[a]?.[b] : r.values[a], text).toBe(want);
      expect(r.questions.filter((q) => / or \d/.test(q.prompt)), text).toEqual([]);
    }
    for (const text of ['FBS 90 to 100', 'fasting sugar 90 to 100', 'on Lonopin 40 for APLA', 'POG 30 to 32 weeks']) {
      expect(voice(text).questions.filter((q) => / or \d/.test(q.prompt)), text).toEqual([]);
    }
  });
});

describe('names', () => {
  it('does not take the husband’s name as hers', () => {
    expect(voice('husband name Ramesh Patil age 26').values.fullName).toBeUndefined();
    expect(voice('name Asha Patil husband Ramesh Patil').values.fullName).toBe('Asha Patil');
    expect(voice('husband Umar 32 years age 26').values).toEqual({ ageYears: '26' });
  });

  it('the husband’s age is not hers when her own age is said later', () => {
    for (const text of [
      'husband Kiran Demo aged 41 patient Lata Demo 30 years phone 98765 43210',
      'husband Kiran Demo age 41, she is Lata Demo, 30 years old',
      'husband Kiran Demo age 41 Lata Demo 30 years',
    ]) {
      for (const r of [typed(text), voice(text)]) expect(r.values.ageYears, text).toBe('30');
    }
    // never his age: hers, or asked
    const both = voice('husband Kiran Demo age 41 Lata Demo age 30');
    expect(both.values.ageYears ?? asked(both, /41 or 30/)?.prompt).toMatch(/^30$|41 or 30/);
    const twoFamily = voice('husband Kiran Demo 41 years old saas 60 years old');
    expect(twoFamily.values.ageYears).toBeUndefined();
    expect(asked(twoFamily, /Her age: 41 or 60\?/)).toMatchObject({ group: 'safety', part: 'info' });
    expect(voice('Lata Demo 30 years, husband Kiran Demo age 41').values.ageYears).toBe('30');
    expect(voice('saas age 60, patient Lata Demo aged 30').values.ageYears).toBe('30');
    expect(voice('mother in law age 58, patient Lata Demo aged 30').values.ageYears).toBe('30');
    // said alone after the husband, it is still hers (as before)
    expect(voice('husband Kiran Demo age 30').values.ageYears).toBe('30');
  });

  it('a newborn’s mother, said as "mother name"', () => {
    const r = voice('mother name Hema Kulkarni born today at 9 am', 'newborn');
    expect(r.values).toMatchObject({ fullName: 'B/o Hema Kulkarni', motherName: 'Hema Kulkarni' });
  });

  it('drops titles, keeps initials, and never takes "MS" (mitral stenosis) as a title', () => {
    expect(voice('Smt Sunita Sample 28 years').values.fullName).toBe('Sunita Sample');
    expect(voice('name R. Lakshmi').values.fullName).toBe('R Lakshmi');
    expect(voice('RHD with severe MS on penicillin').values.fullName).toBeUndefined();
    expect(voice('previous LSCS 3 years back').values.fullName).toBeUndefined();
    expect(voice('ovarian cyst right side aged 35', 'gynaecology').values.fullName).toBeUndefined();
  });

  it('a name ends where the next detail starts, however it was said', () => {
    expect(voice('name Rekha first visit age 26').values).toMatchObject({ fullName: 'Rekha', ageYears: '26' });
    expect(voice('name Asha first pregnancy').values).toMatchObject({ fullName: 'Asha', obstetric: { gravida: '1', para: '0', living: '0', abortions: '0' } });
    expect(voice('name Asha Patil gravita 2 para 1').values).toMatchObject({ fullName: 'Asha Patil', obstetric: { gravida: '2', para: '1' } });
    expect(voice('name Asha Patil prev LSCS').values).toMatchObject({ fullName: 'Asha Patil', obstetric: { previousCaesareans: '1' } });
    expect(voice('name Asha wt 60').values).toMatchObject({ fullName: 'Asha', medical: { weightKg: '60' } });
    expect(voice('name Asha k/c/o asthma').values).toMatchObject({ fullName: 'Asha', medical: { conditions: ['asthma'] } });
    expect(voice('name Asha Nai age 30').values.fullName).toBe('Asha Nai'); // a surname, not "nahi"
  });

  it('"Asha" after "name" stays a name', () => {
    const r = voice('name Asha age 28');
    expect(r.values.fullName).toBe('Asha');
    expect(ticks(r)).toEqual([]);
  });
});

describe('the obstetric formula', () => {
  it('"G2 P1 L1 A0 LSCS" is never 0 caesareans', () => {
    for (const text of ['G2 P1 L1 A0 LSCS', 'G 2 P 1 L 1 A 0 LSCS']) {
      const r = voice(text);
      expect(r.values.obstetric, text).toEqual({ gravida: '2', para: '1', living: '1', abortions: '0' });
      const q = asked(r, /previous caesarean/);
      expect(answerToResult(q, q.options[0].value, 'antenatal').values.obstetric.previousCaesareans).toBe('1');
    }
  });

  it('"eclampsia in first pregnancy" is not a first pregnancy now', () => {
    expect(voice('G2 P1 L1 A0 eclampsia in 1st pregnancy').values.obstetric.gravida).toBe('2');
    expect(voice('eclampsia in 1st pregnancy').values.obstetric?.gravida).toBeUndefined();
  });

  it('asks when the counts cannot all be right', () => {
    const r = voice('G2 P3 L1 A0');
    expect(r.values.obstetric).toBeUndefined();
    const q = asked(r, /cannot all be right/);
    expect(answerToResult(q, q.options[0].value, 'antenatal').values.obstetric).toEqual({ gravida: '2', para: '3', living: '1', abortions: '0' });
  });

  it('the question about counts that cannot be right shows what was heard, and doubts "primi"', () => {
    const primi = voice('primigravida 3 abortions');
    const q = asked(primi, /cannot all be right/);
    expect(q.heard).toBe('primigravida … 3 abortions');
    expect(primi.values.obstetric?.previousCaesareans).toBeUndefined();
    const op = voice('primi para 2 previous operation delivery');
    expect(asked(op, /cannot all be right/).heard).toBe('primi … para 2');
    expect(asked(op, /A previous caesarean/)).toBeTruthy();
    expect(asked(voice('gravida 2 para 3'), /cannot all be right/).heard).toBe('gravida 2 … para 3');
    expect(asked(voice('2nd pregnancy 3 abortions'), /cannot all be right/).heard).not.toBe('');
    expect(voice('primigravida').values.obstetric).toEqual({ gravida: '1', para: '0', living: '0', abortions: '0', previousCaesareans: '0' });
  });

  it('"haan ji, 2 bacche" is not gravida 2', () => {
    expect(voice('haan ji, 2 bacche').values.obstetric).toBeUndefined();
  });
});

describe('"no" said without commas', () => {
  it('"no DM HTN thyroid asthma": nothing is ticked silently', () => {
    const r = voice('no DM HTN thyroid asthma');
    expect(ticks(r)).toEqual([]);
    for (const word of ['HTN', 'thyroid', 'asthma']) expect(asked(r, new RegExp(`“${word}” was said right after “no`)), word).toBeTruthy();
  });

  it('after "no history of" the whole list is "no"', () => {
    const r = voice('no history of DM HTN thyroid asthma');
    expect(ticks(r)).toEqual([]);
    expect(r.questions).toEqual([]);
  });

  it('"no sorry, she has asthma" keeps the asthma', () => {
    expect(ticks(voice('no sorry she has asthma'))).toEqual(['asthma']);
  });

  it('an allergy ends before the next finding', () => {
    const r = voice('allergic to penicillin GDM on diet');
    expect(r.values.medical.allergies).toBe('Penicillin');
    expect(r.values.notes).toMatch(/Gestational diabetes/);
    const both = voice('previous LSCS allergic to penicillin GDM');
    expect(both.values).toMatchObject({ obstetric: { previousCaesareans: '1' }, medical: { allergies: 'Penicillin' } });
    expect(both.values.notes).toMatch(/Gestational diabetes/);
  });
});

describe('family history and similar findings', () => {
  it('"mother diabetic she is hypothyroid": only hers is ticked', () => {
    expect(ticks(voice('mother diabetic she is hypothyroid'))).toEqual(['thyroid']);
  });

  it('"mother of (the) patient" is still the mother', () => {
    for (const text of ['age 26 G1 mother of patient is diabetic', 'age 26 G1 husband of the patient has hypertension', 'family history mother of pt has asthma']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(told(r, /family members/), text).toBe(true);
    }
    expect(ticks(voice('mother of patient is diabetic and she is hypothyroid'))).toEqual(['thyroid']);
  });

  it('never gives the husband a woman-only finding', () => {
    expect(voice('husband diabetic PCOS', 'infertility').values.medical?.otherConditions).toBe('PCOS');
  });

  it('reads Hindi family words and FH', () => {
    expect(ticks(voice('mummy diabetic'))).toEqual([]);
    expect(ticks(voice('FH of hypertension'))).toEqual([]);
  });

  it('"RHD with severe MS" is heart disease, and multiple sclerosis is never ticked silently', () => {
    const r = voice('RHD with severe MS');
    expect(ticks(r)).toEqual(['heart_disease']);
    expect(r.values.medical?.otherConditions).toBeUndefined();
  });

  it('"oligo hydramnios" is oligohydramnios only', () => {
    expect(voice('oligo hydramnios').values.notes).toBe('Oligohydramnios');
  });

  it('a misheard first word of a finding is asked about, even with no clinical word before it', () => {
    // ("hydramnios" or "fits" alone is the opposite finding: the question is how the doctor sees it)
    for (const [text, heard, meant] of [
      ['oligio hydramnios', 'oligio', 'oligo'],
      ['scan shows oligio hydramnios', 'oligio', 'oligo'],
      ['eclamptis fits', 'eclamptis', 'eclamptic'],
    ]) {
      const q = asked(voice(text), new RegExp(`Did you mean “${meant}”`));
      expect(q, text).toBeTruthy();
      expect(q.heard, text).toBe(heard);
    }
  });

  it('"G DM" is gestational diabetes, not diabetes from before', () => {
    const r = voice('G DM on diet');
    expect(ticks(r)).toEqual([]);
    expect(r.values.notes).toMatch(/Gestational diabetes/);
  });

  it('guards from the accent research (7h #15)', () => {
    expect(voice('she was leaving for work').values.obstetric).toBeUndefined();
    expect(voice('came to our clinic').values.medical).toBeUndefined();
    const fatal = voice('fatal accident in the family');
    expect(ticks(fatal)).toEqual([]);
    expect(fatal.values.notes).toBeUndefined();
  });
});

describe('owner decisions, built the safe way until approved', () => {
  it('"BP" said as an illness ticks high blood pressure in every type of care (decision 1, 29 Sep 2026)', () => {
    for (const care of ['antenatal', 'gynaecology', 'infertility']) {
      const r = voice('known case of BP', care);
      expect(ticks(r), care).toEqual(['hypertension']);
      expect(r.questions, care).toEqual([]);
    }
  });

  it('"previous operation" or "cut delivery" asks about a caesarean (decision 2)', () => {
    for (const text of ['previous operation', 'cut delivery 3 years back', 'operation delivery']) {
      const r = voice(`G2 P1 L1 A0 ${text}`);
      expect(r.values.obstetric.previousCaesareans, text).toBeUndefined();
      expect(asked(r, /A previous caesarean/), text).toBeTruthy();
    }
    expect(asked(voice('G2 P1 L1 A0 previous LSCS previous operation'), /A previous caesarean/)).toBeUndefined();
    // in postnatal care "cut delivery" is usually this delivery: only "previous operation" is asked about
    for (const text of ['delivered today, cut delivery', 'delivery by operation yesterday']) expect(asked(voice(text, 'postnatal'), /A previous caesarean/), text).toBeUndefined();
    expect(asked(voice('previous operation', 'postnatal'), /A previous caesarean/)).toBeTruthy();
  });
});

describe('corrections said while speaking', () => {
  it('the later value wins, with a note', () => {
    const age = voice('age 28 sorry 38');
    expect(age.values.ageYears).toBe('38');
    expect(told(age, /Corrected while speaking: age 28 → 38/)).toBe(true);
    expect(voice('age 25 matlab 26').values.ageYears).toBe('26');
    expect(voice('LMP 5th July no sorry 6th July').values.pregnancy.lmp).toBe('2026-07-06');
    expect(voice('age 32 I mean 33 G2 P1 L1 A0').values).toMatchObject({ ageYears: '33', obstetric: { gravida: '2' } });
    expect(voice('G2 sorry G3 P2 L2 A0').values.obstetric.gravida).toBe('3');
    expect(voice('weight 60 cancel that').values.medical).toBeUndefined();
  });

  it('a corrected blood group goes to the card, even when typed', () => {
    for (const read of [voice, (t) => extractPatientDetails(t, { careType: 'antenatal', now })]) {
      const r = read('blood group B positive no sorry B negative');
      expect(r.values.medical?.bloodGroup).toBeUndefined();
      expect(asked(r, /Blood group B- – is that right/)).toMatchObject({ group: 'confirm' });
      expect(told(r, /Corrected while speaking: blood group B positive → B negative/)).toBe(true);
    }
  });

  it('a correction of the Rh alone goes to the card, and one not understood is never dropped silently', () => {
    for (const [text, group] of [
      ['blood group B positive sorry negative', 'B-'],
      ['blood group O positive no sorry Rh negative', 'O-'],
      ['blood group B positive, sorry, Rh negative', 'B-'],
      ['blood group B positive I mean negative', 'B-'],
    ]) {
      for (const read of [voice, typed]) {
        const r = read(text);
        expect(r.values.medical?.bloodGroup, text).toBeUndefined();
        expect(asked(r, new RegExp(`Blood group ${group} – is that right`)), text).toMatchObject({ group: 'confirm' });
        expect(told(r, /Corrected while speaking: blood group/), text).toBe(true);
      }
    }
    expect(asked(voice('bg 0 positive blood group oh negative'), /Blood group O\+ or O-\?/)).toBeTruthy();
    expect(applySelfCorrections('blood group B positive sorry negative for HIV').changes).toEqual([]);
    const unclear = typed('blood group B positive no sorry it is negative');
    expect(unclear.values.medical?.bloodGroup).toBeUndefined();
    expect(asked(unclear, /Blood group B\+ – is that right/)).toMatchObject({ group: 'confirm' });
    expect(told(unclear, /corrected after the blood group but not understood/)).toBe(true);
  });

  it('a number that starts another detail is not a correction', () => {
    expect(applySelfCorrections('age 28 sorry 2nd pregnancy').changes).toEqual([]);
    expect(applySelfCorrections('age 28 sorry 62 kg').changes).toEqual([]);
    expect(applySelfCorrections('P1 sorry 2 abortions').changes).toEqual([]);
    expect(voice('age 28 sorry 23 weeks pregnant').values.ageYears).toBe('28');
    expect(voice('weight 60 sorry 2 weeks back she had fever').values.medical.weightKg).toBe('60');
    expect(voice('height 152 sorry 2 months ago she had surgery').values.medical.heightCm).toBe('152');
    // … and real corrections still work
    expect(voice('weight 60 sorry 62 kg').values.medical.weightKg).toBe('62');
    expect(voice('height 152 sorry 155 cm').values.medical.heightCm).toBe('155');
    expect(voice('age 28 sorry 26 she is G2P1').values.ageYears).toBe('26');
    expect(voice('G2 sorry 3 P2 L2 A0').values.obstetric.gravida).toBe('3');
    expect(applySelfCorrections('prolapse L4 L5 sorry L3 L4').changes).toEqual([]);
  });

  it('asks when the same detail was said twice with different values', () => {
    const age = voice('age 28 G2 P1 L1 A0 age 38');
    expect(age.values.ageYears).toBeUndefined();
    const q = asked(age, /Age was said twice: 28 or 38/);
    expect(q.options.map((o) => o.value)).toEqual(['value:ageYears=28', 'value:ageYears=38', 'ignore']);
    const group = voice('blood group O positive husband blood group B negative');
    expect(asked(group, /Blood group O\+/)).toBeTruthy(); // the husband's is not hers
    const lmp = voice('LMP 5th July, LMP 6th July');
    expect(lmp.values.pregnancy).toBeUndefined();
    expect(asked(lmp, /LMP was said twice/)).toBeTruthy();
    const scan = voice('EDD by scan 11th April 2027 EDD by scan 15th April 2027');
    expect(scan.values.pregnancy).toBeUndefined();
    expect(asked(scan, /EDD by scan was said twice: 11 Apr 2027 or 15 Apr 2027/)).toBeTruthy();
    expect(asked(voice('G2 P1 L1 A0, G2 P1 L1 A1'), /Abortions was said twice: 0 or 1/)).toBeTruthy();
    expect(asked(voice('G2 P1 L1 A0 gravida 3'), /Gravida was said twice: 2 or 3/)).toBeTruthy();
  });

  it('asks when a value is said again straight after the first with no marker ("HIV negative actually positive")', () => {
    for (const [text, test] of [
      ['HIV negative actually positive', 'HIV'],
      ['HIV negative, actually reactive', 'HIV'],
      ['VDRL negative basically positive', 'VDRL'],
    ]) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      const q = asked(r, new RegExp(`${test}: reactive \\(positive\\) or non-reactive \\(negative\\)`));
      expect(q, text).toMatchObject({ group: 'confirm' });
      expect(q.options.map((o) => o.label), text).toEqual(expect.arrayContaining(['Reactive', 'Non-reactive']));
    }
    const age = voice('age 28 actually 29');
    expect(age.values.ageYears).toBeUndefined();
    expect(asked(age, /Age was said twice: 28 or 29/)).toBeTruthy();
    for (const text of ['age 28, 2 years married', 'HIV negative VDRL negative']) expect(voice(text).questions, text).toEqual([]);
    // an emphasis word is still removed when no other value follows
    expect(voice('age 28 only').values.ageYears).toBe('28');
    expect(voice('LMP 5th July itself').values.pregnancy.lmp).toBe('2026-07-05');
  });

  it('a scan EDD and a plain EDD are two details, and "G6PD" or "L4 L5" is not the formula', () => {
    const edd = voice('LMP 5th July 2026 EDD 11th April 2027 EDD by scan 15th April 2027');
    expect(edd.values.pregnancy).toEqual({ lmp: '2026-07-05', scanEdd: '2027-04-15' });
    expect(asked(edd, /said twice/)).toBeUndefined();
    // two plain EDDs are asked about, and the scan EDD said on its own is kept
    const two = voice('EDD 11th April 2027 EDD 12th April 2027 EDD by scan 15th April 2027');
    expect(two.values.pregnancy.scanEdd).toBe('2027-04-15');
    expect(asked(two, /EDD was said twice: 11 Apr 2027 or 12 Apr 2027/)).toBeTruthy();
    for (const text of ['age 26 menarche at age 13', 'age 26 gestational age 28 weeks']) expect(voice(text).values.ageYears, text).toBe('26');
    expect(applySelfCorrections('G2 P1 L1 A0 G6PD deficiency').conflicts).toEqual([]);
    expect(applySelfCorrections('G2 P1 L1 A0 G3 P2 L2 A0').conflicts.map((c) => c.field)).toContain('gravida');
    for (const text of ['G2 P1 L1 A0 G6PD deficiency', 'G2 P1 L1 A0 blood group A1 positive', 'G2 P1 L1 A0 back pain L4 L5', 'G3 P2 L2 A0 IVF with P4 support']) {
      const r = voice(text);
      expect(asked(r, /said twice/), text).toBeUndefined();
      expect(Object.keys(r.values.obstetric ?? {}), text).toEqual(['gravida', 'para', 'living', 'abortions']);
    }
  });
});

describe('dates', () => {
  it('asks about an LMP said as a time ago, never fills it', () => {
    for (const [text, date] of [
      ['LMP 2 months back', '28 Jul 2026'],
      ['LMP do mahine pehle', '28 Jul 2026'],
      ['LMP kal', '27 Sep 2026'],
      ['LMP 3rd of this month', '3 Sep 2026'],
    ]) {
      const r = voice(text);
      expect(r.values.pregnancy, text).toBeUndefined();
      expect(asked(r, new RegExp(`LMP about ${date}`)), text).toMatchObject({ group: 'safety' });
    }
  });

  it('keeps an LMP with a word after it', () => {
    expect(voice('LMP 5th July only').values.pregnancy.lmp).toBe('2026-07-05');
    expect(voice('age 28 only').values.ageYears).toBe('28');
    const r = voice('LMP was 5th July no, diabetes nil');
    expect(r.values.pregnancy.lmp).toBe('2026-07-05');
    expect(ticks(r)).toEqual([]);
  });
});

describe('checkRanges', () => {
  const at = { text: '…', at: 0 };
  it('turns values that cannot be right into questions or notes', () => {
    const got = checkRanges(
      { ageYears: '70', medical: { heightCm: '100', weightKg: '160' }, pregnancy: { lmp: '2025-10-01' }, obstetric: { gravida: '1', para: '2' } },
      { age: { value: 70, ...at }, height: { cm: 100, ...at }, weight: { kg: 160, ...at }, phone: { digits: '987654' } },
      'antenatal',
      now,
    );
    expect(got.drop).toEqual(['ageYears', 'medical.heightCm', 'medical.weightKg', 'pregnancy.lmp', 'obstetric.gravida', 'obstetric.para']);
    expect(got.questions.map((q) => q.prompt)).toEqual([
      'Age 70 or 17?',
      'Height 100 cm – is that right?',
      'Weight 160 kg – is that right?',
      'LMP 1 Oct 2025 is more than 10 months ago – is that right?',
      'G1 P2 – these numbers cannot all be right. Use them as heard?',
    ]);
    expect(got.notes).toEqual(['Phone heard with only 6 digits – check it and type it in.']);
  });

  it('checks the weeks said against the dates', () => {
    const lmp = { pregnancy: { lmp: '2026-07-05' } }; // 12 weeks on 28 Sep 2026
    expect(checkRanges(lmp, { weeks: { value: 12, ...at } }, 'antenatal', now).questions).toEqual([]);
    expect(checkRanges(lmp, { weeks: { value: 40, ...at } }, 'antenatal', now)).toMatchObject({ drop: ['pregnancy.lmp'], questions: [{ prompt: 'LMP 5 Jul 2026 gives 12 weeks, but 40 weeks was said. Use this LMP?' }] });
    expect(checkRanges(lmp, { weeks: { value: 60, ...at } }, 'antenatal', now).questions[0].prompt).toBe('60 weeks is more than 42 weeks – was it 16 weeks? Check the weeks and the dates.');
    const far = checkRanges({ pregnancy: { lmp: '2026-07-05', scanEdd: '2027-05-30' } }, {}, 'antenatal', now);
    expect(far.drop).toEqual(['pregnancy.scanEdd']);
  });

  it('the answer is a value used on this page only', () => {
    expect(meaningLabel('value:ageYears=19')).toBe('Age: 19');
    expect(meaningLabel('value:pregnancy.lmp=2026-07-28')).toBe('LMP: 28 Jul 2026');
    expect(answerToResult(null, 'value:notAField=1', 'antenatal').paths).toEqual([]);
  });
});

describe('protected spans and self-corrections (indianEnglish.js)', () => {
  const kinds = (text) => findProtectedSpans(text).map((p) => [p.kind, text.slice(p.start, p.end)]);
  it('finds names, addresses, phone numbers, doctors and hospitals', () => {
    expect(kinds('name T B Lakshmi age 30 husband Umar 32 years')).toEqual([
      ['name', 'T B Lakshmi'],
      ['husband', 'Umar'],
    ]);
    expect(kinds('address 12 Palm Tree Colony phone 98765 43210')).toEqual([
      ['address', '12 Palm Tree Colony'],
      ['phone', '98765 43210'],
    ]);
    expect(kinds('referred by Dr Asthana from Sai Hospital')).toEqual([
      ['referrer', 'Asthana'],
      ['hospital', 'Sai Hospital'],
    ]);
    expect(kinds('mother diabetic, husband has asthma')).toEqual([]);
    // the same address words and ends as dictation.js reads (plan G3.3)
    expect(kinds('name Sunita Pawar residence at 12 Palm Tree Colony Pune age 28')).toEqual([
      ['name', 'Sunita Pawar'],
      ['address', '12 Palm Tree Colony Pune'],
    ]);
    expect(kinds('name Sunita Pawar village Khed taluka Maval age 28')).toEqual([
      ['name', 'Sunita Pawar'],
      ['address', 'village Khed taluka Maval'],
    ]);
    expect(kinds('at post khed district pune')).toEqual([['address', 'khed district pune']]);
    expect(kinds('address Wakad Pune last MC 5th July')).toEqual([['address', 'Wakad Pune']]);
  });

  it('corrects only values of the same detail', () => {
    expect(applySelfCorrections('age 28 sorry 38').text).toBe('age 38');
    expect(applySelfCorrections('blood group not B positive, B negative').text).toBe('blood group B negative');
    expect(applySelfCorrections('she is rather anxious').text).toBe('she is rather anxious');
    expect(applySelfCorrections('HIV negative sorry VDRL positive').changes).toEqual([]);
    expect(applySelfCorrections('age 28 husband age 32').conflicts).toEqual([]);
    expect(applySelfCorrections('HIV non-reactive, HIV negative').conflicts).toEqual([]); // the same result
    expect(applySelfCorrections('LMP 5 July, EDD by LMP 11 April 2027').conflicts).toEqual([]);
    expect(applySelfCorrections('age 28, age 38').conflicts).toMatchObject([{ field: 'age', values: [{ value: '28' }, { value: '38' }] }]);
  });
});

describe('the baby’s sex in a pregnancy (PCPNDT)', () => {
  const phrases = ['baby is male as per scan', 'ladka hai', 'baby girl', 'female fetus'];
  it('fills nothing, notes nothing, corrects nothing and never offers to remember', () => {
    for (const text of phrases) {
      const r = voice(`Asha Sample 28 years ${text}`);
      expect(r.values, text).toEqual({ fullName: 'Asha Sample', ageYears: '28' });
      expect(r.notes, text).toEqual([]);
      expect(r.questions, text).toEqual([]);
      expect(JSON.stringify(r.unused.filter((u) => !u.sex))).not.toMatch(/male|girl|ladka|fetus/i);
    }
    expect(voice('baby boy sorry girl').notes).toEqual([]);
  });

  it('never gives Chrome a word about the baby’s sex in antenatal care', () => {
    expect(hearingPhrases('antenatal').map((p) => p.text).join(' ')).not.toMatch(/\b(?:boy|girl|male|female|ladka|ladki|beta|beti)\b/i);
  });

  it('takes the part about the sex out of the text box', () => {
    expect(withoutFetalSex('Asha Sample 28 years, the baby is a boy, LMP 5 July')).toEqual({ text: 'Asha Sample 28 years, LMP 5 July', removed: true });
    expect(withoutFetalSex('Asha Sample 28 years G2 P1 L1 A0 as per scan baby is male LMP 5 July G2').removed).toBe(true);
    expect(withoutFetalSex('Asha Sample 28 years G2 P1 L1 A0 as per scan baby is male LMP 5 July G2').text).not.toMatch(/male/);
    expect(withoutFetalSex('LMP 5 July')).toEqual({ text: 'LMP 5 July', removed: false });
  });

  it('takes out only the words about the sex: no other detail and no "no" is lost', () => {
    for (const t of [
      'Asha Patil 28 year old female G2 P1 L1 A0 LMP 5th July 2026',
      'G3 P2 L2 A0 two daughters LMP 5th July 2026 no DM no HTN',
      'Asha Patil age 28 G3 P2 L2 A0 has two daughters no DM HTN asthma',
      'age 30 G2 P1 L1 A0 first baby was a girl not diabetic hypertensive',
      'EDD 12 January 2027 as per scan baby is male G2',
    ]) {
      const a = voice(t);
      const b = voice(withoutFetalSex(t).text);
      expect(b.values, t).toEqual(a.values);
      expect(b.questions.map((q) => q.prompt), t).toEqual(a.questions.map((q) => q.prompt));
      expect(mentionsFetalSex(withoutFetalSex(t).text), t).toBe(false);
    }
    expect(withoutFetalSex('Asha Patil age 28 G3 P2 L2 A0 has two daughters no DM HTN asthma').text).toBe('Asha Patil age 28 G3 P2 L2 A0 has no DM HTN asthma');
    expect(voice(withoutFetalSex('Asha Patil age 28 G3 P2 L2 A0 has two daughters no DM HTN asthma').text).values.medical).toBeUndefined();
  });

  it('also takes out the sound-alike Chrome can write for the word ("mail baby"), and never offers it for the notes', () => {
    for (const t of ['scan shows mail baby', 'baby is mail', 'its a mail child', "it's a mail", 'femail fetus on scan', 'the baby is a fee mail']) {
      const cut = withoutFetalSex(t);
      expect(cut.removed, t).toBe(true);
      expect(cut.text, t).not.toMatch(/mail/i);
      expect(voice(t).unused.filter((u) => u.canNote && /mail/i.test(u.text)), t).toEqual([]);
    }
    expect(withoutFetalSex('G2 P1 L1 A0, 28 weeks, scan shows mail baby, LMP 5 July').text).toBe('G2 P1 L1 A0, 28 weeks, scan shows, LMP 5 July');
    // "mail" on its own is an ordinary word
    for (const t of ['mail the report to husband', 'mail ID asha at example dot com', 'child is mailed the report']) {
      expect(withoutFetalSex(t), t).toEqual({ text: t, removed: false });
      expect(voice(t).unused.some((u) => u.canNote), t).toBe(true);
    }
  });

  it('outside a pregnancy, words about sex are not listed as "not understood"', () => {
    expect(voice('Lata Sample 45 years husband is male partner', 'gynaecology').unused.filter((u) => u.sex)).toEqual([]);
  });
});

describe('words the app is not sure of', () => {
  it('never offers "Remember" for a word with a number (it could not be kept)', () => {
    for (const care of ['antenatal', 'gynaecology']) {
      const q = voice('G6PD deficient', care).questions.find((x) => x.key === 'g6pd');
      expect(q, care).toMatchObject({ teach: true, remember: false });
    }
  });

  it('"jestational diabetes" is asked about, never ticked as diabetes from before', () => {
    const r = voice('jestational diabetes');
    expect(ticks(r)).toEqual([]);
    const q = asked(r, /Diabetes from before this pregnancy, or diabetes of this pregnancy/);
    expect(q.heard).toBe('jestational diabetes');
    expect(ticks(voice('gestational diabetes'))).toEqual([]);
    expect(ticks(voice('pregestational diabetes'))).toEqual(['diabetes']);
    expect(ticks(voice('known case of diabetes'))).toEqual(['diabetes']);
  });

  it('"gestational diabetic", however it is heard, is diabetes of this pregnancy, never diabetes from before', () => {
    for (const text of ['gestational diabetec', 'gestational diabetik', 'GDM, gestational diabetec on diet', 'known gestational diabetec on insulin', 'gestational DM']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(r.values.notes, text).toBe('Gestational diabetes (this pregnancy)');
    }
    expect(typed('gestational diabetic').values.notes).toBe('Gestational diabetes (this pregnancy)');
    expect(ticks(typed('gestational diabetic'))).toEqual([]);
    const before = voice('previous gestational diabetic', 'postnatal');
    expect(ticks(before)).toEqual([]);
    expect(before.values.medical.otherConditions).toBe('Previous pregnancy – Gestational diabetes');
    for (const care of ['gynaecology', 'infertility']) {
      const r = voice('previous gestational diabetic', care);
      expect(ticks(r), care).toEqual([]);
      expect(told(r, /Gestational diabetes was said/), care).toBe(true);
    }
    // "known diabetic" (and a misheard "diabetec") is diabetes from before, as typed
    expect(ticks(voice('known diabetec on insulin'))).toEqual(['diabetes']);
  });

  it('two letters said one by one ("T B") are asked about, never ticked (they may be initials)', () => {
    const r = voice('T B Lakshmi');
    expect(ticks(r)).toEqual([]);
    expect(asked(r, /letters said one by one – Tuberculosis/)).toBeTruthy();
    expect(ticks(voice('h/o TB'))).toEqual(['tuberculosis']); // said as a word, it is ticked
    expect(ticks(voice('l s c s b positive'))).toEqual([]);
  });
});

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe('a phone number said twice, and a plain EDD far from the LMP (plan 2.6)', () => {
  it('asks which phone number is right when two different ones are said with no "sorry"', () => {
    for (const text of ['phone 98765 43210 phone 91234 56789', 'phone 98765 43210 mobile 91234 56789', 'phone 98765 43210 91234 56789']) {
      const r = voice(text);
      expect(r.values.phone, text).toBeUndefined();
      const q = asked(r, /^Phone was said twice: 98765 43210 or 91234 56789\?/);
      expect(q, text).toMatchObject({ group: 'safety', part: 'info', remember: false });
      expect(q.options.map((o) => o.value)).toEqual(['value:phone=98765 43210', 'value:phone=91234 56789', 'ignore']);
      expect(r.notes, text).toEqual([]); // never "Phone heard with only … digits"
    }
    expect(answerToResult(asked(voice('phone 98765 43210 phone 91234 56789'), /^Phone/), 'value:phone=91234 56789', 'antenatal').values.phone).toBe('91234 56789');
  });

  it('fills the later number after "sorry", with a note, and never asks about the same number said twice', () => {
    for (const text of ['phone 98765 43210 sorry 91234 56789', 'phone nine eight seven six five four three two one zero, sorry, nine one two three four five six seven eight nine']) {
      const r = voice(text);
      expect(r.values.phone, text).toBe('91234 56789');
      expect(told(r, /Corrected while speaking: phone/), text).toBe(true);
    }
    for (const text of ['phone +91 98765 43210 mobile 98765 43210', 'phone 98765 43210, address 12 Palm Tree Colony, phone 98765 43210']) {
      const r = voice(text);
      expect(r.values.phone, text).toMatch(/98765 43210$/);
      expect(r.questions, text).toEqual([]);
    }
    // the husband's number is someone else's
    const r = voice("phone 98765 43210 husband's number 91234 56789");
    expect(r.values.phone).toBe('98765 43210');
    expect(r.questions).toEqual([]);
  });

  it('says how far a plain EDD is from the EDD by LMP, since "Yes – from a dating scan" skips that check', () => {
    const r = voice('LMP 12 July 2026 EDD 1 March 2027');
    const q = asked(r, /is it from a dating scan/);
    expect(q.prompt).toBe('EDD 1 Mar 2027 – is it from a dating scan? It is 48 days from the EDD by LMP (18 Apr 2027).');
    expect(q.options.map((o) => o.label)).toEqual(['Yes – EDD from dating scan (48 days from the EDD by LMP)', 'No – from dates (worked out from the LMP)']);
    // within 14 days, or with no LMP, nothing more is said
    expect(asked(voice('LMP 12 July 2026 EDD 20 April 2027'), /is it from a dating scan/).prompt).toBe('EDD 20 Apr 2027 – is it from a dating scan?');
    expect(asked(voice('EDD 1 March 2027'), /is it from a dating scan/).prompt).toBe('EDD 1 Mar 2027 – is it from a dating scan?');
    // a plain EDD said twice: each choice far from the LMP's says so
    const twice = asked(voice('LMP 12 July 2026 EDD 1 March 2027 EDD 20 April 2027'), /EDD was said twice/);
    expect(twice.prompt).toMatch(/The EDD by LMP is 18 Apr 2027\.$/);
    expect(twice.options.map((o) => o.label)).toEqual(['1 Mar 2027 (dating scan, 48 days from the EDD by LMP)', '20 Apr 2027 (dating scan)', 'Leave blank']);
  });
});
