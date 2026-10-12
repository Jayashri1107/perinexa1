import { Router } from 'express';
import { Tenant } from '../models/Tenant.js';
import { HttpError } from '../utils/httpError.js';
import { queuesOf } from './appointments.js';
import { letterheadFor } from './settings.js';

// The waiting-room screen (/api/display/:key – no staff login, for a TV in the waiting room). Off until the hospital
// admin switches it on (Hospital admin → Patient messages); the address holds a secret only the admin sees, and a
// new address makes the old one stop working. Deliberately says very little, because anyone in the room reads it:
// each doctor's name, who goes in next and after – as a token number or an appointment time, NEVER a name, a
// patient number or why someone came – and how many are waiting.

export const displayRouter = Router();

const SHOWN_AFTER_NEXT = 4;
// How a waiting patient is shown: her walk-in token, or the time of her appointment.
const label = (v) => (v.kind === 'token' ? { kind: 'token', token: v.token } : { kind: 'time', start: v.start ?? null });

displayRouter.get('/:key', async (req, res) => {
  const key = String(req.params.key ?? '');
  const tenant = /^[a-f0-9]{32}$/.test(key) ? await Tenant.findOne({ 'messaging.displayKey': key, isActive: true }) : null;
  if (!tenant) throw new HttpError(404, 'This screen is switched off. Ask the hospital admin for the new address.', 'NOT_FOUND');
  const { today, now, queues } = await queuesOf(tenant._id, req.now);
  res.json({
    hospital: letterheadFor(tenant).name,
    today,
    now,
    doctors: queues.map((q) => ({
      name: q.doctor.name,
      next: q.waiting[0] ? label(q.waiting[0]) : null,
      then: q.waiting.slice(1, 1 + SHOWN_AFTER_NEXT).map(label),
      waiting: q.waiting.length,
    })),
  });
});
