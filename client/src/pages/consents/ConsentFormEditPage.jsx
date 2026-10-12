import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, Plus, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB } from '../../platform/modules.js';
import { CARE_TYPES, CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { BLANKS, BLANK_LABELS, INFORMATION_RULES, LANGUAGE_LABELS, LANGUAGES, SUGGEST_LABELS, SUGGEST_RULES, blankProblems, kindWords } from './consentFormat.js';

// Editing a consent form (doctors): its title and clauses in English, Marathi and Hindi, which types of care it
// is for, and when it is suggested. Saving makes a new draft version, which a doctor approves again. The blanks
// ({patient} …) are checked here as on the server: the same blanks in every language.

let uid = 0;
const withUid = (c) => ({ uid: (uid += 1), en: c.en ?? '', mr: c.mr ?? '', hi: c.hi ?? '' });
const TEXT_ROWS = { en: 3, mr: 3, hi: 3 };

export function ConsentFormEditPage({ kind = 'consent' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error: loadError } = useFetch(`/consent-forms/${id}`);
  const [form, setForm] = useState(null);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const W = kindWords(data?.form?.kind ?? kind);
  const information = W === kindWords('information');

  useEffect(() => {
    if (data?.form && !form) {
      const f = data.form;
      setForm({ title: { ...f.title }, description: f.description ?? '', careTypes: f.careTypes, suggestWhen: f.suggestWhen, clauses: f.clauses.map(withUid) });
    }
  }, [data, form]);

  const crumbs = (f) => [
    KNOWLEDGE_CRUMB,
    { label: W.plural, to: W.base },
    ...(f ? [{ label: f.title.en, to: `${W.base}/${f.id}` }] : []),
    { label: 'Edit' },
  ];

  if (loadError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs(null)} title={`Edit ${W.one}`} />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{loadError}</Alert>
            <p>
              <Link to={W.base}>Back to {W.many}</Link>
            </p>
          </div>
        </div>
      </>
    );
  }
  if (!form) return <FullPageSpinner />;
  const f = data.form;
  if (!f.canEdit) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs(f)} title={`Edit: ${f.title.en}`} />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="warning">Only doctors can change {W.many}.</Alert>
            <p>
              <Link to={`${W.base}/${f.id}`}>Back to the form</Link>
            </p>
          </div>
        </div>
      </>
    );
  }

  const setTitle = (lang) => (e) => setForm({ ...form, title: { ...form.title, [lang]: e.target.value } });
  const setClause = (i, lang) => (e) => {
    const clauses = [...form.clauses];
    clauses[i] = { ...clauses[i], [lang]: e.target.value };
    setForm({ ...form, clauses });
  };
  const move = (i, d) => {
    const clauses = [...form.clauses];
    const j = i + d;
    if (j < 0 || j >= clauses.length) return;
    [clauses[i], clauses[j]] = [clauses[j], clauses[i]];
    setForm({ ...form, clauses });
    setFieldErrors({}); // the clause numbers in the messages no longer match
  };
  const remove = (i) => {
    setForm({ ...form, clauses: form.clauses.filter((_, k) => k !== i) });
    setFieldErrors({});
  };
  const add = () => setForm({ ...form, clauses: [...form.clauses, withUid({})] });
  const toggleCare = (t) =>
    setForm({ ...form, careTypes: form.careTypes.includes(t) ? form.careTypes.filter((x) => x !== t) : CARE_TYPES.filter((x) => x === t || form.careTypes.includes(x)) });

  const body = () => ({
    version: f.version, // the version this page loaded: a save over someone's newer change is refused
    title: form.title,
    description: form.description,
    careTypes: form.careTypes,
    suggestWhen: form.suggestWhen,
    clauses: form.clauses.map(({ en, mr, hi }) => ({ en, mr, hi })),
  });

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setFlash(null);
    const local = blankProblems(body());
    form.clauses.forEach((c, i) => {
      if (!c.en.trim()) local[`clauses.${i}.en`] = 'Each clause needs its English text (remove the clause if it is not needed).';
    });
    if (!form.title.en.trim()) local['title.en'] = 'The English title is required.';
    if (form.clauses.length === 0) local.clauses = 'A form needs at least one clause.';
    if (Object.keys(local).length) {
      setFieldErrors(local);
      setError('Please check the highlighted fields.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await api(`/consent-forms/${f.id}`, { method: 'PUT', body: body() });
      navigate(`${W.base}/${f.id}`, { state: { flash: `Saved as draft version ${res.form.version}. A doctor must approve it before it prints without the DRAFT label.` } });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const clauseErrors = Object.keys(fieldErrors).filter((k) => k.startsWith('clauses.')).length;

  return (
    <>
      <PageHeader breadcrumbs={crumbs(f)} title={`Edit: ${f.title.en}`} subtitle="Saving creates a new draft version. A doctor must approve it again before it is used with patients." />
      <form className="pf-content form-page cf-editor" onSubmit={save} noValidate>
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error">{error && `${error}${clauseErrors ? ` ${clauseErrors} problem${clauseErrors > 1 ? 's' : ''} in the clauses below.` : ''}`}</Alert>

        <section className="card form-section">
          <h2>Form details</h2>
          {LANGUAGES.map((l) => (
            <Field key={l} label={`Title – ${LANGUAGE_LABELS[l]}${l === 'en' ? '' : ' (optional while drafting)'}`} id={`cf-title-${l}`} error={fieldErrors[`title.${l}`]}>
              <input id={`cf-title-${l}`} lang={l} value={form.title[l]} onChange={setTitle(l)} maxLength={150} />
            </Field>
          ))}
          <fieldset className="fieldset">
            <legend>For which types of care</legend>
            <div className="check-grid">
              {CARE_TYPES.map((t) => (
                <label key={t} className="check" htmlFor={`cf-care-${t}`}>
                  <input id={`cf-care-${t}`} type="checkbox" checked={form.careTypes.includes(t)} onChange={() => toggleCare(t)} />
                  <span>{CARE_TYPE_SHORT[t]}</span>
                </label>
              ))}
            </div>
            <p className="hint help">Tick none for a form for every patient (e.g. admission, refusal of treatment).</p>
          </fieldset>
          <Field label="Suggested for a patient" id="cf-suggest" error={fieldErrors.suggestWhen} hint={`Shown on the patient's ${W.patientTab} tab when this applies. The doctor decides.`}>
            <select id="cf-suggest" value={form.suggestWhen} onChange={(e) => setForm({ ...form, suggestWhen: e.target.value })}>
              {SUGGEST_RULES.filter((r) => !information || INFORMATION_RULES.includes(r) || r === form.suggestWhen).map((r) => (
                <option key={r} value={r}>
                  {SUGGEST_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes for staff (not printed)" id="cf-notes" error={fieldErrors.description}>
            <textarea id="cf-notes" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} />
          </Field>
        </section>

        <section className="card cf-blanks-help" aria-labelledby="cf-blanks-title">
          <h2 id="cf-blanks-title">Blanks</h2>
          <p className="hint help">
            Write these in a clause to fill it in for each patient. Use the same blanks in the English and in the translations. Typed blanks left empty print
            as a line to fill in by hand.
          </p>
          <ul className="plain-list cf-blank-list">
            {BLANKS.map((b) => (
              <li key={b}>
                <code>{`{${b}}`}</code> {BLANK_LABELS[b]}
                {['procedure', 'reason'].includes(b) ? ' (typed when printing)' : ''}
              </li>
            ))}
          </ul>
        </section>

        <h2 className="cf-clauses-title">Clauses</h2>
        <p className="hint help cp-section-hint">Printed as a numbered list, each clause in English beside its Marathi or Hindi translation.</p>
        {fieldErrors.clauses && <Alert type="error">{fieldErrors.clauses}</Alert>}
        {form.clauses.map((c, i) => {
          const hasError = LANGUAGES.some((l) => fieldErrors[`clauses.${i}.${l}`]);
          return (
            <section key={c.uid} className={`card item-editor ${hasError ? 'item-editor-error' : ''}`.trim()} aria-label={`Clause ${i + 1}`}>
              <div className="item-editor-head">
                <span className="item-editor-title">
                  <span className="item-editor-label">Clause {i + 1}</span>
                  {hasError && (
                    <span className="field-error cp-editor-error">
                      <CircleAlert aria-hidden="true" /> Check this clause
                    </span>
                  )}
                </span>
                <div className="row">
                  <button type="button" className="icon-btn" onClick={() => move(i, -1)} aria-label={`Move clause ${i + 1} up`} disabled={i === 0}>
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => move(i, 1)} aria-label={`Move clause ${i + 1} down`} disabled={i === form.clauses.length - 1}>
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn icon-danger" onClick={() => remove(i)} aria-label={`Remove clause ${i + 1}`} disabled={form.clauses.length === 1}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="cf-clause-grid">
                {LANGUAGES.map((l) => (
                  <Field key={l} label={LANGUAGE_LABELS[l]} id={`cf-c${c.uid}-${l}`} error={fieldErrors[`clauses.${i}.${l}`]}>
                    <textarea id={`cf-c${c.uid}-${l}`} lang={l} rows={TEXT_ROWS[l]} value={c[l]} onChange={setClause(i, l)} maxLength={2000} />
                  </Field>
                ))}
              </div>
            </section>
          );
        })}

        <div className="sticky-actions">
          <button type="button" className="btn btn-link" onClick={add} disabled={form.clauses.length >= 40}>
            <Plus aria-hidden="true" /> Add clause
          </button>
          <span className="grow" />
          <Link to={`${W.base}/${f.id}`} className="btn btn-link">
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
