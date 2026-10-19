import { useEffect, useState } from 'react';
import { CircleCheck, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, Field, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { DEPARTMENTS, TEMPLATES } from './labFormat.js';
import { TestStatus, rupees } from './LabTestsPage.jsx';

// Lab → Tests → one test (docs/LAB_LIMS_PLAN.md features 2 and 3).
//  - Any test: its department, turnaround times (routine and urgent), usual outside lab, and whether it is offered.
//  - A built-in test: other limits for its number values, and ranges for a group of patients.
//  - The hospital's own test: its name, whose test it is, its group and sample, and its values (number, choice or
//    words) with their limits and group ranges.
// A change to the values or ranges makes a new DRAFT version; only a doctor approves it (clinical content).
// A range for one sex is only for a baby's test (the sex recorded after birth) – never for a fetus.

const num = (v) => (v === '' || v == null ? null : Number(v));
const text = (v) => (v == null ? '' : String(v));
const emptyBand = () => ({ pregnant: '', sex: '', ageUnit: 'years', fromAge: '', toAge: '', low: '', high: '', range: '' });
const bandForm = (b) => ({ pregnant: b.pregnant ?? '', sex: b.sex ?? '', ageUnit: b.ageUnit ?? 'years', fromAge: text(b.fromAge), toAge: text(b.toAge), low: text(b.low), high: text(b.high), range: b.range ?? '' });
const bandBody = (b) => ({ pregnant: b.pregnant, sex: b.sex, ageUnit: b.ageUnit, fromAge: num(b.fromAge), toAge: num(b.toAge), low: num(b.low), high: num(b.high), range: b.range.trim() });
const emptyField = () => ({ name: '', type: 'number', unit: '', low: '', high: '', range: '', deltaPercent: '', options: '', abnormal: '', bands: [], section: '', long: false });
const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);
const list = (t) => t.split(',').map((x) => x.trim()).filter(Boolean);

function Bands({ bands, baby, prefix, errors, onChange, disabled }) {
  const set = (j, k, v) => onChange(bands.map((b, i) => (i === j ? { ...b, [k]: v } : b)));
  return (
    <div className="lab-bands">
      {bands.map((b, j) => {
        const id = `${prefix}-band-${j}`;
        return (
          <fieldset key={j} className="fieldset lab-band">
            <legend>Range for a group {j + 1}</legend>
            {errors[`${prefix}.bands.${j}`] && <p className="field-error">{errors[`${prefix}.bands.${j}`]}</p>}
            <div className="form-grid">
              <Field label="Pregnant" id={`${id}-preg`}>
                <select id={`${id}-preg`} value={b.pregnant} disabled={disabled} onChange={(e) => set(j, 'pregnant', e.target.value)}>
                  <option value="">Any</option>
                  <option value="yes">Pregnant (antenatal care)</option>
                  <option value="no">Not pregnant</option>
                </select>
              </Field>
              {/* The patient's own sex: a baby's recorded after birth, an adult's (a man registered by the lab) */}
              <Field label={baby ? "Baby's sex (after birth)" : 'Sex'} id={`${id}-sex`}>
                <select id={`${id}-sex`} value={b.sex} disabled={disabled} onChange={(e) => set(j, 'sex', e.target.value)}>
                  <option value="">Any</option>
                  <option value="female">{baby ? 'Girl' : 'Women'}</option>
                  <option value="male">{baby ? 'Boy' : 'Men'}</option>
                </select>
              </Field>
              <Field label={`From age (${b.ageUnit === 'days' ? 'days of life' : 'years'})`} id={`${id}-from`}>
                <input id={`${id}-from`} inputMode="numeric" value={b.fromAge} disabled={disabled} onChange={(e) => set(j, 'fromAge', e.target.value)} />
              </Field>
              <Field label={`To age (${b.ageUnit === 'days' ? 'days of life' : 'years'})`} id={`${id}-to`}>
                <input id={`${id}-to`} inputMode="numeric" value={b.toAge} disabled={disabled} onChange={(e) => set(j, 'toAge', e.target.value)} />
              </Field>
              {baby && (
                <Field label="Age in" id={`${id}-unit`}>
                  <select id={`${id}-unit`} value={b.ageUnit} disabled={disabled} onChange={(e) => set(j, 'ageUnit', e.target.value)}>
                    <option value="days">Days of life</option>
                    <option value="years">Years</option>
                  </select>
                </Field>
              )}
              <Field label="Lower limit" id={`${id}-low`}>
                <input id={`${id}-low`} inputMode="decimal" className="tabular" value={b.low} disabled={disabled} onChange={(e) => set(j, 'low', e.target.value)} />
              </Field>
              <Field label="Upper limit" id={`${id}-high`}>
                <input id={`${id}-high`} inputMode="decimal" className="tabular" value={b.high} disabled={disabled} onChange={(e) => set(j, 'high', e.target.value)} />
              </Field>
            </div>
            {!disabled && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => onChange(bands.filter((_, i) => i !== j))}>
                <Trash2 aria-hidden="true" /> Remove this range
              </button>
            )}
          </fieldset>
        );
      })}
      {!disabled && bands.length < 10 && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...bands, { ...emptyBand(), ageUnit: baby ? 'days' : 'years' }])}>
          <Plus aria-hidden="true" /> Add a range for a group (age, sex, pregnant)
        </button>
      )}
    </div>
  );
}

function formOf(test) {
  const report = test?.report ?? {};
  const common = {
    department: test?.department ?? 'other',
    tatHours: text(test?.tatHours ?? ''),
    urgentTatHours: text(test?.urgentTatHours ?? ''),
    outsideLab: test?.outsideLab ?? '',
    active: test?.active ?? true,
    // How it prints (report templates)
    template: report.template ?? 'table',
    method: report.method ?? '',
    notes: report.notes ?? '',
    ownPage: Boolean(report.ownPage),
    antibiotics: (test?.antibiotics ?? []).join('\n'),
  };
  if (!test) return { ...common, who: 'adult', name: '', group: 'chemistry', sample: '', fields: [emptyField()] };
  if (!test.custom) {
    const ranges = Object.fromEntries(
      test.fields
        .filter((f) => f.type === 'number')
        .map((f) => [f.key, { low: text(f.low), high: text(f.high), range: test.fieldRanges?.[f.key]?.range ?? '', bands: (f.bands ?? []).map(bandForm), deltaPercent: text(f.deltaPercent) }]),
    );
    return { ...common, ranges };
  }
  return {
    ...common,
    who: test.who,
    name: test.name,
    group: test.group,
    sample: test.sample,
    fields: test.fields.map((f) => ({ key: f.key, name: f.name, type: f.type, unit: f.unit ?? '', low: text(f.low), high: text(f.high), range: f.range ?? '', deltaPercent: text(f.deltaPercent), options: (f.options ?? []).join(', '), abnormal: (f.abnormal ?? []).join(', '), bands: (f.bands ?? []).map(bandForm), section: f.section ?? '', long: Boolean(f.long) })),
  };
}

function bodyOf(test, form) {
  const common = {
    department: form.department,
    tatHours: num(form.tatHours),
    urgentTatHours: num(form.urgentTatHours),
    outsideLab: form.outsideLab.trim(),
    active: form.active,
    report: { template: form.template, method: form.method.trim(), notes: form.notes.trim(), ownPage: form.ownPage },
    ...(form.template === 'culture' ? { antibiotics: lines(form.antibiotics) } : {}),
  };
  if (test && !test.custom) {
    return { ...common, version: test.version, fieldRanges: Object.fromEntries(Object.entries(form.ranges).map(([k, r]) => [k, { low: num(r.low), high: num(r.high), range: r.range.trim(), bands: r.bands.map(bandBody), deltaPercent: num(r.deltaPercent) }])) };
  }
  return {
    ...common,
    ...(test ? { version: test.version } : {}),
    who: form.who,
    name: form.name.trim(),
    group: form.group,
    sample: form.sample.trim(),
    fields: form.fields.map((f) => {
      const base = { ...(f.key ? { key: f.key } : {}), name: f.name.trim(), type: f.type, section: f.section.trim() };
      if (f.type === 'text') return { ...base, long: f.long };
      if (f.type === 'number') return { ...base, unit: f.unit.trim(), low: num(f.low), high: num(f.high), range: f.range.trim(), bands: f.bands.map(bandBody), deltaPercent: num(f.deltaPercent) };
      if (f.type === 'choice') return { ...base, options: list(f.options), abnormal: list(f.abnormal) };
      return base;
    }),
  };
}

function Approve({ test, onDone }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    if (!confirm) return setError('Tick that you checked the values and ranges.');
    setBusy(true);
    try {
      onDone(await api(`/lab-setup/tests/${test.key}/approve`, { method: 'POST', body: { confirm: true, version: test.version } }), 'Approved. The ranges of this version are no longer marked DRAFT.');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
    return undefined;
  };
  return (
    <section className="card" aria-labelledby="lab-approve-title">
      <h2 id="lab-approve-title">Approve the values and ranges</h2>
      <Alert type="error">{error}</Alert>
      <label className="check">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I checked the values, units and usual ranges of version {test.version} against our lab's
        method and sources.
      </label>
      <div className="row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={approve}>
          <CircleCheck aria-hidden="true" /> {busy ? 'Approving…' : `Approve version ${test.version}`}
        </button>
      </div>
    </section>
  );
}

export function LabTestEditPage() {
  const { key } = useParams();
  const navigate = useNavigate();
  const creating = key === 'new';
  const { data, error: loadError, reload } = useFetch('/lab-setup/tests');
  const [answer, setAnswer] = useState(null); // the list as the latest change answered
  const source = answer ?? data;
  const test = creating ? null : (source?.tests.find((t) => t.key === key) ?? null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (source && (creating || test)) setForm((f) => f ?? formOf(test));
  }, [source, test, creating]);
  const canEdit = Boolean(source?.canEdit);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setField = (i, k, v) => setForm((f) => ({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const setRange = (fk, k, v) => setForm((f) => ({ ...f, ranges: { ...f.ranges, [fk]: { ...f.ranges[fk], [k]: v } } }));

  const done = (res, message) => {
    setAnswer(res);
    setNotice(message);
    setError(null);
    setFields({});
    const next = res.tests.find((t) => t.key === (res.key ?? key));
    setForm(formOf(next));
    setSaving(false);
    if (creating && res.key) navigate(`/lab/tests/${res.key}`, { replace: true });
  };
  const save = async (e) => {
    e.preventDefault();
    const words = creating || test?.custom ? [form.name, form.sample, ...form.fields.flatMap((f) => [f.name, f.unit, f.range, f.options])] : [];
    if (words.some((w) => mentionsFetalSex(w))) return setError(PCPNDT_MESSAGE);
    setSaving(true);
    try {
      const res = creating ? await api('/lab-setup/tests', { method: 'POST', body: bodyOf(null, form) }) : await api(`/lab-setup/tests/${key}`, { method: 'PUT', body: bodyOf(test, form) });
      done(res, creating ? 'Test added as a DRAFT. A doctor approves its ranges; the hospital admin sets its price.' : 'Saved.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
      if (err.status === 409) reload();
    }
    return undefined;
  };

  const title = creating ? 'Add a test' : (test?.name ?? 'Lab test');
  const header = <PageHeader tabs={HOSPITAL_LAB.tabs} breadcrumbs={[{ label: 'Lab tests', to: '/lab/tests' }, { label: title }]} title={title} documentTitle="Lab test" />;
  if (loadError) return (<>{header}<div className="pf-content"><Alert type="error">{loadError}</Alert></div></>);
  if (!source || !form) return (<>{header}<div className="pf-content"><p className="muted">{source && !test && !creating ? 'This test is not on the list.' : 'Loading…'}</p></div></>);
  const baby = (test?.who ?? form.who) === 'newborn';
  const own = creating || test?.custom;
  const locked = !canEdit;

  return (
    <>
      {header}
      <div className="pf-content">
        <Link to="/lab/tests" className="btn btn-link btn-sm">
          All tests
        </Link>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        {test && (
          <section className="card">
            <div className="plan-card-head">
              <h2>{own ? "The hospital's own test" : 'Built-in test'}</h2>
              <TestStatus test={test} />
            </div>
            <p className="muted">
              Version {test.version}
              {test.status === 'approved' && test.approvedByName ? ` · approved by ${test.approvedByName}, ${formatDateTime(test.approvedAt)}` : ' · the usual ranges are a DRAFT until a doctor approves them'}
              {test.updatedByName ? ` · last changed by ${test.updatedByName}` : ''} · price {rupees(test.pricePaise)}
            </p>
          </section>
        )}
        <form className="card lab-test-form" onSubmit={save} noValidate>
          <Alert type="error">{error}</Alert>
          {own && (
            <fieldset className="fieldset">
              <legend>The test</legend>
              <div className="form-grid">
                <Field label="Name" id="lt-name" error={fields.name}>
                  <input id="lt-name" maxLength={150} value={form.name} disabled={locked} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label="Whose test" id="lt-who" error={fields.who}>
                  <select id="lt-who" value={form.who} disabled={locked || !creating} onChange={(e) => setForm({ ...form, who: e.target.value, group: e.target.value === 'newborn' ? 'nb_blood' : 'chemistry' })}>
                    <option value="adult">Adult (mother or woman)</option>
                    <option value="newborn">Baby</option>
                  </select>
                </Field>
                <Field label="Group in the order form" id="lt-group" error={fields.group}>
                  <select id="lt-group" value={form.group} disabled={locked} onChange={(e) => set('group', e.target.value)}>
                    {Object.entries(source.groups)
                      .filter(([k]) => k.startsWith('nb_') === (form.who === 'newborn'))
                      .map(([k, w]) => (
                        <option key={k} value={k}>
                          {w}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Sample" id="lt-sample" error={fields.sample} hint="For example: Blood (plain), fasting">
                  <input id="lt-sample" maxLength={150} value={form.sample} disabled={locked} onChange={(e) => set('sample', e.target.value)} />
                </Field>
              </div>
            </fieldset>
          )}
          <fieldset className="fieldset">
            <legend>In the lab</legend>
            <div className="form-grid">
              <Field label="Department" id="lt-dept" error={fields.department}>
                <select id="lt-dept" value={form.department} disabled={locked} onChange={(e) => set('department', e.target.value)}>
                  {Object.entries(DEPARTMENTS).map(([k, w]) => (
                    <option key={k} value={k}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Report due within (hours)" id="lt-tat" error={fields.tatHours}>
                <input id="lt-tat" inputMode="numeric" value={form.tatHours} disabled={locked} onChange={(e) => set('tatHours', e.target.value)} />
              </Field>
              <Field label="When urgent (hours)" id="lt-utat" error={fields.urgentTatHours}>
                <input id="lt-utat" inputMode="numeric" value={form.urgentTatHours} disabled={locked} onChange={(e) => set('urgentTatHours', e.target.value)} />
              </Field>
              <Field label="Usually sent to (outside lab, optional)" id="lt-outside" error={fields.outsideLab}>
                <input id="lt-outside" maxLength={120} value={form.outsideLab} disabled={locked} onChange={(e) => set('outsideLab', e.target.value)} />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.active} disabled={locked} onChange={(e) => set('active', e.target.checked)} /> Offered when doctors order tests
            </label>
          </fieldset>

          <fieldset className="fieldset">
            <legend>On the report</legend>
            <div className="form-grid">
              <Field label="Report layout" id="lt-template" error={fields['report.template']}>
                <select id="lt-template" value={form.template} disabled={locked} onChange={(e) => set('template', e.target.value)}>
                  {Object.entries(TEMPLATES).map(([k, w]) => (
                    <option key={k} value={k}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Method (DRAFT until approved)" id="lt-method" error={fields['report.method']} hint="For example: Automated cell counter">
                <input id="lt-method" maxLength={300} value={form.method} disabled={locked} onChange={(e) => set('method', e.target.value)} />
              </Field>
            </div>
            <Field label="Interpretation notes printed under the result (DRAFT until approved)" id="lt-notes" error={fields['report.notes']}>
              <textarea id="lt-notes" rows={3} maxLength={1000} value={form.notes} disabled={locked} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            {form.template === 'culture' && (
              <Field label="Antibiotics tested, one per line" id="lt-abx" error={fields.antibiotics} hint="The sensitivity table lists these in this order.">
                <textarea id="lt-abx" rows={6} value={form.antibiotics} disabled={locked} onChange={(e) => set('antibiotics', e.target.value)} />
              </Field>
            )}
            <label className="check">
              <input type="checkbox" checked={form.ownPage} disabled={locked} onChange={(e) => set('ownPage', e.target.checked)} /> Print on its own page
            </label>
          </fieldset>

          {!own &&
            test.fields
              .filter((f) => f.type === 'number')
              .map((f) => {
                const r = form.ranges[f.key];
                const b = test.builtIn?.[f.key];
                const at = `fieldRanges.${f.key}`;
                return (
                  <fieldset key={f.key} className="fieldset">
                    <legend>
                      {f.name}
                      {f.unit ? ` (${f.unit})` : ''}
                    </legend>
                    {fields[at] && <p className="field-error">{fields[at]}</p>}
                    <p className="hint">Built-in DRAFT: {b?.range || 'no usual range'}</p>
                    <div className="form-grid">
                      <Field label="Lower limit" id={`lt-${f.key}-low`}>
                        <input id={`lt-${f.key}-low`} inputMode="decimal" className="tabular" value={r.low} disabled={locked} onChange={(e) => setRange(f.key, 'low', e.target.value)} />
                      </Field>
                      <Field label="Upper limit" id={`lt-${f.key}-high`}>
                        <input id={`lt-${f.key}-high`} inputMode="decimal" className="tabular" value={r.high} disabled={locked} onChange={(e) => setRange(f.key, 'high', e.target.value)} />
                      </Field>
                      <Field label="Range in words (optional)" id={`lt-${f.key}-range`} hint="Left empty, it is written from the limits.">
                        <input id={`lt-${f.key}-range`} maxLength={150} value={r.range} disabled={locked} onChange={(e) => setRange(f.key, 'range', e.target.value)} />
                      </Field>
                      <Field label="Big change from her last result (%)" id={`lt-${f.key}-delta`} hint="Empty = no flag. DRAFT until a doctor approves.">
                        <input id={`lt-${f.key}-delta`} inputMode="decimal" className="tabular" value={r.deltaPercent} disabled={locked} onChange={(e) => setRange(f.key, 'deltaPercent', e.target.value)} />
                      </Field>
                    </div>
                    <Bands bands={r.bands} baby={baby} prefix={at} errors={fields} disabled={locked} onChange={(v) => setRange(f.key, 'bands', v)} />
                  </fieldset>
                );
              })}

          {own &&
            form.fields.map((f, i) => {
              const at = `fields.${i}`;
              return (
                <fieldset key={i} className="fieldset">
                  <legend>Result value {i + 1}</legend>
                  {fields[at] && <p className="field-error">{fields[at]}</p>}
                  <div className="form-grid">
                    <Field label="Name" id={`lf-${i}-name`} error={fields[`${at}.name`]}>
                      <input id={`lf-${i}-name`} maxLength={80} value={f.name} disabled={locked} onChange={(e) => setField(i, 'name', e.target.value)} />
                    </Field>
                    <Field label="Section on the report (optional)" id={`lf-${i}-section`} hint="For example: Microscopy">
                      <input id={`lf-${i}-section`} maxLength={60} value={f.section} disabled={locked} onChange={(e) => setField(i, 'section', e.target.value)} />
                    </Field>
                    <Field label="Kind of result" id={`lf-${i}-type`}>
                      <select id={`lf-${i}-type`} value={f.type} disabled={locked} onChange={(e) => setField(i, 'type', e.target.value)}>
                        <option value="number">A number</option>
                        <option value="choice">A choice (for example Negative / Positive)</option>
                        <option value="text">Words</option>
                      </select>
                    </Field>
                    {f.type === 'number' && (
                      <>
                        <Field label="Unit" id={`lf-${i}-unit`}>
                          <input id={`lf-${i}-unit`} maxLength={30} value={f.unit} disabled={locked} onChange={(e) => setField(i, 'unit', e.target.value)} />
                        </Field>
                        <Field label="Lower limit" id={`lf-${i}-low`}>
                          <input id={`lf-${i}-low`} inputMode="decimal" className="tabular" value={f.low} disabled={locked} onChange={(e) => setField(i, 'low', e.target.value)} />
                        </Field>
                        <Field label="Upper limit" id={`lf-${i}-high`}>
                          <input id={`lf-${i}-high`} inputMode="decimal" className="tabular" value={f.high} disabled={locked} onChange={(e) => setField(i, 'high', e.target.value)} />
                        </Field>
                        <Field label="Range in words (optional)" id={`lf-${i}-range`}>
                          <input id={`lf-${i}-range`} maxLength={150} value={f.range} disabled={locked} onChange={(e) => setField(i, 'range', e.target.value)} />
                        </Field>
                        <Field label="Big change from her last result (%)" id={`lf-${i}-delta`} hint="Empty = no flag.">
                          <input id={`lf-${i}-delta`} inputMode="decimal" className="tabular" value={f.deltaPercent} disabled={locked} onChange={(e) => setField(i, 'deltaPercent', e.target.value)} />
                        </Field>
                      </>
                    )}
                    {f.type === 'text' && (
                      <label className="check">
                        <input type="checkbox" checked={f.long} disabled={locked} onChange={(e) => setField(i, 'long', e.target.checked)} /> A paragraph (histopathology, cytology)
                      </label>
                    )}
                    {f.type === 'choice' && (
                      <>
                        <Field label="Options, separated by commas" id={`lf-${i}-options`}>
                          <input id={`lf-${i}-options`} maxLength={400} value={f.options} disabled={locked} onChange={(e) => setField(i, 'options', e.target.value)} />
                        </Field>
                        <Field label="Options flagged Abnormal" id={`lf-${i}-abnormal`}>
                          <input id={`lf-${i}-abnormal`} maxLength={400} value={f.abnormal} disabled={locked} onChange={(e) => setField(i, 'abnormal', e.target.value)} />
                        </Field>
                      </>
                    )}
                  </div>
                  {f.type === 'number' && <Bands bands={f.bands} baby={form.who === 'newborn'} prefix={at} errors={fields} disabled={locked} onChange={(v) => setField(i, 'bands', v)} />}
                  {!locked && form.fields.length > 1 && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => set('fields', form.fields.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden="true" /> Remove this value
                    </button>
                  )}
                </fieldset>
              );
            })}
          {own && !locked && form.fields.length < 20 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set('fields', [...form.fields, emptyField()])}>
              <Plus aria-hidden="true" /> Add a result value
            </button>
          )}
          {fields.fields && <p className="field-error">{fields.fields}</p>}
          {!locked && (
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : creating ? 'Add the test' : 'Save'}
              </button>
            </div>
          )}
          <p className="hint">The values and ranges are clinical: a change makes a new DRAFT version for a doctor to approve. Department, times and the outside lab are not.</p>
        </form>
        {test && source.canApprove && test.status === 'draft' && <Approve test={test} onDone={done} />}
      </div>
    </>
  );
}
