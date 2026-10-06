import { Router } from 'express';
import * as controller from './pharmacyReports.controller.js';

const router = Router();

router.get('/alerts', controller.alerts);
router.get('/expiry', controller.expiry);
router.get('/value', controller.value);
router.get('/register', controller.register);
router.get('/sales', controller.sales);

export default router;
