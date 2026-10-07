// The calendar (as in Perinexa): booked appointments, due dates (EDD) and last periods (LMP) by day, week and month.
// Reception sees booked appointments only; pregnancy dates are for doctors and RMOs (config.access.calendarClinical),
// and only for records they may read clinically (sensitive records: her doctor and RMOs). Every entry is built
// field by field, so nothing else from a record can slip into the answer.
import { config } from '../../config/index.js';
import { todayLocal } from '../../core/dates.js';
import { HttpError } from '../../core/httpError.js';
import { toObjectId } from '../../core/validate.js';
import { Appointment } from '../appointments/appointment.model.js';
import { statusOf } from '../appointments/appointment.service.js';
import { addDays, isoDay, utcDay } from '../appointments/slots.js';
import { Patient } from '../patients/patient.model.js';
import { atLeast, listVisibility, recordLevel } from '../patients/patientAccess.js';
import { User } from '../users/user.model.js';

const { access } = config;
const DOCTOR = config.opd.doctorRole;
const DAY = 86400000;
export const EVENT_TYPES = ['booked', 'edd', 'lmp'];
const PREGNANCY_TYPES = ['edd', 'lmp'];
const MAX_ROWS = 5000;
const has = (req, list) => req.membership.roles.some((r) => list.includes(r));

// Weeks and days of pregnancy on a day, from the EDD (day 0 = EDD − 280 days).
function gaOn(edd, day) {
  const days = Math.floor((utcDay(day) - (utcDay(edd) - config.patients.eddDays * DAY)) / DAY);
  return days >= 0 ? { weeks: Math.floor(days / 7), days: days % 7 } : null;
}

export async function events(req, { from, to, scope, types }) {
  const start = utcDay(from);
  const end = utcDay(to);
  if (end < start) throw new HttpError(400, 'The end of the range is before its start.', 'RANGE');
  if ((end - start) / DAY + 1 > config.calendar.maxRangeDays) throw new HttpError(400, `Show at most ${config.calendar.maxRangeDays} days at once.`, 'RANGE');

  const clinical = has(req, access.calendarClinical);
  const isDoctor = req.membership.roles.includes(DOCTOR);
  const allowed = clinical ? EVENT_TYPES : ['booked'];
  const wanted = (types?.length ? types : allowed).filter((t) => allowed.includes(t));
  const mine = isDoctor && scope === 'mine';
  const hid = toObjectId(req.hospitalId);
  const out = [];
  let incomplete = false;

  if (wanted.includes('booked')) {
    const appts = await Appointment.find({
      hospitalId: hid,
      on: { $gte: start, $lte: end },
      status: { $ne: 'cancelled' },
      ...(mine && { doctorId: req.user._id }),
    })
      .sort({ on: 1, start: 1, token: 1 })
      .limit(MAX_ROWS)
      .lean();
    if (appts.length === MAX_ROWS) incomplete = true;
    const pids = [...new Set(appts.map((a) => a.patientId && String(a.patientId)).filter(Boolean))];
    const dids = [...new Set(appts.map((a) => String(a.doctorId)))];
    const [patients, doctors] = await Promise.all([
      Patient.find({ hospitalId: hid, _id: { $in: pids } }).select('patientNumber name').lean(),
      User.find({ _id: { $in: dids } }).select('name').lean(),
    ]);
    const pMap = new Map(patients.map((p) => [String(p._id), p]));
    const dMap = new Map(doctors.map((d) => [String(d._id), d.name]));
    const todayDay = utcDay(todayLocal());
    for (const a of appts) {
      const p = a.patientId ? pMap.get(String(a.patientId)) : null;
      out.push({
        id: `booked:${a._id}`,
        type: 'booked',
        date: isoDay(a.on),
        start: a.start ?? null,
        token: a.token ?? null,
        status: statusOf(a, todayDay),
        doctor: dMap.get(String(a.doctorId)) ?? 'Doctor',
        patient: p ? { id: String(p._id), name: p.name, patientNumber: p.patientNumber } : { id: null, name: a.guest?.name ?? '', patientNumber: '' },
      });
    }
  }

  const pregnancyTypes = wanted.filter((t) => PREGNANCY_TYPES.includes(t));
  if (pregnancyTypes.length) {
    const or = [];
    if (pregnancyTypes.includes('edd')) or.push({ edd: { $gte: start, $lt: addDays(end, 1) } });
    if (pregnancyTypes.includes('lmp')) or.push({ lmp: { $gte: start, $lt: addDays(end, 1) } });
    const visibility = listVisibility(req);
    const patients = await Patient.find({
      hospitalId: hid,
      status: 'active',
      $and: [{ $or: or }, ...(visibility.$or ? [{ $or: visibility.$or }] : []), ...(visibility.isSensitive === false ? [{ isSensitive: false }] : [])],
      ...(mine && { assignedDoctorId: req.user._id }),
    })
      .select('patientNumber name lmp edd assignedDoctorId isSensitive')
      .limit(MAX_ROWS)
      .lean();
    if (patients.length === MAX_ROWS) incomplete = true;
    for (const p of patients) {
      if (!atLeast(recordLevel(req, p), 'clinicalRead')) continue;
      const patient = { id: String(p._id), name: p.name, patientNumber: p.patientNumber };
      if (pregnancyTypes.includes('edd') && p.edd && utcDay(p.edd) >= start && utcDay(p.edd) <= end) {
        out.push({ id: `edd:${p._id}`, type: 'edd', date: isoDay(p.edd), patient });
      }
      if (pregnancyTypes.includes('lmp') && p.lmp && utcDay(p.lmp) >= start && utcDay(p.lmp) <= end) {
        out.push({ id: `lmp:${p._id}`, type: 'lmp', date: isoDay(p.lmp), edd: p.edd ? isoDay(p.edd) : null, ga: p.edd ? gaOn(p.edd, todayLocal()) : null, patient });
      }
    }
  }

  const order = (e) => EVENT_TYPES.indexOf(e.type);
  out.sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b) || (a.start ?? '99:99').localeCompare(b.start ?? '99:99') || a.patient.name.localeCompare(b.patient.name));
  const counts = {};
  for (const e of out) counts[e.date] = (counts[e.date] ?? 0) + 1;
  return {
    from: isoDay(start),
    to: isoDay(end),
    today: todayLocal(),
    allowed,
    types: wanted,
    canChooseScope: isDoctor,
    scope: mine ? 'mine' : 'all',
    events: out,
    counts,
    incomplete,
  };
}
