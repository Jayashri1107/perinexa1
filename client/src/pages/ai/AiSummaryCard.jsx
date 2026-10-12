import { useState } from 'react';
import { RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';

export const AI_NOTE = 'Written by AI (OpenAI) from the record – her name, phone, address and patient number are not sent. Check it before relying on it.';

/**
 * "AI summary" (Smart features, step 4): a few lines to read before seeing the patient. Made only when the
 * doctor asks (each one costs a little), shown here and not saved.
 */
export function AiSummaryCard({ patientId, className = '' }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api(`/patients/${patientId}/ai/summary`, { method: 'POST' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card ai-card ${className}`.trim()} aria-labelledby="ai-summary-title" aria-busy={busy}>
      <div className="ai-card-head">
        <h2 id="ai-summary-title">
          <Sparkles aria-hidden="true" /> AI summary
        </h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={busy}>
          {result ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />} {busy ? 'Reading the record…' : result ? 'Summarise again' : 'Summarise the record'}
        </button>
      </div>
      <Alert type="error">{error}</Alert>
      {result ? (
        <>
          <ul className="ai-points">
            {result.points.map((p, i) => (
              <li key={i}>
                {p.important && (
                  <StatusPill tone="watch" icon={TriangleAlert}>
                    Attention
                  </StatusPill>
                )}
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
          {result.missing.length > 0 && (
            <p className="ai-missing">
              <strong>Not recorded:</strong> {result.missing.join(' · ')}
            </p>
          )}
          <p className="hint">
            {AI_NOTE} Made {formatDateTime(result.generatedAt)}.
          </p>
        </>
      ) : (
        !busy && <p className="hint">A few lines on where she is, what changed, what is due and what is missing. {AI_NOTE}</p>
      )}
    </section>
  );
}
