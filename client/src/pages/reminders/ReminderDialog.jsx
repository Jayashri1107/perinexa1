import { useEffect, useState } from 'react';
import { Copy, MessageCircle } from 'lucide-react';
import { Alert, Field, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { showWhatsappNumber, whatsappLink, whatsappNumber } from '../visits/whatsapp.js';
import { REMINDER_LANGUAGES, reminderMessage } from './reminderText.js';

const LANG_KEY = 'perinexa.reminderLanguage';
const savedLanguage = () => {
  try {
    return localStorage.getItem(LANG_KEY) ?? 'en';
  } catch {
    return 'en';
  }
};

/**
 * "Send a reminder" (Smart features, step 3): the message for the patient in English, Marathi or Hindi, ready to
 * copy, and a button that opens her WhatsApp chat. Nothing is sent automatically: staff paste the message and
 * send it themselves. Nothing about the patient goes into the WhatsApp address (only her number).
 */
export function ReminderDialog({ patientId, onClose }) {
  const { data, error } = useFetch(`/patients/${patientId}/reminder`);
  const [lang, setLang] = useState(savedLanguage);
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(null);
  const dialogRef = useDialogFocus(onClose);

  useEffect(() => {
    if (data && !edited) setText(reminderMessage(data, lang));
  }, [data, lang, edited]);

  const choose = (l) => {
    setLang(l);
    setEdited(false);
    setCopied(null);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* the choice is only a convenience */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };
  const number = data ? whatsappNumber(data.patient.phone) : null;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="rm-title">
        <h2 id="rm-title">Reminder{data ? ` for ${data.patient.fullName}` : ''}</h2>
        <Alert type="error">{error}</Alert>
        {!data && !error && <p className="muted" aria-busy="true">Preparing the message…</p>}
        {data && (
          <>
            <div className="segmented rm-langs" role="group" aria-label="Language of the message">
              {Object.entries(REMINDER_LANGUAGES).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={lang === k} onClick={() => choose(k)} lang={k}>
                  {label}
                </button>
              ))}
            </div>
            <Field label="Message (you can change it before copying)" id="rm-text">
              <textarea
                id="rm-text"
                className="rm-text"
                rows={12}
                lang={lang}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setEdited(true);
                  setCopied(null);
                }}
              />
            </Field>
            {lang !== 'en' && <p className="hint">The Marathi and Hindi wording is a draft – have it checked by a fluent speaker before using it with patients.</p>}
            {copied === 'ok' && <Alert type="success">Copied. Open the chat, paste the message and send it.</Alert>}
            {copied === 'failed' && <Alert type="warning">This browser didn't allow copying. Select the message and copy it by hand.</Alert>}
            <p className="hint">
              {number ? `WhatsApp: ${showWhatsappNumber(number)}. ` : 'No mobile number is recorded for her – add it on Edit details, or give the message another way. '}
              Nothing is sent automatically.
            </p>
          </>
        )}
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Close
          </button>
          {number && (
            <a className="btn btn-secondary" href={whatsappLink(number)} target="_blank" rel="noreferrer">
              <MessageCircle aria-hidden="true" /> Open WhatsApp chat
            </a>
          )}
          <button type="button" className="btn btn-primary" onClick={copy} disabled={!data || !text.trim()}>
            <Copy aria-hidden="true" /> Copy message
          </button>
        </div>
      </div>
    </div>
  );
}
