// Selected-bill pharmacy settlement (24 Nov 2026): one registered patient, only counter sales, settled in full with a
// concession, advance and/or money received. Concessions are not payments. The existing pay-all-dues endpoint is kept
// for the older Receive payment screen.

import { randomUUID } from 'node:crypto';
import { stampOf } from '../billing/billingService.js';
import { Admission } from '../models/Admission.js';
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

/** Each patient's pharmacy advance available now (deposits less what was used or refunded), by patient id. */
export async function advanceByPatient(req, pids) {
  const entries = pids.length ? await PharmacyAdvance.find({ tenantId: req.tenantId, patientId: { $in: pids } }, { patientId: 1, kind: 1, amountPaise: 1 }).lean() : [];
  const byPatient = new Map();
  for (const e of entries) byPatient.set(String(e.patientId), (byPatient.get(String(e.patientId)) ?? 0) + (e.kind === 'deposit' ? 1 : -1) * e.amountPaise);
  return byPatient;
}

/**
 * Settlement, IP with nothing typed (24 Nov 2026, the pharmacy's request: "IP should show the IP patients"): everyone
 * admitted now, as the pharmacy's Inpatients list – the one who owes most first, then the latest admitted – with the
 * counter bills of her stay, and an older counter bill while something is still owed on it. Medicines on her hospital
 * bill (ward issues, bills put on it) are paid at the billing desk and are not listed. when/dated: From and To, when
 * given (then the bills of those days).
 */
export async function admittedNowList(req, { when = {}, dated = false } = {}) {
  const stays = await Admission.find({ tenantId: req.tenantId, status: 'admitted' }, { patientId: 1, ward: 1, bed: 1, admittedAt: 1 }).sort({ admittedAt: -1, _id: -1 }).limit(500).lean();
  const stayOf = new Map();
  for (const s of stays) if (!stayOf.has(String(s.patientId))) stayOf.set(String(s.patientId), s);
  const pids = [...stayOf.keys()];
  const people = new Map((pids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: pids } }, { fullName: 1, mrn: 1 }).lean() : []).map((p) => [String(p._id), p]));
  const ids = [...people.keys()];
  const invoices = ids.length ? await PharmacyInvoice.find({ tenantId: req.tenantId, patientId: { $in: ids }, billId: null, kind: 'sale', ...when }).sort({ 'created.at': -1, _id: -1 }).limit(1000).lean() : [];
  const rows = invoices
    .map((inv) => settlementRow(inv, people.get(String(inv.patientId))))
    .filter((r) => dated || r.balancePaise > 0 || new Date(r.date) >= new Date(stayOf.get(r.patientId).admittedAt));
  const advance = await advanceByPatient(req, ids);
  const patients = pids
    .filter((id) => people.has(id))
    .map((id) => {
      const p = people.get(id);
      const stay = stayOf.get(id);
      const own = rows.filter((r) => r.patientId === id);
      return {
        id, fullName: p.fullName, mrn: p.mrn ?? '', type: 'ipd', ward: stay.ward ?? '', bed: stay.bed ?? '', admittedAt: stay.admittedAt,
        billCount: own.length, creditPaise: own.reduce((n, r) => n + r.balancePaise, 0), advancePaise: Math.max(0, advance.get(id) ?? 0), lastAt: own[0]?.date ?? null,
      };
    })
    .sort((a, b) => b.creditPaise - a.creditPaise);
  const creditBills = rows.filter((r) => r.balancePaise > 0);
  return { paidBills: rows.filter((r) => r.balancePaise <= 0), creditBills, totalCreditPaise: creditBills.reduce((n, r) => n + r.balancePaise, 0), patients };
}

/**
 * Settlement's Find patient window (24 Nov 2026, the developer's video of the earlier software's Pharmacy Settlement):
 * IPD – everyone admitted now, with her admission's date and time, IPD number and doctor (start/end: admitted between
 * them); OPD – the patients with counter bills (start/end: on those days), with her latest bill's date and time, number
 * and doctor; someone admitted now is IPD, not OPD. who: a Patient filter of what was typed (the name's parts, the
 * mobile number, the UHID). Newest first, at most 500.
 */
export async function settlementPatients(req, { type, start = null, end = null, who = {}, doctor = null }) {
  const tenantId = req.tenantId;
  const typed = Object.keys(who).length > 0;
  if (type === 'ipd') {
    const stays = await Admission.find({ tenantId, status: 'admitted', ...(start ? { admittedAt: { $gte: start, $lt: end } } : {}), ...(doctor ? { doctorName: doctor } : {}) }, { patientId: 1, admittedAt: 1, ipdNo: 1, doctorName: 1 })
      .sort({ admittedAt: -1, _id: -1 })
      .limit(500)
      .lean();
    const people = new Map((stays.length ? await Patient.find({ tenantId, _id: { $in: stays.map((s) => s.patientId) }, ...who }, { fullName: 1, mrn: 1 }).lean() : []).map((p) => [String(p._id), p]));
    const seen = new Set();
    const rows = stays
      .filter((s) => people.has(String(s.patientId)) && !seen.has(String(s.patientId)) && seen.add(String(s.patientId)))
      .map((s) => {
        const p = people.get(String(s.patientId));
        return { id: String(p._id), mrn: p.mrn ?? '', fullName: p.fullName, type: 'ipd', at: s.admittedAt, number: s.ipdNo ?? '', doctor: s.doctorName ?? '' };
      });
    // 25 Nov 2026 (the pharmacy's request): typed – her UHID or name – still finds a patient with an unsettled IPD
    // counter bill once she is discharged, not only everyone admitted now; a plain IPD browse stays as it was
    if (typed && !start) {
      const matched = await Patient.find({ tenantId, ...who }, { fullName: 1, mrn: 1 }).limit(500).lean();
      const rest = matched.filter((p) => !seen.has(String(p._id)));
      if (rest.length) {
        const owed = await PharmacyInvoice.find(
          { tenantId, patientId: { $in: rest.map((p) => p._id) }, admissionId: { $ne: null }, billId: null, kind: 'sale', ...(doctor ? { 'doctor.name': doctor } : {}) },
          { patientId: 1, number: 1, doctor: 1, created: 1, lines: 1, returns: 1, payments: 1, concessions: 1 },
        )
          .sort({ 'created.at': -1, _id: -1 })
          .lean();
        const latestOwed = new Map();
        for (const inv of owed) {
          if ((invoiceTotals(inv).balancePaise ?? 0) <= 0) continue;
          const id = String(inv.patientId);
          if (!latestOwed.has(id)) latestOwed.set(id, inv);
        }
        for (const p of rest) {
          const inv = latestOwed.get(String(p._id));
          if (!inv) continue;
          seen.add(String(p._id));
          rows.push({ id: String(p._id), mrn: p.mrn ?? '', fullName: p.fullName, type: 'ipd', at: inv.created?.at ?? null, number: inv.number, doctor: inv.doctor?.name ?? '' });
        }
      }
    }
    return rows;
  }
  const admitted = new Set((await Admission.distinct('patientId', { tenantId, status: 'admitted' })).map(String));
  // What was typed: the patients first (so that many bills of others never push hers out); else the bills of the days
  const matched = typed ? await Patient.find({ tenantId, ...who }, { fullName: 1, mrn: 1 }).limit(500).lean() : null;
  const invoices = await PharmacyInvoice.find(
    { tenantId, patientId: matched ? { $in: matched.map((p) => p._id) } : { $ne: null }, billId: null, kind: 'sale', ...(start ? { 'created.at': { $gte: start, $lt: end } } : {}), ...(doctor ? { 'doctor.name': doctor } : {}) },
    { patientId: 1, number: 1, doctor: 1, created: 1 },
  )
    .sort({ 'created.at': -1, _id: -1 })
    .limit(2000)
    .lean();
  const latest = new Map();
  for (const inv of invoices) if (!admitted.has(String(inv.patientId)) && !latest.has(String(inv.patientId))) latest.set(String(inv.patientId), inv);
  const ids = [...latest.keys()].slice(0, 500);
  const people = new Map((matched ?? (ids.length ? await Patient.find({ tenantId, _id: { $in: ids } }, { fullName: 1, mrn: 1 }).lean() : [])).map((p) => [String(p._id), p]));
  return ids
    .filter((id) => people.has(id))
    .map((id) => {
      const p = people.get(id);
      const inv = latest.get(id);
      return { id, mrn: p.mrn ?? '', fullName: p.fullName, type: 'opd', at: inv.created?.at ?? null, number: inv.number, doctor: inv.doctor?.name ?? '' };
    });
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
