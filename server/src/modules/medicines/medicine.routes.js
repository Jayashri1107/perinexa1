import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './medicine.controller.js';

// The pharmacist keeps the medicine list; the admin can read it.
const router = Router();
const counter = requireRoles(config.access.pharmacyCounter);

router.get('/', controller.list);
router.get('/options', controller.options);
router.post('/', counter, controller.create);
router.patch('/:id', counter, controller.update);
router.patch('/:id/status', counter, controller.setStatus);

export default router;
