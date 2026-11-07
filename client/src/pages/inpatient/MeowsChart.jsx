import { useState } from 'react';
import { ManualPrint } from '../../components/print/ManualPage.jsx';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { AVPU, MEOWS_PARAMETERS, MEOWS_SOURCE, bandOf, meowsResult, toCelsius } from './meowsRules.js';

// The MEOWS chart of a stay (Clinical Requirements Group B, item 8 – DRAFT until OBG-F-05 replaces it): add a set of
// observations – each reading is coloured as it is typed (red, yellow or normal, always with its word and icon); a
// TRIGGER (one red or two yellow) asks whom you told. Below: every set of this stay, newest first.

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const BAND_LOOK = {
  red: { tone: 'high', icon: TriangleAlert, word: 'Red' },
  yellow: { tone: 'watch', icon: CircleAlert, word: 'Yellow' },
  normal: { tone: 'stable', icon: CircleCheck, word: 'Normal' },
};
export const LEVEL_LOOK = {
  trigger: { tone: 'high', icon: TriangleAlert, word: 'Trigger – tell the doctor now' },
  watch: { tone: 'watch', icon: CircleAlert, word: 'Watch – repeat observations sooner' },
  normal: { tone: 'stable', icon: CircleCheck, word: 'No trigger' },
};
const EMPTY = { rr: '', spo2: '', temp: '', tempUnit: 'C', sbp: '', dbp: '', hr: '', avpu: '', escalatedTo: '', note: '' };

/** A reading with its band: the value, and for red or yellow a pill with the word. */
export function Reading({ value, band, unit = '' }) {
  if (value == null || value === '') return <span className="muted">–</span>;
  if (!band || band === 'normal') return <span>{`${value}${unit}`}</span>;
  const look = BAND_LOOK[band];
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {`${value}${unit} · ${look.word}`}
    </StatusPill>
  );
}

function CancelDialog({ entry, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/meows/${entry.id}/cancel`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="mw-cancel" title="Mark as entered in error" submitLabel="Mark as entered in error" onSubmit={submit} onCancel={onCancel}>
      <p>{`The observations of ${formatDateTime(entry.at)} stay on the chart, struck through, with your reason.`}</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Why" id="mw-reason" error={error?.fields?.reason}>
        <input id="mw-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

const BAND_WORDS = { red: 'red', yellow: 'yellow' };
/** One reading as printed: the value, and its band in words when it is not normal (the printout may be black and white). */
const printed = (v, band, unit = '') => (v == null ? '–' : `${v}${unit}${BAND_WORDS[band] ? ` (${BAND_WORDS[band]})` : ''}`);

/** The chart as printed on the manual's page (PX-X-03): oldest first, each band in words. */
export function MeowsPrint({ patient, entries }) {
  return (
    <>
      <h2>{`MEOWS chart · ${patient.fullName} · ${patient.mrn}`}</h2>
      <table className="mp-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            {MEOWS_PARAMETERS.map((p) => (
              <th key={p.key} scope="col">{`${p.label} (${p.unit})`}</th>
            ))}
            <th scope="col">AVPU</th>
            <th scope="col">Result</th>
            <th scope="col">By</th>
          </tr>
        </thead>
        <tbody>
          {[...entries].reverse().map((e) => (
            <tr key={e.id}>
              <td>{formatDateTime(e.at)}</td>
              {MEOWS_PARAMETERS.map((p) => (
                <td key={p.key}>{printed(e.values[p.key], e.bands[p.key])}</td>
              ))}
              <td>{printed(e.values.avpu, e.bands.avpu)}</td>
              <td>{e.cancelled ? `Entered in error: ${e.cancelled.reason}` : [LEVEL_LOOK[e.level].word.split(' – ')[0], e.escalatedTo && `told ${e.escalatedTo}`, e.note].filter(Boolean).join(' · ')}</td>
              <td>{e.byName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function MeowsChart({ patient, admissionId }) {
  const { data, error, reload } = useFetch(patient.careType === 'newborn' ? null : '/meows', { patientId: patient.id, admissionId });
  const [form, setForm] = useState(EMPTY);
  const [at, setAt] = useState(nowLocal);
  const [requestId, setRequestId] = useState(newRequestId);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  if (patient.careType === 'newborn') return null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const tempC = form.temp === '' ? '' : form.tempUnit === 'F' ? toCelsius(form.temp) : Number(form.temp);
  const live = meowsResult({ rr: form.rr, spo2: form.spo2, tempC, sbp: form.sbp, dbp: form.dbp, hr: form.hr, avpu: form.avpu });
  const typed = live.missing.length < 7;
  const fe = (k) => result?.error?.fields?.[k];
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/meows', { method: 'POST', body: { ...form, clientRequestId: requestId, patientId: patient.id, admissionId, at: at ? new Date(at).toISOString() : '' } });
      setResult({ text: `Saved: ${LEVEL_LOOK[res.entry.level].word}.` });
      setForm(EMPTY);
      setAt(nowLocal());
      setRequestId(newRequestId());
      reload();
    } catch (err) {
      setResult({ error: err });
    }
    setBusy(false);
  };
  const latest = data?.latest;
  const num = (k, label, unit) => (
    <Field label={`${label} (${unit})`} id={`mw-${k}`} error={fe(k)}>
      <input id={`mw-${k}`} inputMode="decimal" value={form[k]} onChange={set(k)} />
    </Field>
  );

  return (
    <section className="card" aria-labelledby="mw-title">
      <div className="item-editor-head">
        <h2 id="mw-title">MEOWS chart</h2>
        {latest && (
          <StatusPill tone={LEVEL_LOOK[latest.level].tone} icon={LEVEL_LOOK[latest.level].icon}>
            {`Latest (${formatDateTime(latest.at)}): ${LEVEL_LOOK[latest.level].word}`}
          </StatusPill>
        )}
      </div>
      <Alert type="error">{error ?? result?.error?.message}</Alert>
      {result?.text && (
        <Alert type="success" onClose={() => setResult(null)}>
          {result.text}
        </Alert>
      )}
      {data?.access.write && (
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Time of the observations" id="mw-at" error={fe('at')}>
              <DateTimeInput id="mw-at" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
            {num('rr', 'Respiratory rate', '/min')}
            {num('spo2', 'SpO2', '%')}
            <Field label="Temperature" id="mw-temp" error={fe('temp')}>
              <span className="weight-input">
                <input id="mw-temp" inputMode="decimal" value={form.temp} onChange={set('temp')} />
                <select aria-label="Temperature unit" value={form.tempUnit} onChange={set('tempUnit')}>
                  <option value="C">°C</option>
                  <option value="F">°F</option>
                </select>
              </span>
            </Field>
            {num('sbp', 'Systolic BP', 'mmHg')}
            {num('dbp', 'Diastolic BP', 'mmHg')}
            {num('hr', 'Heart rate', '/min')}
            <Field label="Consciousness (AVPU)" id="mw-avpu" error={fe('avpu')}>
              <select id="mw-avpu" value={form.avpu} onChange={set('avpu')}>
                <option value="">Not recorded</option>
                {Object.entries(AVPU).map(([k, w]) => (
                  <option key={k} value={k}>
                    {`${k} – ${w}`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {typed && (
            <div className="ip-derived" aria-live="polite">
              <p>
                <StatusPill tone={LEVEL_LOOK[live.level].tone} icon={LEVEL_LOOK[live.level].icon}>
                  {LEVEL_LOOK[live.level].word}
                </StatusPill>{' '}
                {`${live.reds} red, ${live.yellows} yellow`}
                {live.missing.length ? ` · not recorded: ${live.missing.map((k) => (k === 'avpu' ? 'AVPU' : MEOWS_PARAMETERS.find((p) => p.key === k).label)).join(', ')}` : ''}
              </p>
              {form.tempUnit === 'F' && form.temp !== '' && <p className="hint">{`${form.temp} °F = ${tempC} °C`}</p>}
            </div>
          )}
          {(live.level === 'trigger' || form.escalatedTo) && (
            <Field label="Whom you told (doctor's name)" id="mw-told" error={fe('escalatedTo')}>
              <input id="mw-told" maxLength={150} value={form.escalatedTo} onChange={set('escalatedTo')} />
            </Field>
          )}
          <Field label="Note (optional)" id="mw-note" error={fe('note')}>
            <input id="mw-note" maxLength={1000} value={form.note} onChange={set('note')} />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-secondary" disabled={busy || !typed}>
              {busy ? 'Saving…' : 'Save the observations'}
            </button>
          </div>
        </form>
      )}
      <h3>Observations of this stay</h3>
      {data?.entries.length > 0 && (
        <div className="row">
          <ManualPrint screen="meows" on={String(data.entries[data.entries.length - 1].at).slice(0, 10)} title="MEOWS chart">
            <MeowsPrint patient={patient} entries={data.entries} />
          </ManualPrint>
        </div>
      )}
      {data && !data.entries.length && <p className="muted">No observations yet.</p>}
      {data?.entries.length > 0 && (
        <div className="an-table-wrap">
          <table className="ca-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                {MEOWS_PARAMETERS.map((p) => (
                  <th key={p.key} scope="col">
                    {`${p.label} (${p.unit})`}
                  </th>
                ))}
                <th scope="col">AVPU</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className={e.cancelled ? 'ca-empty' : undefined}>
                  <td data-label="Time">
                    {formatDateTime(e.at)}
                    <span className="ca-group-words">{e.byName}</span>
                  </td>
                  {MEOWS_PARAMETERS.map((p) => (
                    <td key={p.key} data-label={p.label}>
                      <Reading value={e.values[p.key]} band={e.bands[p.key]} />
                    </td>
                  ))}
                  <td data-label="AVPU">
                    <Reading value={e.values.avpu} band={e.bands.avpu} />
                  </td>
                  <td data-label="Result">
                    {e.cancelled ? (
                      <span>{`Entered in error: ${e.cancelled.reason}`}</span>
                    ) : (
                      <>
                        <StatusPill tone={LEVEL_LOOK[e.level].tone} icon={LEVEL_LOOK[e.level].icon}>
                          {LEVEL_LOOK[e.level].word.split(' – ')[0]}
                        </StatusPill>
                        {e.escalatedTo && <span className="ca-group-words">{`Told ${e.escalatedTo}`}</span>}
                        {e.note && <span className="ca-group-words">{e.note}</span>}
                        {data.access.write && (
                          <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling(e)}>
                            Entered in error
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{`DRAFT until the Lead Obstetrician replaces it with the manual's chart (OBG-F-05). One red or two yellow readings: tell the doctor now. Source: ${MEOWS_SOURCE}.`}</p>
      {cancelling && (
        <CancelDialog
          entry={cancelling}
          onCancel={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

export { bandOf };
