import { useState } from 'react';
import { CircleAlert, CircleCheck, Thermometer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { WeightInput } from '../../components/WeightInput.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { WitnessFields, emptyWitness, witnessWords } from '../../components/WitnessFields.jsx';
import { ShowChoice } from '../quality/SimpleTable.jsx';
import { BILI_METHODS, BIRTH_CHECKS, CORD_CLAMPING, DISCHARGE_READY, EXAM_ITEMS, NEWBORN_CARE_SOURCE, NICU_OUTCOMES, NICU_REASONS, NICU_SOURCES, NICU_UNITS, RESUSCITATION } from './newbornCareRules.js';

// A baby's care at birth and on the ward, her bilirubin chart and her NICU / SNCU admissions (Clinical Requirements Group
// B, items 12 and 13 – DRAFT until NEO-F-01, F-02, F-03 and NEO-L-05 replace them). The bilirubin chart shows the
// readings against the hours of age only: the treatment lines come from the manual.

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const iso = (v) => (v ? new Date(v).toISOString() : '');
const words = { yes: 'Yes', no: 'No', na: 'Not applicable', normal: 'Normal', abnormal: 'Not normal' };

function Pick({ id, label, value, onChange, options, error, empty = 'Choose…' }) {
  return (
    <Field label={label} id={id} error={error}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{empty}</option>
        {Object.entries(options).map(([k, w]) => (
          <option key={k} value={k}>
            {w}
          </option>
        ))}
      </select>
    </Field>
  );
}
function useSaver(reload) {
  const [result, setResult] = useState(null);
  const save = async (path, body, ok, after) => {
    try {
      await api(path, { method: 'POST', body });
      setResult({ text: ok });
      after?.();
      reload();
      return true;
    } catch (err) {
      setResult({ error: err });
      return false;
    }
  };
  return { result, setResult, save };
}
function Notice({ result, setResult }) {
  return (
    <>
      <Alert type="error">{result?.error?.message}</Alert>
      {result?.text && (
        <Alert type="success" onClose={() => setResult(null)}>
          {result.text}
        </Alert>
      )}
    </>
  );
}

function BirthSection({ patientId, data, reload }) {
  const live = data.birth.find((b) => !b.cancelled);
  const [f, setF] = useState({ criedAtBirth: '', resuscitation: '', cordClamping: '', checks: {}, temperatureC: '', note: '' });
  const [witness, setWitness] = useState(emptyWitness);
  const { result, setResult, save } = useSaver(reload);
  const fe = (k) => result?.error?.fields?.[k];
  return (
    <section className="card" aria-labelledby="nc-birth">
      <h2 id="nc-birth">At birth</h2>
      <Notice result={result} setResult={setResult} />
      {live ? (
        <dl className="details">
          <div>
            <dt>Cried at birth</dt>
            <dd>{words[live.criedAtBirth]}</dd>
          </div>
          <div>
            <dt>Resuscitation</dt>
            <dd>{RESUSCITATION[live.resuscitation]}</dd>
          </div>
          <div>
            <dt>Cord clamping</dt>
            <dd>{CORD_CLAMPING[live.cordClamping]}</dd>
          </div>
          {BIRTH_CHECKS.map((c) => (
            <div key={c.key}>
              <dt>{c.label}</dt>
              <dd>{words[live.checks?.[c.key]] ?? '–'}</dd>
            </div>
          ))}
          <div>
            <dt>Temperature at one hour</dt>
            <dd>{live.temperatureC != null ? `${live.temperatureC} °C` : '–'}</dd>
          </div>
          {live.note && (
            <div>
              <dt>Note</dt>
              <dd>{live.note}</dd>
            </div>
          )}
          {live.idBandWitness && (
            <div>
              <dt>Identity band</dt>
              <dd>{witnessWords(live.idBandWitness, formatDateTime)}</dd>
            </div>
          )}
          <div>
            <dt>Written by</dt>
            <dd>{`${live.byName}, ${formatDateTime(live.at)}`}</dd>
          </div>
        </dl>
      ) : data.access.write ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save('/newborn-care/birth', { ...f, patientId, ...(f.checks.idBand === 'yes' ? { witness } : {}) }, 'Record at birth saved.');
          }}
        >
          <div className="form-grid">
            <Pick id="nc-cried" label="Cried at birth" value={f.criedAtBirth} onChange={(v) => setF({ ...f, criedAtBirth: v })} options={{ yes: 'Yes', no: 'No' }} error={fe('criedAtBirth')} />
            <Pick id="nc-resus" label="Resuscitation" value={f.resuscitation} onChange={(v) => setF({ ...f, resuscitation: v })} options={RESUSCITATION} error={fe('resuscitation')} />
            <Pick id="nc-cord" label="Cord clamping" value={f.cordClamping} onChange={(v) => setF({ ...f, cordClamping: v })} options={CORD_CLAMPING} error={fe('cordClamping')} />
            <Field label="Temperature at one hour – °C (optional)" id="nc-temp" error={fe('temperatureC')}>
              <input id="nc-temp" inputMode="decimal" value={f.temperatureC} onChange={(e) => setF({ ...f, temperatureC: e.target.value })} />
            </Field>
          </div>
          <div className="dc-items">
            {BIRTH_CHECKS.map((c) => (
              <div key={c.key} className="dc-item">
                <span className="dc-item-label">{c.label}</span>
                <ShowChoice label={c.label} options={[['yes', 'Yes'], ['no', 'No'], ...(c.na ? [['na', 'Not applicable']] : [])]} value={f.checks[c.key] ?? ''} onChange={(v) => setF({ ...f, checks: { ...f.checks, [c.key]: v } })} />
                {fe(`checks.${c.key}`) && <span className="field-error">{fe(`checks.${c.key}`)}</span>}
              </div>
            ))}
          </div>
          <Field label="Note (optional; needed if a step was not done)" id="nc-note" error={fe('note')}>
            <input id="nc-note" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          {f.checks.idBand === 'yes' && <WitnessFields id="nc-wit" value={witness} onChange={setWitness} errors={result?.error?.fields ?? {}} what="The identity band" />}
          <div className="row">
            <button type="submit" className="btn btn-secondary">
              Save the record at birth
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">Not written yet.</p>
      )}
    </section>
  );
}

function ExamSection({ patientId, data, reload }) {
  const [f, setF] = useState({ examinedAt: nowLocal(), weightGrams: '', findings: {}, notes: {}, ready: {}, summary: '' });
  const [open, setOpen] = useState(false);
  const { result, setResult, save } = useSaver(reload);
  const fe = (k) => result?.error?.fields?.[k];
  return (
    <section className="card" aria-labelledby="nc-exam">
      <div className="item-editor-head">
        <h2 id="nc-exam">Examination on the ward</h2>
        {data.access.write && !open && (
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
            New examination
          </button>
        )}
      </div>
      <Notice result={result} setResult={setResult} />
      {open && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await save('/newborn-care/exam', { ...f, patientId, examinedAt: iso(f.examinedAt) }, 'Examination saved.');
            if (ok) {
              setOpen(false);
              setF({ examinedAt: nowLocal(), weightGrams: '', findings: {}, notes: {}, ready: {}, summary: '' });
            }
          }}
        >
          <div className="form-grid">
            <Field label="Examined" id="nc-exat" error={fe('examinedAt')}>
              <DateTimeInput id="nc-exat" value={f.examinedAt} onChange={(e) => setF({ ...f, examinedAt: e.target.value })} />
            </Field>
            <Field label="Weight (optional)" id="nc-exwt" error={fe('weightGrams')}>
              <WeightInput id="nc-exwt" value={f.weightGrams} onChange={(e) => setF({ ...f, weightGrams: e.target.value })} />
            </Field>
          </div>
          <div className="dc-items">
            {EXAM_ITEMS.map((i) => (
              <div key={i.key} className="dc-item">
                <span className="dc-item-label">{i.label}</span>
                <ShowChoice label={i.label} options={[['normal', 'Normal'], ['abnormal', 'Not normal']]} value={f.findings[i.key] ?? ''} onChange={(v) => setF({ ...f, findings: { ...f.findings, [i.key]: v } })} />
                {fe(`findings.${i.key}`) && <span className="field-error">{fe(`findings.${i.key}`)}</span>}
                {f.findings[i.key] === 'abnormal' && (
                  <Field label="What was found" id={`nc-n-${i.key}`} error={fe(`notes.${i.key}`)}>
                    <input id={`nc-n-${i.key}`} maxLength={300} value={f.notes[i.key] ?? ''} onChange={(e) => setF({ ...f, notes: { ...f.notes, [i.key]: e.target.value } })} />
                  </Field>
                )}
              </div>
            ))}
          </div>
          <fieldset className="fieldset">
            <legend>Ready to go home (optional)</legend>
            <div className="dc-items">
              {DISCHARGE_READY.map((i) => (
                <div key={i.key} className="dc-item">
                  <span className="dc-item-label">{i.label}</span>
                  <ShowChoice label={i.label} options={[['yes', 'Yes'], ['no', 'No']]} value={f.ready[i.key] ?? ''} onChange={(v) => setF({ ...f, ready: { ...f.ready, [i.key]: v } })} />
                </div>
              ))}
            </div>
          </fieldset>
          <Field label="Summary (optional)" id="nc-sum">
            <input id="nc-sum" maxLength={1000} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-secondary">
              Save the examination
            </button>
            <button type="button" className="btn btn-link" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!data.exams.length && !open && <p className="muted">No examination yet.</p>}
      <ul className="plain-list stack">
        {data.exams.map((e) => {
          const abnormal = EXAM_ITEMS.filter((i) => e.findings?.[i.key] === 'abnormal');
          return (
            <li key={e.id} className={e.cancelled ? 'muted' : undefined}>
              <span className="row">
                <StatusPill tone={abnormal.length ? 'watch' : 'stable'} icon={abnormal.length ? CircleAlert : CircleCheck}>
                  {abnormal.length ? `${abnormal.length} not normal` : 'All normal'}
                </StatusPill>
                <strong>{`${formatDateTime(e.examinedAt)}${e.weightGrams ? ` · ${e.weightGrams / 1000} kg` : ''}`}</strong>
                <span className="hint">{e.byName}</span>
              </span>
              {abnormal.map((i) => (
                <span key={i.key} className="ca-group-words">{`${i.label}: ${e.notes?.[i.key]}`}</span>
              ))}
              {e.summary && <span className="ca-group-words">{e.summary}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The bilirubin readings against the hours of age: a simple line chart (no treatment lines – they come from the manual). */
export function BiliChart({ readings }) {
  const pts = readings.filter((r) => !r.cancelled && r.hours != null);
  if (!pts.length) return null;
  const W = 520;
  const H = 220;
  const maxH = Math.max(48, ...pts.map((p) => p.hours));
  const maxY = Math.max(15, Math.ceil(Math.max(...pts.map((p) => p.mgdl)) / 5) * 5);
  const x = (h) => 40 + (h / maxH) * (W - 60);
  const y = (v) => H - 30 - (v / maxY) * (H - 50);
  return (
    <svg className="bili-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bilirubin readings: ${pts.map((p) => `${p.mgdl} mg/dL at ${p.hours} hours`).join(', ')}`}>
      <line x1="40" y1={H - 30} x2={W - 20} y2={H - 30} className="bili-axis" />
      <line x1="40" y1="20" x2="40" y2={H - 30} className="bili-axis" />
      {[0, maxY / 2, maxY].map((v) => (
        <text key={v} x="34" y={y(v) + 4} textAnchor="end" className="bili-label">
          {v}
        </text>
      ))}
      {[0, Math.round(maxH / 2), maxH].map((h) => (
        <text key={h} x={x(h)} y={H - 12} textAnchor="middle" className="bili-label">
          {`${h} h`}
        </text>
      ))}
      <polyline points={pts.map((p) => `${x(p.hours)},${y(p.mgdl)}`).join(' ')} className="bili-line" />
      {pts.map((p) => (
        <circle key={p.id} cx={x(p.hours)} cy={y(p.mgdl)} r="4" className={p.method === 'serum' ? 'bili-dot' : 'bili-dot bili-dot-skin'} />
      ))}
    </svg>
  );
}

function BiliSection({ patientId, data, reload }) {
  const [f, setF] = useState({ at: nowLocal(), mgdl: '', method: 'serum', note: '' });
  const { result, setResult, save } = useSaver(reload);
  const fe = (k) => result?.error?.fields?.[k];
  return (
    <section className="card" aria-labelledby="nc-bili">
      <h2 id="nc-bili">Bilirubin</h2>
      <Notice result={result} setResult={setResult} />
      {data.access.write && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            save('/newborn-care/bilirubin', { ...f, patientId, at: iso(f.at) }, 'Bilirubin saved.', () => setF({ ...f, at: nowLocal(), mgdl: '', note: '' }));
          }}
        >
          <Field label="Time" id="nc-bat" error={fe('at')}>
            <DateTimeInput id="nc-bat" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />
          </Field>
          <Field label="Bilirubin – mg/dL" id="nc-bval" error={fe('mgdl')}>
            <input id="nc-bval" inputMode="decimal" value={f.mgdl} onChange={(e) => setF({ ...f, mgdl: e.target.value })} />
          </Field>
          <Pick id="nc-bm" label="How" value={f.method} onChange={(v) => setF({ ...f, method: v })} options={BILI_METHODS} error={fe('method')} />
          <div className="row">
            <button type="submit" className="btn btn-secondary">
              Add the reading
            </button>
          </div>
        </form>
      )}
      <BiliChart readings={data.bilirubin} />
      {data.bilirubin.length > 0 ? (
        <ul className="plain-list">
          {data.bilirubin.map((r) => (
            <li key={r.id} className={r.cancelled ? 'muted' : undefined}>{`${formatDateTime(r.at)} · ${r.hours != null ? `${r.hours} h of age · ` : ''}${r.mgdl} mg/dL (${BILI_METHODS[r.method]}) · ${r.byName}${r.cancelled ? ` · entered in error: ${r.cancelled.reason}` : ''}`}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No bilirubin readings yet.</p>
      )}
      <p className="hint">The chart shows the readings only. Whether a reading needs phototherapy depends on her gestation and risk factors – the treatment lines come from the hospital&apos;s manual.</p>
    </section>
  );
}

function OutcomeDialog({ admission, onDone, onCancel }) {
  const [f, setF] = useState({ result: '', at: nowLocal(), note: '' });
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/newborn-care/nicu/${admission.id}/outcome`, { method: 'POST', body: { ...f, at: iso(f.at) } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="nc-out" title={`How admission ${admission.serial} ended`} submitLabel="Save" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <Pick id="nc-res" label="Outcome" value={f.result} onChange={(v) => setF({ ...f, result: v })} options={NICU_OUTCOMES} error={error?.fields?.result} />
      <Field label="When" id="nc-oat" error={error?.fields?.at}>
        <DateTimeInput id="nc-oat" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />
      </Field>
      <Field label="Note (optional)" id="nc-onote">
        <input id="nc-onote" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </FormDialog>
  );
}

function NicuSection({ patientId, data, reload }) {
  const [f, setF] = useState({ unit: '', source: 'inborn', admittedAt: nowLocal(), reasons: [], reasonNote: '', weightGrams: '', temperatureC: '', gestationWeeks: '' });
  const [requestId, setRequestId] = useState(newRequestId);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(null);
  const { result, setResult, save } = useSaver(reload);
  const fe = (k) => result?.error?.fields?.[k];
  const openStay = data.nicu.find((n) => !n.outcome && !n.cancelled);
  return (
    <section className="card" aria-labelledby="nc-nicu">
      <div className="item-editor-head">
        <h2 id="nc-nicu">NICU or SNCU</h2>
        <span className="row">
          <Link to="/nicu-register" className="btn btn-link">
            The register
          </Link>
          {data.access.write && !openStay && !open && (
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
              Admit to the NICU or SNCU
            </button>
          )}
        </span>
      </div>
      <Notice result={result} setResult={setResult} />
      {open && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await save('/newborn-care/nicu', { ...f, clientRequestId: requestId, patientId, admittedAt: iso(f.admittedAt) }, 'Admitted.');
            if (ok) {
              setOpen(false);
              setRequestId(newRequestId());
            }
          }}
        >
          <div className="form-grid">
            <Pick id="nc-unit" label="Unit" value={f.unit} onChange={(v) => setF({ ...f, unit: v })} options={NICU_UNITS} error={fe('unit')} />
            <Pick id="nc-src" label="Born" value={f.source} onChange={(v) => setF({ ...f, source: v })} options={NICU_SOURCES} error={fe('source')} />
            <Field label="Admitted" id="nc-adm" error={fe('admittedAt')}>
              <DateTimeInput id="nc-adm" value={f.admittedAt} onChange={(e) => setF({ ...f, admittedAt: e.target.value })} />
            </Field>
            <Field label="Weight at admission (optional)" id="nc-awt" error={fe('weightGrams')}>
              <WeightInput id="nc-awt" value={f.weightGrams} onChange={(e) => setF({ ...f, weightGrams: e.target.value })} />
            </Field>
            <Field label="Temperature at admission – °C (optional)" id="nc-atemp" error={fe('temperatureC')}>
              <input id="nc-atemp" inputMode="decimal" value={f.temperatureC} onChange={(e) => setF({ ...f, temperatureC: e.target.value })} />
            </Field>
            <Field label="Weeks of pregnancy at birth (optional)" id="nc-aga" error={fe('gestationWeeks')}>
              <input id="nc-aga" inputMode="numeric" value={f.gestationWeeks} onChange={(e) => setF({ ...f, gestationWeeks: e.target.value })} />
            </Field>
          </div>
          <fieldset className="fieldset">
            <legend>Why</legend>
            {fe('reasons') && <p className="field-error">{fe('reasons')}</p>}
            <div className="check-grid">
              {Object.entries(NICU_REASONS).map(([k, w]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={f.reasons.includes(k)} onChange={(e) => setF({ ...f, reasons: e.target.checked ? [...f.reasons, k] : f.reasons.filter((x) => x !== k) })} /> {w}
                </label>
              ))}
            </div>
            {f.reasons.includes('other') && (
              <Field label="Other reason" id="nc-areason" error={fe('reasonNote')}>
                <input id="nc-areason" maxLength={500} value={f.reasonNote} onChange={(e) => setF({ ...f, reasonNote: e.target.value })} />
              </Field>
            )}
          </fieldset>
          <div className="row">
            <button type="submit" className="btn btn-secondary">
              Admit
            </button>
            <button type="button" className="btn btn-link" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!data.nicu.length && !open && <p className="muted">Not admitted to the NICU or SNCU.</p>}
      <ul className="plain-list stack">
        {data.nicu.map((n) => (
          <li key={n.id} className={n.cancelled ? 'muted' : undefined}>
            <span className="row">
              <StatusPill tone={n.outcome ? (n.outcome.result === 'died' ? 'inactive' : 'stable') : 'due'}>{n.outcome ? NICU_OUTCOMES[n.outcome.result] : 'Admitted now'}</StatusPill>
              <strong>{`No. ${n.serial} · ${NICU_UNITS[n.unit]} · ${formatDateTime(n.admittedAt)}${n.ageHours != null ? ` (${n.ageHours} h of age)` : ''}`}</strong>
              {n.cold && (
                <StatusPill tone="watch" icon={Thermometer}>
                  {`Cold at admission – ${n.temperatureC} °C`}
                </StatusPill>
              )}
              {data.access.outcome && !n.outcome && !n.cancelled && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClosing(n)}>
                  Record how it ended
                </button>
              )}
            </span>
            <span className="ca-group-words">{`${NICU_SOURCES[n.source]} · ${n.reasons.map((r) => NICU_REASONS[r]).join(', ')}${n.reasonNote ? ` – ${n.reasonNote}` : ''}${n.stayDays != null ? ` · ${n.stayDays} days` : ''}`}</span>
          </li>
        ))}
      </ul>
      {closing && (
        <OutcomeDialog
          admission={closing}
          onCancel={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

export function NewbornCareTab() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/newborn-care`, { patientId: id });
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <BirthSection patientId={id} data={data} reload={reload} />
      <ExamSection patientId={id} data={data} reload={reload} />
      <BiliSection patientId={id} data={data} reload={reload} />
      <NicuSection patientId={id} data={data} reload={reload} />
      <p className="muted small">{`DRAFT until the Lead Neonatologist replaces these with the manual's forms (NEO-F-01, F-02, F-03, NEO-L-05). Sources: ${NEWBORN_CARE_SOURCE}.`}</p>
    </div>
  );
}
