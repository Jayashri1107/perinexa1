import { Router } from 'express';
import { z } from 'zod';
import { addDays, daysBetween, hospitalDayStart, isoDay } from '../careplans/dates.js';
import { Patient } from '../models/Patient.js';
import { PharmacyInvoice } from '../models/Pharmacy.js';
import { BILL_SEARCH_LIMIT, BILL_TYPES, PAY_CHOICES, billFilter, billRow, billTotals, payFits, returnFits, returnRows, returnTotals } from '../pharmacy/billSearch.js';
import { desk, settingsOf } from '../pharmacy/pharmacyHttp.js';
import { asMade, invoiceTotals } from '../pharmacy/pharmacyService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, parse, requiredDateOnly } from '../utils/validate.js';

// Search bill (23 Nov 2026, the developer, after the "Browse Sales Bill" window of the pharmacy's earlier software):
//  - GET /api/pharmacy/bill-search?type=&first=&last=&mrn=&number=&from=&to=&item=&pay=
//    the bills that fit every part given, newest first (at most BILL_SEARCH_LIMIT), each with its medicines, and the
//    sums of those listed – and (26 Nov 2026) each return as a row of its own, its amounts as minus figures, so a bill
//    stays as it was made. type: opd | ipd | external; first, last: parts of the patient's or customer's name; mrn:
//    the UHID; number: the sales number (or a return's CN number); from, to: the bills' dates; item: part of a
//    medicine's name; pay: cash (paid in full at the counter) | credit (something due, or on the hospital bill).
// Names, numbers and what was sold only; nothing medical. The pharmacist only, as the Sales bill's search; audited as a
// pharmacy report with names (PHARMACY_MIS_VIEWED, report "bill-search") – never the words that were typed.

export const pharmacyBillSearchRouter = Router();

pharmacyBillSearchRouter.use((req, _res, next) => {
  desk(req);
  next();
});

const namePart = z.string().trim().min(1).max(50).optional();
const searchSchema = z
  .object({
    type: z.enum(Object.keys(BILL_TYPES)).optional(),
    first: namePart,
    last: namePart,
    mrn: z.string().trim().min(1).max(40).optional(),
    number: z.string().trim().min(1).max(40).optional(),
    from: requiredDateOnly('From date').optional(),
    to: requiredDateOnly('To date').optional(),
    item: z.string().trim().min(1).max(100).optional(),
    pay: z.enum(PAY_CHOICES).optional(),
    // 26 Nov 2026 (the pharmacy's request): Search sale return – the returns only, pay: cash (money given back) or
    // credit (off what she owed, or off her hospital bill)
    show: z.enum(['bills', 'returns']).default('bills'),
  })
  .strict();

pharmacyBillSearchRouter.get('/', async (req, res) => {
  const q = parse(searchSchema, req.query);
  if (q.from && q.to && q.to < q.from) throw new HttpError(400, 'The To date is before the From date.', 'VALIDATION');
  if (q.from && q.to && daysBetween(q.from, q.to) > 366) throw new HttpError(400, 'Choose dates at most one year apart.', 'VALIDATION');
  const rx = (text) => new RegExp(escapeRegex(text), 'i');

  // A name or a UHID: the registered patients it means, among those the pharmacy has billed (bills are what is listed,
  // so a common name never brings the whole patient list). Each name part typed is in the name, in any order.
  const parts = [q.first, q.last].filter(Boolean).map(rx);
  let person = null;
  if (parts.length || q.mrn) {
    const billed = await PharmacyInvoice.distinct('patientId', { tenantId: req.tenantId, patientId: { $ne: null } });
    const who = { tenantId: req.tenantId, _id: { $in: billed }, ...(q.mrn ? { mrn: rx(q.mrn) } : {}), ...(parts.length ? { $and: parts.map((x) => ({ fullName: x })) } : {}) };
    const patientIds = (await Patient.find(who, { _id: 1 }).lean()).map((p) => p._id);
    person = { patientIds, parts, walkIns: !q.mrn }; // a walk-in has no UHID: a number finds only patients
  }

  const since = q.from ? hospitalDayStart(q.from) : null;
  const before = q.to ? hospitalDayStart(addDays(q.to, 1)) : null;
  const number = q.number ? rx(q.number) : null;
  const item = q.item ? rx(q.item) : null;
  const returnsOnly = q.show === 'returns';
  const filter = billFilter({ tenantId: req.tenantId, type: q.type, since, before, number, item, person });
  if (returnsOnly) filter.$and = [...(filter.$and ?? []), { 'returns.0': { $exists: true } }];
  const found = await PharmacyInvoice.find(filter).sort({ 'created.at': -1, _id: -1 }).limit(BILL_SEARCH_LIMIT + 1).lean();
  const list = found.slice(0, BILL_SEARCH_LIMIT);
  const ids = [...new Set(list.map((i) => i.patientId && String(i.patientId)).filter(Boolean))];
  const patients = new Map((ids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }, { fullName: 1, mrn: 1 }).lean() : []).map((p) => [String(p._id), p]));
  // 26 Nov 2026 (the developer): each bill as it was made, and each return as a row of its own (on its own day) – a
  // bill is listed when it was made on those days and fits the number typed; a return when it was made on those days
  // and its CN number (or its bill's number) fits
  const inRange = (at) => (!since || new Date(at) >= since) && (!before || new Date(at) < before);
  const rows = [];
  for (const i of list) {
    const patient = i.patientId ? (patients.get(String(i.patientId)) ?? null) : null;
    const made = asMade(i);
    if (!returnsOnly && inRange(i.created?.at ?? i.createdAt) && (!number || number.test(i.number))) rows.push(billRow(i, invoiceTotals(i), patient, made));
    rows.push(...returnRows(i, patient, { since, before, number, item, made }));
  }
  rows.sort((a, b) => new Date(b.date) - new Date(a.date) || (a.isReturn === b.isReturn ? 0 : a.isReturn ? -1 : 1));
  const bills = rows.filter((r) => (returnsOnly ? returnFits(r, q.pay) : payFits(r, q.pay)));

  await audit(req, 'PHARMACY_MIS_VIEWED', { details: { report: returnsOnly ? 'return-search' : 'bill-search', ...(q.from ? { from: isoDay(q.from) } : {}), ...(q.to ? { to: isoDay(q.to) } : {}), rows: bills.length } });
  res.json({ bills, totals: billTotals(bills), ...(returnsOnly ? { returnTotals: returnTotals(bills) } : {}), more: found.length > BILL_SEARCH_LIMIT, limit: BILL_SEARCH_LIMIT, settings: await settingsOf(req.tenantId) });
});
