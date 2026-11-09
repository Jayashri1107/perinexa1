// Build 13 – the NICU admission form (NEO-F-03): every field of each part, in the manual's order, for the screen and the
// printout alike (the same list, so the print shows exactly what the form has). The lists of choices come from the
// server (GET /api/newborn-care → rules.f03), so they are never copied here. Field names follow
// server/src/clinical/nicuForm.js. Types: int, num, text, enum (options: a rules.f03 list), multi, yn (yes / no /
// unknown), at (date and time).
import { formatDate, formatDateTime } from '../../components/ui.jsx';

export const MATERNAL_FIELDS = [
  { key: 'motherAge', label: 'Mother’s age (years)', type: 'int' },
  { key: 'gravida', label: 'Gravida', type: 'int' },
  { key: 'para', label: 'Para', type: 'int' },
  { key: 'living', label: 'Living', type: 'int' },
  { key: 'abortions', label: 'Abortions', type: 'int' },
  { key: 'booked', label: 'Booked here', type: 'yn' },
  { key: 'bloodGroup', label: 'Blood group', type: 'text', max: 10 },
  { key: 'serology.vdrl', label: 'VDRL', type: 'enum', options: 'serology', test: 'vdrl' },
  { key: 'serology.hbsag', label: 'HBsAg', type: 'enum', options: 'serology', test: 'hbsag' },
  { key: 'serology.hiv', label: 'HIV', type: 'enum', options: 'serology', test: 'hiv' }, // shown under the neutral name
  { key: 'serology.gbs', label: 'GBS', type: 'enum', options: 'serology', test: 'gbs' },
  { key: 'serology.rubella', label: 'Rubella', type: 'enum', options: 'rubella', test: 'rubella' },
  { key: 'antenatalProblems', label: 'Antenatal problems', type: 'multi', options: 'antenatalProblems', wide: true },
  { key: 'promHours', label: 'PROM (hours)', type: 'int' },
  { key: 'anaemiaHb', label: 'Anaemia – Hb (g/dL)', type: 'num' },
  { key: 'anomalyScanDetail', label: 'Anomaly scan', type: 'text', max: 500 },
  { key: 'drugsInPregnancy', label: 'Drugs in pregnancy', type: 'text', max: 500 },
  { key: 'substances', label: 'Substances', type: 'yn' },
  { key: 'antenatalSteroids', label: 'Antenatal steroids', type: 'enum', options: 'steroids' },
  { key: 'steroidsLastDoseAt', label: 'Last steroid dose', type: 'at' },
  { key: 'mgso4Given', label: 'Magnesium sulphate', type: 'yn' },
  { key: 'maternalAntibioticsDrug', label: 'Maternal antibiotic', type: 'text', max: 150 },
  { key: 'maternalAntibioticsAt', label: 'Antibiotic given at', type: 'at' },
  { key: 'labourOnset', label: 'Labour', type: 'enum', options: 'labourOnset' },
  { key: 'labourDurationH', label: 'Labour duration (hours)', type: 'num' },
  { key: 'liquor', label: 'Liquor', type: 'enum', options: 'liquor' },
  { key: 'fetalDistress', label: 'Fetal distress', type: 'yn' },
  { key: 'ctgDetail', label: 'CTG', type: 'text', max: 500 },
  { key: 'deliveryMode', label: 'Mode of delivery', type: 'enum', options: 'deliveryMode' },
  { key: 'lscsCategory', label: 'LSCS category (1–4)', type: 'int' },
  { key: 'lscsIndication', label: 'LSCS indication', type: 'text', max: 500 },
  { key: 'presentation', label: 'Presentation', type: 'text', max: 100 },
  { key: 'anaesthesia', label: 'Anaesthesia', type: 'text', max: 100 },
  { key: 'ddiMin', label: 'Decision to delivery (minutes)', type: 'int' },
  { key: 'apgar1', label: 'Apgar 1 minute', type: 'int' },
  { key: 'apgar5', label: 'Apgar 5 minutes', type: 'int' },
  { key: 'apgar10', label: 'Apgar 10 minutes', type: 'int' },
  { key: 'resuscitation', label: 'Resuscitation', type: 'multi', options: 'resuscitation', wide: true },
  { key: 'ppvMinutes', label: 'PPV (minutes)', type: 'int' },
  { key: 'cordClamping', label: 'Cord clamping', type: 'enum', options: 'cordClamp' },
  { key: 'cordClampSeconds', label: 'Cord clamped at (seconds)', type: 'int' },
  { key: 'cordPh', label: 'Cord pH', type: 'num' },
  { key: 'cordBe', label: 'Cord base excess', type: 'num' },
  { key: 'drTempC', label: 'Delivery room temperature (°C)', type: 'num' },
  { key: 'skinToSkin', label: 'Skin-to-skin', type: 'yn' },
  { key: 'vitKGiven', label: 'Vitamin K given', type: 'yn' },
  { key: 'vitKAt', label: 'Vitamin K at', type: 'at' },
  { key: 'eyeCare', label: 'Eye care', type: 'yn' },
  { key: 'bandsVerified', label: 'Identity bands checked by two people', type: 'yn' },
  { key: 'firstFeedAt', label: 'First feed at', type: 'at' },
  { key: 'drGlucose', label: 'Delivery room glucose (mg/dL)', type: 'num' },
  { key: 'drGlucoseAt', label: 'Glucose at', type: 'at' },
];

// §2: weight, gestation and temperature are on the admission itself (top: true)
export const ASSESSMENT_FIELDS = [
  { key: 'weightGrams', label: 'Weight (g)', type: 'int', top: true },
  { key: 'lengthCm', label: 'Length (cm)', type: 'num' },
  { key: 'ofcCm', label: 'Head circumference (cm)', type: 'num' },
  { key: 'growthChart', label: 'Growth chart', type: 'enum', options: 'growthCharts' },
  { key: 'weightCentile', label: 'Weight centile (from the chart)', type: 'num' },
  { key: 'symmetry', label: 'Symmetry', type: 'enum', options: 'symmetry' },
  { key: 'gestationWeeks', label: 'Gestation (weeks)', type: 'int', top: true },
  { key: 'gestationDays', label: 'and days (0–6)', type: 'int', top: true },
  { key: 'gaMethod', label: 'Dated by', type: 'enum', options: 'gaMethods' },
  { key: 'ballardScore', label: 'Ballard score', type: 'int' },
  { key: 'temperatureC', label: 'Temperature (°C)', type: 'num', top: true },
  { key: 'hr', label: 'Heart rate (/min)', type: 'int' },
  { key: 'rr', label: 'Breathing rate (/min)', type: 'int' },
  { key: 'spo2', label: 'SpO2 (%)', type: 'int' },
  { key: 'spo2Support', label: 'SpO2 on', type: 'enum', options: 'spo2Support' },
  { key: 'fio2', label: 'FiO2 (0.21–1)', type: 'num' },
  { key: 'cpapPeep', label: 'CPAP PEEP (cm H2O)', type: 'num' },
  { key: 'bpSystolic', label: 'BP systolic', type: 'int' },
  { key: 'bpDiastolic', label: 'BP diastolic', type: 'int' },
  { key: 'bpMean', label: 'BP mean', type: 'int' },
  { key: 'crtSeconds', label: 'Capillary refill (seconds)', type: 'num' },
  { key: 'glucose', label: 'Glucose (mg/dL)', type: 'num' },
  { key: 'silvermanAndersen', label: 'Silverman–Andersen (0–10)', type: 'int' },
  { key: 'nipsPain', label: 'NIPS pain score', type: 'int' },
  { key: 'respiratorySupport', label: 'Respiratory support at admission', type: 'enum', options: 'respiratorySupport', gated: 'gatedRespiratory' },
  { key: 'sarnatStage', label: 'Sarnat stage (1–3)', type: 'int' },
  { key: 'anomaly', label: 'Anomaly', type: 'yn' },
  { key: 'anomalyDetail', label: 'Anomaly – detail', type: 'text', max: 500 },
  { key: 'birthInjury', label: 'Birth injury', type: 'yn' },
  { key: 'birthInjuryDetail', label: 'Birth injury – detail', type: 'text', max: 500 },
];

export const PLAN_FIELDS = [
  { key: 'reasonPrimary', label: 'Main reason for admission', type: 'enum', options: 'reasons', top: true },
  { key: 'workingDiagnosis', label: 'Working diagnosis', type: 'text', max: 500, wide: true },
  { key: 'icd10', label: 'ICD-10', type: 'text', max: 10 },
  { key: 'sepsisRisk', label: 'Sepsis risk', type: 'yn' },
  { key: 'sepsisPathway', label: 'Sepsis pathway', type: 'enum', options: 'sepsisPathway' },
  { key: 'hypoglycaemiaScreen', label: 'Hypoglycaemia screen', type: 'yn' },
  { key: 'jaundiceRisk', label: 'Jaundice risk', type: 'yn' },
  { key: 'tsbDueAt', label: 'TSB due', type: 'at' },
  { key: 'hie', label: 'HIE', type: 'yn' },
  { key: 'sarnat1h', label: 'Sarnat at 1 hour', type: 'int' },
  { key: 'coolingCentreCalledAt', label: 'Cooling centre called', type: 'at' },
  { key: 'unstableCourse', label: 'Unstable course (for ROP below 37 weeks)', type: 'yn' },
  { key: 'thermal', label: 'Thermal care', type: 'enum', options: 'thermal' },
  { key: 'humidityPct', label: 'Humidity (%)', type: 'int' },
  { key: 'respiratory', label: 'Respiratory plan', type: 'text', max: 500, wide: true },
  { key: 'fluidsMlKgDay', label: 'Fluids (mL/kg/day)', type: 'int' },
  { key: 'feeds', label: 'Feeds', type: 'enum', options: 'feeds' },
  { key: 'feedVolumeMlKgDay', label: 'Feed volume (mL/kg/day)', type: 'int' },
  { key: 'feedRoute', label: 'Feed route', type: 'enum', options: 'feedRoute' },
  { key: 'lines', label: 'Lines', type: 'multi', options: 'lines', gated: 'gatedLines', wide: true },
  { key: 'investigations', label: 'Investigations sent', type: 'multi', options: 'investigations', wide: true },
  { key: 'investigationsOther', label: 'Other investigation', type: 'text', max: 200 },
];

export const FOLLOW_ON_FIELDS = [
  { key: 'counselledAt', label: 'Parents counselled at', type: 'at' },
  { key: 'bothParents', label: 'Both parents', type: 'yn' },
  { key: 'consentSigned', label: 'Admission consent signed', type: 'yn' },
  { key: 'consentRef', label: 'Consent form (NEO-F-14)', type: 'text', max: 100 },
  { key: 'expressingStartedAt', label: 'Mother started expressing', type: 'at' },
  { key: 'lactationInformed', label: 'Lactation counsellor told', type: 'yn' },
  { key: 'consultantInformedAt', label: 'Consultant told at', type: 'at' },
  { key: 'consultantReviewAt', label: 'Consultant review at', type: 'at' },
];

export const OUTCOME_FIELDS = [
  { key: 'weightAtDischargeG', label: 'Weight at discharge (g)', type: 'int' },
  { key: 'morbidities', label: 'Morbidities', type: 'multi', options: 'morbidities', wide: true },
  { key: 'ventilated', label: 'Ventilated', type: 'yn' },
  { key: 'ventilatorDays', label: 'Ventilator days', type: 'num' },
  { key: 'cpapDays', label: 'CPAP days', type: 'num' },
  { key: 'surfactant', label: 'Surfactant', type: 'yn' },
  { key: 'tpn', label: 'TPN', type: 'yn' },
  { key: 'centralLineDays', label: 'Central line days', type: 'num' },
  { key: 'deathCauseIcd10', label: 'Cause of death (ICD-10)', type: 'text', max: 10, when: 'died' },
  { key: 'mmReviewRef', label: 'M&M review (NEO-A-06)', type: 'text', max: 60, when: 'died' },
  { key: 'transferTo', label: 'Transferred to', type: 'text', max: 150, when: 'transferred' },
  { key: 'transferReason', label: 'Reason for the transfer', type: 'text', max: 300, when: 'transferred' },
  { key: 'transferRef', label: 'Transfer form (NEO-F-18)', type: 'text', max: 60, when: 'transferred' },
  { key: 'transferDecisionAt', label: 'Decision to transfer', type: 'at', when: 'transferred' },
  { key: 'transferDepartedAt', label: 'Departed', type: 'at', when: 'transferred' },
];

/** A banner in words, with its date (the ROP due day; the time something was typed). */
export const bannerText = (b) => (b.on ? `${b.text} ${b.key === 'rop' ? formatDate(b.on) : formatDateTime(b.on)}.` : b.text);
/** A banner as a short flag for the unit board's bed cards. */
export const FLAG_WORDS = {
  pending: () => 'Admitted at the desk – assessment needed',
  hypothermia: () => 'Under 36.0 °C – hypothermia pathway',
  hypoglycaemia: () => 'Glucose under 45',
  rop: (b) => `ROP exam due ${formatDate(b.on)}`,
  capability: () => 'Outside unit capability',
  floor: () => 'Below admission floor',
  counsel: () => 'Parents not counselled',
  incomplete: () => 'Record not complete',
};
/** What is missing before signing, in words: the examination parts together, then each other field by its label. */
export function missingWords(fields, rules) {
  const all = [...ASSESSMENT_FIELDS, ...PLAN_FIELDS];
  const exam = [];
  const out = [];
  for (const [key, message] of Object.entries(fields ?? {})) {
    const m = /^assessment\.exam\.(.+)$/.exec(key);
    if (m) {
      exam.push(`${rules?.examSystems?.[m[1]] ?? m[1]}${message === 'Write what was found' ? ' (write what was found)' : ''}`);
      continue;
    }
    const f = all.find((x) => x.key === key.split('.').pop());
    out.push(f ? `${f.label}: ${message}` : message);
  }
  if (exam.length) out.unshift(`Examination – choose normal or not normal for ${exam.length === Object.keys(rules?.examSystems ?? {}).length ? 'every part' : exam.join(', ')}`);
  return out;
}

export const FROM_WORDS = { mother: "From the mother's record", delivery: 'From the delivery note', birth: 'From the record at birth' };
const YN = { yes: 'Yes', no: 'No', unknown: 'Unknown' };

/** A nested value (key "serology.hiv"). */
export const valueAt = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
export function setAt(obj, key, value) {
  const [a, b] = key.split('.');
  return b ? { ...obj, [a]: { ...(obj?.[a] ?? {}), [b]: value } } : { ...obj, [a]: value };
}
/** A field's label: the HIV test keeps its neutral name (rules.serologyTests). */
export const labelOf = (f, rules) => (f.test ? `${rules?.serologyTests?.[f.test] ?? f.label}` : f.label);

/** A stored value in words, for the screen and the printout ('–' when empty). */
export function valueWords(f, v, rules, unknown = false) {
  if (unknown) return 'Unknown';
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '–';
  switch (f.type) {
    case 'yn':
      return YN[v] ?? String(v);
    case 'enum':
      return rules?.[f.options]?.[v] ?? String(v);
    case 'multi':
      return v.map((k) => rules?.[f.options]?.[k] ?? k).join(', ');
    case 'at':
      return formatDateTime(v);
    default:
      return String(v);
  }
}

// ---------- The form's values while typing (strings), and back to what the server takes ----------
const pad = (n) => String(n).padStart(2, '0');
export const toLocal = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const nowLocal = () => toLocal(new Date());
export const toIso = (v) => (v ? new Date(v).toISOString() : '');
/** A part's stored values → the form's (dates to the local input format, numbers to text). */
export function toForm(fields, stored = {}) {
  let out = {};
  for (const f of fields) {
    const v = valueAt(stored, f.key);
    out = setAt(out, f.key, f.type === 'multi' ? (v ?? []) : f.type === 'at' ? toLocal(v) : v == null ? '' : String(v));
  }
  return out;
}
/** The form's values → the part as the server takes it (empty stays empty; the server makes '' null). */
export function fromForm(fields, form) {
  let out = {};
  for (const f of fields) {
    if (f.top) continue;
    const v = valueAt(form, f.key);
    out = setAt(out, f.key, f.type === 'at' ? toIso(v) : f.type === 'multi' ? (v ?? []) : (v ?? ''));
  }
  return out;
}
