// The Abortion type of care (pregnancy loss that was not induced): the form's words and lists, and voice entry in
// abortion care – a pregnancy, so the PCPNDT protection applies. All fake sample data.
import { describe, expect, it } from 'vitest';
import { mentionsFetalSex } from '../../pcpndtWords.js';
import { abortionEmpty, abortionPayload, abortionValues } from './AbortionSection.jsx';
import {
  LATE_HINT,
  LOSS_LABELS,
  LOSS_TYPES,
  LOSS_TYPE_KEYS,
  MANAGEMENT,
  OUTCOMES,
  THREATENED_HINT,
  gaFrom,
  gaText,
  lateHint,
  lmpCarryOver,
  managementChoices,
  obstetricHint,
  presentationWeeks,
  showsPregnancyFields,
} from './abortionFormat.js';
import { extractPatientDetails, lossTypesSaid, meaningLabel, mergeDictated, threatenedSaid, withoutFetalSex } from './dictation.js';
import { careNowText } from './patientFormat.js';
import { hearingPhrases } from './obgyTerms.js';

const now = new Date(2026, 9, 1, 11, 30); // 1 Oct 2026, 11:30
const voice = (text, careType = 'abortion') => extractPatientDetails(text, { careType, now, voice: true });

describe('the lists and words', () => {
  it('weeks at presentation as "9 w 2 d", from the LMP to the date seen', () => {
    expect(gaText('2026-07-28', '2026-10-01')).toBe('9 w 2 d');
    expect(gaFrom('2026-08-02', '2026-10-01')).toEqual({ weeks: 8, days: 4 });
    expect(gaText('2026-10-02', '2026-10-01')).toBe(null); // LMP after the date seen
    expect(gaText('', '2026-10-01')).toBe(null);
  });

  it('offers only the management that fits the type of loss', () => {
    expect(managementChoices('complete').map(([k]) => k)).toEqual(['none_needed', 'referred', 'other']);
    expect(managementChoices('molar').map(([k]) => k)).toEqual(['suction_evacuation', 'hysterectomy', 'referred', 'other']);
    expect(managementChoices('ectopic').map(([k]) => k)).toContain('methotrexate');
    expect(managementChoices('missed').map(([k]) => k)).not.toContain('methotrexate');
    expect(managementChoices('')).toEqual([]);
  });

  it('a threatened miscarriage is not a type of loss (it stays under Antenatal); an old record still shows its words', () => {
    expect(LOSS_TYPE_KEYS).not.toContain('threatened');
    expect(JSON.stringify(LOSS_TYPES)).not.toMatch(/threatened/i);
    expect(Object.keys(OUTCOMES)).not.toContain('continuing');
    expect(managementChoices('threatened')).toEqual([]);
    expect(THREATENED_HINT).toBe('A threatened miscarriage is a continuing pregnancy – register or keep her under Pregnancy (antenatal).');
    expect(LOSS_LABELS.threatened).toBe('Threatened miscarriage (now recorded under Antenatal)');
    expect(careNowText({ careType: 'abortion', abortion: { lossType: 'threatened' } })).toBe('Abortion · threatened (now under Antenatal)');
    expect(meaningLabel('value:abortion.lossType=threatened')).toBe('Type of loss: Threatened miscarriage (now recorded under Antenatal)');
  });

  it('the 20-week hint, and the pregnancy fields hidden for recurrent loss', () => {
    expect(lateHint(19)).toBe(null);
    expect(lateHint(20)).toBe(LATE_HINT);
    expect(LATE_HINT).toMatch(/from 28 weeks it is a still birth/);
    expect(lateHint(null)).toBe(null);
    expect(showsPregnancyFields('recurrent')).toBe(false);
    for (const t of ['missed', 'ectopic', 'molar', '']) expect(showsPregnancyFields(t), t).toBe(true);
    expect(showsPregnancyFields('threatened')).toBe(true); // an old record still shows its LMP and weeks
  });

  it('never a value for an induced loss, and nothing about MTP or the baby’s sex', () => {
    const words = JSON.stringify([LOSS_TYPES, MANAGEMENT]);
    expect(words).not.toMatch(/MTP|terminat|induced/i);
    expect(mentionsFetalSex(words)).toBe(false);
  });

  it('the form sends the whole section, and nothing when it is left empty', () => {
    const v = abortionValues(null);
    expect(v.presentedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/); // today by default
    expect(abortionEmpty(v)).toBe(true);
    const filled = { ...v, lossType: 'missed', lmp: '2026-08-02', weeks: '9', method: 'medical', managedOn: '2026-10-01' };
    expect(abortionEmpty(filled)).toBe(false);
    expect(abortionPayload(filled)).toMatchObject({ lossType: 'missed', lmp: '2026-08-02', weeks: '', management: { method: 'medical', on: '2026-10-01', outcome: '' } });
    const stored = abortionValues({ lossType: 'ectopic', lmp: null, weeks: 6, days: 2, presentedOn: '2026-09-30T00:00:00.000Z', antiD: { status: 'given', on: '2026-09-30T00:00:00.000Z' } });
    expect(stored).toMatchObject({ lossType: 'ectopic', weeks: '6', days: '2', presentedOn: '2026-09-30', antiD: 'given', antiDOn: '2026-09-30' });
  });
});

describe('voice entry in abortion care', () => {
  it('"LMP 2 August 2026, missed miscarriage …" fills the loss’s LMP and type – never the pregnancy dates or a note', () => {
    const r = voice('LMP 2 August 2026, missed miscarriage, G2 P1 L1 A0, blood group O negative, no allergies');
    expect(r.values.abortion).toEqual({ lmp: '2026-08-02', lossType: 'missed' });
    expect(r.values.pregnancy).toBeUndefined();
    expect(r.values.notes).toBeUndefined();
    expect(r.values.medical).toMatchObject({ bloodGroup: 'O-', allergies: 'None known' });
    expect(r.found.map((f) => f.label)).toEqual(expect.arrayContaining(['Type of loss', 'LMP']));
    expect(r.found.find((f) => f.label === 'Type of loss').text).toBe('Missed miscarriage');
  });

  it('reads each type of loss, but a past one ("previous ectopic") is not this loss; "induced" is never a type', () => {
    const one = (text) => voice(text).values.abortion?.lossType;
    expect(one('incomplete abortion')).toBe('incomplete');
    expect(one('complete miscarriage')).toBe('complete');
    expect(one('ruptured ectopic')).toBe('ectopic');
    expect(one('H mole')).toBe('molar');
    expect(one('recurrent pregnancy loss')).toBe('recurrent');
    expect(lossTypesSaid('previous ectopic, now missed miscarriage').map((h) => h.key)).toEqual(['missed']);
    expect(one('induced abortion')).toBeUndefined();
    // Two types said: asked, never chosen silently
    const two = voice('missed miscarriage or ectopic');
    expect(two.values.abortion).toBeUndefined();
    expect(two.questions[0].options.map((o) => o.label)).toEqual(['Missed miscarriage', 'Ectopic pregnancy', 'Leave blank']);
    expect(meaningLabel('value:abortion.lossType=missed')).toBe('Type of loss: Missed miscarriage');
  });

  it('"threatened miscarriage" fills no type of loss: the hint to keep her under antenatal care is shown as a note', () => {
    for (const said of ['threatened miscarriage', 'threatened abortion', 'Threatened Miscarriage']) {
      const r = voice(said);
      expect(r.values, said).toEqual({});
      expect(r.notes, said).toEqual([THREATENED_HINT]);
      expect(r.questions, said).toEqual([]);
      expect(r.unused, said).toEqual([]);
    }
    // The rest is read as usual; another type of loss said with it is filled
    const r = voice('LMP 2 August 2026, threatened miscarriage, blood group O negative');
    expect(r.values).toEqual({ abortion: { lmp: '2026-08-02' }, medical: { bloodGroup: 'O-' } });
    expect(r.notes).toContain(THREATENED_HINT);
    expect(voice('threatened miscarriage, now incomplete miscarriage').values).toEqual({ abortion: { lossType: 'incomplete' } });
    expect(lossTypesSaid('threatened miscarriage')).toEqual([]);
    expect(threatenedSaid('previous threatened miscarriage')).toEqual([]); // a past pregnancy: no hint
    expect(voice('previous threatened miscarriage').notes).not.toContain(THREATENED_HINT);
  });

  it('in other types of care the words stay as before', () => {
    const ante = voice('LMP 2 August 2026, threatened miscarriage', 'antenatal');
    expect(ante.values.pregnancy).toEqual({ lmp: '2026-08-02' });
    expect(ante.values.abortion).toBeUndefined();
    expect(ante.values.notes).toBe('Threatened miscarriage');
    expect(voice('previous ectopic pregnancy', 'gynaecology').values.medical.otherConditions).toBe('Previous ectopic pregnancy');
  });

  it('anything about the baby’s sex is taken out and flagged, never filled (PCPNDT)', () => {
    expect(withoutFetalSex('missed miscarriage, it is a boy').removed).toBe(true);
    const r = voice('Asha Sample 28 years baby is male as per scan');
    expect(r.values).toEqual({ fullName: 'Asha Sample', ageYears: '28' });
    expect(r.unused.some((u) => u.sex)).toBe(true);
    expect(r.unused.filter((u) => !u.sex).map((u) => u.text).join()).not.toMatch(/male/);
    const words = hearingPhrases('abortion', [{ phrase: 'baby girl', meaning: 'note:x' }, { phrase: 'beta', meaning: 'note:x' }]).map((p) => p.text);
    for (const t of words) expect(mentionsFetalSex(t), t).toBe(false);
    expect(words).not.toContain('beta');
  });

  it('only words that fit pregnancy loss: no breech, EDD or scans; anti-D and UTI yes', () => {
    const words = hearingPhrases('abortion').map((p) => p.text);
    for (const t of ['breech', 'EDD', 'NT scan', 'dating scan', 'anomaly scan', 'FTND']) expect(words, t).not.toContain(t);
    expect(words).toContain('LMP');
    expect(voice('anti D given').values.abortion).toEqual({ antiD: 'given' });
    expect(voice('UTI').values.notes).toBe('Urinary tract infection');
    expect(voice('breech').values.notes).toBeUndefined();
  });
});

describe('anti-D said in abortion care fills the Anti-D field (so the "Rh negative – anti-D" reminder goes)', () => {
  it('"anti D given" fills Anti-D: given – never a note', () => {
    const r = voice('incomplete abortion, anti D given, blood group B negative');
    expect(r.values.abortion).toEqual({ lossType: 'incomplete', antiD: 'given' });
    expect(r.values.notes).toBeUndefined();
    expect(r.values.medical).toMatchObject({ bloodGroup: 'B-' });
    expect(r.found.find((x) => x.label === 'Anti-D').text).toBe('Given');
    expect(meaningLabel('value:abortion.antiD=given')).toBe('Anti-D: Given');
    // A blood group said straight after is hers, not anti-D's "negative"
    expect(voice('incomplete abortion, anti D given, B negative').values.abortion).toMatchObject({ antiD: 'given' });
    // The weeks said with it are left out (the date given is for the doctor)
    expect(voice('missed abortion, anti D given at 8 weeks').values).toEqual({ abortion: { lossType: 'missed', antiD: 'given' } });
  });

  it('"anti-D due" is "not given yet"; a change straight after is asked, with the field’s answers', () => {
    expect(voice('missed abortion, anti-D due').values.abortion).toEqual({ lossType: 'missed', antiD: 'not_yet' });
    const asked = voice('missed abortion, anti D given no');
    expect(asked.values.abortion).toEqual({ lossType: 'missed' });
    expect(asked.questions[0].options.map((o) => o.value)).toEqual(['value:abortion.antiD=given', 'value:abortion.antiD=not_yet', 'ignore']);
  });

  it('a previous pregnancy’s anti-D, recurrent loss and other types of care stay as before', () => {
    const past = voice('previous pregnancy anti-D given');
    expect(past.values.medical.otherConditions).toBe('Previous pregnancy – Anti-D given');
    expect(past.values.abortion).toBeUndefined();
    const rpl = voice('recurrent pregnancy loss, anti D given');
    expect(rpl.values).toEqual({ abortion: { lossType: 'recurrent' }, notes: 'Anti-D given' });
    const ante = voice('anti D given at 28 weeks', 'antenatal');
    expect(ante.values).toEqual({ notes: 'Anti-D given at 28 weeks' });
    expect(voice('anti D given, B negative', 'antenatal').values.notes).toBe('Anti-D given');
  });

  it('put into the form, it is sent as the anti-D status', () => {
    const r = voice('incomplete abortion, anti D given');
    const blank = { newborn: {}, pregnancy: {}, abortion: abortionValues(null), obstetric: {}, medical: {} };
    const v = mergeDictated(blank, r.values, r.paths);
    expect(v.abortion.antiD).toBe('given');
    expect(abortionPayload(v.abortion).antiD).toEqual({ status: 'given', on: '' });
  });
});

describe('changing the type of care carries the LMP over only for the same pregnancy', () => {
  const loss = (lossType, lmp = '2026-08-02') => ({ lossType, lmp });
  // 'threatened': only a record saved before 3 Oct 2026 – moved to Antenatal as the owner decided, the same pregnancy
  it('back to Antenatal only from an old threatened miscarriage (the pregnancy continues)', () => {
    expect(lmpCarryOver({ from: 'abortion', to: 'antenatal', pregnancyLmp: '', abortion: loss('threatened') })).toEqual({ pregnancyLmp: '2026-08-02' });
    for (const t of ['inevitable', 'incomplete', 'complete', 'missed', 'septic', 'ectopic', 'molar', 'recurrent', '']) {
      expect(lmpCarryOver({ from: 'abortion', to: 'antenatal', pregnancyLmp: '', abortion: loss(t) }), t).toEqual({});
    }
  });
  it('never over an LMP already there', () => {
    expect(lmpCarryOver({ from: 'abortion', to: 'antenatal', pregnancyLmp: '2026-09-01', abortion: loss('threatened') })).toEqual({});
    expect(lmpCarryOver({ from: 'antenatal', to: 'abortion', pregnancyLmp: '2026-08-02', abortion: loss('missed', '2026-08-05') })).toEqual({});
  });
  it('into Abortion only from an antenatal record', () => {
    expect(lmpCarryOver({ from: 'antenatal', to: 'abortion', pregnancyLmp: '2026-08-02', abortion: loss('', '') })).toEqual({ abortionLmp: '2026-08-02' });
    expect(lmpCarryOver({ from: 'postnatal', to: 'abortion', pregnancyLmp: '2026-08-02', abortion: loss('', '') })).toEqual({});
    expect(lmpCarryOver({ from: 'antenatal', to: 'gynaecology', pregnancyLmp: '2026-08-02', abortion: loss('', '') })).toEqual({});
  });
});

describe('the obstetric history hint in abortion care', () => {
  it('weeks at presentation: from the LMP to the date seen, or the weeks typed', () => {
    expect(presentationWeeks({ lmp: '2026-07-28', weeks: '' }, '2026-10-01')).toBe(9);
    expect(presentationWeeks({ lmp: '', weeks: '21' }, '2026-10-01')).toBe(21);
    expect(presentationWeeks({ lmp: '', weeks: '' }, '2026-10-01')).toBe(null);
  });
  it('before 20 weeks: count it in A; from 20 weeks: the doctor decides; recurrent loss: only her earlier losses', () => {
    expect(obstetricHint('missed', 19)).toBe('Include this pregnancy in Gravida. Count it in Abortions (A) once the loss is over.');
    for (const w of [20, 27]) expect(obstetricHint('missed', w), String(w)).toMatch(/Abortions \(A\) counts losses before 20 weeks – at 20 weeks or more, count it as the doctor decides/);
    expect(obstetricHint('recurrent', null)).toBe('Count her earlier losses in Abortions (A). She is not pregnant now.');
    expect(obstetricHint('recurrent', null)).not.toMatch(/this pregnancy/);
    expect(obstetricHint('', null)).toBe('Include this pregnancy in Gravida. Count it in Abortions (A) once the loss is over.');
    expect(obstetricHint('ectopic', null)).toBe(obstetricHint('', null));
  });
});
