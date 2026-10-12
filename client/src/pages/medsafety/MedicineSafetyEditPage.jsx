import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { AdvancedFields, Alert, Field, FieldError } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB } from '../../platform/modules.js';
import { EditorHead, UnitInput } from '../careplans/TemplateEditPage.jsx';
import { DOSE_UNITS } from './doseCheck.js';
import { MedSafetyPill } from './MedicineSafetyPanel.jsx';
import { KIND_LABELS } from './medSafety.js';

const str = (v) => (v == null ? '' : String(v));
let counter = 0;
// Names are edited as one line, separated by commas.
const toText = (terms) => (terms ?? []).join(', ');
const toTerms = (text) =>
  text
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
const toRow = (e) => ({
  ...e,
  terms: toText(e.terms),
  otherTerms: toText(e.otherTerms),
  fromWeek: str(e.fromWeek),
  toWeek: str(e.toWeek),
  maxAgeDays: str(e.maxAgeDays),
  doseUnit: e.doseUnit || 'mg',
  maxSingle: str(e.maxSingle),
  maxDaily: str(e.maxDaily),
  perKg: Boolean(e.perKg),
  message: e.message ?? '',
  source: e.source ?? '',
});
// Only the fields of the entry's own type are sent (the server keeps the same rule).
const toEntry = (r) => {
  const isDose = r.kind === 'dose';
  return {
    key: r.key.trim(),
    kind: r.kind,
    label: r.label,
    terms: toTerms(r.terms),
    otherTerms: r.kind === 'combination' ? toTerms(r.otherTerms) : [],
    level: isDose ? 'caution' : r.level,
    fromWeek: r.kind === 'medicine' ? r.fromWeek : null,
    toWeek: r.kind === 'medicine' ? r.toWeek : null,
    maxAgeDays: r.kind === 'newborn' || (isDose && r.perKg) ? r.maxAgeDays : null,
    doseUnit: isDose ? r.doseUnit : '',
    maxSingle: isDose ? r.maxSingle : null,
    maxDaily: isDose ? r.maxDaily : null,
    perKg: isDose ? r.perKg : false,
    message: r.message,
    source: r.source,
  };
};
const newRow = () => ({
  key: `med_${Date.now().toString(36)}_${(counter += 1)}`,
  kind: 'medicine',
  label: '',
  terms: '',
  otherTerms: '',
  level: 'caution',
  fromWeek: '',
  toWeek: '',
  maxAgeDays: '',
  doseUnit: 'mg',
  maxSingle: '',
  maxDaily: '',
  perKg: false,
  message: '',
  source: '',
});

// A number with a longer unit after it ("mg/kg", "days").
function WideUnitInput({ unit, ...props }) {
  return (
    <span className="cp-unit-input ms-unit-wide">
      <input {...props} />
      <span className="cp-unit" aria-hidden="true">
        {unit}
      </span>
    </span>
  );
}

export function MedicineSafetyEditPage() {
  const navigate = useNavigate();
  const { data, error: loadError } = useFetch('/medicine-safety');
  const [edited, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.list && !edited) setRows(data.list.entries.map(toRow));
  }, [data, edited]);
  // The entries being edited – straight from the list for the moment before they are kept above.
  const rows = edited ?? (data?.list ? data.list.entries.map(toRow) : null);

  const crumbs = [KNOWLEDGE_CRUMB, { label: 'Clinical rules', to: '/care-plans/red-flags' }, { label: 'Medicine safety', to: '/medicine-safety' }, { label: 'Edit' }];
  if (loadError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Edit the medicine safety list" />
        <div className="pf-content">
          <Alert type="error">{loadError}</Alert>
        </div>
      </>
    );
  }
  if (!rows) return <FullPageSpinner />;
  const list = data.list;
  if (!list.canEdit) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Edit the medicine safety list" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="warning">Only doctors can change the medicine safety list.</Alert>
            <Link to="/medicine-safety">Back to the list</Link>
          </div>
        </div>
      </>
    );
  }

  const setField = (i, key) => (e) => setRows(rows.map((r, k) => (k === i ? { ...r, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } : r)));
  const fr = (i, f) => fieldErrors[`entries.${i}.${f}`];
  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await api('/medicine-safety', { method: 'PUT', body: { version: list.version, entries: rows.map(toEntry) } });
      navigate('/medicine-safety', { state: { flash: `Saved as draft version ${res.list.version}. A doctor must approve it.` } });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  const problems = Object.keys(fieldErrors).filter((k) => k.startsWith('entries.')).length;

  return (
    <>
      <PageHeader breadcrumbs={crumbs} title="Edit the medicine safety list" subtitle="Saving creates a new draft version that a doctor must approve." />
      <form className="pf-content form-page template-editor" onSubmit={save} noValidate>
        <Alert type="error">{error && `${error}${problems ? ` ${problems} problem${problems > 1 ? 's' : ''} in the entries below.` : ''}`}</Alert>
        <div className="section-header">
          <h2>
            Entries <span className="tabular">({rows.length})</span>
          </h2>
          <button type="button" className="btn btn-secondary" onClick={() => setRows([...rows, newRow()])}>
            <Plus aria-hidden="true" /> Add entry
          </button>
        </div>
        <p className="hint help cp-section-hint">
          Names: generic and brand names, separated by commas. A name matches at the start of a word in what the doctor types (“losartan” matches “Tab.
          Losartan 50 mg”). Leave the weeks empty for the whole pregnancy. The type says who an entry is for: a pregnant patient, a postnatal patient who is
          breastfeeding, or a baby in newborn care. A dose limit is the usual maximum of one dose and of a whole day; for a baby it is per kg of body weight, and
          can be for the first days of life only.
        </p>
        {rows.map((r, i) => {
          const hasError = Object.keys(fieldErrors).some((k) => k.startsWith(`entries.${i}.`));
          return (
            <section key={i} className={`card item-editor ${hasError ? 'item-editor-error' : ''}`}>
              <EditorHead label={`Entry ${i + 1}`} noun="entry" hasError={hasError} badge={<MedSafetyPill level={r.kind === 'dose' ? 'dose' : r.level} />}>
                <button type="button" className="icon-btn icon-danger" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={`Remove entry ${i + 1}`}>
                  <Trash2 aria-hidden="true" />
                </button>
              </EditorHead>
              <div className="item-grid">
                <div className="span-2">
                  <Field label="Name shown in the warning" id={`ml-${i}`} error={fr(i, 'label')}>
                    <input id={`ml-${i}`} value={r.label} onChange={setField(i, 'label')} maxLength={120} />
                  </Field>
                </div>
                <Field label="Type" id={`mk-${i}`} error={fr(i, 'kind')}>
                  <select id={`mk-${i}`} value={r.kind} onChange={setField(i, 'kind')}>
                    {Object.entries(KIND_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                {r.kind === 'dose' ? (
                  <Field label="Unit" id={`mu-${i}`} error={fr(i, 'doseUnit')}>
                    <select id={`mu-${i}`} value={r.doseUnit} onChange={setField(i, 'doseUnit')}>
                      {DOSE_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Level" id={`mv-${i}`} error={fr(i, 'level')} hint="Avoid asks the doctor for a reason to go ahead. Caution does not.">
                    <select id={`mv-${i}`} value={r.level} onChange={setField(i, 'level')}>
                      <option value="avoid">Avoid</option>
                      <option value="caution">Caution</option>
                    </select>
                  </Field>
                )}
                <div className="span-2">
                  <Field label={r.kind === 'combination' ? 'First medicine: names' : 'Names'} id={`mt-${i}`} error={fr(i, 'terms')}>
                    <input id={`mt-${i}`} value={r.terms} onChange={setField(i, 'terms')} />
                  </Field>
                </div>
                {r.kind === 'combination' && (
                  <div className="span-2">
                    <Field label="Second medicine: names" id={`mo-${i}`} error={fr(i, 'otherTerms')}>
                      <input id={`mo-${i}`} value={r.otherTerms} onChange={setField(i, 'otherTerms')} />
                    </Field>
                  </div>
                )}
                {r.kind === 'medicine' && (
                  <>
                    <Field label="From week" id={`mfw-${i}`} error={fr(i, 'fromWeek')}>
                      <UnitInput unit="w" id={`mfw-${i}`} inputMode="numeric" value={r.fromWeek} onChange={setField(i, 'fromWeek')} maxLength={2} />
                    </Field>
                    <Field label="To week" id={`mtw-${i}`} error={fr(i, 'toWeek')}>
                      <UnitInput unit="w" id={`mtw-${i}`} inputMode="numeric" value={r.toWeek} onChange={setField(i, 'toWeek')} maxLength={2} />
                    </Field>
                  </>
                )}
                {r.kind === 'newborn' && (
                  <Field label="Only up to this age" id={`mad-${i}`} error={fr(i, 'maxAgeDays')} hint="In days. Leave empty for any age in newborn care.">
                    <WideUnitInput unit="days" id={`mad-${i}`} inputMode="numeric" value={r.maxAgeDays} onChange={setField(i, 'maxAgeDays')} maxLength={3} />
                  </Field>
                )}
                {r.kind === 'dose' && (
                  <>
                    <Field label="Maximum for one dose" id={`mds-${i}`} error={fr(i, 'maxSingle')} hint="Leave empty if only the day’s total is limited.">
                      <WideUnitInput unit={`${r.doseUnit}${r.perKg ? '/kg' : ''}`} id={`mds-${i}`} inputMode="decimal" value={r.maxSingle} onChange={setField(i, 'maxSingle')} maxLength={8} />
                    </Field>
                    <Field label="Maximum for a day" id={`mdd-${i}`} error={fr(i, 'maxDaily')}>
                      <WideUnitInput unit={`${r.doseUnit}${r.perKg ? '/kg' : ''}`} id={`mdd-${i}`} inputMode="decimal" value={r.maxDaily} onChange={setField(i, 'maxDaily')} maxLength={8} />
                    </Field>
                    <div className="span-2">
                      <label className="checkbox">
                        <input type="checkbox" checked={r.perKg} onChange={setField(i, 'perKg')} />
                        <span>
                          For a baby: per kg of body weight. Checked only for newborn-care patients with a recorded weight. Without this tick the limit is for adults.
                        </span>
                      </label>
                      <FieldError>{fr(i, 'perKg')}</FieldError>
                    </div>
                    {r.perKg && (
                      <Field
                        label="Only up to this age"
                        id={`mda-${i}`}
                        error={fr(i, 'maxAgeDays')}
                        hint="In days, for a lower limit in the first days of life (7 = the first week). Leave empty for any age in newborn care. A younger baby is checked against this entry instead of the general one."
                      >
                        <WideUnitInput unit="days" id={`mda-${i}`} inputMode="numeric" value={r.maxAgeDays} onChange={setField(i, 'maxAgeDays')} maxLength={3} />
                      </Field>
                    )}
                  </>
                )}
                <div className="span-2">
                  <Field label="Advice shown to the doctor" id={`mm-${i}`} error={fr(i, 'message')}>
                    <textarea id={`mm-${i}`} rows={2} value={r.message} onChange={setField(i, 'message')} maxLength={500} />
                  </Field>
                </div>
                <AdvancedFields hasError={Boolean(fr(i, 'key') || fr(i, 'source'))}>
                  <Field label="Short code" id={`mc-${i}`} error={fr(i, 'key')}>
                    <input id={`mc-${i}`} value={r.key} onChange={setField(i, 'key')} maxLength={60} />
                  </Field>
                  <Field label="Source" id={`ms-${i}`} error={fr(i, 'source')}>
                    <input id={`ms-${i}`} value={r.source} onChange={setField(i, 'source')} maxLength={400} />
                  </Field>
                </AdvancedFields>
              </div>
            </section>
          );
        })}
        <div className="sticky-actions">
          <button type="button" className="btn btn-link" onClick={() => setRows([...rows, newRow()])}>
            <Plus aria-hidden="true" /> Add entry
          </button>
          <span className="grow" />
          <Link to="/medicine-safety" className="btn btn-link">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save as new draft'}
          </button>
        </div>
      </form>
    </>
  );
}
