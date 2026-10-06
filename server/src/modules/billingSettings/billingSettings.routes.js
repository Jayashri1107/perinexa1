import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './billingSettings.controller.js';

// Reception reads only the payee for UPI links; the admin reads and changes the settings and their history.
const router = Router();
const adminOnly = requireRoles(config.access.billingAdmin);

router.get('/payee', controller.payee);
router.get('/', adminOnly, controller.get);
router.put('/', adminOnly, controller.update);

export default router;
