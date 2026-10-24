// Voice entry: the Indian English layer (plan 2.3 steps 1 and 3–9, 2.4, 2.5, and the Task 2a and 2b items of plan
// 4.3). All fake sample data.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerToResult, extractPatientDetails } from './dictation.js';
import {
  ACCENT_NUMBER_WORDS,
  FILLERS,
  INDIAN_NUMBERS,
  LETTER_NAMES,
  LOOKUPS,
  MONTH_SPELLINGS,
  NEVER_AUTO_PAIRS,
  TRAILING_FILLERS,
  accentDistance,
  changedBySound,
  decodeLetters,
  findProtectedSpans,
  fixAfterDigits,
  fuzzyTerm,
  indiKey,
  keyVariants,
  normaliseLabels,
  prepareTranscript,
  soundVocabulary,
} from './indianEnglish.js';
import { EXTRA_VOCAB, TERMS, isBlockedLearned } from './obgyTerms.js';
import { DICTATION_WORDS, GUARD_HASH, REAL_WORDS } from './realWordGuard.js';
import { guardHash } from '../../../scripts/make-word-guard.mjs';
import { mentionsFetalSex } from '../../pcpndtWords.js';
import mishears from './testdata/mishears.json';

const now = new Date(2026, 8, 28, 11, 30); // 28 Sep 2026, 11:30
const voice = (text, careType = 'antenatal', words = []) => extractPatientDetails(text, { careType, now, words, voice: true });
const ticks = (r) => [...(r.values.medical?.conditions ?? []), ...(r.values.obstetric?.pastComplications ?? [])];
const asked = (r, rx) => r.questions.find((q) => rx.test(`${q.prompt} | ${q.heard} | ${q.options.map((o) => o.label).join(' | ')}`));
// The steps before digits, as dictation.js runs them (names and addresses found first)
const prepare = (text, careType = 'antenatal', protect = []) => {
  const labels = normaliseLabels(` ${text} `);
  const r = prepareTranscript(labels.text, { careType, protect, spans: findProtectedSpans(labels.text) });
  return { ...r, text: r.text.trim(), changes: [...labels.changes, ...r.changes] };
};
const afterDigits = (text, careType = 'antenatal') => fixAfterDigits(` ${text} `, { careType, spans: findProtectedSpans(` ${text} `) });
const wordList = (file) =>
  readFileSync(new URL(`./testdata/${file}`, import.meta.url), 'utf8')
    .split('\n')
    .map((w) => w.trim())
    .filter((w) => w && !w.startsWith('#'));
const commonWords = wordList('commonWords.txt');
const indianNames = wordList('indianNames.txt');

describe('letters said one by one, and letter names (plan 2.3 step 6)', () => {
  it('reads letter names into a known short form', () => {
    for (const [said, meant] of [
      ['are H negative', 'Rh negative'],
      ['our edge negative', 'Rh negative'],
      ['previous else CS', 'previous LSCS'],
      ['previous L S C yes', 'previous LSCS'],
      ['G D yem on metformin', 'GDM on metformin'],
      ['E double D 20 February', 'EDD 20 February'],
      ['ee dee dee by scan', 'EDD by scan'],
      ['el em pee 12 July', 'LMP 12 July'],
      ['pie H', 'PIH'],
      ['OG TT normal', 'OGTT normal'],
      ['you S G done', 'USG done'],
    ]) {
      expect(prepare(said).text, said).toBe(meant);
    }
  });

  it('never reads "you are", "you are late", "age I V" or "a C section" as letters', () => {
    for (const text of ['you are', 'you are late', 'age I V', 'she had a C section', 'are you sure', 'I am fine', 'see you in a week']) {
      expect(prepare(text).text, text).toBe(text);
    }
    expect(voice('age I V').values).toEqual({});
  });

  it('leaves initials next to a name alone', () => {
    for (const text of ['name K P Sreeja', 'name Lakshmi K P', 'name R. Lakshmi', 'husband T B Rao']) {
      expect(prepare(text).text, text).toBe(text);
    }
    expect(voice('name Lakshmi K P').values.fullName).toBe('Lakshmi K P');
    // a name that has ended ("age 25") does not stop the letters after it
    expect(prepare('name Farzana Khan age 25 C E D D 3rd Feb').text).toBe('name Farzana Khan age 25 CEDD 3rd Feb');
  });

  it('a 2-letter short form that would tick a finding is asked, never ticked', () => {
    const r = voice('T B treated in 2019');
    expect(ticks(r)).toEqual([]);
    expect(asked(r, /letters said one by one – Tuberculosis/)).toBeTruthy();
    expect(decodeLetters('T B Lakshmi').spelled).toEqual(['TB']);
  });

  it('only letter names and split capitals are reported as corrections, not letters said plainly', () => {
    expect(decodeLetters('l s c s').changes).toEqual([]);
    expect(decodeLetters('are H negative').changes).toEqual([{ heard: 'are H', to: 'Rh', rule: 'letters', tier: 'A' }]);
    expect(voice('group B are H negative').questions.some((q) => /Blood group B-/.test(q.prompt))).toBe(true);
  });
});

describe('digits said as other words (plan 2.4)', () => {
  it('reads them in a phone number or a pincode', () => {
    expect(voice('phone nine eight oh one two three four five six seven').values.phone).toBe('98012 34567');
    expect(voice('contact number nine ate seven six five four three two one zero').values.phone).toBe('98765 43210');
    expect(voice('contact number six three double oh one two three four five six').values.phone).toBe('63001 23456');
    expect(voice('mobile nine four four four zero pive one two three eight').values.phone).toBe('94440 51238');
    expect(voice('mobile 9 8 nought 2 3 4 5 6 7 1').values.phone).toBe('98023 45671');
    expect(afterDigits('pin 4 1 1 0 tree 8').text.trim()).toBe('pin 4 1 1 0 3 8');
    // without a keyword only when they make a run of exactly 6 or 10 digits
    expect(afterDigits('9 8 7 6 5 4 tree 2 1 0').text.trim()).toBe('9 8 7 6 5 4 3 2 1 0');
    expect(afterDigits('4 1 1 0 tree 8').text.trim()).toBe('4 1 1 0 3 8');
    expect(afterDigits('9 8 to 6 5').text.trim()).toBe('9 8 to 6 5');
    // a grouped phone number said without a keyword, and a pH or pus cell count only with "no" after the word
    expect(voice('98 22 oh 1 2 3 4 5').values.phone).toBe('98220 12345');
    expect(voice('cell no 98765 4321 oh').values.phone).toBe('98765 43210');
    // a 10-digit run without a keyword must look like a mobile number
    expect(afterDigits('1 2 3 4 5 6 7 tree 9 0').text.trim()).toBe('1 2 3 4 5 6 7 tree 9 0');
  });

  it('never elsewhere', () => {
    for (const text of [
      'Labebet 1 0 1 for 5 days',
      'pain for 2 days',
      'bleeding 2 to 3 days',
      'scan to 5th July',
      'twins for 2 weeks',
      'tablet 1 0 1 for 5 days',
      // ranges are not 6 digits
      'BP 110 to 70',
      'BP 130 to 80',
      'BP 140 to 90 mm Hg',
      'BP 140 for 90',
      'FBS 90 to 100',
      'BP 120 to 80, pulse 88',
      'urine pH 6 to 7',
      'urine pus cell 2 to 4',
    ]) {
      expect(afterDigits(text).text.trim(), text).toBe(text);
    }
    // "not" is never 0, and a whole phone number takes nothing after it
    expect(afterDigits('phone 9 8 7 6 5 4 3 2 1 not').text.trim()).toBe('phone 9 8 7 6 5 4 3 2 1 not');
    expect(afterDigits('phone 98765 43210 for 2 days').text.trim()).toBe('phone 98765 43210 for 2 days');
    expect(voice('Labebet 1 0 1 for 5 days').corrections).toEqual([]);
  });

  it('a range stays as said in "Not understood", and a pH or pus cell count is never a phone', () => {
    expect(voice('Name Asha. BP 140 to 90 at booking').unused[0].note).toContain('140 to 90');
    for (const text of ['urine pH 6 to 7', 'vaginal pH 4 to 5', 'urine pus cell 2 to 4']) {
      expect(voice(text).notes.filter((n) => /Phone/.test(n)), text).toEqual([]);
    }
  });
});

describe('numbers in Indian languages, only next to a unit or in the formula (plan 2.3 step 4)', () => {
  it('reads one number word of each language', () => {
    const cases = [
      ['Hindi', 'naam Sunaina Mishra pachees saal ki hai', { fullName: 'Sunaina Mishra', ageYears: '25' }],
      ['Punjabi', 'gravida tinn para 2 living 2', { obstetric: { gravida: '3', para: '2', living: '2' } }],
      ['Marathi', 'para don living don gravida 3 abortion 0', { obstetric: { gravida: '3', para: '2', living: '2', abortions: '0' } }],
      ['Gujarati', 'G tran P be L be A0', { obstetric: { gravida: '3', para: '2', living: '2', abortions: '0' } }],
      ['Bengali', 'para dui living dui gravida 3 abortion jiro', { obstetric: { gravida: '3', para: '2', living: '2', abortions: '0' } }],
      ['Odia', 'G2 P0 L0 abortion eka at 8 weeks', { obstetric: { gravida: '2', para: '0', living: '0', abortions: '1' } }],
      ['Tamil', 'para rendu living rendu gravida 3', { obstetric: { gravida: '3', para: '2', living: '2' } }],
      ['Telugu', 'gravida moodu para rendu living rendu', { obstetric: { gravida: '3', para: '2', living: '2' } }],
      ['Kannada', 'gravida 3 para eradu living eradu', { obstetric: { gravida: '3', para: '2', living: '2' } }],
      ['Malayalam', 'para randu living randu gravida 3', { obstetric: { gravida: '3', para: '2', living: '2' } }],
    ];
    for (const [language, text, values] of cases) expect(voice(text).values, language).toMatchObject(values);
    expect(prepare('do mahine pehle').text).toBe('2 months pehle');
    expect(prepare('be varas').text).toBe('2 years');
    expect(prepare('rendu nela').text).toBe('2 months');
  });

  it('leaves them alone on their own', () => {
    for (const text of ['let it be', 'do it now', "don't worry", 'Don Bosco school', 'tin shed', 'noy', 'dui', 'teen age', 'char', 'Reena Das age 27']) {
      expect(prepare(text).text, text).toBe(text);
    }
    expect(voice('name Reena Das age 27').values).toEqual({ fullName: 'Reena Das', ageYears: '27' });
    // a unit word that is also a name is not a unit
    expect(prepare('name Varsha ek').text).toBe('name Varsha ek');
  });
});

describe('labels (plan 2.3 step 1)', () => {
  it('reads a label said with an accent when its value is said with it', () => {
    expect(prepare('prebious LSCS').text).toBe('previous LSCS');
    expect(prepare('privious caesarean').text).toBe('previous caesarean');
    expect(prepare('POG 28 wicks').text).toBe('POG 28 weeks');
    expect(prepare('hight 152').text).toBe('height 152');
    expect(voice('prebious LSCS G2 P1 L1 A0').values.obstetric.previousCaesareans).toBe('1');
    expect(prepare('prebious LSCS').changes).toEqual([{ heard: 'prebious', to: 'previous', rule: 'label', tier: 'A' }]);
  });

  it('never changes an ordinary word or a name, or a label with no value', () => {
    for (const text of [
      '2 books',
      'yours 28',
      'deliver 2',
      'Prebious Sharma came',
      'hight of the pain',
      'wicks',
      'weak 2',
      'is weak',
      // real words that sound like a label (found by running a dictionary through the sound matching)
      'she adores cats',
      'she adores her husband',
      'previews LSCS',
      '28 mounts',
      '28 wakes',
      '28 beaks',
    ]) {
      expect(prepare(text).text, text).toBe(text);
    }
    expect(voice('husband Ramesh age 32, she adores cats').values.address).toBeUndefined();
    // Hindi labels; "umar" is never read as age ("husband Umar 32")
    expect(prepare('pati ka naam Ramesh').text).toBe('husband name Ramesh');
    // "Pati" is also a surname (Odia)
    expect(prepare('name Sunita Pati age 28').text).toBe('name Sunita Pati age 28');
    expect(voice('name Sunita Pati, 28 years').values).toEqual({ fullName: 'Sunita Pati', ageYears: '28' });
    expect(voice('Sunita Pati 28 years').values.fullName).toBe('Sunita Pati');
    expect(voice('name Sunita Pati age 28, husband Ramesh age 32').values).toEqual({ fullName: 'Sunita Pati', ageYears: '28' });
    expect(prepare('name Sunita, pati Ramesh').text).toBe('name Sunita, husband Ramesh');
    expect(voice('patient ka naam Anjali Gupta hai age 28').values).toEqual({ fullName: 'Anjali Gupta', ageYears: '28' });
    expect(voice('husband Umar 32 years age 26').values).toEqual({ ageYears: '26' });
  });

  it('"baby off" is "baby of" only before a name, and only when the mother is not named another way', () => {
    expect(normaliseLabels('baby off lakshmi iyer born today').text).toBe('baby of lakshmi iyer born today');
    for (const text of ['baby off feeds, baby of Rekha', 'baby off phototherapy today, mother Sunita Rao', 'baby off feeds since morning', 'baby off oxygen now']) {
      expect(normaliseLabels(text).text, text).toBe(text);
    }
    expect(voice('baby off feeds, baby of Rekha born today 9 am', 'newborn').values).toMatchObject({ fullName: 'B/o Rekha', motherName: 'Rekha' });
    expect(voice('baby off feeds since morning, born today 4 am', 'newborn').values.motherName).toBeUndefined();
  });
});

describe('the lookup table (plan 2.3 step 8)', () => {
  it('tier A: changed anywhere; tier B: only with its anchor', () => {
    for (const [said, meant] of [
      ['previous sizerian', 'previous caesarean'],
      ['BDRL non reactive', 'VDRL non reactive'],
      ['auntie D given', 'anti-D given'],
      ['hyper tension', 'hypertension'],
      ['hypo thyroid', 'hypothyroid'],
      ['placenta pravia', 'placenta praevia'],
      ['Sirodkar stitch', 'Shirodkar stitch'],
      ['wentouse delivery', 'ventouse delivery'],
      ['kravida three bara two', 'gravida three para two'],
      ['gravity 2 para 1', 'gravida 2 para 1'],
      ['blood group bee positive', 'blood group B positive'],
      ['yeddie 12 January', 'EDD 12 January'],
    ]) {
      expect(prepare(said).text, said).toBe(meant);
    }
    for (const text of ['see section 3 of the report', 'she was leaving for work', 'bara bazaar', 'gravity', 'be positive about it', 'Eddie came', 'our clinic']) {
      expect(prepare(text).text, text).toBe(text);
    }
  });

  it('never swaps hypo and hyper, oligo and poly, or TT and Td', () => {
    expect(prepare('hypo thyroidism').text).toBe('hypothyroidism');
    expect(prepare('hyper thyroid').text).toBe('hyperthyroid');
    expect(voice('oligo hydramnios').values.notes).toBe('Oligohydramnios');
    expect(voice('poly hydramnios').values.notes).toBe('Polyhydramnios');
    expect(prepare('TT 2 doses given, Td booster').text).toBe('TT 2 doses given, Td booster');
  });

  it('a close short form is asked ("CDM" – GDM?), never changed', () => {
    const r = voice('CDM on diet G2 P1 L1 A0');
    expect(r.values.notes).toBeUndefined();
    const q = asked(r, /Did you mean “GDM”/);
    expect(q).toMatchObject({ heard: 'CDM', key: 'cdm', remember: true });
    expect(q.options.map((o) => o.label)).toEqual(['Yes – Gestational diabetes (this pregnancy)', 'Keep as said']);
    expect(answerToResult(q, q.options[0].value, 'antenatal').values.notes).toBe('Gestational diabetes (this pregnancy)');
    expect(prepare('CDM on diet').text).toBe('CDM on diet');
    // a "no" before it still counts
    expect(asked(voice('no BIH'), /PIH/)).toBeUndefined();
  });

  it('never swaps stable and unstable', () => {
    for (const text of ['baby is stable', 'baby is unstable']) {
      expect(prepare(text).text, text).toBe(text);
      expect(voice(text).values, text).toEqual({});
    }
    expect(voice('unstable lie').values.notes).toBe('Transverse / oblique lie');
    expect(voice('stable lie').values.notes).toBeUndefined();
  });

  it('"family planning operation" ticks a sterilisation only when said as done; planned or the husband’s never', () => {
    const sterilised = (r) => r.values.medical?.otherConditions;
    for (const text of ['counselled for family planning operation', 'husband had family planning operation', 'plan TL operation with LSCS', 'family planning operation advised', 'no family planning operation']) {
      const r = voice(text);
      expect(sterilised(r), text).toBeUndefined();
      expect(asked(r, /tubectomy/), text).toBeUndefined();
    }
    for (const text of ['TL operation done 2019', 'h/o TL operation', 'nasbandi done']) expect(sterilised(voice(text)), text).toBe('Previous sterilisation');
    const q = asked(voice('family planning operation'), /Did you mean “tubectomy”/);
    expect(q).toMatchObject({ remember: false });
    expect(q.options.map((o) => o.label)).toEqual(['Yes – Previous sterilisation', 'Keep as said']);
  });

  it('a close short form or a word that fills nothing is asked, and Yes adds it to the notes', () => {
    for (const [said, meant, note, careType = 'antenatal'] of [
      ['DSH normal', 'TSH', 'TSH normal'],
      ['dsh normal', 'TSH', 'TSH normal'],
      ['OKTT normal', 'OGTT', 'OGTT normal'],
      ['BOG 28 weeks', 'POG', 'POG 28 weeks'],
      ['tipsy test done', 'DIPSI', 'DIPSI test done'],
      ['phallic acid started', 'folic acid', 'Folic acid started'],
      ['animal scan normal', 'anomaly scan', 'Anomaly scan normal'],
      ['empty scan normal', 'NT scan', 'NT scan normal'],
    ]) {
      const r = voice(said, careType);
      expect(r.values, said).toEqual({});
      const q = asked(r, new RegExp(`Did you mean “${meant}”`));
      expect(q, said).toMatchObject({ remember: false });
      expect(r.questions, said).toHaveLength(1); // not also "The app doesn't know this short form"
      expect(answerToResult(q, q.options[0].value, careType).values.notes, said).toBe(note);
      expect(prepare(said, careType).text, said).toBe(said);
    }
    expect(voice('she was tipsy').questions).toEqual([]);
    // "Andy D given" is anti-D given (a note the app knows), and may be remembered
    const q = asked(voice('andy d given'), /Did you mean “anti-D given”/);
    expect(q).toMatchObject({ remember: true });
    expect(answerToResult(q, q.options[0].value, 'antenatal').values.notes).toBe('Anti-D given');
    const vent = asked(voice('delivered by vent house', 'postnatal'), /Did you mean “ventouse”/);
    expect(vent.options.map((o) => o.label)).toEqual(['Yes – Instrumental delivery', 'Keep as said']);
  });

  it('"wait 58" is the weight, never "wait 2 weeks"', () => {
    expect(voice('wait 58').values.medical.weightKg).toBe('58');
    expect(voice('wait 58 kg').values.medical.weightKg).toBe('58');
    for (const text of ['wait 2 weeks', 'wait for 10 minutes', 'wait 30 days']) {
      const r = voice(text);
      expect(r.values.medical?.weightKg, text).toBeUndefined();
      expect(r.corrections, text).toEqual([]);
    }
    const q = asked(voice('wait 25'), /Did you mean “weight”/);
    expect(answerToResult(q, q.options[0].value, 'antenatal').values.medical.weightKg).toBe('25');
  });
});

describe('fillers, trailing words, months and masked words (plan 2.3 steps 4 and 7)', () => {
  it('removes Hinglish fillers', () => {
    expect(prepare('LMP haan 12 July').text).toBe('LMP 12 July');
    expect(prepare('age hai 28').text).toBe('age 28');
    expect(voice('age ji 26').values.ageYears).toBe('26');
    expect(voice('haan ji, 2 bacche').values.obstetric).toBeUndefined();
    expect(voice('ji 2 P1 L1 A0').values.obstetric.gravida).toBe('2');
    expect(voice('Sharma ji 28 years').values.ageYears).toBe('28');
  });

  it('removes emphasis words only after a value, and reads a tag "no" as a question word', () => {
    expect(voice('LMP 5th July only').values.pregnancy.lmp).toBe('2026-07-05');
    expect(voice('age 28 only').values.ageYears).toBe('28');
    expect(voice('age 28 bas').values.ageYears).toBe('28');
    expect(prepare('LMP 5th July itself').text).toBe('LMP 5th July');
    expect(prepare('only child').text).toBe('only child');
    const r = voice('LMP was 5th July no, diabetes nil');
    expect(r.values.pregnancy.lmp).toBe('2026-07-05');
    expect(ticks(r)).toEqual([]);
    expect(ticks(voice('no, diabetes'))).toEqual([]);
  });

  it('reads numbers and months said with an accent', () => {
    expect(voice('age tirty two').values.ageYears).toBe('32');
    expect(voice('LMP twenty tree June').values.pregnancy.lmp).toBe('2026-06-23');
    expect(voice('LMP 12 jully').values.pregnancy.lmp).toBe('2026-07-12');
    expect(voice('LMP 3rd agust').values.pregnancy.lmp).toBe('2026-08-03');
    expect(voice('LMP yeleven July 2026').values.pregnancy.lmp).toBe('2026-07-11');
    expect(voice('address is ward number tree, sadar bazaar, raipur').values.address).toMatch(/^Ward Number 3,/);
    expect(voice('baby of Anita born today at 8:20 am birth weight two point tree kg', 'newborn').values.newborn.birthWeightGrams).toBe('2300');
    // "sero" is not a number, and a tree is a tree
    for (const text of ['HIV sero negative', 'address 12 Palm Tree Colony', 'sugar free', 'a tree fell']) {
      expect(voice(text).corrections, text).toEqual([]);
    }
    expect(voice('address 12 Palm Tree Colony').values.address).toBe('12 Palm Tree Colony');
    // in an address "tree", "van" or "hero" is a number only straight after its keyword, or in a pincode not yet whole
    expect(voice('address ward no tree, Tree Park Road').values.address).toBe('Ward no 3, Tree Park Road');
    expect(voice('address pin code four six two zero tree won').values.address).toBe('Pin Code 462031');
    for (const [text, address] of [
      ['address Plot 7 Van Vihar Colony Bhopal', 'Plot 7 Van Vihar Colony Bhopal'],
      ['address house no 12 Tree Park Road', 'House no 12 Tree Park Road'],
      ['address flat 3 hero complex', 'Flat 3 Hero Complex'],
      ['address pin 462016 Van Vihar Bhopal', 'Pin 462016 Van Vihar Bhopal'],
    ]) {
      const r = voice(text);
      expect(r.values.address, text).toBe(address);
      expect(r.corrections, text).toEqual([]);
    }
  });

  it('words hidden as *** never stop the rest being read', () => {
    const r = voice('LMP 5th July *** age 28 f*** G2 P1 L1 A0');
    expect(r.values).toMatchObject({ ageYears: '28', pregnancy: { lmp: '2026-07-05' }, obstetric: { gravida: '2' } });
    expect(r.corrections).toEqual([]);
  });
});

describe('after numbers became digits (plan 2.4)', () => {
  it('reads "to", "for", "tree" and "hero" inside the formula only', () => {
    expect(voice('G to P1 L1 A hero').values.obstetric).toEqual({ gravida: '2', para: '1', living: '1', abortions: '0' });
    expect(voice('G tree P do L do A hero').values.obstetric).toEqual({ gravida: '3', para: '2', living: '2', abortions: '0' });
    expect(voice('A1 abortion for fetal anomaly', 'gynaecology').values.obstetric).toBeUndefined();
    expect(voice('Patil ji 28').values).toEqual({});
  });

  it('a height said as "1 52" is 152 cm; "5 2" is asked', () => {
    expect(afterDigits('height 1 52').text.trim()).toBe('height 152');
    expect(afterDigits('1 52 cm').text.trim()).toBe('152 cm');
    expect(afterDigits('height 5 2').text.trim()).toBe('height 5 2');
    expect(afterDigits('fundal height 1 5').text.trim()).toBe('fundal height 1 5');
  });

  it('joins "20 26" into a year only after a day and a month', () => {
    expect(afterDigits('LMP 5 March 20 26').text.trim()).toBe('LMP 5 March 2026');
    expect(afterDigits('LMP March 20 26').text.trim()).toBe('LMP March 20 26');
    expect(voice('LMP July 20 26 years old').values).toEqual({ ageYears: '26', pregnancy: { lmp: '2026-07-20' } });
    expect(voice('LMP March 20 28 weeks pregnant').values.pregnancy.lmp).toBe('2026-03-20');
    expect(voice('LMP August 20 12 weeks').values.pregnancy.lmp).toBe('2026-08-20');
    expect(voice('born September 20 10 30 am', 'newborn').values.newborn.birthAt).toBe('2026-09-20T10:30');
  });

  it('asks about an approximate date, never fills it', () => {
    for (const [text, date] of [
      ['LMP 2 months back', '28 Jul 2026'],
      ['LMP do mahine pehle', '28 Jul 2026'],
      ['LMP 15 days before', '13 Sep 2026'],
      ['LMP last month 5th', '5 Aug 2026'],
      ['LMP day before yesterday', '26 Sep 2026'],
      ['LMP kal', '27 Sep 2026'],
      ['LMP parson', '26 Sep 2026'],
    ]) {
      const r = voice(text);
      expect(r.values.pregnancy, text).toBeUndefined();
      expect(asked(r, new RegExp(`LMP about ${date}`)), text).toMatchObject({ group: 'safety' });
    }
    expect(voice('LMP pichhle mahine').notes.join(' ')).toMatch(/Say or type the date/);
    // a birth said as "kal" is asked too ("kal" is yesterday or tomorrow)
    const born = voice('baby of Anita born kal raat 11 baje weight 2.8 kg', 'newborn');
    expect(born.values.newborn?.birthAt).toBeUndefined();
    const q = asked(born, /Born on 27 Sep 2026 \(said: “kal”\)/);
    expect(answerToResult(q, q.options[0].value, 'newborn').values.newborn.birthAt).toBe('2026-09-27T23:00');
  });

  it('only a "kal" in the birth phrase itself makes the day unsure', () => {
    for (const [text, at] of [
      ['baby of Asha born today 4 am, kal mother had fever', '2026-09-28T04:00'],
      ['born at 4 am, kal se doodh nahi pee raha', '2026-09-28T04:00'],
      ['baby of Asha born yesterday 10 pm, parson mother admitted', '2026-09-27T22:00'],
      ['baby of Asha born at 10 pm. Mother came kal', '2026-09-27T22:00'],
      ['normal delivery, kal mother had fever, baby born at 4 am', '2026-09-28T04:00'],
    ]) {
      const r = voice(text, 'newborn');
      expect(r.values.newborn?.birthAt, text).toBe(at);
      expect(asked(r, /Born on/), text).toBeUndefined();
    }
    for (const text of ['born kal raat 10 baje', 'born at 9 am kal', 'born kal, 4 am', 'born kal 4 am, today mother fine']) {
      const r = voice(text, 'newborn');
      expect(r.values.newborn?.birthAt, text).toBeUndefined();
      expect(asked(r, /Born on 27 Sep 2026 \(said: “kal”\)/), text).toBeTruthy();
    }
  });
});

describe('the positive/negative guard (plan 2.3 step 5)', () => {
  it('reads "none/nan reactive" after a test as non-reactive, and asks everything else', () => {
    expect(prepare('VDRL none reactive').text).toBe('VDRL non-reactive');
    expect(prepare('HIV nan reactive').text).toBe('HIV non-reactive');
    // no test named: left as heard
    expect(prepare('none reactive').text).toBe('none reactive');
    for (const text of ['HIV known reactive', 'HIV on reactive', 'HIV none positive']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(r.questions.find((q) => q.group === 'confirm'), text).toBeTruthy();
    }
    // a doctor's own word never switches the guard off
    expect(asked(voice('HBsAg known reactive', 'antenatal', [{ phrase: 'known', meaning: 'ignore' }]), /HBsAg/)).toBeTruthy();
  });
});

describe('the doctor’s own words and Remember (plan 2.5)', () => {
  it('never changes a learned word', () => {
    expect(prepare('previous sizerian', 'antenatal', ['sizerian']).text).toBe('previous sizerian');
    expect(voice('pibroid uterus', 'gynaecology', [{ phrase: 'pibroid', meaning: 'other:Fibroid uterus' }]).values.medical.otherConditions).toBe('Fibroid uterus');
    const r = voice('tree 2 3', 'antenatal', [{ phrase: 'tree', meaning: 'ignore' }]);
    expect(r.corrections).toEqual([]);
  });

  it('rejects learned words that could change a result or a "no"', () => {
    for (const phrase of ['no', 'not', 'non', 'none', 'nil', 'known', 'on', 'positive', 'negative', 'reactive', 'sorry', 'none reactive', 'wait 58']) {
      expect(isBlockedLearned(phrase), phrase).toBe(true);
    }
    expect(isBlockedLearned('pibroid')).toBe(false);
  });

  it('never offers Remember for a word after husband, Dr, Mr, Mrs, w/o, d/o, "baby of" or "referred by"', () => {
    // said alone, "CDM" offers Remember (all capitals, so the capital-letter rule does not hide it)
    expect(asked(voice('CDM'), /Did you mean “GDM”/)).toMatchObject({ remember: true });
    for (const before of ['husband', 'Dr', 'Mr', 'Mrs', 'w/o', 'd/o', 'baby of', 'referred by']) {
      expect(voice(`${before} CDM`).questions.filter((q) => q.remember), before).toEqual([]);
    }
  });
});

describe('what was heard and changed is listed (plan 1.7)', () => {
  it('lists each word changed, and never a word about the baby’s sex', () => {
    const r = voice('previous sizerian, BDRL non reactive, age tirty');
    expect(r.corrections.map((c) => [c.heard, c.to]).sort()).toEqual([
      ['BDRL', 'VDRL'],
      ['sizerian', 'caesarean'],
      ['tirty', 'thirty'],
    ]);
    for (const text of ['baby is a boy as per scan', 'ladka hai', 'baby girl']) expect(voice(text).corrections, text).toEqual([]);
  });

  it('no list or lookup of this layer holds a word about the baby’s sex (PCPNDT)', () => {
    const lists = [
      ...FILLERS,
      ...TRAILING_FILLERS,
      ...Object.keys(INDIAN_NUMBERS),
      ...Object.keys(ACCENT_NUMBER_WORDS),
      ...Object.keys(MONTH_SPELLINGS),
      ...Object.keys(LETTER_NAMES.strong),
      ...Object.keys(LETTER_NAMES.weak),
      ...LOOKUPS.map((row) => (typeof row.to === 'string' ? row.to : '')),
      ...EXTRA_VOCAB,
      ...[...soundVocabulary().words.values()].map((e) => e.word),
    ];
    expect(lists.filter((w) => mentionsFetalSex(w) || /^(?:ladka|ladki|beta|beti|boy|girl|male|female)$/i.test(w))).toEqual([]);
  });
});

describe('common words and mishearings', () => {
  // (a few are findings themselves – "asthma", "thyroid" – and tick what they mean; nothing else may be ticked)
  const SAID_AS_TERM = new Set(TERMS.flatMap((t) => t.says.map((say) => say.toLowerCase())));
  it(`changes none of the ${commonWords.length} common dictation words, and ticks nothing from them`, () => {
    const changed = commonWords.filter((w) => prepare(w).text !== w || afterDigits(w).text.trim() !== w || voice(w).corrections.length);
    expect(changed).toEqual([]);
    expect(commonWords.filter((w) => !SAID_AS_TERM.has(w) && ticks(voice(w)).length)).toEqual([]);
  });

  it('changes and ticks nothing in 500 random sentences made of them (seeded)', () => {
    // (without the few that are findings themselves)
    const plain = commonWords.filter((w) => !SAID_AS_TERM.has(w));
    let seed = 2026;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const sentences = Array.from({ length: 500 }, () => Array.from({ length: 4 + Math.floor(next() * 7) }, () => plain[Math.floor(next() * plain.length)]).join(' '));
    const changed = sentences.filter((t) => {
      const r = voice(t);
      return r.corrections.length > 0 || ticks(r).length > 0;
    });
    expect(changed).toEqual([]);
  });

  const same = (a, b) => a.toLowerCase().replace(/ae|oe/g, 'e').replace(/[^a-z]/g, '') === b.toLowerCase().replace(/ae|oe/g, 'e').replace(/[^a-z]/g, '');
  const results = mishears.cases.map((c) => {
    const out = prepare(c.heard).text;
    return { ...c, out, status: out === c.heard ? 'unchanged' : same(out, c.meant) ? 'corrected' : 'wrong' };
  });
  const corrected = results.filter((r) => r.status === 'corrected').length;
  it(`never changes a mishearing into a wrong word (${corrected} of ${results.length} corrected by the lookup table and matching by sound)`, () => {
    console.info(`Mishearings: ${corrected} of ${results.length} corrected, ${results.filter((r) => r.status === 'wrong').length} wrong`);
    expect(results.filter((r) => r.status === 'wrong')).toEqual([]);
  });
  it(`corrects at least 46 of the 63 mishearings automatically (${corrected})`, () => {
    expect(corrected).toBeGreaterThanOrEqual(46);
  });

  it(`changes no Indian name or place (${indianNames.length}), and asks about none without a clinical word before it`, () => {
    const changed = [];
    // ("Pati" is also the Hindi word for husband: read as a surname only after a first name, "Sunita Pati" – plan 2.3)
    for (const name of indianNames.filter((n) => n !== 'Pati')) {
      for (const text of [name, name.toLowerCase(), `husband ${name}`, `Dr ${name}`, `${name} Hospital`, `name ${name} age 28`, `address ${name}`, `she lives in ${name}`]) {
        const r = voice(text);
        if (prepare(text).text !== text || r.corrections.length || r.questions.length || ticks(r).length || r.values.notes) changed.push(text);
      }
    }
    expect(changed).toEqual([]);
  }, 30000);

  it('a name said first with no keyword is never changed by sound, even one not in indianNames.txt', () => {
    for (const [text, name] of [
      ['Aprilia Dsouza 28 years G1', 'Aprilia Dsouza'],
      ['patient Elvin Mary 30 years', 'Elvin Mary'],
      ['Jaundis Ahmed 25 years', 'Jaundis Ahmed'],
      ['Animika Shah age 24', 'Animika Shah'],
      ['anamika sharma twenty six years lmp fifth july', 'Anamika Sharma'],
      ['aakriti sharma twenty six years lmp fifth july', 'Aakriti Sharma'],
    ]) {
      const r = voice(text);
      expect(r.values.fullName, text).toBe(name);
      expect(r.corrections, text).toEqual([]);
      expect(ticks(r), text).toEqual([]);
      expect(r.values.notes, text).toBeUndefined();
    }
    // a name, not an illness: "Anamika" (anaemic) after "name" or "Mrs", and "anaemia" after a name
    expect(voice('name Anamika Sharma 26 years').values.fullName).toBe('Anamika Sharma');
    expect(voice('Mrs Anamika Joshi 24 years').values.fullName).toBe('Anamika Joshi');
    const r = voice('name Sunita Sharma anemia');
    expect(r.values.fullName).toBe('Sunita Sharma');
    expect(ticks(r)).toEqual(['anaemia']);
    // not a name: an illness said first, or "… 3 years back"
    expect(ticks(voice('known case of anaemia'))).toEqual(['anaemia']);
    expect(findProtectedSpans('previous LSCS 3 years back').filter((p) => p.kind === 'name')).toEqual([]);
  });
});

describe('matching words by sound (plan 2.5)', () => {
  it('keys: prefixes that make a word its opposite stay apart', () => {
    expect(indiKey('hypothyroid')).not.toBe(indiKey('hyperthyroid'));
    expect(indiKey('oligohydramnios')).not.toBe(indiKey('polyhydramnios'));
    expect(indiKey('haipothyroid')).toBe(indiKey('hypothyroid'));
    expect(indiKey('hipotyroid')).toBe(indiKey('hypothyroid'));
    expect(indiKey('polihydramnios')).toBe(indiKey('polyhydramnios'));
    expect(indiKey('sterlisation')).toBe(indiKey('sterilisation'));
    expect(indiKey('azoosphermia')).toBe(indiKey('azoospermia'));
    expect(indiKey('eclamsia')).toBe(indiKey('eclampsia'));
    expect(accentDistance('diabitis', 'diabetes')).toBeLessThan(accentDistance('diabitis', 'dialysis'));
  });

  it('never matches across a prefix: hypo ≠ hyper, oligo ≠ poly, stable ≠ unstable, normal ≠ abnormal', () => {
    expect(prepare('haipothyroid').text).toBe('hypothyroid');
    expect(prepare('haiperthyroid').text).toBe('hyperthyroid');
    expect(prepare('oligohydramnious').text).toBe('oligohydramnios');
    expect(ticks(voice('hipotyroid on Thyronorm'))).toEqual(['thyroid']);
    expect(voice('oligohydramnious').values.notes).toBe('Oligohydramnios');
    for (const text of ['baby is stable', 'stabel lie', 'normel scan', 'creased liquor']) {
      const r = voice(text);
      expect(r.corrections, text).toEqual([]);
      expect(r.values.notes, text).toBeUndefined();
    }
  });

  it('one case for each sound Indian English speakers swap', () => {
    for (const [said, meant] of [
      ['Balparin', 'Valparin'], // b / v
      ['pluoxetine', 'fluoxetine'], // p / f
      ['pibroid uterus', 'fibroid uterus'], // p / f
      ['zaundice', 'jaundice'], // z / j
      ['hypertenshion', 'hypertension'], // s / sh
      ['solestasis', 'cholestasis'], // ch / s
      ['fibloid', 'fibroid'], // l / r
      ['hydrocephalu', 'hydrocephalus'], // a last consonant not said
      ['haipothyroid', 'hypothyroid'], // hipo / haipo
    ]) {
      expect(prepare(said).text, said).toBe(meant);
    }
    // syphilis is a blood-test result (plan 2.6): matched by sound, it is asked about, never changed
    expect(prepare('shiphilis').text).toBe('shiphilis');
    expect(asked(voice('history of shiphilis'), /Did you mean “syphilis”/)).toBeTruthy();
    expect(ticks(voice('history of shiphilis'))).toEqual([]);
    // "zondis" is further from jaundice: asked after a clinical word, and never changed
    const r = voice('history of zondis');
    expect(r.corrections).toEqual([]);
    expect(asked(r, /Did you mean “jaundice”/)).toMatchObject({ key: 'zondis', remember: true });
  });

  it('reports each word it changes, and fills from the whole term only', () => {
    const r = voice('fibloid uterus');
    expect(r.corrections).toEqual([{ heard: 'fibloid', to: 'fibroid', rule: 'sound', tier: 'A' }]);
    expect(r.values.medical.otherConditions).toBe('Fibroid uterus');
    // a word of a longer term ticks nothing by itself
    expect(ticks(voice('thalasemia'))).toEqual([]);
    expect(voice('thalasemia').values.medical).toBeUndefined();
  });

  it('asks instead when it is not sure – only after a clinical word, never for an ordinary word alone', () => {
    expect(voice('zondis').questions).toEqual([]);
    expect(asked(voice('known case of zondis'), /Did you mean “jaundice”/)).toBeTruthy();
    expect(asked(voice('known case of Zondis'), /Did you mean “jaundice”/)).toMatchObject({ remember: false }); // may be a name
    for (const word of ['gravity', 'pleasant', 'animal', 'vesicle', 'scripture', 'leaving', 'fatal']) {
      expect(fuzzyTerm(word)?.mode, word).not.toBe('auto');
      expect(prepare(`she said ${word}`).text, word).toBe(`she said ${word}`);
    }
  });

  it('an everyday word said a little differently is never changed into a finding (cephalis is cephalic, not syphilis)', () => {
    for (const [text, notes] of [
      ['USG single live fetus cephalis presentation'],
      ['IVF concetion twins', 'Conceived by IVF / ICSI; Twin pregnancy'],
      ['post op conition stable'],
      ['abdomen soft, abdoen non tender'],
      ['oppasite'],
      ['Labebet 2 tabbets daily'],
      ['previous LSCS twnce'],
      ['birth weight 2800 gravs'],
    ]) {
      const r = voice(text);
      expect(r.corrections.filter((c) => c.rule === 'sound'), text).toEqual([]);
      expect(ticks(r), text).toEqual([]);
      expect(r.values.medical?.otherConditions, text).toBeUndefined();
      expect(r.values.notes, text).toBe(notes);
    }
  });

  it('no one-letter slip of an everyday dictation word is changed into a finding automatically (generated)', () => {
    // Every word of 5 letters or more in DICTATION_WORDS, with each letter left out, changed to any other letter, or
    // swapped with the next (about 63,000 words)
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const bad = [];
    for (const w of [...DICTATION_WORDS].filter((x) => x.length >= 5)) {
      const slips = new Set();
      for (let i = 0; i < w.length; i += 1) {
        slips.add(w.slice(0, i) + w.slice(i + 1));
        for (const c of letters) slips.add(w.slice(0, i) + c + w.slice(i + 1));
        if (i < w.length - 1) slips.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
      }
      slips.delete(w);
      for (const slip of slips) {
        const got = fuzzyTerm(slip);
        if (got?.mode === 'auto' && got.kind === 'term') bad.push(`${w} → ${slip} → ${got.to}`);
      }
    }
    expect(bad).toEqual([]);
  }, 30000);

  it('a word that is not English is asked about ("Did you mean …?") even with no clinical word before it', () => {
    for (const [said, meant] of [['animia', 'anemia'], ['asthoma', 'asthma'], ['hypartension', 'hypertension']]) {
      const r = voice(said);
      expect(asked(r, new RegExp(`Did you mean “${meant}”`)), said).toBeTruthy();
      expect(ticks(r), said).toEqual([]);
    }
    expect(asked(voice('G2 P1 L1, asthoma, LMP 5th July'), /Did you mean “asthma”/)).toBeTruthy();
    // an ordinary word or a name is asked about only after a clinical word
    for (const word of ['seizure', 'Kochi', 'kochi', 'Premila']) expect(voice(word).questions, word).toEqual([]);
    expect(asked(voice('known case of seizure'), /Did you mean/)).toBeTruthy();
  });

  it('a term the app knows, said exactly, is never changed by sound and means the same as typed', () => {
    const bad = [];
    for (const say of new Set(TERMS.flatMap((t) => t.says))) {
      for (const text of [say, `known case of ${say}`]) {
        const v = voice(text);
        const typed = extractPatientDetails(text, { careType: 'antenatal', now, words: [] });
        if (v.corrections.some((c) => c.rule === 'sound') || JSON.stringify(v.values) !== JSON.stringify(typed.values)) bad.push(text);
      }
    }
    expect(bad).toEqual([]);
  }, 30000);

  it('never corrects words under 4 letters, words about the baby’s sex, or a word said inside a name or address', () => {
    expect(fuzzyTerm('tb')).toBeNull();
    expect(fuzzyTerm('femail')).toBeNull();
    expect(voice('husband Pibroid Sharma').corrections).toEqual([]);
    expect(voice('address 12 Diabitis Nagar').corrections).toEqual([]);
  });

  it('a result word is never changed by sound ("none reactive" stays for its question)', () => {
    expect(prepare('none reactive').text).toBe('none reactive');
    expect(prepare('HIV non reactive').text).toBe('HIV non reactive');
    expect(prepare('possitive').text).toBe('possitive');
  });

  it('joins a word said in parts (plan 2.3 step 9)', () => {
    expect(prepare('glyco met 500').text).toBe('Glycomet 500');
    expect(asked(voice('glyco met 500'), /metformin/)).toBeTruthy();
    expect(voice('previous still born baby').values.obstetric.pastComplications).toEqual(['stillbirth_or_neonatal_death']);
    expect(prepare('PC OD').text).toBe('PCOD');
    expect(prepare('RHD with severe MS B').text).toBe('RHD with severe MS B');
    expect(prepare('twins you').text).toBe('twins');
    expect(prepare('twins you are').text).toBe('twins you are');
    // a short word said with a word is not a piece of it ("convulsion is" is not "convulsions")
    expect(prepare('convulsion is not there').text).toBe('convulsion is not there');
    expect(prepare('seizure as a child').text).toBe('seizure as a child');
    expect(prepare('I asthma').text).toBe('I asthma');
    expect(ticks(voice('fit is not there'))).toEqual([]);
    expect(voice('twin is not there').values.notes).toBeUndefined();
    expect(prepare('prime gravida').text).toBe('primigravida');
    // never starting with a, an, no, on or of; two ordinary words asked by the lookup table stay for its question
    expect(prepare('a normally scan').text).toBe('anomaly scan');
    expect(prepare('no nsense').text).toBe('no nsense');
    expect(asked(voice('delivered by vent house', 'postnatal'), /ventouse/)).toBeTruthy();
  });

  it('matches a phrase with one word heard differently ("shugar in pregnancy")', () => {
    expect(voice('shugar in pregnancy on diet').values.notes).toBe('Gestational diabetes (this pregnancy)');
    expect(voice('shugar').corrections).toEqual([]);
  });

  it('a doctor’s own word is matched first: a learned "ignore" stops matching by sound', () => {
    expect(voice('pibroid', 'gynaecology', [{ phrase: 'pibroid', meaning: 'ignore' }]).corrections).toEqual([]);
    expect(voice('known case of zondis', 'antenatal', [{ phrase: 'zondis', meaning: 'condition:liver_disease' }]).values.medical.conditions).toEqual(['liver_disease']);
  });

  it('every pair of known words that sound alike and mean different things is in NEVER_AUTO_PAIRS', () => {
    // (runs on every change to the words the app knows)
    const listed = new Set(NEVER_AUTO_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`].map((k) => k.toLowerCase())));
    const entries = [...soundVocabulary().words.values()];
    const close = [];
    for (const a of entries) {
      const keys = new Set(keyVariants(a.plain));
      for (const b of entries) {
        if (a === b || a.meaning === b.meaning) continue;
        const k = indiKey(b.plain);
        const sameKey = keys.has(k) || (k.length - k.indexOf(':') - 1 >= 4 && keys.has(k.slice(0, -1)));
        if (sameKey && accentDistance(a.plain, b.plain) <= 0.15 * b.plain.length + 0.6) close.push(`${a.word}|${b.word}`.toLowerCase());
      }
    }
    // phrases that differ in one word, which matching by sound may change ("hepatitis B" / "hepatitis C")
    const { phrases } = soundVocabulary();
    for (const a of phrases) {
      for (const b of phrases) {
        if (a === b || a.meaning === b.meaning || a.words.length !== b.words.length) continue;
        const diff = a.words.flatMap((w, k) => (w === b.words[k] ? [] : [k]));
        if (diff.length !== 1) continue;
        const [k] = diff;
        const [h, m] = [a.words[k], b.words[k]];
        if (b.fixed[k] || h.length < 4 || m.length < 4) continue;
        if (keyVariants(h).includes(indiKey(m)) && accentDistance(h, m) <= 0.6) close.push(`${a.said}|${b.said}`.toLowerCase());
      }
    }
    expect(close.length).toBeGreaterThan(0); // (the numbers: "eight" / "eighty")
    expect(close.filter((pair) => !listed.has(pair))).toEqual([]);
  });

  it('the real-word guard is up to date and under 30 KB (node client/scripts/make-word-guard.mjs)', () => {
    expect(GUARD_HASH, 'run: node client/scripts/make-word-guard.mjs').toBe(guardHash());
    expect(statSync(new URL('./realWordGuard.js', import.meta.url)).size).toBeLessThan(30 * 1024);
    // every common word and Indian name that matching by sound would change is in it
    expect([...commonWords, ...indianNames].filter((w) => changedBySound(w) && !REAL_WORDS.has(w.toLowerCase()))).toEqual([]);
    for (const w of ['gravity', 'pleasant']) expect(REAL_WORDS.has(w), w).toBe(true);
  });
});

describe('the accent research’s test cases (research-accents.md §7h)', () => {
  it('1–4: the formula and caesareans', () => {
    expect(voice('Name Sunita Devi age 28 gravida tree para two leaving two abortion zero').values).toMatchObject({
      fullName: 'Sunita Devi',
      ageYears: '28',
      obstetric: { gravida: '3', para: '2', living: '2', abortions: '0' },
    });
    expect(voice('G to P1 L1 A hero').values.obstetric).toEqual({ gravida: '2', para: '1', living: '1', abortions: '0' });
    expect(voice('gravity 2 para 1 living 1').values.obstetric).toEqual({ gravida: '2', para: '1', living: '1' });
    for (const text of ['previous else CS one', 'previous 1 LS CS', 'previous sizerian']) expect(voice(text).values.obstetric?.previousCaesareans, text).toBe('1');
  });

  it('5–7: results, blood group and anti-D', () => {
    const r = voice('VDRL none reactive, HIV nan reactive, HBsAg known reactive');
    expect(ticks(r)).toEqual([]);
    expect(asked(r, /HBsAg/)).toMatchObject({ group: 'confirm' });
    const bg = voice('blood group bee positive, are H positive');
    expect(bg.values.medical).toBeUndefined();
    expect(asked(bg, /Blood group B\+/)).toMatchObject({ group: 'confirm' });
    for (const text of ['anti D given', 'auntie D given']) expect(voice(text).values.notes, text).toBe('Anti-D given');
  });

  it('8–12: dates, phone, height, age and weeks', () => {
    expect(voice('LMP 12 by 7').values.pregnancy.lmp).toBe('2026-07-12');
    expect(voice('LMP 12 7 2026').values.pregnancy.lmp).toBe('2026-07-12');
    expect(voice('last date was 5th July').values.pregnancy.lmp).toBe('2026-07-05');
    expect(asked(voice('LMP two months back'), /LMP about 28 Jul 2026/)).toBeTruthy();
    expect(asked(voice('LMP 3rd of this month'), /LMP about 3 Sep 2026/)).toBeTruthy();
    expect(voice('phone nine eight oh one two three four five six seven').values.phone).toBe('98012 34567');
    expect(voice('height one fifty two cm').values.medical.heightCm).toBe('152');
    expect(asked(voice('Asha Sample ninety years'), /Age 90 or 19/)).toBeTruthy();
    const pog = voice('LMP 5 July 2026 POG forty weeks');
    expect(pog.values).toEqual({});
    expect(asked(pog, /gives 12 weeks, but 40 weeks was said/)).toMatchObject({ group: 'safety' });
  });

  it('13–15: split words and guards', () => {
    expect(voice('oligo hydramnios').values.notes).toBe('Oligohydramnios');
    expect(ticks(voice('hyper tension'))).toEqual(['hypertension']);
    expect(ticks(voice('hypo thyroid'))).toEqual(['thyroid']);
    expect(prepare('hypo thyroid').text).toBe('hypothyroid');
    expect(voice('pre eclampsia in last pregnancy').values.obstetric.pastComplications).toEqual(['pre_eclampsia']);
    expect(voice('she was leaving for work').values.obstetric).toBeUndefined();
    expect(ticks(voice('fatal accident in the family'))).toEqual([]);
    expect(voice('came to our clinic').values.medical).toBeUndefined();
    expect(voice('name Asha Patil age 26').values.fullName).toBe('Asha Patil');
    expect(voice('haan ji, 2 bacche').values.obstetric).toBeUndefined();
  });
});

describe('the plan’s own accent examples, in antenatal and gynaecology care', () => {
  it.each(['antenatal', 'gynaecology'])('%s: "pibroid", "tired", "tee bee" and "k c o"', (careType) => {
    for (const text of ['h/o pibroid', 'known case of pibroid', 'pibroid uterus']) {
      const r = voice(text, careType);
      expect(r.values.medical?.otherConditions, text).toBe('Fibroid uterus');
      expect(r.corrections, text).toEqual([{ heard: 'pibroid', to: 'fibroid', rule: 'lookup', tier: 'A' }]);
    }
    // "tired" is a word: asked only straight after a word that names an illness, with Remember
    const tired = voice('known case of tired', careType);
    expect(ticks(tired)).toEqual([]);
    expect(asked(tired, /Did you mean “thyroid”/)).toMatchObject({ key: 'tired', remember: true });
    expect(tired.unused).toEqual([]);
    for (const text of ['she is tired', 'patient complains of feeling tired', 'tired since 2 days']) expect(voice(text, careType).questions, text).toEqual([]);
    // "tee bee" is T B: two letters that would tick a finding are asked
    expect(asked(voice('history of tee bee', careType), /“TB” was heard as letters/)).toBeTruthy();
    expect(ticks(voice('history of tee bee', careType))).toEqual([]);
    // "k c o" is "known case of", so "c o D M" is never OD
    const kco = voice('k c o D M', careType);
    expect(asked(kco, /“DM” was heard as letters/)).toBeTruthy();
    expect(kco.unused).toEqual([]);
    expect(JSON.stringify(kco)).not.toMatch(/\bOD\b/);
  });

  it('never makes "known case of" from initials in a name, nor a letter from "bee" alone', () => {
    expect(voice('name K C O Mary age 30').values.fullName).toBe('K C O Mary');
    expect(voice('bee sting allergy').corrections).toEqual([]);
    expect(decodeLetters('tee bee').text).toBe('TB');
    expect(decodeLetters('bee you').text).toBe('bee you'); // weak words alone are never letters
  });
});
