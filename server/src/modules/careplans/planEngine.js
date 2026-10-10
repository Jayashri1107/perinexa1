// The care-plan engine (the core of Perinexa's careplans/planEngine.js and careplans/risk.js). PURE – no database; the
// day is passed in. Dates are days at midnight UTC.
//
// Week 0 of a plan: for pregnancy, the day the pregnancy is counted from (EDD − 280 days); for a newborn, the day of
// birth; for every other care, the day the plan was started (or the day chosen). An item is due
//  - at booking: from the day the plan starts, for two weeks;
//  - in a window of weeks (fromWeek–toWeek) after week 0;
//  - some weeks after another item was done;
//  - on a fixed date (an item the doctor added).
// Whether an item applies (appliesWhen): always; Rh negative and high risk are worked out from the record and the risk
// level; anything perinexa1 does not record yet is "doctor decides" – never counted as overdue.
// Decision support only: the doctor decides. No fetal-sex field anywhere (PC-PNDT).
const DAY = 86400000;
export const utcDay = (d) => new Date(Math.floor(new Date(d).getTime() / DAY) * DAY);
export const addDays = (d, n) => new Date(utcDay(d).getTime() + n * DAY);
const iso = (d) => (d ? utcDay(d).toISOString().slice(0, 10) : null);

// ---------- Week 0 ----------

export function weekZero(patient, careType, { startOn = null, eddDays = 280 } = {}) {
  if (careType === 'antenatal') return patient.edd ? addDays(patient.edd, -eddDays) : null;
  if (careType === 'newborn' && patient.birthDate && !patient.birthDateApprox) return utcDay(patient.birthDate);
  return startOn ? utcDay(startOn) : null;
}

// ---------- Risk (antenatal) ----------

const OPS = { lt: (a, b) => a < b, lte: (a, b) => a <= b, gt: (a, b) => a > b, gte: (a, b) => a >= b, eq: (a, b) => a === b };
const NEEDS = {
  age: 'Age',
  heightCm: 'Height (at a visit)',
  weightKg: 'Weight (at a visit)',
  bmi: 'Height and weight (at a visit)',
  gravida: 'Gravida (G)',
  para: 'Para (P)',
  rhNegative: 'Blood group',
  lowestHb: 'Haemoglobin (a visit or a reviewed lab result)',
  bpSystolic: 'Blood pressure (at a visit)',
  bpDiastolic: 'Blood pressure (at a visit)',
};

// The facts the risk rules can check, from the record, her visits and her reviewed lab results.
export function riskFacts(patient, { visits = [], labHbs = [], today }) {
  const ageYears = patient.birthDate ? Math.floor((utcDay(today) - utcDay(patient.birthDate)) / (365.25 * DAY)) : null;
  const latest = (field) => visits.find((v) => v.vitals?.[field] != null)?.vitals[field] ?? null;
  const heightCm = latest('heightCm');
  const weightKg = latest('weightKg');
  const bpVisit = visits.find((v) => v.vitals?.bpSystolic != null);
  const hbs = [...visits.map((v) => v.vitals?.hb).filter((x) => x != null), ...labHbs];
  return {
    age: ageYears,
    heightCm,
    weightKg,
    bmi: heightCm && weightKg ? Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10 : null,
    gravida: patient.gravida ?? null,
    para: patient.para ?? null,
    rhNegative: patient.bloodGroup ? patient.bloodGroup.endsWith('-') : null,
    lowestHb: hbs.length ? Math.min(...hbs) : null,
    bpSystolic: bpVisit?.vitals.bpSystolic ?? null,
    bpDiastolic: bpVisit?.vitals.bpDiastolic ?? null,
  };
}

/**
 * The risk level from the approved rules: { level: high|moderate|low|incomplete, reasons: [label], missing: [what to
 * record], notChecked: [labels of rules on things perinexa1 does not record yet – the doctor assesses them] }.
 * "low" only when every rule could be checked; otherwise "incomplete" – missing information never reads as low.
 */
export function assessRisk(rules, facts) {
  const reasons = [];
  const missing = new Set();
  const notChecked = [];
  let level = null;
  for (const r of rules) {
    if (r.active === false) continue;
    let met;
    if (r.factor === 'rhNegative') met = facts.rhNegative;
    else if (r.op && r.factor in NEEDS) met = facts[r.factor] == null ? null : OPS[r.op]?.(facts[r.factor], r.value);
    else {
      notChecked.push(r.label);
      continue;
    }
    if (met == null) {
      missing.add(NEEDS[r.factor]);
      continue;
    }
    if (met) {
      reasons.push({ label: r.label, level: r.level });
      if (r.level === 'high') level = 'high';
      else if (!level) level = 'moderate';
    }
  }
  return { level: level ?? (missing.size ? 'incomplete' : 'low'), reasons, missing: [...missing], notChecked };
}

export const effectiveRisk = (risk) => risk?.override?.level ?? risk?.level ?? null;

// ---------- Items ----------

// Does an item apply? 'yes' | 'no' | 'unknown' (doctor decides).
export function applies(item, { patient, riskLevel }) {
  const w = item.appliesWhen;
  if (!w || w === 'always') return 'yes';
  if (item.forceInclude) return 'yes';
  if (w === 'rh_negative') return patient.bloodGroup ? (patient.bloodGroup.endsWith('-') ? 'yes' : 'no') : 'unknown';
  if (w === 'high_risk') return riskLevel === 'high' ? 'yes' : riskLevel === 'low' || riskLevel === 'moderate' ? 'no' : 'unknown';
  return 'unknown';
}

// The window of an item: { from, to } (days), or null when it cannot be told yet.
export function windowOf(item, plan, byKey) {
  if (item.date) return { from: utcDay(item.date), to: utcDay(item.dateBy ?? item.date) };
  if (item.atBooking) return { from: utcDay(plan.bookedOn), to: addDays(plan.bookedOn, 14) };
  if (item.after?.key) {
    const anchor = byKey.get(item.after.key);
    return anchor?.state === 'done' && anchor.done?.on ? { from: addDays(anchor.done.on, item.after.weeks * 7), to: addDays(anchor.done.on, item.after.weeks * 7 + 13) } : null;
  }
  if (item.fromWeek != null && plan.weekZero) {
    return { from: addDays(plan.weekZero, item.fromWeek * 7), to: addDays(plan.weekZero, ((item.toWeek ?? item.fromWeek) + 1) * 7 - 1) };
  }
  return null;
}

/**
 * Each item with its status today: done | not_needed | not_applicable | decide (only-when not known: doctor decides) |
 * overdue | due | upcoming | waiting (its window cannot be told yet).
 */
export function itemStatuses(plan, { patient, today }) {
  const byKey = new Map(plan.items.map((i) => [i.key, i]));
  const riskLevel = effectiveRisk(plan.risk);
  const day = utcDay(today);
  return plan.items.map((item) => {
    const win = windowOf(item, plan, byKey);
    let status;
    if (item.state === 'done') status = 'done';
    else if (item.state === 'not_needed') status = 'not_needed';
    else {
      const a = applies(item, { patient, riskLevel });
      if (a === 'no') status = 'not_applicable';
      else if (a === 'unknown') status = 'decide';
      else if (!win) status = 'waiting';
      else if (win.to < day) status = 'overdue';
      else if (win.from <= day) status = 'due';
      else status = 'upcoming';
    }
    return { item, status, window: win ? { from: iso(win.from), to: iso(win.to) } : null };
  });
}

export const OPEN_STATUSES = ['overdue', 'due'];
