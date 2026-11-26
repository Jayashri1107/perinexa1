import { Router } from 'express';
import { z } from 'zod';
import { Admission } from '../models/Admission.js';
import { Bill } from '../models/Bill.js';
import { Patient } from '../models/Patient.js';
import { Medicine, PharmacyInvoice } from '../models/Pharmacy.js';
import { RETURN_TYPES, purchaseHistory, returnableLines, returnSplit, returnedMoney } from '../pharmacy/patientReturn.js';
import { desk, qty, reason, settingsOf, today } from '../pharmacy/pharmacyHttp.js';
import { COUNTER_MODES } from '../pharmacy/pharmacyRules.js';
import { asMade, invoiceTotals, isExpired, returnItems } from '../pharmacy/pharmacyService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, parse, requiredDateOnly } from '../utils/validate.js';
import { addDays, hospitalDayStart, isoDay } from '../careplans/dates.js';

// Sale return patient-wise (24 Nov 2026, the developer, after the earlier software's "Sales Return" window):
//  - GET  /api/pharmacy/patient-return?type=opd|ipd&mrn=&first=&doctor=   the patients found (UHID or first name); with
//    nothing typed (24 Nov 2026, the pharmacy's request): OPD – those with counter bills today, IPD – those admitted now
//    with ward issues
//  - GET  /api/pharmacy/patient-return?type=&patientId=&doctor=           her medicines that can be taken back
//  - POST /api/pharmacy/patient-return                                    takes back quantities from several bills
// OPD: her counter sales; IPD: her ward issues. Each bill returned gets its own credit note (returnItems). The pharmacist
// only. Lookups are in the audit log (PHARMACY_PATIENT_LOOKED_UP, by "patient-return"); every bill returned is
// PHARMACY_RETURNED, as when a bill's medicines are taken back.

export const pharmacyPatientReturnRouter = Router();

pharmacyPatientReturnRouter.use((req, _res, next) => {
  desk(req);
  next();
});

const bad = (message, fields) => Object.assign(new HttpError(400, message, 'VALIDATION'), fields ? { fields } : {});
const doctorFilter = (doctor) => (doctor ? { 'doctor.name': new RegExp(escapeRegex(doctor), 'i') } : {});

/** Her bills of the type that still have something to take back, with what the screen shows. */
async function patientData(req, patient, type, doctor) {
  const invoices = await PharmacyInvoice.find({ tenantId: req.tenantId, patientId: patient._id, kind: RETURN_TYPES[type], ...doctorFilter(doctor) })
    .sort({ 'created.at': -1 })
    .limit(400)
    .lean();
  const open = invoices.filter((inv) => inv.lines.some((l) => (l.returnedQty ?? 0) < l.qty));
  const billIds = [...new Set(open.map((inv) => inv.billId && String(inv.billId)).filter(Boolean))];
  const bills = new Map((billIds.length ? await Bill.find({ tenantId: req.tenantId, _id: { $in: billIds } }, { status: 1, final: 1 }).lean() : []).map((b) => [String(b._id), b]));
  const medicineIds = [...new Set(open.flatMap((inv) => inv.lines.map((l) => String(l.medicineId))))];
  const barcodes = new Map((medicineIds.length ? await Medicine.find({ tenantId: req.tenantId, _id: { $in: medicineIds } }, { barcodes: 1 }).lean() : []).map((m) => [String(m._id), m.barcodes ?? []]));
  const found = returnableLines(open, { today: today(req), bills, barcodes, totalsOf: invoiceTotals, madeOf: (inv) => asMade(inv).madeAs });
  // 26 Nov 2026 (the pharmacy's request): everything she has taken so far – counter sales and ward issues, every
  // doctor's, newest first
  const all = await PharmacyInvoice.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ 'created.at': -1 }).limit(400).lean();
  const allBillIds = [...new Set(all.map((inv) => inv.billId && String(inv.billId)).filter((id) => id && !bills.has(id)))];
  for (const b of allBillIds.length ? await Bill.find({ tenantId: req.tenantId, _id: { $in: allBillIds } }, { status: 1, final: 1 }).lean() : []) bills.set(String(b._id), b);
  const past = purchaseHistory(all, { today: today(req), bills, madeOf: (inv) => asMade(inv).madeAs });
  return { patient: { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn ?? '' }, type, today: isoDay(today(req)), ...found, ...past };
}

const findSchema = z
  .object({
    type: z.enum(Object.keys(RETURN_TYPES)).default('opd'),
    mrn: z.string().trim().max(40).optional(),
    first: z.string().trim().max(50).optional(),
    doctor: z.string().trim().max(150).optional(),
    // 25 Nov 2026 (the pharmacy's request): the Date box, ticked – OPD billed/IPD admitted that day instead of today
    date: requiredDateOnly('Date').optional(),
    patientId: objectId.optional(),
  })
  .strict();

pharmacyPatientReturnRouter.get('/', async (req, res) => {
  const q = parse(findSchema, req.query);
  if (q.patientId) {
    const patient = await Patient.findOne({ tenantId: req.tenantId, _id: q.patientId }, { fullName: 1, mrn: 1 }).lean();
    if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
    const data = await patientData(req, patient, q.type, q.doctor);
    await audit(req, 'PHARMACY_PATIENT_LOOKED_UP', { details: { by: 'patient-return', patientIds: [String(patient._id)], rows: data.lines.length } });
    return res.json({ ...data, settings: await settingsOf(req.tenantId) });
  }
  const mrn = q.mrn ?? '';
  const first = q.first ?? '';
  if (!mrn && !first) {
    const day = q.date ?? today(req);
    const ids =
      q.type === 'ipd'
        ? await PharmacyInvoice.distinct('patientId', { tenantId: req.tenantId, kind: 'issue', patientId: { $in: await Admission.distinct('patientId', { tenantId: req.tenantId, status: 'admitted' }) }, ...doctorFilter(q.doctor) })
        : await PharmacyInvoice.distinct('patientId', { tenantId: req.tenantId, kind: 'sale', patientId: { $ne: null }, 'created.at': { $gte: hospitalDayStart(day), $lt: hospitalDayStart(addDays(day, 1)) }, ...doctorFilter(q.doctor) });
    const people = ids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }, { fullName: 1, mrn: 1 }).sort({ fullName: 1 }).limit(200).lean() : [];
    const patients = people.map((p) => ({ id: String(p._id), fullName: p.fullName, mrn: p.mrn ?? '' }));
    await audit(req, 'PHARMACY_PATIENT_LOOKED_UP', { details: { by: 'patient-return', patientIds: patients.map((p) => p.id), rows: patients.length } });
    return res.json({ type: q.type, list: true, patients });
  }
  if (mrn.length < 2 && first.length < 2) throw bad('Type the registration number (UHID) or at least two letters of the first name.');
  const who = {
    tenantId: req.tenantId,
    ...(mrn ? { mrn: new RegExp(`^${escapeRegex(mrn)}`, 'i') } : {}),
    // the first name: the start of the name or of any word in it
    ...(first ? { fullName: new RegExp(`(^|\\s)${escapeRegex(first)}`, 'i') } : {}),
  };
  const people = await Patient.find(who, { fullName: 1, mrn: 1 }).sort({ fullName: 1 }).limit(100).lean();
  const billed = people.length
    ? new Set((await PharmacyInvoice.distinct('patientId', { tenantId: req.tenantId, patientId: { $in: people.map((p) => p._id) }, kind: RETURN_TYPES[q.type], ...doctorFilter(q.doctor) })).map(String))
    : new Set();
  const patients = people.filter((p) => billed.has(String(p._id))).slice(0, 50).map((p) => ({ id: String(p._id), fullName: p.fullName, mrn: p.mrn ?? '' }));
  await audit(req, 'PHARMACY_PATIENT_LOOKED_UP', { details: { by: 'patient-return', patientIds: patients.map((p) => p.id), rows: patients.length } });
  res.json({ type: q.type, patients });
});

const returnSchema = z
  .object({
    patientId: objectId,
    type: z.enum(Object.keys(RETURN_TYPES)),
    items: z
      .array(z.object({ invoiceId: objectId, lineId: objectId, qty }).strict())
      .min(1, 'Type a return quantity.')
      .max(200)
      .refine((xs) => new Set(xs.map((x) => `${x.invoiceId}:${x.lineId}`)).size === xs.length, 'Each medicine only once.'),
    reason: reason('A return'),
    refund: z.object({ mode: z.enum(COUNTER_MODES), reference: z.string().trim().max(80).default('') }).strict().default({ mode: 'cash', reference: '' }),
  })
  .strict();

pharmacyPatientReturnRouter.post('/', async (req, res) => {
  const body = parse(returnSchema, req.body);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: body.patientId }, { fullName: 1, mrn: 1 }).lean();
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  const ids = [...new Set(body.items.map((x) => x.invoiceId))];
  const invoices = await PharmacyInvoice.find({ tenantId: req.tenantId, patientId: patient._id, kind: RETURN_TYPES[body.type], _id: { $in: ids } }).sort({ 'created.at': 1, _id: 1 });
  if (invoices.length !== ids.length) throw bad('Choose only this patient’s bills.', { items: 'A bill was not found for this patient.' });

  // Everything is checked before anything is taken back
  const day = today(req);
  const plan = [];
  for (const inv of invoices) {
    const items = body.items.filter((x) => x.invoiceId === String(inv._id));
    let amountPaise = 0;
    for (const it of items) {
      const line = inv.lines.id(it.lineId);
      if (!line) throw bad('A medicine of a bill was not found.', { items: 'Reload the list.' });
      const left = line.qty - (line.returnedQty ?? 0);
      if (it.qty > left) throw bad(`${line.name} (bill ${inv.number}): at most ${left} can be taken back.`, { items: 'Lower the return quantity.' });
      if (isExpired(line, day)) throw new HttpError(409, `${line.name}, batch ${line.batch}, has expired: it can't be taken back.`, 'EXPIRED');
      amountPaise += returnedMoney(line, it.qty).amountPaise;
    }
    plan.push({ inv, items: items.map((x) => ({ lineId: x.lineId, qty: x.qty })), split: returnSplit(invoiceTotals(inv), amountPaise, { onHospitalBill: Boolean(inv.billId) }) });
  }
  const billIds = [...new Set(invoices.map((inv) => inv.billId && String(inv.billId)).filter(Boolean))];
  if (billIds.length) {
    const bills = await Bill.find({ tenantId: req.tenantId, _id: { $in: billIds } }, { number: 1, status: 1, final: 1 }).lean();
    const closed = bills.find((b) => b.status !== 'open' || b.final);
    if (closed || bills.length !== billIds.length) throw new HttpError(409, `The hospital bill${closed?.number ? ` ${closed.number}` : ''} is final: the billing desk reopens it before medicines are taken back.`, 'BILL_FINAL');
  }

  const creditNotes = [];
  for (const p of plan) {
    const out = await returnItems(req, p.inv, p.items, body.reason, { ...body.refund, onlyPaid: true });
    creditNotes.push({
      invoiceId: String(p.inv._id),
      number: p.inv.number,
      creditNote: out.number,
      amountPaise: out.credit.amountPaise,
      // 25 Nov 2026 (the pharmacy's request): the Tax box, ticked – CGST/SGST already worked out for the credit note
      // (partOf, in returnItems), only not carried this far before
      taxablePaise: out.credit.taxablePaise,
      cgstPaise: out.credit.cgstPaise,
      sgstPaise: out.credit.sgstPaise,
      refundPaise: out.refundPaise,
      creditPaise: out.credit.amountPaise - out.refundPaise,
      onHospitalBill: Boolean(p.inv.billId),
    });
    await audit(req, 'PHARMACY_RETURNED', {
      details: { invoiceId: String(p.inv._id), number: p.inv.number, creditNote: out.number, amountPaise: out.credit.amountPaise, refundPaise: out.refundPaise, reason: body.reason, patientWise: true },
    });
  }
  const totals = creditNotes.reduce(
    (t, c) => ({
      amountPaise: t.amountPaise + c.amountPaise,
      taxablePaise: t.taxablePaise + c.taxablePaise,
      cgstPaise: t.cgstPaise + c.cgstPaise,
      sgstPaise: t.sgstPaise + c.sgstPaise,
      refundPaise: t.refundPaise + c.refundPaise,
      creditPaise: t.creditPaise + c.creditPaise,
    }),
    { amountPaise: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, refundPaise: 0, creditPaise: 0 },
  );
  res.status(201).json({ creditNotes, totals, refundMode: body.refund.mode, ...(await patientData(req, patient, body.type)), settings: await settingsOf(req.tenantId) });
});
