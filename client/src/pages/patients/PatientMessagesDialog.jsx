import { useState } from 'react';
import { KeyRound, Printer } from 'lucide-react';
import { api } from '../../api.js';
import { BiLabel, PrintLanguageChoice, Translation } from '../../components/print/Bilingual.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { DRAFT_TRANSLATION_HINT, defaultPrintLanguage, secondLanguage } from '../../components/print/printLanguage.js';
import { Alert, Field, formatDate, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PORTAL_SLIP_WORDS } from '../portal/portalWords.js';

// "Reminders and portal" on the patient page (Version 2): her agreement to automatic reminders (SMS or WhatsApp,
// in her language), and her patient portal code. Ask her first: the reminder says only the hospital, the date and
// the phone number. The portal code is shown once – print it for her, or read it to her.
// Since 4 Oct 2026 the same agreement also covers two general messages – "a check-up or test is due" and "we missed
// you" – so the dialog says so. On a baby's record the agreement is the baby's own (the parents'), for the number on
// the baby's record: the mother's agreement is never used for the baby.
// Since 5 Oct 2026 the paper with her portal code prints in English only, or with Marathi or Hindi under the English
// (chosen in the print preview; DRAFT wording), like the portal itself.

const CHANNEL_WORDS = { sms: 'SMS', whatsapp: 'WhatsApp' };
const LANGUAGE_WORDS = { en: 'English', mr: 'Marathi', hi: 'Hindi' };

/**
 * The paper with her portal code (in the print preview, and in tests). lang: 'en', or 'mr' / 'hi' printed under the
 * English. The hospital's name, her name, the address and the code are printed as they are.
 */
export function CodeSlipDocument({ patient, code, letterhead, address, lang = 'en' }) {
  const second = secondLanguage(lang);
  const en = PORTAL_SLIP_WORDS.en;
  const other = second ? PORTAL_SLIP_WORDS[second] : null;
  const hospital = letterhead?.name ?? null;
  const line = (words) => {
    const [before, after] = words.open;
    return (
      <>
        {before}
        <strong>{address}</strong>
        {after}
      </>
    );
  };
  return (
    <PrintDocument>
      {letterhead && <Letterhead letterhead={letterhead} />}
      <h1 className="pdoc-title">{en.title(hospital)}</h1>
      {other && (
        <p className="pdoc-title pdoc-title-2" lang={second}>
          {other.title(hospital)}
        </p>
      )}
      <p>
        <BiLabel words={{ en: en.forWhom, ...(other ? { [second]: other.forWhom } : {}) }} lang={lang} />: {patient.fullName}
      </p>
      <p>
        {line(en)}
        {other && (
          <span className="pdoc-block" lang={second}>
            {line(other)}
          </span>
        )}
      </p>
      <p className="portal-slip-code">{code}</p>
      <p>
        {en.digits}
        <Translation text={other?.digits} english={en.digits} lang={lang} />
      </p>
      <p className="pdoc-small">
        {en.keep}
        <Translation text={other?.keep} english={en.keep} lang={lang} />
      </p>
    </PrintDocument>
  );
}

function CodeSlip({ patient, code, onClose }) {
  const lh = useFetch('/tenant/settings/letterhead');
  const address = `${window.location.origin}/portal`;
  // In the language recorded for her messages, if there is one; the English is always printed too
  const [language, setLanguage] = useState(() => defaultPrintLanguage(patient));
  const second = secondLanguage(language);
  return (
    <PrintPreview
      title="Portal code – print preview"
      hint="Give the paper to the patient herself."
      controls={
        <PrintLanguageChoice
          value={language}
          onChange={setLanguage}
          hints={second ? [`${second === 'mr' ? 'Marathi' : 'Hindi'} prints under the English. The portal itself has the same language switch at the top.`, DRAFT_TRANSLATION_HINT] : []}
        />
      }
      onClose={onClose}
    >
      <CodeSlipDocument patient={patient} code={code} letterhead={lh.data?.letterhead ?? null} address={address} lang={language} />
    </PrintPreview>
  );
}

export function PatientMessagesDialog({ patient, onDone, onCancel }) {
  const ref = useDialogFocus(onCancel);
  const current = patient.reminders ?? null;
  const isBaby = patient.careType === 'newborn';
  const [choice, setChoice] = useState(current?.consent ? current.channel : 'off');
  const [language, setLanguage] = useState(current?.language ?? 'mr');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const portal = useFetch(`/patients/${patient.id}/portal-access`);
  const [code, setCode] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/patients/${patient.id}/reminder-consent`, { method: 'PUT', body: { consent: choice !== 'off', channel: choice === 'off' ? (current?.channel ?? 'sms') : choice, language } });
      onDone(
        choice === 'off'
          ? `Automatic reminders are off for ${isBaby ? 'this baby' : 'her'}.`
          : `${isBaby ? 'Reminders for this baby will go' : 'She will get reminders'} by ${CHANNEL_WORDS[choice]} in ${LANGUAGE_WORDS[language]}.`,
      );
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };
  const makeCode = async () => {
    setPortalBusy(true);
    setError(null);
    try {
      setCode((await api(`/patients/${patient.id}/portal-access`, { method: 'POST' })).code);
      portal.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setPortalBusy(false);
    }
  };
  const withdraw = async () => {
    setPortalBusy(true);
    try {
      await api(`/patients/${patient.id}/portal-access`, { method: 'DELETE' });
      setCode(null);
      portal.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setPortalBusy(false);
    }
  };
  const p = portal.data;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="pm-title" onSubmit={save} noValidate>
        <h2 id="pm-title">Reminders and portal</h2>
        <Alert type="error">{error}</Alert>
        {/* A record marked as a duplicate gets no automatic message: the agreement that counts is the main record's */}
        {patient.duplicateOf && (
          <Alert type="info">
            This record is marked as a duplicate of {patient.duplicateOf.mrn}: no automatic messages are sent for it, whatever is chosen here. Record{' '}
            {isBaby ? "the parents'" : 'her'} agreement on {patient.duplicateOf.mrn}.
          </Alert>
        )}
        <fieldset className="fieldset">
          <legend>Automatic reminders</legend>
          <p className="hint">
            Ask {isBaby ? 'the parents' : 'her'} first. The day before an appointment {isBaby ? 'they get' : 'she gets'}: "{'<'}hospital{'>'}: your appointment is on {'<'}date{'>'}. To change it,
            call {'<'}phone{'>'}." – no name, no reason. Sent only if the hospital has switched reminders on.
          </p>
          <p className="hint">
            The same agreement covers two more messages, to the mobile number on this record: "A check-up or test is due at {'<'}hospital{'>'}. Please call {'<'}phone{'>'} to book." when
            something in the care plan is overdue and nothing is booked, and "we missed you at your appointment on {'<'}date{'>'}" the day after an appointment nobody came to. They never say what
            is due or why; at most one of them in 14 days.
            {isBaby ? " A baby's messages go only under the agreement recorded here, on the baby's own record – the mother's agreement does not count for the baby." : ''}
          </p>
          {['off', 'sms', 'whatsapp'].map((c) => (
            <label key={c} className="check">
              <input type="radio" name="pm-channel" checked={choice === c} onChange={() => setChoice(c)} />{' '}
              {c === 'off' ? 'No automatic reminders' : `${isBaby ? 'The parents agree' : 'She agrees'} to reminders by ${CHANNEL_WORDS[c]}`}
            </label>
          ))}
          {choice !== 'off' && (
            <Field label="Language" id="pm-language">
              <select id="pm-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {Object.entries(LANGUAGE_WORDS).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {current?.byName && (
            <p className="hint">
              Last recorded by {current.byName}, {formatDate(current.at)}.
            </p>
          )}
        </fieldset>
        <fieldset className="fieldset">
          <legend>Patient portal</legend>
          {portal.error && <p className="muted">{portal.error}</p>}
          {p && !p.enabled && <p className="muted">The patient portal is switched off for this hospital (Hospital admin → Patient messages).</p>}
          {p?.enabled && (
            <>
              <p className="hint">
                {isBaby
                  ? "The parents see only the baby's next appointment and what is due in the baby's care plan – no results or notes. They sign in with a code and the last 4 digits of the mobile number on this record."
                  : 'She sees only her next appointment and what is due in her care plan – no results or notes. She signs in with a code and the last 4 digits of her mobile.'}
              </p>
              {code ? (
                <>
                  <p>
                    {isBaby ? 'The code' : 'Her code'} (shown only now): <strong className="portal-slip-code">{code}</strong>
                  </p>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPrinting(true)}>
                    <Printer aria-hidden="true" /> {isBaby ? 'Print it for the parents' : 'Print it for her'}
                  </button>
                </>
              ) : p.active ? (
                <p>
                  A code is active – made by {p.active.createdByName} on {formatDate(p.active.createdAt)}, works until {formatDate(p.active.expiresAt)}
                  {p.active.lastUsedAt ? `, last used ${formatDate(p.active.lastUsedAt)}` : ', not used yet'}.
                </p>
              ) : (
                <p className="muted">No code yet.</p>
              )}
              <div className="row">
                <button type="button" className="btn btn-secondary btn-sm" disabled={portalBusy || !p.hasMobile} onClick={makeCode}>
                  <KeyRound aria-hidden="true" /> {p.active || code ? 'Make a new code (the old one stops)' : isBaby ? 'Make a code for the parents' : 'Make her code'}
                </button>
                {(p.active || code) && (
                  <button type="button" className="btn btn-link btn-sm" disabled={portalBusy} onClick={withdraw}>
                    Withdraw access
                  </button>
                )}
              </div>
              {!p.hasMobile && <p className="hint">{isBaby ? 'Add a mobile number to this record first (Edit details).' : 'Add her mobile number first (Edit details).'}</p>}
            </>
          )}
        </fieldset>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save reminders'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Close
          </button>
        </div>
      </form>
      {printing && code && <CodeSlip patient={patient} code={code} onClose={() => setPrinting(false)} />}
    </div>
  );
}
