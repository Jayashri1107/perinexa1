import { Router } from 'express';
import { nextAppointment } from '../appointments/appointmentService.js';
import { hospitalToday } from '../careplans/dates.js';
import { patientWords, planCtx, reminderItems } from '../careplans/plansService.js';
import { hasRole } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { Visit } from '../models/Visit.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientForPlan } from '../utils/patientLookup.js';
import { refuseNewOnClosed } from '../patients/deathRules.js';

// A follow-up reminder to the patient (Smart features, step 3): /api/patients/:id/reminder. What the message
// needs – her name and phone, the next appointment (the date the doctor set at the latest visit), the next
// visit and the tests or medicines due in the care plan, and the hospital's name and phone. The message itself
// is written in the browser, in English, Marathi or Hindi; staff copy it and send it from their own WhatsApp
// or phone – nothing is sent automatically and nothing about the patient goes into a web address.
// For doctors, RMOs and nurses who may see the medical details. Audited as REMINDER_PREPARED (ids only).
// The care-plan items come from pregnancy care and from pregnancy-loss care (5 Oct 2026: no automatic message goes
// out from a pregnancy-loss plan, so staff prepare one themselves from Today's care-plan list; the message uses the
// items' words for the patient, which never name the loss – client/src/pages/reminders/reminderText.js).
const PLAN_CARE_TYPES = ['antenatal', 'abortion'];
// Pregnancy-loss care: the answer carries only words the patient may read – an item's staff name can name the loss
// (the message never uses it), so it is replaced by her words, and the next visit's by nothing.
function patientWordsOnly(plan) {
  if (!plan) return plan;
  const item = (it) => ({ ...it, name: patientWords(it, 'abortion') });
  return { ...plan, nextVisit: plan.nextVisit ? { ...plan.nextVisit, name: '' } : null, overdue: plan.overdue.map(item), due: plan.due.map(item) };
}

const ROLES = ['doctor', 'rmo', 'nurse'];
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');

export const remindersRouter = Router({ mergeParams: true });

remindersRouter.get('/', async (req, res) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('Reminders are prepared by doctors, RMOs and nurses.');
  const patient = await loadPatientForPlan(req);
  const access = patientAccess(req, patient);
  if (!access.view.has('pregnancy') || !access.view.has('phone')) throw forbidden("You can't prepare reminders for this patient.");
  refuseNewOnClosed(patient, 'message'); // a record closed after a death gets no message of any kind

  const today = hospitalToday(req.now);
  const [next, tenant, plan] = await Promise.all([
    nextAppointment(req.tenantId, patient._id, today),
    Tenant.findById(req.tenantId, 'name letterhead.name letterhead.phone').lean(),
    PLAN_CARE_TYPES.includes(patient.careType) ? reminderItems(planCtx(req), patient) : null,
  ]);
  const appointment = next?.date ?? null;
  const planWords = patient.careType === 'abortion' ? patientWordsOnly(plan) : plan;

  await audit(req, 'REMINDER_PREPARED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  res.json({
    today,
    patient: { id: String(patient._id), fullName: patient.fullName, phone: patient.phone ?? '', careType: patient.careType },
    hospital: { name: tenant?.letterhead?.name || tenant?.name || '', phone: tenant?.letterhead?.phone ?? '' },
    appointment,
    appointmentTime: next?.start ?? null,
    appointmentDoctor: next?.doctorName ?? null,
    plan: planWords,
  });
});
