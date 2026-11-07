import { useState } from 'react';
import { BadgeCheck, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { ASA, COMORBIDITIES, FASTING, FITNESS, MALLAMPATI, PAC_SOURCE, PLANNED_ANAESTHESIA, fastingHours, pacMissing } from './anaesthesiaRules.js';

// Her pre-anaesthesia check-ups (Clinical Requirements Group B, item 9 – DRAFT until ANA-F-01, F-02 and F-11 replace
// it): ASA grade, airway, conditions, medicines and allergies, fasting, the plan and whether she is fit – written and
// signed in one go by a doctor (the anaesthetist) or an RMO. The latest shows on her theatre case.

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const iso = (v) => (v ? new Date(v).toISOString() : null);
export const FITNESS_LOOK = {
  fit: { tone: 'stable', icon: CircleCheck },
  conditions: { tone: 'watch', icon: CircleAlert },
  defer: { tone: 'high', icon: TriangleAlert },
  unfit: { tone: 'high', icon: TriangleAlert },
};
const EMPTY = () => ({ assessedAt: nowLocal(), procedure: '', asa: '', emergency: false, weightKg: '', airwayMallampati: '', mouthOpeningOk: true, neckMovementOk: true, comorbidities: [], comorbidityNote: '', medicines: '', allergies: '', previousAnaesthesia: '', lastSolidAt: '', lastClearAt: '', investigations: '', plannedAnaesthesia: '', risksExplained: false, fitness: '', fitnessNote: '' });

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

function CancelDialog({ item, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/anaesthesia/pac/${item.id}/cancel`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="pac-cancel" title="Mark the check-up as entered in error" submitLabel="Mark as entered in error" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Why" id="pac-why" error={error?.fields?.reason}>
        <input id="pac-why" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

export function PacTab() {
  const { patient } = useOutletContext();
  const { data, error, reload } = useFetch('/anaesthesia/pac', { patientId: patient.id });
  const [f, setF] = useState(EMPTY);
  const [requestId, setRequestId] = useState(newRequestId);
  const [result, setResult] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const fe = (k) => result?.error?.fields?.[k];
  const fasting = fastingHours(f.assessedAt ? new Date(f.assessedAt) : new Date(), f.lastSolidAt ? new Date(f.lastSolidAt) : null, f.lastClearAt ? new Date(f.lastClearAt) : null);
  const missing = pacMissing(f);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/anaesthesia/pac', { method: 'POST', body: { ...f, clientRequestId: requestId, patientId: patient.id, assessedAt: iso(f.assessedAt), lastSolidAt: iso(f.lastSolidAt), lastClearAt: iso(f.lastClearAt) } });
      setResult({ text: 'Check-up signed.' });
      setF(EMPTY());
      setRequestId(newRequestId());
      reload();
    } catch (err) {
      setResult({ error: err });
    }
  };
  return (
    <div className="stack">
      <Alert type="error">{error ?? result?.error?.message}</Alert>
      {result?.text && (
        <Alert type="success" onClose={() => setResult(null)}>
          {result.text}
        </Alert>
      )}
      {data?.access.write && (
        <section className="card" aria-labelledby="pac-new">
          <h2 id="pac-new">Pre-anaesthesia check-up</h2>
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <Field label="Date and time" id="pac-at" error={fe('assessedAt')}>
                <DateTimeInput id="pac-at" value={f.assessedAt} onChange={set('assessedAt')} />
              </Field>
              <Field label="Operation planned (optional)" id="pac-proc" error={fe('procedure')}>
                <input id="pac-proc" maxLength={300} value={f.procedure} onChange={set('procedure')} />
              </Field>
              <Field label="Weight – kg (optional)" id="pac-wt" error={fe('weightKg')}>
                <input id="pac-wt" inputMode="decimal" value={f.weightKg} onChange={set('weightKg')} />
              </Field>
              <Pick id="pac-asa" label="ASA grade" value={f.asa} onChange={set('asa')} options={ASA} error={fe('asa')} />
              <label className="check">
                <input type="checkbox" checked={f.emergency} onChange={set('emergency')} /> Emergency (E)
              </label>
              <Pick id="pac-mp" label="Airway – Mallampati class" value={f.airwayMallampati} onChange={set('airwayMallampati')} options={MALLAMPATI} error={fe('airwayMallampati')} />
              <label className="check">
                <input type="checkbox" checked={f.mouthOpeningOk} onChange={set('mouthOpeningOk')} /> Mouth opening adequate
              </label>
              <label className="check">
                <input type="checkbox" checked={f.neckMovementOk} onChange={set('neckMovementOk')} /> Neck movement normal
              </label>
            </div>
            <fieldset className="fieldset">
              <legend>Conditions</legend>
              <div className="check-grid">
                {Object.entries(COMORBIDITIES).map(([k, w]) => (
                  <label key={k} className="check">
                    <input type="checkbox" checked={f.comorbidities.includes(k)} onChange={(e) => setF({ ...f, comorbidities: e.target.checked ? [...f.comorbidities, k] : f.comorbidities.filter((x) => x !== k) })} /> {w}
                  </label>
                ))}
              </div>
              {f.comorbidities.includes('other') && (
                <Field label="Other condition" id="pac-other" error={fe('comorbidityNote')}>
                  <input id="pac-other" maxLength={500} value={f.comorbidityNote} onChange={set('comorbidityNote')} />
                </Field>
              )}
            </fieldset>
            <div className="form-grid">
              <Field label="Medicines she takes (optional)" id="pac-meds">
                <input id="pac-meds" maxLength={1000} value={f.medicines} onChange={set('medicines')} />
              </Field>
              <Field label="Allergies (optional)" id="pac-all">
                <input id="pac-all" maxLength={500} value={f.allergies} onChange={set('allergies')} />
              </Field>
              <Field label="Earlier anaesthesia and problems (optional)" id="pac-prev">
                <input id="pac-prev" maxLength={500} value={f.previousAnaesthesia} onChange={set('previousAnaesthesia')} />
              </Field>
              <Field label="Investigations reviewed (optional)" id="pac-inv">
                <input id="pac-inv" maxLength={1000} value={f.investigations} onChange={set('investigations')} />
              </Field>
              <Field label="Last solid food (optional)" id="pac-solid" error={fe('lastSolidAt')}>
                <DateTimeInput id="pac-solid" value={f.lastSolidAt} onChange={set('lastSolidAt')} />
              </Field>
              <Field label="Last clear fluid (optional)" id="pac-clear" error={fe('lastClearAt')}>
                <DateTimeInput id="pac-clear" value={f.lastClearAt} onChange={set('lastClearAt')} />
              </Field>
            </div>
            {(fasting.solid != null || fasting.clear != null) && (
              <p className="hint">
                {[
                  fasting.solid != null && `Solid food ${fasting.solid} h ago${fasting.solidOk ? '' : ` – under the ${FASTING.lightMealHours} h of the fasting guideline`}`,
                  fasting.clear != null && `clear fluid ${fasting.clear} h ago${fasting.clearOk ? '' : ` – under the ${FASTING.clearHours} h of the fasting guideline`}`,
                ]
                  .filter(Boolean)
                  .join('; ')}
              </p>
            )}
            <div className="form-grid">
              <Pick id="pac-plan" label="Planned anaesthesia" value={f.plannedAnaesthesia} onChange={set('plannedAnaesthesia')} options={PLANNED_ANAESTHESIA} error={fe('plannedAnaesthesia')} />
              <Pick id="pac-fit" label="Fitness" value={f.fitness} onChange={set('fitness')} options={FITNESS} error={fe('fitness')} />
              {['conditions', 'defer', 'unfit'].includes(f.fitness) && (
                <Field label="Conditions or reason" id="pac-fnote" error={fe('fitnessNote')}>
                  <input id="pac-fnote" maxLength={1000} value={f.fitnessNote} onChange={set('fitnessNote')} />
                </Field>
              )}
            </div>
            <label className="check">
              <input type="checkbox" checked={f.risksExplained} onChange={set('risksExplained')} /> The anaesthesia and its risks were explained to her
            </label>
            {fe('risksExplained') && <p className="field-error">{fe('risksExplained')}</p>}
            <div className="row">
              <button type="submit" className="btn btn-positive">
                <BadgeCheck aria-hidden="true" /> Sign the check-up
              </button>
              <span className="hint">{Object.keys(missing).length ? `${Object.keys(missing).length} still to fill in` : 'Ready to sign'}</span>
            </div>
          </form>
        </section>
      )}
      <section className="card" aria-labelledby="pac-list">
        <h2 id="pac-list">Her check-ups</h2>
        {data && !data.assessments.length && <p className="muted">No pre-anaesthesia check-up yet.</p>}
        <ul className="plain-list stack">
          {(data?.assessments ?? []).map((p) => {
            const look = FITNESS_LOOK[p.fitness];
            return (
              <li key={p.id} className={p.cancelled ? 'muted' : undefined}>
                <span className="row">
                  {!p.cancelled && (
                    <StatusPill tone={look.tone} icon={look.icon}>
                      {FITNESS[p.fitness]}
                    </StatusPill>
                  )}
                  <strong>{`${formatDateTime(p.assessedAt)} · ASA ${p.asa}${p.emergency ? 'E' : ''} · Mallampati ${p.airwayMallampati} · ${PLANNED_ANAESTHESIA[p.plannedAnaesthesia]}`}</strong>
                  <span className="hint">{`${p.byName} (${p.role})`}</span>
                  {data.access.write && !p.cancelled && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling(p)}>
                      Entered in error
                    </button>
                  )}
                </span>
                {p.fitnessNote && <span className="ca-group-words">{p.fitnessNote}</span>}
                {p.cancelled && <span className="ca-group-words">{`Entered in error: ${p.cancelled.reason}`}</span>}
              </li>
            );
          })}
        </ul>
        <p className="muted small">{`DRAFT until the Lead Anaesthetist replaces it with the manual's forms (ANA-F-01, F-02, F-11). Sources: ${PAC_SOURCE}.`}</p>
      </section>
      {cancelling && (
        <CancelDialog
          item={cancelling}
          onCancel={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
