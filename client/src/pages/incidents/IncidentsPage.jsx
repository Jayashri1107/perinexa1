import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { ShowChoice, SimpleTable } from '../quality/SimpleTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog, nowLocal, toIso } from '../quality/FormDialog.jsx';
import { INCIDENT_KINDS, SEVERITIES, incidentLook } from './incidentFormat.js';

// Incidents (Clinical Requirements Group A, item 6 – PX-X-10): report an incident; the quality lead reviews it, records
// its actions and closes it. Everyone sees the incidents they reported; the quality lead and the hospital admin see all
// (the admin without the patient it names). Never on the patient's record or its copy. DRAFT kinds of incident.

function Pick({ id, label, value, onChange, options, error }) {
  return (
    <Field label={label} id={id} error={error}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {Object.entries(options).map(([k, w]) => (
          <option key={k} value={k}>
            {w}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ReportDialog({ onDone, onCancel }) {
  const [f, setF] = useState({ occurredAt: nowLocal(), place: '', kind: '', severity: '', description: '', immediateAction: '', patientNo: '' });
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF({ ...f, [k]: typeof v === 'string' ? v : v.target.value });
  const fe = (k) => error?.fields?.[k];
  const submit = async () => {
    setBusy(true);
    try {
      const res = await api('/incidents', { method: 'POST', body: { ...f, clientRequestId: requestId, occurredAt: toIso(f.occurredAt) } });
      onDone(`Incident ${res.incident.serial} reported. The quality lead will review it.`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="inc-report" title="Report an incident" submitLabel="Report" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <p className="hint">Write what happened, not who is to blame. An incident is never shown on the patient&apos;s record.</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label="When it happened" id="inc-at" error={fe('occurredAt')}>
        <DateTimeInput id="inc-at" value={f.occurredAt} onChange={set('occurredAt')} />
      </Field>
      <Field label="Where (optional)" id="inc-place" error={fe('place')}>
        <input id="inc-place" maxLength={150} value={f.place} onChange={set('place')} />
      </Field>
      <Pick id="inc-kind" label="Kind of incident" value={f.kind} onChange={set('kind')} options={INCIDENT_KINDS} error={fe('kind')} />
      <Pick id="inc-sev" label="Degree of harm" value={f.severity} onChange={set('severity')} options={SEVERITIES} error={fe('severity')} />
      <Field label="What happened" id="inc-desc" error={fe('description')}>
        <textarea id="inc-desc" rows={4} maxLength={4000} value={f.description} onChange={set('description')} />
      </Field>
      <Field label="What was done at once (optional)" id="inc-now" error={fe('immediateAction')}>
        <textarea id="inc-now" rows={2} maxLength={2000} value={f.immediateAction} onChange={set('immediateAction')} />
      </Field>
      <Field label="Patient number, if it concerns a patient (optional)" id="inc-pno" error={fe('patientNo')}>
        <input id="inc-pno" maxLength={30} value={f.patientNo} onChange={set('patientNo')} />
      </Field>
    </FormDialog>
  );
}

export function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState(null);
  const show = ['open', 'closed', 'all'].includes(params.get('show')) ? params.get('show') : 'open';
  const { data, error, loading, reload } = useFetch('/incidents', { show });
  const { activeMembership } = useAuth();
  const seesAll = hasRole(activeMembership, 'quality', 'admin');
  return (
    <>
      <PageHeader
        title="Incidents"
        documentTitle="Incidents"
        help="Report an incident – the quality lead reviews it, records the actions and closes it. Incidents are kept apart from the patients' records."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setReporting(true)}>
            Report an incident
          </button>
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        {notice && (
          <Alert type="success" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        {seesAll && (
          <ShowChoice options={[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']]} value={show} onChange={(k) => setParams({ show: k }, { replace: true })} />
        )}
        <section className="card">
          <SimpleTable
            loading={loading && !data}
            rows={data?.incidents ?? []}
            emptyText="No incidents here."
            columns={[
              { key: 'serial', header: 'No.', render: (i) => <Link to={`/incidents/${i.id}`}>{i.serial}</Link> },
              { key: 'occurredAt', header: 'When', render: (i) => formatDateTime(i.occurredAt) },
              { key: 'kind', header: 'Kind', render: (i) => INCIDENT_KINDS[i.kind] },
              { key: 'severity', header: 'Harm', render: (i) => SEVERITIES[i.severity] },
              { key: 'reported', header: 'Reported by', render: (i) => (i.reported.mine ? 'You' : i.reported.byName) },
              {
                key: 'status',
                header: 'Status',
                render: (i) => {
                  const look = incidentLook(i);
                  return (
                    <StatusPill tone={look.tone} icon={look.icon}>
                      {look.word}
                    </StatusPill>
                  );
                },
              },
            ]}
          />
        </section>
      </div>
      {reporting && (
        <ReportDialog
          onCancel={() => setReporting(false)}
          onDone={(text) => {
            setReporting(false);
            setNotice(text);
            reload();
          }}
        />
      )}
    </>
  );
}

/** One incident: what was reported, and – for the quality lead – the review, the actions and the closure. */
export function IncidentPage() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/incidents/${id}`);
  const { activeMembership } = useAuth();
  const lead = hasRole(activeMembership, 'quality');
  const [form, setForm] = useState({ findings: '', causes: '', severity: '', text: '', owner: '', dueOn: '', summary: '' });
  const [problem, setProblem] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const run = async (path, body) => {
    try {
      await api(`/incidents/${id}${path}`, { method: 'POST', body });
      setProblem(null);
      reload();
    } catch (err) {
      setProblem(err);
    }
  };
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <p className="muted">Loading…</p>;
  const i = data.incident;
  const look = incidentLook(i);
  const fe = (k) => problem?.fields?.[k];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Incidents', to: '/incidents' }, { label: `Incident ${i.serial}` }]} title={`Incident ${i.serial}`} documentTitle={`Incident ${i.serial}`} />
      <div className="pf-content stack">
        <Alert type="error">{problem?.message}</Alert>
        <section className="card">
          <p>
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.word}
            </StatusPill>
          </p>
          <dl className="details">
            <div>
              <dt>When</dt>
              <dd>{`${formatDateTime(i.occurredAt)}${i.place ? ` · ${i.place}` : ''}`}</dd>
            </div>
            <div>
              <dt>Kind</dt>
              <dd>{INCIDENT_KINDS[i.kind]}</dd>
            </div>
            <div>
              <dt>Degree of harm</dt>
              <dd>{SEVERITIES[i.severity]}</dd>
            </div>
            <div>
              <dt>What happened</dt>
              <dd className="pre-line">{i.description}</dd>
            </div>
            {i.immediateAction && (
              <div>
                <dt>Done at once</dt>
                <dd className="pre-line">{i.immediateAction}</dd>
              </div>
            )}
            {i.patient && (
              <div>
                <dt>Patient</dt>
                <dd>{`${i.patient.fullName} · ${i.patient.mrn}`}</dd>
              </div>
            )}
            <div>
              <dt>Reported</dt>
              <dd>{`${i.reported.byName}, ${formatDateTime(i.reported.at)}`}</dd>
            </div>
          </dl>
        </section>
        {i.review !== undefined && (
          <section className="card stack" aria-labelledby="inc-review">
            <h2 id="inc-review">Review</h2>
            {i.review ? (
              <p className="pre-line">{`${i.review.findings}${i.review.causes ? `\nCauses: ${i.review.causes}` : ''}\n(${i.review.byName}, ${formatDateTime(i.review.at)})`}</p>
            ) : (
              lead &&
              i.status !== 'closed' && (
                <div className="form-grid">
                  <Field label="Findings" id="inc-findings" error={fe('findings')}>
                    <textarea id="inc-findings" rows={3} value={form.findings} onChange={set('findings')} />
                  </Field>
                  <Field label="Causes (optional)" id="inc-causes" error={fe('causes')}>
                    <textarea id="inc-causes" rows={2} value={form.causes} onChange={set('causes')} />
                  </Field>
                  <Pick id="inc-rsev" label="Degree of harm" value={form.severity} onChange={(v) => setForm({ ...form, severity: v })} options={SEVERITIES} error={fe('severity')} />
                  <div className="row">
                    <button type="button" className="btn btn-primary" onClick={() => run('/review', { findings: form.findings, causes: form.causes, severity: form.severity })}>
                      Save the review
                    </button>
                  </div>
                </div>
              )
            )}
            <h3>Actions</h3>
            <ul className="plain-list stack">
              {(i.actions ?? []).map((a) => (
                <li key={a.id} className="row">
                  <StatusPill tone={a.done ? 'stable' : 'watch'}>{a.done ? 'Done' : 'Open'}</StatusPill>
                  <span className="grow">{`${a.text}${a.owner ? ` – ${a.owner}` : ''}${a.dueOn ? `, by ${formatDate(a.dueOn)}` : ''}`}</span>
                  {!a.done && lead && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(`/actions/${a.id}/done`, {})}>
                      Mark done
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {lead && i.status !== 'closed' && (
              <div className="form-grid">
                <Field label="New action" id="inc-text" error={fe('text')}>
                  <input id="inc-text" maxLength={1000} value={form.text} onChange={set('text')} />
                </Field>
                <Field label="Who (optional)" id="inc-owner">
                  <input id="inc-owner" maxLength={150} value={form.owner} onChange={set('owner')} />
                </Field>
                <Field label="By (optional)" id="inc-due">
                  <input id="inc-due" type="date" value={form.dueOn} onChange={set('dueOn')} />
                </Field>
                <div className="row">
                  <button type="button" className="btn btn-secondary" onClick={() => run('/actions', { text: form.text, owner: form.owner, dueOn: form.dueOn || null }).then(() => setForm({ ...form, text: '', owner: '', dueOn: '' }))}>
                    Add the action
                  </button>
                </div>
              </div>
            )}
            {i.closure ? (
              <p className="pre-line">{`Closed: ${i.closure.summary} (${i.closure.byName}, ${formatDateTime(i.closure.at)})`}</p>
            ) : (
              lead &&
              i.review && (
                <div className="form-grid">
                  <Field label="Closing summary" id="inc-summary" error={fe('summary')}>
                    <textarea id="inc-summary" rows={2} value={form.summary} onChange={set('summary')} />
                  </Field>
                  <div className="row">
                    <button type="button" className="btn btn-secondary" onClick={() => run('/close', { summary: form.summary })}>
                      Close the incident
                    </button>
                  </div>
                </div>
              )
            )}
          </section>
        )}
        {i.review === undefined && <p className="hint">{`The quality lead reviews it. Actions still open: ${i.actionsOpen}.`}</p>}
      </div>
    </>
  );
}
