import { Router } from 'express';
import * as controller from './bill.controller.js';

const router = Router();

router.get('/', controller.list);
router.get('/patients', controller.patients);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.post('/:id/lines', controller.addLines);
router.post('/:id/lines/:lineId/remove', controller.removeLine);
router.put('/:id/discount', controller.discount);
router.post('/:id/cancel', controller.cancel);
router.post('/:id/payments', controller.payment);
router.post('/:id/refunds', controller.refund);

export default router;
