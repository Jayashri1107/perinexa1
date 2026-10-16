import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Copy, ListPlus, Plus, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, Field, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useUndo } from '../../components/Undo.jsx';
import { onReturnToPage } from '../../hooks/onReturnToPage.js';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { listWords } from '../consents/consentFormat.js';
import { MedSafetyPill, MedicineSafetyPanel } from '../medsafety/MedicineSafetyPanel.jsx';
import { babyAgeText, babyOnVisit, breastfeedingOnVisit, medicineWarnings, needsReason, notCovered, pregnancyOnVisit } from '../medsafety/medSafety.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { MedicineRows } from './MedicineRows.jsx';
import { RxDictation } from './RxDictation.jsx';
import { MEDICINES } from './medicines.js';
import { instructionLine, medicineName } from './rxFormat.js';
import { addSet, emptyRow, isBlankRow, rowProblems, sameRows, toItem, toRow } from './rxRows.js';
import { useStockStatus } from './rxStock.js';
import { focusLastMedicine, keyboardEntry } from './keyboardEntry.js';
import { SaveAsSetDialog, SetPicker } from './SetDialogs.jsx';

// The Prescription tab (Feature 8): the medicines of this visit, in order. Quick to fill: medicine names are
// suggested from the doctor's own recent medicines (with "Your usual", the way they last wrote it) and from a
// list of common OBGY medicines (names, forms and strengths only – never doses); a ready-made set from the
// hospital's library adds its medicines here and its tests and advice to Visit details (onAppendDetails), and a
// doctor can save what is on screen as a new set. Each row shows how it will print, and – when the hospital keeps
// medicines in the Pharmacy module – whether the medicine is in the pharmacy. Saved as a whole, only if
// nobody saved it meanwhile. The treating doctor or an RMO writes it. The parent remounts this form (key) after
// a save; through `ref` it can save the form before printing ({ pending(), save() }), and `printAction` is its print
// button, shown next to Save. `onRecheckPatient` reads the patient's record again (what is typed here stays): used
// when breastfeeding is not recorded and may just have been recorded in her details.

/** "Added from “Anaemia in pregnancy”: 1 medicine added; IFA replaced by the set's version. …" */
function addedText({ set, added, replaced }) {
  const parts = [
    added.length > 0 && `${added.length} ${added.length === 1 ? 'medicine' : 'medicines'} added`,
    replaced.length > 0 && `${listWords(replaced)} replaced by the set's version`,
  ].filter(Boolean);
  const toDetails = [set.investigations && 'tests', set.advice && 'advice'].filter(Boolean);
  return [
    `Added from “${set.name}”${parts.length ? `: ${parts.join('; ')}` : ''}.`,
    set.notes ? 'Its general instructions were added below.' : '',
    toDetails.length ? `Its ${listWords(toDetails)} ${toDetails.length > 1 ? 'were' : 'was'} added to Visit details.` : '',
    `Check everything, then save${toDetails.length ? ' both tabs' : ''}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The medicine safety warnings the doctor went ahead with, and why (shown with the saved prescription). */
function WarningReasons({ list }) {
  if (!list?.length) return null;
  return (
    <div className="ms-reasons">
      <h3>Medicine safety warnings – gone ahead with</h3>
      <ul className="rf-list">
        {list.map((w) => (
          <li key={w.key}>
            <MedSafetyPill level={w.level} />
            <span className="rf-text">
              <strong>{w.title}</strong>
              {w.medicines.length > 0 && <span className="muted"> – {w.medicines.join(', ')}</span>}
              <span className="rf-message">Reason: {w.reason}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PrescriptionForm({
  patient,
  page,
  recent,
  onSaved,
  onConflict,
  onDirty,
  draft = null,
  onDraft = null,
  onAppendDetails,
  addMedicine = null,
  onMedicineAdded,
  canAddSets,
  printAction = null,
  onRecheckPatient = null,
  ref,
}) {
  const { visit, access, previousPrescription: prev } = page;
  const rx = visit.prescription;
  const canEdit = visit.status === 'active' && access.canEdit;
  // A prescription with no medicines yet starts with one empty row to type into (an empty row is never saved)
  // draft: the person's own unsaved typing, put back (doctor ideas #4 – visitDraft.js)
  const [rows, setRows] = useState(() => (Array.isArray(draft?.rows) && draft.rows.length ? draft.rows : rx.items.length || !(visit.status === 'active' && access.canEdit) ? rx.items.map(toRow) : [emptyRow()]));
  const filled = rows.filter((r) => !isBlankRow(r));
  const [notes, setNotes] = useState(typeof draft?.notes === 'string' ? draft.notes : rx.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [picking, setPicking] = useState(false);
  const [savingSet, setSavingSet] = useState(false);
  const [setNotice, setSetNotice] = useState(null); // { type, text, setId? }
  const undo = useUndo(); // Undo for replacing the medicines (doctor ideas #5)

  const initial = useMemo(() => rx.items.map(toRow), [rx.items]);
  // Why the doctor goes ahead despite an Avoid or Allergy warning, by warning (kept from the last save)
  const savedReasons = useMemo(() => Object.fromEntries((rx.warningReasons ?? []).map((w) => [w.key, w.reason])), [rx.warningReasons]);
  const [reasons, setReasons] = useState(savedReasons);

  // The doctor's own medicines first (as they last wrote them), then the common list.
  const usual = useMemo(() => new Map((recent ?? []).map((m) => [m.drug.toLowerCase(), m])), [recent]);
  const names = useMemo(() => [...new Set([...(recent ?? []).map((m) => m.drug), ...MEDICINES.map((m) => m.name)])], [recent]);
  const add = () => setRows((rs) => [...rs, emptyRow()]);

  // Medicine safety (Smart features): warnings while writing, from the hospital's list, the recorded allergies and
  // who the patient is on the visit's date – weeks of pregnancy (antenatal), breastfeeding (postnatal), a baby's age
  // and weight (newborn care) – and the dose worked out from what is typed. They never stop saving.
  const safety = useFetch(canEdit ? '/medicine-safety' : null);
  const entries = safety.data?.list?.entries;
  const { pregnant, weeks } = pregnancyOnVisit(patient, visit.visitOn);
  const breastfeeding = breastfeedingOnVisit(patient);
  const baby = useMemo(() => babyOnVisit(patient, visit), [patient, visit]);
  const warnings = useMemo(
    () => medicineWarnings({ rows, list: entries ?? [], weeks, pregnant, allergies: patient.medical?.allergies ?? '', breastfeeding, baby }),
    [rows, entries, weeks, pregnant, patient.medical?.allergies, breastfeeding, baby],
  );
  // Who the list's entries apply to, in a few words (the panel's heading)
  const safetyContext = pregnant
    ? weeks != null
      ? `${weeks} weeks pregnant`
      : 'pregnant'
    : breastfeeding
      ? breastfeeding === 'yes'
        ? 'breastfeeding'
        : 'breastfeeding not recorded'
      : baby
        ? baby.calendarDays != null
          ? `baby, ${babyAgeText(baby.calendarDays)}`
          : 'baby'
        : '';
  // What the hospital's list has no entries for (a list a doctor approved or changed is not given new kinds of entries
  // by itself): said on the form, so that "no warnings" is never read as "checked".
  const missing = useMemo(() => notCovered(entries, { pregnant, breastfeeding, baby }), [entries, pregnant, breastfeeding, baby]);
  const anyMedicine = rows.some((r) => r.drug.trim());
  const hasDoseLimits = Boolean(entries) && !missing.doses;
  // Breastfeeding not recorded: the warning links to her details, in a new tab. Coming back to this page then reads her
  // record again (once the link was followed), so the answer counts here at once and nothing typed here is lost.
  const wentToRecord = useRef(false);
  const askAgain = canEdit && breastfeeding === 'unknown' && onRecheckPatient ? onRecheckPatient : null;
  useEffect(() => {
    if (!askAgain) return undefined;
    return onReturnToPage(() => {
      if (wentToRecord.current) askAgain();
    });
  }, [askAgain]);
  // Pharmacy stock (only "in the pharmacy" or "not in stock", and only for a confident match)
  const stockOf = useStockStatus(rows, canEdit);
  // Avoid and Allergy warnings need a one-line reason to go ahead (recorded with the prescription); a Caution or a
  // dose warning does not.
  const needReason = warnings.filter(needsReason);
  const reasonsChanged = Boolean(safety.data) && (needReason.some((w) => (reasons[w.key] ?? '').trim() !== (savedReasons[w.key] ?? '')) || needReason.length !== (rx.warningReasons ?? []).length);
  const dirty = canEdit && (!sameRows(filled, initial) || notes !== rx.notes || (filled.length > 0 && reasonsChanged));
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => onDraft?.(dirty ? { rows, notes } : null), [dirty, rows, notes, onDraft]);

  // A medicine from the care plan: added as a new line (unless it is already there) with only its name – the
  // doctor fills in the dose and duration before saving.
  useEffect(() => {
    if (!addMedicine) return;
    if (canEdit) {
      setRows((rs) => (rs.some((r) => r.drug.trim().toLowerCase() === addMedicine.name.trim().toLowerCase()) ? rs : [...rs, { ...emptyRow(), drug: addMedicine.name }]));
    }
    onMedicineAdded?.();
  }, [addMedicine, canEdit, onMedicineAdded]);

  // "Same as last visit" (doctor ideas #2): the last visit's medicines and instructions here, its advice in Visit
  // details – the doctor changes only what differs, then saves.
  // The medicines typed here are replaced at once, with Undo (doctor ideas #5) – nothing saved changes.
  const copyPrevious = () => {
    if (filled.length) {
      const before = { rows, notes };
      undo.offer(`The medicines here were replaced by those of ${formatDate(prev.visitOn)}.`, () => {
        setRows(before.rows);
        setNotes(before.notes);
      });
    }
    setRows(prev.items.map(toRow));
    if (!notes && prev.notes) setNotes(prev.notes);
    if (prev.advice?.trim()) onAppendDetails({ advice: prev.advice });
    setSetNotice({ type: 'info', text: `Copied from ${formatDate(prev.visitOn)}: ${prev.items.length} ${prev.items.length === 1 ? 'medicine' : 'medicines'}${prev.advice?.trim() ? ', and its advice in Visit details' : ''}. Change what differs, then save${prev.advice?.trim() ? ' both tabs' : ''}.` });
  };

  const addFromSet = (set) => {
    const result = addSet({ rows: filled, notes }, set);
    if (result.rows.length > 40) {
      setPicking(false);
      setSetNotice({ type: 'warning', text: `“${set.name}” was not added: a prescription can have at most 40 medicines.` });
      return;
    }
    setRows(result.rows);
    setNotes(result.notes);
    if (set.investigations || set.advice) onAppendDetails({ investigations: set.investigations, advice: set.advice });
    setPicking(false);
    setFields({});
    const text = addedText({ set, ...result });
    setSetNotice(
      set.status === 'draft'
        ? { type: 'warning', text: `${text} This set is a draft – no doctor has approved it yet: check every medicine and dose.` }
        : { type: 'info', text },
    );
  };

  // "AI dictation": the dictated medicines are added like a set – same medicine replaced, others at the end.
  const addDictated = ({ items, notes: said }) => {
    if (!items.length && !said) {
      setSetNotice({ type: 'warning', text: 'No medicines were understood in the recording. Please try again, or type them.' });
      return;
    }
    const result = addSet({ rows: filled, notes }, { items, notes: said });
    if (result.rows.length > 40) {
      setSetNotice({ type: 'warning', text: 'The recorded medicines were not added: a prescription can have at most 40 medicines.' });
      return;
    }
    setRows(result.rows.length ? result.rows : [emptyRow()]);
    setNotes(result.notes);
    setFields({});
    const parts = [
      result.added.length > 0 && `${result.added.length} ${result.added.length === 1 ? 'medicine' : 'medicines'} added`,
      result.replaced.length > 0 && `${listWords(result.replaced)} replaced`,
    ].filter(Boolean);
    setSetNotice({
      type: 'warning',
      text: `From your recording: ${parts.join('; ') || 'nothing added'}.${said ? ' General instructions were added below.' : ''} Written by AI – check every medicine, dose and duration, then save.`,
    });
  };

  // What must be fixed before saving (or saving as a set): the same checks as the server.
  // Empty rows are dropped first, so the highlighted rows match what is checked.
  const problems = () => {
    if (filled.length !== rows.length) setRows(filled);
    const local = rowProblems(filled, { checkFetalSex: patient.careType !== 'newborn' });
    if (patient.careType !== 'newborn' && mentionsFetalSex(notes)) local.notes = PCPNDT_MESSAGE;
    return local;
  };
  const reasonProblems = () => {
    const out = {};
    for (const w of needReason) {
      const r = (reasons[w.key] ?? '').trim();
      if (r.length < 3) out[`warning:${w.key}`] = 'Write why you are going ahead, or change the medicine.';
      else if (patient.careType !== 'newborn' && mentionsFetalSex(r)) out[`warning:${w.key}`] = PCPNDT_MESSAGE;
    }
    return out;
  };

  const startSaveAsSet = () => {
    const local = problems();
    if (Object.keys(local).length) {
      setFields(local);
      setError('Please check the highlighted medicines before saving them as a set.');
      return;
    }
    setFields({});
    setError(null);
    setSavingSet(true);
  };

  // Saves the prescription. Returns the visit as saved, or null (the form shows what to fix).
  const saveNow = async () => {
    setError(null);
    const local = problems();
    if (Object.keys(local).length) {
      setFields(local);
      setError('Please check the highlighted medicines.');
      return null;
    }
    const why = reasonProblems();
    if (Object.keys(why).length) {
      setFields(why);
      setError('A medicine safety warning needs your reason before saving (Medicine safety, under the medicines).');
      return null;
    }
    setSaving(true);
    setFields({});
    const warningReasons = needReason.map((w) => ({ key: w.key.slice(0, 200), level: w.level, title: w.title.slice(0, 300), medicines: w.medicines.slice(0, 10).map((m) => m.slice(0, 120)), reason: reasons[w.key].trim() }));
    try {
      const res = await api(`/patients/${patient.id}/visits/${visit.id}/prescription`, { method: 'PUT', body: { rev: rx.rev, items: filled.map(toItem), notes, warningReasons } });
      onSaved(res, `Prescription saved – ${filled.length} ${filled.length === 1 ? 'medicine' : 'medicines'}.`);
      return res;
    } catch (err) {
      setSaving(false);
      // (the record was marked as a duplicate meanwhile: the refusal is shown here and the medicines typed stay on
      // the screen, to be written on the main record – nothing is reloaded)
      if (err.status === 409 && err.code !== 'DUPLICATE_RECORD') {
        onConflict(err.message);
        return null;
      }
      setError(err.message);
      setFields(err.fields ?? {});
      return null;
    }
  };
  const save = (e) => {
    e.preventDefault();
    saveNow();
  };
  useImperativeHandle(ref, () => ({ pending: () => dirty, save: saveNow }));

  if (!canEdit) {
    return (
      <section className="card vs-section">
        <h2>Prescription</h2>
        {rx.byName && (
          <p className="hint vs-byline">
            By {rx.byName} · {formatDateTime(rx.at)}
          </p>
        )}
        {rx.items.length ? (
          <ol className="vs-rx-read">
            {rx.items.map((it) => (
              <li key={it.id}>
                <strong>{medicineName(it)}</strong>
                <span className="vs-rx-line">{instructionLine(it)}</span>
                {it.instructions && <span className="vs-rx-line muted">{it.instructions}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No medicines prescribed at this visit.</p>
        )}
        {rx.notes && <p className="pre-line">{rx.notes}</p>}
        <WarningReasons list={rx.warningReasons} />
      </section>
    );
  }

  // The dialogs are forms of their own: they sit beside this form, never inside it (no nested forms).
  return (
    <>
      <form
        className="vs-form"
        onSubmit={save}
        noValidate
        onKeyDown={keyboardEntry({
          onLastEnter: () => {
            if (rows.length >= 40) return;
            add();
            focusLastMedicine();
          },
        })}
      >
        <Alert type="error">{error}</Alert>
        {setNotice && (
          <Alert type={setNotice.type} onClose={() => setSetNotice(null)}>
            {setNotice.text}
            {setNotice.setId && (
              <>
                {' '}
                <Link to={`/prescription-sets/${setNotice.setId}`} target="_blank" rel="noreferrer">
                  Open the set in a new tab
                </Link>
              </>
            )}
          </Alert>
        )}
        <section className="card vs-section">
          <div className="vs-section-head">
            <div>
              <h2>Prescription</h2>
              <p className="hint vs-byline">{rx.byName ? `Last saved by ${rx.byName} · ${formatDateTime(rx.at)}` : 'Not saved yet.'}</p>
            </div>
            <div className="row vs-rx-actions">
              <RxDictation onMedicines={addDictated} onError={setError} disabled={rows.length >= 40} />
              {prev && (
                <button type="button" className="btn btn-secondary" onClick={copyPrevious}>
                  <Copy aria-hidden="true" /> Same as last visit ({formatDate(prev.visitOn)})
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setPicking(true)} disabled={rows.length >= 40}>
                <ListPlus aria-hidden="true" /> Add a ready-made set
              </button>
              <button type="button" className="btn btn-secondary" onClick={add} disabled={rows.length >= 40}>
                <Plus aria-hidden="true" /> Add medicine
              </button>
            </div>
          </div>
          {rows.length === 0 && <p className="muted">No medicines yet. Add the first one below, or add a ready-made set.</p>}
          <MedicineRows rows={rows} setRows={setRows} fieldError={(i, k) => fields[`items.${i}.${k}`]} names={names} usual={usual} stockOf={stockOf} />
          {rows.some((r) => stockOf(r)) && (
            <p className="hint help ms-dose-note">
              “In the pharmacy” and “Not in stock” come from the hospital pharmacy’s stock list, and are shown only where the medicine could be matched by its
              name and strength. Nothing beside a medicine means the stock list could not say – not that the pharmacy has none.
            </p>
          )}
          <MedicineSafetyPanel
            warnings={warnings}
            listInfo={safety.data?.list}
            checked={Boolean(pregnant || breastfeeding || baby) && !missing.entries && anyMedicine}
            context={safetyContext}
            notChecked={entries && anyMedicine ? listWords([missing.entries, missing.doses].filter(Boolean).map((what) => `no ${what}`)) : ''}
            patientId={patient.id}
            onRecordLink={() => {
              wentToRecord.current = true;
            }}
            onRecheck={askAgain}
            reasons={reasons}
            onReason={(key, text) => setReasons((r) => ({ ...r, [key]: text }))}
            reasonError={(key) => fields[`warning:${key}`]}
          />
          {/* A baby with no weight at this visit and no birth weight: none of the per-kg limits can be checked – said here */}
          {hasDoseLimits && baby && !baby.weight && filled.length > 0 && (
            <p className="hint ms-missing">
              <Scale aria-hidden="true" />
              <span>No weight is recorded for this baby, so the doses are not checked. Record the weight in Visit details (or the birth weight in the baby’s details).</span>
            </p>
          )}
          {/* Always shown (not an explanation that can be switched off): what the dose check does not do */}
          {hasDoseLimits && filled.length > 0 && (
            <p className="hint ms-dose-note">
              Dose check: for the medicines with a usual maximum in the medicine safety list, the dose is worked out from the strength, the dose and how often, as
              typed{baby ? ', per kg of the baby’s weight (the weight at this visit, or the birth weight) and by the baby’s age where the list gives one' : ''}. It is
              limited: it stays silent when it cannot work the dose out (a combined medicine, a strength without a unit, a dose in words or in drops, a cream, an
              injection with no dose written{baby ? ', no weight recorded' : ''}), and it does not check the medicines that are not on the list. The day’s total is
              worked out only when “How often” is one of the fixed choices: with “SOS” or “Other – write it” (for example “every 8 hours”) only the single dose is
              checked. No warning does not mean the dose is right.
              {safety.data?.list?.status !== 'approved' ? ' The limits are a draft until a doctor approves the list.' : ''}
            </p>
          )}
          <Field label="General instructions (optional)" id="rx-notes" error={fields.notes} hint="Printed under the medicines.">
            <textarea id="rx-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </section>
        <div className="sticky-actions">
          <button type="button" className="btn btn-link" onClick={add} disabled={rows.length >= 40}>
            <Plus aria-hidden="true" /> Add medicine
          </button>
          {canAddSets && filled.length > 0 && (
            <button type="button" className="btn btn-link" onClick={startSaveAsSet}>
              <BookmarkPlus aria-hidden="true" /> Save as a set
            </button>
          )}
          <span className="grow hint">{dirty ? 'Unsaved changes.' : 'All changes saved.'}</span>
          {printAction}
          <button title="Ctrl+Enter saves · Enter moves to the next box" type="submit" className="btn btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save prescription'}
          </button>
        </div>
        {undo.element}
      </form>
      {picking && (
        <SetPicker patient={patient} rows={filled} careLabel={CARE_TYPE_SHORT[patient.careType]?.toLowerCase()} onAdd={addFromSet} onCancel={() => setPicking(false)} />
      )}
      {savingSet && (
        <SaveAsSetDialog
          patient={patient}
          rows={filled}
          notes={notes}
          onCancel={() => setSavingSet(false)}
          onSaved={(set) => {
            setSavingSet(false);
            setSetNotice({ type: 'success', text: `Saved as the draft set “${set.name}”. A doctor checks and approves it under Prescription sets.`, setId: set.id });
          }}
        />
      )}
    </>
  );
}
