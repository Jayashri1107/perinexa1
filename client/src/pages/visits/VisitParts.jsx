// The parts of a visit page: vitals, findings, red flags and corrections. Each part is saved on its own with its
// version, so two people working on the same visit never overwrite each other.
import { Pencil, Siren } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../components/Alert.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { FLAG_LOOKS, MOVEMENTS, OEDEMA, PRESENTATIONS, URINE } from './visitFormat.js';

// One small field of a part's form.
export function Field({ id, label, unit, value, onChange, type = 'number', options, wide, error }) {
  return (
    <div className={`form-field ${wide ? 'width-full' : 'width-third'}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}{unit && <span className="muted"> ({unit})</span>}</label>
      {options ? (
        <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : type === 'textarea' ? (
        <textarea id={id} rows={2} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type={type} inputMode={type === 'number' ? 'decimal' : undefined} step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

const savedText = (part) => (part?.at ? `Saved by ${part.byName}, ${formatDateTime(part.at)}` : 'Not filled in yet');

// A part with a read view and, when allowed, a form; save(values) → the server's answer.
function Part({ title, part, editable, start, children, view, save, onSaved }) {
  const [values, setValues] = useState(null);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setValues((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setFields({});
    try {
      onSaved(await save({ ...values, rev: part.rev }));
      setValues(null);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {editable && !values && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValues(start())}><Pencil size={14} aria-hidden /> {part.at ? 'Change' : 'Fill in'}</button>}
      </div>
      <p className="muted small">{savedText(part)}</p>
      {values ? (
        <form onSubmit={submit} noValidate>
          <Alert type="error">{error}</Alert>
          <div className="form-grid">{children(values, set, fields)}</div>
          <div className="modal-foot inline">
            <button type="button" className="btn btn-ghost" onClick={() => setValues(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : (
        view
      )}
    </section>
  );
}

const show = (v, unit = '') => (v === null || v === undefined || v === '' ? '—' : `${v}${unit ? ` ${unit}` : ''}`);
const VITALS = [
  ['weightKg', 'Weight', 'kg'],
  ['heightCm', 'Height', 'cm'],
  ['bpSystolic', 'BP upper', 'mmHg'],
  ['bpDiastolic', 'BP lower', 'mmHg'],
  ['pulse', 'Pulse', '/min'],
  ['temperatureF', 'Temperature', '°F'],
  ['spo2', 'SpO₂', '%'],
  ['hb', 'Hb', 'g/dL'],
];
const urineOptions = URINE.map((g) => [g, g || '—']);

export function VitalsPart({ visit, editable, save, onSaved }) {
  const v = visit.vitals;
  return (
    <Part
      title="Vitals"
      part={v}
      editable={editable}
      save={save}
      onSaved={onSaved}
      start={() => Object.fromEntries([...VITALS.map(([k]) => [k, v[k] ?? '']), ['urineAlbumin', v.urineAlbumin ?? ''], ['urineSugar', v.urineSugar ?? '']])}
      view={
        <dl className="details wide">
          <dt>BP</dt><dd>{v.bpSystolic != null ? `${v.bpSystolic}/${show(v.bpDiastolic)} mmHg` : '—'}</dd>
          <dt>Weight / height</dt><dd>{show(v.weightKg, 'kg')} · {show(v.heightCm, 'cm')}</dd>
          <dt>Pulse · temp · SpO₂</dt><dd>{show(v.pulse, '/min')} · {show(v.temperatureF, '°F')} · {show(v.spo2, '%')}</dd>
          <dt>Hb</dt><dd>{show(v.hb, 'g/dL')}</dd>
          <dt>Urine</dt><dd>albumin {show(v.urineAlbumin)} · sugar {show(v.urineSugar)}</dd>
        </dl>
      }
    >
      {(values, set, fields) => (
        <>
          {VITALS.map(([k, label, unit]) => <Field key={k} id={`v-${k}`} label={label} unit={unit} value={values[k]} onChange={set(k)} error={fields[k]} />)}
          <Field id="v-ua" label="Urine albumin" value={values.urineAlbumin} onChange={set('urineAlbumin')} options={urineOptions} />
          <Field id="v-us" label="Urine sugar" value={values.urineSugar} onChange={set('urineSugar')} options={urineOptions} />
        </>
      )}
    </Part>
  );
}

const pick = (map) => Object.entries(map);

export function FindingsPart({ visit, careType, editable, isPrescriber, save, onSaved }) {
  const d = visit.details;
  const antenatal = careType === 'antenatal';
  const text = ['complaints', 'examination', 'diagnosis', 'investigations', 'advice'];
  return (
    <Part
      title="Findings and advice"
      part={d}
      editable={editable}
      save={save}
      onSaved={onSaved}
      start={() => ({
        ...Object.fromEntries(text.map((k) => [k, d[k] ?? ''])),
        fundalHeightCm: d.fundalHeightCm ?? '',
        fetalHeartRate: d.fetalHeartRate ?? '',
        presentation: d.presentation ?? '',
        fetalMovements: d.fetalMovements ?? '',
        oedema: d.oedema ?? '',
        privateNote: d.privateNote ?? '',
        nextVisitOn: d.nextVisitOn ?? '',
        nextVisitNote: d.nextVisitNote ?? '',
      })}
      view={
        <dl className="details wide">
          <dt>Complaints</dt><dd className="pre">{show(d.complaints)}</dd>
          {antenatal && (<><dt>Pregnancy check</dt><dd>Fundal height {show(d.fundalHeightCm, 'cm')} · FHR {show(d.fetalHeartRate, '/min')} · {PRESENTATIONS[d.presentation ?? ''] ?? '—'} · movements {MOVEMENTS[d.fetalMovements ?? ''] ?? '—'}</dd></>)}
          <dt>Oedema</dt><dd>{OEDEMA[d.oedema ?? ''] ?? '—'}</dd>
          <dt>Examination</dt><dd className="pre">{show(d.examination)}</dd>
          <dt>Diagnosis</dt><dd className="pre">{show(d.diagnosis)}</dd>
          <dt>Tests advised</dt><dd className="pre">{show(d.investigations)}</dd>
          <dt>Advice</dt><dd className="pre">{show(d.advice)}</dd>
          <dt>Next visit</dt><dd>{d.nextVisitOn ? `${d.nextVisitOn}${d.nextVisitNote ? ` – ${d.nextVisitNote}` : ''}` : '—'}</dd>
          {isPrescriber && (<><dt>Private note</dt><dd className="pre">{show(d.privateNote)}</dd></>)}
        </dl>
      }
    >
      {(values, set, fields) => (
        <>
          <Field id="d-complaints" label="Complaints" type="textarea" wide value={values.complaints} onChange={set('complaints')} />
          {antenatal && (
            <>
              <Field id="d-fh" label="Fundal height" unit="cm" value={values.fundalHeightCm} onChange={set('fundalHeightCm')} error={fields.fundalHeightCm} />
              <Field id="d-fhr" label="Fetal heart rate" unit="/min" value={values.fetalHeartRate} onChange={set('fetalHeartRate')} error={fields.fetalHeartRate} />
              <Field id="d-pres" label="Presentation" value={values.presentation} onChange={set('presentation')} options={pick(PRESENTATIONS)} />
              <Field id="d-fm" label="Fetal movements" value={values.fetalMovements} onChange={set('fetalMovements')} options={pick(MOVEMENTS)} />
            </>
          )}
          <Field id="d-oed" label="Oedema" value={values.oedema} onChange={set('oedema')} options={pick(OEDEMA)} />
          <Field id="d-exam" label="Examination" type="textarea" wide value={values.examination} onChange={set('examination')} />
          <Field id="d-dx" label="Diagnosis" type="textarea" wide value={values.diagnosis} onChange={set('diagnosis')} />
          <Field id="d-inv" label="Tests advised" type="textarea" wide value={values.investigations} onChange={set('investigations')} />
          <Field id="d-adv" label="Advice for the patient" type="textarea" wide value={values.advice} onChange={set('advice')} />
          <Field id="d-next" label="Next visit" type="date" value={values.nextVisitOn} onChange={set('nextVisitOn')} error={fields.nextVisitOn} />
          <Field id="d-nextnote" label="Next visit note" type="text" value={values.nextVisitNote} onChange={set('nextVisitNote')} />
          <Field id="d-private" label="Private note (never printed, not shown to nurses)" type="textarea" wide value={values.privateNote} onChange={set('privateNote')} />
          <p className="muted small span-2">A next visit gets a booking with her doctor that still needs a time; reception gives it one.</p>
        </>
      )}
    </Part>
  );
}

export function RedFlagsCard({ checks }) {
  return (
    <section className={`card${checks.redFlags.length ? ' warn-card' : ''}`}>
      <h2><Siren size={18} aria-hidden /> Red flags</h2>
      {!checks.redFlagRulesApproved && <p className="muted">The red-flag rules are still a draft in the Clinic library: no checks until a doctor approves them.</p>}
      {checks.redFlagRulesApproved && checks.redFlags.length === 0 && <p className="muted">None from the values recorded.</p>}
      <ul className="plain-list flag-list">
        {checks.redFlags.map((f) => (
          <li key={f.key}>
            <StateBadge look={FLAG_LOOKS[f.level]} small /> <strong>{f.label}</strong>
            <span className="block small">{f.message}</span>
            <span className="muted block small">
              From: {f.values.map((v) => `${v.factor} ${v.value} (${v.source}, ${formatDateTime(v.at)})`).join('; ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">Decision support: raised only from values recorded. The doctor decides.</p>
    </section>
  );
}

export function AdditionsCard({ visit, canAdd, add }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  if (!visit.signed) return null;
  return (
    <section className="card">
      <h2>Corrections and additions</h2>
      <p className="muted small">Signed by {visit.signed.byName}, {formatDateTime(visit.signed.at)}. Nothing above can change; corrections are added here.</p>
      <ul className="plain-list rows">
        {visit.additions.map((a) => (
          <li key={a._id ?? a.at}><span className="pre">{a.text}</span><span className="muted small">{a.byName}, {formatDateTime(a.at)}</span></li>
        ))}
      </ul>
      {canAdd && (
        <form
          className="top-gap-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await add(text);
              setText('');
            } catch (err) {
              setError(err.message);
            }
          }}
        >
          <Alert type="error">{error}</Alert>
          <textarea className="full-textarea" aria-label="Correction or addition" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-ghost btn-sm top-gap-sm" disabled={text.trim().length < 2}>Add</button>
        </form>
      )}
    </section>
  );
}
