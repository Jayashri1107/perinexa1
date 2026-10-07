// The lab tests a doctor can order, with the values the lab enters for each – copied from Perinexa's DRAFT list
// (content/labTests.json). DRAFT reference ranges: the lab's own report and the treating doctor decide; the flag only
// draws attention. No test here reveals the sex of a fetus (PC-PNDT).
// A field is a number (unit, low, high: below low is Low, above high is High), a choice (the options in `abnormal`
// are flagged Abnormal) or text.
import { readFileSync } from 'node:fs';

const catalogue = JSON.parse(readFileSync(new URL('./content/labTests.json', import.meta.url), 'utf8'));

export const LAB_GROUPS = catalogue.groups;
export const LAB_TESTS = catalogue.tests;
export const OTHER_TEST = 'other'; // a test typed by the doctor: the lab writes the result as text
export const testByKey = new Map(LAB_TESTS.map((t) => [t.key, t]));
export const FLAGS = ['', 'normal', 'low', 'high', 'abnormal'];
export const isAbnormal = (flag) => ['low', 'high', 'abnormal'].includes(flag);

// Newborn tests for babies, adult tests for everyone else.
export const testsFor = (careType) => (careType === 'newborn' ? 'newborn' : 'adult');

// "1,500" or "1500" → 1500; "1.5" → 1.5; anything else → null.
function numberOf(text) {
  const t = String(text ?? '').trim().replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

// The flag of one value, from the field's range or abnormal options ('' when it cannot be judged).
export function flagFor(field, value) {
  if (value === '' || value == null) return '';
  if (field.type === 'number') {
    const n = numberOf(value);
    if (n == null) return '';
    if (field.low != null && n < field.low) return 'low';
    if (field.high != null && n > field.high) return 'high';
    return field.low == null && field.high == null ? '' : 'normal';
  }
  if (field.type === 'choice') return field.abnormal?.includes(value) ? 'abnormal' : 'normal';
  return '';
}

export const catalogueView = () => ({ note: catalogue.note, groups: LAB_GROUPS, tests: LAB_TESTS });
