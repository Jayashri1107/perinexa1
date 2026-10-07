import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './priceList.controller.js';

// Everyone who bills reads the price list; the hospital admin and the billing department change it
// (config.access.priceListEdit).
const router = Router();
const adminOnly = requireRoles(config.access.priceListEdit);

router.get('/', controller.list);
router.get('/options', controller.options);
router.post('/', adminOnly, controller.create);
router.patch('/:id', adminOnly, controller.update);
router.patch('/:id/status', adminOnly, controller.setStatus);

export default router;
