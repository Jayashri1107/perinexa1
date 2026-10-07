import { Router } from 'express';
import * as controller from './calendar.controller.js';

const router = Router();

router.get('/', controller.events);

export default router;
