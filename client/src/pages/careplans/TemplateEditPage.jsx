import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { AdvancedFields, Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB } from '../../platform/modules.js';
import { APPLIES_LABELS, ITEM_KIND_LABELS, ITEM_KINDS } from './templateFormat.js';
import { CONDITION_LABELS, PAST_COMPLICATION_LABELS, PREGNANCY_FINDING_LABELS } from '../patients/patientFormat.js';
import { RiskBadge } from '../patients/RiskCard.jsx';
import { NUMBER_FACTORS, OP_LABELS, RISK_FACTOR_LABELS } from '../patients/riskFormat.js';

const str = (v) => (v == null ? '' : String(v));

// A number input with its unit shown inside the box (e.g. "12 w").
export function UnitInput({ unit, ...props }) {
  return (
    <span className="cp-unit-input">
      <input {...props} />
      <span className="cp-unit" aria-hidden="true">
        {unit}
      </span>
    </span>
  );
}

// Card heading for one item or rule: its number, a marker when it has a problem, and the move/remove buttons.
// The problem marker looks like a field error (red text + circle icon), not a status pill, so it can't be
// mistaken for a rule's clinical risk level shown next to it.
export function EditorHead({ label, noun, hasError, badge, children }) {
  return (
    <div className="item-editor-head">
      <span className="item-editor-title">
        <span className="item-editor-label">{label}</span>
        {badge}
        {hasError && (
          <span className="field-error cp-editor-error">
            <CircleAlert aria-hidden="true" /> Check this {noun}
          </span>
        )}
      </span>
      <div className="row">{children}</div>
    </div>
  );
}

// Each item is edited as text; "timing" says which of the three timing styles is used.
function toRow(it) {
  return {
    key: it.key,
    kind: it.kind,
    name: it.name,
    patientText: it.patientText ?? '',
    timing: it.atBooking ? 'booking' : it.after?.key ? 'after' : 'weeks',
    fromWeek: str(it.fromWeek),
    toWeek: str(it.toWeek),
    afterKey: it.after?.key ?? '',
    afterWeeks: str(it.after?.weeks),
    appliesWhen: it.appliesWhen ?? 'always',
    source: it.source ?? '',
  };
}

function toItem(r) {
  return {
    key: r.key.trim(),
    kind: r.kind,
    name: r.name,
    patientText: r.patientText,
    atBooking: r.timing === 'booking',
    fromWeek: r.timing === 'weeks' ? r.fromWeek : null,
    toWeek: r.timing === 'weeks' ? r.toWeek : null,
    after: r.timing === 'after' ? { key: r.afterKey, weeks: r.afterWeeks } : { key: null, weeks: null },
    appliesWhen: r.appliesWhen,
    source: r.source,
  };
}

const toRuleRow = (r) => ({
  key: r.key,
  label: r.label,
  factor: r.factor,
  op: r.op ?? 'gte',
  value: str(r.value),
  condition: r.condition ?? 'diabetes',
  complication: r.complication ?? 'stillbirth_or_neonatal_death',
  finding: r.finding ?? 'gdm',
  level: r.level,
  source: r.source ?? '',
});
const toRule = (r) => ({
  key: r.key.trim(),
  label: r.label,
  factor: r.factor,
  op: NUMBER_FACTORS.includes(r.factor) ? r.op : null,
  value: NUMBER_FACTORS.includes(r.factor) ? r.value : null,
  condition: r.factor === 'condition' ? r.condition : null,
  complication: r.factor === 'pastComplication' ? r.complication : null,
  finding: r.factor === 'finding' ? r.finding : null,
  level: r.level,
  source: r.source,
});

let counter = 0;
const newRow = () => ({
  key: `item_${Date.now().toString(36)}_${(counter += 1)}`,
  kind: 'visit',
  name: '',
  patientText: '',
  timing: 'weeks',
  fromWeek: '',
  toWeek: '',
  afterKey: '',
  afterWeeks: '',
  appliesWhen: 'always',
  source: '',
});

export function TemplateEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error: loadError } = useFetch(`/care-plans/templates/${id}`);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.template && !form) {
      const t = data.template;
      setForm({ name: t.name, description: t.description ?? '', sources: t.sources ?? '', rows: t.items.map(toRow), rules: (t.riskRules ?? []).map(toRuleRow) });
    }
  }, [data, form]);

  const crumbs = (tpl) => [
    KNOWLEDGE_CRUMB,
    { label: 'Care plans', to: '/care-plans/templates' },
    ...(tpl ? [{ label: tpl.name, to: `/care-plans/templates/${tpl.id}` }] : []),
    { label: 'Edit' },
  ];

  if (loadError) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs(null)} title="Edit template" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{loadError}</Alert>
            <p>
              <Link to="/care-plans/templates">Back to templates</Link>
            </p>
          </div>
        </div>
      </>
    );
  }
  if (!form) return <FullPageSpinner />;
  const t = data.template;
  if (!t.canEdit) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs(t)} title={`Edit: ${t.name}`} />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="warning">You can't change this template.</Alert>
            <p>
              <Link to={`/care-plans/templates/${t.id}`}>Back to the template</Link>
            </p>
          </div>
        </div>
      </>
    );
  }

  const setRow = (i, key) => (e) => {
    const rows = [...form.rows];
    rows[i] = { ...rows[i], [key]: e.target.value };
    setForm({ ...form, rows });
  };
  const move = (i, d) => {
    const rows = [...form.rows];
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    setForm({ ...form, rows });
  };
  const remove = (i) => setForm({ ...form, rows: form.rows.filter((_, k) => k !== i) });
  const add = () => setForm({ ...form, rows: [...form.rows, newRow()] });
  const fe = (i, f) => fieldErrors[`items.${i}.${f}`];
  const fr = (i, f) => fieldErrors[`riskRules.${i}.${f}`];
  const setRule = (i, key) => (e) => {
    const rules = [...form.rules];
    rules[i] = { ...rules[i], [key]: e.target.value };
    setForm({ ...form, rules });
  };
  const removeRule = (i) => setForm({ ...form, rules: form.rules.filter((_, k) => k !== i) });
  const addRule = () =>
    setForm({
      ...form,
      rules: [
        ...form.rules,
        { key: `rule_${Date.now().toString(36)}_${(counter += 1)}`, label: '', factor: 'age', op: 'gt', value: '', condition: 'diabetes', complication: 'stillbirth_or_neonatal_death', finding: 'gdm', level: 'high', source: '' },
      ],
    });
  // Risk rules exist only on the hospital standard template (personal protocols don't change risk levels).
  const isAntenatal = t.careType === 'antenatal' && t.kind === 'standard';

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await api(`/care-plans/templates/${t.id}`, {
        method: 'PUT',
        // version: the version this page loaded, so a save over someone else's newer changes is refused.
        body: { version: t.version, name: form.name, description: form.description, sources: form.sources, items: form.rows.map(toItem), ...(isAntenatal ? { riskRules: form.rules.map(toRule) } : {}) },
      });
      const rc = res.recalculated;
      const flash = isAntenatal
        ? `Saved as draft version ${res.template.version}. Risk levels of ${rc?.checked ?? 0} patient(s) were recalculated with these rules (${rc?.changed ?? 0} changed) and are marked as based on draft rules until a doctor approves the template.`
        : `Saved as draft version ${res.template.version}. It must be approved again before use.`;
      navigate(`/care-plans/templates/${t.id}`, { state: { flash } });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const rowErrors = Object.keys(fieldErrors).filter((k) => k.startsWith('items.') || k.startsWith('riskRules.')).length;

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs(t)}
        title={`Edit: ${t.name}`}
        subtitle="Saving creates a new draft version. A doctor must approve it again before it is used for patients."
      />
      <form className="pf-content form-page template-editor" onSubmit={save} noValidate>
        <Alert type="error">{error && `${error}${rowErrors ? ` ${rowErrors} problem${rowErrors > 1 ? 's' : ''} in the ${isAntenatal ? 'items and rules' : 'items'} below.` : ''}`}</Alert>
        {t.ownerDefault && (
          <Alert type="warning">
            This is your default protocol. Saving makes it a draft: until you approve it again, new care plans of your patients start from the hospital standard
            template.
          </Alert>
        )}
        <section className="card form-section">
          <h2>Template details</h2>
          <Field label="Template name" id="t-name" error={fieldErrors.name}>
            <input id="t-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150} />
          </Field>
          <Field label="Description" id="t-desc" error={fieldErrors.description}>
            <textarea id="t-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} />
          </Field>
          <Field label="Guideline sources" id="t-sources" error={fieldErrors.sources}>
            <textarea id="t-sources" rows={2} value={form.sources} onChange={(e) => setForm({ ...form, sources: e.target.value })} maxLength={1000} />
          </Field>
        </section>

        <div className="section-header">
          <h2>
            Items <span className="tabular">({form.rows.length})</span>
          </h2>
          <button type="button" className="btn btn-secondary" onClick={add}>
            <Plus aria-hidden="true" /> Add item
          </button>
        </div>
        {t.careType === 'antenatal' && (
          <p className="hint cp-section-hint">
            An item “for” a finding in this pregnancy (GDM, high blood pressure, twins, low-lying placenta, bleeding) applies once a doctor or RMO has ticked that
            finding on the patient's record. Until then it shows as not applicable; the doctor can still use Include anyway on her plan.
          </p>
        )}

        {form.rows.map((r, i) => {
          const itemHasError = Object.keys(fieldErrors).some((k) => k.startsWith(`items.${i}.`));
          return (
            <section key={i} className={`card item-editor ${itemHasError ? 'item-editor-error' : ''}`}>
              <EditorHead label={`Item ${i + 1}`} noun="item" hasError={itemHasError}>
                <button type="button" className="icon-btn" onClick={() => move(i, -1)} aria-label={`Move item ${i + 1} up`} disabled={i === 0}>
                  <ArrowUp aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn" onClick={() => move(i, 1)} aria-label={`Move item ${i + 1} down`} disabled={i === form.rows.length - 1}>
                  <ArrowDown aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn icon-danger" onClick={() => remove(i)} aria-label={`Remove item ${i + 1}`}>
                  <Trash2 aria-hidden="true" />
                </button>
              </EditorHead>
              <div className="item-grid">
                <Field label="Type" id={`k-${i}`} error={fe(i, 'kind')}>
                  <select id={`k-${i}`} value={r.kind} onChange={setRow(i, 'kind')}>
                    {ITEM_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ITEM_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="span-2">
                  <Field label="Name (for staff)" id={`n-${i}`} error={fe(i, 'name')}>
                    <input id={`n-${i}`} value={r.name} onChange={setRow(i, 'name')} maxLength={200} />
                  </Field>
                </div>
                <Field label="When" id={`tm-${i}`}>
                  <select id={`tm-${i}`} value={r.timing} onChange={setRow(i, 'timing')}>
                    <option value="booking">At first visit</option>
                    <option value="weeks">Week range</option>
                    <option value="after">After another item</option>
                  </select>
                </Field>
                {r.timing === 'weeks' && (
                  <>
                    <Field label="From week" id={`fw-${i}`} error={fe(i, 'fromWeek')}>
                      <UnitInput unit="w" id={`fw-${i}`} inputMode="numeric" value={r.fromWeek} onChange={setRow(i, 'fromWeek')} maxLength={2} />
                    </Field>
                    <Field label="To week" id={`tw-${i}`} error={fe(i, 'toWeek')}>
                      <UnitInput unit="w" id={`tw-${i}`} inputMode="numeric" value={r.toWeek} onChange={setRow(i, 'toWeek')} maxLength={2} />
                    </Field>
                  </>
                )}
                {r.timing === 'after' && (
                  <>
                    <Field label="After item" id={`ak-${i}`} error={fe(i, 'after.key')}>
                      <select id={`ak-${i}`} value={r.afterKey} onChange={setRow(i, 'afterKey')}>
                        <option value="">Choose…</option>
                        {form.rows
                          .filter((o) => o.key !== r.key)
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.name || o.key}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Weeks after" id={`aw-${i}`} error={fe(i, 'after.weeks')}>
                      <UnitInput unit="w" id={`aw-${i}`} inputMode="numeric" value={r.afterWeeks} onChange={setRow(i, 'afterWeeks')} maxLength={2} />
                    </Field>
                  </>
                )}
                {r.timing === 'booking' && fe(i, 'fromWeek') && <p className="field-error cp-grid-error">{fe(i, 'fromWeek')}</p>}
                <Field label="For which patients" id={`aw2-${i}`} error={fe(i, 'appliesWhen')}>
                  <select id={`aw2-${i}`} value={r.appliesWhen} onChange={setRow(i, 'appliesWhen')}>
                    {Object.entries(APPLIES_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="span-2">
                  <Field label="Text on the patient's copy" id={`pt-${i}`} error={fe(i, 'patientText')}>
                    <input id={`pt-${i}`} value={r.patientText} onChange={setRow(i, 'patientText')} maxLength={300} />
                  </Field>
                </div>
                <AdvancedFields hasError={Boolean(fe(i, 'key') || fe(i, 'source'))}>
                  <Field label="Short code" id={`key-${i}`} error={fe(i, 'key')} hint="e.g. scan_anomaly">
                    <input id={`key-${i}`} value={r.key} onChange={setRow(i, 'key')} maxLength={60} />
                  </Field>
                  <Field label="Guideline source" id={`src-${i}`} error={fe(i, 'source')}>
                    <input id={`src-${i}`} value={r.source} onChange={setRow(i, 'source')} maxLength={400} />
                  </Field>
                </AdvancedFields>
              </div>
            </section>
          );
        })}

        {isAntenatal && (
          <>
            <div className="section-header">
              <h2>
                Risk rules <span className="tabular">({form.rules.length})</span>
              </h2>
              <button type="button" className="btn btn-secondary" onClick={addRule}>
                <Plus aria-hidden="true" /> Add rule
              </button>
            </div>
            <p className="hint help cp-section-hint">
              Each rule raises the patient to high or moderate risk when it applies. Changing rules recalculates every patient using this template. Rules on the
              lowest haemoglobin and the latest blood pressure use what was recorded at her visits in this pregnancy (haemoglobin: also lab results a doctor has
              reviewed); a rule on a finding applies once the finding is ticked on her record.
            </p>
            {form.rules.map((r, i) => {
              const ruleHasError = Object.keys(fieldErrors).some((k) => k.startsWith(`riskRules.${i}.`));
              return (
                <section key={i} className={`card item-editor ${ruleHasError ? 'item-editor-error' : ''}`}>
                  <EditorHead
                    label={`Rule ${i + 1}`}
                    noun="rule"
                    hasError={ruleHasError}
                    badge={<RiskBadge level={r.level} />}
                  >
                    <button type="button" className="icon-btn icon-danger" onClick={() => removeRule(i)} aria-label={`Remove rule ${i + 1}`}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </EditorHead>
                  <div className="item-grid">
                    <div className="span-2">
                      <Field label="Name" id={`rl-${i}`} error={fr(i, 'label')}>
                        <input id={`rl-${i}`} value={r.label} onChange={setRule(i, 'label')} maxLength={150} />
                      </Field>
                    </div>
                    <Field label="Checks" id={`rf-${i}`} error={fr(i, 'factor')}>
                      <select id={`rf-${i}`} value={r.factor} onChange={setRule(i, 'factor')}>
                        {Object.entries(RISK_FACTOR_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Level" id={`rv-${i}`} error={fr(i, 'level')}>
                      <select id={`rv-${i}`} value={r.level} onChange={setRule(i, 'level')}>
                        <option value="high">High</option>
                        <option value="moderate">Moderate</option>
                      </select>
                    </Field>
                    {NUMBER_FACTORS.includes(r.factor) && (
                      <>
                        <Field label="Comparison" id={`ro-${i}`} error={fr(i, 'op')}>
                          <select id={`ro-${i}`} value={r.op} onChange={setRule(i, 'op')}>
                            {Object.entries(OP_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Value" id={`rn-${i}`} error={fr(i, 'value')}>
                          <input id={`rn-${i}`} inputMode="decimal" value={r.value} onChange={setRule(i, 'value')} maxLength={6} />
                        </Field>
                      </>
                    )}
                    {r.factor === 'pastComplication' && (
                      <div className="span-2">
                        <Field label="Previous-pregnancy problem" id={`rp-${i}`} error={fr(i, 'complication')}>
                          <select id={`rp-${i}`} value={r.complication} onChange={setRule(i, 'complication')}>
                            {Object.entries(PAST_COMPLICATION_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    )}
                    {r.factor === 'finding' && (
                      <div className="span-2">
                        <Field label="Finding in this pregnancy" id={`rg-${i}`} error={fr(i, 'finding')}>
                          <select id={`rg-${i}`} value={r.finding} onChange={setRule(i, 'finding')}>
                            {Object.entries(PREGNANCY_FINDING_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    )}
                    {r.factor === 'condition' && (
                      <div className="span-2">
                        <Field label="Condition" id={`rc-${i}`} error={fr(i, 'condition')}>
                          <select id={`rc-${i}`} value={r.condition} onChange={setRule(i, 'condition')}>
                            {Object.entries(CONDITION_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    )}
                    <AdvancedFields hasError={Boolean(fr(i, 'key') || fr(i, 'source'))}>
                      <Field label="Short code" id={`rk-${i}`} error={fr(i, 'key')}>
                        <input id={`rk-${i}`} value={r.key} onChange={setRule(i, 'key')} maxLength={60} />
                      </Field>
                      <Field label="Guideline source" id={`rs-${i}`} error={fr(i, 'source')}>
                        <input id={`rs-${i}`} value={r.source} onChange={setRule(i, 'source')} maxLength={400} />
                      </Field>
                    </AdvancedFields>
                  </div>
                </section>
              );
            })}
          </>
        )}

        <div className="sticky-actions">
          <button type="button" className="btn btn-link" onClick={add}>
            <Plus aria-hidden="true" /> Add item
          </button>
          <span className="grow" />
          <Link to={`/care-plans/templates/${t.id}`} className="btn btn-link">
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
