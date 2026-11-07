// Build 13 – what may be typed on the NICU admission (NEO-F-03): the checks for each part of the form, and what must be
// filled in before the admitting doctor signs it (field schema build13_nicu_admission.json). Field names follow the
// schema in camelCase. Every field may be left empty while the form is being written; "unknown" is allowed for an
// outborn baby (maternal.unknown lists the fields marked unknown). The free text is written after the birth on the
// baby's own record (as on the delivery note), so the words-about-sex check of the mother's record does not apply.

import { z } from 'zod';
import { CONFIDENTIAL_NAME } from '../billing/billingRules.js';
import {
  ADMISSION_REASONS,
  ANTENATAL_PROBLEMS,
  CORD_CLAMP,
  DELIVERY_MODE,
  EXAM_SYSTEMS,
  FEED_ROUTE,
  FEEDS,
  GA_METHODS,
  GROWTH_CHARTS,
  INVESTIGATIONS,
  LABOUR_ONSET,
  LINES,
  LIQUOR,
  MAX_PROBLEMS,
  MORBIDITIES,
  OUTCOMES_F03,
  RESPIRATORY_SUPPORT,
  RESUSCITATION_F03,
  RUBELLA,
  SEPSIS_PATHWAY,
  SEROLOGY,
  SPO2_SUPPORT,
  STEROIDS,
  SYMMETRY,
  THERMAL,
} from './nicuAdmission.js';

// The serology tests on the form; HIV keeps Perinexa's neutral name on screen and on paper (HIV and AIDS Act 2017).
export const SEROLOGY_TESTS = { vdrl: 'VDRL', hbsag: 'HBsAg', hiv: CONFIDENTIAL_NAME, gbs: 'GBS', rubella: 'Rubella' };

const empty = (v) => v === '' || v === undefined;
const num = (label, min, max, int = false) =>
  z.preprocess((v) => (empty(v) ? null : v), z.union([z.null(), (int ? z.coerce.number(`${label} must be a number`).int(`${label} must be a whole number`) : z.coerce.number(`${label} must be a number`)).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)])).default(null);
const int = (label, min, max) => num(label, min, max, true);
const pick = (options, label) => z.preprocess((v) => (empty(v) ? null : v), z.union([z.null(), z.enum(Object.keys(options), `${label}: choose one of the options`)])).default(null);
const many = (options, label, max = Object.keys(options).length) => z.array(z.enum(Object.keys(options), `${label}: choose from the list`)).max(max).default([]).transform((a) => [...new Set(a)]);
const yn = (label) => z.preprocess((v) => (empty(v) ? null : v === true ? 'yes' : v === false ? 'no' : v), z.union([z.null(), z.enum(['yes', 'no', 'unknown'], `${label}: yes, no or unknown`)])).default(null);
const at = (label) => z.preprocess((v) => (empty(v) ? null : v), z.union([z.null(), z.iso.datetime(`${label}: please enter a valid date and time`).transform((v) => new Date(v))])).default(null);
const text = (label, max) => z.string().trim().max(max, `${label} is too long`).default('');
const ICD10 = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;
const icd = (label) => z.string().trim().toUpperCase().refine((v) => v === '' || ICD10.test(v), `${label}: an ICD-10 code like P07.3`).default('');

// §1 Maternal and perinatal history (PX-X-14: pre-filled from the mother's record, the delivery note and the record at
// birth where they are linked)
export const MATERNAL_KEYS = [
  'motherAge', 'gravida', 'para', 'living', 'abortions', 'booked', 'bloodGroup', 'serology', 'antenatalProblems', 'promHours', 'anaemiaHb', 'anomalyScanDetail', 'drugsInPregnancy', 'substances', 'antenatalSteroids', 'steroidsLastDoseAt', 'mgso4Given', 'maternalAntibioticsDrug', 'maternalAntibioticsAt', 'labourOnset', 'labourDurationH', 'liquor', 'fetalDistress', 'ctgDetail', 'deliveryMode', 'lscsCategory', 'lscsIndication', 'presentation', 'anaesthesia', 'ddiMin', 'apgar1', 'apgar5', 'apgar10', 'resuscitation', 'ppvMinutes', 'cordClamping', 'cordClampSeconds', 'cordPh', 'cordBe', 'drTempC', 'skinToSkin', 'vitKGiven', 'vitKAt', 'eyeCare', 'bandsVerified', 'firstFeedAt', 'drGlucose', 'drGlucoseAt',
];
export const maternalSchema = z
  .object({
    motherAge: int('Mother’s age', 12, 60),
    gravida: int('Gravida', 0, 30),
    para: int('Para', 0, 30),
    living: int('Living', 0, 30),
    abortions: int('Abortions', 0, 30),
    booked: yn('Booked'),
    bloodGroup: text('Blood group', 10),
    serology: z
      .object({ vdrl: pick(SEROLOGY, 'VDRL'), hbsag: pick(SEROLOGY, 'HBsAg'), hiv: pick(SEROLOGY, CONFIDENTIAL_NAME), gbs: pick(SEROLOGY, 'GBS'), rubella: pick(RUBELLA, 'Rubella') })
      .strict()
      .default({}),
    antenatalProblems: many(ANTENATAL_PROBLEMS, 'Antenatal problems'),
    promHours: int('PROM hours', 0, 2000),
    anaemiaHb: num('Haemoglobin', 2, 20),
    anomalyScanDetail: text('Anomaly scan', 500),
    drugsInPregnancy: text('Drugs in pregnancy', 500),
    substances: yn('Substances'),
    antenatalSteroids: pick(STEROIDS, 'Antenatal steroids'),
    steroidsLastDoseAt: at('Last steroid dose'),
    mgso4Given: yn('Magnesium sulphate'),
    maternalAntibioticsDrug: text('Maternal antibiotic', 150),
    maternalAntibioticsAt: at('Maternal antibiotic time'),
    labourOnset: pick(LABOUR_ONSET, 'Labour onset'),
    labourDurationH: num('Labour duration', 0, 100),
    liquor: pick(LIQUOR, 'Liquor'),
    fetalDistress: yn('Fetal distress'),
    ctgDetail: text('CTG', 500),
    deliveryMode: pick(DELIVERY_MODE, 'Mode of delivery'),
    lscsCategory: int('LSCS category', 1, 4),
    lscsIndication: text('LSCS indication', 500),
    presentation: text('Presentation', 100),
    anaesthesia: text('Anaesthesia', 100),
    ddiMin: int('Decision-to-delivery', 0, 2000),
    apgar1: int('Apgar at 1 minute', 0, 10),
    apgar5: int('Apgar at 5 minutes', 0, 10),
    apgar10: int('Apgar at 10 minutes', 0, 10),
    resuscitation: many(RESUSCITATION_F03, 'Resuscitation'),
    ppvMinutes: int('PPV minutes', 0, 120),
    cordClamping: pick(CORD_CLAMP, 'Cord clamping'),
    cordClampSeconds: int('Cord clamping', 0, 600),
    cordPh: num('Cord pH', 6.5, 7.6),
    cordBe: num('Cord base excess', -40, 20),
    drTempC: num('Temperature in the delivery room', 30, 42),
    skinToSkin: yn('Skin-to-skin'),
    vitKGiven: yn('Vitamin K'),
    vitKAt: at('Vitamin K time'),
    eyeCare: yn('Eye care'),
    bandsVerified: yn('Identity bands checked by two people'),
    firstFeedAt: at('First feed'),
    drGlucose: num('Glucose in the delivery room', 0, 600),
    drGlucoseAt: at('Glucose time'),
    unknown: z.array(z.enum(MATERNAL_KEYS)).max(MATERNAL_KEYS.length).default([]).transform((a) => [...new Set(a)]),
  })
  .strict();

// §2 Admission assessment (weight, GA and temperature are also kept on the admission itself for the register)
export const assessmentSchema = z
  .object({
    lengthCm: num('Length', 20, 70),
    ofcCm: num('Head circumference', 15, 50),
    growthChart: pick(GROWTH_CHARTS, 'Growth chart'),
    weightCentile: num('Weight centile', 0, 100), // typed from the chart (no centile tables in Perinexa)
    symmetry: pick(SYMMETRY, 'Symmetry'),
    gaMethod: pick(GA_METHODS, 'How the gestation was dated'),
    ballardScore: int('Ballard score', -10, 50),
    hr: int('Heart rate', 0, 300),
    rr: int('Breathing rate', 0, 200),
    spo2: int('SpO2', 0, 100),
    spo2Support: pick(SPO2_SUPPORT, 'SpO2 on'),
    fio2: num('FiO2', 0.21, 1),
    cpapPeep: num('PEEP', 0, 20),
    bpSystolic: int('Systolic BP', 0, 150),
    bpDiastolic: int('Diastolic BP', 0, 120),
    bpMean: int('Mean BP', 0, 130),
    crtSeconds: num('Capillary refill', 0, 20),
    glucose: num('Glucose', 0, 600),
    silvermanAndersen: int('Silverman–Andersen score', 0, 10),
    nipsPain: int('NIPS pain score', 0, 7),
    respiratorySupport: pick(RESPIRATORY_SUPPORT, 'Respiratory support'),
    exam: z
      .object(Object.fromEntries(Object.keys(EXAM_SYSTEMS).map((k) => [k, z.object({ status: pick({ normal: 1, abnormal: 1 }, 'Normal or not'), note: text('Note', 300) }).strict().default({ status: null, note: '' })])))
      .strict()
      .default({}),
    sarnatStage: int('Sarnat stage', 1, 3),
    anomaly: yn('Anomaly'),
    anomalyDetail: text('Anomaly', 500),
    birthInjury: yn('Birth injury'),
    birthInjuryDetail: text('Birth injury', 500),
  })
  .strict();

// §3 Problem list and plan, with the risk flags
export const planSchema = z
  .object({
    problems: z.array(z.string().trim().min(1).max(200, 'A problem is at most 200 characters')).max(MAX_PROBLEMS, `At most ${MAX_PROBLEMS} problems`).default([]),
    workingDiagnosis: text('Working diagnosis', 500),
    icd10: icd('ICD-10'),
    sepsisRisk: yn('Sepsis risk'),
    sepsisPathway: pick(SEPSIS_PATHWAY, 'Sepsis pathway'),
    hypoglycaemiaScreen: yn('Hypoglycaemia screen'),
    jaundiceRisk: yn('Jaundice risk'),
    tsbDueAt: at('TSB due'),
    hie: yn('HIE'),
    sarnat1h: int('Sarnat at 1 hour', 1, 3),
    coolingCentreCalledAt: at('Cooling centre called'),
    unstableCourse: yn('Unstable course'), // counts for ROP screening below 37 weeks
    thermal: pick(THERMAL, 'Thermal care'),
    humidityPct: int('Humidity', 0, 100),
    respiratory: text('Respiratory plan', 500),
    fluidsMlKgDay: int('Fluids', 0, 300),
    feeds: pick(FEEDS, 'Feeds'),
    feedVolumeMlKgDay: int('Feed volume', 0, 300),
    feedRoute: pick(FEED_ROUTE, 'Feed route'),
    lines: many(LINES, 'Lines'),
    investigations: many(INVESTIGATIONS, 'Investigations'),
    investigationsOther: text('Other investigation', 200),
  })
  .strict();

// What follows the admission: the parents told, consent, expressing, the consultant (changeable after signing)
export const followOnSchema = z
  .object({
    counselledAt: at('Parents counselled'),
    counselledById: z.union([z.null(), z.string().regex(/^[0-9a-f]{24}$/i)]).default(null),
    bothParents: yn('Both parents'),
    consentSigned: yn('Admission consent'),
    consentRef: text('Consent form', 100),
    expressingStartedAt: at('Mother started expressing'),
    lactationInformed: yn('Lactation counsellor told'),
    consultantInformedAt: at('Consultant told'),
    consultantReviewAt: at('Consultant review'),
  })
  .strict();

// The outcome (NEO-L-05)
export const outcomeDetailsSchema = z
  .object({
    weightAtDischargeG: int('Weight at discharge', 300, 8000),
    morbidities: many(MORBIDITIES, 'Morbidities'),
    ventilated: yn('Ventilated'),
    ventilatorDays: num('Ventilator days', 0, 365),
    cpapDays: num('CPAP days', 0, 365),
    surfactant: yn('Surfactant'),
    tpn: yn('TPN'),
    centralLineDays: num('Central line days', 0, 365),
    deathCauseIcd10: icd('Cause of death'),
    mmReviewRef: text('M&M review', 60),
    transferTo: text('Transferred to', 150),
    transferReason: text('Reason for the transfer', 300),
    transferRef: text('Transfer form', 60),
    transferDecisionAt: at('Decision to transfer'),
    transferDepartedAt: at('Departed'),
  })
  .strict();
export const outcomeResult = z.enum(Object.keys(OUTCOMES_F03), 'Choose how the admission ended');

export const ADMISSION_REASON_KEYS = Object.keys(ADMISSION_REASONS);

/**
 * What is missing before the admitting doctor signs (N6 counts an unsigned form as incomplete). Returns { field:
 * message } (empty when complete). PURE.
 */
export function missingForSign(n) {
  const out = {};
  if (n.weightGrams == null) out.weightGrams = 'Enter the weight';
  if (n.gestationWeeks == null) out.gestationWeeks = 'Enter the gestation';
  if (n.temperatureC == null) out.temperatureC = 'Enter the temperature';
  if (!n.reasonPrimary) out.reasonPrimary = 'Choose the main reason for admission';
  const a = n.assessment ?? {};
  for (const k of Object.keys(EXAM_SYSTEMS)) {
    const e = a.exam?.[k];
    if (!e?.status) out[`assessment.exam.${k}`] = 'Normal or not normal';
    else if (e.status === 'abnormal' && !e.note) out[`assessment.exam.${k}`] = 'Write what was found';
  }
  if (!a.respiratorySupport) out['assessment.respiratorySupport'] = 'Choose the respiratory support';
  const p = n.plan ?? {};
  if (p.hie === 'yes' && a.sarnatStage == null) out['assessment.sarnatStage'] = 'HIE: enter the Sarnat stage';
  if (!(p.problems ?? []).length && !p.workingDiagnosis) out['plan.workingDiagnosis'] = 'Write the problems or the working diagnosis';
  if (a.anomaly === 'yes' && !a.anomalyDetail) out['assessment.anomalyDetail'] = 'Describe the anomaly';
  if (a.birthInjury === 'yes' && !a.birthInjuryDetail) out['assessment.birthInjuryDetail'] = 'Describe the injury';
  return out;
}
