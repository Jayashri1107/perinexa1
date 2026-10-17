import { Router } from 'express';
import { dayStates } from '../appointments/appointmentService.js';
import { hospitalToday, timeIn } from '../careplans/dates.js';
import { Appointment } from '../models/Appointment.js';
import { LabOrder } from '../models/LabOrder.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { Visit } from '../models/Visit.js';
import { handoversToConfirm } from './cashHandover.js';

// "Your day" on a doctor's or RMO's Today (doctor ideas #9, 16 Oct 2026): counts only, of their own work today – the
// patients they saw, their visits not signed yet, the lab reports waiting for their review (their patients, or what
// they ordered), and high-risk patients booked with them today whose time has passed without them coming. A sense of
// finishing the day, and the loose ends to catch. No names here: each line links to the list that has them.

export const myDayRouter = Router(); // /api/my-day

myDayRouter.get('/', async (req, res) => {
  if (!hasRole(req.membership, 'doctor', 'rmo')) return res.json({ day: null });
  const me = req.user._id;
  const today = hospitalToday(req.now);
  const mine = { $or: [{ 'details.by': me }, { 'prescription.by': me }, { 'signed.by': me }, { createdBy: me }] };
  const [visits, toReview, booked] = await Promise.all([
    Visit.find({ tenantId: req.tenantId, visitOn: today, status: 'active', ...mine }, { patientId: 1, signed: 1 }).lean(),
    (async () => {
      const myPatients = await Patient.distinct('_id', { tenantId: req.tenantId, assignedDoctor: me });
      return LabOrder.countDocuments({ tenantId: req.tenantId, status: 'reported', $or: [{ patientId: { $in: myPatients } }, { 'ordered.by': me }] });
    })(),
    Appointment.find({ tenantId: req.tenantId, on: today, doctorId: me, kind: 'slot', status: 'booked', patientId: { $ne: null }, start: { $ne: null } }, { patientId: 1, start: 1, on: 1, status: 1 }).lean(),
  ]);
  // Booked with me today, the time passed (by 30 minutes), not come, and high risk
  const nowTime = timeIn(req.now);
  const late = booked.filter((a) => a.start && addMinutes(a.start, 30) <= nowTime);
  let missedHighRisk = 0;
  if (late.length) {
    const states = await dayStates(req.tenantId, late.map((a) => a.patientId), today);
    const notCome = late.filter((a) => {
      const s = states.get(String(a.patientId));
      return !s?.seen && !s?.arrivedAt;
    });
    missedHighRisk = notCome.length ? await Patient.countDocuments({ tenantId: req.tenantId, _id: { $in: notCome.map((a) => a.patientId) }, 'risk.level': 'high' }) : 0;
  }
  res.json({
    day: {
      seen: new Set(visits.map((v) => String(v.patientId))).size,
      notSigned: visits.filter((v) => !v.signed).length,
      labToReview: toReview,
      missedHighRisk,
      // Doctors: the cash handed over that waits for a confirmation (docs/WHATSAPP_DESK_PLAN.md)
      cashToConfirm: hasRole(req.membership, 'doctor') ? await handoversToConfirm(req.tenantId) : 0,
    },
  });
});

/** "10:20" + 30 → "10:50" (same day; past midnight stays "23:59"). */
function addMinutes(hhmm, n) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + n, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
