import { Router } from 'express';
import { z } from 'zod';
import { objectId, parse } from '../../core/validate.js';
import { NOTIFICATION_TYPES } from './notification.model.js';
import * as service from './notification.service.js';

// Everyone working in a hospital – each person sees only their own notifications:
//  GET  /            the latest, and how many are unread
//  POST /:id/read    mark one as read
//  POST /read-all    mark all as read
const router = Router();

router.get('/', async (req, res) => {
  res.json(await service.myNotifications(req));
});
router.post('/read-all', async (req, res) => {
  const { types } = parse(z.object({ types: z.array(z.enum(NOTIFICATION_TYPES)).max(30).default([]) }), req.body ?? {});
  res.json(await service.markAllRead(req, types));
});
router.post('/:id/read', async (req, res) => {
  res.json(await service.markRead(req, parse(z.object({ id: objectId }), req.params).id));
});

export default router;
