// Voice entry: what the owner's test in Google Chrome (29 Sep 2026) changed, and what it left as it was (all fake
// sample data). The Chrome transcripts themselves are in testdata/voiceOwnerChrome.json (dictation.corpus.test.js).
import { describe, expect, it, vi } from 'vitest';
import { answerToResult, extractPatientDetails } from './dictation.js';
import { findProtectedSpans, normaliseLabels, prepareTranscript } from './indianEnglish.js';
import { hearingPhrases } from './obgyTerms.js';
import { ACTIVITY_EVENT, speechActivity } from './voiceSession.js';
import { mentionsFetalSex } from '../../pcpndtWords.js';

const now = new Date(2026, 8, 29, 11, 0); // 29 Sep 2026, 11:00
const voice = (text, careType = 'antenatal', keep = []) => extractPatientDetails(text, { careType, now, words: [], voice: true, keep });
const typed = (text, careType = 'antenatal') => extractPatientDetails(text, { careType, now });
const ticks = (r) => [...(r.values.medical?.conditions ?? []), ...(r.values.obstetric?.pastComplications ?? [])];
const asked = (r, rx) => r.questions.find((q) => rx.test(`${q.prompt} | ${q.heard} | ${q.options.map((o) => o.label).join(' | ')}`));
const unused = (r) => r.unused.map((u) => u.text);
const prepare = (text) => {
  const labels = normaliseLabels(` ${text} `);
  return prepareTranscript(labels.text, { careType: 'antenatal', spans: findProtectedSpans(labels.text) });
};

describe('1. "NTD given" is anti-D given', () => {
  it('Chrome\'s "NTD" before given, injection, dose … becomes anti-D, listed with Undo', () => {
    const r = voice('Blood group Rh negative NTD given at 28 weeks');
    expect(r.corrections).toEqual([{ heard: 'NTD', to: 'anti-D', rule: 'lookup', tier: 'B' }]); // no `undo: false`: it can be undone
    expect(r.values.notes).toBe('Anti-D given at 28 weeks');
    expect(asked(r, /^Which ABO group\?/)).toMatchObject({ group: 'confirm', heard: 'Rh negative' });
    expect(asked(r, /previous pregnancy, or in this one/i)).toBeUndefined();
    expect(r.questions).toHaveLength(1);
    expect(unused(r)).toEqual([]);
    for (const [said, meant] of [
      ['NTD given', 'anti-D given'],
      ['N T D given', 'anti-D given'],
      ['N.T.D. given', 'anti-D given'],
      ['NTD injection at 28 weeks', 'anti-D injection at 28 weeks'],
      ['ntd inj given', 'anti-D inj given'],
      ['NTD dose due', 'anti-D dose due'],
      ['NTD administered', 'anti-D administered'],
      ['NTD taken', 'anti-D taken'],
      ['NTD due at 28 weeks', 'anti-D due at 28 weeks'],
    ]) {
      expect(prepare(said).text.trim(), said).toBe(meant);
    }
  });

  it('"NTD" said any other way is still a neural tube defect', () => {
    for (const text of ['previous baby with NTD', 'NTD scan normal', 'no NTD', 'NTD', 'NTD in the 1st baby given up for adoption']) {
      expect(voice(text).corrections, text).toEqual([]);
    }
    expect(ticks(voice('previous baby with NTD'))).toEqual(['congenital_anomaly']);
    expect(asked(voice('NTD'), /previous pregnancy, or in this one/i)).toBeTruthy();
  });

  it('Undo keeps "NTD" as heard: then it is read as an NTD again', () => {
    const r = voice('Blood group Rh negative NTD given at 28 weeks', 'antenatal', ['NTD']);
    expect(r.corrections).toEqual([]);
    expect(r.values.notes).toBeUndefined();
    expect(asked(r, /previous pregnancy, or in this one/i)).toBeTruthy();
  });

  it('anti-D given, taken or due is noted with its weeks; "not given" is not', () => {
    for (const [text, note] of [
      ['anti D given at 28 weeks', 'Anti-D given at 28 weeks'],
      ['anti-D taken at 28 wks', 'Anti-D given at 28 weeks'],
      ['anti D injection given', 'Anti-D given'],
      ['anti D administered at 34 weeks', 'Anti-D given at 34 weeks'],
      ['anti D due at 28 weeks', 'Anti-D due at 28 weeks'],
      ['anti D given', 'Anti-D given'],
      ['anti-D given at 28 weeks, ICT negative', 'Anti-D given at 28 weeks; ICT negative'],
    ]) {
      expect(voice(text).values.notes, text).toBe(note);
      expect(typed(text).values.notes, text).toBe(note);
    }
    for (const text of ['anti D not given yet', 'no anti D given']) expect(voice(text).values.notes, text).toBeUndefined();
    expect(voice('anti D given', 'gynaecology').values.notes).toBeUndefined();
    expect(voice('anti D given in previous pregnancy').values.medical.otherConditions).toBe('Previous pregnancy – Anti-D given');
    expect(voice('anti D given at 28 weeks').questions).toEqual([]); // the 28 weeks are not the weeks of this pregnancy
  });
});

describe('2. "previous <finding> N years back" is a note', () => {
  it('keeps the previous caesarean and notes when it was', () => {
    const r = voice('Previous LSCS five years back now 28 weeks');
    expect(r.values.obstetric).toEqual({ previousCaesareans: '1' });
    expect(r.values.notes).toBe('Previous LSCS 5 years back');
    expect(r.values.pregnancy).toBeUndefined(); // never a date field
    expect(unused(r)).toEqual([]);
  });

  it('works for any previous-pregnancy finding, "back" or "ago"', () => {
    expect(voice('previous pregnancy PPH 2 years ago').values).toEqual({ obstetric: { pastComplications: ['pph'] }, notes: 'Previous pregnancy PPH 2 years ago' });
    expect(voice('previous sijerian 3 years back').values.notes).toBe('Previous caesarean 3 years back');
    expect(voice('prior LSCS for CPD 4 years back').values.notes).toBe('Prior LSCS for CPD 4 years back; CPD (cephalopelvic disproportion)');
    expect(typed('previous LSCS 1 year ago').values.notes).toBe('Previous LSCS 1 year ago');
  });

  it('not when no finding was read between "previous" and the time', () => {
    for (const text of ['previous 3 years back', 'previous delivery 3 years back', 'married 5 years back', 'history of jaundice 2 years back']) {
      expect(voice(text).values.notes, text).toBeUndefined();
    }
    expect(unused(voice('previous delivery 3 years back'))).toEqual(['previous delivery 3 years back']);
  });
});

describe('3. weeks of pregnancy said without an LMP or EDD', () => {
  it('asks about the LMP they give, never fills it', () => {
    for (const text of ['now 28 weeks', '28 weeks now', '28 weeks pregnant', 'POG 28 weeks', 'period of gestation 28 weeks', '28 weeks running', '28 weeks by dates']) {
      const r = voice(text);
      expect(r.values.pregnancy, text).toBeUndefined();
      const q = asked(r, /^LMP about 17 Mar 2026 \(said: “.+”\) – is that right\?/);
      expect(q, text).toMatchObject({ group: 'safety', heard: text });
      expect(q.options.map((o) => o.label), text).toEqual(['Yes, LMP 17 Mar 2026', 'Leave blank']);
      expect(unused(r), text).toEqual([]);
      expect(r.notes, text).toEqual([]);
    }
    const q = asked(voice('Previous LSCS five years back now 28 weeks'), /^LMP about/);
    expect(q.prompt).toBe('LMP about 17 Mar 2026 (said: “now 28 weeks”) – is that right?');
    expect(answerToResult(q, q.options[0].value, 'antenatal').values.pregnancy.lmp).toBe('2026-03-17');
    expect(asked(voice('POG 28+3 weeks'), /^LMP about 14 Mar 2026/)).toBeTruthy();
  });

  it('with an LMP or EDD there is no new question (the check that the weeks fit stays)', () => {
    expect(voice('LMP 10 March 2026 now 28 weeks').questions).toEqual([]);
    expect(voice('LMP 10 March 2026 now 28 weeks').values.pregnancy.lmp).toBe('2026-03-10');
    expect(asked(voice('LMP 1 June 2026 now 28 weeks'), /gives 17 weeks, but 28 weeks was said/)).toBeTruthy();
    expect(asked(voice('LMP 2 months back now 28 weeks'), /said: “now 28 weeks”/)).toBeUndefined();
    const edd = voice('EDD 20 December 2026 now 28 weeks');
    expect(asked(edd, /^LMP about/)).toBeUndefined();
    expect(asked(edd, /from a dating scan/)).toBeTruthy();
  });

  it('never for weeks over 42 or under 4, nor for weeks said about something else', () => {
    expect(asked(voice('now 50 weeks'), /^LMP about/)).toBeUndefined();
    expect(asked(voice('now 50 weeks'), /more than 42 weeks/)).toBeTruthy();
    expect(asked(voice('now 3 weeks'), /^LMP about/)).toBeUndefined();
    for (const text of ['anti D given at 28 weeks', 'follow up after 2 weeks', 'review after 4 weeks now', 'primi 28 weeks', 'cerclage done at 14 weeks']) {
      expect(asked(voice(text), /^LMP about/), text).toBeUndefined();
    }
    expect(asked(voice('28 weeks pregnant', 'gynaecology'), /^LMP about/)).toBeUndefined();
  });
});

describe('4. negative screening results are recorded', () => {
  it('as one note, the tests in the order said and spelled the standard way; nothing ticked or asked', () => {
    for (const read of [voice, typed]) {
      const r = read('Hiv non-reactive hbs AG non-reactive vdrl non-reactive');
      expect(r.values).toEqual({ notes: 'HIV non-reactive, HBsAg non-reactive, VDRL non-reactive' });
      expect(r.questions).toEqual([]);
      expect(ticks(r)).toEqual([]);
    }
    for (const [text, note] of [
      ['HIV NR HBsAg -ve VDRL non reactive', 'HIV non-reactive, HBsAg negative, VDRL non-reactive'],
      ['HIV, HBsAg and VDRL negative', 'HIV negative, HBsAg negative, VDRL negative'],
      ['anti HCV negative', 'Anti-HCV negative'],
      ['RPR non reactive TPHA negative', 'RPR non-reactive, TPHA negative'],
      ['HIV none reactive', 'HIV non-reactive'],
    ]) {
      expect(voice(text).values.notes, text).toBe(note);
    }
  });

  it('a reactive or positive result is still confirmed, and a doubtful one asked', () => {
    const r = voice('HIV non reactive HBsAg reactive');
    expect(r.values.notes).toBe('HIV non-reactive');
    expect(asked(r, /^HBsAg reactive \(positive\) – is that right\?/)).toMatchObject({ group: 'confirm' });
    expect(voice('Hbs AG reactive').values).toEqual({});
    for (const text of ['HIV negative HIV reactive', 'HIV on reactive', 'VDRL not done']) expect(voice(text).values.notes, text).toBeUndefined();
    expect(voice('husband HIV non reactive').values.notes).toBeUndefined(); // not hers
  });
});

describe('5. "BP" said as an illness ticks high blood pressure (owner decision 1)', () => {
  it('"known case of BP", "k/c/o BP", "h/o BP", "BP patient", "on BP tablets", "BP ki bimari"', () => {
    for (const text of ['known case of BP', 'k/c/o BP', 'h/o BP', 'BP patient', 'on BP tablets', 'on BP medicine', 'taking BP medicines', 'BP ki bimari']) {
      for (const care of ['antenatal', 'postnatal', 'gynaecology', 'infertility']) {
        const r = voice(text, care);
        expect(ticks(r), `${text} (${care})`).toEqual(['hypertension']);
        expect(r.questions, `${text} (${care})`).toEqual([]);
        expect(r.found.find((x) => x.label === 'Existing conditions').text, text).toBe('High blood pressure');
      }
    }
    const r = voice('BP patient since 3 years on Amlodipine');
    expect(ticks(r)).toEqual(['hypertension']);
    expect(asked(r, /amlodipine/i)).toBeUndefined();
  });

  it('readings, "BP normal", "no BP", a family member\'s and a pregnancy\'s high BP are as before', () => {
    for (const text of ['BP 120 by 80', 'BP 1 30 by 80', 'BP normal', 'no BP', 'not a known case of BP', 'mother known case of BP', 'husband BP patient']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(asked(r, /blood pressure/i), text).toBeUndefined();
    }
    expect(asked(voice('BP was high in previous pregnancy'), /In a previous pregnancy – was it pre-eclampsia/)).toBeTruthy();
    expect(asked(voice('h/o BP in previous pregnancy'), /In a previous pregnancy – was it pre-eclampsia/)).toBeTruthy();
    expect(asked(voice('BP high in this pregnancy'), /before this pregnancy, or of this pregnancy \(PIH\)/)).toBeTruthy();
    expect(asked(voice('BP high', 'gynaecology'), /^High blood pressure \(hypertension\)\?/)).toBeTruthy();
    expect(ticks(voice('BP ki problem hai'))).toEqual([]);
  });
});

describe('6. Hindi words Chrome leaves out', () => {
  const HINGLISH = ['naam', 'saal', 'pehli', 'doosri', 'teesri', 'bees', 'pachees', 'tees', 'mahine', 'hafte', 'bacche', 'haan'];
  it.each(['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn', 'abortion'])('%s: the Hinglish words are given to Chrome with a low boost, within the cap', (careType) => {
    const list = hearingPhrases(careType, []);
    expect(list.length).toBeLessThanOrEqual(212);
    for (const word of HINGLISH) {
      expect(list.find((p) => p.text === word), word).toEqual({ text: word, boost: 1 });
      expect(mentionsFetalSex(word), word).toBe(false); // never a word about the baby's sex
    }
    if (careType === 'antenatal' || careType === 'abortion') for (const p of list) expect(mentionsFetalSex(p.text), p.text).toBe(false);
  });

  it('the key words still get in with 50 learned words (the cap drops from the long list at the end)', () => {
    const words = Array.from({ length: 50 }, (_, i) => ({ phrase: `sampleword${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, meaning: 'note:x' }));
    const texts = hearingPhrases('antenatal', words).map((p) => p.text);
    expect(texts).toHaveLength(212);
    for (const t of ['pachees', 'haan', 'previous LSCS', 'Rh negative', 'non-reactive', 'kilo']) expect(texts).toContain(t);
  });
});

describe('8. speaking counts as activity for the automatic logout', () => {
  it('signals at most every 10 seconds, and carries nothing of what was said', () => {
    let t = 0;
    const signal = vi.fn();
    const spoke = speechActivity(signal, () => t);
    spoke();
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal.mock.calls[0]).toEqual([]);
    t = 9_999;
    spoke();
    expect(signal).toHaveBeenCalledTimes(1);
    t = 10_000;
    spoke();
    spoke();
    expect(signal).toHaveBeenCalledTimes(2);
    expect(ACTIVITY_EVENT).toBe('perinexa:activity');
  });

  it('the automatic logout listens for it', async () => {
    const { readFileSync } = await import('node:fs');
    const auth = readFileSync(new URL('../../auth/AuthContext.jsx', import.meta.url), 'utf8');
    expect(auth).toMatch(/ACTIVITY_EVENTS = \[[^\]]*'perinexa:activity'/);
  });
});

describe('1. "NTD" in a neural tube defect sentence stays NTD', () => {
  it('after a baby or history word, or before "given folic acid" or "due to", it is not anti-D', () => {
    for (const text of [
      'Previous baby NTD given folic acid 5 mg',
      'previous pregnancy NTD due to folate deficiency',
      'previous baby NTD taken for termination',
      'h/o NTD given folic acid 5 mg daily',
      'known case of NTD given high dose folic acid',
      'previous baby had NTD due to folic acid deficiency',
      'H/O previous baby with NTD due to valproate',
      'NTD due to low folate in previous baby',
      'Rh negative NTD given folic acid',
    ]) {
      const r = voice(text);
      expect(r.corrections, text).toEqual([]);
      expect(JSON.stringify(r.values), text).not.toMatch(/Anti-D/);
    }
    for (const text of ['Previous baby NTD given folic acid 5 mg', 'previous pregnancy NTD due to folate deficiency', 'previous baby NTD taken for termination', 'h/o NTD given folic acid 5 mg daily', 'previous baby had NTD due to folic acid deficiency']) {
      expect(ticks(voice(text)), text).toContain('congenital_anomaly');
    }
  });

  it('"NTD given" with a time, at the end, or before the next detail is still anti-D', () => {
    for (const [said, meant] of [
      ['NTD given at 28 weeks sorry 30 weeks', 'anti-D given at 28 weeks sorry 30 weeks'],
      ['NTD due after delivery', 'anti-D due after delivery'],
      ['NTD given HIV non reactive', 'anti-D given HIV non reactive'],
      ['NTD given, ICT negative', 'anti-D given, ICT negative'],
    ]) {
      expect(prepare(said).text.trim(), said).toBe(meant);
    }
  });
});

describe('anti-D: a change said straight after is asked, never noted as given', () => {
  it('"given no", "given not yet", "given, sorry, not given", "given, sorry, due …" and two weeks with no "sorry"', () => {
    for (const [text, heard, labels] of [
      ['anti D given no', 'anti D given no', ['Anti-D given', 'Not given yet', 'Ignore']],
      ['anti D given, no', 'anti D given, no', ['Anti-D given', 'Not given yet', 'Ignore']],
      ['anti D given not yet', 'anti D given not yet', ['Anti-D given', 'Not given yet', 'Ignore']],
      ['anti D given sorry not given', 'anti D given not given', ['Anti-D given', 'Not given yet', 'Ignore']],
      ['anti D given sorry due at 28 weeks', 'anti D given due at 28 weeks', ['Anti-D given', 'Anti-D due at 28 weeks', 'Not given yet', 'Ignore']],
      ['anti D given at 28 weeks 30 weeks', 'anti D given at 28 weeks 30 weeks', ['Anti-D given at 28 weeks', 'Anti-D given at 30 weeks', 'Not given yet', 'Ignore']],
    ]) {
      for (const read of [voice, typed]) {
        const r = read(text);
        expect(r.values.notes, text).toBeUndefined();
        const q = asked(r, /^Anti-D – given, due, or not given yet\?/);
        expect(q?.heard, text).toBe(heard);
        expect(q.options.map((o) => o.label), text).toEqual(labels);
        expect(unused(r), text).toEqual([]);
      }
    }
    const q = asked(voice('anti D given not yet'), /^Anti-D/);
    expect(answerToResult(q, 'note:Anti-D not given yet', 'antenatal').values.notes).toBe('Anti-D not given yet');
  });

  it('"at 28 weeks, sorry, 30 weeks" notes the 30 weeks, and says it was corrected', () => {
    for (const text of ['anti D given at 28 weeks sorry 30 weeks', 'anti D given at 28 weeks, sorry, 30 weeks', 'NTD given at 28 weeks sorry 30 weeks']) {
      const r = voice(text);
      expect(r.values.notes, text).toBe('Anti-D given at 30 weeks');
      expect(r.notes, text).toContain('Corrected while speaking: anti-D 28 weeks → 30 weeks.');
      expect(r.questions, text).toEqual([]);
    }
  });

  it('a husband said before it does not hide it, and a full stop or comma ends it as before', () => {
    const r = voice('Blood group O negative husband B positive anti D given at 28 weeks');
    expect(r.values.notes).toBe('Anti-D given at 28 weeks');
    expect(voice('anti D given. No complaints').values.notes).toBe('Anti-D given');
    expect(voice('anti D given at 28 weeks no complaints').values.notes).toBe('Anti-D given at 28 weeks');
    expect(voice('anti-D given at 28 weeks, ICT negative').values.notes).toBe('Anti-D given at 28 weeks; ICT negative');
    expect(voice('anti-D given. ICT negative').values.notes).toBe('Anti-D given; ICT negative');
  });
});

describe('3. the weeks of this pregnancy only, said once', () => {
  it('not a previous pregnancy\'s weeks', () => {
    for (const text of ['previous preterm delivery 32 weeks now 28 weeks', 'previous baby born 32 weeks now 28 weeks pregnant']) {
      expect(asked(voice(text), /^LMP about/).prompt, text).toMatch(/^LMP about 17 Mar 2026 \(said: “now 28 weeks/);
    }
    expect(asked(voice('previous IUD 30 weeks now'), /^LMP about/)).toBeUndefined();
    expect(asked(voice('Previous LSCS five years back now 28 weeks'), /^LMP about 17 Mar 2026/)).toBeTruthy();
    expect(asked(voice('Previous LSCS five years back 28 weeks now'), /^LMP about 17 Mar 2026/)).toBeTruthy();
  });

  it('not how long a symptom, a medicine or a visit has been', () => {
    for (const text of ['spotting 6 weeks now', 'cough now 10 weeks', 'iron tablets now 6 weeks', 'next visit 4 weeks now', 'T dap given 28 weeks now']) {
      const r = voice(text);
      expect(asked(r, /^LMP about/), text).toBeUndefined();
      expect(r.notes, text).toEqual([]);
    }
  });

  it('corrected while speaking: the new weeks; said two ways: not worked out', () => {
    expect(asked(voice('POG 28 weeks sorry 30 weeks'), /^LMP about/).prompt).toBe('LMP about 3 Mar 2026 (said: “POG 30 weeks”) – is that right?');
    expect(asked(voice('now 28 weeks sorry 26 weeks'), /^LMP about/).prompt).toBe('LMP about 31 Mar 2026 (said: “now 26 weeks”) – is that right?');
    const r = voice('28 weeks pregnant sorry 30 weeks');
    expect(asked(r, /^LMP about/)).toBeUndefined();
    expect(r.notes).toEqual(['The weeks of pregnancy were said more than once (“28 weeks pregnant”, “30 weeks”) – check the weeks and the LMP.']);
    expect(asked(voice('POG 28 weeks, now 30 weeks'), /^LMP about/)).toBeUndefined();
  });

  it('weeks and days said in words', () => {
    for (const text of ['now 28 weeks 3 days', 'now 28 weeks and 3 days', 'now 28 weeks, 3 days', 'POG 28 weeks 3 days', '28 weeks 3 days pregnant', '28 weeks and 3 days running']) {
      const r = voice(text);
      expect(asked(r, /^LMP about/)?.prompt, text).toBe(`LMP about 14 Mar 2026 (said: “${text}”) – is that right?`);
      expect(unused(r), text).toEqual([]);
    }
    expect(asked(voice('now 28+3 weeks'), /^LMP about 14 Mar 2026/)).toBeTruthy();
    expect(asked(voice('anti-D given at 28 weeks 3 days pregnant'), /^LMP about/)).toBeUndefined();
  });

  it('with an LMP said roughly, the weeks are compared with it – never "no LMP was said"', () => {
    const r = voice('32 weeks pregnant LMP 2 months back');
    expect(asked(r, /^LMP about 29 Jul 2026 \(said: “2 months back”\)/)).toBeTruthy();
    expect(asked(r, /said: “32 weeks pregnant”/)).toBeUndefined();
    expect(r.notes).toEqual(['“32 weeks pregnant” was said, but the LMP said gives about 8 weeks – check the weeks and the LMP.']);
    expect(voice('LMP 2 months back now 9 weeks').notes).toEqual([]);
    expect(unused(voice('LMP 2 months back now 9 weeks'))).toEqual([]);
    // an EDD waiting for its answer: the weeks stay in "Not understood", to check against it
    expect(unused(voice('EDD 20 December 2026 now 28 weeks'))).toEqual(['now 28 weeks']);
  });
});

describe('4. a screening result of a previous pregnancy is not noted', () => {
  it('said before or after the result', () => {
    for (const read of [voice, typed]) {
      expect(read('HIV negative in previous pregnancy').values.notes).toBeUndefined();
      expect(read('previous pregnancy HIV negative').values.notes).toBeUndefined();
      expect(read('HIV negative in previous pregnancy, HBsAg non reactive').values.notes).toBe('HBsAg non-reactive');
      expect(read('HIV negative in last pregnancy now again HIV negative').values.notes).toBe('HIV negative');
      expect(read('previous baby had cleft lip VDRL non reactive').values.notes).toBe('VDRL non-reactive');
    }
    expect(voice('HIV non reactive BDRL non reactive HBsAg negative blood group AB positive').values.notes).toBe('HIV non-reactive, VDRL non-reactive, HBsAg negative');
  });
});

describe('5. "BP" said as an illness – when it is not a tick', () => {
  const BEFORE_OR_PIH = /^High blood pressure from before this pregnancy, or of this pregnancy \(PIH\)\?/;
  it('said with this pregnancy: asked', () => {
    for (const text of [
      'BP patient in this pregnancy',
      'on BP tablets in this pregnancy',
      'on BP tablets since 6 months of pregnancy',
      'known case of BP from 20 weeks',
      'k/c/o BP since pregnancy',
      'h/o BP since 7 months',
      'on BP tablets labetalol since 28 weeks',
    ]) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(asked(r, BEFORE_OR_PIH), text).toBeTruthy();
    }
    expect(asked(voice('on BP tablets labetalol since 28 weeks'), /^What is the labetalol for\?/)).toBeTruthy();
    expect(ticks(voice('on BP tablets since 6 months', 'gynaecology'))).toEqual(['hypertension']);
  });

  it('low BP: no tick and no high-BP question', () => {
    for (const text of ['low BP patient', 'known case of BP low', 'history of BP low']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(asked(r, /blood pressure/i), text).toBeUndefined();
    }
  });

  it('a family member said after it: not hers', () => {
    for (const text of ['history of BP in family', 'history of BP in mother', 'known case of BP in her mother', 'history of BP in husband']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(asked(r, /blood pressure/i), text).toBeUndefined();
      expect(r.notes, text).toContain("Illnesses of family members (or of a previous baby) are not the patient's own, so they were not ticked.");
    }
  });

  it('with PIH said: the PIH note only', () => {
    for (const text of ['PIH on BP tablets', 'gestational hypertension, on BP tablets']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(r.values.notes, text).toBe('Gestational hypertension / PIH (this pregnancy)');
    }
  });
});
