import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { KNOWLEDGE_CRUMB } from '../../platform/modules.js';
import { WHO_WORDS } from './TestPackagesPage.jsx';

// A new test package, or editing one (doctors): its name, whose tests (a baby's or an adult's), for which patients,
// the days of life (babies), and the tests. Saving makes it a new draft version for a doctor to approve.

const EMPTY = { who: 'newborn', name: '', forWhom: '', about: '', fromDay: '0', toDay: '', tests: [] };
const dayValue = (v) => (v === '' || v == null ? null : Number(v));

export function TestPackageEditPage() {
  const { activeMembership } = useAuth();
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const existing = useFetch(isNew ? null : `/lab-packages/${id}`);
  const catalogue = useFetch('/lab/tests');
  const [form, setForm] = useState(isNew ? EMPTY : null);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const p = existing.data?.package;
  const isDoctor = activeMembership.roles.includes('doctor');

  useEffect(() => {
    if (p && !form) setForm({ who: p.who, name: p.name, forWhom: p.forWhom, about: p.about, fromDay: p.fromDay ?? '', toDay: p.toDay ?? '', tests: p.tests });
  }, [p, form]);

  const crumbs = [KNOWLEDGE_CRUMB, { label: 'Test packages', to: '/test-packages' }, ...(p ? [{ label: p.name, to: `/test-packages/${p.id}` }] : []), { label: isNew ? 'New' : 'Edit' }];
  if (existing.error && !p) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Package not found" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{existing.error}</Alert>
          </div>
        </div>
      </>
    );
  }
  if (!form || !catalogue.data) return <FullPageSpinner />;
  if (!isDoctor) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title={isNew ? 'New test package' : `Edit: ${p.name}`} />
        <div className="pf-content">
          <Alert type="warning">Only doctors can add or change test packages.</Alert>
        </div>
      </>
    );
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const offered = catalogue.data.tests.filter((t) => t.who === form.who);
  const groups = Object.entries(catalogue.data.groups)
    .map(([key, label]) => ({ key, label, tests: offered.filter((t) => t.group === key) }))
    .filter((g) => g.tests.length);
  const toggle = (k) => setForm({ ...form, tests: form.tests.includes(k) ? form.tests.filter((x) => x !== k) : [...form.tests, k] });
  const chooseWho = (who) => setForm({ ...form, who, tests: [], fromDay: who === 'newborn' ? '0' : '', toDay: '' });

  const save = async (e) => {
    e.preventDefault();
    const local = {};
    if (!form.name.trim()) local.name = 'Give the package a name.';
    if (!form.tests.length) local.tests = 'Choose at least one test.';
    for (const k of ['name', 'forWhom', 'about']) if (mentionsFetalSex(form[k])) local[k] = PCPNDT_MESSAGE;
    if (form.who === 'newborn' && form.fromDay === '') local.fromDay = 'Enter the first day of life it fits (0 = the day of birth).';
    if (Object.keys(local).length) {
      setFields(local);
      setError('Please check the highlighted fields.');
      return;
    }
    const body = {
      who: form.who,
      name: form.name.trim(),
      forWhom: form.forWhom.trim(),
      about: form.about.trim(),
      fromDay: form.who === 'newborn' ? dayValue(form.fromDay) : null,
      toDay: form.who === 'newborn' ? dayValue(form.toDay) : null,
      tests: form.tests,
    };
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const res = isNew
        ? await api('/lab-packages', { method: 'POST', body })
        : await api(`/lab-packages/${p.id}`, { method: 'PUT', body: { ...body, version: p.version } });
      navigate(`/test-packages/${res.package.id}`, { state: { flash: `Saved as draft version ${res.package.version}. A doctor approves it before it is used without the draft label.` } });
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader breadcrumbs={crumbs} title={isNew ? 'New test package' : `Edit: ${p.name}`} subtitle="Saving creates a new draft version. A doctor approves it again." />
      <div className="pf-content">
        <form className="card form-card" onSubmit={save} noValidate>
          <Alert type="error">{error}</Alert>
          <fieldset className="fieldset">
            <legend>Whose tests</legend>
            {Object.entries(WHO_WORDS).map(([k, label]) => (
              <label key={k} className="check" htmlFor={`pkg-who-${k}`}>
                <input id={`pkg-who-${k}`} type="radio" name="pkg-who" checked={form.who === k} onChange={() => chooseWho(k)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <Field label="Name" id="pkg-name" error={fields.name} hint='e.g. "Day 2–3 – newborn screening before going home"'>
            <input id="pkg-name" value={form.name} maxLength={120} onChange={set('name')} />
          </Field>
          <Field label="For which patients (optional)" id="pkg-for" error={fields.forWhom} hint={form.who === 'newborn' ? 'Leave empty for every baby.' : 'e.g. "First antenatal visit"'}>
            <input id="pkg-for" value={form.forWhom} maxLength={300} onChange={set('forWhom')} />
          </Field>
          {form.who === 'newborn' && (
            <div className="row">
              <Field label="From day of life" id="pkg-from" error={fields.fromDay} hint="0 = the day of birth">
                <input id="pkg-from" type="number" min={0} max={3650} value={form.fromDay} onChange={set('fromDay')} />
              </Field>
              <Field label="To day of life (optional)" id="pkg-to" error={fields.toDay} hint="Empty = any later day">
                <input id="pkg-to" type="number" min={0} max={3650} value={form.toDay} onChange={set('toDay')} />
              </Field>
            </div>
          )}
          <fieldset className="fieldset">
            <legend>Tests ({form.tests.length})</legend>
            {fields.tests && <p className="field-error">{fields.tests}</p>}
            {groups.map((g) => (
              <fieldset key={g.key} className="fieldset">
                <legend>{g.label}</legend>
                <div className="check-grid">
                  {g.tests.map((t) => (
                    <label key={t.key} className="check">
                      <input type="checkbox" checked={form.tests.includes(t.key)} onChange={() => toggle(t.key)} /> {t.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </fieldset>
          <Field label="Notes for doctors (optional)" id="pkg-about" error={fields.about}>
            <textarea id="pkg-about" rows={3} value={form.about} maxLength={1000} onChange={set('about')} />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save aria-hidden="true" /> {saving ? 'Saving…' : 'Save as draft'}
            </button>
            <Link to={p ? `/test-packages/${p.id}` : '/test-packages'} className="btn btn-link">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
