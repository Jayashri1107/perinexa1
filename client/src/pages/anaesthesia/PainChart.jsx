import { useState } from 'react';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { NAUSEA, PAIN_SOURCE, POSS, painBand, sedationBand } from './anaesthesiaRules.js';

// The pain chart of a stay (Clinical Requirements Group B, item 10 – DRAFT until ANA-F-03 replaces it): the pain score
// (0–10), the sedation score (POSS), nausea and what was done. POSS 3 or 4 asks whom you told; severe pain asks what was
// done. The order sets A–D wait until their formulary rows are verified.

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const LOOK = { red: { tone: 'high', icon: TriangleAlert }, yellow: { tone: 'watch', icon: CircleAlert }, normal: { tone: 'stable', icon: CircleCheck } };
const EMPTY = { score: '', poss: '', nausea: '', action: '', escalatedTo: '' };

export function PainChartSection({ patient, admissionId }) {
  const skip = patient.careType === 'newborn';
  const { data, error, reload } = useFetch(skip ? null : '/anaesthesia/pain', { patientId: patient.id, admissionId });
  const [f, setF] = useState(EMPTY);
  const [at, setAt] = useState(nowLocal);
  const [requestId, setRequestId] = useState(newRequestId);
  const [result, setResult] = useState(null);
  if (skip) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const fe = (k) => result?.error?.fields?.[k];
  const pain = f.score === '' ? null : painBand(Number(f.score));
  const sed = f.poss === '' ? null : sedationBand(Number(f.poss));
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/anaesthesia/pain', { method: 'POST', body: { ...f, clientRequestId: requestId, patientId: patient.id, admissionId, at: at ? new Date(at).toISOString() : '' } });
      setResult({ text: 'Pain score saved.' });
      setF(EMPTY);
      setAt(nowLocal());
      setRequestId(newRequestId());
      reload();
    } catch (err) {
      setResult({ error: err });
    }
  };
  return (
    <section className="card" aria-labelledby="pain-title">
      <h2 id="pain-title">Pain chart</h2>
      <Alert type="error">{error ?? result?.error?.message}</Alert>
      {result?.text && (
        <Alert type="success" onClose={() => setResult(null)}>
          {result.text}
        </Alert>
      )}
      {data?.access.write && (
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Time" id="pain-at" error={fe('at')}>
              <DateTimeInput id="pain-at" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
            <Field label="Pain score (0 no pain – 10 worst)" id="pain-score" error={fe('score')}>
              <select id="pain-score" value={f.score} onChange={set('score')}>
                <option value="">Choose…</option>
                {Array.from({ length: 11 }, (_, i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sedation (POSS) – optional" id="pain-poss" error={fe('poss')}>
              <select id="pain-poss" value={f.poss} onChange={set('poss')}>
                <option value="">Not recorded</option>
                {Object.entries(POSS).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nausea – optional" id="pain-nausea">
              <select id="pain-nausea" value={f.nausea} onChange={set('nausea')}>
                <option value="">Not recorded</option>
                {Object.entries(NAUSEA).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={pain?.band === 'red' ? 'What was done' : 'What was done (optional)'} id="pain-action" error={fe('action')}>
              <input id="pain-action" maxLength={300} value={f.action} onChange={set('action')} />
            </Field>
            {sed?.band === 'red' && (
              <Field label="Whom you told" id="pain-told" error={fe('escalatedTo')}>
                <input id="pain-told" maxLength={150} value={f.escalatedTo} onChange={set('escalatedTo')} />
              </Field>
            )}
          </div>
          {(pain || sed) && (
            <p aria-live="polite" className="row">
              {pain && (
                <StatusPill tone={LOOK[pain.band].tone} icon={LOOK[pain.band].icon}>
                  {pain.words}
                </StatusPill>
              )}
              {sed && (
                <StatusPill tone={LOOK[sed.band].tone} icon={LOOK[sed.band].icon}>
                  {sed.words}
                </StatusPill>
              )}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-secondary">
              Save the pain score
            </button>
          </div>
        </form>
      )}
      {data && !data.entries.length && <p className="muted">No pain scores yet.</p>}
      {data?.entries.length > 0 && (
        <div className="an-table-wrap">
          <table className="ca-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Pain</th>
                <th scope="col">Sedation</th>
                <th scope="col">Nausea</th>
                <th scope="col">What was done</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className={e.cancelled ? 'ca-empty' : undefined}>
                  <td data-label="Time">
                    {formatDateTime(e.at)}
                    <span className="ca-group-words">{e.byName}</span>
                  </td>
                  <td data-label="Pain">
                    <StatusPill tone={LOOK[e.pain.band].tone} icon={LOOK[e.pain.band].icon}>{`${e.score} · ${e.pain.words}`}</StatusPill>
                  </td>
                  <td data-label="Sedation">{e.poss ? <StatusPill tone={LOOK[e.sedation.band].tone} icon={LOOK[e.sedation.band].icon}>{`POSS ${e.poss}`}</StatusPill> : '–'}</td>
                  <td data-label="Nausea">{NAUSEA[e.nausea] ?? '–'}</td>
                  <td data-label="What was done">
                    {e.action || '–'}
                    {e.escalatedTo && <span className="ca-group-words">{`Told ${e.escalatedTo}`}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{`DRAFT until the Lead Anaesthetist replaces it with ANA-F-03. Order sets A–D come once their formulary rows are verified. Source: ${PAIN_SOURCE}.`}</p>
    </section>
  );
}
