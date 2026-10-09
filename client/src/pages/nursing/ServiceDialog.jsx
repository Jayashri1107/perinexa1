// Record services given (owner, 9 Oct 2026): the nurse picks what she did from the hospital's price list – injection,
// dressing, IV drip, NST … – with how many, when, and a note. Saving sends it to the front desk, who add it to the
// patient's bill. Without a patient (from Today), she finds the patient first.
import { Minus, Plus, Search, Send, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { appointmentsApi, nursingServicesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { toast } from '../../components/Toast.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PatientPicker } from '../../components/PatientPicker.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { toLocalInput } from '../inpatient/inpatientFormat.js';
import { requestId } from '../visits/visitFormat.js';

export function ServiceDialog({ patient: fixedPatient = null, onClose, onSaved }) {
  const { billing } = useAppConfig();
  const [patient, setPatient] = useState(fixedPatient);
  const [options, setOptions] = useState(null);
  const [group, setGroup] = useState('');
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState([]); // [{ item, qty }]
  const [givenAt, setGivenAt] = useState(toLocalInput(new Date()));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rid] = useState(requestId);

  useEffect(() => {
    nursingServicesApi.options().then((r) => setOptions(r.items)).catch((err) => setError(err.message));
  }, []);
  const groups = useMemo(() => [...new Set((options ?? []).map((i) => i.group))], [options]);
  const groupLabel = (k) => billing.priceGroups.find((g) => g.key === k)?.label ?? k;
  const shown = (options ?? []).filter((i) => (!group || i.group === group) && (!text.trim() || `${i.name} ${i.code}`.toLowerCase().includes(text.trim().toLowerCase())));
  const add = (item) => setChosen((c) => (c.some((x) => x.item.id === item.id) ? c.map((x) => (x.item.id === item.id ? { ...x, qty: Math.min(100, x.qty + 1) } : x)) : [...c, { item, qty: 1 }]));
  const setQty = (id, qty) => setChosen((c) => (qty < 1 ? c.filter((x) => x.item.id !== id) : c.map((x) => (x.item.id === id ? { ...x, qty: Math.min(100, qty) } : x))));
  const total = chosen.reduce((n, x) => n + x.item.price * x.qty, 0);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await nursingServicesApi.record({ patientId: patient.id, items: chosen.map((x) => ({ priceItemId: x.item.id, qty: x.qty })), givenAt: new Date(givenAt).toISOString(), note, clientRequestId: rid });
      toast('Service sent to billing');
      onSaved(r.service);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Record a service given" onClose={onClose} size="lg">
      <form onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        {!fixedPatient && <PatientPicker search={appointmentsApi.patients} value={patient} onChange={setPatient} />}
        {fixedPatient && <p className="rx-order"><strong>{fixedPatient.name}</strong> <span className="muted">{fixedPatient.patientNumber}</span></p>}

        <div className="svc-layout top-gap-sm">
          <div>
            <div className="svc-search">
              <Search size={16} aria-hidden />
              <input aria-label="Find a service" placeholder="Find a service, e.g. injection, dressing" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="chips top-gap-sm" role="group" aria-label="Kind of service">
              <button type="button" className={`chip-toggle${!group ? ' on' : ''}`} aria-pressed={!group} onClick={() => setGroup('')}>All</button>
              {groups.map((g) => <button key={g} type="button" className={`chip-toggle${group === g ? ' on' : ''}`} aria-pressed={group === g} onClick={() => setGroup(g)}>{groupLabel(g)}</button>)}
            </div>
            <ul className="plain-list svc-options">
              {!options && <li className="muted">Loading the price list…</li>}
              {options && shown.length === 0 && <li className="muted">No service matches. The hospital admin adds services to the price list.</li>}
              {shown.map((i) => (
                <li key={i.id}>
                  <button type="button" className="svc-option" onClick={() => add(i)}>
                    <span><strong>{i.name}</strong><span className="muted small block">{groupLabel(i.group)} · {i.code}</span></span>
                    <span className="svc-price">{formatMoney(i.price)}</span>
                    <Plus size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <aside className="svc-chosen" aria-label="Services given">
            <h3>Services given</h3>
            {chosen.length === 0 && <p className="muted small">Choose from the list.</p>}
            <ul className="plain-list">
              {chosen.map((x) => (
                <li key={x.item.id} className="svc-line">
                  <span className="svc-line-name">{x.item.name}</span>
                  <span className="svc-qty">
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`One less ${x.item.name}`} onClick={() => setQty(x.item.id, x.qty - 1)}>{x.qty === 1 ? <X size={14} aria-hidden /> : <Minus size={14} aria-hidden />}</button>
                    <strong aria-live="polite">{x.qty}</strong>
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`One more ${x.item.name}`} onClick={() => setQty(x.item.id, x.qty + 1)}><Plus size={14} aria-hidden /></button>
                  </span>
                  <span className="svc-price">{formatMoney(x.item.price * x.qty)}</span>
                </li>
              ))}
            </ul>
            {chosen.length > 0 && <p className="svc-total"><span>Total</span><strong>{formatMoney(total)}</strong></p>}
            <div className="form-field"><label htmlFor="sv-at">Given at</label><input id="sv-at" type="datetime-local" value={givenAt} onChange={(e) => setGivenAt(e.target.value)} /></div>
            <div className="form-field top-gap-sm"><label htmlFor="sv-note">Note</label><input id="sv-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. which injection" /></div>
          </aside>
        </div>

        <p className="muted small top-gap-sm">Saving sends it to the front desk, who add it to her bill.</p>
        <div className="modal-foot inline">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !patient || chosen.length === 0}><Send size={16} aria-hidden /> {busy ? 'Sending…' : 'Save and send to billing'}</button>
        </div>
      </form>
    </Modal>
  );
}
