// At the counter: the patient's latest prescriptions (medicines only), and "Use" to put them on the sale – each found
// on the stock list by name, with a quantity worked out from the dose, how often and how long when that can be told.
// The pharmacist checks every line before selling.
import { useEffect, useState } from 'react';
import { medicinesApi, pharmacyPrescriptionsApi } from '../../api/index.js';
import { dayText } from '../appointments/appointmentFormat.js';
import { rxLine } from '../visits/visitFormat.js';

// "Tab Folic acid 5 mg" → "folic acid": the words to look for on the stock list.
const nameOf = (drug) => drug.toLowerCase().replace(/^(tab|cap|syp|syrup|inj|tablet|capsule)\.?\s+/i, '').replace(/\d.*$/, '').trim();
const perDay = (f) => (/^\d(-\d){2,3}$/.test(f) ? f.split('-').reduce((n, x) => n + Number(x), 0) : null);
function quantityOf(i) {
  const times = perDay(i.frequency);
  const dose = Number(String(i.dose ?? '1').replace('½', '0.5').replace(/[^\d.]/g, '')) || 1;
  const days = i.durationUnit === 'days' ? i.durationValue : i.durationUnit === 'weeks' ? (i.durationValue ?? 0) * 7 : null;
  return times && days && ['tab', 'cap'].includes(i.form) ? Math.ceil(dose * times * days) : 1;
}

export function FromPrescription({ patientId, onUse }) {
  const [items, setItems] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    setItems(null);
    pharmacyPrescriptionsApi.forPatient(patientId).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [patientId]);

  const use = async (rx) => {
    const found = [];
    const missing = [];
    for (const i of rx.items) {
      const { items: options } = await medicinesApi.options(nameOf(i.drug));
      const m = options.find((o) => o.available > 0);
      if (m) found.push({ medicine: m, qty: quantityOf(i) });
      else missing.push(i.drug);
    }
    onUse(found, rx.doctor);
    setNote(missing.length ? `Not in stock or not on the list: ${missing.join(', ')}.` : 'All medicines added – check each line and quantity.');
  };

  if (!items) return <p className="muted small">Loading her prescriptions…</p>;
  if (!items.length) return <p className="muted small">No prescriptions written for her in this hospital.</p>;
  return (
    <div className="top-gap-sm">
      <h3>Her prescriptions</h3>
      <ul className="plain-list rows">
        {items.map((rx) => (
          <li key={rx.visitId} className="appt-line">
            <span>
              <strong>{dayText(rx.visitOn)}</strong> <span className="muted small">{rx.doctor}</span>
              <span className="block small">{rx.items.map(rxLine).join('; ')}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => use(rx)}>Use</button>
          </li>
        ))}
      </ul>
      {note && <p className="small">{note}</p>}
    </div>
  );
}
