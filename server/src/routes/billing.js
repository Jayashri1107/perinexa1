import { Router } from 'express';
import { z } from 'zod';
import { BILLING_ROLES, BILL_PCPNDT_MESSAGE, CLAIM_LAYOUTS, GROUPS, GROUP_LABELS, INSURANCE_FIELDS, INSURANCE_LABELS, MAX_PAISE, MIN_REASON, MODE_LABELS, PAYMENT_MODES, PRICE_ROLES, REPORT_ROLES, SETTINGS_ROLES, UPI_MIN_PAISE } from '../billing/billingRules.js';
import { billViews, billingSettings, billingSettingsHistory, claimForm, earlierInsurance, ensurePriceList, findBill, freshBill, labLineName, noteInsurer, openBillFor, padded, pushLines, refuseFetalSex as refuseFetalSexFor, saveBillingSettings, stampOf, userNames } from '../billing/billingService.js';
import { discountPaise, liveLines, rupees, totals } from '../billing/money.js';
import { PAYEE_NAME_MAX, UPI_ID_MAX, payeeNameProblem, upiIdProblem, upiLink, upiMessage } from '../billing/upi.js';
import { addDays, daysBetween, hospitalDayStart, hospitalToday, isoDay, timeIn, toHospitalDate } from '../careplans/dates.js';
import { Bill } from '../models/Bill.js';
import { CashHandover } from '../models/CashHandover.js';
import { collected } from './cashHandover.js';
import { nextNumber } from '../models/Counter.js';
import { Membership, hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { PriceItem } from '../models/PriceItem.js';
import { Tenant } from '../models/Tenant.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { mentionsFetalSex } from '../utils/pcpndt.js';
import { escapeRegex, objectId, parse, requiredDateOnly } from '../utils/validate.js';
import { documentOffer, offerView, sendPatientPdf } from '../visits/whatsappDocuments.js';

// Billing (docs/BILLING_PLAN.md, approved 3 Oct 2026), for reception and the hospital admin:
//  - /api/billing/prices            the price list (everyone who bills reads it; the admin changes it)
//  - /api/billing/bills             a day's bills, a patient's bills, unpaid bills; one bill; a new bill for a patient
//  - /api/billing/bills/:id/…       add or take off items, discount, take payment / deposit / refund, cancel, printed
//  - /api/billing/bills/:id/…       insurance or scheme details, the claim form (and its PM-JAY sheet), the UPI link
//  - /api/billing/settings          the hospital's UPI ID and payee name (everyone who bills reads; the admin changes)
//  - /api/billing/reports/…         the daily cash summary, unpaid bills, monthly income (admin)
//  - /api/billing/export            bills' items or payments for a period, as CSV for Excel (admin)
// Charges added by the work done come from billing/hooks.js. Amounts are paise. The audit log gets ids and amounts.

export const billingRouter = Router();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
billingRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...BILLING_ROLES)) throw forbidden('Billing is for reception, the billing department and the hospital admin.');
  next();
});
const assertRole = (req, roles, message) => {
  if (!hasRole(req.membership, ...roles)) throw forbidden(message);
};

const paise = z.number().int().min(0).max(MAX_PAISE);
const reason = (label) => z.string().trim().min(MIN_REASON, `${label}: please write a reason.`).max(200);
const ids = (b, extra = {}) => ({ billId: String(b._id), number: b.number, patientId: String(b.patientId), ...extra });

async function viewOf(req, bill) {
  const [view] = await billViews(req.tenantId, [bill]);
  return view;
}

// PC-PNDT: text typed on the bill of a patient who is not a baby never mentions the baby's sex – an item's name, a
// reason, the payer or reference of a payment (billingService.js refuseFetalSex, shared with the fee taken when an
// appointment is booked; the insurance details have the same guard in their own schema).
const refuseFetalSex = (req, bill, texts) => refuseFetalSexFor(req, bill.patientId, texts);

// ---------- The price list ----------

const priceView = (p) => ({ id: String(p._id), key: p.key ?? null, name: p.name, group: p.group, pricePaise: p.pricePaise, ward: p.ward ?? null, active: p.active, builtIn: Boolean(p.builtIn), updatedByName: p.updatedByName ?? '' });

billingRouter.get('/prices', async (req, res) => {
  await ensurePriceList(req.tenantId);
  const items = await PriceItem.find({ tenantId: req.tenantId }).sort({ group: 1, order: 1, name: 1 }).lean();
  res.json({ items: items.map(priceView), groups: GROUPS.map((g) => ({ key: g, label: GROUP_LABELS[g] })), canEdit: hasRole(req.membership, ...PRICE_ROLES) });
});

const priceSchema = z
  .object({
    name: z.string().trim().min(2, 'Please enter a name.').max(120),
    group: z.enum(GROUPS),
    pricePaise: paise,
    ward: z.string().trim().max(60).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

billingRouter.post('/prices', async (req, res) => {
  assertRole(req, PRICE_ROLES, 'The price list is kept by the hospital admin.');
  const body = parse(priceSchema, req.body);
  await ensurePriceList(req.tenantId);
  const item = await PriceItem.create({ tenantId: req.tenantId, ...body, ward: body.group === 'inpatient' ? (body.ward ?? null) : null, order: 10_000, updatedByName: req.user.name });
  await audit(req, 'PRICE_LIST_CHANGED', { details: { priceItemId: String(item._id), pricePaise: item.pricePaise, added: true } });
  res.status(201).json({ item: priceView(item) });
});

billingRouter.patch('/prices/:id', async (req, res) => {
  assertRole(req, PRICE_ROLES, 'The price list is kept by the hospital admin.');
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(priceSchema.partial().strict(), req.body);
  const item = await PriceItem.findOne({ tenantId: req.tenantId, _id: id });
  if (!item) throw new HttpError(404, 'Price list item not found.', 'NOT_FOUND');
  // A built-in item that work charges automatically keeps its group (a consultation stays a consultation).
  if (item.key && body.group && body.group !== item.group) throw new HttpError(400, 'This item is charged automatically; its group cannot change.', 'VALIDATION');
  const before = item.pricePaise;
  Object.assign(item, body, { updatedByName: req.user.name });
  if (item.group !== 'inpatient') item.ward = null;
  await item.save();
  await audit(req, 'PRICE_LIST_CHANGED', { details: { priceItemId: String(item._id), from: before, pricePaise: item.pricePaise, ...(body.active === false ? { stopped: true } : {}) } });
  res.json({ item: priceView(item) });
});

// ---------- Lists ----------

const listSchema = z
  .object({
    date: requiredDateOnly('Date').optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

// A day's bills (outpatient bills of the day, and stays with a payment or charge that day), newest first; or, with a
// search (name, phone, patient or bill number), the latest 50 matching bills.
billingRouter.get('/bills', async (req, res) => {
  const q = parse(listSchema, req.query);
  const today = hospitalToday(req.now);
  let bills;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    const patients = await Patient.find({ tenantId: req.tenantId, $or: [{ fullName: rx }, { mrn: rx }, { phone: rx }] }, { _id: 1 }).limit(200).lean();
    bills = await Bill.find({ tenantId: req.tenantId, $or: [{ number: rx }, { patientId: { $in: patients.map((p) => p._id) } }] }).sort({ on: -1, createdAt: -1, _id: -1 }).limit(50).lean();
  } else {
    const day = q.date ?? today;
    const [from, to] = [hospitalDayStart(day), hospitalDayStart(addDays(day, 1))];
    bills = await Bill.find({
      tenantId: req.tenantId,
      $or: [{ on: day }, { kind: 'ipd', status: 'open', on: { $lte: day } }, { 'payments.at': { $gte: from, $lt: to } }],
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
  }
  const views = await billViews(req.tenantId, bills, { full: false });
  res.json({ today: isoDay(today), date: q.search ? null : isoDay(q.date ?? today), bills: views });
});

// A patient's bills (her record's Bills tab), newest first.
billingRouter.get('/patient/:patientId', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }), req.params);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: patientId }, { _id: 1, duplicateOf: 1 }).lean();
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  const bills = await Bill.find({ tenantId: req.tenantId, patientId }).sort({ on: -1, createdAt: -1, _id: -1 }).limit(200).lean();
  const views = await billViews(req.tenantId, bills, { full: false });
  // Money still owed on a record marked as a duplicate of this one (her earlier record): the bills stay there, and
  // reception – who works on this record now – is told here. Numbers only.
  const earlierOwed = [];
  for (const e of await Patient.find({ tenantId: req.tenantId, 'duplicateOf.patient': patient._id }, { mrn: 1 }).sort({ createdAt: 1, _id: 1 }).lean()) {
    const theirs = await Bill.find({ tenantId: req.tenantId, patientId: e._id, status: { $ne: 'cancelled' } }, { lines: 1, discount: 1, payments: 1, status: 1 }).limit(200).lean();
    const balances = theirs.map((b) => totals(b).balance).filter((x) => x > 0);
    if (balances.length) earlierOwed.push({ id: String(e._id), mrn: e.mrn, bills: balances.length, owed: balances.reduce((s, x) => s + x, 0) });
  }
  res.json({
    bills: views,
    owed: views.filter((b) => b.status !== 'cancelled' && b.balance > 0).reduce((s, b) => s + b.balance, 0),
    // A record marked as a duplicate takes no new bill; its open bills stay here, with this note for reception
    duplicateOf: isDuplicate(patient) ? { id: String(patient.duplicateOf.patient), mrn: patient.duplicateOf.mrn } : null,
    earlierOwed,
  });
});

// ---------- One bill ----------

billingRouter.get('/bills/:id', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const bill = await freshBill(req, await findBill(req, id));
  await audit(req, 'BILL_VIEWED', { details: ids(bill) });
  const settings = await billingSettings(req.tenantId);
  res.json({
    bill: await viewOf(req, bill),
    modes: PAYMENT_MODES.map((m) => ({ key: m, label: MODE_LABELS[m] })),
    upiReady: settings.upiReady, // can a UPI payment link be made (Billing → Settings)
    billNotes: settings.billNotes, // printed at the foot of the bill and its receipts
    earlierInsurance: await earlierInsurance(req, bill), // her insurance on an earlier bill, to fill in again
  });
});

// A bill for a patient (reception, e.g. for a scan with no visit): today's open bill – or her stay's – opened if needed.
billingRouter.post('/bills', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.body);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: patientId }, { _id: 1, duplicateOf: 1 }).lean();
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  refuseNewOnDuplicate(patient, 'bill'); // a record marked as a duplicate takes no new bill (an open one stays, and can be paid)
  const bill = await openBillFor(req, patient._id);
  res.status(201).json({ bill: await viewOf(req, await freshBill(req, bill)) });
});

const openBill = async (req) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const bill = await findBill(req, id);
  if (bill.status === 'cancelled') throw conflict('This bill was cancelled.', 'CANCELLED');
  return bill;
};

// Add an item from the price list. An item priced ₹0 (e.g. "Other charge") needs the amount, and may take a name.
const lineSchema = z
  .object({
    priceItemId: objectId,
    qty: z.number().int().min(1).max(365).default(1),
    ratePaise: paise.optional(),
    name: z.string().trim().min(2).max(120).optional(),
    doctorId: objectId.nullable().optional(), // the doctor the charge is for (shown on the bill)
  })
  .strict();

billingRouter.post('/bills/:id/lines', async (req, res) => {
  const bill = await openBill(req);
  const body = parse(lineSchema, req.body);
  const item = await PriceItem.findOne({ tenantId: req.tenantId, _id: body.priceItemId, active: true }).lean();
  if (!item) throw new HttpError(400, 'Choose an item that is in use on the price list.', 'VALIDATION');
  if (!item.pricePaise && !body.ratePaise) throw Object.assign(new HttpError(400, 'This item has no price on the list: enter the amount.', 'VALIDATION'), { fields: { ratePaise: 'Enter the amount.' } });
  await refuseFetalSex(req, bill, { name: body.name });
  const rate = item.pricePaise || body.ratePaise;
  // A confidential test keeps its neutral name on the bill, also when added by hand (labLineName)
  const listed = item.key?.startsWith('lab:') ? labLineName({ key: item.key.slice(4), name: item.name }) : item.name;
  if (body.doctorId && !(await Membership.exists({ tenantId: req.tenantId, userId: body.doctorId, roles: 'doctor', isActive: true }))) throw Object.assign(new HttpError(400, 'Choose a doctor of this hospital.', 'VALIDATION'), { fields: { doctorId: 'Choose a doctor of this hospital.' } });
  const after = await pushLines(req, bill._id, [{ item, name: !item.pricePaise && body.name ? body.name : listed, qty: body.qty, ratePaise: rate, source: 'manual', doctorId: body.doctorId ?? null }]);
  if (!after) throw conflict('This bill was cancelled.', 'CANCELLED');
  await audit(req, 'BILL_ITEM_ADDED', { details: ids(bill, { priceItemId: String(item._id), amountPaise: rate * body.qty }) });
  res.status(201).json({ bill: await viewOf(req, after) });
});

billingRouter.post('/bills/:id/lines/:lineId/remove', async (req, res) => {
  const bill = await openBill(req);
  const { lineId } = parse(z.object({ id: objectId, lineId: objectId }), req.params);
  const body = parse(z.object({ reason: reason('Taking an item off') }).strict(), req.body);
  await refuseFetalSex(req, bill, { reason: body.reason });
  const line = bill.lines.find((l) => String(l._id) === lineId);
  if (!line) throw new HttpError(404, 'Item not found on this bill.', 'NOT_FOUND');
  if (line.removed) throw conflict('This item was already taken off.');
  const after = await Bill.findOneAndUpdate(
    { tenantId: req.tenantId, _id: bill._id },
    { $set: { 'lines.$[l].removed': { ...stampOf(req), reason: body.reason } } },
    { arrayFilters: [{ 'l._id': line._id, 'l.removed': null }], returnDocument: 'after' },
  ).lean();
  await audit(req, 'BILL_ITEM_REMOVED', { details: ids(bill, { amountPaise: line.amountPaise, reason: body.reason }) });
  res.json({ bill: await viewOf(req, after) });
});

// A discount: an amount (paise) or a percentage, with a reason. Value 0 takes the discount off.
const discountSchema = z
  .object({ mode: z.enum(['amount', 'percent']), value: z.number().min(0).max(MAX_PAISE), reason: z.string().trim().max(200).default('') })
  .strict()
  .refine((d) => d.mode !== 'percent' || d.value <= 100, { message: 'A percentage can be at most 100.', path: ['value'] })
  .refine((d) => d.mode !== 'amount' || Number.isInteger(d.value), { message: 'Enter the amount in paise.', path: ['value'] })
  .refine((d) => d.value === 0 || d.reason.length >= MIN_REASON, { message: 'Please write why the discount is given.', path: ['reason'] });

billingRouter.post('/bills/:id/discount', async (req, res) => {
  const bill = await openBill(req);
  const body = parse(discountSchema, req.body);
  await refuseFetalSex(req, bill, { reason: body.reason });
  const { subtotal } = totals(bill);
  const amount = discountPaise(body, subtotal);
  if (amount > subtotal) throw Object.assign(new HttpError(400, 'The discount is more than the bill.', 'VALIDATION'), { fields: { value: 'More than the bill.' } });
  const after = await Bill.findOneAndUpdate(
    { tenantId: req.tenantId, _id: bill._id, status: 'open' },
    { $set: { discount: body.value ? { mode: body.mode, value: body.value, paise: amount, reason: body.reason, ...stampOf(req) } : null } },
    { returnDocument: 'after' },
  ).lean();
  await audit(req, 'DISCOUNT_GIVEN', { details: ids(bill, { mode: body.mode, value: body.value, discountPaise: amount, reason: body.reason }) });
  res.json({ bill: await viewOf(req, after) });
});

// A payment (a deposit while she is in hospital), or a refund of money paid beyond the bill.
const paymentSchema = z
  .object({
    kind: z.enum(['payment', 'refund']).default('payment'),
    mode: z.enum(PAYMENT_MODES),
    amountPaise: z.number().int().min(1, 'Enter the amount.').max(MAX_PAISE),
    reference: z.string().trim().max(80).default(''),
    scheme: z.string().trim().max(80).default(''),
  })
  .strict();

billingRouter.post('/bills/:id/payments', async (req, res) => {
  const bill = await freshBill(req, await openBill(req));
  const body = parse(paymentSchema, req.body);
  // Paid by insurance: the payer is the one typed, else the one in the bill's insurance details (kept consistent)
  const scheme = body.mode === 'insurance' ? body.scheme || (bill.insurance?.insurer ?? '') : '';
  if (body.mode === 'insurance' && scheme.length < 2) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { scheme: 'Write the insurance company or scheme.' } });
  await refuseFetalSex(req, bill, { scheme, reference: body.reference });
  const t = totals(bill);
  const stayOpen = bill.kind === 'ipd' && (await viewOf(req, bill)).stay?.inHospital;
  if (body.kind === 'refund') {
    if (body.amountPaise > Math.max(0, -t.balance)) throw new HttpError(400, t.balance < 0 ? `At most ${(-t.balance / 100).toFixed(2)} can be refunded.` : 'Nothing is due back on this bill.', 'VALIDATION');
  } else if (!stayOpen && body.amountPaise > t.balance) {
    // Outside a stay, a payment can't be more than what is due (a deposit during a stay can).
    throw new HttpError(400, t.balance > 0 ? `The balance is ${(t.balance / 100).toFixed(2)}: take at most that.` : 'Nothing is due on this bill.', 'VALIDATION');
  }
  const receipt = padded('R', await nextNumber(req.tenantId, 'receipt'));
  const kind = body.kind === 'refund' ? 'refund' : stayOpen ? 'deposit' : 'payment';
  const payment = { receipt, kind, mode: body.mode, amountPaise: body.amountPaise, reference: body.reference, scheme, ...stampOf(req) };
  const paid = await Bill.findOneAndUpdate({ tenantId: req.tenantId, _id: bill._id, status: 'open' }, { $push: { payments: payment } }, { returnDocument: 'after' }).lean();
  if (!paid) throw conflict('This bill was cancelled.', 'CANCELLED');
  await audit(req, kind === 'refund' ? 'REFUND_GIVEN' : 'PAYMENT_RECEIVED', { details: ids(bill, { receipt, kind, mode: body.mode, amountPaise: body.amountPaise }) });
  // A bill with no insurance details yet takes the payer of an insurance payment as its insurer, and a bill with no
  // claim number takes the one typed with the payment
  const after = (kind !== 'refund' && scheme ? await noteInsurer(req, paid, scheme, body.reference) : null) ?? paid;
  const view = await viewOf(req, after);
  res.status(201).json({ bill: view, payment: view.payments.find((p) => p.receipt === receipt) });
});

// ---------- Correcting a payment (owner, 19 Oct 2026 – docs/BILL_CORRECTIONS_PLAN.md) ----------
// E.g. the UPI payment failed and she paid in cash: the mode, reference, amount or time is corrected, never deleted.
// Reception and the billing department correct on the day of the payment, until that day's cash handover of the person
// who took it is confirmed; after that (or on a later day) only the hospital admin. A reason always.

/** Who may correct this payment now: 'desk' (reception too), 'admin' (only the hospital admin). */
async function correctableBy(req, p) {
  const day = toHospitalDate(p.at);
  if (day.getTime() !== hospitalToday(req.now).getTime()) return 'admin';
  const handover = await CashHandover.findOne({ tenantId: req.tenantId, day, userId: p.by }, { received: 1 }).lean();
  return handover?.received ? 'admin' : 'desk';
}

const correctionSchema = z
  .object({
    mode: z.enum(PAYMENT_MODES),
    amountPaise: z.number().int().min(1, 'Enter the amount.').max(MAX_PAISE),
    reference: z.string().trim().max(80).default(''),
    scheme: z.string().trim().max(80).default(''),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter the time as HH:MM.').optional(), // the same day
    reason: z.string().trim().min(MIN_REASON, 'Write why it is corrected.').max(300),
  })
  .strict();

billingRouter.post('/bills/:id/payments/:paymentId/correct', async (req, res) => {
  const bill = await openBill(req);
  const { paymentId } = parse(z.object({ id: objectId, paymentId: objectId }), req.params);
  const p = (bill.payments ?? []).find((x) => String(x._id) === paymentId);
  if (!p) throw new HttpError(404, 'This payment is not on the bill.', 'NOT_FOUND');
  const body = parse(correctionSchema, req.body);
  if ((await correctableBy(req, p)) === 'admin' && !hasRole(req.membership, 'admin')) {
    throw forbidden("After the day's cash handover is confirmed, or on a later day, only the hospital admin corrects a payment.");
  }
  const scheme = body.mode === 'insurance' ? body.scheme || (bill.insurance?.insurer ?? '') : '';
  if (body.mode === 'insurance' && scheme.length < 2) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { scheme: 'Write the insurance company or scheme.' } });
  await refuseFetalSex(req, bill, { scheme, reference: body.reference, reason: body.reason });
  const day = toHospitalDate(p.at);
  const at = body.time ? new Date(hospitalDayStart(day).getTime() + (Number(body.time.slice(0, 2)) * 60 + Number(body.time.slice(3))) * 60000) : p.at;
  if (at > (req.now ?? new Date())) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { time: 'The time cannot be later than now.' } });
  // The amount: within what was due without this payment (a deposit during a stay may be more)
  const t = totals(bill);
  if (p.kind === 'refund') {
    const dueBack = Math.max(0, -(t.balance - p.amountPaise));
    if (body.amountPaise > dueBack) throw Object.assign(new HttpError(400, `At most ${(dueBack / 100).toFixed(2)} can be refunded.`, 'VALIDATION'), { fields: { amountPaise: 'More than is due back.' } });
  } else if (p.kind === 'payment' && body.amountPaise > t.balance + p.amountPaise) {
    throw Object.assign(new HttpError(400, `The bill comes to ${((t.balance + p.amountPaise) / 100).toFixed(2)} without this payment: at most that.`, 'VALIDATION'), { fields: { amountPaise: 'More than is due.' } });
  }
  const same = body.mode === p.mode && body.amountPaise === p.amountPaise && body.reference === (p.reference ?? '') && scheme === (p.scheme ?? '') && at.getTime() === new Date(p.at).getTime();
  if (same) throw new HttpError(400, 'Nothing was changed.', 'VALIDATION');
  const before = { mode: p.mode, amountPaise: p.amountPaise, reference: p.reference ?? '', scheme: p.scheme ?? '', at: p.at };
  const after = await Bill.findOneAndUpdate(
    { tenantId: req.tenantId, _id: bill._id, status: 'open', payments: { $elemMatch: { _id: p._id, amountPaise: p.amountPaise, mode: p.mode } } },
    {
      $set: { 'payments.$[p].mode': body.mode, 'payments.$[p].amountPaise': body.amountPaise, 'payments.$[p].reference': body.reference, 'payments.$[p].scheme': scheme, 'payments.$[p].at': at },
      $push: { 'payments.$[p].corrections': { before, reason: body.reason, ...stampOf(req) } },
    },
    { arrayFilters: [{ 'p._id': p._id }], returnDocument: 'after' },
  ).lean();
  if (!after) throw conflict('Someone changed this payment or the bill meanwhile. Open the bill again.', 'CONFLICT');
  // The day's cash handover follows: recounted while it waits for a confirmation; once confirmed it is kept as it was,
  // with the correction shown on it
  const handover = await CashHandover.findOne({ tenantId: req.tenantId, day, userId: p.by });
  if (handover && !handover.received) {
    Object.assign(handover, await collected(req.tenantId, p.by, day));
    await handover.save();
  } else if (handover) {
    handover.correctedAfter.push({ receipt: p.receipt, beforePaise: p.amountPaise, afterPaise: body.amountPaise, beforeMode: p.mode, afterMode: body.mode, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
    await handover.save();
  }
  await audit(req, 'PAYMENT_CORRECTED', {
    details: ids(bill, { receipt: p.receipt, kind: p.kind, before: { mode: p.mode, amountPaise: p.amountPaise }, after: { mode: body.mode, amountPaise: body.amountPaise }, timeChanged: at.getTime() !== new Date(p.at).getTime(), reason: body.reason }),
  });
  const view = await viewOf(req, after);
  res.json({ bill: view, payment: view.payments.find((x) => x.receipt === p.receipt) });
});

/** Who may correct each payment of a bill now (for the Correct button): { [paymentId]: 'desk' | 'admin' }. */
billingRouter.get('/bills/:id/corrections', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const bill = await findBill(req, id);
  const out = {};
  for (const p of bill.payments ?? []) out[String(p._id)] = await correctableBy(req, p);
  res.json({ correctableBy: out, isAdmin: hasRole(req.membership, 'admin') });
});

billingRouter.post('/bills/:id/cancel', async (req, res) => {
  const bill = await openBill(req);
  const body = parse(z.object({ reason: reason('Cancelling a bill') }).strict(), req.body);
  await refuseFetalSex(req, bill, { reason: body.reason });
  if (totals(bill).paid > 0) throw conflict('Money was paid on this bill: refund it first, then cancel the bill.', 'PAID');
  const after = await Bill.findOneAndUpdate({ tenantId: req.tenantId, _id: bill._id, status: 'open' }, { $set: { status: 'cancelled', cancelled: { ...stampOf(req), reason: body.reason } } }, { returnDocument: 'after' }).lean();
  await audit(req, 'BILL_CANCELLED', { details: ids(bill, { reason: body.reason, totalPaise: totals(bill).total }) });
  res.json({ bill: await viewOf(req, after) });
});

billingRouter.post('/bills/:id/printed', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(z.object({ receipt: z.string().max(20).optional() }).strict(), req.body);
  const bill = await findBill(req, id);
  await audit(req, 'BILL_PRINTED', { details: ids(bill, body.receipt ? { receipt: body.receipt } : {}) });
  res.json({ ok: true });
});

// ---------- The bill or a receipt on WhatsApp (owner, 17 Oct 2026 – docs/WHATSAPP_DESK_PLAN.md) ----------
// In one click from the hospital's WhatsApp number, to the mobile number on her record, when she agreed to WhatsApp
// messages (visits/whatsappDocuments.js). The PDF is made in the browser. The audit log gets ids only.

const billPatient = (req, bill) => Patient.findOne({ tenantId: req.tenantId, _id: bill.patientId }, { mrn: 1, phone: 1, reminders: 1, 'death.on': 1 }).lean();

billingRouter.get('/bills/:id/whatsapp', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const bill = await findBill(req, id);
  res.json(offerView(await documentOffer(req.tenantId, await billPatient(req, bill))));
});

billingRouter.post('/bills/:id/whatsapp', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(z.object({ pdf: z.string().min(100).max(7_500_000), receipt: z.string().max(20).optional() }).strict(), req.body);
  const bill = await findBill(req, id);
  if (body.receipt && !(bill.payments ?? []).some((p) => p.receipt === body.receipt)) throw new HttpError(404, 'This receipt is not on the bill.', 'NOT_FOUND');
  const offer = await documentOffer(req.tenantId, await billPatient(req, bill));
  // The file's name has the bill or receipt number, never her name
  await sendPatientPdf(offer, { pdf: body.pdf, fileName: body.receipt ? `Receipt-${body.receipt}.pdf` : `Bill-${bill.number}.pdf` });
  await audit(req, 'BILL_SENT_WHATSAPP', { details: ids(bill, { ...(body.receipt ? { receipt: body.receipt } : {}), ...(offer.practice ? { practice: true } : {}) }) });
  res.status(201).json({ sent: true, practice: offer.practice });
});

// ---------- Insurance or scheme details on a bill (billing extras, 4 Oct 2026) ----------

// All optional, typed by reception or the hospital admin. The claim itself is made outside Perinexa. Free text about a
// patient who is not a baby goes through the fetal-sex guard (PC-PNDT). Everything empty takes the details off.
const insuranceSchema = (guarded) =>
  z
    .object(
      Object.fromEntries(
        Object.entries(INSURANCE_FIELDS).map(([key, max]) => {
          const text = z.string().trim().max(max, `${INSURANCE_LABELS[key]} is too long`);
          return [key, (guarded ? text.refine((t) => !mentionsFetalSex(t), BILL_PCPNDT_MESSAGE) : text).default('')];
        }),
      ),
    )
    .strict();

billingRouter.put('/bills/:id/insurance', async (req, res) => {
  const bill = await openBill(req);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: bill.patientId }, { careType: 1 }).lean();
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  const body = parse(insuranceSchema(patient.careType !== 'newborn'), req.body);
  const keys = Object.keys(INSURANCE_FIELDS);
  const any = keys.some((k) => body[k]);
  if (any && body.insurer.length < 2) {
    throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { insurer: 'Write the insurance company or scheme (for PM-JAY, write PM-JAY).' } });
  }
  const changed = keys.filter((k) => (bill.insurance?.[k] ?? '') !== body[k]);
  if (!changed.length) return res.json({ bill: await viewOf(req, bill) });
  const after = await Bill.findOneAndUpdate({ tenantId: req.tenantId, _id: bill._id, status: 'open' }, { $set: { insurance: any ? { ...body, ...stampOf(req) } : null } }, { returnDocument: 'after' }).lean();
  if (!after) throw conflict('This bill was cancelled.', 'CANCELLED');
  // Which details changed – never what was typed
  await audit(req, 'BILL_INSURANCE_CHANGED', { details: ids(bill, { fields: changed, ...(any ? {} : { removed: true }) }) });
  res.json({ bill: await viewOf(req, after) });
});

// ---------- The claim form and the PM-JAY claim sheet ----------

// What the two printouts hold (billing/billingService.js claimForm): identity, dates, her doctor, the bill by group,
// the insurance details. No clinical detail: that part is printed empty for the treating doctor.
const claimable = async (req) => {
  const bill = await freshBill(req, await openBill(req));
  if (!liveLines(bill).length) throw conflict('This bill has no charges to claim.', 'NO_CHARGES');
  return bill;
};

billingRouter.get('/bills/:id/claim-form', async (req, res) => {
  const bill = await claimable(req);
  const form = await claimForm(req, bill);
  await audit(req, 'BILL_VIEWED', { details: ids(bill, { claimForm: true }) });
  res.json({ form });
});

billingRouter.post('/bills/:id/claim-form/printed', async (req, res) => {
  const bill = await claimable(req);
  const { layout } = parse(z.object({ layout: z.enum(CLAIM_LAYOUTS) }).strict(), req.body);
  await audit(req, 'CLAIM_FORM_PRINTED', { details: ids(bill, { layout }) });
  res.json({ ok: true });
});

// ---------- The UPI payment link ----------

// The standard UPI link and a message to copy, for the balance (or a part of it). It is only text: Perinexa is
// connected to no bank and no gateway, and making a link records NOTHING on the bill – reception records the payment
// with "Take payment" when the money has arrived. Nothing about the patient is in the link except the bill number.
billingRouter.post('/bills/:id/upi-link', async (req, res) => {
  const bill = await freshBill(req, await openBill(req));
  const body = parse(z.object({ amountPaise: z.number().int().min(UPI_MIN_PAISE, 'A UPI payment is at least ₹1.').max(MAX_PAISE).optional() }).strict(), req.body);
  const { balance } = totals(bill);
  if (balance <= 0) throw conflict('Nothing is due on this bill.', 'NOTHING_DUE');
  const amountPaise = body.amountPaise ?? balance;
  if (amountPaise > balance) throw Object.assign(new HttpError(400, `The balance is ${rupees(balance)}: the link can ask for at most that.`, 'VALIDATION'), { fields: { amountPaise: 'More than the balance.' } });
  if (amountPaise < UPI_MIN_PAISE) throw Object.assign(new HttpError(400, 'A UPI payment is at least ₹1.', 'VALIDATION'), { fields: { amountPaise: 'At least ₹1.' } });
  const settings = await billingSettings(req.tenantId);
  if (!settings.upiReady) throw conflict('The hospital’s UPI ID is not set yet. The hospital admin enters it under Billing → Settings.', 'UPI_NOT_SET');
  const { upiId, payeeName } = settings;
  const link = upiLink({ upiId, payeeName, amountPaise, billNumber: bill.number });
  await audit(req, 'UPI_LINK_MADE', { details: ids(bill) }); // ids only: no amount, no link
  res.status(201).json({ link, message: upiMessage({ upiId, payeeName, amountPaise, billNumber: bill.number, link }), amountPaise, upiId, payeeName, number: bill.number });
});

// ---------- Billing settings: the hospital's UPI ID and payee name ----------

// Everyone who bills reads the UPI ID and payee name. The hospital admin also gets their history: every change, with
// who made it and when – so it can be seen which UPI ID the links of any day pointed to (the audit log, which keeps no
// values, says who made a link for which bill and when).
const settingsAnswer = async (req) => {
  const canEdit = hasRole(req.membership, ...SETTINGS_ROLES);
  return { settings: await billingSettings(req.tenantId), canEdit, ...(canEdit ? { history: await billingSettingsHistory(req.tenantId) } : {}) };
};

billingRouter.get('/settings', async (req, res) => {
  res.json(await settingsAnswer(req));
});

const settingsSchema = z.object({ upiId: z.string().trim().max(UPI_ID_MAX, 'The UPI ID is too long.'), payeeName: z.string().trim().max(PAYEE_NAME_MAX, 'The payee name is too long.') }).strict();

// The lines printed at the foot of every bill and receipt (owner, 27 Oct 2026) – the hospital admin
billingRouter.put('/settings/bill-notes', async (req, res) => {
  assertRole(req, SETTINGS_ROLES, 'The billing settings are kept by the hospital admin.');
  const { billNotes } = parse(z.object({ billNotes: z.string().trim().max(600, 'Keep the notes to 600 characters.') }).strict(), req.body);
  if (mentionsFetalSex(billNotes)) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { billNotes: BILL_PCPNDT_MESSAGE } });
  const before = (await billingSettings(req.tenantId)).billNotes;
  if (before !== billNotes) {
    await Tenant.updateOne({ _id: req.tenantId }, { $set: { 'billing.billNotes': billNotes } });
    await audit(req, 'BILLING_SETTINGS_CHANGED', { details: { fields: ['billNotes'] } });
  }
  res.json(await settingsAnswer(req));
});

billingRouter.put('/settings', async (req, res) => {
  assertRole(req, SETTINGS_ROLES, 'The billing settings are kept by the hospital admin.');
  const body = parse(settingsSchema, req.body);
  // Both empty switches UPI links off; a UPI ID needs the right format and its payee name
  const fields = {};
  if (body.upiId && upiIdProblem(body.upiId)) fields.upiId = upiIdProblem(body.upiId);
  if (body.payeeName && payeeNameProblem(body.payeeName)) fields.payeeName = payeeNameProblem(body.payeeName);
  if (body.upiId && !body.payeeName) fields.payeeName = 'Enter the name the UPI ID is registered under.';
  if (Object.keys(fields).length) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
  const before = await billingSettings(req.tenantId);
  const changed = ['upiId', 'payeeName'].filter((k) => before[k] !== body[k]);
  if (changed.length) {
    await saveBillingSettings(req, before, body); // also kept in the settings' own history, with who and when
    await audit(req, 'BILLING_SETTINGS_CHANGED', { details: { fields: changed } }); // which settings – the audit log keeps no UPI ID
  }
  res.json(await settingsAnswer(req));
});

// ---------- Reports ----------

// The daily cash summary: money in and out on a day by mode and by person, discounts given and bills cancelled.
billingRouter.get('/reports/daily', async (req, res) => {
  const { date } = parse(z.object({ date: requiredDateOnly('Date').optional() }).strict(), req.query);
  const day = date ?? hospitalToday(req.now);
  const [from, to] = [hospitalDayStart(day), hospitalDayStart(addDays(day, 1))];
  const inDay = (t) => t && t >= from && t < to;
  const bills = await Bill.find({ tenantId: req.tenantId, $or: [{ 'payments.at': { $gte: from, $lt: to } }, { 'discount.at': { $gte: from, $lt: to } }, { 'cancelled.at': { $gte: from, $lt: to } }] }).lean();
  const byMode = Object.fromEntries(PAYMENT_MODES.map((m) => [m, { in: 0, out: 0 }]));
  const byPerson = new Map();
  const payments = [];
  for (const b of bills) {
    for (const p of b.payments ?? []) {
      if (!inDay(p.at)) continue;
      const out = p.kind === 'refund';
      byMode[p.mode][out ? 'out' : 'in'] += p.amountPaise;
      const who = byPerson.get(p.byName) ?? { name: p.byName, in: 0, out: 0, count: 0 };
      who[out ? 'out' : 'in'] += p.amountPaise;
      who.count += 1;
      byPerson.set(p.byName, who);
      payments.push({ bill: b, p });
    }
  }
  const views = new Map((await billViews(req.tenantId, bills, { full: false })).map((v) => [v.id, v]));
  // OPD and IPD apart, and what was charged this day by service group (owner, 27 Oct 2026: like the hospital's
  // "Daily collection" and "Group wise summary")
  const byKind = { opd: { in: 0, out: 0 }, ipd: { in: 0, out: 0 } };
  for (const { bill, p } of payments) byKind[bill.kind === 'ipd' ? 'ipd' : 'opd'][p.kind === 'refund' ? 'out' : 'in'] += p.amountPaise;
  const charged = await Bill.find({ tenantId: req.tenantId, status: { $ne: 'cancelled' }, 'lines.added.at': { $gte: from, $lt: to } }, { lines: 1 }).lean();
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, { count: 0, amount: 0 }]));
  for (const b of charged) {
    for (const l of b.lines ?? []) {
      if (l.removed || !inDay(l.added?.at) || !byGroup[l.group]) continue;
      byGroup[l.group].count += l.qty ?? 1;
      byGroup[l.group].amount += l.amountPaise;
    }
  }
  const servicesOf = (bill) => [...new Set(liveLines(bill).map((l) => l.name))].join(', ');
  const totalIn = Object.values(byMode).reduce((s, m) => s + m.in, 0);
  const totalOut = Object.values(byMode).reduce((s, m) => s + m.out, 0);
  res.json({
    date: isoDay(day),
    totals: { in: totalIn, out: totalOut, net: totalIn - totalOut },
    byMode: PAYMENT_MODES.map((m) => ({ mode: m, label: MODE_LABELS[m], ...byMode[m], net: byMode[m].in - byMode[m].out })),
    byPerson: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)),
    byKind: ['opd', 'ipd'].map((k) => ({ kind: k, ...byKind[k], net: byKind[k].in - byKind[k].out })),
    byGroup: GROUPS.filter((g) => byGroup[g].count).map((g) => ({ group: g, label: GROUP_LABELS[g], ...byGroup[g] })),
    payments: payments
      .sort((a, b) => a.p.at - b.p.at)
      .map(({ bill, p }) => {
        const v = views.get(String(bill._id));
        return { receipt: p.receipt, at: p.at, kind: p.kind, mode: p.mode, amountPaise: p.amountPaise, byName: p.byName, billId: String(bill._id), number: bill.number, billKind: bill.kind, doctorName: v?.doctorName ?? '', services: servicesOf(bill), patient: v?.patient ?? null };
      }),
    discounts: bills.filter((b) => inDay(b.discount?.at)).map((b) => ({ billId: String(b._id), number: b.number, patient: views.get(String(b._id))?.patient ?? null, discountPaise: b.discount.paise, reason: b.discount.reason ?? '', byName: b.discount.byName ?? '' })),
    cancelled: bills.filter((b) => inDay(b.cancelled?.at)).map((b) => ({ billId: String(b._id), number: b.number, patient: views.get(String(b._id))?.patient ?? null, reason: b.cancelled.reason ?? '', byName: b.cancelled.byName ?? '' })),
  });
});

// The daily summary saved as a PDF (Download PDF on its print preview): written down, as every export is.
billingRouter.post('/reports/daily/saved', async (req, res) => {
  const { date } = parse(z.object({ date: requiredDateOnly('Date') }).strict(), req.body);
  await audit(req, 'BILLING_EXPORTED', { details: { what: 'daily-summary', from: isoDay(date), to: isoDay(date) } });
  res.json({ ok: true });
});

// Unpaid bills: who owes how much, since when (oldest first).
billingRouter.get('/reports/unpaid', async (req, res) => {
  const bills = await Bill.find({ tenantId: req.tenantId, status: 'open' }).sort({ on: 1 }).limit(2000).lean();
  const owing = bills.filter((b) => totals(b).balance !== 0);
  const views = await billViews(req.tenantId, owing, { full: false });
  const today = hospitalToday(req.now);
  res.json({
    bills: views.map((v) => ({ ...v, days: daysBetween(new Date(`${v.date}T00:00:00Z`), today) })),
    owed: views.filter((v) => v.balance > 0).reduce((s, v) => s + v.balance, 0),
    dueBack: views.filter((v) => v.balance < 0).reduce((s, v) => s - v.balance, 0),
  });
});

// Monthly income for a year: charged (by group, by doctor) and collected, month by month.
billingRouter.get('/reports/monthly', async (req, res) => {
  assertRole(req, REPORT_ROLES, 'The monthly report is for the hospital admin and the billing department.');
  const { year } = parse(z.object({ year: z.coerce.number().int().min(2020).max(2100).optional() }).strict(), req.query);
  const y = year ?? hospitalToday(req.now).getUTCFullYear();
  const [from, to] = [hospitalDayStart(new Date(Date.UTC(y, 0, 1))), hospitalDayStart(new Date(Date.UTC(y + 1, 0, 1)))];
  const bills = await Bill.find({ tenantId: req.tenantId, $or: [{ 'lines.added.at': { $gte: from, $lt: to } }, { 'payments.at': { $gte: from, $lt: to } }] }).lean();
  const months = Array.from({ length: 12 }, (_, m) => ({ month: `${y}-${String(m + 1).padStart(2, '0')}`, charged: 0, discount: 0, collected: 0, groups: Object.fromEntries(GROUPS.map((g) => [g, 0])) }));
  const monthOf = (t) => (t && t >= from && t < to ? toHospitalDate(t).getUTCMonth() : null);
  const byDoctor = new Map();
  for (const b of bills) {
    for (const p of b.payments ?? []) {
      const m = monthOf(p.at);
      if (m != null) months[m].collected += p.kind === 'refund' ? -p.amountPaise : p.amountPaise;
    }
    if (b.status === 'cancelled') continue;
    for (const l of b.lines ?? []) {
      const m = monthOf(l.added?.at);
      if (m == null || l.removed) continue;
      months[m].charged += l.amountPaise;
      months[m].groups[l.group] += l.amountPaise;
      if (l.doctorId) byDoctor.set(String(l.doctorId), (byDoctor.get(String(l.doctorId)) ?? 0) + l.amountPaise);
    }
    const dm = monthOf(b.discount?.at);
    if (dm != null) months[dm].discount += b.discount.paise ?? 0;
  }
  const names = await userNames([...byDoctor.keys()]);
  res.json({
    year: y,
    groups: GROUPS.map((g) => ({ key: g, label: GROUP_LABELS[g] })),
    months,
    byDoctor: [...byDoctor.entries()].map(([id, amount]) => ({ id, name: names.get(id) ?? 'Doctor', chargedPaise: amount })).sort((a, b) => b.chargedPaise - a.chargedPaise),
  });
});

// ---------- Export for the accountant ----------

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never a formula when opened in Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
const amount = (p) => (p / 100).toFixed(2);

billingRouter.get('/export', async (req, res) => {
  assertRole(req, REPORT_ROLES, 'The export is for the hospital admin and the billing department.');
  const q = parse(z.object({ from: requiredDateOnly('From'), to: requiredDateOnly('To'), what: z.enum(['items', 'payments']) }).strict(), req.query);
  if (q.to < q.from || daysBetween(q.from, q.to) > 366) throw new HttpError(400, 'Choose a period of at most one year, ending after it starts.', 'VALIDATION');
  const [from, to] = [hospitalDayStart(q.from), hospitalDayStart(addDays(q.to, 1))];
  const field = q.what === 'items' ? 'lines.added.at' : 'payments.at';
  const bills = await Bill.find({ tenantId: req.tenantId, [field]: { $gte: from, $lt: to } }).sort({ on: 1 }).lean();
  const views = new Map((await billViews(req.tenantId, bills, { full: false })).map((v) => [v.id, v]));
  const inRange = (t) => t && t >= from && t < to;
  const day = (t) => isoDay(toHospitalDate(t));
  let rows;
  if (q.what === 'items') {
    const doctors = await userNames(bills.flatMap((b) => b.lines.map((l) => l.doctorId)));
    rows = [['Bill', 'Bill date', 'Bill status', 'Patient number', 'Patient', 'Date added', 'Item', 'Group', 'Quantity', 'Rate', 'Amount', 'Taken off', 'Doctor']];
    for (const b of bills) {
      const v = views.get(String(b._id));
      for (const l of b.lines) {
        if (!inRange(l.added?.at)) continue;
        rows.push([b.number, isoDay(b.on), b.status === 'cancelled' ? 'Cancelled' : 'Open', v.patient?.mrn, v.patient?.fullName, day(l.added.at), l.name, GROUP_LABELS[l.group], l.qty, amount(l.ratePaise), amount(l.amountPaise), l.removed ? `Yes – ${l.removed.reason ?? ''}` : '', doctors.get(String(l.doctorId)) ?? '']);
      }
    }
  } else {
    rows = [['Receipt', 'Date', 'Time', 'Bill', 'Patient number', 'Patient', 'Kind', 'Mode', 'Amount', 'Reference', 'Insurance / scheme', 'Taken by']];
    for (const b of bills) {
      const v = views.get(String(b._id));
      for (const p of b.payments) {
        if (!inRange(p.at)) continue;
        const time = timeIn(p.at);
        rows.push([p.receipt, day(p.at), time, b.number, v.patient?.mrn, v.patient?.fullName, p.kind, MODE_LABELS[p.mode], amount(p.kind === 'refund' ? -p.amountPaise : p.amountPaise), p.reference, p.scheme, p.byName]);
      }
    }
  }
  await audit(req, 'BILLING_EXPORTED', { details: { what: q.what, from: isoDay(q.from), to: isoDay(q.to), rows: rows.length - 1 } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="perinexa-${q.what}-${isoDay(q.from)}-to-${isoDay(q.to)}.csv"`);
  res.send(csv(rows));
});
