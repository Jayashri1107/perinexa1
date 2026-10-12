import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { briefNamer, briefParts } from './briefParts.js';

export const BRIEF_NOTE = 'Written by AI (OpenAI) from what this page shows – names, phone numbers, addresses and patient numbers are not sent. Check it before relying on it.';

/**
 * "AI brief" (Smart features, step 10): a few lines on what is most important to look at on this page (Today, the
 * calendar, a patient's page). Made only when asked – each one costs a little – shown here and not saved.
 *  endpoint: e.g. "/ai/brief/today"; body: the page's choices (scope, view …);
 *  resetKey: when it changes (another day, week or patient) the brief is put away, as it was about other things;
 *  intro: what the brief covers, one short sentence: until asked the box is one slim line (pages that fit one
 *  screen stay that way).
 */
export function AiBriefCard({ endpoint, body, resetKey, intro, className = '' }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const asked = useRef(0); // an answer for an earlier page is not shown

  useEffect(() => {
    asked.current += 1;
    setResult(null);
    setError(null);
    setBusy(false);
  }, [resetKey]);

  const run = async () => {
    const mine = ++asked.current;
    setBusy(true);
    setError(null);
    try {
      const res = await api(endpoint, { method: 'POST', body: body ?? {} });
      if (mine === asked.current) setResult(res);
    } catch (err) {
      if (mine === asked.current) setError(err.message);
    } finally {
      if (mine === asked.current) setBusy(false);
    }
  };

  const nameOf = briefNamer(result?.patients);
  const idle = !result && !error;

  return (
    <section className={`card ai-card ai-brief${idle ? ' ai-brief-idle' : ''} ${className}`.trim()} aria-labelledby="ai-brief-title" aria-busy={busy}>
      <div className="ai-card-head">
        <h2 id="ai-brief-title">
          <Sparkles aria-hidden="true" /> AI brief
        </h2>
        {idle && <p className="hint ai-brief-intro">{intro} No names, phone or patient numbers are sent.</p>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={busy}>
          {result ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />} {busy ? 'Reading the page…' : result ? 'Brief me again' : 'Brief me'}
        </button>
      </div>
      <Alert type="error">{error}</Alert>
      {result?.empty ? (
        <p className="hint">Nothing on this page to brief yet.</p>
      ) : result ? (
        <>
          <ul className="ai-points">
            {result.points.map((p, i) => (
              <li key={i}>
                {p.first && (
                  <StatusPill tone="watch" icon={TriangleAlert}>
                    Attention
                  </StatusPill>
                )}
                <span>
                  {briefParts(p.text, result.patients).map((part, j) =>
                    part.patient ? (
                      <Link key={j} to={`/patients/${part.patient.id}`} className="ai-brief-name">
                        {nameOf(part.patient)}
                      </Link>
                    ) : (
                      part.text
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
          {result.missing?.length > 0 && (
            <p className="ai-missing">
              <strong>Not recorded:</strong> {result.missing.join(' · ')}
            </p>
          )}
          <p className="hint">
            {BRIEF_NOTE} Made {formatDateTime(result.generatedAt)}.
          </p>
        </>
      ) : null}
    </section>
  );
}
