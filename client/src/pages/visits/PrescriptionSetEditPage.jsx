import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB } from '../../platform/modules.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { CARE_TYPES, CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { MedicineRows } from './MedicineRows.jsx';
import { MEDICINES } from './medicines.js';
import { emptyRow, rowProblems, toItem, toRow } from './rxRows.js';

// Writing a ready-made prescription set (Feature 8b, doctors): its name, which types of care it is for, notes for
// doctors, the medicines (the same rows as the Prescription tab), general instructions, tests advised and advice.
// A new set, or a change, is saved as a draft that a doctor approves.

const TEXT_KEYS = ['name', 'about', 'notes', 'investigations', 'advice'];
const NAMES = [...new Set(MEDICINES.map((m) => m.name))];
const blank = { name: '', about: '', careTypes: [], notes: '', investigations: '', advice: '' };

export function PrescriptionSetEditPage() {
  const { id } = useParams(); // none: a new set
  const isNew = !id;
  const { activeMembership } = useAuth();
  const navigate = useNavigate();
  const { data, error: loadError } = useFetch(isNew ? null : `/prescription-sets/${id}`);
  const [form, setForm] = useState(isNew ? blank : null);
  const [rows, setRows] = useState(isNew ? [emptyRow()] : []);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.set && !form) {
      const s = data.set;
      setForm({ name: s.name, about: s.about, careTypes: s.careTypes, notes: s.notes, investigations: s.investigations, advice: s.advice });
      setRows(s.items.map(toRow));
    }
  }, [data, form]);

  const s = data?.set ?? null;
  const crumbs = [
    KNOWLEDGE_CRUMB,
    { label: 'Prescription sets', to: '/prescription-sets' },
    ...(s ? [{ label: s.name, to: `/prescription-sets/${s.id}` }] : []),
    { label: isNew ? 'New set' : 'Edit' },
  ];
  const title = isNew ? 'New prescription set' : `Edit: ${s?.name ?? ''}`;
  const canEdit = isNew ? hasRole(activeMembership, 'doctor') : s?.canEdit;

  if (loadError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Edit prescription set" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{loadError}</Alert>
            <p>
              <Link to="/prescription-sets">Back to prescription sets</Link>
            </p>
          </div>
        </div>
      </>
    );
  }
  if (!form) return <FullPageSpinner />;
  if (!canEdit) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title={title} />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="warning">Only doctors can add or change prescription sets.</Alert>
            <p>
              <Link to={s ? `/prescription-sets/${s.id}` : '/prescription-sets'}>Back</Link>
            </p>
          </div>
        </div>
      </>
    );
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleCare = (t) =>
    setForm({ ...form, careTypes: form.careTypes.includes(t) ? form.careTypes.filter((x) => x !== t) : CARE_TYPES.filter((x) => x === t || form.careTypes.includes(x)) });

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    const local = rowProblems(rows);
    for (const k of TEXT_KEYS) if (mentionsFetalSex(form[k])) local[k] = PCPNDT_MESSAGE;
    if (!form.name.trim()) local.name = 'Give the set a name';
    if (!rows.length && !form.notes.trim() && !form.investigations.trim() && !form.advice.trim()) local.items = 'Add at least one medicine, or tests or advice';
    if (Object.keys(local).length) {
      setFields(local);
      setError('Please check the highlighted fields.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setFields({});
    setSaving(true);
    const body = { ...form, items: rows.map(toItem) };
    try {
      const res = isNew
        ? await api('/prescription-sets', { method: 'POST', body })
        : await api(`/prescription-sets/${s.id}`, { method: 'PUT', body: { ...body, version: s.version } });
      navigate(`/prescription-sets/${res.set.id}`, {
        state: { flash: `Saved as draft version ${res.set.version}. A doctor must check and approve it; until then it is marked as a draft when it is added to a prescription.` },
      });
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const rowErrors = Object.keys(fields).filter((k) => k.startsWith('items.')).length;

  return (
    <>
      <PageHeader breadcrumbs={crumbs} title={title} subtitle="Saving makes a draft version. A doctor approves it before it is used without the Draft mark." />
      <form className="pf-content form-page rxs-editor" onSubmit={save} noValidate>
        <Alert type="error">{error && `${error}${rowErrors ? ` ${rowErrors} problem${rowErrors > 1 ? 's' : ''} in the medicines below.` : ''}`}</Alert>

        <section className="card form-section">
          <h2>About the set</h2>
          <Field label="Name" id="rxs-name" error={fields.name} hint="e.g. Anaemia in pregnancy (mild to moderate)">
            <input id="rxs-name" maxLength={120} value={form.name} onChange={set('name')} />
          </Field>
          <fieldset className="fieldset">
            <legend>For which types of care</legend>
            <div className="check-grid">
              {CARE_TYPES.map((t) => (
                <label key={t} className="check" htmlFor={`rxs-care-${t}`}>
                  <input id={`rxs-care-${t}`} type="checkbox" checked={form.careTypes.includes(t)} onChange={() => toggleCare(t)} />
                  <span>{CARE_TYPE_SHORT[t]}</span>
                </label>
              ))}
            </div>
            <p className="hint help">Offered first for these patients. Tick none for every type of care.</p>
          </fieldset>
          <Field label="Notes for doctors (not printed)" id="rxs-about" error={fields.about} hint="When to use it, the guidance it follows, what to check.">
            <textarea id="rxs-about" rows={3} maxLength={1000} value={form.about} onChange={set('about')} />
          </Field>
        </section>

        <section className="card vs-section" aria-labelledby="rxs-meds-title">
          <h2 id="rxs-meds-title">Medicines</h2>
          <p className="hint help">As they will be written on the prescription. Each row's title shows how it prints.</p>
          {fields.items && <Alert type="error">{fields.items}</Alert>}
          {rows.length === 0 && <p className="muted">No medicines. A set can also hold only tests and advice.</p>}
          <MedicineRows rows={rows} setRows={setRows} fieldError={(i, k) => fields[`items.${i}.${k}`]} names={NAMES} />
          <Field label="General instructions (optional)" id="rxs-notes" error={fields.notes} hint="Printed under the medicines.">
            <textarea id="rxs-notes" rows={2} maxLength={1000} value={form.notes} onChange={set('notes')} />
          </Field>
        </section>

        <section className="card form-section">
          <h2>Added to Visit details</h2>
          <Field label="Tests advised (optional)" id="rxs-tests" error={fields.investigations}>
            <textarea id="rxs-tests" rows={2} maxLength={1000} value={form.investigations} onChange={set('investigations')} />
          </Field>
          <Field label="Advice for the patient (optional)" id="rxs-advice" error={fields.advice} hint="Printed as written – in English, or in Marathi or Hindi if you write it so.">
            <textarea id="rxs-advice" rows={4} maxLength={2000} value={form.advice} onChange={set('advice')} />
          </Field>
        </section>

        <div className="sticky-actions">
          <button type="button" className="btn btn-link" onClick={() => setRows((r) => [...r, emptyRow()])} disabled={rows.length >= 20}>
            <Plus aria-hidden="true" /> Add medicine
          </button>
          <span className="grow" />
          <Link to={s ? `/prescription-sets/${s.id}` : '/prescription-sets'} className="btn btn-link">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Save the set' : 'Save as new draft'}
          </button>
        </div>
      </form>
    </>
  );
}
