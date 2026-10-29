import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, CalendarClock, CircleCheck, CircleMinus, Clock, FilePen, FileSearch, FileText, ImagePlus, MonitorDown, Printer, ScanLine, Siren } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { usePagedRows } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, KpiCard, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { CALC_SOURCES, draftReport, gaWords, ordinal, workOut } from './usgCalc.js';
import { ExportButton } from '../../components/ExportButton.jsx';
import { fileBody, fileSize } from '../../components/fileUpload.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { SCAN_ROLES } from '../../platform/modules.js';
import { ApiImage } from '../../components/ApiImage.jsx';
import { MachinePanel, machineImageUrl } from './MachinePanel.jsx';
import { USE_WORDS } from './machineTable.js';

// USG and radiology (Lab version 2 part 8 – docs/LAB_V2_PLAN.md): the worklist (to schedule, scheduled, to report,
// signed), one study (schedule, done, the report from a DRAFT template, sign, print), and a patient's scans with the
// order dialog. Doctors and RMOs only (owner, 19 Oct 2026). Pregnancy scans work out the weeks, EDD, weight and
// centile from the readings and write a draft report (usgCalc.js, DRAFT); "Complete" signs and prints. PCPNDT: no
// field holds a fetus's sex; any text about it is refused here and on the server.

export const STATUS = {
  ordered: { tone: 'due', icon: Clock, word: 'To schedule' },
  scheduled: { tone: 'due', icon: CalendarClock, word: 'Scheduled' },
  done: { tone: 'watch', icon: FilePen, word: 'Done – to report' },
  signed: { tone: 'stable', icon: CircleCheck, word: 'Signed' },
  cancelled: { tone: 'inactive', icon: CircleMinus, word: 'Cancelled' },
};
export function StudyStatus({ s }) {
  const l = STATUS[s.status];
  return (
    <StatusPill tone={l.tone} icon={l.icon}>
      {l.word}
    </StatusPill>
  );
}
const LISTS = [
  ['ordered', 'To schedule'],
  ['scheduled', 'Scheduled'],
  ['report', 'To report'],
  ['signed', 'Signed (last 7 days)'],
];
const localInput = (d) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 16);
};

// The day at a glance (24 Oct 2026, docs/IDEAS_FOR_LATER.md 21): counts only; each opens its list
// links: false for the hospital admin, who sees the counts only (owner, 24 Oct 2026)
function ScanDashboard({ links = true }) {
  const { data } = useFetch('/imaging/dashboard');
  const c = data?.counts;
  if (!c) return null;
  const to = (path) => (links ? path : undefined);
  return (
    <div className="kpi-grid img-tiles" aria-label="Scans today">
      <KpiCard to={to('/scans?list=scheduled')} tone="due" icon={CalendarClock} label="Booked today" value={c.bookedToday} />
      <KpiCard to={to('/scans')} tone="due" icon={Clock} label="To scan" value={c.toScan} sub="Ordered or scheduled" />
      <KpiCard to={to('/scans?list=report')} tone="watch" icon={FilePen} label="To report" value={c.toReport} />
      <KpiCard to={to('/scans?list=report')} tone="watch" icon={FileText} label="To sign" value={c.toSign} sub="Report written" />
      <KpiCard to={to('/scans?list=signed')} tone="stable" icon={CircleCheck} label="Signed today" value={c.signedToday} />
    </div>
  );
}

// The hospital admin with no scan role: the day's numbers, no patient (owner, 24 Oct 2026)
function ScanCountsOnly() {
  return (
    <>
      <PageHeader title="Sonography" help="Today's scans in numbers. The scan list and reports are for doctors, RMOs and sonography staff." />
      <div className="pf-content">
        <ScanDashboard links={false} />
      </div>
    </>
  );
}

export function ImagingWorklistPage() {
  const { activeMembership } = useAuth();
  if (!activeMembership?.roles?.some((r) => SCAN_ROLES.includes(r))) return <ScanCountsOnly />;
  return <ScanWorklist />;
}

function ScanWorklist() {
  const [params, setParams] = useSearchParams();
  const list = LISTS.some(([k]) => k === params.get('list')) ? params.get('list') : 'ordered';
  const { data, error, loading } = useFetch('/imaging/worklist', { list });
  const { shown, pager } = usePagedRows(data?.studies, { initial: 25, sizes: [25, 50, 100], label: 'scans', resetKey: list });
  return (
    <>
      <PageHeader title="Sonography" actions={<ExportButton what="scans" />} help="USG and radiology: studies to schedule, scheduled, to report and signed. Doctors order scans from the patient's Lab tab." />
      <div className="pf-content">
        <ScanDashboard />
        <div className="segmented img-lists" aria-label="Scan lists">
          {LISTS.map(([k, w]) => (
            <button key={k} type="button" aria-pressed={k === list} onClick={() => setParams(k === 'ordered' ? {} : { list: k }, { replace: true })}>
              {w}
              {data?.counts?.[k] != null && <span className="tabular"> ({data.counts[k]})</span>}
            </button>
          ))}
        </div>
        <Alert type="error">{error}</Alert>
        <MachineUnmatched />
        <section className="card">
          {loading && !data ? (
            <p className="muted">Loading…</p>
          ) : !data?.studies.length ? (
            <p className="muted">Nothing here.</p>
          ) : (
            <ul className="wl-list">
              {(shown ?? []).map((s) => (
                <li key={s.id}>
                  <div className="wl-row-head">
                    <span className="wl-who">
                      <Link to={`/scans/${s.id}`} className="strong-name">
                        {s.patient.fullName}
                      </Link>
                      <span className="muted tabular">{[s.patient.mrn, s.patient.age != null ? `${s.patient.age} yrs` : null, s.studyName].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="wl-counts">
                      {s.urgent && (
                        <StatusPill tone="high" icon={Siren}>
                          Urgent
                        </StatusPill>
                      )}
                      <StudyStatus s={s} />
                    </span>
                  </div>
                  <span className="hint">
                    Ordered by {s.ordered.byName}, {formatDateTime(s.ordered.at)}
                    {s.scheduledFor ? ` · for ${formatDateTime(s.scheduledFor)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pager}
        </section>
      </div>
    </>
  );
}

// Studies from the ultrasound machine no one is matched to (docs/USG_MACHINE_PLAN.md): staff check the picture and the
// name typed on the machine, and link each to her patient number. Shown only when there are some.
function MachineUnmatched() {
  const { data, reload } = useFetch('/imaging/machine/unmatched');
  const [numbers, setNumbers] = useState({});
  const [problems, setProblems] = useState({});
  const [notice, setNotice] = useState(null);
  if (!data?.studies?.length) return notice ? <Alert type="success" onClose={() => setNotice(null)}>{notice}</Alert> : null;
  const link = async (m) => {
    try {
      const res = await api(`/imaging/machine/${m.id}/link`, { method: 'POST', body: { mrn: numbers[m.id] ?? '' } });
      setProblems({ ...problems, [m.id]: null });
      setNotice(`Linked to ${res.patient.fullName} (${res.patient.mrn}). Open her scan to use it.`);
      reload();
    } catch (err) {
      setProblems({ ...problems, [m.id]: err.fields?.mrn ?? err.message });
    }
  };
  return (
    <section className="card" aria-labelledby="img-unlinked-title">
      <h2 id="img-unlinked-title">
        <MonitorDown aria-hidden="true" /> From the machine – not linked
      </h2>
      <p className="hint">The machine sent these without a scan number or a patient number Perinexa knows. Check the picture and the name, then link each to her patient number.</p>
      <Alert type="success" onClose={() => setNotice(null)}>
        {notice}
      </Alert>
      <ul className="wl-list">
        {data.studies.map((m) => (
          <li key={m.id} className="img-unlinked">
            {m.images[0] && <ApiImage path={machineImageUrl(m.id, m.images[0].id)} alt="First picture of the study" link />}
            <span className="wl-who">
              <span className="strong-name">{m.nameOnMachine || 'No name on the machine'}</span>
              <span className="muted tabular">{[m.numberOnMachine, formatDateTime(m.studyAt ?? m.receivedAt), m.machine, `${m.images.length} picture${m.images.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
            </span>
            <Field label="Her patient number" id={`unl-${m.id}`} error={problems[m.id]}>
              <span className="row">
                <input id={`unl-${m.id}`} maxLength={40} placeholder="P-000123" value={numbers[m.id] ?? ''} onChange={(e) => setNumbers({ ...numbers, [m.id]: e.target.value })} />
                <button type="button" className="btn btn-secondary btn-sm" disabled={!(numbers[m.id] ?? '').trim()} onClick={() => link(m)}>
                  Link
                </button>
              </span>
            </Field>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReportForm({ s, template, onSaved, onError, onAsk = null }) {
  const [values, setValues] = useState(() => Object.fromEntries((template?.fields ?? []).map((f) => [f.key, s.report?.values?.[f.key] != null ? String(s.report.values[f.key]) : ''])));
  const [findings, setFindings] = useState(s.report?.findings ?? '');
  const [impression, setImpression] = useState(s.report?.impression ?? '');
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  // Worked out from the readings (usgCalc.js, DRAFT): put in the fields it fills – never over what was typed by hand
  const typedByHand = useRef(new Set(Object.keys(s.report?.values ?? {}).filter((k) => s.report.values[k] !== '' && s.report.values[k] != null)));
  const scanDay = s.done?.at ?? s.scheduledFor ?? new Date();
  const calc = useMemo(() => workOut(s.study, values, { on: scanDay, eddByDates: s.patient?.eddByDates ?? null }), [s.study, values, scanDay, s.patient?.eddByDates]);
  useEffect(() => {
    const next = Object.entries(calc.fill).filter(([k, v]) => !typedByHand.current.has(k) && values[k] !== v);
    if (next.length) setValues((cur) => ({ ...cur, ...Object.fromEntries(next) }));
  }, [calc]); // eslint-disable-line react-hooks/exhaustive-deps
  const setValue = (key, value) => {
    if (key in calc.fill) typedByHand.current.add(key);
    setValues({ ...values, [key]: value });
  };
  const writeReport = () => {
    const d = draftReport(s.study, values, calc, template?.fields ?? []);
    setFindings(d.findings);
    if (d.impression) setImpression(d.impression);
  };
  const save = async (e) => {
    e?.preventDefault();
    if ([findings, impression, ...Object.values(values)].some((t) => mentionsFetalSex(t))) return setFields({ findings: PCPNDT_MESSAGE });
    setBusy(true);
    try {
      const res = await api(`/imaging/${s.id}/report`, { method: 'PUT', body: { rev: s.rev, values, findings, impression, reason } });
      setFields({});
      onSaved(res.study, 'Report saved.');
      if (res.study.status === 'done') onAsk?.(); // "Is the report complete?" (on the page: the form starts again after a save)
    } catch (err) {
      setFields(err.fields ?? {});
      onError(err);
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  const worked = [calc.ga && `${gaWords(calc.ga)} by ${calc.gaFrom}`, calc.edd && `EDD by scan ${calc.edd}`, calc.efw && `weight ${calc.efw} g`, calc.efwCentile && `${ordinal(calc.efwCentile)} centile by dates`].filter(Boolean);
  return (
    <form className="img-report-form" onSubmit={save} noValidate aria-labelledby="img-report-title">
      <section className="card" aria-labelledby="img-readings-title">
      <h2 id="img-readings-title">Readings</h2>
      <p className="hint">DRAFT template – for the doctor to check and approve. No field records the sex of a fetus (PCPNDT Act).</p>
      <div className="form-grid">
        {(template?.fields ?? []).map((f) => (
          <Field key={f.key} label={`${f.name}${f.unit ? ` (${f.unit})` : ''}`} id={`img-${f.key}`} error={fields[`values.${f.key}`]}>
            {f.type === 'choice' ? (
              <select id={`img-${f.key}`} value={values[f.key]} onChange={(e) => setValue(f.key, e.target.value)}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`img-${f.key}`}
                className={f.key in calc.fill && !typedByHand.current.has(f.key) ? 'voice-filled' : undefined}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                maxLength={300}
                value={values[f.key]}
                onChange={(e) => setValue(f.key, e.target.value)}
              />
            )}
          </Field>
        ))}
      </div>
      {worked.length > 0 && (
        <p className="hint img-worked" role="status">
          <Calculator aria-hidden="true" /> Worked out from the readings: {worked.join(' · ')}. {CALC_SOURCES}.
        </p>
      )}
      </section>
      <section className="card" aria-labelledby="img-report-title">
      <h2 id="img-report-title">Report</h2>
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={writeReport}>
          <FileText aria-hidden="true" /> Write the report from the readings
        </button>
        <span className="hint">Fills the findings and impression for you to check and change.</span>
      </div>
      <Field label="Findings" id="img-findings" error={fields.findings}>
        <textarea id="img-findings" rows={6} maxLength={4000} value={findings} onChange={(e) => setFindings(e.target.value)} />
      </Field>
      <Field label="Impression" id="img-impression" error={fields.impression}>
        <textarea id="img-impression" rows={2} maxLength={1000} value={impression} onChange={(e) => setImpression(e.target.value)} />
      </Field>
      {s.status === 'signed' && (
        <Field label="Why is the signed report changed?" id="img-reason" error={fields.reason}>
          <input id="img-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <div className="row">
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? 'Saving…' : 'Save the report'}
        </button>
      </div>
      </section>
    </form>
  );
}

const imageUrl = (s, i) => `/imaging/${s.id}/images/${i.fileId}`;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Pictures from the machine (24 Oct 2026, docs/IDEAS_FOR_LATER.md 19): JPEG, PNG or WebP exported from the machine,
// added once the study is done and before it is signed; ticked ones print with the report. Taking one off needs a
// reason and keeps it in the record. PCPNDT: never a picture that shows the baby's sex – it cannot be checked by Perinexa.
function ScanImages({ s, onSaved, onError }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [removing, setRemoving] = useState(null); // { fileId, reason }
  const images = s.images ?? [];
  const can = s.access.canImages;
  const change = async (i, body) => {
    try {
      onSaved((await api(`/imaging/${s.id}/images/${i.fileId}`, { method: 'PATCH', body: { rev: s.rev, ...body } })).study, body.remove ? 'Picture taken off the report.' : 'Saved.');
    } catch (err) {
      onError(err);
    }
  };
  const add = async (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setProblem(null);
    let study = s;
    setBusy(true);
    try {
      for (const file of files) {
        if (!IMAGE_TYPES.includes(file.type)) throw new Error(`${file.name}: choose a picture (JPEG, PNG or WebP). DICOM files are not read yet.`);
        if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: the picture is too large (at most 5 MB).`);
        study = (await api(`/imaging/${s.id}/images`, { method: 'POST', body: { rev: study.rev, ...(await fileBody(file)) } })).study;
      }
      if (files.length) onSaved(study, files.length === 1 ? 'Picture added.' : `${files.length} pictures added.`);
    } catch (err) {
      if (study !== s) onSaved(study, null);
      if (err.status) onError(err);
      else setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (!can && !images.length) return null;
  return (
    <section className="card" aria-labelledby="img-pictures">
      <div className="plan-card-head">
        <h2 id="img-pictures">Pictures</h2>
        {can && (
          <>
            <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} multiple className="sr-only" onChange={add} tabIndex={-1} aria-label="Add pictures" />
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
              <ImagePlus aria-hidden="true" /> {busy ? 'Adding…' : 'Add pictures'}
            </button>
          </>
        )}
      </div>
      {can && <p className="hint">Pictures exported from the machine (JPEG, PNG or WebP, up to 5 MB each, at most 12). Never a picture that shows the baby&apos;s sex.</p>}
      <Alert type="warning">{problem}</Alert>
      {images.length === 0 ? (
        <p className="muted">No pictures yet.</p>
      ) : (
        <ul className="img-pictures">
          {images.map((i) => (
            <li key={i.fileId}>
              <ApiImage path={imageUrl(s, i)} alt={i.fileName} link />
              <span className="hint">
                {i.fileName} · {fileSize(i.size)} · {i.byName}
              </span>
              {can ? (
                <span className="row">
                  <label className="check">
                    <input type="checkbox" checked={i.inPrint} onChange={(e) => change(i, { inPrint: e.target.checked })} /> In the printed report
                  </label>
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setRemoving({ fileId: i.fileId, reason: '' })}>
                    Take off
                  </button>
                </span>
              ) : (
                <span className="hint">{i.inPrint ? 'In the printed report' : 'Not printed'}</span>
              )}
              {can && removing?.fileId === i.fileId && (
                <span className="row">
                  <input aria-label="Why is it taken off?" placeholder="Why is it taken off?" maxLength={300} value={removing.reason} onChange={(e) => setRemoving({ ...removing, reason: e.target.value })} />
                  <button type="button" className="btn btn-secondary btn-sm" disabled={removing.reason.trim().length < 3} onClick={() => change(i, { remove: removing.reason.trim() }).then(() => setRemoving(null))}>
                    Take it off
                  </button>
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setRemoving(null)}>
                    Keep it
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The readings from the machine behind the report's values: each reading (struck through when unticked), the rule
// and the value used; a value changed by hand afterwards says so
export function MachineReadingsTable({ machine, className = 'ptable pdoc-table' }) {
  if (!machine?.rows?.length) return null;
  return (
    <>
      <h2 className="pdoc-sig-title">Measurements from the ultrasound machine{machine.fetus && machine.fetus !== 'A' ? ` – fetus ${machine.fetus}` : ''}</h2>
      <table className={className}>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col">Readings</th>
            <th scope="col">Used</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {machine.rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {r.name} ({r.unit})
              </th>
              <td className="tabular">
                {r.readings.length
                  ? r.readings.map((v, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        {r.ticked?.[i] === false ? <s title="Not used">{v}</s> : v}
                      </span>
                    ))
                  : `Machine: ${r.machine}`}
              </td>
              <td>{r.use === 'reading' ? `Reading ${r.reading + 1}` : USE_WORDS[r.use]}</td>
              <td className="tabular">
                {r.value}
                {r.edited ? ' (changed by hand)' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** What the report says: the patient, the values, the machine's readings, findings, impression, the chosen pictures. */
function ReportBody({ s, template }) {
  return (
    <>
      <h1 className="pdoc-title">{s.studyName}</h1>
      <PrintFacts
        items={[
          ['Patient', s.patient.fullName],
          ['Patient number', s.patient.mrn],
          ['Age', s.patient.age != null ? `${s.patient.age} years` : ''],
          ['Referred by', s.ordered.byName],
          ['Done', s.done ? formatDateTime(s.done.at) : ''],
          ['Indication', s.indication ?? '', true],
        ]}
      />
      <PrintFacts items={(template?.fields ?? []).filter((f) => s.report?.values?.[f.key] != null && s.report.values[f.key] !== '').map((f) => [f.name, `${s.report.values[f.key]}${f.unit ? ` ${f.unit}` : ''}`])} />
      <MachineReadingsTable machine={s.report?.machine} />
      {s.report?.findings && (
        <>
          <h2 className="pdoc-sig-title">Findings</h2>
          <p className="pre-line">{s.report.findings}</p>
        </>
      )}
      {s.report?.impression && (
        <>
          <h2 className="pdoc-sig-title">Impression</h2>
          <p className="pre-line">{s.report.impression}</p>
        </>
      )}
      {s.images?.some((i) => i.inPrint) && (
        <div className="img-print-pictures">
          {s.images
            .filter((i) => i.inPrint)
            .map((i) => (
              <ApiImage key={i.fileId} path={imageUrl(s, i)} alt={i.fileName} />
            ))}
        </div>
      )}
      <p className="pdoc-small">The sex of the fetus is not determined or disclosed (PCPNDT Act, 1994).</p>
    </>
  );
}

function ReportPrint({ s, template, onClose, autoPrint = false }) {
  const lh = useFetch('/tenant/settings/letterhead');
  const record = () => api(`/imaging/${s.id}/printed`, { method: 'POST' });
  return (
    <PrintPreview title="Scan report – print preview" hint="Check it, then print on A4 paper." onPrint={record} onClose={onClose} autoPrint={autoPrint}>
      {!lh.data && !lh.error ? (
        <p className="muted">Preparing…</p>
      ) : (
        <PrintDocument draft="DRAFT report template – not yet approved by the hospital's doctor.">
          {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
          <ReportBody s={s} template={template} />
          <div className="pdoc-sigs">
            <div className="pdoc-sig">
              <h2 className="pdoc-sig-title">Signed by</h2>
              <p>
                {s.signed?.byName}, {s.signed ? formatDateTime(s.signed.at) : ''}
              </p>
            </div>
          </div>
        </PrintDocument>
      )}
    </PrintPreview>
  );
}

export function ImagingStudyPage() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/imaging/${id}`);
  const [current, setCurrent] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [when, setWhen] = useState(() => localInput(new Date()));
  const [printing, setPrinting] = useState(false); // false | 'preview' | 'auto' (completed: prints by itself)
  const [asking, setAsking] = useState(false); // the report saved: "Is the report complete?"
  const [reviewing, setReviewing] = useState(false); // the final report as it will print, before finalising
  const s = current ?? data?.study;
  const saved = (next, msg) => {
    setCurrent(next);
    setNotice(msg);
    setActionError(null);
  };
  const failed = (err) => {
    setActionError(err.message);
    if (err.status === 409) {
      setCurrent(null);
      reload();
    }
  };
  const act = async (path, body, msg) => {
    try {
      saved((await api(`/imaging/${s.id}/${path}`, { method: 'POST', body: { rev: s.rev, ...body } })).study, msg);
    } catch (err) {
      failed(err);
    }
  };
  const complete = async () => {
    try {
      saved((await api(`/imaging/${s.id}/sign`, { method: 'POST', body: { rev: s.rev } })).study, 'Signed. The report is printing.');
      setAsking(false);
      setReviewing(false);
      setPrinting('auto');
    } catch (err) {
      failed(err);
    }
  };
  const header = <PageHeader breadcrumbs={[{ label: 'Scans', to: '/scans' }, { label: s?.patient?.fullName ?? 'Scan' }]} title={s?.studyName ?? 'Scan'} documentTitle="Scan" />;
  if (!s) return (<>{header}<div className="pf-content">{error ? <Alert type="error">{error}</Alert> : <p className="muted">Loading…</p>}</div></>);
  const a = s.access;
  return (
    <>
      {header}
      <div className="pf-content">
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <Alert type="error">{actionError}</Alert>
        <section className="card">
          <div className="plan-card-head">
            <h2>
              <ScanLine aria-hidden="true" /> {s.patient.fullName} <span className="muted tabular">{s.patient.mrn}</span>
            </h2>
            <StudyStatus s={s} />
          </div>
          <p className="muted">
            Ordered by {s.ordered.byName}, {formatDateTime(s.ordered.at)}
            {s.scheduledFor ? ` · for ${formatDateTime(s.scheduledFor)}` : ''}
            {s.done ? ` · done ${formatDateTime(s.done.at)}` : ''}
            {s.signed ? ` · signed by ${s.signed.byName}` : ''}
            {s.accession ? ` · scan number on the machine ${s.accession}` : ''}
          </p>
          {s.indication && <p>Indication: {s.indication}</p>}
          <div className="row">
            {a.canSchedule && (
              <>
                <input type="datetime-local" aria-label="Day and time" value={when} onChange={(e) => setWhen(e.target.value)} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => act('schedule', { scheduledFor: new Date(when).toISOString() }, 'Scheduled.')}>
                  Schedule
                </button>
              </>
            )}
            {a.canDone && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => act('done', {}, 'Marked done. A doctor writes the report.')}>
                Mark done
              </button>
            )}
            {!reviewing && s.status === 'done' && s.report && (a.canSign || a.canReport) && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setReviewing(true)}>
                <FileSearch aria-hidden="true" /> Review the final report
              </button>
            )}
            {a.canPrint && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPrinting(true)}>
                <Printer aria-hidden="true" /> Print the report
              </button>
            )}
          </div>
        </section>
        <div className="img-study">
        <div className="img-study-main">
        {reviewing && s.status === 'done' && s.report && (
          // The final report as it will print (docs/USG_MACHINE_PLAN.md step 4): finalising signs it and prints it
          <section className="card img-review" aria-labelledby="img-review-title">
            <h2 id="img-review-title">Review the final report</h2>
            <p className="hint">This is the report as it will print. Finalising signs it; after that, a change needs a reason.</p>
            <div className="img-review-sheet">
              <ReportBody s={s} template={data?.template} />
            </div>
            <div className="row">
              {a.canSign ? (
                <button type="button" className="btn btn-primary" onClick={complete}>
                  <CircleCheck aria-hidden="true" /> Finalise – sign and print
                </button>
              ) : (
                <span className="hint">A doctor finalises and signs it.</span>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setReviewing(false)}>
                Make changes
              </button>
            </div>
          </section>
        )}
        {s.images && !reviewing && <MachinePanel s={s} onSaved={saved} onError={failed} />}
        {a.canReport && !reviewing && <ReportForm key={`${s.rev}`} s={s} template={data?.template} onSaved={saved} onError={failed} onAsk={() => setAsking(true)} />}
        {asking && !reviewing && s.status === 'done' && (
          // Asked once the report is saved (owner, 19 Oct 2026): complete – the doctor signs and it prints by itself
          <section className="card img-complete" aria-labelledby="img-complete-title">
            <h2 id="img-complete-title">Is the report complete?</h2>
            <p>{a.canSign ? 'Review the final report, then finalise: it is signed and prints. Add something keeps it open for more.' : 'A doctor signs it; until then it stays open for more.'}</p>
            <div className="row">
              {a.canSign && (
                <button type="button" className="btn btn-primary" onClick={() => setReviewing(true)}>
                  <FileSearch aria-hidden="true" /> Review the final report
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>
                Add something
              </button>
            </div>
          </section>
        )}
        {!a.canReport && s.report && (
          <section className="card">
            <h2>Report</h2>
            {s.report.findings && <p className="pre-line">{s.report.findings}</p>}
            {s.report.impression && <p>{s.report.impression}</p>}
          </section>
        )}
        </div>
        <aside className="img-study-side">
          <ScanImages s={s} onSaved={saved} onError={failed} />
        </aside>
        </div>
      </div>
      {printing && <ReportPrint s={s} template={data?.template} autoPrint={printing === 'auto'} onClose={() => setPrinting(false)} />}
    </>
  );
}

function OrderScanDialog({ patient, onDone, onClose }) {
  const studies = useFetch('/imaging/studies');
  const ref = useDialogFocus(onClose);
  const [form, setForm] = useState({ study: 'usg_early', urgent: false, indication: '' });
  const [error, setError] = useState(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const send = async (e) => {
    e.preventDefault();
    if (mentionsFetalSex(form.indication)) return setError(PCPNDT_MESSAGE);
    try {
      await api(`/patients/${patient.id}/imaging`, { method: 'POST', body: { clientRequestId: requestId, ...form } });
      onDone();
    } catch (err) {
      setError(err.message);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="scan-order-title" onSubmit={send} noValidate>
        <h2 id="scan-order-title">Order a scan</h2>
        <Alert type="error">{error}</Alert>
        <Field label="Study" id="so-study">
          <select id="so-study" value={form.study} onChange={(e) => setForm({ ...form, study: e.target.value })}>
            {(studies.data?.studies ?? []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Indication (why)" id="so-ind">
          <input id="so-ind" maxLength={300} value={form.indication} onChange={(e) => setForm({ ...form, indication: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.urgent} onChange={(e) => setForm({ ...form, urgent: e.target.checked })} /> Urgent
        </label>
        <div className="row">
          <button type="submit" className="btn btn-primary">
            Order the scan
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** On the patient's Lab tab: her scans (USG and radiology), and "Order a scan" for her doctor or an RMO. */
export function PatientScans({ patient }) {
  const res = useFetch(`/patients/${patient.id}/imaging`);
  const [ordering, setOrdering] = useState(false);
  if (res.error || !res.data) return null;
  return (
    <section className="card" aria-labelledby="pt-scans">
      <div className="plan-card-head">
        <h2 id="pt-scans">
          <ScanLine aria-hidden="true" /> Scans (USG and X-ray)
        </h2>
        {res.data.canOrder && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOrdering(true)}>
            Order a scan
          </button>
        )}
      </div>
      {res.data.studies.length === 0 ? (
        <p className="muted">No scans ordered here yet.</p>
      ) : (
        <ul className="wl-list">
          {res.data.studies.map((s) => (
            <li key={s.id}>
              <div className="wl-row-head">
                <span className="wl-who">
                  <Link to={`/scans/${s.id}`} className="strong-name">
                    {s.studyName}
                  </Link>
                  <span className="muted">
                    {formatDateTime(s.ordered.at)} · {s.ordered.byName}
                    {s.report?.impression ? ` · ${s.report.impression}` : ''}
                  </span>
                </span>
                <StudyStatus s={s} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {ordering && (
        <OrderScanDialog
          patient={patient}
          onClose={() => setOrdering(false)}
          onDone={() => {
            setOrdering(false);
            res.reload();
          }}
        />
      )}
    </section>
  );
}
