// The prescription of a visit: the medicines (form, strength, dose, how often, when, how long), a ready-made set from
// the Clinic library as a starting point (approved sets only), and the medicine safety warnings. Going ahead despite an
// Avoid or Allergy warning needs a one-line reason, kept with the visit and never printed.
import { CircleCheck, Clock, Pencil, Plus, Printer, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { visitsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Modal } from '../../components/Modal.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { DURATION_UNITS, FORMS, FREQUENCIES, TIMINGS, WARNING_LOOKS, needsReason, rxLine } from './visitFormat.js';

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

// The dose (owner, 8 Oct 2026): the 1-0-1 codes as buttons – morning, afternoon, night – and the other ways
// (SOS, once now, weekly, alternate days, the doctor's own words) under "Other".
const DOSE_CODES = ['1-0-0', '0-1-0', '0-0-1', '1-1-0', '1-0-1', '0-1-1', '1-1-1', '1-1-1-1'];
const DOSE_OTHER = ['sos', 'stat', 'weekly', 'alternate', 'custom'];
function DoseCodes({ value, onChange, n }) {
  const other = DOSE_OTHER.includes(value);
  return (
    <div className="dose-codes" role="group" aria-label={`Dose of medicine ${n} (morning – afternoon – night)`}>
      {DOSE_CODES.map((code) => (
        <button key={code} type="button" className={value === code ? 'on' : ''} aria-pressed={value === code} title={FREQUENCIES[code]} onClick={() => onChange(code)}>
          {code}
        </button>
      ))}
      <select className={other ? 'on' : ''} aria-label={`Other dose, medicine ${n}`} value={other ? value : ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
        <option value="">Other…</option>
        {DOSE_OTHER.map((k) => <option key={k} value={k}>{FREQUENCIES[k]}</option>)}
      </select>
    </div>
  );
}
const FOOD = [
  ['before_food', 'Before food'],
  ['after_food', 'After food'],
];

// One medicine in the prescription box: what (form, name, strength), the dose code, food, how long, and a note.
function MedicineCard({ it, i, set, remove, error }) {
  const moreFood = !['', 'before_food', 'after_food'].includes(it.timing);
  return (
    <li className="rx-card">
      <div className="rx-card-top">
        <span className="rx-card-no">{i + 1}</span>
        <select aria-label={`Form, medicine ${i + 1}`} className="rx-form" value={it.form} onChange={(e) => set('form', e.target.value)}>{FORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <input aria-label={`Medicine ${i + 1}`} className="rx-drug" placeholder="Medicine name" value={it.drug} onChange={(e) => set('drug', e.target.value)} />
        <input aria-label={`Strength, medicine ${i + 1}`} className="rx-strength" placeholder="500 mg" value={it.strength} onChange={(e) => set('strength', e.target.value)} />
        <button type="button" className="icon-btn" aria-label={`Remove medicine ${i + 1}`} onClick={remove}><Trash2 size={15} /></button>
      </div>
      {error && <span className="field-error block">{error}</span>}
      <div className="rx-card-row">
        <span className="rx-label">Dose</span>
        <DoseCodes value={it.frequency} onChange={(f) => set('frequency', f)} n={i + 1} />
      </div>
      {it.frequency === 'custom' && <input className="top-gap-sm" aria-label={`How often in words, medicine ${i + 1}`} placeholder="How often, in words" value={it.frequencyText} onChange={(e) => set('frequencyText', e.target.value)} />}
      <div className="rx-card-row rx-card-more">
        <span className="rx-label">Food</span>
        <div className="dose-codes" role="group" aria-label={`Food, medicine ${i + 1}`}>
          {FOOD.map(([k, word]) => (
            <button key={k} type="button" className={it.timing === k ? 'on' : ''} aria-pressed={it.timing === k} onClick={() => set('timing', it.timing === k ? '' : k)}>{word}</button>
          ))}
          <select className={moreFood ? 'on' : ''} aria-label={`Other timing, medicine ${i + 1}`} value={moreFood ? it.timing : ''} onChange={(e) => set('timing', e.target.value)}>
            <option value="">Other…</option>
            {Object.entries(TIMINGS).filter(([k]) => !['', 'before_food', 'after_food'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <span className="rx-label">For</span>
        <span className="rx-days">
          <input aria-label={`For how long, medicine ${i + 1}`} inputMode="numeric" placeholder="5" value={it.durationValue} onChange={(e) => set('durationValue', e.target.value)} />
          <select aria-label={`Unit, medicine ${i + 1}`} value={it.durationUnit} onChange={(e) => set('durationUnit', e.target.value)}>{Object.entries(DURATION_UNITS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </span>
      </div>
      <input className="top-gap-sm" aria-label={`Note, medicine ${i + 1}`} placeholder="Note for her (optional) – e.g. with plenty of water" value={it.instructions} onChange={(e) => set('instructions', e.target.value)} />
    </li>
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

  const closeDraft = () => {
    setDraft(null);
    setAsking([]);
    setError('');
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
        <Modal title="Prescription" onClose={closeDraft} size="lg">
          <form onSubmit={submit} noValidate className="rx-box">
            <Alert type="error">{error}</Alert>
            {asking.length > 0 && <Warnings warnings={asking} reasons={reasons} setReason={(k, v) => setReasons((r) => ({ ...r, [k]: v }))} asking />}
            {sets.length > 0 && (
              <label className="filter">
                <span>Start from a ready-made set</span>
                <select value="" onChange={(e) => addSet(e.target.value)}>
                  <option value="">Choose…</option>
                  {sets.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
              </label>
            )}
            <p className="muted small rx-hint">Dose: morning – afternoon – night, e.g. 1-0-1 is one in the morning and one at night.</p>
            {draft.items.length === 0 && <p className="muted">No medicines yet.</p>}
            <ol className="plain-list rx-cards">
              {draft.items.map((it, i) => (
                <MedicineCard
                  key={i}
                  it={it}
                  i={i}
                  set={(k, v) => setItem(i, k, v)}
                  remove={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}
                  error={rowError(i)}
                />
              ))}
            </ol>
            <button type="button" className="btn btn-ghost rx-add" disabled={draft.items.length >= 40} onClick={() => setDraft((d) => ({ ...d, items: [...d.items, { ...EMPTY }] }))}><Plus size={16} aria-hidden /> Add a medicine</button>
            <div className="form-field top-gap-sm">
              <label htmlFor="rx-notes">Advice (printed under the medicines)</label>
              <textarea id="rx-notes" rows={2} maxLength={1000} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
            </div>
            <div className="modal-foot inline">
              <button type="button" className="btn btn-ghost" onClick={closeDraft}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Checking…' : asking.length ? 'Save with these reasons' : 'Save prescription'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
