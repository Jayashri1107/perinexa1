import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_MODE_KEYS, PRICE_GROUP_KEYS, config } from '../../config/index.js';
import { objectId, optional, parse } from '../../core/validate.js';
import * as service from './dispensing.service.js';

// Giving prescriptions (config.access.dispense – the pharmacy and the front desk; owner, 8 Oct 2026):
//  GET  /queue               prescriptions sent by doctors and still to give, and those given today
//  GET  /medicines?search=   medicines on the stock list, to add
//  GET  /bills/:billId       the bill of a given prescription, to print
//  GET  /:visitId            the prescription to give: her details, the medicines matched to stock, the price list
//  POST /:visitId/give       give it: the medicines, other charges, discount and payment on one bill
const router = Router();

const NEEDS_REFERENCE = new Set(config.billing.paymentModes.filter((m) => m.needsReference).map((m) => m.key));
const giveBody = z.object({
  medicines: z.array(z.object({ medicineId: objectId, qty: z.coerce.number().int().min(1, 'At least 1').max(10000) })).max(100).default([]),
  charges: z
    .array(
      z
        .object({
          priceItemId: optional(objectId),
          name: z.string().trim().max(150).default(''),
          group: optional(z.enum(PRICE_GROUP_KEYS)),
          unitPrice: optional(z.coerce.number().min(0).max(10000000)),
          qty: z.coerce.number().int().min(1).max(1000).default(1),
        })
        .refine((l) => l.priceItemId || (l.name.length >= 2 && l.group && l.unitPrice !== undefined), { message: 'Choose a charge from the price list, or give its name and amount' }),
    )
    .max(30)
    .default([]),
  discount: z
    .object({ amount: z.coerce.number().min(0).max(10000000).default(0), reason: z.string().trim().max(200).default('') })
    .default({ amount: 0, reason: '' })
    .refine((d) => d.amount === 0 || d.reason.length >= 3, { path: ['reason'], message: 'Give the reason for the discount' }),
  payment: z
    .object({ mode: z.enum(PAYMENT_MODE_KEYS, 'Choose how it was paid'), reference: z.string().trim().max(100).default(''), amount: z.coerce.number().min(0).max(10000000).default(0) })
    .refine((p) => p.amount === 0 || !NEEDS_REFERENCE.has(p.mode) || p.reference.length > 0, { path: ['reference'], message: 'Enter the reference (transaction or slip number)' }),
});
const visitParams = z.object({ visitId: objectId });

router.get('/queue', async (req, res) => {
  res.json(await service.pharmacyQueue(req));
});
router.get('/medicines', async (req, res) => {
  res.json({ items: await service.searchMedicines(req, parse(z.object({ search: z.string().trim().max(60).default('') }), req.query).search) });
});
router.get('/bills/:billId', async (req, res) => {
  res.json(await service.billToPrint(req, parse(z.object({ billId: objectId }), req.params).billId));
});
router.get('/:visitId', async (req, res) => {
  res.json(await service.prescriptionToGive(req, parse(visitParams, req.params).visitId));
});
router.post('/:visitId/give', async (req, res) => {
  res.status(201).json(await service.give(req, parse(visitParams, req.params).visitId, parse(giveBody, req.body)));
});

export default router;
