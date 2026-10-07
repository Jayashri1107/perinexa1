import { Router } from 'express';
import * as controller from './lab.controller.js';

// Everyone in config.access.lab; ordering (labOrder), entering results (labReport) and reviewing (labReview) are
// checked in the service, together with the patient's record access.
const router = Router();

router.get('/tests', controller.catalogue);
router.get('/orders', controller.list);
router.post('/orders', controller.create);
router.get('/patient/:patientId', controller.forPatient);
router.get('/orders/:id', controller.get);
router.post('/orders/:id/collect', controller.collect);
router.put('/orders/:id/results', controller.results);
router.post('/orders/:id/review', controller.review);
router.post('/orders/:id/cancel', controller.cancel);

export default router;
