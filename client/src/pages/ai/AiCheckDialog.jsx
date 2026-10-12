import { useState } from 'react';
import { Pencil, Printer, ShieldAlert, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, StatusPill, useDialogFocus } from '../../components/ui.jsx';

const LOOK = {
  important: { tone: 'high', icon: ShieldAlert, word: 'Important' },
  check: { tone: 'watch', icon: TriangleAlert, word: 'Check' },
};

/**
 * What the AI check found before printing (Smart features): each point, then Correct it (back to the prescription)
 * or Print as it is (the doctor's decision, recorded in the audit log). Never blocks printing.
 */
export function AiCheckDialog({ patientId, visitId, check, onCorrect, onPrint }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dialogRef = useDialogFocus(onCorrect);

  const printAnyway = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/patients/${patientId}/visits/${visitId}/ai-check/print-anyway`, { method: 'POST', body: { key: check.key } });
      onPrint();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCorrect()}>
      <div ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="aic-title">
        <h2 id="aic-title">Please check before printing</h2>
        <p className="hint">The AI check (OpenAI) found {check.issues.length === 1 ? 'one point' : `${check.issues.length} points`} in this prescription. You decide: it may be wrong.</p>
        <Alert type="error">{error}</Alert>
        <ul className="rf-list aic-list">
          {check.issues.map((it, i) => {
            const look = LOOK[it.severity] ?? LOOK.check;
            return (
              <li key={i}>
                <StatusPill tone={look.tone} icon={look.icon}>
                  {look.word}
                </StatusPill>
                <span className="rf-text">
                  <strong>{it.about}</strong>
                  <span> – {it.problem}</span>
                  {it.suggestion && <span className="rf-message">{it.suggestion}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={printAnyway} disabled={busy}>
            <Printer aria-hidden="true" /> {busy ? 'Opening…' : 'Print as it is'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onCorrect} disabled={busy}>
            <Pencil aria-hidden="true" /> Correct it
          </button>
        </div>
      </div>
    </div>
  );
}
