import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './sale.controller.js';

// The pharmacist sells and takes returns; the admin can read the sales.
const router = Router();
const counter = requireRoles(config.access.pharmacyCounter);

router.get('/', controller.list);
router.get('/patients', counter, controller.patients);
router.post('/', counter, controller.create);
router.get('/:id', controller.get);
router.post('/:id/returns', counter, controller.returnItems);

export default router;
