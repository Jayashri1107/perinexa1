import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { objectId, parse } from '../../core/validate.js';
import { DOSE_OUTCOMES, IV_ACTIONS, TASK_OUTCOMES } from '../admissions/admission.model.js';
import { ORDER_TYPES } from './careOrder.model.js';
import * as service from './wardCare.service.js';

// The nurse's work (config.access.patientsClinical: doctors, RMOs, nurses); each action is checked again in the
// service with the patient's record access.
//  GET  /station                         who is in hospital, with what is due (?wardId= one ward)
//  GET  /stays/:id                       a stay's orders and charts
//  POST /stays/:id/orders                a new order (her doctor or an RMO)
//  POST /stays/:id/orders/:orderId/stop  stop an order, with the reason (her doctor or an RMO)
//  POST /stays/:id/chart                 a dose, IV event, task, intake/output or handover (nurses, her doctor, RMOs)
// Vital signs and notes go on the nursing chart as before (POST /hospital/admissions/:id/nursing).
const router = Router();

const text = (max) => z.string().trim().max(max, 'This is too long').default('');
const requestId = z.string().trim().min(8).max(64);
const when = z.coerce.date({ error: 'Choose the date and time' }).refine((d) => d <= new Date(Date.now() + 5 * 60000), 'This time is in the future');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time like 08:00');
const ml = (max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0).max(max).nullable()).default(null);
const stayParams = z.object({ id: objectId });
const NEEDS_REASON = ['late', 'refused', 'withheld', 'missed', 'not_done'];

const orderBody = z
  .object({
    type: z.enum(ORDER_TYPES),
    medicine: z
      .object({
        drug: z.string().trim().min(2, 'Name the medicine').max(120),
        dose: z.string().trim().min(1, 'Write the dose').max(60),
        route: z.enum(config.nursing.routes, 'Choose the route'),
        food: text(40),
      })
      .optional(),
    iv: z
      .object({
        fluid: z.string().trim().min(2, 'Name the fluid').max(120),
        volumeMl: z.coerce.number('Write the volume').int().min(1, 'Write the volume').max(10000),
        rateMlPerHour: z.coerce.number('Write the rate').min(1, 'Write the rate').max(2000),
      })
      .optional(),
    task: z.object({ text: z.string().trim().min(3, 'Write the task').max(200) }).optional(),
    times: z.array(time).max(24).default([]),
    instructions: text(300),
    clientRequestId: requestId,
  })
  .refine((o) => o[o.type], { path: ['type'], message: 'Fill in the order' })
  .refine((o) => o.type !== 'task' || o.times.length > 0, { path: ['times'], message: 'Choose when the task is due' });

const chartBody = z
  .object({
    kind: z.enum(['dose', 'iv', 'task', 'io', 'handover']),
    at: when,
    orderId: objectId.optional(),
    dueAt: z.coerce.date().optional(),
    outcome: z.enum([...DOSE_OUTCOMES, ...TASK_OUTCOMES]).optional(),
    reason: text(300),
    iv: z.object({ action: z.enum(IV_ACTIONS), site: text(60), volumeMl: ml(10000) }).optional(),
    io: z.object({ oralMl: ml(10000), ivMl: ml(10000), urineMl: ml(10000), otherOutMl: ml(10000) }).optional(),
    note: text(2000),
    clientRequestId: requestId,
  })
  .refine((b) => !['dose', 'iv', 'task'].includes(b.kind) || b.orderId, { path: ['orderId'], message: "Choose one of the doctor's orders" })
  .refine((b) => b.kind !== 'dose' || DOSE_OUTCOMES.includes(b.outcome), { path: ['outcome'], message: 'Say whether it was given' })
  .refine((b) => b.kind !== 'task' || TASK_OUTCOMES.includes(b.outcome), { path: ['outcome'], message: 'Say whether it was done' })
  .refine((b) => !NEEDS_REASON.includes(b.outcome) || b.reason.length >= 3, { path: ['reason'], message: 'Say why (at least 3 characters)' })
  .refine((b) => b.kind !== 'iv' || b.iv, { path: ['iv.action'], message: 'Choose what was done' })
  .refine((b) => b.kind !== 'io' || Object.values(b.io ?? {}).some((v) => v != null), { path: ['io'], message: 'Enter at least one amount' })
  .refine((b) => b.kind !== 'handover' || b.note.length >= 5, { path: ['note'], message: 'Write the handover (at least 5 characters)' });

router.get('/station', async (req, res) => {
  res.json(await service.station(req, parse(z.object({ wardId: objectId.optional() }), req.query)));
});
router.get('/stays/:id', async (req, res) => {
  res.json(await service.stayCare(req, parse(stayParams, req.params).id));
});
router.post('/stays/:id/orders', async (req, res) => {
  res.status(201).json(await service.addOrder(req, parse(stayParams, req.params).id, parse(orderBody, req.body)));
});
router.post('/stays/:id/orders/:orderId/stop', async (req, res) => {
  const { id, orderId } = parse(z.object({ id: objectId, orderId: objectId }), req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300) }), req.body);
  res.json(await service.stopOrder(req, id, orderId, reason));
});
router.post('/stays/:id/chart', async (req, res) => {
  res.status(201).json(await service.chart(req, parse(stayParams, req.params).id, parse(chartBody, req.body)));
});

export default router;
