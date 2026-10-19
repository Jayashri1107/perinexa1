import { useState } from 'react';
import { ChartLine, CircleCheck, Plus, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { DataTable, usePagedRows } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal } from '../billing/billingUi.jsx';

// Lab → QC (Lab version 2 – docs/LAB_V2_PLAN.md): control lots (a test's value, level 1–3, lot, expiry, the insert's
// mean and SD), the day's control runs checked with the Westgard rules, the Levey-Jennings chart of a lot, and the
// corrective action of a rejected run. While a test's run today is rejected without an action, reporting it needs a
// reason. Status = colour + icon + word. The lots as a table with today's value on each row; adding a lot, the chart and
// the corrective action in dialogs (owner, 19 Oct 2026).

const LOOK = {
  accepted: { tone: 'stable', icon: CircleCheck, word: 'Accepted' },
  warning: { tone: 'watch', icon: TriangleAlert, word: 'Warning' },
  rejected: { tone: 'high', icon: TriangleAlert, word: 'Rejected' },
};
export function RunPill({ status }) {
  const l = LOOK[status];
  return l ? (
    <StatusPill tone={l.tone} icon={l.icon}>
      {l.word}
    </StatusPill>
  ) : null;
}

/** The Levey-Jennings chart: each run's value against the mean and ±1, 2, 3 SD (SVG, points coloured by status). */
export function LeveyJennings({ lot, runs }) {
  const W = 640;
  const H = 240;
  const pad = 36;
  const y = (z) => H / 2 - (Math.max(-4, Math.min(4, z)) * (H / 2 - 16)) / 4;
  const x = (i) => pad + (runs.length <= 1 ? 0 : (i * (W - pad - 12)) / (runs.length - 1));
  const lines = [-3, -2, -1, 0, 1, 2, 3];
  return (
    <svg className="lj-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Levey-Jennings chart of lot ${lot.lotNo}`}>
      {lines.map((s) => (
        <g key={s}>
          <line x1={pad} x2={W - 8} y1={y(s)} y2={y(s)} className={s === 0 ? 'lj-mean' : Math.abs(s) === 3 ? 'lj-3sd' : Math.abs(s) === 2 ? 'lj-2sd' : 'lj-1sd'} />
          <text x={4} y={y(s) + 4} className="lj-label">
            {s === 0 ? 'Mean' : `${s > 0 ? '+' : ''}${s} SD`}
          </text>
        </g>
      ))}
      {runs.length > 1 && <polyline className="lj-line" points={runs.map((r, i) => `${x(i)},${y(r.z)}`).join(' ')} />}
      {runs.map((r, i) => (
        <circle key={r.id} cx={x(i)} cy={y(r.z)} r={4} className={`lj-point is-${r.status}`}>
          <title>{`${r.value} (${r.z > 0 ? '+' : ''}${r.z} SD) – ${formatDateTime(r.run.at)}${r.rules.length ? ` – ${r.rules.join('; ')}` : ''}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function LotChart({ lot, onClose }) {
  const res = useFetch(`/lab-qc/lots/${lot.id}/runs`);
  return (
    <Modal id="lj" title={`Levey-Jennings – ${lot.label} · level ${lot.level} · lot ${lot.lotNo}`} wide onClose={onClose}>
      <p className="hint">Mean {lot.mean}, SD {lot.sd}. Points: accepted, warning (beyond 2 SD) and rejected runs. The last 60 runs.</p>
      {res.data ? res.data.runs.length ? <LeveyJennings lot={lot} runs={res.data.runs} /> : <p className="muted">No runs yet.</p> : <p className="muted">Loading…</p>}
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function ActionDialog({ lot, onClose, onDone }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/lab-qc/runs/${lot.latest.id}/action`, { method: 'POST', body: { text: text.trim() } });
      onDone();
    } catch (err) {
      setError(err.fields?.text ?? err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="qa" title={`Corrective action – ${lot.label} · level ${lot.level}`} onClose={onClose}>
      <p>
        The run of {formatDateTime(lot.latest.run.at)} ({lot.latest.value}) was rejected{lot.latest.rules.length ? `: ${lot.latest.rules.join('; ')}` : ''}. Write what was
        done (e.g. new reagent opened, analyser recalibrated, control repeated).
      </p>
      <form onSubmit={save} noValidate>
        <Field label="Corrective action" id="qa-text" error={error}>
          <input id="qa-text" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || text.trim().length < 3}>
            {busy ? 'Saving…' : 'Save the action'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

const EMPTY_LOT = { field: '', level: '1', material: '', lotNo: '', expiresOn: '', mean: '', sd: '' };

function LotDialog({ data, onClose, onSaved }) {
  const [lot, setLot] = useState(EMPTY_LOT);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const addLot = async (e) => {
    e.preventDefault();
    const [testKey, fieldKey] = lot.field.split('|');
    setBusy(true);
    try {
      await api('/lab-qc/lots', { method: 'POST', body: { testKey, fieldKey, level: Number(lot.level), material: lot.material, lotNo: lot.lotNo, expiresOn: lot.expiresOn || null, mean: Number(lot.mean), sd: Number(lot.sd) } });
      onSaved();
    } catch (err) {
      setFields({ ...(err.fields ?? {}), form: err.message });
      setBusy(false);
    }
  };
  return (
    <Modal id="ql" title="Add a control lot" wide onClose={onClose}>
      <form onSubmit={addLot} noValidate>
        <Alert type="error">{fields.form}</Alert>
        <div className="form-grid">
          <Field label="Test value" id="ql-field" error={fields.fieldKey}>
            <select id="ql-field" value={lot.field} onChange={(e) => setLot({ ...lot, field: e.target.value })} autoFocus>
              <option value="">Choose…</option>
              {(data?.fields ?? []).map((f) => (
                <option key={`${f.testKey}|${f.fieldKey}`} value={`${f.testKey}|${f.fieldKey}`}>
                  {f.testName} – {f.fieldName}
                  {f.unit ? ` (${f.unit})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Level" id="ql-level">
            <select id="ql-level" value={lot.level} onChange={(e) => setLot({ ...lot, level: e.target.value })}>
              <option value="1">1 (normal)</option>
              <option value="2">2 (abnormal)</option>
              <option value="3">3 (high)</option>
            </select>
          </Field>
          <Field label="Control material" id="ql-mat">
            <input id="ql-mat" maxLength={120} value={lot.material} onChange={(e) => setLot({ ...lot, material: e.target.value })} />
          </Field>
          <Field label="Lot number" id="ql-lot" error={fields.lotNo}>
            <input id="ql-lot" maxLength={60} value={lot.lotNo} onChange={(e) => setLot({ ...lot, lotNo: e.target.value })} />
          </Field>
          <Field label="Expires on" id="ql-exp">
            <input id="ql-exp" type="date" value={lot.expiresOn} onChange={(e) => setLot({ ...lot, expiresOn: e.target.value })} />
          </Field>
          <Field label="Target mean" id="ql-mean" error={fields.mean}>
            <input id="ql-mean" inputMode="decimal" value={lot.mean} onChange={(e) => setLot({ ...lot, mean: e.target.value })} />
          </Field>
          <Field label="SD" id="ql-sd" error={fields.sd}>
            <input id="ql-sd" inputMode="decimal" value={lot.sd} onChange={(e) => setLot({ ...lot, sd: e.target.value })} />
          </Field>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || !lot.field}>
            {busy ? 'Saving…' : 'Save the lot'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function LabQcPage() {
  const { data, error, loading, reload } = useFetch('/lab-qc');
  const [dialog, setDialog] = useState(null); // 'lot' | { chart: lot } | { action: lot }
  const [values, setValues] = useState({});
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const label = (l) => {
    const f = data?.fields.find((x) => x.testKey === l.testKey && x.fieldKey === l.fieldKey);
    return f ? `${f.testName} – ${f.fieldName}` : `${l.testKey} – ${l.fieldKey}`;
  };
  const run = async (l) => {
    setActionError(null);
    try {
      const { run: r } = await api(`/lab-qc/lots/${l.id}/runs`, { method: 'POST', body: { value: Number(String(values[l.id] ?? '').replace(',', '.')) } });
      setValues({ ...values, [l.id]: '' });
      setNotice(`${label(l)} level ${l.level}: ${r.value} – ${LOOK[r.status].word}${r.rules.length ? ` (${r.rules.join('; ')})` : ''}.`);
      reload();
    } catch (err) {
      setActionError(err.message);
    }
  };
  const { shown, pager } = usePagedRows(data?.lots, { label: 'control lots' });
  const columns = [
    {
      key: 'test',
      header: 'Test value',
      render: (l) => (
        <>
          <strong>{label(l)}</strong>
          {l.material && <span className="muted dt-sub">{l.material}</span>}
        </>
      ),
    },
    { key: 'level', header: 'Level', render: (l) => <span className="tabular">{l.level}</span> },
    {
      key: 'lot',
      header: 'Lot',
      render: (l) => (
        <>
          <span className="tabular">{l.lotNo}</span>
          {l.expiresOn && <span className="muted dt-sub">expires {formatDate(l.expiresOn)}</span>}
        </>
      ),
    },
    { key: 'target', header: 'Mean ± SD', render: (l) => <span className="tabular">{`${l.mean} ± ${l.sd}`}</span> },
    {
      key: 'last',
      header: 'Last run',
      render: (l) =>
        l.latest ? (
          <>
            <span className="qc-last">
              <span className="tabular">{l.latest.value}</span> <RunPill status={l.latest.status} />
            </span>
            <span className="muted dt-sub">{formatDateTime(l.latest.run.at)}</span>
            {l.latest.action && <span className="muted dt-sub">Action: {l.latest.action.text}</span>}
            {l.latest.status === 'rejected' && !l.latest.action && (
              <button type="button" className="btn btn-link btn-sm qc-action-btn" onClick={() => setDialog({ action: { ...l, label: label(l) } })}>
                Write the corrective action
              </button>
            )}
          </>
        ) : (
          <span className="muted">No run yet</span>
        ),
    },
    {
      key: 'today',
      header: 'Today’s value',
      render: (l) =>
        l.active ? (
          <form
            className="qc-run-inline"
            onSubmit={(e) => {
              e.preventDefault();
              run(l);
            }}
            noValidate
          >
            <input aria-label={`Today’s control value for ${label(l)} level ${l.level}`} inputMode="decimal" className="tabular" value={values[l.id] ?? ''} onChange={(e) => setValues({ ...values, [l.id]: e.target.value })} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={!values[l.id]}>
              Enter
            </button>
          </form>
        ) : (
          <span className="muted">Not in use</span>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (l) => (
        <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ chart: { ...l, label: label(l) } })} aria-label={`Chart of ${label(l)} level ${l.level}`}>
          <ChartLine aria-hidden="true" /> Chart
        </button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        title="Quality control"
        documentTitle="Lab quality control"
        help="Enter each day's control readings. The Westgard rules check each run; a rejected run needs a corrective action before results are reported without a reason."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setDialog('lot')}>
            <Plus aria-hidden="true" /> Add a control lot
          </button>
        }
      />
      <div className="pf-content lab-tables">
        <Alert type="error">{error || actionError}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <DataTable caption="Control lots" columns={columns} rows={shown} loading={loading} emptyText="No control lots yet. Add one for each control level you run." footer={pager} />
      </div>
      {dialog === 'lot' && (
        <LotDialog
          data={data}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setNotice('Control lot added.');
            reload();
          }}
        />
      )}
      {dialog?.chart && <LotChart lot={dialog.chart} onClose={() => setDialog(null)} />}
      {dialog?.action && (
        <ActionDialog
          lot={dialog.action}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setNotice('Corrective action saved.');
            reload();
          }}
        />
      )}
    </>
  );
}
