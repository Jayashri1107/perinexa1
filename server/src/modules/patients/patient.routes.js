import { Router } from 'express';
import { config } from '../../config/index.js';
import { requireRoles } from '../../middleware/auth.js';
import * as controller from './patient.controller.js';

// Everyone with patient work (config.access.patients) may use this module; what each sees is decided per record.
const router = Router();
const canRegister = requireRoles(config.access.registerPatients);

router.get('/', controller.list);
router.get('/doctors', controller.doctors);
router.get('/pincode/:pin', controller.pincode);
router.get('/duplicates', canRegister, controller.duplicates);
router.post('/', canRegister, controller.register);
router.get('/:id', controller.get);
router.patch('/:id/contact', controller.updateContact);
router.patch('/:id/clinical', controller.updateClinical);
router.patch('/:id/status', controller.setStatus);
router.post('/:id/emergency-access', controller.emergencyAccess);

export default router;
