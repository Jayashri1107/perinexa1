import { useState } from 'react';
import { CircleAlert, CircleCheck, Clock, History, TriangleAlert } from 'lucide-react';
import { ManualPrint } from '../../components/print/ManualPage.jsx';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { AVPU, CHOICE_ROWS, CONTEXTS, FUNDUS, LOCHIA, MEOWS_FORM, MEOWS_PARAMETERS, MEOWS_SOURCE, ORDERABLE_FREQUENCIES, WOUND, bandOf, meowsResult, toCelsius } from './meowsRules.js';

// The MEOWS chart of a stay (Clinical Requirements Group B, item 8 – OBG-F-05 v1.0): the header (context, ordered
// frequency – a doctor's order), when the next set is due and whether it is overdue (E4), banners for a hypertensive
// emergency and a shock index of 0.9 or more (E3), the escalation tasks still open (E1, E2) with the pathway choices,
// and the form – each reading coloured as it is typed (red, amber or normal, always with its word and icon). Below:
// every set of this stay, newest first, with the late-entry badge (PX-X-04). Printed A4 landscape, 12 sets per sheet.

const pad = (n) => String(n).padStart(2, '0');
const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nowLocal = () => toLocal(new Date());
const iso = (local) => (local ? new Date(local).toISOString() : '');
export const BAND_LOOK = {
  red: { tone: 'high', icon: TriangleAlert, word: 'Red' },
  amber: { tone: 'watch', icon: CircleAlert, word: 'Amber' },
  yellow: { tone: 'watch', icon: CircleAlert, word: 'Amber' }, // sets saved before OBG-F-05 (CEMACH "yellow")
  normal: { tone: 'stable', icon: CircleCheck, word: 'Normal' },
};
export const LEVEL_LOOK = {
  trigger: { tone: 'high', icon: TriangleAlert, word: 'Trigger – tell the doctor now' },
  watch: { tone: 'watch', icon: CircleAlert, word: 'Watch – repeat observations sooner' },
  normal: { tone: 'stable', icon: CircleCheck, word: 'No trigger' },
};
const RULE_WORDS = {
  E1: 'E1 – resident at the bedside within 30 min, repeat observations within 30 min, consultant informed',
  E2: 'E2 – consultant at the bedside, anaesthetist informed',
  E3: 'E3 – shock index 0.9 or more',
};
const EMPTY = { rr: '', spo2: '', temp: '', tempUnit: 'C', sbp: '', dbp: '', hr: '', avpu: '', urine4h: '', confusion: '', pain: '', lochia: '', fundus: '', wound: '', nurseConcern: '', actionTaken: '', doctorInformedAt: '', note: '' };
const yes = (v) => (v === 'yes' ? true : v === 'no' ? false : null);
const minutesWord = (m) => (m >= 60 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);
const DAY = 24 * 3_600_000;

/** A reading with its band: the value, and for red or amber a pill with the word. */
export function Reading({ value, band, unit = '' }) {
  if (value == null || value === '') return <span className="muted">–</span>;
  const look = BAND_LOOK[band];
  if (!look || band === 'normal') return <span>{`${value}${unit}`}</span>;
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {`${value}${unit} · ${look.word}`}
    </StatusPill>
  );
}

export function LateEntry({ entry }) {
  if (!entry.lateEntry) return null;
  return (
    <StatusPill tone="watch" icon={History} title={`Typed ${formatDateTime(entry.enteredAt)}`}>
      Late entry
    </StatusPill>
  );
}

/** The PPH chart is suggested on E3 for a mother after birth (postnatal, within 24 h of birth when that is known). */
export function suggestPph(entry, { header, copied, careType }) {
  if (!entry?.escalation?.includes('E3')) return false;
  const postnatal = header ? header.context === 'postnatal' : careType === 'postnatal';
  if (!postnatal) return false;
  if (!copied?.deliveredAt) return true;
  return new Date(entry.at) - new Date(copied.deliveredAt) <= DAY;
}

const choiceText = (key, v) => (v == null ? null : key === 'avpu' ? v : key === 'lochia' ? LOCHIA[v] : key === 'fundus' ? FUNDUS[v] : key === 'wound' ? WOUND[v] : v === true ? 'Yes' : v === false ? 'No' : v);

function TimeDialog({ id, title, label, intro, onSave, onCancel }) {
  const [at, setAt] = useState(nowLocal);
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await onSave(iso(at));
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id={id} title={title} submitLabel="Save" onSubmit={submit} onCancel={onCancel}>
      {intro && <p>{intro}</p>}
      <Alert type="error">{error?.message}</Alert>
      <Field label={label} id={`${id}-at`} error={Object.values(error?.fields ?? {})[0]}>
        <DateTimeInput id={`${id}-at`} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function CancelDialog({ entry, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/meows/${entry.id}/cancel`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="mw-cancel" title="Mark as entered in error" submitLabel="Mark as entered in error" onSubmit={submit} onCancel={onCancel}>
      <p>{`The observations of ${formatDateTime(entry.at)} stay on the chart, struck through, with your reason.`}</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Why" id="mw-reason" error={error?.fields?.reason}>
        <input id="mw-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

/** The header form (a doctor's order): context, detail, diagnosis, frequency, blood loss at delivery, LMWH. */
function HeaderForm({ patient, admissionId, header, copied, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({
    context: header?.context ?? (Object.keys(CONTEXTS).includes(patient.careType) ? patient.careType : ''),
    contextDetail: header?.contextDetail ?? '',
    diagnosis: header?.diagnosis ?? '',
    frequencyMinutes: header?.frequencyMinutes ?? '',
    bloodLossMl: header?.bloodLossMl ?? copied?.bloodLossMl ?? '',
    lmwhPrescribed: header?.lmwhPrescribed ?? copied?.lmwh ?? false,
  }));
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async () => {
    try {
      await api('/meows/chart', { method: 'PUT', body: { ...f, patientId: patient.id, admissionId, frequencyMinutes: Number(f.frequencyMinutes) || 0, bloodLossMl: f.bloodLossMl } });
      onSaved();
    } catch (err) {
      setError(err);
    }
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <FormDialog id="mw-header" title={header ? 'Change the chart header' : 'Start the MEOWS chart'} submitLabel="Save the header" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <div className="form-grid">
        <Field label="Context" id="mw-context" error={fe('context')}>
          <select id="mw-context" value={f.context} onChange={set('context')}>
            <option value="">Choose</option>
            {Object.entries(CONTEXTS).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Detail (e.g. GA 34 wk, postnatal day 2, post-op day 1)" id="mw-detail" error={fe('contextDetail')}>
          <input id="mw-detail" maxLength={150} value={f.contextDetail} onChange={set('contextDetail')} />
        </Field>
        <Field label="Diagnosis or procedure" id="mw-diag" error={fe('diagnosis')}>
          <input id="mw-diag" maxLength={300} value={f.diagnosis} onChange={set('diagnosis')} />
        </Field>
        <Field label="Observations ordered every" id="mw-freq" error={fe('frequencyMinutes')}>
          <select id="mw-freq" value={f.frequencyMinutes} onChange={set('frequencyMinutes')}>
            <option value="">Choose</option>
            {[...new Set([...ORDERABLE_FREQUENCIES, ...(header?.frequencyMinutes ? [header.frequencyMinutes] : [])])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {minutesWord(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Blood loss at delivery (mL)" id="mw-loss" error={fe('bloodLossMl')} hint={copied?.bloodLossMl != null ? `From the signed delivery note: ${copied.bloodLossMl} mL` : 'No signed delivery note on this stay'}>
          <input id="mw-loss" inputMode="numeric" value={f.bloodLossMl} onChange={set('bloodLossMl')} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={Boolean(f.lmwhPrescribed)} onChange={set('lmwhPrescribed')} /> LMWH prescribed
          {copied?.lmwh != null && <span className="hint">{` (VTE score: ${copied.lmwh ? 'LMWH indicated' : 'not high risk'})`}</span>}
        </label>
      </div>
    </FormDialog>
  );
}

/** Open escalation: tasks not done yet, the pathway of a trigger, the antibiotic and antihypertensive times. */
function EscalationPanel({ entries, canWrite, onChanged }) {
  const [asking, setAsking] = useState(null); // { entry, kind: 'task' | 'antibiotic' | 'antihypertensive', key?, label }
  const [error, setError] = useState(null);
  const recent = entries.filter((e) => !e.cancelled && (e.tasks.some((t) => !t.doneAt) || (e.level === 'trigger' && !e.pathway && Date.now() - new Date(e.at) < DAY) || (e.pathway?.key === 'sepsis' && !e.antibioticAt) || (e.hypertensiveEmergency && !e.antihypertensiveAt && Date.now() - new Date(e.at) < DAY)));
  if (!recent.length) return null;
  const choose = async (e, pathway) => {
    try {
      setError(null);
      await api(`/meows/${e.id}/follow-up`, { method: 'POST', body: { pathway } });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };
  const save = async (atIso) => {
    const { entry, kind, key } = asking;
    if (kind === 'task') await api(`/meows/${entry.id}/tasks/${key}`, { method: 'POST', body: { at: atIso } });
    else await api(`/meows/${entry.id}/follow-up`, { method: 'POST', body: { [kind === 'antibiotic' ? 'antibioticAt' : 'antihypertensiveAt']: atIso } });
    setAsking(null);
    onChanged();
  };
  return (
    <div className="stack">
      <h3>Escalation</h3>
      <Alert type="error">{error}</Alert>
      <ul className="stack">
        {recent.map((e) => (
          <li key={e.id} className="card">
            <p>
              <StatusPill tone="high" icon={TriangleAlert}>
                {`${formatDateTime(e.at)} · ${e.escalation.join(', ') || 'Trigger'}`}
              </StatusPill>{' '}
              {e.e2Reason === 'no_improvement' && <span className="hint">E1 open 60 minutes without improvement.</span>}
            </p>
            {e.tasks
              .filter((t) => !t.doneAt)
              .map((t) => {
                const late = new Date(t.dueAt) < Date.now();
                return (
                  <p key={t.key} className="row">
                    <StatusPill tone={late ? 'high' : 'due'} icon={Clock}>
                      {`${t.label} · ${late ? 'overdue since' : 'due by'} ${formatDateTime(t.dueAt)}`}
                    </StatusPill>
                    {canWrite && (
                      <button type="button" className="btn btn-link btn-sm" onClick={() => setAsking({ entry: e, kind: 'task', key: t.key, label: `${t.label}: time` })}>
                        Mark done
                      </button>
                    )}
                  </p>
                );
              })}
            {e.level === 'trigger' && !e.pathway && canWrite && (
              <p className="row">
                <span>{e.escalation.includes('E2') ? 'Suggested pathways (choose one); offer HDU transfer:' : 'Pathway, if one applies:'}</span>
                <button type="button" className="btn btn-link btn-sm" onClick={() => choose(e, 'sepsis')}>
                  Sepsis six (OBG-ALG-07)
                </button>
                <a className="btn btn-link btn-sm" href="#pph-title" onClick={() => choose(e, 'pph')}>
                  PPH (OBG-ALG-01)
                </a>
                <button type="button" className="btn btn-link btn-sm" onClick={() => choose(e, 'severe_htn')}>
                  Severe hypertension (OBG-ALG-02)
                </button>
              </p>
            )}
            {e.pathway && <p className="hint">{`Pathway: ${e.pathway.label} (${e.pathway.code}) – ${e.pathway.byName}, ${formatDateTime(e.pathway.at)}`}</p>}
            {e.pathway?.key === 'sepsis' && !e.antibioticAt && canWrite && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setAsking({ entry: e, kind: 'antibiotic', label: 'First antibiotic given at' })}>
                Record the first antibiotic’s time
              </button>
            )}
            {e.hypertensiveEmergency && !e.antihypertensiveAt && canWrite && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setAsking({ entry: e, kind: 'antihypertensive', label: 'Antihypertensive given at' })}>
                Record the antihypertensive’s time
              </button>
            )}
          </li>
        ))}
      </ul>
      {asking && <TimeDialog id="mw-time" title={asking.label} label="Time" intro={`Observations of ${formatDateTime(asking.entry.at)}.`} onSave={save} onCancel={() => setAsking(null)} />}
    </div>
  );
}

const BAND_WORDS = { red: 'red', amber: 'amber', yellow: 'amber' };
/** One reading as printed: the value, and its band in words when it is not normal (the printout may be black and white). */
const printed = (v, band, unit = '') => (v == null || v === '' ? '' : `${v}${unit}${BAND_WORDS[band] ? ` (${BAND_WORDS[band]})` : ''}`);
export const PRINT_COLUMNS = 12;

/** The footer of every printed page: "OBG-F-05 · v1.0 · effective <date>" from the version in force. */
export const meowsFooter = (form) => `${form?.code ?? MEOWS_FORM.code} · v${form?.version ?? MEOWS_FORM.version} · effective ${form?.effectiveFrom ? formatDate(form.effectiveFrom) : 'date not in the document register'}`;

/**
 * The chart as printed on OBG-F-05 (PX-X-03): A4 landscape, oldest first, 12 sets per sheet; rows are the page's
 * parameters with their RED and AMBER limits, then the totals, action and signature rows. Each band in words.
 */
export function MeowsPrint({ patient, header, entries }) {
  const sets = [...entries].reverse();
  const sheets = [];
  for (let i = 0; i < Math.max(sets.length, 1); i += PRINT_COLUMNS) sheets.push(sets.slice(i, i + PRINT_COLUMNS));
  const cell = (e, k, render) => (e ? render(e) : '');
  const rows = [
    ...MEOWS_PARAMETERS.map((p) => ({ key: p.key, label: `${p.label} (${p.unit})`, red: p.redText, amber: p.amberText, value: (e) => printed(e.values[p.key], e.bands[p.key]) })),
    { key: 'avpu', label: CHOICE_ROWS[0].label, red: CHOICE_ROWS[0].redText, amber: CHOICE_ROWS[0].amberText, value: (e) => [printed(e.values.avpu, e.bands.avpu), e.values.confusion ? 'new confusion' : ''].filter(Boolean).join(', ') },
    { key: 'lochia', label: CHOICE_ROWS[1].label, red: CHOICE_ROWS[1].redText, amber: '', value: (e) => printed(choiceText('lochia', e.values.lochia), e.bands.lochia) },
    { key: 'fundus', label: CHOICE_ROWS[2].label, red: CHOICE_ROWS[2].redText, amber: '', value: (e) => printed(choiceText('fundus', e.values.fundus), e.bands.fundus) },
    { key: 'wound', label: 'Wound / perineum', red: '', amber: '', value: (e) => choiceText('wound', e.values.wound) ?? '' },
    { key: 'nurseConcern', label: CHOICE_ROWS[3].label, red: CHOICE_ROWS[3].redText, amber: '', value: (e) => printed(choiceText('nurseConcern', e.values.nurseConcern), e.bands.nurseConcern) },
    { key: 'si', label: 'Shock index (pulse ÷ systolic)', red: '≥0.9', amber: '', value: (e) => (e.shockIndex == null ? '' : `${e.shockIndex.toFixed(2)}${e.shockIndex >= 0.9 ? ' (red)' : ''}`) },
  ];
  return (
    <>
      {sheets.map((sheet, n) => {
        const cols = Array.from({ length: PRINT_COLUMNS }, (_, i) => sheet[i] ?? null);
        return (
          <section key={n} className="mw-sheet">
            <h2>{`MEOWS chart (${MEOWS_FORM.code}) · ${patient.fullName} · ${patient.mrn}${sheets.length > 1 ? ` · sheet ${n + 1} of ${sheets.length}` : ''}`}</h2>
            <p>
              {[
                `Context: ${header ? CONTEXTS[header.context] : '–'}${header?.contextDetail ? ` (${header.contextDetail})` : ''}`,
                `Diagnosis / procedure: ${header?.diagnosis || '–'}`,
                `Observations every: ${header?.frequencyMinutes ? minutesWord(header.frequencyMinutes) : 'not ordered'}`,
                `Blood loss at delivery: ${header?.bloodLossMl != null ? `${header.bloodLossMl} mL` : '–'}`,
                `LMWH: ${header?.lmwhPrescribed ? 'prescribed' : 'no'}`,
              ].join(' · ')}
            </p>
            <table className="mp-table mw-print">
              <thead>
                <tr>
                  <th scope="col" className="mw-param">
                    Parameter
                  </th>
                  <th scope="col" className="mw-limit">
                    RED
                  </th>
                  <th scope="col" className="mw-limit">
                    AMBER
                  </th>
                  {cols.map((e, i) => (
                    <th key={i} scope="col">
                      {e ? `${formatDateTime(e.at)}${e.lateEntry ? ' · Late entry' : ''}` : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td>{r.red}</td>
                    <td>{r.amber}</td>
                    {cols.map((e, i) => (
                      <td key={i}>{cell(e, r.key, (x) => (x.cancelled ? '' : r.value(x)))}</td>
                    ))}
                  </tr>
                ))}
                <tr className="mw-band">
                  <th scope="row">Totals</th>
                  <td colSpan={2}>Red · amber</td>
                  {cols.map((e, i) => (
                    <td key={i}>{cell(e, 'tot', (x) => (x.cancelled ? 'Entered in error' : x.reds == null ? '' : `${x.reds} red · ${x.ambers} amber`))}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Action</th>
                  <td colSpan={2}>E1–E3</td>
                  {cols.map((e, i) => (
                    <td key={i}>
                      {cell(e, 'act', (x) =>
                        x.cancelled
                          ? x.cancelled.reason
                          : [x.escalation.join(', '), x.actionTaken, x.escalatedTo && `told ${x.escalatedTo}`, x.doctorInformedAt && `doctor informed ${formatDateTime(x.doctorInformedAt)}`, x.hypertensiveEmergency && 'hypertensive emergency']
                              .filter(Boolean)
                              .join('; '),
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Signature</th>
                  <td colSpan={2}>Recorded by</td>
                  {cols.map((e, i) => (
                    <td key={i}>{cell(e, 'by', (x) => x.byName)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}

export function MeowsChart({ patient, admissionId }) {
  const { data, error, reload } = useFetch(patient.careType === 'newborn' ? null : '/meows', { patientId: patient.id, admissionId });
  const [form, setForm] = useState(EMPTY);
  const [at, setAt] = useState(nowLocal);
  const [requestId, setRequestId] = useState(newRequestId);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [editingHeader, setEditingHeader] = useState(false);
  if (patient.careType === 'newborn') return null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const tempC = form.temp === '' ? '' : form.tempUnit === 'F' ? toCelsius(form.temp) : Number(form.temp);
  const live = meowsResult({ ...form, tempC, confusion: yes(form.confusion), nurseConcern: yes(form.nurseConcern), avpu: form.avpu || null, lochia: form.lochia || null, fundus: form.fundus || null });
  const typed = Object.entries(form).some(([k, v]) => !['tempUnit', 'actionTaken', 'doctorInformedAt', 'note', 'wound'].includes(k) && v !== '') || form.wound !== '';
  const fe = (k) => result?.error?.fields?.[k];
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/meows', { method: 'POST', body: { ...form, doctorInformedAt: iso(form.doctorInformedAt), clientRequestId: requestId, patientId: patient.id, admissionId, at: iso(at) } });
      const esc = res.entry.escalation.length ? ` ${res.entry.escalation.join(', ')}: the RMOs and her consultant were told through the bell.` : '';
      setResult({ text: `Saved: ${LEVEL_LOOK[res.entry.level].word}.${esc}` });
      setForm(EMPTY);
      setAt(nowLocal());
      setRequestId(newRequestId());
      reload();
    } catch (err) {
      setResult({ error: err });
    }
    setBusy(false);
  };
  const latest = data?.latest;
  const header = data?.header;
  const status = data?.status;
  const num = (k, label, unit) => (
    <Field label={`${label} (${unit})`} id={`mw-${k}`} error={fe(k)}>
      <input id={`mw-${k}`} inputMode="decimal" value={form[k]} onChange={set(k)} />
    </Field>
  );
  const pick = (k, label, options, blank = 'Not recorded') => (
    <Field label={label} id={`mw-${k}`} error={fe(k)}>
      <select id={`mw-${k}`} value={form[k]} onChange={set(k)}>
        <option value="">{blank}</option>
        {Object.entries(options).map(([v, w]) => (
          <option key={v} value={v}>
            {w}
          </option>
        ))}
      </select>
    </Field>
  );
  const ctx = { header, copied: data?.copied, careType: patient.careType };

  return (
    <section className="card" aria-labelledby="mw-title">
      <div className="item-editor-head">
        <h2 id="mw-title">{`MEOWS chart (${MEOWS_FORM.code})`}</h2>
        {latest && (
          <StatusPill tone={LEVEL_LOOK[latest.level].tone} icon={LEVEL_LOOK[latest.level].icon}>
            {`Latest (${formatDateTime(latest.at)}): ${LEVEL_LOOK[latest.level].word}`}
          </StatusPill>
        )}
      </div>
      <Alert type="error">{error ?? result?.error?.message}</Alert>
      {result?.text && (
        <Alert type="success" onClose={() => setResult(null)}>
          {result.text}
        </Alert>
      )}

      {data && (
        <div className="stack">
          <p>
            {header
              ? [
                  `${CONTEXTS[header.context]}${header.contextDetail ? ` (${header.contextDetail})` : ''}`,
                  header.diagnosis,
                  `observations every ${minutesWord(header.frequencyMinutes)}`,
                  header.bloodLossMl != null && `blood loss at delivery ${header.bloodLossMl} mL${header.bloodLossFrom === 'delivery_note' ? ' (delivery note)' : ''}`,
                  header.lmwhPrescribed && 'LMWH prescribed',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'The chart header is not set: the doctor orders the context and how often to observe.'}{' '}
            {data.access.order && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setEditingHeader(true)}>
                {header ? 'Change' : 'Start the chart'}
              </button>
            )}
          </p>
          {status?.dueAt && (
            <p>
              {status.overdue ? (
                <StatusPill tone="high" icon={Clock}>{`Overdue – observations were due ${formatDateTime(status.dueAt)}`}</StatusPill>
              ) : (
                <StatusPill tone="due" icon={Clock}>{`Next observations due ${formatDateTime(status.dueAt)}`}</StatusPill>
              )}
            </p>
          )}
          {status?.e2Due && <Alert type="error">E1 has been open for 60 minutes without improvement: escalate to E2 – consultant at the bedside, anaesthetist informed.</Alert>}
          {latest?.hypertensiveEmergency && (
            <Alert type="critical">{`Hypertensive emergency (${formatDateTime(latest.at)}): systolic 160 or more or diastolic 110 or more – treat within 30 minutes (OBG-SOP-03; OBG-F-15).`}</Alert>
          )}
          {latest?.escalation.includes('E3') && (
            <Alert type="critical">
              {`Shock index ≥ 0.9 (${latest.shockIndex.toFixed(2)}): significant haemorrhage even if blood is not visible.`}
              {suggestPph(latest, ctx) && (
                <>
                  {' '}
                  <a href="#pph-title">Consider the PPH chart (below)</a>
                </>
              )}
            </Alert>
          )}
          <EscalationPanel entries={data.entries} canWrite={data.access.write} onChanged={reload} />
        </div>
      )}

      {data?.access.write && (
        <form className="stack" onSubmit={save}>
          <h3>Add observations</h3>
          <div className="form-grid">
            <Field label="Clinical time (when they were taken)" id="mw-at" error={fe('at')}>
              <DateTimeInput id="mw-at" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
            {num('rr', 'Respiratory rate', '/min')}
            {num('spo2', 'SpO2', '%')}
            <Field label="Temperature" id="mw-temp" error={fe('temp')}>
              <span className="weight-input">
                <input id="mw-temp" inputMode="decimal" value={form.temp} onChange={set('temp')} />
                <select aria-label="Temperature unit" value={form.tempUnit} onChange={set('tempUnit')}>
                  <option value="C">°C</option>
                  <option value="F">°F</option>
                </select>
              </span>
            </Field>
            {num('hr', 'Pulse', '/min')}
            {num('sbp', 'Systolic BP', 'mmHg')}
            {num('dbp', 'Diastolic BP', 'mmHg')}
            {num('urine4h', 'Urine in 4 h (catheterised)', 'mL')}
            {pick('avpu', 'Consciousness (AVPU)', Object.fromEntries(Object.entries(AVPU).map(([k, w]) => [k, `${k} – ${w}`])))}
            {pick('confusion', 'New confusion', { no: 'No', yes: 'Yes' })}
            {num('pain', 'Pain score', '0–10')}
            {pick('lochia', 'Lochia / PV loss', LOCHIA)}
            {pick('fundus', 'Fundus', FUNDUS)}
            {pick('wound', 'Wound / perineum', WOUND)}
            {pick('nurseConcern', 'Nurse concern', { no: 'No', yes: 'Yes' })}
          </div>
          {typed && (
            <div className="ip-derived" aria-live="polite">
              <p>
                <StatusPill tone={LEVEL_LOOK[live.level].tone} icon={LEVEL_LOOK[live.level].icon}>
                  {LEVEL_LOOK[live.level].word}
                </StatusPill>{' '}
                {`${live.reds} red, ${live.ambers} amber`}
                {live.shockIndex != null ? ` · shock index ${live.shockIndex.toFixed(2)}${live.shockIndexRed ? ' (red)' : ''}` : ''}
                {live.missing.length ? ` · not recorded: ${live.missing.map((k) => (k === 'avpu' ? 'AVPU' : MEOWS_PARAMETERS.find((p) => p.key === k).label)).join(', ')}` : ''}
              </p>
              {live.escalation.map((r) => (
                <p key={r}>
                  <StatusPill tone="high" icon={TriangleAlert}>
                    {RULE_WORDS[r]}
                  </StatusPill>
                </p>
              ))}
              {live.hypertensiveEmergency && (
                <p>
                  <StatusPill tone="high" icon={TriangleAlert}>
                    Hypertensive emergency – treat within 30 minutes
                  </StatusPill>
                </p>
              )}
              {form.tempUnit === 'F' && form.temp !== '' && <p className="hint">{`${form.temp} °F = ${tempC} °C`}</p>}
            </div>
          )}
          <div className="form-grid">
            <Field label={live.level === 'trigger' ? 'Action taken (needed for a trigger)' : 'Action taken'} id="mw-action" error={fe('actionTaken')}>
              <input id="mw-action" maxLength={1000} value={form.actionTaken} onChange={set('actionTaken')} />
            </Field>
            <Field label="Doctor informed at" id="mw-informed" error={fe('doctorInformedAt')}>
              <DateTimeInput id="mw-informed" value={form.doctorInformedAt} onChange={set('doctorInformedAt')} />
            </Field>
            <Field label="Note (optional)" id="mw-note" error={fe('note')}>
              <input id="mw-note" maxLength={1000} value={form.note} onChange={set('note')} />
            </Field>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-secondary" disabled={busy || !typed}>
              {busy ? 'Saving…' : 'Save the observations'}
            </button>
          </div>
        </form>
      )}
      <h3>Observations of this stay</h3>
      {data?.entries.length > 0 && (
        <div className="row">
          <ManualPrint screen="meows" on={String(data.entries[data.entries.length - 1].at).slice(0, 10)} title="MEOWS chart" page={{ size: 'A4 landscape' }} footer={meowsFooter}>
            <MeowsPrint patient={patient} header={header} entries={data.entries} />
          </ManualPrint>
        </div>
      )}
      {data && !data.entries.length && <p className="muted">No observations yet.</p>}
      {data?.entries.length > 0 && (
        <div className="an-table-wrap">
          <table className="ca-table">
            <thead>
              <tr>
                <th scope="col">Clinical time</th>
                {MEOWS_PARAMETERS.map((p) => (
                  <th key={p.key} scope="col">
                    {`${p.label} (${p.unit})`}
                  </th>
                ))}
                <th scope="col">AVPU</th>
                <th scope="col">Postnatal</th>
                <th scope="col">Shock index</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className={e.cancelled ? 'ca-empty' : undefined}>
                  <td data-label="Clinical time">
                    {formatDateTime(e.at)} <LateEntry entry={e} />
                    <span className="ca-group-words">{e.byName}</span>
                  </td>
                  {MEOWS_PARAMETERS.map((p) => (
                    <td key={p.key} data-label={p.label}>
                      <Reading value={e.values[p.key]} band={e.bands[p.key]} />
                    </td>
                  ))}
                  <td data-label="AVPU">
                    <Reading value={[e.values.avpu, e.values.confusion ? 'new confusion' : null].filter(Boolean).join(', ') || null} band={e.bands.avpu} />
                  </td>
                  <td data-label="Postnatal">
                    {[
                      ['lochia', 'Lochia'],
                      ['fundus', 'Fundus'],
                      ['wound', 'Wound'],
                      ['nurseConcern', 'Nurse concern'],
                    ]
                      .filter(([k]) => e.values[k] != null)
                      .map(([k, w]) => (
                        <span key={k} className="ca-group-words">
                          {`${w}: `}
                          <Reading value={choiceText(k, e.values[k])} band={e.bands[k]} />
                        </span>
                      ))}
                  </td>
                  <td data-label="Shock index">
                    <Reading value={e.shockIndex == null ? null : e.shockIndex.toFixed(2)} band={e.shockIndex >= 0.9 ? 'red' : 'normal'} />
                  </td>
                  <td data-label="Result">
                    {e.cancelled ? (
                      <span>{`Entered in error: ${e.cancelled.reason}`}</span>
                    ) : (
                      <>
                        <StatusPill tone={LEVEL_LOOK[e.level].tone} icon={LEVEL_LOOK[e.level].icon}>
                          {LEVEL_LOOK[e.level].word.split(' – ')[0]}
                        </StatusPill>
                        {e.reds != null && <span className="ca-group-words">{`${e.reds} red, ${e.ambers} amber${e.escalation.length ? ` · ${e.escalation.join(', ')}` : ''}`}</span>}
                        {e.actionTaken && <span className="ca-group-words">{`Action: ${e.actionTaken}`}</span>}
                        {e.escalatedTo && <span className="ca-group-words">{`Told ${e.escalatedTo}`}</span>}
                        {e.doctorInformedAt && <span className="ca-group-words">{`Doctor informed ${formatDateTime(e.doctorInformedAt)}`}</span>}
                        {e.tasks.filter((t) => t.doneAt).map((t) => (
                          <span key={t.key} className="ca-group-words">{`${t.label}: ${formatDateTime(t.doneAt)} (${t.byName})`}</span>
                        ))}
                        {e.antibioticAt && <span className="ca-group-words">{`First antibiotic ${formatDateTime(e.antibioticAt.at)}`}</span>}
                        {e.antihypertensiveAt && <span className="ca-group-words">{`Antihypertensive ${formatDateTime(e.antihypertensiveAt.at)}`}</span>}
                        {e.note && <span className="ca-group-words">{e.note}</span>}
                        {data.access.write && (
                          <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling(e)}>
                            Entered in error
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{`${MEOWS_FORM.code} v${MEOWS_FORM.version}. One red or two amber readings (nurse concern counts as one red): tell the doctor now. Source: ${MEOWS_SOURCE}.`}</p>
      {editingHeader && (
        <HeaderForm
          patient={patient}
          admissionId={admissionId}
          header={header}
          copied={data?.copied}
          onCancel={() => setEditingHeader(false)}
          onSaved={() => {
            setEditingHeader(false);
            reload();
          }}
        />
      )}
      {cancelling && (
        <CancelDialog
          entry={cancelling}
          onCancel={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

export { bandOf };
