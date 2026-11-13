import { useState } from 'react';
import { PauseCircle } from 'lucide-react';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal, PharmacyLetterhead, useSend } from './pharmacyUi.jsx';

// PH5 (docs/PHARMACY_BUILD_NOTE.md): a batch on hold, and who received it. A recall names a manufacturer's batch
// number: the hold covers every stock batch with that number of the medicine (two purchases of the same batch). Held
// stock cannot be sold or issued; it can be returned to the supplier, written off or counted. No notice goes to her
// doctor (owner, 10 Nov 2026) – the pharmacist's list is enough; telling the patients is the hospital's own step.

export const HOLD_WORDS = { recalled: 'Recalled', quality: 'Quality doubt', other: 'Other reason' };

/** "On hold" – colour, icon and word. */
export function HoldPill({ hold }) {
  if (!hold) return null;
  return (
    <StatusPill tone="high" icon={PauseCircle}>
      {HOLD_WORDS[hold.reason] ? `On hold – ${HOLD_WORDS[hold.reason].toLowerCase()}` : 'Some on hold'}
    </StatusPill>
  );
}

export function HoldDialog({ medicine, batch, onClose, onDone }) {
  const [reason, setReason] = useState('recalled');
  const [note, setNote] = useState('');
  const s = useSend(onDone);
  const ready = reason !== 'other' || note.trim().length >= 3;
  return (
    <Modal id="ph-hold" title={`Put batch ${batch.batch} on hold`} onClose={onClose}>
      <p>
        Every batch {batch.batch} of {medicine.name} is held: it cannot be sold or issued until it is released. It can still be returned to the supplier, written off or counted.
      </p>
      <Alert type="error">{s.error}</Alert>
      <fieldset className="fieldset">
        <legend>Why</legend>
        {Object.entries(HOLD_WORDS).map(([k, w]) => (
          <label key={k} className="check">
            <input type="radio" name="ph-hold-reason" checked={reason === k} onChange={() => setReason(k)} /> {w}
          </label>
        ))}
      </fieldset>
      <Field label={reason === 'other' ? 'What is the reason' : 'Note (optional) – the recall notice, its date'} id="ph-hold-note">
        <input id="ph-hold-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-danger" disabled={!ready || s.busy} onClick={() => s.send('/pharmacy/batches/hold', { medicineId: medicine.id, batch: batch.batch, reason, note: note.trim() })}>
          {s.busy ? 'Saving…' : 'Put on hold'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function ReleaseDialog({ medicine, batch, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const s = useSend(onDone);
  return (
    <Modal id="ph-release" title={`Release batch ${batch.batch}`} onClose={onClose}>
      <p>It can be sold and issued again. Write why – for example, the recall did not name this batch.</p>
      <Alert type="error">{s.error}</Alert>
      <Field label="Reason" id="ph-release-reason">
        <input id="ph-release-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={reason.trim().length < 3 || s.busy} onClick={() => s.send('/pharmacy/batches/release', { medicineId: medicine.id, batch: batch.batch, reason: reason.trim() })}>
          {s.busy ? 'Saving…' : 'Release'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Who received this batch: every sale and issue from it, net of returns, and what is still in stock – printable. */
export function RecipientsPrint({ medicine, batch, onClose }) {
  const res = useFetch('/pharmacy/batches/recipients', { medicineId: medicine.id, batch: batch.batch });
  const d = res.data;
  const store = useFetch('/pharmacy/settings').data; // the store's heading on top, as on every pharmacy paper
  return (
    <PrintPreview title={`Who received batch ${batch.batch} – print preview`} hint="The pharmacist's list for a recall. Telling the patients is the hospital's own step." docKey={d ? `recipients-${d.recipients.length}` : null} onClose={onClose}>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {d && (
        <PrintDocument className="bill-doc ph-doc ph-recipients">
          {store?.settings && <PharmacyLetterhead settings={store.settings} />}
          <h2>
            {d.medicine.name} · batch {d.batch}
          </h2>
          <p>
            {d.medicine.manufacturer ? `Manufacturer: ${d.medicine.manufacturer}. ` : ''}
            {d.hold ? `On hold since ${formatDateTime(d.hold.at)} (${HOLD_WORDS[d.hold.reason] ?? d.hold.reason}${d.hold.note ? `: ${d.hold.note}` : ''}). ` : ''}
            Still in stock: {d.inStock} {d.medicine.unit}s.
          {d.vaccinationsRecorded ? ` Also given as a vaccination ${d.vaccinationsRecorded} time${d.vaccinationsRecorded === 1 ? '' : 's'} (recorded on care plans – the doctors see who).` : ''}</p>
          {!d.recipients.length ? (
            <p>Nothing from this batch was sold or issued (or everything came back).</p>
          ) : (
            <table className="bill-report">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Invoice</th>
                  <th scope="col">Patient or customer</th>
                  <th scope="col">Phone</th>
                  <th scope="col" className="num">
                    Qty
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.recipients.map((r, i) => (
                  <tr key={`${r.number}-${i}`}>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      {r.number}
                      {r.kind === 'issue' ? ' (ward)' : ''}
                    </td>
                    <td>{r.patient ? `${r.patient.fullName} (${r.patient.mrn})${r.patient.closed ? ' – record closed' : ''}` : `${r.customer || 'Walk-in'} (walk-in)`}</td>
                    <td>{r.patient?.phone ?? ''}</td>
                    <td className="num">{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PrintDocument>
      )}
    </PrintPreview>
  );
}
