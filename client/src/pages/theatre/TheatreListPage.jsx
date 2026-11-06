import { useState } from 'react';
import { CircleCheck, Circle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { SimpleTable } from '../quality/SimpleTable.jsx';
import { ANAESTHESIA, CASE_STATUS, PHASES, PHASE_ORDER, URGENCY } from './whoRules.js';

// The theatre list (Clinical Requirements Group B, item 16 – PX-OT-01): the day's operations by theatre and order, with
// where each one is in the WHO Surgical Safety Checklist. Doctors, RMOs and nurses.

const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const STATUS_LOOK = {
  planned: { tone: 'neutral', word: 'Planned' },
  in_theatre: { tone: 'due', word: 'In theatre' },
  done: { tone: 'stable', word: 'Done' },
  cancelled: { tone: 'inactive', word: 'Taken off the list' },
};

/** Sign in · Time out · Sign out, each ticked or not – icon and word. */
export function ChecklistProgress({ progress }) {
  return (
    <span className="row">
      {PHASE_ORDER.map((p) => {
        const done = progress[p];
        const word = PHASES[p].label.split(' – ')[0];
        return (
          <StatusPill key={p} tone={done ? 'stable' : 'neutral'} icon={done ? CircleCheck : Circle}>
            {`${word}${done ? ' done' : ''}`}
          </StatusPill>
        );
      })}
    </span>
  );
}

function AddDialog({ date, onDone, onCancel }) {
  const [f, setF] = useState({ patientNo: '', listDate: date, theatre: 'Theatre 1', order: '1', procedure: '', site: '', urgency: 'elective', surgeon: '', assistant: '', anaesthetist: '', anaesthesia: '' });
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const fe = (k) => error?.fields?.[k];
  const submit = async () => {
    setBusy(true);
    try {
      await api('/theatre', { method: 'POST', body: { ...f, clientRequestId: requestId, order: Number(f.order || 1) } });
      onDone(f.listDate);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const text = (k, label, max) => (
    <Field label={label} id={`th-${k}`} error={fe(k)}>
      <input id={`th-${k}`} maxLength={max} value={f[k]} onChange={set(k)} />
    </Field>
  );
  return (
    <FormDialog id="th-add" title="Put an operation on the list" submitLabel="Add to the list" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <div className="form-grid">
        {text('patientNo', 'Patient number', 30)}
        <Field label="Day" id="th-day" error={fe('listDate')}>
          <input id="th-day" type="date" value={f.listDate} onChange={set('listDate')} />
        </Field>
        {text('theatre', 'Theatre', 40)}
        <Field label="Order on the list" id="th-order" error={fe('order')}>
          <input id="th-order" inputMode="numeric" value={f.order} onChange={set('order')} />
        </Field>
        {text('procedure', 'Operation', 300)}
        {text('site', 'Site or side (optional)', 100)}
        <Field label="Urgency" id="th-urg">
          <select id="th-urg" value={f.urgency} onChange={set('urgency')}>
            {Object.entries(URGENCY).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        {text('surgeon', 'Surgeon (optional)', 150)}
        {text('assistant', 'Assistant (optional)', 150)}
        {text('anaesthetist', 'Anaesthetist (optional)', 150)}
        <Field label="Anaesthesia (optional)" id="th-an">
          <select id="th-an" value={f.anaesthesia} onChange={set('anaesthesia')}>
            <option value="">Not decided</option>
            {Object.entries(ANAESTHESIA).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </FormDialog>
  );
}

export function TheatreListPage() {
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : today();
  const { data, error, loading, reload } = useFetch('/theatre', { date });
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(null);
  return (
    <>
      <PageHeader
        title="Theatre list"
        documentTitle="Theatre list"
        subtitle="The day's operations and where each one is in the WHO Surgical Safety Checklist."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Add an operation
          </button>
        }
      />
      <div className="pf-content stack">
        <Alert type="error">{error}</Alert>
        {notice && (
          <Alert type="success" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        <div className="row reg-toolbar">
          <Field label="Day" id="th-date">
            <input id="th-date" type="date" value={date} onChange={(e) => e.target.value && setParams({ date: e.target.value }, { replace: true })} />
          </Field>
        </div>
        <section className="card">
          <SimpleTable
            loading={loading && !data}
            rows={data?.cases ?? []}
            emptyText="No operations on the list for this day."
            columns={[
              { key: 'where', header: 'Theatre', render: (c) => `${c.theatre} · ${c.order}` },
              { key: 'patient', header: 'Patient', render: (c) => <Link to={`/theatre/${c.id}`}>{`${c.patient.fullName} · ${c.patient.mrn}`}</Link> },
              { key: 'procedure', header: 'Operation', render: (c) => `${c.procedure}${c.site ? ` (${c.site})` : ''}${c.urgency === 'emergency' ? ' · Emergency' : ''}` },
              { key: 'team', header: 'Team', render: (c) => [c.surgeon, c.anaesthetist].filter(Boolean).join(' · ') || '–' },
              {
                key: 'status',
                header: 'Status',
                render: (c) => (
                  <span className="stack">
                    <StatusPill tone={STATUS_LOOK[c.status].tone}>{STATUS_LOOK[c.status].word}</StatusPill>
                    {c.status !== 'cancelled' && <ChecklistProgress progress={c.progress} />}
                  </span>
                ),
              },
            ]}
          />
        </section>
        <p className="hint">{`Statuses: ${Object.values(CASE_STATUS).join(', ')}. Open an operation to fill in its WHO checklist.`}</p>
      </div>
      {adding && (
        <AddDialog
          date={date}
          onCancel={() => setAdding(false)}
          onDone={(d) => {
            setAdding(false);
            setNotice('Operation added to the list.');
            if (d !== date) setParams({ date: d }, { replace: true });
            else reload();
          }}
        />
      )}
    </>
  );
}
