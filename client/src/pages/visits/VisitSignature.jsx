import { useState } from 'react';
import { BadgeCheck, History, PenLine } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, Field, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';

// Sign and finish a visit: the treating doctor or an RMO signs; from then on nothing in the visit can be changed.
// A correction or addition is added below it with the person's name and the time, and is never changed or removed.

const ROLE_WORDS = { doctor: 'Doctor', rmo: 'RMO' };

/** "Signed by Dr X (Doctor) · 1 Oct 2026, 11:20" */
export const signedText = (signed) => `Signed by ${signed.byName}${ROLE_WORDS[signed.role] ? ` (${ROLE_WORDS[signed.role]})` : ''} · ${formatDateTime(signed.at)}`;

export function SignedPill({ signed }) {
  return signed ? (
    <StatusPill tone="stable" icon={BadgeCheck} title={signedText(signed)}>
      Signed
    </StatusPill>
  ) : (
    <StatusPill tone="watch" icon={PenLine}>
      Not signed
    </StatusPill>
  );
}

/** "Sign and finish this visit?" – signs the version shown (page: the latest saved visit). */
export function SignDialog({ patient, page, onDone, onCancel }) {
  const { user } = useAuth();
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const v = page.visit;
  const sign = async () => {
    setSaving(true);
    setError(null);
    try {
      const revs = { vitals: v.vitals.rev, details: v.details.rev, prescription: v.prescription.rev };
      onDone(await api(`/patients/${patient.id}/visits/${v.id}/sign`, { method: 'POST', body: { revs } }));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="vs-sign-title">
        <h2 id="vs-sign-title">Sign and finish this visit?</h2>
        <p>
          You sign as <strong>{user?.name}</strong>. After signing, nothing in this visit can be changed: vital signs, notes, prescription and care-plan
          ticks. A correction can still be added below it, with your name and the time.
        </p>
        <Alert type="error">{error}</Alert>
        <div className="row">
          <button type="button" className="btn btn-positive" onClick={sign} disabled={saving}>
            <BadgeCheck aria-hidden="true" /> {saving ? 'Signing…' : 'Sign and finish'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Corrections and additions to a signed visit, newest last, and the form to add one. */
export function AdditionsCard({ patient, page, onAdded }) {
  const v = page.visit;
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const canAdd = Boolean(page.access.canAddAddition);
  if (!v.signed && !v.additions?.length) return null;
  if (!canAdd && !v.additions?.length) return null;

  const add = async (e) => {
    e.preventDefault();
    if (text.trim().length < 3) return setError('Please write the correction or addition.');
    if (patient.careType !== 'newborn' && mentionsFetalSex(text)) return setError(PCPNDT_MESSAGE);
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/visits/${v.id}/additions`, { method: 'POST', body: { text: text.trim() } });
      setText('');
      onAdded(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <section className="card vs-additions" aria-labelledby="vs-additions-title">
      <h2 id="vs-additions-title">Corrections and additions</h2>
      {v.additions?.length > 0 && (
        <ol className="vs-addition-list">
          {v.additions.map((a) => (
            <li key={a.id}>
              <p className="pre-line">{a.text}</p>
              <p className="hint">
                {a.byName} · {formatDateTime(a.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
      {canAdd && (
        <form onSubmit={add} noValidate>
          <Field label="Add a correction or addition" id="vs-addition" error={error} hint="Saved with your name and the time. It can't be changed or removed later." keepHint>
            <textarea id="vs-addition" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}
    </section>
  );
}

const HISTORY_WORDS = {
  VISIT_CREATED: 'Started the visit',
  VISIT_UPDATED: 'Saved',
  PRESCRIPTION_UPDATED: 'Saved the prescription',
  VISIT_SIGNED: 'Signed and finished',
  VISIT_ADDITION_ADDED: 'Added a correction',
  VISIT_CANCELLED: 'Marked entered in error',
  PRESCRIPTION_PRINTED: 'Printed the prescription',
  PRESCRIPTION_PDF_SAVED: 'Saved the prescription as a PDF',
  VISIT_SUMMARY_PRINTED: 'Printed the visit summary',
  VISIT_SUMMARY_PDF_SAVED: 'Saved the visit summary as a PDF',
  AI_CHECK_PRINTED_ANYWAY: 'Printed without changing what the AI check pointed out',
};
const PART_WORDS = { vitals: 'the vital signs', details: 'the visit details' };

export function historyText(h) {
  if (h.action === 'VISIT_UPDATED' && h.sections?.length) return `Saved ${h.sections.map((s) => PART_WORDS[s] ?? s).join(' and ')}`;
  const words = HISTORY_WORDS[h.action] ?? h.action;
  return h.via === 'whatsapp' ? `${words}, to send on WhatsApp` : words;
}

/** Who started, saved, signed, corrected and printed the visit, and when (folded until opened; loaded then). */
export function VisitHistory({ patient, visitId, version }) {
  const [open, setOpen] = useState(false);
  const { data, error, loading } = useFetch(open ? `/patients/${patient.id}/visits/${visitId}/history` : null, { v: version });
  return (
    <details className="card vs-history" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <History aria-hidden="true" /> History of this visit
      </summary>
      <Alert type="error">{error}</Alert>
      {loading && !data && <p className="hint">Loading…</p>}
      {data && (
        <ol className="vs-history-list">
          {data.history.map((h, i) => (
            <li key={i}>
              <span className="tabular muted">{formatDateTime(h.at)}</span> <strong>{h.byName ?? 'Someone'}</strong> – {historyText(h)}
            </li>
          ))}
        </ol>
      )}
      {data && <p className="hint help">Who changed or printed the visit, and when – not what was written.</p>}
    </details>
  );
}
