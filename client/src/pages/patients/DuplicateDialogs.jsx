import { useEffect, useState } from 'react';
import { Copy, Files } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, Avatar, ConfirmDialog, Field, FieldError, formatDate, useDebounced, useDialogFocus } from '../../components/ui.jsx';
import { ageText } from './patientFormat.js';
import { MAIN_SEARCH_ASKED, earlierRecordsLabel, historyLine, leftBehindLines, mainRecordChoices, markedMessage, moreVisitsHere, reasonProblem, undoneMessage } from './duplicateFormat.js';

// Two records of one person, joined the safe way: one is marked "Duplicate of P-…" by her doctor or an RMO. Nothing
// is moved between the records or deleted – the duplicate stays readable with a link to the main record, takes
// nothing new and is left out of the lists; only her appointments from today on go to the main record. "Undo" puts
// it back. The server decides who may do this and refuses what makes no sense (itself, a duplicate of a duplicate,
// a baby and an adult); this file only asks and shows.

/** On a duplicate record, on every tab: what it is, where the main record is, who marked it and why. */
export function DuplicateBanner({ patient, onUndo }) {
  const d = patient.duplicateOf;
  if (!d) return null;
  return (
    <Alert type="warning" icon={Copy}>
      <strong>Duplicate record.</strong> This record is marked as a duplicate of <Link to={`/patients/${d.id}`}>{d.mrn}</Link>. It can still be read, but it takes
      nothing new – no visits, prescriptions, lab orders, admissions, appointments, scans or bills. Use <Link to={`/patients/${d.id}`}>{d.mrn}</Link> for{' '}
      {patient.careType === 'newborn' ? "the baby's" : 'her'} care.
      <span className="dup-meta">
        {d.byName ? `Marked by ${d.byName}` : 'Marked'}
        {d.at ? ` on ${formatDate(d.at)}` : ''}.{patient.duplicateReason ? ` Reason: ${patient.duplicateReason}` : ''}
      </span>
      {patient.access.canUndoDuplicate && (
        <button type="button" className="btn btn-secondary btn-sm dup-undo" onClick={onUndo}>
          Undo duplicate marking
        </button>
      )}
    </Alert>
  );
}

/**
 * On the main record: "Earlier record: P-…" with a link (only the records this person may open are sent). For
 * those who may see the medical details of both records, also what an earlier record has that this one does not –
 * an allergy, a blood group, pregnancy dates, a care plan (earlierRecordDetails): prescribing and the lists use
 * this record only, so it must not drop out of sight.
 */
export function EarlierRecordsNote({ patient }) {
  const records = patient.earlierRecords ?? [];
  if (!records.length) return null;
  const details = patient.earlierRecordDetails ?? [];
  return (
    <Alert type="patient-note" icon={Files}>
      <strong>{earlierRecordsLabel(records)}:</strong>{' '}
      {records.map((r, i) => (
        <span key={r.id}>
          {i > 0 && ', '}
          <Link to={`/patients/${r.id}`} className="tabular">
            {r.mrn}
          </Link>
        </span>
      ))}{' '}
      – marked as {records.length === 1 ? 'a duplicate' : 'duplicates'} of this record. {records.length === 1 ? 'Its' : 'Their'} visits, results and bills stay there.
      {details.map((r) => (
        <span key={r.id} className="dup-left">
          <strong>
            On <Link to={`/patients/${r.id}`}>{r.mrn}</Link> and not on this record:
          </strong>{' '}
          {leftBehindLines(r.details, 'this record', formatDate).join('; ')}. Copy what still applies to this record (Edit details).
        </span>
      ))}
    </Alert>
  );
}

/** Earlier markings of this record that were undone (for those who see the medical details). */
export function DuplicateHistory({ patient }) {
  const history = patient.duplicateHistory ?? [];
  if (!history.length) return null;
  return (
    <details className="override-history">
      <summary>Duplicate markings that were undone ({history.length})</summary>
      <ul>
        {history.map((h, i) => (
          <li key={i}>{historyLine(h, formatDate)}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * In "Mark as a duplicate", once the main record is chosen: what the server found when it compared the two records
 * (check, from GET …/duplicate-of/check). `problem`: why this record cannot be marked now. The rest never stops the
 * marking – it says what only this record has (an allergy, a blood group, pregnancy dates, a care plan, more visits,
 * her agreement to reminders, her ABHA), so that it is copied to the main record or the other record is marked.
 */
export function MarkingCheckNote({ check, mainMrn, baby = false }) {
  if (!check) return null;
  const left = leftBehindLines(check.details, mainMrn, formatDate);
  const visitsHint = moreVisitsHere(check.visits, mainMrn, baby);
  return (
    <>
      <Alert type="warning">{check.problem}</Alert>
      {(left.length > 0 || visitsHint || check.remindersHere || check.abhaHere) && (
        <Alert type="warning">
          <strong>Before you mark, look at what only this record has.</strong> Nothing is copied by itself.
          {left.length > 0 && (
            <ul className="dup-left-list">
              {left.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {left.length > 0 && <span className="dup-left">Copy what still applies to {mainMrn} (Edit details), or keep this record as the main one.</span>}
          {visitsHint && <span className="dup-left">{visitsHint}</span>}
          {check.remindersHere && (
            <span className="dup-left">
              {baby ? 'The parents' : 'She'} agreed to reminders on this record only. {mainMrn} sends none until the agreement is recorded there (More → Reminders and portal).
            </span>
          )}
          {check.abhaHere && (
            <span className="dup-left">
              {baby ? 'The' : 'Her'} ABHA is linked on this record only. It is unlinked here and linked on {mainMrn} (ABHA tab).
            </span>
          )}
        </Alert>
      )}
    </>
  );
}

/**
 * Pop-up: mark this record as a duplicate of another. The main record is searched for (name, phone or patient
 * number) – a baby's record only among babies, everyone else's never among babies – and a reason is typed.
 * onDone(message): marked; the page reloads the record.
 */
export function MarkDuplicateDialog({ patient, onDone, onCancel }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null); // null = not searched yet
  const [main, setMain] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [check, setCheck] = useState(null); // what this record has that the chosen main record does not
  const term = useDebounced(search.trim(), 300);
  const ref = useDialogFocus(busy ? undefined : onCancel);
  const baby = patient.careType === 'newborn';

  // The same search as the Patients list (duplicates are already left out); this record itself and records of the
  // other kind (baby / not a baby) are not offered. More rows are asked for than are shown, so that the right
  // record is not cut off by the rows that are left out here; a baby's record is searched among babies only.
  useEffect(() => {
    if (term.length < 2) {
      setResults(null);
      return undefined;
    }
    let current = true;
    api('/patients', { query: { search: term, doctor: 'all', limit: MAIN_SEARCH_ASKED, sort: 'fullName', ...(baby ? { careType: 'newborn' } : {}) } })
      .then((res) => current && setResults(mainRecordChoices(patient, res.patients)))
      .catch(() => current && setResults({ shown: [], more: false }));
    return () => {
      current = false;
    };
  }, [term, patient, baby]);

  // The main record was chosen: the server compares the two records (nothing is changed) – what this record has
  // that the other does not is shown before the marking, and why it cannot be marked, if it cannot.
  const mainId = main?.id ?? null;
  useEffect(() => {
    setCheck(null);
    if (!mainId) return undefined;
    let current = true;
    api(`/patients/${patient.id}/duplicate-of/check`, { query: { mainId } })
      .then((res) => current && setCheck(res))
      .catch((err) => current && setCheck({ problem: err.message }));
    return () => {
      current = false;
    };
  }, [mainId, patient.id]);

  const save = async (e) => {
    e.preventDefault();
    const problems = { ...(main ? {} : { mainId: 'Choose the main record.' }), ...(reasonProblem(reason) ? { reason: reasonProblem(reason) } : {}) };
    setFieldErrors(problems);
    setError(null);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const result = await api(`/patients/${patient.id}/duplicate-of`, { method: 'PUT', body: { mainId: main.id, reason: reason.trim() } });
      onDone(markedMessage(result, { baby, formatDate }));
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="dup-title" onSubmit={save} noValidate>
        <h2 id="dup-title">Mark this record as a duplicate</h2>
        <p className="hint dup-intro">
          Use this when {patient.fullName} has two records. This record ({patient.mrn}) becomes the duplicate; choose the main record – the one to keep using.
          Nothing is moved or deleted: this record stays readable with a link to the main one, takes nothing new and is left out of the lists. Only{' '}
          {baby ? 'the' : 'her'} appointments from today on go to the main record. You can undo it.
        </p>
        {/* The server's reason is shown under the field it belongs to; only a problem with no field is shown here */}
        <Alert type="error">{fieldErrors.mainId || fieldErrors.reason ? null : error}</Alert>
        {main ? (
          <div className={`field ${fieldErrors.mainId ? 'has-error' : ''}`}>
            <span className="field-label">Main record</span>
            <div className="picked dup-picked">
              <span className="name-cell">
                <Avatar name={main.fullName} seed={main.id} />
                <span className="name-cell-text">
                  <strong>{main.fullName}</strong>
                  <span className="muted tabular">{[main.mrn, ageText(main), main.phone].filter((x) => x && x !== '—').join(' · ')}</span>
                </span>
              </span>
              <button
                type="button"
                className="btn btn-link"
                onClick={() => {
                  setMain(null);
                  setFieldErrors({});
                  setError(null);
                }}
                disabled={busy}
              >
                Change
              </button>
            </div>
            <FieldError>{fieldErrors.mainId}</FieldError>
            {!fieldErrors.mainId && <MarkingCheckNote check={check} mainMrn={main.mrn} baby={baby} />}
          </div>
        ) : (
          <Field label="Main record (search by name, phone or patient number)" id="dup-search" error={fieldErrors.mainId}>
            <input id="dup-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type at least 2 letters…" autoComplete="off" maxLength={100} autoFocus />
            {results && results.shown.length > 0 && (
              <ul className="pick-list">
                {results.shown.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setMain(p);
                        setSearch('');
                        setFieldErrors({});
                      }}
                    >
                      <span className="name-cell">
                        <Avatar name={p.fullName} seed={p.id} />
                        <span className="name-cell-text">
                          <strong>{p.fullName}</strong>
                          <span className="muted tabular">{[p.mrn, ageText(p), p.phone].filter((x) => x && x !== '—').join(' · ')}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {results && results.shown.length === 0 && (
              <p className="hint" role="status">
                {results.more
                  ? `None of the first ${MAIN_SEARCH_ASKED} records found for “${term}” can be the main record. Type more of the name, or the patient number.`
                  : `No other ${baby ? "baby's" : "patient's"} record found for “${term}”.`}
              </p>
            )}
            {results && results.shown.length > 0 && results.more && (
              <p className="hint" role="status">
                More records match than are shown. If the right one is not here, type more of the name, or the patient number.
              </p>
            )}
          </Field>
        )}
        <Field label="Reason" id="dup-reason" error={fieldErrors.reason} hint={baby ? 'e.g. "Registered twice at the desk – the same baby and mother"' : 'e.g. "Registered twice at the desk – the same woman and phone number"'}>
          <textarea id="dup-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={busy} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Mark as a duplicate'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** "Undo the duplicate marking?" – asked first; onDone(message) when undone, onError(message) when refused. */
export function UndoDuplicateDialog({ patient, onDone, onError, onCancel }) {
  const mrn = patient.duplicateOf?.mrn ?? 'the main record';
  const undo = async () => {
    try {
      onDone(undoneMessage(await api(`/patients/${patient.id}/duplicate-of`, { method: 'DELETE' }), { baby: patient.careType === 'newborn' }));
    } catch (err) {
      onError(err.message);
    }
  };
  return (
    <ConfirmDialog id="undo-duplicate" title="Undo the duplicate marking?" confirmLabel="Undo marking" onConfirm={undo} onCancel={onCancel}>
      This record will be in use again and back in the lists. Appointments that went to {mrn} and are still ahead come back to this record. Nothing else changes.
    </ConfirmDialog>
  );
}
