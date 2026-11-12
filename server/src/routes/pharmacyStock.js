import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday, utcDay } from '../careplans/dates.js';
import { hasRole } from '../models/Membership.js';
import { Medicine, StockBatch } from '../models/Pharmacy.js';
import { matchLine, readLine, statusFor, stockIndex } from '../pharmacy/stockMatch.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, parse } from '../utils/validate.js';
import { RX_FORMS } from '../visits/rxCodes.js';

// Pharmacy stock while prescribing: /api/pharmacy-stock. For those who write prescriptions (doctors and RMOs) – the
// pharmacy itself (/api/pharmacy) stays with the pharmacist and the hospital admin.
// It answers ONE thing about each medicine asked about: in stock, low, or out – or nothing when the medicine can't be
// matched with confidence (pharmacy/stockMatch.js). Never a quantity, price, batch, expiry date, supplier or the
// pharmacy's own name for the medicine, and nothing about any patient. It changes nothing, and reads only this
// hospital's stock list. Not written to the audit log: no patient's record is read.

const PRESCRIBER_ROLES = ['doctor', 'rmo'];

const checkSchema = z
  .object({
    medicines: z
      .array(
        z
          .object({
            drug: z.string().trim().min(1, 'Enter the medicine').max(120),
            strength: z.string().trim().max(40).default(''),
            form: z.enum(RX_FORMS).optional(),
          })
          .strict(),
      )
      .min(1, 'Send at least one medicine')
      .max(40, 'At most 40 medicines at a time'),
  })
  .strict();

/** Usable units of each medicine (batches with stock that have not expired): Map "<medicineId>" → units. */
async function usableStock(tenantId, medicineIds, today) {
  if (!medicineIds.length) return new Map();
  const rows = await StockBatch.aggregate([
    // PH5: a batch on hold is not "in stock" for the doctor
    { $match: { tenantId, medicineId: { $in: medicineIds }, qtyLeft: { $gt: 0 }, expiry: { $gte: utcDay(today) }, hold: null, locationId: null } }, // PH13: the pharmacy's
    { $group: { _id: '$medicineId', qty: { $sum: '$qtyLeft' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.qty]));
}

export const pharmacyStockRouter = Router();

pharmacyStockRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...PRESCRIBER_ROLES)) throw new HttpError(403, 'Pharmacy stock while prescribing is shown to doctors and RMOs.', 'FORBIDDEN');
  next();
});

// PH8: the batches in stock of a vaccine (found by name), for a vaccination marked done – batch, expiry, maker only
pharmacyStockRouter.get('/vaccine-batches', async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().min(2).max(60) }).strict(), req.query);
  const rx = new RegExp(escapeRegex(q.q), 'i');
  const meds = await Medicine.find({ tenantId: req.tenantId, active: true, $or: [{ name: rx }, { generic: rx }] }, { name: 1, manufacturer: 1 }).limit(20).lean();
  const byId = new Map(meds.map((m) => [String(m._id), m]));
  const batches = meds.length ? await StockBatch.find({ tenantId: req.tenantId, medicineId: { $in: meds.map((m) => m._id) }, qtyLeft: { $gt: 0 }, expiry: { $gte: utcDay(hospitalToday(req.now)) }, hold: null, locationId: null }).sort({ expiry: 1 }).limit(30).lean() : [];
  res.json({
    batches: batches.map((b) => {
      const m = byId.get(String(b.medicineId));
      return { stockBatchId: String(b._id), name: m.name, batch: b.batch, expiry: b.expiry.toISOString().slice(0, 7), manufacturer: m.manufacturer ?? '' };
    }),
  });
});

// POST (a list is sent), but it only reads. Answers in the order asked: { pharmacy, stock: ['in' | 'low' | 'out' | null] }.
// pharmacy false: this hospital keeps no medicines in the Pharmacy module, so there is nothing to show.
pharmacyStockRouter.post('/check', async (req, res) => {
  const { medicines } = parse(checkSchema, req.body);
  // Only medicines in use: a stopped medicine is not sold.
  // PH14: consumables are not medicines a doctor prescribes
  const list = await Medicine.find({ tenantId: req.tenantId, active: true, kind: { $ne: 'consumable' } }, { name: 1, generic: 1, form: 1, strength: 1, reorderLevel: 1 }).lean();
  if (!list.length) return res.json({ pharmacy: false, stock: medicines.map(() => null) });
  // Each line and the stock list are read once (not line by medicine): a long list and a full prescription stay quick.
  const lines = medicines.map(readLine);
  const index = stockIndex(list, lines);
  const matches = lines.map((line) => matchLine(line, index));
  const ids = [...new Map(matches.flatMap((m) => m.medicines).map((m) => [String(m._id), m._id])).values()];
  const usable = await usableStock(req.tenantId, ids, hospitalToday(req.now));
  res.json({ pharmacy: true, stock: matches.map((m) => statusFor(m, usable)) });
});
