import { Router } from 'express';
import { z } from 'zod';
import { addDays, daysBetween, hospitalDayStart, isoDay, timeIn, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { Medicine, PharmacyInvoice, Purchase, PurchaseOrder, StockBatch, StockMove, Supplier, SupplierReturn } from '../models/Pharmacy.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { einvoiceHsn, einvoiceOf, einvoiceProblems } from '../pharmacy/einvoice.js';
import { byRate, suggestedQty, sum } from '../pharmacy/gst.js';
import { cleanGstin, gstinProblem, gstinState } from '../pharmacy/gstin.js';
import { applyPurchase, countPurchaseOnOrder, orderToReceive } from '../pharmacy/ordersService.js';
import { batchView, desk, editor, forbidden, idParam, medicineView, paise, qty, reason, reports, settingsOf, supplierView, today } from '../pharmacy/pharmacyHttp.js';
import {
  BARCODE_PATTERN,
  COUNTER_MODES,
  CONTROLLED,
  EXPIRY_REPORT_DAYS,
  EXPIRY_WARNING_DAYS,
  FORMS,
  GST_RATES,
  MAX_BARCODES,
  MAX_QTY,
  MIN_REASON,
  PHARMACY_EINVOICE_ROLES,
  PHARMACY_EXPORT_ROLES,
  PHARMACY_ROLES,
  SCHEDULES,
  SCHEDULE_LABELS,
  SUPPLIER_RETURN_REASON_LABELS,
  cleanBarcode,
} from '../pharmacy/pharmacyRules.js';
import { cancelPurchase, countStock, createInvoice, createPurchase, daysLeft, invoiceTotals, invoiceViews, isExpired, returnItems, stockOf, writeOff } from '../pharmacy/pharmacyService.js';
import { isDuplicate } from '../patients/duplicateRules.js';
import { isClosed } from '../patients/deathRules.js';
import { NOT_CANCELLED, returnTotals } from '../pharmacy/supplierReturnsService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, parse, requiredDateOnly } from '../utils/validate.js';
import { pharmacyOrdersRouter } from './pharmacyOrders.js';
import { pharmacySupplierReturnsRouter } from './pharmacySupplierReturns.js';

// Pharmacy and medicine stock (docs/PHARMACY_PLAN.md, approved 3 Oct 2026), for the pharmacist (and the hospital admin
// for the reports and the medicine list):
//  - /api/pharmacy/settings, /medicines, /suppliers        the pharmacy's details, the stock list, the suppliers
//  - /api/pharmacy/purchases                                supplier invoices (stock in, batch by batch)
//  - /api/pharmacy/stock, /batches/:id/writeoff|count       stock, write-offs, counts
//  - /api/pharmacy/patients/:id/prescriptions, /inpatients  what to sell or issue
//  - /api/pharmacy/invoices                                 counter sales and issues to admitted patients (GST tax
//                                                           invoices), returns (credit notes)
//  - /api/pharmacy/reports/…, /export                       alerts, registers (H1, X, narcotic), sales, GST, export
// Pharmacy extras (4 Oct 2026):
//  - /api/pharmacy/orders            purchase orders to suppliers (routes/pharmacyOrders.js)
//  - /api/pharmacy/supplier-returns  stock returned to a supplier, with debit notes (routes/pharmacySupplierReturns.js)
//  - /api/pharmacy/barcode/:code     the medicine a barcode belongs to (exact match)
//  - /api/pharmacy/invoices/:id/einvoice   the e-invoice file of a sale to a business with a GSTIN (hospital admin)
// Pharmacists see patients' names, numbers and phones, and the medicines prescribed – never diagnoses or notes.

export const pharmacyRouter = Router();

pharmacyRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...PHARMACY_ROLES)) throw forbidden('The pharmacy is for pharmacists and the hospital admin.');
  next();
});
pharmacyRouter.use('/orders', pharmacyOrdersRouter);
pharmacyRouter.use('/supplier-returns', pharmacySupplierReturnsRouter);

// ---------- The pharmacy's details ----------

const settingsSchema = z
  .object({
    name: z.string().trim().max(150),
    gstin: z.string().trim().max(20),
    licence20: z.string().trim().max(80),
    licence21: z.string().trim().max(80),
    rmi: z.string().trim().max(80),
    pharmacistName: z.string().trim().max(150),
    state: z.string().trim().max(60),
    // City or town and PIN code: only the e-invoice file needs them
    place: z.string().trim().max(50),
    pin: z.string().trim().regex(/^([1-9]\d{5})?$/, 'A PIN code has 6 digits.'),
  })
  .partial()
  .strict();

pharmacyRouter.get('/settings', async (req, res) => {
  res.json({ settings: await settingsOf(req.tenantId), canEdit: hasRole(req.membership, 'pharmacist', 'admin'), lists: { forms: FORMS, gstRates: GST_RATES, schedules: SCHEDULES.map((s) => ({ key: s, label: SCHEDULE_LABELS[s] })), modes: COUNTER_MODES } });
});

pharmacyRouter.put('/settings', async (req, res) => {
  editor(req);
  const body = parse(settingsSchema, req.body);
  await Tenant.updateOne({ _id: req.tenantId }, { $set: Object.fromEntries(Object.entries(body).map(([k, v]) => [`pharmacy.${k}`, v])) });
  await audit(req, 'PHARMACY_SETTINGS_CHANGED', { details: { fields: Object.keys(body) } });
  res.json({ settings: await settingsOf(req.tenantId) });
});

// ---------- Medicines ----------

const medicineFields = {
  name: z.string().trim().min(2, 'Please enter the name.').max(120),
  generic: z.string().trim().max(160),
  form: z.enum(FORMS),
  strength: z.string().trim().max(60),
  unit: z.string().trim().min(1).max(30),
  hsn: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/, 'An HSN code has 4, 6 or 8 digits.'),
  gstRate: z.union(GST_RATES.map((r) => z.literal(r))),
  schedule: z.enum(SCHEDULES),
  reorderLevel: z.number().int().min(0).max(MAX_QTY),
  // The barcodes on its packs (typed, or scanned: a scanner types the digits). Kept without spaces, in capitals.
  barcodes: z
    .array(z.string().max(60).transform(cleanBarcode).pipe(z.string().regex(BARCODE_PATTERN, 'A barcode has 4 to 32 digits or letters.')))
    .max(MAX_BARCODES, `A medicine can hold at most ${MAX_BARCODES} barcodes.`)
    .transform((list) => [...new Set(list)]),
  active: z.boolean(),
};
// A new medicine: what is left out starts empty.
const medicineSchema = z
  .object({
    ...medicineFields,
    generic: medicineFields.generic.default(''),
    strength: medicineFields.strength.default(''),
    hsn: medicineFields.hsn.default(''),
    schedule: medicineFields.schedule.default(''),
    reorderLevel: medicineFields.reorderLevel.default(0),
    barcodes: medicineFields.barcodes.optional(),
    active: medicineFields.active.optional(),
  })
  .strict();
// A change: ONLY what is sent changes. (Until 4 Oct 2026 the starting values above were also applied to a change, so
// "Stop using" – which sends only `active` – emptied the generic name, strength, HSN code, schedule and reorder
// level: a narcotic lost its schedule. A change never fills anything in now.)
const medicineChangeSchema = z.object(medicineFields).partial().strict();

/** A barcode belongs to only one medicine in a hospital: refuses one that another medicine already holds. */
async function barcodesFree(req, codes, exceptId = null) {
  if (!codes?.length) return;
  const other = await Medicine.findOne({ tenantId: req.tenantId, barcodes: { $in: codes }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { name: 1, barcodes: 1 }).lean();
  if (!other) return;
  const code = codes.find((c) => other.barcodes.includes(c));
  const message = `Barcode ${code} is already on ${other.name}. A barcode belongs to one medicine only.`;
  throw Object.assign(new HttpError(409, message, 'DUPLICATE'), { fields: { barcodes: message } });
}

pharmacyRouter.get('/medicines', async (req, res) => {
  const q = parse(z.object({ search: z.string().trim().max(100).optional(), active: z.enum(['1', '0']).optional() }).strict(), req.query);
  const filter = { tenantId: req.tenantId };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { generic: rx }];
  }
  if (q.active === '1') filter.active = true;
  const meds = await Medicine.find(filter).sort({ name: 1 }).limit(500).lean();
  const stock = await stockOf(req.tenantId, meds.map((m) => m._id));
  res.json({ medicines: meds.map((m) => medicineView(m, stock.get(String(m._id)) ?? 0)) });
});

pharmacyRouter.post('/medicines', async (req, res) => {
  editor(req);
  const body = parse(medicineSchema, req.body);
  await barcodesFree(req, body.barcodes);
  const m = await Medicine.create({ tenantId: req.tenantId, ...body, updatedByName: req.user.name });
  await audit(req, 'PHARMACY_MEDICINE_CHANGED', { details: { medicineId: String(m._id), added: true, schedule: m.schedule, ...(m.barcodes.length ? { barcodes: m.barcodes.length } : {}) } });
  res.status(201).json({ medicine: medicineView(m.toObject(), 0) });
});

pharmacyRouter.patch('/medicines/:id', async (req, res) => {
  editor(req);
  const body = parse(medicineChangeSchema, req.body);
  const m = await Medicine.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!m) throw new HttpError(404, 'Medicine not found.', 'NOT_FOUND');
  await barcodesFree(req, body.barcodes, m._id);
  Object.assign(m, body, { updatedByName: req.user.name });
  await m.save();
  await audit(req, 'PHARMACY_MEDICINE_CHANGED', { details: { medicineId: String(m._id), fields: Object.keys(body), ...(body.barcodes ? { barcodes: m.barcodes.length } : {}) } });
  const stock = await stockOf(req.tenantId, [m._id]);
  res.json({ medicine: medicineView(m.toObject(), stock.get(String(m._id)) ?? 0) });
});

// The medicine a barcode belongs to – the exact barcode only, never a near match (a wrong medicine is worse than
// none). Nothing about a patient is read, so it is not in the audit log (like finding a medicine by name).
pharmacyRouter.get('/barcode/:code', async (req, res) => {
  const code = cleanBarcode(req.params.code);
  if (!BARCODE_PATTERN.test(code)) throw new HttpError(400, 'A barcode has 4 to 32 digits or letters.', 'VALIDATION');
  const m = await Medicine.findOne({ tenantId: req.tenantId, barcodes: code }).lean();
  if (!m) throw new HttpError(404, `No medicine has the barcode ${code}. Find the medicine by name, then add this barcode to it under Medicines.`, 'NOT_FOUND');
  const stock = await stockOf(req.tenantId, [m._id]);
  res.json({ medicine: medicineView(m, stock.get(String(m._id)) ?? 0) });
});

// ---------- Suppliers ----------

const supplierFields = {
  name: z.string().trim().min(2, 'Please enter the name.').max(150),
  gstin: z.string().trim().max(20),
  drugLicence: z.string().trim().max(80),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(300),
  active: z.boolean(),
};
const supplierSchema = z
  .object({
    ...supplierFields,
    gstin: supplierFields.gstin.default(''),
    drugLicence: supplierFields.drugLicence.default(''),
    phone: supplierFields.phone.default(''),
    address: supplierFields.address.default(''),
    active: supplierFields.active.optional(),
  })
  .strict();
// A change: only what is sent changes (see the medicines above).
const supplierChangeSchema = z.object(supplierFields).partial().strict();

pharmacyRouter.get('/suppliers', async (req, res) => {
  const list = await Supplier.find({ tenantId: req.tenantId }).sort({ name: 1 }).lean();
  res.json({ suppliers: list.map(supplierView) });
});
pharmacyRouter.post('/suppliers', async (req, res) => {
  editor(req);
  const s = await Supplier.create({ tenantId: req.tenantId, ...parse(supplierSchema, req.body) });
  await audit(req, 'PHARMACY_SUPPLIER_CHANGED', { details: { supplierId: String(s._id), added: true } });
  res.status(201).json({ supplier: supplierView(s) });
});
pharmacyRouter.patch('/suppliers/:id', async (req, res) => {
  editor(req);
  const body = parse(supplierChangeSchema, req.body);
  const s = await Supplier.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!s) throw new HttpError(404, 'Supplier not found.', 'NOT_FOUND');
  Object.assign(s, body);
  await s.save();
  await audit(req, 'PHARMACY_SUPPLIER_CHANGED', { details: { supplierId: String(s._id), fields: Object.keys(body) } });
  res.json({ supplier: supplierView(s) });
});

// ---------- Purchases ----------

const purchaseSchema = z
  .object({
    supplierId: objectId,
    invoiceNo: z.string().trim().min(1, 'Enter the supplier’s invoice number.').max(60),
    invoiceDate: requiredDateOnly('Invoice date'),
    orderId: objectId.optional(), // the purchase order this delivery is received against
    lines: z
      .array(
        z
          .object({
            medicineId: objectId,
            batch: z.string().trim().min(1, 'Enter the batch.').max(40),
            expiry: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter the expiry month (YYYY-MM).'),
            qty: z.number().int().min(0).max(MAX_QTY),
            freeQty: z.number().int().min(0).max(MAX_QTY).default(0),
            ratePaise: paise,
            mrpPaise: paise.min(1, 'Enter the MRP.'),
          })
          .strict(),
      )
      .min(1, 'Add at least one medicine.')
      .max(100),
  })
  .strict();

async function purchaseViews(req, list) {
  const suppliers = new Map((await Supplier.find({ tenantId: req.tenantId, _id: { $in: list.map((p) => p.supplierId) } }, { name: 1 }).lean()).map((s) => [String(s._id), s.name]));
  const orderIds = list.map((p) => p.orderId).filter(Boolean);
  const orders = new Map((orderIds.length ? await PurchaseOrder.find({ tenantId: req.tenantId, _id: { $in: orderIds } }, { number: 1 }).lean() : []).map((o) => [String(o._id), o.number]));
  return list.map((p) => ({
    id: String(p._id),
    number: p.number,
    supplier: suppliers.get(String(p.supplierId)) ?? '',
    order: p.orderId && orders.has(String(p.orderId)) ? { id: String(p.orderId), number: orders.get(String(p.orderId)) } : null,
    invoiceNo: p.invoiceNo,
    invoiceDate: isoDay(p.invoiceDate),
    totalPaise: p.totalPaise,
    status: p.status,
    cancelled: p.cancelled ? { reason: p.cancelled.reason, byName: p.cancelled.byName, at: p.cancelled.at } : null,
    byName: p.created?.byName ?? '',
    lines: p.lines.map((l) => ({ name: l.name, batch: l.batch, expiry: isoDay(l.expiry), qty: l.qty, freeQty: l.freeQty, ratePaise: l.ratePaise, mrpPaise: l.mrpPaise })),
  }));
}

pharmacyRouter.get('/purchases', async (req, res) => {
  const list = await Purchase.find({ tenantId: req.tenantId }).sort({ invoiceDate: -1, createdAt: -1 }).limit(200).lean();
  res.json({ purchases: await purchaseViews(req, list) });
});
pharmacyRouter.post('/purchases', async (req, res) => {
  desk(req);
  const body = parse(purchaseSchema, req.body);
  // Received against a purchase order: the order is checked before any stock comes in
  const order = body.orderId ? await orderToReceive(req, body.orderId, body) : null;
  const p = await createPurchase(req, body);
  // The stock is in: that is in the audit log first, with the order it was entered against
  await audit(req, 'PHARMACY_PURCHASE_ENTERED', { details: { purchaseId: String(p._id), number: p.number, lines: p.lines.length, totalPaise: p.totalPaise, ...(order ? { orderId: String(order._id), order: order.number } : {}) } });
  // Now the order counts it – unless it was cancelled or closed at this very moment: the purchase then stays without
  // the order, and the answer and the audit log (notCounted) say so.
  const got = order ? await countPurchaseOnOrder(req, order._id, p) : null;
  const orderNow = got?.order ?? order;
  if (got) {
    await audit(req, 'PHARMACY_ORDER_RECEIVED', {
      details: { orderId: String(order._id), number: order.number, purchaseId: String(p._id), purchase: p.number, status: orderNow.status, ...(got.counted ? {} : { notCounted: got.why }) },
    });
  }
  const [view] = await purchaseViews(req, [p.toObject()]);
  res.status(201).json({
    purchase: view,
    ...(got ? { order: { id: String(orderNow._id), number: orderNow.number, status: orderNow.status, closed: Boolean(orderNow.closed), counted: got.counted, ...(got.counted ? {} : { notCounted: got.why }) } } : {}),
  });
});
pharmacyRouter.post('/purchases/:id/cancel', async (req, res) => {
  desk(req);
  const { reason: why } = parse(z.object({ reason: reason('Cancelling a purchase') }).strict(), req.body);
  const p = await Purchase.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!p) throw new HttpError(404, 'Purchase not found.', 'NOT_FOUND');
  await cancelPurchase(req, p, why);
  // What it brought in no longer counts towards its purchase order
  if (p.orderId) await applyPurchase(req, p.orderId, p.lines, -1);
  await audit(req, 'PHARMACY_PURCHASE_CANCELLED', { details: { purchaseId: String(p._id), number: p.number, reason: why } });
  const [view] = await purchaseViews(req, [p.toObject()]);
  res.json({ purchase: view });
});

// ---------- Stock ----------

// Every medicine with its stock (usable and expired), value at cost and at MRP, the nearest expiry and the low mark.
pharmacyRouter.get('/stock', async (req, res) => {
  const t = today(req);
  const meds = await Medicine.find({ tenantId: req.tenantId }).sort({ name: 1 }).lean();
  const batches = await StockBatch.find({ tenantId: req.tenantId, qtyLeft: { $gt: 0 } }).lean();
  const byMed = new Map();
  for (const b of batches) {
    const k = String(b.medicineId);
    if (!byMed.has(k)) byMed.set(k, []);
    byMed.get(k).push(b);
  }
  const rows = meds.map((m) => {
    const bs = byMed.get(String(m._id)) ?? [];
    const usable = bs.filter((b) => !isExpired(b, t));
    const qtyUsable = usable.reduce((s, b) => s + b.qtyLeft, 0);
    const nearest = usable.map((b) => b.expiry).sort((a, b) => a - b)[0] ?? null;
    return {
      ...medicineView(m),
      qty: qtyUsable,
      expiredQty: bs.filter((b) => isExpired(b, t)).reduce((s, b) => s + b.qtyLeft, 0),
      costValuePaise: bs.reduce((s, b) => s + b.qtyLeft * b.costPaise, 0),
      mrpValuePaise: bs.reduce((s, b) => s + b.qtyLeft * b.mrpPaise, 0),
      nearestExpiry: nearest ? isoDay(nearest) : null,
      expiringSoon: nearest ? daysLeft(nearest, t) <= EXPIRY_WARNING_DAYS : false,
      low: m.active && qtyUsable <= (m.reorderLevel ?? 0),
    };
  });
  res.json({
    medicines: rows,
    totals: { costValuePaise: rows.reduce((s, r) => s + r.costValuePaise, 0), mrpValuePaise: rows.reduce((s, r) => s + r.mrpValuePaise, 0), low: rows.filter((r) => r.low).length },
  });
});

// One medicine: its batches and its recent stock moves.
pharmacyRouter.get('/stock/:id', async (req, res) => {
  const t = today(req);
  const m = await Medicine.findOne({ tenantId: req.tenantId, _id: idParam(req) }).lean();
  if (!m) throw new HttpError(404, 'Medicine not found.', 'NOT_FOUND');
  const batches = await StockBatch.find({ tenantId: req.tenantId, medicineId: m._id }).sort({ expiry: 1 }).lean();
  const moves = await StockMove.find({ tenantId: req.tenantId, medicineId: m._id }).sort({ at: -1, _id: -1 }).limit(100).lean();
  const batchName = new Map(batches.map((b) => [String(b._id), b.batch]));
  res.json({
    medicine: medicineView(m, batches.filter((b) => !isExpired(b, t)).reduce((s, b) => s + b.qtyLeft, 0)),
    batches: batches.filter((b) => b.qtyLeft > 0 || daysBetween(b.updatedAt ?? b.createdAt, req.now ?? new Date()) < 90).map((b) => batchView(b, t)),
    moves: moves.map((x) => ({ at: x.at, kind: x.kind, qty: x.qty, balanceAfter: x.balanceAfter, batch: batchName.get(String(x.batchId)) ?? '', ref: x.ref?.number ?? '', reason: x.reason ?? '', witness: x.witness ?? '', byName: x.byName ?? '' })),
  });
});

async function loadBatch(req) {
  const b = await StockBatch.findOne({ tenantId: req.tenantId, _id: idParam(req) }).lean();
  if (!b) throw new HttpError(404, 'Batch not found.', 'NOT_FOUND');
  const m = await Medicine.findOne({ tenantId: req.tenantId, _id: b.medicineId }).lean();
  return { b, m };
}

pharmacyRouter.post('/batches/:id/writeoff', async (req, res) => {
  desk(req);
  const body = parse(z.object({ qty, reason: reason('Writing off stock') }).strict(), req.body);
  const { b, m } = await loadBatch(req);
  const after = await writeOff(req, b, body.qty, body.reason);
  await audit(req, 'PHARMACY_STOCK_WRITTEN_OFF', { details: { medicineId: String(m._id), batchId: String(b._id), qty: body.qty, reason: body.reason } });
  res.json({ batch: batchView(after, today(req)) });
});

pharmacyRouter.post('/batches/:id/count', async (req, res) => {
  desk(req);
  const body = parse(z.object({ counted: z.number().int().min(0).max(MAX_QTY), reason: reason('Correcting the stock'), witness: z.string().trim().max(150).default('') }).strict(), req.body);
  const { b, m } = await loadBatch(req);
  const after = await countStock(req, b, body.counted, body.reason, body.witness, m);
  await audit(req, 'PHARMACY_STOCK_COUNTED', { details: { medicineId: String(m._id), batchId: String(b._id), from: b.qtyLeft, to: body.counted, reason: body.reason, ...(body.witness ? { witness: body.witness } : {}) } });
  res.json({ batch: batchView(after, today(req)) });
});

// The batches a medicine can be sold from (not expired, with stock), earliest expiry first.
pharmacyRouter.get('/medicines/:id/batches', async (req, res) => {
  const t = today(req);
  const list = await StockBatch.find({ tenantId: req.tenantId, medicineId: idParam(req), qtyLeft: { $gt: 0 }, expiry: { $gte: utcDay(t) } }).sort({ expiry: 1 }).lean();
  res.json({ batches: list.map((b) => batchView(b, t)), warnDays: EXPIRY_WARNING_DAYS });
});

// ---------- What to sell or issue ----------

// A patient's recent prescriptions – the medicines only, matched to the stock list by name (pharmacist).
pharmacyRouter.get('/patients/:id/prescriptions', async (req, res) => {
  desk(req);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: idParam(req) }, { fullName: 1, mrn: 1, phone: 1, duplicateOf: 1, 'death.on': 1 }).lean();
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  // Also the prescriptions written on a record that was marked as a duplicate of hers (her earlier record): she is
  // sold to on this record, and the paper in her hand may be from the other one. Nothing is moved.
  const earlier = new Map((await Patient.find({ tenantId: req.tenantId, 'duplicateOf.patient': patient._id }, { mrn: 1 }).lean()).map((e) => [String(e._id), e.mrn]));
  const visits = await Visit.find({ tenantId: req.tenantId, patientId: { $in: [patient._id, ...earlier.keys()] }, status: 'active', 'prescription.items.0': { $exists: true } }, { patientId: 1, visitOn: 1, prescription: 1 })
    .sort({ visitOn: -1, createdAt: -1 })
    .limit(5)
    .lean();
  const doctors = new Map((await User.find({ _id: { $in: visits.map((v) => v.prescription?.by).filter(Boolean) } }, { name: 1, professional: 1 }).lean()).map((u) => [String(u._id), u]));
  const meds = await Medicine.find({ tenantId: req.tenantId, active: true }, { name: 1, generic: 1, strength: 1, schedule: 1, unit: 1, gstRate: 1 }).lean();
  const stock = await stockOf(req.tenantId, meds.map((m) => m._id));
  const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const match = (drug) => {
    const want = words(drug);
    return meds
      .map((m) => ({ m, score: want.filter((w) => words(`${m.name} ${m.generic}`).includes(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (stock.get(String(b.m._id)) ?? 0) - (stock.get(String(a.m._id)) ?? 0))
      .slice(0, 3)
      .map((x) => ({ id: String(x.m._id), name: x.m.name, generic: x.m.generic ?? '', strength: x.m.strength ?? '', schedule: x.m.schedule ?? '', unit: x.m.unit, gstRate: x.m.gstRate, inStock: stock.get(String(x.m._id)) ?? 0 }));
  };
  await audit(req, 'PHARMACY_PRESCRIPTIONS_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn, prescriptions: visits.length } });
  res.json({
    // duplicateOf: this record is marked as a duplicate – it takes no sale ({ id, mrn } of the main record to open)
    // closed: the record is closed (no counter sale – never why)
    patient: {
      id: String(patient._id),
      fullName: patient.fullName,
      mrn: patient.mrn,
      phone: patient.phone ?? '',
      duplicateOf: isDuplicate(patient) ? { id: String(patient.duplicateOf.patient), mrn: patient.duplicateOf.mrn } : null,
      closed: isClosed(patient),
    },
    prescriptions: visits.map((v) => {
      const by = v.prescription?.by ? doctors.get(String(v.prescription.by)) : null;
      return {
        visitId: String(v._id),
        date: isoDay(v.visitOn),
        // Written on her earlier record (its patient number), not on this one
        fromRecord: earlier.get(String(v.patientId)) ?? null,
        doctor: by ? { name: by.name, reg: by.professional?.registrationNumber ?? '' } : null,
        items: v.prescription.items.map((it) => ({
          id: String(it._id),
          drug: it.drug,
          form: it.form,
          strength: it.strength ?? '',
          dose: it.dose ?? '',
          frequency: it.frequency,
          frequencyText: it.frequencyText ?? '',
          durationValue: it.durationValue ?? null,
          durationUnit: it.durationUnit ?? '',
          suggestedQty: suggestedQty(it),
          matches: match(`${it.drug} ${it.strength ?? ''}`),
        })),
      };
    }),
  });
});

// Admitted patients (to issue medicines to).
pharmacyRouter.get('/inpatients', async (req, res) => {
  desk(req);
  const stays = await Admission.find({ tenantId: req.tenantId, status: 'admitted' }, { patientId: 1, ward: 1, bed: 1, admittedAt: 1 }).sort({ admittedAt: -1 }).lean();
  const patients = new Map((await Patient.find({ tenantId: req.tenantId, _id: { $in: stays.map((s) => s.patientId) } }, { fullName: 1, mrn: 1, phone: 1 }).lean()).map((p) => [String(p._id), p]));
  res.json({
    inpatients: stays
      .filter((s) => patients.has(String(s.patientId)))
      .map((s) => {
        const p = patients.get(String(s.patientId));
        return { patient: { id: String(p._id), fullName: p.fullName, mrn: p.mrn, phone: p.phone ?? '' }, ward: s.ward ?? '', bed: s.bed ?? '', admittedAt: s.admittedAt };
      }),
  });
});

// ---------- Invoices ----------

const invoiceSchema = z
  .object({
    kind: z.enum(['sale', 'issue']),
    patientId: objectId.optional(),
    customer: z.object({ name: z.string().trim().min(2, 'Write the customer’s name.').max(150), phone: z.string().trim().max(30).default('') }).strict().optional(),
    doctor: z.object({ name: z.string().trim().max(150).default(''), reg: z.string().trim().max(60).default('') }).strict().optional(),
    visitId: objectId.optional(),
    rxSeen: z.boolean().default(false),
    lines: z.array(z.object({ medicineId: objectId, qty, batchId: objectId.optional() }).strict()).min(1, 'Add at least one medicine.').max(60),
    discountPercent: z.number().min(0).max(100).default(0),
    discountReason: z.string().trim().max(200).default(''),
    payment: z.object({ mode: z.enum(COUNTER_MODES), reference: z.string().trim().max(80).default('') }).strict().optional(),
    // A walk-in sale to a business that gives its GSTIN (for its tax invoice and the e-invoice file). Its state is
    // read from the GSTIN's first two digits.
    buyer: z
      .object({
        name: z.string().trim().min(3, 'Write the business’s name as on its GST certificate.').max(100),
        gstin: z
          .string()
          .max(40)
          .transform(cleanGstin)
          .superRefine((g, ctx) => {
            const problem = gstinProblem(g);
            if (problem) ctx.addIssue({ code: 'custom', message: problem });
          }),
        address: z.string().trim().min(3, 'Write the business’s address.').max(200),
        place: z.string().trim().min(3, 'Write the city or town.').max(50),
        pin: z.string().trim().regex(/^[1-9]\d{5}$/, 'A PIN code has 6 digits.'),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((b) => !b.buyer || (!b.patientId && b.kind === 'sale'), { message: 'A business buyer is for a walk-in sale at the counter, not for a patient.', path: ['buyer'] })
  .refine((b) => Boolean(b.patientId) !== Boolean(b.customer), { message: 'Choose the patient, or write a walk-in customer’s name.', path: ['patientId'] })
  .refine((b) => b.patientId || b.payment, { message: 'A walk-in customer pays at the counter: choose how.', path: ['payment'] })
  .refine((b) => !b.discountPercent || b.discountReason.length >= MIN_REASON, { message: 'Please write why the discount is given.', path: ['discountReason'] })
  .refine((b) => b.kind === 'sale' || b.patientId, { message: 'Medicines are issued to an admitted patient.', path: ['patientId'] });

const loadInvoice = async (req) => {
  const inv = await PharmacyInvoice.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!inv) throw new HttpError(404, 'Invoice not found.', 'NOT_FOUND');
  return inv;
};
const oneView = async (req, inv) => (await invoiceViews(req, [inv.toObject ? inv.toObject() : inv]))[0];

pharmacyRouter.post('/invoices', async (req, res) => {
  desk(req);
  const body = parse(invoiceSchema, req.body);
  const inv = await createInvoice(req, body);
  const t = invoiceTotals(inv);
  await audit(req, body.kind === 'issue' ? 'PHARMACY_ISSUED' : 'PHARMACY_SOLD', {
    details: { invoiceId: String(inv._id), number: inv.number, ...(inv.patientId ? { patientId: String(inv.patientId) } : { walkIn: true }), ...(inv.buyer ? { business: true } : {}), lines: inv.lines.length, amountPaise: t.netPaise, controlled: inv.lines.some((l) => CONTROLLED.includes(l.schedule)) },
  });
  res.status(201).json({ invoice: await oneView(req, inv) });
});

pharmacyRouter.get('/invoices', async (req, res) => {
  const q = parse(z.object({ date: requiredDateOnly('Date').optional(), search: z.string().trim().max(100).optional(), patientId: objectId.optional() }).strict(), req.query);
  const filter = { tenantId: req.tenantId };
  if (q.patientId) filter.patientId = q.patientId;
  else if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    const pids = (await Patient.find({ tenantId: req.tenantId, $or: [{ fullName: rx }, { mrn: rx }, { phone: rx }] }, { _id: 1 }).limit(200).lean()).map((p) => p._id);
    filter.$or = [{ number: rx }, { 'customer.name': rx }, { 'buyer.name': rx }, { patientId: { $in: pids } }];
  } else {
    const day = q.date ?? today(req);
    filter['created.at'] = { $gte: hospitalDayStart(day), $lt: hospitalDayStart(addDays(day, 1)) };
  }
  const list = await PharmacyInvoice.find(filter).sort({ 'created.at': -1, _id: -1 }).limit(200).lean();
  res.json({ today: isoDay(today(req)), invoices: await invoiceViews(req, list) });
});

pharmacyRouter.get('/invoices/:id', async (req, res) => {
  const inv = await loadInvoice(req);
  await audit(req, 'PHARMACY_INVOICE_VIEWED', { details: { invoiceId: String(inv._id), number: inv.number } });
  const settings = await settingsOf(req.tenantId);
  const view = await oneView(req, inv);
  res.json({
    invoice: view,
    settings,
    stay: inv.admissionId ? await Admission.findOne({ tenantId: req.tenantId, _id: inv.admissionId }, { ward: 1, bed: 1 }).lean() : null,
    // A sale to a business with a GSTIN: may this person download its e-invoice file, and what is still missing for it
    ...(inv.buyer?.gstin
      ? {
          einvoice: {
            canDownload: hasRole(req.membership, ...PHARMACY_EINVOICE_ROLES),
            problems: einvoiceProblems({ seller: settings, buyer: inv.buyer, lines: await einvoiceLines(req, inv), number: inv.number }),
            sellerStateCode: gstinState(settings.gstin)?.code ?? null, // the page says so when the buyer is from another state
          },
        }
      : {}),
  });
});

// ---------- The e-invoice file of a sale to a business (hospital admin) ----------

// The invoice's lines (or one credit note's) as the e-invoice needs them: the HSN code kept on the invoice – or the
// medicine's present one when none was kept, or when it is the same code written out longer (einvoiceHsn) – and the
// medicine's unit of sale.
async function einvoiceLines(req, inv, ret = null) {
  const meds = new Map((await Medicine.find({ tenantId: req.tenantId, _id: { $in: inv.lines.map((l) => l.medicineId) } }, { hsn: 1, unit: 1 }).lean()).map((m) => [String(m._id), m]));
  const facts = (l) => ({ name: l.name, generic: l.generic ?? '', hsn: einvoiceHsn(l.hsn, meds.get(String(l.medicineId))?.hsn), unit: meds.get(String(l.medicineId))?.unit ?? '', batch: l.batch, expiry: l.expiry, gstRate: l.gstRate });
  if (!ret) return inv.lines.map((l) => ({ ...facts(l), qty: l.qty, amountPaise: l.amountPaise, taxablePaise: l.taxablePaise, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise }));
  return ret.lines.map((x) => ({ ...facts(inv.lines.id(x.lineId)), qty: x.qty, amountPaise: x.amountPaise, taxablePaise: x.taxablePaise, cgstPaise: x.cgstPaise, sgstPaise: x.sgstPaise }));
}

// The invoice (or, with ?creditNote=CN-000001, one of its credit notes) as a JSON file in the Government of India's
// e-invoice format (schema INV-01, version 1.1), to upload on the e-invoice portal by hand. Perinexa sends nothing to
// the portal. Only for a walk-in sale to a business that gave its GSTIN – sales to patients need no e-invoice.
pharmacyRouter.get('/invoices/:id/einvoice', async (req, res) => {
  if (!hasRole(req.membership, ...PHARMACY_EINVOICE_ROLES)) throw forbidden('The e-invoice file is for the hospital admin.');
  const q = parse(z.object({ creditNote: z.string().regex(/^CN-\d{6,10}$/, 'Not a credit note number.').optional() }).strict(), req.query);
  const inv = await loadInvoice(req);
  if (inv.patientId || !inv.buyer?.gstin) throw new HttpError(400, 'This sale was not to a business with a GSTIN: it needs no e-invoice.', 'NOT_BUSINESS');
  const ret = q.creditNote ? inv.returns.find((r) => r.number === q.creditNote) : null;
  if (q.creditNote && !ret) throw new HttpError(404, 'Credit note not found on this invoice.', 'NOT_FOUND');
  const seller = await settingsOf(req.tenantId);
  const lines = await einvoiceLines(req, inv, ret);
  const number = ret ? ret.number : inv.number;
  const problems = einvoiceProblems({ seller, buyer: inv.buyer, lines, number });
  if (problems.length) throw new HttpError(409, `The e-invoice file cannot be made yet. ${problems.join(' ')}`, 'INCOMPLETE');
  const invoiceDate = toHospitalDate(inv.created.at);
  const doc = ret ? { type: 'CRN', number, date: toHospitalDate(ret.at), against: { number: inv.number, date: invoiceDate } } : { type: 'INV', number, date: invoiceDate };
  await audit(req, 'PHARMACY_EINVOICE_DOWNLOADED', { details: { invoiceId: String(inv._id), number: inv.number, document: doc.type, ...(ret ? { creditNote: ret.number } : {}) } });
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="einvoice-${number}.json"`);
  // The portal's bulk upload takes a list of documents: this file holds the one
  res.send(`${JSON.stringify([einvoiceOf({ seller, buyer: inv.buyer, doc, lines })], null, 2)}\n`);
});

pharmacyRouter.post('/invoices/:id/returns', async (req, res) => {
  desk(req);
  const body = parse(
    z
      .object({
        items: z.array(z.object({ lineId: objectId, qty }).strict()).min(1),
        reason: reason('A return'),
        refund: z.object({ mode: z.enum(COUNTER_MODES), reference: z.string().trim().max(80).default('') }).strict().optional(),
      })
      .strict(),
    req.body,
  );
  const inv = await loadInvoice(req);
  const out = await returnItems(req, inv, body.items, body.reason, body.refund);
  await audit(req, 'PHARMACY_RETURNED', { details: { invoiceId: String(inv._id), number: inv.number, creditNote: out.number, amountPaise: out.credit.amountPaise, reason: body.reason } });
  res.json({ invoice: await oneView(req, out.invoice), creditNote: out.number });
});

pharmacyRouter.post('/invoices/:id/printed', async (req, res) => {
  const inv = await loadInvoice(req);
  const { what } = parse(z.object({ what: z.string().max(20).default('invoice') }).strict(), req.body);
  await audit(req, 'PHARMACY_PRINTED', { details: { invoiceId: String(inv._id), number: inv.number, what } });
  res.json({ ok: true });
});

// ---------- Reports and alerts ----------

const periodSchema = z.object({ from: requiredDateOnly('From'), to: requiredDateOnly('To') }).strict();
const period = (q) => {
  if (q.to < q.from || daysBetween(q.from, q.to) > 366) throw new HttpError(400, 'Choose a period of at most one year, ending after it starts.', 'VALIDATION');
  return [hospitalDayStart(q.from), hospitalDayStart(addDays(q.to, 1))];
};

// Alerts: medicines at or below their reorder level; batches expiring within 90 days, and expired ones.
pharmacyRouter.get('/reports/alerts', async (req, res) => {
  reports(req);
  const t = today(req);
  const meds = await Medicine.find({ tenantId: req.tenantId, active: true }).sort({ name: 1 }).lean();
  const batches = await StockBatch.find({ tenantId: req.tenantId, qtyLeft: { $gt: 0 } }).sort({ expiry: 1 }).lean();
  const usable = new Map();
  for (const b of batches) if (!isExpired(b, t)) usable.set(String(b.medicineId), (usable.get(String(b.medicineId)) ?? 0) + b.qtyLeft);
  const names = new Map(meds.map((m) => [String(m._id), m]));
  const soon = batches.filter((b) => daysLeft(b.expiry, t) <= EXPIRY_REPORT_DAYS && names.has(String(b.medicineId)));
  res.json({
    low: meds.filter((m) => (usable.get(String(m._id)) ?? 0) <= (m.reorderLevel ?? 0)).map((m) => ({ ...medicineView(m), qty: usable.get(String(m._id)) ?? 0 })),
    expiring: soon.map((b) => ({ ...batchView(b, t), medicine: { id: String(b.medicineId), name: names.get(String(b.medicineId)).name } })),
    days: EXPIRY_REPORT_DAYS,
  });
});

// A register: H1 (every sale, issue and return of H1 medicines – from a patient or to a supplier), or X / narcotic
// (every move of each such medicine, with the running balance – one page per medicine).
pharmacyRouter.get('/reports/register', async (req, res) => {
  reports(req);
  const q = parse(z.object({ type: z.enum(['H1', 'X', 'narcotic']), from: requiredDateOnly('From'), to: requiredDateOnly('To') }).strict(), req.query);
  const [from, to] = period(q);
  const meds = await Medicine.find({ tenantId: req.tenantId, schedule: q.type }).sort({ name: 1 }).lean();
  const moveFilter = { tenantId: req.tenantId, medicineId: { $in: meds.map((m) => m._id) }, at: { $gte: from, $lt: to }, ...(q.type === 'H1' ? { kind: { $in: ['sale', 'issue', 'return', 'supplier_return', 'supplier_return_cancelled'] } } : {}) };
  const moves = await StockMove.find(moveFilter).sort({ at: 1, _id: 1 }).lean();
  const pids = [...new Set(moves.map((m) => m.patientId && String(m.patientId)).filter(Boolean))];
  const patients = new Map((pids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: pids } }, { fullName: 1, mrn: 1 }).lean() : []).map((p) => [String(p._id), p]));
  const batches = new Map((await StockBatch.find({ tenantId: req.tenantId, _id: { $in: moves.map((m) => m.batchId) } }, { batch: 1 }).lean()).map((b) => [String(b._id), b.batch]));
  const row = (x) => {
    const p = x.patientId ? patients.get(String(x.patientId)) : null;
    return {
      at: x.at,
      date: isoDay(toHospitalDate(x.at)),
      time: timeIn(x.at),
      kind: x.kind,
      ref: x.ref?.number ?? '',
      batch: batches.get(String(x.batchId)) ?? '',
      in: x.qty > 0 ? x.qty : 0,
      out: x.qty < 0 ? -x.qty : 0,
      balance: x.balanceAfter,
      patient: p ? `${p.fullName} (${p.mrn})` : x.customer || '',
      doctor: [x.doctorName, x.doctorReg ? `Reg. ${x.doctorReg}` : ''].filter(Boolean).join(', '),
      supplier: x.supplierName ?? '',
      reason: x.reason ?? '',
      witness: x.witness ?? '',
      byName: x.byName ?? '',
    };
  };
  const pages = [];
  for (const m of meds) {
    const mine = moves.filter((x) => String(x.medicineId) === String(m._id));
    if (q.type === 'H1' && !mine.length) continue;
    const before = await StockMove.findOne({ tenantId: req.tenantId, medicineId: m._id, at: { $lt: from } }).sort({ at: -1, _id: -1 }).lean();
    pages.push({ medicine: medicineView(m), opening: before?.balanceAfter ?? 0, rows: mine.map(row), closing: mine.at(-1)?.balanceAfter ?? before?.balanceAfter ?? 0 });
  }
  await audit(req, 'PHARMACY_REGISTER_VIEWED', { details: { type: q.type, from: isoDay(q.from), to: isoDay(q.to) } });
  res.json({ type: q.type, label: SCHEDULE_LABELS[q.type], from: isoDay(q.from), to: isoDay(q.to), pages, settings: await settingsOf(req.tenantId) });
});

// Sales and GST for a period: by day (counter and issues), and GST by rate (after returns).
pharmacyRouter.get('/reports/sales', async (req, res) => {
  reports(req);
  const q = parse(periodSchema, req.query);
  const [from, to] = period(q);
  const list = await PharmacyInvoice.find({ tenantId: req.tenantId, $or: [{ 'created.at': { $gte: from, $lt: to } }, { 'returns.at': { $gte: from, $lt: to } }] }).lean();
  const inRange = (t) => t && t >= from && t < to;
  const days = new Map();
  const dayRow = (d) => days.get(d) ?? days.set(d, { date: d, salePaise: 0, issuePaise: 0, returnedPaise: 0, invoices: 0 }).get(d);
  const gstLines = [];
  for (const inv of list) {
    if (inRange(inv.created?.at)) {
      const d = dayRow(isoDay(toHospitalDate(inv.created.at)));
      d[inv.kind === 'issue' ? 'issuePaise' : 'salePaise'] += sum(inv.lines).amountPaise;
      d.invoices += 1;
      gstLines.push(...inv.lines);
    }
    for (const r of inv.returns ?? []) {
      if (!inRange(r.at)) continue;
      dayRow(isoDay(toHospitalDate(r.at))).returnedPaise += sum(r.lines).amountPaise;
      for (const x of r.lines) {
        const line = inv.lines.find((l) => String(l._id) === String(x.lineId));
        gstLines.push({ gstRate: line?.gstRate ?? 0, amountPaise: -x.amountPaise, taxablePaise: -x.taxablePaise, cgstPaise: -x.cgstPaise, sgstPaise: -x.sgstPaise });
      }
    }
  }
  const byDay = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  res.json({ from: isoDay(q.from), to: isoDay(q.to), byDay, gst: byRate(gstLines), totals: sum(gstLines) });
});

// Purchases for a period, by supplier, net of what was returned to each supplier in the period. Purchases count by
// their invoice date, returns by the day the stock went back; both at purchase value (before GST). A cancelled
// purchase and a cancelled return do not count.
pharmacyRouter.get('/reports/purchases', async (req, res) => {
  reports(req);
  const q = parse(periodSchema, req.query);
  const [from, to] = period(q);
  const list = await Purchase.find({ tenantId: req.tenantId, status: 'active', invoiceDate: { $gte: q.from, $lte: q.to } }).lean();
  const returns = await SupplierReturn.find({ tenantId: req.tenantId, ...NOT_CANCELLED, 'created.at': { $gte: from, $lt: to } }).lean();
  const names = new Map((await Supplier.find({ tenantId: req.tenantId }, { name: 1 }).lean()).map((s) => [String(s._id), s.name]));
  const by = new Map();
  const row = (supplierId) => {
    const k = String(supplierId);
    if (!by.has(k)) by.set(k, { supplier: names.get(k) ?? '', invoices: 0, totalPaise: 0, returns: 0, returnedPaise: 0, netPaise: 0 });
    return by.get(k);
  };
  for (const p of list) {
    const r = row(p.supplierId);
    r.invoices += 1;
    r.totalPaise += p.totalPaise;
  }
  for (const x of returns) {
    const r = row(x.supplierId);
    r.returns += 1;
    r.returnedPaise += returnTotals(x).taxablePaise;
  }
  const bySupplier = [...by.values()].map((r) => ({ ...r, netPaise: r.totalPaise - r.returnedPaise })).sort((a, b) => b.netPaise - a.netPaise || a.supplier.localeCompare(b.supplier));
  const totalPaise = bySupplier.reduce((s, r) => s + r.totalPaise, 0);
  const returnedPaise = bySupplier.reduce((s, r) => s + r.returnedPaise, 0);
  res.json({ from: isoDay(q.from), to: isoDay(q.to), bySupplier, totalPaise, returnedPaise, netPaise: totalPaise - returnedPaise });
});

// ---------- Export for the accountant (admin) ----------

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
const rs = (p) => (p / 100).toFixed(2);

pharmacyRouter.get('/export', async (req, res) => {
  if (!hasRole(req.membership, ...PHARMACY_EXPORT_ROLES)) throw forbidden('The export is for the hospital admin.');
  const q = parse(z.object({ from: requiredDateOnly('From'), to: requiredDateOnly('To'), what: z.enum(['sales', 'purchases', 'supplier_returns']) }).strict(), req.query);
  const [from, to] = period(q);
  let rows;
  if (q.what === 'sales') {
    const list = await PharmacyInvoice.find({ tenantId: req.tenantId, 'created.at': { $gte: from, $lt: to } }).sort({ 'created.at': 1 }).lean();
    const views = await invoiceViews(req, list);
    rows = [['Invoice', 'Date', 'Kind', 'Patient number', 'Patient / customer', 'Doctor', 'Medicine', 'HSN', 'Batch', 'Expiry', 'Qty', 'Returned', 'MRP', 'Amount', 'Taxable', 'GST %', 'CGST', 'SGST', 'Buyer (business)', 'Buyer GSTIN']];
    for (const v of views) {
      for (const l of v.lines) {
        rows.push([v.number, isoDay(toHospitalDate(new Date(v.date))), v.kind === 'issue' ? 'Issue (inpatient)' : 'Sale', v.patient?.mrn ?? '', v.patient?.fullName ?? v.customer?.name ?? '', v.doctor?.name ?? '', l.name, l.hsn, l.batch, l.expiry, l.qty, l.returnedQty, rs(l.mrpPaise), rs(l.amountPaise), rs(l.taxablePaise), l.gstRate, rs(l.cgstPaise), rs(l.sgstPaise), v.buyer?.name ?? '', v.buyer?.gstin ?? '']);
      }
    }
  } else if (q.what === 'supplier_returns') {
    const list = await SupplierReturn.find({ tenantId: req.tenantId, 'created.at': { $gte: from, $lt: to } }).sort({ 'created.at': 1 }).lean();
    const names = new Map((await Supplier.find({ tenantId: req.tenantId, _id: { $in: list.map((r) => r.supplierId) } }, { name: 1, gstin: 1 }).lean()).map((x) => [String(x._id), x]));
    // Cancelled returns are listed too, marked so (like cancelled purchases): the accountant leaves them out
    rows = [['Debit note', 'Date', 'Supplier', 'Supplier GSTIN', 'Reason', 'Supplier invoice', 'Medicine', 'HSN', 'Batch', 'Expiry', 'Qty', 'Rate', 'Taxable', 'GST %', 'CGST', 'SGST', 'IGST', 'Amount', 'Status']];
    for (const r of list) {
      const sup = names.get(String(r.supplierId));
      for (const l of r.lines) {
        rows.push([r.number, isoDay(toHospitalDate(r.created.at)), sup?.name ?? '', sup?.gstin ?? '', SUPPLIER_RETURN_REASON_LABELS[r.reason] ?? r.reason, l.invoiceNo ?? '', l.name, l.hsn, l.batch, isoDay(l.expiry), l.qty, rs(l.ratePaise), rs(l.taxablePaise), l.gstRate, rs(l.cgstPaise), rs(l.sgstPaise), rs(l.igstPaise), rs(l.amountPaise), r.status === 'cancelled' ? 'Cancelled' : 'Returned']);
      }
    }
  } else {
    const list = await Purchase.find({ tenantId: req.tenantId, invoiceDate: { $gte: q.from, $lte: q.to } }).sort({ invoiceDate: 1 }).lean();
    const views = await purchaseViews(req, list);
    rows = [['Purchase', 'Supplier', 'Invoice', 'Invoice date', 'Status', 'Medicine', 'Batch', 'Expiry', 'Qty', 'Free', 'Rate', 'MRP', 'Value', 'Purchase order']];
    for (const v of views) for (const l of v.lines) rows.push([v.number, v.supplier, v.invoiceNo, v.invoiceDate, v.status, l.name, l.batch, l.expiry, l.qty, l.freeQty, rs(l.ratePaise), rs(l.mrpPaise), rs(l.ratePaise * l.qty), v.order?.number ?? '']);
  }
  await audit(req, 'PHARMACY_EXPORTED', { details: { what: q.what, from: isoDay(q.from), to: isoDay(q.to), rows: rows.length - 1 } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="perinexa-pharmacy-${q.what.replace('_', '-')}-${isoDay(q.from)}-to-${isoDay(q.to)}.csv"`);
  res.send(csv(rows));
});
