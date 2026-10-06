import { Router } from 'express';
import * as controller from './analytics.controller.js';

const router = Router();

router.get('/', controller.summary);

export default router;
