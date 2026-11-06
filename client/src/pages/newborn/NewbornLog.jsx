import { useState } from 'react';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { HIGH_RISK_LABELS, RESULTS_FOR, RESULT_LABELS, itemLook } from './newbornFormat.js';

// One baby's screening log and follow-up clinic (Clinical Requirements Group A, item 4): her gestation at birth and
// whether she is high-risk (doctors, RMOs, nurses), the screens with their due dates and results, and the clinic
// visits at corrected age. The coordinator sees the dates and whether each was done, and records attended visits.

const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

function RecordDialog({ patientId, item, kind, onDone, onCancel }) {
  const [status, setStatus] = useState(kind === 'visit' ? 'attended' : 'done');
  const [on, setOn] = useState(today());
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      onDone(await api(`/newborn-follow-up/patients/${patientId}/records`, { method: 'POST', body: { kind, key: item.key, status, on, result: status === 'done' ? result : '', note } }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <FormDialog id="nb-record" title={item.label} submitLabel="Save" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      {kind === 'screen' && (
        <Field label="What happened" id="nb-status" error={fe('status')}>
          <select id="nb-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="done">Done</option>
            <option value="not_needed">Not needed</option>
          </select>
        </Field>
      )}
      <Field label={kind === 'visit' ? 'Attended on' : 'On'} id="nb-on" error={fe('on')}>
        <input id="nb-on" type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value)} />
      </Field>
      {kind === 'screen' && status === 'done' && (
        <Field label="Result" id="nb-result" error={fe('result')}>
          <select id="nb-result" value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">Choose…</option>
            {(RESULTS_FOR[item.key] ?? Object.keys(RESULT_LABELS)).map((r) => (
              <option key={r} value={r}>
                {RESULT_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(kind === 'screen' || status === 'not_needed') && (
        <Field label={status === 'not_needed' ? 'Why it is not needed' : 'Note (optional)'} id="nb-note" error={fe('note')}>
          <textarea id="nb-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
    </FormDialog>
  );
}

function DetailsForm({ baby, reasons, onSaved }) {
  const [weeks, setWeeks] = useState(baby.gestationWeeks == null ? '' : String(baby.gestationWeeks));
  const [days, setDays] = useState(String(baby.gestationDays ?? 0));
  const [highRisk, setHighRisk] = useState(baby.highRisk);
  const [picked, setPicked] = useState(baby.highRiskReasons);
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      onSaved(await api(`/newborn-follow-up/patients/${baby.patientId}`, { method: 'PUT', body: { gestationWeeks: weeks === '' ? null : Number(weeks), gestationDays: Number(days || 0), highRisk, highRiskReasons: highRisk ? picked : [] } }));
      setError(null);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="stack" onSubmit={save}>
      <Alert type="error">{error?.message}</Alert>
      <div className="form-grid">
      <Field label="Weeks of pregnancy at birth" id="nb-weeks" error={error?.fields?.gestationWeeks}>
        <input id="nb-weeks" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
      </Field>
      <Field label="and days (0–6)" id="nb-days" error={error?.fields?.gestationDays}>
        <input id="nb-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={highRisk} onChange={(e) => setHighRisk(e.target.checked)} /> High-risk baby: follow-up clinic at corrected age
      </label>
      {highRisk && (
        <fieldset className="fieldset">
          <legend>Why</legend>
          {error?.fields?.highRiskReasons && <p className="field-error">{error.fields.highRiskReasons}</p>}
          <div className="check-grid">
            {reasons.map((r) => (
              <label key={r} className="check">
                <input type="checkbox" checked={picked.includes(r)} onChange={(e) => setPicked(e.target.checked ? [...picked, r] : picked.filter((x) => x !== r))} /> {HIGH_RISK_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="row">
        <button type="submit" className="btn btn-secondary">
          Save the details
        </button>
      </div>
    </form>
  );
}

function Items({ title, items, kind, canRecord, onRecord }) {
  if (!items.length) return null;
  return (
    <section className="card" aria-labelledby={`nb-${kind}`}>
      <h2 id={`nb-${kind}`}>{title}</h2>
      <ul className="plain-list stack">
        {items.map((x) => {
          const look = itemLook(x);
          return (
            <li key={x.key} className="row">
              <StatusPill tone={look.tone} icon={look.icon}>
                {look.word}
              </StatusPill>
              <span className="grow">
                <strong>{x.label}</strong> · {x.dueOn ? `due ${formatDate(x.dueOn)}` : `from ${formatDate(x.dueFrom)} to ${formatDate(x.dueBy)}`}
                {x.record && <span className="hint">{` · ${formatDate(x.record.on)}, recorded by ${x.record.byName}${x.record.note ? ` – ${x.record.note}` : ''}`}</span>}
              </span>
              {!x.record && canRecord && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRecord(x, kind)}>
                  Record
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function NewbornLog({ patientId }) {
  const { data, error, reload } = useFetch(`/newborn-follow-up/patients/${patientId}`);
  const [recording, setRecording] = useState(null);
  const [notice, setNotice] = useState(null);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <p className="muted">Loading…</p>;
  const { baby, access } = data;
  const done = () => {
    setRecording(null);
    setNotice('Saved.');
    reload();
  };
  return (
    <div className="stack">
      {notice && (
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <section className="card">
        <h2>{`${baby.fullName} · ${baby.mrn}`}</h2>
        <p className="hint">{`Born ${formatDate(baby.birthAt)}${baby.birthWeightGrams ? ` · ${baby.birthWeightGrams / 1000} kg (${baby.birthWeightGrams} g)` : ''}${baby.gestationWeeks != null ? ` · ${baby.gestationWeeks} weeks ${baby.gestationDays ?? 0} days` : ''}${baby.phone ? ` · ${baby.phone}` : ''}${baby.highRisk ? ' · high-risk follow-up' : ''}`}</p>
        {access.write && <DetailsForm baby={baby} reasons={data.highRiskReasons ?? []} onSaved={() => reload()} />}
        <p className="muted small">DRAFT schedule until the Lead Neonatologist confirms it. Source: {data.source}.</p>
      </section>
      <Items title="Screening" items={baby.screens} kind="screen" canRecord={access.write} onRecord={(item, kind) => setRecording({ item, kind })} />
      <Items title="Follow-up clinic (corrected age)" items={baby.visits} kind="visit" canRecord={access.attend} onRecord={(item, kind) => setRecording({ item, kind })} />
      {recording && <RecordDialog patientId={patientId} item={recording.item} kind={recording.kind} onDone={done} onCancel={() => setRecording(null)} />}
    </div>
  );
}
