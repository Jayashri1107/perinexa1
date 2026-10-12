import { Router } from 'express';
import {
  addCustomItem,
  applyItemAction,
  applyTemplate,
  changeBookingDate,
  closeCarePlan,
  decideEdd,
  getCarePlan,
  planCtx,
  previewTemplate,
  recordPrint,
  reopenCarePlan,
  startCarePlan,
  templateOptions,
} from '../careplans/plansService.js';
import {
  bookingDateSchema,
  closeSchema,
  customItemSchema,
  eddDecisionSchema,
  itemActionSchema,
  itemParamsSchema,
  previewQuerySchema,
  printedSchema,
  reopenSchema,
  templateChangeSchema,
  viewQuerySchema,
} from '../careplans/planSchemas.js';
import { idParams, parse } from '../utils/validate.js';

// A patient's care plan: /api/patients/:id/care-plan. Mounted inside the patients router, after its role
// gate, so only patient-facing staff get here. mergeParams lets these routes read the patient id (:id).
//
// Each route only checks what the browser sent (strict schemas: an unknown field such as "fetalSex" is
// refused, and free text is checked for words about the baby's sex). Everything else happens in the
// care-plan service: finding the patient in this hospital, who may see or change the plan, keeping the plan
// in step with the patient, and the audit entries (ids only). Nothing is audited here, so nothing twice.

export const carePlanRouter = Router({ mergeParams: true });

// The patient id from the URL (400 for anything that is not an id).
const patientId = (req) => parse(idParams, req.params).id;

// The current plan (built on first view), or ?planId= one of this patient's earlier plans (read-only).
carePlanRouter.get('/', async (req, res) => {
  const { planId } = parse(viewQuerySchema, req.query);
  res.json(await getCarePlan(planCtx(req), patientId(req), { planId: planId ?? null }));
});

// Gynaecology and infertility: a doctor or RMO starts the plan (postnatal and newborn plans start by themselves).
carePlanRouter.post('/start', async (req, res) => {
  res.status(201).json(await startCarePlan(planCtx(req), patientId(req)));
});

// Plan-level changes (active plan only; a paused plan answers 409 PLAN_PAUSED, except Close).
carePlanRouter.patch('/', async (req, res) => {
  const body = parse(bookingDateSchema, req.body);
  res.json(await changeBookingDate(planCtx(req), patientId(req), body));
});

carePlanRouter.get('/template-options', async (req, res) => {
  res.json(await templateOptions(planCtx(req), patientId(req)));
});

carePlanRouter.get('/template-preview', async (req, res) => {
  const { templateId } = parse(previewQuerySchema, req.query);
  res.json(await previewTemplate(planCtx(req), patientId(req), templateId));
});

carePlanRouter.put('/template', async (req, res) => {
  const body = parse(templateChangeSchema, req.body);
  res.json(await applyTemplate(planCtx(req), patientId(req), body));
});

carePlanRouter.post('/edd-decision', async (req, res) => {
  const body = parse(eddDecisionSchema, req.body);
  res.json(await decideEdd(planCtx(req), patientId(req), body));
});

carePlanRouter.post('/close', async (req, res) => {
  const body = parse(closeSchema, req.body);
  res.json(await closeCarePlan(planCtx(req), patientId(req), body));
});

// A patient copy or staff copy was printed (recorded in the audit log only).
carePlanRouter.post('/printed', async (req, res) => {
  const body = parse(printedSchema, req.body);
  res.json(await recordPrint(planCtx(req), patientId(req), body));
});

carePlanRouter.post('/reopen', async (req, res) => {
  const body = parse(reopenSchema, req.body);
  res.json(await reopenCarePlan(planCtx(req), patientId(req), body));
});

// A doctor adds an item. 201 when it was added; 200 when the same request (clientRequestId) was already
// saved, for example after a double click or a retry on a slow connection.
carePlanRouter.post('/items', async (req, res) => {
  const body = parse(customItemSchema, req.body);
  const { created, body: out } = await addCustomItem(planCtx(req), patientId(req), body);
  res.status(created ? 201 : 200).json(out);
});

// One action on one item (done, reopen, not needed, move …). Every body carries the item's rev.
carePlanRouter.patch('/items/:itemId', async (req, res) => {
  const { itemId } = parse(itemParamsSchema, req.params);
  const intent = parse(itemActionSchema, req.body);
  res.json(await applyItemAction(planCtx(req), patientId(req), itemId, intent));
});
