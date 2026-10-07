import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './billingReports.controller.js';

// Unpaid and daily: everyone who bills. Monthly income and the export: the admin and the billing department
// (config.access.billingReports).
const router = Router();
const reportsOnly = requireRoles(config.access.billingReports);

router.get('/unpaid', controller.unpaid);
router.get('/daily', controller.daily);
router.get('/monthly', reportsOnly, controller.monthly);
router.get('/export', reportsOnly, controller.exportCsv);

export default router;
