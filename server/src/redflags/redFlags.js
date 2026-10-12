// Red-flag alerts (Smart features, step 1; widened on 4 Oct 2026 to lab results, postnatal and newborn care and
// patients in hospital, and on 5 Oct 2026 to pregnancy-loss care).
//
// A red flag is a warning worked out from values recorded for a patient: "BP 162/104 – severe-range blood
// pressure". The values come from
//  - her latest visit of this pregnancy or episode of care (and, for weight gain, the visit before it);
//  - the lab results of this pregnancy or episode of care, once the lab has reported them (the latest value of
//    each test; an amended report replaces the earlier values);
//  - while she is in hospital, the vital signs on the nursing chart of this stay (the latest value of each sign,
//    when it is newer than the visit's; when nobody can tell which is newer, both are checked);
//  - in pregnancy-loss care, her record: where the pregnancy is (an ectopic, or not yet located), and the findings a
//    doctor or RMO recorded there – signs of rupture, bleeding, fever with foul-smelling discharge
//    (patients/lossFindings.js).
// The same quantity measured in two places (haemoglobin and urine albumin: at a visit and in the lab) counts once:
// the newer reading. A rule that joins values from different places (blood pressure with a lab urine result) is
// raised only when they were recorded within RULE_VALUES_WITHIN_DAYS days of each other.
// The rules are the hospital's own (one rule set per hospital, a doctor edits and approves them, like the risk
// rules). Each rule says which types of care it applies to. The built-in rules below are a DRAFT prepared from
// published guidance (FOGSI, WHO, MoHFW India, NICE, RCOG, ACOG, ATA, NNF India) – not a clinical review – and
// are shown as a draft until a doctor approves them. The pregnancy-loss rules also draw on RCOG guidance.
//
// This is DECISION SUPPORT: a flag is only raised from values actually recorded (a missing value never raises or
// clears a flag), every flag says which value raised it, where and when it was recorded and which rule it is,
// and symptoms written as text are not checked. Flags are worked out when they are read, never stored.
// Pure – no database (only the hospital's time zone is read, for dates in words).

import { DAY, addDays, dateWords, daysBetween, gaOn, hospitalDayStart, timeIn, toHospitalDate, utcDay } from '../careplans/dates.js';

export const RED_FLAG_LEVELS = ['urgent', 'watch'];
// Bump when the built-in draft rules below change: hospitals whose rules no doctor has edited or approved get
// the new ones; every other hospital is offered the new rules (BUILT_IN_SINCE) to add as a draft.
// 2 (4 Oct 2026): rules say which types of care they apply to; lab results; postnatal and newborn rules.
// 3 (5 Oct 2026): pregnancy-loss care (the Abortion type of care) – possible ruptured ectopic, possible septic
// abortion, heavy bleeding, severe anaemia.
export const BUILT_IN_RED_FLAG_VERSION = 3;

// The types of care a rule can apply to (the same list as models/Patient.js CARE_TYPES – a test checks it).
export const RED_FLAG_CARE_TYPES = ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn', 'abortion'];
// Rules saved before rules had "applies to" were all for pregnancy care.
export const DEFAULT_APPLIES_TO = ['antenatal'];
/** The types of care a rule applies to. */
export const ruleCareTypes = (rule) => (rule?.appliesTo?.length ? [...rule.appliesTo] : DEFAULT_APPLIES_TO);

// Ordered grades (a rule "at least 1+" matches 1+, 2+, 3+ and 4+).
export const URINE_ORDER = ['nil', 'trace', '1+', '2+', '3+', '4+'];
export const OEDEMA_ORDER = ['none', 'mild', 'moderate', 'severe'];

const PREGNANCY_ONLY = ['antenatal'];
const BABY_ONLY = ['newborn'];
const LOSS_ONLY = ['abortion'];
const NOT_BABY = RED_FLAG_CARE_TYPES.filter((t) => t !== 'newborn');

// What a rule can check. type: number (lt/lte/gt/gte), grade (gte an ordered grade), choice (in a list).
// group: vitals – vital signs recorded at a visit or, in hospital, on the nursing chart; visit – other values
// recorded at a visit; worked – worked out from them; lab – a result reported by the lab; record – on her record
// (pregnancy-loss care: the Pregnancy loss section and its findings).
// careTypes: the types of care the value exists for (none given: every type).
export const RED_FLAG_FACTORS = {
  bpSystolic: { label: 'BP systolic', unit: 'mmHg', type: 'number', group: 'vitals' },
  bpDiastolic: { label: 'BP diastolic', unit: 'mmHg', type: 'number', group: 'vitals' },
  pulse: { label: 'Pulse', unit: '/min', type: 'number', group: 'vitals' },
  temperatureF: { label: 'Temperature', unit: '°F', type: 'number', group: 'vitals' },
  spo2: { label: 'SpO₂', unit: '%', type: 'number', group: 'vitals' },
  hb: { label: 'Hb', unit: 'g/dL', type: 'number', group: 'visit' },
  urineAlbumin: { label: 'Urine albumin', type: 'grade', order: URINE_ORDER, group: 'visit' },
  urineSugar: { label: 'Urine sugar', type: 'grade', order: URINE_ORDER, group: 'visit' },
  oedema: { label: 'Oedema', type: 'grade', order: OEDEMA_ORDER, group: 'visit', careTypes: PREGNANCY_ONLY },
  fetalMovements: { label: 'Fetal movements', type: 'choice', choices: ['present', 'reduced', 'absent'], group: 'visit', careTypes: PREGNANCY_ONLY },
  fetalHeartRate: { label: 'Fetal heart rate', unit: '/min', type: 'number', group: 'visit', careTypes: PREGNANCY_ONLY },
  presentation: { label: 'Presentation', type: 'choice', choices: ['cephalic', 'breech', 'transverse', 'oblique', 'variable'], group: 'visit', careTypes: PREGNANCY_ONLY },
  // Worked out: |fundal height (cm) − weeks of pregnancy at the visit|
  fundalHeightGap: { label: 'Fundal height differs from weeks by', unit: 'cm', type: 'number', group: 'worked', careTypes: PREGNANCY_ONLY },
  // Worked out: weight change since the previous visit that has a weight, per week (at least 1 week apart)
  weightGainPerWeek: { label: 'Weight gain since last visit', unit: 'kg/week', type: 'number', group: 'worked', careTypes: PREGNANCY_ONLY },
  // Weeks of pregnancy TODAY (not at the visit) – e.g. for "41 weeks or more"
  weeksToday: { label: 'Weeks of pregnancy today', unit: 'weeks', type: 'number', group: 'worked', careTypes: PREGNANCY_ONLY },
  // Worked out for a baby: how far the weight at the visit is below the birth weight on the record, in per cent
  weightBelowBirth: { label: 'Weight below birth weight by', unit: '%', type: 'number', group: 'worked', careTypes: BABY_ONLY },
  // Lab results (lab/labTests.js): the latest reported value of this pregnancy or episode of care
  labHb: { label: 'Haemoglobin (lab)', unit: 'g/dL', type: 'number', group: 'lab' },
  labPlatelets: { label: 'Platelets (lab)', unit: 'lakh/µL', type: 'number', group: 'lab' },
  labFastingGlucose: { label: 'Fasting blood sugar (lab)', unit: 'mg/dL', type: 'number', group: 'lab', careTypes: NOT_BABY },
  labOgtt2h: { label: 'OGTT 2-hour blood sugar (lab)', unit: 'mg/dL', type: 'number', group: 'lab', careTypes: NOT_BABY },
  labPostMealGlucose: { label: 'Post-meal blood sugar (lab)', unit: 'mg/dL', type: 'number', group: 'lab', careTypes: NOT_BABY },
  labRandomGlucose: { label: 'Random blood sugar (lab)', unit: 'mg/dL', type: 'number', group: 'lab', careTypes: NOT_BABY },
  labTsh: { label: 'TSH (lab)', unit: 'µIU/mL', type: 'number', group: 'lab' },
  labUrineAlbumin: { label: 'Urine albumin (lab)', type: 'grade', order: URINE_ORDER, group: 'lab', careTypes: NOT_BABY },
  labBabyGlucose: { label: "Baby's blood sugar (lab)", unit: 'mg/dL', type: 'number', group: 'lab', careTypes: BABY_ONLY },
  labBilirubinTotal: { label: "Baby's total bilirubin (lab)", unit: 'mg/dL', type: 'number', group: 'lab', careTypes: BABY_ONLY },
  labBilirubinDirect: { label: "Baby's direct bilirubin (lab)", unit: 'mg/dL', type: 'number', group: 'lab', careTypes: BABY_ONLY },
  // Pregnancy-loss care, from her record. Location: 'ectopic' – the type of loss is an ectopic pregnancy; 'unknown' –
  // a pregnancy of unknown location: a complete miscarriage whose scan showed no gestational sac in the uterus (nor
  // did an earlier one), with no products of conception seen (patients/abortionRules.js lossLocation). Either only
  // while the pregnancy can still rupture: not once "Treatment complete" or an operation is recorded
  // (patients/lossFindings.js lossLocationNow). The other three are findings a doctor or RMO recorded on her record,
  // each with the day it was recorded.
  lossLocation: { label: 'Pregnancy location', type: 'choice', choices: ['ectopic', 'unknown'], group: 'record', careTypes: LOSS_ONLY },
  lossRuptureSigns: { label: 'Signs of rupture', type: 'choice', choices: ['yes', 'no'], group: 'record', careTypes: LOSS_ONLY },
  lossBleeding: { label: 'Bleeding', type: 'choice', choices: ['light', 'moderate', 'heavy'], group: 'record', careTypes: LOSS_ONLY },
  lossFeverDischarge: { label: 'Fever with foul-smelling discharge', type: 'choice', choices: ['yes', 'no'], group: 'record', careTypes: LOSS_ONLY },
};
// The findings of a pregnancy-loss record the rules can check: [the rule's check, the finding on the record]
// (the same pairs as patients/lossFindings.js RED_FLAG_LOSS_FINDINGS – a test checks it).
export const LOSS_RECORD_FACTORS = [
  ['lossRuptureSigns', 'ruptureSigns'],
  ['lossBleeding', 'bleeding'],
  ['lossFeverDischarge', 'feverDischarge'],
];
export const NUMBER_OPS = ['lt', 'lte', 'gt', 'gte'];
// A rule with several checks whose values were recorded in different places (a visit, a lab result, the nursing
// chart) is raised only when the values were recorded within this many days of each other: a lab result of months
// ago is never joined with today's blood pressure. DRAFT, for the doctor to check with the rules; the rule pages
// and the text of such a rule say it.
export const RULE_VALUES_WITHIN_DAYS = 7;
// One quantity measured in two places – at a visit (point of care) and by the lab: [the visit's check, the lab's].
const SAME_QUANTITY = [
  ['hb', 'labHb'],
  ['urineAlbumin', 'labUrineAlbumin'],
];
const OP_TEXT = { lt: 'under', lte: 'at most', gt: 'over', gte: 'at least' };

// Which lab test and value feed each lab factor (test key → value key, lab/labTests.js). An adult's and a baby's
// test feed the same factor where both exist (a baby's record has only baby tests). min–max: the values that are
// plausible in the factor's unit – a value outside them (for example typed in another unit) is not checked: it
// never raises or clears a flag. Only values the lab enters as a number; urine albumin is the lab's grade
// (Nil … 4+), checked like the dipstick grade of a visit.
export const LAB_FACTOR_SOURCES = {
  labHb: { tests: { cbc: 'hb', hb: 'hb', nb_cbc: 'hb' }, min: 2, max: 25 },
  labPlatelets: { tests: { cbc: 'platelets', nb_cbc: 'platelets' }, min: 0.01, max: 20 },
  labFastingGlucose: { tests: { fbs: 'fbs' }, min: 10, max: 1000 },
  labOgtt2h: { tests: { ogtt: 'glucose2h' }, min: 10, max: 1000 },
  labPostMealGlucose: { tests: { ppbs: 'ppbs' }, min: 10, max: 1000 },
  labRandomGlucose: { tests: { rbs: 'rbs' }, min: 10, max: 1000 },
  labTsh: { tests: { tsh: 'tsh', nb_tsh: 'tsh' }, min: 0, max: 1000 },
  labUrineAlbumin: { tests: { urine: 'albumin' } },
  labBabyGlucose: { tests: { nb_sugar: 'glucose' }, min: 1, max: 1000 },
  labBilirubinTotal: { tests: { nb_bilirubin: 'total' }, min: 0.1, max: 60 },
  labBilirubinDirect: { tests: { nb_bilirubin: 'direct' }, min: 0, max: 60 },
};
export const LAB_FACTORS = Object.keys(LAB_FACTOR_SOURCES);
/** The lab tests (keys) the rules' lab checks need – none when no rule looks at a lab result. */
export function labTestKeysOf(rules) {
  const keys = new Set();
  for (const r of rules ?? []) for (const c of r.conditions ?? []) for (const k of Object.keys(LAB_FACTOR_SOURCES[c.factor]?.tests ?? {})) keys.add(k);
  return [...keys];
}
// The test whose "baby's age when sampled" (hours) the lab enters with the result
const AGE_HOURS_KEY = 'ageHours';
const MAX_AGE_HOURS = 24 * 366;

const round1 = (n) => Math.round(n * 10) / 10;
const time = (d) => new Date(d).getTime();

/** A lab value as the rules use it: a number inside the plausible range, or a grade; null when it can't be used. */
function labValue(factor, raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const f = RED_FLAG_FACTORS[factor];
  if (f.type === 'grade') {
    const grade = String(raw).trim().toLowerCase();
    return f.order.includes(grade) ? grade : null;
  }
  const n = Number(String(raw).trim().replace(',', '.'));
  const { min, max } = LAB_FACTOR_SOURCES[factor];
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/**
 * The latest reported value of each lab factor (pure). orders: the patient's lab orders – only reported or
 * reviewed ones count (their current values: an amended report has replaced the earlier ones); a result that is
 * only saved, or a cancelled order, does not.
 * since: the first day of this pregnancy or episode of care (null: everything on the record); sinceAt: the moment
 * it began, when the record has one (a delivery note with its time) – a sample taken earlier that day is then
 * left out too (a report without a sample time counts from the time of the report: when nobody can tell, the value
 * is shown rather than hidden). The date of a value is the hospital's date of the sample, as on the care plan.
 * birthAt: a baby's time of birth, for the age in days when sampled. The age in hours the lab entered with the
 * result is used first. Without it the time of the sample is used – and when the lab reported without marking the
 * sample as collected (the report then stamps the sample time, routes/lab.js), the sample was taken some time
 * between the order and the report: the time of the order is used, so that the limit of the younger age applies
 * and a value is flagged early rather than late.
 * Returns { [factor]: { value, on, at, orderId, ageDays } }.
 */
export function labReadings(orders, { since = null, sinceAt = null, birthAt = null } = {}) {
  const out = {};
  const newer = (a, b) => time(a.at) > time(b.at) || (time(a.at) === time(b.at) && time(a.reportedAt ?? 0) > time(b.reportedAt ?? 0));
  const daysOld = (moment) => (birthAt && moment ? Math.floor((time(moment) - time(birthAt)) / DAY) : null);
  for (const o of orders ?? []) {
    if (!['reported', 'reviewed'].includes(o.status)) continue;
    const at = o.collected?.at ?? o.reported?.at ?? o.createdAt;
    if (!at) continue;
    const on = toHospitalDate(at);
    if (sinceAt ? time(at) < time(sinceAt) : since && on < utcDay(since)) continue;
    // The sample's own time is not on the record: it was stamped by the report
    const stamped = o.collectedAtReport === true || !o.collected?.at || (o.reported?.at != null && time(o.collected.at) === time(o.reported.at));
    const earliest = stamped && o.createdAt && time(o.createdAt) < time(at) ? o.createdAt : at;
    for (const t of o.tests ?? []) {
      const raw = (key) => (t.values ?? []).find((x) => x.key === key)?.value;
      for (const factor of LAB_FACTORS) {
        const valueKey = LAB_FACTOR_SOURCES[factor].tests[t.key];
        if (!valueKey) continue;
        const value = labValue(factor, raw(valueKey));
        if (value == null) continue;
        const hours = Number(String(raw(AGE_HOURS_KEY) ?? '').trim().replace(',', '.') || NaN);
        const fromBirth = [daysOld(earliest), daysOld(at)].find((d) => d != null && d >= 0) ?? null;
        const ageDays = Number.isFinite(hours) && hours >= 0 && hours <= MAX_AGE_HOURS ? Math.floor(hours / 24) : fromBirth;
        const reading = { value, on, at: new Date(at), reportedAt: o.reported?.at ?? null, orderId: o._id != null ? String(o._id) : null, ageDays };
        if (!out[factor] || newer(reading, out[factor])) out[factor] = reading;
      }
    }
  }
  return out;
}

/**
 * The latest value of each vital sign on the nursing chart of a stay (pure). entries: the stay's chart entries;
 * only vital-sign entries that are not marked "entered in error" count. A sign keeps its latest charted value
 * until a newer one is charted (an entry without a BP does not clear an earlier raised BP).
 * since / sinceAt: the first day (or, when the record has it, the moment) of this pregnancy or episode of care –
 * an entry charted in labour, before the delivery, is not a value "after delivery".
 * Returns { bp: { systolic, diastolic, at, admissionId } | null, pulse | temperatureF | spo2: { value, at, admissionId } | null }.
 */
export function chartReadings(entries, { since = null, sinceAt = null } = {}) {
  const out = { bp: null, pulse: null, temperatureF: null, spo2: null };
  const inEpisode = (e) => (sinceAt ? time(e.at) >= time(sinceAt) : !since || toHospitalDate(e.at) >= utcDay(since));
  const rows = (entries ?? [])
    .filter((e) => !e.cancelled && (e.kind ?? 'vitals') === 'vitals' && e.at && inEpisode(e))
    .sort((a, b) => time(b.at) - time(a.at));
  for (const e of rows) {
    const v = e.vitals ?? {};
    const origin = { at: new Date(e.at), admissionId: e.admissionId != null ? String(e.admissionId) : null };
    if (!out.bp && (v.bpSystolic != null || v.bpDiastolic != null)) out.bp = { systolic: v.bpSystolic ?? null, diastolic: v.bpDiastolic ?? null, ...origin };
    for (const k of ['pulse', 'temperatureF', 'spo2']) if (!out[k] && v[k] != null) out[k] = { value: v[k], ...origin };
  }
  return out;
}

// When a visit's vital signs were taken, as far as the record can tell: some time from `earliest` to `latest`.
// A visit keeps ONE time for all its vital signs – when they were last saved. Saved once, that is the time. Saved
// again (a weight or an Hb added later), nobody can tell when the BP was taken: some time between the start of the
// visit and the last save. A visit entered later for an earlier day: some time on that day.
function visitSpan(visit) {
  const dayStart = hospitalDayStart(visit.visitOn).getTime();
  const dayEnd = hospitalDayStart(addDays(visit.visitOn, 1)).getTime() - 1;
  const onDay = (t) => t != null && t >= dayStart && t <= dayEnd;
  const saved = visit.vitals?.at != null ? time(visit.vitals.at) : null;
  if (!onDay(saved)) return { earliest: dayStart, latest: dayEnd };
  if ((visit.vitals?.rev ?? 1) <= 1) return { earliest: saved, latest: saved };
  const started = visit.createdAt != null ? time(visit.createdAt) : null;
  return { earliest: onDay(started) ? Math.min(started, saved) : dayStart, latest: saved };
}

/**
 * The facts rules can check (null = not recorded), with where each one comes from (facts.from[factor]:
 * { source: 'visit' | 'chart' | 'lab' | 'today', on | at, visitId | orderId | admissionId, weeks, ageDays }).
 *  - careType: the patient's type of care (antenatal when not given);
 *  - visit: the latest visit of this pregnancy or episode (may be null); previousWeighed: the visit before it
 *    that has a weight; edd: the EDD in use (antenatal); today: the hospital's date;
 *  - chart: chartReadings() of the current stay (a patient in hospital) – a charted vital sign replaces the
 *    visit's when it is certainly newer, and the visit's stays when the chart's is certainly older. When nobody can
 *    tell (visitSpan), neither hides the other: the chart's value is in the facts and the visit's in facts.also –
 *    a second set of facts that evaluateRedFlags checks as well;
 *  - lab: labReadings() of this pregnancy or episode;
 *  - newborn: { birthAt, birthWeightGrams } from a baby's record;
 *  - delivered: the delivery of this pregnancy is on the record – "weeks of pregnancy today" no longer counts;
 *  - loss: pregnancy-loss care – lossRedFlagFacts() of her record: { location, findings: { ruptureSigns | bleeding |
 *    feverDischarge: { value, on } } }. The location is a standing fact of the record while the pregnancy can still
 *    rupture (it has no day of its own, so a rule joins it with a visit's vital signs; for a visit's own flags it is
 *    the location at that visit – lossLocationOn); a finding is from the day it was recorded (source 'record').
 */
export function redFlagFacts({ careType = 'antenatal', visit = null, previousWeighed = null, edd = null, today, chart = null, lab = null, newborn = null, delivered = false, loss = null }) {
  const v = visit?.vitals ?? {};
  const d = visit?.details ?? {};
  const pregnancyEdd = careType === 'antenatal' ? edd : null;
  const birthAt = careType === 'newborn' ? (newborn?.birthAt ?? null) : null;
  const weeksOn = (date) => (pregnancyEdd && date ? (gaOn(pregnancyEdd, date)?.weeks ?? null) : null);
  // A baby's age in whole days: on a date (a visit has only its day), or at a moment (the nursing chart)
  const ageOn = (date) => {
    if (!birthAt || !date) return null;
    const days = daysBetween(toHospitalDate(birthAt), date);
    return days >= 0 ? days : null;
  };
  const ageAt = (moment) => {
    if (!birthAt || !moment) return null;
    const days = Math.floor((time(moment) - time(birthAt)) / DAY);
    return days >= 0 ? days : null;
  };
  const gaVisit = pregnancyEdd && visit ? gaOn(pregnancyEdd, visit.visitOn) : null;
  const gaToday = pregnancyEdd && !delivered ? gaOn(pregnancyEdd, today) : null;
  const blank = (x) => (x === '' || x === undefined ? null : x);

  const facts = { careType };
  const from = {};
  const put = (factor, value, origin) => {
    facts[factor] = value ?? null;
    if (value != null && origin) from[factor] = origin;
  };

  // The latest visit
  const visitOrigin = visit ? { source: 'visit', on: utcDay(visit.visitOn), visitId: visit._id != null ? String(visit._id) : null, weeks: gaVisit ? gaVisit.weeks : null, ageDays: ageOn(visit.visitOn) } : null;
  for (const k of ['bpSystolic', 'bpDiastolic', 'pulse', 'temperatureF', 'spo2', 'hb']) put(k, v[k], visitOrigin);
  put('urineAlbumin', blank(v.urineAlbumin), visitOrigin);
  put('urineSugar', blank(v.urineSugar), visitOrigin);
  put('oedema', blank(d.oedema), visitOrigin);
  put('fetalMovements', blank(d.fetalMovements), visitOrigin);
  put('fetalHeartRate', d.fetalHeartRate, visitOrigin);
  put('presentation', blank(d.presentation), visitOrigin);
  put('fundalHeightGap', d.fundalHeightCm != null && gaVisit ? round1(Math.abs(d.fundalHeightCm - (gaVisit.weeks + gaVisit.days / 7))) : null, visitOrigin);
  let weightGainPerWeek = null;
  if (v.weightKg != null && previousWeighed?.vitals?.weightKg != null) {
    const days = daysBetween(previousWeighed.visitOn, visit.visitOn);
    if (days >= 7) weightGainPerWeek = round1(((v.weightKg - previousWeighed.vitals.weightKg) / days) * 7);
  }
  put('weightGainPerWeek', weightGainPerWeek, visitOrigin);
  // A baby's weight against the birth weight on the record (a positive number: below the birth weight). Not
  // rounded: 10.03 % is "more than 10 %" (the flag's text rounds it, weightText).
  const birthGrams = careType === 'newborn' ? (newborn?.birthWeightGrams ?? null) : null;
  put('weightBelowBirth', v.weightKg != null && birthGrams ? ((birthGrams - Math.round(v.weightKg * 1000)) * 100) / birthGrams : null, visitOrigin);
  facts.weightKg = v.weightKg ?? null;
  facts.birthWeightGrams = birthGrams;

  // In hospital: the nursing chart's latest value of a vital sign replaces the visit's when it is certainly newer.
  // When nobody can tell which is newer, the chart's value goes here and the visit's is kept for facts.also.
  const visitToo = {}; // the visit's values that are checked as well: { factor: value }
  const visitFrom = {};
  if (chart) {
    const span = visit ? visitSpan(visit) : null;
    // 'chart': only the chart's value counts; 'visit': only the visit's; 'both': the order cannot be known
    const which = (reading, visitHas) => {
      if (!reading) return 'visit';
      if (!visitHas || !span) return 'chart';
      const t = time(reading.at);
      return t >= span.latest ? 'chart' : t < span.earliest ? 'visit' : 'both';
    };
    const chartOrigin = (reading) => ({ source: 'chart', at: reading.at, admissionId: reading.admissionId ?? null, weeks: weeksOn(toHospitalDate(reading.at)), ageDays: ageAt(reading.at) });
    const take = (factors, reading, values) => {
      const use = which(reading, factors.some((k) => v[k] != null));
      if (use === 'visit') return;
      for (const k of factors) {
        if (use === 'both') {
          visitToo[k] = facts[k];
          if (from[k]) visitFrom[k] = from[k];
        }
        delete from[k];
        put(k, values[k], chartOrigin(reading));
      }
    };
    take(['bpSystolic', 'bpDiastolic'], chart.bp, { bpSystolic: chart.bp?.systolic, bpDiastolic: chart.bp?.diastolic });
    for (const k of ['pulse', 'temperatureF', 'spo2']) take([k], chart[k], { [k]: chart[k]?.value });
  }

  // Lab results of this pregnancy or episode
  for (const factor of LAB_FACTORS) {
    const r = lab?.[factor] ?? null;
    put(factor, r?.value, r ? { source: 'lab', on: r.on, orderId: r.orderId ?? null, weeks: weeksOn(r.on), ageDays: r.ageDays ?? null } : null);
  }

  // Her record (pregnancy-loss care): where the pregnancy is, and the findings recorded there
  const record = careType === 'abortion' ? loss : null;
  put('lossLocation', record?.location ?? null, null);
  for (const [factor, finding] of LOSS_RECORD_FACTORS) {
    const r = record?.findings?.[finding] ?? null;
    put(factor, r?.value, r ? { source: 'record', on: utcDay(r.on) } : null);
  }

  // Today
  put('weeksToday', gaToday ? gaToday.weeks : null, { source: 'today', on: utcDay(today) });

  const all = {
    ...facts,
    // For the rule's "from / to week" window: weeks at the visit (or today for rules on weeksToday only)
    weeksAtVisit: gaVisit ? gaVisit.weeks : null,
    weeksNow: gaToday ? gaToday.weeks : null,
    // For a baby's "from / to day" window when a rule has no dated value
    ageDaysNow: ageOn(today),
    from,
  };
  // The same facts with the visit's vital signs where nobody can tell whether the visit or the chart is newer
  if (Object.keys(visitToo).length) {
    const kept = Object.fromEntries(Object.entries(from).filter(([k]) => !(k in visitToo)));
    all.also = [{ ...all, ...visitToo, from: { ...kept, ...visitFrom } }];
  }
  return all;
}

function valueText(factor, value) {
  const f = RED_FLAG_FACTORS[factor];
  if (value == null) return '';
  return `${f.label} ${value}${f.unit ? ` ${f.unit}` : ''}`;
}

/** One condition: true, false or null (the value isn't recorded). */
export function checkCondition(c, facts) {
  const f = RED_FLAG_FACTORS[c.factor];
  if (!f) return null;
  const v = facts[c.factor];
  if (v === null || v === undefined) return null;
  if (f.type === 'number') {
    switch (c.op) {
      case 'lt':
        return v < c.value;
      case 'lte':
        return v <= c.value;
      case 'gt':
        return v > c.value;
      case 'gte':
        return v >= c.value;
      default:
        return null;
    }
  }
  if (f.type === 'grade') {
    const at = f.order.indexOf(v);
    const min = f.order.indexOf(c.grade);
    return at < 0 || min < 0 ? null : at >= min;
  }
  if (f.type === 'choice') return (c.choices ?? []).includes(v);
  return null;
}

/** A condition in words, e.g. "BP systolic at least 160 mmHg", "Urine albumin 1+ or more". */
export function conditionText(c) {
  const f = RED_FLAG_FACTORS[c.factor];
  if (!f) return 'Unknown check';
  if (f.type === 'number') return `${f.label} ${OP_TEXT[c.op] ?? c.op} ${c.value}${f.unit ? ` ${f.unit}` : ''}`;
  if (f.type === 'grade') return `${f.label} ${c.grade} or more`;
  return `${f.label}: ${(c.choices ?? []).join(' or ')}`;
}

/** When in pregnancy the rule applies, e.g. "from 20 weeks", "24–40 weeks", "" (always). */
export function weeksText(r) {
  if (r.fromWeek != null && r.toWeek != null) return `${r.fromWeek}–${r.toWeek} weeks`;
  if (r.fromWeek != null) return `from ${r.fromWeek} weeks`;
  if (r.toWeek != null) return `up to ${r.toWeek} weeks`;
  return '';
}

const daysOld = (n) => `${n} ${n === 1 ? 'day' : 'days'} old`;
/** At which age of a baby the rule applies (whole days, when the value was taken): "baby under 1 day old", "baby 1–3 days old", "". */
export function ageText(r) {
  const { fromDay: a = null, toDay: b = null } = r;
  if (a == null && b == null) return '';
  if (a != null && b != null) {
    if (a !== b) return `baby ${a}–${b} days old`;
    return b === 0 ? 'baby under 1 day old' : `baby ${daysOld(b)}`;
  }
  if (a != null) return `baby ${daysOld(a)} or more`;
  return b === 0 ? 'baby under 1 day old' : `baby up to ${daysOld(b)}`;
}

/**
 * For a rule that joins a lab result with a value from a visit or the nursing chart: how close in time the values
 * must have been recorded ("values recorded within 7 days of each other"; '' for any other rule).
 */
export function withinText(r) {
  const groups = (r.conditions ?? []).filter((c) => c.factor !== 'weeksToday').map((c) => RED_FLAG_FACTORS[c.factor]?.group);
  return groups.includes('lab') && groups.some((x) => x && x !== 'lab') ? `values recorded within ${RULE_VALUES_WITHIN_DAYS} days of each other` : '';
}

/** The whole rule in words: "BP systolic at least 140 mmHg and Urine albumin 1+ or more, from 20 weeks". */
export function ruleText(r) {
  const checks = (r.conditions ?? []).map(conditionText).join(' and ');
  return [checks, weeksText(r), ageText(r), withinText(r)].filter(Boolean).join(', ');
}

// The weeks of pregnancy (antenatal) and the baby's age in days (newborn) a rule is limited to are checked on
// the day each value was recorded; a rule with no dated value (weeks today) is checked on today.
function insideWindow(rule, careType, origins, facts) {
  const dated = origins.filter((o) => o && o.source !== 'today');
  const within = (values, lo, hi) => values.every((x) => x != null && (lo == null || x >= lo) && (hi == null || x <= hi));
  if (careType === 'antenatal' && (rule.fromWeek != null || rule.toWeek != null)) {
    if (!within(dated.length ? dated.map((o) => o.weeks) : [facts.weeksNow], rule.fromWeek, rule.toWeek)) return false;
  }
  if (careType === 'newborn' && (rule.fromDay != null || rule.toDay != null)) {
    if (!within(dated.length ? dated.map((o) => o.ageDays) : [facts.ageDaysNow], rule.fromDay, rule.toDay)) return false;
  }
  return true;
}

const sourceKey = (o) => `${o.source}|${o.visitId ?? o.orderId ?? o.admissionId ?? ''}|${time(o.at ?? o.on)}`;
const sourceView = (o) => ({
  source: o.source,
  ...(o.source === 'chart' ? { at: o.at, admissionId: o.admissionId ?? null } : { on: o.on }),
  ...(o.source === 'visit' ? { visitId: o.visitId ?? null } : {}),
  ...(o.source === 'lab' ? { orderId: o.orderId ?? null } : {}),
});
// The hospital's day a value was recorded on
const originDay = (o) => (o.source === 'chart' ? toHospitalDate(o.at) : utcDay(o.on));

// Values from different places are joined by a rule only when they were recorded close together.
function recordedTogether(origins) {
  const days = origins.filter((o) => o && o.source !== 'today').map((o) => time(originDay(o)));
  return days.length < 2 || Math.max(...days) - Math.min(...days) <= RULE_VALUES_WITHIN_DAYS * DAY;
}

// One quantity measured at a visit and by the lab (SAME_QUANTITY): only the newer reading raises a flag – a lab Hb
// of 10.4 at booking is replaced by the visit's 11.8 eight weeks later, and a visit's by a newer lab report. Taken
// on the same day, both are checked. A reading is only replaced when the rules for this type of care check the
// newer one; otherwise nothing would look at either value.
function newestReadings(own, facts) {
  const checked = new Set(own.flatMap((r) => (r.conditions ?? []).map((c) => c.factor)));
  let out = facts;
  for (const [atVisit, inLab] of SAME_QUANTITY) {
    const a = facts.from?.[atVisit];
    const b = facts.from?.[inLab];
    if (facts[atVisit] == null || facts[inLab] == null || !a || !b) continue;
    const visitDay = time(originDay(a));
    const labDay = time(originDay(b));
    if (visitDay === labDay) continue;
    const [older, newer] = labDay > visitDay ? [atVisit, inLab] : [inLab, atVisit];
    if (!checked.has(newer)) continue;
    if (out === facts) out = { ...facts, from: { ...facts.from } };
    out[older] = null;
    delete out.from[older];
  }
  return out;
}

// The flags of one set of facts (the rules are those of the facts' type of care).
function flagsOf(own, careType, facts) {
  const flags = [];
  for (const rule of own) {
    const conditions = rule.conditions ?? [];
    const results = conditions.map((c) => checkCondition(c, facts));
    if (!results.length || !results.every((r) => r === true)) continue;
    const origins = conditions.map((c) => facts.from?.[c.factor] ?? null);
    if (!insideWindow(rule, careType, origins, facts)) continue;
    if (!recordedTogether(origins)) continue;
    const detail = [...new Set(conditions.map((c) => (BP_FACTORS.includes(c.factor) ? bpText(facts) : c.factor === 'weightBelowBirth' ? weightText(facts, c) : valueText(c.factor, facts[c.factor]))))]
      .filter(Boolean)
      .join(', ');
    const sources = [...new Map(origins.filter((o) => o && o.source !== 'today').map((o) => [sourceKey(o), sourceView(o)])).values()];
    flags.push({
      key: rule.key,
      label: rule.label,
      level: rule.level,
      message: rule.message,
      detail,
      rule: ruleText(rule),
      sources,
      bpOnly: conditions.every((c) => BP_FACTORS.includes(c.factor)),
      usesBp: conditions.some((c) => BP_FACTORS.includes(c.factor)),
    });
  }
  return mergeFlags(flags);
}

/**
 * The flags raised for a patient of the facts' type of care: every rule that applies to that type whose
 * conditions ALL hold (a rule with an unrecorded value is not raised), inside its weeks (or baby's age), with
 * values recorded within RULE_VALUES_WITHIN_DAYS days of each other. facts.also (a visit's vital signs that may
 * be newer than the nursing chart's) is checked as well, so the same rule can be raised by both readings.
 * Urgent first. Each flag: { key, label, level, message, detail, rule, sources } – detail: the values that
 * raised it; rule: the rule's checks in words; sources: where and when each value was recorded
 * ([{ source: 'visit', on, visitId } | { source: 'lab', on, orderId } | { source: 'chart', at, admissionId }]).
 */
export function evaluateRedFlags(rules, facts) {
  const careType = facts.careType ?? 'antenatal';
  const own = (rules ?? []).filter((r) => ruleCareTypes(r).includes(careType));
  const flags = [];
  const seen = new Set();
  for (const set of [facts, ...(facts.also ?? [])]) {
    for (const flag of flagsOf(own, careType, newestReadings(own, set))) {
      const id = `${flag.key}|${flag.detail}|${flag.sources.map(sourceKey).join(',')}`;
      if (seen.has(id)) continue;
      seen.add(id);
      flags.push(flag);
    }
  }
  return flags.sort((a, b) => (a.level === b.level ? 0 : a.level === 'urgent' ? -1 : 1));
}

// Blood pressure is one reading: "BP 150/96 mmHg", never systolic and diastolic on separate lines.
const BP_FACTORS = ['bpSystolic', 'bpDiastolic'];
function bpText(facts) {
  const { bpSystolic: s, bpDiastolic: d } = facts;
  if (s == null && d == null) return '';
  return `BP ${s ?? '–'}/${d ?? '–'} mmHg`;
}
// A baby's weight loss with the two weights it was worked out from. The per cent is shown to one decimal – or to
// two when one decimal would hide that the rule's limit was passed (10.03 % is "over 10 %", not "10 %").
function weightText(facts, condition) {
  if (facts.weightBelowBirth == null) return '';
  const raw = facts.weightBelowBirth;
  const shown = checkCondition(condition, { weightBelowBirth: round1(raw) }) === true ? round1(raw) : Math.round(raw * 100) / 100;
  return `Weight ${facts.weightKg} kg – ${shown} % below the birth weight of ${facts.birthWeightGrams} g`;
}
/**
 * One line per problem: the same flag raised by its systolic and its diastolic rule (same name and level) is
 * shown once, and a BP-only warning ("Raised blood pressure") is left out when an urgent flag already includes
 * the same reading ("Severe-range", "Possible pre-eclampsia").
 */
function mergeFlags(flags) {
  const out = [];
  for (const f of flags) {
    if (out.some((o) => o.label === f.label && o.level === f.level && o.detail === f.detail)) continue;
    out.push(f);
  }
  const urgentBp = out.some((f) => f.usesBp && f.level === 'urgent');
  return out.filter((f) => !(urgentBp && f.bpOnly && f.level !== 'urgent')).map(({ bpOnly, usesBp, ...f }) => f);
}

/** Where and when one value was recorded, in words: "the visit on 3 Oct 2026", "the lab result of 3 Oct 2026", "the nursing chart, 3 Oct 2026, 14:30", "her record, 3 Oct 2026". */
export function sourceText(s) {
  if (s.source === 'visit') return `the visit on ${dateWords(s.on)}`;
  if (s.source === 'lab') return `the lab result of ${dateWords(s.on)}`;
  if (s.source === 'chart') return `the nursing chart, ${dateWords(toHospitalDate(s.at))}, ${timeIn(new Date(s.at))}`;
  if (s.source === 'record') return `her record, ${dateWords(s.on)}`;
  return '';
}
/** "from the lab result of 3 Oct 2026" ('' for a flag worked out from today's date only). */
export function flagFromText(flag) {
  const parts = (flag.sources ?? []).map(sourceText).filter(Boolean);
  return parts.length ? `from ${parts.join(' and ')}` : '';
}
/** True for a flag whose values all come from lab results (no visit, no nursing chart). */
export const flagFromLabOnly = (flag) => (flag.sources ?? []).length > 0 && flag.sources.every((x) => x.source === 'lab');
/** The newest day a flag's values were recorded (the hospital's date; null for a flag from today's date only). */
export function flagLatestDay(flag) {
  const days = (flag.sources ?? []).map((s) => (s.source === 'chart' ? toHospitalDate(s.at) : utcDay(s.on))).filter(Boolean);
  return days.length ? new Date(Math.max(...days.map(time))) : null;
}

// ---------- Built-in DRAFT rules ----------
// Prepared from published guidance for the doctor to check – NOT a clinical review. Every threshold, the
// wording and the level are the doctor's decision; the rules can be edited and must be approved in the app.
const FOGSI_HDP = 'FOGSI GCPR Hypertensive disorders in pregnancy (2019); WHO recommendations for prevention and treatment of pre-eclampsia and eclampsia (2011); NICE NG133 (2019)';
const ANAEMIA = 'WHO haemoglobin thresholds (2011, 2024); MoHFW India Anemia Mukt Bharat guidelines (2018); FOGSI GCPR Anaemia in pregnancy';
const FETAL = 'RCOG Green-top 57 Reduced fetal movements; NICE NG229 / FIGO intrapartum fetal monitoring (normal FHR 110–160)';
const WHO_ANC = 'WHO recommendations on antenatal care for a positive pregnancy experience (2016); MoHFW India MCP card danger signs';
const n = (factor, op, value) => ({ factor, op, value });
const g = (factor, grade) => ({ factor, grade });
const ch = (factor, choices) => ({ factor, choices });
const NO_WINDOW = { fromWeek: null, toWeek: null, fromDay: null, toDay: null };
const forCare = (appliesTo, rules) => rules.map((r) => ({ ...NO_WINDOW, ...r, appliesTo }));

// Version 1 (30 Sep 2026): pregnancy care, from the values of the latest visit.
const ANTENATAL_VISIT_RULES = forCare(['antenatal'], [
  { key: 'bp_severe_sys', label: 'Severe-range blood pressure', level: 'urgent', conditions: [n('bpSystolic', 'gte', 160)],
    message: 'Recheck in 15 minutes. If it stays this high, treat urgently (e.g. labetalol / nifedipine as per protocol) and assess for severe pre-eclampsia, or refer.', source: FOGSI_HDP },
  { key: 'bp_severe_dia', label: 'Severe-range blood pressure', level: 'urgent', conditions: [n('bpDiastolic', 'gte', 110)],
    message: 'Recheck in 15 minutes. If it stays this high, treat urgently (e.g. labetalol / nifedipine as per protocol) and assess for severe pre-eclampsia, or refer.', source: FOGSI_HDP },
  { key: 'pe_sys', label: 'Possible pre-eclampsia', level: 'urgent', conditions: [n('bpSystolic', 'gte', 140), g('urineAlbumin', '1+')], fromWeek: 20,
    message: 'Raised BP with protein in the urine after 20 weeks. Assess the same day: symptoms (headache, visual change, epigastric pain), platelets, liver and kidney tests; plan monitoring or admission.', source: FOGSI_HDP },
  { key: 'pe_dia', label: 'Possible pre-eclampsia', level: 'urgent', conditions: [n('bpDiastolic', 'gte', 90), g('urineAlbumin', '1+')], fromWeek: 20,
    message: 'Raised BP with protein in the urine after 20 weeks. Assess the same day: symptoms (headache, visual change, epigastric pain), platelets, liver and kidney tests; plan monitoring or admission.', source: FOGSI_HDP },
  { key: 'htn_sys', label: 'Raised blood pressure', level: 'watch', conditions: [n('bpSystolic', 'gte', 140), n('bpSystolic', 'lt', 160)],
    message: 'BP 140/90 or more. Recheck after rest; if confirmed, check urine protein and follow up closely (gestational or chronic hypertension).', source: FOGSI_HDP },
  { key: 'htn_dia', label: 'Raised blood pressure', level: 'watch', conditions: [n('bpDiastolic', 'gte', 90), n('bpDiastolic', 'lt', 110)],
    message: 'BP 140/90 or more. Recheck after rest; if confirmed, check urine protein and follow up closely (gestational or chronic hypertension).', source: FOGSI_HDP },
  { key: 'hb_severe', label: 'Severe anaemia', level: 'urgent', conditions: [n('hb', 'lt', 7)],
    message: 'Hb below 7 g/dL. Needs urgent assessment and treatment in hospital (blood transfusion or IV iron as indicated); look for the cause.', source: ANAEMIA },
  { key: 'hb_moderate', label: 'Moderate anaemia', level: 'watch', conditions: [n('hb', 'gte', 7), n('hb', 'lt', 10)],
    message: 'Hb 7–9.9 g/dL. Start treatment-dose iron (consider IV iron, especially later in pregnancy or if oral iron is not tolerated) and recheck Hb.', source: ANAEMIA },
  { key: 'hb_mild', label: 'Mild anaemia', level: 'watch', conditions: [n('hb', 'gte', 10), n('hb', 'lt', 11)],
    message: 'Hb 10–10.9 g/dL. Treatment-dose oral iron and folic acid; recheck Hb in about 4 weeks.', source: ANAEMIA },
  { key: 'fm_reduced', label: 'Reduced or absent fetal movements', level: 'urgent', conditions: [ch('fetalMovements', ['reduced', 'absent'])], fromWeek: 28,
    message: 'Check the fetal heart now and arrange a CTG (and ultrasound if needed) the same day.', source: FETAL },
  { key: 'fhr_low', label: 'Slow fetal heart rate', level: 'urgent', conditions: [n('fetalHeartRate', 'lt', 110)],
    message: 'Fetal heart rate below 110/min. Recheck for a full minute and arrange CTG / urgent assessment.', source: FETAL },
  { key: 'fhr_high', label: 'Fast fetal heart rate', level: 'urgent', conditions: [n('fetalHeartRate', 'gt', 160)],
    message: 'Fetal heart rate above 160/min. Recheck for a full minute, check maternal temperature and pulse, and arrange CTG / urgent assessment.', source: FETAL },
  { key: 'spo2_low', label: 'Low oxygen saturation', level: 'urgent', conditions: [n('spo2', 'lt', 95)],
    message: 'SpO₂ below 95%. Recheck; assess breathing and arrange urgent medical review.', source: WHO_ANC },
  { key: 'fever', label: 'Fever', level: 'watch', conditions: [n('temperatureF', 'gte', 100.4)],
    message: 'Temperature 100.4 °F or more. Look for the cause (urine infection, malaria, dengue, respiratory infection, chorioamnionitis) and treat.', source: WHO_ANC },
  { key: 'pulse_high', label: 'Fast maternal pulse', level: 'watch', conditions: [n('pulse', 'gt', 110)],
    message: 'Pulse above 110/min. Look for anaemia, infection, bleeding, dehydration or heart disease.', source: WHO_ANC },
  { key: 'urine_sugar', label: 'Sugar in urine', level: 'watch', conditions: [g('urineSugar', '1+')],
    message: 'Arrange a blood glucose test (75 g OGTT, DIPSI) if not already done.', source: 'FOGSI GCPR Gestational diabetes mellitus (2018); MoHFW India National guidelines for diagnosis and management of GDM (2018)' },
  { key: 'oedema_marked', label: 'Marked oedema', level: 'watch', conditions: [g('oedema', 'moderate')], fromWeek: 20,
    message: 'Check BP and urine protein for pre-eclampsia.', source: FOGSI_HDP },
  { key: 'malpresentation', label: 'Not head-down at term', level: 'watch', conditions: [ch('presentation', ['breech', 'transverse', 'oblique'])], fromWeek: 36,
    message: 'Confirm by ultrasound and discuss options (external cephalic version or planned mode of delivery).', source: 'RCOG Green-top 20a/20b (breech); FOGSI GCPR' },
  { key: 'fundal_gap', label: 'Fundal height not matching the weeks', level: 'watch', conditions: [n('fundalHeightGap', 'gt', 3)], fromWeek: 24, toWeek: 40,
    message: 'Fundal height differs from the weeks by more than 3 cm. Consider a growth scan (growth restriction, too much or too little fluid, twins, or wrong dates).', source: 'RCOG Green-top 31 Small-for-gestational-age fetus; WHO ANC 2016 (symphysis-fundal height)' },
  { key: 'weight_gain', label: 'Sudden weight gain', level: 'watch', conditions: [n('weightGainPerWeek', 'gt', 1)], fromWeek: 20,
    message: 'More than 1 kg a week since the last weighed visit. Check BP, urine protein and oedema (fluid retention / pre-eclampsia).', source: FOGSI_HDP },
  { key: 'postdates', label: '41 weeks or more', level: 'urgent', conditions: [n('weeksToday', 'gte', 41)],
    message: 'Plan delivery (induction of labour) as per the hospital protocol if she has not delivered; check fetal wellbeing.', source: 'WHO recommendations for induction of labour (2011, 2022); FOGSI GCPR Induction of labour' },
]);

// Version 2 (4 Oct 2026). DRAFT, not reviewed by a doctor.
const PLATELETS = 'ACOG Practice Bulletin 207 Thrombocytopenia in pregnancy (2019); ACOG Practice Bulletin 222 Gestational hypertension and preeclampsia (2020); FOGSI GCPR Hypertensive disorders in pregnancy (2019)';
const DIPSI = 'MoHFW India National guidelines for diagnosis and management of GDM (2018, DIPSI test: 2-hour value 140 mg/dL or more); FOGSI GCPR Gestational diabetes mellitus (2018)';
const WHO_SUGAR = 'WHO Diagnostic criteria and classification of hyperglycaemia first detected in pregnancy (2013)';
const THYROID = 'American Thyroid Association guidelines for thyroid disease during pregnancy and the postpartum (2017); MoHFW India National guidelines for screening of hypothyroidism during pregnancy (2014)';
const PE_LAB_MESSAGE = 'Raised BP with protein in a lab urine test of the same week (within 7 days), after 20 weeks. Assess the same day: symptoms (headache, visual change, epigastric pain), platelets, liver and kidney tests; plan monitoring or admission.';

// Pregnancy care: lab results of this pregnancy.
const ANTENATAL_LAB_RULES = forCare(['antenatal'], [
  { key: 'lab_hb_severe', label: 'Severe anaemia', level: 'urgent', conditions: [n('labHb', 'lt', 7)],
    message: 'Hb below 7 g/dL. Needs urgent assessment and treatment in hospital (blood transfusion or IV iron as indicated); look for the cause.', source: ANAEMIA },
  { key: 'lab_hb_moderate', label: 'Moderate anaemia', level: 'watch', conditions: [n('labHb', 'gte', 7), n('labHb', 'lt', 10)],
    message: 'Hb 7–9.9 g/dL. Start treatment-dose iron (consider IV iron, especially later in pregnancy or if oral iron is not tolerated) and recheck Hb.', source: ANAEMIA },
  { key: 'lab_hb_mild', label: 'Mild anaemia', level: 'watch', conditions: [n('labHb', 'gte', 10), n('labHb', 'lt', 11)],
    message: 'Hb 10–10.9 g/dL. Treatment-dose oral iron and folic acid; recheck Hb in about 4 weeks.', source: ANAEMIA },
  { key: 'lab_platelets_mild', label: 'Platelets below normal', level: 'watch', conditions: [n('labPlatelets', 'gte', 1), n('labPlatelets', 'lt', 1.5)],
    message: 'Platelets 1–1.49 lakh/µL. Often gestational thrombocytopenia: check BP, repeat the count, and look for other causes if it falls.', source: PLATELETS },
  { key: 'lab_ogtt_gdm', label: 'Gestational diabetes range (OGTT)', level: 'watch', conditions: [n('labOgtt2h', 'gte', 140), n('labOgtt2h', 'lt', 200)],
    message: '2-hour glucose 140–199 mg/dL after 75 g glucose. Start diet advice and glucose monitoring as per the GDM protocol; treat if the targets are not met.', source: DIPSI },
  { key: 'lab_ogtt_diabetes', label: 'Diabetes range (OGTT)', level: 'urgent', conditions: [n('labOgtt2h', 'gte', 200)],
    message: '2-hour glucose 200 mg/dL or more after 75 g glucose: diabetes in pregnancy. Start treatment without delay and involve a physician.', source: `${WHO_SUGAR}; ${DIPSI}` },
  { key: 'lab_fbs_high', label: 'Raised fasting blood sugar', level: 'watch', conditions: [n('labFastingGlucose', 'gte', 92), n('labFastingGlucose', 'lt', 126)],
    message: 'Fasting glucose 92–125 mg/dL: gestational diabetes range. Confirm as per the hospital protocol (75 g test) and start diet advice.', source: `${WHO_SUGAR}; FOGSI GCPR Gestational diabetes mellitus (2018)` },
  { key: 'lab_fbs_diabetes', label: 'Diabetes range (fasting sugar)', level: 'urgent', conditions: [n('labFastingGlucose', 'gte', 126)],
    message: 'Fasting glucose 126 mg/dL or more: diabetes in pregnancy. Start treatment without delay and involve a physician.', source: WHO_SUGAR },
  { key: 'lab_rbs_high', label: 'Diabetes range (random sugar)', level: 'urgent', conditions: [n('labRandomGlucose', 'gte', 200)],
    message: 'Random glucose 200 mg/dL or more. Confirm with a fasting or 75 g test and start treatment; check urine ketones if she is unwell.', source: WHO_SUGAR },
  { key: 'lab_tsh_high', label: 'Raised TSH', level: 'watch', conditions: [n('labTsh', 'gt', 4)],
    message: 'TSH above 4 µIU/mL. Check free T4 (and TPO antibodies if available) and treat hypothyroidism as per guideline; TSH above 10 needs treatment whatever the free T4. The Government of India guideline uses lower limits (2.5 in the first trimester, 3 later) – use your own range if the hospital has one.', source: THYROID },
  { key: 'lab_tsh_low', label: 'Low TSH', level: 'watch', conditions: [n('labTsh', 'lt', 0.1)],
    message: 'TSH below 0.1 µIU/mL. Often normal in early pregnancy (hCG effect, severe vomiting): check free T4 and look for signs of thyrotoxicosis.', source: THYROID },
  { key: 'lab_urine_protein', label: 'Protein in urine (lab result)', level: 'watch', conditions: [g('labUrineAlbumin', '1+')], fromWeek: 20,
    message: 'Albumin 1+ or more in the lab urine test after 20 weeks. Check BP today for pre-eclampsia; rule out urine infection; consider a urine protein : creatinine ratio.', source: FOGSI_HDP },
  { key: 'pe_lab_sys', label: 'Possible pre-eclampsia', level: 'urgent', conditions: [n('bpSystolic', 'gte', 140), g('labUrineAlbumin', '1+')], fromWeek: 20, message: PE_LAB_MESSAGE, source: FOGSI_HDP },
  { key: 'pe_lab_dia', label: 'Possible pre-eclampsia', level: 'urgent', conditions: [n('bpDiastolic', 'gte', 90), g('labUrineAlbumin', '1+')], fromWeek: 20, message: PE_LAB_MESSAGE, source: FOGSI_HDP },
]);

// Pregnancy and after delivery: very low platelets (HELLP can begin after delivery).
const MOTHER_LAB_RULES = forCare(['antenatal', 'postnatal'], [
  { key: 'lab_platelets_low', label: 'Low platelets', level: 'urgent', conditions: [n('labPlatelets', 'lt', 1)],
    message: 'Platelets below 1 lakh/µL. Check BP and liver tests for HELLP or severe pre-eclampsia, repeat the count, and plan delivery, anaesthesia and bleeding risk with the physician.', source: PLATELETS },
]);

// After delivery (postnatal): the vital signs of a visit or, in hospital, of the nursing chart; Hb at a visit or from the lab.
const PN_BP = 'WHO recommendations on maternal and newborn care for a positive postnatal experience (2022); NICE NG133 Hypertension in pregnancy (2019), postnatal care; FOGSI GCPR Hypertensive disorders in pregnancy (2019)';
const PN_SEVERE_MESSAGE = 'BP 160/110 or more after delivery. Recheck in 15 minutes; if it stays this high, treat urgently as per protocol and assess for pre-eclampsia or eclampsia, which can begin after delivery.';
const PN_RAISED_MESSAGE = 'BP 140/90 or more after delivery. Recheck after rest; ask about headache, visual change and upper abdominal pain; check urine protein and follow up closely.';
const PN_HB_MESSAGE = 'Hb below 7 g/dL after delivery. Needs urgent assessment and treatment (blood transfusion or IV iron as indicated); look for continuing bleeding.';
const POSTNATAL_RULES = forCare(['postnatal'], [
  { key: 'pn_bp_severe_sys', label: 'Severe-range blood pressure after delivery', level: 'urgent', conditions: [n('bpSystolic', 'gte', 160)], message: PN_SEVERE_MESSAGE, source: PN_BP },
  { key: 'pn_bp_severe_dia', label: 'Severe-range blood pressure after delivery', level: 'urgent', conditions: [n('bpDiastolic', 'gte', 110)], message: PN_SEVERE_MESSAGE, source: PN_BP },
  { key: 'pn_bp_sys', label: 'Raised blood pressure after delivery', level: 'watch', conditions: [n('bpSystolic', 'gte', 140), n('bpSystolic', 'lt', 160)], message: PN_RAISED_MESSAGE, source: PN_BP },
  { key: 'pn_bp_dia', label: 'Raised blood pressure after delivery', level: 'watch', conditions: [n('bpDiastolic', 'gte', 90), n('bpDiastolic', 'lt', 110)], message: PN_RAISED_MESSAGE, source: PN_BP },
  { key: 'pn_fever', label: 'Fever after delivery', level: 'urgent', conditions: [n('temperatureF', 'gte', 100.4)],
    message: 'Temperature 100.4 °F (38 °C) or more after delivery. Look for infection – uterus, wound or perineum, breast, urine, chest – and for sepsis; treat or refer the same day.',
    source: 'WHO recommendations for prevention and treatment of maternal peripartum infections (2015); WHO postnatal care recommendations (2022); MoHFW India SBA guidelines (danger signs after delivery)' },
  { key: 'pn_pulse_high', label: 'Fast pulse after delivery', level: 'urgent', conditions: [n('pulse', 'gt', 110)],
    message: 'Pulse above 110/min after delivery. Check BP, bleeding, the uterus, temperature and Hb: a fast pulse can be the first sign of blood loss or infection.',
    source: 'WHO Managing complications in pregnancy and childbirth (2nd edition, 2017): a fast pulse (110/min or more) is a sign of shock – this draft rule is raised over 110, like the pregnancy rule; change it to "at least 110" to follow WHO exactly. WHO postnatal care recommendations (2022)' },
  { key: 'pn_hb_severe', label: 'Severe anaemia after delivery', level: 'urgent', conditions: [n('hb', 'lt', 7)], message: PN_HB_MESSAGE, source: ANAEMIA },
  { key: 'pn_lab_hb_severe', label: 'Severe anaemia after delivery', level: 'urgent', conditions: [n('labHb', 'lt', 7)], message: PN_HB_MESSAGE, source: ANAEMIA },
]);

// Newborn care. Temperature: 97.7 °F = 36.5 °C, 99.5 °F = 37.5 °C, 95.9 °F = 35.5 °C; "over 99.5 °F" follows WHO's
// normal range (IMNCI counts 37.5 °C itself as fever – the source text of the rules says so). Bilirubin: the NICE CG98
// treatment thresholds for babies born at 38 weeks or later, at the START of each day of life (100, 200, 250,
// 300, 350 µmol/L at 0, 24, 48, 72 and 96 hours = 5.8, 11.7, 14.6, 17.5, 20.5 mg/dL), so a value on a later hour
// of the day is flagged early rather than late. The record does not hold the weeks at birth: a baby born earlier
// needs treatment at lower values, which these rules do not know. Skin (transcutaneous) bilirubin is not checked.
const NB_TEMP = 'WHO Thermal protection of the newborn: a practical guide (1997) – normal 36.5–37.5 °C, so a temperature above 37.5 °C is raised; MoHFW India IMNCI and Facility Based Newborn Care – below 35.5 °C is a danger sign. IMNCI counts 37.5 °C itself as fever: change "over 99.5" to "at least 99.5" to follow IMNCI exactly';
const NB_BILI = 'NICE CG98 Jaundice in newborn babies under 28 days (2010, updated 2023): treatment threshold table for babies of 38 weeks or more (100, 200, 250, 300 and 350 µmol/L at 0, 24, 48, 72 and 96 hours of age); hour-specific charts: AAP 2022, NNF India';
const biliMessage = (value, when) =>
  `Total bilirubin above ${value} mg/dL ${when}. This is the NICE line for starting phototherapy at the start of that day, for a baby born at 38 weeks or later. Plot the value on the hour-specific chart now and treat if it is above the line. A baby born before 38 weeks, or with risk factors, needs treatment at lower values, which this rule does not check.`;
const bili = (key, value, fromDay, toDay, when) => ({ key, label: "High bilirubin for the baby's age", level: 'urgent', conditions: [n('labBilirubinTotal', 'gt', value)], fromDay, toDay, message: biliMessage(value, when), source: NB_BILI });
const NEWBORN_RULES = forCare(['newborn'], [
  { key: 'nb_temp_very_low', label: 'Very low temperature (baby)', level: 'urgent', conditions: [n('temperatureF', 'lt', 95.9)],
    message: 'Temperature below 95.9 °F (35.5 °C). Rewarm now and assess for serious infection and low blood sugar; admit or refer.', source: NB_TEMP },
  { key: 'nb_temp_low', label: 'Low temperature (baby)', level: 'watch', conditions: [n('temperatureF', 'gte', 95.9), n('temperatureF', 'lt', 97.7)],
    message: 'Temperature below 97.7 °F (36.5 °C). Warm the baby – skin-to-skin, cap, warm room – and recheck within an hour; check feeding and blood sugar.', source: NB_TEMP },
  { key: 'nb_temp_high', label: 'High temperature (baby)', level: 'urgent', conditions: [n('temperatureF', 'gt', 99.5)],
    message: 'Temperature above 99.5 °F (37.5 °C). Check for over-wrapping and measure again; if it stays high, assess for infection the same day – fever in a young baby is a danger sign.', source: NB_TEMP },
  { key: 'nb_weight_loss', label: 'Weight more than 10 % below birth weight', level: 'urgent', conditions: [n('weightBelowBirth', 'gt', 10)],
    message: 'Assess the baby for dehydration, jaundice and illness, watch a feed and support feeding; recheck the weight in 24–48 hours.',
    source: 'NICE NG75 Faltering growth (2017), recommendation 1.1.2; MoHFW India Facility Based Newborn Care (weight loss in the first week up to 10 % of the birth weight)' },
  bili('nb_bili_day0', 5.8, 0, 0, 'in the first 24 hours of life'),
  bili('nb_bili_day1', 11.7, 1, 1, 'at 24–47 hours of age'),
  bili('nb_bili_day2', 14.6, 2, 2, 'at 48–71 hours of age'),
  bili('nb_bili_day3', 17.5, 3, 3, 'at 72–95 hours of age'),
  bili('nb_bili_day4', 20.5, 4, null, 'at 96 hours of age or later'),
  { key: 'nb_bili_direct', label: 'Raised direct bilirubin (baby)', level: 'watch', conditions: [n('labBilirubinDirect', 'gt', 1)],
    message: 'Direct (conjugated) bilirubin above 1.0 mg/dL. Conjugated jaundice is never normal: ask about pale stools and dark urine and arrange evaluation for cholestasis (for example biliary atresia) without delay.',
    source: 'NASPGHAN / ESPGHAN guideline for the evaluation of cholestatic jaundice in infants (2017): direct bilirubin above 1.0 mg/dL is abnormal' },
  { key: 'nb_lab_sugar_low', label: 'Low blood sugar (baby)', level: 'urgent', conditions: [n('labBabyGlucose', 'lt', 45)],
    message: 'Blood glucose below 45 mg/dL. Feed now and recheck in 30–60 minutes as per the hospital protocol; a baby with symptoms or a very low value needs IV glucose.',
    source: 'NNF India Clinical Practice Guidelines: Management of neonatal hypoglycaemia (2010) – operational threshold: plasma glucose below 45 mg/dL' },
]);

// Version 3 (5 Oct 2026). Pregnancy-loss care (the Abortion type of care: a miscarriage, an ectopic or a molar
// pregnancy). DRAFT, not reviewed by a doctor. Each message says what to consider and names its source, because the
// flag shows the message. The vital signs are those of her latest visit or, in hospital, of the nursing chart; the
// location and the ticks are on her record. Pulse "over 110" follows the other built-in rules (WHO counts 110 itself
// as a sign of shock: change it to "at least 110" to follow WHO exactly).
const SHOCK = 'WHO Managing complications in pregnancy and childbirth (2nd edition, 2017): a fast pulse (110/min or more) and systolic BP below 90 mmHg are signs of shock';
const ECTOPIC = `NICE NG126 Ectopic pregnancy and miscarriage (2019, updated 2023); RCOG Green-top Guideline 21 Diagnosis and management of ectopic pregnancy (2016); ${SHOCK}`;
const ECTOPIC_DO = 'Consider a ruptured ectopic pregnancy with bleeding inside the abdomen. Assess now: pain, pallor, abdominal tenderness, shoulder-tip pain; two IV lines, blood for cross-match, and surgery without delay if she is unstable. A miscarriage with heavy bleeding can look the same. (NICE NG126; RCOG GTG 21)';
const SEPSIS = 'WHO Managing complications in pregnancy and childbirth (2nd edition, 2017): septic abortion; RCOG Green-top Guideline 64a Bacterial sepsis in pregnancy (2012); FOGSI';
const SEPSIS_DO = 'Consider a septic abortion (infection of the uterus). Assess now: BP, breathing, abdominal and uterine tenderness, the discharge; start broad-spectrum IV antibiotics and fluids without delay and plan to empty the uterus if tissue remains. (WHO MCPC 2017; RCOG GTG 64a)';
const LOSS_BLEEDING = `NICE NG126 Ectopic pregnancy and miscarriage (2019, updated 2023); ${SHOCK}`;
const LOSS_HB_MESSAGE = 'Hb below 7 g/dL. Needs urgent assessment and treatment (blood transfusion or IV iron as indicated); look for continuing bleeding. (WHO haemoglobin thresholds; Anemia Mukt Bharat)';
const LOCATED = ch('lossLocation', ['ectopic', 'unknown']);
const LOSS_RULES = forCare(['abortion'], [
  { key: 'loss_ectopic_pulse', label: 'Possible ruptured ectopic pregnancy', level: 'urgent', conditions: [LOCATED, n('pulse', 'gt', 110)],
    message: `An ectopic pregnancy, or a pregnancy not yet located, with a pulse over 110/min. ${ECTOPIC_DO}`, source: ECTOPIC },
  { key: 'loss_ectopic_bp', label: 'Possible ruptured ectopic pregnancy', level: 'urgent', conditions: [LOCATED, n('bpSystolic', 'lt', 90)],
    message: `An ectopic pregnancy, or a pregnancy not yet located, with systolic BP below 90 mmHg. ${ECTOPIC_DO}`, source: ECTOPIC },
  { key: 'loss_rupture_signs', label: 'Possible ruptured ectopic pregnancy', level: 'urgent', conditions: [ch('lossRuptureSigns', ['yes'])],
    message: `Signs of rupture are recorded on her record. ${ECTOPIC_DO}`, source: ECTOPIC },
  { key: 'loss_sepsis_vitals', label: 'Possible septic abortion', level: 'urgent', conditions: [n('temperatureF', 'gte', 100.4), n('pulse', 'gt', 110)],
    message: `Temperature 100.4 °F (38 °C) or more with a pulse over 110/min after a pregnancy loss. ${SEPSIS_DO}`, source: SEPSIS },
  { key: 'loss_sepsis_signs', label: 'Possible septic abortion', level: 'urgent', conditions: [ch('lossFeverDischarge', ['yes'])],
    message: `Fever with foul-smelling discharge is recorded on her record. ${SEPSIS_DO}`, source: SEPSIS },
  { key: 'loss_bleeding_heavy', label: 'Heavy bleeding', level: 'urgent', conditions: [ch('lossBleeding', ['heavy'])],
    message: 'Heavy bleeding is recorded on her record. Check pulse, BP and Hb now; look for tissue left in the uterus or at the cervix; resuscitate, and arrange evacuation or surgery as needed. (NICE NG126; WHO MCPC 2017)', source: LOSS_BLEEDING },
  { key: 'loss_hb_severe', label: 'Severe anaemia after pregnancy loss', level: 'urgent', conditions: [n('hb', 'lt', 7)], message: LOSS_HB_MESSAGE, source: ANAEMIA },
  { key: 'loss_lab_hb_severe', label: 'Severe anaemia after pregnancy loss', level: 'urgent', conditions: [n('labHb', 'lt', 7)], message: LOSS_HB_MESSAGE, source: ANAEMIA },
]);

const V2_RULES = [...ANTENATAL_LAB_RULES, ...MOTHER_LAB_RULES, ...POSTNATAL_RULES, ...NEWBORN_RULES];
const V3_RULES = [...LOSS_RULES];
export const BUILT_IN_RED_FLAG_RULES = [...ANTENATAL_VISIT_RULES, ...V2_RULES, ...V3_RULES];
// The built-in version each rule came with (rules not listed: version 1). A rule set a doctor approved or changed
// is offered the rules of later versions; it is never given them by itself.
export const BUILT_IN_SINCE = { ...Object.fromEntries(V2_RULES.map((r) => [r.key, 2])), ...Object.fromEntries(V3_RULES.map((r) => [r.key, 3])) };

// What the rules can't see: shown with every list of flags so nobody relies on it alone.
export const RED_FLAGS_NOT_CHECKED =
  "Not checked automatically: symptoms written as text (bleeding, leaking, headache, blurred vision, abdominal pain, fits, breathlessness, a baby feeding poorly), scan findings (in pregnancy-loss care only the ticks on her record are checked: signs of rupture, heavy bleeding, fever with foul-smelling discharge, and a pregnancy not seen in the uterus), lab results written in words, only attached as a file, typed in a different unit from the one shown, or with no rule (for example HIV, HBsAg, cultures, liver and kidney tests, beta hCG), vital signs with no rule for the patient's type of care (for example SpO₂ after delivery or for a baby), a baby's skin bilirubin, and the lower bilirubin limits of a baby born early. Doctors must still assess these.";
