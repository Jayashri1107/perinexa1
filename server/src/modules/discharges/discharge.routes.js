import { Router } from 'express';
import { z } from 'zod';
import { objectId, optional, parse } from '../../core/validate.js';
import * as service from './discharge.service.js';

// Signed discharge cards (config.access.dischargeCards; each card is checked again against her record):
//  GET /            recent discharges (?days=30), or ?search= by name or patient number
//  GET /:cardId     one signed discharge card with the letterhead, for printing or saving as PDF
const router = Router();

const listQuery = z.object({ search: z.string().trim().max(120).default(''), days: optional(z.coerce.number().int().min(1).max(366)) });
const cardParams = z.object({ cardId: objectId });

router.get('/', async (req, res) => {
  res.json(await service.recentDischarges(req, parse(listQuery, req.query)));
});
router.get('/:cardId', async (req, res) => {
  res.json(await service.dischargeCard(req, parse(cardParams, req.params).cardId));
});

export default router;
