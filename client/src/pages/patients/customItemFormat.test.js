// Editing an item a doctor added to one patient's care plan (5 Oct 2026): when it is offered, the form, its checks,
// and what an edit changes – the server's rule, so "nothing changed" means the same on both. Fake data only.
import { describe, expect, it } from 'vitest';
import { canEditItem, editBody, editHistoryText, editedFields, editedMessage, emptyItemForm, itemForm, timingFromForm, weeksLabel } from './customItemFormat.js';

const plan = { careType: 'antenatal', canChangePlan: true };
const added = (over = {}) => ({
  id: 'i1',
  origin: 'custom',
  kind: 'investigation',
  name: 'Thyroid revew',
  patientText: '',
  note: null,
  timing: { atBooking: false, fromWeek: 20, toWeek: 22, after: { key: null, weeks: null }, date: null, dateBy: null },
  done: null,
  notNeeded: null,
  ...over,
});
const dated = added({ timing: { atBooking: false, fromWeek: null, toWeek: null, after: { key: null, weeks: null }, date: '2026-11-02T00:00:00.000Z', dateBy: '2026-11-08T00:00:00.000Z' } });

describe('when "Edit item" is offered', () => {
  it('for an item added for this patient, still open, on a plan this person may change', () => {
    expect(canEditItem(added(), plan)).toBe(true);
    expect(canEditItem(added({ origin: 'template' }), plan)).toBe(false);
    expect(canEditItem(added({ done: { on: '2026-09-28' } }), plan)).toBe(false); // a done item cannot be edited
    expect(canEditItem(added({ notNeeded: { reasonCode: 'declined' } }), plan)).toBe(false);
    expect(canEditItem(added(), { ...plan, canChangePlan: false })).toBe(false); // paused, closed, or read-only
  });

  it('the weeks choice is named for the plan', () => {
    expect(weeksLabel(plan)).toBe('Weeks of pregnancy');
    expect(weeksLabel({ careType: 'postnatal', startWord: 'delivery' })).toBe('Weeks after delivery');
    expect(weeksLabel({ careType: 'newborn', startWord: 'birth' })).toBe('Weeks after birth');
    expect(weeksLabel({ careType: 'abortion', startWord: 'loss' })).toBe('Weeks since she was seen');
  });
});

describe('the form', () => {
  it('starts from the item: its weeks or its dates, its wording and note', () => {
    expect(itemForm(added({ note: { text: 'Ask about tiredness' }, patientText: 'Thyroid blood test' }))).toMatchObject({
      name: 'Thyroid revew',
      patientText: 'Thyroid blood test',
      note: 'Ask about tiredness',
      timingType: 'weeks',
      fromWeek: '20',
      toWeek: '22',
      dueFrom: '',
    });
    expect(itemForm(dated)).toMatchObject({ timingType: 'date', fromWeek: '', dueFrom: '2026-11-02', dueBy: '2026-11-08' });
    expect(emptyItemForm()).toMatchObject({ kind: '', name: '', timingType: 'weeks' });
  });

  it('checks the when part as the server does', () => {
    expect(timingFromForm({ timingType: 'weeks', fromWeek: '22', toWeek: '24' })).toEqual({ timing: { type: 'weeks', fromWeek: 22, toWeek: 24 }, errors: {} });
    expect(timingFromForm({ timingType: 'weeks', fromWeek: '', toWeek: '24' }).errors).toEqual({ 'timing.fromWeek': 'Enter a week.' });
    expect(timingFromForm({ timingType: 'weeks', fromWeek: '24', toWeek: '22' }).errors).toEqual({ 'timing.toWeek': '"To" week must not be before "from" week.' });
    expect(timingFromForm({ timingType: 'date', dueFrom: '', dueBy: '' }).errors).toEqual({ 'timing.dueFrom': 'Please enter the first day it is due.' });
    expect(timingFromForm({ timingType: 'date', dueFrom: '2026-11-02', dueBy: '' }).timing).toEqual({ type: 'date', dueFrom: '2026-11-02', dueBy: null });
    const { body, errors } = editBody({ ...itemForm(added()), name: '  ' });
    expect(errors).toEqual({ name: 'Please give the item a name.' });
    expect(body).toMatchObject({ action: 'edit', name: '', timing: { type: 'weeks', fromWeek: 20, toWeek: 22 } });
  });
});

describe('what an edit changes', () => {
  it('nothing for the form as it was opened; each part on its own', () => {
    expect(editedFields(added(), editBody(itemForm(added())).body)).toEqual([]);
    expect(editedFields(dated, editBody(itemForm(dated)).body)).toEqual([]);
    // An empty "due by" means 6 days after "due from" – the same window as stored
    expect(editedFields(dated, editBody({ ...itemForm(dated), dueBy: '' }).body)).toEqual([]);
    const body = editBody({ ...itemForm(added()), name: 'Thyroid review', toWeek: '24', note: 'Ask about tiredness ' }).body;
    expect(editedFields(added(), body)).toEqual(['name', 'timing', 'note']);
    expect(body.note).toBe('Ask about tiredness');
    expect(editedFields(added(), editBody({ ...itemForm(added()), timingType: 'date', dueFrom: '2026-10-12' }).body)).toEqual(['timing']);
    expect(editedFields(added({ note: { text: 'Old note' } }), editBody({ ...itemForm(added({ note: { text: 'Old note' } })), note: '' }).body)).toEqual(['note']);
  });

  it('says what changed, and the item history reads it back', () => {
    expect(editedMessage('Thyroid review', ['name', 'timing'])).toBe('Thyroid review: name and due window changed.');
    expect(editedMessage('Thyroid review', ['name', 'patientText', 'timing', 'note'])).toBe('Thyroid review: name, wording for the patient, due window and note changed.');
    expect(editedMessage('Thyroid review', [])).toBe('Thyroid review: nothing was changed.');
    expect(editHistoryText({ action: 'edit', from: { name: 'Thyroid revew', timing: { fromWeek: 20, toWeek: 22 } }, to: { name: 'Thyroid review', timing: { fromWeek: 22, toWeek: 24 } } })).toBe(
      'name (was “Thyroid revew”), due window',
    );
    expect(editHistoryText({ action: 'edit', from: { note: 'x', manualDate: { dueFrom: '2026-10-12' } }, to: { note: '' } })).toBe('note, the moved date replaced');
  });
});
