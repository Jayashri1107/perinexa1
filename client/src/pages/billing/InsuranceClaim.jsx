import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field } from '../../components/ui.jsx';
import { insuranceForm, rupees, toInput, toPaise } from './billingFormat.js';
import { Modal } from './billingUi.jsx';

// Cashless insurance on a bill (11 Nov 2026): the amount the insurer or TPA approved comes off what the patient pays at
// once; the insurer's money is recorded later as a payment by Insurance. The server works out the parts
// (billing/money.js): claimApproved, insuranceShare, insurancePaid, insuranceDue, patientPaid, patientBalance.

/** The bill has an insurance part to show: an approved amount, or money from an insurer. */
export const hasClaim = (bill) => Boolean(bill && (bill.claimApproved > 0 || bill.insurancePaid > 0));

/**
 * The sums after Net pay when insurance pays part, as rows [key, label, paise, strong?]: the insurer's share, what the
 * patient paid, what she still has to pay, and what is due from the insurer.
 */
export function claimRows(bill) {
  if (!hasClaim(bill)) return [];
  const rows = [
    ['insurance', bill.insurancePaid > bill.claimApproved ? 'Insurance (paid)' : 'Insurance (approved)', bill.insuranceShare],
    ['patientPaid', 'Paid by patient', bill.patientPaid],
    ['patientBalance', bill.patientBalance < 0 ? 'Due back to patient' : 'Patient to pay', Math.abs(bill.patientBalance), true],
  ];
  if (bill.insurancePaid > 0) rows.push(['insurancePaid', 'Received from insurance', bill.insurancePaid]);
  rows.push(['insuranceDue', 'Due from insurance', bill.insuranceDue, bill.insuranceDue > 0]);
  return rows;
}

/**
 * Set the approved amount (and the insurer, TPA and pre-authorisation number when the bill has none): one form for a
 * cashless patient. 0 takes the approved amount off. Reception, billing and the hospital admin; audited.
 */
export function ClaimDialog({ bill, onClose, onDone }) {
  const current = insuranceForm(bill.insurance);
  const [insurer, setInsurer] = useState(current.insurer);
  const [tpa, setTpa] = useState(current.tpa);
  const [preAuth, setPreAuth] = useState(current.preAuthNumber);
  const [amount, setAmount] = useState(toInput(bill.claimApproved ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const paise = toPaise(amount || '0');
  const ready = paise != null && (paise === 0 || insurer.trim().length >= 2) && !busy;
  const save = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      let out = null;
      const details = { ...current, insurer: insurer.trim(), tpa: tpa.trim(), preAuthNumber: preAuth.trim() };
      if (paise > 0 && (details.insurer !== current.insurer || details.tpa !== current.tpa || details.preAuthNumber !== current.preAuthNumber)) {
        out = await api(`/billing/bills/${bill.id}/insurance`, { method: 'PUT', body: details });
      }
      out = await api(`/billing/bills/${bill.id}/claim`, { method: 'PUT', body: { approvedPaise: paise } });
      setBusy(false);
      onDone(out, paise ? `Insurance approved ${rupees(paise)}. Patient to pay: ${rupees(Math.max(0, out.bill.patientBalance))}.` : 'Insurance approved amount taken off.');
    } catch (err) {
      setBusy(false);
      setError(err.message);
      setFields(err.fields ?? {});
    }
  };
  return (
    <Modal id="bill-claim" title="Cashless insurance" onClose={onClose}>
      <p>
        The amount the insurer or TPA approved comes off what the patient pays. Net pay {rupees(bill.total)}. When the insurer’s money comes, record it with
        Take payment → Paid by Insurance.
      </p>
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Insurance company or scheme" id="bill-claim-insurer" error={fields.insurer}>
          <input id="bill-claim-insurer" value={insurer} maxLength={80} onChange={(e) => setInsurer(e.target.value)} autoFocus={!current.insurer} />
        </Field>
        <Field label="TPA (optional)" id="bill-claim-tpa" error={fields.tpa}>
          <input id="bill-claim-tpa" value={tpa} maxLength={80} onChange={(e) => setTpa(e.target.value)} />
        </Field>
        <Field label="Pre-authorisation number (optional)" id="bill-claim-preauth" error={fields.preAuthNumber}>
          <input id="bill-claim-preauth" value={preAuth} maxLength={60} onChange={(e) => setPreAuth(e.target.value)} />
        </Field>
        <Field label="Approved amount (₹)" id="bill-claim-amount" error={fields.approvedPaise} hint="Enter 0 to take it off.">
          <input id="bill-claim-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={Boolean(current.insurer)} />
        </Field>
      </div>
      {paise > 0 && paise <= bill.total && (
        <p className="muted">
          Patient to pay {rupees(Math.max(0, bill.total - Math.max(paise, bill.insurancePaid ?? 0) - (bill.patientPaid ?? 0)))} · due from insurance{' '}
          {rupees(Math.max(paise, bill.insurancePaid ?? 0) - (bill.insurancePaid ?? 0))}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>
          <ShieldCheck aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
