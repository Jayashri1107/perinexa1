import { Router } from 'express';
import { requireAuth, requirePasswordChanged } from '../../middleware/auth.js';
import { loginLimiter } from '../../middleware/rateLimiters.js';
import * as controller from './auth.controller.js';
import { recordRateLimited } from './auth.service.js';

// Public module: each address says itself whether a session is needed.
const router = Router();

router.post('/login', loginLimiter(recordRateLimited), controller.login);
router.post('/logout', controller.logout);
router.get('/me', requireAuth, controller.me);
router.post('/change-password', requireAuth, controller.changePassword);
router.post('/switch-hospital', requireAuth, requirePasswordChanged, controller.switchHospital);

export default router;
