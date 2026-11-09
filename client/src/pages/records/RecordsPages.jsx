import { useRef, useState } from 'react';
import { BookCopy, FileClock, FolderArchive, Plus, TriangleAlert } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, DateFilter, FilterSelect, SearchInput, TablePagination, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KIND_LABELS } from '../inpatient/inpatientFormat.js';
import { CARE_TYPE_LABELS, CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { COPY_WHATS, COPY_WHAT_LABELS, GIVEN_TO, GIVEN_TO_LABELS, GIVEN_TO_WORDS, INCOMPLETE_KIND_LABELS, RECEIVER_NAME_NEEDED, RECORDS_TABS, copyTimingWords } from './recordLists.js';

// The Records menu (the medical records module): for the medical records staff, doctors and RMOs.
//  - Index: every record with its last stay and how many documents are attached.
//  - Incomplete records: visits not signed the day after; inpatient documents still drafts once the stay is over or
//    after a week.
//  - Copies register: every copy of a record that left the hospital – for whom, on what authority, when asked and
//    when given (the 72-hour rule), and who gave it.
// Identity details only on these pages; a record opens as the person's role allows.

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const options = (keys, labels) =>
  keys.map((k) => (
    <option key={k} value={k}>
      {labels[k]}
    </option>
  ));
const PatientCell = ({ p }) =>
  p ? (
    <div>
      <Link to={`/patients/${p.id}`} className="strong-name">
        {p.fullName}
      </Link>
      <div className="t-caption muted tabular">
        {p.mrn}
        {p.age != null ? ` · ${p.age} yrs` : ''}
        {p.careType ? ` · ${CARE_TYPE_SHORT[p.careType] ?? p.careType}` : ''}
        {p.closed ? ' · record closed' : ''}
      </div>
    </div>
  ) : (
    <span className="muted">Record not found</span>
  );

// ---------- Index ----------

export function RecordsIndexPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const careType = params.get('careType') ?? '';
  const page = Number(params.get('page') ?? 1);
  const limit = Number(params.get('limit') ?? 25);
  const { data, error, loading } = useFetch('/records/index', { search, careType, page, limit });
  const update = (changes) => {
    const next = { search, careType, page: 1, limit, ...changes };
    setParams(Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== '' && !(k === 'page' && v === 1) && !(k === 'limit' && v === 25)).map(([k, v]) => [k, String(v)])), { replace: true });
  };
  const columns = [
    { key: 'patient', header: 'Record', className: 'wrap', render: (r) => <PatientCell p={r} /> },
    { key: 'careType', header: 'Type of care', render: (r) => CARE_TYPE_LABELS[r.careType] ?? r.careType },
    { key: 'doctor', header: 'Doctor', render: (r) => r.assignedDoctorName ?? <span className="muted">–</span> },
    { key: 'registered', header: 'Registered', render: (r) => <span className="tabular">{formatDate(r.registeredOn)}</span> },
    {
      key: 'stay',
      header: 'Last stay',
      className: 'wrap',
      render: (r) =>
        r.lastStay ? (
          <span className="tabular">
            {formatDate(r.lastStay.admittedAt)}
            {r.lastStay.status === 'discharged' ? ` to ${formatDate(r.lastStay.dischargedAt)}` : ' – in hospital'}
            {r.lastStay.count > 1 ? <span className="muted"> · {r.lastStay.count} stays</span> : null}
          </span>
        ) : (
          <span className="muted">None</span>
        ),
    },
    { key: 'documents', header: 'Documents', align: 'right', render: (r) => (r.documents ? <Link to={`/patients/${r.id}/documents`}>{formatNumber(r.documents)}</Link> : <span className="muted">0</span>) },
  ];
  return (
    <>
      <PageHeader title="Records" help="Every record of this hospital with its last stay and the documents attached to it. Open a record to see what your role allows; the Documents tab holds its scanned papers." tabs={RECORDS_TABS} />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <DataTable
          caption="Records index"
          columns={columns}
          rows={data?.rows}
          loading={loading}
          emptyText={search || careType ? 'No record matches.' : 'No record yet.'}
          toolbar={
            <>
              <SearchInput value={search} onChange={(v) => update({ search: v })} placeholder="Name, patient number or phone" label="Find a record" />
              <FilterSelect label="Type of care" value={careType} onChange={(v) => update({ careType: v })} options={Object.entries(CARE_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
            </>
          }
          footer={data && <TablePagination page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} onPage={(p) => update({ page: p })} onLimit={(l) => update({ limit: l })} label="records" />}
        />
      </div>
    </>
  );
}

// ---------- Incomplete records ----------

export function IncompleteRecordsPage() {
  const { activeMembership } = useAuth();
  const clinical = hasRole(activeMembership, 'doctor', 'rmo'); // may open the visit or the document itself
  const { data, error, loading } = useFetch('/records/incomplete');
  const link = (r) => {
    if (!clinical || !r.patient) return null;
    return r.kind === 'visit_unsigned' ? `/patients/${r.patient.id}/visits/${r.visitId}` : `/patients/${r.patient.id}/stays/${r.admissionId}/docs/${r.documentId}`;
  };
  const columns = [
    {
      key: 'days',
      header: 'Open for',
      render: (r) => (
        <StatusPill tone={r.daysOpen >= 7 ? 'high' : 'due'} icon={r.daysOpen >= 7 ? TriangleAlert : FileClock}>
          {r.daysOpen} {r.daysOpen === 1 ? 'day' : 'days'}
        </StatusPill>
      ),
    },
    { key: 'patient', header: 'Record', className: 'wrap', render: (r) => <PatientCell p={r.patient} /> },
    {
      key: 'what',
      header: 'What is unfinished',
      className: 'wrap',
      render: (r) => {
        const words = r.kind === 'visit_unsigned' ? `${INCOMPLETE_KIND_LABELS.visit_unsigned} – visit of ${formatDate(r.on)}` : `${KIND_LABELS[r.documentKind] ?? r.documentKind} still a draft${r.stayOver ? ' – the stay is over' : ` – written ${formatDate(r.on)}`}`;
        const to = link(r);
        return to ? <Link to={to}>{words}</Link> : words;
      },
    },
    { key: 'doctor', header: 'Doctor', render: (r) => r.patient?.assignedDoctorName ?? <span className="muted">–</span> },
  ];
  return (
    <>
      <PageHeader
        title="Incomplete records"
        documentTitle="Records"
        help={data ? `A visit is listed when it is still unsigned the day after; an inpatient document when it is still a draft once the stay is over, or after ${data.rules.draftOpenAfterDays} days.` : undefined}
        tabs={RECORDS_TABS}
        badges={
          data && (
            <>
              <StatusPill tone={data.counts.visits ? 'due' : 'stable'}>{formatNumber(data.counts.visits)} visits unsigned</StatusPill>
              <StatusPill tone={data.counts.documents ? 'due' : 'stable'}>{formatNumber(data.counts.documents)} documents in draft</StatusPill>
            </>
          )
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <DataTable caption="Incomplete records" columns={columns} rows={data?.rows.map((r) => ({ ...r, id: r.visitId ?? r.documentId }))} loading={loading} emptyText="Every visit is signed and every inpatient document is confirmed." />
      </div>
    </>
  );
}

// ---------- The copies register ----------

/** Choosing the patient a copy was given for (when the dialog is not opened from her record). */
function PatientPicker({ onPick }) {
  const [search, setSearch] = useState('');
  const { data, loading } = useFetch(search.trim().length >= 2 ? '/records/index' : null, { search: search.trim(), limit: 8 });
  return (
    <Field label="Whose record" id="ci-patient" hint="Type her name or patient number, then choose.">
      <SearchInput value={search} onChange={setSearch} placeholder="Name or patient number" label="Find the record" />
      {search.trim().length >= 2 && (
        <ul className="plain-list ci-picks" aria-busy={loading}>
          {(data?.rows ?? []).map((r) => (
            <li key={r.id}>
              <button type="button" className="btn btn-link btn-sm" onClick={() => onPick({ id: r.id, fullName: r.fullName, mrn: r.mrn })}>
                {r.fullName} · {r.mrn}
              </button>
            </li>
          ))}
          {data && data.rows.length === 0 && <li className="muted">No record matches.</li>}
        </ul>
      )}
    </Field>
  );
}

/** "A copy was given": the register's entry. patient: known when opened from her record (the copy of the whole record). */
export function CopyIssueDialog({ patient: given = null, defaultWhat = '', onDone, onCancel }) {
  const [patient, setPatient] = useState(given);
  const [form, setForm] = useState({ what: defaultWhat, whatNote: '', givenTo: '', receiverName: '', authorisation: '', requestedOn: '', givenOn: today(), note: '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(newRequestId());
  const ref = useDialogFocus(onCancel);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const missing = {};
    if (!patient) missing.patient = 'Choose whose record it was.';
    if (!form.what) missing.what = 'Choose what was given.';
    if (!form.givenTo) missing.givenTo = 'Choose who received it.';
    if (!form.givenOn) missing.givenOn = 'Enter the day it was given.';
    setFields(missing);
    if (Object.keys(missing).length) return undefined;
    setSaving(true);
    setError(null);
    try {
      const body = { clientRequestId: requestId.current, patientId: patient.id, ...form, whatNote: form.whatNote.trim(), receiverName: form.receiverName.trim(), authorisation: form.authorisation.trim(), note: form.note.trim() };
      onDone((await api('/records/copies', { method: 'POST', body })).issue);
    } catch (err) {
      setFields(err.fields ?? {});
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="ci-title" onSubmit={save} noValidate>
        <h2 id="ci-title">A copy of a record was given</h2>
        <p className="hint">The copies register: who received what, on what authority, and when. A copy is due within 72 hours of the request.</p>
        <Alert type="error">{error}</Alert>
        {patient ? (
          <p>
            <strong>{patient.fullName}</strong> <span className="muted tabular">· {patient.mrn}</span>
            {!given && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setPatient(null)}>
                Change
              </button>
            )}
          </p>
        ) : (
          <>
            <PatientPicker onPick={setPatient} />
            <Alert type="error">{fields.patient}</Alert>
          </>
        )}
        <div className="form-grid">
          <Field label="What was given" id="ci-what" error={fields.what}>
            <select id="ci-what" value={form.what} onChange={set('what')}>
              <option value="">Choose…</option>
              {options(COPY_WHATS, COPY_WHAT_LABELS)}
            </select>
          </Field>
          {['documents', 'other'].includes(form.what) && (
            <Field label={form.what === 'documents' ? 'Which documents' : 'What exactly'} id="ci-whatNote" error={fields.whatNote}>
              <input id="ci-whatNote" value={form.whatNote} maxLength={300} onChange={set('whatNote')} />
            </Field>
          )}
          <Field label="Given to" id="ci-givenTo" error={fields.givenTo}>
            <select id="ci-givenTo" value={form.givenTo} onChange={set('givenTo')}>
              <option value="">Choose…</option>
              {options(GIVEN_TO, GIVEN_TO_LABELS)}
            </select>
          </Field>
          {RECEIVER_NAME_NEEDED.includes(form.givenTo) && (
            <Field label="Name of the receiver" id="ci-receiver" error={fields.receiverName}>
              <input id="ci-receiver" value={form.receiverName} maxLength={120} onChange={set('receiverName')} />
            </Field>
          )}
          <Field label="Requested on (optional)" id="ci-requested" error={fields.requestedOn}>
            <input id="ci-requested" type="date" value={form.requestedOn} max={today()} onChange={set('requestedOn')} />
          </Field>
          <Field label="Given on" id="ci-given" error={fields.givenOn}>
            <input id="ci-given" type="date" value={form.givenOn} max={today()} onChange={set('givenOn')} />
          </Field>
        </div>
        <Field label={form.givenTo === 'patient' ? 'Request or authorisation (optional)' : 'Request or authorisation'} id="ci-auth" error={fields.authorisation} hint="Her written request or consent, a court order, the insurer’s request letter …">
          <input id="ci-auth" value={form.authorisation} maxLength={300} onChange={set('authorisation')} />
        </Field>
        <Field label="Note (optional)" id="ci-note" error={fields.note}>
          <input id="ci-note" value={form.note} maxLength={500} onChange={set('note')} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <BookCopy aria-hidden="true" /> {saving ? 'Saving…' : 'Record in the register'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function MistakeDialog({ issue, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const ref = useDialogFocus(onCancel);
  const save = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Write why this entry was made by mistake.');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err.fields?.reason ?? err.message);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="ci-mistake-title" onSubmit={save} noValidate>
        <h2 id="ci-mistake-title">Mark this entry as made by mistake?</h2>
        <p>It stays in the register, marked with your name and the reason. Nothing is deleted.</p>
        <Field label="Why" id="ci-mistake-reason" error={error}>
          <input id="ci-mistake-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-danger">
            Mark as a mistake
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function RecordCopiesPage() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1);
  const { data, error, loading, reload } = useFetch('/records/copies', { from, to, page });
  const [adding, setAdding] = useState(false);
  const [marking, setMarking] = useState(null);
  const [notice, setNotice] = useState(null);
  const update = (changes) => {
    const next = { from, to, page: 1, ...changes };
    setParams(Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== '' && !(k === 'page' && v === 1)).map(([k, v]) => [k, String(v)])), { replace: true });
  };
  const columns = [
    { key: 'given', header: 'Given on', render: (r) => <span className="tabular">{formatDate(r.givenOn)}</span> },
    { key: 'patient', header: 'Record', className: 'wrap', render: (r) => <PatientCell p={r.patient} /> },
    {
      key: 'what',
      header: 'What and to whom',
      className: 'wrap',
      render: (r) => (
        <div>
          <strong>{COPY_WHAT_LABELS[r.what] ?? r.what}</strong>
          {r.whatNote ? ` – ${r.whatNote}` : ''}
          <div className="t-caption muted">
            To {GIVEN_TO_WORDS[r.givenTo] ?? r.givenTo}
            {r.receiverName ? `: ${r.receiverName}` : ''}
            {r.authorisation ? ` · on ${r.authorisation}` : ''}
          </div>
          {r.note && <div className="t-caption muted">{r.note}</div>}
          <div className="t-caption muted">Recorded by {r.recorded?.byName}, {formatDateTime(r.recorded?.at)}</div>
        </div>
      ),
    },
    {
      key: 'timing',
      header: 'Timing',
      className: 'wrap',
      render: (r) =>
        r.cancelled ? (
          <span>
            <StatusPill tone="inactive">Made by mistake</StatusPill> <span className="t-caption muted">{r.cancelled.reason}</span>
          </span>
        ) : r.requestedOn ? (
          <StatusPill tone={r.late ? 'high' : 'stable'} icon={r.late ? TriangleAlert : undefined}>
            {copyTimingWords(r)}
          </StatusPill>
        ) : (
          <span className="muted">No request date</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.cancelled ? null : (
          <button type="button" className="btn btn-link btn-sm" onClick={() => setMarking(r)}>
            Made by mistake
          </button>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Copies register"
        documentTitle="Records"
        help="Every copy of a record that left the hospital: for whom, on what authority, when it was asked for and when it was given. A copy is due within 72 hours of the request."
        tabs={RECORDS_TABS}
        badges={data && data.late > 0 && <StatusPill tone="high" icon={TriangleAlert}>{formatNumber(data.late)} given late</StatusPill>}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" /> A copy was given
          </button>
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <DataTable
          caption="Copies register"
          columns={columns}
          rows={data?.rows}
          loading={loading}
          emptyText="No copy has been recorded as given."
          toolbar={
            <>
              <DateFilter label="Given from" value={from} onChange={(v) => update({ from: v })} />
              <DateFilter label="to" value={to} onChange={(v) => update({ to: v })} />
            </>
          }
          footer={data && <TablePagination page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} onPage={(p) => update({ page: p })} label="entries" />}
        />
      </div>
      {adding && (
        <CopyIssueDialog
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            setNotice('Recorded in the register.');
            reload();
          }}
        />
      )}
      {marking && (
        <MistakeDialog
          issue={marking}
          onCancel={() => setMarking(null)}
          onConfirm={async (reason) => {
            await api(`/records/copies/${marking.id}/cancel`, { method: 'POST', body: { reason } });
            setMarking(null);
            setNotice('Marked as made by mistake.');
            reload();
          }}
        />
      )}
    </>
  );
}

export const RECORDS_ICON = FolderArchive;
