import { Router } from 'express';
import * as service from './doctorDesk.service.js';

// The doctor's desk (doctors and RMOs; checked in the service): GET / – my patients, clinical alerts, pending reviews.
const router = Router();
router.get('/', async (req, res) => res.json(await service.desk(req)));

export default router;
