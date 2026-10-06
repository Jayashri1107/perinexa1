import { Router } from 'express';
import * as controller from './member.controller.js';

// Mounted at /hospitals/:hospitalId/members (see modules/index.js).
const router = Router({ mergeParams: true });

router.get('/', controller.list);
router.post('/', controller.add);
router.patch('/:memberId/roles', controller.updateRoles);
router.patch('/:memberId/status', controller.setStatus);

export default router;
