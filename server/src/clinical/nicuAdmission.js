// Build 13 – the NICU admission (NEO-F-03), its unit set-up (NEO-A-01) and the admission and outcome register
// (NEO-L-05), as the field schema docs/field_schemas/build13_nicu_admission.json describes them (NEO-F-03 v1.0,
// NEO-SOP-03, NEO-A-01, NEO-L-05, NEO-A-05, PX-NEO-04, PX-X-01, PX-X-14). The owner approved the schema as clinical
// content (developer, 7 Nov 2026 – docs/CLINICAL_REQUIREMENTS.md, Group B items 12 and 13). Master pages are v1.0 with
// the department lead's sign-off pending, so screens still say which manual page they follow.
// Everything here is PURE (no database). The admission upgrades the DRAFT NICU / SNCU admission of 6 Nov 2026
// (clinical/newbornCare.js): records made before keep their fields and are read as they were.
// Not built here (linked forms that do not exist yet): the EOS calculator (Build 12, NEO-SOP-06), the transfer form
// NEO-F-18, fluids NEO-F-05, parent counselling NEO-F-19, ventilator chart NEO-F-10 – the fields that point to them are
// stored as typed. No weight-centile tables are in Perinexa: the chart is chosen and the centile typed by hand.

import { birthDay } from './newbornSchedule.js';

export const NICU_F03_SOURCE = 'NEO-F-03 v1.0, NEO-SOP-03, NEO-A-01, NEO-L-05, NEO-A-05 (field schema build13_nicu_admission.json, 6 Nov 2026)';
export const NICU_FORM_CODE = 'NEO-F-03';
export const NICU_FORM_FOOTER = 'NEO-F-03 · v1.0';

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

// ---------- The unit (NEO-A-01) ----------
export const LEVELS = { level_II: 'Level II', level_IIIA: 'Level IIIA' };
export const BED_LEVELS = { intensive: 'Intensive', step_down: 'Step-down' };
export const BED_KINDS = { incubator: 'Incubator', warmer: 'Radiant warmer', cot: 'Cot' };
// The admission floor: below it the transfer pathway (NEO-F-18) is suggested – never blocked; a consultant decides.
export const FLOOR_DEFAULTS = Object.freeze({ minGestationWeeks: 28, minBirthWeightGrams: 1000 });
export const NURSE_BABY_RATIO = 2; // nurse:baby ≤ 1:2 for intensive beds (NEO-A-01)
/**
 * What a hospital starts with before its admin sets the units (Hospital admin → NICU units): the two units of the
 * DRAFT of 6 Nov 2026, both at level II (the gated level IIIA screens stay hidden until the admin says otherwise).
 * The manual's three units (Garkheda level IIIA with 6 beds, Adalat Road and Waluj level II) are typed by the admin –
 * names are never written here.
 */
export const UNIT_DEFAULTS = Object.freeze([
  Object.freeze({ key: 'nicu', name: 'NICU', level: 'level_II', active: true, ...FLOOR_DEFAULTS }),
  Object.freeze({ key: 'sncu', name: 'SNCU', level: 'level_II', active: true, ...FLOOR_DEFAULTS }),
]);
/** The hospital's NICU units with the defaults for what was never saved. PURE. */
export function nicuUnitsFor(tenant) {
  const raw = (typeof tenant?.toObject === 'function' ? tenant.toObject() : tenant)?.nicu?.units;
  const list = Array.isArray(raw) && raw.length ? raw : UNIT_DEFAULTS;
  return list.map((u) => ({
    key: u.key,
    name: u.name ?? u.key,
    level: LEVELS[u.level] ? u.level : 'level_II',
    active: u.active !== false,
    minGestationWeeks: u.minGestationWeeks ?? FLOOR_DEFAULTS.minGestationWeeks,
    minBirthWeightGrams: u.minBirthWeightGrams ?? FLOOR_DEFAULTS.minBirthWeightGrams,
  }));
}
/** PX-X-01: ventilation, TPN, exchange and central-line screens only at a level IIIA unit. PURE. */
export const allowsIntensive = (unit) => unit?.level === 'level_IIIA';
export const GATED_RESPIRATORY = ['ventilator'];
export const GATED_LINES = ['uvc', 'uac', 'picc'];

// ---------- Header ----------
// Where the baby came from: the schema's transfer_adalat_road / transfer_waluj are "transfer_<unit key>" for each other
// unit the hospital set up, so the names are the hospital's own.
export const FIXED_SOURCES = { inborn_lr_ot: 'Inborn – labour room or theatre', postnatal_ward: 'Postnatal ward', transfer_other: 'Transfer – other hospital' };
export const LEGACY_SOURCES = { inborn: 'Born here (inborn)', outborn: 'Born elsewhere (outborn)' };
/** The sources an admission at `unitKey` may have, with their words. PURE. */
export function sourcesFor(units, unitKey) {
  const out = { inborn_lr_ot: FIXED_SOURCES.inborn_lr_ot, postnatal_ward: FIXED_SOURCES.postnatal_ward };
  for (const u of units) if (u.key !== unitKey && u.active) out[`transfer_${u.key}`] = `Transfer – ${u.name}`;
  out.transfer_other = FIXED_SOURCES.transfer_other;
  return out;
}
export const isInborn = (source) => source === 'inborn_lr_ot' || source === 'postnatal_ward' || source === 'inborn';
export const isTransferIn = (source) => typeof source === 'string' && source.startsWith('transfer_');
export const sourceWords = (units, source) => {
  if (FIXED_SOURCES[source]) return FIXED_SOURCES[source];
  if (LEGACY_SOURCES[source]) return LEGACY_SOURCES[source];
  const u = isTransferIn(source) ? units.find((x) => `transfer_${x.key}` === source) : null;
  return u ? `Transfer – ${u.name}` : source;
};

// ---------- §1 Maternal and perinatal history ----------
export const SEROLOGY = { N: 'Negative', P: 'Positive', NK: 'Not known' };
export const RUBELLA = { immune: 'Immune', non_immune: 'Not immune', NK: 'Not known' };
export const ANTENATAL_PROBLEMS = {
  uneventful: 'Uneventful',
  pih_preeclampsia: 'PIH / pre-eclampsia',
  gdm_dm: 'GDM / diabetes',
  aph: 'Antepartum haemorrhage',
  prom: 'PROM',
  fever: 'Fever',
  chorioamnionitis: 'Chorioamnionitis',
  iugr: 'IUGR',
  polyhydramnios: 'Polyhydramnios',
  oligohydramnios: 'Oligohydramnios',
  anomaly_scan_abnormal: 'Anomaly scan abnormal',
  thyroid: 'Thyroid',
  anaemia: 'Anaemia',
  other: 'Other',
};
export const STEROIDS = { none: 'None', partial: 'Partial course', complete: 'Complete course' };
export const LABOUR_ONSET = { spontaneous: 'Spontaneous', induced: 'Induced', no_labour: 'No labour' };
export const LIQUOR = { clear: 'Clear', msl: 'Meconium-stained', foul: 'Foul-smelling', blood: 'Blood-stained' };
export const DELIVERY_MODE = { svd: 'Normal vaginal', vacuum: 'Vacuum', forceps: 'Forceps', breech: 'Assisted breech', lscs: 'Caesarean (LSCS)' };
export const RESUSCITATION_F03 = { none: 'None', ppv: 'PPV', intubated: 'Intubated', compressions: 'Chest compressions', drugs: 'Drugs' };
export const CORD_CLAMP = { delayed: 'Delayed (1 minute or more)', early: 'Early (under 1 minute)' };
export const YES_NO_UNKNOWN = { yes: 'Yes', no: 'No', unknown: 'Unknown' };

// ---------- §2 Admission assessment ----------
export const GROWTH_CHARTS = { fenton: 'Fenton', intergrowth: 'INTERGROWTH-21st', who: 'WHO' };
export const GA_METHODS = { lmp: 'LMP', usg: 'Ultrasound', new_ballard: 'New Ballard' };
export const SYMMETRY = { symmetric: 'Symmetric', asymmetric: 'Asymmetric' };
export const SPO2_SUPPORT = { air: 'Air', o2: 'Oxygen', cpap: 'CPAP' };
export const RESPIRATORY_SUPPORT = { none: 'None', o2: 'Oxygen', cpap: 'CPAP', ventilator: 'Ventilator' };
export const EXAM_SYSTEMS = {
  general_activity: 'General – activity',
  skin_colour_jaundice: 'Skin – colour, jaundice',
  head_fontanelle: 'Head – fontanelle',
  eyes: 'Eyes',
  ent_palate: 'ENT – palate',
  chest_air_entry: 'Chest – air entry',
  heart_murmur_pulses: 'Heart – murmur, pulses',
  abdomen_cord_liver: 'Abdomen – cord, liver',
  genitalia_anus: 'Genitalia, anus',
  spine: 'Spine',
  hips: 'Hips',
  limbs: 'Limbs',
  neuro_tone: 'Neuro – tone',
  neuro_reflexes: 'Neuro – reflexes',
};
export const MATURITY = { term: 'Term', late_preterm: 'Late preterm', preterm: 'Preterm', extreme_preterm: 'Extreme preterm' };
export const SIZE = { sga: 'SGA', aga: 'AGA', lga: 'LGA' };

// ---------- §3 Problem list and plan ----------
export const ADMISSION_REASONS = {
  prematurity: 'Prematurity',
  rds: 'RDS',
  ttn: 'TTN',
  mas: 'Meconium aspiration (MAS)',
  asphyxia_hie: 'Asphyxia / HIE',
  sepsis_suspected: 'Sepsis – suspected',
  sepsis_proven: 'Sepsis – proven',
  jaundice: 'Jaundice',
  hypoglycaemia: 'Hypoglycaemia',
  lbw_feeding: 'LBW / feeding',
  congenital_anomaly: 'Congenital anomaly',
  observation_at_risk: 'Observation – at risk',
  surgical: 'Surgical',
  other: 'Other',
};
export const SEPSIS_PATHWAY = { culture_and_antibiotics: 'Culture and antibiotics', observe: 'Observe' };
export const THERMAL = { incubator: 'Incubator', warmer: 'Radiant warmer', kmc: 'KMC' };
export const FEEDS = { npo: 'Nil by mouth', ebm: 'Expressed breast milk', formula_with_consent: 'Formula (with consent)' };
export const FEED_ROUTE = { og: 'Orogastric', paladai: 'Paladai', breast: 'Breast' };
export const LINES = { piv: 'Peripheral IV', uvc: 'UVC', uac: 'UAC', picc: 'PICC' };
export const INVESTIGATIONS = { culture: 'Blood culture', cbc: 'CBC', crp: 'CRP', glucose: 'Glucose', gas: 'Blood gas', tsb: 'TSB', electrolytes: 'Electrolytes', group_dat: 'Group and DAT', cxr: 'Chest X-ray', other: 'Other' };
export const MAX_PROBLEMS = 6;

// ---------- Outcome (NEO-L-05) ----------
export const OUTCOMES_F03 = { discharged_home: 'Discharged home', transferred: 'Transferred', died: 'Died', lama: 'Left against medical advice' };
// The DRAFT's outcomes (6 Nov 2026): kept for reading old records
export const LEGACY_OUTCOMES = { discharged: 'Discharged home', referred: 'Referred to a higher centre' };
export const outcomeWords = (k) => OUTCOMES_F03[k] ?? LEGACY_OUTCOMES[k] ?? k;
/** discharged_home for the new list; the DRAFT's "discharged" counts too. PURE. */
export const survived = (k) => k === 'discharged_home' || k === 'discharged';
export const isTransferOut = (k) => k === 'transferred' || k === 'referred';
export const MORBIDITIES = {
  ivh_grade_3_4: 'IVH grade 3–4',
  pvl: 'PVL',
  nec_stage_2_plus: 'NEC stage 2 or more',
  bpd: 'BPD',
  rop_type_1_plus: 'ROP type 1 or worse',
  sepsis_culture_proven: 'Sepsis – culture proven',
  clabsi: 'CLABSI',
  vap: 'VAP',
  pneumothorax: 'Pneumothorax',
  none: 'None',
};

// ---------- Computed (never typed) ----------
/** term ≥37 | late_preterm 34–36+6 | preterm 28–33+6 | extreme_preterm <28 (completed weeks). PURE. */
export function maturityClass(gaWeeks) {
  if (gaWeeks == null) return null;
  if (gaWeeks >= 37) return 'term';
  if (gaWeeks >= 34) return 'late_preterm';
  if (gaWeeks >= 28) return 'preterm';
  return 'extreme_preterm';
}
/** From the typed weight centile on the chosen chart: sga <10th | aga | lga >90th. null without a centile. PURE. */
export function sizeClass(centile) {
  if (centile == null || centile === '') return null;
  const c = Number(centile);
  if (!Number.isFinite(c)) return null;
  return c < 10 ? 'sga' : c > 90 ? 'lga' : 'aga';
}
/** The default chart: Fenton below 37 weeks, WHO from 37. PURE. */
export const defaultChart = (gaWeeks) => (gaWeeks == null ? null : gaWeeks < 37 ? 'fenton' : 'who');
const gaTotalDays = (w, d) => w * 7 + (d ?? 0);
/** ROP screening (schema, Confirm 4): GA < 34 wk OR weight < 2000 g OR (GA < 37 wk AND an unstable course). PURE. */
export function ropEligible({ gaWeeks, weightGrams, unstableCourse = false }) {
  if (gaWeeks == null && weightGrams == null) return null;
  return (gaWeeks != null && gaWeeks < 34) || (weightGrams != null && weightGrams < 2000) || (gaWeeks != null && gaWeeks < 37 && Boolean(unstableCourse));
}
/**
 * The first ROP examination: the later of 30 days after birth and the day the baby reaches 31 weeks' postmenstrual
 * age (GA at birth + age). Days are counted from the day of birth in India time. PURE.
 */
export function ropFirstExamDue(birthAt, gaWeeks, gaDays = 0) {
  if (!birthAt || gaWeeks == null) return null;
  const born = birthDay(birthAt);
  const at30 = born.getTime() + 30 * DAY;
  const at31wk = born.getTime() + (31 * 7 - gaTotalDays(gaWeeks, gaDays)) * DAY;
  return new Date(Math.max(at30, at31wk));
}
/** Cranial ultrasound when GA < 32 wk or weight < 1500 g: day 3, day 7, day 28 and 36 weeks' PMA. [] otherwise. PURE. */
export function cranialUsgDue(birthAt, gaWeeks, gaDays, weightGrams) {
  if (!birthAt) return [];
  if (!((gaWeeks != null && gaWeeks < 32) || (weightGrams != null && weightGrams < 1500))) return [];
  const born = birthDay(birthAt).getTime();
  const list = [
    { key: 'day3', label: 'Day 3', on: new Date(born + 3 * DAY) },
    { key: 'day7', label: 'Day 7', on: new Date(born + 7 * DAY) },
    { key: 'day28', label: 'Day 28', on: new Date(born + 28 * DAY) },
  ];
  if (gaWeeks != null) list.push({ key: 'pma36', label: '36 weeks PMA', on: new Date(born + (36 * 7 - gaTotalDays(gaWeeks, gaDays)) * DAY) });
  return list;
}
/** Days in the unit, whole days (to the discharge, or to now while admitted). PURE. */
export function lengthOfStayDays(admittedAt, until) {
  if (!admittedAt || !until) return null;
  return Math.max(0, Math.round((new Date(until) - new Date(admittedAt)) / DAY));
}
/** Hearing (AABR) before discharge when the stay is more than 5 days. PURE. */
export const aabrDue = (admittedAt, until) => (lengthOfStayDays(admittedAt, until) ?? 0) > 5;
/** Admission temperature in range (KPI): 36.5–37.5 °C. PURE. */
export const tempInRange = (t) => t != null && Number(t) >= 36.5 && Number(t) <= 37.5;
/** N2: under 36.0 °C – red banner and the hypothermia pathway (SOP-04). PURE. */
export const hypothermic = (t) => t != null && Number(t) < 36.0;
/** Glucose under 45 mg/dL – the hypoglycaemia pathway prompt (SOP-08). PURE. */
export const hypoglycaemic = (g) => g != null && Number(g) < 45;
/** Below the unit's admission floor (GA or weight): the transfer pathway is suggested. PURE. */
export const belowFloor = (unit, gaWeeks, weightGrams) =>
  Boolean(unit) && ((gaWeeks != null && gaWeeks < unit.minGestationWeeks) || (weightGrams != null && weightGrams < unit.minBirthWeightGrams));
/** N5: a transfer in to a level II unit with GA < 32, weight < 1500 or ventilated – outside the unit's capability. PURE. */
export function outsideCapability(unit, { source, gaWeeks, weightGrams, ventilated }) {
  if (!unit || unit.level !== 'level_II' || !isTransferIn(source)) return false;
  return (gaWeeks != null && gaWeeks < 32) || (weightGrams != null && weightGrams < 1500) || Boolean(ventilated);
}
// The dashboard bands (NEO-A-05)
export const WEIGHT_BANDS = [
  { key: 'w1', label: 'under 1000 g', test: (g) => g < 1000 },
  { key: 'w2', label: '1000–1499 g', test: (g) => g >= 1000 && g < 1500 },
  { key: 'w3', label: '1500–2499 g', test: (g) => g >= 1500 && g < 2500 },
  { key: 'w4', label: '2500 g or more', test: (g) => g >= 2500 },
];
export const GA_BANDS = [
  { key: 'g1', label: 'under 28 weeks', test: (w) => w < 28 },
  { key: 'g2', label: '28–31 weeks', test: (w) => w >= 28 && w < 32 },
  { key: 'g3', label: '32–36 weeks', test: (w) => w >= 32 && w < 37 },
  { key: 'g4', label: '37 weeks or more', test: (w) => w >= 37 },
];
export const bandOf = (bands, v) => (v == null ? null : (bands.find((b) => b.test(Number(v)))?.key ?? null));
// Minutes allowed for the parents' counselling and for the complete admission record (N1, N6, NEO-A-05)
export const COUNSEL_WITHIN_MIN = 60;
export const COMPLETE_WITHIN_MIN = 60;
/** Counselled within the hour (KPI). PURE. */
export const counselledInTime = (admittedAt, counselledAt) => Boolean(admittedAt && counselledAt) && new Date(counselledAt) - new Date(admittedAt) <= COUNSEL_WITHIN_MIN * MIN;
export const completedInTime = (admittedAt, signedAt) => Boolean(admittedAt && signedAt) && new Date(signedAt) - new Date(admittedAt) <= COMPLETE_WITHIN_MIN * MIN;
// A transfer out: decision to departure within 2 hours (KPI, times from the outcome until NEO-F-18 exists)
export const TRANSFER_WITHIN_MIN = 120;
// Late entry (PX-X-04, owner's approval 7 Nov 2026): typed more than an hour after the time it records
export const LATE_ENTRY_MIN = 60;
export const lateEntry = (eventAt, typedAt) => Boolean(eventAt && typedAt) && new Date(typedAt) - new Date(eventAt) > LATE_ENTRY_MIN * MIN;

/** The register number as printed: UNIT-YEAR-0001. PURE. */
export const registerLabel = (unitKey, year, no) => (no ? `${String(unitKey).toUpperCase()}-${year}-${String(no).padStart(4, '0')}` : null);
/** The register year of an admission: its admission day's year in India time. PURE. */
export const registerYearOf = (admittedAt) => new Date(new Date(admittedAt).getTime() + 330 * MIN).getUTCFullYear();

// ---------- NEO-A-05: the monthly dashboard's NICU rows (worked out in clinical/nicuData.js nicuDashboardValues) ----------
// defaultTarget: the schema's target, used until the hospital sets its own.
export const NICU_INDICATORS = [
  { key: 'nicuTempInRange', department: 'newborn', unit: 'percent', better: 'higher', defaultTarget: 90, label: 'NICU admission temperature 36.5–37.5 °C', definition: 'Admissions this month with a temperature of 36.5–37.5 °C at admission ÷ admissions (NEO-A-05).' },
  { key: 'nicuCounselled1h', department: 'newborn', unit: 'percent', better: 'higher', defaultTarget: 95, label: 'Parents counselled within 1 hour of NICU admission', definition: 'NEO-F-03 admissions this month with the parents counselled within 60 minutes ÷ NEO-F-03 admissions.' },
  { key: 'nicuComplete1h', department: 'newborn', unit: 'percent', better: 'higher', label: 'NICU admission record complete within 1 hour', definition: 'NEO-F-03 admissions signed by the admitting doctor within 60 minutes ÷ NEO-F-03 admissions (N6).' },
  { key: 'nicuCounselOverdue', department: 'newborn', unit: 'count', better: 'lower', label: 'NICU parents not counselled after 1 hour (now)', definition: 'Babies in the unit now, admitted over an hour ago, whose parents are not counselled yet (N1).' },
  ...WEIGHT_BANDS.map((b) => ({ key: `nicuWeight_${b.key}`, department: 'newborn', unit: 'count', label: `NICU admissions – weight ${b.label}`, definition: `Admissions this month weighing ${b.label} at admission.` })),
  ...GA_BANDS.map((b) => ({ key: `nicuGa_${b.key}`, department: 'newborn', unit: 'count', label: `NICU admissions – gestation ${b.label}`, definition: `Admissions this month born at ${b.label}.` })),
  ...WEIGHT_BANDS.map((b) => ({ key: `nicuSurvival_${b.key}`, department: 'newborn', unit: 'percent', better: 'higher', label: `Survival to discharge – ${b.label}`, definition: `Admissions of ${b.label} that ended this month discharged home ÷ admissions of ${b.label} that ended this month (n/N).` })),
  { key: 'nicuSurvivalUnder1500', department: 'newborn', unit: 'percent', better: 'higher', label: 'Survival to discharge – under 1500 g', definition: 'Admissions under 1500 g that ended this month discharged home ÷ admissions under 1500 g that ended this month (n/N).' },
  { key: 'nicuInborn', department: 'newborn', unit: 'count', label: 'NICU admissions – inborn', definition: 'Admissions this month of babies born here (labour room, theatre or postnatal ward).' },
  { key: 'nicuOutborn', department: 'newborn', unit: 'count', label: 'NICU admissions – outborn', definition: 'Admissions this month of babies born elsewhere (transfers in).' },
  { key: 'nicuTransfersOut', department: 'newborn', unit: 'count', label: 'NICU transfers out', definition: 'Admissions that ended this month with a transfer.' },
  { key: 'nicuTransfer2h', department: 'newborn', unit: 'percent', better: 'higher', defaultTarget: 90, label: 'Transfers out: decision to departure within 2 hours', definition: 'Transfers out this month with both times recorded on the outcome that left within 2 hours of the decision ÷ those transfers (until the transfer form NEO-F-18 exists).' },
  { key: 'nicuRopOnTime', department: 'newborn', unit: 'percent', better: 'higher', defaultTarget: 100, label: 'ROP-eligible babies with the first eye examination on time', definition: 'ROP-eligible NICU babies whose first examination fell due this month and was recorded done by its due date ÷ those babies.' },
];
