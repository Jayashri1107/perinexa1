import { useState } from 'react';
import { CircleAlert, CircleCheck, Droplet, TriangleAlert } from 'lucide-react';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { ShowChoice } from '../quality/SimpleTable.jsx';
import { LOSS_METHODS, PPH_CAUSES, PPH_OUTCOMES, PPH_SOURCE, PPH_STEPS, lossBand } from './pphRules.js';

// The PPH chart of a stay (Clinical Requirements Group B, item 15 – DRAFT until OBG-F-07 replaces it): started when the
// bleeding is recognised (or typed in afterwards from the paper chart), then each amount of blood lost, each step taken
// and each set of observations, in time order; the blood loss is added up and banded, the shock index worked out. A
// medicine's dose and route are typed by whoever gave it – Perinexa never gives a dose. Closed by her doctor or an RMO.

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const iso = (v) => (v ? new Date(v).toISOString() : '');
const LOOK = {
  red: { tone: 'high', icon: TriangleAlert, word: 'Red' },
  yellow: { tone: 'watch', icon: CircleAlert, word: 'Yellow' },
  normal: { tone: 'stable', icon: CircleCheck, word: 'Normal' },
};
const stepLabel = (key) => PPH_STEPS.find((s) => s.key === key)?.label ?? key;

/** Every line of a chart in time order, as words. */
export function timeline(chart) {
  const rows = [
    ...chart.losses.map((l) => ({ id: l.id, at: l.at, kind: 'Blood loss', words: `${l.ml} mL, ${l.method}`, byName: l.byName, cancelled: l.cancelled })),
    ...chart.steps.map((s) => ({ id: s.id, at: s.at, kind: 'Step', words: [stepLabel(s.key), s.dose && `dose ${s.dose}`, s.route && `route ${s.route}`, s.note].filter(Boolean).join(' · '), byName: s.byName, cancelled: s.cancelled })),
    ...chart.observations.map((o) => ({
      id: o.id,
      at: o.at,
      kind: 'Observations',
      words: [o.hr != null && `pulse ${o.hr}`, o.sbp != null && `BP ${o.sbp}/${o.dbp}`, o.spo2 != null && `SpO2 ${o.spo2}%`].filter(Boolean).join(' · '),
      shock: o.shock,
      byName: o.byName,
      cancelled: o.cancelled,
    })),
  ];
  return rows.sort((a, b) => new Date(a.at) - new Date(b.at));
}

function StartDialog({ patient, admissionId, onDone, onCancel }) {
  const [at, setAt] = useState(nowLocal);
  const [causes, setCauses] = useState([]);
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api('/pph', { method: 'POST', body: { clientRequestId: requestId, patientId: patient.id, admissionId, recognisedAt: iso(at), causes } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="pph-start" title="Start a PPH chart" submitLabel="Start the chart" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <Field label="When the bleeding was recognised" id="pph-rec" error={error?.fields?.recognisedAt}>
        <DateTimeInput id="pph-rec" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <CauseBoxes value={causes} onChange={setCauses} />
    </FormDialog>
  );
}

function CauseBoxes({ value, onChange, disabled = false }) {
  return (
    <fieldset className="fieldset">
      <legend>Cause, if known (the four Ts)</legend>
      <div className="check-grid">
        {Object.entries(PPH_CAUSES).map(([k, w]) => (
          <label key={k} className="check">
            <input type="checkbox" disabled={disabled} checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} /> {w}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LineForm({ chart, onSaved }) {
  const [kind, setKind] = useState('loss');
  const [f, setF] = useState({ at: nowLocal(), ml: '', method: 'measured', key: 'help', dose: '', route: '', note: '', hr: '', sbp: '', dbp: '', spo2: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const fe = (k) => error?.fields?.[k];
  const medicine = PPH_STEPS.find((s) => s.key === f.key)?.medicine;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body =
      kind === 'loss'
        ? { type: 'loss', at: iso(f.at), ml: f.ml, method: f.method }
        : kind === 'step'
          ? { type: 'step', at: iso(f.at), key: f.key, dose: medicine ? f.dose : '', route: medicine ? f.route : '', note: f.note }
          : { type: 'obs', at: iso(f.at), hr: f.hr, sbp: f.sbp, dbp: f.dbp, spo2: f.spo2 };
    try {
      await api(`/pph/${chart.id}/lines`, { method: 'POST', body });
      setF({ ...f, at: nowLocal(), ml: '', dose: '', route: '', note: '', hr: '', sbp: '', dbp: '', spo2: '' });
      setError(null);
      onSaved();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  return (
    <form className="stack" onSubmit={save}>
      <ShowChoice
        label="What to add"
        options={[
          ['loss', 'Blood loss'],
          ['step', 'Step taken'],
          ['obs', 'Observations'],
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setError(null);
        }}
      />
      <Alert type="error">{error?.message}</Alert>
      <div className="form-grid">
        <Field label="Time" id="pph-at" error={fe('at')}>
          <DateTimeInput id="pph-at" value={f.at} onChange={set('at')} />
        </Field>
        {kind === 'loss' && (
          <>
            <Field label="Amount (mL)" id="pph-ml" error={fe('ml')}>
              <input id="pph-ml" inputMode="numeric" value={f.ml} onChange={set('ml')} />
            </Field>
            <Field label="How" id="pph-method" error={fe('method')}>
              <select id="pph-method" value={f.method} onChange={set('method')}>
                {Object.entries(LOSS_METHODS).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {kind === 'step' && (
          <>
            <Field label="Step" id="pph-key" error={fe('key')}>
              <select id="pph-key" value={f.key} onChange={set('key')}>
                {PPH_STEPS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            {medicine && (
              <>
                <Field label="Dose given" id="pph-dose" error={fe('dose')}>
                  <input id="pph-dose" maxLength={60} value={f.dose} onChange={set('dose')} />
                </Field>
                <Field label="Route (optional)" id="pph-route" error={fe('route')}>
                  <input id="pph-route" maxLength={40} value={f.route} onChange={set('route')} />
                </Field>
              </>
            )}
            <Field label={f.key === 'other' ? 'What was done' : 'Note (optional)'} id="pph-note" error={fe('note')}>
              <input id="pph-note" maxLength={300} value={f.note} onChange={set('note')} />
            </Field>
          </>
        )}
        {kind === 'obs' && (
          <>
            <Field label="Pulse (/min)" id="pph-hr" error={fe('hr')}>
              <input id="pph-hr" inputMode="numeric" value={f.hr} onChange={set('hr')} />
            </Field>
            <Field label="Systolic BP (mmHg)" id="pph-sbp" error={fe('sbp')}>
              <input id="pph-sbp" inputMode="numeric" value={f.sbp} onChange={set('sbp')} />
            </Field>
            <Field label="Diastolic BP (mmHg)" id="pph-dbp" error={fe('dbp')}>
              <input id="pph-dbp" inputMode="numeric" value={f.dbp} onChange={set('dbp')} />
            </Field>
            <Field label="SpO2 (%)" id="pph-spo2" error={fe('spo2')}>
              <input id="pph-spo2" inputMode="numeric" value={f.spo2} onChange={set('spo2')} />
            </Field>
          </>
        )}
      </div>
      {kind === 'step' && medicine && <p className="hint">Type the dose that was given. Perinexa does not give doses – use the hospital&apos;s protocol or a verified formulary row.</p>}
      <div className="row">
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? 'Saving…' : 'Add to the chart'}
        </button>
      </div>
    </form>
  );
}

function ReasonDialog({ title, path, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(path, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="pph-reason" title={title} submitLabel="Mark as entered in error" onSubmit={submit} onCancel={onCancel}>
      <p>It stays on the chart, struck through, with your reason.</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Why" id="pph-why" error={error?.fields?.reason}>
        <input id="pph-why" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function CloseDialog({ chart, onDone, onCancel }) {
  const [f, setF] = useState({ result: '', at: nowLocal(), note: '' });
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/pph/${chart.id}/close`, { method: 'POST', body: { ...f, at: iso(f.at) } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="pph-close" title="Close the PPH chart" submitLabel="Close the chart" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <Field label="How it ended" id="pph-result" error={error?.fields?.result}>
        <select id="pph-result" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
          <option value="">Choose…</option>
          {Object.entries(PPH_OUTCOMES).map(([k, w]) => (
            <option key={k} value={k}>
              {w}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Time" id="pph-cat" error={error?.fields?.at}>
        <DateTimeInput id="pph-cat" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />
      </Field>
      <Field label={f.result === 'other' ? 'How it ended' : 'Note (optional)'} id="pph-cnote" error={error?.fields?.note}>
        <input id="pph-cnote" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </FormDialog>
  );
}

function OneChart({ chart, access, reload }) {
  const [dialog, setDialog] = useState(null); // { kind: 'line' | 'chart' | 'close', line? }
  const [problem, setProblem] = useState(null);
  const open = chart.status === 'open' && !chart.cancelled;
  const canWrite = access.write && open;
  const loss = lossBand(chart.totalLossMl);
  const done = () => {
    setDialog(null);
    reload();
  };
  const setCauses = async (causes) => {
    try {
      await api(`/pph/${chart.id}/causes`, { method: 'POST', body: { causes } });
      setProblem(null);
      reload();
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <div className={`pph-chart stack ${chart.cancelled ? 'ca-empty' : ''}`.trim()}>
      <div className="item-editor-head">
        <strong>{`Recognised ${formatDateTime(chart.recognisedAt)}`}</strong>
        <span className="row">
          {chart.cancelled ? (
            <StatusPill tone="inactive">{`Entered in error: ${chart.cancelled.reason}`}</StatusPill>
          ) : chart.status === 'closed' ? (
            <StatusPill tone="stable" icon={CircleCheck}>{`Closed – ${PPH_OUTCOMES[chart.outcome?.result] ?? ''}`}</StatusPill>
          ) : (
            <StatusPill tone="due" icon={Droplet}>
              Open
            </StatusPill>
          )}
        </span>
      </div>
      <Alert type="error">{problem}</Alert>
      <div className="ca-cats pph-sum">
        <div className="ca-cat">
          <span className="ca-cat-label">Blood loss so far</span>
          <span className="ca-cat-value">{`${chart.totalLossMl} mL`}</span>
          {loss && (
            <StatusPill tone={LOOK[loss.band].tone} icon={LOOK[loss.band].icon}>
              {loss.words}
            </StatusPill>
          )}
        </div>
        <div className="ca-cat">
          <span className="ca-cat-label">Latest shock index (pulse ÷ systolic BP)</span>
          <span className="ca-cat-value">{chart.shock ? chart.shock.value : '–'}</span>
          {chart.shock && (
            <StatusPill tone={LOOK[chart.shock.band].tone} icon={LOOK[chart.shock.band].icon}>
              {chart.shock.band === 'red' ? '1.4 or more – urgent' : chart.shock.band === 'yellow' ? '0.9 or more – watch closely' : 'Under 0.9'}
            </StatusPill>
          )}
        </div>
      </div>
      <CauseBoxes value={chart.causes} onChange={setCauses} disabled={!canWrite} />
      {canWrite && <LineForm chart={chart} onSaved={reload} />}
      <div className="an-table-wrap">
        <table className="ca-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">What</th>
              <th scope="col">Details</th>
              <th scope="col">Typed by</th>
            </tr>
          </thead>
          <tbody>
            {timeline(chart).map((r) => (
              <tr key={r.id} className={r.cancelled ? 'ca-empty' : undefined}>
                <td data-label="Time">{formatDateTime(r.at)}</td>
                <td data-label="What">{r.kind}</td>
                <td data-label="Details">
                  {r.cancelled ? <s>{r.words}</s> : r.words}
                  {r.shock && !r.cancelled && (
                    <>
                      {' '}
                      <StatusPill tone={LOOK[r.shock.band].tone} icon={LOOK[r.shock.band].icon}>{`Shock index ${r.shock.value} · ${LOOK[r.shock.band].word}`}</StatusPill>
                    </>
                  )}
                  {r.cancelled && <span className="ca-group-words">{`Entered in error: ${r.cancelled.reason}`}</span>}
                </td>
                <td data-label="Typed by">
                  {r.byName}
                  {canWrite && !r.cancelled && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ kind: 'line', line: r })}>
                      Entered in error
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chart.outcome && <p>{`How it ended: ${PPH_OUTCOMES[chart.outcome.result]}, ${formatDateTime(chart.outcome.at)}${chart.outcome.note ? ` – ${chart.outcome.note}` : ''} (${chart.outcome.byName})`}</p>}
      {open && (
        <div className="row">
          {access.close && (
            <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'close' })}>
              Close the chart
            </button>
          )}
          {access.write && (
            <button type="button" className="btn btn-link" onClick={() => setDialog({ kind: 'chart' })}>
              Chart started by mistake
            </button>
          )}
        </div>
      )}
      {dialog?.kind === 'line' && <ReasonDialog title="Mark this line as entered in error" path={`/pph/${chart.id}/lines/${dialog.line.id}/cancel`} onDone={done} onCancel={() => setDialog(null)} />}
      {dialog?.kind === 'chart' && <ReasonDialog title="Mark this PPH chart as entered in error" path={`/pph/${chart.id}/cancel`} onDone={done} onCancel={() => setDialog(null)} />}
      {dialog?.kind === 'close' && <CloseDialog chart={chart} onDone={done} onCancel={() => setDialog(null)} />}
    </div>
  );
}

export function PphChartSection({ patient, admissionId }) {
  const skip = patient.careType === 'newborn';
  const { data, error, reload } = useFetch(skip ? null : '/pph', { patientId: patient.id, admissionId });
  const [starting, setStarting] = useState(false);
  if (skip) return null;
  const hasOpen = data?.charts.some((c) => c.status === 'open' && !c.cancelled);
  return (
    <section className="card" aria-labelledby="pph-title">
      <div className="item-editor-head">
        <h2 id="pph-title">PPH chart</h2>
        {data?.access.start && !hasOpen && (
          <button type="button" className="btn btn-secondary" onClick={() => setStarting(true)}>
            Start a PPH chart
          </button>
        )}
      </div>
      <Alert type="error">{error}</Alert>
      {data && !data.charts.length && <p className="muted">No PPH chart on this stay. Start one when heavy bleeding is recognised, or to type in the paper chart afterwards.</p>}
      <div className="stack">
        {(data?.charts ?? []).map((c) => (
          <OneChart key={c.id} chart={c} access={data.access} reload={reload} />
        ))}
      </div>
      <p className="muted small">{`DRAFT until the Lead Obstetrician replaces it with the manual's chart (OBG-F-07). Source: ${PPH_SOURCE}.`}</p>
      {starting && (
        <StartDialog
          patient={patient}
          admissionId={admissionId}
          onCancel={() => setStarting(false)}
          onDone={() => {
            setStarting(false);
            reload();
          }}
        />
      )}
    </section>
  );
}
