// One clinic library entry: what it is for, its approval, and its content – a care plan, rules, a medicine list, a
// form, a test package or a prescription set. Doctors and RMOs change it (any change makes it a draft again);
// doctors approve it. A new entry of a kind the hospital may add opens here empty (/hospital/library/<kind>/new).
import { ArrowLeft, Copy, Pencil, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { libraryApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { CarePlanEditor } from './editors/CarePlanEditor.jsx';
import { FormEditor } from './editors/FormEditor.jsx';
import { MedicineSafetyEditor } from './editors/MedicineSafetyEditor.jsx';
import { PrescriptionSetEditor } from './editors/PrescriptionSetEditor.jsx';
import { RedFlagRulesEditor, RiskRulesEditor, ruleEdits } from './editors/RuleSetEditors.jsx';
import { TestPackageEditor } from './editors/TestPackageEditor.jsx';
import { LibraryFrame } from './LibraryFrame.jsx';
import { EMPTY_CONTENT, INACTIVE_LOOK, careTypesText, entryLook } from './libraryFormat.js';

const EDITORS = {
  care_plan: CarePlanEditor,
  red_flag_rules: RedFlagRulesEditor,
  risk_rules: RiskRulesEditor,
  medicine_safety: MedicineSafetyEditor,
  consent_form: FormEditor,
  information_form: FormEditor,
  test_package: TestPackageEditor,
  prescription_set: PrescriptionSetEditor,
};
const SINGLE = ['red_flag_rules', 'medicine_safety', 'risk_rules'];

// The server's field names ("content.items.3.name") in words.
function errorLines(fields) {
  return Object.entries(fields ?? {}).map(([path, message]) => {
    const m = /^content\.(items|rules|entries|clauses)\.(\d+)\.?(.*)$/.exec(path);
    const words = { items: 'Row', rules: 'Rule', entries: 'Entry', clauses: 'Clause' };
    return m ? `${words[m[1]]} ${Number(m[2]) + 1}: ${message}` : message;
  });
}

// What is sent: the entry's own fields; a rule set as one change per rule.
const bodyOf = (kind, draft) => ({ name: draft.name, careTypes: draft.careTypes, about: draft.about, content: SINGLE.includes(kind) && kind !== 'medicine_safety' ? ruleEdits(kind, draft.content) : draft.content });

export function LibraryEntryPage({ id: givenId }) {
  const params = useParams();
  const id = givenId ?? params.id;
  const isNew = id === 'new';
  const { patients } = useAppConfig();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(isNew);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    if (isNew) {
      const kind = params.kind;
      setData({ entry: { kind, name: '', careTypes: [], about: '', content: EMPTY_CONTENT[kind]?.() ?? {}, status: 'draft', isActive: true, origin: 'hospital' }, kind: { key: kind }, can: { edit: true } });
      setDraft({ name: '', careTypes: [], about: '', content: EMPTY_CONTENT[kind]?.() ?? {} });
      return;
    }
    libraryApi
      .get(id)
      .then((d) => {
        setData(d);
        setDraft({ name: d.entry.name, careTypes: d.entry.careTypes, about: d.entry.about, content: d.entry.content });
      })
      .catch((err) => setError(err.message));
  }, [id, isNew, params.kind]);
  useEffect(load, [load]);

  if (error && !data) return <LibraryFrame><Alert type="error">{error}</Alert></LibraryFrame>;
  if (!data || !draft) return <LibraryFrame><Loader /></LibraryFrame>;
  const { entry, can } = data;
  const kind = entry.kind;
  const Editor = EDITORS[kind];
  if (isNew && !EMPTY_CONTENT[kind]) return <LibraryFrame><Alert type="error">The hospital cannot add its own entry of this kind.</Alert></LibraryFrame>;

  const act = async (action, after) => {
    setBusy(true);
    setError('');
    setErrors([]);
    try {
      const result = await action();
      after?.(result);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
      setErrors(errorLines(err.fields));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    act(
      () => (isNew ? libraryApi.create({ kind, ...bodyOf(kind, draft) }) : libraryApi.update(entry.id, bodyOf(kind, draft))),
      (d) => {
        setEditing(false);
        if (isNew) navigate(`/hospital/library/${kind}/${d.entry.id}`, { replace: true });
        else {
          setData(d);
          setDraft({ name: d.entry.name, careTypes: d.entry.careTypes, about: d.entry.about, content: d.entry.content });
        }
      },
    );
  const cancelEdit = () => {
    if (isNew) navigate(`/hospital/library/${kind}`);
    else {
      setDraft({ name: entry.name, careTypes: entry.careTypes, about: entry.about, content: entry.content });
      setEditing(false);
      setErrors([]);
      setError('');
    }
  };
  const replace = (d) => {
    setData(d);
    setDraft({ name: d.entry.name, careTypes: d.entry.careTypes, about: d.entry.about, content: d.entry.content });
  };
  const toggleCare = (c) => setDraft((d) => ({ ...d, careTypes: d.careTypes.includes(c) ? d.careTypes.filter((x) => x !== c) : [...d.careTypes, c] }));

  const actions = editing ? (
    <>
      <button type="button" className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : isNew ? 'Add as draft' : 'Save as draft'}</button>
    </>
  ) : (
    <>
      {can.edit && <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden /> Change</button>}
      {can.duplicate && (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => libraryApi.duplicate(entry.id), (d) => navigate(`/hospital/library/${kind}/${d.entry.id}`))}>
          <Copy size={16} aria-hidden /> Make a copy
        </button>
      )}
      {can.toggle && !SINGLE.includes(kind) && (
        <button type="button" className="btn btn-link" disabled={busy} onClick={() => act(() => libraryApi.setStatus(entry.id, !entry.isActive), replace)}>
          {entry.isActive ? 'Stop using' : 'Use again'}
        </button>
      )}
      {can.approve && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => libraryApi.approve(entry.id), replace)}>
          <ShieldCheck size={16} aria-hidden /> Approve
        </button>
      )}
    </>
  );

  return (
    <LibraryFrame actions={actions} reloadKey={reloadKey}>
      {!SINGLE.includes(kind) && (
        <Link to={`/hospital/library/${kind}`} className="back-link"><ArrowLeft size={16} aria-hidden /> Back to the list</Link>
      )}
      <div className="entry-head">
        {editing ? (
          <input className="entry-name-input" aria-label="Name" value={draft.name} maxLength={200} placeholder="Name" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        ) : (
          <h2 className="entry-name">{entry.name}</h2>
        )}
        {!isNew && <StateBadge look={entryLook(entry)} />}
        {!entry.isActive && <StateBadge look={INACTIVE_LOOK} />}
        {entry.origin === 'hospital' ? <span className="pill">Own</span> : <span className="pill pill-strong">Built-in DRAFT from Perinexa</span>}
      </div>

      {(error || errors.length > 0) && (
        <Alert type="error">
          {error}
          {errors.map((m) => <div key={m}>{m}</div>)}
        </Alert>
      )}
      {!isNew && entry.status === 'draft' && (
        <Alert type="info">
          A draft is not used for any patient until a doctor approves it.
          {entry.approvedVersionOld && ' It was approved before, then changed – approve it again after checking the changes.'}
        </Alert>
      )}

      <section className="card">
        <div className="grid-2">
          <div>
            <h3>For</h3>
            {editing ? (
              <div className="checkbox-group top-gap-sm">
                {patients.careTypes.map((c) => (
                  <label key={c.key} className={`chip-check${draft.careTypes.includes(c.key) ? ' checked' : ''}`}>
                    <input type="checkbox" checked={draft.careTypes.includes(c.key)} onChange={() => toggleCare(c.key)} />
                    {c.label}
                  </label>
                ))}
                <span className="muted small">None ticked = every type of care.</span>
              </div>
            ) : (
              <p>{careTypesText(entry.careTypes, patients.careTypes)}</p>
            )}
            {!isNew && (
              <p className="muted small">
                Version {entry.version}
                {entry.approved && ` · approved by ${entry.approved.by}, ${formatDateTime(entry.approved.at)}`}
                {entry.updatedBy && ` · last changed by ${entry.updatedBy}, ${formatDateTime(entry.updatedAt)}`}
              </p>
            )}
          </div>
          <div>
            <h3>Notes for doctors</h3>
            {editing ? (
              <textarea className="full-textarea" aria-label="Notes for doctors" rows={5} maxLength={5000} value={draft.about} onChange={(e) => setDraft((d) => ({ ...d, about: e.target.value }))} />
            ) : (
              <p className="pre small">{entry.about || '—'}</p>
            )}
          </div>
        </div>
      </section>

      <section className="card list-panel top-gap">
        <Editor content={editing ? draft.content : entry.content} editing={editing} onChange={(content) => setDraft((d) => ({ ...d, content }))} />
      </section>
      {SINGLE.includes(kind) ? (
        <p className="muted small top-gap-sm">
          These rules are decision support for the visits and prescriptions module (next in the plan): they warn, they never decide.
        </p>
      ) : null}
    </LibraryFrame>
  );
}
