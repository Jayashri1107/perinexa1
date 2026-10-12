import { useRef, useState } from 'react';
import { Eye, FileCheck, FileClock, FileSignature, Info, Lightbulb, Paperclip, Printer, TriangleAlert } from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { FILE_TYPES, fileBody, fileProblem, fileSize } from '../../components/fileUpload.js';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { ConsentPrintDocument } from './ConsentDocument.jsx';
import { INFO_STAGES, LANGUAGE_NAMES, PRINT_LANGUAGES, SUGGEST_WHY, infoStage, kindWords, printLanguageLabel } from './consentFormat.js';

// The Consent forms tab on the patient record: the hospital's forms that fit this patient (suggested ones
// first – e.g. "Scan due", "High-risk pregnancy"), printed in English with Marathi or Hindi next to it and
// filled in with her details. Who sees it follows the patient access rules: those who may see the medical
// details; the treating (or an unassigned) doctor and RMOs print. Each printout is recorded ("Printed for
// this patient"); the paper she signs is the consent.
//
// The same tab, with kind="information", is "Information given": the doctor explains a condition or complication
// (PIH, GDM, low thyroid …) and the patient and her relatives sign that they were informed. Suggested from the
// record (ticked conditions, the latest visit's red flags, lab results, the blood group).

function FormStatus({ form }) {
  return form.status === 'approved' ? (
    <StatusPill tone="stable">Approved · v{form.version}</StatusPill>
  ) : (
    <StatusPill tone="watch" icon={TriangleAlert}>
      Draft
    </StatusPill>
  );
}

function FormRow({ form, lang, canPrint, onPrint }) {
  const Icon = form.kind === 'information' ? Info : FileSignature;
  const second = lang !== 'en' && form.title[lang] ? lang : null;
  return (
    <li className="cf-row">
      <span className="cf-row-icon" aria-hidden="true">
        <Icon />
      </span>
      <div className="cf-row-text">
        <strong>{form.title.en}</strong>
        {second && (
          <span className="cf-row-sub" lang={second}>
            {form.title[second]}
          </span>
        )}
        <span className="cf-row-pills">
          {form.suggested && (
            <StatusPill tone="neutral" icon={Lightbulb}>
              {SUGGEST_WHY[form.suggested.why] ?? 'Suggested'}
            </StatusPill>
          )}
          <FormStatus form={form} />
        </span>
      </div>
      {canPrint && (
        <button type="button" className="btn btn-secondary btn-sm" aria-label={`Print ${form.title.en}`} onClick={() => onPrint(form)}>
          <Printer aria-hidden="true" /> Print
        </button>
      )}
    </li>
  );
}

function FormSection({ title, hint, forms, ...rowProps }) {
  if (!forms.length) return null;
  return (
    <section className="card cf-section" aria-label={title}>
      <h2>{title}</h2>
      {hint && <p className="hint cf-section-hint">{hint}</p>}
      <ul className="plain-list cf-list">
        {forms.map((f) => (
          <FormRow key={f.id} form={f} {...rowProps} />
        ))}
      </ul>
    </section>
  );
}

// ---------- Print dialog ----------

/**
 * Choose the language, fill in the typed blanks (procedure, reason – filled in from the record when the form is
 * suggested) and whether to print the doctor's name. again: an earlier printout to repeat (same choices).
 */
function ConsentPrintDialog({ summary, defaultLanguage, again, onPreview, onCancel }) {
  const { user } = useAuth();
  const { data, error } = useFetch(`/consent-forms/${summary.id}`);
  const form = data?.form ?? null;
  const langs = form?.languages ?? summary.languages;
  const blanks = new Set(form?.blanks ?? summary.blanks);
  const firstChoice = [again?.language, defaultLanguage, 'mr', 'hi', 'en'].find((l) => l && langs.includes(l)) ?? 'en';
  const [language, setLanguage] = useState(firstChoice);
  const [procedure, setProcedure] = useState(again?.procedure ?? summary.suggested?.prefill?.procedure ?? '');
  const [reason, setReason] = useState(again?.reason ?? summary.suggested?.prefill?.reason ?? '');
  const [condition, setCondition] = useState(again?.condition ?? summary.suggested?.prefill?.condition ?? '');
  const [doctor, setDoctor] = useState(again && !again.doctorName ? 'blank' : 'me');
  const [errors, setErrors] = useState({});
  const ref = useDialogFocus(onCancel);
  const chosen = langs.includes(language) ? language : 'en';

  const preview = (e) => {
    e.preventDefault();
    if (!form) return;
    const found = {};
    if (blanks.has('procedure') && mentionsFetalSex(procedure)) found.procedure = PCPNDT_MESSAGE;
    if (blanks.has('reason') && mentionsFetalSex(reason)) found.reason = PCPNDT_MESSAGE;
    if (blanks.has('condition') && mentionsFetalSex(condition)) found.condition = PCPNDT_MESSAGE;
    setErrors(found);
    if (Object.keys(found).length) return;
    onPreview({
      form,
      language: chosen,
      procedure: blanks.has('procedure') ? procedure.trim() : '',
      reason: blanks.has('reason') ? reason.trim() : '',
      condition: blanks.has('condition') ? condition.trim() : '',
      doctor,
    });
  };

  const reg = user.professional?.registrationNumber;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="cf-print-title" onSubmit={preview} noValidate>
        <h2 id="cf-print-title">Print: {summary.title.en}</h2>
        <Alert type="error">{error && `Couldn't load the form. ${error}`}</Alert>
        {summary.status !== 'approved' && (
          <Alert type="warning">
            This form is a <strong>draft</strong>: no doctor has approved its wording yet. The printed form says DRAFT at the top of every page.
          </Alert>
        )}
        <fieldset className="fieldset">
          <legend>Languages</legend>
          {PRINT_LANGUAGES.map((l) => {
            const available = langs.includes(l.key);
            return (
              <label key={l.key} className="check" htmlFor={`cf-lang-${l.key}`}>
                <input id={`cf-lang-${l.key}`} type="radio" name="cf-lang" checked={chosen === l.key} disabled={!available} onChange={() => setLanguage(l.key)} />
                <span>
                  {l.label}
                  {!available && <span className="muted"> – the {LANGUAGE_NAMES[l.key]} text of this form is not complete</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
        {blanks.has('procedure') && (
          <Field label="Operation or procedure" id="cf-procedure" error={errors.procedure} hint="Printed in the form. Leave empty to write it in by hand.">
            <input id="cf-procedure" value={procedure} maxLength={200} onChange={(e) => setProcedure(e.target.value)} />
          </Field>
        )}
        {blanks.has('reason') && (
          <Field label="Reason" id="cf-reason" error={errors.reason} hint="Printed in the form. Leave empty to write it in by hand.">
            <textarea id="cf-reason" rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {blanks.has('condition') && (
          <Field label="Condition or complication" id="cf-condition" error={errors.condition} hint='e.g. "Cholestasis of pregnancy". Printed in the form. Leave empty to write it in by hand.'>
            <input id="cf-condition" value={condition} maxLength={200} onChange={(e) => setCondition(e.target.value)} />
          </Field>
        )}
        <fieldset className="fieldset">
          <legend>Doctor who explains the form</legend>
          <label className="check" htmlFor="cf-doctor-me">
            <input id="cf-doctor-me" type="radio" name="cf-doctor" checked={doctor === 'me'} onChange={() => setDoctor('me')} />
            <span>
              Print my name: {user.name}
              {reg ? ` · Reg. No. ${reg}` : ''}
            </span>
          </label>
          <label className="check" htmlFor="cf-doctor-blank">
            <input id="cf-doctor-blank" type="radio" name="cf-doctor" checked={doctor === 'blank'} onChange={() => setDoctor('blank')} />
            <span>Leave it blank, to write it in by hand</span>
          </label>
        </fieldset>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!form}>
            <Eye aria-hidden="true" /> {form ? 'Preview' : 'Loading the form…'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Print preview ----------

/** The filled-in form. Print records the printout (once per preview, even if printed twice), then prints. */
function ConsentPrintPreview({ patient, choice, onPrinted, onBack, onClose }) {
  const { user, activeMembership } = useAuth();
  const lh = useFetch('/tenant/settings/letterhead');
  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const [clientRequestId] = useState(newRequestId);
  const [printedAt] = useState(() => new Date());
  const { form, language, procedure, reason, condition = '', doctor } = choice;
  const values = {
    patient: patient.fullName,
    age: patient.currentAge ?? '',
    mrn: patient.mrn,
    hospital: letterhead.name,
    doctor: doctor === 'me' ? user.name : '',
    procedure,
    reason,
    condition,
  };

  const record = async () => {
    const res = await api(`/patients/${patient.id}/consents`, {
      method: 'POST',
      body: { clientRequestId, formId: form.id, version: form.version, language, procedure, reason, condition, doctor },
    });
    onPrinted(res.consent);
  };

  return (
    <PrintPreview
      title={form.kind === 'information' ? 'Information form – print preview' : 'Consent form – print preview'}
      hint={
        <>
          {lh.error && !lh.data ? "The letterhead couldn't be loaded, so only the hospital's name is printed. " : ''}
          {printLanguageLabel(language)}. Check the page, then print it on A4 paper.{' '}
          <button type="button" className="btn btn-link plan-inline-link" onClick={onBack}>
            Change language or details
          </button>
        </>
      }
      onPrint={record}
      onClose={onClose}
    >
      <ConsentPrintDocument
        form={form}
        lang={language}
        patient={patient}
        letterhead={letterhead}
        values={values}
        doctor={doctor === 'me' ? user : null}
        printedAt={printedAt}
        printedByName={user.name}
      />
    </PrintPreview>
  );
}

// ---------- The tab ----------

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "Record the signed copy": the day it was signed, the witness and where the paper is kept. Saved once. */
function SignedDialog({ patient, consent, onDone, onCancel }) {
  const [form, setForm] = useState({ signedOn: localToday(), witness: '', keptAt: '' });
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const local = {};
    for (const k of ['witness', 'keptAt']) if (patient.careType !== 'newborn' && mentionsFetalSex(form[k])) local[k] = PCPNDT_MESSAGE;
    if (Object.keys(local).length) return setFields(local);
    setSaving(true);
    setError(null);
    try {
      await api(`/patients/${patient.id}/consents/${consent.id}/signed`, { method: 'POST', body: form });
      onDone();
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="cf-signed-title" onSubmit={save} noValidate>
        <h2 id="cf-signed-title">Record the signed copy</h2>
        <p>
          <strong>{consent.title}</strong>, printed {formatDateTime(consent.printedAt)}. Saved with your name and the time; it can't be changed later.
        </p>
        <Alert type="error">{error}</Alert>
        <Field label="Date it was signed" id="cf-signed-on" error={fields.signedOn}>
          <input id="cf-signed-on" type="date" value={form.signedOn} max={localToday()} onChange={set('signedOn')} />
        </Field>
        <Field label="Witness (optional)" id="cf-witness" error={fields.witness} hint='e.g. "Husband, Ramesh Sample"'>
          <input id="cf-witness" value={form.witness} maxLength={150} onChange={set('witness')} />
        </Field>
        <Field label="Where the paper is kept (optional)" id="cf-kept" error={fields.keptAt} hint="e.g. Patient's paper file">
          <input id="cf-kept" value={form.keptAt} maxLength={200} onChange={set('keptAt')} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Record signed copy'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** The scanned copies of a signed form (Version 2): links that open them, and "Attach scan" (at most 3 pages). */
function Scans({ patient, consent, canAdd, onAdded, onError }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const scans = consent.scans ?? [];
  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) return onError(problem);
    setBusy(true);
    try {
      await api(`/patients/${patient.id}/consents/${consent.id}/scans`, { method: 'POST', body: await fileBody(file) });
      onAdded(`Scan attached: ${file.name}.`);
    } catch (err) {
      onError(err.fields?.file ?? err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  if (!scans.length && !canAdd) return null;
  return (
    <span className="cf-scans">
      {scans.map((f, i) => (
        <a key={f.id} href={`/api/patients/${patient.id}/consents/${consent.id}/scans/${f.id}`} target="_blank" rel="noopener noreferrer" className="t-caption">
          <Paperclip aria-hidden="true" /> Scan {scans.length > 1 ? i + 1 : ''} ({fileSize(f.size)})
        </a>
      ))}
      {canAdd && scans.length < 3 && (
        <>
          <input ref={input} type="file" accept={FILE_TYPES.join(',')} className="sr-only" onChange={choose} tabIndex={-1} aria-hidden="true" />
          <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => input.current?.click()} aria-label={`Attach a scan of the signed ${consent.title}`}>
            {busy ? 'Attaching…' : scans.length ? 'Attach another page' : 'Attach the scan'}
          </button>
        </>
      )}
    </span>
  );
}

export function PatientConsentsTab({ kind = 'consent' }) {
  const { patient } = useOutletContext();
  const W = kindWords(kind);
  const information = kind === 'information';
  const canView = Boolean(patient.access?.canViewConsents);
  const { data, error, loading, reload } = useFetch(canView ? `/patients/${patient.id}/consents` : null, information ? { kind: 'information' } : undefined);
  const [printing, setPrinting] = useState(null); // { step: 'dialog' | 'preview', summary, again?, choice? }
  const [notice, setNotice] = useState(null);
  const [recording, setRecording] = useState(null); // the printout whose signed copy is being recorded
  const [scanError, setScanError] = useState(null);

  if (!canView) return <div className="card">{W.plural} are not part of your role for this patient.</div>;
  if (error && !data) {
    return (
      <div className="card">
        <Alert type="error">{error}</Alert>
        <button type="button" className="btn btn-secondary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="card plan-loading" aria-busy="true">
        <span className="sr-only">Loading the {W.many}…</span>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="plan-skeleton" />
        ))}
      </div>
    );
  }

  const forms = data.forms;
  const lang = data.defaultLanguage;
  const canPrint = data.canPrint;
  const careWord = (CARE_TYPE_SHORT[patient.careType] ?? patient.careType).toLowerCase();
  const suggested = forms.filter((f) => f.suggested);
  const forCare = forms.filter((f) => !f.suggested && f.forThisCare && f.careTypes.length);
  const general = forms.filter((f) => !f.suggested && f.forThisCare && !f.careTypes.length);
  const others = forms.filter((f) => !f.suggested && !f.forThisCare);
  const activeIds = new Set(forms.map((f) => f.id));
  const anyDraft = forms.some((f) => f.forThisCare && f.status !== 'approved');
  const rowProps = { lang, canPrint, onPrint: (summary) => setPrinting({ step: 'dialog', summary }) };

  const printed = (consent) => {
    setNotice(`Printed: ${consent.title}. It is listed under “${information ? 'Given to this patient' : 'Printed for this patient'}”.`);
    reload();
  };

  return (
    <div className="cf-tab">
      <Alert type="error" onClose={() => setScanError(null)}>
        {scanError}
      </Alert>
      <Alert type="success" onClose={() => setNotice(null)}>
        {notice}
      </Alert>
      {information && (
        <p className="hint plan-hint">
          For a condition or complication found at an OPD visit or at admission: explain it to the patient and her relatives, print the sheet, and have them
          sign that they were informed. This is not a consent – an operation or procedure still needs its consent form.
        </p>
      )}
      {anyDraft && (
        <Alert type="warning">
          Some {W.many} are <strong>drafts</strong>: their wording, including the Marathi and Hindi translations, must be checked by the hospital and approved
          by a doctor before use. Printed drafts say DRAFT on every page. <Link to={W.base}>Review the forms</Link>
        </Alert>
      )}
      {!canPrint && <p className="hint plan-hint">View only – the patient's doctor or an RMO prints {W.many}.</p>}

      <FormSection
        title={information ? 'To explain now' : 'Suggested now'}
        hint={
          information
            ? "From the patient's record: ticked conditions, the latest visit's red flags, lab results and the blood group – the doctor decides what to explain."
            : "From the patient's record and care plan – the doctor decides which consents to take."
        }
        forms={suggested}
        {...rowProps}
      />
      {information ? (
        // Many sheets: by stage of care (the general sheet and the hospital's own under "Other")
        INFO_STAGES.map((stage) => (
          <FormSection key={stage} title={stage} forms={[...forCare, ...general].filter((f) => infoStage(f) === stage)} {...rowProps} />
        ))
      ) : (
        <>
          <FormSection title={`For ${careWord} care`} forms={forCare} {...rowProps} />
          <FormSection title="For every patient" forms={general} {...rowProps} />
        </>
      )}
      {others.length > 0 && (
        <details className="plan-folded card">
          <summary>
            Forms for other types of care <span className="tabular">({others.length})</span>
          </summary>
          <ul className="plain-list cf-list">
            {others.map((f) => (
              <FormRow key={f.id} form={f} {...rowProps} />
            ))}
          </ul>
        </details>
      )}
      {forms.length === 0 && (
        <div className="card">
          No {W.many} are in use. Doctors choose the forms in Clinic library › {W.plural}.
        </div>
      )}

      {recording && (
        <SignedDialog
          patient={patient}
          consent={recording}
          onCancel={() => setRecording(null)}
          onDone={() => {
            setRecording(null);
            setNotice('The signed copy is recorded.');
            reload();
          }}
        />
      )}
      <section className="card cf-section" aria-labelledby="cf-printed-title">
        <h2 id="cf-printed-title">{information ? 'Given to this patient' : 'Printed for this patient'}</h2>
        {data.printed.length === 0 ? (
          <p className="muted">No {W.one} has been printed for this patient yet.</p>
        ) : (
          <ul className="plain-list cf-printed">
            {data.printed.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{c.title}</strong>
                  <span className="t-caption muted">
                    {formatDateTime(c.printedAt)} · {c.printedByName} · {printLanguageLabel(c.language)} · version {c.formVersion}
                    {c.formApproved ? '' : ' (draft)'}
                    {c.procedure ? ` · ${c.procedure}` : ''}
                    {c.condition ? ` · ${c.condition}` : ''}
                  </span>
                  {/* Whether the signed paper came back (the signed paper is the consent) */}
                  <span className="cf-signed">
                    {c.signed ? (
                      <>
                        <StatusPill tone="stable" icon={FileCheck}>
                          Signed copy received
                        </StatusPill>{' '}
                        <span className="t-caption muted">
                          Signed {formatDate(c.signed.on)}
                          {c.signed.witness ? ` · witness: ${c.signed.witness}` : ''}
                          {c.signed.keptAt ? ` · kept: ${c.signed.keptAt}` : ''} · recorded by {c.signed.recordedByName}
                        </span>{' '}
                        <Scans
                          patient={patient}
                          consent={c}
                          canAdd={data.canRecordSigned}
                          onAdded={(text) => {
                            setNotice(text);
                            reload();
                          }}
                          onError={setScanError}
                        />
                      </>
                    ) : (
                      <>
                        <StatusPill tone="watch" icon={FileClock}>
                          Signed copy not received yet
                        </StatusPill>
                        {data.canRecordSigned && (
                          <button type="button" className="btn btn-link btn-sm" onClick={() => setRecording(c)} aria-label={`Record the signed copy of ${c.title}`}>
                            Record signed copy
                          </button>
                        )}
                      </>
                    )}
                  </span>
                </div>
                {canPrint && activeIds.has(c.formId) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    aria-label={`Print ${c.title} again`}
                    onClick={() => setPrinting({ step: 'dialog', summary: forms.find((f) => f.id === c.formId), again: c })}
                  >
                    <Printer aria-hidden="true" /> Print again
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {printing?.step === 'dialog' && (
        <ConsentPrintDialog
          summary={printing.summary}
          defaultLanguage={lang}
          again={printing.again}
          onPreview={(choice) => setPrinting({ ...printing, step: 'preview', choice })}
          onCancel={() => setPrinting(null)}
        />
      )}
      {printing?.step === 'preview' && (
        <ConsentPrintPreview
          patient={patient}
          choice={printing.choice}
          onPrinted={printed}
          onBack={() => setPrinting({ ...printing, step: 'dialog', again: { ...printing.choice, doctorName: printing.choice.doctor === 'me' ? 'me' : null } })}
          onClose={() => setPrinting(null)}
        />
      )}
    </div>
  );
}
