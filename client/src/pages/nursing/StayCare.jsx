// A stay's medicine and care charts (owner, 9 Oct 2026), one tab each: Medicines (the doctor's orders and each dose
// – given, given late, refused, withheld, missed), IV fluids (start, pause, resume, complete, site checks), Vital
// signs, Tests (since admission; nurses mark a sample as taken), Tasks and notes, Intake and output (24-hour totals)
// and the Shift handover. Doctors and RMOs write and stop orders; nurses chart against them and never change them.
// Nothing is changed or deleted: an entry made by mistake is marked "entered in error" with a reason.
import { Ban, ClipboardList, Droplets, FlaskConical, HeartPulse, ListChecks, Pill, Plus, Receipt, Repeat, Scale, Send, Syringe } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { admissionsApi, labApi, nursingServicesApi, wardCareApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { toast } from '../../components/Toast.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDateTime, formatMoney } from '../../utils/format.js';
import { VITAL_FIELDS, toLocalInput, vitalsText } from '../inpatient/inpatientFormat.js';
import { requestId } from '../visits/visitFormat.js';
import { ServiceDialog } from './ServiceDialog.jsx';
import { DOSE_CHOICES, IV_ACTION_WORDS, IV_LOOKS, IV_NEXT, LAB_LOOKS, ORDER_WORDS, SLOT_LOOKS, TASK_CHOICES, clock, needsReason, orderText, slotWhen } from './nursingFormat.js';

const TABS = [
  { key: 'medicines', label: 'Medicines', icon: Pill },
  { key: 'iv', label: 'IV fluids', icon: Droplets },
  { key: 'vitals', label: 'Vital signs', icon: HeartPulse },
  { key: 'tests', label: 'Tests', icon: FlaskConical },
  { key: 'tasks', label: 'Tasks and notes', icon: ListChecks },
  { key: 'io', label: 'Intake and output', icon: Scale },
  { key: 'handover', label: 'Shift handover', icon: Repeat },
  { key: 'services', label: 'Services', icon: Syringe },
];
const FOOD = ['', 'Before food', 'After food', 'With food', 'Empty stomach', 'At bedtime'];

const fieldsText = (fields) => Object.values(fields ?? {})[0];

// ---------- A doctor's new order ----------

function TimesPicker({ times, onChange, optional }) {
  const { nursing } = useAppConfig();
  const [other, setOther] = useState('');
  const toggle = (t) => onChange(times.includes(t) ? times.filter((x) => x !== t) : [...times, t].sort());
  const extra = times.filter((t) => !nursing.doseTimes.some((d) => d.time === t));
  return (
    <div className="form-field width-full">
      <span className="field-label">When{!optional && <span className="required" aria-hidden> *</span>}</span>
      <div className="chips times-picker">
        {nursing.doseTimes.map((d) => (
          <button key={d.key} type="button" className={`chip-toggle${times.includes(d.time) ? ' on' : ''}`} aria-pressed={times.includes(d.time)} onClick={() => toggle(d.time)}>
            {d.label} {d.time}
          </button>
        ))}
        {extra.map((t) => (
          <button key={t} type="button" className="chip-toggle on" aria-pressed onClick={() => toggle(t)} title="Click to remove">{t}</button>
        ))}
        <span className="leave-row">
          <input type="time" aria-label="Another time" value={other} onChange={(e) => setOther(e.target.value)} />
          <button type="button" className="btn btn-ghost btn-sm" disabled={!other} onClick={() => { if (!times.includes(other)) toggle(other); setOther(''); }}>Add time</button>
        </span>
      </div>
      {optional && <span className="muted small">{times.length ? `${times.length} time${times.length === 1 ? '' : 's'} a day` : 'No set times: given as needed (SOS)'}</span>}
    </div>
  );
}

function OrderDialog({ stayId, type, onClose, onSaved }) {
  const { nursing } = useAppConfig();
  const [medicine, setMedicine] = useState({ drug: '', dose: '', route: nursing.routes[0], food: '' });
  const [iv, setIv] = useState({ fluid: '', volumeMl: '', rateMlPerHour: '' });
  const [task, setTask] = useState({ text: '' });
  const [times, setTimes] = useState(type === 'iv' ? [] : nursing.doseTimes.slice(0, 1).map((d) => d.time));
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rid] = useState(requestId);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { type, times: type === 'iv' ? [] : times, instructions, clientRequestId: rid, ...(type === 'medicine' && { medicine }), ...(type === 'iv' && { iv }), ...(type === 'task' && { task }) };
      onSaved(await wardCareApi.addOrder(stayId, body));
    } catch (err) {
      setError(fieldsText(err.fields) ?? err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`New order: ${ORDER_WORDS[type].toLowerCase()}`} onClose={onClose} size="lg">
      <form onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          {type === 'medicine' && (
            <>
              <div className="form-field width-half"><label htmlFor="o-drug">Medicine<span className="required" aria-hidden> *</span></label><input id="o-drug" value={medicine.drug} maxLength={120} onChange={(e) => setMedicine({ ...medicine, drug: e.target.value })} placeholder="Name and strength, e.g. Paracetamol 500 mg" /></div>
              <div className="form-field width-half"><label htmlFor="o-dose">Dose<span className="required" aria-hidden> *</span></label><input id="o-dose" value={medicine.dose} maxLength={60} onChange={(e) => setMedicine({ ...medicine, dose: e.target.value })} placeholder="e.g. 1 tablet, 1 g, 10 units" /></div>
              <div className="form-field width-half"><label htmlFor="o-route">Route</label><select id="o-route" value={medicine.route} onChange={(e) => setMedicine({ ...medicine, route: e.target.value })}>{nursing.routes.map((r) => <option key={r}>{r}</option>)}</select></div>
              <div className="form-field width-half"><label htmlFor="o-food">Food</label><select id="o-food" value={medicine.food} onChange={(e) => setMedicine({ ...medicine, food: e.target.value })}>{FOOD.map((f) => <option key={f} value={f}>{f || '—'}</option>)}</select></div>
              <TimesPicker times={times} onChange={setTimes} optional />
            </>
          )}
          {type === 'iv' && (
            <>
              <div className="form-field width-full"><label htmlFor="o-fluid">Fluid<span className="required" aria-hidden> *</span></label><input id="o-fluid" value={iv.fluid} maxLength={120} onChange={(e) => setIv({ ...iv, fluid: e.target.value })} placeholder="e.g. Ringer lactate, Normal saline 0.9%" /></div>
              <div className="form-field width-half"><label htmlFor="o-vol">Volume (ml)<span className="required" aria-hidden> *</span></label><input id="o-vol" inputMode="numeric" value={iv.volumeMl} onChange={(e) => setIv({ ...iv, volumeMl: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="form-field width-half"><label htmlFor="o-rate">Rate (ml per hour)<span className="required" aria-hidden> *</span></label><input id="o-rate" inputMode="decimal" value={iv.rateMlPerHour} onChange={(e) => setIv({ ...iv, rateMlPerHour: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            </>
          )}
          {type === 'task' && (
            <>
              <div className="form-field width-full"><label htmlFor="o-task">Task<span className="required" aria-hidden> *</span></label><input id="o-task" value={task.text} maxLength={200} onChange={(e) => setTask({ text: e.target.value })} placeholder="e.g. Wound dressing, Catheter care, Position change" /></div>
              <TimesPicker times={times} onChange={setTimes} />
            </>
          )}
          <div className="form-field width-full"><label htmlFor="o-ins">Instructions for the nurse</label><input id="o-ins" value={instructions} maxLength={300} onChange={(e) => setInstructions(e.target.value)} placeholder="Optional" /></div>
        </div>
        <div className="modal-foot inline">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save order'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- A nurse charts a dose, a task or an IV event ----------

function ChartDialog({ stayId, patientId, title, kind, order, dueAt, ivAction, onClose, onSaved }) {
  const { nursing } = useAppConfig();
  // an injection given: offer its charge for the bill (the price list item config.nursing.injectionPriceCode)
  const [injection, setInjection] = useState(null);
  const [billInjection, setBillInjection] = useState(true);
  const isInjection = kind === 'dose' && nursing.injectionRoutes.includes(order.medicine?.route);
  useEffect(() => {
    if (!isInjection) return;
    nursingServicesApi.options().then((r) => setInjection(r.items.find((i) => i.code === nursing.injectionPriceCode) ?? null)).catch(() => setInjection(null));
  }, [isInjection, nursing.injectionPriceCode]);
  const choices = kind === 'dose' ? DOSE_CHOICES : kind === 'task' ? TASK_CHOICES : null;
  const [outcome, setOutcome] = useState(choices?.[0][0] ?? '');
  const [at, setAt] = useState(toLocalInput(new Date()));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [site, setSite] = useState(order?.ivState?.site ?? '');
  const [volumeMl, setVolumeMl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rid] = useState(requestId);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        kind,
        at: new Date(at).toISOString(),
        orderId: order.id,
        ...(dueAt && { dueAt }),
        ...(choices && { outcome }),
        reason,
        note,
        ...(kind === 'iv' && { iv: { action: ivAction, site, volumeMl } }),
        clientRequestId: rid,
      };
      const saved = await wardCareApi.chart(stayId, body);
      if (injection && billInjection && ['given', 'late'].includes(outcome)) {
        await nursingServicesApi.record({ patientId, items: [{ priceItemId: injection.id, qty: 1 }], givenAt: new Date(at).toISOString(), note: orderText(order), clientRequestId: `${rid}-inj` });
      }
      onSaved(saved);
    } catch (err) {
      setError(fieldsText(err.fields) ?? err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} size="md">
      <form onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        <p className="rx-order"><strong>{orderText(order)}</strong>{dueAt && <span className="muted"> · due {slotWhen(dueAt)}</span>}</p>
        {order.instructions && <p className="small">Doctor's instructions: {order.instructions}</p>}
        <div className="form-grid">
          {choices && (
            <div className="form-field width-full">
              <span className="field-label">What happened</span>
              <div className="chips" role="group" aria-label="What happened">
                {choices.map(([k, l]) => (
                  <button key={k} type="button" className={`chip-toggle${outcome === k ? ' on' : ''}`} aria-pressed={outcome === k} onClick={() => setOutcome(k)}>{l}</button>
                ))}
              </div>
            </div>
          )}
          <div className="form-field width-half"><label htmlFor="c-at">Time</label><input id="c-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>
          {kind === 'iv' && (
            <>
              <div className="form-field width-half"><label htmlFor="c-site">IV site</label><input id="c-site" value={site} maxLength={60} onChange={(e) => setSite(e.target.value)} placeholder="e.g. Left forearm" /></div>
              {ivAction !== 'started' && <div className="form-field width-half"><label htmlFor="c-vol">Volume given since last entry (ml)</label><input id="c-vol" inputMode="numeric" value={volumeMl} onChange={(e) => setVolumeMl(e.target.value.replace(/\D/g, ''))} placeholder="If known" /></div>}
            </>
          )}
          {needsReason(outcome) && (
            <div className="form-field width-full"><label htmlFor="c-reason">Reason<span className="required" aria-hidden> *</span></label><input id="c-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={outcome === 'late' ? 'Why it was given late' : 'Why it was not given / done'} /></div>
          )}
          <div className="form-field width-full"><label htmlFor="c-note">{kind === 'iv' ? 'Site and observations' : 'Note'}</label><input id="c-note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'iv' ? 'e.g. No swelling or redness' : 'Optional'} /></div>
        </div>
        {needsReason(outcome) && kind === 'dose' && <p className="muted small">Her doctor is told when a dose is not given.</p>}
        {injection && ['given', 'late'].includes(outcome) && (
          <label className="chip-check top-gap-sm">
            <input type="checkbox" checked={billInjection} onChange={(e) => setBillInjection(e.target.checked)} />
            <Receipt size={14} aria-hidden /> Add “{injection.name}” ({formatMoney(injection.price)}) to her bill – sent to the front desk
          </label>
        )}
        <div className="modal-foot inline">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save to the chart'}</button>
        </div>
      </form>
    </Modal>
  );
}

// "Entered in error" on one of the entries this person wrote (or her doctor / an RMO).
function ErrorButton({ entry, canOrder, stayId, onDone }) {
  if (entry.cancelled || !(entry.mine || canOrder)) return null;
  return (
    <button
      type="button"
      className="btn btn-link btn-sm"
      onClick={async () => {
        const r = window.prompt('Why is it entered in error?');
        if (r && r.trim().length >= 3) {
          await admissionsApi.cancelNursing(stayId, entry.id, r.trim());
          onDone();
        }
      }}
    >
      Entered in error
    </button>
  );
}

// ---------- The tabs ----------

function OrdersList({ orders, type, can, onStop, onChart }) {
  const list = orders.filter((o) => o.type === type);
  if (list.length === 0) return <p className="muted">No {ORDER_WORDS[type].toLowerCase()} orders yet.{can.order ? '' : ' The doctor or RMO writes them.'}</p>;
  return (
    <ul className="plain-list rows">
      {list.map((o) => (
        <li key={o.id} className={o.status === 'stopped' ? 'struck' : ''}>
          <span>
            <strong>{orderText(o)}</strong>
            <span className="block small">{o.times.length ? o.times.join(' · ') : type === 'medicine' ? 'As needed (SOS)' : ''}{o.instructions && ` · ${o.instructions}`}</span>
            <span className="muted block small">Ordered by {o.ordered.byName}, {formatDateTime(o.ordered.at)}{o.stopped && ` · stopped by ${o.stopped.byName}, ${formatDateTime(o.stopped.at)}: ${o.stopped.reason}`}</span>
          </span>
          <span className="row-actions">
            {o.status === 'active' && can.chart && type === 'medicine' && o.times.length === 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChart(o)}>Chart a dose</button>}
            {o.status === 'active' && can.order && <button type="button" className="btn btn-link btn-sm btn-danger-text" onClick={() => onStop(o)}>Stop</button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ScheduleTable({ schedule, orders, type, can, onChart, stayId, onChanged }) {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const rows = schedule.filter((s) => s.type === type);
  if (rows.length === 0) return <p className="muted">Nothing scheduled in the last 24 hours or the rest of today.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Due</th><th>{type === 'medicine' ? 'Medicine' : 'Task'}</th><th>Status</th><th>Charted</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {rows.map((s) => {
            const o = byId.get(s.orderId);
            const open = ['later', 'due', 'overdue'].includes(s.state);
            return (
              <tr key={`${s.orderId}${s.dueAt}`} className={s.state === 'overdue' ? 'row-alert' : ''}>
                <td className="nowrap"><strong>{slotWhen(s.dueAt)}</strong></td>
                <td>{o ? orderText(o) : '—'}</td>
                <td><StateBadge look={SLOT_LOOKS[s.state]} small /></td>
                <td className="small">{s.entry ? <>{clock(s.entry.at)} · {s.entry.byName}{s.entry.reason && <span className="block muted">{s.entry.reason}</span>}</> : '—'}</td>
                <td className="actions">
                  {open && can.chart && o && <button type="button" className={`btn btn-sm ${s.state === 'later' ? 'btn-ghost' : 'btn-primary'}`} onClick={() => onChart(o, s.dueAt)}>Chart</button>}
                  {s.entry && <ErrorButton entry={s.entry} canOrder={can.order} stayId={stayId} onDone={onChanged} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VitalsTab({ stayId, data, onChanged }) {
  const [at, setAt] = useState(toLocalInput(new Date()));
  const [vitals, setVitals] = useState({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await admissionsApi.nursing(stayId, { kind: 'vitals', at: new Date(at).toISOString(), vitals, note, clientRequestId: requestId() });
      setVitals({});
      setNote('');
      setAt(toLocalInput(new Date()));
      onChanged();
    } catch (err) {
      setError(fieldsText(err.fields) ?? err.message);
    }
  };
  return (
    <>
      {data.can.chart && (
        <form onSubmit={save} className="card" noValidate>
          <h3>Record vital signs</h3>
          <Alert type="error">{error}</Alert>
          <div className="vitals-grid">
            {VITAL_FIELDS.map(([k, l, unit]) => (
              <label key={k} className="vital-box">
                <span className="small muted">{l}</span>
                <span className="vital-input"><input inputMode="decimal" value={vitals[k] ?? ''} onChange={(e) => setVitals((v) => ({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') }))} /><span className="small muted">{unit}</span></span>
              </label>
            ))}
          </div>
          <div className="leave-row">
            <input type="datetime-local" aria-label="When" value={at} onChange={(e) => setAt(e.target.value)} />
            <input aria-label="Note" placeholder="Note (optional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm">Save vital signs</button>
          </div>
          <p className="muted small">Due every {data.settings.vitalsEveryHours} hours. Red-flag checks use the rules a doctor approved in the Clinic library.</p>
        </form>
      )}
      <div className="table-wrap top-gap">
        <table className="table">
          <thead><tr><th>Time</th>{VITAL_FIELDS.filter(([k]) => k !== 'bpDiastolic').map(([k, l, unit]) => <th key={k}>{k === 'bpSystolic' ? 'BP' : l}<span className="muted small block">{k.startsWith('bp') ? 'mmHg' : unit}</span></th>)}<th>By</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {data.vitals.length === 0 && <tr><td colSpan={VITAL_FIELDS.length + 2} className="muted">No vital signs recorded yet.</td></tr>}
            {data.vitals.map((e) => (
              <tr key={e.id} className={e.cancelled ? 'struck-row' : ''}>
                <td className="nowrap">{formatDateTime(e.at)}</td>
                {VITAL_FIELDS.filter(([k]) => k !== 'bpDiastolic').map(([k]) => (
                  <td key={k}>{k === 'bpSystolic' ? (e.vitals?.bpSystolic != null || e.vitals?.bpDiastolic != null ? `${e.vitals.bpSystolic ?? '–'}/${e.vitals.bpDiastolic ?? '–'}` : '—') : e.vitals?.[k] ?? '—'}</td>
                ))}
                <td className="small">{e.byName}{e.note && <span className="block muted">{e.note}</span>}</td>
                <td className="actions"><ErrorButton entry={e} canOrder={data.can.order} stayId={data.stayId} onDone={onChanged} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function IvTab({ data, can, onAction, onStop }) {
  const ivs = data.orders.filter((o) => o.type === 'iv');
  if (ivs.length === 0) return <p className="muted">No IV fluid orders yet.{can.order ? '' : ' The doctor or RMO writes them.'}</p>;
  return (
    <div className="stack">
      {ivs.map((o) => {
        const state = o.status === 'stopped' && o.ivState.state !== 'completed' ? 'stopped' : o.ivState.state;
        const events = data.ivEvents.filter((e) => e.orderId === o.id);
        return (
          <section key={o.id} className="card">
            <div className="card-head">
              <h3><Droplets size={16} aria-hidden /> {orderText(o)}</h3>
              <StateBadge look={IV_LOOKS[state]} small />
            </div>
            <p className="small">
              {o.ivState.startedAt && <>Started {formatDateTime(o.ivState.startedAt)} · </>}
              {o.ivState.site && <>Site: {o.ivState.site} · </>}
              Given so far: {o.ivState.volumeMl ? `${o.ivState.volumeMl} ml of ${o.iv.volumeMl} ml` : 'not recorded'}
            </p>
            <p className="muted small">Ordered by {o.ordered.byName}, {formatDateTime(o.ordered.at)}{o.instructions && ` · ${o.instructions}`}{o.stopped && ` · stopped by ${o.stopped.byName}: ${o.stopped.reason}`}</p>
            <div className="row-actions">
              {o.status === 'active' && can.chart && IV_NEXT[o.ivState.state].map((a) => (
                <button key={a} type="button" className={`btn btn-sm ${a === 'started' || a === 'resumed' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onAction(o, a)}>{IV_ACTION_WORDS[a]}</button>
              ))}
              {o.status === 'active' && can.order && <button type="button" className="btn btn-link btn-sm btn-danger-text" onClick={() => onStop(o)}>Stop order</button>}
            </div>
            {events.length > 0 && (
              <ul className="plain-list rows top-gap-sm">
                {events.map((e) => (
                  <li key={e.id} className={e.cancelled ? 'struck' : ''}>
                    <span><strong>{formatDateTime(e.at)}</strong> {IV_ACTION_WORDS[e.iv?.action]}{e.iv?.site && ` · ${e.iv.site}`}{e.iv?.volumeMl ? ` · ${e.iv.volumeMl} ml` : ''}{e.note && <span className="block small">{e.note}</span>}{e.cancelled && <span className="block small">Entered in error: {e.cancelled.reason}</span>}</span>
                    <span className="muted small">{e.byName}</span>
                    <ErrorButton entry={e} canOrder={can.order} stayId={data.stayId} onDone={data.reload} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TestsTab({ data, onChanged }) {
  const [error, setError] = useState('');
  if (data.labs.length === 0) return <p className="muted">No tests ordered since she was admitted.</p>;
  return (
    <>
      <Alert type="error">{error}</Alert>
      <ul className="plain-list rows">
        {data.labs.map((l) => (
          <li key={l.id}>
            <span>
              <Link to={`/hospital/lab/orders/${l.id}`}><strong>{l.tests.join(', ')}</strong></Link>
              <span className="muted block small">
                {l.orderNumber} · ordered {formatDateTime(l.orderedAt)}{l.collectedAt && ` · sample taken ${formatDateTime(l.collectedAt)}`}{l.reportedAt && ` · reported ${formatDateTime(l.reportedAt)}`}
              </span>
            </span>
            <span className="row-actions">
              {l.flagged && ['reported', 'reviewed'].includes(l.status) && <StateBadge look={{ tone: 'danger', icon: FlaskConical, word: 'Abnormal result' }} small />}
              <StateBadge look={LAB_LOOKS[l.status]} small />
              {l.status === 'ordered' && data.can.collect && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    setError('');
                    try {
                      await labApi.collect(l.id);
                      onChanged();
                    } catch (err) {
                      setError(err.message);
                    }
                  }}
                >
                  Sample taken
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small top-gap-sm">Abnormal results: tell her doctor according to the hospital's policy. The doctor reviews them in Lab.</p>
    </>
  );
}

function NoteForm({ stayId, onChanged }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="leave-row"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try {
          await admissionsApi.nursing(stayId, { kind: 'note', at: new Date().toISOString(), note, clientRequestId: requestId() });
          setNote('');
          onChanged();
        } catch (err) {
          setError(fieldsText(err.fields) ?? err.message);
        }
      }}
    >
      <input aria-label="Nursing note" placeholder="Symptoms, observations, complaints, care given, what she was told…" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      <button type="submit" className="btn btn-ghost btn-sm" disabled={note.trim().length < 2}>Add note</button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}

function IoTab({ stayId, data, onChanged }) {
  const [io, setIo] = useState({ oralMl: '', ivMl: '', urineMl: '', otherOutMl: '' });
  const [at, setAt] = useState(toLocalInput(new Date()));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const t = data.ioTotals;
  const FIELDS = [['oralMl', 'Oral fluids'], ['ivMl', 'IV fluids'], ['urineMl', 'Urine'], ['otherOutMl', 'Other output (drain, vomit…)']];
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await wardCareApi.chart(stayId, { kind: 'io', at: new Date(at).toISOString(), io, note, clientRequestId: requestId() });
      setIo({ oralMl: '', ivMl: '', urineMl: '', otherOutMl: '' });
      setNote('');
      setAt(toLocalInput(new Date()));
      onChanged();
    } catch (err) {
      setError(fieldsText(err.fields) ?? err.message);
    }
  };
  return (
    <>
      <div className="io-totals">
        <div><span className="muted small">Intake, last 24 h</span><strong>{t.intakeMl} ml</strong><span className="muted small">oral {t.oralMl} · IV {t.ivMl}</span></div>
        <div><span className="muted small">Output, last 24 h</span><strong>{t.outputMl} ml</strong><span className="muted small">urine {t.urineMl} · other {t.otherOutMl}</span></div>
        <div><span className="muted small">Balance</span><strong>{t.intakeMl - t.outputMl > 0 ? '+' : ''}{t.intakeMl - t.outputMl} ml</strong></div>
      </div>
      {data.can.chart && (
        <form onSubmit={save} className="card top-gap" noValidate>
          <h3>Record intake or output (ml)</h3>
          <Alert type="error">{error}</Alert>
          <div className="vitals-grid">
            {FIELDS.map(([k, l]) => (
              <label key={k} className="vital-box">
                <span className="small muted">{l}</span>
                <span className="vital-input"><input inputMode="numeric" value={io[k]} onChange={(e) => setIo((v) => ({ ...v, [k]: e.target.value.replace(/\D/g, '') }))} /><span className="small muted">ml</span></span>
              </label>
            ))}
          </div>
          <div className="leave-row">
            <input type="datetime-local" aria-label="When" value={at} onChange={(e) => setAt(e.target.value)} />
            <input aria-label="Note" placeholder="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm">Save</button>
          </div>
        </form>
      )}
      <ul className="plain-list rows top-gap">
        {data.io.length === 0 && <li className="muted">Nothing recorded in the last 24 hours.</li>}
        {data.io.map((e) => (
          <li key={e.id} className={e.cancelled ? 'struck' : ''}>
            <span>
              <strong>{formatDateTime(e.at)}</strong> {FIELDS.filter(([k]) => e.io?.[k] != null).map(([k, l]) => `${l} ${e.io[k]} ml`).join(' · ')}
              {e.note && <span className="block small">{e.note}</span>}
            </span>
            <span className="muted small">{e.byName}</span>
            <ErrorButton entry={e} canOrder={data.can.order} stayId={stayId} onDone={onChanged} />
          </li>
        ))}
      </ul>
    </>
  );
}

function HandoverTab({ stayId, data, onChanged }) {
  const s = data.summary;
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  return (
    <>
      <section className="card">
        <h3>For the next shift <span className="muted small">({s.shift.label}, since {clock(s.shift.startedAt)})</span></h3>
        <ul className="plain-list handover-list">
          <li><Pill size={14} aria-hidden /> Doses due or overdue: <strong>{s.dosesOpen}</strong>{s.dosesNotGiven > 0 && ` · not given this shift: ${s.dosesNotGiven}`}</li>
          <li><Droplets size={14} aria-hidden /> IV fluids running: <strong>{s.ivRunning.length ? s.ivRunning.join(', ') : 'none'}</strong></li>
          <li><FlaskConical size={14} aria-hidden /> Tests waiting: <strong>{s.labPending.length ? s.labPending.join('; ') : 'none'}</strong></li>
          <li><ClipboardList size={14} aria-hidden /> Care tasks due or not done: <strong>{s.tasksOpen}</strong></li>
          <li><HeartPulse size={14} aria-hidden /> Latest vital signs: <strong>{s.lastVitals ? `${vitalsText(s.lastVitals.vitals)} (${formatDateTime(s.lastVitals.at)})` : 'none recorded'}</strong>{s.vitalsDue && ' · due now'}</li>
        </ul>
        {s.notes.length > 0 && (
          <>
            <h4 className="summary-h">Notes this shift</h4>
            <ul className="plain-list small">{s.notes.map((n) => <li key={n.id}>{clock(n.at)} {n.note} <span className="muted">– {n.byName}</span></li>)}</ul>
          </>
        )}
        {data.can.chart && (
          <form
            className="top-gap"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                await wardCareApi.chart(stayId, { kind: 'handover', at: new Date().toISOString(), note, clientRequestId: requestId() });
                setNote('');
                onChanged();
              } catch (err) {
                setError(fieldsText(err.fields) ?? err.message);
              }
            }}
          >
            <label htmlFor="h-note" className="field-label">Handover note</label>
            <textarea id="h-note" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Her condition, concerns, what to watch, what is pending" />
            {error && <span className="field-error">{error}</span>}
            <div className="modal-foot inline"><button type="submit" className="btn btn-primary" disabled={note.trim().length < 5}>Hand over</button></div>
          </form>
        )}
      </section>
      <h3 className="top-gap">Earlier handovers</h3>
      <ul className="plain-list rows">
        {data.handovers.length === 0 && <li className="muted">None yet.</li>}
        {data.handovers.map((h) => (
          <li key={h.id} className={h.cancelled ? 'struck' : ''}>
            <span><strong>{formatDateTime(h.at)}</strong><span className="block pre">{h.note}</span></span>
            <span className="muted small">{h.byName}</span>
            <ErrorButton entry={h} canOrder={data.can.order} stayId={stayId} onDone={onChanged} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ServicesTab({ data, onRecord }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    nursingServicesApi.ofPatient(data.patient.id).then((r) => setList(r.items)).catch((err) => setError(err.message));
  }, [data.patient.id]);
  useEffect(load, [load, data]);
  const LOOK = {
    sent: { tone: 'pending', icon: Send, word: 'Sent to billing' },
    billed: { tone: 'active', icon: Receipt, word: 'On the bill' },
    cancelled: { tone: 'inactive', icon: Ban, word: 'Cancelled' },
  };
  const cancel = async (s) => {
    const r = window.prompt('Why cancel this service?');
    if (!r || r.trim().length < 3) return;
    try {
      await nursingServicesApi.cancel(s.id, r.trim());
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      {data.can.chart && (
        <div className="care-actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => onRecord(load)}><Plus size={14} aria-hidden /> Record a service</button></div>
      )}
      <p className="muted small">Injections, dressings, IV drips and other services she was given. Each is sent to the front desk and added to her bill there.</p>
      <Alert type="error">{error}</Alert>
      {!list && !error && <Loader />}
      <ul className="plain-list rows">
        {list?.length === 0 && <li className="muted">No services recorded yet.</li>}
        {list?.map((s) => (
          <li key={s.id} className={s.status === 'cancelled' ? 'struck' : ''}>
            <span>
              <strong>{s.items.map((i) => `${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ')}</strong> <span className="muted">{formatMoney(s.amount)}</span>
              <span className="muted block small">{s.serviceNumber} · {formatDateTime(s.givenAt)} · {s.givenByName}{s.note && ` · ${s.note}`}{s.billed && ` · bill ${s.billed.billNumber}`}{s.cancelled && ` · ${s.cancelled.reason}`}</span>
            </span>
            <span className="row-actions">
              <StateBadge look={LOOK[s.status]} small />
              {s.status === 'sent' && data.can.chart && <button type="button" className="btn btn-link btn-sm" onClick={() => cancel(s)}>Cancel</button>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- The charts ----------

export function StayCare({ stayId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('medicines');
  const [dialog, setDialog] = useState(null);

  const load = useCallback(() => {
    wardCareApi.stay(stayId).then((d) => { setData(d); setError(''); }).catch((err) => setError(err.message));
  }, [stayId]);
  useEffect(load, [load]);
  // what is due changes with the clock
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const can = data.can;
  const view = { ...data, stayId, reload: load };
  const saved = (d, message = 'Saved to the chart') => { setData(d); setDialog(null); toast(message); };
  const stop = async (o) => {
    const r = window.prompt(`Stop ${orderText(o)}? Why?`);
    if (!r || r.trim().length < 3) return;
    try {
      setData(await wardCareApi.stopOrder(stayId, o.id, r.trim()));
    } catch (err) {
      setError(err.message);
    }
  };
  const count = (type) => data.schedule.filter((s) => s.type === type && ['due', 'overdue'].includes(s.state)).length;
  const badges = { medicines: count('medicine'), tasks: count('task'), vitals: data.summary.vitalsDue ? 1 : 0, iv: data.orders.filter((o) => o.type === 'iv' && o.status === 'active' && o.ivState.state === 'ordered').length };
  const orderType = { medicines: 'medicine', iv: 'iv', tasks: 'task' }[tab];

  return (
    <section className="card stay-care">
      <div className="care-tabs" role="tablist" aria-label="Charts">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            <Icon size={15} aria-hidden /> {label}
            {badges[key] > 0 && <span className="care-count" aria-label={`${badges[key]} due`}>{badges[key]}</span>}
          </button>
        ))}
      </div>
      <Alert type="error">{error}</Alert>
      {orderType && can.order && (
        <div className="care-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ order: orderType })}><Plus size={14} aria-hidden /> New {ORDER_WORDS[orderType].toLowerCase()} order</button>
        </div>
      )}

      {tab === 'medicines' && (
        <>
          <h3>Today's doses</h3>
          <ScheduleTable schedule={data.schedule} orders={data.orders} type="medicine" can={can} stayId={stayId} onChanged={load} onChart={(o, dueAt) => setDialog({ chart: 'dose', order: o, dueAt })} />
          <h3 className="top-gap">Doctor's medicine orders</h3>
          <OrdersList orders={data.orders} type="medicine" can={can} onStop={stop} onChart={(o) => setDialog({ chart: 'dose', order: o })} />
          {data.doses.some((d) => !d.dueAt) && (
            <>
              <h3 className="top-gap">As-needed doses</h3>
              <ul className="plain-list rows">
                {data.doses.filter((d) => !d.dueAt).map((d) => (
                  <li key={d.id} className={d.cancelled ? 'struck' : ''}>
                    <span><strong>{formatDateTime(d.at)}</strong> {[d.medicine?.drug, d.medicine?.dose].filter(Boolean).join(' ')} <StateBadge look={SLOT_LOOKS[d.outcome]} small />{d.reason && <span className="block small">{d.reason}</span>}</span>
                    <span className="muted small">{d.byName}</span>
                    <ErrorButton entry={d} canOrder={can.order} stayId={stayId} onDone={load} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {tab === 'iv' && <IvTab data={view} can={can} onAction={(o, a) => setDialog({ chart: 'iv', order: o, ivAction: a })} onStop={stop} />}
      {tab === 'vitals' && <VitalsTab stayId={stayId} data={view} onChanged={load} />}
      {tab === 'tests' && <TestsTab data={data} onChanged={load} />}
      {tab === 'tasks' && (
        <>
          <h3>Today's care tasks</h3>
          <ScheduleTable schedule={data.schedule} orders={data.orders} type="task" can={can} stayId={stayId} onChanged={load} onChart={(o, dueAt) => setDialog({ chart: 'task', order: o, dueAt })} />
          <h3 className="top-gap">Doctor's care task orders</h3>
          <OrdersList orders={data.orders} type="task" can={can} onStop={stop} onChart={() => {}} />
          <h3 className="top-gap">Nursing notes</h3>
          {can.chart && <NoteForm stayId={stayId} onChanged={load} />}
          <ul className="plain-list rows top-gap-sm">
            {data.notes.filter((n) => n.kind === 'note').length === 0 && <li className="muted">No notes yet.</li>}
            {data.notes.filter((n) => n.kind === 'note').map((n) => (
              <li key={n.id} className={n.cancelled ? 'struck' : ''}>
                <span><strong>{formatDateTime(n.at)}</strong> {n.note}{n.cancelled && <span className="block small">Entered in error: {n.cancelled.reason}</span>}</span>
                <span className="muted small">{n.byName}</span>
                <ErrorButton entry={n} canOrder={can.order} stayId={stayId} onDone={load} />
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === 'io' && <IoTab stayId={stayId} data={view} onChanged={load} />}
      {tab === 'handover' && <HandoverTab stayId={stayId} data={view} onChanged={load} />}
      {tab === 'services' && <ServicesTab data={view} onRecord={(after) => setDialog({ service: after })} />}

      {dialog?.service && <ServiceDialog patient={data.patient} onClose={() => setDialog(null)} onSaved={() => { dialog.service(); setDialog(null); }} />}
      {dialog?.order && !dialog.chart && <OrderDialog stayId={stayId} type={dialog.order} onClose={() => setDialog(null)} onSaved={(d) => saved(d, 'Order saved – the nurses are told')} />}
      {dialog?.chart && (
        <ChartDialog
          stayId={stayId}
          patientId={data.patient.id}
          kind={dialog.chart}
          order={dialog.order}
          dueAt={dialog.dueAt}
          ivAction={dialog.ivAction}
          title={dialog.chart === 'dose' ? 'Chart a dose' : dialog.chart === 'task' ? 'Chart a care task' : `IV fluid: ${IV_ACTION_WORDS[dialog.ivAction].toLowerCase()}`}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
    </section>
  );
}
