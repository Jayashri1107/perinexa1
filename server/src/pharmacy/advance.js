// Pharmacy advance (18 Nov 2026, the pharmacy's request): a patient's deposit with the pharmacy, used against her
// pharmacy bills paid here or on credit (oldest first), or refunded. The money is counted in the collection when it is
// deposited or refunded – a use moves no money, so it is a payment of mode 'advance' on the bill and is left out of the
// collection reports. Every query carries the hospital's tenantId.

import { PharmacyAdvance, PharmacyInvoice } from '../models/Pharmacy.js';
import { nextNumber } from '../models/Counter.js';
import { stampOf } from '../billing/billingService.js';
import { HttpError } from '../utils/httpError.js';
import { padded, patientDues } from './pharmacyService.js';

const SIGN = { deposit: 1, used: -1, refund: -1 };

/** Her advance: the balance left and every entry, oldest first. */
export async function advanceOf(req, patientId) {
  const entries = await PharmacyAdvance.find({ tenantId: req.tenantId, patientId }).sort({ 'created.at': 1, _id: 1 }).lean();
  return {
    balancePaise: entries.reduce((n, e) => n + SIGN[e.kind] * e.amountPaise, 0),
    entries: entries.map((e) => ({ id: String(e._id), number: e.number, kind: e.kind, amountPaise: e.amountPaise, mode: e.mode ?? '', reference: e.reference ?? '', invoiceNumber: e.invoiceNumber ?? '', reason: e.reason ?? '', at: e.created.at, byName: e.created.byName ?? '' })),
  };
}

/** Takes a deposit. */
export async function depositAdvance(req, patientId, { amountPaise, mode, reference = '' }) {
  const number = padded('PA', await nextNumber(req.tenantId, 'pharmacy-advance'));
  return PharmacyAdvance.create({ tenantId: req.tenantId, patientId, number, kind: 'deposit', amountPaise, mode, reference, created: stampOf(req) });
}

/** Gives back part or all of what is left. */
export async function refundAdvance(req, patientId, { amountPaise, mode, reason }) {
  const { balancePaise } = await advanceOf(req, patientId);
  if (amountPaise > balancePaise) throw Object.assign(new HttpError(400, `Only ₹${(balancePaise / 100).toFixed(2)} of advance is left.`, 'VALIDATION'), { fields: { amountPaise: 'More than the advance left.' } });
  const number = padded('PA', await nextNumber(req.tenantId, 'pharmacy-advance'));
  return PharmacyAdvance.create({ tenantId: req.tenantId, patientId, number, kind: 'refund', amountPaise, mode, reason, created: stampOf(req) });
}

/**
 * Uses her advance on what she owes the pharmacy, oldest bill first, as far as it goes. Returns the bills paid
 * [{ invoiceId, number, amountPaise }].
 */
export async function useAdvance(req, patientId) {
  const { balancePaise } = await advanceOf(req, patientId);
  if (balancePaise <= 0) throw new HttpError(400, 'No advance is left.', 'NOTHING_LEFT');
  const dues = await patientDues(req, patientId);
  if (dues.duePaise <= 0) throw new HttpError(400, 'Nothing is due from this patient.', 'NOTHING_DUE');
  let left = balancePaise;
  const paid = [];
  for (const b of dues.bills) {
    if (!left) break;
    const part = Math.min(left, b.balancePaise);
    const inv = await PharmacyInvoice.findOne({ tenantId: req.tenantId, _id: b.id });
    inv.payments.push({ kind: 'payment', mode: 'advance', amountPaise: part, reference: '', narration: 'From the pharmacy advance', ...stampOf(req) });
    await inv.save();
    await PharmacyAdvance.create({ tenantId: req.tenantId, patientId, number: inv.number, kind: 'used', amountPaise: part, invoiceId: inv._id, invoiceNumber: inv.number, created: stampOf(req) });
    paid.push({ invoiceId: String(inv._id), number: inv.number, amountPaise: part });
    left -= part;
  }
  return paid;
}
