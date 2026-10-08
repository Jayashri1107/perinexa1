import { Router } from 'express';
import * as controller from './admission.controller.js';

// Doctors, RMOs and nurses (config.access.patientsClinical); each action is checked again in the service with the
// patient's record access.
const router = Router();

router.get('/', controller.inpatients);
router.get('/front-desk', controller.frontDesk);
router.post('/', controller.admit);
router.get('/patient/:patientId', controller.ofPatient);
router.get('/:admissionId', controller.get);
router.patch('/:admissionId/bed', controller.bed);
router.post('/:admissionId/documents', controller.newDocument);
router.put('/:admissionId/documents/:docId', controller.saveDocument);
router.post('/:admissionId/documents/:docId/sign', controller.signDocument);
router.post('/:admissionId/documents/:docId/cancel', controller.cancelDocument);
router.post('/:admissionId/documents/:docId/additions', controller.addToDocument);
router.post('/:admissionId/nursing', controller.addNursing);
router.post('/:admissionId/nursing/:entryId/cancel', controller.cancelNursing);

export default router;

// The pharmacist: who is in hospital, and issuing medicines to a stay.
export const wardIssueRouter = Router();
wardIssueRouter.get('/admitted', controller.admitted);
wardIssueRouter.post('/', controller.issue);
