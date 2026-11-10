// The hospital's lab set-up (docs/LAB_LIMS_PLAN.md): departments, turnaround times, sample numbers, sample
// rejection reasons, the hospital's test list (built-in tests as the hospital changed them, plus its own tests) and
// the usual range that applies to one patient.
import { CONFIDENTIAL_NAME, CONFIDENTIAL_TESTS } from '../billing/billingRules.js';
import { gaOn, hospitalToday } from '../careplans/dates.js';
import { eddInUse } from '../patients/pregnancyFindings.js';
import { nextNumber } from '../models/Counter.js';
import { LabSetup } from '../models/LabSetup.js';
import { LabTestSetting } from '../models/LabTestSetting.js';
import { currentAge } from '../models/Patient.js';
import { LAB_GROUPS, LAB_TESTS, OTHER_TEST, labNumber } from './labTests.js';

// ---------- Departments and turnaround times (workflow, not clinical) ----------

export const DEPARTMENTS = {
  haematology: 'Haematology',
  biochemistry: 'Biochemistry',
  serology: 'Serology',
  immunoassay: 'Hormones and immunoassay',
  clinical: 'Clinical pathology',
  microbiology: 'Microbiology',
  cytology: 'Cytology and histopathology',
  bedside: 'Bedside tests',
  other: 'Other',
};
export const DEPARTMENT_KEYS = Object.keys(DEPARTMENTS);

const GROUP_DEPARTMENT = {
  blood: 'haematology',
  screening: 'serology',
  sugar: 'biochemistry',
  chemistry: 'biochemistry',
  hormones: 'immunoassay',
  antibodies: 'immunoassay',
  urine: 'clinical',
  other: 'clinical',
  nb_blood: 'biochemistry',
  nb_infection: 'microbiology',
  nb_screening: 'other',
  nb_bedside: 'bedside',
};
const KEY_DEPARTMENT = {
  urineCulture: 'microbiology',
  hvsCulture: 'microbiology',
  histopath: 'cytology',
  pap: 'cytology',
  nb_cbc: 'haematology',
  nb_group_dct: 'haematology',
  nb_g6pd: 'haematology',
  nb_tsh: 'immunoassay',
  nb_sepsis: 'haematology',
};
/** The department a built-in test belongs to when the hospital has not changed it. */
export const builtInDepartment = (test) => KEY_DEPARTMENT[test.key] ?? GROUP_DEPARTMENT[test.group] ?? 'other';

// Usual turnaround times in hours, from the order to the report (the hospital changes them per test). Cultures and
// smears take days whatever the urgency.
const SLOW = { microbiology: 72, cytology: 120 };
export const ROUTINE_TAT = 24;
export const URGENT_TAT = 4;
export const defaultTat = (department) => SLOW[department] ?? ROUTINE_TAT;
export const defaultUrgentTat = (department) => SLOW[department] ?? URGENT_TAT;

/** The time an order is due: the order time plus the longest turnaround time of its tests. */
export function dueAt(orderedAt, tests, urgent) {
  const hours = Math.max(...tests.map((t) => (urgent ? t.urgentTatHours : t.tatHours)).filter((h) => h > 0), 1);
  return new Date(new Date(orderedAt).getTime() + hours * 3600 * 1000);
}

// ---------- Sample numbers ----------

/** "261017-0003": the hospital's date and the day's count – printed with a barcode on the sample labels. */
export async function nextSampleNo(tenantId, now = new Date()) {
  const day = hospitalToday(now).toISOString().slice(2, 10).replace(/-/g, '');
  const n = await nextNumber(tenantId, `lab-sample-${day}`);
  return `${day}-${String(n).padStart(4, '0')}`;
}

/** Gives an older order (made before sample numbers) its number. Returns whether it was given now. */
export async function ensureSampleNo(order, now) {
  if (order.sampleNo) return false;
  order.sampleNo = await nextSampleNo(order.tenantId, now);
  return true;
}

// Why the lab refuses a sample. The order goes back to "Samples to take" (a new sample is needed).
export const REJECT_REASONS = {
  haemolysed: 'Haemolysed',
  clotted: 'Clotted',
  insufficient: 'Too little sample',
  container: 'Wrong container or tube',
  label: 'Not labelled or wrongly labelled',
  leaked: 'Leaked or broken in transport',
  delayed: 'Arrived too late to test',
  other: 'Other',
};

// ---------- Confidential tests (the neutral name) ----------

export const isConfidential = (key) => CONFIDENTIAL_TESTS.includes(key);
/** A test's name where others may see it (labels, the register, a printed report): the neutral name for HIV. */
export const shownName = (test) => (isConfidential(test.key) ? CONFIDENTIAL_NAME : test.name);

// ---------- Usual ranges for one patient ----------

// The patient's own sex: a baby's as recorded after birth, an adult's as the lab recorded it at a walk-in registration
// (every other adult in Perinexa is a women's-care patient). Never a fetus's (PCPNDT).
export const BAND_SEX = ['', 'female', 'male'];
// 'postnatal': after delivery (postnatal care) - P4 of docs/LAB_BUILD_NOTE.md
export const BAND_PREGNANT = ['', 'yes', 'no', 'postnatal'];
export const AGE_UNITS = ['years', 'days'];

/**
 * What decides which range applies to a patient: age in years (adults) or days of life (a baby), the patient's sex
 * (a baby's recorded after birth; an adult's recorded by the lab for a walk-in, else female – Perinexa's adults are
 * women's-care patients), whether she is pregnant (antenatal care) and her weeks from the EDD in use, or after
 * delivery (postnatal care). now: the time of the SAMPLE (P4 – a result is judged as she was when it was taken, also
 * when it is typed or changed later).
 */
export function rangeContext(patient, now = new Date()) {
  const baby = patient.careType === 'newborn';
  let ageDays = null;
  if (baby && patient.newborn?.birthAt) ageDays = Math.max(0, Math.round((hospitalToday(now) - hospitalToday(new Date(patient.newborn.birthAt))) / 86400000));
  return {
    baby,
    ageYears: baby ? 0 : currentAge(patient, now),
    ageDays,
    sex: baby ? (['female', 'male'].includes(patient.newborn?.sex) ? patient.newborn.sex : '') : patient.sex === 'male' ? 'male' : 'female',
    pregnant: patient.careType === 'antenatal',
    postnatal: patient.careType === 'postnatal',
    // Weeks of pregnancy on the sample's day (null without an EDD: a range by weeks then does not apply)
    weeks: patient.careType === 'antenatal' ? (gaOnSample(patient, now)?.weeks ?? null) : null,
  };
}
function gaOnSample(patient, at) {
  const edd = eddInUse(patient);
  return edd ? gaOn(edd, hospitalToday(at)) : null;
}

const inAge = (band, ctx) => {
  if (band.fromAge == null && band.toAge == null) return true;
  const age = band.ageUnit === 'days' ? ctx.ageDays : ctx.ageYears;
  if (age == null) return false;
  return (band.fromAge == null || age >= band.fromAge) && (band.toAge == null || age <= band.toAge);
};
/** Whether a group range applies to this patient (every condition it sets must hold). */
export function bandFits(band, ctx) {
  if (!ctx) return false;
  if (band.sex && band.sex !== ctx.sex) return false;
  if (band.pregnant === 'yes' && !ctx.pregnant) return false;
  if (band.pregnant === 'no' && ctx.pregnant) return false;
  if (band.pregnant === 'postnatal' && !ctx.postnatal) return false;
  if (band.pregnant === 'yes' && (band.fromWeeks != null || band.toWeeks != null)) {
    if (ctx.weeks == null) return false;
    if ((band.fromWeeks != null && ctx.weeks < band.fromWeeks) || (band.toWeeks != null && ctx.weeks > band.toWeeks)) return false;
  }
  return inAge(band, ctx);
}

export function rangeText(low, high, unit) {
  if (low != null && high != null) return `${low}–${high} ${unit ?? ''}`.trim();
  if (high != null) return `up to ${high} ${unit ?? ''}`.trim();
  if (low != null) return `${low} ${unit ?? ''} or more`.trim();
  return '';
}

/**
 * "Pregnant, 14–27 weeks, 18–45 years" – who a group range is for. baby: a baby's test (a girl or a boy, not women
 * or men). weeks: false leaves the weeks out (the words the lab sees and the report prints - need-to-know).
 */
export function bandWho(band, baby = false, { weeks = true } = {}) {
  const parts = [];
  if (band.pregnant === 'yes') parts.push(weeks ? `pregnant${weeksWords(band)}` : 'pregnant');
  if (band.pregnant === 'no') parts.push('not pregnant');
  if (band.pregnant === 'postnatal') parts.push('after delivery');
  if (band.sex) parts.push(baby ? (band.sex === 'female' ? 'baby girl' : 'baby boy') : band.sex === 'female' ? 'women' : 'men');
  if (band.fromAge != null || band.toAge != null) {
    const u = band.ageUnit === 'days' ? 'days of life' : 'years';
    if (band.fromAge != null && band.toAge != null) parts.push(`${band.fromAge}–${band.toAge} ${u}`);
    else if (band.fromAge != null) parts.push(`${band.fromAge} ${u} or more`);
    else parts.push(`up to ${band.toAge} ${u}`);
  }
  const text = parts.join(', ');
  return text ? text[0].toUpperCase() + text.slice(1) : 'Everyone';
}

/**
 * Whether a number value is critical (P5 - docs/LAB_BUILD_NOTE.md): at or below the hospital's low critical limit, or
 * at or above its high one. The limits are about the number alone (not her weeks or record), so the lab may see them.
 */
export function isCritical(field, value) {
  if (field?.type !== 'number' || value === '' || value == null) return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return (field.criticalLow != null && n <= field.criticalLow) || (field.criticalHigh != null && n >= field.criticalHigh);
}

function weeksWords(band) {
  if (band.fromWeeks != null && band.toWeeks != null) return `, ${band.fromWeeks}–${band.toWeeks} weeks`;
  if (band.fromWeeks != null) return `, from ${band.fromWeeks} weeks`;
  if (band.toWeeks != null) return `, up to ${band.toWeeks} weeks`;
  return '';
}

/**
 * A number field as it applies to this patient: the first group range that fits, else the field's own range.
 * range: the words printed and shown to the lab (no weeks); band: who the range is for, with the weeks (clinical
 * users only - lab/labSetup.js catalogueView and routes/lab.js leave it out for the lab).
 */
export function fieldFor(field, ctx) {
  if (field.type !== 'number') return field;
  const band = (field.bands ?? []).find((b) => bandFits(b, ctx));
  if (!band) return field;
  const who = bandWho(band, ctx?.baby);
  const shown = bandWho(band, ctx?.baby, { weeks: false });
  return { ...field, low: band.low ?? null, high: band.high ?? null, range: band.range || `${rangeText(band.low, band.high, field.unit)} (${shown.toLowerCase()})`, band: who };
}

// ---------- The hospital's test list ----------

// Report templates (docs/LAB_TEMPLATES_PLAN.md): how a test prints – a table of values (with sections), a serology
// line with method, a culture with its sensitivity table, or paragraphs (histopathology, Pap smear).
export const TEMPLATES = { table: 'Table of values', serology: 'Serology (result and method)', culture: 'Culture and sensitivity', narrative: 'Paragraphs (histopathology, cytology)' };
export const TEMPLATE_KEYS = Object.keys(TEMPLATES);
export const SENSITIVITY = ['S', 'I', 'R']; // Sensitive, Intermediate, Resistant

/** A test's report settings: the built-in (or empty) ones with the hospital's changes over them. */
function reportOf(base, changed) {
  const b = base ?? {};
  const c = changed ?? {};
  const pick = (k, d) => (c[k] !== undefined && c[k] !== null ? c[k] : (b[k] ?? d));
  return { template: pick('template', 'table'), method: pick('method', ''), notes: pick('notes', ''), ownPage: Boolean(pick('ownPage', false)) };
}

/** A built-in test as this hospital set it up (s: its LabTestSetting, or none). */
function builtInAsSet(t, s) {
  const department = s?.department || builtInDepartment(t);
  const ranges = s?.fieldRanges ?? {};
  const fields = t.fields.map((f) => {
    const r = ranges[f.key];
    // The built-in group ranges (men) stay until the hospital sets its own (an empty list removes them)
    // Critical limits (P5): none built in - the hospital's own, set and approved like a range (LAB_BUILD_NOTE section 7)
    if (!r || f.type !== 'number') return { ...f, bands: f.type === 'number' ? (f.bands ?? []) : [], deltaPercent: null, criticalLow: null, criticalHigh: null };
    const changed = r.low !== undefined || r.high !== undefined;
    const low = r.low !== undefined ? r.low : f.low;
    const high = r.high !== undefined ? r.high : f.high;
    return { ...f, low, high, range: r.range || (changed ? rangeText(low, high, f.unit) : f.range), bands: r.bands !== undefined ? r.bands : (f.bands ?? []), deltaPercent: r.deltaPercent ?? null, criticalLow: r.criticalLow ?? null, criticalHigh: r.criticalHigh ?? null };
  });
  return {
    key: t.key,
    name: t.name,
    group: t.group,
    sample: t.sample,
    who: t.who,
    fields,
    planKeys: t.planKeys ?? [],
    planSeries: Boolean(t.planSeries),
    report: reportOf(t.report, s?.report),
    antibiotics: s?.antibiotics ?? t.antibiotics ?? [],
    custom: false,
    department,
    tatHours: s?.tatHours ?? defaultTat(department),
    urgentTatHours: s?.urgentTatHours ?? defaultUrgentTat(department),
    outsideLab: s?.outsideLab ?? '',
    active: s ? s.active !== false : true,
    // Built-in ranges are a DRAFT for the doctor to check (HANDOVER.md section 10) until a doctor approves them here
    status: s?.status === 'approved' ? 'approved' : 'draft',
    version: s?.version ?? 1,
    approvedVersion: s?.approvedVersion ?? null,
    approvedByName: s?.approvedByName ?? null,
    approvedAt: s?.approvedAt ?? null,
    updatedByName: s?.updatedByName ?? null,
    changed: Boolean(s),
  };
}

function customAsSet(s) {
  const department = s.department || 'other';
  return {
    key: s.key,
    name: s.name,
    group: s.group || 'other',
    sample: s.sample,
    who: s.who,
    fields: (s.fields ?? []).map((f) => {
      const n = f.type === 'number';
      return { ...f, bands: n ? (f.bands ?? []) : [], deltaPercent: n ? (f.deltaPercent ?? null) : null, criticalLow: n ? (f.criticalLow ?? null) : null, criticalHigh: n ? (f.criticalHigh ?? null) : null };
    }),
    planKeys: [],
    report: reportOf(null, s.report),
    antibiotics: s.antibiotics ?? [],
    custom: true,
    department,
    tatHours: s.tatHours ?? defaultTat(department),
    urgentTatHours: s.urgentTatHours ?? defaultUrgentTat(department),
    outsideLab: s.outsideLab ?? '',
    active: s.active !== false,
    status: s.status,
    version: s.version,
    approvedVersion: s.approvedVersion ?? null,
    approvedByName: s.approvedByName ?? null,
    approvedAt: s.approvedAt ?? null,
    updatedByName: s.updatedByName ?? null,
    changed: true,
  };
}

/** The hospital's test list: { tests, byKey }. */
export async function labCatalogue(tenantId) {
  const settings = await LabTestSetting.find({ tenantId }).lean();
  const byKeySetting = new Map(settings.map((s) => [s.key, s]));
  const tests = [...LAB_TESTS.map((t) => builtInAsSet(t, byKeySetting.get(t.key))), ...settings.filter((s) => s.custom).map(customAsSet)];
  return { tests, byKey: new Map(tests.map((t) => [t.key, t])) };
}

/** The department, times and outside lab of a typed "other" test. */
export const OTHER_SETUP = { department: 'other', tatHours: ROUTINE_TAT, urgentTatHours: URGENT_TAT, outsideLab: '' };
export const setupOf = (catalogue, key) => (key === OTHER_TEST ? OTHER_SETUP : (catalogue.byKey.get(key) ?? OTHER_SETUP));

/**
 * The test list for the browser. ctx (a patient's rangeContext): the number fields carry the range that applies to
 * this patient (the result form suggests the flag from it).
 */
export function catalogueView(catalogue, ctx = null, { clinical = true } = {}) {
  return {
    groups: LAB_GROUPS,
    departments: DEPARTMENTS,
    tests: catalogue.tests.map((t) => ({
      key: t.key,
      name: t.name,
      group: t.group,
      sample: t.sample,
      who: t.who,
      custom: t.custom,
      active: t.active,
      department: t.department,
      status: t.status,
      report: t.report,
      antibiotics: t.antibiotics,
      fields: t.fields.map((f) => {
        // The lab sees the range's numbers, not whom it is for (her weeks of pregnancy - need-to-know, P4)
        const { bands, band, ...rest } = ctx ? fieldFor(f, ctx) : f;
        return clinical && band ? { ...rest, band } : rest;
      }),
    })),
  };
}

/** Who signs reports (the lab's settings – report templates), with their signature pictures. */
export async function labSignatories(tenantId) {
  const s = await LabSetup.findOne({ tenantId, set: 'lab' }, { signatories: 1 }).lean();
  return (s?.signatories ?? []).map((x) => ({ id: String(x._id), name: x.name, title: x.title ?? '', qualification: x.qualification ?? '', regNo: x.regNo ?? '', userId: x.userId ? String(x.userId) : null, signature: x.signature ?? '', isDefault: Boolean(x.isDefault), active: x.active !== false }));
}

/**
 * Who signs this report: the signer who checked it (or reported it, without the check) – with the signature picture –
 * else the default signer's name with a line to sign by hand (no picture: the report was not checked by them).
 * Only for reported results.
 */
export function reportSigner(signatories, order) {
  if (!['reported', 'reviewed'].includes(order.status)) return null;
  const active = signatories.filter((x) => x.active);
  const by = String(order.verified?.by ?? order.reported?.by ?? '');
  const own = active.find((x) => x.userId && x.userId === by);
  const pick = own ?? active.find((x) => x.isDefault) ?? null;
  if (!pick) return null;
  return { name: pick.name, title: pick.title, qualification: pick.qualification, regNo: pick.regNo, signature: own && pick.signature ? pick.signature : '', signed: Boolean(own) };
}

/** The lab's settings (the defaults when the hospital has none). */
export async function labSetup(tenantId) {
  const s = await LabSetup.findOne({ tenantId, set: 'lab' }).lean();
  return { verify: Boolean(s?.verify), verifierIds: (s?.verifierIds ?? []).map(String), updatedByName: s?.updatedByName ?? '', updatedAt: s?.updatedAt ?? null };
}

export { labNumber };
