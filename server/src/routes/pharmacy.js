import { Router } from 'express';
import { pharmacyWitnessField, pharmacyWitnessName } from '../auth/witness.js';
import mongoose from 'mongoose';
import { z } from 'zod';
import { addDays, daysBetween, hospitalDayStart, isoDay, timeIn, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Arrival } from '../models/Arrival.js';
import { Membership, hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { Medicine, NoSubstitute, PharmacyInvoice, Purchase, PurchaseOrder, StockBatch, StockMove, Supplier, SupplierPayment, SupplierReturn, SUPPLIER_PAYMENT_MODES, PharmacyDayClose } from '../models/Pharmacy.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { einvoiceHsn, einvoiceOf, einvoiceProblems } from '../pharmacy/einvoice.js';
import { PAYMENT_MODES, TAX_TYPES, grnTotals, perUnit } from '../pharmacy/grn.js';
import { byRate, suggestedQty, sum, grossOf } from '../pharmacy/gst.js';
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
  MAX_PAISE,
  OLD_GST_RATES,
  MAX_QTY,
  MIN_REASON,
  PHARMACY_EINVOICE_ROLES,
  PHARMACY_EXPORT_ROLES,
  PHARMACY_DOCTOR_SALES_ROLES,
  PHARMACY_ROLES,
  SCHEDULES,
  SCHEDULE_LABELS,
  SUPPLIER_RETURN_REASON_LABELS,
  cleanBarcode,
} from '../pharmacy/pharmacyRules.js';
import { cancelPurchase, countStock, createInvoice, createPurchase, daysLeft, invoiceTotals, invoiceViews, isExpired, returnItems, stockOf, writeOff, usableMatch, HOLD_REASONS, padded } from '../pharmacy/pharmacyService.js';
import { isDuplicate } from '../patients/duplicateRules.js';
import { isClosed } from '../patients/deathRules.js';
import { NOT_CANCELLED, returnTotals } from '../pharmacy/supplierReturnsService.js';
import { checkOpening, nameKey, openingSchema, saveOpening } from '../pharmacy/openingStock.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, parse, requiredDateOnly } from '../utils/validate.js';
import { pharmacyOrdersRouter } from './pharmacyOrders.js';
import { pharmacyRegisterRouter } from './pharmacyRegister.js';
import { pharmacySupplierReturnsRouter } from './pharmacySupplierReturns.js';
import { capitalizeName } from '../utils/personName.js';
import { givenFromPrescriptions, givenWords } from '../pharmacy/rxGiven.js';
import { neverSubstitute, sameMedicine } from '../pharmacy/substitutes.js';
import { supplierAccount } from '../pharmacy/supplierAccount.js';
import { nextNumber } from '../models/Counter.js';
import { daysOutOfStock, expiryLoss, h1Use, nonMoving, prescriptionsFilled, profitByMedicine } from '../pharmacy/figures.js';
import { doctorOf, salesByDoctor } from '../pharmacy/salesByDoctor.js';
import { WardRequest, statusOfLines } from '../models/WardRequest.js';
import { wardRequestView } from './wardRequests.js';
import { CarePlan } from '../models/CarePlan.js';
import { StockLocation } from '../models/Pharmacy.js';
import { formularyHighAlerts, withFormularyAlert } from '../pharmacy/formularyAlerts.js';

// Pharmacy and medicine stock (docs/PHARMACY_PLAN.md, approved 3 Oct 2026), for the pharmacist (and the hospital admin
// for the reports and the medicine list):
//  - /api/pharmacy/settings, /medicines, /suppliers        the pharmacy's details, the stock list, the suppliers
//  - /api/pharmacy/purchases                                supplier invoices (stock in, batch by batch)
//  - /api/pharmacy/stock, /batches/:id/writeoff|count       stock, write-offs, counts
//  - /api/pharmacy/opening-stock/check, /opening-stock     the stock on the shelves at the start, from the old
//                                                           software's Excel file (pharmacy/openingStock.js)
//  - /api/pharmacy/patients/:id/prescriptions, /inpatients  what to sell or issue
//  - /api/pharmacy/invoices                                 counter sales and issues to admitted patients (GST tax
//                                                           invoices), returns (credit notes)
//  - /api/pharmacy/reports/…, /export                       alerts, registers (H1, X, narcotic), sales, GST, export
// Pharmacy extras (4 Oct 2026):
//  - /api/pharmacy/orders            purchase orders to suppliers (routes/pharmacyOrders.js)
//  - /api/pharmacy/supplier-returns  stock returned to a supplier, with debit notes (routes/pharmacySupplierReturns.js)
// The daily register (26 Oct 2026):
//  - /api/pharmacy/register          today's OPD, IPD and External patients, and finding someone else (routes/pharmacyRegister.js)
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
pharmacyRouter.use('/register', pharmacyRegisterRouter);

// ---------- The pharmacy's details ----------

const settingsSchema = z
  .object({
    name: z.string().trim().max(150),
    gstin: z.string().trim().max(20),
    licence20: z.string().trim().max(80),
    licence21: z.string().trim().max(80),
    rmi: z.string().trim().max(80),
    pharmacistName: z.string().trim().max(150).transform(capitalizeName),
    address: z.string().trim().max(300),
    phone: z.string().trim().max(80),
    state: z.string().trim().max(60),
    // City or town (the bill's jurisdiction line, the e-invoice file) and PIN code (the e-invoice file)
    place: z.string().trim().max(50),
    pin: z.string().trim().regex(/^([1-9]\d{5})?$/, 'A PIN code has 6 digits.'),
    // PH17: reorder by use
    reorderLookBackDays: z.number().int().min(7).max(180),
    reorderLeadDays: z.number().int().min(0).max(60),
    reorderCoverDays: z.number().int().min(1).max(120),
  })
  .partial()
  .strict();

// The store's own address and phone as typed (the printed ones fall back to the hospital letterhead's)
const ownContact = async (tenantId) => {
  const t = await Tenant.findById(tenantId, { 'pharmacy.address': 1, 'pharmacy.phone': 1 }).lean();
  return { address: t?.pharmacy?.address ?? '', phone: t?.pharmacy?.phone ?? '' };
};

pharmacyRouter.get('/settings', async (req, res) => {
  res.json({ settings: await settingsOf(req.tenantId), own: await ownContact(req.tenantId), canEdit: hasRole(req.membership, 'pharmacist', 'admin'), lists: { forms: FORMS, gstRates: GST_RATES, schedules: SCHEDULES.map((s) => ({ key: s, label: SCHEDULE_LABELS[s] })), modes: COUNTER_MODES } });
});

pharmacyRouter.put('/settings', async (req, res) => {
  editor(req);
  const body = parse(settingsSchema, req.body);
  await Tenant.updateOne({ _id: req.tenantId }, { $set: Object.fromEntries(Object.entries(body).map(([k, v]) => [`pharmacy.${k}`, v])) });
  await audit(req, 'PHARMACY_SETTINGS_CHANGED', { details: { fields: Object.keys(body) } });
  res.json({ settings: await settingsOf(req.tenantId), own: await ownContact(req.tenantId) });
});

// ---------- Medicines ----------

const medicineFields = {
  name: z.string().trim().min(2, 'Please enter the name.').max(120),
  generic: z.string().trim().max(160),
  form: z.enum(FORMS),
  strength: z.string().trim().max(60),
  unit: z.string().trim().min(1).max(30),
  hsn: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/, 'An HSN code has 4, 6 or 8 digits.'),
  gstRate: z.union(GST_RATES.map((r) => z.literal(r)), { error: `GST is ${GST_RATES.join(', ')} % since 22 September 2025 (medicines 5 %).` }),
  schedule: z.enum(SCHEDULES),
  reorderLevel: z.number().int().min(0).max(MAX_QTY),
  // PH4: the manufacturer (for a recall); PH2: the pack it is bought in, and whether a pack may be split
  manufacturer: z.string().trim().max(120),
  packSize: z.number().int().min(1, 'A pack holds at least 1.').max(1000),
  packName: z.string().trim().max(20),
  looseSale: z.boolean(),
  kind: z.enum(['medicine', 'consumable']), // PH14
  preferredSupplierId: objectId.nullable(), // PH17
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
    manufacturer: medicineFields.manufacturer.default(''),
    packSize: medicineFields.packSize.default(1),
    packName: medicineFields.packName.default(''),
    looseSale: medicineFields.looseSale.default(true),
    kind: medicineFields.kind.default('medicine'),
    preferredSupplierId: medicineFields.preferredSupplierId.default(null),
    barcodes: medicineFields.barcodes.optional(),
    active: medicineFields.active.optional(),
  })
  .strict();
// A change: ONLY what is sent changes. (Until 4 Oct 2026 the starting values above were also applied to a change, so
// "Stop using" – which sends only `active` – emptied the generic name, strength, HSN code, schedule and reorder
// level: a narcotic lost its schedule. A change never fills anything in now.)
const medicineChangeSchema = z.object(medicineFields).partial().strict();

/** PH14: a consumable has no schedule (it never enters a register). */
function consumableNoSchedule(m) {
  if (m.kind === 'consumable' && m.schedule) throw Object.assign(new HttpError(400, 'A consumable has no schedule. Keep it a medicine, or clear the schedule.', 'VALIDATION'), { fields: { schedule: 'A consumable has no schedule.' } });
}

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
  // A search (the pickers) gives the first 500; the whole list (Pharmacy → Medicines, paged there) all of them – an
  // imported opening stock can bring a thousand medicines.
  const meds = await Medicine.find(filter).sort({ name: 1 }).limit(q.search ? 500 : 20000).lean();
  const stock = await stockOf(req.tenantId, meds.map((m) => m._id));
  // A search (the counter's drop-down, 7 Nov 2026) also gives the MRP of the batch sold next: the earliest expiry in stock
  const next = new Map();
  if (q.search) {
    const t = today(req);
    for (const b of await StockBatch.find({ tenantId: req.tenantId, medicineId: { $in: meds.map((m) => m._id) }, ...usableMatch(t) }, { medicineId: 1, mrpPaise: 1, expiry: 1 }).sort({ expiry: 1 }).lean()) {
      if (!next.has(String(b.medicineId))) next.set(String(b.medicineId), b.mrpPaise);
    }
  }
  const alerts = await formularyHighAlerts(req.tenantId); // PH7: the formulary's high alert too
  res.json({ medicines: meds.map((m) => ({ ...withFormularyAlert(medicineView(m, stock.get(String(m._id)) ?? 0), m, alerts), ...(q.search ? { mrpPaise: next.get(String(m._id)) ?? null } : {}) })) });
});

pharmacyRouter.post('/medicines', async (req, res) => {
  editor(req);
  const body = parse(medicineSchema, req.body);
  consumableNoSchedule(body);
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
  consumableNoSchedule(m);
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
  creditDays: z.number().int().min(0).max(365), // PH11
  active: z.boolean(),
};
const supplierSchema = z
  .object({
    ...supplierFields,
    gstin: supplierFields.gstin.default(''),
    drugLicence: supplierFields.drugLicence.default(''),
    phone: supplierFields.phone.default(''),
    address: supplierFields.address.default(''),
    creditDays: supplierFields.creditDays.default(0),
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

// ---------- PH12: the ward's requests (docs/PHARMACY_BUILD_NOTE.md) ----------
// The pharmacist's list: open ones first, urgent first, then the oldest. Issuing is POST /invoices with wardRequestId.
const OPEN_REQUEST = ['requested', 'part_issued'];
pharmacyRouter.get('/ward-requests', async (req, res) => {
  const q = parse(z.object({ open: z.enum(['1', '0']).optional() }).strict(), req.query);
  const filter = { tenantId: req.tenantId, ...(q.open === '1' ? { status: { $in: OPEN_REQUEST } } : {}) };
  const list = await WardRequest.find(filter).sort({ createdAt: -1 }).limit(q.open === '1' ? 500 : 100).lean();
  const shut = (r) => (OPEN_REQUEST.includes(r.status) ? 0 : 1);
  list.sort((a, b) => shut(a) - shut(b) || (shut(a) === 0 ? Number(b.urgent) - Number(a.urgent) || a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  const patients = new Map((await Patient.find({ tenantId: req.tenantId, _id: { $in: list.map((r) => r.patientId) } }, { fullName: 1, mrn: 1 }).lean()).map((p) => [String(p._id), p]));
  const stays = new Map((await Admission.find({ tenantId: req.tenantId, _id: { $in: list.map((r) => r.admissionId) } }, { ward: 1, bed: 1, status: 1 }).lean()).map((a) => [String(a._id), a]));
  // Each line's medicine as the counter knows it (to fill the issue), with what is in stock
  const medIds = [...new Set(list.flatMap((r) => r.lines.map((l) => String(l.medicineId))))];
  const meds = await Medicine.find({ tenantId: req.tenantId, _id: { $in: medIds } }).lean();
  const stock = await stockOf(req.tenantId, meds.map((m) => m._id));
  const medView = new Map(meds.map((m) => [String(m._id), medicineView(m, stock.get(String(m._id)) ?? 0)]));
  res.json({
    requests: list.map((r) => {
      const p = patients.get(String(r.patientId));
      const a = stays.get(String(r.admissionId));
      const v = wardRequestView(r);
      return { ...v, lines: v.lines.map((l) => ({ ...l, medicine: medView.get(l.medicineId) ?? null })), patient: p ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn } : null, stay: a ? { ward: a.ward ?? '', bed: a.bed ?? '', admitted: a.status === 'admitted' } : null };
    }),
  });
});
// A line the pharmacy will not give (out of stock, not kept, a question for the doctor): with the reason, shown on the ward
pharmacyRouter.post('/ward-requests/:id/refuse', async (req, res) => {
  desk(req);
  const body = parse(z.object({ medicineId: objectId, reason: z.string().trim().min(3, 'Write why.').max(200) }).strict(), req.body);
  const r = await WardRequest.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!r) throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
  if (!OPEN_REQUEST.includes(r.status)) throw new HttpError(409, 'This request is already closed.', 'CONFLICT');
  const line = r.lines.find((l) => String(l.medicineId) === String(body.medicineId));
  if (!line || line.refused || line.issuedQty >= line.qty) throw new HttpError(409, 'This line is not open.', 'CONFLICT');
  line.refused = { by: req.user._id, byName: req.user.name, at: req.now, reason: body.reason };
  r.status = statusOfLines(r.lines);
  await r.save();
  await audit(req, 'WARD_REQUEST_REFUSED', { details: { patientId: String(r.patientId), requestId: String(r._id), number: r.number, medicineId: String(body.medicineId) } });
  res.json({ request: wardRequestView(r.toObject()) });
});

// ---------- PH16: the supplier's bill from a file (docs/PHARMACY_BUILD_NOTE.md) ----------
// The file is read in the browser and only fills the purchase form; saving goes through POST /purchases with all its
// checks. Here: the supplier's saved column headings, matching its item names to our medicines (remembered matches
// first, then the same name), and remembering what the pharmacist picked.
const BILL_FILE_FIELDS = ['name', 'batch', 'expiry', 'qty', 'freeQty', 'rate', 'mrp', 'disc', 'gstRate', 'packSize', 'hsn'];
const billFileSupplier = async (req) => {
  const s = await Supplier.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!s) throw new HttpError(404, 'Supplier not found.', 'NOT_FOUND');
  return s;
};
pharmacyRouter.get('/suppliers/:id/bill-file', async (req, res) => {
  desk(req);
  const s = await billFileSupplier(req);
  res.json({ columns: Object.fromEntries(s.billFile?.columns ?? []), fields: BILL_FILE_FIELDS });
});
pharmacyRouter.post('/suppliers/:id/bill-file/match', async (req, res) => {
  desk(req);
  const s = await billFileSupplier(req);
  const { names } = parse(z.object({ names: z.array(z.string().trim().min(1).max(200)).max(500) }).strict(), req.body);
  const remembered = new Map((s.billFile?.items ?? []).map((x) => [x.key, String(x.medicineId)]));
  const meds = await Medicine.find({ tenantId: req.tenantId, active: true }).lean();
  const byId = new Map(meds.map((m) => [String(m._id), m]));
  const byName = new Map(meds.map((m) => [nameKey(m.name), m]));
  const matches = names.map((name) => {
    const k = nameKey(name);
    const kept = remembered.has(k) ? byId.get(remembered.get(k)) : null; // a stopped medicine is not matched
    const m = kept ?? byName.get(k) ?? null;
    return { name, medicine: m ? medicineView(m) : null, how: kept ? 'remembered' : m ? 'same_name' : null };
  });
  res.json({ matches });
});
pharmacyRouter.put('/suppliers/:id/bill-file', async (req, res) => {
  desk(req);
  const s = await billFileSupplier(req);
  const body = parse(
    z
      .object({
        columns: z.partialRecord(z.enum(BILL_FILE_FIELDS), z.string().trim().max(80)).optional(),
        items: z.array(z.object({ name: z.string().trim().min(1).max(200), medicineId: objectId }).strict()).max(500).default([]),
      })
      .strict(),
    req.body,
  );
  const ids = [...new Set(body.items.map((x) => x.medicineId))];
  const found = await Medicine.countDocuments({ tenantId: req.tenantId, _id: { $in: ids } });
  if (found !== ids.length) throw new HttpError(400, 'A medicine was not found.', 'VALIDATION');
  const items = new Map((s.billFile?.items ?? []).map((x) => [x.key, x]));
  for (const x of body.items) items.set(nameKey(x.name), { key: nameKey(x.name), name: x.name, medicineId: x.medicineId });
  const columns = body.columns ? Object.fromEntries(Object.entries(body.columns).filter(([, v]) => v)) : Object.fromEntries(s.billFile?.columns ?? []);
  s.billFile = { columns, items: [...items.values()].slice(-5000) };
  await s.save();
  await audit(req, 'PHARMACY_SUPPLIER_CHANGED', { details: { supplierId: String(s._id), fields: ['billFile'], items: body.items.length } });
  res.json({ columns, remembered: s.billFile.items.length });
});

// ---------- PH11: what each supplier is owed (docs/PHARMACY_BUILD_NOTE.md) ----------
// The pharmacist enters payments; the pharmacist and the hospital admin see the account. Amounts and ids in the audit
// log. Payments are not sent to Tally yet (that comes with purchases to Tally – the accountant keeps entering them
// there until then).

async function accountOf(req, supplier) {
  const [purchases, returns, payments] = await Promise.all([
    Purchase.find({ tenantId: req.tenantId, supplierId: supplier._id }, { number: 1, invoiceNo: 1, invoiceDate: 1, totalPaise: 1, grn: 1, status: 1 }).lean(),
    SupplierReturn.find({ tenantId: req.tenantId, supplierId: supplier._id }, { number: 1, lines: 1, status: 1, created: 1, createdAt: 1 }).lean(),
    SupplierPayment.find({ tenantId: req.tenantId, supplierId: supplier._id }).sort({ on: -1, _id: -1 }).lean(),
  ]);
  return supplierAccount({ supplier, purchases, returns, payments, today: today(req) });
}

pharmacyRouter.get('/suppliers/:id/account', async (req, res) => {
  reports(req);
  const s = await Supplier.findOne({ tenantId: req.tenantId, _id: idParam(req) }).lean();
  if (!s) throw new HttpError(404, 'Supplier not found.', 'NOT_FOUND');
  res.json({ supplier: supplierView(s), ...(await accountOf(req, s)), canPay: hasRole(req.membership, 'pharmacist'), modes: SUPPLIER_PAYMENT_MODES });
});

pharmacyRouter.post('/suppliers/:id/payments', async (req, res) => {
  desk(req);
  const body = parse(
    z.object({ on: requiredDateOnly('Date'), amountPaise: z.number().int().min(1, 'Write the amount paid.').max(MAX_PAISE), mode: z.enum(SUPPLIER_PAYMENT_MODES, 'Choose how it was paid.'), reference: z.string().trim().max(80).default(''), purchaseIds: z.array(objectId).max(50).default([]), note: z.string().trim().max(200).default('') }).strict(),
    req.body,
  );
  const s = await Supplier.findOne({ tenantId: req.tenantId, _id: idParam(req) }).lean();
  if (!s) throw new HttpError(404, 'Supplier not found.', 'NOT_FOUND');
  if (body.mode !== 'cash' && body.reference.length < 2) throw Object.assign(new HttpError(400, 'Write the cheque or transaction number.', 'VALIDATION'), { fields: { reference: 'Write the cheque or transaction number.' } });
  if (body.on > utcDay(today(req))) throw Object.assign(new HttpError(400, 'The date is in the future.', 'VALIDATION'), { fields: { on: 'The date is in the future.' } });
  if (body.purchaseIds.length && (await Purchase.countDocuments({ tenantId: req.tenantId, supplierId: s._id, _id: { $in: body.purchaseIds }, status: { $ne: 'cancelled' } })) !== new Set(body.purchaseIds.map(String)).size) {
    throw new HttpError(400, 'A bill chosen is not this supplier’s.', 'VALIDATION');
  }
  const number = padded('SP', await nextNumber(req.tenantId, 'pharmacy-supplier-payment'));
  const p = await SupplierPayment.create({ tenantId: req.tenantId, number, supplierId: s._id, ...body, created: { by: req.user._id, byName: req.user.name, at: req.now } });
  await audit(req, 'PHARMACY_SUPPLIER_PAID', { details: { paymentId: String(p._id), number, supplierId: String(s._id), amountPaise: body.amountPaise, mode: body.mode, bills: body.purchaseIds.length } });
  res.status(201).json({ payment: { id: String(p._id), number }, ...(await accountOf(req, s)) });
});

pharmacyRouter.post('/supplier-payments/:id/cancel', async (req, res) => {
  desk(req);
  const { reason: why } = parse(z.object({ reason: reason('Cancelling a payment') }).strict(), req.body);
  const p = await SupplierPayment.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!p) throw new HttpError(404, 'Payment not found.', 'NOT_FOUND');
  if (p.cancelled) throw new HttpError(409, 'This payment was already cancelled.', 'CONFLICT');
  p.cancelled = { by: req.user._id, byName: req.user.name, at: req.now, reason: why };
  await p.save();
  await audit(req, 'PHARMACY_SUPPLIER_PAYMENT_CANCELLED', { details: { paymentId: String(p._id), number: p.number, supplierId: String(p.supplierId), amountPaise: p.amountPaise } });
  const s = await Supplier.findOne({ tenantId: req.tenantId, _id: p.supplierId }).lean();
  res.json(await accountOf(req, s));
});

// Owed and overdue, every supplier (Reports → Purchases)
pharmacyRouter.get('/reports/supplier-dues', async (req, res) => {
  reports(req);
  const suppliers = await Supplier.find({ tenantId: req.tenantId }).sort({ name: 1 }).lean();
  const rows = [];
  for (const s of suppliers) {
    const a = await accountOf(req, s);
    if (!a.bills.length && !a.payments.length) continue;
    rows.push({ id: String(s._id), name: s.name, creditDays: s.creditDays ?? 0, ...a.totals, taxMissing: a.taxMissing });
  }
  rows.sort((x, y) => y.overduePaise - x.overduePaise || y.owedPaise - x.owedPaise);
  res.json({ suppliers: rows, owedPaise: rows.reduce((t, r) => t + r.owedPaise, 0), overduePaise: rows.reduce((t, r) => t + r.overduePaise, 0) });
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
            // The bill (GRN, 26 Oct 2026): quantities, rate and MRP above are per pack of `conv` units of sale
            conv: z.number().int().min(1, 'Pack size: at least 1.').max(1000).default(1),
            discPercent: z.number().min(0).max(100).default(0),
            gstRate: z.number().refine((r) => [...GST_RATES, ...OLD_GST_RATES].includes(r), 'Choose the GST rate on the bill.').optional(),
          })
          .strict(),
      )
      .min(1, 'Add at least one medicine.')
      .max(100),
    // The bill's own details, discounts and charges (GRN, 26 Oct 2026)
    grn: z
      .object({
        gateEntryNo: z.string().trim().max(40).default(''),
        taxType: z.enum(TAX_TYPES).default('cgst_sgst'),
        payment: z.enum(PAYMENT_MODES).default('credit'),
        receivedBy: z.string().trim().max(100).default(''),
        remark: z.string().trim().max(300).default(''),
        schemeDiscPaise: paise.default(0),
        discPercent: z.number().min(0).max(100).default(0),
        crnAdjPaise: paise.default(0),
        otherChargesPaise: paise.default(0),
        surchargePaise: paise.default(0),
        freightPaise: paise.default(0),
        // PH3: the bill's total as printed, typed to check the sums; a difference above ₹1 is asked about first
        printedTotalPaise: paise.nullable().default(null),
        totalConfirmed: z.boolean().default(false),
      })
      .strict()
      .optional(),
  })
  .strict();

// PH3: the largest difference between the bill as printed and the sums worked out here that is let through unasked
export const BILL_TOTAL_SLACK_PAISE = 100;
const rupees = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The bill as entered → what the stock keeps: lines per unit of sale (with the line as on the bill in `pack`), and
 * the bill's sums. A line without its GST rate takes the medicine's. A bill whose discounts are more than its value
 * is refused.
 */
async function asStock(req, body) {
  const rates = new Map((await Medicine.find({ tenantId: req.tenantId, _id: { $in: body.lines.map((l) => l.medicineId) } }, { gstRate: 1 }).lean()).map((m) => [String(m._id), m.gstRate]));
  body.lines.forEach((l) => {
    l.gstRate ??= rates.get(String(l.medicineId)) ?? 0;
  });
  const lines = body.lines;
  const sums = grnTotals(lines, body.grn ?? {});
  if (sums.netPaise < 0) throw new HttpError(400, 'The discounts are more than the bill: check the scheme discount, the discount and the credit note.', 'VALIDATION_ERROR');
  // PH3: the supplier's printed total against the sums – more than ₹1 apart is asked about before the stock comes in
  const printed = body.grn?.printedTotalPaise;
  if (printed != null && Math.abs(printed - sums.netPaise) > BILL_TOTAL_SLACK_PAISE && !body.grn.totalConfirmed) {
    throw Object.assign(new HttpError(409, `The bill says ${rupees(printed)} but the lines add up to ${rupees(sums.netPaise)}: check the rates, discounts and GST, or confirm the bill as it is.`, 'BILL_TOTAL_DIFFERS'), {
      details: { printedTotalPaise: printed, netPaise: sums.netPaise },
    });
  }
  return {
    ...body,
    lines: body.lines.map((l, i) => {
      const { conv, discPercent, ...rest } = l;
      return { ...rest, ...perUnit(l), pack: { conv, qty: l.qty, freeQty: l.freeQty, ratePaise: l.ratePaise, mrpPaise: l.mrpPaise, discPercent, ...sums.lines[i] } };
    }),
    grn: body.grn ? (({ totalConfirmed, ...g }) => ({ ...g, ...Object.fromEntries(Object.entries(sums).filter(([k]) => k !== 'lines')) }))(body.grn) : null,
  };
}

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
    at: p.created?.at ?? null,
    // The bill's details and sums (GRN), and each line as on the bill (pack) – null on older purchases
    grn: p.grn ?? null,
    lines: p.lines.map((l) => ({ name: l.name, batch: l.batch, expiry: isoDay(l.expiry), qty: l.qty, freeQty: l.freeQty, ratePaise: l.ratePaise, mrpPaise: l.mrpPaise, hsn: l.hsn ?? '', gstRate: l.gstRate ?? null, manufacturer: l.manufacturer ?? '', pack: l.pack ?? null })),
  }));
}

pharmacyRouter.get('/purchases', async (req, res) => {
  // supplierId: one supplier's bills (its page under Suppliers)
  const q = parse(z.object({ supplierId: objectId.optional() }).strict(), req.query);
  const list = await Purchase.find({ tenantId: req.tenantId, ...(q.supplierId ? { supplierId: q.supplierId } : {}) }).sort({ invoiceDate: -1, createdAt: -1 }).limit(200).lean();
  res.json({ purchases: await purchaseViews(req, list) });
});
pharmacyRouter.post('/purchases', async (req, res) => {
  desk(req);
  const body = await asStock(req, parse(purchaseSchema, req.body));
  // The same supplier's invoice is entered once (26 Oct 2026): entering it again would add its stock twice
  const twice = await Purchase.findOne({ tenantId: req.tenantId, supplierId: body.supplierId, status: { $ne: 'cancelled' }, invoiceNo: new RegExp(`^${escapeRegex(body.invoiceNo)}$`, 'i') }, { number: 1 }).lean();
  if (twice) throw new HttpError(409, `This supplier's invoice ${body.invoiceNo} is already entered (${twice.number}). Cancel that purchase first if it was wrong.`, 'DUPLICATE');
  // Received against a purchase order: the order is checked before any stock comes in
  const order = body.orderId ? await orderToReceive(req, body.orderId, body) : null;
  const p = await createPurchase(req, body);
  // The stock is in: that is in the audit log first, with the order it was entered against
  await audit(req, 'PHARMACY_PURCHASE_ENTERED', { details: { purchaseId: String(p._id), number: p.number, lines: p.lines.length, totalPaise: p.totalPaise, ...(p.grn ? { netPaise: p.grn.netPaise } : {}), ...(order ? { orderId: String(order._id), order: order.number } : {}) } });
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
  const alerts = await formularyHighAlerts(req.tenantId); // PH7: the formulary's high alert too
  const byMed = new Map();
  for (const b of batches) {
    const k = String(b.medicineId);
    if (!byMed.has(k)) byMed.set(k, []);
    byMed.get(k).push(b);
  }
  const rows = meds.map((m) => {
    const bs = byMed.get(String(m._id)) ?? [];
    const usable = bs.filter((b) => !isExpired(b, t) && !b.hold); // PH5: held stock is shown apart
    const qtyUsable = usable.reduce((s, b) => s + b.qtyLeft, 0);
    const nearest = usable.map((b) => b.expiry).sort((a, b) => a - b)[0] ?? null;
    return {
      ...withFormularyAlert(medicineView(m), m, alerts),
      qty: qtyUsable,
      heldQty: bs.filter((b) => b.hold && !isExpired(b, t)).reduce((s, b) => s + b.qtyLeft, 0),
      expiredQty: bs.filter((b) => isExpired(b, t)).reduce((s, b) => s + b.qtyLeft, 0),
      costValuePaise: bs.reduce((s, b) => s + b.qtyLeft * b.costPaise, 0),
      mrpValuePaise: bs.reduce((s, b) => s + grossOf(b, b.qtyLeft), 0), // PH2: from the pack's MRP where known
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

// The stock sheet (Current Stock): one line per batch with stock, by medicine name then expiry, to print or save as a
// PDF and count the shelves against (the Phy Qty column is left blank to write in). Expired batches still on the shelf
// are listed too, marked. Values: quantity × MRP and quantity × purchase price (before GST).
pharmacyRouter.get('/stock-sheet', async (req, res) => {
  const t = today(req);
  const meds = new Map((await Medicine.find({ tenantId: req.tenantId }, { name: 1 }).lean()).map((m) => [String(m._id), m]));
  const batches = await StockBatch.find({ tenantId: req.tenantId, qtyLeft: { $gt: 0 } }).lean();
  const lines = batches
    .filter((b) => meds.has(String(b.medicineId)))
    .map((b) => ({
      name: meds.get(String(b.medicineId)).name,
      batch: b.batch,
      expiry: isoDay(b.expiry),
      expired: isExpired(b, t),
      qty: b.qtyLeft,
      mrpValuePaise: grossOf(b, b.qtyLeft),
      costValuePaise: b.qtyLeft * b.costPaise,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.expiry.localeCompare(b.expiry) || a.batch.localeCompare(b.batch));
  res.json({
    settings: await settingsOf(req.tenantId),
    lines,
    totals: { mrpValuePaise: lines.reduce((s, l) => s + l.mrpValuePaise, 0), costValuePaise: lines.reduce((s, l) => s + l.costValuePaise, 0) },
  });
});

// Opening stock from the old pharmacy software's file (pharmacist or hospital admin). Check reads only: every line
// with what it becomes and its problems. Import saves it all, or nothing while any line has a problem.
pharmacyRouter.post('/opening-stock/check', async (req, res) => {
  editor(req);
  const { lines } = parse(openingSchema, req.body);
  res.json(await checkOpening(req, lines, today(req)));
});

pharmacyRouter.post('/opening-stock', async (req, res) => {
  editor(req);
  const { lines, witness } = parse(openingSchema, req.body);
  const done = await saveOpening(req, lines, today(req), witness || '');
  await audit(req, 'PHARMACY_OPENING_STOCK_IMPORTED', { details: { batches: done.batches, medicinesAdded: done.medicinesAdded, units: done.units, mrpValuePaise: done.mrpValuePaise, costValuePaise: done.costValuePaise, ...(done.witness ? { controlled: done.controlled, witness: done.witness } : {}) } });
  res.status(201).json({ imported: done });
});

// One medicine: its batches and its recent stock moves.
pharmacyRouter.get('/stock/:id', async (req, res) => {
  const t = today(req);
  const m = await Medicine.findOne({ tenantId: req.tenantId, _id: idParam(req) }).lean();
  if (!m) throw new HttpError(404, 'Medicine not found.', 'NOT_FOUND');
  const batches = await StockBatch.find({ tenantId: req.tenantId, medicineId: m._id }).sort({ expiry: 1 }).lean();
  const moves = await StockMove.find({ tenantId: req.tenantId, medicineId: m._id }).sort({ at: -1, _id: -1 }).limit(100).lean();
  const batchName = new Map(batches.map((b) => [String(b._id), b.batch]));
  const placeNames = new Map((await StockLocation.find({ tenantId: req.tenantId, _id: { $in: batches.map((b) => b.locationId).filter(Boolean) } }, { name: 1 }).lean()).map((x) => [String(x._id), x.name]));
  res.json({
    medicine: withFormularyAlert(medicineView(m, batches.filter((b) => !isExpired(b, t)).reduce((s, b) => s + b.qtyLeft, 0)), m, await formularyHighAlerts(req.tenantId)),
    batches: batches.filter((b) => b.qtyLeft > 0 || daysBetween(b.updatedAt ?? b.createdAt, req.now ?? new Date()) < 90).map((b) => ({ ...batchView(b, t), place: b.locationId ? (placeNames.get(String(b.locationId)) ?? 'A place') : '' })), // PH13: '' = the pharmacy
    moves: moves.map((x) => ({ at: x.at, kind: x.kind, qty: x.qty, balanceAfter: x.balanceAfter, batch: batchName.get(String(x.batchId)) ?? '', ref: x.ref?.number ?? '', reason: x.reason ?? '', witness: x.witness ?? '', byName: x.byName ?? '' })),
  });
});

// ---------- PH5: a batch on hold, and who received it (docs/PHARMACY_BUILD_NOTE.md) ----------
// A recall names a manufacturer's batch number; the same number can be in several stock batches (two purchases), so
// the hold works on { medicine, batch number } – all of them at once. Held stock cannot be sold or issued (usableMatch);
// it can still be returned to the supplier, written off or counted. No notice goes to her doctor (owner, 10 Nov 2026).

const holdTarget = z.object({ medicineId: objectId, batch: z.string().trim().min(1).max(40) });
const sameBatch = (req, b) => ({ tenantId: req.tenantId, medicineId: b.medicineId, batch: new RegExp(`^${escapeRegex(b.batch)}$`, 'i') });

pharmacyRouter.post('/batches/hold', async (req, res) => {
  desk(req);
  const body = parse(holdTarget.extend({ reason: z.enum(Object.keys(HOLD_REASONS), 'Choose why it is held.'), note: z.string().trim().max(200).default('') }).strict(), req.body);
  if (body.reason === 'other' && body.note.length < 3) throw new HttpError(400, 'Write why the batch is held.', 'VALIDATION');
  const list = await StockBatch.find(sameBatch(req, body), { _id: 1, hold: 1 }).lean();
  if (!list.length) throw new HttpError(404, 'No batch with this number for this medicine.', 'NOT_FOUND');
  if (list.every((b) => b.hold)) throw new HttpError(409, 'This batch is already on hold.', 'ALREADY_HELD');
  await StockBatch.updateMany({ ...sameBatch(req, body), hold: null }, { $set: { hold: { reason: body.reason, note: body.note, by: req.user._id, byName: req.user.name, at: req.now } } });
  await audit(req, 'PHARMACY_BATCH_HELD', { details: { medicineId: body.medicineId, batch: body.batch, reason: body.reason, batches: list.length } });
  res.json({ held: list.length });
});

pharmacyRouter.post('/batches/release', async (req, res) => {
  desk(req);
  const body = parse(holdTarget.extend({ reason: reason('Releasing a batch') }).strict(), req.body);
  const list = await StockBatch.find({ ...sameBatch(req, body), hold: { $ne: null } }).lean();
  if (!list.length) throw new HttpError(409, 'This batch is not on hold.', 'NOT_HELD');
  for (const b of list) {
    await StockBatch.updateOne({ tenantId: req.tenantId, _id: b._id }, { $set: { hold: null }, $push: { released: { heldReason: b.hold.reason, reason: body.reason, by: req.user._id, byName: req.user.name, at: req.now } } });
  }
  await audit(req, 'PHARMACY_BATCH_RELEASED', { details: { medicineId: body.medicineId, batch: body.batch, batches: list.length } });
  res.json({ released: list.length });
});

// Who received this batch: every sale and issue from it, net of returns – date, invoice, the patient (what the
// pharmacist already sees: name, number, phone; a closed record says so) or the walk-in's name – and what is still in
// stock. Read from the stock moves: nothing new is stored.
pharmacyRouter.get('/batches/recipients', async (req, res) => {
  desk(req);
  const q = parse(holdTarget.strict(), req.query);
  const m = await Medicine.findOne({ tenantId: req.tenantId, _id: q.medicineId }, { name: 1, manufacturer: 1, unit: 1 }).lean();
  if (!m) throw new HttpError(404, 'Medicine not found.', 'NOT_FOUND');
  const batches = await StockBatch.find(sameBatch(req, q)).lean();
  const moves = batches.length ? await StockMove.find({ tenantId: req.tenantId, batchId: { $in: batches.map((b) => b._id) }, kind: { $in: ['sale', 'issue', 'return'] } }).sort({ at: 1, _id: 1 }).lean() : [];
  const byInvoice = new Map();
  for (const mv of moves) {
    const k = mv.ref?.number ?? String(mv._id);
    if (!byInvoice.has(k)) byInvoice.set(k, { number: mv.ref?.number ?? '', kind: mv.kind === 'issue' ? 'issue' : 'sale', at: mv.at, patientId: mv.patientId ? String(mv.patientId) : null, customer: mv.customer ?? '', qty: 0 });
    const r = byInvoice.get(k);
    if (mv.kind === 'issue') r.kind = 'issue';
    r.qty += -mv.qty; // a sale or issue is −, a return +
  }
  const rows = [...byInvoice.values()].filter((r) => r.qty > 0);
  const pids = [...new Set(rows.map((r) => r.patientId).filter(Boolean))];
  const patients = new Map((pids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: pids } }, { fullName: 1, mrn: 1, phone: 1, 'death.on': 1 }).lean() : []).map((p) => [String(p._id), p]));
  // PH8: vaccinations recorded on care plans with this batch number – a count only for the pharmacist (names stay with
  // the doctors, on each patient's care plan)
  const batchRx = new RegExp(`^${escapeRegex(q.batch)}$`, 'i');
  const vaccinated = await CarePlan.aggregate([
    { $match: { tenantId: req.tenantId, 'items.done.vaccine.batch': batchRx } },
    { $unwind: '$items' },
    { $match: { 'items.state': 'done', 'items.done.vaccine.batch': batchRx } },
    { $count: 'n' },
  ]);
  await audit(req, 'PHARMACY_BATCH_RECIPIENTS_VIEWED', { details: { medicineId: q.medicineId, batch: q.batch, results: rows.length } });
  res.json({
    vaccinationsRecorded: vaccinated[0]?.n ?? 0,
    medicine: { id: String(m._id), name: m.name, manufacturer: m.manufacturer ?? '', unit: m.unit },
    batch: q.batch,
    hold: batches.find((b) => b.hold)?.hold ? (({ reason: r, note, byName, at }) => ({ reason: r, note: note ?? '', byName: byName ?? '', at }))(batches.find((b) => b.hold).hold) : null,
    inStock: batches.reduce((s, b) => s + b.qtyLeft, 0),
    recipients: rows.map((r) => {
      const p = r.patientId ? patients.get(r.patientId) : null;
      return {
        date: isoDay(toHospitalDate(r.at)),
        number: r.number,
        kind: r.kind,
        qty: r.qty,
        patient: p ? (isClosed(p) ? { fullName: p.fullName, mrn: p.mrn, phone: '', closed: true } : { fullName: p.fullName, mrn: p.mrn, phone: p.phone ?? '', closed: false }) : null,
        customer: p ? '' : r.customer,
      };
    }),
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
  // PH7: a controlled medicine's write-off needs a witness who signs in, as its count does
  // PH15: what kind of loss it was (the value lost to expiry is counted from it)
  const body = parse(z.object({ qty, reason: reason('Writing off stock'), witness: pharmacyWitnessField, kind: z.enum(['expired', 'damaged', 'lost', 'other']).default('other') }).strict(), req.body);
  const { b, m } = await loadBatch(req);
  if (CONTROLLED.includes(m.schedule) && !body.witness) throw Object.assign(new HttpError(400, `${m.name} is a controlled medicine: a second person who checked the write-off signs in for it.`, 'VALIDATION'), { fields: { 'witness.email': 'A second person (pharmacist, doctor, RMO or nurse) types their email and password.' } });
  body.witness = await pharmacyWitnessName(req, body.witness || null, 'pharmacy_writeoff');
  const after = await writeOff(req, b, body.qty, body.reason, body.witness, body.kind);
  await audit(req, 'PHARMACY_STOCK_WRITTEN_OFF', { details: { medicineId: String(m._id), batchId: String(b._id), qty: body.qty, reason: body.reason, ...(body.witness ? { witness: body.witness } : {}) } });
  res.json({ batch: batchView(after, today(req)) });
});

pharmacyRouter.post('/batches/:id/count', async (req, res) => {
  desk(req);
  // A controlled medicine's count: the second person signs in (Group C, PX-X-06) – never a typed name
  const body = parse(z.object({ counted: z.number().int().min(0).max(MAX_QTY), reason: reason('Correcting the stock'), witness: pharmacyWitnessField }).strict(), req.body);
  body.witness = await pharmacyWitnessName(req, body.witness || null, 'pharmacy_count');
  const { b, m } = await loadBatch(req);
  const after = await countStock(req, b, body.counted, body.reason, body.witness, m);
  await audit(req, 'PHARMACY_STOCK_COUNTED', { details: { medicineId: String(m._id), batchId: String(b._id), from: b.qtyLeft, to: body.counted, reason: body.reason, ...(body.witness ? { witness: body.witness } : {}) } });
  res.json({ batch: batchView(after, today(req)) });
});

// PH10: other brands of the same medicine in stock (strict matcher: generic, strength, form) – alphabetical, then
// earliest expiry; none for a medicine without a generic name. blocked: the doctors do not allow another brand of it.
pharmacyRouter.get('/medicines/:id/substitutes', async (req, res) => {
  desk(req);
  const m = await Medicine.findOne({ tenantId: req.tenantId, _id: idParam(req) }).lean();
  if (!m) throw new HttpError(404, 'Medicine not found.', 'NOT_FOUND');
  const never = new Set((await NoSubstitute.find({ tenantId: req.tenantId, active: true }, { key: 1 }).lean()).map((x) => x.key));
  const blocked = neverSubstitute(never, { drug: m.name }, [m]);
  const all = blocked || !String(m.generic ?? '').trim() ? [] : await Medicine.find({ tenantId: req.tenantId, active: true, _id: { $ne: m._id }, generic: { $ne: '' } }).lean();
  const same = all.filter((x) => sameMedicine(m, x));
  const t = today(req);
  const batches = same.length ? await StockBatch.find({ tenantId: req.tenantId, medicineId: { $in: same.map((x) => x._id) }, ...usableMatch(t) }, { medicineId: 1, qtyLeft: 1, expiry: 1 }).lean() : [];
  const stock = new Map();
  for (const b of batches) {
    const k = String(b.medicineId);
    const s = stock.get(k) ?? { qty: 0, expiry: b.expiry };
    s.qty += b.qtyLeft;
    if (b.expiry < s.expiry) s.expiry = b.expiry;
    stock.set(k, s);
  }
  const list = same.filter((x) => stock.has(String(x._id))).sort((a, b) => a.name.localeCompare(b.name) || stock.get(String(a._id)).expiry - stock.get(String(b._id)).expiry);
  const alerts = await formularyHighAlerts(req.tenantId);
  res.json({ blocked, substitutes: list.map((x) => ({ ...withFormularyAlert(medicineView(x, stock.get(String(x._id)).qty), x, alerts), nearestExpiry: isoDay(stock.get(String(x._id)).expiry) })) });
});

// PH10: the hospital's doctors, for "which doctor agreed" to another brand
pharmacyRouter.get('/doctors', async (req, res) => {
  desk(req);
  const members = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: 'doctor' }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((x) => x.userId) } }, { name: 1 }).sort({ name: 1 }).lean();
  res.json({ doctors: users.map((u) => ({ id: String(u._id), name: u.name })) });
});

// PH17: the last price paid for a medicine (purchase entry and the order screen): per pack as on the bill, with its date
// and supplier. null when it was never bought.
pharmacyRouter.get('/medicines/:id/last-price', async (req, res) => {
  const p = await Purchase.findOne({ tenantId: req.tenantId, status: 'active', 'lines.medicineId': idParam(req) }, { invoiceDate: 1, supplierId: 1, lines: 1 }).sort({ invoiceDate: -1, createdAt: -1 }).lean();
  if (!p) return res.json({ last: null });
  const l = p.lines.find((x) => String(x.medicineId) === String(idParam(req)));
  const s = await Supplier.findOne({ tenantId: req.tenantId, _id: p.supplierId }, { name: 1 }).lean();
  res.json({ last: { ratePaise: l.pack?.ratePaise ?? l.ratePaise, conv: l.pack?.conv ?? 1, unitRatePaise: l.ratePaise, date: isoDay(p.invoiceDate), supplier: s?.name ?? '' } });
});

// The batches a medicine can be sold from (not expired, with stock), earliest expiry first.
pharmacyRouter.get('/medicines/:id/batches', async (req, res) => {
  const t = today(req);
  const list = await StockBatch.find({ tenantId: req.tenantId, medicineId: idParam(req), ...usableMatch(t) }).sort({ expiry: 1 }).lean();
  // As the store's earlier software showed them at the counter (7 Nov 2026): where each batch was bought – the supplier,
  // its bill number and date – and the pack it came in (units per pack and the pack's MRP). Opening stock has none.
  const purchases = new Map(
    (await Purchase.find({ tenantId: req.tenantId, _id: { $in: list.map((b) => b.purchaseId).filter(Boolean) } }, { invoiceNo: 1, invoiceDate: 1, lines: 1 }).lean()).map((p) => [String(p._id), p]),
  );
  const suppliers = new Map((await Supplier.find({ tenantId: req.tenantId, _id: { $in: list.map((b) => b.supplierId).filter(Boolean) } }, { name: 1 }).lean()).map((s) => [String(s._id), s.name]));
  const bought = (b) => {
    const p = b.purchaseId ? purchases.get(String(b.purchaseId)) : null;
    const line = p?.lines?.find((l) => String(l.batchId) === String(b._id));
    return { supplier: b.supplierId ? (suppliers.get(String(b.supplierId)) ?? '') : '', billNo: p?.invoiceNo ?? '', billDate: p?.invoiceDate ? isoDay(p.invoiceDate) : null, conv: line?.pack?.conv ?? 1, packMrpPaise: line?.pack?.mrpPaise ?? b.mrpPaise };
  };
  res.json({ batches: list.map((b) => ({ ...batchView(b, t), ...bought(b) })), warnDays: EXPIRY_WARNING_DAYS });
});

// ---------- What to sell or issue ----------

/**
 * PH7: her allergy line for the pharmacist – { status: 'recorded' | 'none' | 'not_asked', text } (the website's
 * patientFormat.js allergyStatus). A baby's record has no allergy field: 'not_asked'.
 */
export function allergyFor(patient) {
  const text = String(patient?.medical?.allergies ?? '').trim();
  if (!text) return { status: 'not_asked', text: '' };
  if (/^(none|nil|no)( known)?( (drug )?allerg(y|ies))?\.?$|^nkda$|^nka$/i.test(text)) return { status: 'none', text };
  return { status: 'recorded', text };
}

// A patient's recent prescriptions – the medicines only, matched to the stock list by name (pharmacist).
pharmacyRouter.get('/patients/:id/prescriptions', async (req, res) => {
  desk(req);
  // PH7 (owner's decision 2, 10 Nov 2026): the pharmacist sees her allergies – medical.allergies and nothing else of
  // her record (patientAccess is not widened; this narrow projection is the one path)
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: idParam(req) }, { fullName: 1, mrn: 1, phone: 1, duplicateOf: 1, 'death.on': 1, careType: 1, 'medical.allergies': 1 }).lean();
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
  // PH6: what was already sold from these prescriptions (net of returns) – by prescription line where the sale says
  // which line, else (older sales) listed with the prescription only
  const given = await givenFromPrescriptions(req.tenantId, visits.map((v) => v._id));
  const allergies = allergyFor(patient);
  await audit(req, 'PHARMACY_PRESCRIPTIONS_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn, prescriptions: visits.length, ...(allergies.status === 'recorded' ? { allergiesShown: true } : {}) } });
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
      allergies,
    },
    prescriptions: visits.map((v) => {
      const by = v.prescription?.by ? doctors.get(String(v.prescription.by)) : null;
      return {
        visitId: String(v._id),
        date: isoDay(v.visitOn),
        // Written on her earlier record (its patient number), not on this one
        fromRecord: earlier.get(String(v.patientId)) ?? null,
        doctor: by ? { name: by.name, reg: by.professional?.registrationNumber ?? '' } : null,
        soldUnlinked: given.unlinked.get(String(v._id)) ?? [],
        items: v.prescription.items.map((it) => ({
          ...givenWords(given.byItem.get(String(it._id)) ?? [], suggestedQty(it)),
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

// One part of a walk-in's payment from the Payment window (7 Nov 2026). reference: the cheque number, a card's last 4
// digits (never the whole card number) or the transaction id.
const paymentPart = z
  .object({
    mode: z.enum(COUNTER_MODES),
    amountPaise: z.number().int().min(1, 'Write the amount paid.').max(1_000_000_000),
    reference: z.string().trim().max(80).default(''),
    bank: z.string().trim().max(80).default(''),
    on: requiredDateOnly('Date').optional(),
    authorisedBy: z.string().trim().max(100).default(''),
    narration: z.string().trim().max(200).default(''),
  })
  .strict()
  .refine((p) => p.mode !== 'card' || !p.reference || /^\d{4}$/.test(p.reference), { message: 'Write only the last 4 digits of the card.', path: ['reference'] });

const invoiceFields = z
  .object({
    kind: z.enum(['sale', 'issue']),
    patientId: objectId.optional(),
    customer: z.object({ name: z.string().trim().min(2, 'Write the customer’s name.').max(150).transform(capitalizeName), phone: z.string().trim().max(30).default('') }).strict().optional(),
    doctor: z.object({ name: z.string().trim().max(150).transform(capitalizeName).default(''), reg: z.string().trim().max(60).default('') }).strict().optional(),
    visitId: objectId.optional(),
    rxSeen: z.boolean().default(false),
    kitId: objectId.optional(), // PH14: an issue filled from a kit (its name is kept on the invoice)
    wardRequestId: objectId.optional(), // PH12: an issue answering the ward's request
    lines: z
      .array(
        z
          .object({
            medicineId: objectId,
            qty,
            batchId: objectId.optional(),
            dose: z.string().trim().max(60, 'Write the dose in at most 60 letters').default(''),
            // PH6: the prescription line it is sold from, and why it is sold again when already given in full
            rxItemId: objectId.optional(),
            repeatReason: z.string().trim().max(200).default(''),
            // PH10: another brand than the doctor wrote – which doctor agreed (one of the hospital's, or a typed name)
            substitution: z.object({ agreedById: objectId.optional(), agreedByName: z.string().trim().max(150).default('') }).strict().optional(),
          })
          .strict(),
      )
      .min(1, 'Add at least one medicine.')
      .max(60),
    discountPercent: z.number().min(0).max(100).default(0),
    discountReason: z.string().trim().max(200).default(''),
    payment: z.object({ mode: z.enum(COUNTER_MODES), reference: z.string().trim().max(80).default('') }).strict().optional(),
    payments: z.array(paymentPart).min(1).max(5).optional(),
    paymentRemarks: z.string().trim().max(200).default(''),
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
  .refine((b) => !b.discountPercent || b.discountReason.length >= MIN_REASON, { message: 'Please write why the discount is given.', path: ['discountReason'] })
  .refine((b) => b.kind === 'sale' || b.patientId, { message: 'Medicines are issued to an admitted patient.', path: ['patientId'] })
  // A registered patient's invoice goes on her hospital bill: she pays at the billing desk, never here
  .refine((b) => !b.patientId || (!b.payment && !b.payments), { message: 'A registered patient pays at the billing desk: the invoice goes on her hospital bill.', path: ['payments'] })
  .refine((b) => !(b.payment && b.payments), { message: 'Send the payment once.', path: ['payments'] });
const invoiceSchema = invoiceFields.refine((b) => b.patientId || b.payment || b.payments, { message: 'A walk-in customer pays at the counter: choose how.', path: ['payment'] });

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
    details: {
      invoiceId: String(inv._id),
      number: inv.number,
      ...(inv.patientId ? { patientId: String(inv.patientId) } : { walkIn: true }),
      ...(inv.buyer ? { business: true } : {}),
      lines: inv.lines.length,
      amountPaise: t.netPaise,
      controlled: inv.lines.some((l) => CONTROLLED.includes(l.schedule)),
      // PH6: prescription lines sold again after they were given in full (the reasons stay on the invoice)
      ...(inv.lines.some((l) => l.repeatReason) ? { repeats: new Set(inv.lines.filter((l) => l.repeatReason).map((l) => String(l.rxItemId))).size } : {}),
    },
  });
  res.status(201).json({ invoice: await oneView(req, inv) });
});

// The Payment window (7 Nov 2026): what the bill will come to – the same medicines, batches and discount as the
// invoice about to be made, with nothing taken from the stock and no number used.
pharmacyRouter.post('/invoices/quote', async (req, res) => {
  desk(req);
  const body = parse(invoiceFields, req.body);
  res.json({ quote: await createInvoice(req, body, { dryRun: true }) });
});

pharmacyRouter.get('/invoices', async (req, res) => {
  const q = parse(z.object({ date: requiredDateOnly('Date').optional(), search: z.string().trim().max(100).optional(), patientId: objectId.optional() }).strict(), req.query);
  const filter = { tenantId: req.tenantId };
  if (q.patientId) filter.patientId = q.patientId;
  else if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    const pids = (await Patient.find({ tenantId: req.tenantId, $or: [{ fullName: rx }, { mrn: rx }, { phone: rx }] }, { _id: 1 }).limit(200).lean()).map((p) => p._id);
    filter.$or = [{ number: rx }, { 'customer.name': rx }, { 'buyer.name': rx }, { patientId: { $in: pids } }, { 'lines.name': rx }, { 'lines.generic': rx }];
  } else {
    const day = q.date ?? today(req);
    filter['created.at'] = { $gte: hospitalDayStart(day), $lt: hospitalDayStart(addDays(day, 1)) };
  }
  const list = await PharmacyInvoice.find(filter).sort({ 'created.at': -1, _id: -1 }).limit(200).lean();
  res.json({ today: isoDay(today(req)), invoices: await invoiceViews(req, list) });
});

// Finding people on Sold (developer's request, 3 Nov 2026): the people the pharmacy has billed, newest bill first, by
// name or phone and patient number, narrowed by type, doctor, day, amount and how it was paid, each with their bills.
// A search also finds registered patients without a bill (the owner's approval, given through the developer on 5 Nov 2026,
// changing the rule of 26 Oct 2026): their name and number only, from two letters typed and with no other filter, never
// a sensitive record or a duplicate. The whole list is still never shown without a search. The pharmacist only; audited.
const PEOPLE_LIMIT = 200;
const PERSON_BILLS = 200;
const BILL_TYPES = { opd: { kind: 'sale', patientId: { $ne: null } }, ipd: { kind: 'issue' }, external: { patientId: null } };
// The whole patient list on Sold and New bill (owner's approval, 9 Nov 2026 – it changes the rules of 26 Oct and 5 Nov
// 2026): a page of this many more patients each time "Show more" is pressed
const FULL_LIST_PAGE = 200;
/**
 * Every patient of a type, from the first registration to today (owner's approval, 9 Nov 2026): OPD – anyone who ever
 * came to the OPD (checked in, or a visit); IPD – anyone ever admitted; all – everyone registered. Never a sensitive
 * record or a duplicate. Returns the filter for Patient.find, and the IPD and OPD sets to mark each person's type.
 */
async function fullListFilter(req, type) {
  const tenantId = req.tenantId;
  const [arrived, visited, admitted] = await Promise.all([
    type === 'ipd' ? [] : Arrival.distinct('patientId', { tenantId }),
    type === 'ipd' ? [] : Visit.distinct('patientId', { tenantId, status: 'active' }),
    Admission.distinct('patientId', { tenantId }),
  ]);
  const opd = new Set([...arrived, ...visited].map(String));
  const ipd = new Set(admitted.map(String));
  const ids = type === 'opd' ? [...opd] : type === 'ipd' ? [...ipd] : null;
  return { filter: { tenantId, sensitive: { $ne: true }, 'duplicateOf.patient': null, ...(ids ? { _id: { $in: ids } } : {}) }, opd, ipd };
}
pharmacyRouter.get('/invoices/people', async (req, res) => {
  desk(req);
  const { search, mrn, type, doctor, date, amount, paidBy, pages } = parse(
    z.object({ search: z.string().trim().min(1).max(100).optional(), mrn: z.string().trim().min(1).max(40).optional(), type: z.enum(Object.keys(BILL_TYPES)).optional(), doctor: z.string().trim().max(150).optional(), date: requiredDateOnly('Date').optional(), amount: z.string().trim().regex(/^\d+(\.\d*)?$/).optional(), paidBy: z.enum([...COUNTER_MODES, 'hospital']).optional(), pages: z.coerce.number().int().min(1).max(50).default(1) }).strict(),
    req.query,
  );
  let unbilledFilter = null;
  const match = { tenantId: new mongoose.Types.ObjectId(String(req.tenantId)), ...(type ? BILL_TYPES[type] : {}), ...(doctor ? { 'doctor.name': doctor } : {}), ...(date ? { 'created.at': { $gte: hospitalDayStart(date), $lt: hospitalDayStart(addDays(date, 1)) } } : {}) };
  // An amount by its first digits (12 finds 12, 120 and 1,200); "hospital": a patient's bill, paid at the billing desk
  const also = [
    ...(amount ? [{ $expr: { $regexMatch: { input: { $toString: { $divide: [{ $sum: '$lines.amountPaise' }, 100] } }, regex: `^${escapeRegex(amount)}` } } }] : []),
    ...(paidBy === 'hospital' ? [{ patientId: { $ne: null } }] : paidBy ? [{ 'payments.mode': paidBy }] : []),
  ];
  if (also.length) match.$and = also;
  if (search || mrn) {
    const rx = search ? new RegExp(escapeRegex(search), 'i') : null;
    // Among the patients with a bill, so that many who match without one never push out those who have one
    const billed = await PharmacyInvoice.distinct('patientId', { tenantId: req.tenantId, patientId: { $ne: null } });
    const who = { tenantId: req.tenantId, ...(rx ? { $or: [{ fullName: rx }, { mrn: rx }, { phone: rx }] } : {}), ...(mrn ? { mrn: new RegExp(escapeRegex(mrn), 'i') } : {}) };
    const pids = (await Patient.find({ ...who, _id: { $in: billed } }, { _id: 1 }).lean()).map((p) => p._id);
    const typedEnough = (search ?? '').length >= 2 || (mrn ?? '').length >= 2;
    // Registered patients without a bill (5 Nov 2026) – with OPD or IPD chosen too (9 Nov 2026), among that type's
    // patients, so the counts are those of the other screens. The bill filters (doctor, day, amount, paid by) find bills only.
    if (typedEnough && type !== 'external' && !doctor && !date && !amount && !paidBy) {
      const ofType = type ? (await fullListFilter(req, type)).filter : { sensitive: { $ne: true }, 'duplicateOf.patient': null };
      unbilledFilter = { ...ofType, ...who, _id: { $nin: billed, ...(ofType._id ?? {}) } };
    }
    // A walk-in has no patient number: a number finds only patients
    match.$or = [{ patientId: { $in: pids } }, ...(rx && !mrn ? [{ patientId: null, 'customer.name': rx }, { patientId: null, 'customer.phone': rx }, { patientId: null, 'buyer.name': rx }] : [])];
  }
  const groups = await PharmacyInvoice.aggregate([
    { $match: match },
    { $sort: { 'created.at': -1, _id: -1 } },
    {
      $group: {
        // A walk-in has no record: the same name and phone count as one person
        _id: { patientId: '$patientId', name: { $cond: ['$patientId', null, { $toLower: { $ifNull: ['$customer.name', ''] } }] }, phone: { $cond: ['$patientId', null, '$customer.phone'] } },
        customer: { $first: '$customer' },
        lastAt: { $first: '$created.at' },
        bills: { $push: { id: '$_id', number: '$number', kind: '$kind', at: '$created.at' } },
      },
    },
    { $sort: { lastAt: -1, '_id.name': 1 } },
    { $limit: PEOPLE_LIMIT + 1 },
    { $project: { customer: 1, lastAt: 1, billCount: { $size: '$bills' }, bills: { $slice: ['$bills', PERSON_BILLS] } } },
  ]);
  const shown = groups.slice(0, PEOPLE_LIMIT);
  const ids = shown.map((g) => g._id.patientId).filter(Boolean);
  const patients = new Map((ids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }, { fullName: 1, mrn: 1, phone: 1 }).lean() : []).map((p) => [String(p._id), p]));
  const people = shown
    .filter((g) => !g._id.patientId || patients.has(String(g._id.patientId)))
    .map((g) => {
      const p = g._id.patientId ? patients.get(String(g._id.patientId)) : null;
      return {
        key: p ? String(p._id) : `walkin-${g.bills[0].id}`,
        type: !p ? 'external' : g.bills[0].kind === 'issue' ? 'ipd' : 'opd',
        name: p ? p.fullName : (g.customer?.name ?? ''),
        mrn: p?.mrn ?? '',
        phone: p ? (p.phone ?? '') : (g.customer?.phone ?? ''),
        lastAt: g.lastAt,
        billCount: g.billCount,
        bills: g.bills.map((b) => ({ id: String(b.id), number: b.number, at: b.at })),
      };
    });
  // Search with nothing typed (6 Nov 2026): first the people to bill now, as the pharmacist's register lists them –
  // those admitted (IPD) and those who arrived today (OPD) – then everyone billed, newest first. Never other records.
  if (!search && !mrn && !doctor && !date && !amount && !paidBy && type !== 'external') {
    const listed = new Set(people.map((x) => x.key));
    const [stays, arrivals] = await Promise.all([
      type === 'opd' ? [] : Admission.find({ tenantId: req.tenantId, status: 'admitted' }, { patientId: 1 }).sort({ admittedAt: -1 }).limit(PEOPLE_LIMIT).lean(),
      type === 'ipd' ? [] : Arrival.find({ tenantId: req.tenantId, on: utcDay(today(req)) }, { patientId: 1 }).sort({ at: -1 }).limit(PEOPLE_LIMIT).lean(),
    ]);
    const now = [...stays.map((x) => [String(x.patientId), 'ipd']), ...arrivals.map((x) => [String(x.patientId), 'opd'])].filter(([id], i, all) => !listed.has(id) && all.findIndex(([other]) => other === id) === i);
    const found = new Map((now.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: now.map(([id]) => id) } }, { fullName: 1, mrn: 1 }).lean() : []).map((p) => [String(p._id), p]));
    const first = now.filter(([id]) => found.has(id)).map(([id, kind]) => ({ key: id, type: kind, name: found.get(id).fullName, mrn: found.get(id).mrn, phone: '', lastAt: null, billCount: 0, bills: [] }));
    people.unshift(...first);
    people.splice(PEOPLE_LIMIT);
  }
  // After those with bills: registered patients without one, as far as the list has room
  const room = PEOPLE_LIMIT - people.length;
  const unbilled = unbilledFilter && room > 0 ? await Patient.find(unbilledFilter, { fullName: 1, mrn: 1 }).sort({ fullName: 1 }).limit(room + 1).lean() : [];
  for (const p of unbilled.slice(0, room)) people.push({ key: String(p._id), type: type ?? '', name: p.fullName, mrn: p.mrn, phone: '', lastAt: null, billCount: 0, bills: [] });

  // Search with nothing typed (owner's approval, 9 Nov 2026): after the people to bill now and those billed, every patient
  // of the type from the first registration to today, newest registration first, a page at a time ("Show more")
  let fullMore = false;
  let fullCount = 0;
  const browsing = !search && !mrn && !doctor && !date && !amount && !paidBy && type !== 'external';
  if (browsing) {
    const { filter, ipd, opd } = await fullListFilter(req, type);
    const listed = people.map((x) => x.key).filter((k) => !k.startsWith('walkin-'));
    const want = FULL_LIST_PAGE * pages;
    const rest = await Patient.find({ ...filter, _id: { ...(filter._id ?? {}), $nin: listed } }, { fullName: 1, mrn: 1 })
      .sort({ createdAt: -1, _id: -1 })
      .limit(want + 1)
      .lean();
    fullMore = rest.length > want;
    for (const p of rest.slice(0, want)) people.push({ key: String(p._id), type: type ?? (ipd.has(String(p._id)) ? 'ipd' : opd.has(String(p._id)) ? 'opd' : ''), name: p.fullName, mrn: p.mrn, phone: '', lastAt: null, billCount: 0, bills: [] });
    fullCount = Math.min(rest.length, want);
  }
  await audit(req, 'PHARMACY_PATIENT_LOOKED_UP', {
    details: search || mrn ? { by: search ? 'name' : 'number', patientIds: people.filter((x) => x.mrn).map((x) => x.key), walkInBills: people.filter((x) => !x.mrn).length, withoutBill: Math.min(unbilled.length, Math.max(room, 0)) } : { by: 'list', type: type ?? 'all', people: people.length, ...(browsing ? { wholeList: fullCount, pages } : {}) },
  });
  res.json({ people, more: browsing ? fullMore : groups.length > PEOPLE_LIMIT || unbilled.length > room, ...(browsing ? { pages } : {}) });
});

// The doctors named on the pharmacy's bills, for the filter on Sold.
pharmacyRouter.get('/invoices/doctors', async (req, res) => {
  desk(req);
  const names = await PharmacyInvoice.distinct('doctor.name', { tenantId: req.tenantId });
  res.json({ doctors: names.filter(Boolean).sort((x, y) => x.localeCompare(y)) });
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

// ---------- PH24: sales by doctor (docs/PHARMACY_BUILD_NOTE.md, owner's decision 5) ----------
// The pharmacist only – NOT reports(req), which lets the hospital admin in. Not in the export, not in Analytics.
pharmacyRouter.get('/reports/by-doctor', async (req, res) => {
  if (!hasRole(req.membership, ...PHARMACY_DOCTOR_SALES_ROLES)) throw forbidden('Sales by doctor are for the pharmacist only.');
  const q = parse(periodSchema, req.query);
  const [from, to] = period(q);
  const invoices = await PharmacyInvoice.find({ tenantId: req.tenantId, 'created.at': { $gte: from, $lt: to } }, { doctor: 1, lines: 1, returns: 1, payments: 1, patientId: 1 }).lean();
  const rows = salesByDoctor(invoices);
  await audit(req, 'PHARMACY_DOCTOR_SALES_VIEWED', { details: { from: isoDay(q.from), to: isoDay(q.to), doctors: rows.length } });
  res.json({ from: isoDay(q.from), to: isoDay(q.to), doctors: rows.map(({ key, ...r }) => r), withoutDoctor: invoices.filter((i) => !doctorOf(i)).length });
});

// ---------- PH15: the missing reports and the day's closing (docs/PHARMACY_BUILD_NOTE.md) ----------

// The figures of a period: profit by medicine, slow and non-moving stock (now), the value lost to expiry, days out of
// stock, prescriptions filled in-house (counts), and H1 use by month. The pharmacist and the hospital admin.
pharmacyRouter.get('/reports/figures', async (req, res) => {
  reports(req);
  const q = parse(periodSchema, req.query);
  const [from, to] = period(q);
  const [profit, slow, expiry, out, rx, h1] = await Promise.all([
    profitByMedicine(req.tenantId, from, to),
    nonMoving(req.tenantId, req.now),
    expiryLoss(req.tenantId, from, to),
    daysOutOfStock(req.tenantId, from, new Date(Math.min(to, req.now))), // up to now within the current day
    prescriptionsFilled(req.tenantId, from, to),
    h1Use(req.tenantId, from, to),
  ]);
  res.json({ from: isoDay(q.from), to: isoDay(q.to), profit, nonMoving: slow, expiryLoss: expiry, outOfStock: out, prescriptions: rx, h1 });
});

/** The counter's takings of one hospital day: walk-in payments less refunds by mode, and what went on hospital bills. */
async function takingsOf(req, day) {
  const from = hospitalDayStart(day);
  const to = hospitalDayStart(addDays(day, 1));
  const invoices = await PharmacyInvoice.find({ tenantId: req.tenantId, $or: [{ 'created.at': { $gte: from, $lt: to } }, { 'payments.at': { $gte: from, $lt: to } }] }).lean();
  const byMode = {};
  let refundsPaise = 0;
  let onBillsPaise = 0;
  let count = 0;
  for (const inv of invoices) {
    const made = inv.created?.at >= from && inv.created?.at < to;
    if (made) count += 1;
    if (made && inv.patientId) onBillsPaise += invoiceTotals(inv).totalPaise;
    for (const p of inv.payments ?? []) {
      if (!(p.at >= from && p.at < to)) continue;
      const v = p.kind === 'refund' ? -p.amountPaise : p.amountPaise;
      byMode[p.mode] = (byMode[p.mode] ?? 0) + v;
      if (p.kind === 'refund') refundsPaise += p.amountPaise;
    }
  }
  return { byMode, refundsPaise, onBillsPaise, invoices: count, expectedCashPaise: byMode.cash ?? 0 };
}

pharmacyRouter.get('/reports/day', async (req, res) => {
  reports(req);
  const q = parse(z.object({ date: requiredDateOnly('Date') }).strict(), req.query);
  const closed = await PharmacyDayClose.findOne({ tenantId: req.tenantId, on: q.date }).lean();
  res.json({
    date: isoDay(q.date),
    ...(await takingsOf(req, q.date)),
    closed: closed ? { expectedCashPaise: closed.expectedCashPaise, countedCashPaise: closed.countedCashPaise, differencePaise: closed.differencePaise, note: closed.note ?? '', byName: closed.created.byName, at: closed.created.at } : null,
    canClose: hasRole(req.membership, 'pharmacist') && !closed,
  });
});

pharmacyRouter.post('/day-close', async (req, res) => {
  desk(req);
  const body = parse(z.object({ date: requiredDateOnly('Date'), countedCashPaise: z.number().int().min(0).max(MAX_PAISE), note: z.string().trim().max(300).default('') }).strict(), req.body);
  if (body.date > utcDay(today(req))) throw new HttpError(400, 'That day has not come yet.', 'VALIDATION');
  if (await PharmacyDayClose.exists({ tenantId: req.tenantId, on: body.date })) throw new HttpError(409, 'This day is already closed.', 'ALREADY_CLOSED');
  const t = await takingsOf(req, body.date);
  const differencePaise = body.countedCashPaise - t.expectedCashPaise;
  if (differencePaise !== 0 && body.note.length < 3) throw Object.assign(new HttpError(400, 'The cash counted is not what the counter took: write why.', 'VALIDATION'), { fields: { note: 'Write why the cash differs.' } });
  await PharmacyDayClose.create({ tenantId: req.tenantId, on: body.date, ...t, countedCashPaise: body.countedCashPaise, differencePaise, note: body.note, created: { by: req.user._id, byName: req.user.name, at: req.now } });
  await audit(req, 'PHARMACY_DAY_CLOSED', { details: { date: isoDay(body.date), expectedCashPaise: t.expectedCashPaise, countedCashPaise: body.countedCashPaise, differencePaise } });
  res.status(201).json({ closed: true, differencePaise });
});

// Alerts: medicines at or below their reorder level; batches expiring within 90 days, and expired ones.
pharmacyRouter.get('/reports/alerts', async (req, res) => {
  reports(req);
  const t = today(req);
  const meds = await Medicine.find({ tenantId: req.tenantId, active: true }).sort({ name: 1 }).lean();
  const batches = await StockBatch.find({ tenantId: req.tenantId, qtyLeft: { $gt: 0 } }).sort({ expiry: 1 }).lean();
  const usable = new Map();
  for (const b of batches) if (!isExpired(b, t) && !b.hold) usable.set(String(b.medicineId), (usable.get(String(b.medicineId)) ?? 0) + b.qtyLeft);
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
      place: x.place ?? '', // PH13: '' = the pharmacy
      otherPlace: x.otherPlace ?? '',
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
  res.json({ from: isoDay(q.from), to: isoDay(q.to), bySupplier, totalPaise, returnedPaise, netPaise: totalPaise - returnedPaise, register: purchaseRegister(list, names) });
});

/**
 * PH3: the purchase register – one row per bill of the period: taxable value, GST by rate, CGST, SGST, IGST, rounding
 * and the bill's total. Bills entered before the GRN (no tax recorded) are listed apart and left out of the tax totals.
 */
export function purchaseRegister(list, names) {
  const rows = [];
  const noTax = [];
  for (const p of [...list].sort((a, b) => new Date(a.invoiceDate) - new Date(b.invoiceDate) || a.number.localeCompare(b.number))) {
    const base = { number: p.number, supplier: names.get(String(p.supplierId)) ?? '', invoiceNo: p.invoiceNo, invoiceDate: isoDay(p.invoiceDate) };
    if (!p.grn || p.grn.netPaise == null) {
      noTax.push({ ...base, valuePaise: p.totalPaise });
      continue;
    }
    const rates = new Map();
    for (const l of p.lines) {
      const r = l.gstRate ?? 0;
      const x = rates.get(r) ?? { rate: r, taxablePaise: 0, gstPaise: 0 };
      x.taxablePaise += l.pack?.taxablePaise ?? 0;
      x.gstPaise += l.pack?.gstPaise ?? 0;
      rates.set(r, x);
    }
    rows.push({
      ...base,
      interState: p.grn.taxType === 'igst',
      taxablePaise: (p.grn.netPaise ?? 0) - (p.grn.gstPaise ?? 0) - (p.grn.roundingPaise ?? 0),
      byRate: [...rates.values()].sort((a, b) => a.rate - b.rate),
      cgstPaise: p.grn.cgstPaise ?? 0,
      sgstPaise: p.grn.sgstPaise ?? 0,
      igstPaise: p.grn.igstPaise ?? 0,
      roundingPaise: p.grn.roundingPaise ?? 0,
      netPaise: p.grn.netPaise,
      printedTotalPaise: p.grn.printedTotalPaise ?? null,
    });
  }
  const total = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  return { rows, noTax, totals: { taxablePaise: total('taxablePaise'), cgstPaise: total('cgstPaise'), sgstPaise: total('sgstPaise'), igstPaise: total('igstPaise'), roundingPaise: total('roundingPaise'), netPaise: total('netPaise') } };
}

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
  const q = parse(z.object({ from: requiredDateOnly('From'), to: requiredDateOnly('To'), what: z.enum(['sales', 'purchases', 'supplier_returns', 'supplier_payments']) }).strict(), req.query);
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
  } else if (q.what === 'supplier_payments') {
    // PH11: payments to suppliers (cancelled ones listed, marked)
    const list = await SupplierPayment.find({ tenantId: req.tenantId, on: { $gte: q.from, $lte: q.to } }).sort({ on: 1, number: 1 }).lean();
    const names = new Map((await Supplier.find({ tenantId: req.tenantId, _id: { $in: list.map((p) => p.supplierId) } }, { name: 1, gstin: 1 }).lean()).map((x) => [String(x._id), x]));
    rows = [['Payment', 'Date', 'Supplier', 'Supplier GSTIN', 'Mode', 'Reference', 'Amount', 'Status']];
    for (const p of list) rows.push([p.number, isoDay(p.on), names.get(String(p.supplierId))?.name ?? '', names.get(String(p.supplierId))?.gstin ?? '', p.mode, p.reference ?? '', rs(p.amountPaise), p.cancelled ? 'Cancelled' : 'Paid']);
  } else if (q.what === 'supplier_returns') {
    const list = await SupplierReturn.find({ tenantId: req.tenantId, 'created.at': { $gte: from, $lt: to } }).sort({ 'created.at': 1 }).lean();
    const names = new Map((await Supplier.find({ tenantId: req.tenantId, _id: { $in: list.map((r) => r.supplierId) } }, { name: 1, gstin: 1 }).lean()).map((x) => [String(x._id), x]));
    // Cancelled returns are listed too, marked so (like cancelled purchases): the accountant leaves them out
    rows = [['Debit note', 'Date', 'Supplier', 'Supplier GSTIN', 'Reason', 'Supplier invoice', 'Medicine', 'Manufacturer', 'HSN', 'Batch', 'Expiry', 'Qty', 'Rate', 'Taxable', 'GST %', 'CGST', 'SGST', 'IGST', 'Amount', 'Status', 'Supplier credit note', 'Credit note date', 'Credit note amount']];
    for (const r of list) {
      const sup = names.get(String(r.supplierId));
      for (const l of r.lines) {
        rows.push([r.number, isoDay(toHospitalDate(r.created.at)), sup?.name ?? '', sup?.gstin ?? '', SUPPLIER_RETURN_REASON_LABELS[r.reason] ?? r.reason, l.invoiceNo ?? '', l.name, l.manufacturer ?? '', l.hsn, l.batch, isoDay(l.expiry), l.qty, rs(l.ratePaise), rs(l.taxablePaise), l.gstRate, rs(l.cgstPaise), rs(l.sgstPaise), rs(l.igstPaise), rs(l.amountPaise), r.status === 'cancelled' ? 'Cancelled' : 'Returned', r.creditNote?.number ?? '', r.creditNote?.date ? isoDay(r.creditNote.date) : '', r.creditNote ? rs(r.creditNote.amountPaise) : '']);
      }
    }
  } else {
    const list = await Purchase.find({ tenantId: req.tenantId, invoiceDate: { $gte: q.from, $lte: q.to } }).sort({ invoiceDate: 1 }).lean();
    const views = await purchaseViews(req, list);
    rows = [['Purchase', 'Supplier', 'Invoice', 'Invoice date', 'Status', 'Medicine', 'Manufacturer', 'Batch', 'Expiry', 'Qty', 'Free', 'Rate', 'MRP', 'Value', 'Purchase order']];
    for (const v of views) for (const l of v.lines) rows.push([v.number, v.supplier, v.invoiceNo, v.invoiceDate, v.status, l.name, l.manufacturer ?? '', l.batch, l.expiry, l.qty, l.freeQty, rs(l.ratePaise), rs(l.mrpPaise), rs(l.ratePaise * l.qty), v.order?.number ?? '']);
  }
  await audit(req, 'PHARMACY_EXPORTED', { details: { what: q.what, from: isoDay(q.from), to: isoDay(q.to), rows: rows.length - 1 } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="perinexa-pharmacy-${q.what.replace('_', '-')}-${isoDay(q.from)}-to-${isoDay(q.to)}.csv"`);
  res.send(csv(rows));
});
