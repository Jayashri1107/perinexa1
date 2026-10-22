import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Ban, CircleCheck, FileText, Inbox, Paperclip, Printer, Siren, Tag, TestTube, Upload } from 'lucide-react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, Field, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { OutsideSection, RejectDialog, VerifyCard } from './LabOrderExtras.jsx';
import { AntibioticTable, calcHint, previewCalc } from './LabTemplateParts.jsx';
import { LabLabels, LabReportPrint } from './LabPrints.jsx';
import { HomeCard, PreviousResults } from './LabWalkIn.jsx';
import { OrderTracker } from './OrderTracker.jsx';
import {
  FILE_TYPES,
  FLAG_LOOK,
  LATE_LOOK,
  FLAG_OPTIONS,
  MAX_FILE_BYTES,
  fileSize,
  fileUrl,
  flagFor,
  formFromOrder,
  orderLook,
  packageNames,
  readAsBase64,
  resultLine,
  SENSITIVITY,
  antibioticRows,
  bySection,
  testDef,
  testsFromForm,
  turnaround,
  valueWords,
} from './labFormat.js';

// One lab order (Version 2, lab module) – in the Lab module (/lab/orders/:orderId) and on the patient record
// (/patients/:id/lab/:orderId). The lab marks the sample taken, enters the results (or attaches the report) and
// reports them; a doctor reviews them. A change after the report needs a reason and goes back to the doctor.
// Lab staff see only the patient's name, number and age, the tests and the doctor's note to the lab.

function FlagPill({ flag }) {
  const look = FLAG_LOOK[flag];
  if (!look) return null;
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {look.word}
    </StatusPill>
  );
}

/** The results, read only: one table per test, with the reference values. */
function ResultsView({ order, catalogue }) {
  return (
    <div className="lab-results">
      {order.tests.map((t, i) => {
        const def = testDef(catalogue, t.key);
        const values = t.values.filter((v) => v.value !== '');
        return (
          <div key={`${t.key}-${i}`} className="lab-test">
            <h3>{t.name}</h3>
            {t.outside && <p className="hint">Done at {t.outside.labName}</p>}
            {values.length > 0 && (
              <table className="lab-values">
                <thead>
                  <tr>
                    <th scope="col">Test</th>
                    <th scope="col">Result</th>
                    <th scope="col">Usual range</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((v) => {
                    // The words saved with the result: the range that applied to this patient
                    const w = valueWords(v, def);
                    return (
                      <tr key={v.key}>
                        <th scope="row">{w.name}</th>
                        <td>
                          <strong className="tabular pre-line">{v.value}</strong> {w.unit} <FlagPill flag={v.flag} />
                          {v.calculated && <span className="muted"> (worked out)</span>}
                          {v.bigChange && (
                            <StatusPill tone="watch" icon={Siren}>
                              Big change ({v.deltaPercent > 0 ? '+' : ''}
                              {v.deltaPercent} %)
                            </StatusPill>
                          )}
                        </td>
                        <td className="muted">{w.range}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {t.antibiotics?.length > 0 && (
              <table className="lab-values lab-abx-table">
                <caption>Sensitivity</caption>
                <thead>
                  <tr>
                    <th scope="col">Antibiotic</th>
                    <th scope="col">Result</th>
                    <th scope="col">Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {t.antibiotics.map((a) => (
                    <tr key={a.name}>
                      <th scope="row">{a.name}</th>
                      <td>{SENSITIVITY[a.result] ?? a.result}</td>
                      <td>{a.zone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {t.text && <p className="pre-line">{t.text}</p>}
            {!values.length && !t.text && !t.antibiotics?.length && <p className="muted">No result typed{order.files.length ? ' – see the report file' : ''}.</p>}
          </div>
        );
      })}
      {order.labNote && (
        <p>
          <span className="muted">Lab remark: </span>
          {order.labNote}
        </p>
      )}
    </div>
  );
}

/** Entering or changing the results. amending: they were reported already (a reason is needed). */
function ResultsForm({ order, catalogue, pcpndt, amending, primary, verify, qcRejected = [], onSaved, onCancel }) {
  const [form, setForm] = useState(() => formFromOrder(order));
  const [labNote, setLabNote] = useState(order.labNote ?? '');
  const [reason, setReason] = useState('');
  const [qcReason, setQcReason] = useState('');
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(null); // 'save' | 'report'

  const setValue = (i, f, value) =>
    setForm((cur) =>
      cur.map((e, j) => {
        if (j !== i) return e;
        const before = e.values[f.key] ?? {};
        // The flag follows the value until someone chooses it; a value typed over a worked-out one is the lab's own
        const flag = before.flagChosen ? before.flag : flagFor(f, value);
        return { ...e, values: { ...e.values, [f.key]: { ...before, value, flag, calculated: false } } };
      }),
    );
  const setFlag = (i, f, flag) => setForm((cur) => cur.map((e, j) => (j === i ? { ...e, values: { ...e.values, [f.key]: { ...(e.values[f.key] ?? { value: '' }), flag, flagChosen: true } } } : e)));
  const setText = (i, text) => setForm((cur) => cur.map((e, j) => (j === i ? { ...e, text } : e)));
  const setAntibiotics = (i, rows) => setForm((cur) => cur.map((e, j) => (j === i ? { ...e, antibiotics: rows } : e)));

  const send = async (report) => {
    const texts = [labNote, reason, ...form.flatMap((e) => [e.text, ...Object.values(e.values).map((v) => v.value)])];
    if (pcpndt && texts.some((t) => mentionsFetalSex(t))) {
      setError(PCPNDT_MESSAGE);
      return;
    }
    if (amending && reason.trim().length < 5) {
      setFields({ reason: 'Write why the results are changed.' });
      return;
    }
    setSaving(report ? 'report' : 'save');
    setError(null);
    setFields({});
    try {
      const res = await api(`/lab/orders/${order.id}/results`, { method: 'PUT', body: { rev: order.rev, tests: testsFromForm(order, form, catalogue), labNote: labNote.trim(), report, reason: reason.trim(), qcReason: qcReason.trim() } });
      const words =
        res.order.status === 'entered' && report
          ? 'Results entered. They go to the doctor once a second person has checked them.'
          : report || amending
            ? 'Results reported. The doctor sees them for review.'
            : 'Results saved – not reported yet.';
      onSaved(res.order, `${words}${res.stockShort?.length ? ` Not enough stock for: ${res.stockShort.join(', ')} – check Lab → Stock.` : ''}`);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(null);
    }
  };

  return (
    <form
      className="lab-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        send(true);
      }}
    >
      <Alert type="error">{error}</Alert>
      {order.tests.map((t, i) => {
        const def = testDef(catalogue, t.key);
        const entry = form[i];
        const list = def?.fields ?? [];
        return (
          <fieldset key={`${t.key}-${i}`} className="fieldset lab-test lab-entry-test">
            <legend>{t.name}</legend>
            {fields[`tests.${i}`] && <p className="field-error">{fields[`tests.${i}`]}</p>}
            {list.length > 0 && (
              <table className="lab-entry">
                <thead>
                  <tr>
                    <th scope="col">Value</th>
                    <th scope="col">Result</th>
                    <th scope="col">Unit</th>
                    <th scope="col">Usual range</th>
                    <th scope="col">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {bySection(list).flatMap(([section, fs]) => [
                    // A heading row where the report's section changes (report templates)
                    ...(section
                      ? [
                          <tr key={`s-${section}`} className="lab-entry-section">
                            <th scope="rowgroup" colSpan={5}>
                              {section}
                            </th>
                          </tr>,
                        ]
                      : []),
                    ...fs.map((f) => {
                    const id = `lab-${i}-${f.key}`;
                    const v = entry.values[f.key] ?? { value: '', flag: '' };
                    const err = fields[`tests.${i}.${f.key}`];
                    return (
                      <tr key={f.key} className={err ? 'has-error' : ''}>
                        <th scope="row" data-label="Value">
                          <label htmlFor={id}>{f.name}</label>
                        </th>
                        <td data-label="Result">
                          {f.type === 'choice' ? (
                            <select id={id} value={v.value} onChange={(e) => setValue(i, f, e.target.value)}>
                              <option value="">—</option>
                              {f.options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : f.type === 'text' && f.long ? (
                            <textarea id={id} rows={4} maxLength={2000} value={v.value} onChange={(e) => setValue(i, f, e.target.value)} />
                          ) : f.type === 'text' ? (
                            <input id={id} value={v.value} maxLength={100} onChange={(e) => setValue(i, f, e.target.value)} />
                          ) : (
                            // A worked-out value (MCV, globulin …) shows what it comes to; typed over, the lab's own is kept
                            <input
                              id={id}
                              className="tabular"
                              inputMode="decimal"
                              value={v.calculated ? '' : v.value}
                              placeholder={(f.calc ? previewCalc(f, def, entry) : null) ?? (v.calculated ? v.value : '')}
                              maxLength={20}
                              onChange={(e) => setValue(i, f, e.target.value)}
                            />
                          )}
                          {err && <span className="field-error">{err}</span>}
                        </td>
                        <td data-label="Unit">{f.unit ?? ''}</td>
                        <td data-label="Usual range" className="muted">
                          {f.range ?? ''}
                          {f.calc && <span className="lab-order-sub">{calcHint(f, def, entry)}</span>}
                        </td>
                        <td data-label="Flag">
                          {f.type === 'number' ? (
                            <select aria-label={`Flag for ${f.name}`} value={v.flag ?? ''} onChange={(e) => setFlag(i, f, e.target.value)}>
                              {FLAG_OPTIONS.map(([k, w]) => (
                                <option key={k} value={k}>
                                  {w}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <FlagPill flag={v.flag} />
                          )}
                        </td>
                      </tr>
                    );
                    }),
                  ])}
                </tbody>
              </table>
            )}
            {def?.report?.template === 'culture' && (
              <AntibioticTable idPrefix={`lab-${i}`} rows={antibioticRows(def.antibiotics, entry.antibiotics)} onChange={(rows) => setAntibiotics(i, rows)} error={fields[`tests.${i}.antibiotics`]} />
            )}
            <Field label={def ? 'Comment on this test (optional)' : 'Result'} id={`lab-${i}-text`} error={fields[`tests.${i}.text`]}>
              {def ? (
                <input id={`lab-${i}-text`} maxLength={2000} value={entry.text} onChange={(e) => setText(i, e.target.value)} />
              ) : (
                <textarea id={`lab-${i}-text`} rows={3} maxLength={2000} value={entry.text} onChange={(e) => setText(i, e.target.value)} />
              )}
            </Field>
          </fieldset>
        );
      })}
      <Field label="Lab remark (optional)" id="lab-note" error={fields.labNote}>
        <input id="lab-note" maxLength={1000} value={labNote} onChange={(e) => setLabNote(e.target.value)} />
      </Field>
      {qcRejected.length > 0 && (
        <>
          <Alert type="warning">Quality control was rejected today for this test and has no corrective action yet (Lab → QC).</Alert>
          <Field label="Why may the result still be reported?" id="lab-qc-reason" error={fields.qcReason}>
            <input id="lab-qc-reason" maxLength={300} value={qcReason} onChange={(e) => setQcReason(e.target.value)} />
          </Field>
        </>
      )}
      {amending && (
        <Field label="Why are the results changed?" id="lab-reason" error={fields.reason}>
          <input id="lab-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <div className="row">
        <button type="submit" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={Boolean(saving)}>
          <FileText aria-hidden="true" /> {saving === 'report' ? 'Saving…' : amending ? 'Save the change' : verify && order.status !== 'entered' ? 'Send for checking' : 'Report results'}
        </button>
        {!amending && (
          <button type="button" className="btn btn-secondary" disabled={Boolean(saving)} onClick={() => send(false)}>
            {saving === 'save' ? 'Saving…' : 'Save for later'}
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Files({ order, pcpndt, onSaved }) {
  const input = useRef(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false); // after the report: the reason is asked first
  const amending = ['reported', 'reviewed'].includes(order.status);
  const canAdd = order.access.canReport && order.files.length < 5;
  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!FILE_TYPES.includes(file.type)) return setError('Choose a PDF or a photo (JPEG, PNG or WebP).');
    if (file.size > MAX_FILE_BYTES) return setError('The file is too large (at most 5 MB).');
    if (amending && reason.trim().length < 5) return setError('The results were reported already: write why the file is added, then choose it.');
    if (pcpndt && mentionsFetalSex(reason)) return setError(PCPNDT_MESSAGE);
    setBusy(true);
    setError(null);
    try {
      const data = await readAsBase64(file);
      const res = await api(`/lab/orders/${order.id}/files`, { method: 'POST', body: { fileName: file.name, mediaType: file.type, data, reason: reason.trim() } });
      setReason('');
      setAsking(false);
      onSaved(res.order, `Report file added: ${file.name}.`);
    } catch (err) {
      setError(err.fields?.file ?? err.fields?.reason ?? err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  if (!order.files.length && !canAdd) return null;
  return (
    <section className="card" aria-labelledby="lab-files-title">
      <h2 id="lab-files-title">
        <Paperclip aria-hidden="true" /> Report files
      </h2>
      <Alert type="error">{error}</Alert>
      {order.files.length > 0 ? (
        <ul className="plain-list">
          {order.files.map((f) => (
            <li key={f.id}>
              <a href={fileUrl(order, f)} target="_blank" rel="noopener noreferrer">
                {f.fileName}
              </a>{' '}
              <span className="muted">
                · {fileSize(f.size)} · {f.byName}, {formatDateTime(f.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No report file yet.</p>
      )}
      {canAdd && (
        <>
          {amending && asking && (
            <Field label="Why is a file added after the report?" id="lab-file-reason">
              <input id="lab-file-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
          )}
          <input ref={input} type="file" accept={FILE_TYPES.join(',')} className="sr-only" onChange={choose} tabIndex={-1} aria-hidden="true" />
          <div className="row">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => (amending && !asking ? setAsking(true) : input.current?.click())}>
              <Upload aria-hidden="true" /> {busy ? 'Uploading…' : amending && asking ? 'Choose the file' : 'Attach the report (PDF or photo)'}
            </button>
            {asking && (
              <button type="button" className="btn btn-link" onClick={() => setAsking(false)}>
                Cancel
              </button>
            )}
          </div>
          {(!amending || asking) && <p className="hint">At most 5 MB. Use only fake sample reports until the app has been reviewed.</p>}
        </>
      )}
    </section>
  );
}

function CancelDialog({ order, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const save = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Write why the order is cancelled.');
    setSaving(true);
    try {
      const res = await api(`/lab/orders/${order.id}/cancel`, { method: 'POST', body: { rev: order.rev, reason: reason.trim() } });
      onDone(res.order);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="lab-cancel-title" onSubmit={save} noValidate>
        <h2 id="lab-cancel-title">Cancel this order?</h2>
        <p>The order stays in the record, marked cancelled with your name and the reason.</p>
        <Field label="Reason" id="lab-cancel-reason" error={error}>
          <input id="lab-cancel-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-danger" disabled={saving}>
            {saving ? 'Cancelling…' : 'Cancel the order'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Keep it
          </button>
        </div>
      </form>
    </div>
  );
}

function Review({ order, onSaved }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (order.abnormal && comment.trim().length < 3) return setError('A result is outside the usual range: write what was done about it.');
    if (mentionsFetalSex(comment)) return setError(PCPNDT_MESSAGE);
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/lab/orders/${order.id}/review`, { method: 'POST', body: { rev: order.rev, comment: comment.trim() } });
      // A reviewed haemoglobin counts for the risk level (the lowest Hb of this pregnancy)
      onSaved(res.order, `Reviewed.${res.planChanged ? ' The matching care-plan items are marked done.' : ''}${res.riskChanged ? ' Her risk level changed with this result – see her Overview.' : ''}`);
    } catch (err) {
      setError(err.fields?.comment ?? err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <form className="card" onSubmit={save} noValidate aria-labelledby="lab-review-title">
      <h2 id="lab-review-title">Your review</h2>
      <Field label={order.abnormal ? 'What was done about the result' : 'Comment (optional)'} id="lab-review-comment" error={error}>
        <textarea id="lab-review-comment" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <CircleCheck aria-hidden="true" /> {saving ? 'Saving…' : 'Mark reviewed'}
        </button>
      </div>
    </form>
  );
}

export function LabOrderPage() {
  const outlet = useOutletContext();
  const inRecord = Boolean(outlet?.patient);
  const { orderId } = useParams();
  const { data, error, reload: refetch } = useFetch(`/lab/orders/${orderId}`);
  const [current, setCurrent] = useState(null); // the order as the latest change answered (until the next load)
  useEffect(() => setCurrent(null), [orderId]);
  const [notice, setNotice] = useState(null);
  const [changing, setChanging] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [printing, setPrinting] = useState(null); // 'labels' | 'report'
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const order = current ?? data?.order;
  const reload = () => {
    setCurrent(null);
    refetch();
  };
  const catalogue = data?.catalogue;
  const back = inRecord ? `/patients/${outlet.patient.id}/lab` : '/lab';

  // Ctrl+P on a lab order prints the report, never this page with its buttons (22 Oct 2026). While a print preview
  // is open, Ctrl+P prints that preview as usual.
  const canPrintReport = Boolean(order?.access?.canPrint);
  const previewOpen = useRef(false);
  previewOpen.current = printing !== null;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'p' || previewOpen.current) return;
      e.preventDefault();
      if (canPrintReport) setPrinting('report');
      else setNotice('The report can be printed once its results are entered.');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canPrintReport]);
  const header = !inRecord && (
    <PageHeader tabs={HOSPITAL_LAB.tabs} breadcrumbs={[{ label: 'Lab', to: '/lab' }, { label: 'Lab order' }]} title={order ? order.patient.fullName : 'Lab order'} documentTitle="Lab order" />
  );
  if (error && !order) {
    return (
      <>
        {header}
        <div className="pf-content">
          <Alert type="error">{error}</Alert>
          <Link to={back}>Back</Link>
        </div>
      </>
    );
  }
  if (!order) {
    return (
      <>
        {header}
        <div className="pf-content">
          <p className="muted">Loading…</p>
        </div>
      </>
    );
  }

  const saved = (next, message) => {
    setCurrent({ ...next, patient: order.patient });
    setNotice(message);
    setChanging(false);
    setActionError(null);
    if (inRecord) outlet.reload?.();
  };
  const collect = async () => {
    setBusy(true);
    try {
      saved((await api(`/lab/orders/${order.id}/collect`, { method: 'POST', body: { rev: order.rev } })).order, 'Sample marked taken.');
    } catch (err) {
      setActionError(err.message);
      if (err.status === 409) reload();
    } finally {
      setBusy(false);
    }
  };

  const look = orderLook(order);
  const a = order.access;
  const pcpndt = order.patient.careType !== 'newborn';
  const open = ['ordered', 'collected'].includes(order.status);
  const done = ['reported', 'reviewed'].includes(order.status);
  // One primary button: review, else "sample taken", else reporting
  const primaryReport = !a.canReview && !a.canCollect && !a.canVerify;
  const failed = (err) => {
    setActionError(err.message);
    if (err.status === 409) reload();
  };

  return (
    <>
      {header}
      <div className={inRecord ? 'vs-tab lab-order-page' : 'pf-content lab-order-page'}>
        <Link to={back} className="btn btn-link btn-sm">
          <ArrowLeft aria-hidden="true" /> {inRecord ? 'All lab orders' : 'Lab worklist'}
        </Link>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <Alert type="error">{actionError}</Alert>

        <section className="card lab-order-card" aria-labelledby="lab-order-title">
          <div className="lab-order-top">
            <div className="lab-order-who">
              <h2 id="lab-order-title">
                <TestTube aria-hidden="true" /> {order.tests.map((t) => t.name).join(', ')}
              </h2>
              {!inRecord && (
                <p className="lab-order-patient">
                  <strong>{order.patient.fullName}</strong>
                  <span className="muted tabular">
                    {order.patient.mrn}
                    {order.patient.age != null ? ` · ${order.patient.age} yrs` : ''} · {CARE_TYPE_SHORT[order.patient.careType] ?? order.patient.careType}
                  </span>
                </p>
              )}
            </div>
            <span className="lab-order-pills">
              {order.urgent && (
                <StatusPill tone="high" icon={Siren}>
                  Urgent
                </StatusPill>
              )}
              {order.late && (
                <StatusPill tone={LATE_LOOK.tone} icon={LATE_LOOK.icon}>
                  {LATE_LOOK.word}
                </StatusPill>
              )}
              {order.status === 'ordered' && order.rejections?.length > 0 && (
                <StatusPill tone="watch" icon={Ban}>
                  New sample needed
                </StatusPill>
              )}
              <StatusPill tone={look.tone} icon={look.icon}>
                {look.word}
              </StatusPill>
            </span>
          </div>

          {/* Who did each step and when: the tracker (the facts below hold the rest) */}
          <OrderTracker order={order} />

          <dl className="lab-order-facts">
            <div>
              <dt>Sample number</dt>
              <dd className="tabular">{order.sampleNo ?? 'Given when the label is printed or the sample is taken'}</dd>
            </div>
            <div>
              <dt>Ordered by</dt>
              <dd>
                {order.ordered.byName}
                <span className="muted lab-order-sub">{formatDateTime(order.ordered.at)}</span>
              </dd>
            </div>
            {order.dueAt && order.status !== 'cancelled' && (
              <div>
                <dt>{order.reported ? 'Time taken' : 'Report due'}</dt>
                <dd>{order.reported ? `${turnaround(order)}${order.late ? ' – after the due time' : ''}` : formatDateTime(order.dueAt)}</dd>
              </div>
            )}
            <div>
              <dt>{order.source === 'walk_in' ? 'Walk-in · referred by' : 'Ordered from'}</dt>
              <dd>
                {order.source === 'walk_in' ? (order.referrer?.name ?? 'Self') : 'A doctor of this hospital'}
                {order.source === 'walk_in' && order.prescription && <span className="muted lab-order-sub">{order.prescription}</span>}
              </dd>
            </div>
            {order.packages?.length > 0 && (
              <div>
                <dt>Package</dt>
                <dd>{packageNames(order.packages)}</dd>
              </div>
            )}
            {order.noteToLab && (
              <div className="lab-order-wide">
                <dt>Note to the lab</dt>
                <dd>{order.noteToLab}</dd>
              </div>
            )}
            {order.reviewed?.comment && (
              <div className="lab-order-wide">
                <dt>Doctor's comment</dt>
                <dd>{order.reviewed.comment}</dd>
              </div>
            )}
            {order.qcOverride && (
              <div className="lab-order-wide">
                <dt>Reported while quality control was rejected</dt>
                <dd>
                  {order.qcOverride.reason} <span className="muted">({order.qcOverride.byName})</span>
                </dd>
              </div>
            )}
            {order.cancelled && (
              <div className="lab-order-wide">
                <dt>Cancelled</dt>
                <dd>
                  {order.cancelled.byName}, {formatDateTime(order.cancelled.at)} – {order.cancelled.reason}
                </dd>
              </div>
            )}
          </dl>

          {(order.rejections?.length > 0 || order.sentBack?.length > 0) && (
            <ul className="plain-list lab-history">
              {order.rejections.map((r, i) => (
                <li key={`r-${i}`}>
                  <Ban aria-hidden="true" /> Sample rejected – {r.reasonText}
                  {r.note ? ` (${r.note})` : ''} · {r.byName}, {formatDateTime(r.at)}
                </li>
              ))}
              {order.sentBack.map((r, i) => (
                <li key={`b-${i}`}>
                  Results sent back – {r.reason} · {r.byName}, {formatDateTime(r.at)}
                </li>
              ))}
            </ul>
          )}

          {(a.canCollect || a.canCancel || a.canLabel || a.canReject || a.canPrint || a.canReceive) && (
            <div className="lab-order-actions">
              {a.canCollect && (
                <button type="button" className={`btn ${a.canReview ? 'btn-secondary' : 'btn-primary'}`} disabled={busy} onClick={collect}>
                  <TestTube aria-hidden="true" /> {busy ? 'Saving…' : 'Mark sample taken'}
                </button>
              )}
              {a.canReceive && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      saved((await api(`/lab/orders/${order.id}/receive`, { method: 'POST', body: { rev: order.rev } })).order, 'Sample received in the lab.');
                    } catch (err) {
                      failed(err);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Inbox aria-hidden="true" /> Receive the sample
                </button>
              )}
              {a.canLabel && (
                <button type="button" className="btn btn-secondary" onClick={() => setPrinting('labels')}>
                  <Tag aria-hidden="true" /> Print labels
                </button>
              )}
              {a.canPrint && (
                <button type="button" className="btn btn-secondary" onClick={() => setPrinting('report')}>
                  <Printer aria-hidden="true" /> Print the report
                </button>
              )}
              {(a.canReject || a.canCancel) && <span className="lab-order-actions-gap" aria-hidden="true" />}
              {a.canReject && (
                <button type="button" className="btn btn-link" onClick={() => setRejecting(true)}>
                  <Ban aria-hidden="true" /> Reject the sample
                </button>
              )}
              {a.canCancel && (
                <button type="button" className="btn btn-link lab-order-cancel" onClick={() => setCancelling(true)}>
                  Cancel the order
                </button>
              )}
            </div>
          )}
        </section>

        {order.status !== 'cancelled' && (
          <section className="card" aria-labelledby="lab-results-title">
            <div className="plan-card-head">
              <h2 id="lab-results-title">Results</h2>
              {order.abnormal && done && (
                <StatusPill tone="high" icon={FLAG_LOOK.abnormal.icon}>
                  Outside the usual range
                </StatusPill>
              )}
            </div>
            {a.canReport && (open || changing) ? (
              <ResultsForm
                order={order}
                catalogue={catalogue}
                pcpndt={pcpndt}
                amending={done}
                primary={primaryReport}
                verify={Boolean(data?.verify)}
                qcRejected={data?.qcRejected ?? []}
                onSaved={saved}
                onCancel={changing ? () => setChanging(false) : null}
              />
            ) : done ? (
              <>
                <ResultsView order={order} catalogue={catalogue} />
                {a.canReport && (
                  <div className="row">
                    <button type="button" className="btn btn-secondary" onClick={() => setChanging(true)}>
                      Change the results
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="muted">Waiting for the lab.</p>
            )}
            {order.lastSaved && open && <p className="hint">Last saved by {order.lastSaved.byName}, {formatDateTime(order.lastSaved.at)} – not reported yet.</p>}
          </section>
        )}

        <PreviousResults order={order} catalogue={catalogue} previous={data?.previous} />

        {order.status !== 'cancelled' && <HomeCard order={order} onSaved={saved} onError={failed} />}

        {a.canVerify && <VerifyCard order={order} onSaved={saved} onError={failed} />}

        {a.canReview && <Review order={order} onSaved={saved} />}

        {order.status !== 'cancelled' && <OutsideSection order={order} catalogue={catalogue} onSaved={saved} onError={failed} />}

        {order.status !== 'cancelled' && <Files order={order} pcpndt={pcpndt} onSaved={saved} />}

        {order.amendments.length > 0 && (
          <section className="card" aria-labelledby="lab-changes-title">
            <h2 id="lab-changes-title">Changes after the report ({order.amendments.length})</h2>
            <ul className="plain-list">
              {order.amendments
                .slice()
                .reverse()
                .map((m, i) => (
                  <li key={`${m.at}-${i}`}>
                    <strong>{m.byName}</strong>, {formatDateTime(m.at)} – {m.reason}
                    {m.tests && (
                      <details>
                        <summary>Results before this change{m.reviewedByName ? ` (reviewed by ${m.reviewedByName})` : ''}</summary>
                        <ul>
                          {m.tests.map((t, j) => (
                            <li key={`${t.key}-${j}`}>
                              {t.name}: {resultLine(t, catalogue) || '—'}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
      {rejecting && (
        <RejectDialog
          order={order}
          onCancel={() => setRejecting(false)}
          onDone={(next, message) => {
            setRejecting(false);
            saved(next, message);
          }}
        />
      )}
      {printing === 'labels' && <LabLabels order={order} catalogue={catalogue} onPrinted={(next) => setCurrent({ ...next, patient: order.patient })} onClose={() => setPrinting(null)} />}
      {printing === 'report' && <LabReportPrint order={order} catalogue={catalogue} signer={data?.signer ?? null} onClose={() => setPrinting(null)} />}
      {cancelling && (
        <CancelDialog
          order={order}
          onCancel={() => setCancelling(false)}
          onDone={(next) => {
            setCancelling(false);
            saved(next, 'Order cancelled.');
          }}
        />
      )}
    </>
  );
}
