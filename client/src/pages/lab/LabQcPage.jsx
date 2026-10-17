import { useState } from 'react';
import { CircleCheck, Plus, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// Lab → QC (Lab version 2 – docs/LAB_V2_PLAN.md): control lots (a test's value, level 1–3, lot, expiry, the insert's
// mean and SD), the day's control runs checked with the Westgard rules, the Levey-Jennings chart of a lot, and the
// corrective action of a rejected run. While a test's run today is rejected without an action, reporting it needs a
// reason. Status = colour + icon + word.

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
    <section className="card" aria-labelledby="lj-title">
      <div className="plan-card-head">
        <h2 id="lj-title">
          Levey-Jennings – {lot.label} · level {lot.level} · lot {lot.lotNo}
        </h2>
        <button type="button" className="btn btn-link btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Mean {lot.mean}, SD {lot.sd}. Points: accepted, warning (beyond 2 SD) and rejected runs. The last 60 runs.
      </p>
      {res.data ? res.data.runs.length ? <LeveyJennings lot={lot} runs={res.data.runs} /> : <p className="muted">No runs yet.</p> : <p className="muted">Loading…</p>}
    </section>
  );
}

function ActionForm({ run, onDone }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(`/lab-qc/runs/${run.id}/action`, { method: 'POST', body: { text: text.trim() } });
      onDone();
    } catch (err) {
      setError(err.fields?.text ?? err.message);
    }
  };
  return (
    <form className="row qc-action" onSubmit={save} noValidate>
      <Field label="Corrective action (what was done)" id={`qa-${run.id}`} error={error}>
        <input id={`qa-${run.id}`} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-secondary btn-sm">
        Save the action
      </button>
    </form>
  );
}

const EMPTY_LOT = { field: '', level: '1', material: '', lotNo: '', expiresOn: '', mean: '', sd: '' };

export function LabQcPage() {
  const { data, error, reload } = useFetch('/lab-qc');
  const [adding, setAdding] = useState(false);
  const [lot, setLot] = useState(EMPTY_LOT);
  const [fields, setFields] = useState({});
  const [values, setValues] = useState({});
  const [chart, setChart] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const label = (l) => {
    const f = data?.fields.find((x) => x.testKey === l.testKey && x.fieldKey === l.fieldKey);
    return f ? `${f.testName} – ${f.fieldName}` : `${l.testKey} – ${l.fieldKey}`;
  };
  const addLot = async (e) => {
    e.preventDefault();
    const [testKey, fieldKey] = lot.field.split('|');
    try {
      await api('/lab-qc/lots', { method: 'POST', body: { testKey, fieldKey, level: Number(lot.level), material: lot.material, lotNo: lot.lotNo, expiresOn: lot.expiresOn || null, mean: Number(lot.mean), sd: Number(lot.sd) } });
      setAdding(false);
      setLot(EMPTY_LOT);
      setFields({});
      reload();
    } catch (err) {
      setFields({ ...(err.fields ?? {}), form: err.message });
    }
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
  return (
    <>
      <PageHeader title="Quality control" documentTitle="Lab quality control" help="Enter each day's control readings. The Westgard rules check each run; a rejected run needs a corrective action before results are reported without a reason." />
      <div className="pf-content">
        <Alert type="error">{error || actionError}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        {!adding ? (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" /> Add a control lot
          </button>
        ) : (
          <form className="card" onSubmit={addLot} noValidate>
            <h2>Add a control lot</h2>
            <Alert type="error">{fields.form}</Alert>
            <div className="form-grid">
              <Field label="Test value" id="ql-field" error={fields.fieldKey}>
                <select id="ql-field" value={lot.field} onChange={(e) => setLot({ ...lot, field: e.target.value })}>
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
              <button type="submit" className="btn btn-primary">
                Save the lot
              </button>
              <button type="button" className="btn btn-link" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {chart && <LotChart lot={{ ...chart, label: label(chart) }} onClose={() => setChart(null)} />}
        <section className="card" aria-labelledby="qc-lots">
          <h2 id="qc-lots">Control lots</h2>
          {!data ? (
            <p className="muted">Loading…</p>
          ) : data.lots.length === 0 ? (
            <p className="muted">No control lots yet.</p>
          ) : (
            <ul className="wl-list">
              {data.lots.map((l) => (
                <li key={l.id}>
                  <div className="wl-row-head">
                    <span className="wl-who">
                      <strong>
                        {label(l)} · level {l.level}
                      </strong>
                      <span className="muted">
                        Lot {l.lotNo}
                        {l.expiresOn ? ` · expires ${formatDate(l.expiresOn)}` : ''} · mean {l.mean} · SD {l.sd}
                        {l.latest ? ` · last run ${l.latest.value} (${formatDateTime(l.latest.run.at)})` : ' · no run yet'}
                      </span>
                    </span>
                    <span className="wl-counts">
                      {l.latest && <RunPill status={l.latest.status} />}
                      <button type="button" className="btn btn-link btn-sm" onClick={() => setChart(l)}>
                        Chart
                      </button>
                    </span>
                  </div>
                  {l.active && (
                    <form
                      className="row qc-run"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(l);
                      }}
                      noValidate
                    >
                      <label className="lab-filter" htmlFor={`qr-${l.id}`}>
                        <span>Today's control value</span>
                        <input id={`qr-${l.id}`} inputMode="decimal" className="tabular" value={values[l.id] ?? ''} onChange={(e) => setValues({ ...values, [l.id]: e.target.value })} />
                      </label>
                      <button type="submit" className="btn btn-secondary btn-sm" disabled={!values[l.id]}>
                        Enter the run
                      </button>
                    </form>
                  )}
                  {l.latest?.status === 'rejected' && !l.latest.action && <ActionForm run={l.latest} onDone={reload} />}
                  {l.latest?.action && <span className="hint">Corrective action: {l.latest.action.text} ({l.latest.action.byName})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
