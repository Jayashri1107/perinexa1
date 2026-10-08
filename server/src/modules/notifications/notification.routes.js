import { Router } from 'express';
import { z } from 'zod';
import { objectId, parse } from '../../core/validate.js';
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
  res.json(await service.markAllRead(req));
});
router.post('/:id/read', async (req, res) => {
  res.json(await service.markRead(req, parse(z.object({ id: objectId }), req.params).id));
});

export default router;
