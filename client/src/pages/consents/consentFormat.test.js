// Words for consent forms (fake sample data only).
import { describe, expect, it } from 'vitest';
import {
  BLANKS,
  BLANK_LABELS,
  LANGUAGES,
  PRINT_LABELS,
  PRINT_LANGUAGES,
  SUGGEST_LABELS,
  SUGGEST_WHY,
  bilingual,
  blankProblems,
  careTypesText,
  formBlanks,
  languagesOf,
  listWords,
  printLanguageLabel,
  textParts,
} from './consentFormat.js';

const form = (clauses, title = { en: 'Consent', mr: 'संमती', hi: 'सहमति' }) => ({ title, clauses });

describe('blanks', () => {
  it('split a clause into words and blanks', () => {
    expect(textParts('I, {patient} (patient no. {mrn}), consent to {procedure}.')).toEqual([
      { text: 'I, ' },
      { blank: 'patient' },
      { text: ' (patient no. ' },
      { blank: 'mrn' },
      { text: '), consent to ' },
      { blank: 'procedure' },
      { text: '.' },
    ]);
    expect(textParts('Unknown {thing} stays')).toEqual([{ text: 'Unknown ' }, { text: '{thing}' }, { text: ' stays' }]);
    expect(textParts('')).toEqual([]);
  });

  it('are the same in every language, and only the known ones', () => {
    const ok = form([{ en: 'I, {patient}, agree: {reason}.', mr: 'मी, {patient}, … {reason}.', hi: '' }]);
    expect(blankProblems(ok)).toEqual({});
    const bad = form(
      [
        { en: 'I, {patient}, agree to {operation}.', mr: 'मी सहमत आहे.', hi: 'मैं, {patient}, {reason}.' },
        { en: 'No blanks here.', mr: 'येथे {patient}.', hi: '' },
      ],
      { en: 'Consent for {patient}', mr: '', hi: '' },
    );
    const problems = blankProblems(bad);
    expect(problems['title.en']).toMatch(/cannot contain blanks/);
    expect(problems['clauses.0.en']).toMatch(/Unknown blank \{operation\}/);
    expect(problems['clauses.0.mr']).toMatch(/same blanks as the English: \{patient\} \{operation\}/);
    expect(problems['clauses.0.hi']).toMatch(/same blanks as the English/);
    expect(problems['clauses.1.mr']).toMatch(/should have none either/);
    expect(formBlanks(bad)).toEqual(new Set(['patient']));
  });

  it('each have words for the editor and the form page', () => {
    for (const b of BLANKS) expect(BLANK_LABELS[b]).toBeTruthy();
  });
});

describe('languages', () => {
  it('are complete only with the title and every clause', () => {
    const f = form([
      { en: 'One', mr: 'एक', hi: 'एक' },
      { en: 'Two', mr: 'दोन', hi: '' },
    ]);
    expect(languagesOf(f)).toEqual(['en', 'mr']);
    expect(languagesOf({ ...f, title: { en: 'Consent', mr: '', hi: 'सहमति' } })).toEqual(['en']);
    expect(PRINT_LANGUAGES.map((l) => l.key)).toEqual(['mr', 'hi', 'en']);
    expect(printLanguageLabel('mr')).toBe('English + मराठी (Marathi)');
  });

  it('print every label in English, Marathi and Hindi', () => {
    for (const [key, label] of Object.entries(PRINT_LABELS)) {
      for (const lang of LANGUAGES) expect(label[lang]?.trim(), `${key}.${lang}`).toBeTruthy();
    }
    expect(bilingual(PRINT_LABELS.signature, 'mr')).toEqual(['Signature', 'सही']);
    expect(bilingual(PRINT_LABELS.signature, 'en')).toEqual(['Signature']);
  });
});

describe('suggestions and lists', () => {
  it('have words for every rule', () => {
    for (const rule of Object.keys(SUGGEST_LABELS).filter((r) => r !== 'none')) expect(SUGGEST_WHY[rule], rule).toBeTruthy();
    expect(careTypesText([], {})).toBe('All types of care');
    expect(listWords(['English', 'Marathi', 'Hindi'])).toBe('English, Marathi and Hindi');
    expect(listWords(['English'])).toBe('English');
    expect(careTypesText(['antenatal', 'postnatal'], { antenatal: 'Antenatal', postnatal: 'Postnatal' })).toBe('Antenatal, Postnatal');
  });
});

describe('information forms by stage of care', () => {
  it('lists each built-in sheet under its stage, the general sheet and the hospital\'s own under Other', async () => {
    const { infoStage } = await import('./consentFormat.js');
    expect(infoStage({ key: 'info_ectopic', origin: 'built_in' })).toBe('Early pregnancy');
    expect(infoStage({ key: 'info_hypertension', origin: 'built_in' })).toBe('Pregnancy');
    expect(infoStage({ key: 'info_fetal_distress', origin: 'built_in' })).toBe('Labour');
    expect(infoStage({ key: 'info_pph', origin: 'built_in' })).toBe('After delivery');
    expect(infoStage({ key: 'info_condition', origin: 'built_in' })).toBe('Other');
    expect(infoStage({ key: 'form_1a2b3c4d', origin: 'hospital' })).toBe('Other');
  });
});

describe("the patient's high-risk factors on a consent form", () => {
  const SECTION = { heading: { en: 'High-risk factors in this patient' }, intro: { en: 'It has been explained …' }, complications: { en: 'Possible complications' }, other: { en: 'Other risk factors' } };
  const factors = [
    { id: 'previous_caesarean', level: 'high', name: { en: 'Previous caesarean section' }, complications: { en: 'the scar can open' } },
    { id: 'diabetes', level: 'high', name: { en: 'Diabetes' }, complications: { en: 'a large baby' } },
    { id: 'obesity', level: 'moderate', name: { en: 'Obesity (high BMI)' }, complications: { en: 'blood clots' } },
  ];
  const risk = { factors, section: SECTION, wording: { version: 1, approved: false } };

  it("ticks the high ones for a new print, and repeats the doctor's earlier choice for a repeat", async () => {
    const { defaultRiskTicks, repeatsEarlierTicks } = await import('./consentFormat.js');
    expect(defaultRiskTicks(factors)).toEqual(['previous_caesarean', 'diabetes']);
    expect(defaultRiskTicks([])).toEqual([]);
    // "Print again": for every factor her record showed then, the choice of that time – ticked or not
    const all = ['previous_caesarean', 'diabetes', 'obesity'];
    const earlier = { riskOffered: [...all, 'heart'], riskFactors: [{ id: 'obesity', name: 'Obesity (high BMI)' }, { id: 'heart', name: 'Heart disease' }] };
    expect(defaultRiskTicks(factors, earlier)).toEqual(['obesity']);
    // … also when the doctor had unticked everything (a private factor she did not want printed stays unticked)
    expect(defaultRiskTicks(factors, { riskOffered: all, riskFactors: [] })).toEqual([]);
    // A factor her record shows only since then is new: ticked when it is high
    expect(defaultRiskTicks(factors, { riskOffered: ['previous_caesarean', 'obesity'], riskFactors: [] })).toEqual(['diabetes']);
    expect(defaultRiskTicks(factors, { riskOffered: ['obesity'], riskFactors: [{ id: 'obesity', name: 'Obesity (high BMI)' }] })).toEqual(['previous_caesarean', 'diabetes', 'obesity']);
    // Nothing was offered then, or a printout from before forms carried the section: as a new print
    expect(defaultRiskTicks(factors, { riskOffered: [], riskFactors: [] })).toEqual(['previous_caesarean', 'diabetes']);
    expect(defaultRiskTicks(factors, { title: 'Consent for anaesthesia' })).toEqual(['previous_caesarean', 'diabetes']);
    // Back from the preview: exactly what was chosen, even nothing
    expect(defaultRiskTicks(factors, { riskTicks: [] })).toEqual([]);
    expect(defaultRiskTicks(factors, { riskTicks: ['diabetes', 'gone'] })).toEqual(['diabetes']);
    // The dialog says when the ticks repeat an earlier printout
    expect(repeatsEarlierTicks(earlier)).toBe(true);
    expect(repeatsEarlierTicks({ riskOffered: [], riskFactors: [] })).toBe(false);
    expect(repeatsEarlierTicks({ riskTicks: ['diabetes'], riskOffered: all })).toBe(false);
    expect(repeatsEarlierTicks(null)).toBe(false);
  });

  it('refuses a typed line that names HIV, and nothing a consent may need to say', async () => {
    const { namesHiv, HIV_ON_CONSENT_MESSAGE } = await import('./consentFormat.js');
    const refused = [
      'HIV positive', 'hiv1/2 reactive', 'H.I.V.', 'AIDS', 'PLHIV', 'RVD reactive', 'R.V.D. reactive', 'Retroviral disease', 'retro +ve', 'Retro: positive', 'Retro NR',
      'on antiretroviral treatment', 'Human immunodeficiency virus infection', 'CD4 count low', 'on HAART', 'attends the ART centre', 'एचआयव्ही', 'एच.आई.वी.', 'एड्स', 'एडस',
    ];
    for (const typed of refused) expect(namesHiv(typed), typed).toBe(true);
    const writable = [
      '', undefined, 'Fibroid – more bleeding', 'Retroplacental clot', 'Retroverted uterus', 'hearing aids', 'Hepatitis B with a high viral load', 'NVP', 'ART pregnancy',
      'TLE on carbamazepine', 'conceived at an ART clinic', 'ICSI at ART centre', 'a state-of-the-art centre', 'PROM for 18 h. I.V. antibiotics started', 'primary immunodeficiency',
      'पीपीएच आयव्ही ऑक्सिटोसिन',
    ];
    for (const typed of writable) expect(namesHiv(typed), String(typed)).toBe(false);
    expect(HIV_ON_CONSENT_MESSAGE).toMatch(/never printed on a consent or information form/);
    expect(HIV_ON_CONSENT_MESSAGE).not.toMatch(/!/);
  });

  it('checks every box a doctor types for a printout: the operation, the reason, the condition and the other risks', async () => {
    const { typedHivFields } = await import('./consentFormat.js');
    expect(typedHivFields({ procedure: 'Caesarean section', reason: 'Breech', condition: '', otherRisks: 'Fibroid' })).toEqual([]);
    expect(typedHivFields({ procedure: 'HIV test', reason: 'Breech', condition: '', otherRisks: '' })).toEqual(['procedure']);
    expect(typedHivFields({ procedure: 'LSCS', reason: 'RVD reactive mother', condition: 'Retroviral disease', otherRisks: 'एचआयव्ही' })).toEqual(['reason', 'condition', 'otherRisks']);
    expect(typedHivFields({ reason: 'Retroplacental clot; hepatitis B with a high viral load' })).toEqual([]);
    expect(typedHivFields(undefined)).toEqual([]);
    // The words that were read as HIV are shown under the box
    const { hivWordIn } = await import('./consentFormat.js');
    expect(hivWordIn('LSCS – RVD reactive mother')).toBe('RVD');
    expect(hivWordIn('Mother attends the ART centre')).toBe('ART centre');
    expect(hivWordIn('माता एचआयव्ही बाधित')).toBe('एचआयव्ही');
    expect(hivWordIn('ICSI at ART centre')).toBe('');
    expect(hivWordIn('Breech')).toBe('');
  });

  it('finds a private factor that was unticked but is still written in the typed reason', async () => {
    const { privateStillInReason } = await import('./consentFormat.js');
    const list = [
      ...factors,
      { id: 'hepatitis_b', level: 'high', private: true, name: { en: 'Hepatitis B' }, labels: ['Hepatitis B'] },
      { id: 'rule:rule_mh', level: 'high', private: true, name: { en: 'Depression on treatment' }, labels: ['Depression on treatment'] },
      { id: 'syphilis', level: 'high', private: true, name: { en: 'Syphilis' }, labels: ['VDRL reactive'] }, // the hospital renamed its rule
    ];
    const reason = 'Age over 35; Previous caesarean section; Hepatitis B; VDRL reactive';
    const names = (ticked, text = reason) => privateStillInReason(list, ticked, text).map((f) => f.id);
    expect(names(['hepatitis_b', 'syphilis'])).toEqual([]); // still ticked: nothing to say
    expect(names(['previous_caesarean'])).toEqual(['hepatitis_b', 'syphilis']); // unticked, but the reason still names them
    expect(names([], 'Age over 35; hepatitis b')).toEqual(['hepatitis_b']);
    expect(names([], 'Age over 35; Previous caesarean section')).toEqual([]); // removed from the reason too
    expect(names([], '')).toEqual([]);
    expect(privateStillInReason(factors, [], 'Diabetes; Previous caesarean section')).toEqual([]); // not private: the doctor's choice
  });

  it('prints the ticked ones in the order of the list, with what was typed, or nothing at all', async () => {
    const { riskToPrint, printedRiskWords } = await import('./consentFormat.js');
    expect(riskToPrint(null, ['diabetes'], 'typed')).toBeNull(); // information forms, and those who only view
    expect(riskToPrint(risk, [], '  ')).toBeNull();
    expect(riskToPrint(risk, ['obesity', 'previous_caesarean', 'unknown'], ' Fibroid ')).toEqual({
      section: SECTION,
      rows: [factors[0], factors[2]],
      other: 'Fibroid',
      version: 1,
      approved: false,
    });
    expect(riskToPrint({ ...risk, wording: { version: 1, approved: true } }, [], 'Fibroid')).toMatchObject({ rows: [], other: 'Fibroid', approved: true });
    expect(printedRiskWords({ riskFactors: [{ name: 'Diabetes' }, { name: 'Twins or more' }], otherRisks: 'Fibroid' })).toBe('Diabetes, Twins or more, other (typed)');
    expect(printedRiskWords({})).toBe(''); // a printout from before
  });
});
