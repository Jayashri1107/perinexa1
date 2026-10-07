import { Router } from 'express';
import * as controller from './purchaseOrder.controller.js';

// Everyone with pharmacy access reads; the pharmacist (config.access.pharmacyCounter) changes – checked in the service.
const router = Router();

router.get('/', controller.list);
router.get('/suggest', controller.suggest);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.put('/:id', controller.update);
router.post('/:id/send', controller.send);
router.post('/:id/cancel', controller.cancel);
router.post('/:id/close', controller.close);

export default router;
