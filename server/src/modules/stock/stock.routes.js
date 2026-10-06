import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './stock.controller.js';

const router = Router();

router.get('/', controller.list);
router.get('/:medicineId/batches', controller.batches);
router.post('/batches/:batchId/adjust', requireRoles(config.access.pharmacyCounter), controller.adjust);

export default router;
