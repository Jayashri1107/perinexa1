import { Router } from 'express';
import * as controller from './masterData.controller.js';

// :type is one of config.masterData.types (department, speciality …).
const router = Router();

router.get('/:type', controller.list);
router.get('/:type/options', controller.options);
router.post('/:type', controller.create);
router.patch('/:type/:id', controller.update);
router.patch('/:type/:id/status', controller.setStatus);

export default router;
