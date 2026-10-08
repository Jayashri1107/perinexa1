// One ward document: read view, or the form of its kind while it is a draft. Dates and times are typed on this
// computer's clock; a baby's sex is asked only in the delivery note (after the birth – PC-PNDT).
import { Plus, Trash2 } from 'lucide-react';
import { BABY_SEX, BREASTFED, DOC_FIELDS, OUTCOME, STILLBIRTH_TYPE, VITAL_FIELDS, YES_NO, emptyBaby, toLocalInput, valueText } from './inpatientFormat.js';
import { DURATION_UNITS, FORMS, FREQUENCIES, ROUTES, TIMINGS, rxLine } from '../visits/visitFormat.js';

const sel = (id, value, onChange, map, placeholder = '—') => (
  <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
    <option value="">{placeholder}</option>
    {Object.entries(map).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
  </select>
);

function Babies({ value = [], onChange, errors }) {
  const set = (i, k, v) => onChange(value.map((b, j) => (j === i ? { ...b, [k]: v } : b)));
  return (
    <div className="babies">
      {value.map((b, i) => (
        <fieldset key={i} className="result-test">
          <legend>Baby {i + 1}</legend>
          <div className="form-field"><label htmlFor={`b${i}-out`}>Outcome *</label>{sel(`b${i}-out`, b.outcome, (v) => set(i, 'outcome', v), OUTCOME, 'Choose…')}</div>
          <div className="form-field"><label htmlFor={`b${i}-sex`}>Sex</label>{sel(`b${i}-sex`, b.sex, (v) => set(i, 'sex', v), BABY_SEX)}</div>
          <div className="form-field"><label htmlFor={`b${i}-wt`}>Weight (g)</label><input id={`b${i}-wt`} inputMode="numeric" value={b.weightGrams ?? ''} onChange={(e) => set(i, 'weightGrams', e.target.value)} /></div>
          <div className="form-field"><label htmlFor={`b${i}-a1`}>Apgar 1 min</label><input id={`b${i}-a1`} inputMode="numeric" value={b.apgar1 ?? ''} onChange={(e) => set(i, 'apgar1', e.target.value)} /></div>
          <div className="form-field"><label htmlFor={`b${i}-a5`}>Apgar 5 min</label><input id={`b${i}-a5`} inputMode="numeric" value={b.apgar5 ?? ''} onChange={(e) => set(i, 'apgar5', e.target.value)} /></div>
          {b.outcome === 'stillbirth' && <div className="form-field"><label htmlFor={`b${i}-st`}>Kind of stillbirth</label>{sel(`b${i}-st`, b.stillbirthType, (v) => set(i, 'stillbirthType', v), STILLBIRTH_TYPE)}</div>}
          {b.outcome === 'live' && <div className="form-field"><label htmlFor={`b${i}-bf`}>Breastfed within 1 hour</label>{sel(`b${i}-bf`, b.breastfedWithinHour, (v) => set(i, 'breastfedWithinHour', v), BREASTFED)}</div>}
          {b.outcome === 'live' && <div className="form-field"><label htmlFor={`b${i}-nicu`}>To NICU / SNCU</label>{sel(`b${i}-nicu`, b.nicu, (v) => set(i, 'nicu', v), YES_NO)}</div>}
          <div className="form-field"><label htmlFor={`b${i}-notes`}>Notes</label><input id={`b${i}-notes`} value={b.notes ?? ''} maxLength={500} onChange={(e) => set(i, 'notes', e.target.value)} /></div>
          <button type="button" className="icon-btn" aria-label={`Remove baby ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
        </fieldset>
      ))}
      {Object.entries(errors).filter(([k]) => k.startsWith('content.babies')).map(([k, m]) => <span key={k} className="field-error block">{m}</span>)}
      <button type="button" className="btn btn-ghost btn-sm" disabled={value.length >= 6} onClick={() => onChange([...value, emptyBaby()])}><Plus size={14} aria-hidden /> Add a baby</button>
    </div>
  );
}

// Medicines on discharge: one row each – medicine, form, strength, dose, how often, food, route, how long.
function Medicines({ value = [], onChange, errors = {} }) {
  const set = (i, k, v) => onChange(value.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const err = (i, k) => errors[`content.medicines.${i}.${k}`];
  return (
    <div className="rx-table-wrap">
      {value.length > 0 && (
        <table className="rx-table">
          <thead>
            <tr><th>Medicine</th><th>Form</th><th>Strength</th><th>Dose</th><th>How often</th><th>Food</th><th>Route</th><th>For</th><th /></tr>
          </thead>
          <tbody>
            {value.map((m, i) => (
              <tr key={i}>
                <td>
                  <input aria-label={`Medicine ${i + 1}`} placeholder="e.g. Paracetamol" value={m.drug ?? ''} onChange={(e) => set(i, 'drug', e.target.value)} className={err(i, 'drug') ? 'has-error' : undefined} />
                  {err(i, 'drug') && <span className="field-error">{err(i, 'drug')}</span>}
                </td>
                <td>{sel(`rx${i}-form`, m.form ?? 'tab', (v) => set(i, 'form', v), Object.fromEntries(Object.entries(FORMS).filter(([k]) => k !== 'other').map(([k, l]) => [k, l.replace('.', '')])), 'Other')}</td>
                <td><input aria-label={`Strength, medicine ${i + 1}`} placeholder="500 mg" value={m.strength ?? ''} maxLength={40} onChange={(e) => set(i, 'strength', e.target.value)} /></td>
                <td><input aria-label={`Dose, medicine ${i + 1}`} placeholder="1 tab" value={m.dose ?? ''} maxLength={40} onChange={(e) => set(i, 'dose', e.target.value)} /></td>
                <td>{sel(`rx${i}-freq`, m.frequency, (v) => set(i, 'frequency', v), Object.fromEntries(Object.entries(FREQUENCIES).filter(([k]) => k !== 'custom')), 'Choose…')}</td>
                <td>{sel(`rx${i}-food`, m.timing ?? '', (v) => set(i, 'timing', v), Object.fromEntries(Object.entries(TIMINGS).filter(([k]) => k !== '')))}</td>
                <td>{sel(`rx${i}-route`, m.route ?? '', (v) => set(i, 'route', v), Object.fromEntries(Object.entries(ROUTES).filter(([k]) => k !== '')))}</td>
                <td className="rx-duration">
                  <input aria-label={`How long, medicine ${i + 1}`} placeholder="5" inputMode="numeric" value={m.durationValue ?? ''} onChange={(e) => set(i, 'durationValue', e.target.value.replace(/\D/g, ''))} />
                  {sel(`rx${i}-unit`, m.durationUnit ?? 'days', (v) => set(i, 'durationUnit', v), Object.fromEntries(Object.entries(DURATION_UNITS).filter(([k]) => k !== '')))}
                </td>
                <td><button type="button" className="icon-btn" aria-label={`Remove medicine ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="btn btn-ghost btn-sm top-gap-sm" onClick={() => onChange([...value, { drug: '', form: 'tab', strength: '', dose: '1', frequency: '1-0-1', timing: 'after_food', route: 'oral', durationValue: '5', durationUnit: 'days' }])}>
        <Plus size={14} aria-hidden /> Add a medicine
      </button>
    </div>
  );
}

// "content.finalDiagnosis" → "Final diagnosis", "content.medicines.0.drug" → "Medicine 1" – for the list of what to fix.
export function fieldName(kind, key) {
  const k = key.replace(/^content\./, '');
  const med = /^medicines\.(\d+)/.exec(k);
  if (med) return `Medicine ${Number(med[1]) + 1}`;
  return DOC_FIELDS[kind]?.find((f) => f.key === k.split('.')[0])?.label ?? k;
}

// The form of a draft: content → onChange(content).
export function DocumentForm({ kind, content, onChange, errors = {} }) {
  const set = (k) => (v) => onChange({ ...content, [k]: v });
  return (
    <div className="form-grid">
      {DOC_FIELDS[kind].map((f) => {
        if (f.section) return <h3 key={f.section} className="doc-section span-all">{f.section}</h3>;
        const id = `doc-${f.key}`;
        const error = errors[`content.${f.key}`];
        const label = <label htmlFor={id}>{f.label}{f.required && <span className="required" aria-hidden> *</span>}</label>;
        let control;
        if (f.type === 'area') control = <textarea id={id} rows={3} value={content[f.key] ?? ''} onChange={(e) => set(f.key)(e.target.value)} />;
        else if (f.type === 'datetime') control = <input id={id} type="datetime-local" value={toLocalInput(content[f.key])} onChange={(e) => set(f.key)(e.target.value ? new Date(e.target.value).toISOString() : '')} />;
        else if (f.type === 'date') control = <input id={id} type="date" value={content[f.key] ?? ''} onChange={(e) => set(f.key)(e.target.value)} />;
        else if (f.type === 'number') control = <input id={id} inputMode="decimal" value={content[f.key] ?? ''} onChange={(e) => set(f.key)(e.target.value)} />;
        else if (f.type === 'select') control = sel(id, content[f.key], set(f.key), f.options);
        else if (f.type === 'vitals')
          control = (
            <div className="leave-row">
              {VITAL_FIELDS.map(([k, l]) => (
                <input key={k} aria-label={l} placeholder={l} inputMode="decimal" value={content.vitals?.[k] ?? ''} onChange={(e) => set('vitals')({ ...content.vitals, [k]: e.target.value })} />
              ))}
            </div>
          );
        else if (f.type === 'babies') control = <Babies value={content.babies} onChange={set('babies')} errors={errors} />;
        else if (f.type === 'medicines') control = <Medicines value={content.medicines} onChange={set('medicines')} errors={errors} />;
        else control = <input id={id} value={content[f.key] ?? ''} onChange={(e) => set(f.key)(e.target.value)} />;
        const half = ['datetime', 'date', 'number', 'select'].includes(f.type);
        return (
          <div key={f.key} className={`form-field ${half ? 'width-third' : 'width-full'}${error ? ' has-error' : ''}`}>
            {label}
            {control}
            {error && <span className="field-error">{error}</span>}
          </div>
        );
      })}
    </div>
  );
}

// The read view (also printed).
export function DocumentView({ kind, content }) {
  return (
    <dl className="details wide">
      {DOC_FIELDS[kind].filter((f) => !f.section).map((f) => {
        const v = content?.[f.key];
        let shown;
        if (f.type === 'babies') {
          shown = (v ?? []).map((b, i) => (
            <span key={i} className="block">
              Baby {i + 1}: {OUTCOME[b.outcome] ?? '—'}{b.sex && ` · ${BABY_SEX[b.sex]}`}{b.weightGrams && ` · ${b.weightGrams} g`}{b.apgar1 != null && b.apgar1 !== '' && ` · Apgar ${b.apgar1}/${b.apgar5 ?? '–'}`}
              {b.stillbirthType && ` · ${STILLBIRTH_TYPE[b.stillbirthType]}`}{b.breastfedWithinHour && ` · breastfed within 1 h: ${BREASTFED[b.breastfedWithinHour]}`}{b.nicu && ` · NICU: ${YES_NO[b.nicu]}`}{b.notes && ` · ${b.notes}`}
            </span>
          ));
        } else if (f.type === 'medicines') {
          shown = (v ?? []).length ? <ol className="rx-list">{v.map((m, i) => <li key={i}>{rxLine(m)}</li>)}</ol> : '—';
        } else shown = <span className="pre">{valueText(f, v)}</span>;
        return (
          <div key={f.key} className="detail-row">
            <dt>{f.label}</dt>
            <dd>{shown}</dd>
          </div>
        );
      })}
    </dl>
  );
}
