// The prescription of a visit: the medicines (form, strength, dose, how often, when, how long), a ready-made set from
// the Clinic library as a starting point (approved sets only), and the medicine safety warnings. Going ahead despite an
// Avoid or Allergy warning needs a one-line reason, kept with the visit and never printed.
import { CircleCheck, Clock, Moon, Pencil, Plus, Printer, Send, Sun, Sunrise, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { visitsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { DURATION_UNITS, FORMS, FREQUENCIES, ROUTES, TIMINGS, WARNING_LOOKS, needsReason, options, rxLine } from './visitFormat.js';

const EMPTY = { drug: '', form: 'tab', strength: '', dose: '1', frequency: '1-0-1', frequencyText: '', timing: 'after_food', route: '', durationValue: '', durationUnit: 'days', instructions: '' };
const FORM_OPTIONS = Object.entries(FORMS).map(([value, label]) => ({ value, label: label || 'Other' }));

function Warnings({ warnings, reasons, setReason, asking }) {
  if (!warnings.length) return null;
  return (
    <ul className="plain-list flag-list">
      {warnings.map((w) => (
        <li key={w.key}>
          <StateBadge look={WARNING_LOOKS[w.level]} small /> <strong>{w.title}</strong> <span className="muted small">({w.medicines.join(', ')})</span>
          <span className="block small">{w.message}{w.unsureWeeks && ' (weeks of pregnancy not known)'}</span>
          {asking && needsReason(w) && (
            <input className="full-textarea top-gap-sm" aria-label={`Reason to go ahead: ${w.title}`} placeholder="Reason to go ahead (required)" value={reasons[w.key] ?? ''} maxLength={300} onChange={(e) => setReason(w.key, e.target.value)} />
          )}
        </li>
      ))}
    </ul>
  );
}

// When to take it (owner, 8 Oct 2026): three buttons – Morning, Afternoon, Night – make the 1-0-1 code; "Other" for
// SOS, once now, weekly, alternate days or the doctor's own words (a select appears).
const SLOTS = [
  { icon: Sunrise, word: 'Morning' },
  { icon: Sun, word: 'Afternoon' },
  { icon: Moon, word: 'Night' },
];
function DoseTimes({ value, onChange, n }) {
  const pattern = /^\d-\d-\d$/.test(value) ? value.split('-').map(Number) : null;
  const toggle = (k) => {
    const next = (pattern ?? [0, 0, 0]).map((x, j) => (j === k ? (x ? 0 : 1) : x));
    if (next.some(Boolean)) onChange(next.join('-'));
  };
  return (
    <div className="dose-times" role="group" aria-label={`When to take medicine ${n}`}>
      {SLOTS.map(({ icon: Icon, word }, k) => (
        <button key={word} type="button" className={pattern?.[k] ? 'on' : ''} aria-pressed={Boolean(pattern?.[k])} title={word} onClick={() => toggle(k)}>
          <Icon size={14} aria-hidden /> {word}
        </button>
      ))}
      <button type="button" className={pattern ? '' : 'on'} aria-pressed={!pattern} onClick={() => !pattern || onChange('sos')}>Other</button>
    </div>
  );
}

// Where the prescription is with the pharmacy: waiting there, or given (sold at the counter, or given another way).
const PHARMACY_LOOKS = {
  sent: { tone: 'pending', icon: Clock, word: 'Waiting at the pharmacy' },
  given: { tone: 'active', icon: CircleCheck, word: 'Given by the pharmacy' },
};

function PharmacyStatus({ pharmacy, canSend, sending, onSend, printHref }) {
  const look = PHARMACY_LOOKS[pharmacy?.status];
  return (
    <div className="rx-pharmacy">
      <span className="rx-pharmacy-state">
        {look ? (
          <>
            <StateBadge look={look} />
            <span className="muted small">
              {pharmacy.status === 'given'
                ? `${pharmacy.givenByName}, ${formatDateTime(pharmacy.givenAt)}${pharmacy.invoiceNumber ? ` · invoice ${pharmacy.invoiceNumber}` : ''}`
                : `Sent by ${pharmacy.sentByName}, ${formatDateTime(pharmacy.sentAt)}`}
            </span>
          </>
        ) : (
          <span className="muted small">Ready: send it to the pharmacy, or print it for her.</span>
        )}
      </span>
      <span className="rx-actions">
        <a className="btn btn-ghost btn-sm" href={printHref} target="_blank" rel="noreferrer"><Printer size={14} aria-hidden /> Print</a>
        {canSend && (
          <button type="button" className={`btn ${look ? 'btn-ghost' : 'btn-accent'} btn-sm`} disabled={sending} onClick={onSend}>
            <Send size={14} aria-hidden /> {sending ? 'Sending…' : look ? 'Send again' : 'Send to pharmacy'}
          </button>
        )}
      </span>
    </div>
  );
}

// autoEdit: opened with "Write prescription" from her record – the form opens at once (with one empty row).
export function PrescriptionPart({ visit, careType, checks, editable, canSend, save, onSaved, autoEdit = false }) {
  const rx = visit.prescription;
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const send = async () => {
    if (visit.pharmacy?.status === 'sent' && !window.confirm('It is already waiting at the pharmacy. Send it again with the medicines as they are now?')) return;
    setSending(true);
    setSendError('');
    try {
      onSaved(await visitsApi.sendToPharmacy(visit.patientId, visit.id));
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };
  const [draft, setDraft] = useState(null);
  const [sets, setSets] = useState([]);
  const [asking, setAsking] = useState([]); // warnings that need a reason, from the last save
  const [reasons, setReasons] = useState({});
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft && editable) visitsApi.sets(careType).then((r) => setSets(r.items)).catch(() => setSets([]));
  }, [draft, editable, careType]);

  const startEditing = () => {
    setDraft({ items: rx.items.map(({ id, ...i }) => ({ ...i, durationValue: i.durationValue ?? '' })), notes: rx.notes ?? '' });
    setReasons(Object.fromEntries((rx.warningReasons ?? []).map((w) => [w.key, w.reason])));
  };
  const opened = useRef(false);
  useEffect(() => {
    if (!autoEdit || !editable || opened.current) return;
    opened.current = true;
    setDraft({ items: rx.items.length ? rx.items.map(({ id, ...i }) => ({ ...i, durationValue: i.durationValue ?? '' })) : [{ ...EMPTY }], notes: rx.notes ?? '' });
    setReasons(Object.fromEntries((rx.warningReasons ?? []).map((w) => [w.key, w.reason])));
    document.getElementById('prescription')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [autoEdit, editable]); // the visit's first answer only
  const setItem = (i, k, v) => setDraft((d) => ({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const addSet = (key) => {
    const set = sets.find((s) => s.key === key);
    if (!set) return;
    setDraft((d) => ({
      items: [...d.items, ...set.items.map((i) => ({ ...EMPTY, ...i, form: FORMS[i.form] !== undefined ? i.form : 'other', durationValue: i.durationValue ?? '' }))],
      notes: [d.notes, set.notes].filter(Boolean).join('\n'),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setFields({});
    try {
      onSaved(await save({ rev: rx.rev, items: draft.items, notes: draft.notes, reasons }));
      setDraft(null);
      setAsking([]);
    } catch (err) {
      if (err.code === 'NEEDS_REASON') setAsking(err.details.warnings ?? []);
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setSaving(false);
    }
  };

  const rowError = (i) => Object.entries(fields).filter(([k]) => k.startsWith(`items.${i}.`)).map(([, m]) => m).join(' ');

  return (
    <section className="card" id="prescription">
      <div className="card-head">
        <h2>Prescription</h2>
        {editable && !draft && <button type="button" className="btn btn-ghost btn-sm" onClick={startEditing}><Pencil size={14} aria-hidden /> {rx.items.length ? 'Change' : 'Write'}</button>}
      </div>
      <p className="muted small">{rx.at ? `Written by ${rx.byName}, ${formatDateTime(rx.at)}` : 'Not written yet'}</p>
      {!checks.medicineSafetyApproved && <p className="muted small">The medicine safety list is still a draft in the Clinic library: no medicine checks until a doctor approves it. Allergies are always checked.</p>}

      {!draft && (
        <>
          {rx.items.length === 0 && <p className="muted">No medicines.</p>}
          <ol className="rx-list">
            {rx.items.map((i) => <li key={i.id}>{rxLine(i)}{i.instructions && <span className="muted block small">{i.instructions}</span>}</li>)}
          </ol>
          {rx.notes && <p className="pre small">{rx.notes}</p>}
          <Warnings warnings={checks.warnings} reasons={{}} setReason={() => {}} asking={false} />
          {rx.warningReasons?.length > 0 && (
            <p className="small muted">Went ahead despite: {rx.warningReasons.map((w) => `${w.title} – “${w.reason}”`).join('; ')}</p>
          )}
          {rx.items.length > 0 && (
            <>
              <PharmacyStatus pharmacy={visit.pharmacy} canSend={canSend} sending={sending} onSend={send} printHref={`/hospital/print/prescription/${visit.patientId}/${visit.id}`} />
              <Alert type="error">{sendError}</Alert>
            </>
          )}
        </>
      )}

      {draft && (
        <form onSubmit={submit} noValidate>
          <Alert type="error">{error}</Alert>
          {asking.length > 0 && <Warnings warnings={asking} reasons={reasons} setReason={(k, v) => setReasons((r) => ({ ...r, [k]: v }))} asking />}
          {sets.length > 0 && (
            <label className="filter top-gap-sm">
              <span>Add a ready-made set</span>
              <select value="" onChange={(e) => addSet(e.target.value)}>
                <option value="">Choose…</option>
                {sets.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </select>
            </label>
          )}
          <div className="table-wrap top-gap-sm">
            <table className="table rx-table">
              <thead>
                <tr><th>Form</th><th>Medicine</th><th>Strength</th><th>Dose</th><th>When to take</th><th>Food</th><th>Route</th><th>For</th><th /><th>Instructions</th><th /></tr>
              </thead>
              <tbody>
                {draft.items.length === 0 && <tr><td colSpan={11} className="empty">No medicines yet.</td></tr>}
                {draft.items.map((it, i) => (
                  <tr key={i}>
                    <td><select aria-label={`Form, medicine ${i + 1}`} value={it.form} onChange={(e) => setItem(i, 'form', e.target.value)}>{FORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
                    <td>
                      <input aria-label={`Medicine ${i + 1}`} value={it.drug} onChange={(e) => setItem(i, 'drug', e.target.value)} />
                      {rowError(i) && <span className="field-error block">{rowError(i)}</span>}
                    </td>
                    <td><input aria-label={`Strength, medicine ${i + 1}`} placeholder="500 mg" value={it.strength} onChange={(e) => setItem(i, 'strength', e.target.value)} /></td>
                    <td><input aria-label={`Dose, medicine ${i + 1}`} value={it.dose} onChange={(e) => setItem(i, 'dose', e.target.value)} /></td>
                    <td>
                      <DoseTimes value={it.frequency} onChange={(f) => setItem(i, 'frequency', f)} n={i + 1} />
                      {!/^\d-\d-\d$/.test(it.frequency) && (
                        <select className="top-gap-sm" aria-label={`How often, medicine ${i + 1}`} value={it.frequency} onChange={(e) => setItem(i, 'frequency', e.target.value)}>{options(FREQUENCIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                      )}
                      {it.frequency === 'custom' && <input aria-label={`How often in words, medicine ${i + 1}`} value={it.frequencyText} onChange={(e) => setItem(i, 'frequencyText', e.target.value)} />}
                    </td>
                    <td><select aria-label={`When, medicine ${i + 1}`} value={it.timing} onChange={(e) => setItem(i, 'timing', e.target.value)}>{Object.entries(TIMINGS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td><select aria-label={`Route, medicine ${i + 1}`} value={it.route} onChange={(e) => setItem(i, 'route', e.target.value)}>{Object.entries(ROUTES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td><input aria-label={`For how long, medicine ${i + 1}`} inputMode="numeric" value={it.durationValue} onChange={(e) => setItem(i, 'durationValue', e.target.value)} /></td>
                    <td><select aria-label={`Unit, medicine ${i + 1}`} value={it.durationUnit} onChange={(e) => setItem(i, 'durationUnit', e.target.value)}>{Object.entries(DURATION_UNITS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td><input aria-label={`Instructions, medicine ${i + 1}`} value={it.instructions} onChange={(e) => setItem(i, 'instructions', e.target.value)} /></td>
                    <td><button type="button" className="icon-btn" aria-label={`Remove medicine ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-ghost btn-sm top-gap-sm" disabled={draft.items.length >= 40} onClick={() => setDraft((d) => ({ ...d, items: [...d.items, { ...EMPTY }] }))}><Plus size={14} aria-hidden /> Add a medicine</button>
          <div className="form-field top-gap-sm">
            <label htmlFor="rx-notes">General instructions (printed under the medicines)</label>
            <textarea id="rx-notes" rows={2} maxLength={1000} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          </div>
          <div className="modal-foot inline">
            <button type="button" className="btn btn-ghost" onClick={() => { setDraft(null); setAsking([]); setError(''); }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Checking…' : asking.length ? 'Save with these reasons' : 'Save'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
