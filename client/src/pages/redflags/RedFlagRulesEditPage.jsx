import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { AdvancedFields, Alert, Field, FieldError } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB } from '../../platform/modules.js';
import { EditorHead, UnitInput } from '../careplans/TemplateEditPage.jsx';
import { RedFlagPill } from './RedFlagList.jsx';
import { EPISODE_HINT, FACTOR_GROUPS, LOSS_LOCATION_HINT, LOSS_RECORD_HINT, OP_TEXT, READINGS_HINT, RED_FLAG_FACTORS, RULE_CARE_LABELS, RULE_CARE_TYPES, notCheckedText, ruleCareTypes, ruleToSave } from './redFlagFormat.js';

const str = (v) => (v == null ? '' : String(v));
let counter = 0;

// A check as edited: every field kept as text, whatever the factor (switching factor keeps the others).
const toCheckRow = (c) => ({
  factor: c.factor,
  op: c.op ?? 'gte',
  value: str(c.value),
  grade: c.grade ?? RED_FLAG_FACTORS[c.factor]?.order?.[2] ?? '',
  choices: c.choices ?? [],
});
const toRow = (r) => ({
  ...r,
  appliesTo: ruleCareTypes(r),
  message: r.message ?? '',
  source: r.source ?? '',
  fromWeek: str(r.fromWeek),
  toWeek: str(r.toWeek),
  fromDay: str(r.fromDay),
  toDay: str(r.toDay),
  conditions: r.conditions.map(toCheckRow),
});
const newCheck = () => toCheckRow({ factor: 'bpSystolic', op: 'gte', value: '' });
const newRule = (careType = 'antenatal') => ({
  key: `flag_${Date.now().toString(36)}_${(counter += 1)}`,
  label: '',
  level: 'watch',
  appliesTo: [careType],
  message: '',
  fromWeek: '',
  toWeek: '',
  fromDay: '',
  toDay: '',
  source: '',
  conditions: [newCheck()],
});

// A number of days, with room for the unit after it (the unit is also in the field's label, for screen readers).
function DaysInput(props) {
  return (
    <span className="cp-unit-input ms-unit-wide">
      <input {...props} />
      <span className="cp-unit" aria-hidden="true">
        days
      </span>
    </span>
  );
}

// One check of a rule: what to look at, and the value / grade / choices that raise the flag.
// appliesTo: the rule's types of care – a check that does not exist for one of them says so at once.
function CheckEditor({ id, check, appliesTo, errors, onChange, onRemove }) {
  const f = RED_FLAG_FACTORS[check.factor];
  const set = (key) => (e) => onChange({ ...check, [key]: e.target.value });
  const toggle = (choice) => onChange({ ...check, choices: check.choices.includes(choice) ? check.choices.filter((x) => x !== choice) : [...check.choices, choice] });
  return (
    <div className="rf-check">
      <Field label="Check" id={`${id}-f`} error={errors('factor') ?? (notCheckedText(check.factor, appliesTo) || undefined)}>
        <select id={`${id}-f`} value={check.factor} onChange={(e) => onChange(toCheckRow({ ...check, factor: e.target.value, grade: null }))}>
          {FACTOR_GROUPS.map((group) => (
            <optgroup key={group.key} label={group.label}>
              {Object.entries(RED_FLAG_FACTORS)
                .filter(([, x]) => x.group === group.key)
                .map(([k, x]) => (
                  <option key={k} value={k}>
                    {x.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {f.type === 'number' && (
        <>
          <Field label="Comparison" id={`${id}-o`} error={errors('op')}>
            <select id={`${id}-o`} value={check.op} onChange={set('op')}>
              {Object.entries(OP_TEXT).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Value" id={`${id}-v`} error={errors('value')}>
            <UnitInput unit={f.unit} id={`${id}-v`} inputMode="decimal" value={check.value} onChange={set('value')} maxLength={6} />
          </Field>
        </>
      )}
      {f.type === 'grade' && (
        <Field label="This grade or more" id={`${id}-g`} error={errors('grade')}>
          <select id={`${id}-g`} value={check.grade} onChange={set('grade')}>
            {f.order.map((gr) => (
              <option key={gr} value={gr}>
                {gr}
              </option>
            ))}
          </select>
        </Field>
      )}
      {f.type === 'choice' && (
        <fieldset className="fieldset rf-choices">
          <legend>Raised when it is</legend>
          {f.choices.map((choice) => (
            <label key={choice} className="check">
              <input type="checkbox" checked={check.choices.includes(choice)} onChange={() => toggle(choice)} />
              <span>{choice}</span>
            </label>
          ))}
          <FieldError>{errors('choices')}</FieldError>
          {check.factor === 'lossLocation' && <p className="hint">{LOSS_LOCATION_HINT}</p>}
        </fieldset>
      )}
      {onRemove && (
        <button type="button" className="icon-btn rf-check-remove" onClick={onRemove} aria-label="Remove this check">
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function RedFlagRulesEditPage() {
  const navigate = useNavigate();
  const { data, error: loadError } = useFetch('/red-flag-rules');
  const [edited, setRules] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState('all'); // which type of care's rules are listed

  useEffect(() => {
    if (data?.ruleSet && !edited) setRules(data.ruleSet.rules.map(toRow));
  }, [data, edited]);
  // The rules being edited – straight from the rule set for the moment before they are kept above.
  const rules = edited ?? (data?.ruleSet ? data.ruleSet.rules.map(toRow) : null);

  const crumbs = [KNOWLEDGE_CRUMB, { label: 'Clinical rules', to: '/care-plans/red-flags' }, { label: 'Red-flag rules', to: '/care-plans/red-flags' }, { label: 'Edit' }];
  if (loadError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Edit red-flag rules" />
        <div className="pf-content">
          <Alert type="error">{loadError}</Alert>
        </div>
      </>
    );
  }
  if (!rules) return <FullPageSpinner />;
  const rs = data.ruleSet;
  if (!rs.canEdit) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Edit red-flag rules" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="warning">Only doctors can change the red-flag rules.</Alert>
            <Link to="/care-plans/red-flags">Back to the rules</Link>
          </div>
        </div>
      </>
    );
  }

  const update = (i, next) => setRules(rules.map((r, k) => (k === i ? next : r)));
  const setField = (i, key) => (e) => update(i, { ...rules[i], [key]: e.target.value });
  const fr = (i, f) => fieldErrors[`rules.${i}.${f}`];
  const toggleCare = (i, careType) => {
    const r = rules[i];
    const next = r.appliesTo.includes(careType) ? r.appliesTo.filter((t) => t !== careType) : RULE_CARE_TYPES.filter((t) => t === careType || r.appliesTo.includes(t));
    if (show === careType && !next.includes(careType)) setShow('all'); // the rule stays on screen when its listed type is unticked
    update(i, { ...r, appliesTo: next });
  };
  // A new rule is for the type of care being looked at (pregnancy care when all are shown)
  const addRule = () => setRules([...rules, newRule(show === 'all' ? 'antenatal' : show)]);
  const shown = (r) => show === 'all' || r.appliesTo.includes(show);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await api('/red-flag-rules', { method: 'PUT', body: { version: rs.version, rules: rules.map(ruleToSave) } });
      navigate('/care-plans/red-flags', { state: { flash: `Saved as draft version ${res.ruleSet.version}. Red flags are marked as based on draft rules until a doctor approves them.` } });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
      setShow('all'); // a rule with a problem may be of a type of care that is not listed now
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  const problems = Object.keys(fieldErrors).filter((k) => k.startsWith('rules.')).length;

  return (
    <>
      <PageHeader breadcrumbs={crumbs} title="Edit red-flag rules" subtitle="Saving creates a new draft version. A doctor must approve it before the flags stop being marked as draft." />
      <form className="pf-content form-page template-editor" onSubmit={save} noValidate>
        <Alert type="error">{error && `${error}${problems ? ` ${problems} problem${problems > 1 ? 's' : ''} in the rules below.` : ''}`}</Alert>
        <div className="section-header">
          <h2>
            Rules <span className="tabular">({rules.length})</span>
          </h2>
          <button type="button" className="btn btn-secondary" onClick={addRule}>
            <Plus aria-hidden="true" /> Add rule
          </button>
        </div>
        <div className="segmented rf-show" role="group" aria-label="Which rules to list">
          <button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')}>
            All
          </button>
          {RULE_CARE_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={show === t} onClick={() => setShow(t)}>
              {RULE_CARE_LABELS[t]} <span className="tabular">({rules.filter((r) => r.appliesTo.includes(t)).length})</span>
            </button>
          ))}
        </div>
        <p className="hint cp-section-hint">
          A rule raises its flag for patients of the types of care ticked on it, when all its checks are true (up to 3). A check looks at the latest visit, at the lab results of this
          pregnancy or episode of care or, in hospital, at the nursing chart. Weeks of pregnancy and a baby's age can be left empty for any time. {EPISODE_HINT}{' '}
          {READINGS_HINT} {LOSS_RECORD_HINT}
        </p>
        {rules.filter(shown).length === 0 && <p className="muted">No rules for this type of care yet. Add rule starts one.</p>}
        {rules.map((r, i) => {
          if (!shown(r)) return null;
          const hasError = Object.keys(fieldErrors).some((k) => k.startsWith(`rules.${i}.`));
          const pregnancy = r.appliesTo.includes('antenatal');
          const baby = r.appliesTo.includes('newborn');
          return (
            <section key={i} className={`card item-editor ${hasError ? 'item-editor-error' : ''}`}>
              <EditorHead label={`Rule ${i + 1}`} noun="rule" hasError={hasError} badge={<RedFlagPill level={r.level} />}>
                <button type="button" className="icon-btn icon-danger" onClick={() => setRules(rules.filter((_, k) => k !== i))} aria-label={`Remove rule ${i + 1}`}>
                  <Trash2 aria-hidden="true" />
                </button>
              </EditorHead>
              <div className="item-grid">
                <div className="span-2">
                  <Field label="Red flag (what the doctor sees)" id={`rl-${i}`} error={fr(i, 'label')}>
                    <input id={`rl-${i}`} value={r.label} onChange={setField(i, 'label')} maxLength={120} />
                  </Field>
                </div>
                <Field label="Level" id={`rv-${i}`} error={fr(i, 'level')}>
                  <select id={`rv-${i}`} value={r.level} onChange={setField(i, 'level')}>
                    <option value="urgent">Urgent</option>
                    <option value="watch">Watch</option>
                  </select>
                </Field>
              </div>
              <fieldset className="fieldset rf-choices rf-applies">
                <legend>Applies to (types of care)</legend>
                {RULE_CARE_TYPES.map((t) => (
                  <label key={t} className="check">
                    <input type="checkbox" checked={r.appliesTo.includes(t)} onChange={() => toggleCare(i, t)} />
                    <span>{RULE_CARE_LABELS[t]}</span>
                  </label>
                ))}
                <FieldError>{fr(i, 'appliesTo') ?? (r.appliesTo.length ? undefined : 'Tick at least one type of care')}</FieldError>
              </fieldset>
              {(pregnancy || baby) && (
                <div className="item-grid">
                  {pregnancy && (
                    <>
                      <Field label="From week of pregnancy" id={`rfw-${i}`} error={fr(i, 'fromWeek')}>
                        <UnitInput unit="w" id={`rfw-${i}`} inputMode="numeric" value={r.fromWeek} onChange={setField(i, 'fromWeek')} maxLength={2} />
                      </Field>
                      <Field label="To week of pregnancy" id={`rtw-${i}`} error={fr(i, 'toWeek')}>
                        <UnitInput unit="w" id={`rtw-${i}`} inputMode="numeric" value={r.toWeek} onChange={setField(i, 'toWeek')} maxLength={2} />
                      </Field>
                    </>
                  )}
                  {baby && (
                    <>
                      <Field label="From baby's age (days)" id={`rfd-${i}`} error={fr(i, 'fromDay')} hint="Whole days when the value was taken. 0 is the first 24 hours." keepHint>
                        <DaysInput id={`rfd-${i}`} inputMode="numeric" value={r.fromDay} onChange={setField(i, 'fromDay')} maxLength={3} />
                      </Field>
                      <Field label="To baby's age (days)" id={`rtd-${i}`} error={fr(i, 'toDay')} hint="Whole days. Leave empty for no upper age." keepHint>
                        <DaysInput id={`rtd-${i}`} inputMode="numeric" value={r.toDay} onChange={setField(i, 'toDay')} maxLength={3} />
                      </Field>
                    </>
                  )}
                </div>
              )}
              <h3 className="rf-checks-title">Raised when</h3>
              {r.conditions.map((c, j) => (
                <CheckEditor
                  key={j}
                  id={`rc-${i}-${j}`}
                  check={c}
                  appliesTo={r.appliesTo}
                  errors={(f) => fieldErrors[`rules.${i}.conditions.${j}.${f}`]}
                  onChange={(next) => update(i, { ...r, conditions: r.conditions.map((x, k) => (k === j ? next : x)) })}
                  onRemove={r.conditions.length > 1 ? () => update(i, { ...r, conditions: r.conditions.filter((_, k) => k !== j) }) : null}
                />
              ))}
              {fr(i, 'conditions') && <p className="field-error">{fr(i, 'conditions')}</p>}
              {r.conditions.length < 3 && (
                <button type="button" className="btn btn-link rf-add-check" onClick={() => update(i, { ...r, conditions: [...r.conditions, newCheck()] })}>
                  <Plus aria-hidden="true" /> And also…
                </button>
              )}
              <div className="item-grid">
                <div className="span-2">
                  <Field label="What to consider doing" id={`rm-${i}`} error={fr(i, 'message')}>
                    <textarea id={`rm-${i}`} rows={2} value={r.message} onChange={setField(i, 'message')} maxLength={500} />
                  </Field>
                </div>
                <AdvancedFields hasError={Boolean(fr(i, 'key') || fr(i, 'source'))}>
                  <Field label="Short code" id={`rk-${i}`} error={fr(i, 'key')}>
                    <input id={`rk-${i}`} value={r.key} onChange={setField(i, 'key')} maxLength={60} />
                  </Field>
                  <Field label="Guideline source" id={`rs-${i}`} error={fr(i, 'source')}>
                    <input id={`rs-${i}`} value={r.source} onChange={setField(i, 'source')} maxLength={400} />
                  </Field>
                </AdvancedFields>
              </div>
            </section>
          );
        })}
        <div className="sticky-actions">
          <button type="button" className="btn btn-link" onClick={addRule}>
            <Plus aria-hidden="true" /> Add rule
          </button>
          <span className="grow" />
          <Link to="/care-plans/red-flags" className="btn btn-link">
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
