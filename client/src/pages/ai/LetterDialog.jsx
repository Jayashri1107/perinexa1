import { useState } from 'react';
import { Copy, FileText, Printer } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DoctorSignature, Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, formatDate, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { AI_NOTE } from './AiSummaryCard.jsx';

const TYPES = { referral: 'Referral letter', discharge: 'Discharge summary', fitness: 'Medical certificate / fitness note' };

/** Fills in what the AI left as placeholders: her name and the doctor's name. */
export const fillLetter = (text, { patientName, doctorName }) => text.replaceAll('[Patient name]', patientName).replaceAll('[Doctor name]', doctorName);

/**
 * "Write a letter" (Smart features, step 6): a referral letter, discharge summary or fitness note drafted by AI
 * from the record; the doctor edits it, then copies or prints it on the hospital letterhead. Not saved.
 */
export function LetterDialog({ patient, onClose }) {
  const { user, activeMembership } = useAuth();
  const [form, setForm] = useState({ type: 'referral', to: '', reason: '', extra: '' });
  const [draft, setDraft] = useState(null); // { subject, body }
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const lh = useFetch(printing ? '/tenant/settings/letterhead' : null);
  const dialogRef = useDialogFocus(onClose);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const write = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await api(`/patients/${patient.id}/ai/letter`, { method: 'POST', body: form });
      const names = { patientName: patient.fullName, doctorName: user.name };
      setDraft({ subject: fillLetter(res.subject, names), body: fillLetter(res.body, names) });
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied(true);
    } catch {
      setError("This browser didn't allow copying. Select the text and copy it by hand.");
    }
  };

  if (printing) {
    const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
    return (
      <PrintPreview title={TYPES[form.type]} onClose={() => setPrinting(false)}>
        <PrintDocument footer={<span>Printed {formatDate(new Date())} by {user.name}</span>}>
          <Letterhead letterhead={letterhead} />
          <p className="ai-letter-date">{formatDate(new Date())}</p>
          <h1 className="ai-letter-subject">{draft.subject}</h1>
          <div className="pre-line ai-letter-body">{draft.body}</div>
          <DoctorSignature user={user} />
          <LetterheadFooter letterhead={letterhead} />
        </PrintDocument>
      </PrintPreview>
    );
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="lt-title">
        <h2 id="lt-title">Write a letter</h2>
        <Alert type="error">{error}</Alert>
        {!draft ? (
          <>
            <Field label="Kind of letter" id="lt-type">
              <select id="lt-type" value={form.type} onChange={set('type')}>
                {Object.entries(TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To (optional)" id="lt-to" hint='e.g. "Consultant physician, District Hospital"'>
              <input id="lt-to" value={form.to} onChange={set('to')} maxLength={200} />
            </Field>
            <Field label="Reason" id="lt-reason" error={fields.reason} hint='e.g. "Severe pre-eclampsia at 32 weeks – for delivery with NICU backup"'>
              <input id="lt-reason" value={form.reason} onChange={set('reason')} maxLength={500} />
            </Field>
            <Field label="Anything else to include (optional)" id="lt-extra" error={fields.extra}>
              <textarea id="lt-extra" rows={3} value={form.extra} onChange={set('extra')} maxLength={2000} />
            </Field>
            <p className="hint">{AI_NOTE}</p>
          </>
        ) : (
          <>
            <Field label="Subject" id="lt-subject">
              <input id="lt-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </Field>
            <Field label="Letter (check and correct every line)" id="lt-body">
              <textarea id="lt-body" rows={16} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </Field>
            {copied && <Alert type="success">Copied.</Alert>}
            <p className="hint">Drafted by AI from the record. Nothing is saved: copy or print it now.</p>
          </>
        )}
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Close
          </button>
          {draft ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)}>
                Start again
              </button>
              <button type="button" className="btn btn-secondary" onClick={copy}>
                <Copy aria-hidden="true" /> Copy
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setPrinting(true)}>
                <Printer aria-hidden="true" /> Print
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={write} disabled={busy}>
              <FileText aria-hidden="true" /> {busy ? 'Writing the draft…' : 'Draft the letter'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
