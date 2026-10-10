import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { objectId, optionalText, parse } from '../../core/validate.js';
import { requireRoles } from '../../middleware/auth.js';
import * as service from './pregnancy.service.js';

// A pregnancy's scans and vaccinations, the pregnancy card and the check-ups due (pregnancy.service.js):
//  GET  /patients/:patientId                    her scans and vaccinations, with the card's details (clinical)
//  POST /patients/:patientId/items/:key/done    { on, note } – done on that day (her doctor, an RMO or a nurse)
//  POST /patients/:patientId/items/:key/undo    { reason } – recorded by mistake
//  GET  /reminders?from=YYYY-MM-DD              the check-ups due in that week (Calendar)
//  POST /reminders/:patientId/sent              { keys } – the reminder was sent
const router = Router();
const clinical = requireRoles(config.access.patientsClinical);
const calendar = requireRoles(config.access.calendar);

const itemParams = z.object({ patientId: objectId, key: z.string().trim().min(2).max(80) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const doneBody = z.object({ on: day, note: optionalText(500) });
const undoBody = z.object({ reason: z.string().trim().min(3, 'Say why (at least 3 letters)').max(300) });
const remindersQuery = z.object({ from: day.optional() });
const sentBody = z.object({ keys: z.array(z.string().trim().min(2).max(80)).min(1).max(30) });

router.get('/patients/:patientId', clinical, async (req, res) => {
  res.json(await service.getCard(req, parse(z.object({ patientId: objectId }), req.params).patientId));
});
router.post('/patients/:patientId/items/:key/done', clinical, async (req, res) => {
  const { patientId, key } = parse(itemParams, req.params);
  res.json(await service.markDone(req, patientId, key, parse(doneBody, req.body)));
});
router.post('/patients/:patientId/items/:key/undo', clinical, async (req, res) => {
  const { patientId, key } = parse(itemParams, req.params);
  res.json(await service.undoDone(req, patientId, key, parse(undoBody, req.body)));
});
router.get('/reminders', calendar, async (req, res) => {
  res.json(await service.reminders(req, parse(remindersQuery, req.query)));
});
router.post('/reminders/:patientId/sent', calendar, async (req, res) => {
  res.json(await service.markReminded(req, parse(z.object({ patientId: objectId }), req.params).patientId, parse(sentBody, req.body).keys));
});

export default router;
