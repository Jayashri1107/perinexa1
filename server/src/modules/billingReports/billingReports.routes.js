import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './billingReports.controller.js';

// Unpaid and daily: reception and admin. Monthly income and the export: admin only.
const router = Router();
const adminOnly = requireRoles(config.access.billingAdmin);

router.get('/unpaid', controller.unpaid);
router.get('/daily', controller.daily);
router.get('/monthly', adminOnly, controller.monthly);
router.get('/export', adminOnly, controller.exportCsv);

export default router;
