import { Router } from 'express';
import * as controller from './hospitalStaff.controller.js';

const router = Router();

router.get('/', controller.list);
router.post('/', controller.add);
router.patch('/:memberId/roles', controller.updateRoles);
router.patch('/:memberId/status', controller.setStatus);
router.post('/:memberId/reset-password', controller.resetPassword);

export default router;
