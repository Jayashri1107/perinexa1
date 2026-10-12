// Recording a death on a record, what follows it, and undoing one recorded in error (the rules and the words are in
// deathRules.js). Every query carries the hospital's tenantId.
//
// SAFETY: nothing is deleted. Closing a record cancels what would otherwise reach the family – her booked
// appointments from today on (no cancellation message is sent), the messages still waiting, her portal access. It
// never touches her notes, her bills or her stay in hospital: a stay is ended by the doctor's discharge card.

import { cancelAppointment } from '../appointments/appointmentService.js';
import { dateWords, hospitalToday, isoDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { NursingEntry } from '../models/NursingEntry.js';
import { Patient } from '../models/Patient.js';
import { PortalAccess } from '../models/PortalAccess.js';
import { ReminderMessage } from '../models/ReminderMessage.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { CLOSED_CANCEL_REASON, CLOSED_MESSAGE_REASON, IN_USE, ageInDays } from './deathRules.js';

const who = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
const WAITING_MESSAGES = ['queued', 'to_send', 'failed'];
const subject = (patient) => (patient.careType === 'newborn' ? 'The baby' : 'She');

// Nursing chart entries that cannot come after a death: vital signs measured and a medicine given. (A nurse's note
// can – for example that the body was handed over – so a note never stops a death being recorded.)
const LIVING_CHART_KINDS = ['vitals', 'medicine'];

/**
 * Why this day cannot be the day of death – { field: message } (empty when it can). The day is a date only.
 *  - not in the future (the hospital's date);
 *  - a baby: not before the day of birth;
 *  - not before something recorded for her as having happened later: a visit that is not marked entered in error, an
 *    admission, or vital signs or a medicine on the nursing chart (the date is then wrong, or the death – or that
 *    entry – is on the wrong record: a mother and her baby in the ward at the same time).
 */
export async function deathDayProblems(req, patient, on) {
  const day = utcDay(on);
  const today = hospitalToday(req.now);
  if (day > today) return { on: 'The date cannot be in the future.' };
  const baby = patient.careType === 'newborn';
  if (baby && patient.newborn?.birthAt && day < toHospitalDate(patient.newborn.birthAt)) return { on: `The date cannot be before the day of birth (${dateWords(toHospitalDate(patient.newborn.birthAt))}).` };
  const tenantId = req.tenantId;
  const [visit, stay, chart] = await Promise.all([
    Visit.findOne({ tenantId, patientId: patient._id, status: 'active', visitOn: { $gt: day } }, { visitOn: 1 }).sort({ visitOn: -1 }).lean(),
    Admission.findOne({ tenantId, patientId: patient._id }, { admittedAt: 1 }).sort({ admittedAt: -1 }).lean(),
    NursingEntry.findOne({ tenantId, patientId: patient._id, cancelled: null, kind: { $in: LIVING_CHART_KINDS } }, { at: 1, kind: 1 }).sort({ at: -1 }).lean(),
  ]);
  if (visit) return { on: `A visit is recorded on ${dateWords(visit.visitOn)}, after this date. Check the date – or, if that visit is on the wrong record, mark it as entered in error first.` };
  if (stay && toHospitalDate(stay.admittedAt) > day) return { on: `${subject(patient)} was admitted on ${dateWords(toHospitalDate(stay.admittedAt))}, after this date. Please check the date.` };
  if (chart && toHospitalDate(chart.at) > day) {
    const what = chart.kind === 'medicine' ? 'A medicine given' : 'Vital signs';
    return { on: `${what} on ${dateWords(toHospitalDate(chart.at))} ${chart.kind === 'medicine' ? 'is' : 'are'} on the nursing chart of this record, after this date. Check the date and that this is the right record – or, if that entry is on the wrong record, mark it as entered in error first.` };
  }
  return {};
}

/**
 * Records the death on the record (already checked: this hospital, a doctor who may change the record, not a
 * duplicate, not closed yet, the day is possible). Only the record itself is saved here; closeRecord does the rest.
 * body: { on, place } for a baby, { on, timing } for everyone else.
 */
export async function recordDeath(req, patient, body) {
  const baby = patient.careType === 'newborn';
  const on = utcDay(body.on);
  patient.death = {
    on,
    place: baby ? body.place : null,
    timing: baby ? null : body.timing,
    ageDays: baby && patient.newborn?.birthAt ? ageInDays(toHospitalDate(patient.newborn.birthAt), on) : null,
    ...who(req),
  };
  await patient.save();
}

/**
 * What follows a death being recorded – safe to run again (a closing that was cut off half-way is finished by
 * pressing the button again). `progress` is kept up to date as it goes, for the audit entry also when a later step
 * fails. Returns { appointmentsCancelled, messagesCancelled, portalEnded, inHospital, babies }:
 *  - her booked appointments from today on are cancelled, with no message to the family (a fee taken in advance
 *    comes off her bill and shows as due back, as for every cancelled appointment);
 *  - the messages still waiting for her are cancelled (the outbox keeps them, with "Record closed");
 *  - her portal access ends;
 *  - inHospital: she has a stay that is still open (the discharge card ends it – nothing is done to it here);
 *  - babies: the records of her babies that are still in use ([{ id, mrn }]) – their reminders go on, to the
 *    number on the baby's own record, so the doctor is told to look at them. Never for a baby's own record.
 */
export async function closeRecord(req, patient, progress = { appointmentsCancelled: 0, messagesCancelled: 0, portalEnded: 0 }) {
  const tenantId = req.tenantId;
  const today = hospitalToday(req.now);
  const ahead = await Appointment.find({ tenantId, patientId: patient._id, status: 'booked', on: { $gte: today } });
  for (const appt of ahead) {
    await cancelAppointment(req, appt, CLOSED_CANCEL_REASON, { message: false });
    progress.appointmentsCancelled += 1;
  }
  const messages = await ReminderMessage.updateMany({ tenantId, patientId: patient._id, status: { $in: WAITING_MESSAGES } }, { $set: { status: 'cancelled', error: CLOSED_MESSAGE_REASON } });
  progress.messagesCancelled += messages.modifiedCount ?? 0;
  const portal = await PortalAccess.updateMany({ tenantId, patientId: patient._id, revoked: null }, { $set: { revoked: who(req) } });
  progress.portalEnded += portal.modifiedCount ?? 0;

  const [stay, babies] = await Promise.all([
    Admission.exists({ tenantId, patientId: patient._id, status: 'admitted' }),
    patient.careType === 'newborn' ? [] : Patient.find({ tenantId, 'newborn.mother': patient._id, ...IN_USE }, { mrn: 1 }).sort({ createdAt: 1 }).lean(),
  ]);
  return { ...progress, inHospital: Boolean(stay), babies: babies.map((b) => ({ id: String(b._id), mrn: b.mrn })) };
}

/**
 * Undoes a death recorded in error: the record is in use again, and the entry is kept in the record's history with
 * the reason. Nothing that the closing cancelled is brought back by itself – the appointments, the messages and the
 * portal access. A cancelled appointment may have had its fee taken off the bill, and its time may have been given
 * to someone else meanwhile: so the appointments that the closing cancelled and that are still ahead are LISTED, for
 * reception to book again on the Appointments tab if they are still wanted. The next reminder round queues what is
 * still true; a new portal code is made when she asks.
 * Returns { appointmentsToRebook: [{ date, start, doctorName }] }.
 */
export async function undoDeath(req, patient, reason) {
  const tenantId = req.tenantId;
  const today = hospitalToday(req.now);
  const was = patient.death;
  patient.deathHistory.push({ on: was.on, place: was.place ?? null, timing: was.timing ?? null, byName: was.byName, at: was.at, undoneReason: reason, undoneByName: req.user.name, undoneAt: req.now ?? new Date() });
  patient.death = null;
  await patient.save();
  // Only those cancelled by THIS closing (from the moment the death was recorded): an appointment cancelled by an
  // earlier closing that was undone was listed then, and may have been booked again since.
  const cancelled = await Appointment.find(
    { tenantId, patientId: patient._id, status: 'cancelled', 'cancelled.reason': CLOSED_CANCEL_REASON, 'cancelled.at': { $gte: was.at }, on: { $gte: today } },
    { on: 1, start: 1, doctorId: 1 },
  )
    .sort({ on: 1, start: 1 })
    .limit(50)
    .lean();
  const doctorIds = [...new Set(cancelled.map((a) => String(a.doctorId)))];
  const names = new Map((doctorIds.length ? await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean() : []).map((u) => [String(u._id), u.name]));
  return { appointmentsToRebook: cancelled.map((a) => ({ date: isoDay(a.on), start: a.start ?? null, doctorName: names.get(String(a.doctorId)) ?? null })) };
}
