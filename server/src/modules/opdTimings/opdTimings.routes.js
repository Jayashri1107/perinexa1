import { Router } from 'express';
import * as controller from './opdTimings.controller.js';

const router = Router();

router.get('/', controller.list);
router.get('/:doctorId', controller.get);
router.put('/:doctorId', controller.save);

export default router;
