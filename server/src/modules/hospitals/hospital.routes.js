import { Router } from 'express';
import * as controller from './hospital.controller.js';

const router = Router();

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/options', controller.options);
router.get('/:id', controller.get);
router.patch('/:id', controller.update);
router.patch('/:id/status', controller.setStatus);

export default router;
