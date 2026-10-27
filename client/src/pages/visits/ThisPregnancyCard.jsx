import { useState } from 'react';
import { Baby, ChevronDown, Save } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, formatDate } from '../../components/ui.jsx';
import { CONCEPTION_LABELS, FOLIC_ACID_LABELS, PLANNED_LABELS, pregnancyDetailLines } from '../patients/historyFormat.js';

// This pregnancy's details, recorded at the visit (docs/HISTORY_SHEET_LAYOUT.md section 1 – the owner's go-ahead of
// 27 Oct 2026): EDD by the dating scan, planned or not, how she conceived, folic acid, medicines taken so far and
// symptoms so far. Kept with the pregnancy on her record (PATCH /api/patients/:id, only the fields changed), so they
// are entered once and seen at every visit. Antenatal care only; changed by those who may change the clinical details.


const day = (v) => (v ? String(v).slice(0, 10) : '');
const valuesOf = (p) => ({
  scanEdd: day(p?.scanEdd),
  planned: p?.planned ?? '',
  conception: p?.conception ?? '',
  folicAcid: p?.folicAcid ?? '',
  medicinesTaken: p?.medicinesTaken ?? '',
  symptoms: p?.symptoms ?? '',
});

const thisPregnancyLines = (p) => [...(p?.scanEdd ? [['EDD by scan', formatDate(p.scanEdd)]] : []), ...pregnancyDetailLines(p)];

function Choice({ id, value, labels, onChange }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not recorded</option>
      {Object.entries(labels).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function ThisPregnancyCard({ patient, page, onSaved }) {
  const stored = valuesOf(patient.pregnancy);
  const [v, setV] = useState(stored);
  const [open, setOpen] = useState(() => thisPregnancyLines(patient.pregnancy).length === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  if (patient.careType !== 'antenatal' || !patient.pregnancy) return null;
  const canEdit = Boolean(patient.access?.canEditClinical && page?.access?.canEdit && page?.visit?.status === 'active');
  const lines = thisPregnancyLines(patient.pregnancy);
  if (!canEdit && !lines.length) return null;
  const set = (k) => (x) => setV({ ...v, [k]: typeof x === 'string' ? x : x.target.value });
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== stored[k]).map(([k, x]) => [k, k === 'scanEdd' ? x || null : x]));
  const save = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api(`/patients/${patient.id}`, { method: 'PATCH', body: { pregnancy: changed } });
      setOpen(false);
      onSaved?.("This pregnancy's details are saved on her record.");
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const fe = (k) => fields[`pregnancy.${k}`];

  return (
    <section className="card vp-pregnancy" aria-labelledby="vp-preg-title">
      <button type="button" className="vp-pregnancy-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Baby aria-hidden="true" />
        <h2 id="vp-preg-title">This pregnancy</h2>
        {!open && lines.length > 0 && <span className="muted vp-pregnancy-sum">{lines.map(([k, x]) => `${k}: ${x}`).join(' · ')}</span>}
        <ChevronDown className={`vp-pregnancy-chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      {open &&
        (canEdit ? (
          <div className="vp-pregnancy-body">
            <Alert type="error">{error}</Alert>
            <div className="form-grid">
              <Field label="EDD by dating scan" id="vp-scanEdd" error={fe('scanEdd')} hint="Used instead of the LMP date when given.">
                <input id="vp-scanEdd" type="date" value={v.scanEdd} onChange={set('scanEdd')} />
              </Field>
              <Field label="Planned pregnancy" id="vp-planned" error={fe('planned')}>
                <Choice id="vp-planned" value={v.planned} labels={PLANNED_LABELS} onChange={set('planned')} />
              </Field>
              <Field label="Conception" id="vp-conception" error={fe('conception')}>
                <Choice id="vp-conception" value={v.conception} labels={CONCEPTION_LABELS} onChange={set('conception')} />
              </Field>
              <Field label="Folic acid" id="vp-folic" error={fe('folicAcid')}>
                <Choice id="vp-folic" value={v.folicAcid} labels={FOLIC_ACID_LABELS} onChange={set('folicAcid')} />
              </Field>
            </div>
            <Field label="Medicines taken so far" id="vp-meds" error={fe('medicinesTaken')}>
              <input id="vp-meds" value={v.medicinesTaken} onChange={set('medicinesTaken')} maxLength={300} />
            </Field>
            <Field label="Symptoms so far" id="vp-symptoms" error={fe('symptoms')}>
              <input id="vp-symptoms" value={v.symptoms} onChange={set('symptoms')} maxLength={300} />
            </Field>
            <button type="button" className="btn btn-secondary" disabled={busy || !Object.keys(changed).length} onClick={save}>
              <Save aria-hidden="true" /> {busy ? 'Saving…' : 'Save these details'}
            </button>
          </div>
        ) : (
          <dl className="details vp-pregnancy-body">
            {lines.map(([k, x]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{x}</dd>
              </div>
            ))}
          </dl>
        ))}
    </section>
  );
}
