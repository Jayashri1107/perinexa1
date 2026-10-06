import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './purchase.controller.js';

const router = Router();

router.get('/', controller.list);
router.get('/:id', controller.get);
router.post('/', requireRoles(config.access.pharmacyCounter), controller.create);

export default router;
