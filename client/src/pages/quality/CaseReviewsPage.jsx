import { useState } from 'react';
import { BadgeCheck, FilePen } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog, nowLocal, toIso } from './FormDialog.jsx';
import { SimpleTable } from './SimpleTable.jsx';
import { useQualityTabs } from './qualityFormat.js';

// Clinical audit → Death and near-miss reviews (Clinical Requirements Group C – PX-OBG-30, DRAFT lists): the reviews,
// the mothers' deaths still without one, and starting a review. Doctors, RMOs and the quality lead only.

export const REVIEW_LOOK = {
  draft: { tone: 'due', icon: FilePen, word: 'Draft' },
  sealed: { tone: 'stable', icon: BadgeCheck, word: 'Sealed' },
};

/** R-0001 */
export const reviewNumber = (serial) => `R-${String(serial).padStart(4, '0')}`;

function StartDialog({ rules, mrn: givenMrn = '', kind: givenKind = '', onCancel }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ mrn: givenMrn, kind: givenKind, eventAt: nowLocal() });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await api('/case-reviews', { method: 'POST', body: { mrn: f.mrn.trim(), kind: f.kind, eventAt: toIso(f.eventAt) } });
      navigate(`/clinical-audit/reviews/${res.review.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="cr-start" title="Start a review" submitLabel="Start the review" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.fields ? null : error?.message}</Alert>
      <div className="form-grid">
        <Field label="Her patient number" id="cr-mrn" error={error?.fields?.mrn}>
          <input id="cr-mrn" value={f.mrn} placeholder="P-000123" onChange={(e) => setF({ ...f, mrn: e.target.value })} />
        </Field>
        <Field label="Review of" id="cr-kind" error={error?.fields?.kind}>
          <select id="cr-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="">Choose…</option>
            {Object.entries(rules.kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="When it happened" id="cr-at" error={error?.fields?.eventAt}>
          <DateTimeInput id="cr-at" value={f.eventAt} onChange={(e) => setF({ ...f, eventAt: e.target.value })} />
        </Field>
      </div>
    </FormDialog>
  );
}

export function CaseReviewsPage() {
  const tabs = useQualityTabs();
  const { data, error } = useFetch('/case-reviews');
  const [starting, setStarting] = useState(null);
  return (
    <>
      <PageHeader
        title="Clinical audit"
        documentTitle="Death and near-miss reviews"
        subtitle="Each maternal death and near miss reviewed by the team: the cause, the three delays, what could have been avoided and the actions. A doctor signs and seals it; later mistakes are corrected on top."
        tabs={tabs}
        actions={
          data && (
            <button type="button" className="btn btn-primary" onClick={() => setStarting({})}>
              Start a review
            </button>
          )
        }
      />
      <div className="pf-content stack">
        <Alert type="error">{error}</Alert>
        {data && <p className="hint">{data.rules.source}</p>}
        {data?.awaiting.length > 0 && (
          <section className="card">
            <h2>Deaths without a review</h2>
            <ul className="pa-list">
              {data.awaiting.map((d) => (
                <li key={d.id}>
                  <StatusPill tone="watch">Review due</StatusPill>
                  <span>{`${d.fullName} · ${d.mrn} · died ${formatDate(d.diedOn)}`}</span>
                  <button type="button" className="btn btn-link" onClick={() => setStarting({ mrn: d.mrn, kind: 'maternal_death' })}>
                    Start her review
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && (
          <section className="card">
            <h2>Reviews</h2>
            <SimpleTable
              emptyText="No reviews yet."
              rows={data.reviews}
              columns={[
                { key: 'no', header: 'No.', main: true, render: (r) => <Link to={`/clinical-audit/reviews/${r.id}`}>{reviewNumber(r.serial)}</Link> },
                { key: 'patient', header: 'Patient', render: (r) => (r.patient ? `${r.patient.fullName} · ${r.patient.mrn}` : '–') },
                { key: 'kind', header: 'Review of', render: (r) => data.rules.kinds[r.kind] },
                { key: 'when', header: 'When', render: (r) => formatDateTime(r.eventAt) },
                {
                  key: 'status',
                  header: 'Status',
                  render: (r) => (
                    <>
                      <StatusPill tone={REVIEW_LOOK[r.status].tone} icon={REVIEW_LOOK[r.status].icon}>
                        {REVIEW_LOOK[r.status].word}
                      </StatusPill>
                      {r.corrections ? ` · ${r.corrections} correction${r.corrections === 1 ? '' : 's'}` : ''}
                    </>
                  ),
                },
              ]}
            />
          </section>
        )}
      </div>
      {starting && <StartDialog rules={data.rules} mrn={starting.mrn} kind={starting.kind} onCancel={() => setStarting(null)} />}
    </>
  );
}
