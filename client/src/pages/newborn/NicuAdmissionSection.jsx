import { useState } from 'react';
import { BadgeCheck, CalendarClock, CircleAlert, Clock, Info, Thermometer, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { ManualPrint } from '../../components/print/ManualPage.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { NICU_OUTCOMES, NICU_REASONS } from './newbornCareRules.js';
import { NicuF03Print } from './NicuF03Print.jsx';
import { ASSESSMENT_FIELDS, FOLLOW_ON_FIELDS, FROM_WORDS, MATERNAL_FIELDS, OUTCOME_FIELDS, PLAN_FIELDS, bannerText, fromForm, labelOf, missingWords, nowLocal, setAt, toForm, toIso, valueAt, valueWords } from './nicuFields.js';

// Build 13 – a baby's NICU admission (NEO-F-03) on the Newborn care tab: admit (unit, where from, bed, the first
// findings – the mother's history, Apgar, resuscitation and cord data come from her record, the delivery note and the
// record at birth), the banners (hypothermia, hypoglycaemia, ROP due, outside the unit's capability, below the floor,
// counselling and completion overdue, late entry), the form's three parts and what follows, the admitting doctor's
// signature, the outcome (NEO-L-05), and printing as NEO-F-03. The lists come from the server (rules.f03).

const BANNER_ICON = { high: TriangleAlert, watch: CircleAlert, due: CalendarClock, neutral: Clock };

export function Banners({ list }) {
  if (!list?.length) return null;
  return (
    <div className="nicu-banners" role="status">
      {list.map((b, i) => {
        const Icon = BANNER_ICON[b.tone] ?? Info;
        return (
          <p key={`${b.key}-${i}`} className={`nicu-banner nicu-banner-${b.tone}`}>
            <Icon aria-hidden="true" /> <span>{bannerText(b)}</span>
          </p>
        );
      })}
    </div>
  );
}

/** One field as an input, by its type. Gated options (PX-X-01) are left out below level IIIA. */
function Input({ f, value, onChange, rules, intensive, id, error, from, unknown, onUnknown }) {
  let options = f.options ? rules[f.options] ?? {} : {};
  if (f.gated && !intensive) options = Object.fromEntries(Object.entries(options).filter(([k]) => !(rules[f.gated] ?? []).includes(k)));
  const label = labelOf(f, rules);
  const hint = [from && FROM_WORDS[from], f.gated && !intensive && 'Ventilation and central lines: level IIIA units only (PX-X-01)'].filter(Boolean).join(' · ') || undefined;
  let input;
  if (f.type === 'multi') {
    input = (
      <div className="check-grid" id={id}>
        {Object.entries(options).map(([k, w]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={(value ?? []).includes(k)} onChange={(e) => onChange(e.target.checked ? [...(value ?? []), k] : (value ?? []).filter((x) => x !== k))} /> {w}
          </label>
        ))}
      </div>
    );
  } else if (f.type === 'enum' || f.type === 'yn') {
    const opts = f.type === 'yn' ? { yes: 'Yes', no: 'No', unknown: 'Unknown' } : options;
    input = (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not recorded</option>
        {Object.entries(opts).map(([k, w]) => (
          <option key={k} value={k}>
            {w}
          </option>
        ))}
      </select>
    );
  } else if (f.type === 'at') {
    input = <DateTimeInput id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  } else {
    input = <input id={id} inputMode={f.type === 'text' ? undefined : 'decimal'} maxLength={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Field label={label} id={id} error={error} hint={hint}>
      {input}
      {onUnknown && (
        <label className="check">
          <input type="checkbox" checked={unknown} onChange={(e) => onUnknown(e.target.checked)} /> Unknown
        </label>
      )}
    </Field>
  );
}

/** A part of the form being edited: its fields as inputs, saved together (PUT /newborn-care/nicu/:id). */
function PartEditor({ part, fields, n, rules, patientId, onSaved, onCancel }) {
  const staff = useFetch(part === 'followOn' ? '/newborn-care/nicu/options' : null, { patientId });
  const intensive = n.unitLevel === 'level_IIIA';
  const stored = part === 'followOn' ? n.followOn : part === 'assessment' ? n.assessment : part === 'plan' ? n.plan : n.maternal;
  const top = fields.filter((f) => f.top);
  const [form, setForm] = useState(() => ({ ...toForm(fields.filter((f) => !f.top), stored ?? {}), ...Object.fromEntries(top.map((f) => [f.key, n[f.key] == null ? '' : String(n[f.key])])) }));
  const [unknown, setUnknown] = useState(n.maternal?.unknown ?? []);
  const [exam, setExam] = useState(() => n.assessment?.exam ?? {});
  const [problems, setProblems] = useState(() => [...(n.plan?.problems ?? []), ...Array(rules.maxProblems).fill('')].slice(0, rules.maxProblems));
  const [counsellor, setCounsellor] = useState(n.followOn?.counselledById ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = Object.fromEntries(top.filter((f) => form[f.key] !== '').map((f) => [f.key, form[f.key]]));
    const values = fromForm(fields, form);
    if (part === 'maternal') values.unknown = unknown;
    if (part === 'assessment') values.exam = Object.fromEntries(Object.keys(rules.examSystems).map((k) => [k, { status: exam[k]?.status || '', note: exam[k]?.note ?? '' }]));
    if (part === 'plan') values.problems = problems.map((p) => p.trim()).filter(Boolean);
    if (part === 'followOn' && counsellor) values.counselledById = counsellor;
    if (part === 'followOn' && !counsellor) values.counselledById = null;
    try {
      await api(`/newborn-care/nicu/${n.id}`, { method: 'PUT', body: { ...body, [part]: values } });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const fe = (k) => error?.fields?.[k] ?? error?.fields?.[`${part}.${k}`];
  return (
    <form className="stack" onSubmit={save}>
      <Alert type="error">{error?.message}</Alert>
      <div className="form-grid">
        {fields.map((f) => (
          <Input
            key={f.key}
            f={f}
            id={`nicu-${part}-${f.key}`}
            rules={rules}
            intensive={intensive}
            value={valueAt(form, f.key)}
            onChange={(v) => setForm((x) => setAt(x, f.key, v))}
            error={fe(f.key)}
            from={part === 'maternal' ? n.maternalFrom?.[f.key.split('.')[0]] : null}
            unknown={unknown.includes(f.key)}
            onUnknown={part === 'maternal' && !n.inborn && !f.key.includes('.') ? (on) => setUnknown((u) => (on ? [...u, f.key] : u.filter((k) => k !== f.key))) : null}
          />
        ))}
      </div>
      {part === 'assessment' && (
        <fieldset className="fieldset">
          <legend>Examination</legend>
          <div className="nicu-exam">
            {Object.entries(rules.examSystems).map(([k, label]) => (
              <div key={k} style={{ display: 'contents' }}>
                <span>{label}</span>
                <select aria-label={`${label}: normal or not`} value={exam[k]?.status ?? ''} onChange={(e) => setExam({ ...exam, [k]: { ...exam[k], status: e.target.value } })}>
                  <option value="">Choose…</option>
                  <option value="normal">Normal</option>
                  <option value="abnormal">Not normal</option>
                </select>
                <input aria-label={`${label}: note`} maxLength={300} value={exam[k]?.note ?? ''} onChange={(e) => setExam({ ...exam, [k]: { ...exam[k], note: e.target.value } })} />
              </div>
            ))}
          </div>
        </fieldset>
      )}
      {part === 'plan' && (
        <fieldset className="fieldset">
          <legend>{`Problem list (up to ${rules.maxProblems})`}</legend>
          {problems.map((p, i) => (
            <input key={i} aria-label={`Problem ${i + 1}`} maxLength={200} value={p} onChange={(e) => setProblems(problems.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
        </fieldset>
      )}
      {part === 'followOn' && staff.data?.people && (
        <Field label="Counselled by" id="nicu-counsellor" error={fe('counselledById')}>
          <select id="nicu-counsellor" value={counsellor} onChange={(e) => setCounsellor(e.target.value)}>
            <option value="">Me</option>
            {staff.data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="row">
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? 'Saving…' : 'Save this part'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PartView({ fields, values, rules, top, unknown = [], from }) {
  return (
    <dl className="details">
      {fields.map((f) => {
        const v = f.top ? top?.[f.key] : valueAt(values ?? {}, f.key);
        if ((v == null || v === '' || (Array.isArray(v) && !v.length)) && !unknown.includes(f.key)) return null;
        return (
          <div key={f.key}>
            <dt>{labelOf(f, rules)}</dt>
            <dd>
              {valueWords(f, v, rules, unknown.includes(f.key))}
              {from?.[f.key.split('.')[0]] && <span className="nicu-from">{` · ${FROM_WORDS[from[f.key.split('.')[0]]]}`}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function OutcomeDialog({ n, rules, onDone, onCancel }) {
  const [f, setF] = useState({ result: '', at: nowLocal(), note: '' });
  const [d, setD] = useState(() => toForm(OUTCOME_FIELDS, {}));
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/newborn-care/nicu/${n.id}/outcome`, { method: 'POST', body: { ...f, at: toIso(f.at), details: fromForm(OUTCOME_FIELDS, d) } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="nicu-out" title={`How admission ${n.registerLabel} ended`} submitLabel="Save the outcome" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Outcome" id="nicu-res" error={error?.fields?.result}>
        <select id="nicu-res" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
          <option value="">Choose…</option>
          {Object.entries(rules.outcomes).map(([k, w]) => (
            <option key={k} value={k}>
              {w}
            </option>
          ))}
        </select>
      </Field>
      <Field label="When" id="nicu-oat" error={error?.fields?.at}>
        <DateTimeInput id="nicu-oat" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />
      </Field>
      <div className="form-grid">
        {OUTCOME_FIELDS.filter((x) => !x.when || x.when === f.result).map((x) => (
          <Input key={x.key} f={x} id={`nicu-o-${x.key}`} rules={rules} intensive value={d[x.key]} onChange={(v) => setD({ ...d, [x.key]: v })} error={error?.fields?.[`details.${x.key}`]} />
        ))}
      </div>
      <Field label="Note (optional)" id="nicu-onote">
        <input id="nicu-onote" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </FormDialog>
  );
}

function AdmitForm({ patientId, reasons, onDone, onCancel }) {
  const { data: o, error: loadError } = useFetch('/newborn-care/nicu/options', { patientId });
  const [requestId, setRequestId] = useState(newRequestId);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (loadError) return <Alert type="error">{loadError}</Alert>;
  if (!o) return <p className="muted">Loading…</p>;
  const form = f ?? { unit: o.units[0]?.key ?? '', source: '', transferFromName: '', admittedAt: nowLocal(), bedId: '', consultantId: '', admittingDoctorId: '', weightGrams: o.prefill.weightGrams ?? '', gestationWeeks: o.prefill.gestationWeeks ?? '', gestationDays: '0', temperatureC: '', reasonPrimary: '', allergyAlert: o.prefill.allergyAlert ?? '', floor: { decision: '', consultantId: '', note: '' } };
  const set = (k, v) => setF({ ...form, [k]: v });
  const unit = o.units.find((u) => u.key === form.unit);
  const beds = o.beds.filter((b) => b.unit === form.unit);
  const doctors = o.people.filter((p) => p.roles.includes('doctor'));
  const admitting = o.people.filter((p) => p.roles.some((r) => r === 'doctor' || r === 'rmo'));
  const below = unit && ((form.gestationWeeks !== '' && Number(form.gestationWeeks) < unit.minGestationWeeks) || (form.weightGrams !== '' && Number(form.weightGrams) < unit.minBirthWeightGrams));
  const full = beds.length > 0 && beds.every((b) => b.occupied);
  const fe = (k) => error?.fields?.[k];
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { floor, ...rest } = form;
    const body = { ...rest, clientRequestId: requestId, patientId, admittedAt: toIso(form.admittedAt), consultantId: form.consultantId || null, admittingDoctorId: form.admittingDoctorId || null };
    if (below) body.floorDecision = floor;
    try {
      const r = await api('/newborn-care/nicu', { method: 'POST', body });
      setRequestId(newRequestId());
      onDone(r.warnings);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Alert type="error">{error?.message}</Alert>
      {o.prefill.motherHidden && <Alert type="info">The mother's record is linked but you may not see her details: §1 starts empty.</Alert>}
      {o.prefill.fields.length > 0 && <p className="hint">{`Filled in from the linked records (you can change them after admitting): ${o.prefill.fields.length} fields of §1.`}</p>}
      {full && <Alert type="info">This unit is full. Admitting needs the hospital admin to allow one more admission (Hospital admin → NICU units); otherwise use the transfer pathway (NEO-F-18).</Alert>}
      <div className="form-grid">
        <Field label="Unit" id="na-unit" error={fe('unit')}>
          <select id="na-unit" value={form.unit} onChange={(e) => setF({ ...form, unit: e.target.value, source: '', bedId: '' })}>
            {o.units.map((u) => (
              <option key={u.key} value={u.key}>
                {`${u.name} (${u.level === 'level_IIIA' ? 'level IIIA' : 'level II'})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Came from" id="na-src" error={fe('source')}>
          <select id="na-src" value={form.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(unit?.sources ?? {}).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        {form.source === 'transfer_other' && (
          <Field label="Hospital it came from" id="na-from" error={fe('transferFromName')}>
            <input id="na-from" maxLength={150} value={form.transferFromName} onChange={(e) => set('transferFromName', e.target.value)} />
          </Field>
        )}
        <Field label="Admitted" id="na-at" error={fe('admittedAt')}>
          <DateTimeInput id="na-at" value={form.admittedAt} onChange={(e) => set('admittedAt', e.target.value)} />
        </Field>
        <Field label="Bed" id="na-bed" error={fe('bedId')} hint={beds.length ? `${beds.filter((b) => !b.occupied).length} of ${beds.length} free` : 'No NICU beds set up for this unit'}>
          <select id="na-bed" value={form.bedId} onChange={(e) => set('bedId', e.target.value)}>
            <option value="">Choose…</option>
            {beds.map((b) => (
              <option key={b.id} value={b.id}>
                {`${b.ward} · ${b.name} – ${b.occupied ? 'taken' : 'free'}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Admitting doctor" id="na-doc" error={fe('admittingDoctorId')} hint="Leave as yourself if you are the doctor or RMO admitting">
          <select id="na-doc" value={form.admittingDoctorId} onChange={(e) => set('admittingDoctorId', e.target.value)}>
            <option value="">Me</option>
            {admitting.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Consultant" id="na-cons" error={fe('consultantId')}>
          <select id="na-cons" value={form.consultantId} onChange={(e) => set('consultantId', e.target.value)}>
            <option value="">Not chosen yet</option>
            {doctors.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weight (g)" id="na-wt" error={fe('weightGrams')}>
          <input id="na-wt" inputMode="numeric" value={form.weightGrams} onChange={(e) => set('weightGrams', e.target.value)} />
        </Field>
        <Field label="Gestation – weeks" id="na-ga" error={fe('gestationWeeks')}>
          <input id="na-ga" inputMode="numeric" value={form.gestationWeeks} onChange={(e) => set('gestationWeeks', e.target.value)} />
        </Field>
        <Field label="and days (0–6)" id="na-gad" error={fe('gestationDays')}>
          <input id="na-gad" inputMode="numeric" value={form.gestationDays} onChange={(e) => set('gestationDays', e.target.value)} />
        </Field>
        <Field label="Temperature at admission (°C)" id="na-temp" error={fe('temperatureC')}>
          <input id="na-temp" inputMode="decimal" value={form.temperatureC} onChange={(e) => set('temperatureC', e.target.value)} />
        </Field>
        <Field label="Main reason for admission" id="na-why" error={fe('reasonPrimary')}>
          <select id="na-why" value={form.reasonPrimary} onChange={(e) => set('reasonPrimary', e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(reasons ?? {}).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Allergy alert" id="na-allergy" hint={o.prefill.allergyAlert ? "From the mother's record" : undefined}>
          <input id="na-allergy" maxLength={500} value={form.allergyAlert} onChange={(e) => set('allergyAlert', e.target.value)} />
        </Field>
      </div>
      {below && (
        <fieldset className="fieldset">
          <legend>{`Below the admission floor (${unit.minGestationWeeks} weeks / ${unit.minBirthWeightGrams} g): the transfer pathway (NEO-F-18) is suggested. The consultant decides.`}</legend>
          {fe('floorDecision') && <p className="field-error">{fe('floorDecision')}</p>}
          <div className="form-grid">
            <Field label="Consultant" id="na-fc" error={fe('floorDecision.consultantId')}>
              <select id="na-fc" value={form.floor.consultantId} onChange={(e) => set('floor', { ...form.floor, consultantId: e.target.value })}>
                <option value="">Choose…</option>
                {doctors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Decision" id="na-fd">
              <select id="na-fd" value={form.floor.decision} onChange={(e) => set('floor', { ...form.floor, decision: e.target.value })}>
                <option value="">Choose…</option>
                <option value="admit_here">Admit here</option>
                <option value="transfer">Transfer pathway</option>
              </select>
            </Field>
            <Field label="Note (optional)" id="na-fn">
              <input id="na-fn" maxLength={300} value={form.floor.note} onChange={(e) => set('floor', { ...form.floor, note: e.target.value })} />
            </Field>
          </div>
        </fieldset>
      )}
      <div className="row">
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? 'Admitting…' : 'Admit'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const PARTS = [
  { key: 'maternal', title: '§1 Maternal and perinatal history', action: 'Fill in §1', fields: MATERNAL_FIELDS, locked: true },
  { key: 'assessment', title: '§2 Admission assessment', action: 'Fill in §2', fields: ASSESSMENT_FIELDS, locked: true },
  { key: 'plan', title: '§3 Problem list and plan', action: 'Fill in §3', fields: PLAN_FIELDS, locked: true },
  { key: 'followOn', title: 'Parents, consent and the consultant', action: 'Record counselling and consent', fields: FOLLOW_ON_FIELDS, locked: false },
];

/** One NEO-F-03 admission: banners, the parts, sign, outcome, print. */
export function NicuAdmissionCard({ n, baby, data, reload }) {
  const rules = data.rules.f03;
  const [editing, setEditing] = useState(null);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState(null);
  const open = !n.outcome && !n.cancelled;
  const prefill = async () => {
    try {
      const r = await api(`/newborn-care/nicu/${n.id}/prefill`, { method: 'POST' });
      setResult({ text: r.filled ? `${r.filled} ${r.filled === 1 ? "field" : "fields"} filled in from the linked records.` : r.motherHidden ? "Nothing to fill in: you may not see the mother's record." : 'Nothing new to fill in from the linked records.' });
      reload();
    } catch (err) {
      setResult({ error: err });
    }
  };
  const sign = async () => {
    try {
      await api(`/newborn-care/nicu/${n.id}/sign`, { method: 'POST' });
      setResult({ text: 'Signed.' });
      reload();
    } catch (err) {
      setResult({ error: err });
    }
  };
  const c = n.computed ?? {};
  return (
    <li className={n.cancelled ? 'muted stack' : 'stack'}>
      <span className="row">
        <StatusPill tone={n.cancelled ? 'inactive' : n.outcome ? (n.outcome.result === 'died' ? 'inactive' : 'stable') : 'admitted'}>{n.cancelled ? 'Entered in error' : n.outcome ? rules.outcomes[n.outcome.result] ?? NICU_OUTCOMES[n.outcome.result] : 'Admitted now'}</StatusPill>
        <strong>{`${n.registerLabel} · ${n.unitName} · ${formatDateTime(n.admittedAt)}${n.ageHours != null ? ` (${n.ageHours} h of age)` : ''}`}</strong>
        {n.signed ? (
          <StatusPill tone="stable" icon={BadgeCheck}>{`Signed by ${n.signed.byName}`}</StatusPill>
        ) : (
          !n.cancelled && <StatusPill tone="watch">Not signed yet</StatusPill>
        )}
      </span>
      <span className="ca-group-words">
        {[
          `${n.sourceWords}${n.transferFromName ? ` – ${n.transferFromName}` : ''}`,
          n.bed?.name ?? 'no bed',
          rules.reasons[n.reasonPrimary],
          n.weightGrams != null && `${n.weightGrams} g`,
          n.gestationWeeks != null && `${n.gestationWeeks}+${n.gestationDays ?? 0} weeks${c.maturityClass ? ` (${rules.maturity[c.maturityClass]})` : ''}`,
          c.sizeClass && rules.size[c.sizeClass],
          n.stayDays != null && `${n.stayDays} days`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {n.allergyAlert && <p className="nicu-allergy">{`Allergy alert: ${n.allergyAlert}`}</p>}
      {open && <Banners list={n.banners} />}
      {n.fullOverride && <p className="hint">{`Admitted to a full unit: allowed by ${n.fullOverride.byName} – ${n.fullOverride.reason}`}</p>}
      {n.atDesk && <p className="hint">{`Admitted at the desk by ${n.atDesk.byName}, ${formatDateTime(n.atDesk.at)}`}</p>}
      {(c.cranialUsg?.length > 0 || c.hearingAabrBeforeDischarge) && (
        <p className="hint">
          {[c.cranialUsg?.length && `Cranial ultrasound: ${c.cranialUsg.map((x) => `${x.label} ${formatDate(x.on)}`).join(', ')}`, c.hearingAabrBeforeDischarge && 'Hearing screen (AABR) before discharge – stay over 5 days'].filter(Boolean).join(' · ')}
        </p>
      )}
      {result?.error && <Alert type="error">{result.error.message}</Alert>}
      {result?.error?.fields && (
        <ul className="plain-list small">
          {missingWords(result.error.fields, rules).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {result?.text && (
        <Alert type="success" onClose={() => setResult(null)}>
          {result.text}
        </Alert>
      )}
      {!n.cancelled &&
        PARTS.map((p) => {
          const canEdit = data.access.write && !n.cancelled && (!p.locked || !n.signed);
          const values = p.key === 'maternal' ? n.maternal : p.key === 'assessment' ? n.assessment : p.key === 'plan' ? n.plan : n.followOn;
          return (
            <details key={p.key} className="nicu-part" open={editing === p.key || undefined}>
              <summary>{p.title}</summary>
              {editing === p.key ? (
                <PartEditor
                  part={p.key}
                  fields={p.fields}
                  n={n}
                  rules={rules}
                  patientId={baby.id}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    setResult({ text: 'Saved.' });
                    reload();
                  }}
                />
              ) : (
                <>
                  {p.key === 'plan' && (n.plan?.problems ?? []).length > 0 && (
                    <ol>
                      {n.plan.problems.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ol>
                  )}
                  <PartView fields={p.fields} values={values} rules={rules} top={n} unknown={p.key === 'maternal' ? (n.maternal?.unknown ?? []) : []} from={p.key === 'maternal' ? n.maternalFrom : null} />
                  {p.key === 'assessment' && n.assessment?.exam && (
                    <p className="hint">{`Examination: ${Object.values(n.assessment.exam).filter((e) => e?.status === 'abnormal').length} not normal of ${Object.values(n.assessment.exam).filter((e) => e?.status).length} examined`}</p>
                  )}
                  {p.key === 'followOn' && n.followOn?.counselledByName && <p className="hint">{`Counselled by ${n.followOn.counselledByName}`}</p>}
                  {canEdit && (
                    <span className="row">
                      <button type="button" className="btn btn-link" onClick={() => setEditing(p.key)}>
                        {p.action}
                      </button>
                      {p.key === 'maternal' && (
                        <button type="button" className="btn btn-link" onClick={prefill}>
                          Fill in from the linked records
                        </button>
                      )}
                    </span>
                  )}
                </>
              )}
            </details>
          );
        })}
      <div className="row">
        {data.access.sign && !n.signed && !n.cancelled && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={sign}>
            Sign the admission
          </button>
        )}
        {data.access.outcome && open && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClosing(true)}>
            Record how it ended
          </button>
        )}
        {!n.cancelled && (
          <ManualPrint screen="nicu_admission" on={String(n.admittedAt).slice(0, 10)} title="NICU admission" footer={rules.footer}>
            <NicuF03Print admission={n} baby={baby} rules={rules} />
          </ManualPrint>
        )}
      </div>
      {closing && (
        <OutcomeDialog
          n={n}
          rules={rules}
          onCancel={() => setClosing(false)}
          onDone={() => {
            setClosing(false);
            reload();
          }}
        />
      )}
    </li>
  );
}

/** The NICU part of a baby's Newborn care tab. */
export function NicuAdmissionSection({ patientId, data, reload, baby }) {
  const [open, setOpen] = useState(false);
  const openStay = data.nicu.find((x) => !x.outcome && !x.cancelled);
  return (
    <section className="card" aria-labelledby="nc-nicu">
      <div className="item-editor-head">
        <h2 id="nc-nicu">NICU admission (NEO-F-03)</h2>
        <span className="row">
          <Link to="/nicu-board" className="btn btn-link">
            Unit board
          </Link>
          <Link to="/nicu-register" className="btn btn-link">
            The register
          </Link>
          {data.access.write && !openStay && !open && (
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
              Admit to the NICU
            </button>
          )}
        </span>
      </div>
      {open && (
        <AdmitForm
          patientId={patientId}
          reasons={data.rules.f03.reasons}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            reload();
          }}
        />
      )}
      {!data.nicu.length && !open && <p className="muted">Not admitted to the NICU.</p>}
      <ul className="plain-list stack">
        {data.nicu.map((n) =>
          n.format === 'f03' ? (
            <NicuAdmissionCard key={n.id} n={n} baby={baby} data={data} reload={reload} />
          ) : (
            <li key={n.id} className={n.cancelled ? 'muted' : undefined}>
              <span className="row">
                <StatusPill tone={n.outcome ? (n.outcome.result === 'died' ? 'inactive' : 'stable') : 'due'}>{n.outcome ? (data.rules.outcomes[n.outcome.result] ?? n.outcome.result) : 'Admitted now'}</StatusPill>
                <strong>{`${n.registerLabel} · ${n.unitName} · ${formatDateTime(n.admittedAt)}`}</strong>
                {n.cold && (
                  <StatusPill tone="watch" icon={Thermometer}>
                    {`Cold at admission – ${n.temperatureC} °C`}
                  </StatusPill>
                )}
              </span>
              <span className="ca-group-words">{`Recorded before the NEO-F-03 form (DRAFT of 6 Nov 2026) · ${n.sourceWords} · ${n.reasons.map((r) => NICU_REASONS[r] ?? r).join(', ')}${n.stayDays != null ? ` · ${n.stayDays} days` : ''}`}</span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
