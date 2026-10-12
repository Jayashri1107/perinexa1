// Items a doctor adds to one patient's care plan, and editing them (5 Oct 2026): the form's values, its checks, and
// what an edit changes – the same rules as the server (careplans/plansService.js editedFields), so the screen and the
// server agree on what "nothing changed" means. Pure: no React, no requests.
import { addDays, isAntenatalPlan, itemState, toDateInput } from './carePlanFormat.js';

/** The parts of an added item an edit can change, in plain words (in this order). */
export const EDIT_FIELD_WORDS = { name: 'name', patientText: 'wording for the patient', timing: 'due window', note: 'note' };

/**
 * "Edit item" is offered for an item added for this patient, still open, on a plan this person may change (an active
 * plan of her current care). The server checks the same again.
 */
export const canEditItem = (item, plan) => Boolean(plan?.canChangePlan) && item?.origin === 'custom' && itemState(item) === 'open';

const AFTER_WORDS = { delivery: 'after delivery', birth: 'after birth', start: 'since the start', loss: 'since she was seen' };
/** The label of the weeks choice: "Weeks of pregnancy", or "Weeks after delivery" (birth, since the start …). */
export const weeksLabel = (plan) => (isAntenatalPlan(plan) ? 'Weeks of pregnancy' : `Weeks ${AFTER_WORDS[plan?.startWord] ?? 'since the start'}`);

/** An empty form for a new item. */
export const emptyItemForm = () => ({ kind: '', name: '', timingType: 'weeks', fromWeek: '', toWeek: '', dueFrom: '', dueBy: '', patientText: '', note: '', reason: '' });

/** The form for editing an item a doctor added, filled from the item as the Care plan tab shows it (PlanView item). */
export function itemForm(item) {
  const t = item?.timing ?? {};
  const weeks = t.fromWeek != null || !t.date;
  return {
    ...emptyItemForm(),
    kind: item?.kind ?? '',
    name: item?.name ?? '',
    patientText: item?.patientText ?? '',
    note: item?.note?.text ?? '',
    timingType: weeks ? 'weeks' : 'date',
    fromWeek: t.fromWeek != null ? String(t.fromWeek) : '',
    toWeek: t.toWeek != null ? String(t.toWeek) : '',
    dueFrom: t.date ? toDateInput(t.date) : '',
    dueBy: t.dateBy ? toDateInput(t.dateBy) : '',
  };
}

/**
 * The "When" part of the form as the server takes it – { type: 'weeks', fromWeek, toWeek } or { type: 'date', dueFrom,
 * dueBy } – and the problems with it, keyed by field ('timing.fromWeek' …), empty when fine.
 */
export function timingFromForm(form) {
  const errors = {};
  if (form.timingType === 'weeks') {
    const from = Number.parseInt(form.fromWeek, 10);
    const to = Number.parseInt(form.toWeek, 10);
    if (!Number.isInteger(from)) errors['timing.fromWeek'] = 'Enter a week.';
    if (!Number.isInteger(to)) errors['timing.toWeek'] = 'Enter a week.';
    else if (Number.isInteger(from) && to < from) errors['timing.toWeek'] = '"To" week must not be before "from" week.';
    return { timing: { type: 'weeks', fromWeek: from, toWeek: to }, errors };
  }
  if (!form.dueFrom) errors['timing.dueFrom'] = 'Please enter the first day it is due.';
  return { timing: { type: 'date', dueFrom: form.dueFrom, dueBy: form.dueBy || null }, errors };
}

/**
 * The body of an edit (PATCH …/items/:id, action "edit"; rev is added when it is sent) and the problems with the form,
 * keyed by field. Text is trimmed as the server stores it.
 */
export function editBody(form) {
  const { timing, errors } = timingFromForm(form);
  const name = form.name.trim();
  if (!name) errors.name = 'Please give the item a name.';
  return { body: { action: 'edit', name, patientText: form.patientText.trim(), note: form.note.trim(), timing }, errors };
}

// The item's timing is the one in the body (dates as "YYYY-MM-DD"; an empty "due by" is 6 days after "due from").
function sameTiming(t = {}, timing) {
  if (timing.type === 'weeks') return t.date == null && t.fromWeek === timing.fromWeek && (t.toWeek ?? t.fromWeek) === timing.toWeek;
  if (t.fromWeek != null || t.date == null || !timing.dueFrom) return false;
  const by = timing.dueBy || toDateInput(addDays(timing.dueFrom, 6));
  return toDateInput(t.date) === timing.dueFrom && toDateInput(t.dateBy ?? addDays(t.date, 6)) === by;
}

/** What an edit changes on the item: some of 'name', 'patientText', 'timing', 'note' (empty: nothing). */
export function editedFields(item, body) {
  return [
    (item.name ?? '') !== body.name && 'name',
    (item.patientText ?? '') !== body.patientText && 'patientText',
    !sameTiming(item.timing ?? {}, body.timing) && 'timing',
    (item.note?.text ?? '') !== body.note && 'note',
  ].filter(Boolean);
}

const listWords = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? ''));

/** The message once an edit is saved: "Thyroid review: name and due window changed." */
export const editedMessage = (name, fields) => (fields.length ? `${name}: ${listWords(fields.map((f) => EDIT_FIELD_WORDS[f] ?? f))} changed.` : `${name}: nothing was changed.`);

/** What an "Edited" entry of the item's history changed, in words: "name (was “Thyroid revew”), due window". */
export function editHistoryText(h) {
  const to = h?.to ?? {};
  const from = h?.from ?? {};
  return Object.keys(EDIT_FIELD_WORDS)
    .filter((f) => f in to)
    .map((f) => (f === 'name' && from.name ? `name (was “${from.name}”)` : EDIT_FIELD_WORDS[f]))
    .concat(from.manualDate ? ['the moved date replaced'] : [])
    .join(', ');
}
