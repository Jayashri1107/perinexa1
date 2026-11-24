// Selected-bill pharmacy settlement (24 Nov 2026): one registered patient, only counter sales, settled in full with a
// concession, advance and/or money received. Concessions are not payments. The existing pay-all-dues endpoint is kept
// for the older Receive payment screen.

import { randomUUID } from 'node:crypto';
import { stampOf } from '../billing/billingService.js';
import { Patient } from '../models/Patient.js';
import { PharmacyAdvance, PharmacyInvoice } from '../models/Pharmacy.js';
import { HttpError } from '../utils/httpError.js';
import { advanceOf } from './advance.js';
import { invoiceTotals } from './pharmacyService.js';

const bad = (message, fields) => Object.assign(new HttpError(400, message, 'VALIDATION'), fields ? { fields } : {});
const conflict = (message) => new HttpError(409, message, 'CONFLICT');
// An array still as long as when it was read. A bill saved before 24 Nov 2026 has no concessions array at all in the
// database (Mongoose shows it as empty), and $size never matches a missing field.
const sized = (field, n) => (n ? { [field]: { $size: n } } : { $or: [{ [field]: { $exists: false } }, { [field]: { $size: 0 } }] });

/** One counter bill as the Settlement tables show it. Hospital bills and ward issues never enter this list. */
export function settlementRow(inv, patient = null) {
  const t = invoiceTotals(inv);
  const discount = Math.max(0, t.grossPaise - t.totalPaise);
  const conceded = t.settlementConcessionPaise ?? 0;
  return {
    id: String(inv._id),
    number: inv.number,
    date: inv.created?.at ?? inv.createdAt,
    patientId: inv.patientId ? String(inv.patientId) : null,
    mrn: patient?.mrn ?? '',
    name: patient?.fullName ?? inv.customer?.name ?? inv.buyer?.name ?? 'Walk-in customer',
    type: inv.admissionId ? 'ipd' : inv.patientId ? 'opd' : 'external',
    billAmountPaise: t.grossPaise,
    concessionPaise: discount + conceded,
    netPayablePaise: t.netPaise - conceded, // so that Net pay − Paid = Balance on the screen
    paidPaise: t.paidPaise ?? 0,
    balancePaise: t.balancePaise ?? 0,
    eligible: !inv.billId && inv.kind === 'sale' && Boolean(inv.patientId) && (t.balancePaise ?? 0) > 0,
  };
}

/** The patient's Paid and Credit bills, plus the advance available now. */
export async function settlementData(req, patient, invoices) {
  const rows = invoices.map((inv) => settlementRow(inv, patient)).sort((a, b) => new Date(b.date) - new Date(a.date));
  const creditBills = rows.filter((r) => r.balancePaise > 0);
  return {
    patient: { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn ?? '', phone: patient.phone ?? '' },
    paidBills: rows.filter((r) => r.balancePaise <= 0),
    creditBills,
    totalCreditPaise: creditBills.reduce((n, r) => n + r.balancePaise, 0),
    advance: await advanceOf(req, patient._id),
  };
}

/**
 * Fully settles the chosen bills. Every rupee of their current balance must be accounted for exactly once. Writes are
 * optimistic (array sizes must still match what was read); if a later write fails, this settlement's entries are removed.
 */
export async function settleSelected(req, body) {
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: body.patientId }, { _id: 1, fullName: 1, mrn: 1, phone: 1 }).lean();
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  const invoices = await PharmacyInvoice.find({ tenantId: req.tenantId, patientId: patient._id, _id: { $in: body.invoiceIds } })
    .sort({ 'created.at': 1, _id: 1 });
  if (invoices.length !== body.invoiceIds.length) throw bad('Choose only this patient’s pharmacy bills.', { invoiceIds: 'A bill was not found for this patient.' });
  for (const inv of invoices) {
    if (inv.billId) throw bad('A hospital bill is paid at the billing desk, not at the pharmacy counter.', { invoiceIds: 'Hospital bills cannot be settled here.' });
    if (inv.kind !== 'sale') throw bad('Ward issues cannot be settled at the pharmacy counter.', { invoiceIds: 'Choose a counter sale.' });
    if ((invoiceTotals(inv).balancePaise ?? 0) <= 0) throw bad('A selected bill has nothing left to settle.', { invoiceIds: 'Choose only bills with a balance.' });
  }

  const duePaise = invoices.reduce((n, inv) => n + invoiceTotals(inv).balancePaise, 0);
  const receivedPaise = body.payments.reduce((n, p) => n + p.amountPaise, 0);
  const concessionPaise = body.concessionPaise;
  const advancePaise = body.advancePaise;
  if (concessionPaise > duePaise) throw bad('The concession is more than the selected credit.', { concessionPaise: 'Reduce the concession.' });
  if (concessionPaise && !body.concessionReason) throw bad('Write why the concession is given.', { concessionReason: 'A reason is required.' });
  const advance = await advanceOf(req, patient._id);
  if (advancePaise > advance.balancePaise) throw bad('The advance used is more than the patient has available.', { advancePaise: 'Reduce the advance.' });
  const accountedPaise = concessionPaise + advancePaise + receivedPaise;
  if (accountedPaise !== duePaise) {
    throw bad(`Selected credit is ₹${(duePaise / 100).toFixed(2)}; concession, advance and receipts must add up to exactly that amount.`, {
      ...(accountedPaise < duePaise ? { payments: 'Add the remaining amount, advance or concession.' } : { payments: 'The total is more than the selected credit.' }),
    });
  }

  const settlementId = randomUUID();
  const stamp = stampOf(req);
  const left = invoices.map((inv) => ({ inv, balancePaise: invoiceTotals(inv).balancePaise, concessionPaise: 0, advancePaise: 0, payments: [] }));
  const allocate = (amountPaise, apply) => {
    let rest = amountPaise;
    for (const row of left) {
      if (!rest) break;
      const part = Math.min(rest, row.balancePaise);
      if (!part) continue;
      apply(row, part);
      row.balancePaise -= part;
      rest -= part;
    }
  };
  allocate(concessionPaise, (row, part) => { row.concessionPaise += part; });
  allocate(advancePaise, (row, part) => { row.advancePaise += part; });
  for (const p of body.payments) allocate(p.amountPaise, (row, part) => { row.payments.push({ ...p, amountPaise: part }); });

  const touched = [];
  try {
    // Reserve advance first. A final balance check below catches two counters using the same advance at once.
    for (const row of left) {
      if (!row.advancePaise) continue;
      await PharmacyAdvance.create({
        tenantId: req.tenantId,
        patientId: patient._id,
        number: row.inv.number,
        kind: 'used',
        amountPaise: row.advancePaise,
        invoiceId: row.inv._id,
        invoiceNumber: row.inv.number,
        settlementId,
        created: stamp,
      });
    }
    for (const row of left) {
      if (!row.concessionPaise && !row.advancePaise && !row.payments.length) continue;
      const push = {};
      if (row.concessionPaise) {
        push.concessions = { amountPaise: row.concessionPaise, reason: body.concessionReason, remarks: body.remarks, settlementId, ...stamp };
      }
      const payments = [];
      if (row.advancePaise) payments.push({ kind: 'payment', mode: 'advance', amountPaise: row.advancePaise, narration: 'Settlement from pharmacy advance', settlementId, ...stamp });
      for (const p of row.payments) {
        payments.push({
          kind: 'payment', mode: p.mode, amountPaise: p.amountPaise, reference: p.reference ?? '', bank: p.bank ?? '',
          on: p.on ?? null, authorisedBy: p.authorisedBy ?? '', narration: p.narration || `Settlement ${settlementId}`, settlementId, ...stamp,
        });
      }
      if (payments.length) push.payments = { $each: payments };
      const changed = await PharmacyInvoice.findOneAndUpdate(
        {
          tenantId: req.tenantId, _id: row.inv._id, patientId: patient._id, billId: null, kind: 'sale',
          $and: [sized('payments', row.inv.payments.length), sized('concessions', (row.inv.concessions ?? []).length), sized('returns', (row.inv.returns ?? []).length)],
        },
        { $push: push },
        { new: true },
      );
      if (!changed) throw conflict('A selected bill changed while it was being settled. Reload the bills and try again.');
      touched.push(row.inv._id);
    }
    if ((await advanceOf(req, patient._id)).balancePaise < 0) throw bad('The patient’s advance was used by another settlement. Reload and try again.', { advancePaise: 'Not enough advance is left.' });
  } catch (err) {
    await PharmacyAdvance.deleteMany({ tenantId: req.tenantId, patientId: patient._id, settlementId });
    if (touched.length) {
      await PharmacyInvoice.updateMany(
        { tenantId: req.tenantId, _id: { $in: touched } },
        { $pull: { payments: { settlementId }, concessions: { settlementId } } },
      );
    }
    throw err;
  }

  const result = {
    settlementId,
    duePaise,
    concessionPaise,
    advancePaise,
    receivedPaise,
    invoices: left.map((row) => ({
      invoiceId: String(row.inv._id), number: row.inv.number, concessionPaise: row.concessionPaise, advancePaise: row.advancePaise,
      receivedPaise: row.payments.reduce((n, p) => n + p.amountPaise, 0),
    })),
  };
  const current = await PharmacyInvoice.find({ tenantId: req.tenantId, patientId: patient._id, billId: null, kind: 'sale' }).sort({ 'created.at': -1, _id: -1 }).limit(500).lean();
  return { patient, result, data: await settlementData(req, patient, current) };
}
