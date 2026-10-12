import { useState } from 'react';
import { CircleCheck, CopyPlus, TriangleAlert } from 'lucide-react';
import { ApiError, api, newRequestId } from '../../api.js';
import { Alert, Avatar, Field, FieldError, StatusPill, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { APPLIES_LABELS, ITEM_KIND_ICONS, ITEM_KIND_LABELS, ITEM_KINDS, defaultPill, templateOwnerLabel } from '../careplans/templateFormat.js';
import {
  CLOSE_REASONS,
  FLAG_LABELS,
  HISTORY_LABELS,
  INCLUDE_PICKS,
  KEPT_WHY,
  NOT_NEEDED_HINTS,
  NOT_NEEDED_REASONS,
  REASON_REQUIRED,
  USER_CLOSE_REASONS,
  WHY_TEXT,
  addDays,
  afterItemWarning,
  canKeep,
  gaOn,
  gaText,
  isAntenatalPlan,
  itemState,
  lastPlanDay,
  maxPlanWeek,
  previewFor,
  repeatLabel,
  statusLook,
  statusNote,
  toDateInput,
  windowText,
} from './carePlanFormat.js';
import { editBody, editHistoryText, editedFields, editedMessage, emptyItemForm, itemForm, timingFromForm, weeksLabel } from './customItemFormat.js';

// Every dialog on the Care plan tab. Each one: focus moves in and back to the row's button (useDialogFocus),
// Escape closes it, one primary button, Cancel as a link, and field errors from the server's answer (err.fields).
// Every change sends the item's (or the plan's) version exactly as the server expects, and hands the server's
// answer ({ plan, summary, … }) to onSaved(res, message) so the tab and the Overview card show the new plan.
// A 409 (someone else, or an automatic update, changed the plan meanwhile) goes to onConflict(message): the tab
// closes the dialog, shows the message and loads the latest plan. So does a 404 for an item that is no longer in
// the plan (see changeItem).
//
// Common props: patient, plan (PlanView), item (for item dialogs), onSaved(res, message, extra?), onConflict, onCancel.

// ---------- Talking to the server ----------

const planPath = (patientId) => `/patients/${patientId}/care-plan`;

/**
 * One action on one item (PATCH /items/:itemId). Every body carries the item's rev as the person saw it.
 * A 404 means the item left the plan meanwhile (the protocol was changed, or a new plan was started): it is
 * handled like any other change by someone else (409) – the dialog closes and the latest plan is shown.
 */
export const changeItem = (patientId, item, body) =>
  api(`${planPath(patientId)}/items/${item.id}`, { method: 'PATCH', body: { ...body, rev: item.rev } }).catch((err) => {
    if (err.status === 404) throw new ApiError(409, { message: `${item.name} is no longer in the current plan. The latest plan is shown.`, code: 'CONFLICT' });
    throw err;
  });

const post = (patientId, path, body) => api(`${planPath(patientId)}${path}`, { method: 'POST', body });

// ---------- Shared pieces ----------

const REASON_MESSAGE = 'Please say why (at least 5 characters).';
const tooShort = (text) => text.trim().length < 5;

// Words about the baby's sex are refused before anything is sent (the server checks again).
function pcpndtErrors(texts) {
  return Object.fromEntries(Object.entries(texts).filter(([, t]) => mentionsFetalSex(t)).map(([k]) => [k, PCPNDT_MESSAGE]));
}

/**
 * Saving from a dialog. submit(request, localErrors?): shows localErrors without sending anything; otherwise
 * sends the request, hands the answer to onSaved, a 409 to onConflict, and keeps anything else in the dialog.
 */
function useSave(onSaved, onConflict) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const submit = async (request, localErrors = {}) => {
    if (Object.keys(localErrors).length) {
      setError('Please check the highlighted fields.');
      setFields(localErrors);
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const res = await request();
      onSaved(res);
    } catch (err) {
      setSaving(false);
      if (err.status === 409) {
        onConflict(err.message);
        return;
      }
      setError(err.message);
      setFields(err.fields ?? {});
    }
  };
  return { saving, error, fields, submit };
}

/**
 * The frame of every dialog: title, error message (with any field problem the form has no place for),
 * the fields, then the one primary button and Cancel.
 * shown: the field names the dialog shows errors under (others are listed in the message at the top).
 * submitDisabled: the primary button can't be used yet (e.g. while the protocol preview is worked out).
 */
function PlanDialog({ id, title, wide = false, save, shown = [], submitLabel, savingLabel = 'Saving…', submitClass = 'btn-primary', submitIcon: Icon, submitDisabled = false, onSubmit, onCancel, children, noSubmit = false, cancelLabel = 'Cancel' }) {
  const ref = useDialogFocus(onCancel);
  const extra = Object.entries(save?.fields ?? {}).filter(([k]) => !shown.includes(k));
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        ref={ref}
        tabIndex={-1}
        className={`modal ${wide ? 'modal-wide' : ''} plan-dialog`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!noSubmit && !submitDisabled) onSubmit();
        }}
        noValidate
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {save?.error && (
          <Alert type="error">
            {save.error}
            {extra.length > 0 && (
              <ul className="plan-error-list">
                {extra.map(([k, m]) => (
                  <li key={k}>{m}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        {children}
        <div className="row">
          {!noSubmit && (
            <button type="submit" className={`btn ${submitClass}`} disabled={save?.saving || submitDisabled}>
              {Icon && <Icon aria-hidden="true" />}
              {save?.saving ? savingLabel : submitLabel}
            </button>
          )}
          <button type="button" className="btn btn-link" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/** "20 w 1 d – 20 w 6 d" for two 'YYYY-MM-DD' dates (empty when unknown). */
function gaRange(plan, from, to) {
  const a = gaText(gaOn(plan.edd, from || null));
  const b = gaText(gaOn(plan.edd, to || null));
  if (!a) return '';
  return b && b !== a ? `${a} – ${b}` : a;
}

/** "Guideline window: 18 w 0 d – 20 w 6 d (26 Oct – 15 Nov 2026)" */
function guidelineWindow(item) {
  if (!item.window) return 'This item has no guideline window.';
  const ga = item.gaWindow ? `${gaText(item.gaWindow.from)} – ${gaText(item.gaWindow.to)} ` : '';
  return `Guideline window: ${ga}(${windowText(item.window.from, item.window.to)})`;
}

// The item's name with its type, at the top of item dialogs.
function ItemHeading({ item, plan, patient }) {
  const look = statusLook(item, plan);
  const note = statusNote(item, plan, patient);
  return (
    <div className="plan-dialog-item">
      <StatusPill tone="neutral" icon={ITEM_KIND_ICONS[item.kind] ?? null}>
        {ITEM_KIND_LABELS[item.kind] ?? item.kind}
      </StatusPill>
      <StatusPill tone={look.tone} icon={look.icon}>
        {look.word}
      </StatusPill>
      {note && <span className="t-caption muted">{note}</span>}
    </div>
  );
}

// ---------- Item dialogs ----------

/** Mark done. elsewhere: opened from "Done elsewhere" (the box starts ticked). */
export function MarkDoneDialog({ patient, plan, item, elsewhere: startElsewhere = false, onSaved, onConflict, onCancel }) {
  const [on, setOn] = useState(toDateInput(plan.today));
  const [elsewhere, setElsewhere] = useState(startElsewhere);
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const takesResult = item.kind === 'investigation' || item.kind === 'scan';
  const wasOpen = itemState(item) === 'open';
  const save = useSave((res) => onSaved(res, `${item.name} marked done (${formatDate(on)}).`, { undoItemId: wasOpen ? item.id : null }), onConflict);
  const warning = afterItemWarning(item, plan, on);
  const isBloodGroup = item.key === 'lab_group' || /blood group/i.test(item.name);
  const isDatingScan = item.key === 'scan_dating' || (item.kind === 'scan' && /dating/i.test(item.name));

  const submit = () => {
    const errors = { ...pcpndtErrors({ result, note }), ...(on ? {} : { on: 'Please enter the date it was done.' }) };
    save.submit(() => changeItem(patient.id, item, { action: 'done', on, elsewhere, result: takesResult ? result.trim() : '', note: note.trim() }), errors);
  };

  return (
    <PlanDialog id="plan-done" title={`Mark done: ${item.name}`} save={save} shown={['on', 'result', 'note']} submitLabel="Mark done" submitIcon={CircleCheck} onSubmit={submit} onCancel={onCancel}>
      <ItemHeading item={item} plan={plan} patient={patient} />
      {item.kind === 'scan' && (
        <Alert type="warning">Record findings needed for care. Never record or disclose the baby's sex (PCPNDT Act).</Alert>
      )}
      {isBloodGroup && <Alert type="info">Also enter the blood group in Edit details – Rh-negative items depend on it.</Alert>}
      {isDatingScan && <Alert type="info">If the scan changes the EDD, enter the scan EDD in Edit details – the plan's dates follow.</Alert>}
      {warning && <Alert type="warning">{warning}</Alert>}
      <Field label="Date" id="done-on" error={save.fields.on} hint={on ? gaRange(plan, on, on) : undefined} keepHint>
        <input id="done-on" type="date" value={on} max={toDateInput(plan.today)} min={toDateInput(addDays(plan.dayZero, -365))} onChange={(e) => setOn(e.target.value)} autoFocus />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={elsewhere} onChange={(e) => setElsewhere(e.target.checked)} />
        <span>Done elsewhere (outside report)</span>
      </label>
      {takesResult && (
        <Field label="Result (optional)" id="done-result" error={save.fields.result}>
          <input id="done-result" value={result} onChange={(e) => setResult(e.target.value)} maxLength={500} placeholder="e.g. Hb 11.2 g/dL" />
        </Field>
      )}
      <Field label="Note (optional)" id="done-note" error={save.fields.note}>
        <textarea id="done-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
    </PlanDialog>
  );
}

/** Move date. planNow: "Plan now" for an item that needs a decision – prefilled today to today + 6 days. */
export function MoveDateDialog({ patient, plan, item, planNow = false, onSaved, onConflict, onCancel }) {
  const today = toDateInput(plan.today);
  const [start, end] = planNow
    ? [today, toDateInput(addDays(plan.today, 6))]
    : item.manualDate
      ? [toDateInput(item.manualDate.dueFrom), toDateInput(item.manualDate.dueBy)]
      : item.due
        ? [toDateInput(item.due.from), toDateInput(item.due.to)]
        : [today, toDateInput(addDays(plan.today, 6))];
  const [dueFrom, setDueFrom] = useState(start);
  const [dueBy, setDueBy] = useState(end);
  const [reason, setReason] = useState('');
  const shownBy = dueBy || (dueFrom ? toDateInput(addDays(dueFrom, 6)) : '');
  const outside = Boolean(item.window && dueFrom && (dueFrom < toDateInput(item.window.from) || shownBy > toDateInput(item.window.to)));
  const windowWords = item.gaWindow ? `${gaText(item.gaWindow.from)} – ${gaText(item.gaWindow.to)}` : item.window ? windowText(item.window.from, item.window.to) : '';
  const save = useSave((res) => onSaved(res, `${item.name}: due ${windowText(dueFrom, shownBy)}.`), onConflict);

  const submit = () => {
    const errors = pcpndtErrors({ reason });
    if (!dueFrom) errors.dueFrom = 'Please enter the first day it is due.';
    if (outside && tooShort(reason)) errors.reason ??= `This date is outside the guideline window (${windowWords}). Please give a reason.`;
    save.submit(() => changeItem(patient.id, item, { action: 'move', dueFrom, dueBy: dueBy || null, reason: reason.trim() }), errors);
  };

  const readout = gaRange(plan, dueFrom, shownBy);
  return (
    <PlanDialog
      id="plan-move"
      title={`${planNow ? 'Plan now' : 'Move date'}: ${item.name}`}
      save={save}
      shown={['dueFrom', 'dueBy', 'reason']}
      submitLabel={planNow ? 'Plan now' : 'Move date'}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <ItemHeading item={item} plan={plan} patient={patient} />
      <p className="hint">{guidelineWindow(item)}</p>
      <div className="form-grid">
        <Field label="Due from" id="move-from" error={save.fields.dueFrom}>
          <input id="move-from" type="date" value={dueFrom} min={toDateInput(plan.dayZero)} max={toDateInput(lastPlanDay(plan))} onChange={(e) => setDueFrom(e.target.value)} autoFocus />
        </Field>
        <Field label="Due by" id="move-by" error={save.fields.dueBy} hint="Empty: 6 days after “Due from”">
          <input id="move-by" type="date" value={dueBy} min={dueFrom > today ? dueFrom : today} max={toDateInput(lastPlanDay(plan))} onChange={(e) => setDueBy(e.target.value)} />
        </Field>
      </div>
      {readout && (
        <p className="plan-readout tabular" aria-live="polite">
          {readout}
          {outside && (
            <span className="plan-readout-warn">
              <TriangleAlert aria-hidden="true" /> Outside the guideline window
            </span>
          )}
        </p>
      )}
      <Field label={outside ? 'Reason (needed – outside the guideline window)' : 'Reason (optional)'} id="move-reason" error={save.fields.reason}>
        <input id="move-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-required={outside} />
      </Field>
    </PlanDialog>
  );
}

export function NotNeededDialog({ patient, plan, item, onSaved, onConflict, onCancel }) {
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const required = REASON_REQUIRED.includes(reasonCode);
  const save = useSave((res) => onSaved(res, `${item.name} marked not needed.`), onConflict);

  const submit = () => {
    const errors = pcpndtErrors({ reason });
    if (!reasonCode) errors.reasonCode = 'Please choose a reason.';
    if (required && tooShort(reason)) errors.reason ??= REASON_MESSAGE;
    save.submit(() => changeItem(patient.id, item, { action: 'not_needed', reasonCode, reason: reason.trim() }), errors);
  };

  return (
    <PlanDialog id="plan-not-needed" title={`Not needed: ${item.name}`} save={save} shown={['reasonCode', 'reason']} submitLabel="Mark not needed" onSubmit={submit} onCancel={onCancel}>
      <ItemHeading item={item} plan={plan} patient={patient} />
      <fieldset className="fieldset" aria-describedby={save.fields.reasonCode ? 'nn-code-error' : undefined}>
        <legend>Reason</legend>
        {Object.entries(NOT_NEEDED_REASONS).map(([code, label]) => (
          <label key={code} className="check" htmlFor={`nn-${code}`}>
            <input id={`nn-${code}`} type="radio" name="nn-reason" value={code} checked={reasonCode === code} onChange={() => setReasonCode(code)} />
            <span>
              {label}
              {NOT_NEEDED_HINTS[code] && <span className="muted"> ({NOT_NEEDED_HINTS[code]})</span>}
            </span>
          </label>
        ))}
        <FieldError id="nn-code-error">{save.fields.reasonCode}</FieldError>
      </fieldset>
      <Field label={required ? 'Why (needed for this reason)' : 'Why (optional)'} id="nn-reason" error={save.fields.reason}>
        <input id="nn-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-required={required} />
      </Field>
      <p className="hint help">Done at another centre? Use Mark done and tick “Done elsewhere”.</p>
    </PlanDialog>
  );
}

export function IncludeDialog({ patient, plan, item, onSaved, onConflict, onCancel }) {
  const [reason, setReason] = useState('');
  const save = useSave((res) => onSaved(res, `${item.name} included for this patient.`), onConflict);
  const submit = () => {
    const errors = pcpndtErrors({ reason });
    if (tooShort(reason)) errors.reason ??= REASON_MESSAGE;
    save.submit(() => changeItem(patient.id, item, { action: 'include', reason: reason.trim() }), errors);
  };
  return (
    <PlanDialog id="plan-include" title={`Include anyway: ${item.name}`} save={save} shown={['reason']} submitLabel="Include anyway" onSubmit={submit} onCancel={onCancel}>
      <ItemHeading item={item} plan={plan} patient={patient} />
      <p className="hint">The item stays in this patient's plan even if her recorded details say it does not apply. For: {APPLIES_LABELS[item.appliesWhen] ?? 'All patients'}.</p>
      <div className="plan-picks" role="group" aria-label="Quick reasons">
        {INCLUDE_PICKS.map((p) => (
          <button key={p} type="button" className="btn btn-secondary btn-sm" aria-pressed={reason === p} onClick={() => setReason(p)}>
            {p}
          </button>
        ))}
      </div>
      <Field label="Reason" id="include-reason" error={save.fields.reason}>
        <input id="include-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-required="true" autoFocus />
      </Field>
    </PlanDialog>
  );
}

export function NoteDialog({ patient, plan, item, onSaved, onConflict, onCancel }) {
  const [text, setText] = useState(item.note?.text ?? '');
  const save = useSave((res) => onSaved(res, text.trim() ? `Note saved for ${item.name}.` : `Note removed from ${item.name}.`), onConflict);
  const submit = () => save.submit(() => changeItem(patient.id, item, { action: 'note', text: text.trim() }), pcpndtErrors({ text }));
  return (
    <PlanDialog id="plan-note" title={`Note: ${item.name}`} save={save} shown={['text']} submitLabel="Save note" onSubmit={submit} onCancel={onCancel}>
      <ItemHeading item={item} plan={plan} patient={patient} />
      <Field label="Note" id="note-text" error={save.fields.text} hint="Leave empty to remove the note.">
        <textarea id="note-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} autoFocus />
      </Field>
    </PlanDialog>
  );
}

/**
 * "When" an item a doctor adds (or edits) is due: weeks (of pregnancy, or after delivery, birth …) or dates, with the
 * dates the weeks stand for, or the weeks the dates stand for, under the fields. id: the prefix of the field ids.
 */
function WhenFields({ id, plan, form, setForm, errors }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const weeks = form.timingType === 'weeks';
  const [from, to] = [Number.parseInt(form.fromWeek, 10), Number.parseInt(form.toWeek, 10)];
  const weeksValid = Number.isInteger(from) && Number.isInteger(to) && to >= from;
  const weeksDates = weeksValid ? windowText(addDays(plan.dayZero, 7 * from), addDays(plan.dayZero, 7 * to + 6)) : '';
  return (
    <>
      <fieldset className="fieldset">
        <legend>When</legend>
        <div className="row">
          <label className="check" htmlFor={`${id}-when-weeks`}>
            <input id={`${id}-when-weeks`} type="radio" name={`${id}-when`} checked={weeks} onChange={() => setForm((x) => ({ ...x, timingType: 'weeks' }))} />
            <span>{weeksLabel(plan)}</span>
          </label>
          <label className="check" htmlFor={`${id}-when-dates`}>
            <input id={`${id}-when-dates`} type="radio" name={`${id}-when`} checked={!weeks} onChange={() => setForm((x) => ({ ...x, timingType: 'date' }))} />
            <span>Dates</span>
          </label>
        </div>
      </fieldset>
      {weeks ? (
        <div className="form-grid">
          <Field label="From week" id={`${id}-from-week`} error={errors['timing.fromWeek']}>
            <input id={`${id}-from-week`} type="number" inputMode="numeric" min={0} max={maxPlanWeek(plan)} step={1} value={form.fromWeek} onChange={set('fromWeek')} />
          </Field>
          <Field label="To week" id={`${id}-to-week`} error={errors['timing.toWeek']} hint={weeksDates || undefined} keepHint>
            <input id={`${id}-to-week`} type="number" inputMode="numeric" min={0} max={maxPlanWeek(plan)} step={1} value={form.toWeek} onChange={set('toWeek')} />
          </Field>
        </div>
      ) : (
        <div className="form-grid">
          <Field label="Due from" id={`${id}-due-from`} error={errors['timing.dueFrom']} hint={gaRange(plan, form.dueFrom, form.dueBy) || undefined} keepHint>
            <input id={`${id}-due-from`} type="date" value={form.dueFrom} min={toDateInput(plan.dayZero)} max={toDateInput(lastPlanDay(plan))} onChange={set('dueFrom')} />
          </Field>
          <Field label="Due by" id={`${id}-due-by`} error={errors['timing.dueBy']} hint="Empty: 6 days after “Due from”">
            <input id={`${id}-due-by`} type="date" value={form.dueBy} min={toDateInput(plan.today)} max={toDateInput(lastPlanDay(plan))} onChange={set('dueBy')} />
          </Field>
        </div>
      )}
    </>
  );
}

const WHEN_FIELDS = ['timing.fromWeek', 'timing.toWeek', 'timing.dueFrom', 'timing.dueBy'];

/** Add an item to this patient's plan (Type, Name, When, text for the patient's copy, note, reason). */
export function AddItemDialog({ patient, plan, onSaved, onConflict, onCancel }) {
  const [clientRequestId] = useState(newRequestId);
  const [form, setForm] = useState(emptyItemForm);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useSave((res) => onSaved(res, `${form.name.trim()} added to the plan.`), onConflict);

  const submit = () => {
    const { timing, errors: whenErrors } = timingFromForm(form);
    const errors = { ...pcpndtErrors({ name: form.name, patientText: form.patientText, note: form.note, reason: form.reason }), ...whenErrors };
    if (!form.kind) errors.kind = 'Choose what kind of item this is.';
    if (!form.name.trim()) errors.name ??= 'Please give the item a name.';
    const body = {
      clientRequestId,
      kind: form.kind,
      name: form.name.trim(),
      patientText: form.patientText.trim(),
      note: form.note.trim(),
      reason: form.reason.trim(),
      timing,
    };
    save.submit(() => post(patient.id, '/items', body), errors);
  };

  const f = save.fields;
  return (
    <PlanDialog
      id="plan-add"
      title="Add item to this plan"
      wide
      save={save}
      shown={['kind', 'name', ...WHEN_FIELDS, 'patientText', 'note', 'reason']}
      submitLabel="Add item"
      onSubmit={submit}
      onCancel={onCancel}
    >
      <p className="hint help">The item is added for this patient only. To change the protocol for everyone, edit the template.</p>
      <div className="form-grid">
        <Field label="Type" id="add-kind" error={f.kind}>
          <select id="add-kind" value={form.kind} onChange={set('kind')} autoFocus>
            <option value="">Choose…</option>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {ITEM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" id="add-name" error={f.name} hint="e.g. Thyroid review">
          <input id="add-name" value={form.name} onChange={set('name')} maxLength={200} />
        </Field>
      </div>
      <WhenFields id="add" plan={plan} form={form} setForm={setForm} errors={f} />
      <Field label="Text for the patient's copy (optional)" id="add-patient-text" error={f.patientText}>
        <input id="add-patient-text" value={form.patientText} onChange={set('patientText')} maxLength={300} />
      </Field>
      <Field label="Note (optional)" id="add-note" error={f.note}>
        <textarea id="add-note" rows={2} value={form.note} onChange={set('note')} maxLength={1000} />
      </Field>
      <Field label="Reason for adding (optional)" id="add-reason" error={f.reason}>
        <input id="add-reason" value={form.reason} onChange={set('reason')} maxLength={300} />
      </Field>
    </PlanDialog>
  );
}

/**
 * Edit an item a doctor added to this plan (5 Oct 2026): its name, wording for the patient, due window and note –
 * instead of marking it not needed and adding it again. Not for an item of the protocol, nor once it is done (the
 * server refuses both). What it was stays in the item's history; the plan history and the audit log record the edit.
 */
export function EditItemDialog({ patient, plan, item, onSaved, onConflict, onCancel }) {
  const [form, setForm] = useState(() => itemForm(item));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const sent = editBody(form);
  const changes = editedFields(item, sent.body);
  const save = useSave((res) => onSaved(res, res.changed === false ? `${item.name}: nothing was changed.` : editedMessage(sent.body.name, changes)), onConflict);
  const submit = () => {
    const errors = { ...pcpndtErrors({ name: form.name, patientText: form.patientText, note: form.note }), ...sent.errors };
    save.submit(() => changeItem(patient.id, item, sent.body), errors);
  };
  const f = save.fields;
  const moved = item.manualDate ? windowText(item.manualDate.dueFrom, item.manualDate.dueBy) : '';
  return (
    <PlanDialog
      id="plan-edit"
      title={`Edit: ${item.name}`}
      wide
      save={save}
      shown={['name', ...WHEN_FIELDS, 'patientText', 'note']}
      submitLabel="Save changes"
      onSubmit={submit}
      onCancel={onCancel}
    >
      <ItemHeading item={item} plan={plan} patient={patient} />
      <p className="hint help">This item was added for this patient. Only this patient's plan changes; the item's history keeps what it was before.</p>
      <Field label="Name" id="edit-name" error={f.name}>
        <input id="edit-name" value={form.name} onChange={set('name')} maxLength={200} autoFocus />
      </Field>
      <WhenFields id="edit" plan={plan} form={form} setForm={setForm} errors={f} />
      {moved && (
        <p className="hint">
          Its date was moved to {moved}
          {item.manualDate.byName ? ` by ${item.manualDate.byName}` : ''}. A new due window replaces the moved date.
        </p>
      )}
      <Field label="Text for the patient's copy (optional)" id="edit-patient-text" error={f.patientText}>
        <input id="edit-patient-text" value={form.patientText} onChange={set('patientText')} maxLength={300} />
      </Field>
      <Field label="Note (optional)" id="edit-note" error={f.note} hint="Leave empty to remove the note.">
        <textarea id="edit-note" rows={2} value={form.note} onChange={set('note')} maxLength={1000} />
      </Field>
      {changes.length === 0 && <p className="muted">Nothing changed yet.</p>}
    </PlanDialog>
  );
}

/** Everything about one item, with Keep as planned for its flags and the item's history. */
export function ItemDetailsDialog({ patient, plan, item, onSaved, onConflict, onCancel }) {
  const save = useSave((res) => onSaved(res, `${item.name} kept as planned.`), onConflict);
  const keep = () => save.submit(() => changeItem(patient.id, item, { action: 'keep' }));
  const flags = (item.flags ?? []).filter((f) => FLAG_LABELS[f]);
  const repeats = flags.includes('possible_duplicate');
  const planned = item.window ? windowText(item.window.from, item.window.to) : '';
  const rows = [
    ['When', item.timingText],
    ['Guideline window', planned && `${item.gaWindow ? `${gaText(item.gaWindow.from)} – ${gaText(item.gaWindow.to)} · ` : ''}${planned}`],
    ['Due', item.due && `${windowText(item.due.from, item.due.to)}${item.manualDate ? ' (moved)' : ''}`],
    item.manualDate && ['Moved', `By ${item.manualDate.byName} on ${formatDate(item.manualDate.at)}${item.manualDate.reason ? ` – ${item.manualDate.reason}` : ''}`],
    ['For', `${APPLIES_LABELS[item.appliesWhen] ?? 'All patients'}${item.why && item.applies !== 'yes' ? ` – ${WHY_TEXT[item.why] ?? ''}` : ''}`],
    item.forceInclude && ['Included anyway', `By ${item.forceInclude.byName} on ${formatDate(item.forceInclude.at)} – ${item.forceInclude.reason}`],
    item.added && ['Added', `By ${item.added.byName} on ${formatDate(item.added.at)}${item.added.reason ? ` – ${item.added.reason}` : ''}`],
    item.notInTemplate && ['Template', `No longer in “${item.notInTemplate.templateName}” (version ${item.notInTemplate.version}); kept because staff changed it`],
    ['Patient copy', item.patientText],
    ['Source', item.source],
    item.done && [
      'Done',
      `${formatDate(item.done.on)}${item.done.gaOn ? ` (${gaText(item.done.gaOn)})` : ''}${item.done.elsewhere ? ' · elsewhere' : ''} · recorded by ${item.done.byName}`,
    ],
    item.done?.result && ['Result', item.done.result],
    item.done?.note && ['Note when done', item.done.note],
    item.notNeeded && [
      'Not needed',
      `${NOT_NEEDED_REASONS[item.notNeeded.reasonCode] ?? ''}${item.notNeeded.reason ? `: ${item.notNeeded.reason}` : ''} · ${item.notNeeded.byName}, ${formatDate(item.notNeeded.at)}`,
    ],
    item.note && ['Note', `${item.note.text} (${item.note.byName}, ${formatDate(item.note.at)})`],
  ].filter((r) => r && r[1]);
  const history = [...(item.history ?? [])].reverse();

  return (
    <PlanDialog id="plan-details" title={item.name} wide save={save} shown={[]} noSubmit cancelLabel="Close" onCancel={onCancel}>
      <ItemHeading item={item} plan={plan} patient={patient} />
      <dl className="details">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {flags.length > 0 && (
        <section className="plan-details-flags" aria-label="Checks">
          <div className="row">
            {flags.map((f) => (
              <StatusPill key={f} tone="watch" icon={f === 'possible_duplicate' ? CopyPlus : TriangleAlert}>
                {f === 'possible_duplicate' ? repeatLabel(item) : FLAG_LABELS[f]}
              </StatusPill>
            ))}
          </div>
          {plan.canEdit && canKeep(item) && (
            <>
              {repeats && (
                <p className="hint">
                  A protocol change added this item while the plan already had “{item.possibleDuplicate?.withName ?? 'another item'}”, which may be the same. Mark one
                  of the two not needed, or keep both as planned.
                </p>
              )}
              {flags.some((f) => ['check_date', 'no_longer_indicated'].includes(f)) && (
                <p className="hint">The dates or the patient's details changed after this item was moved or included. Check it, then keep it as planned.</p>
              )}
              <button type="button" className="btn btn-secondary" onClick={keep} disabled={save.saving}>
                <CircleCheck aria-hidden="true" /> {save.saving ? 'Saving…' : 'Keep as planned'}
              </button>
            </>
          )}
        </section>
      )}
      <h3 className="plan-dialog-sub">History</h3>
      {history.length === 0 ? (
        <p className="muted">Nothing recorded by staff yet.</p>
      ) : (
        <ul className="plain-list plan-log">
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <Avatar name={h.byName} />
              <div>
                <strong>{HISTORY_LABELS[h.action] ?? h.action}</strong>
                {historyDetail(h) && <span> – {historyDetail(h)}</span>}
                <div className="t-caption muted">
                  {h.byName} · {formatDateTime(h.at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PlanDialog>
  );
}

// What an item's history entry changed, in words: the new dates, the done date, the reason.
function historyDetail(h) {
  const parts = [];
  if (h.action === 'move' && h.to?.dueFrom) parts.push(windowText(h.to.dueFrom, h.to.dueBy));
  if (h.action === 'done' && h.to?.on) parts.push(formatDate(h.to.on));
  if (h.action === 'not_needed' && h.to?.reasonCode) parts.push(NOT_NEEDED_REASONS[h.to.reasonCode] ?? '');
  if (h.action === 'edit') parts.push(editHistoryText(h));
  if (h.action === 'keep' && h.from?.possibleDuplicate?.withName) parts.push(`beside “${h.from.possibleDuplicate.withName}”`);
  if (h.reason && h.reason !== HISTORY_LABELS[h.action]) parts.push(h.reason); // "Kept as planned" is the label already
  return parts.filter(Boolean).join(' · ');
}

// ---------- Plan dialogs ----------

// Field names in the protocol preview, in plain words.
const FIELD_WORDS = { name: 'name', patientText: 'patient text', source: 'source', appliesWhen: 'who it is for', timing: 'timing' };
const fieldWords = (fields) => [...new Set((fields ?? []).map((f) => FIELD_WORDS[f.split('.')[0]] ?? f))].join(', ');
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function PreviewList({ title, items, render, hint }) {
  if (!items?.length) return null;
  return (
    <section className="plan-preview-section">
      <h3 className="plan-dialog-sub">
        {title} ({items.length})
      </h3>
      {hint && <p className="hint">{hint}</p>}
      <ul className="plan-preview-list">
        {items.map((x, i) => (
          <li key={x.itemId ?? x.key ?? i}>{render(x)}</li>
        ))}
      </ul>
    </section>
  );
}

// A doctor's default protocol among the choices, as on the template list: "My default" (to its doctor) or "Default"
// while new plans start from it, "Default – not in use" (watch, with why) when they do not (a draft after an edit).
function DefaultMark({ template, meId }) {
  const pill = defaultPill(template, meId);
  if (!pill) return null;
  return (
    <StatusPill tone={pill.tone} icon={pill.icon} title={pill.title ?? undefined}>
      {pill.word}
    </StatusPill>
  );
}

/**
 * Change protocol, in two steps: 1. choose one of the protocols this plan may use; 2. review what would change
 * (the server works it out with the same function as the real change), then switch or update.
 * templateId: start at step 2 for this protocol (the "Review changes" link of an approved update).
 */
export function ChangeProtocolDialog({ patient, plan, templateId: startId = null, onSaved, onConflict, onCancel }) {
  const me = useAuth()?.user;
  const [chosen, setChosen] = useState(startId ?? '');
  const [step, setStep] = useState(startId ? 2 : 1);
  const options = useFetch(step === 1 ? `${planPath(patient.id)}/template-options` : null);
  const preview = useFetch(step === 2 && chosen ? `${planPath(patient.id)}/template-preview` : null, { templateId: chosen });
  // Only the preview of the protocol chosen now (useFetch keeps its last answer while the next one loads and
  // after it fails), so the button can never apply a protocol looked at before.
  const p = step === 2 ? previewFor(preview, chosen) : null;
  const previewError = step === 2 && !preview.loading ? preview.error : null;
  const update = p?.to?.id === plan.template.id;
  const save = useSave(
    (res) => onSaved(res, res.changed === false ? 'The plan already uses this version.' : update ? `Plan updated to version ${p.to.version}.` : `Plan switched to “${p.to.name}”.`),
    onConflict,
  );
  const [pickError, setPickError] = useState(null);

  const submit = () => {
    if (step === 1) {
      if (!chosen) {
        setPickError('Please choose a protocol.');
        return;
      }
      setStep(2);
      return;
    }
    if (!p) return;
    save.submit(() => api(`${planPath(patient.id)}/template`, { method: 'PUT', body: { templateId: p.to.id, fromItemsHash: p.from.itemsHash, toItemsHash: p.to.itemsHash } }));
  };

  const list = options.data?.templates ?? [];
  const nothingChanges = p && !p.added.length && !p.changed.length && !p.kept.length && !p.dropped.length;
  return (
    <PlanDialog
      id="plan-protocol"
      title={step === 1 ? 'Change protocol' : update ? `Update to version ${p?.to.version ?? ''}` : 'Review the changes'}
      wide
      save={save}
      submitLabel={step === 1 ? 'Review changes' : !p && !previewError ? 'Working out the changes…' : update ? 'Update plan' : 'Switch to this protocol'}
      savingLabel="Updating…"
      submitDisabled={step === 2 && !p}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {step === 1 ? (
        <>
          <p className="hint help">Done items, moved dates, notes and items added for this patient are kept. You see every change before anything is saved.</p>
          <Alert type="error">{options.error}</Alert>
          {options.loading && !options.data && <p className="muted">Loading the protocols…</p>}
          {options.data && list.length === 0 && <p className="muted">No other protocol with items is available for this patient.</p>}
          <fieldset className="fieldset" aria-describedby={pickError ? 'protocol-error' : undefined}>
            <legend className="sr-only">Protocol</legend>
            {list.map((t) => (
              <label key={t.id} className={`role-option ${chosen === t.id ? 'checked' : ''} plan-protocol-option`} htmlFor={`protocol-${t.id}`}>
                <input id={`protocol-${t.id}`} type="radio" name="protocol" checked={chosen === t.id} onChange={() => setChosen(t.id)} />
                <span>
                  <strong>{t.name}</strong>
                  <small>
                    {/* "My protocol" for the doctor's own, as on the template list (beside "My default") */}
                    {templateOwnerLabel(t, me?.id)} · version {t.version} · {count(t.itemCount, 'item')}
                  </small>
                  <span className="row">
                    {t.contentApproved ? (
                      <StatusPill tone="stable">Approved · v{t.version}</StatusPill>
                    ) : (
                      <StatusPill tone="watch" icon={TriangleAlert}>
                        Draft
                      </StatusPill>
                    )}
                    {t.inUse && <StatusPill tone="neutral">In use</StatusPill>}
                    <DefaultMark template={t} meId={me?.id} />
                  </span>
                </span>
              </label>
            ))}
            <FieldError id="protocol-error">{pickError}</FieldError>
          </fieldset>
        </>
      ) : (
        <>
          <Alert type="error">{previewError}</Alert>
          {!p && !previewError && <p className="muted">Working out the changes…</p>}
          {p && (
            <>
              <p>
                From “{p.from.name}” version {p.from.version} to “{p.to.name}” version {p.to.version}.
              </p>
              {!p.to.contentApproved && (
                <Alert type="warning">This protocol is a draft – the plan will be marked “Draft – not approved for clinical use”.</Alert>
              )}
              {p.possibleDuplicates.length > 0 && (
                <Alert type="warning">
                  <strong>Possible duplicates.</strong> After the change each added item is marked “May repeat” on the plan until you keep it or mark one of
                  the pair not needed:
                  <ul className="plan-error-list">
                    {p.possibleDuplicates.map((d) => (
                      <li key={`${d.key}-${d.withItemId}`}>
                        “{d.name}” and “{d.withName}”
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              {nothingChanges && <p className="muted">No item changes – only the protocol's name and version are updated.</p>}
              <PreviewList
                title="Added"
                items={p.added}
                hint={p.needsDecision.length ? `${count(p.needsDecision.length, 'item needs', 'items need')} a decision – their window has passed.` : null}
                render={(a) => (
                  <>
                    <span className="strong-name">{a.name}</span> <span className="muted">· {ITEM_KIND_LABELS[a.kind] ?? a.kind} · {a.timingText}</span>
                  </>
                )}
              />
              <PreviewList
                title="Changed"
                items={p.changed}
                hint="Dates you moved are kept – check them."
                render={(c) => (
                  <>
                    <span className="strong-name">{c.name}</span> <span className="muted">· {fieldWords(c.fields)}</span>
                    {c.keepsDoctorDate && <span className="muted"> · the moved date is kept</span>}
                  </>
                )}
              />
              <PreviewList
                title="Kept because they have staff changes"
                items={p.kept}
                render={(k) => (
                  <>
                    <span className="strong-name">{k.name}</span>
                    {KEPT_WHY[k.why] && <span className="muted"> · {KEPT_WHY[k.why]}</span>}
                  </>
                )}
              />
              <PreviewList title="Removed (not started)" items={p.dropped} render={(d) => d.name} />
              <p className="muted tabular">
                Unchanged: {count(p.unchanged, 'item')}
                {p.customKept > 0 && ` · ${count(p.customKept, 'item')} added for this patient, kept`}
              </p>
            </>
          )}
          {/* Also after a failed preview, and when the dialog opened straight at step 2 ("Review changes") */}
          <button
            type="button"
            className="btn btn-link"
            onClick={() => {
              setPickError(null);
              setStep(1);
            }}
          >
            Choose another protocol
          </button>
        </>
      )}
    </PlanDialog>
  );
}

export function BookingDateDialog({ patient, plan, onSaved, onConflict, onCancel }) {
  const [bookedOn, setBookedOn] = useState(toDateInput(plan.bookedOn));
  const save = useSave((res) => onSaved(res, `Booking date changed to ${formatDate(bookedOn)}.`), onConflict);
  const submit = () =>
    save.submit(
      () => api(planPath(patient.id), { method: 'PATCH', body: { bookedOn, previousBookedOn: toDateInput(plan.bookedOn) } }),
      bookedOn ? {} : { bookedOn: 'Please enter the booking date.' },
    );
  return (
    <PlanDialog id="plan-booking" title="Change booking date" save={save} shown={['bookedOn']} submitLabel="Change booking date" onSubmit={submit} onCancel={onCancel}>
      <p className="hint help">
        Items due at the first visit are counted from this date. Items due since this date that were done but not recorded will show as Overdue – mark them done.
      </p>
      <Field
        label="Booking date"
        id="booking-date"
        error={save.fields.bookedOn}
        hint={`From ${formatDate(plan.minBookedOn)} (${gaText(gaOn(plan.edd, plan.minBookedOn))}) to today, ${formatDate(plan.today)}.${bookedOn ? ` Booked at ${gaRange(plan, bookedOn, bookedOn)}.` : ''}`} keepHint
      >
        <input id="booking-date" type="date" value={bookedOn} min={toDateInput(plan.minBookedOn)} max={toDateInput(plan.today)} onChange={(e) => setBookedOn(e.target.value)} autoFocus />
      </Field>
    </PlanDialog>
  );
}

/** "Same pregnancy – move the dates" or "New pregnancy – start a new plan", after the EDD moved by more than 8 weeks. */
export function EddDecisionDialog({ patient, plan, decision, onSaved, onConflict, onCancel }) {
  const toEdd = toDateInput(plan.eddReview.toEdd);
  const same = decision === 'same_pregnancy';
  const done = plan.counts?.done ?? 0;
  const save = useSave(
    (res) => onSaved(res, same ? `The plan now follows the new EDD (${formatDate(toEdd)}).` : 'A new care plan was started. The earlier plan is kept read-only under Earlier care plans.', { reload: !same }),
    onConflict,
  );
  const submit = () => save.submit(() => post(patient.id, '/edd-decision', { decision, toEdd }));
  return (
    <PlanDialog
      id="plan-edd"
      title={same ? 'Same pregnancy – move the dates' : 'New pregnancy – start a new plan'}
      save={save}
      submitLabel={same ? 'Move the dates' : 'Start a new plan'}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {same ? (
        <p>
          Move the plan to the new EDD ({formatDate(toEdd)})? Items not yet done get new due dates; dates you moved stay and are marked “Check date”.
        </p>
      ) : (
        <p>
          Start a new plan for the pregnancy with EDD {formatDate(toEdd)}? The current plan is closed and kept read-only under Earlier care plans.{' '}
          {count(done, 'item')} marked done stay in the old plan and are not carried over.
        </p>
      )}
    </PlanDialog>
  );
}

export function ClosePlanDialog({ patient, onSaved, onConflict, onCancel }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const save = useSave((res) => onSaved(res, 'Care plan closed. It is kept under Earlier care plans and can be reopened.', { reload: true }), onConflict);
  const submit = () => {
    const errors = pcpndtErrors({ note });
    if (!reason) errors.reason = 'Please choose a reason.';
    if (reason === 'other' && tooShort(note)) errors.note ??= REASON_MESSAGE;
    save.submit(() => post(patient.id, '/close', { reason, note: note.trim() }), errors);
  };
  return (
    <PlanDialog id="plan-close" title="Close care plan" save={save} shown={['reason', 'note']} submitLabel="Close plan" savingLabel="Closing…" submitClass="btn-danger" onSubmit={submit} onCancel={onCancel}>
      <p>Reminders for this pregnancy stop. The plan stays in the record and can be reopened.</p>
      <Field label="Reason" id="close-reason" error={save.fields.reason}>
        <select id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
          <option value="">Choose…</option>
          {USER_CLOSE_REASONS.map((r) => (
            <option key={r} value={r}>
              {CLOSE_REASONS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={reason === 'other' ? 'Note (needed for Other)' : 'Note (optional)'} id="close-note" error={save.fields.note}>
        <textarea id="close-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
    </PlanDialog>
  );
}

/** Reopen a closed plan of this patient (it becomes the current plan again). */
export function ReopenPlanDialog({ patient, plan, onSaved, onConflict, onCancel }) {
  const save = useSave((res) => onSaved(res, 'Care plan reopened.', { reopened: true }), onConflict);
  const submit = () => save.submit(() => post(patient.id, '/reopen', { planId: plan.id }));
  return (
    <PlanDialog id="plan-reopen" title="Reopen care plan" save={save} submitLabel="Reopen plan" onSubmit={submit} onCancel={onCancel}>
      <p>
        This plan ({isAntenatalPlan(plan) ? `EDD ${formatDate(plan.edd)}` : `from ${formatDate(plan.dayZero)}`}) becomes the patient's current care plan again. Its dates follow the patient's details now: if the EDD has changed a lot,
        it waits for a decision on the new dates.
      </p>
    </PlanDialog>
  );
}
