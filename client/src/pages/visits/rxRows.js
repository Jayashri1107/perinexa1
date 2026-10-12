// Medicine rows as they are typed (Feature 8 and 8b): every value a string, plus a key for React. Shared by the
// Prescription tab and the prescription-set editor, with the rule for adding a ready-made set to a prescription.

import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { COUNTED_UNITS } from './rxFormat.js';

export const RX_FIELDS = ['drug', 'form', 'strength', 'dose', 'frequency', 'frequencyText', 'timing', 'route', 'durationValue', 'durationUnit', 'instructions'];
const TEXT_FIELDS = ['drug', 'strength', 'dose', 'frequencyText', 'instructions'];

let seq = 0;
const newKey = () => `row-${(seq += 1)}`;

/** A medicine (as saved) → a row to edit. */
export const toRow = (it) => ({ key: newKey(), ...Object.fromEntries(RX_FIELDS.map((k) => [k, it[k] == null ? '' : String(it[k])])), form: it.form || 'tab' });
export const emptyRow = () => toRow({ form: 'tab', frequency: '' });
/** A row → the medicine to save. */
export const toItem = (r) => ({
  ...Object.fromEntries(RX_FIELDS.map((k) => [k, typeof r[k] === 'string' ? r[k].trim() : r[k]])),
  durationValue: r.durationValue === '' ? null : Number(r.durationValue),
});
/** A row nothing was typed into (the empty row a new prescription starts with): never saved, never "unsaved". */
export const isBlankRow = (r) => RX_FIELDS.every((k) => k === 'form' || String(r[k] ?? '').trim() === '');
export const stripKeys = (rows) => rows.map(({ key: _k, ...r }) => r);
export const sameRows = (a, b) => JSON.stringify(stripKeys(a)) === JSON.stringify(stripKeys(b));

/** Whether a row already reads as the doctor's usual way of writing that medicine (then "Use it" is not offered). */
export const isUsual = (r, m) => RX_FIELDS.every((k) => k === 'drug' || String(r[k] ?? '').trim() === String(m[k] ?? '').trim());

/** What to fix before saving, as { 'items.0.drug': message } – the same checks as the server. */
export function rowProblems(rows, { checkFetalSex = true } = {}) {
  const p = {};
  rows.forEach((r, i) => {
    if (!r.drug.trim()) p[`items.${i}.drug`] = 'Enter the medicine';
    if (!r.frequency) p[`items.${i}.frequency`] = 'Choose how often';
    if (r.frequency === 'custom' && !r.frequencyText.trim()) p[`items.${i}.frequencyText`] = 'Write how often';
    if (COUNTED_UNITS.includes(r.durationUnit) && r.durationValue === '') p[`items.${i}.durationValue`] = 'Enter how many';
    if (r.durationValue !== '' && !COUNTED_UNITS.includes(r.durationUnit)) p[`items.${i}.durationUnit`] = 'Choose days, weeks or months';
    if (checkFetalSex) for (const k of TEXT_FIELDS) if (mentionsFetalSex(r[k])) p[`items.${i}.${k}`] = PCPNDT_MESSAGE;
  });
  return p;
}

/** The same medicine: the same name (any capitals) and the same form – a clotrimazole pessary is not the cream. */
export const sameMedicine = (row, item) => row.drug.trim().toLowerCase() === item.drug.trim().toLowerCase() && row.form === (item.form || 'tab');

/** Adds text as a new line, unless it is already there. */
export function appendText(current = '', addition = '') {
  const add = addition.trim();
  if (!add || current.includes(add)) return current;
  return current.trim() ? `${current.trimEnd()}\n${add}` : add;
}

/**
 * Adds a ready-made set to what is being written. A medicine already there (the same medicine) is replaced, in its
 * place, by the set's version – the doctor chose the set's dose now; the others are added at the end. The set's
 * general instructions are added to the notes. Returns { rows, notes, added, replaced } (names).
 */
export function addSet({ rows, notes }, set) {
  const next = [...rows];
  const taken = new Set();
  const added = [];
  const replaced = [];
  for (const it of set.items) {
    const i = rows.findIndex((r, k) => !taken.has(k) && sameMedicine(r, it)); // only rows that were already there
    if (i >= 0) {
      taken.add(i);
      next[i] = { ...toRow(it), key: rows[i].key };
      replaced.push(it.drug);
    } else {
      next.push(toRow(it));
      added.push(it.drug);
    }
  }
  return { rows: next, notes: appendText(notes, set.notes), added, replaced };
}
