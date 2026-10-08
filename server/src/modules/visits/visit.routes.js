import { Router } from 'express';
import * as controller from './visit.controller.js';

// Doctors, RMOs and nurses (config.access.patientsClinical); each part is checked again in the service with the
// patient's record access.
const router = Router();

router.get('/sets', controller.sets);
router.get('/patient/:patientId', controller.list);
router.post('/patient/:patientId', controller.start);
router.get('/patient/:patientId/:visitId', controller.get);
router.put('/patient/:patientId/:visitId/vitals', controller.vitals);
router.put('/patient/:patientId/:visitId/details', controller.details);
router.put('/patient/:patientId/:visitId/prescription', controller.prescription);
router.post('/patient/:patientId/:visitId/sign', controller.sign);
router.post('/patient/:patientId/:visitId/cancel', controller.cancel);
router.post('/patient/:patientId/:visitId/additions', controller.addition);
router.post('/patient/:patientId/:visitId/send-to-pharmacy', controller.sendToPharmacy);

export default router;

// The pharmacy's view (pharmacists at the counter): the prescriptions doctors sent (waiting, and given today), marking
// one given, and a patient's latest prescriptions to sell from (medicines only).
export const pharmacyPrescriptionRouter = Router();
pharmacyPrescriptionRouter.get('/queue', controller.pharmacyQueue);
pharmacyPrescriptionRouter.post('/queue/:visitId/given', controller.markGiven);
pharmacyPrescriptionRouter.get('/:patientId', controller.forPharmacy);
