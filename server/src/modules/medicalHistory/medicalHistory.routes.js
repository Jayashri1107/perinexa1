import { Router } from 'express';
import { z } from 'zod';
import { objectId, parse } from '../../core/validate.js';
import { medicalHistory } from './medicalHistory.service.js';

// GET /:patientId – her medical history (config.access.patientsClinical; checked again against her record).
const router = Router();
router.get('/:patientId', async (req, res) => {
  res.json(await medicalHistory(req, parse(z.object({ patientId: objectId }), req.params).patientId));
});

export default router;
