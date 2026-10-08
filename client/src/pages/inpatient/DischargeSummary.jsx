// The discharge summary (owner, 8 Oct 2026): Draft → Ready for review → Finalized. The patient and admission details
// come from her record; every clinical, medicine, instruction and follow-up field is required (the server checks it
// when the summary is marked ready or finalized – a draft may be incomplete). Finalized: locked; corrections are added
// below it. Used on the stay (form and view), in the preview and in the printout (DischargeSummaryView).
import { Ban, CircleCheck, Eye, FileDown, FileText, PencilLine, Plus, Printer, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { admissionsApi, patientsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Modal } from '../../components/Modal.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { ageText, formatDate, formatDateTime } from '../../utils/format.js';
import { DURATION_UNITS, FORMS, FREQUENCIES, ROUTES, TIMINGS } from '../visits/visitFormat.js';
import { toLocalInput } from './inpatientFormat.js';

export const ADMISSION_TYPES = { emergency: 'Emergency', planned: 'Planned', referral: 'Referred', labour: 'In labour', transfer: 'Transfer from another hospital' };
const SEX = { female: 'Female', male: 'Male', other: 'Other' };
const noBlank = (map) => Object.fromEntries(Object.entries(map).filter(([k]) => k !== ''));

// The sections and their fields (all required). key → [label, kind, hint]
const SECTIONS = [
  ['Admission', [
    ['dischargedAt', 'Date and time of discharge', 'datetime'],
    ['admissionType', 'Type of admission', 'admissionType'],
    ['department', 'Department', 'text', 'For example Obstetrics and Gynaecology'],
  ]],
  ['Clinical summary', [
    ['chiefComplaint', 'Chief complaint', 'area'],
    ['admissionDiagnosis', 'Diagnosis at admission', 'area'],
    ['finalDiagnosis', 'Final diagnosis', 'area'],
    ['procedures', 'Procedure / surgery', 'area', 'Write None if there was none'],
    ['course', 'Course in hospital', 'area', 'Treatment given and how she did'],
    ['investigations', 'Investigation summary', 'area', 'Main lab and scan results'],
    ['importantFindings', 'Important findings', 'area', 'Write None if there were none'],
    ['conditionAtDischarge', 'Condition at discharge', 'area'],
  ]],
  ['Discharge medicines', [['medicines', 'Medicines', 'medicines']]],
  ['Discharge instructions', [
    ['diet', 'Diet', 'area'],
    ['activity', 'Activity restrictions', 'area', 'Write None if there are none'],
    ['woundCare', 'Wound care', 'area', 'Write Not applicable if there is no wound'],
    ['warningSigns', 'Warning signs – when to come back at once', 'area'],
    ['otherInstructions', 'Other instructions', 'area', 'Write None if there are none'],
  ]],
  ['Follow-up', [
    ['followUpOn', 'Follow-up date', 'date'],
    ['followUpDoctorId', 'Follow-up doctor', 'doctor'],
    ['followUpDepartment', 'Department', 'text'],
    ['followUpInstructions', 'Follow-up instructions', 'area', 'For example: bring all reports'],
  ]],
];
const ALL_KEYS = SECTIONS.flatMap(([, fields]) => fields.map(([k]) => k));
export const DISCHARGE_LABELS = Object.fromEntries(SECTIONS.flatMap(([, fields]) => fields.map(([k, l]) => [k, l])));

/** "Draft" / "Ready for review" / "Finalized" / "Entered in error". */
export function summaryStatus(doc) {
  if (doc.status === 'cancelled') return { word: 'Entered in error', tone: 'inactive', icon: Ban };
  if (doc.status === 'signed') return { word: 'Finalized', tone: 'active', icon: CircleCheck };
  if (doc.readyForReview) return { word: 'Ready for review', tone: 'info', icon: Send };
  return { word: 'Draft', tone: 'pending', icon: PencilLine };
}

// What is still missing, worked out in the browser (the server checks it again): field key → message.
function missingIn(c) {
  const out = {};
  for (const k of ALL_KEYS) {
    if (k === 'medicines') continue;
    if (!String(c[k] ?? '').trim()) out[`content.${k}`] = 'Required';
  }
  const meds = c.medicines ?? [];
  if (!meds.length) out['content.medicines'] = 'Add at least one medicine';
  meds.forEach((m, i) => {
    for (const [k, label] of [['drug', 'medicine'], ['dose', 'dose'], ['frequency', 'how often'], ['route', 'route'], ['durationValue', 'how long'], ['durationUnit', 'days / weeks']]) {
      if (!String(m[k] ?? '').trim()) out[`content.medicines.${i}.${k}`] = `Give the ${label}`;
    }
  });
  return out;
}

const medicineLine = (m) => [
  [FORMS[m.form], m.drug].filter(Boolean).join(' '),
  m.dose,
  FREQUENCIES[m.frequency]?.split(' (')[0] ?? m.frequency,
  m.timing && TIMINGS[m.timing],
  m.route && ROUTES[m.route],
  m.durationValue && `${m.durationValue} ${DURATION_UNITS[m.durationUnit] ?? ''}`,
];

/** The patient and admission block (from her record, never typed). */
export function PatientBlock({ patient, stay, content }) {
  const rows = [
    ['Patient', patient.name, 'Patient no.', patient.patientNumber],
    ['Age / sex', [patient.birthDate && ageText(patient.birthDate, patient.birthDateApprox), SEX[patient.sex]].filter(Boolean).join(' / ') || '—', 'Admission no.', stay.admissionNumber || '—'],
    ['Admitted', formatDateTime(stay.admittedAt), 'Discharged', content.dischargedAt ? formatDateTime(content.dischargedAt) : '—'],
    ['Doctor', stay.doctorName || '—', 'Department', content.department || '—'],
    ['Ward / bed', [stay.ward, stay.bed].filter(Boolean).join(' / ') || '—', 'Admission type', ADMISSION_TYPES[content.admissionType] ?? '—'],
  ];
  return (
    <table className="print-info summary-info">
      <tbody>
        {rows.map(([a, b, c, d]) => (
          <tr key={a}><th>{a}</th><td>{b}</td><th>{c}</th><td>{d}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** The summary as it is read and printed. */
export function DischargeSummaryView({ patient, stay, content = {} }) {
  const meds = content.medicines ?? [];
  const block = (keys) => keys.map((k) => (
    <div key={k} className="summary-row">
      <dt>{DISCHARGE_LABELS[k] ?? k}</dt>
      <dd className="pre">{content[k] || '—'}</dd>
    </div>
  ));
  return (
    <div className="discharge-summary">
      <h3 className="summary-h">Patient information</h3>
      <PatientBlock patient={patient} stay={stay} content={content} />
      <h3 className="summary-h">Clinical summary</h3>
      <dl className="summary-list">{block(['chiefComplaint', 'admissionDiagnosis', 'finalDiagnosis', 'procedures', 'course', 'investigations', 'importantFindings', 'conditionAtDischarge'])}</dl>
      <h3 className="summary-h">Discharge medicines</h3>
      {meds.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <table className="print-table">
          <thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>How often</th><th>Food</th><th>Route</th><th>For</th></tr></thead>
          <tbody>
            {meds.map((m, i) => (
              <tr key={i}><td>{i + 1}</td>{medicineLine(m).map((x, j) => <td key={j}>{x || '—'}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="summary-h">Discharge instructions</h3>
      <dl className="summary-list">{block(['diet', 'activity', 'woundCare', 'warningSigns', 'otherInstructions'])}</dl>
      <h3 className="summary-h">Follow-up</h3>
      <dl className="summary-list">
        <div className="summary-row"><dt>Date</dt><dd>{content.followUpOn ? formatDate(content.followUpOn) : '—'}</dd></div>
        <div className="summary-row"><dt>Doctor</dt><dd>{content.followUpDoctorName || '—'}</dd></div>
        <div className="summary-row"><dt>Department</dt><dd>{content.followUpDepartment || '—'}</dd></div>
        <div className="summary-row"><dt>Instructions</dt><dd className="pre">{content.followUpInstructions || '—'}</dd></div>
      </dl>
    </div>
  );
}

function MedicineTable({ value = [], onChange, errors }) {
  const set = (i, k, v) => onChange(value.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const err = (i, k) => errors[`content.medicines.${i}.${k}`];
  const sel = (i, k, map, placeholder) => (
    <select aria-label={k} value={value[i][k] ?? ''} className={err(i, k) ? 'has-error' : undefined} onChange={(e) => set(i, k, e.target.value)}>
      <option value="">{placeholder}</option>
      {Object.entries(map).map(([key, l]) => <option key={key} value={key}>{l}</option>)}
    </select>
  );
  const input = (i, k, placeholder, extra = {}) => (
    <input aria-label={k} placeholder={placeholder} value={value[i][k] ?? ''} className={err(i, k) ? 'has-error' : undefined} onChange={(e) => set(i, k, extra.digits ? e.target.value.replace(/\D/g, '') : e.target.value)} {...(extra.digits && { inputMode: 'numeric' })} />
  );
  return (
    <div className="rx-table-wrap">
      {value.length > 0 && (
        <table className="rx-table">
          <thead><tr><th>Medicine *</th><th>Form</th><th>Dose *</th><th>How often *</th><th>Food</th><th>Route *</th><th>For *</th><th /></tr></thead>
          <tbody>
            {value.map((m, i) => (
              <tr key={i}>
                <td>{input(i, 'drug', 'e.g. Paracetamol')}</td>
                <td>{sel(i, 'form', Object.fromEntries(Object.entries(FORMS).filter(([k]) => k !== 'other').map(([k, l]) => [k, l.replace('.', '')])), 'Other')}</td>
                <td>{input(i, 'dose', '500 mg / 1 tab')}</td>
                <td>{sel(i, 'frequency', Object.fromEntries(Object.entries(FREQUENCIES).filter(([k]) => k !== 'custom')), 'Choose…')}</td>
                <td>{sel(i, 'timing', noBlank(TIMINGS), '—')}</td>
                <td>{sel(i, 'route', noBlank(ROUTES), 'Choose…')}</td>
                <td className="rx-duration">{input(i, 'durationValue', '5', { digits: true })}{sel(i, 'durationUnit', noBlank(DURATION_UNITS), '—')}</td>
                <td><button type="button" className="icon-btn" aria-label={`Remove medicine ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Object.entries(errors).filter(([k]) => k.startsWith('content.medicines')).slice(0, 3).map(([k, m]) => <span key={k} className="field-error block">{k.match(/\.(\d+)\./) ? `Medicine ${Number(k.match(/\.(\d+)\./)[1]) + 1}: ` : ''}{m}</span>)}
      <button type="button" className="btn btn-ghost btn-sm top-gap-sm" onClick={() => onChange([...value, { drug: '', form: 'tab', dose: '', frequency: '1-0-1', timing: 'after_food', route: 'oral', durationValue: '5', durationUnit: 'days' }])}>
        <Plus size={14} aria-hidden /> Add medicine
      </button>
    </div>
  );
}

export function DischargeSummary({ stayId, stay, patient, doc, can, onChanged }) {
  const doctors = useOptions(patientsApi.doctors);
  const [content, setContent] = useState(doc.content ?? {});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [addition, setAddition] = useState('');
  const status = summaryStatus(doc);
  const editable = doc.status === 'draft' && can.write;
  const set = (k) => (v) => setContent((c) => ({ ...c, [k]: v }));
  const followUpDoctorName = doctors.find((d) => d.value === content.followUpDoctorId)?.label ?? content.followUpDoctorName ?? '';
  const shown = { ...content, followUpDoctorName };

  const run = async (action, message, after) => {
    setBusy(true);
    setError('');
    setErrors({});
    setNotice('');
    try {
      const r = await action();
      onChanged(r);
      if (r.document?.content) setContent(r.document.content);
      setNotice(message);
      after?.(r);
    } catch (err) {
      setError(err.message);
      setErrors(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const save = (message = 'Draft saved.', after) => run(() => admissionsApi.saveDocument(stayId, doc.id, { rev: doc.rev, content }), message, after);
  // Ready / Finalize: everything is checked here first (the server checks again)
  const complete = () => {
    const missing = missingIn(content);
    if (Object.keys(missing).length) {
      setErrors(missing);
      setError(`${Object.keys(missing).length} required ${Object.keys(missing).length === 1 ? 'field is' : 'fields are'} still empty.`);
      return false;
    }
    return true;
  };
  const markReady = () => complete() && save('Saved.', () => run(() => admissionsApi.readyDocument(stayId, doc.id), 'Ready for review. A doctor can now finalize it.'));
  const finalize = () => {
    if (!complete()) return;
    if (!window.confirm('Finalize the discharge summary and discharge her? It can no longer be changed (corrections are added below it).')) return;
    save('Saved.', () => run(() => admissionsApi.signDocument(stayId, doc.id), 'Finalized – she is discharged. Print the summary or save it as PDF.'));
  };
  const draftPdf = () => save('Draft saved.', () => window.open(`/hospital/print/ward-document/${stayId}/${doc.id}`, '_blank'));

  const field = ([k, label, kind, hint]) => {
    const id = `ds-${k}`;
    const err = errors[`content.${k}`];
    let control;
    if (kind === 'area') control = <textarea id={id} rows={2} value={content[k] ?? ''} onChange={(e) => set(k)(e.target.value)} />;
    else if (kind === 'datetime') control = <input id={id} type="datetime-local" value={toLocalInput(content[k])} onChange={(e) => set(k)(e.target.value ? new Date(e.target.value).toISOString() : '')} />;
    else if (kind === 'date') control = <input id={id} type="date" value={content[k] ?? ''} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set(k)(e.target.value)} />;
    else if (kind === 'admissionType')
      control = (
        <select id={id} value={content[k] ?? ''} onChange={(e) => set(k)(e.target.value)}>
          <option value="">Choose…</option>
          {Object.entries(ADMISSION_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      );
    else if (kind === 'doctor')
      control = (
        <select id={id} value={content[k] ?? ''} onChange={(e) => set(k)(e.target.value)}>
          <option value="">Choose…</option>
          {doctors.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      );
    else if (kind === 'medicines') control = <MedicineTable value={content.medicines} onChange={set('medicines')} errors={errors} />;
    else control = <input id={id} value={content[k] ?? ''} onChange={(e) => set(k)(e.target.value)} />;
    const wide = kind === 'area' || kind === 'medicines';
    return (
      <div key={k} className={`form-field ${wide ? 'width-full' : 'width-third'}${err ? ' has-error' : ''}`}>
        {kind !== 'medicines' && <label htmlFor={id}>{label}<span className="required" aria-hidden> *</span></label>}
        {control}
        {err && kind !== 'medicines' && <span className="field-error">{err}</span>}
        {!err && hint && <span className="field-help">{hint}</span>}
      </div>
    );
  };

  return (
    <section className="card discharge-card-box">
      <div className="card-head">
        <h2><FileText size={18} aria-hidden /> Discharge summary</h2>
        <StateBadge look={status} />
      </div>
      <p className="muted small">
        Started by {doc.createdByName}
        {doc.savedAt && ` · saved by ${doc.savedByName}, ${formatDateTime(doc.savedAt)}`}
        {doc.readyForReview && ` · ready for review (${doc.readyForReview.byName}, ${formatDateTime(doc.readyForReview.at)})`}
        {doc.signed && ` · finalized by ${doc.signed.byName}, ${formatDateTime(doc.signed.at)}`}
        {doc.cancelled && ` · entered in error: ${doc.cancelled.reason}`}
      </p>
      {(error || notice) && (
        <Alert type={error ? 'error' : 'success'}>
          {error || notice}
          {error && Object.keys(errors).length > 0 && (
            <ul className="fix-list">
              {Object.entries(errors).slice(0, 12).map(([k, m]) => {
                const med = /^content\.medicines\.(\d+)/.exec(k);
                const name = med ? `Medicine ${Number(med[1]) + 1}` : DISCHARGE_LABELS[k.replace('content.', '')] ?? k;
                return <li key={k}><strong>{name}:</strong> {m}</li>;
              })}
            </ul>
          )}
        </Alert>
      )}

      {editable ? (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
          <h3 className="summary-h">Patient information</h3>
          <PatientBlock patient={patient} stay={stay} content={shown} />
          {SECTIONS.map(([title, fields]) => (
            <div key={title}>
              <h3 className="summary-h">{title}</h3>
              <div className="form-grid">{fields.map(field)}</div>
            </div>
          ))}
          <div className="summary-actions">
            <button type="submit" className="btn btn-ghost" disabled={busy}>Save draft</button>
            <button type="button" className="btn btn-ghost" onClick={() => setPreview(true)}><Eye size={16} aria-hidden /> Preview</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={draftPdf}><FileDown size={16} aria-hidden /> Generate PDF</button>
            {!doc.readyForReview && <button type="button" className="btn btn-ghost" disabled={busy} onClick={markReady}><Send size={16} aria-hidden /> Ready for review</button>}
            {can.sign.discharge && <button type="button" className="btn btn-primary" disabled={busy} onClick={finalize}><CircleCheck size={16} aria-hidden /> Finalize discharge</button>}
          </div>
          {!can.sign.discharge && <p className="muted small">A doctor finalizes the summary – mark it ready for review when it is complete.</p>}
        </form>
      ) : (
        <>
          <DischargeSummaryView patient={patient} stay={stay} content={shown} />
          {doc.status === 'signed' && (
            <div className="summary-actions">
              <a className="btn btn-primary" href={`/hospital/print/discharge-card/${doc.id}`} target="_blank" rel="noreferrer"><Printer size={16} aria-hidden /> Print</a>
              <a className="btn btn-ghost" href={`/hospital/print/discharge-card/${doc.id}`} target="_blank" rel="noreferrer"><FileDown size={16} aria-hidden /> Download PDF</a>
              <span className="muted small">For a PDF, choose “Save as PDF” in the print window.</span>
            </div>
          )}
          {doc.additions?.length > 0 && (
            <>
              <h3 className="summary-h">Corrections and additions</h3>
              <ul className="plain-list rows">{doc.additions.map((a, i) => <li key={i}><span className="pre">{a.text}</span><span className="muted small">{a.byName}, {formatDateTime(a.at)}</span></li>)}</ul>
            </>
          )}
          {doc.status === 'signed' && (can.write || can.nursing) && (
            <form className="leave-row top-gap-sm" onSubmit={(e) => { e.preventDefault(); run(() => admissionsApi.addToDocument(stayId, doc.id, addition), 'Correction added.', () => setAddition('')); }}>
              <input aria-label="Correction" placeholder="Add a correction (the summary itself stays as finalized)" value={addition} maxLength={2000} onChange={(e) => setAddition(e.target.value)} />
              <button type="submit" className="btn btn-ghost btn-sm" disabled={addition.trim().length < 3 || busy}>Add</button>
            </form>
          )}
        </>
      )}

      {preview && (
        <Modal title="Preview – discharge summary" onClose={() => setPreview(false)} size="lg">
          <p className="muted small">This is how it will print. Nothing is saved by previewing.</p>
          <DischargeSummaryView patient={patient} stay={stay} content={shown} />
        </Modal>
      )}
    </section>
  );
}
