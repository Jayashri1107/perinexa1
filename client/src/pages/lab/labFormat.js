// Words, colours and small helpers for the lab module (Version 2). Statuses and flags are colour + icon + word
// (brand guide). The test list and the reference values come from the server (GET /api/lab/tests).
import { ArrowDown, ArrowUp, CircleCheck, CircleMinus, Clock, FileText, TestTube, TriangleAlert } from 'lucide-react';

export const ORDER_STATUS = {
  ordered: { tone: 'due', icon: Clock, word: 'Sample to take' },
  collected: { tone: 'due', icon: TestTube, word: 'Sample taken' },
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

/** "Haemoglobin 9.5 g/dL (Low), Platelets 2.1 lakh/µL" – one line per test, for lists. */
export function resultLine(test, catalogue) {
  const def = testDef(catalogue, test.key);
  const parts = (test.values ?? [])
    .filter((v) => v.value !== '')
    .map((v) => {
      const f = def?.fields.find((x) => x.key === v.key);
      const flag = FLAG_LOOK[v.flag] ? ` (${FLAG_LOOK[v.flag].word})` : '';
      return `${f?.name ?? v.key} ${v.value}${f?.unit ? ` ${f.unit}` : ''}${flag}`;
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
    values: Object.fromEntries((t.values ?? []).map((v) => [v.key, { value: v.value, flag: v.flag, flagSet: true }])),
    text: t.text ?? '',
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
        if (!v || v.value === '') return null;
        return { key: f.key, value: String(v.value).trim(), flag: f.type === 'text' ? '' : (v.flag ?? flagFor(f, v.value)) };
      })
      .filter(Boolean);
    return { key: t.key, values, text: entry.text.trim() };
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
