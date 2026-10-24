import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
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
  const [open, setOpen] = useState(false); // the brief opens in a pop-up (owner, 24 Oct 2026), not inside the card
  useEffect(() => {
    if (result || error) setOpen(true);
  }, [result, error]);

  return (
    <section className={`card ai-card ai-brief ai-brief-idle ${className}`.trim()} aria-labelledby="ai-brief-title" aria-busy={busy}>
      <div className="ai-card-head">
        <h2 id="ai-brief-title">
          <Sparkles aria-hidden="true" /> AI brief
        </h2>
        <p className="hint ai-brief-intro">{intro} No names, phone or patient numbers are sent.</p>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={busy}>
            {result ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />} {busy ? 'Reading the page…' : result ? 'Brief me again' : 'Brief me'}
          </button>
          {(result || error) && !open && (
            <button type="button" className="btn btn-link btn-sm" onClick={() => setOpen(true)}>
              Show the brief
            </button>
          )}
        </div>
      </div>
      {open && (result || error) && (
        <BriefPopup onClose={() => setOpen(false)}>
            <h2 id="ai-brief-pop-title">
              <Sparkles aria-hidden="true" /> AI brief
            </h2>
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
                            <Link key={j} to={`/patients/${part.patient.id}`} className="ai-brief-name" onClick={() => setOpen(false)}>
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
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={run} disabled={busy}>
                <RefreshCw aria-hidden="true" /> {busy ? 'Reading the page…' : 'Brief me again'}
              </button>
              <button type="button" className="btn btn-link" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
        </BriefPopup>
      )}
    </section>
  );
}

// The pop-up the brief opens in (owner, 24 Oct 2026); its focus handling only while it is open
function BriefPopup({ onClose, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal ai-brief-modal" role="dialog" aria-modal="true" aria-labelledby="ai-brief-pop-title">
        {children}
      </div>
    </div>
  );
}
