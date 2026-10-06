import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './pharmacySettings.controller.js';

const router = Router();

router.get('/', controller.get);
router.put('/', requireRoles(config.access.pharmacyAdmin), controller.update);

export default router;
