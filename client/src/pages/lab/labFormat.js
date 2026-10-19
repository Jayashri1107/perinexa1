// Words, colours and small helpers for the lab module (Version 2). Statuses and flags are colour + icon + word
// (brand guide). The test list and the reference values come from the server (GET /api/lab/tests).
import { ArrowDown, ArrowUp, CircleCheck, CircleMinus, ClipboardCheck, Clock, FileText, TestTube, TriangleAlert } from 'lucide-react';

export const ORDER_STATUS = {
  ordered: { tone: 'due', icon: Clock, word: 'Sample to take' },
  collected: { tone: 'due', icon: TestTube, word: 'Sample taken' },
  entered: { tone: 'due', icon: ClipboardCheck, word: 'Entered – to check' },
  reported: { tone: 'watch', icon: FileText, word: 'Reported – to review' },
  reviewed: { tone: 'stable', icon: CircleCheck, word: 'Reviewed' },
  cancelled: { tone: 'inactive', icon: CircleMinus, word: 'Cancelled' },
};
export const orderLook = (order) => ORDER_STATUS[order?.status] ?? { tone: 'neutral', icon: null, word: order?.status ?? '—' };

export const FLAG_LOOK = {
  low: { tone: 'high', icon: ArrowDown, word: 'Low' },
  high: { tone: 'high', icon: ArrowUp, word: 'High' },
  abnormal: { tone: 'high', icon: TriangleAlert, word: 'Abnormal' },
};
export const FLAG_OPTIONS = [
  ['', 'Not flagged'],
  ['normal', 'Normal'],
  ['low', 'Low'],
  ['high', 'High'],
  ['abnormal', 'Abnormal'],
];
export const isAbnormal = (flag) => Boolean(FLAG_LOOK[flag]);

export const AMBIGUOUS_NUMBER = 'Write it without the comma (1500), or with a point if it is a decimal (1.5).';

/**
 * A number as the lab typed it: { value } as the server stores it ('1500', '12.5'), or { error } in words – the same
 * rule as the server (server/src/lab/labTests.js; a test checks they agree). Grouping commas are taken out
 * ("1,23,456", "1,234,567", "1,500.5") in a field that can hold such a number (field: the test's field) – elsewhere
 * they are refused with the unit ("1,40,000" platelets in lakh/µL); "12,5" is a decimal comma; "1,500" alone could be
 * either and is asked about, so a beta hCG of 1,500 is never read as 1.5.
 */
export function labNumber(text, field = null) {
  const t = String(text ?? '').trim();
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return { value: t };
  if (/^-?\d+,\d{1,2}$/.test(t)) return { value: t.replace(',', '.') };
  if (/^-?\d{1,3},\d{3}$/.test(t)) return { error: AMBIGUOUS_NUMBER };
  const indian = /^-?\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/;
  const international = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
  if (indian.test(t) || international.test(t)) return groupsDigits(field) ? { value: t.replace(/,/g, '') } : { error: tooLarge(field) };
  return { error: 'Enter a number.' };
}

/**
 * Can this number field hold a number written with grouping commas (1,000 or more)? Yes when it has no usual range
 * (beta hCG, LH, the antibody tests) or its range reaches 1,000 (a white cell count per µL); no for the others
 * (haemoglobin, platelets in lakh/µL …). Without a field: yes.
 */
export const groupsDigits = (field) => !field || (field.low == null && field.high == null) || (field.high ?? Infinity) >= 1000 || (field.low ?? 0) >= 1000;
const tooLarge = (field) => `This is far too large for ${field.unit ? `${field.unit} – check the unit` : 'this test – check the number'}${field.range ? ` (${field.range})` : ''}.`;

/**
 * The suggested flag for a value (the same rule as the server; the lab may change it). A number with no usual range
 * (beta hCG, LH, most antibody tests) is not flagged – never "Normal".
 */
export function flagFor(field, value) {
  if (value === '' || value == null || !field) return '';
  if (field.type === 'number') {
    if (field.low == null && field.high == null) return '';
    const parsed = labNumber(value, field);
    const n = parsed.error ? NaN : Number(parsed.value);
    if (!Number.isFinite(n)) return '';
    if (field.low != null && n < field.low) return 'low';
    if (field.high != null && n > field.high) return 'high';
    return 'normal';
  }
  if (field.type === 'choice') return field.abnormal.includes(value) ? 'abnormal' : 'normal';
  return '';
}

/** The test's definition (null for a test the doctor typed: its result is in words). */
export const testDef = (catalogue, key) => catalogue?.tests?.find((t) => t.key === key) ?? null;

/**
 * A value's name, unit and usual range: as saved with the result (the range that applied to this patient, a test of
 * the hospital's own), else from the test list.
 */
export function valueWords(v, def) {
  const f = def?.fields?.find((x) => x.key === v.key);
  return { name: v.name ?? f?.name ?? v.key, unit: v.unit ?? f?.unit ?? '', range: v.range ?? f?.range ?? '' };
}

/** "Haemoglobin 9.5 g/dL (Low), Platelets 2.1 lakh/µL" – one line per test, for lists. */
export function resultLine(test, catalogue) {
  const def = testDef(catalogue, test.key);
  const parts = (test.values ?? [])
    .filter((v) => v.value !== '')
    .map((v) => {
      const w = valueWords(v, def);
      const flag = FLAG_LOOK[v.flag] ? ` (${FLAG_LOOK[v.flag].word})` : '';
      return `${w.name} ${v.value}${w.unit ? ` ${w.unit}` : ''}${flag}`;
    });
  if (test.text) parts.push(test.text);
  return parts.join(', ');
}

/** "Hb, HIV, Serum vitamin D" – the tests of an order, short. */
export const testNames = (order) => order.tests.map((t) => t.name).join(', ');

export { FILE_TYPES, MAX_FILE_BYTES, fileSize, readAsBase64 } from '../../components/fileUpload.js';
export const fileUrl = (order, file) => `/api/lab/orders/${order.id}/files/${file.id}`;

/** The values as the result form keeps them: { [testIndex]: { [fieldKey]: { value, flag, touched } }, text }. */
export function formFromOrder(order) {
  return order.tests.map((t) => ({
    // calculated: worked out by the server (report templates) – sent back only once someone types over it
    values: Object.fromEntries((t.values ?? []).map((v) => [v.key, { value: v.value, flag: v.flag, flagSet: true, ...(v.calculated ? { calculated: true } : {}) }])),
    text: t.text ?? '',
    antibiotics: (t.antibiotics ?? []).map((a) => ({ name: a.name, result: a.result, zone: a.zone ?? '' })),
  }));
}

/** The form back into the request body's tests. */
export function testsFromForm(order, form, catalogue) {
  return order.tests.map((t, i) => {
    const def = testDef(catalogue, t.key);
    const entry = form[i] ?? { values: {}, text: '' };
    const values = (def?.fields ?? [])
      .map((f) => {
        const v = entry.values[f.key];
        // A value the server worked out is worked out again from what is typed now (left out here)
        if (!v || v.value === '' || v.calculated) return null;
        return { key: f.key, value: String(v.value).trim(), flag: f.type === 'text' ? '' : (v.flag ?? flagFor(f, v.value)) };
      })
      .filter(Boolean);
    // The culture template's sensitivity table: the antibiotics given a result
    const antibiotics = (entry.antibiotics ?? []).filter((a) => a.result).map((a) => ({ name: a.name, result: a.result, zone: (a.zone ?? '').trim() }));
    return { key: t.key, values, text: entry.text.trim(), ...(antibiotics.length ? { antibiotics } : {}) };
  });
}

// ---------- Baby tests and packages ----------

/** 'newborn' for a patient registered for newborn care (baby tests only), otherwise 'adult'. */
export const testsFor = (patient) => (patient?.careType === 'newborn' ? 'newborn' : 'adult');

/** The baby's day of life today (the day of birth is day 0), from the birth date and time; null if not recorded. */
export function dayOfLife(birthAt, now = new Date()) {
  if (!birthAt) return null;
  const b = new Date(birthAt);
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(b)) / 86400000);
  return days >= 0 ? days : null;
}

/** Whether a package fits a baby of this day of life. */
export const packageFits = (pkg, day) => day != null && day >= pkg.fromDay && (pkg.toDay == null || day <= pkg.toDay);

/** "Day 0", "Day 2–7", "From day 14". */
export function packageDays(pkg) {
  if (pkg.toDay == null) return `From day ${pkg.fromDay}`;
  return pkg.fromDay === pkg.toDay ? `Day ${pkg.fromDay}` : `Day ${pkg.fromDay}–${pkg.toDay}`;
}

/** "Day 2–3 – newborn screening before going home" for the packages an order was made from. */
export const packageNames = (packages) => (packages ?? []).map((p) => (typeof p === 'string' ? p : p.name)).join('; ');

/** "Day 0", "Day 2–7", "From day 14" for a baby package; '' for an adult one (no day window). */
export const packageWhen = (pkg) => (pkg.who === 'newborn' && pkg.fromDay != null ? packageDays(pkg) : '');

// ---------- The full lab system (docs/LAB_LIMS_PLAN.md) ----------

// The lab's departments (the same list as server/src/lab/labSetup.js DEPARTMENTS)
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
export const departmentName = (key) => DEPARTMENTS[key] ?? DEPARTMENTS.other;

// Why the lab refuses a sample (the same list as server/src/lab/labSetup.js REJECT_REASONS)
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

// The neutral name of a confidential test (HIV) on labels, the register and a printed report – the same as
// server/src/billing/billingRules.js CONFIDENTIAL_TESTS / CONFIDENTIAL_NAME.
export const CONFIDENTIAL_TESTS = ['hiv'];
export const CONFIDENTIAL_NAME = 'Lab test (confidential)';
export const isConfidential = (test) => CONFIDENTIAL_TESTS.includes(test.key);
export const shownName = (test) => (isConfidential(test) ? CONFIDENTIAL_NAME : test.name);

export const LATE_LOOK = { tone: 'high', icon: Clock, word: 'Late' };

/** "3 h 20 min" or "2 days 4 h" – the time from the order to the report (or to now). */
export function duration(from, to) {
  const min = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `${Math.floor(h / 24)} days${h % 24 ? ` ${h % 24} h` : ''}`;
}

/** The time taken so far: to the report, or (still open) until now. */
export const turnaround = (order, now = new Date()) => duration(order.ordered.at, order.reported?.at ?? now);

/**
 * The containers of an order, one label each: the tests grouped by their sample ("Blood (EDTA)"), numbered 1, 2 …
 * Each label's barcode is the sample number and the container's number ("261017-0003-2"). A confidential test is
 * named by its neutral name; a typed test without a sample in the list goes on a label "Sample as noted".
 */
export function sampleLabels(order, catalogue) {
  const groups = new Map();
  for (const t of order.tests) {
    const sample = testDef(catalogue, t.key)?.sample || 'Sample as noted';
    if (!groups.has(sample)) groups.set(sample, []);
    groups.get(sample).push(shownName(t));
  }
  return [...groups.entries()].map(([sample, tests], i) => ({ code: `${order.sampleNo}-${i + 1}`, sample, tests }));
}

/** The register as a CSV file (opens in Excel): one row per order. Words only – the confidential test is neutral. */
export function registerCsv(rows) {
  const cell = (v) => {
    const t = String(v ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ['Sample number', 'Ordered', 'Patient', 'Patient number', 'Tests', 'Departments', 'Urgent', 'Status', 'Reported', 'Time taken', 'Late', 'Outside lab', 'Rejected samples'];
  const lines = rows.map((o) => [
    o.sampleNo ?? '',
    new Date(o.ordered.at).toLocaleString('en-IN'),
    o.patient.fullName,
    o.patient.mrn,
    o.tests.map((t) => t.name).join('; '),
    [...new Set(o.tests.map((t) => departmentName(t.department)))].join('; '),
    o.urgent ? 'Yes' : '',
    orderLook(o).word,
    o.reported ? new Date(o.reported.at).toLocaleString('en-IN') : '',
    o.status === 'cancelled' ? '' : turnaround(o),
    o.late ? 'Yes' : '',
    [...new Set(o.tests.filter((t) => t.outside).map((t) => t.outside.labName))].join('; '),
    o.rejections.length || '',
  ]);
  return [head, ...lines].map((l) => l.map(cell).join(',')).join('\r\n');
}

// ---------- Report templates (docs/LAB_TEMPLATES_PLAN.md) ----------

export const TEMPLATES = { table: 'Table of values', serology: 'Serology (result and method)', culture: 'Culture and sensitivity', narrative: 'Paragraphs (histopathology, cytology)' };
export const SENSITIVITY = { S: 'Sensitive', I: 'Intermediate', R: 'Resistant' };

/** A test's values grouped by their section on the report: [[section or '', [values or fields]]], in order. */
export function bySection(items) {
  const out = [];
  for (const it of items) {
    const sec = it.section ?? '';
    const last = out[out.length - 1];
    if (last && last[0] === sec) last[1].push(it);
    else out.push([sec, [it]]);
  }
  return out;
}

/** The sensitivity table's rows for the form: the test's panel, then any other antibiotic already entered. */
export function antibioticRows(panel, entered = []) {
  const byName = new Map(entered.map((a) => [a.name, a]));
  const rows = (panel ?? []).map((name) => ({ name, result: byName.get(name)?.result ?? '', zone: byName.get(name)?.zone ?? '' }));
  for (const a of entered) if (!(panel ?? []).includes(a.name)) rows.push({ name: a.name, result: a.result, zone: a.zone ?? '' });
  return rows;
}
