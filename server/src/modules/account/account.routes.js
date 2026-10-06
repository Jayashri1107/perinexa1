import { Router } from 'express';
import * as controller from './account.controller.js';

// The logged-in person's own settings.
const router = Router();

router.get('/', controller.get);
router.put('/professional', controller.updateProfessional);
router.put('/appearance', controller.updateAppearance);

export default router;
