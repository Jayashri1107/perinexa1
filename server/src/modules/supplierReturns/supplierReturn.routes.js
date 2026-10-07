import { Router } from 'express';
import * as controller from './supplierReturn.controller.js';

// Everyone with pharmacy access reads; the pharmacist returns and cancels – checked in the service.
const router = Router();

router.get('/', controller.list);
router.get('/batches/:supplierId', controller.batches);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.post('/:id/cancel', controller.cancel);

export default router;
