import { Router } from 'express';
import { pharmacyWitnessField, pharmacyWitnessName } from '../auth/witness.js';
import { z } from 'zod';
import { SupplierReturn } from '../models/Pharmacy.js';
import { desk, idParam, notFound, qty, reason, settingsOf } from '../pharmacy/pharmacyHttp.js';
import { CONTROLLED, SUPPLIER_RETURN_REASONS, SUPPLIER_RETURN_REASON_LABELS } from '../pharmacy/pharmacyRules.js';
import { cancelSupplierReturn, createSupplierReturn, returnTotals, returnableBatches, supplierReturnViews } from '../pharmacy/supplierReturnsService.js';
import { audit } from '../utils/audit.js';
import { objectId, parse, requiredDateOnly } from '../utils/validate.js';
import { paise } from '../pharmacy/pharmacyHttp.js';
import { capitalizeName } from '../utils/personName.js';

// Stock returned to a supplier: /api/pharmacy/supplier-returns (mounted inside routes/pharmacy.js, after its
// "pharmacists and the hospital admin only" check). The pharmacist sends stock back (it leaves the stock, like a
// write-off) and cancels a return entered by mistake (the stock comes back); the pharmacist and the hospital admin see
// the returns and print their debit notes.
// A return holds no patient data. The audit log gets ids, numbers and amounts – never the note or reason that was typed.

export const pharmacySupplierReturnsRouter = Router();

const returnSchema = z
  .object({
    supplierId: objectId,
    reason: z.enum(SUPPLIER_RETURN_REASONS, 'Choose the reason.'),
    note: z.string().trim().max(200).default(''),
    witness: pharmacyWitnessField, // a controlled medicine: the second person signs in (PX-X-06)
    lines: z.array(z.object({ batchId: objectId, qty }).strict()).min(1, 'Choose at least one batch.').max(100),
  })
  .strict();

const one = async (req, ret) => (await supplierReturnViews(req, [ret.toObject ? ret.toObject() : ret]))[0];

pharmacySupplierReturnsRouter.get('/', async (req, res) => {
  const list = await SupplierReturn.find({ tenantId: req.tenantId }).sort({ 'created.at': -1, _id: -1 }).limit(200).lean();
  res.json({ returns: await supplierReturnViews(req, list), reasons: SUPPLIER_RETURN_REASONS.map((key) => ({ key, label: SUPPLIER_RETURN_REASON_LABELS[key] })) });
});

// The batches in stock that were bought from one supplier (expired ones too) – what can go back to it.
pharmacySupplierReturnsRouter.get('/batches', async (req, res) => {
  desk(req);
  const q = parse(z.object({ supplierId: objectId }).strict(), req.query);
  res.json({ ...(await returnableBatches(req, q.supplierId)), reasons: SUPPLIER_RETURN_REASONS.map((key) => ({ key, label: SUPPLIER_RETURN_REASON_LABELS[key] })) });
});

pharmacySupplierReturnsRouter.post('/', async (req, res) => {
  desk(req);
  const body = parse(returnSchema, req.body);
  body.witness = await pharmacyWitnessName(req, body.witness || null, 'pharmacy_return');
  const ret = await createSupplierReturn(req, body);
  const t = returnTotals(ret);
  await audit(req, 'PHARMACY_SUPPLIER_RETURNED', {
    details: { returnId: String(ret._id), number: ret.number, supplierId: String(ret.supplierId), reason: ret.reason, lines: ret.lines.length, qty: t.qty, amountPaise: t.amountPaise, controlled: ret.lines.some((l) => CONTROLLED.includes(l.schedule)) },
  });
  res.status(201).json({ return: await one(req, ret) });
});

const loadReturn = async (req) => {
  const ret = await SupplierReturn.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!ret) throw notFound('Return');
  return ret;
};

// One return, with the pharmacy's details for its debit note.
pharmacySupplierReturnsRouter.get('/:id', async (req, res) => {
  const ret = await loadReturn(req);
  res.json({ return: await one(req, ret), settings: await settingsOf(req.tenantId) });
});

// A return entered by mistake: kept, marked cancelled, and its stock put back on its batches (the pharmacist).
pharmacySupplierReturnsRouter.post('/:id/cancel', async (req, res) => {
  desk(req);
  const body = parse(z.object({ reason: reason('Cancelling a return'), witness: pharmacyWitnessField }).strict(), req.body);
  body.witness = await pharmacyWitnessName(req, body.witness || null, 'pharmacy_return_cancelled');
  const ret = await cancelSupplierReturn(req, await loadReturn(req), body);
  const t = returnTotals(ret);
  await audit(req, 'PHARMACY_SUPPLIER_RETURN_CANCELLED', { details: { returnId: String(ret._id), number: ret.number, supplierId: String(ret.supplierId), lines: ret.lines.length, qty: t.qty, amountPaise: t.amountPaise, controlled: ret.lines.some((l) => CONTROLLED.includes(l.schedule)) } });
  res.json({ return: await one(req, ret), settings: await settingsOf(req.tenantId) });
});

// PH3 (docs/PHARMACY_BUILD_NOTE.md): the supplier's own credit note for this return – its number, date and amount –
// entered when it arrives, usually days after the stock went back. Typed again to correct it. Not on a cancelled return.
pharmacySupplierReturnsRouter.post('/:id/credit-note', async (req, res) => {
  desk(req);
  const body = parse(
    z.object({ number: z.string().trim().min(1, 'Enter the credit note number.').max(60), date: requiredDateOnly('Credit note date'), amountPaise: paise.min(1, 'Enter the amount.') }).strict(),
    req.body,
  );
  const ret = await loadReturn(req);
  if (ret.status === 'cancelled') throw Object.assign(new Error('This return was cancelled.'), { status: 409, code: 'CANCELLED' });
  const changed = Boolean(ret.creditNote);
  ret.creditNote = { number: body.number, date: body.date, amountPaise: body.amountPaise, by: req.user._id, byName: req.user.name, at: req.now };
  await ret.save();
  await audit(req, 'PHARMACY_SUPPLIER_CREDIT_NOTE', { details: { returnId: String(ret._id), number: ret.number, amountPaise: body.amountPaise, ...(changed ? { changed: true } : {}) } });
  res.json({ return: await one(req, ret) });
});

pharmacySupplierReturnsRouter.post('/:id/printed', async (req, res) => {
  parse(z.object({}).strict(), req.body);
  const ret = await loadReturn(req);
  await audit(req, 'PHARMACY_DEBIT_NOTE_PRINTED', { details: { returnId: String(ret._id), number: ret.number } });
  res.json({ ok: true });
});
