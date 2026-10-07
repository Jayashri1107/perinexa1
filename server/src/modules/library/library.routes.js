import { Router } from 'express';
import * as controller from './library.controller.js';

// Everyone in config.access.library reads; editing (libraryEdit) and approving (libraryApprove) are checked in the
// service.
const router = Router();

router.get('/summary', controller.summary);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.put('/:id', controller.update);
router.post('/:id/approve', controller.approve);
router.patch('/:id/status', controller.setStatus);
router.post('/:id/duplicate', controller.duplicate);

export default router;
