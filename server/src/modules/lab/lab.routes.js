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
// sample tracking and the lab's overview (lab staff, 9 Oct 2026)
router.get('/dashboard', controller.dashboard);
router.post('/orders/:id/receive', controller.receive);
router.post('/orders/:id/process', controller.process);
router.post('/orders/:id/reject', controller.reject);
router.post('/orders/:id/query', controller.query);
router.put('/orders/:id/results', controller.results);
router.post('/orders/:id/review', controller.review);
router.post('/orders/:id/cancel', controller.cancel);

export default router;

// Reception books lab tests (config.access.registrationMenu; owner, 8 Oct 2026):
//  GET  /tests   the tests and packages to choose from
//  POST /        book tests for a registered patient – straight to the lab's worklist
export const labBookingRouter = Router();
labBookingRouter.get('/tests', controller.bookingCatalogue);
labBookingRouter.post('/', controller.book);
