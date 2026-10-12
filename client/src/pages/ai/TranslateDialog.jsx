import { useState } from 'react';
import { Languages } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, useDialogFocus } from '../../components/ui.jsx';

const LANGS = { mr: 'मराठी (Marathi)', hi: 'हिंदी (Hindi)' };

/**
 * "Translate for the patient" (Smart features, step 5): the advice in Marathi or Hindi, written by AI, for the
 * doctor to check and change; "Add below the advice" puts it under the English advice (saved with the visit).
 */
export function TranslateDialog({ patientId, text, onAdd, onClose }) {
  const [language, setLanguage] = useState('mr');
  const [translation, setTranslation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dialogRef = useDialogFocus(onClose);

  const run = async (lang = language) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/patients/${patientId}/ai/translate`, { method: 'POST', body: { text, language: lang } });
      setTranslation(res.translation);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="tr-title">
        <h2 id="tr-title">Advice in her language</h2>
        <p className="hint">The advice below is translated by AI (OpenAI). Only the advice is sent. Check every line before printing.</p>
        <blockquote className="ai-source pre-line">{text}</blockquote>
        <div className="segmented rm-langs" role="group" aria-label="Language">
          {Object.entries(LANGS).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={language === k}
              onClick={() => {
                setLanguage(k);
                setTranslation('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <Alert type="error">{error}</Alert>
        {translation ? (
          <Field label="Translation (you can correct it)" id="tr-text">
            <textarea id="tr-text" rows={8} lang={language} value={translation} onChange={(e) => setTranslation(e.target.value)} />
          </Field>
        ) : (
          <p className="muted">{busy ? 'Translating…' : 'Choose the language, then Translate.'}</p>
        )}
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
          {translation ? (
            <button type="button" className="btn btn-primary" onClick={() => onAdd(translation.trim())} disabled={!translation.trim()}>
              Add below the advice
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => run()} disabled={busy}>
              <Languages aria-hidden="true" /> {busy ? 'Translating…' : 'Translate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
