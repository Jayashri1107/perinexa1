import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BadgeCheck, CircleMinus, MoreHorizontal, Plus, Printer, Trash2 } from 'lucide-react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { BiLabel, PrintLanguageChoice, Translation } from '../../components/print/Bilingual.jsx';
import { DoctorSignature, Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { DRAFT_TRANSLATION_HINT, ageWords, defaultPrintLanguage, secondLanguage } from '../../components/print/printLanguage.js';
import { Alert, ConfirmDialog, Field, StatusPill, formatDate, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { ageText } from '../patients/patientFormat.js';
import { MedicineRows } from '../visits/MedicineRows.jsx';
import { MEDICINES } from '../visits/medicines.js';
import { instructionLine, medicineName } from '../visits/rxFormat.js';
import { isBlankRow, toItem, toRow } from '../visits/rxRows.js';
import { DISCHARGE_FIELD_WORDS, DISCHARGE_WORDS } from './dischargeWords.js';
import { DOC_FIELDS, VITAL_FIELDS, emptyBaby } from './docFields.js';
import { BREASTFED_LABELS, NICU_LABELS, STILLBIRTH_TYPE_LABELS, babyOutcomeWords, pphHint, tidyBaby } from './deliveryOutcomes.js';
import { BABY_SEX_LABELS, DOCTOR_CONFIRMS, KIND_LABELS, OUTCOME_LABELS, docStatusLook, fromLocalInput, toLocalInput, vitalsLine } from './inpatientFormat.js';

// One inpatient document (Version 2): written as a draft (Save draft), then signed – admission and round notes by
// the doctor or RMO who writes them, delivery, operation and discharge confirmed by a doctor. Signed: locked, with
// corrections added below it. Printed on the hospital's letterhead with the signer's name and registration number.
// The discharge card – the document she takes home – prints in English only, or with Marathi or Hindi next to the
// English (5 Oct 2026; DRAFT wording): its own words and the medicines' dose, timing and duration; what the doctor
// wrote prints as typed. Every other document is a staff document, printed in English.

/** Every piece of text in the content (for the check on words about the baby's sex). */
const textsOf = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(textsOf) : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** The saved content → what the form edits (strings; times in this computer's time; medicines as rows). */
export function toForm(kind, c = {}) {
  const f = {};
  for (const field of DOC_FIELDS[kind]) {
    const v = c[field.key];
    if (field.type === 'datetime') f[field.key] = toLocalInput(v);
    else if (field.type === 'vitals') f[field.key] = Object.fromEntries(VITAL_FIELDS.map((x) => [x.key, str(v?.[x.key])]));
    else if (field.type === 'babies') f[field.key] = (v ?? []).map((b) => Object.fromEntries(Object.keys(emptyBaby()).map((k) => [k, str(b[k])])));
    else if (field.type === 'medicines') f[field.key] = (v ?? []).map(toRow);
    else f[field.key] = str(v);
  }
  return f;
}
/** The form → the content to save. */
export function toContent(kind, f) {
  const c = {};
  for (const field of DOC_FIELDS[kind]) {
    const v = f[field.key];
    if (field.type === 'datetime') c[field.key] = fromLocalInput(v);
    else if (field.type === 'date') c[field.key] = v || null;
    else if (field.type === 'medicines') c[field.key] = v.filter((r) => !isBlankRow(r)).map(toItem);
    else c[field.key] = v;
  }
  return c;
}

/** One field as words (the read-only page and the printout); null when empty. */
function shownValue(field, v) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null;
  switch (field.type) {
    case 'datetime':
      return formatDateTime(v);
    case 'date':
      return formatDate(v);
    case 'select':
    case 'pph':
      return field.options[v] ?? v;
    case 'number':
      return `${v}${field.unit ? ` ${field.unit}` : ''}`;
    case 'vitals':
      return vitalsLine(v) || null;
    case 'babies':
      // ("Baby 1: Live birth · Female …" – the number of a twin is not one of the parts)
      return v
        .map((b, i) => {
          const parts = [
            OUTCOME_LABELS[b.outcome],
            BABY_SEX_LABELS[b.sex],
            b.weightGrams != null && b.weightGrams !== '' ? `${b.weightGrams} g` : null,
            b.apgar1 != null && b.apgar1 !== '' ? `Apgar ${b.apgar1}/${b.apgar5 ?? '–'}` : null,
            ...babyOutcomeWords(b),
            b.notes || null,
          ].filter(Boolean);
          return `${v.length > 1 ? `Baby ${i + 1}: ` : ''}${parts.join(' · ')}`;
        })
        .join('\n');
    case 'medicines':
      return v.map((it, i) => `${i + 1}. ${medicineName(it)} – ${instructionLine(it)}${it.instructions ? ` (${it.instructions})` : ''}`).join('\n');
    default:
      return String(v);
  }
}

/**
 * The discharge card's medicines with the dose, timing and duration in her language under each English line
 * (the names, strengths and a medicine's own instructions as typed).
 */
function DischargeMedicines({ items, lang }) {
  return items.map((it, i) => (
    // A medicine has no id: its place in the list is its key
    <span key={i} className="pdoc-block">
      {`${i + 1}. ${medicineName(it)} – ${instructionLine(it)}${it.instructions ? ` (${it.instructions})` : ''}`}
      <Translation text={instructionLine(it, lang)} english={instructionLine(it)} lang={lang} />
    </span>
  ));
}

/**
 * The document's content as label and words (read-only page and printout). lang (the printed discharge card only):
 * 'mr' or 'hi' prints the labels and the medicines' instructions in that language next to the English.
 */
export function DocContent({ kind, content, className = 'details', lang = 'en' }) {
  const second = kind === 'discharge' ? secondLanguage(lang) : null;
  const rows = DOC_FIELDS[kind].map((f) => [f, shownValue(f, content?.[f.key])]).filter(([, v]) => v !== null);
  if (!rows.length) return <p className="muted">Nothing written yet.</p>;
  return (
    <dl className={className}>
      {rows.map(([f, v]) => (
        <div key={f.key}>
          <dt>{second && DISCHARGE_FIELD_WORDS[f.key] ? <BiLabel words={DISCHARGE_FIELD_WORDS[f.key]} lang={second} /> : f.key === 'babies' && content.babies.length > 1 ? 'Babies' : f.label}</dt>
          <dd className="pre-line">{second && f.type === 'medicines' ? <DischargeMedicines items={content[f.key]} lang={second} /> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The printed document (in the print preview, and in tests): the letterhead, the title, her details, the content,
 * corrections and the signature. lang: for the discharge card, 'mr' or 'hi' prints that language next to the English.
 */
export function DocPrintDocument({ patient, page, letterhead, printedAt, printedByName, lang = 'en' }) {
  const d = page.document;
  const a = page.admission;
  const second = d.kind === 'discharge' ? secondLanguage(lang) : null;
  const title = KIND_LABELS[d.kind];
  const W = DISCHARGE_WORDS;
  // On the discharge card in Marathi or Hindi: "Age / वय"; every other document as before
  const label = (key, en) => (second ? <BiLabel key={key} words={W[key]} lang={second} /> : en);
  const both = (en, other) =>
    second && other ? (
      <>
        {en} / <span lang={second}>{other}</span>
      </>
    ) : (
      en
    );
  const draftEn = `DRAFT – not ${DOCTOR_CONFIRMS.includes(d.kind) ? 'confirmed by a doctor' : 'signed'} yet.`;
  const footer = (
    <>
      <span>
        {title} · {d.status === 'signed' ? `${DOCTOR_CONFIRMS.includes(d.kind) ? 'confirmed' : 'signed'} by ${d.signed.byName} on ${formatDateTime(d.signed.at)}` : 'draft'}
      </span>
      <span>
        {patient.fullName} · {patient.mrn} · printed {formatDateTime(printedAt)} by {printedByName}
      </span>
    </>
  );
  const bed = a.bed ? both(`Bed ${a.bed}`, second ? `${W.bed[second]} ${a.bed}` : '') : null;
  return (
    <PrintDocument draft={d.status !== 'signed' ? both(draftEn, second ? W.draft[second] : '') : null} footer={footer}>
      <Letterhead letterhead={letterhead} />
      <h1 className="pdoc-title">{title}</h1>
      {second && (
        <p className="pdoc-title pdoc-title-2" lang={second}>
          {W.title[second]}
        </p>
      )}
      <PrintFacts
        items={[
          [label('patient', 'Patient'), patient.fullName],
          [label('age', 'Age'), both(ageText(patient), second ? ageWords(patient, second) : '')],
          [label('patientNo', 'Patient no.'), patient.mrn],
          [label('admitted', 'Admitted'), formatDateTime(a.admittedAt)],
          ...(a.dischargedAt ? [[label('discharged', 'Discharged'), formatDateTime(a.dischargedAt)]] : []),
          [
            label('wardBed', 'Ward / bed'),
            a.ward || bed ? (
              <>
                {a.ward}
                {a.ward && bed ? ' · ' : ''}
                {bed}
              </>
            ) : (
              '—'
            ),
          ],
        ]}
      />
      <DocContent kind={d.kind} content={d.content} className="pdoc-details" lang={lang} />
      {d.additions.length > 0 && (
        <>
          <h2>{label('corrections', 'Corrections and additions')}</h2>
          {d.additions.map((x) => (
            <p key={x.id}>
              {x.text} <span className="pdoc-small">({x.byName}, {formatDateTime(x.at)})</span>
            </p>
          ))}
        </>
      )}
      {d.status === 'signed' && page.signer ? <DoctorSignature user={page.signer} /> : <p className="pdoc-small">{both('Not signed yet.', second ? W.notSigned[second] : '')}</p>}
    </PrintDocument>
  );
}

export function DocForm({ kind, form, setForm, fields }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const names = useMemo(() => MEDICINES.map((m) => m.name), []);
  const fe = (k) => fields[`content.${k}`];
  return (
    <div className="ip-form">
      {DOC_FIELDS[kind].map((f) => {
        const id = `doc-${f.key}`;
        const label = `${f.label}${f.required ? '' : ' (optional)'}`;
        switch (f.type) {
          case 'area':
            return (
              <Field key={f.key} label={label} id={id} error={fe(f.key)}>
                <textarea id={id} rows={3} value={form[f.key]} maxLength={f.max ?? 2000} onChange={set(f.key)} />
              </Field>
            );
          case 'datetime':
            return (
              <Field key={f.key} label={label} id={id} error={fe(f.key)}>
                <input id={id} type="datetime-local" value={form[f.key]} onChange={set(f.key)} />
              </Field>
            );
          case 'date':
            return (
              <Field key={f.key} label={label} id={id} error={fe(f.key)}>
                <input id={id} type="date" value={form[f.key]} onChange={set(f.key)} />
              </Field>
            );
          case 'number':
            return (
              <Field key={f.key} label={`${label}${f.unit ? ` – ${f.unit}` : ''}`} id={id} error={fe(f.key)}>
                <input id={id} inputMode="decimal" value={form[f.key]} onChange={set(f.key)} />
              </Field>
            );
          case 'select':
            return (
              <Field key={f.key} label={label} id={id} error={fe(f.key)}>
                <select id={id} value={form[f.key]} onChange={set(f.key)}>
                  <option value="">Choose…</option>
                  {Object.entries(f.options).map(([k, w]) => (
                    <option key={k} value={k}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
            );
          case 'pph':
            // The doctor's answer; the blood loss only suggests it (never ticked by itself)
            return (
              <Field key={f.key} label={label} id={id} error={fe(f.key)} hint={pphHint(form.mode, form.bloodLossMl)} keepHint>
                <select id={id} value={form[f.key]} onChange={set(f.key)}>
                  <option value="">Not recorded</option>
                  {Object.entries(f.options).map(([k, w]) => (
                    <option key={k} value={k}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
            );
          case 'vitals':
            return (
              <fieldset key={f.key} className="fieldset">
                <legend>{f.label}</legend>
                <div className="form-grid ip-vitals">
                  {VITAL_FIELDS.map((v) => (
                    <Field key={v.key} label={v.label} id={`${id}-${v.key}`} error={fe(`vitals.${v.key}`)}>
                      <input id={`${id}-${v.key}`} inputMode="decimal" value={form.vitals[v.key]} onChange={(e) => setForm({ ...form, vitals: { ...form.vitals, [v.key]: e.target.value } })} />
                    </Field>
                  ))}
                </div>
              </fieldset>
            );
          case 'babies':
            return (
              <fieldset key={f.key} className="fieldset">
                <legend>Babies</legend>
                {fe('babies') && <p className="field-error">{fe('babies')}</p>}
                {form.babies.map((b, i) => {
                  // (an answer that does not fit the outcome is cleared: the server drops it too)
                  const setB = (k) => (e) => setForm({ ...form, babies: form.babies.map((x, j) => (j === i ? tidyBaby({ ...x, [k]: e.target.value }) : x)) });
                  const pick = (k, labelText, options, hint) => (
                    <Field label={labelText} id={`b-${k}-${i}`} error={fe(`babies.${i}.${k}`)} hint={hint} keepHint={Boolean(hint)}>
                      <select id={`b-${k}-${i}`} value={b[k]} onChange={setB(k)}>
                        <option value="">Not recorded</option>
                        {Object.entries(options).map(([o, w]) => (
                          <option key={o} value={o}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </Field>
                  );
                  return (
                    <div key={i} className="ip-baby">
                      <div className="item-editor-head">
                        <strong>Baby {i + 1}</strong>
                        <button type="button" className="icon-btn icon-danger" aria-label={`Remove baby ${i + 1}`} onClick={() => setForm({ ...form, babies: form.babies.filter((_, j) => j !== i) })}>
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                      <div className="form-grid">
                        <Field label="Outcome" id={`b-out-${i}`} error={fe(`babies.${i}.outcome`)}>
                          <select id={`b-out-${i}`} value={b.outcome} onChange={setB('outcome')}>
                            <option value="">Choose…</option>
                            {Object.entries(OUTCOME_LABELS).map(([k, w]) => (
                              <option key={k} value={k}>
                                {w}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Sex" id={`b-sex-${i}`} error={fe(`babies.${i}.sex`)}>
                          <select id={`b-sex-${i}`} value={b.sex} onChange={setB('sex')}>
                            <option value="">Choose…</option>
                            {Object.entries(BABY_SEX_LABELS).map(([k, w]) => (
                              <option key={k} value={k}>
                                {w}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Birth weight (g)" id={`b-wt-${i}`} error={fe(`babies.${i}.weightGrams`)}>
                          <input id={`b-wt-${i}`} inputMode="numeric" value={b.weightGrams} onChange={setB('weightGrams')} />
                        </Field>
                        <Field label="Apgar 1 min" id={`b-a1-${i}`} error={fe(`babies.${i}.apgar1`)}>
                          <input id={`b-a1-${i}`} inputMode="numeric" value={b.apgar1} onChange={setB('apgar1')} />
                        </Field>
                        <Field label="Apgar 5 min" id={`b-a5-${i}`} error={fe(`babies.${i}.apgar5`)}>
                          <input id={`b-a5-${i}`} inputMode="numeric" value={b.apgar5} onChange={setB('apgar5')} />
                        </Field>
                        {b.outcome === 'stillbirth' && pick('stillbirthType', 'Kind of stillbirth', STILLBIRTH_TYPE_LABELS, 'Fresh: the baby died during labour. Macerated: before labour.')}
                        {b.outcome !== 'stillbirth' && pick('breastfedWithinHour', 'Breastfed within one hour of birth', BREASTFED_LABELS, 'Not applicable: for example the baby went to the NICU at once.')}
                        {b.outcome !== 'stillbirth' && pick('nicu', 'Admitted to the NICU or SNCU', NICU_LABELS)}
                        <Field label="Notes (optional)" id={`b-n-${i}`} error={fe(`babies.${i}.notes`)}>
                          <input id={`b-n-${i}`} value={b.notes} maxLength={500} onChange={setB('notes')} />
                        </Field>
                      </div>
                    </div>
                  );
                })}
                {form.babies.length < 4 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, babies: [...form.babies, emptyBaby()] })}>
                    <Plus aria-hidden="true" /> Add {form.babies.length ? 'another baby' : 'the baby'}
                  </button>
                )}
              </fieldset>
            );
          case 'medicines':
            return (
              <fieldset key={f.key} className="fieldset">
                <legend>{f.label}</legend>
                <MedicineRows rows={form.medicines} setRows={(fn) => setForm((cur) => ({ ...cur, medicines: typeof fn === 'function' ? fn(cur.medicines) : fn }))} fieldError={(i, k) => fe(`medicines.${i}.${k}`)} names={names} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, medicines: [...form.medicines, toRow({ form: 'tab', frequency: '' })] })} disabled={form.medicines.length >= 40}>
                  <Plus aria-hidden="true" /> Add medicine
                </button>
              </fieldset>
            );
          default:
            return (
              <Field key={f.key} label={label} id={id} error={fe(f.key)}>
                <input id={id} value={form[f.key]} maxLength={f.max ?? 500} onChange={set(f.key)} />
              </Field>
            );
        }
      })}
    </div>
  );
}

function DocPrint({ patient, page, onClose }) {
  const { user, activeMembership } = useAuth();
  const lh = useFetch('/tenant/settings/letterhead');
  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const [printedAt] = useState(() => new Date());
  const d = page.document;
  const a = page.admission;
  const discharge = d.kind === 'discharge';
  // The discharge card opens in the language recorded for her messages; the staff documents are in English
  const [language, setLanguage] = useState(() => defaultPrintLanguage(patient));
  const lang = discharge ? language : 'en';
  const second = secondLanguage(lang);
  const title = KIND_LABELS[d.kind];
  const record = () => api(`/patients/${patient.id}/admissions/${a.id}/documents/${d.id}/printed`, { method: 'POST', ...(discharge ? { body: { language: lang } } : {}) });
  const controls = discharge ? (
    <PrintLanguageChoice
      value={language}
      onChange={setLanguage}
      hints={
        second
          ? [
              `${second === 'mr' ? 'Marathi' : 'Hindi'} prints under the English: the card's own words and each medicine's dose, timing and duration. What the doctor wrote – the diagnosis, the course, the advice, the follow-up note, a medicine's own instructions – prints as typed.`,
              DRAFT_TRANSLATION_HINT,
            ]
          : []
      }
    />
  ) : null;
  return (
    <PrintPreview title={`${title} – print preview`} hint="Check the page, then print it on A4 paper." controls={controls} onPrint={record} onClose={onClose}>
      <DocPrintDocument patient={patient} page={page} letterhead={letterhead} printedAt={printedAt} printedByName={user.name} lang={lang} />
    </PrintPreview>
  );
}

function ReasonDialog({ title, text, label, confirmLabel, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const ref = useDialogFocus(onCancel);
  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Please say why (at least 5 characters).');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err.message);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="reason-title" onSubmit={submit} noValidate>
        <h2 id="reason-title">{title}</h2>
        <p>{text}</p>
        <Field label={label} id="reason-text" error={error}>
          <input id="reason-text" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-danger">
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function DocumentPage() {
  const { patient, reload: reloadPatient } = useOutletContext();
  const { admissionId, docId } = useParams();
  const { activeMembership } = useAuth();
  const url = `/patients/${patient.id}/admissions/${admissionId}/documents/${docId}`;
  const { data, error, reload } = useFetch(url);
  const [page, setPage] = useState(null);
  const [form, setForm] = useState(null);
  const [fields, setFields] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [addition, setAddition] = useState('');

  useEffect(() => {
    if (!data) return;
    setPage(data);
    setForm(toForm(data.document.kind, data.document.content));
  }, [data]);
  if (error && !page) return <Alert type="error">{error}</Alert>;
  if (!page || !form) return <div className="card plan-loading" aria-busy="true" />;

  const d = page.document;
  const kind = d.kind;
  // A delivery draft made before the type of care became Abortion opens read-only (no delivery note for abortion care).
  const noDeliveryNote = kind === 'delivery' && patient.careType === 'abortion';
  const editable = d.status === 'draft' && page.access.canWrite && !noDeliveryNote;
  const doctorKind = DOCTOR_CONFIRMS.includes(kind);
  const canSign = editable && (doctorKind ? hasRole(activeMembership, 'doctor') : hasRole(activeMembership, 'doctor', 'rmo'));
  const dirty = editable && JSON.stringify(toContent(kind, form)) !== JSON.stringify(toContent(kind, toForm(kind, d.content)));
  const look = docStatusLook(d);
  const back = `/patients/${patient.id}/stays/${admissionId}`;

  const applied = (res, message) => {
    setPage((p) => ({ ...p, ...res, document: res.document, admission: res.admission ?? p.admission }));
    if (res.document) setForm(toForm(kind, res.document.content));
    setFields({});
    if (message) setNotice({ type: 'success', text: message });
  };
  // Saves the draft; returns the saved document (or null when something must be fixed).
  const saveDraft = async () => {
    const content = toContent(kind, form);
    if (patient.careType !== 'newborn' && kind !== 'delivery' && textsOf(content).some((t) => mentionsFetalSex(t))) {
      setNotice({ type: 'error', text: PCPNDT_MESSAGE });
      return null;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await api(url, { method: 'PUT', body: { rev: d.rev, content } });
      applied(res, 'Draft saved.');
      return res.document;
    } catch (err) {
      setFields(err.fields ?? {});
      setNotice({ type: err.status === 409 ? 'warning' : 'error', text: err.message });
      if (err.status === 409) reload();
      return null;
    } finally {
      setBusy(false);
    }
  };
  const sign = async () => {
    setConfirming(false);
    let doc = d;
    if (dirty) {
      doc = await saveDraft();
      if (!doc) return;
    }
    setBusy(true);
    try {
      const res = await api(`${url}/sign`, { method: 'POST', body: { rev: doc.rev } });
      applied(res, doctorKind ? 'Confirmed and signed. The document is locked; corrections can be added below.' : 'Signed. The document is locked; corrections can be added below.');
      reloadPatient();
      reload();
    } catch (err) {
      setFields(err.fields ?? {});
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };
  const addCorrection = async (e) => {
    e.preventDefault();
    if (addition.trim().length < 3) return setNotice({ type: 'error', text: 'Please write the correction or addition.' });
    if (patient.careType !== 'newborn' && kind !== 'delivery' && mentionsFetalSex(addition)) return setNotice({ type: 'error', text: PCPNDT_MESSAGE });
    try {
      applied(await api(`${url}/additions`, { method: 'POST', body: { text: addition.trim() } }), 'Correction added.');
      setAddition('');
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
    return undefined;
  };

  return (
    <div className="vs-page ip-page">
      <section className="card vs-visit-head">
        <div className="vs-visit-top">
          <Link to={back} className="btn btn-link vs-back">
            <ArrowLeft aria-hidden="true" /> The stay
          </Link>
          <div className="row">
            {canSign && (
              <button type="button" className="btn btn-positive" onClick={() => setConfirming(true)} disabled={busy}>
                <BadgeCheck aria-hidden="true" /> {doctorKind ? 'Confirm and sign' : 'Sign'}
              </button>
            )}
            {d.status !== 'cancelled' && (
              <button type="button" className="btn btn-secondary" onClick={() => setPrinting(true)} disabled={dirty}>
                <Printer aria-hidden="true" /> Print
              </button>
            )}
            {page.access.canWrite && d.status !== 'cancelled' && !(kind === 'discharge' && d.status === 'signed') && (
              <MenuButton
                className="btn btn-secondary"
                icon={MoreHorizontal}
                label="More"
                align="end"
                ariaLabel="More actions for this document"
                items={[{ label: 'Mark as entered in error', icon: CircleMinus, danger: true, onSelect: () => setCancelling(true) }]}
              />
            )}
          </div>
        </div>
        <div className="vs-visit-title">
          <h2>{KIND_LABELS[kind]}</h2>
          <StatusPill tone={look.tone} icon={look.icon}>
            {look.word}
          </StatusPill>
        </div>
        <p className="hint">
          Written by {d.createdByName}
          {d.savedByName ? ` · last saved by ${d.savedByName}, ${formatDateTime(d.savedAt)}` : ''}
          {d.signed ? ` · ${doctorKind ? 'confirmed' : 'signed'} by ${d.signed.byName}, ${formatDateTime(d.signed.at)}` : ''}
        </p>
        {editable && doctorKind && !canSign && <p className="hint">A doctor confirms this document: save the draft – it appears in the doctor's “Waiting for your confirmation”.</p>}
      </section>
      {noDeliveryNote && d.status === 'draft' && <Alert type="info">A delivery note is not used for the Abortion type of care – use an operation note.</Alert>}
      {d.cancelled && (
        <Alert type="info">
          Marked as entered in error by {d.cancelled.byName} on {formatDateTime(d.cancelled.at)}: {d.cancelled.reason}
        </Alert>
      )}
      {notice && (
        <Alert type={notice.type} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {editable ? (
        <section className="card">
          <DocForm kind={kind} form={form} setForm={setForm} fields={fields} />
          <div className="sticky-actions">
            <span className="grow hint">{dirty ? 'Unsaved changes.' : 'All changes saved.'}</span>
            <button type="button" className="btn btn-primary" onClick={saveDraft} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </section>
      ) : (
        <section className="card">
          <DocContent kind={kind} content={d.content} />
        </section>
      )}

      {kind === 'delivery' && d.status === 'signed' && (d.content.babies ?? []).some((b) => b.outcome === 'live') && (
        <section className="card">
          <h2>The baby's record</h2>
          <p>A baby is a patient of her own, linked to her mother. Register each live baby from New patient → Newborn, choosing {patient.fullName} as the mother.</p>
          <Link to="/patients/new/newborn" className="btn btn-secondary">
            Register a newborn
          </Link>
        </section>
      )}

      {d.status === 'signed' && (d.additions.length > 0 || page.access.canAddAddition) && (
        <section className="card vs-additions" aria-labelledby="doc-add-title">
          <h2 id="doc-add-title">Corrections and additions</h2>
          {d.additions.length > 0 && (
            <ol className="vs-addition-list">
              {d.additions.map((x) => (
                <li key={x.id}>
                  <p className="pre-line">{x.text}</p>
                  <p className="hint">
                    {x.byName} · {formatDateTime(x.at)}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {page.access.canAddAddition && (
            <form onSubmit={addCorrection} noValidate>
              <Field label="Add a correction or addition" id="doc-addition" hint="Saved with your name and the time. It can't be changed or removed later." keepHint>
                <textarea id="doc-addition" rows={2} maxLength={2000} value={addition} onChange={(e) => setAddition(e.target.value)} />
              </Field>
              <button type="submit" className="btn btn-primary">
                Add
              </button>
            </form>
          )}
        </section>
      )}

      {confirming && (
        <ConfirmDialog
          id="doc-sign"
          title={doctorKind ? `Confirm and sign this ${KIND_LABELS[kind].toLowerCase()}?` : `Sign this ${KIND_LABELS[kind].toLowerCase()}?`}
          confirmLabel={doctorKind ? 'Confirm and sign' : 'Sign'}
          onConfirm={sign}
          onCancel={() => setConfirming(false)}
        >
          {dirty ? 'Your changes are saved first. ' : ''}After signing nothing in it can be changed; a correction can still be added below it, with your name and the time.
          {kind === 'discharge' ? ' Confirming the discharge card discharges the patient.' : ''}
        </ConfirmDialog>
      )}
      {cancelling && (
        <ReasonDialog
          title="Mark this document as entered in error?"
          text="It is kept, but no longer counted or changed."
          label="Why"
          confirmLabel="Mark as entered in error"
          onCancel={() => setCancelling(false)}
          onConfirm={async (reason) => {
            await api(`${url}/cancel`, { method: 'POST', body: { reason } });
            setCancelling(false);
            reload();
          }}
        />
      )}
      {printing && <DocPrint patient={patient} page={page} onClose={() => setPrinting(false)} />}
    </div>
  );
}
