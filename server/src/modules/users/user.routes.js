import { Router } from 'express';
import * as controller from './user.controller.js';

const router = Router();

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.patch('/:id', controller.update);
router.patch('/:id/status', controller.setStatus);
router.post('/:id/reset-password', controller.resetPassword);

export default router;
