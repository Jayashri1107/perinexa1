import { Router } from 'express';
import * as controller from './appointment.controller.js';

// Everyone in config.access.appointments may look; booking, moving and cancelling are checked in the service
// (config.access.bookAppointments), as are "seen" (clinical roles) and changing timings (own, or the admin).
const router = Router();

router.get('/doctors', controller.doctors);
router.get('/timings/:doctorId', controller.getTimings);
router.put('/timings/:doctorId', controller.saveTimings);
router.get('/day', controller.day);
router.get('/needs-time', controller.needsTime);
router.get('/patients', controller.patients);
router.get('/patient/:patientId', controller.forPatient);
router.get('/reminders', controller.reminders);
router.post('/', controller.book);
router.post('/tokens', controller.giveToken);
router.post('/:id/move', controller.move);
router.post('/:id/cancel', controller.cancel);
router.post('/:id/link', controller.link);
router.post('/:id/arrive', controller.arrive);
router.post('/:id/undo-arrival', controller.undoArrival);
router.post('/:id/seen', controller.markSeen);
router.post('/:id/reminder-sent', controller.reminderSent);

export default router;
