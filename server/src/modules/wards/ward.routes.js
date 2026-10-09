import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { objectId, parse } from '../../core/validate.js';
import { requireRoles } from '../../middleware/auth.js';
import { WARD_KINDS } from './ward.model.js';
import * as service from './ward.service.js';

// Wards and beds (config.access.wards: those who admit or move patients, and the hospital admin):
//  GET   /availability     active wards, each bed free or booked
//  GET   /                 every ward (hospital admin)
//  POST  /                 a new ward with a number of beds (hospital admin)
//  PATCH /:id              name, kind, floor, beds, in use or not (hospital admin)
const router = Router();
const adminOnly = requireRoles([config.adminRole]);

const name = z.string().trim().min(2, 'Name the ward').max(60);
const kind = z.enum(WARD_KINDS, 'Choose the kind of ward');
const floor = z.string().trim().max(30, 'A floor is at most 30 letters');
const bedLabel = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,20}$/, 'A bed is 1–20 letters or digits, e.g. G1');
const createBody = z.object({ name, kind, floor: floor.default(''), bedCount: z.coerce.number().int().min(1, 'At least 1 bed').max(200), bedPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{0,6}$/).default('') });
const updateBody = z.object({
  name: name.optional(),
  kind: kind.optional(),
  floor: floor.optional(),
  beds: z.array(z.object({ label: bedLabel, isActive: z.boolean().default(true) })).max(300).optional(),
  isActive: z.boolean().optional(),
});
const query = z.object({ exceptStayId: objectId.optional() });

router.get('/availability', async (req, res) => {
  res.json(await service.availability(req, parse(query, req.query)));
});
router.get('/', adminOnly, async (req, res) => {
  res.json(await service.listWards(req.hospitalId));
});
router.post('/', adminOnly, async (req, res) => {
  res.status(201).json(await service.createWard(req, parse(createBody, req.body)));
});
router.patch('/:id', adminOnly, async (req, res) => {
  res.json(await service.updateWard(req, parse(z.object({ id: objectId }), req.params).id, parse(updateBody, req.body)));
});

export default router;
