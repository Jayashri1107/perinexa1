import { Router } from 'express';
import * as controller from './hospitalSettings.controller.js';

// The current hospital's settings (the hospital comes from the session).
const router = Router();

router.get('/', controller.get);
router.put('/:section', controller.updateSection);

export default router;
