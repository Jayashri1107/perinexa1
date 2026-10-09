import { Router } from 'express';
import { z } from 'zod';
import { objectId, parse } from '../../core/validate.js';
import * as service from './nursingService.service.js';

// Nurses (and doctors, RMOs) record services they gave (config.access.patientsClinical):
//  GET  /options               the price list items a nurse may record
//  GET  /mine-today            the services this person recorded today
//  GET  /patient/:patientId    a patient's services
//  POST /                      record services given (sent to the front desk)
//  POST /:id/cancel            cancel one still waiting, with the reason
const router = Router();

const requestId = z.string().trim().min(8).max(64);
const recordBody = z.object({
  patientId: objectId,
  items: z.array(z.object({ priceItemId: objectId, qty: z.coerce.number().int().min(1, 'At least 1').max(100) })).min(1, 'Choose at least one service').max(20),
  givenAt: z.coerce.date({ error: 'Choose the date and time' }).refine((d) => d <= new Date(Date.now() + 5 * 60000), 'This time is in the future'),
  note: z.string().trim().max(300, 'This is too long').default(''),
  clientRequestId: requestId,
});
const reason = z.object({ reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300) });

router.get('/options', async (req, res) => res.json(await service.options(req)));
router.get('/mine-today', async (req, res) => res.json(await service.mineToday(req)));
router.get('/patient/:patientId', async (req, res) => res.json(await service.ofPatient(req, parse(z.object({ patientId: objectId }), req.params).patientId)));
router.post('/', async (req, res) => res.status(201).json(await service.record(req, parse(recordBody, req.body))));
router.post('/:id/cancel', async (req, res) => res.json(await service.cancel(req, parse(z.object({ id: objectId }), req.params).id, parse(reason, req.body).reason)));

export default router;

// The front desk (config.access.billing): services waiting to be billed, and adding one to her bill.
//  GET  /              waiting (oldest first) and billed today
//  POST /:id/bill      onto { billId } or her latest open bill, or a new bill
export const billingServicesRouter = Router();
billingServicesRouter.get('/', async (req, res) => res.json(await service.queue(req)));
billingServicesRouter.post('/:id/bill', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  res.json(await service.bill(req, id, parse(z.object({ billId: objectId.optional() }), req.body)));
});
