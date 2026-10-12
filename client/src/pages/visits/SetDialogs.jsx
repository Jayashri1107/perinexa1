import { useState } from 'react';
import { BookmarkPlus, ListPlus } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { CARE_TYPES, CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { LOSS_SETS_NOTE, SetContents, SetStatus, lossSetWarning, setMedicinesText } from './PrescriptionSetParts.jsx';
import { toItem } from './rxRows.js';

// The Prescription tab's dialogs for ready-made prescription sets (Feature 8b): choosing a set to add, and
// saving what is on screen as a new set of the hospital's own.

const forCare = (set, careType) => !set.careTypes.length || set.careTypes.includes(careType);
const matches = (set, q) => !q || [set.name, ...set.items.map((it) => it.drug)].some((t) => t.toLowerCase().includes(q));

function SetOption({ set, checked, onChoose }) {
  const id = `rxs-opt-${set.id}`;
  return (
    <label className={`rxs-option ${checked ? 'checked' : ''}`.trim()} htmlFor={id}>
      <input id={id} type="radio" name="rxs-set" checked={checked} onChange={() => onChoose(set.id)} />
      <span className="rxs-option-text">
        <span className="rxs-option-name">{set.name}</span>
        <span className="rxs-option-meds">{setMedicinesText(set)}</span>
        {set.status === 'draft' && <SetStatus set={set} />}
      </span>
    </label>
  );
}

/**
 * Choose a set, see what it holds, and add it: onAdd(set). Sets for the patient's type of care come first.
 * rows: the medicines already on the prescription (the set's version replaces the same medicine).
 */
export function SetPicker({ patient, rows, careLabel, onAdd, onCancel }) {
  const { data, error, loading } = useFetch('/prescription-sets');
  const [query, setQuery] = useState('');
  const [chosenId, setChosenId] = useState(null);
  const ref = useDialogFocus(onCancel);
  const q = query.trim().toLowerCase();
  const inUse = (data?.sets ?? []).filter((s) => s.isActive);
  const hers = inUse.filter((s) => forCare(s, patient.careType) && matches(s, q));
  const others = inUse.filter((s) => !forCare(s, patient.careType) && matches(s, q));
  const chosen = inUse.find((s) => s.id === chosenId) ?? null;

  const add = (e) => {
    e.preventDefault();
    if (chosen) onAdd(chosen);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal rxs-picker" role="dialog" aria-modal="true" aria-labelledby="rxs-picker-title" onSubmit={add}>
        <h2 id="rxs-picker-title">Add a ready-made set</h2>
        <p className="hint help">
          The set's medicines are added to this prescription, and its tests and advice to Visit details. Nothing is saved until you save – change anything
          first.
        </p>
        {patient.careType === 'abortion' && <p className="hint help">{LOSS_SETS_NOTE}</p>}
        <Alert type="error">{error}</Alert>
        <div className="rxs-picker-body">
          <div>
            <Field label="Find a set or a medicine" id="rxs-find">
              <input id="rxs-find" type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            <div className="rxs-list" role="radiogroup" aria-label="Prescription sets">
              {loading && !data && <p className="muted">Loading the sets…</p>}
              {data && hers.length + others.length === 0 && <p className="muted">{q ? 'No set matches.' : 'No sets are in use yet.'}</p>}
              {hers.length > 0 && <p className="rxs-group">For {careLabel} patients</p>}
              {hers.map((s) => (
                <SetOption key={s.id} set={s} checked={s.id === chosenId} onChoose={setChosenId} />
              ))}
              {others.length > 0 && <p className="rxs-group">Other sets</p>}
              {others.map((s) => (
                <SetOption key={s.id} set={s} checked={s.id === chosenId} onChoose={setChosenId} />
              ))}
            </div>
          </div>
          <div className="rxs-preview" aria-live="polite">
            {chosen ? (
              <>
                <h3 className="rxs-preview-title">{chosen.name}</h3>
                {lossSetWarning(chosen, patient) && <Alert type="warning">{lossSetWarning(chosen, patient)}</Alert>}
                {chosen.status === 'draft' ? (
                  <Alert type="warning">
                    <strong>Draft – no doctor has approved this set yet.</strong> Check every medicine and dose before saving the prescription.
                  </Alert>
                ) : (
                  <p className="hint">Approved by {chosen.approvedByName}.</p>
                )}
                <SetContents set={chosen} rows={rows} detailsNote="Added to Visit details:" headingId="rxs-pick" />
                {chosen.about && (
                  <>
                    <h3 className="rxs-sub">Notes for doctors (not printed)</h3>
                    <p className="pre-line hint">{chosen.about}</p>
                  </>
                )}
              </>
            ) : (
              <p className="muted rxs-preview-empty">Choose a set to see what it adds.</p>
            )}
          </div>
        </div>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!chosen}>
            <ListPlus aria-hidden="true" /> Add to prescription
          </button>
        </div>
      </form>
    </div>
  );
}

/** Save the medicines and general instructions on screen as a new draft set in the hospital's library (doctors). */
export function SaveAsSetDialog({ patient, rows, notes, onSaved, onCancel }) {
  const [name, setName] = useState('');
  const [careTypes, setCareTypes] = useState([patient.careType]);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const toggle = (t) => setCareTypes((c) => (c.includes(t) ? c.filter((x) => x !== t) : CARE_TYPES.filter((x) => x === t || c.includes(x))));

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setFields({ name: 'Give the set a name' });
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const res = await api('/prescription-sets', { method: 'POST', body: { name, careTypes, items: rows.map(toItem), notes } });
      onSaved(res.set);
    } catch (err) {
      setSaving(false);
      setError(err.message);
      setFields(err.fields ?? {});
    }
  };

  const n = rows.length;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="rxs-save-title" onSubmit={save} noValidate>
        <h2 id="rxs-save-title">Save as a ready-made set</h2>
        <p>
          The {n === 1 ? 'medicine' : `${n} medicines`}
          {notes.trim() ? ' and the general instructions' : ''} on screen become a new <strong>draft</strong> set in the hospital's library, for every doctor
          and RMO. Check that nothing in it is about this patient only.
        </p>
        <Alert type="error">{error}</Alert>
        {Object.keys(fields).some((k) => k.startsWith('items.')) && <Alert type="warning">Some medicines need changes first. Close this box and check them.</Alert>}
        <Field label="Name of the set" id="rxs-save-name" error={fields.name} hint="e.g. PCOS – my usual first visit">
          <input id="rxs-save-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="fieldset">
          <legend>For which types of care</legend>
          <div className="check-grid">
            {CARE_TYPES.map((t) => (
              <label key={t} className="check" htmlFor={`rxs-save-care-${t}`}>
                <input id={`rxs-save-care-${t}`} type="checkbox" checked={careTypes.includes(t)} onChange={() => toggle(t)} />
                <span>{CARE_TYPE_SHORT[t]}</span>
              </label>
            ))}
          </div>
          <p className="hint help">Sets for the patient's type of care are offered first. Tick none for every type.</p>
        </fieldset>
        <p className="hint help">Tests and advice can be added on the set's page (Prescription sets in the left menu), where a doctor also approves it.</p>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <BookmarkPlus aria-hidden="true" /> {saving ? 'Saving…' : 'Save as a set'}
          </button>
        </div>
      </form>
    </div>
  );
}
